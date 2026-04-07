import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const locationSessions = pgTable("location_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name"),
  isActive: boolean("is_active").notNull().default(true),
  consentGranted: boolean("consent_granted").notNull().default(false),
  consentTimestamp: timestamp("consent_timestamp"),
  accuracyMode: text("accuracy_mode").notNull().default("balanced"),
  updateIntervalMs: integer("update_interval_ms").notNull().default(600000),
  backgroundEnabled: boolean("background_enabled").notNull().default(false),
  lastLocationAt: timestamp("last_location_at"),
  createdAt: timestamp("created_at").defaultNow(),
  endedAt: timestamp("ended_at"),
});

export const locationPoints = pgTable("location_points", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sessionId: integer("session_id"),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  altitude: text("altitude"),
  accuracy: integer("accuracy"),
  altitudeAccuracy: integer("altitude_accuracy"),
  heading: integer("heading"),
  speed: integer("speed"),
  context: text("context"),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  metadata: jsonb("metadata"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const locationPreferences = pgTable("location_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  feature: text("feature").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  accuracy: text("accuracy").notNull().default("balanced"),
  retentionDays: integer("retention_days").notNull().default(30),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const geofences = pgTable("geofences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(100),
  type: text("type").notNull().default("circle"),
  triggerOn: text("trigger_on").notNull().default("both"),
  isActive: boolean("is_active").notNull().default(true),
  linkedAction: text("linked_action"),
  linkedActionId: integer("linked_action_id"),
  actionPayload: jsonb("action_payload"),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  lastTriggeredAt: timestamp("last_triggered_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const geofenceEvents = pgTable("geofence_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  geofenceId: integer("geofence_id").notNull(),
  eventType: text("event_type").notNull(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  accuracy: integer("accuracy"),
  actionExecuted: boolean("action_executed").notNull().default(false),
  actionResult: text("action_result"),
  dwellTimeMinutes: integer("dwell_time_minutes"),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const savedRoutes = pgTable("saved_routes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  profile: text("profile").notNull().default("driving"),
  totalDistance: integer("total_distance"),
  totalDuration: integer("total_duration"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  isTemplate: boolean("is_template").notNull().default(false),
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").notNull().default(0),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const routeWaypoints = pgTable("route_waypoints", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull(),
  userId: integer("user_id").notNull(),
  orderIndex: integer("order_index").notNull(),
  label: text("label").notNull(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  address: text("address"),
  name: text("name"),
  estimatedArrival: timestamp("estimated_arrival"),
  estimatedDuration: integer("estimated_duration"),
  estimatedDistance: integer("estimated_distance"),
  isCurrentLocation: boolean("is_current_location").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const routeHistory = pgTable("route_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  savedRouteId: integer("saved_route_id"),
  name: text("name"),
  profile: text("profile").notNull().default("driving"),
  startAddress: text("start_address"),
  endAddress: text("end_address"),
  waypointsData: jsonb("waypoints_data").default([]),
  plannedDistance: integer("planned_distance"),
  plannedDuration: integer("planned_duration"),
  actualDistance: integer("actual_distance"),
  actualDuration: integer("actual_duration"),
  deviationCount: integer("deviation_count").notNull().default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const routePreferences = pgTable("route_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  defaultProfile: text("default_profile").notNull().default("driving"),
  avoidTolls: boolean("avoid_tolls").notNull().default(false),
  avoidHighways: boolean("avoid_highways").notNull().default(false),
  avoidFerries: boolean("avoid_ferries").notNull().default(false),
  optimizeOrder: boolean("optimize_order").notNull().default(true),
  showAlternatives: boolean("show_alternatives").notNull().default(false),
  voiceGuidance: boolean("voice_guidance").notNull().default(true),
  autoRecalculate: boolean("auto_recalculate").notNull().default(true),
  deviationThreshold: integer("deviation_threshold").notNull().default(50),
  arrivalAlertDistance: integer("arrival_alert_distance").notNull().default(200),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const activeNavigation = pgTable("active_navigation", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  routeId: integer("route_id"),
  currentWaypointIndex: integer("current_waypoint_index").notNull().default(0),
  currentInstructionIndex: integer("current_instruction_index").notNull().default(0),
  waypointsData: jsonb("waypoints_data").notNull().default([]),
  instructionsData: jsonb("instructions_data").notNull().default([]),
  profile: text("profile").notNull().default("driving"),
  totalDistance: integer("total_distance"),
  totalDuration: integer("total_duration"),
  remainingDistance: integer("remaining_distance"),
  remainingDuration: integer("remaining_duration"),
  lastKnownLat: text("last_known_lat"),
  lastKnownLng: text("last_known_lng"),
  isOffRoute: boolean("is_off_route").notNull().default(false),
  offRouteCount: integer("off_route_count").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLocationSessionSchema = createInsertSchema(locationSessions).omit({ id: true, createdAt: true, endedAt: true, lastLocationAt: true });
export const insertLocationPointSchema = createInsertSchema(locationPoints).omit({ id: true, createdAt: true });
export const insertLocationPreferenceSchema = createInsertSchema(locationPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGeofenceSchema = createInsertSchema(geofences).omit({ id: true, createdAt: true, updatedAt: true, lastTriggeredAt: true });
export const insertGeofenceEventSchema = createInsertSchema(geofenceEvents).omit({ id: true, createdAt: true });

export const insertSavedRouteSchema = createInsertSchema(savedRoutes).omit({ id: true, createdAt: true, updatedAt: true, lastUsedAt: true });
export const insertRouteWaypointSchema = createInsertSchema(routeWaypoints).omit({ id: true, createdAt: true });
export const insertRouteHistorySchema = createInsertSchema(routeHistory).omit({ id: true, createdAt: true, startedAt: true, completedAt: true });
export const insertRoutePreferencesSchema = createInsertSchema(routePreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertActiveNavigationSchema = createInsertSchema(activeNavigation).omit({ id: true, startedAt: true, updatedAt: true });

export type LocationSession = typeof locationSessions.$inferSelect;
export type InsertLocationSession = z.infer<typeof insertLocationSessionSchema>;

export type LocationPoint = typeof locationPoints.$inferSelect;
export type InsertLocationPoint = z.infer<typeof insertLocationPointSchema>;

export type LocationPreference = typeof locationPreferences.$inferSelect;
export type InsertLocationPreference = z.infer<typeof insertLocationPreferenceSchema>;

export type Geofence = typeof geofences.$inferSelect;
export type InsertGeofence = z.infer<typeof insertGeofenceSchema>;

export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type InsertGeofenceEvent = z.infer<typeof insertGeofenceEventSchema>;

export type SavedRoute = typeof savedRoutes.$inferSelect;
export type InsertSavedRoute = z.infer<typeof insertSavedRouteSchema>;

export type RouteWaypoint = typeof routeWaypoints.$inferSelect;
export type InsertRouteWaypoint = z.infer<typeof insertRouteWaypointSchema>;

export type RouteHistory = typeof routeHistory.$inferSelect;
export type InsertRouteHistory = z.infer<typeof insertRouteHistorySchema>;

export type RoutePreferences = typeof routePreferences.$inferSelect;
export type InsertRoutePreferences = z.infer<typeof insertRoutePreferencesSchema>;

export type ActiveNavigation = typeof activeNavigation.$inferSelect;
export type InsertActiveNavigation = z.infer<typeof insertActiveNavigationSchema>;
