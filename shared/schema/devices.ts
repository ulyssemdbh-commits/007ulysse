import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceName: text("device_name").notNull(),
  deviceType: text("device_type").notNull().default("unknown"),
  deviceIdentifier: text("device_identifier").notNull().unique(),
  lastSeen: timestamp("last_seen").defaultNow(),
  lastIp: text("last_ip"),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").notNull().default(true),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: integer("device_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  preferences: jsonb("preferences").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const knownPersons = pgTable("known_persons", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  notes: text("notes"),
  thumbnailPath: text("thumbnail_path"),
  isOwner: boolean("is_owner").notNull().default(false),
  photoCount: integer("photo_count").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const faceDescriptors = pgTable("face_descriptors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  personId: integer("person_id"),
  descriptor: jsonb("descriptor").notNull(),
  sourceMediaId: integer("source_media_id"),
  quality: real("quality").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mediaFaces = pgTable("media_faces", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id").notNull(),
  personId: integer("person_id"),
  descriptorId: integer("descriptor_id"),
  boxX: real("box_x").notNull(),
  boxY: real("box_y").notNull(),
  boxWidth: real("box_width").notNull(),
  boxHeight: real("box_height").notNull(),
  confidence: real("confidence").notNull(),
  isConfirmed: boolean("is_confirmed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ulysseCharter = pgTable("ulysse_charter", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  communicationStyle: text("communication_style").default("direct"),
  language: text("language").default("fr"),
  responseLength: text("response_length").default("concise"),
  priorityDomains: text("priority_domains").array().default([]),
  activeProjects: jsonb("active_projects").default([]),
  behaviorRules: jsonb("behavior_rules").default([]),
  wakeWord: text("wake_word").default("Ulysse"),
  voicePersonality: text("voice_personality").default("professional"),
  rememberConversations: boolean("remember_conversations").notNull().default(true),
  contextRetentionDays: integer("context_retention_days").default(30),
  proactiveInsights: boolean("proactive_insights").notNull().default(true),
  dailyBriefEnabled: boolean("daily_brief_enabled").notNull().default(true),
  dailyBriefTime: text("daily_brief_time").default("08:00"),
  customInstructions: text("custom_instructions"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mediaLibrary = pgTable("media_library", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  duration: integer("duration"),
  width: integer("width"),
  height: integer("height"),
  description: text("description"),
  tags: text("tags").array().default([]),
  isFavorite: boolean("is_favorite").notNull().default(false),
  capturedAt: timestamp("captured_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const devicesRelations = relations(devices, ({ one }) => ({
  user: one(users, {
    fields: [devices.userId],
    references: [users.id],
  }),
}));

export const insertDeviceSchema = createInsertSchema(devices).omit({ id: true, createdAt: true, lastSeen: true });
export const insertApiTokenSchema = createInsertSchema(apiTokens).omit({ id: true, createdAt: true, lastUsedAt: true });
export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKnownPersonSchema = createInsertSchema(knownPersons).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFaceDescriptorSchema = createInsertSchema(faceDescriptors).omit({ id: true, createdAt: true });
export const insertMediaFaceSchema = createInsertSchema(mediaFaces).omit({ id: true, createdAt: true });
export const insertUlysseCharterSchema = createInsertSchema(ulysseCharter).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMediaLibrarySchema = createInsertSchema(mediaLibrary).omit({ id: true, createdAt: true, capturedAt: true });

export type Device = typeof devices.$inferSelect;
export type InsertDevice = z.infer<typeof insertDeviceSchema>;

export type ApiToken = typeof apiTokens.$inferSelect;
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;

export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;

export type KnownPerson = typeof knownPersons.$inferSelect;
export type InsertKnownPerson = z.infer<typeof insertKnownPersonSchema>;

export type FaceDescriptor = typeof faceDescriptors.$inferSelect;
export type InsertFaceDescriptor = z.infer<typeof insertFaceDescriptorSchema>;

export type MediaFace = typeof mediaFaces.$inferSelect;
export type InsertMediaFace = z.infer<typeof insertMediaFaceSchema>;

export type UlysseCharter = typeof ulysseCharter.$inferSelect;
export type InsertUlysseCharter = z.infer<typeof insertUlysseCharterSchema>;

export type MediaLibrary = typeof mediaLibrary.$inferSelect;
export type InsertMediaLibrary = z.infer<typeof insertMediaLibrarySchema>;
