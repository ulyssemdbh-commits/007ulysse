import { db } from "../db";
import { 
  locationSessions, 
  locationPoints, 
  locationPreferences, 
  geofences, 
  geofenceEvents,
  InsertLocationSession,
  InsertLocationPoint,
  InsertLocationPreference,
  InsertGeofence,
  InsertGeofenceEvent,
  LocationSession,
  LocationPoint,
  LocationPreference,
  Geofence,
  GeofenceEvent
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

class GeolocationService {
  async createSession(data: InsertLocationSession): Promise<LocationSession> {
    const [session] = await db.insert(locationSessions).values(data).returning();
    return session;
  }

  async getActiveSession(userId: number, deviceId: string): Promise<LocationSession | null> {
    const [session] = await db.select()
      .from(locationSessions)
      .where(and(
        eq(locationSessions.userId, userId),
        eq(locationSessions.deviceId, deviceId),
        eq(locationSessions.isActive, true)
      ))
      .limit(1);
    return session || null;
  }

  async endSession(sessionId: number): Promise<void> {
    await db.update(locationSessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(eq(locationSessions.id, sessionId));
  }

  async updateSessionLastLocation(sessionId: number): Promise<void> {
    await db.update(locationSessions)
      .set({ lastLocationAt: new Date() })
      .where(eq(locationSessions.id, sessionId));
  }

  async recordLocation(data: InsertLocationPoint): Promise<LocationPoint> {
    const [point] = await db.insert(locationPoints).values(data).returning();
    
    if (data.sessionId) {
      await this.updateSessionLastLocation(data.sessionId);
    }
    
    await this.checkGeofenceTriggers(data.userId, parseFloat(data.latitude), parseFloat(data.longitude), data.accuracy || 50);
    
    return point;
  }

  async recordLocationBatch(points: InsertLocationPoint[]): Promise<LocationPoint[]> {
    if (points.length === 0) return [];
    
    const inserted = await db.insert(locationPoints).values(points).returning();
    
    // Check geofence triggers for each point in order (important for enter/exit detection)
    if (points.length > 0 && points[0]?.userId) {
      const userId = points[0].userId;
      for (const point of points) {
        await this.checkGeofenceTriggers(
          userId, 
          parseFloat(point.latitude), 
          parseFloat(point.longitude), 
          point.accuracy || 50
        );
      }
    }
    
    return inserted;
  }

  async getLocationHistory(
    userId: number, 
    options: { limit?: number; startDate?: Date; endDate?: Date } = {}
  ): Promise<LocationPoint[]> {
    const { limit = 100, startDate, endDate } = options;
    
    // Build conditions array
    const conditions = [eq(locationPoints.userId, userId)];
    
    if (startDate) {
      conditions.push(gte(locationPoints.recordedAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(locationPoints.recordedAt, endDate));
    }
    
    return await db.select()
      .from(locationPoints)
      .where(and(...conditions))
      .orderBy(desc(locationPoints.recordedAt))
      .limit(limit);
  }

  async getLastKnownLocation(userId: number): Promise<LocationPoint | null> {
    const [point] = await db.select()
      .from(locationPoints)
      .where(eq(locationPoints.userId, userId))
      .orderBy(desc(locationPoints.recordedAt))
      .limit(1);
    return point || null;
  }

  async setPreference(data: InsertLocationPreference): Promise<LocationPreference> {
    const existing = await db.select()
      .from(locationPreferences)
      .where(and(
        eq(locationPreferences.userId, data.userId),
        eq(locationPreferences.feature, data.feature)
      ))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db.update(locationPreferences)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(locationPreferences.id, existing[0].id))
        .returning();
      return updated;
    }

    const [preference] = await db.insert(locationPreferences).values(data).returning();
    return preference;
  }

  async getPreferences(userId: number): Promise<LocationPreference[]> {
    return await db.select()
      .from(locationPreferences)
      .where(eq(locationPreferences.userId, userId));
  }

  async getPreference(userId: number, feature: string): Promise<LocationPreference | null> {
    const [preference] = await db.select()
      .from(locationPreferences)
      .where(and(
        eq(locationPreferences.userId, userId),
        eq(locationPreferences.feature, feature)
      ))
      .limit(1);
    return preference || null;
  }

  async createGeofence(data: InsertGeofence): Promise<Geofence> {
    const [geofence] = await db.insert(geofences).values(data).returning();
    return geofence;
  }

  async getGeofences(userId: number, activeOnly: boolean = true): Promise<Geofence[]> {
    if (activeOnly) {
      return await db.select()
        .from(geofences)
        .where(and(
          eq(geofences.userId, userId),
          eq(geofences.isActive, true)
        ));
    }
    return await db.select()
      .from(geofences)
      .where(eq(geofences.userId, userId));
  }

  async getGeofence(id: number, userId: number): Promise<Geofence | null> {
    const [geofence] = await db.select()
      .from(geofences)
      .where(and(
        eq(geofences.id, id),
        eq(geofences.userId, userId)
      ))
      .limit(1);
    return geofence || null;
  }

  async updateGeofence(id: number, userId: number, data: Partial<InsertGeofence>): Promise<Geofence | null> {
    const [updated] = await db.update(geofences)
      .set({ ...data, updatedAt: new Date() })
      .where(and(
        eq(geofences.id, id),
        eq(geofences.userId, userId)
      ))
      .returning();
    return updated || null;
  }

  async deleteGeofence(id: number, userId: number): Promise<boolean> {
    const result = await db.delete(geofences)
      .where(and(
        eq(geofences.id, id),
        eq(geofences.userId, userId)
      ));
    return true;
  }

  async recordGeofenceEvent(data: InsertGeofenceEvent): Promise<GeofenceEvent> {
    const [event] = await db.insert(geofenceEvents).values(data).returning();
    
    await db.update(geofences)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(geofences.id, data.geofenceId));
    
    return event;
  }

  async getGeofenceEvents(userId: number, geofenceId?: number, limit: number = 50): Promise<GeofenceEvent[]> {
    if (geofenceId) {
      return await db.select()
        .from(geofenceEvents)
        .where(and(
          eq(geofenceEvents.userId, userId),
          eq(geofenceEvents.geofenceId, geofenceId)
        ))
        .orderBy(desc(geofenceEvents.triggeredAt))
        .limit(limit);
    }
    return await db.select()
      .from(geofenceEvents)
      .where(eq(geofenceEvents.userId, userId))
      .orderBy(desc(geofenceEvents.triggeredAt))
      .limit(limit);
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  async checkGeofenceTriggers(userId: number, lat: number, lon: number, accuracy: number): Promise<GeofenceEvent[]> {
    const activeGeofences = await this.getGeofences(userId, true);
    const triggeredEvents: GeofenceEvent[] = [];

    for (const geofence of activeGeofences) {
      const geofenceLat = parseFloat(geofence.latitude);
      const geofenceLon = parseFloat(geofence.longitude);
      const distance = this.calculateDistance(lat, lon, geofenceLat, geofenceLon);
      const isInside = distance <= geofence.radiusMeters + accuracy;

      const recentEvents = await db.select()
        .from(geofenceEvents)
        .where(and(
          eq(geofenceEvents.geofenceId, geofence.id),
          gte(geofenceEvents.triggeredAt, new Date(Date.now() - geofence.cooldownMinutes * 60 * 1000))
        ))
        .orderBy(desc(geofenceEvents.triggeredAt))
        .limit(1);

      const lastEvent = recentEvents[0];
      const wasInside = lastEvent?.eventType === 'enter' || lastEvent?.eventType === 'dwell';

      let eventType: 'enter' | 'exit' | null = null;
      
      if (isInside && !wasInside && (geofence.triggerOn === 'enter' || geofence.triggerOn === 'both')) {
        eventType = 'enter';
      } else if (!isInside && wasInside && (geofence.triggerOn === 'exit' || geofence.triggerOn === 'both')) {
        eventType = 'exit';
      }

      if (eventType && (!geofence.lastTriggeredAt || 
          Date.now() - geofence.lastTriggeredAt.getTime() > geofence.cooldownMinutes * 60 * 1000)) {
        const event = await this.recordGeofenceEvent({
          userId,
          geofenceId: geofence.id,
          eventType,
          latitude: lat.toString(),
          longitude: lon.toString(),
          accuracy,
          actionExecuted: false,
          triggeredAt: new Date()
        });
        triggeredEvents.push(event);
        
        console.log(`[Geolocation] Geofence "${geofence.name}" triggered: ${eventType}`);
      }
    }

    return triggeredEvents;
  }

  async cleanupOldData(userId: number, retentionDays: number = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    
    const result = await db.delete(locationPoints)
      .where(and(
        eq(locationPoints.userId, userId),
        lte(locationPoints.recordedAt, cutoffDate)
      ));
    
    return 0;
  }

  async getLocationStats(userId: number): Promise<{
    totalPoints: number;
    lastLocation: LocationPoint | null;
    activeGeofences: number;
    recentEvents: number;
  }> {
    const [pointCount] = await db.select({ count: sql<number>`count(*)` })
      .from(locationPoints)
      .where(eq(locationPoints.userId, userId));

    const lastLocation = await this.getLastKnownLocation(userId);

    const [geofenceCount] = await db.select({ count: sql<number>`count(*)` })
      .from(geofences)
      .where(and(
        eq(geofences.userId, userId),
        eq(geofences.isActive, true)
      ));

    const [eventCount] = await db.select({ count: sql<number>`count(*)` })
      .from(geofenceEvents)
      .where(and(
        eq(geofenceEvents.userId, userId),
        gte(geofenceEvents.triggeredAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      ));

    return {
      totalPoints: Number(pointCount?.count || 0),
      lastLocation,
      activeGeofences: Number(geofenceCount?.count || 0),
      recentEvents: Number(eventCount?.count || 0)
    };
  }

  getFormattedLocationForAI(location: LocationPoint | null): string {
    if (!location) {
      return "Position actuelle: Non disponible (géolocalisation non activée ou pas de données récentes)";
    }

    const date = location.recordedAt.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    let formatted = `Position actuelle (${date}):\n`;
    formatted += `- Coordonnées: ${location.latitude}, ${location.longitude}\n`;
    if (location.address) formatted += `- Adresse: ${location.address}\n`;
    if (location.city) formatted += `- Ville: ${location.city}\n`;
    if (location.accuracy) formatted += `- Précision: ±${location.accuracy}m\n`;

    return formatted;
  }
}

export const geolocationService = new GeolocationService();
