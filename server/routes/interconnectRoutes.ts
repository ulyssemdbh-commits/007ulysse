import { Router } from "express";
import { interconnectService } from "../services/interconnectService";
import { insertActivityStreamSchema, insertEntityLinkSchema, insertEntityTagSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// ============================================================================
// ACTIVITY STREAM ENDPOINTS
// ============================================================================

router.get("/timeline", async (req, res) => {
  try {
    const { domain, eventType, restaurant, from, to, entityType, minImportance, search, limit, offset } = req.query;
    const result = await interconnectService.getTimeline({
      domain: domain as string,
      eventType: eventType as string,
      restaurant: restaurant as string,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      entityType: entityType as string,
      minImportance: minImportance ? parseInt(minImportance as string) : undefined,
      search: search as string,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/timeline/day/:date", async (req, res) => {
  try {
    const date = new Date(req.params.date);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }
    const grouped = await interconnectService.getCrossDomainDay(date);
    res.json(grouped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/timeline/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const activity = await interconnectService.getActivityById(id);
    if (!activity) return res.status(404).json({ error: "Activity not found" });
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/timeline", async (req, res) => {
  try {
    const data = insertActivityStreamSchema.parse(req.body);
    const entry = await interconnectService.logActivity(data);
    res.status(201).json(entry);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/timeline/batch", async (req, res) => {
  try {
    const entries = z.array(insertActivityStreamSchema).parse(req.body);
    const results = await interconnectService.logActivities(entries);
    res.status(201).json({ inserted: results.length, activities: results });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete("/timeline/:id", async (req, res) => {
  try {
    await interconnectService.deleteActivity(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ENTITY LINKS ENDPOINTS
// ============================================================================

router.post("/links", async (req, res) => {
  try {
    const data = insertEntityLinkSchema.parse(req.body);
    const link = await interconnectService.createLink(data);
    res.status(201).json(link);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/links/batch", async (req, res) => {
  try {
    const entries = z.array(insertEntityLinkSchema).parse(req.body);
    const results = await interconnectService.createLinks(entries);
    res.status(201).json({ inserted: results.length, links: results });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get("/links/:entityType/:entityId", async (req, res) => {
  try {
    const links = await interconnectService.getLinksForEntity(req.params.entityType, req.params.entityId);
    res.json(links);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/links/type/:relationshipType", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const links = await interconnectService.getLinksOfType(req.params.relationshipType, limit);
    res.json(links);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/links/:id", async (req, res) => {
  try {
    await interconnectService.deleteLink(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GRAPH TRAVERSAL
// ============================================================================

router.get("/graph/:entityType/:entityId", async (req, res) => {
  try {
    const depth = req.query.depth ? parseInt(req.query.depth as string) : 2;
    const graph = await interconnectService.traverse(req.params.entityType, req.params.entityId, Math.min(depth, 5));
    res.json(graph);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ENTITY TAGS ENDPOINTS
// ============================================================================

router.post("/tags", async (req, res) => {
  try {
    const data = insertEntityTagSchema.parse(req.body);
    const tag = await interconnectService.addTag(data);
    res.status(201).json(tag);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/tags/batch", async (req, res) => {
  try {
    const entries = z.array(insertEntityTagSchema).parse(req.body);
    const results = await interconnectService.addTags(entries);
    res.status(201).json({ inserted: results.length, tags: results });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get("/tags/:entityType/:entityId", async (req, res) => {
  try {
    const tags = await interconnectService.getTagsForEntity(req.params.entityType, req.params.entityId);
    res.json(tags);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/tags/search/:tag", async (req, res) => {
  try {
    const entities = await interconnectService.findEntitiesByTag(req.params.tag);
    res.json(entities);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/tags/:id", async (req, res) => {
  try {
    await interconnectService.removeTag(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// CROSS-DOMAIN CONTEXT & STATS
// ============================================================================

router.get("/context/:entityType/:entityId", async (req, res) => {
  try {
    const context = await interconnectService.getEntityContext(req.params.entityType, req.params.entityId);
    res.json(context);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const stats = await interconnectService.getInterconnectionStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats/domains", async (req, res) => {
  try {
    const { from, to } = req.query;
    const stats = await interconnectService.getDomainStats({
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
    });
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
