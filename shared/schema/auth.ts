import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  plainPassword: text("plain_password"),
  displayName: text("display_name"),
  role: text("role").notNull().default("guest"),
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  twoFactorVerified: boolean("two_factor_verified").default(false),
});

export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type"),
  transports: text("transports").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const approvedUsers = pgTable("approved_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  approvedBy: integer("approved_by").notNull(),
  accessLevel: text("access_level").notNull().default("basic"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const guestSessions = pgTable("guest_sessions", {
  id: text("id").primaryKey(),
  displayName: text("display_name"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  messageCount: integer("message_count").notNull().default(0),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(sessions).omit({ createdAt: true });
export const insertWebauthnCredentialSchema = createInsertSchema(webauthnCredentials).omit({ createdAt: true });
export const insertApprovedUserSchema = createInsertSchema(approvedUsers).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type InsertWebauthnCredential = z.infer<typeof insertWebauthnCredentialSchema>;

export type ApprovedUser = typeof approvedUsers.$inferSelect;
export type InsertApprovedUser = z.infer<typeof insertApprovedUserSchema>;
