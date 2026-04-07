import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const surveillanceCameras = pgTable("surveillance_cameras", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  location: text("location"),
  cameraType: text("camera_type").notNull().default("ip"),
  streamUrl: text("stream_url"),
  snapshotUrl: text("snapshot_url"),
  username: text("username"),
  passwordEncrypted: text("password_encrypted"),
  ipAddress: text("ip_address"),
  port: integer("port").default(554),
  protocol: text("protocol").notNull().default("rtsp"),
  serialNumber: text("serial_number"),
  channelNumber: integer("channel_number").default(1),
  nvrIpAddress: text("nvr_ip_address"),
  resolution: text("resolution").default("1080p"),
  fps: integer("fps").default(15),
  hasMotionDetection: boolean("has_motion_detection").notNull().default(false),
  motionSensitivity: integer("motion_sensitivity").default(50),
  hasFaceRecognition: boolean("has_face_recognition").notNull().default(false),
  isOnline: boolean("is_online").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at"),
  lastSnapshotAt: timestamp("last_snapshot_at"),
  lastSnapshotUrl: text("last_snapshot_url"),
  notifyOnMotion: boolean("notify_on_motion").notNull().default(true),
  notifyOnPerson: boolean("notify_on_person").notNull().default(true),
  recordingEnabled: boolean("recording_enabled").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const cameraEvents = pgTable("camera_events", {
  id: serial("id").primaryKey(),
  cameraId: integer("camera_id").notNull(),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(),
  personId: integer("person_id"),
  personName: text("person_name"),
  confidence: integer("confidence"),
  snapshotUrl: text("snapshot_url"),
  metadata: jsonb("metadata").default({}),
  isAcknowledged: boolean("is_acknowledged").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const smartDevices = pgTable("smart_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  room: text("room"),
  vendor: text("vendor"),
  externalId: text("external_id"),
  capabilities: jsonb("capabilities").default([]),
  state: jsonb("state").default({}),
  ipAddress: text("ip_address"),
  macAddress: text("mac_address"),
  accessToken: text("access_token"),
  isOnline: boolean("is_online").notNull().default(false),
  lastStateAt: timestamp("last_state_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const smartScenes = pgTable("smart_scenes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").default("home"),
  color: text("color").default("#3B82F6"),
  actions: jsonb("actions").notNull().default([]),
  trigger: text("trigger"),
  triggerConfig: jsonb("trigger_config").default({}),
  isActive: boolean("is_active").notNull().default(true),
  lastActivatedAt: timestamp("last_activated_at"),
  activationCount: integer("activation_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const siriWebhooks = pgTable("siri_webhooks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  phrase: text("phrase").notNull(),
  action: text("action").notNull(),
  actionTarget: text("action_target"),
  actionParams: jsonb("action_params").default({}),
  webhookToken: text("webhook_token").notNull(),
  webhookSecret: text("webhook_secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userBehaviorEvents = pgTable("user_behavior_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(),
  eventSource: text("event_source").notNull(),
  targetType: text("target_type"),
  targetId: integer("target_id"),
  targetName: text("target_name"),
  context: jsonb("context").default({}),
  previousState: jsonb("previous_state").default({}),
  newState: jsonb("new_state").default({}),
  occurredAt: timestamp("occurred_at").defaultNow(),
});

export const proactiveSuggestions = pgTable("proactive_suggestions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  suggestionType: text("suggestion_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  action: text("action").notNull(),
  actionTarget: text("action_target"),
  actionParams: jsonb("action_params").default({}),
  confidence: integer("confidence").notNull().default(50),
  basedOnPatterns: jsonb("based_on_patterns").default([]),
  triggerConditions: jsonb("trigger_conditions").default({}),
  status: text("status").notNull().default("pending"),
  userFeedback: text("user_feedback"),
  shownAt: timestamp("shown_at"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const learnedPatterns = pgTable("learned_patterns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  patternType: text("pattern_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  conditions: jsonb("conditions").notNull().default({}),
  actions: jsonb("actions").notNull().default([]),
  confidence: integer("confidence").notNull().default(0),
  occurrences: integer("occurrences").notNull().default(0),
  lastOccurrence: timestamp("last_occurrence"),
  isConfirmed: boolean("is_confirmed").notNull().default(false),
  isAutomated: boolean("is_automated").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const monitoredSites = pgTable("monitored_sites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  url: text("url").notNull(),
  name: text("name").notNull(),
  checkInterval: integer("check_interval").notNull().default(60),
  alertThreshold: integer("alert_threshold").notNull().default(30000),
  isActive: boolean("is_active").notNull().default(true),
  lastCheckAt: timestamp("last_check_at"),
  lastStatus: text("last_status"),
  lastResponseTime: integer("last_response_time"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const monitoringChecks = pgTable("monitoring_checks", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull(),
  responseTimeMs: integer("response_time_ms"),
  httpStatus: integer("http_status"),
  errorMessage: text("error_message"),
  contentLength: integer("content_length"),
  checkedAt: timestamp("checked_at").defaultNow(),
});

export const monitoringAlerts = pgTable("monitoring_alerts", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull(),
  userId: integer("user_id").notNull(),
  alertType: text("alert_type").notNull(),
  message: text("message").notNull(),
  responseTimeMs: integer("response_time_ms"),
  isRead: boolean("is_read").notNull().default(false),
  isNotified: boolean("is_notified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
});

export const screenMonitorPreferences = pgTable("screen_monitor_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  captureIntervalMs: integer("capture_interval_ms").notNull().default(2000),
  captureQuality: text("capture_quality").notNull().default("medium"),
  privacyFilters: text("privacy_filters").array().default([]),
  activeHoursStart: text("active_hours_start"),
  activeHoursEnd: text("active_hours_end"),
  pauseOnInactivity: boolean("pause_on_inactivity").notNull().default(true),
  inactivityTimeoutMs: integer("inactivity_timeout_ms").notNull().default(120000),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const screenMonitorSessions = pgTable("screen_monitor_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  totalFrames: integer("total_frames").notNull().default(0),
  totalAnalyses: integer("total_analyses").notNull().default(0),
  status: text("status").notNull().default("active"),
});

export const screenContextEvents = pgTable("screen_context_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sessionId: integer("session_id").notNull(),
  activeApp: text("active_app"),
  activeWindow: text("active_window"),
  context: text("context").notNull(),
  tags: text("tags").array().default([]),
  confidence: real("confidence").notNull().default(0.8),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const screenWorkPatterns = pgTable("screen_work_patterns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  patternType: text("pattern_type").notNull(),
  patternName: text("pattern_name").notNull(),
  patternData: jsonb("pattern_data").notNull(),
  occurrences: integer("occurrences").notNull().default(1),
  confidence: real("confidence").notNull().default(0.5),
  lastObserved: timestamp("last_observed").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSurveillanceCameraSchema = createInsertSchema(surveillanceCameras).omit({ id: true, createdAt: true, updatedAt: true, lastSeenAt: true, lastSnapshotAt: true });
export const insertCameraEventSchema = createInsertSchema(cameraEvents).omit({ id: true, createdAt: true });
export const insertSmartDeviceSchema = createInsertSchema(smartDevices).omit({ id: true, createdAt: true, updatedAt: true, lastStateAt: true });
export const insertSmartSceneSchema = createInsertSchema(smartScenes).omit({ id: true, createdAt: true, updatedAt: true, lastActivatedAt: true });
export const insertSiriWebhookSchema = createInsertSchema(siriWebhooks).omit({ id: true, createdAt: true, lastTriggeredAt: true });
export const insertUserBehaviorEventSchema = createInsertSchema(userBehaviorEvents).omit({ id: true, occurredAt: true });
export const insertProactiveSuggestionSchema = createInsertSchema(proactiveSuggestions).omit({ id: true, createdAt: true, shownAt: true, respondedAt: true });
export const insertLearnedPatternSchema = createInsertSchema(learnedPatterns).omit({ id: true, createdAt: true, updatedAt: true, lastOccurrence: true });
export const insertMonitoredSiteSchema = createInsertSchema(monitoredSites).omit({ id: true, createdAt: true, updatedAt: true, lastCheckAt: true });
export const insertMonitoringCheckSchema = createInsertSchema(monitoringChecks).omit({ id: true, checkedAt: true });
export const insertMonitoringAlertSchema = createInsertSchema(monitoringAlerts).omit({ id: true, createdAt: true, acknowledgedAt: true });
export const insertScreenMonitorPreferencesSchema = createInsertSchema(screenMonitorPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertScreenMonitorSessionSchema = createInsertSchema(screenMonitorSessions).omit({ id: true, startedAt: true, endedAt: true });
export const insertScreenContextEventSchema = createInsertSchema(screenContextEvents).omit({ id: true, timestamp: true });
export const insertScreenWorkPatternSchema = createInsertSchema(screenWorkPatterns).omit({ id: true, createdAt: true, lastObserved: true });

export type SurveillanceCamera = typeof surveillanceCameras.$inferSelect;
export type InsertSurveillanceCamera = z.infer<typeof insertSurveillanceCameraSchema>;

export type CameraEvent = typeof cameraEvents.$inferSelect;
export type InsertCameraEvent = z.infer<typeof insertCameraEventSchema>;

export type SmartDevice = typeof smartDevices.$inferSelect;
export type InsertSmartDevice = z.infer<typeof insertSmartDeviceSchema>;

export type SmartScene = typeof smartScenes.$inferSelect;
export type InsertSmartScene = z.infer<typeof insertSmartSceneSchema>;

export type SiriWebhook = typeof siriWebhooks.$inferSelect;
export type InsertSiriWebhook = z.infer<typeof insertSiriWebhookSchema>;

export type UserBehaviorEvent = typeof userBehaviorEvents.$inferSelect;
export type InsertUserBehaviorEvent = z.infer<typeof insertUserBehaviorEventSchema>;

export type ProactiveSuggestion = typeof proactiveSuggestions.$inferSelect;
export type InsertProactiveSuggestion = z.infer<typeof insertProactiveSuggestionSchema>;

export type LearnedPattern = typeof learnedPatterns.$inferSelect;
export type InsertLearnedPattern = z.infer<typeof insertLearnedPatternSchema>;

export type MonitoredSite = typeof monitoredSites.$inferSelect;
export type InsertMonitoredSite = z.infer<typeof insertMonitoredSiteSchema>;

export type MonitoringCheck = typeof monitoringChecks.$inferSelect;
export type InsertMonitoringCheck = z.infer<typeof insertMonitoringCheckSchema>;

export type MonitoringAlert = typeof monitoringAlerts.$inferSelect;
export type InsertMonitoringAlert = z.infer<typeof insertMonitoringAlertSchema>;

export type ScreenMonitorPreferences = typeof screenMonitorPreferences.$inferSelect;
export type InsertScreenMonitorPreferences = z.infer<typeof insertScreenMonitorPreferencesSchema>;

export type ScreenMonitorSession = typeof screenMonitorSessions.$inferSelect;
export type InsertScreenMonitorSession = z.infer<typeof insertScreenMonitorSessionSchema>;

export type ScreenContextEvent = typeof screenContextEvents.$inferSelect;
export type InsertScreenContextEvent = z.infer<typeof insertScreenContextEventSchema>;

export type ScreenWorkPattern = typeof screenWorkPatterns.$inferSelect;
export type InsertScreenWorkPattern = z.infer<typeof insertScreenWorkPatternSchema>;
