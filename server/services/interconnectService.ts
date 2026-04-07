import { db } from "../db";
import {
  activityStream, entityLinks, entityTags,
  type InsertActivityStream, type InsertEntityLink, type InsertEntityTag,
  type ActivityStream, type EntityLink, type EntityTag
} from "@shared/schema";
import { eq, and, or, desc, asc, gte, lte, sql, ilike } from "drizzle-orm";

export const interconnectService = {

  // ============================================================================
  // ACTIVITY STREAM
  // ============================================================================

  async logActivity(data: InsertActivityStream): Promise<ActivityStream> {
    const [entry] = await db.insert(activityStream).values(data).returning();
    return entry;
  },

  async logActivities(entries: InsertActivityStream[]): Promise<ActivityStream[]> {
    if (entries.length === 0) return [];
    const results = await db.insert(activityStream).values(entries).returning();
    return results;
  },

  async getTimeline(filters: {
    domain?: string;
    eventType?: string;
    restaurant?: string;
    from?: Date;
    to?: Date;
    entityType?: string;
    minImportance?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ activities: ActivityStream[]; total: number }> {
    const conditions = [];
    if (filters.domain) conditions.push(eq(activityStream.domain, filters.domain));
    if (filters.eventType) conditions.push(eq(activityStream.eventType, filters.eventType));
    if (filters.restaurant) conditions.push(eq(activityStream.restaurant, filters.restaurant));
    if (filters.from) conditions.push(gte(activityStream.occurredAt, filters.from));
    if (filters.to) conditions.push(lte(activityStream.occurredAt, filters.to));
    if (filters.entityType) conditions.push(eq(activityStream.entityType, filters.entityType));
    if (filters.minImportance) conditions.push(gte(activityStream.importance, filters.minImportance));
    if (filters.search) conditions.push(ilike(activityStream.title, `%${filters.search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [activities, countResult] = await Promise.all([
      db.select().from(activityStream)
        .where(where)
        .orderBy(desc(activityStream.occurredAt))
        .limit(filters.limit || 50)
        .offset(filters.offset || 0),
      db.select({ count: sql<number>`count(*)::int` }).from(activityStream).where(where)
    ]);

    return { activities, total: countResult[0]?.count || 0 };
  },

  async getActivityById(id: number): Promise<ActivityStream | undefined> {
    const [entry] = await db.select().from(activityStream).where(eq(activityStream.id, id));
    return entry;
  },

  async deleteActivity(id: number): Promise<void> {
    await db.delete(activityStream).where(eq(activityStream.id, id));
  },

  async getCrossDomainDay(date: Date): Promise<Record<string, ActivityStream[]>> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const activities = await db.select().from(activityStream)
      .where(and(
        gte(activityStream.occurredAt, dayStart),
        lte(activityStream.occurredAt, dayEnd)
      ))
      .orderBy(asc(activityStream.occurredAt));

    const grouped: Record<string, ActivityStream[]> = {};
    for (const a of activities) {
      if (!grouped[a.domain]) grouped[a.domain] = [];
      grouped[a.domain].push(a);
    }
    return grouped;
  },

  async getDomainStats(filters?: { from?: Date; to?: Date }): Promise<{ domain: string; count: number; lastEvent: Date | null }[]> {
    const conditions = [];
    if (filters?.from) conditions.push(gte(activityStream.occurredAt, filters.from));
    if (filters?.to) conditions.push(lte(activityStream.occurredAt, filters.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const stats = await db.select({
      domain: activityStream.domain,
      count: sql<number>`count(*)::int`,
      lastEvent: sql<Date>`max(${activityStream.occurredAt})`,
    }).from(activityStream).where(where).groupBy(activityStream.domain);

    return stats;
  },

  // ============================================================================
  // ENTITY LINKS
  // ============================================================================

  async createLink(data: InsertEntityLink): Promise<EntityLink> {
    const [link] = await db.insert(entityLinks).values(data).returning();
    return link;
  },

  async createLinks(entries: InsertEntityLink[]): Promise<EntityLink[]> {
    if (entries.length === 0) return [];
    const results = await db.insert(entityLinks).values(entries).returning();
    return results;
  },

  async getLinksForEntity(entityType: string, entityId: string): Promise<EntityLink[]> {
    const links = await db.select().from(entityLinks)
      .where(or(
        and(eq(entityLinks.sourceType, entityType), eq(entityLinks.sourceId, entityId)),
        and(eq(entityLinks.targetType, entityType), eq(entityLinks.targetId, entityId))
      ))
      .orderBy(desc(entityLinks.strength));
    return links;
  },

  async getLinksOfType(relationshipType: string, limit?: number): Promise<EntityLink[]> {
    return db.select().from(entityLinks)
      .where(eq(entityLinks.relationshipType, relationshipType))
      .orderBy(desc(entityLinks.createdAt))
      .limit(limit || 50);
  },

  async deleteLink(id: number): Promise<void> {
    await db.delete(entityLinks).where(eq(entityLinks.id, id));
  },

  async traverse(entityType: string, entityId: string, depth: number = 2): Promise<{
    nodes: { type: string; id: string }[];
    edges: EntityLink[];
  }> {
    const visited = new Set<string>();
    const allEdges: EntityLink[] = [];
    const queue: { type: string; id: string; currentDepth: number }[] = [
      { type: entityType, id: entityId, currentDepth: 0 }
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = `${current.type}:${current.id}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (current.currentDepth >= depth) continue;

      const links = await this.getLinksForEntity(current.type, current.id);
      for (const link of links) {
        allEdges.push(link);
        const nextType = link.sourceType === current.type && link.sourceId === current.id
          ? link.targetType : link.sourceType;
        const nextId = link.sourceType === current.type && link.sourceId === current.id
          ? link.targetId : link.sourceId;
        const nextKey = `${nextType}:${nextId}`;
        if (!visited.has(nextKey)) {
          queue.push({ type: nextType, id: nextId, currentDepth: current.currentDepth + 1 });
        }
      }
    }

    const nodes = Array.from(visited).map(k => {
      const [type, id] = k.split(":");
      return { type, id };
    });

    const uniqueEdges = allEdges.filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i);

    return { nodes, edges: uniqueEdges };
  },

  // ============================================================================
  // ENTITY TAGS
  // ============================================================================

  async addTag(data: InsertEntityTag): Promise<EntityTag> {
    const [tag] = await db.insert(entityTags).values(data).returning();
    return tag;
  },

  async addTags(entries: InsertEntityTag[]): Promise<EntityTag[]> {
    if (entries.length === 0) return [];
    const results = await db.insert(entityTags).values(entries).returning();
    return results;
  },

  async getTagsForEntity(entityType: string, entityId: string): Promise<EntityTag[]> {
    return db.select().from(entityTags)
      .where(and(eq(entityTags.entityType, entityType), eq(entityTags.entityId, entityId)));
  },

  async findEntitiesByTag(tag: string): Promise<EntityTag[]> {
    return db.select().from(entityTags).where(eq(entityTags.tag, tag));
  },

  async findEntitiesByTags(tags: string[]): Promise<EntityTag[]> {
    if (tags.length === 0) return [];
    const conditions = tags.map(t => eq(entityTags.tag, t));
    return db.select().from(entityTags).where(or(...conditions));
  },

  async removeTag(id: number): Promise<void> {
    await db.delete(entityTags).where(eq(entityTags.id, id));
  },

  async removeTagsForEntity(entityType: string, entityId: string): Promise<void> {
    await db.delete(entityTags).where(
      and(eq(entityTags.entityType, entityType), eq(entityTags.entityId, entityId))
    );
  },

  // ============================================================================
  // CROSS-DOMAIN QUERIES
  // ============================================================================

  async getEntityContext(entityType: string, entityId: string): Promise<{
    tags: EntityTag[];
    links: EntityLink[];
    activities: ActivityStream[];
    graph: { nodes: { type: string; id: string }[]; edges: EntityLink[] };
  }> {
    const [tags, links, activitiesResult, graph] = await Promise.all([
      this.getTagsForEntity(entityType, entityId),
      this.getLinksForEntity(entityType, entityId),
      this.getTimeline({ entityType, limit: 20 }),
      this.traverse(entityType, entityId, 2),
    ]);

    const activities = activitiesResult.activities.filter(
      a => a.entityType === entityType && a.entityId === entityId
    );

    return { tags, links, activities, graph };
  },

  async getInterconnectionStats(): Promise<{
    totalActivities: number;
    totalLinks: number;
    totalTags: number;
    domainCoverage: { domain: string; count: number }[];
    topRelationships: { type: string; count: number }[];
    topTags: { tag: string; count: number }[];
  }> {
    const [activitiesCount, linksCount, tagsCount, domainCoverage, topRelationships, topTags] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(activityStream),
      db.select({ count: sql<number>`count(*)::int` }).from(entityLinks),
      db.select({ count: sql<number>`count(*)::int` }).from(entityTags),
      db.select({
        domain: activityStream.domain,
        count: sql<number>`count(*)::int`,
      }).from(activityStream).groupBy(activityStream.domain).orderBy(sql`count(*) desc`),
      db.select({
        type: entityLinks.relationshipType,
        count: sql<number>`count(*)::int`,
      }).from(entityLinks).groupBy(entityLinks.relationshipType).orderBy(sql`count(*) desc`).limit(10),
      db.select({
        tag: entityTags.tag,
        count: sql<number>`count(*)::int`,
      }).from(entityTags).groupBy(entityTags.tag).orderBy(sql`count(*) desc`).limit(10),
    ]);

    return {
      totalActivities: activitiesCount[0]?.count || 0,
      totalLinks: linksCount[0]?.count || 0,
      totalTags: tagsCount[0]?.count || 0,
      domainCoverage,
      topRelationships,
      topTags,
    };
  },
};
