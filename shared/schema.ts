import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Export chat models
export * from "./models/chat";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  plainPassword: text("plain_password"),
  displayName: text("display_name"),
  role: text("role").notNull().default("guest"), // owner, approved, external, guest
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Sessions for authenticated users
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // UUID token
  userId: integer("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  twoFactorVerified: boolean("two_factor_verified").default(false),
});

// WebAuthn credentials for FaceID/TouchID
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: text("id").primaryKey(), // credential ID from WebAuthn
  userId: integer("user_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type"), // platform, cross-platform
  transports: text("transports").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Approved users list - managed by owner (Maurice)
export const approvedUsers = pgTable("approved_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  approvedBy: integer("approved_by").notNull(), // owner user id
  accessLevel: text("access_level").notNull().default("basic"), // basic, full
  note: text("note"), // why this user was approved
  createdAt: timestamp("created_at").defaultNow(),
});

// Audit logs for security tracking
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Anonymous guest sessions for Alfred (external visitors)
export const guestSessions = pgTable("guest_sessions", {
  id: text("id").primaryKey(), // UUID token stored in browser
  displayName: text("display_name"), // Optional name provided by guest
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  messageCount: integer("message_count").notNull().default(0),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Owner of this project - data isolation
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active, completed, archived
  createdAt: timestamp("created_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Owner of this task - data isolation
  projectId: integer("project_id"), // Optional - task can exist without a project
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo, in_progress, done
  priority: text("priority").default("medium"), // low, medium, high
  dueDate: timestamp("due_date"),
  recurrenceType: text("recurrence_type"), // daily, weekly, monthly, yearly
  recurrenceInterval: integer("recurrence_interval").default(1), // every N days/weeks/etc
  parentTaskId: integer("parent_task_id"), // if this is a generated recurrence, points to original
  source: text("source").default("manual"), // manual, kanban_ai, homework, calendar
  context: text("context"), // sugu, suguval, foot, perso, dev - categorizes task domain
  createdAt: timestamp("created_at").defaultNow(),
});

export const subtasks = pgTable("subtasks", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(), // Parent task
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const taskLabels = pgTable("task_labels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Owner - data isolation
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"), // hex color
  createdAt: timestamp("created_at").defaultNow(),
});

export const taskLabelAssignments = pgTable("task_label_assignments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  labelId: integer("label_id").notNull(),
});

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Owner of this note - data isolation
  projectId: integer("project_id"), // Optional: note might not be linked to a project
  title: text("title").notNull(),
  content: text("content").notNull(), // Markdown
  createdAt: timestamp("created_at").defaultNow(),
});

// Ulysse AI Assistant State - tracks level, capabilities, and unlocked features per user
export const ulysseState = pgTable("ulysse_state", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Each user has their own Ulysse relationship
  level: integer("level").notNull().default(1),
  experience: integer("experience").notNull().default(0),
  unlockedFeatures: text("unlocked_features").array().notNull().default([]),
  capabilities: jsonb("capabilities").default({}),
  personality: text("personality").default("helpful"),
  lastInteraction: timestamp("last_interaction").defaultNow(),
  totalConversations: integer("total_conversations").notNull().default(0),
  totalTasksCompleted: integer("total_tasks_completed").notNull().default(0),
});

// Ulysse Memory - stores learned information about each user separately
export const ulysseMemory = pgTable("ulysse_memory", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Memory is isolated per user
  category: text("category").notNull(), // personality, preference, skill, interest, habit, fact
  key: text("key").notNull(), // e.g., "communication_style", "favorite_tech", "work_hours"
  value: text("value").notNull(), // the actual learned information
  confidence: integer("confidence").notNull().default(50), // 0-100, increases with repeated observations
  source: text("source"), // conversation excerpt that taught this
  verified: boolean("verified").default(false), // true if data was verified via double-scrape
  metadata: jsonb("metadata").$type<Record<string, any> | null>(), // optional structured data payload
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Project Context - detailed memory about specific projects per user
export const projectMemory = pgTable("project_memory", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Memory is isolated per user
  projectId: integer("project_id"), // optional link to projects table
  projectName: text("project_name").notNull(),
  summary: text("summary"), // current understanding of the project
  techStack: text("tech_stack").array().default([]),
  goals: text("goals").array().default([]),
  decisions: jsonb("decisions").default([]), // array of {decision, reason, date}
  challenges: text("challenges").array().default([]),
  nextSteps: text("next_steps").array().default([]),
  status: text("status").default("active"), // active, paused, completed
  lastDiscussed: timestamp("last_discussed").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Web Search Memory - stores Ulysse's research and learned data from web searches per user
export const webSearchMemory = pgTable("web_search_memory", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Search history is isolated per user
  query: text("query").notNull(), // what was searched
  topic: text("topic"), // extracted topic/category
  keyFindings: text("key_findings").array().default([]), // important facts learned
  sources: jsonb("sources").default([]), // array of {title, url, snippet}
  userContext: text("user_context"), // why the user asked this
  learnedInsights: text("learned_insights"), // what Ulysse learned from this search
  usefulnessScore: integer("usefulness_score").default(50), // 0-100, how useful was this search
  timesReferenced: integer("times_referenced").default(0), // how often this knowledge was reused
  createdAt: timestamp("created_at").defaultNow(),
  // MARS v2 fields for accuracy-focused research
  reliabilityScore: integer("reliability_score").default(0), // 0-100 MARS reliability score
  tags: text("tags").array().default([]), // semantic tags for categorization
  category: text("category"), // fact type: statistic, date, event, claim
  domain: text("domain"), // query domain: factual, temporal, scientific, news
  confidenceScore: integer("confidence_score").default(0), // 0-100 confidence level
  expiresAt: timestamp("expires_at"), // for temporal data, when it becomes stale
  policyReport: jsonb("policy_report").default({}), // MARS policy decision details
});

// MARS Search History - complete search results with 31-day TTL
// Accessible by Ulysse/Iris for context and learning
export const marsSearchHistory = pgTable("mars_search_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  query: text("query").notNull(),
  queryType: text("query_type").notNull(), // factual, temporal, scientific, news
  success: boolean("success").notNull().default(true),
  totalTime: integer("total_time"), // ms
  // Results summary
  sourceCount: integer("source_count").default(0),
  verifiedFactCount: integer("verified_fact_count").default(0),
  confidenceLevel: text("confidence_level"), // high, medium, low, insufficient
  // Key data
  directAnswers: jsonb("direct_answers").default([]), // array of {engine, answer, citations}
  verifiedFacts: jsonb("verified_facts").default([]), // array of {content, sources, consensus}
  topSources: jsonb("top_sources").default([]), // array of {url, title, reliabilityScore}
  crawledContent: text("crawled_content"), // compressed summary of crawled pages
  // Policy decision
  canRespond: boolean("can_respond").default(true),
  disclaimers: text("disclaimers").array().default([]),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(), // 31 days from creation
});

// Ulysse Self-Diagnostics - logs issues Ulysse detects and how they were resolved
// When Iris (approved users) reports issues, they sync to owner's view for Ulysse to analyze
export const ulysseDiagnostics = pgTable("ulysse_diagnostics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // who reported this (isolates per user)
  reportedBy: text("reported_by").notNull().default("ulysse"), // "ulysse" or "iris" 
  syncedToOwner: boolean("synced_to_owner").notNull().default(false), // true if from Iris and synced
  type: text("type").notNull(), // error, warning, performance, suggestion
  component: text("component").notNull(), // voice, chat, memory, search, ui
  description: text("description").notNull(),
  severity: text("severity").notNull().default("medium"), // low, medium, high, critical
  status: text("status").notNull().default("detected"), // detected, investigating, resolved, ignored
  rootCause: text("root_cause"),
  solution: text("solution"),
  proposedUpgrade: text("proposed_upgrade"), // Ulysse's proposed fix for synced Iris issues
  userImpact: text("user_impact"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Ulysse Self-Improvement - tracks improvements Ulysse suggests or implements
export const ulysseImprovements = pgTable("ulysse_improvements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // who this improvement benefits (owner sees all)
  originatedFrom: text("originated_from").notNull().default("ulysse"), // "ulysse" or "iris"
  category: text("category").notNull(), // feature, optimization, fix, learning
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"), // low, medium, high
  status: text("status").notNull().default("proposed"), // proposed, approved, implemented, rejected
  userFeedback: text("user_feedback"),
  implementedAt: timestamp("implemented_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const projectsRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
  notes: many(notes),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  project: one(projects, {
    fields: [notes.projectId],
    references: [projects.id],
  }),
}));

// Ulysse Generated Files - files created by Ulysse for download
export const ulysseFiles = pgTable("ulysse_files", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path").notNull(),
  description: text("description"),
  generatedBy: text("generated_by").notNull().default("ulysse"),
  category: text("category").notNull().default("generated"),
  parentFileId: integer("parent_file_id"),
  version: integer("version").notNull().default(1),
  versionLabel: text("version_label"),
  editPrompt: text("edit_prompt"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Ulysse Code Snapshots - OWNER ONLY - encrypted code copies for self-analysis
// Maximum security: Only accessible by owner (Maurice), used for Ulysse self-improvement
export const ulysseCodeSnapshots = pgTable("ulysse_code_snapshots", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull(), // Must be owner user ID
  version: text("version").notNull(), // Version identifier
  summary: text("summary"), // Brief description of what's included
  filesCount: integer("files_count").notNull().default(0),
  totalSize: integer("total_size").notNull().default(0), // bytes
  codeContent: text("code_content").notNull(), // Compressed/encoded code content
  structureMap: jsonb("structure_map").default({}), // File tree structure
  keyComponents: text("key_components").array().default([]), // Important files/components
  analysisNotes: text("analysis_notes"), // Ulysse's analysis of changes
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  ipAddress: text("ip_address"), // Audit trail
  userAgent: text("user_agent"), // Audit trail
  createdAt: timestamp("created_at").defaultNow(),
});

// Voice Settings - TTS and STT preferences per user
export const voiceSettings = pgTable("voice_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(), // One settings per user
  // TTS preferences
  ttsVoice: text("tts_voice").notNull().default("onyx"), // alloy, echo, fable, onyx, nova, shimmer
  ttsSpeed: integer("tts_speed").notNull().default(100), // percentage 50-200 (100 = normal)
  ttsPitch: text("tts_pitch").notNull().default("normal"), // low, normal, high (for browser fallback)
  ttsAutoSpeak: boolean("tts_auto_speak").notNull().default(true), // auto-speak responses
  ttsMaxLength: integer("tts_max_length").default(500), // max chars before chunking (iOS optimization)
  // STT preferences
  sttMode: text("stt_mode").notNull().default("auto"), // auto, push-to-talk, continuous
  sttLanguage: text("stt_language").notNull().default("fr-FR"),
  sttWakeWordEnabled: boolean("stt_wake_word_enabled").notNull().default(true),
  // General
  preferBrowserFallback: boolean("prefer_browser_fallback").notNull().default(false),
  voiceFeedbackEnabled: boolean("voice_feedback_enabled").notNull().default(true), // audio feedback sounds
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Ulysse Homework - background tasks for Ulysse to prepare (owner only)
export const ulysseHomework = pgTable("ulysse_homework", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Owner's user ID
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"), // low, medium, high
  recurrence: text("recurrence").notNull().default("none"), // none, daily, weekly, monthly, yearly
  status: text("status").notNull().default("pending"), // pending, in_progress, completed, cancelled
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  nextOccurrence: timestamp("next_occurrence"), // For recurring tasks
  lastExecutedAt: timestamp("last_executed_at"), // Last time Ulysse worked on this
  notes: text("notes"), // Ulysse's notes on progress
  createdAt: timestamp("created_at").defaultNow(),
});

// Homework Execution History - tracks each time Ulysse executes a homework task
export const homeworkExecution = pgTable("homework_execution", {
  id: serial("id").primaryKey(),
  homeworkId: integer("homework_id").notNull(),
  userId: integer("user_id").notNull(),
  triggeredBy: text("triggered_by").notNull().default("auto"), // auto, manual, daily
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  resultSummary: text("result_summary"), // What Ulysse found/did
  artifacts: jsonb("artifacts").default({}), // Web search results, generated files, etc.
  error: text("error"), // Error message if failed
});

// Task Queue - Ulysse's sequential work pipeline
export const taskQueues = pgTable("task_queues", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull().default("chat"), // chat, autonomous, homework
  status: text("status").notNull().default("pending"), // pending, running, paused, completed, failed
  totalItems: integer("total_items").notNull().default(0),
  completedItems: integer("completed_items").notNull().default(0),
  currentItemId: integer("current_item_id"),
  threadId: integer("thread_id"), // conversation thread that triggered this
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const taskQueueItems = pgTable("task_queue_items", {
  id: serial("id").primaryKey(),
  queueId: integer("queue_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  toolName: text("tool_name"), // which tool to use (devops_github, web_search, etc.)
  toolArgs: jsonb("tool_args"), // arguments for the tool
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, skipped
  result: text("result"), // execution result summary
  error: text("error"),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// DEV God Mode (DGM) — Ulysse full autonomy mode for DevOps
export const dgmSessions = pgTable("dgm_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  active: boolean("active").notNull().default(false),
  objective: text("objective"),
  repoContext: text("repo_context"),
  currentTaskId: integer("current_task_id"),
  totalTasks: integer("total_tasks").notNull().default(0),
  completedTasks: integer("completed_tasks").notNull().default(0),
  activatedAt: timestamp("activated_at"),
  deactivatedAt: timestamp("deactivated_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dgmTasks = pgTable("dgm_tasks", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  testCriteria: text("test_criteria"),
  testResult: text("test_result"),
  codeChanges: jsonb("code_changes"),
  error: text("error"),
  impactedFiles: text("impacted_files").array(),
  riskScore: integer("risk_score"),
  riskLevel: text("risk_level"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  pipelineStage: text("pipeline_stage").notNull().default("pending"),
  reviewResult: jsonb("review_result"),
  deployResult: jsonb("deploy_result"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  testedAt: timestamp("tested_at"),
});

export const dgmPipelineRuns = pgTable("dgm_pipeline_runs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  taskId: integer("task_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull().default("running"),
  input: jsonb("input"),
  output: jsonb("output"),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Ambiance Profiles - visual and sound presets per user
export const ambianceProfiles = pgTable("ambiance_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isPreset: boolean("is_preset").notNull().default(false), // system presets vs user-created
  isActive: boolean("is_active").notNull().default(false),
  visualMode: text("visual_mode").notNull().default("orb"), // orb, equalizer
  orbColor: text("orb_color").default("#6366f1"), // hex color for the orb
  orbIntensity: integer("orb_intensity").default(50), // 0-100
  backgroundGradient: text("background_gradient"), // CSS gradient string
  autoSpeak: boolean("auto_speak").notNull().default(true),
  voiceSpeed: integer("voice_speed").default(100), // percentage 50-150
  voicePitch: integer("voice_pitch").default(100), // percentage 50-150
  ambientSound: text("ambient_sound"), // none, rain, forest, ocean, space
  ambientVolume: integer("ambient_volume").default(30), // 0-100
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// ULYSSE SERVER V2 - Centralized Architecture
// ============================================

// Devices - registered devices for multi-device access
export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceName: text("device_name").notNull(), // "iPhone de Maurice", "MacBook Pro"
  deviceType: text("device_type").notNull().default("unknown"), // iphone, android, desktop, tablet, web
  deviceIdentifier: text("device_identifier").notNull().unique(), // Unique device fingerprint
  lastSeen: timestamp("last_seen").defaultNow(),
  lastIp: text("last_ip"),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").notNull().default(true),
  pushToken: text("push_token"), // For push notifications (future)
  createdAt: timestamp("created_at").defaultNow(),
});

// API Tokens - JWT refresh tokens for multi-device auth
export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: integer("device_id").notNull(),
  tokenHash: text("token_hash").notNull(), // Hashed refresh token
  expiresAt: timestamp("expires_at").notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Conversation Threads - unified conversation history across devices
export const conversationThreads = pgTable("conversation_threads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title"), // Auto-generated or user-set
  summary: text("summary"), // AI-generated summary
  originDevice: text("origin_device"), // Device where conversation started
  lastDevice: text("last_device"), // Last device used
  messageCount: integer("message_count").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  tags: text("tags").array().default([]),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Conversation Messages - individual messages in threads
export const conversationMessages = pgTable("conversation_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(), // user, assistant, system
  content: text("content").notNull(),
  modality: text("modality").notNull().default("text"), // text, voice, image, file
  attachments: jsonb("attachments").default([]), // [{type, url, name, analysis}]
  metadata: jsonb("metadata").default({}), // {tokens, model, latency, deviceId}
  isEdited: boolean("is_edited").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Daily Summaries - cached briefs
export const dailySummaries = pgTable("daily_summaries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD format
  summary: text("summary").notNull(),
  highlights: jsonb("highlights").default([]), // [{type, title, description}]
  tasksCompleted: integer("tasks_completed").default(0),
  conversationsCount: integer("conversations_count").default(0),
  emailsSummary: text("emails_summary"),
  weatherInfo: jsonb("weather_info").default({}),
  generatedAt: timestamp("generated_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // Cache expiration
});

// Email Messages Cache - cached Gmail messages
export const emailMessages = pgTable("email_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  gmailId: text("gmail_id").notNull().unique(),
  threadId: text("thread_id"),
  from: text("from").notNull(),
  to: text("to"),
  subject: text("subject"),
  snippet: text("snippet"),
  body: text("body"), // Cached full body
  labels: text("labels").array().default([]),
  isRead: boolean("is_read").notNull().default(false),
  isStarred: boolean("is_starred").notNull().default(false),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  receivedAt: timestamp("received_at"),
  cachedAt: timestamp("cached_at").defaultNow(),
});

// AgentMail Messages - Ulysse's dedicated email inbox
// AgentMail Send History - tracks all outbound emails with status
export const agentmailSendHistory = pgTable("agentmail_send_history", {
  id: serial("id").primaryKey(),
  trackingId: text("tracking_id").notNull().unique(), // EMAIL-{timestamp}-{random}
  userId: integer("user_id").notNull(),
  persona: text("persona").notNull().default("ulysse"), // ulysse, iris
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  bodyLength: integer("body_length").notNull().default(0),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  attachmentCount: integer("attachment_count").default(0),
  status: text("status").notNull().default("pending"), // pending, sent, failed, retrying
  attempts: integer("attempts").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  messageId: text("message_id"), // AgentMail message ID if successful
  errorMessage: text("error_message"), // Error details if failed
  deliveryStatus: text("delivery_status"), // sent, pending, failed
  sentAt: timestamp("sent_at"), // When successfully sent
  createdAt: timestamp("created_at").defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at").defaultNow(),
});

export const agentmailMessages = pgTable("agentmail_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  messageId: text("message_id").notNull().unique(), // AgentMail message ID
  threadId: text("thread_id"), // AgentMail thread ID
  inboxId: text("inbox_id").notNull(), // e.g., "ulysse@agentmail.to"
  from: text("from").notNull(),
  to: text("to").array().default([]),
  cc: text("cc").array().default([]),
  subject: text("subject"),
  body: text("body"), // Full email body (text)
  htmlBody: text("html_body"), // HTML version if available
  snippet: text("snippet"), // Short preview
  isRead: boolean("is_read").notNull().default(false),
  isProcessed: boolean("is_processed").notNull().default(false), // Has Ulysse analyzed this?
  category: text("category"), // work, personal, notification, spam, etc.
  priority: text("priority").default("normal"), // urgent, high, normal, low
  sentiment: text("sentiment"), // positive, neutral, negative
  summary: text("summary"), // AI-generated summary
  suggestedAction: text("suggested_action"), // reply, archive, forward, etc.
  attachments: jsonb("attachments").default([]), // [{id, filename, mimeType, size, url}]
  metadata: jsonb("metadata").default({}), // Additional AgentMail metadata
  receivedAt: timestamp("received_at"),
  cachedAt: timestamp("cached_at").defaultNow(),
});

// AgentMail Attachments - stores attachment data
export const agentmailAttachments = pgTable("agentmail_attachments", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull(), // Reference to agentmail_messages.messageId
  attachmentId: text("attachment_id").notNull(), // AgentMail attachment ID
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull().default(0), // Size in bytes
  localPath: text("local_path"), // Path if downloaded locally
  url: text("url"), // URL to download
  createdAt: timestamp("created_at").defaultNow(),
});

// Gmail OAuth Tokens - custom OAuth for full Gmail access
export const gmailTokens = pgTable("gmail_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenType: text("token_type").notNull().default("Bearer"),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Preferences - centralized user settings (JSON flexible)
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  preferences: jsonb("preferences").notNull().default({}), // Flexible key-value store
  // Common preferences stored in jsonb:
  // - language: "fr", "en"
  // - timezone: "Europe/Paris"
  // - briefTime: "08:00"
  // - notifications: {email: true, push: false}
  // - uiTheme: "dark", "light", "system"
  // - voiceEnabled: true
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Known Persons - for face recognition
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

// Face Descriptors - for facial recognition
export const faceDescriptors = pgTable("face_descriptors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  personId: integer("person_id"),
  descriptor: jsonb("descriptor").notNull(), // Float32Array serialized as number[]
  sourceMediaId: integer("source_media_id"),
  quality: real("quality").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Media Faces - faces detected in media items
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

export const insertKnownPersonSchema = createInsertSchema(knownPersons).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFaceDescriptorSchema = createInsertSchema(faceDescriptors).omit({ id: true, createdAt: true });
export const insertMediaFaceSchema = createInsertSchema(mediaFaces).omit({ id: true, createdAt: true });

// Relations for v2 tables
export const devicesRelations = relations(devices, ({ one }) => ({
  user: one(users, {
    fields: [devices.userId],
    references: [users.id],
  }),
}));

export const conversationThreadsRelations = relations(conversationThreads, ({ one, many }) => ({
  user: one(users, {
    fields: [conversationThreads.userId],
    references: [users.id],
  }),
  messages: many(conversationMessages),
}));

export const conversationMessagesRelations = relations(conversationMessages, ({ one }) => ({
  thread: one(conversationThreads, {
    fields: [conversationMessages.threadId],
    references: [conversationThreads.id],
  }),
}));

// Ulysse Charter - Persistent behavior rules and preferences for the AI
export const ulysseCharter = pgTable("ulysse_charter", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  // Communication style
  communicationStyle: text("communication_style").default("direct"), // direct, formal, casual, detailed
  language: text("language").default("fr"), // fr, en
  responseLength: text("response_length").default("concise"), // concise, balanced, detailed
  // Priority domains
  priorityDomains: text("priority_domains").array().default([]), // ["business", "email", "projects", "sports"]
  // Important projects to track
  activeProjects: jsonb("active_projects").default([]), // [{name, description, priority}]
  // Behavior rules
  behaviorRules: jsonb("behavior_rules").default([]), // [{rule, enabled}]
  // Wake word and voice preferences
  wakeWord: text("wake_word").default("Ulysse"),
  voicePersonality: text("voice_personality").default("professional"), // professional, friendly, assistant
  // Context retention
  rememberConversations: boolean("remember_conversations").notNull().default(true),
  contextRetentionDays: integer("context_retention_days").default(30),
  // Proactivity settings
  proactiveInsights: boolean("proactive_insights").notNull().default(true),
  dailyBriefEnabled: boolean("daily_brief_enabled").notNull().default(true),
  dailyBriefTime: text("daily_brief_time").default("08:00"),
  // Custom instructions
  customInstructions: text("custom_instructions"), // Freeform text for specific behaviors
  // Timestamps
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Media Library - photos and videos captured by Ulysse
export const mediaLibrary = pgTable("media_library", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // "photo" | "video"
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  duration: integer("duration"), // video duration in seconds
  width: integer("width"),
  height: integer("height"),
  description: text("description"),
  tags: text("tags").array().default([]),
  isFavorite: boolean("is_favorite").notNull().default(false),
  capturedAt: timestamp("captured_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ═══════════════════════════════════════════════════════════════
// ULYSSE ENHANCED SELF-AWARENESS SYSTEM
// ═══════════════════════════════════════════════════════════════

// Capability Registry - tracks all Ulysse capabilities with runtime status
export const capabilityRegistry = pgTable("capability_registry", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  marker: text("marker"),
  isAvailable: boolean("is_available").notNull().default(true),
  lastVerified: timestamp("last_verified").defaultNow(),
  failureReason: text("failure_reason"),
  version: text("version").notNull().default("1.0.0"),
  dependencies: text("dependencies").array().default([]),
  usageCount: integer("usage_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  lastUsed: timestamp("last_used"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Action Logs - tracks every action Ulysse performs with verification results
export const actionLogs = pgTable("action_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  persona: text("persona").notNull().default("ulysse"),
  actionType: text("action_type").notNull(),
  actionCategory: text("action_category").notNull(),
  inputPayload: jsonb("input_payload"),
  outputPayload: jsonb("output_payload"),
  status: text("status").notNull().default("pending"),
  effectivenessScore: integer("effectiveness_score"),
  coherenceScore: integer("coherence_score"),
  precisionScore: integer("precision_score"),
  overallScore: integer("overall_score"),
  validationNotes: text("validation_notes"),
  errorMessage: text("error_message"),
  executionTimeMs: integer("execution_time_ms"),
  wasRolledBack: boolean("was_rolled_back").notNull().default(false),
  relatedActionId: integer("related_action_id"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Diagnostic Runs - stores results of system health checks
export const diagnosticRuns = pgTable("diagnostic_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  runType: text("run_type").notNull(),
  triggeredBy: text("triggered_by").notNull(),
  status: text("status").notNull().default("running"),
  systemHealth: jsonb("system_health"),
  interfaceHealth: jsonb("interface_health"),
  communicationHealth: jsonb("communication_health"),
  overallScore: integer("overall_score"),
  findingsCount: integer("findings_count").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  infoCount: integer("info_count").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Diagnostic Findings - individual issues found during diagnostics
export const diagnosticFindings = pgTable("diagnostic_findings", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  domain: text("domain").notNull(),
  component: text("component").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  recommendation: text("recommendation"),
  selfHealingAction: text("self_healing_action"),
  canAutoFix: boolean("can_auto_fix").notNull().default(false),
  wasAutoFixed: boolean("was_auto_fixed").notNull().default(false),
  fixResult: text("fix_result"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// Capability Changelog - tracks updates to capabilities
export const capabilityChangelog = pgTable("capability_changelog", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id"),
  changeType: text("change_type").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  reason: text("reason"),
  version: text("version").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== GEOLOCATION SYSTEM ====================

// Location Sessions - tracks geolocation sessions per device with consent
export const locationSessions = pgTable("location_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name"),
  isActive: boolean("is_active").notNull().default(true),
  consentGranted: boolean("consent_granted").notNull().default(false),
  consentTimestamp: timestamp("consent_timestamp"),
  accuracyMode: text("accuracy_mode").notNull().default("balanced"), // high, balanced, low
  updateIntervalMs: integer("update_interval_ms").notNull().default(600000), // 10 min default
  backgroundEnabled: boolean("background_enabled").notNull().default(false),
  lastLocationAt: timestamp("last_location_at"),
  createdAt: timestamp("created_at").defaultNow(),
  endedAt: timestamp("ended_at"),
});

// Location Points - stores individual location readings
export const locationPoints = pgTable("location_points", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sessionId: integer("session_id"),
  latitude: text("latitude").notNull(), // stored as text for precision
  longitude: text("longitude").notNull(),
  altitude: text("altitude"),
  accuracy: integer("accuracy"), // meters
  altitudeAccuracy: integer("altitude_accuracy"),
  heading: integer("heading"), // degrees from north
  speed: integer("speed"), // m/s
  context: text("context"), // navigation, background, manual
  address: text("address"), // reverse geocoded address (cached)
  city: text("city"),
  country: text("country"),
  metadata: jsonb("metadata"),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Location Preferences - per-feature opt-in settings
export const locationPreferences = pgTable("location_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  feature: text("feature").notNull(), // weather, calendar_travel, reminders, recommendations
  enabled: boolean("enabled").notNull().default(false),
  accuracy: text("accuracy").notNull().default("balanced"), // high, balanced, low
  retentionDays: integer("retention_days").notNull().default(30),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Geofences - geographical zones for triggers
export const geofences = pgTable("geofences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(100),
  type: text("type").notNull().default("circle"), // circle, polygon (polygon coords in metadata)
  triggerOn: text("trigger_on").notNull().default("both"), // enter, exit, both
  isActive: boolean("is_active").notNull().default(true),
  linkedAction: text("linked_action"), // reminder, homework, notification
  linkedActionId: integer("linked_action_id"), // ID of linked reminder/homework
  actionPayload: jsonb("action_payload"), // action parameters
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60), // prevent repeated triggers
  lastTriggeredAt: timestamp("last_triggered_at"),
  metadata: jsonb("metadata"), // polygon coords, custom data
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Geofence Events - logs of enter/exit events
export const geofenceEvents = pgTable("geofence_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  geofenceId: integer("geofence_id").notNull(),
  eventType: text("event_type").notNull(), // enter, exit, dwell
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  accuracy: integer("accuracy"),
  actionExecuted: boolean("action_executed").notNull().default(false),
  actionResult: text("action_result"),
  dwellTimeMinutes: integer("dwell_time_minutes"),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================
// ITINERARY SYSTEM - Routes and Navigation
// ============================================

// Saved Routes - user's saved itineraries
export const savedRoutes = pgTable("saved_routes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  profile: text("profile").notNull().default("driving"), // driving, cycling, walking
  totalDistance: integer("total_distance"), // meters
  totalDuration: integer("total_duration"), // seconds
  isFavorite: boolean("is_favorite").notNull().default(false),
  isTemplate: boolean("is_template").notNull().default(false), // Reusable route template
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").notNull().default(0),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Route Waypoints - ordered stops in a route
export const routeWaypoints = pgTable("route_waypoints", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull(),
  userId: integer("user_id").notNull(),
  orderIndex: integer("order_index").notNull(), // 0 = start, increments
  label: text("label").notNull(), // A, B, C, D...
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  address: text("address"), // Human-readable address
  name: text("name"), // Custom name for the stop
  estimatedArrival: timestamp("estimated_arrival"), // ETA at this waypoint
  estimatedDuration: integer("estimated_duration"), // Seconds from previous waypoint
  estimatedDistance: integer("estimated_distance"), // Meters from previous waypoint
  isCurrentLocation: boolean("is_current_location").notNull().default(false),
  notes: text("notes"), // User notes for this stop
  createdAt: timestamp("created_at").defaultNow(),
});

// Route History - completed journeys
export const routeHistory = pgTable("route_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  savedRouteId: integer("saved_route_id"), // Optional link to saved route
  name: text("name"),
  profile: text("profile").notNull().default("driving"),
  startAddress: text("start_address"),
  endAddress: text("end_address"),
  waypointsData: jsonb("waypoints_data").default([]), // Snapshot of waypoints
  plannedDistance: integer("planned_distance"),
  plannedDuration: integer("planned_duration"),
  actualDistance: integer("actual_distance"),
  actualDuration: integer("actual_duration"),
  deviationCount: integer("deviation_count").notNull().default(0), // Times user went off-route
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("completed"), // completed, cancelled, in_progress
  createdAt: timestamp("created_at").defaultNow(),
});

// Route Preferences - user navigation settings
export const routePreferences = pgTable("route_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  defaultProfile: text("default_profile").notNull().default("driving"),
  avoidTolls: boolean("avoid_tolls").notNull().default(false),
  avoidHighways: boolean("avoid_highways").notNull().default(false),
  avoidFerries: boolean("avoid_ferries").notNull().default(false),
  optimizeOrder: boolean("optimize_order").notNull().default(true), // Auto-optimize waypoint order
  showAlternatives: boolean("show_alternatives").notNull().default(false),
  voiceGuidance: boolean("voice_guidance").notNull().default(true),
  autoRecalculate: boolean("auto_recalculate").notNull().default(true), // Recalc on deviation
  deviationThreshold: integer("deviation_threshold").notNull().default(50), // Meters before recalc
  arrivalAlertDistance: integer("arrival_alert_distance").notNull().default(200), // Meters before arrival alert
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Active Navigation - current navigation state
export const activeNavigation = pgTable("active_navigation", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(), // One active nav per user
  routeId: integer("route_id"), // Link to saved route if any
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

// ============================================
// DOMOTIQUE - HOME AUTOMATION & SURVEILLANCE
// ============================================

// Surveillance Cameras - IP/RTSP/ONVIF/Dahua camera management
export const surveillanceCameras = pgTable("surveillance_cameras", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(), // "Entrée", "Salon", "Jardin"
  location: text("location"), // Description du lieu
  cameraType: text("camera_type").notNull().default("ip"), // ip, rtsp, onvif, homekit, dahua_p2p
  streamUrl: text("stream_url"), // RTSP/HTTP URL for stream
  snapshotUrl: text("snapshot_url"), // URL for still image
  username: text("username"), // Auth if required
  passwordEncrypted: text("password_encrypted"), // Encrypted camera password
  ipAddress: text("ip_address"),
  port: integer("port").default(554), // RTSP default port
  protocol: text("protocol").notNull().default("rtsp"), // rtsp, http, https, p2p
  // Dahua P2P / DMSS specific
  serialNumber: text("serial_number"), // Device SN for P2P connection (E3368)
  channelNumber: integer("channel_number").default(1), // 1-8 for multi-channel NVR
  nvrIpAddress: text("nvr_ip_address"), // NVR IP for direct access
  resolution: text("resolution").default("1080p"), // 720p, 1080p, 4k
  fps: integer("fps").default(15),
  hasMotionDetection: boolean("has_motion_detection").notNull().default(false),
  motionSensitivity: integer("motion_sensitivity").default(50), // 0-100
  hasFaceRecognition: boolean("has_face_recognition").notNull().default(false),
  isOnline: boolean("is_online").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at"),
  lastSnapshotAt: timestamp("last_snapshot_at"),
  lastSnapshotUrl: text("last_snapshot_url"), // Stored snapshot in object storage
  notifyOnMotion: boolean("notify_on_motion").notNull().default(true),
  notifyOnPerson: boolean("notify_on_person").notNull().default(true),
  recordingEnabled: boolean("recording_enabled").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Camera Events - motion detection, face recognition events
export const cameraEvents = pgTable("camera_events", {
  id: serial("id").primaryKey(),
  cameraId: integer("camera_id").notNull(),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(), // motion, person_detected, face_recognized, offline, online
  personId: integer("person_id"), // Link to knownPersons if face recognized
  personName: text("person_name"), // Name if recognized
  confidence: integer("confidence"), // 0-100 for face recognition
  snapshotUrl: text("snapshot_url"), // Stored snapshot of the event
  metadata: jsonb("metadata").default({}), // Additional event data
  isAcknowledged: boolean("is_acknowledged").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// PHASE 1: SMART HOME (HomeKit/Hue) - Appareils connectés et scènes
// ============================================================================

// Smart Devices - lumières, prises, thermostats, volets, etc.
export const smartDevices = pgTable("smart_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Owner-only access
  name: text("name").notNull(), // "Lampe salon", "Thermostat cuisine"
  type: text("type").notNull(), // light, switch, thermostat, blind, plug, sensor, lock
  room: text("room"), // "Salon", "Cuisine", "Chambre"
  vendor: text("vendor"), // philips_hue, homekit, netatmo, tuya, custom
  externalId: text("external_id"), // ID from vendor API
  capabilities: jsonb("capabilities").default([]), // ["toggle", "brightness", "color", "temperature"]
  state: jsonb("state").default({}), // {on: true, brightness: 80, color: "#FF5500", temperature: 21}
  ipAddress: text("ip_address"), // Local IP if applicable
  macAddress: text("mac_address"),
  accessToken: text("access_token"), // Encrypted token for API access
  isOnline: boolean("is_online").notNull().default(false),
  lastStateAt: timestamp("last_state_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Smart Scenes - combinaisons d'actions prédéfinies
export const smartScenes = pgTable("smart_scenes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(), // "Mode cinéma", "Bonne nuit", "Départ maison"
  description: text("description"),
  icon: text("icon").default("home"), // Lucide icon name
  color: text("color").default("#3B82F6"), // Scene color for UI
  actions: jsonb("actions").notNull().default([]), // [{deviceId, action, params}]
  trigger: text("trigger"), // manual, schedule, geofence, siri
  triggerConfig: jsonb("trigger_config").default({}), // {time: "22:00", geofenceId: 5, siriPhrase: "bonne nuit"}
  isActive: boolean("is_active").notNull().default(true),
  lastActivatedAt: timestamp("last_activated_at"),
  activationCount: integer("activation_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// PHASE 2: SIRI SHORTCUTS WEBHOOK - Déclenchement externe sécurisé
// ============================================================================

// Siri Webhooks - endpoints sécurisés pour Siri Shortcuts
export const siriWebhooks = pgTable("siri_webhooks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(), // "Allume salon", "Active mode cinéma"
  phrase: text("phrase").notNull(), // Siri trigger phrase
  action: text("action").notNull(), // scene, device, capability
  actionTarget: text("action_target"), // sceneId, deviceId, or capability name
  actionParams: jsonb("action_params").default({}), // {brightness: 80}
  webhookToken: text("webhook_token").notNull(), // Unique secure token (HMAC)
  webhookSecret: text("webhook_secret").notNull(), // Secret for signature verification
  isActive: boolean("is_active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// PHASE 3: PROACTIVE PREDICTION ML - Apprentissage comportemental
// ============================================================================

// User Behavior Events - log des actions utilisateur pour apprentissage
export const userBehaviorEvents = pgTable("user_behavior_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(), // device_action, scene_activation, location_change, time_routine
  eventSource: text("event_source").notNull(), // manual, voice, siri, schedule, auto
  targetType: text("target_type"), // device, scene, capability
  targetId: integer("target_id"),
  targetName: text("target_name"),
  context: jsonb("context").default({}), // {dayOfWeek: 5, hour: 22, location: "home", weather: "cloudy"}
  previousState: jsonb("previous_state").default({}),
  newState: jsonb("new_state").default({}),
  occurredAt: timestamp("occurred_at").defaultNow(),
});

// Proactive Suggestions - suggestions générées par l'IA
export const proactiveSuggestions = pgTable("proactive_suggestions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  suggestionType: text("suggestion_type").notNull(), // routine, optimization, reminder, automation
  title: text("title").notNull(),
  description: text("description"),
  action: text("action").notNull(), // scene, device, message, reminder
  actionTarget: text("action_target"),
  actionParams: jsonb("action_params").default({}),
  confidence: integer("confidence").notNull().default(50), // 0-100, based on pattern strength
  basedOnPatterns: jsonb("based_on_patterns").default([]), // [{pattern, occurrences, lastSeen}]
  triggerConditions: jsonb("trigger_conditions").default({}), // {time: "22:00", dayOfWeek: [1,2,3,4,5]}
  status: text("status").notNull().default("pending"), // pending, shown, accepted, rejected, automated
  userFeedback: text("user_feedback"), // "helpful", "not_useful", "too_early"
  shownAt: timestamp("shown_at"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Learned Patterns - patterns détectés et confirmés
export const learnedPatterns = pgTable("learned_patterns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  patternType: text("pattern_type").notNull(), // time_routine, location_routine, sequence, preference
  name: text("name").notNull(), // "Lumières salon 22h", "Mode travail matin"
  description: text("description"),
  conditions: jsonb("conditions").notNull().default({}), // {time: "22:00", dayOfWeek: [1-5], location: "home"}
  actions: jsonb("actions").notNull().default([]), // [{type: "device", id: 1, action: "on"}]
  confidence: integer("confidence").notNull().default(0), // 0-100
  occurrences: integer("occurrences").notNull().default(0), // How many times detected
  lastOccurrence: timestamp("last_occurrence"),
  isConfirmed: boolean("is_confirmed").notNull().default(false), // User confirmed this pattern
  isAutomated: boolean("is_automated").notNull().default(false), // Auto-execute without asking
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Website Monitoring - sites surveillés
export const monitoredSites = pgTable("monitored_sites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  url: text("url").notNull(),
  name: text("name").notNull(),
  checkInterval: integer("check_interval").notNull().default(60), // minutes between checks
  alertThreshold: integer("alert_threshold").notNull().default(30000), // ms before alert (30s default)
  isActive: boolean("is_active").notNull().default(true),
  lastCheckAt: timestamp("last_check_at"),
  lastStatus: text("last_status"), // up, down, slow, error
  lastResponseTime: integer("last_response_time"), // ms
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Monitoring Check History - historique des vérifications
export const monitoringChecks = pgTable("monitoring_checks", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull(), // up, down, slow, error, timeout
  responseTimeMs: integer("response_time_ms"),
  httpStatus: integer("http_status"),
  errorMessage: text("error_message"),
  contentLength: integer("content_length"),
  checkedAt: timestamp("checked_at").defaultNow(),
});

// Monitoring Alerts - alertes générées
export const monitoringAlerts = pgTable("monitoring_alerts", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull(),
  userId: integer("user_id").notNull(),
  alertType: text("alert_type").notNull(), // down, slow, recovered, content_changed
  message: text("message").notNull(),
  responseTimeMs: integer("response_time_ms"),
  isRead: boolean("is_read").notNull().default(false),
  isNotified: boolean("is_notified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
});

// ========================================
// SCREEN MONITORING / LIVE WATCH SYSTEM
// ========================================

// Screen monitoring preferences per user
export const screenMonitorPreferences = pgTable("screen_monitor_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  captureIntervalMs: integer("capture_interval_ms").notNull().default(2000), // 2s default
  captureQuality: text("capture_quality").notNull().default("medium"), // low, medium, high
  privacyFilters: text("privacy_filters").array().default([]), // apps/domains to blur
  activeHoursStart: text("active_hours_start"), // HH:MM format, null = always
  activeHoursEnd: text("active_hours_end"),
  pauseOnInactivity: boolean("pause_on_inactivity").notNull().default(true),
  inactivityTimeoutMs: integer("inactivity_timeout_ms").notNull().default(120000), // 2 min
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Active screen monitoring sessions
export const screenMonitorSessions = pgTable("screen_monitor_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  totalFrames: integer("total_frames").notNull().default(0),
  totalAnalyses: integer("total_analyses").notNull().default(0),
  status: text("status").notNull().default("active"), // active, paused, ended
});

// Screen context events - what Ulysse learns from watching
export const screenContextEvents = pgTable("screen_context_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sessionId: integer("session_id").notNull(),
  activeApp: text("active_app"), // VSCode, Chrome, etc.
  activeWindow: text("active_window"), // Window title (sanitized)
  context: text("context").notNull(), // AI-generated context description
  tags: text("tags").array().default([]), // coding, browsing, documentation, etc.
  confidence: real("confidence").notNull().default(0.8),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Work patterns learned from screen monitoring
export const screenWorkPatterns = pgTable("screen_work_patterns", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  patternType: text("pattern_type").notNull(), // app_usage, focus_session, break_pattern, productivity
  patternName: text("pattern_name").notNull(),
  patternData: jsonb("pattern_data").notNull(), // {app, avgDuration, timeOfDay, frequency, etc.}
  occurrences: integer("occurrences").notNull().default(1),
  confidence: real("confidence").notNull().default(0.5),
  lastObserved: timestamp("last_observed").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ═══════════════════════════════════════════════════════════════
// ULYSSE BRAIN SYSTEM - Unified Knowledge & Memory Architecture
// ═══════════════════════════════════════════════════════════════

// Knowledge Base - structured knowledge with hierarchical categorization
// The core "brain" storage for all learned information
export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Content
  title: text("title").notNull(),
  content: text("content").notNull(), // Main content (can be long text, markdown, etc.)
  summary: text("summary"), // AI-generated summary
  // Type classification
  type: text("type").notNull(), // text, image, video, link, document, code, fact, concept
  category: text("category").notNull(), // personal, work, reference, learning, creative, technical
  subcategory: text("subcategory"), // More specific classification
  // Hierarchical organization
  parentId: integer("parent_id"), // For nested knowledge (concept -> sub-concepts)
  tags: text("tags").array().default([]),
  // Source tracking
  source: text("source"), // Where this knowledge came from (conversation, web, upload, etc.)
  sourceUrl: text("source_url"), // Original URL if applicable
  sourceType: text("source_type"), // conversation, web_search, upload, manual, inference
  // Media attachments
  mediaPath: text("media_path"), // Path to associated media file
  mediaMimeType: text("media_mime_type"),
  mediaSize: integer("media_size"),
  thumbnailPath: text("thumbnail_path"),
  // Intelligence metrics
  importance: integer("importance").notNull().default(50), // 0-100 importance score
  confidence: integer("confidence").notNull().default(50), // 0-100 confidence in accuracy
  usefulness: integer("usefulness").notNull().default(50), // 0-100 usefulness score
  accessCount: integer("access_count").notNull().default(0), // Times retrieved
  // Temporal
  isTemporary: boolean("is_temporary").notNull().default(false),
  expiresAt: timestamp("expires_at"), // For temporary knowledge
  lastAccessedAt: timestamp("last_accessed_at"),
  lastVerifiedAt: timestamp("last_verified_at"), // Last time accuracy was verified
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Saved Links - bookmarked URLs with analysis and summaries
export const savedLinks = pgTable("saved_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Link info
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  faviconUrl: text("favicon_url"),
  // AI analysis
  summary: text("summary"), // AI-generated summary of content
  keyPoints: text("key_points").array().default([]), // Main takeaways
  category: text("category"), // article, tool, reference, tutorial, video, etc.
  tags: text("tags").array().default([]),
  sentiment: text("sentiment"), // positive, neutral, negative
  readingTime: integer("reading_time"), // Estimated minutes to read
  // Content caching
  cachedContent: text("cached_content"), // Extracted main content
  lastCrawledAt: timestamp("last_crawled_at"),
  crawlStatus: text("crawl_status"), // success, failed, pending
  // Status
  isFavorite: boolean("is_favorite").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  isRead: boolean("is_read").notNull().default(false),
  // Context
  savedFrom: text("saved_from"), // conversation, manual, email, homework
  relatedKnowledgeId: integer("related_knowledge_id"), // Link to knowledge_base if processed
  notes: text("notes"), // User's personal notes
  // Metrics
  visitCount: integer("visit_count").notNull().default(0),
  lastVisitedAt: timestamp("last_visited_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Knowledge Graph - relationships between entities for reasoning
export const knowledgeGraph = pgTable("knowledge_graph", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Source entity
  sourceType: text("source_type").notNull(), // knowledge, link, person, project, memory, concept
  sourceId: integer("source_id").notNull(),
  sourceLabel: text("source_label").notNull(), // Display name
  // Relationship
  relationship: text("relationship").notNull(), // relates_to, is_part_of, depends_on, contradicts, supports, mentions, created_by, similar_to
  relationshipStrength: integer("relationship_strength").notNull().default(50), // 0-100
  // Target entity
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  targetLabel: text("target_label").notNull(),
  // Metadata
  context: text("context"), // Why/how this relationship was created
  isInferred: boolean("is_inferred").notNull().default(false), // AI-inferred vs explicit
  confidence: integer("confidence").notNull().default(80), // 0-100 confidence
  // Temporal
  validFrom: timestamp("valid_from"),
  validUntil: timestamp("valid_until"), // For temporal relationships
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Learning Log - tracks what Ulysse learns and how
export const learningLog = pgTable("learning_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // What was learned
  topic: text("topic").notNull(),
  content: text("content").notNull(), // What was learned
  learningType: text("learning_type").notNull(), // fact, preference, skill, pattern, correction, insight
  // Source
  sourceType: text("source_type").notNull(), // conversation, observation, homework, web_search, feedback
  sourceContext: text("source_context"), // Relevant context (e.g., conversation excerpt)
  sourceMessageId: integer("source_message_id"), // Reference to conversation_messages if applicable
  // Impact
  affectedEntities: jsonb("affected_entities").default([]), // [{type, id, field, oldValue, newValue}]
  impactScore: integer("impact_score").notNull().default(50), // 0-100 how significant
  // Validation
  wasConfirmed: boolean("was_confirmed"), // User confirmed the learning
  wasContradicted: boolean("was_contradicted").notNull().default(false),
  contradictionReason: text("contradiction_reason"),
  // Status
  isApplied: boolean("is_applied").notNull().default(true), // Learning was applied
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Brain Statistics - tracks overall brain health and metrics
export const brainStatistics = pgTable("brain_statistics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  // Knowledge metrics
  totalKnowledge: integer("total_knowledge").notNull().default(0),
  totalLinks: integer("total_links").notNull().default(0),
  totalConnections: integer("total_connections").notNull().default(0),
  totalLearnings: integer("total_learnings").notNull().default(0),
  // Category breakdown (JSONB for flexibility)
  knowledgeByCategory: jsonb("knowledge_by_category").default({}), // {personal: 50, work: 30, ...}
  knowledgeByType: jsonb("knowledge_by_type").default({}), // {text: 100, image: 20, ...}
  // Health metrics
  averageConfidence: integer("average_confidence").default(50),
  averageImportance: integer("average_importance").default(50),
  staleKnowledgeCount: integer("stale_knowledge_count").default(0), // Not accessed in 30+ days
  contradictionCount: integer("contradiction_count").default(0),
  // Activity metrics
  learningsToday: integer("learnings_today").default(0),
  learningsThisWeek: integer("learnings_this_week").default(0),
  retrievalsToday: integer("retrievals_today").default(0),
  // Timestamps
  lastLearningAt: timestamp("last_learning_at"),
  lastRetrievalAt: timestamp("last_retrieval_at"),
  lastCleanupAt: timestamp("last_cleanup_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Learning Progress - tracks autonomous learning depth per topic (Russian dolls system V2)
export const learningProgress = pgTable("learning_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Topic identification
  topic: text("topic").notNull(), // The subject being learned
  topicHash: text("topic_hash").notNull(), // Normalized hash for deduplication
  category: text("category"), // personal, work, reference, learning, etc.
  // V2: Domain classification for prioritization (sports, trading, sugu, dev, perso, autre)
  domain: text("domain").notNull().default("autre"),
  // Russian dolls depth tracking
  currentDepth: integer("current_depth").notNull().default(0), // 0-4 (surface to insights)
  maxDepth: integer("max_depth").notNull().default(4), // Target depth
  // Layer status: pending, processing, completed, failed
  layer1Status: text("layer1_status").notNull().default("pending"), // Surface facts
  layer2Status: text("layer2_status").notNull().default("pending"), // Detailed knowledge
  layer3Status: text("layer3_status").notNull().default("pending"), // Connections
  layer4Status: text("layer4_status").notNull().default("pending"), // Insights
  // V2: Layer knowledge IDs for poupees russes structure
  layer1KnowledgeIds: integer("layer1_knowledge_ids").array().default([]),
  layer2KnowledgeIds: integer("layer2_knowledge_ids").array().default([]),
  layer3GraphIds: integer("layer3_graph_ids").array().default([]),
  layer4InsightIds: integer("layer4_insight_ids").array().default([]),
  // Progress tracking
  totalFacts: integer("total_facts").notNull().default(0),
  totalConnections: integer("total_connections").notNull().default(0),
  totalInsights: integer("total_insights").notNull().default(0),
  // Prioritization
  priority: integer("priority").notNull().default(50), // 0-100, higher = more important
  recencyScore: integer("recency_score").notNull().default(50), // How recent the topic was discussed
  frequencyScore: integer("frequency_score").notNull().default(0), // How often mentioned
  // V2: Usefulness score - tracks how often this knowledge is used in responses
  usefulnessScore: integer("usefulness_score").notNull().default(50), // 0-100, updated when knowledge is used
  // V3: Pattern type for sports predictions (structural = permanent patterns, situational = context-dependent)
  patternType: text("pattern_type").default("structural"), // structural, situational
  // V3: Volatility factor for confidence decay (higher = faster decay)
  volatilityFactor: real("volatility_factor").notNull().default(1.0), // 0.5 for stable (dev), 2.0 for volatile (sports context)
  // V3: Trigger type for learning cycle
  triggerType: text("trigger_type").default("time_based"), // time_based, event_based, manual
  // V3: Confidence score (separate from usefulness - how reliable is this knowledge)
  confidenceScore: integer("confidence_score").notNull().default(70), // 0-100
  // V3: Last time this knowledge was accessed/used
  lastAccessedAt: timestamp("last_accessed_at"),
  // V3: Source prediction IDs (for sports prediction bridge)
  sourcePredictionIds: integer("source_prediction_ids").array().default([]),
  // Source tracking
  sourceConversationIds: integer("source_conversation_ids").array().default([]),
  extractedFrom: text("extracted_from"), // conversation, homework, user_request, prediction_learning
  // Scheduling
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  runCount: integer("run_count").notNull().default(0),
  lastError: text("last_error"),
  // Related knowledge entries created (legacy - use layer*Ids for V2)
  relatedKnowledgeIds: integer("related_knowledge_ids").array().default([]),
  relatedGraphIds: integer("related_graph_ids").array().default([]),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert Schemas for Brain System
export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBase).omit({ id: true, createdAt: true, updatedAt: true, lastAccessedAt: true });
export const insertSavedLinkSchema = createInsertSchema(savedLinks).omit({ id: true, createdAt: true, updatedAt: true, lastVisitedAt: true, lastCrawledAt: true });
export const insertKnowledgeGraphSchema = createInsertSchema(knowledgeGraph).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLearningLogSchema = createInsertSchema(learningLog).omit({ id: true, createdAt: true, appliedAt: true });
export const insertBrainStatisticsSchema = createInsertSchema(brainStatistics).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLearningProgressSchema = createInsertSchema(learningProgress).omit({ id: true, createdAt: true, updatedAt: true, lastRunAt: true, nextRunAt: true });

// Schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertSessionSchema = createInsertSchema(sessions).omit({ createdAt: true });
export const insertWebauthnCredentialSchema = createInsertSchema(webauthnCredentials).omit({ createdAt: true });
export const insertApprovedUserSchema = createInsertSchema(approvedUsers).omit({ id: true, createdAt: true });
export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export const insertSubtaskSchema = createInsertSchema(subtasks).omit({ id: true, createdAt: true });
export const insertTaskLabelSchema = createInsertSchema(taskLabels).omit({ id: true, createdAt: true });
export const insertTaskLabelAssignmentSchema = createInsertSchema(taskLabelAssignments).omit({ id: true });
export const insertNoteSchema = createInsertSchema(notes).omit({ id: true, createdAt: true });
export const insertUlysseStateSchema = createInsertSchema(ulysseState).omit({ id: true, lastInteraction: true });
export const insertUlysseMemorySchema = createInsertSchema(ulysseMemory).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProjectMemorySchema = createInsertSchema(projectMemory).omit({ id: true, createdAt: true, lastDiscussed: true });
export const insertWebSearchMemorySchema = createInsertSchema(webSearchMemory).omit({ id: true, createdAt: true });
export const insertMarsSearchHistorySchema = createInsertSchema(marsSearchHistory).omit({ id: true, createdAt: true });
export const insertUlysseDiagnosticsSchema = createInsertSchema(ulysseDiagnostics).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertUlysseImprovementsSchema = createInsertSchema(ulysseImprovements).omit({ id: true, createdAt: true, implementedAt: true });
export const insertVoiceSettingsSchema = createInsertSchema(voiceSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAmbianceProfileSchema = createInsertSchema(ambianceProfiles).omit({ id: true, createdAt: true });
export const insertUlysseFileSchema = createInsertSchema(ulysseFiles).omit({ id: true, createdAt: true });
export const insertUlysseCodeSnapshotSchema = createInsertSchema(ulysseCodeSnapshots).omit({ id: true, createdAt: true, lastAnalyzedAt: true });
export const insertUlysseHomeworkSchema = createInsertSchema(ulysseHomework).omit({ id: true, createdAt: true, completedAt: true, lastExecutedAt: true });
export const insertHomeworkExecutionSchema = createInsertSchema(homeworkExecution).omit({ id: true, startedAt: true, completedAt: true });
export const insertTaskQueueSchema = createInsertSchema(taskQueues).omit({ id: true, createdAt: true, startedAt: true, completedAt: true });
export const insertTaskQueueItemSchema = createInsertSchema(taskQueueItems).omit({ id: true, startedAt: true, completedAt: true });

// AgentMail Schemas
export const insertAgentmailMessageSchema = createInsertSchema(agentmailMessages).omit({ id: true, cachedAt: true });
export const insertAgentmailAttachmentSchema = createInsertSchema(agentmailAttachments).omit({ id: true, createdAt: true });
export const insertAgentmailSendHistorySchema = createInsertSchema(agentmailSendHistory).omit({ id: true, createdAt: true, lastAttemptAt: true, sentAt: true });

// Self-Awareness System Schemas
export const insertCapabilityRegistrySchema = createInsertSchema(capabilityRegistry).omit({ id: true, createdAt: true, updatedAt: true, lastVerified: true });
export const insertActionLogSchema = createInsertSchema(actionLogs).omit({ id: true, startedAt: true, completedAt: true });
export const insertDiagnosticRunSchema = createInsertSchema(diagnosticRuns).omit({ id: true, startedAt: true, completedAt: true });
export const insertDiagnosticFindingSchema = createInsertSchema(diagnosticFindings).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertCapabilityChangelogSchema = createInsertSchema(capabilityChangelog).omit({ id: true, createdAt: true });

// V2 Schemas
export const insertDeviceSchema = createInsertSchema(devices).omit({ id: true, createdAt: true, lastSeen: true });
export const insertApiTokenSchema = createInsertSchema(apiTokens).omit({ id: true, createdAt: true, lastUsedAt: true });
export const insertConversationThreadSchema = createInsertSchema(conversationThreads).omit({ id: true, createdAt: true, lastMessageAt: true });
export const insertConversationMessageSchema = createInsertSchema(conversationMessages).omit({ id: true, createdAt: true });
export const insertDailySummarySchema = createInsertSchema(dailySummaries).omit({ id: true, generatedAt: true });
export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({ id: true, cachedAt: true });
export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMediaLibrarySchema = createInsertSchema(mediaLibrary).omit({ id: true, createdAt: true, capturedAt: true });
export const insertUlysseCharterSchema = createInsertSchema(ulysseCharter).omit({ id: true, createdAt: true, updatedAt: true });

// Geolocation Schemas
export const insertLocationSessionSchema = createInsertSchema(locationSessions).omit({ id: true, createdAt: true, endedAt: true, lastLocationAt: true });
export const insertLocationPointSchema = createInsertSchema(locationPoints).omit({ id: true, createdAt: true });
export const insertLocationPreferenceSchema = createInsertSchema(locationPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGeofenceSchema = createInsertSchema(geofences).omit({ id: true, createdAt: true, updatedAt: true, lastTriggeredAt: true });
export const insertGeofenceEventSchema = createInsertSchema(geofenceEvents).omit({ id: true, createdAt: true });

// Itinerary Schemas
export const insertSavedRouteSchema = createInsertSchema(savedRoutes).omit({ id: true, createdAt: true, updatedAt: true, lastUsedAt: true });
export const insertRouteWaypointSchema = createInsertSchema(routeWaypoints).omit({ id: true, createdAt: true });
export const insertRouteHistorySchema = createInsertSchema(routeHistory).omit({ id: true, createdAt: true, startedAt: true, completedAt: true });
export const insertRoutePreferencesSchema = createInsertSchema(routePreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertActiveNavigationSchema = createInsertSchema(activeNavigation).omit({ id: true, startedAt: true, updatedAt: true });

// Domotique / Surveillance Schemas
export const insertSurveillanceCameraSchema = createInsertSchema(surveillanceCameras).omit({ id: true, createdAt: true, updatedAt: true, lastSeenAt: true, lastSnapshotAt: true });
export const insertCameraEventSchema = createInsertSchema(cameraEvents).omit({ id: true, createdAt: true });

// Smart Home Schemas (Phase 1)
export const insertSmartDeviceSchema = createInsertSchema(smartDevices).omit({ id: true, createdAt: true, updatedAt: true, lastStateAt: true });
export const insertSmartSceneSchema = createInsertSchema(smartScenes).omit({ id: true, createdAt: true, updatedAt: true, lastActivatedAt: true });

// Siri Webhooks Schemas (Phase 2)
export const insertSiriWebhookSchema = createInsertSchema(siriWebhooks).omit({ id: true, createdAt: true, lastTriggeredAt: true });

// Proactive ML Schemas (Phase 3)
export const insertUserBehaviorEventSchema = createInsertSchema(userBehaviorEvents).omit({ id: true, occurredAt: true });
export const insertProactiveSuggestionSchema = createInsertSchema(proactiveSuggestions).omit({ id: true, createdAt: true, shownAt: true, respondedAt: true });
export const insertLearnedPatternSchema = createInsertSchema(learnedPatterns).omit({ id: true, createdAt: true, updatedAt: true, lastOccurrence: true });

// Website Monitoring Schemas
export const insertMonitoredSiteSchema = createInsertSchema(monitoredSites).omit({ id: true, createdAt: true, updatedAt: true, lastCheckAt: true });
export const insertMonitoringCheckSchema = createInsertSchema(monitoringChecks).omit({ id: true, checkedAt: true });
export const insertMonitoringAlertSchema = createInsertSchema(monitoringAlerts).omit({ id: true, createdAt: true, acknowledgedAt: true });

// Screen Monitoring Schemas
export const insertScreenMonitorPreferencesSchema = createInsertSchema(screenMonitorPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertScreenMonitorSessionSchema = createInsertSchema(screenMonitorSessions).omit({ id: true, startedAt: true, endedAt: true });
export const insertScreenContextEventSchema = createInsertSchema(screenContextEvents).omit({ id: true, timestamp: true });
export const insertScreenWorkPatternSchema = createInsertSchema(screenWorkPatterns).omit({ id: true, createdAt: true, lastObserved: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type InsertWebauthnCredential = z.infer<typeof insertWebauthnCredentialSchema>;

export type ApprovedUser = typeof approvedUsers.$inferSelect;
export type InsertApprovedUser = z.infer<typeof insertApprovedUserSchema>;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type TaskQueue = typeof taskQueues.$inferSelect;
export type InsertTaskQueue = z.infer<typeof insertTaskQueueSchema>;
export type TaskQueueItem = typeof taskQueueItems.$inferSelect;
export type InsertTaskQueueItem = z.infer<typeof insertTaskQueueItemSchema>;

// Work Journal - Ulysse's operational work log with checklist
export const workJournal = pgTable("work_journal", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  context: text("context").notNull().default("general"), // general, devops, sugu, football, finance
  entryType: text("entry_type").notNull().default("task"), // task, reflection, strategy, note, request
  title: text("title").notNull(),
  content: text("content"), // detailed description, strategy, reasoning
  status: text("status").notNull().default("pending"), // pending, in_progress, done, blocked, cancelled
  priority: text("priority").notNull().default("normal"), // critical, high, normal, low
  source: text("source").notNull().default("user"), // user (Maurice's request), autonomous (Ulysse initiative), system
  relatedFiles: text("related_files").array(), // files touched or relevant
  tags: text("tags").array(), // free tags for grouping
  outcome: text("outcome"), // result/conclusion when done
  parentId: integer("parent_id"), // for sub-tasks
  conversationId: integer("conversation_id"), // link to conversation thread
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkJournalSchema = createInsertSchema(workJournal).omit({ id: true, createdAt: true, updatedAt: true, completedAt: true });
export type WorkJournalEntry = typeof workJournal.$inferSelect;
export type InsertWorkJournalEntry = z.infer<typeof insertWorkJournalSchema>;

export const devopsFileHistory = pgTable("devops_file_history", {
  id: serial("id").primaryKey(),
  filePath: text("file_path").notNull(),
  eventType: text("event_type").notNull(), // commit, patch, review, revert, hotfix, bug_report
  eventResult: text("event_result").notNull().default("success"), // success, bug, revert, hotfix, failure
  riskScore: integer("risk_score"), // CI Oracle score at time of event
  linesChanged: integer("lines_changed").default(0),
  commitSha: text("commit_sha"),
  domains: text("domains").array(),
  description: text("description"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDevopsFileHistorySchema = createInsertSchema(devopsFileHistory).omit({ id: true, createdAt: true });
export type DevopsFileHistoryEntry = typeof devopsFileHistory.$inferSelect;
export type InsertDevopsFileHistoryEntry = z.infer<typeof insertDevopsFileHistorySchema>;

export type Subtask = typeof subtasks.$inferSelect;
export type InsertSubtask = z.infer<typeof insertSubtaskSchema>;

export type TaskLabel = typeof taskLabels.$inferSelect;
export type InsertTaskLabel = z.infer<typeof insertTaskLabelSchema>;

export type TaskLabelAssignment = typeof taskLabelAssignments.$inferSelect;
export type InsertTaskLabelAssignment = z.infer<typeof insertTaskLabelAssignmentSchema>;

export type TaskWithSubtasks = Task & { subtasks: Subtask[]; labels: TaskLabel[] };

export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

export type UlysseState = typeof ulysseState.$inferSelect;
export type InsertUlysseState = z.infer<typeof insertUlysseStateSchema>;

export type UlysseMemory = typeof ulysseMemory.$inferSelect;
export type InsertUlysseMemory = z.infer<typeof insertUlysseMemorySchema>;

export type ProjectMemory = typeof projectMemory.$inferSelect;
export type InsertProjectMemory = z.infer<typeof insertProjectMemorySchema>;

export type WebSearchMemory = typeof webSearchMemory.$inferSelect;
export type InsertWebSearchMemory = z.infer<typeof insertWebSearchMemorySchema>;

export type MarsSearchHistory = typeof marsSearchHistory.$inferSelect;
export type InsertMarsSearchHistory = z.infer<typeof insertMarsSearchHistorySchema>;

export type UlysseDiagnostic = typeof ulysseDiagnostics.$inferSelect;
export type InsertUlysseDiagnostic = z.infer<typeof insertUlysseDiagnosticsSchema>;

export type UlysseImprovement = typeof ulysseImprovements.$inferSelect;
export type InsertUlysseImprovement = z.infer<typeof insertUlysseImprovementsSchema>;

export type VoiceSettings = typeof voiceSettings.$inferSelect;
export type InsertVoiceSettings = z.infer<typeof insertVoiceSettingsSchema>;

export type AmbianceProfile = typeof ambianceProfiles.$inferSelect;
export type InsertAmbianceProfile = z.infer<typeof insertAmbianceProfileSchema>;

export type UlysseFile = typeof ulysseFiles.$inferSelect;
export type InsertUlysseFile = z.infer<typeof insertUlysseFileSchema>;

export type UlysseCodeSnapshot = typeof ulysseCodeSnapshots.$inferSelect;
export type InsertUlysseCodeSnapshot = z.infer<typeof insertUlysseCodeSnapshotSchema>;

export type UlysseHomework = typeof ulysseHomework.$inferSelect;
export type InsertUlysseHomework = z.infer<typeof insertUlysseHomeworkSchema>;

export type HomeworkExecution = typeof homeworkExecution.$inferSelect;
export type InsertHomeworkExecution = z.infer<typeof insertHomeworkExecutionSchema>;

// V2 Types
export type Device = typeof devices.$inferSelect;
export type InsertDevice = z.infer<typeof insertDeviceSchema>;

export type ApiToken = typeof apiTokens.$inferSelect;
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;

export type ConversationThread = typeof conversationThreads.$inferSelect;
export type InsertConversationThread = z.infer<typeof insertConversationThreadSchema>;

export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type InsertConversationMessage = z.infer<typeof insertConversationMessageSchema>;

export type DailySummary = typeof dailySummaries.$inferSelect;
export type InsertDailySummary = z.infer<typeof insertDailySummarySchema>;

export type EmailMessage = typeof emailMessages.$inferSelect;
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;

export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;

export type MediaLibrary = typeof mediaLibrary.$inferSelect;
export type InsertMediaLibrary = z.infer<typeof insertMediaLibrarySchema>;

export type KnownPerson = typeof knownPersons.$inferSelect;
export type InsertKnownPerson = z.infer<typeof insertKnownPersonSchema>;

export type FaceDescriptor = typeof faceDescriptors.$inferSelect;
export type InsertFaceDescriptor = z.infer<typeof insertFaceDescriptorSchema>;

export type MediaFace = typeof mediaFaces.$inferSelect;
export type InsertMediaFace = z.infer<typeof insertMediaFaceSchema>;

export type UlysseCharter = typeof ulysseCharter.$inferSelect;
export type InsertUlysseCharter = z.infer<typeof insertUlysseCharterSchema>;

export type AgentmailMessage = typeof agentmailMessages.$inferSelect;
export type InsertAgentmailMessage = z.infer<typeof insertAgentmailMessageSchema>;

export type AgentmailAttachment = typeof agentmailAttachments.$inferSelect;
export type InsertAgentmailAttachment = z.infer<typeof insertAgentmailAttachmentSchema>;

// Self-Awareness System Types
export type CapabilityRegistry = typeof capabilityRegistry.$inferSelect;
export type InsertCapabilityRegistry = z.infer<typeof insertCapabilityRegistrySchema>;

export type ActionLog = typeof actionLogs.$inferSelect;
export type InsertActionLog = z.infer<typeof insertActionLogSchema>;

export type DiagnosticRun = typeof diagnosticRuns.$inferSelect;
export type InsertDiagnosticRun = z.infer<typeof insertDiagnosticRunSchema>;

export type DiagnosticFinding = typeof diagnosticFindings.$inferSelect;
export type InsertDiagnosticFinding = z.infer<typeof insertDiagnosticFindingSchema>;

export type CapabilityChangelog = typeof capabilityChangelog.$inferSelect;
export type InsertCapabilityChangelog = z.infer<typeof insertCapabilityChangelogSchema>;

// Geolocation Types
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

// Itinerary Types
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

// Domotique / Surveillance Types
export type SurveillanceCamera = typeof surveillanceCameras.$inferSelect;
export type InsertSurveillanceCamera = z.infer<typeof insertSurveillanceCameraSchema>;

export type CameraEvent = typeof cameraEvents.$inferSelect;
export type InsertCameraEvent = z.infer<typeof insertCameraEventSchema>;

// Smart Home Types (Phase 1)
export type SmartDevice = typeof smartDevices.$inferSelect;
export type InsertSmartDevice = z.infer<typeof insertSmartDeviceSchema>;

export type SmartScene = typeof smartScenes.$inferSelect;
export type InsertSmartScene = z.infer<typeof insertSmartSceneSchema>;

// Siri Webhook Types (Phase 2)
export type SiriWebhook = typeof siriWebhooks.$inferSelect;
export type InsertSiriWebhook = z.infer<typeof insertSiriWebhookSchema>;

// Proactive ML Types (Phase 3)
export type UserBehaviorEvent = typeof userBehaviorEvents.$inferSelect;
export type InsertUserBehaviorEvent = z.infer<typeof insertUserBehaviorEventSchema>;

export type ProactiveSuggestion = typeof proactiveSuggestions.$inferSelect;
export type InsertProactiveSuggestion = z.infer<typeof insertProactiveSuggestionSchema>;

export type LearnedPattern = typeof learnedPatterns.$inferSelect;
export type InsertLearnedPattern = z.infer<typeof insertLearnedPatternSchema>;

// Website Monitoring Types
export type MonitoredSite = typeof monitoredSites.$inferSelect;
export type InsertMonitoredSite = z.infer<typeof insertMonitoredSiteSchema>;

export type MonitoringCheck = typeof monitoringChecks.$inferSelect;
export type InsertMonitoringCheck = z.infer<typeof insertMonitoringCheckSchema>;

export type MonitoringAlert = typeof monitoringAlerts.$inferSelect;
export type InsertMonitoringAlert = z.infer<typeof insertMonitoringAlertSchema>;

// Screen Monitoring Types
export type ScreenMonitorPreferences = typeof screenMonitorPreferences.$inferSelect;
export type InsertScreenMonitorPreferences = z.infer<typeof insertScreenMonitorPreferencesSchema>;

export type ScreenMonitorSession = typeof screenMonitorSessions.$inferSelect;
export type InsertScreenMonitorSession = z.infer<typeof insertScreenMonitorSessionSchema>;

export type ScreenContextEvent = typeof screenContextEvents.$inferSelect;
export type InsertScreenContextEvent = z.infer<typeof insertScreenContextEventSchema>;

export type ScreenWorkPattern = typeof screenWorkPatterns.$inferSelect;
export type InsertScreenWorkPattern = z.infer<typeof insertScreenWorkPatternSchema>;

// Brain System Types
export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBase = z.infer<typeof insertKnowledgeBaseSchema>;

export type SavedLink = typeof savedLinks.$inferSelect;
export type InsertSavedLink = z.infer<typeof insertSavedLinkSchema>;

export type KnowledgeGraph = typeof knowledgeGraph.$inferSelect;
export type InsertKnowledgeGraph = z.infer<typeof insertKnowledgeGraphSchema>;

export type LearningLog = typeof learningLog.$inferSelect;
export type InsertLearningLog = z.infer<typeof insertLearningLogSchema>;

export type BrainStatistics = typeof brainStatistics.$inferSelect;
export type InsertBrainStatistics = z.infer<typeof insertBrainStatisticsSchema>;

export type LearningProgress = typeof learningProgress.$inferSelect;
export type InsertLearningProgress = z.infer<typeof insertLearningProgressSchema>;

// ============================================
// SUGUVAL RESTAURANT CHECKLIST SYSTEM
// Accessible at /courses/suguval (no auth required)
// ============================================

export const suguvalCategories = pgTable("suguval_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sheet: text("sheet").notNull().default("Feuil1"),
  zone: integer("zone").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguvalItems = pgTable("suguval_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguvalChecks = pgTable("suguval_checks", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  checkDate: text("check_date").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  checkedAt: timestamp("checked_at"),
  note: text("note"),
});

export const suguvalFutureItems = pgTable("suguval_future_items", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  targetDate: text("target_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suguvalEmailLogs = pgTable("suguval_email_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at").defaultNow(),
  emailDate: text("email_date").notNull(),
  itemCount: integer("item_count").notNull(),
  itemsList: text("items_list").notNull(),
  success: boolean("success").notNull().default(true),
  error: text("error"),
});

// Suguval Insert Schemas
export const insertSuguvalCategorySchema = createInsertSchema(suguvalCategories).omit({ id: true, createdAt: true });
export const insertSuguvalItemSchema = createInsertSchema(suguvalItems).omit({ id: true, createdAt: true });
export const insertSuguvalCheckSchema = createInsertSchema(suguvalChecks).omit({ id: true });
export const insertSuguvalFutureItemSchema = createInsertSchema(suguvalFutureItems).omit({ id: true, createdAt: true });
export const insertSuguvalEmailLogSchema = createInsertSchema(suguvalEmailLogs).omit({ id: true, sentAt: true });

// Suguval Types
export type SuguvalCategory = typeof suguvalCategories.$inferSelect;
export type InsertSuguvalCategory = z.infer<typeof insertSuguvalCategorySchema>;

export type SuguvalItem = typeof suguvalItems.$inferSelect;
export type InsertSuguvalItem = z.infer<typeof insertSuguvalItemSchema>;

export type SuguvalCheck = typeof suguvalChecks.$inferSelect;
export type InsertSuguvalCheck = z.infer<typeof insertSuguvalCheckSchema>;

export type SuguvalFutureItem = typeof suguvalFutureItems.$inferSelect;
export type InsertSuguvalFutureItem = z.infer<typeof insertSuguvalFutureItemSchema>;

export type SuguvalEmailLog = typeof suguvalEmailLogs.$inferSelect;
export type InsertSuguvalEmailLog = z.infer<typeof insertSuguvalEmailLogSchema>;

// Suguval Comments - Employee notes to admin
export const suguvalComments = pgTable("suguval_comments", {
  id: serial("id").primaryKey(),
  author: text("author").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguvalCommentSchema = createInsertSchema(suguvalComments).omit({ id: true, createdAt: true });
export type SuguvalComment = typeof suguvalComments.$inferSelect;
export type InsertSuguvalComment = z.infer<typeof insertSuguvalCommentSchema>;

// ============================================
// SUGU MAILLANE RESTAURANT CHECKLIST SYSTEM
// Accessible at /courses/sugumaillane (no auth required)
// 100% clone of Suguval with email to sugu.resto@gmail.com
// ============================================

export const sugumaillaneCategories = pgTable("sugumaillane_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sheet: text("sheet").notNull().default("Feuil1"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sugumaillaneItems = pgTable("sugumaillane_items", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  nameVi: text("name_vi"),
  nameTh: text("name_th"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sugumaillaneChecks = pgTable("sugumaillane_checks", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  checkDate: text("check_date").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  checkedAt: timestamp("checked_at"),
  note: text("note"),
});

export const sugumaillaneFutureItems = pgTable("sugumaillane_future_items", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  targetDate: text("target_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sugumaillaneEmailLogs = pgTable("sugumaillane_email_logs", {
  id: serial("id").primaryKey(),
  sentAt: timestamp("sent_at").defaultNow(),
  emailDate: text("email_date").notNull(),
  itemCount: integer("item_count").notNull(),
  itemsList: text("items_list").notNull(),
  success: boolean("success").notNull().default(true),
  error: text("error"),
});

// Sugumaillane Insert Schemas
export const insertSugumaillaneCategorySchema = createInsertSchema(sugumaillaneCategories).omit({ id: true, createdAt: true });
export const insertSugumaillaneItemSchema = createInsertSchema(sugumaillaneItems).omit({ id: true, createdAt: true });
export const insertSugumaillaneCheckSchema = createInsertSchema(sugumaillaneChecks).omit({ id: true });
export const insertSugumaillaneFutureItemSchema = createInsertSchema(sugumaillaneFutureItems).omit({ id: true, createdAt: true });
export const insertSugumaillaneEmailLogSchema = createInsertSchema(sugumaillaneEmailLogs).omit({ id: true, sentAt: true });

// Sugumaillane Types
export type SugumaillaneCategory = typeof sugumaillaneCategories.$inferSelect;
export type InsertSugumaillaneCategory = z.infer<typeof insertSugumaillaneCategorySchema>;

export type SugumaillaneItem = typeof sugumaillaneItems.$inferSelect;
export type InsertSugumaillaneItem = z.infer<typeof insertSugumaillaneItemSchema>;

export type SugumaillaneCheck = typeof sugumaillaneChecks.$inferSelect;
export type InsertSugumaillaneCheck = z.infer<typeof insertSugumaillaneCheckSchema>;

export type SugumaillaneFutureItem = typeof sugumaillaneFutureItems.$inferSelect;
export type InsertSugumaillaneFutureItem = z.infer<typeof insertSugumaillaneFutureItemSchema>;

export type SugumaillaneEmailLog = typeof sugumaillaneEmailLogs.$inferSelect;
export type InsertSugumaillaneEmailLog = z.infer<typeof insertSugumaillaneEmailLogSchema>;

// ============================================
// SPORTS CACHE SYSTEM - DJEDOU PRONOS API
// Cache intelligent pour matchs et cotes de paris
// Sync quotidienne 6h + refresh cotes horaire
// ============================================

export const cachedMatches = pgTable("cached_matches", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull(), // API-Football fixture id
  sport: text("sport").notNull().default("football"), // football, basketball, f1, etc.
  league: text("league").notNull(), // Ligue 1, Premier League, NBA, etc.
  leagueId: integer("league_id"), // API-Football league id
  country: text("country"), // France, England, etc.
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeTeamId: integer("home_team_id"), // API-Football team id for stats lookup
  awayTeamId: integer("away_team_id"), // API-Football team id for stats lookup
  homeTeamLogo: text("home_team_logo"),
  awayTeamLogo: text("away_team_logo"),
  matchDate: timestamp("match_date").notNull(),
  venue: text("venue"),
  status: text("status").notNull().default("scheduled"), // scheduled, live, finished, postponed
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  stats: jsonb("stats"), // Goals for/against, form, etc.
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const cachedOdds = pgTable("cached_odds", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull(), // FK to cached_matches
  externalMatchId: text("external_match_id"), // TheOddsAPI event id
  bookmaker: text("bookmaker").notNull(), // Unibet, Betclic, etc.
  market: text("market").notNull().default("h2h"), // h2h, spreads, totals
  homeOdds: real("home_odds"),
  drawOdds: real("draw_odds"),
  awayOdds: real("away_odds"),
  overOdds: real("over_odds"), // Over 2.5
  underOdds: real("under_odds"), // Under 2.5
  bttsYes: real("btts_yes"), // Both teams to score
  bttsNo: real("btts_no"),
  oddsData: jsonb("odds_data"), // Raw odds data for other markets
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

export const sportsSyncJobs = pgTable("sports_sync_jobs", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull(), // daily_sync, hourly_odds, manual, stats_sync
  sport: text("sport").notNull().default("all"),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, partial_success
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  matchesProcessed: integer("matches_processed").default(0),
  oddsProcessed: integer("odds_processed").default(0),
  apiCallsUsed: integer("api_calls_used").default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Cache stats équipes pour analyse paris
export const cachedTeamStats = pgTable("cached_team_stats", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull(), // API-Football team id
  teamName: text("team_name").notNull(),
  league: text("league").notNull(),
  leagueId: integer("league_id"),
  
  // Forme récente (10 derniers matchs)
  formString: text("form_string"), // "VVDNVNDVVV"
  last10Wins: integer("last10_wins").default(0),
  last10Draws: integer("last10_draws").default(0),
  last10Losses: integer("last10_losses").default(0),
  
  // Stats buts (moyenne sur 10 matchs)
  goalsForAvg: real("goals_for_avg"),
  goalsAgainstAvg: real("goals_against_avg"),
  
  // Taux pour paris
  over25Rate: real("over25_rate"), // % matchs > 2.5 buts
  bttsRate: real("btts_rate"), // % matchs BTTS
  cleanSheetRate: real("clean_sheet_rate"), // % clean sheets
  failedToScoreRate: real("failed_to_score_rate"), // % matchs sans marquer
  
  // Stats domicile/extérieur spécifiques
  homeGoalsForAvg: real("home_goals_for_avg"),
  homeGoalsAgainstAvg: real("home_goals_against_avg"),
  homeOver25Rate: real("home_over25_rate"),
  homeBttsRate: real("home_btts_rate"),
  
  awayGoalsForAvg: real("away_goals_for_avg"),
  awayGoalsAgainstAvg: real("away_goals_against_avg"),
  awayOver25Rate: real("away_over25_rate"),
  awayBttsRate: real("away_btts_rate"),
  
  // Métadonnées
  matchesSampled: integer("matches_sampled").default(10),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Sports Cache Insert Schemas
export const insertCachedMatchSchema = createInsertSchema(cachedMatches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCachedOddsSchema = createInsertSchema(cachedOdds).omit({ id: true, fetchedAt: true });
export const insertCachedTeamStatsSchema = createInsertSchema(cachedTeamStats).omit({ id: true, createdAt: true, lastUpdated: true });
export const insertSportsSyncJobSchema = createInsertSchema(sportsSyncJobs).omit({ id: true, createdAt: true });

// Sports Cache Types
export type CachedMatch = typeof cachedMatches.$inferSelect;
export type InsertCachedMatch = z.infer<typeof insertCachedMatchSchema>;

export type CachedOdds = typeof cachedOdds.$inferSelect;
export type InsertCachedOdds = z.infer<typeof insertCachedOddsSchema>;

export type SportsSyncJob = typeof sportsSyncJobs.$inferSelect;
export type InsertSportsSyncJob = z.infer<typeof insertSportsSyncJobSchema>;

export type CachedTeamStats = typeof cachedTeamStats.$inferSelect;
export type InsertCachedTeamStats = z.infer<typeof insertCachedTeamStatsSchema>;

// ═══════════════════════════════════════════════════════════════
// PROFIL PARIS - Préférences utilisateur pour les paris sportifs
// ═══════════════════════════════════════════════════════════════

export const bettingProfiles = pgTable("betting_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  
  // Ligues favorites (priorité 1-5)
  favoriteLeagues: jsonb("favorite_leagues").$type<string[]>().default([]),
  
  // Types de paris préférés
  preferredBetTypes: jsonb("preferred_bet_types").$type<string[]>().default([]),
  // Options: "1X2", "over_under", "btts", "combo", "handicap", "score_exact", "mi_temps"
  
  // Style de pari
  riskProfile: text("risk_profile").default("balanced"), // safe, balanced, aggressive
  
  // Équipes favorites (toujours afficher leurs matchs)
  favoriteTeams: jsonb("favorite_teams").$type<string[]>().default([]),
  
  // Équipes à éviter
  blacklistedTeams: jsonb("blacklisted_teams").$type<string[]>().default([]),
  
  // Préférences de cotes
  minOdds: real("min_odds").default(1.2),
  maxOdds: real("max_odds").default(5.0),
  preferredOddsRange: jsonb("preferred_odds_range").$type<{min: number, max: number}>(),
  
  // Budget et mise
  typicalStake: real("typical_stake"), // mise habituelle en €
  weeklyBudget: real("weekly_budget"), // budget hebdo
  
  // Préférences horaires
  preferredTimeSlots: jsonb("preferred_time_slots").$type<string[]>().default([]),
  // Options: "afternoon", "evening", "prime_time", "weekend"
  
  // Tags préférés pour filtrage
  preferredTags: jsonb("preferred_tags").$type<string[]>().default([]),
  avoidedTags: jsonb("avoided_tags").$type<string[]>().default([]),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ═══════════════════════════════════════════════════════════════
// HISTORIQUE PARIS - Suivi des prédictions et résultats
// ═══════════════════════════════════════════════════════════════

export const bettingHistory = pgTable("betting_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  
  // Match info
  matchId: integer("match_id"), // ref cachedMatches.id
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  league: text("league").notNull(),
  matchDate: timestamp("match_date").notNull(),
  
  // Prédiction Ulysse
  predictedBetType: text("predicted_bet_type").notNull(), // 1, X, 2, O2.5, U2.5, BTTS, etc.
  predictedOdds: real("predicted_odds"),
  confidence: integer("confidence"), // 0-100
  reasoning: text("reasoning"), // Explication de la prédiction
  tags: jsonb("tags").$type<string[]>().default([]),
  
  // Résultat réel
  actualHomeScore: integer("actual_home_score"),
  actualAwayScore: integer("actual_away_score"),
  betResult: text("bet_result"), // "won", "lost", "void", "pending"
  
  // Suivi mise (optionnel - si l'utilisateur a parié)
  stakeAmount: real("stake_amount"),
  potentialWin: real("potential_win"),
  actualWin: real("actual_win"),
  wasActuallyBet: boolean("was_actually_bet").default(false),
  
  // Métadonnées
  source: text("source").default("ulysse"), // ulysse, manual
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
});

// Stats agrégées par période
export const bettingStats = pgTable("betting_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  
  period: text("period").notNull(), // "daily", "weekly", "monthly", "all_time"
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  
  // Stats globales
  totalPredictions: integer("total_predictions").default(0),
  correctPredictions: integer("correct_predictions").default(0),
  successRate: real("success_rate").default(0), // %
  
  // Par type de pari
  statsByBetType: jsonb("stats_by_bet_type").$type<Record<string, {total: number, won: number, rate: number}>>(),
  
  // Par ligue
  statsByLeague: jsonb("stats_by_league").$type<Record<string, {total: number, won: number, rate: number}>>(),
  
  // ROI si paris réels
  totalStaked: real("total_staked").default(0),
  totalWon: real("total_won").default(0),
  roi: real("roi").default(0), // %
  
  // Streaks
  currentStreak: integer("current_streak").default(0), // positif = wins, négatif = losses
  bestStreak: integer("best_streak").default(0),
  worstStreak: integer("worst_streak").default(0),
  
  lastUpdated: timestamp("last_updated").defaultNow(),
});

// Insert schemas
export const insertBettingProfileSchema = createInsertSchema(bettingProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBettingHistorySchema = createInsertSchema(bettingHistory).omit({ id: true, createdAt: true });
export const insertBettingStatsSchema = createInsertSchema(bettingStats).omit({ id: true, lastUpdated: true });

// Types
export type BettingProfile = typeof bettingProfiles.$inferSelect;
export type InsertBettingProfile = z.infer<typeof insertBettingProfileSchema>;

export type BettingHistoryEntry = typeof bettingHistory.$inferSelect;
export type InsertBettingHistory = z.infer<typeof insertBettingHistorySchema>;

export type BettingStatsEntry = typeof bettingStats.$inferSelect;
export type InsertBettingStats = z.infer<typeof insertBettingStatsSchema>;

// ═══════════════════════════════════════════════════════════════
// SPORTS PREDICTION SNAPSHOTS - Mémorisation automatique des prédictions
// ═══════════════════════════════════════════════════════════════

export const sportsPredictionSnapshots = pgTable("sports_prediction_snapshots", {
  id: serial("id").primaryKey(),
  
  // Match identification
  matchId: integer("match_id"), // ref cachedMatches.id (nullable for external matches)
  externalMatchId: text("external_match_id"), // API-Football fixture id
  sport: text("sport").notNull().default("football"), // football, basketball, hockey, nfl
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  matchDate: timestamp("match_date").notNull(),
  
  // Snapshot des cotes au moment de la prédiction
  oddsSnapshot: jsonb("odds_snapshot").$type<{
    homeOdds: number;
    drawOdds?: number;
    awayOdds: number;
    overOdds?: number;
    underOdds?: number;
    bttsYes?: number;
    spreadHome?: number;
    spreadAway?: number;
    bookmaker: string;
    fetchedAt: string;
  }>(),
  
  // Statistiques utilisées pour la prédiction
  statsSnapshot: jsonb("stats_snapshot").$type<{
    homeForm?: string;
    awayForm?: string;
    homeGoalsAvg?: number;
    awayGoalsAvg?: number;
    homeOver25Rate?: number;
    awayOver25Rate?: number;
    homeBttsRate?: number;
    awayBttsRate?: number;
    h2hHistory?: any;
  }>(),
  
  // Prédictions calculées (toutes les probabilités)
  predictions: jsonb("predictions").$type<{
    homeWinProb: number;
    drawProb?: number;
    awayWinProb: number;
    over25Prob?: number;
    under25Prob?: number;
    bttsProb?: number;
    spreadProb?: number;
  }>().notNull(),
  
  // Recommandations générées
  recommendations: jsonb("recommendations").$type<{
    bestBet: string; // "1", "X", "2", "O2.5", "U2.5", "BTTS", etc.
    confidence: number; // 0-100
    valueScore: number; // écart cote réelle vs probabilité
    reasoning: string;
    altBets?: Array<{bet: string; confidence: number; value: number}>;
  }>().notNull(),
  
  // Résultat réel (mis à jour après le match)
  actualResult: jsonb("actual_result").$type<{
    homeScore: number;
    awayScore: number;
    status: string;
    settledAt: string;
  }>(),
  
  // Performance de la prédiction
  predictionPerformance: jsonb("prediction_performance").$type<{
    mainBetWon: boolean;
    probabilityAccuracy: number; // 0-100
    valueRealized: boolean;
    notes?: string;
  }>(),
  
  // Brain System integration
  addedToBrain: boolean("added_to_brain").default(false),
  brainKnowledgeId: integer("brain_knowledge_id"), // référence vers knowledge base
  learningExtracted: boolean("learning_extracted").default(false),
  
  // Footdatas integration
  footdatasSynced: boolean("footdatas_synced").default(false),
  
  // Metadata
  version: integer("version").default(1), // pour suivre les mises à jour
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schema
export const insertSportsPredictionSnapshotSchema = createInsertSchema(sportsPredictionSnapshots).omit({ 
  id: true, createdAt: true, updatedAt: true 
});

// Types
export type SportsPredictionSnapshot = typeof sportsPredictionSnapshots.$inferSelect;
export type InsertSportsPredictionSnapshot = z.infer<typeof insertSportsPredictionSnapshotSchema>;

// Screenshot Cache for Vision-based URL analysis
export const screenshotCache = pgTable("screenshot_cache", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  userId: integer("user_id").notNull(),
  imageBase64: text("image_base64").notNull(),
  analysis: text("analysis").notNull(),
  metadata: jsonb("metadata").$type<{
    fullPage?: boolean;
    prompt?: string;
    focusOn?: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertScreenshotCacheSchema = createInsertSchema(screenshotCache).omit({ 
  id: true, createdAt: true 
});
export type ScreenshotCache = typeof screenshotCache.$inferSelect;
export type InsertScreenshotCache = z.infer<typeof insertScreenshotCacheSchema>;

// Domain Profiles - Learning which scraping strategy works for each domain
export const domainProfiles = pgTable("domain_profiles", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  defaultStrategy: text("default_strategy").notNull().default("http"),
  jsRequired: boolean("js_required").notNull().default(false),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  successfulStrategies: text("successful_strategies").array().default([]),
  failedStrategies: text("failed_strategies").array().default([]),
  lastSuccessStrategy: text("last_success_strategy"),
  lastAttempt: timestamp("last_attempt"),
  lastSuccess: timestamp("last_success"),
  attemptCount: integer("attempt_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  avgQualityScore: text("avg_quality_score").notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDomainProfileSchema = createInsertSchema(domainProfiles).omit({ 
  id: true
});
export type DomainProfileDb = typeof domainProfiles.$inferSelect;
export type InsertDomainProfile = z.infer<typeof insertDomainProfileSchema>;

// ============================================================================
// ULYSSE DEV++ CAPABILITIES - Enhanced AI Assistant Features
// ============================================================================

// 1. Codebase Graph - Structured access to imports/exports graph
export const codebaseGraphs = pgTable("codebase_graphs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  snapshotId: text("snapshot_id").notNull(), // unique identifier for this scan
  graph: jsonb("graph").$type<{
    files: Array<{
      path: string;
      imports: Array<{ from: string; names: string[] }>;
      exports: string[];
      dependencies: string[];
    }>;
    modules: Record<string, string[]>;
    entryPoints: string[];
  }>().notNull(),
  stats: jsonb("stats").$type<{
    totalFiles: number;
    totalImports: number;
    totalExports: number;
    scanDurationMs: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCodebaseGraphSchema = createInsertSchema(codebaseGraphs).omit({ id: true, createdAt: true });
export type CodebaseGraph = typeof codebaseGraphs.$inferSelect;
export type InsertCodebaseGraph = z.infer<typeof insertCodebaseGraphSchema>;

// 2. Test Runs - Captures test execution results
export const testRuns = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // jest, vitest, playwright
  status: text("status").notNull(), // running, passed, failed, error
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  summary: jsonb("summary").$type<{
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    failures: Array<{
      testName: string;
      file: string;
      line?: number;
      message: string;
      stack?: string;
    }>;
  }>(),
  rawLog: text("raw_log"),
});

export const insertTestRunSchema = createInsertSchema(testRuns).omit({ id: true, startedAt: true });
export type TestRun = typeof testRuns.$inferSelect;
export type InsertTestRun = z.infer<typeof insertTestRunSchema>;

// 3. Build Runs - Captures build/compile results
export const buildRuns = pgTable("build_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // typescript, vite, esbuild
  status: text("status").notNull(), // running, success, error
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  errors: jsonb("errors").$type<Array<{
    file: string;
    line: number;
    column?: number;
    message: string;
    code?: string;
    severity: 'error' | 'warning';
  }>>(),
  rawLog: text("raw_log"),
});

export const insertBuildRunSchema = createInsertSchema(buildRuns).omit({ id: true, startedAt: true });
export type BuildRun = typeof buildRuns.$inferSelect;
export type InsertBuildRun = z.infer<typeof insertBuildRunSchema>;

// 4. Runtime Errors - Aggregates frontend and backend errors
export const runtimeErrors = pgTable("runtime_errors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  source: text("source").notNull(), // frontend, backend, worker
  level: text("level").notNull(), // error, warn, info
  message: text("message").notNull(),
  stack: text("stack"),
  url: text("url"),
  userAgent: text("user_agent"),
  deviceId: text("device_id"),
  persona: text("persona"), // ulysse, iris, alfred
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRuntimeErrorSchema = createInsertSchema(runtimeErrors).omit({ id: true, createdAt: true });
export type RuntimeError = typeof runtimeErrors.$inferSelect;
export type InsertRuntimeError = z.infer<typeof insertRuntimeErrorSchema>;

// 5. Usage Events - Tracks feature usage by module and persona
export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  module: text("module").notNull(), // voice, navigation, homework, email, geoloc, etc.
  feature: text("feature").notNull(), // specific action within module
  persona: text("persona"), // ulysse, iris, alfred, kelly, lenny, micky
  durationMs: integer("duration_ms"),
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUsageEventSchema = createInsertSchema(usageEvents).omit({ id: true, createdAt: true });
export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;

// 6. Performance Metrics - Profiling data for endpoints and queries
export const perfMetrics = pgTable("perf_metrics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  type: text("type").notNull(), // api, db_query, external_api, render
  endpoint: text("endpoint"),
  method: text("method"), // GET, POST, etc.
  durationMs: integer("duration_ms").notNull(),
  statusCode: integer("status_code"),
  dbQuery: jsonb("db_query").$type<{
    query: string;
    params?: any[];
    rows?: number;
  }>(),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPerfMetricSchema = createInsertSchema(perfMetrics).omit({ id: true, createdAt: true });
export type PerfMetric = typeof perfMetrics.$inferSelect;
export type InsertPerfMetric = z.infer<typeof insertPerfMetricSchema>;

// 7. Assistant Modes - Configurable ship/craft/audit modes
export const assistantModes = pgTable("assistant_modes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  mode: text("mode").notNull().default("craft"), // ship, craft, audit
  preferences: jsonb("preferences").$type<{
    strictness: number; // 0-100
    autoFix: boolean;
    codeReview: boolean;
    suggestTests: boolean;
    debtTracking: boolean;
  }>(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAssistantModeSchema = createInsertSchema(assistantModes).omit({ id: true, updatedAt: true });
export type AssistantMode = typeof assistantModes.$inferSelect;
export type InsertAssistantMode = z.infer<typeof insertAssistantModeSchema>;

// 8. Style Guides - Living code style rules extracted from codebase
export const styleGuides = pgTable("style_guides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  rules: jsonb("rules").$type<Array<{
    category: string; // naming, structure, patterns, imports
    rule: string;
    examples: string[];
    confidence: number;
  }>>(),
  analysis: jsonb("analysis").$type<{
    frameworks: string[];
    conventions: Record<string, string>;
    patterns: string[];
    antiPatterns: string[];
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStyleGuideSchema = createInsertSchema(styleGuides).omit({ id: true, createdAt: true });
export type StyleGuide = typeof styleGuides.$inferSelect;
export type InsertStyleGuide = z.infer<typeof insertStyleGuideSchema>;

// 9. Patch Proposals - Sandboxed multi-file edit proposals
export const patchProposals = pgTable("patch_proposals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  diff: text("diff").notNull(), // unified diff format
  files: jsonb("files").$type<Array<{
    path: string;
    action: 'add' | 'modify' | 'delete';
    additions: number;
    deletions: number;
  }>>().notNull(),
  status: text("status").notNull().default("pending"), // pending, applied, rejected
  changelog: text("changelog"),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPatchProposalSchema = createInsertSchema(patchProposals).omit({ id: true, createdAt: true });
export type PatchProposal = typeof patchProposals.$inferSelect;
export type InsertPatchProposal = z.infer<typeof insertPatchProposalSchema>;

// ============================================
// STOCK MARKET SYSTEM
// Watchlists, portfolio tracking, price alerts
// Multi-provider: Finnhub, Twelve Data, Alpha Vantage
// ============================================

export const stockWatchlists = pgTable("stock_watchlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull().default("Ma Watchlist"),
  symbols: text("symbols").array().notNull().default([]),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const stockPortfolio = pgTable("stock_portfolio", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  shares: real("shares").notNull(),
  avgCost: real("avg_cost").notNull(),
  currency: text("currency").default("USD"),
  notes: text("notes"),
  addedAt: timestamp("added_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const stockAlerts = pgTable("stock_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  alertType: text("alert_type").notNull(), // price_above, price_below, percent_change
  targetValue: real("target_value").notNull(),
  currentValue: real("current_value"),
  isTriggered: boolean("is_triggered").default(false),
  triggeredAt: timestamp("triggered_at"),
  notifyMethod: text("notify_method").default("chat"), // chat, email
  createdAt: timestamp("created_at").defaultNow(),
});

export const stockQuoteCache = pgTable("stock_quote_cache", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  name: text("name"),
  price: real("price").notNull(),
  change: real("change"),
  changePercent: real("change_percent"),
  high: real("high"),
  low: real("low"),
  open: real("open"),
  previousClose: real("previous_close"),
  volume: integer("volume"),
  marketCap: real("market_cap"),
  pe: real("pe"),
  eps: real("eps"),
  provider: text("provider"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

export const insertStockWatchlistSchema = createInsertSchema(stockWatchlists).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStockPortfolioSchema = createInsertSchema(stockPortfolio).omit({ id: true, addedAt: true, updatedAt: true });
export const insertStockAlertSchema = createInsertSchema(stockAlerts).omit({ id: true, createdAt: true, triggeredAt: true, isTriggered: true });

export type StockWatchlist = typeof stockWatchlists.$inferSelect;
export type InsertStockWatchlist = z.infer<typeof insertStockWatchlistSchema>;

export type StockPortfolioPosition = typeof stockPortfolio.$inferSelect;
export type InsertStockPortfolioPosition = z.infer<typeof insertStockPortfolioSchema>;

export type StockAlert = typeof stockAlerts.$inferSelect;
export type InsertStockAlert = z.infer<typeof insertStockAlertSchema>;

export type StockQuoteCache = typeof stockQuoteCache.$inferSelect;

// ========================================
// BETSLIP TRACKER - Track actual bets placed
// ========================================

export const actualBets = pgTable("actual_bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  matchId: integer("match_id"), // Link to sports prediction if available
  externalMatchId: text("external_match_id"),
  sport: text("sport").notNull(), // football, basketball, hockey, nfl
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  matchDate: timestamp("match_date").notNull(),
  betType: text("bet_type").notNull(), // 1, X, 2, 1X, X2, 12, Over 2.5, Under 2.5, BTTS Yes/No, etc.
  odds: real("odds").notNull(),
  stake: real("stake").notNull(),
  potentialWin: real("potential_win"),
  bookmaker: text("bookmaker").notNull(), // betclic, winamax, unibet, etc.
  status: text("status").notNull().default("pending"), // pending, won, lost, void, cashout
  actualResult: jsonb("actual_result"), // { homeScore, awayScore, settledAt }
  profit: real("profit"), // Calculated after settlement (positive or negative)
  confidence: integer("confidence"), // User's confidence 1-100
  reasoning: text("reasoning"), // Why this bet was placed
  isValueBet: boolean("is_value_bet").default(false),
  predictionId: integer("prediction_id"), // Link to sportsPredictionSnapshots
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
});

export const insertActualBetSchema = createInsertSchema(actualBets).omit({ 
  id: true, 
  createdAt: true, 
  settledAt: true, 
  profit: true,
  potentialWin: true,
  actualResult: true
});

export type ActualBet = typeof actualBets.$inferSelect;
export type InsertActualBet = z.infer<typeof insertActualBetSchema>;

// ========================================
// SUGU ANALYTICS - Unified business intelligence
// ========================================

export const suguAnalytics = pgTable("sugu_analytics", {
  id: serial("id").primaryKey(),
  store: text("store").notNull(), // suguval, sugumaillane
  analysisType: text("analysis_type").notNull(), // rotation, stockout, overstock, margin, trend
  itemId: integer("item_id"),
  itemName: text("item_name"),
  categoryId: integer("category_id"),
  categoryName: text("category_name"),
  period: text("period").notNull(), // daily, weekly, monthly
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  metrics: jsonb("metrics").notNull(), // Flexible metrics based on analysis type
  insights: jsonb("insights"), // AI-generated insights
  severity: text("severity"), // info, warning, critical
  actionRequired: boolean("action_required").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguAnalyticsSchema = createInsertSchema(suguAnalytics).omit({ 
  id: true, 
  createdAt: true 
});

export type SuguAnalytics = typeof suguAnalytics.$inferSelect;
export type InsertSuguAnalytics = z.infer<typeof insertSuguAnalyticsSchema>;

// ========================================
// SUGU MANAGEMENT - Purchases, Expenses, Bank, Employees, Payroll, Absences, Files
// ========================================

// ====== SUGU SUPPLIERS (Fiche Fournisseur) ======
export const suguSuppliers = pgTable("sugu_suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  siret: text("siret"),
  tvaNumber: text("tva_number"),
  accountNumber: text("account_number"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  contactName: text("contact_name"),
  category: text("category").default("autre"),
  paymentTerms: text("payment_terms"),
  defaultPaymentMethod: text("default_payment_method"),
  bankIban: text("bank_iban"),
  bankBic: text("bank_bic"),
  notes: text("notes"),
  totalPurchases: real("total_purchases").default(0),
  totalExpenses: real("total_expenses").default(0),
  invoiceCount: integer("invoice_count").default(0),
  lastInvoiceDate: text("last_invoice_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguSupplierSchema = createInsertSchema(suguSuppliers).omit({ id: true, createdAt: true });
export type SuguSupplier = typeof suguSuppliers.$inferSelect;
export type InsertSuguSupplier = z.infer<typeof insertSuguSupplierSchema>;

export const suguPurchases = pgTable("sugu_purchases", {
  id: serial("id").primaryKey(),
  supplier: text("supplier").notNull(),
  supplierId: integer("supplier_id"),
  description: text("description"),
  category: text("category").notNull().default("alimentaire"),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguPurchaseSchema = createInsertSchema(suguPurchases).omit({ id: true, createdAt: true });
export type SuguPurchase = typeof suguPurchases.$inferSelect;
export type InsertSuguPurchase = z.infer<typeof insertSuguPurchaseSchema>;

export const suguExpenses = pgTable("sugu_general_expenses", {
  id: serial("id").primaryKey(),
  label: text("label").default("Non spécifié"),
  supplierId: integer("supplier_id"),
  category: text("category").notNull().default("energie"),
  description: text("description").notNull().default(""),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  period: text("period"),
  frequency: text("frequency").default("mensuel"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  invoiceNumber: text("invoice_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguExpenseSchema = createInsertSchema(suguExpenses).omit({ id: true, createdAt: true });
export type SuguExpense = typeof suguExpenses.$inferSelect;
export type InsertSuguExpense = z.infer<typeof insertSuguExpenseSchema>;

export const suguFiles = pgTable("sugu_files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  category: text("category").notNull(),
  fileType: text("file_type").notNull().default("file"),
  supplier: text("supplier"),
  description: text("description"),
  fileDate: text("file_date"),
  storagePath: text("storage_path").notNull(),
  employeeId: integer("employee_id"),
  createdAt: timestamp("created_at").defaultNow(),
  emailedTo: text("emailed_to").array(),
});

export const insertSuguFileSchema = createInsertSchema(suguFiles).omit({ id: true, createdAt: true });
export type SuguFile = typeof suguFiles.$inferSelect;
export type InsertSuguFile = z.infer<typeof insertSuguFileSchema>;

export const suguTrash = pgTable("sugu_trash", {
  id: serial("id").primaryKey(),
  originalFileId: integer("original_file_id"),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  category: text("category").notNull(),
  fileType: text("file_type").notNull().default("file"),
  supplier: text("supplier"),
  description: text("description"),
  fileDate: text("file_date"),
  storagePath: text("storage_path").notNull(),
  emailedTo: text("emailed_to").array(),
  deletedAt: timestamp("deleted_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});
export type SuguTrashItem = typeof suguTrash.$inferSelect;

export const sugumTrash = pgTable("sugum_trash", {
  id: serial("id").primaryKey(),
  originalFileId: integer("original_file_id"),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  category: text("category").notNull(),
  fileType: text("file_type").notNull().default("file"),
  supplier: text("supplier"),
  description: text("description"),
  fileDate: text("file_date"),
  storagePath: text("storage_path").notNull(),
  emailedTo: text("emailed_to").array(),
  deletedAt: timestamp("deleted_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});
export type SugumTrashItem = typeof sugumTrash.$inferSelect;

export const suguBankEntries = pgTable("sugu_bank_entries", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull().default("Banque Principale"),
  entryDate: text("entry_date").notNull(),
  label: text("label").notNull(),
  amount: real("amount").notNull(),
  balance: real("balance"),
  category: text("category"),
  isReconciled: boolean("is_reconciled").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguBankEntrySchema = createInsertSchema(suguBankEntries).omit({ id: true, createdAt: true });
export type SuguBankEntry = typeof suguBankEntries.$inferSelect;
export type InsertSuguBankEntry = z.infer<typeof insertSuguBankEntrySchema>;

export const suguLoans = pgTable("sugu_loans", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull(),
  loanLabel: text("loan_label").notNull(),
  loanType: text("loan_type").notNull().default("emprunt"),
  totalAmount: real("total_amount").notNull(),
  remainingAmount: real("remaining_amount").notNull(),
  monthlyPayment: real("monthly_payment").notNull(),
  interestRate: real("interest_rate"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  notes: text("notes"),
  originalFileId: integer("original_file_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguLoanSchema = createInsertSchema(suguLoans).omit({ id: true, createdAt: true });
export type SuguLoan = typeof suguLoans.$inferSelect;
export type InsertSuguLoan = z.infer<typeof insertSuguLoanSchema>;

export const suguCashRegister = pgTable("sugu_cash_entries", {
  id: serial("id").primaryKey(),
  entryDate: text("entry_date").notNull(),
  totalRevenue: real("total_revenue").notNull(),
  cashAmount: real("cash_amount").default(0),
  cbAmount: real("cb_amount").default(0),
  cbzenAmount: real("cbzen_amount").default(0),
  trAmount: real("tr_amount").default(0),
  ctrAmount: real("ctr_amount").default(0),
  ubereatsAmount: real("ubereats_amount").default(0),
  deliverooAmount: real("deliveroo_amount").default(0),
  chequeAmount: real("cheque_amount").default(0),
  virementAmount: real("virement_amount").default(0),
  ticketRestoAmount: real("ticket_resto_amount").default(0),
  onlineAmount: real("online_amount").default(0),
  coversCount: integer("covers_count").default(0),
  averageTicket: real("average_ticket").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguCashRegisterSchema = createInsertSchema(suguCashRegister).omit({ id: true, createdAt: true });
export type SuguCashRegister = typeof suguCashRegister.$inferSelect;
export type InsertSuguCashRegister = z.infer<typeof insertSuguCashRegisterSchema>;

export const suguEmployees = pgTable("sugu_employees", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: text("role").notNull(),
  contractType: text("contract_type").notNull().default("CDI"),
  monthlySalary: real("monthly_salary"),
  hourlyRate: real("hourly_rate"),
  weeklyHours: real("weekly_hours").default(35),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  phone: text("phone"),
  email: text("email"),
  socialSecurityNumber: text("social_security_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguEmployeeSchema = createInsertSchema(suguEmployees).omit({ id: true, createdAt: true });
export type SuguEmployee = typeof suguEmployees.$inferSelect;
export type InsertSuguEmployee = z.infer<typeof insertSuguEmployeeSchema>;

export const suguPayroll = pgTable("sugu_payroll", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  period: text("period").notNull(),
  grossSalary: real("gross_salary").notNull(),
  netSalary: real("net_salary").notNull(),
  socialCharges: real("social_charges").default(0),
  employerCharges: real("employer_charges"),
  totalEmployerCost: real("total_employer_cost"),
  bonus: real("bonus").default(0),
  overtime: real("overtime").default(0),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  pdfPath: text("pdf_path"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguPayrollSchema = createInsertSchema(suguPayroll).omit({ id: true, createdAt: true });
export type SuguPayroll = typeof suguPayroll.$inferSelect;
export type InsertSuguPayroll = z.infer<typeof insertSuguPayrollSchema>;

export const suguAbsences = pgTable("sugu_absences", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  type: text("type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  duration: real("duration"),
  isApproved: boolean("is_approved").notNull().default(false),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuguAbsenceSchema = createInsertSchema(suguAbsences).omit({ id: true, createdAt: true });
export type SuguAbsence = typeof suguAbsences.$inferSelect;
export type InsertSuguAbsence = z.infer<typeof insertSuguAbsenceSchema>;

export const suguBackups = pgTable("sugu_backups", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  dataJson: text("data_json").notNull(),
  tableCounts: text("table_counts"),
  sizeBytes: integer("size_bytes").default(0),
});

export type SuguBackup = typeof suguBackups.$inferSelect;

// ========================================
// SUGU MAILLANE - Isolated tables for Maillane restaurant
// ========================================

export const suguMaillaneSuppliers = pgTable("sugum_suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  siret: text("siret"),
  tvaNumber: text("tva_number"),
  accountNumber: text("account_number"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  contactName: text("contact_name"),
  category: text("category").default("autre"),
  paymentTerms: text("payment_terms"),
  defaultPaymentMethod: text("default_payment_method"),
  bankIban: text("bank_iban"),
  bankBic: text("bank_bic"),
  notes: text("notes"),
  totalPurchases: real("total_purchases").default(0),
  totalExpenses: real("total_expenses").default(0),
  invoiceCount: integer("invoice_count").default(0),
  lastInvoiceDate: text("last_invoice_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillaneSupplierSchema = createInsertSchema(suguMaillaneSuppliers).omit({ id: true, createdAt: true });
export type SuguMaillaneSupplier = typeof suguMaillaneSuppliers.$inferSelect;

export const suguMaillanePurchases = pgTable("sugum_purchases", {
  id: serial("id").primaryKey(),
  supplier: text("supplier").notNull(),
  supplierId: integer("supplier_id"),
  description: text("description"),
  category: text("category").notNull().default("alimentaire"),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillanePurchaseSchema = createInsertSchema(suguMaillanePurchases).omit({ id: true, createdAt: true });
export type SuguMaillanePurchase = typeof suguMaillanePurchases.$inferSelect;

export const suguMaillaneExpenses = pgTable("sugum_general_expenses", {
  id: serial("id").primaryKey(),
  label: text("label").default("Non spécifié"),
  supplierId: integer("supplier_id"),
  category: text("category").notNull().default("energie"),
  description: text("description").notNull().default(""),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  period: text("period"),
  frequency: text("frequency").default("mensuel"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  invoiceNumber: text("invoice_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillaneExpenseSchema = createInsertSchema(suguMaillaneExpenses).omit({ id: true, createdAt: true });
export type SuguMaillaneExpense = typeof suguMaillaneExpenses.$inferSelect;

export const suguMaillaneFiles = pgTable("sugum_files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  category: text("category").notNull(),
  fileType: text("file_type").notNull().default("file"),
  supplier: text("supplier"),
  description: text("description"),
  fileDate: text("file_date"),
  storagePath: text("storage_path").notNull(),
  employeeId: integer("employee_id"),
  createdAt: timestamp("created_at").defaultNow(),
  emailedTo: text("emailed_to").array(),
});
export const insertSuguMaillaneFileSchema = createInsertSchema(suguMaillaneFiles).omit({ id: true, createdAt: true });
export type SuguMaillaneFile = typeof suguMaillaneFiles.$inferSelect;

export const suguMaillaneBankEntries = pgTable("sugum_bank_entries", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull().default("Banque Principale"),
  entryDate: text("entry_date").notNull(),
  label: text("label").notNull(),
  amount: real("amount").notNull(),
  balance: real("balance"),
  category: text("category"),
  isReconciled: boolean("is_reconciled").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillaneBankEntrySchema = createInsertSchema(suguMaillaneBankEntries).omit({ id: true, createdAt: true });
export type SuguMaillaneBankEntry = typeof suguMaillaneBankEntries.$inferSelect;

export const suguMaillaneLoans = pgTable("sugum_loans", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull(),
  loanLabel: text("loan_label").notNull(),
  loanType: text("loan_type").notNull().default("emprunt"),
  totalAmount: real("total_amount").notNull(),
  remainingAmount: real("remaining_amount").notNull(),
  monthlyPayment: real("monthly_payment").notNull(),
  interestRate: real("interest_rate"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  notes: text("notes"),
  originalFileId: integer("original_file_id"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillaneLoanSchema = createInsertSchema(suguMaillaneLoans).omit({ id: true, createdAt: true });
export type SuguMaillaneLoan = typeof suguMaillaneLoans.$inferSelect;

export const suguMaillaneCashRegister = pgTable("sugum_cash_entries", {
  id: serial("id").primaryKey(),
  entryDate: text("entry_date").notNull(),
  totalRevenue: real("total_revenue").notNull(),
  cashAmount: real("cash_amount").default(0),
  cbAmount: real("cb_amount").default(0),
  cbzenAmount: real("cbzen_amount").default(0),
  trAmount: real("tr_amount").default(0),
  ctrAmount: real("ctr_amount").default(0),
  ubereatsAmount: real("ubereats_amount").default(0),
  deliverooAmount: real("deliveroo_amount").default(0),
  chequeAmount: real("cheque_amount").default(0),
  virementAmount: real("virement_amount").default(0),
  ticketRestoAmount: real("ticket_resto_amount").default(0),
  onlineAmount: real("online_amount").default(0),
  coversCount: integer("covers_count").default(0),
  averageTicket: real("average_ticket").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillaneCashRegisterSchema = createInsertSchema(suguMaillaneCashRegister).omit({ id: true, createdAt: true });
export type SuguMaillaneCashRegister = typeof suguMaillaneCashRegister.$inferSelect;

export const suguMaillaneEmployees = pgTable("sugum_employees", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: text("role").notNull(),
  contractType: text("contract_type").notNull().default("CDI"),
  monthlySalary: real("monthly_salary"),
  hourlyRate: real("hourly_rate"),
  weeklyHours: real("weekly_hours").default(35),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillaneEmployeeSchema = createInsertSchema(suguMaillaneEmployees).omit({ id: true, createdAt: true });
export type SuguMaillaneEmployee = typeof suguMaillaneEmployees.$inferSelect;

export const suguMaillanePayroll = pgTable("sugum_payroll", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  period: text("period").notNull(),
  grossSalary: real("gross_salary").notNull(),
  netSalary: real("net_salary").notNull(),
  socialCharges: real("social_charges").default(0),
  employerCharges: real("employer_charges"),
  totalEmployerCost: real("total_employer_cost"),
  bonus: real("bonus").default(0),
  overtime: real("overtime").default(0),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  pdfPath: text("pdf_path"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillanePayrollSchema = createInsertSchema(suguMaillanePayroll).omit({ id: true, createdAt: true });
export type SuguMaillanePayroll = typeof suguMaillanePayroll.$inferSelect;

export const suguMaillaneAbsences = pgTable("sugum_absences", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  type: text("type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  duration: real("duration"),
  isApproved: boolean("is_approved").notNull().default(false),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSuguMaillaneAbsenceSchema = createInsertSchema(suguMaillaneAbsences).omit({ id: true, createdAt: true });
export type SuguMaillaneAbsence = typeof suguMaillaneAbsences.$inferSelect;

// ========================================
// SYSTEM DIAGNOSTICS - Self-awareness tracking
// ========================================

export const systemDiagnostics = pgTable("system_diagnostics", {
  id: serial("id").primaryKey(),
  healthScore: integer("health_score").notNull(),
  status: text("status").notNull(), // healthy, degraded, critical
  clarityScore: integer("clarity_score").notNull(),
  clarityMode: text("clarity_mode").notNull(), // normal, cautious, limited
  components: jsonb("components").notNull(), // Component status details
  warnings: text("warnings").array(),
  degradedComponents: text("degraded_components").array(),
  downComponents: text("down_components").array(),
  brainStats: jsonb("brain_stats"), // Brain knowledge stats
  triggeredBy: text("triggered_by").notNull(), // scheduled, manual, event
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSystemDiagnosticsSchema = createInsertSchema(systemDiagnostics).omit({ 
  id: true, 
  createdAt: true 
});

export type SystemDiagnostics = typeof systemDiagnostics.$inferSelect;
export type InsertSystemDiagnostics = z.infer<typeof insertSystemDiagnosticsSchema>;

// ========================================
// FOOTDATAS - Complete Football Database for Big 5 European Leagues
// Each team has its own data file (OMDatas, RealMadridDatas, etc.)
// ========================================

// Leagues - The 5 major European championships
export const footdatasLeagues = pgTable("footdatas_leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Ligue 1, LaLiga, Premier League, Bundesliga, Serie A
  country: text("country").notNull(), // France, Spain, England, Germany, Italy
  code: text("code").notNull().unique(), // L1, LL, PL, BL, SA
  logoUrl: text("logo_url"),
  tier: integer("tier").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Clubs - Main table for each team (OMDatas, RealMadridDatas, etc.)
export const footdatasClubs = pgTable("footdatas_clubs", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull(), // FK to leagues
  name: text("name").notNull(), // Olympique de Marseille
  shortName: text("short_name").notNull(), // OM
  dataFileName: text("data_file_name").notNull().unique(), // OMDatas, RealMadridDatas
  city: text("city"), // Marseille
  stadium: text("stadium"), // Stade Vélodrome
  stadiumCapacity: integer("stadium_capacity"),
  foundedYear: integer("founded_year"),
  colors: text("colors").array(), // ["blue", "white"]
  logoUrl: text("logo_url"),
  website: text("website"),
  president: text("president"),
  budget: text("budget"), // Estimated budget
  socialMedia: jsonb("social_media"), // { twitter, instagram, facebook }
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Club Organigramme - Organization structure
export const footdatasOrganigramme = pgTable("footdatas_organigramme", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(), // FK to clubs
  role: text("role").notNull(), // President, Directeur Sportif, Entraîneur, etc.
  category: text("category").notNull(), // direction, staff_technique, staff_medical, administratif
  personName: text("person_name").notNull(),
  nationality: text("nationality"),
  photoUrl: text("photo_url"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"), // null if currently in position
  previousClub: text("previous_club"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Staff technique - Coaching and technical staff
export const footdatasStaff = pgTable("footdatas_staff", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(), // head_coach, assistant_coach, goalkeeper_coach, fitness_coach, etc.
  nationality: text("nationality"),
  birthDate: timestamp("birth_date"),
  photoUrl: text("photo_url"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  previousClubs: text("previous_clubs").array(),
  achievements: jsonb("achievements"), // Array of { title, year }
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Players - Complete player registry per club
export const footdatasPlayers = pgTable("footdatas_players", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  shirtNumber: integer("shirt_number"),
  position: text("position"), // GK, DF, MF, FW
  positionDetail: text("position_detail"), // CB, RB, LB, CDM, CM, CAM, RW, LW, ST
  nationality: text("nationality"),
  secondNationality: text("second_nationality"),
  birthDate: timestamp("birth_date"),
  age: integer("age"),
  height: integer("height"), // in cm
  weight: integer("weight"), // in kg
  preferredFoot: text("preferred_foot"), // left, right, both
  marketValue: text("market_value"), // €20M
  contractUntil: timestamp("contract_until"),
  photoUrl: text("photo_url"),
  status: text("status").default("active"), // active, injured, loaned_out, suspended
  injuryDetails: text("injury_details"),
  captain: boolean("captain").default(false),
  youthAcademy: boolean("youth_academy").default(false), // From club's academy
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Player Stats - Individual statistics per season
export const footdatasPlayerStats = pgTable("footdatas_player_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  clubId: integer("club_id").notNull(),
  season: text("season").notNull(), // 2024-2025
  competition: text("competition").notNull(), // Ligue 1, Champions League, etc.
  appearances: integer("appearances").default(0),
  starts: integer("starts").default(0),
  minutesPlayed: integer("minutes_played").default(0),
  goals: integer("goals").default(0),
  assists: integer("assists").default(0),
  yellowCards: integer("yellow_cards").default(0),
  redCards: integer("red_cards").default(0),
  cleanSheets: integer("clean_sheets").default(0), // For GK
  saves: integer("saves").default(0), // For GK
  passAccuracy: real("pass_accuracy"),
  shotsOnTarget: integer("shots_on_target").default(0),
  tacklesWon: integer("tackles_won").default(0),
  aerialDuelsWon: integer("aerial_duels_won").default(0),
  rating: real("rating"), // Average rating
  manOfTheMatch: integer("man_of_the_match").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Club Stats - Team statistics per season
export const footdatasClubStats = pgTable("footdatas_club_stats", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  season: text("season").notNull(), // 2024-2025
  competition: text("competition").notNull(),
  matchesPlayed: integer("matches_played").default(0),
  wins: integer("wins").default(0),
  draws: integer("draws").default(0),
  losses: integer("losses").default(0),
  goalsFor: integer("goals_for").default(0),
  goalsAgainst: integer("goals_against").default(0),
  goalDifference: integer("goal_difference").default(0),
  points: integer("points").default(0),
  position: integer("position"), // League position
  homeWins: integer("home_wins").default(0),
  awayWins: integer("away_wins").default(0),
  cleanSheets: integer("clean_sheets").default(0),
  topScorer: text("top_scorer"),
  topScorerGoals: integer("top_scorer_goals"),
  avgPossession: real("avg_possession"),
  avgPassAccuracy: real("avg_pass_accuracy"),
  formLast5: text("form_last_5"), // WWLDW
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transfers (Mercato) - All incoming and outgoing transfers
export const footdatasTransfers = pgTable("footdatas_transfers", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  playerId: integer("player_id"), // FK if player exists in DB
  playerName: text("player_name").notNull(),
  transferType: text("transfer_type").notNull(), // in, out, loan_in, loan_out, free, youth_promotion
  transferWindow: text("transfer_window").notNull(), // summer_2024, winter_2025
  transferDate: timestamp("transfer_date"),
  fromClub: text("from_club"),
  toClub: text("to_club"),
  fee: text("fee"), // €30M, Free, Loan
  feeAmount: real("fee_amount"), // Numeric value in millions
  contractLength: text("contract_length"), // 4 years
  salary: text("salary"), // Estimated salary
  agentFee: text("agent_fee"),
  bonuses: text("bonuses"), // Performance bonuses
  buybackClause: text("buyback_clause"),
  source: text("source"), // Where info came from
  confirmed: boolean("confirmed").default(false),
  officialAnnouncement: text("official_announcement"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// News - Club news and updates
export const footdatasNews = pgTable("footdatas_news", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  summary: text("summary"),
  category: text("category").notNull(), // match, transfer, injury, interview, announcement, rumor
  importance: text("importance").default("normal"), // low, normal, high, breaking
  source: text("source"),
  sourceUrl: text("source_url"),
  imageUrl: text("image_url"),
  relatedPlayerId: integer("related_player_id"),
  relatedPlayerName: text("related_player_name"),
  publishedAt: timestamp("published_at").notNull(),
  verified: boolean("verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Rankings - Historical league positions
export const footdatasRankings = pgTable("footdatas_rankings", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  competition: text("competition").notNull(), // Ligue 1, Champions League, etc.
  season: text("season").notNull(), // 2024-2025
  matchday: integer("matchday"), // Current matchday
  position: integer("position").notNull(),
  points: integer("points").notNull(),
  matchesPlayed: integer("matches_played"),
  wins: integer("wins"),
  draws: integer("draws"),
  losses: integer("losses"),
  goalsFor: integer("goals_for"),
  goalsAgainst: integer("goals_against"),
  goalDifference: integer("goal_difference"),
  form: text("form"), // Last 5 matches: WWDLW
  recordedAt: timestamp("recorded_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Club History - Historical milestones and achievements
export const footdatasHistory = pgTable("footdatas_history", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  eventType: text("event_type").notNull(), // trophy, foundation, stadium, record, milestone, legend
  title: text("title").notNull(),
  description: text("description"),
  eventDate: timestamp("event_date"),
  season: text("season"),
  competition: text("competition"),
  opponent: text("opponent"), // For match-related events
  score: text("score"),
  significance: text("significance"), // local, national, european, world
  relatedPersons: text("related_persons").array(),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Trophies - Complete trophy cabinet
export const footdatasTrophies = pgTable("footdatas_trophies", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  competition: text("competition").notNull(), // Ligue 1, Champions League, Coupe de France, etc.
  season: text("season").notNull(), // 1992-1993
  result: text("result").notNull(), // winner, runner_up, semi_final
  finalOpponent: text("final_opponent"),
  finalScore: text("final_score"),
  topScorer: text("top_scorer"),
  keyPlayers: text("key_players").array(),
  coach: text("coach"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ========================================
// FOOTDATAS MATCHES TABLE (from matchendirect.fr)
// ========================================

export const footdatasMatches = pgTable("footdatas_matches", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id"),
  homeClubId: integer("home_club_id"),
  awayClubId: integer("away_club_id"),
  homeTeamName: text("home_team_name").notNull(),
  awayTeamName: text("away_team_name").notNull(),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  status: text("status").notNull(),
  matchDate: text("match_date").notNull(),
  matchTime: text("match_time"),
  competition: text("competition").notNull(),
  leagueCode: text("league_code"),
  matchUrl: text("match_url"),
  source: text("source").default("matchendirect"),
  predictionData: jsonb("prediction_data").$type<{
    lastPrediction?: {
      won: boolean;
      betType: string;
      confidence: number;
      settledAt: string;
    };
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ========================================
// FOOTDATAS Insert Schemas and Types
// ========================================

export const insertFootdatasMatchSchema = createInsertSchema(footdatasMatches).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasMatch = typeof footdatasMatches.$inferSelect;
export type InsertFootdatasMatch = z.infer<typeof insertFootdatasMatchSchema>;

export const insertFootdatasLeagueSchema = createInsertSchema(footdatasLeagues).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasLeague = typeof footdatasLeagues.$inferSelect;
export type InsertFootdatasLeague = z.infer<typeof insertFootdatasLeagueSchema>;

export const insertFootdatasClubSchema = createInsertSchema(footdatasClubs).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasClub = typeof footdatasClubs.$inferSelect;
export type InsertFootdatasClub = z.infer<typeof insertFootdatasClubSchema>;

export const insertFootdatasOrganigrammeSchema = createInsertSchema(footdatasOrganigramme).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasOrganigramme = typeof footdatasOrganigramme.$inferSelect;
export type InsertFootdatasOrganigramme = z.infer<typeof insertFootdatasOrganigrammeSchema>;

export const insertFootdatasStaffSchema = createInsertSchema(footdatasStaff).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasStaff = typeof footdatasStaff.$inferSelect;
export type InsertFootdatasStaff = z.infer<typeof insertFootdatasStaffSchema>;

export const insertFootdatasPlayerSchema = createInsertSchema(footdatasPlayers).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasPlayer = typeof footdatasPlayers.$inferSelect;
export type InsertFootdatasPlayer = z.infer<typeof insertFootdatasPlayerSchema>;

export const insertFootdatasPlayerStatsSchema = createInsertSchema(footdatasPlayerStats).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasPlayerStats = typeof footdatasPlayerStats.$inferSelect;
export type InsertFootdatasPlayerStats = z.infer<typeof insertFootdatasPlayerStatsSchema>;

export const insertFootdatasClubStatsSchema = createInsertSchema(footdatasClubStats).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasClubStats = typeof footdatasClubStats.$inferSelect;
export type InsertFootdatasClubStats = z.infer<typeof insertFootdatasClubStatsSchema>;

export const insertFootdatasTransferSchema = createInsertSchema(footdatasTransfers).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasTransfer = typeof footdatasTransfers.$inferSelect;
export type InsertFootdatasTransfer = z.infer<typeof insertFootdatasTransferSchema>;

export const insertFootdatasNewsSchema = createInsertSchema(footdatasNews).omit({ id: true, createdAt: true });
export type FootdatasNews = typeof footdatasNews.$inferSelect;
export type InsertFootdatasNews = z.infer<typeof insertFootdatasNewsSchema>;

export const insertFootdatasRankingSchema = createInsertSchema(footdatasRankings).omit({ id: true, createdAt: true, recordedAt: true });
export type FootdatasRanking = typeof footdatasRankings.$inferSelect;
export type InsertFootdatasRanking = z.infer<typeof insertFootdatasRankingSchema>;

export const insertFootdatasHistorySchema = createInsertSchema(footdatasHistory).omit({ id: true, createdAt: true });
export type FootdatasHistory = typeof footdatasHistory.$inferSelect;
export type InsertFootdatasHistory = z.infer<typeof insertFootdatasHistorySchema>;

export const insertFootdatasTrophySchema = createInsertSchema(footdatasTrophies).omit({ id: true, createdAt: true });
export type FootdatasTrophy = typeof footdatasTrophies.$inferSelect;
export type InsertFootdatasTrophy = z.infer<typeof insertFootdatasTrophySchema>;

// ========================================
// FOOTDATAS API CACHE - 3-Year Persistent Football Database
// DB-first, API-fallback strategy for all API Football data
// ========================================

export const footdatasApiTeamMap = pgTable("footdatas_api_team_map", {
  id: serial("id").primaryKey(),
  apiTeamId: integer("api_team_id").notNull().unique(),
  clubId: integer("club_id"),
  teamName: text("team_name").notNull(),
  teamLogo: text("team_logo"),
  apiLeagueId: integer("api_league_id"),
  country: text("country"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasApiStandings = pgTable("footdatas_api_standings", {
  id: serial("id").primaryKey(),
  apiLeagueId: integer("api_league_id").notNull(),
  season: integer("season").notNull(),
  apiTeamId: integer("api_team_id").notNull(),
  teamName: text("team_name").notNull(),
  teamLogo: text("team_logo"),
  rank: integer("rank").notNull(),
  points: integer("points").notNull(),
  goalsDiff: integer("goals_diff").notNull(),
  played: integer("played").notNull(),
  win: integer("win").notNull(),
  draw: integer("draw").notNull(),
  lose: integer("lose").notNull(),
  goalsFor: integer("goals_for").notNull(),
  goalsAgainst: integer("goals_against").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasApiSquads = pgTable("footdatas_api_squads", {
  id: serial("id").primaryKey(),
  apiTeamId: integer("api_team_id").notNull(),
  season: integer("season").notNull(),
  squadData: jsonb("squad_data").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasApiTeamStats = pgTable("footdatas_api_team_stats", {
  id: serial("id").primaryKey(),
  apiTeamId: integer("api_team_id").notNull(),
  season: integer("season").notNull(),
  statsData: jsonb("stats_data").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFootdatasApiTeamMapSchema = createInsertSchema(footdatasApiTeamMap).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasApiTeamMap = typeof footdatasApiTeamMap.$inferSelect;
export type InsertFootdatasApiTeamMap = z.infer<typeof insertFootdatasApiTeamMapSchema>;

export const insertFootdatasApiStandingsSchema = createInsertSchema(footdatasApiStandings).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasApiStanding = typeof footdatasApiStandings.$inferSelect;
export type InsertFootdatasApiStanding = z.infer<typeof insertFootdatasApiStandingsSchema>;

export const insertFootdatasApiSquadsSchema = createInsertSchema(footdatasApiSquads).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasApiSquad = typeof footdatasApiSquads.$inferSelect;
export type InsertFootdatasApiSquad = z.infer<typeof insertFootdatasApiSquadsSchema>;

export const insertFootdatasApiTeamStatsSchema = createInsertSchema(footdatasApiTeamStats).omit({ id: true, createdAt: true, updatedAt: true });
export type FootdatasApiTeamStat = typeof footdatasApiTeamStats.$inferSelect;
export type InsertFootdatasApiTeamStat = z.infer<typeof insertFootdatasApiTeamStatsSchema>;

// ====== PUSH NOTIFICATION SUBSCRIPTIONS ======
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name"),
  alertTypes: text("alert_types").array().notNull().default(["morning_briefing", "anomaly", "sports", "task_reminder"]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;

// ====== SUGU SUPPLIER KNOWLEDGE (Autonomous Learning) ======
export const suguSupplierKnowledge = pgTable("sugu_supplier_knowledge", {
    id: serial("id").primaryKey(),
    restaurant: text("restaurant").notNull().default("val"),
    supplierNorm: text("supplier_norm").notNull(),
    supplierDisplay: text("supplier_display").notNull(),
    category: text("category").notNull(),
    categoryConfidence: real("category_confidence").notNull().default(0),
    totalInvoices: integer("total_invoices").notNull().default(0),
    avgAmount: real("avg_amount"),
    minAmount: real("min_amount"),
    maxAmount: real("max_amount"),
    categoryBreakdown: jsonb("category_breakdown").default({}),
    lastLearned: timestamp("last_learned").defaultNow(),
}, (t) => ([
    uniqueIndex("sugu_supplier_knowledge_restaurant_norm_idx").on(t.restaurant, t.supplierNorm),
]));
export type SuguSupplierKnowledge = typeof suguSupplierKnowledge.$inferSelect;

// ====== MEMORY CONNECTIONS (Graph) ======
export const memoryConnections = pgTable("memory_connections", {
  id: serial("id").primaryKey(),
  sourceMemoryId: integer("source_memory_id").notNull(),
  targetMemoryId: integer("target_memory_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  strength: real("strength").notNull().default(0.5),
  createdAt: timestamp("created_at").defaultNow(),
});
export type MemoryConnection = typeof memoryConnections.$inferSelect;

// ====== USER CONVERSATIONAL PREFERENCES ======
export const userConversationalPreferences = pgTable("user_conversational_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  preferenceType: text("preference_type").notNull(),
  value: text("value").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  learnedFrom: text("learned_from").default("auto"),
  sampleCount: integer("sample_count").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type UserConversationalPreference = typeof userConversationalPreferences.$inferSelect;

// ====== ACTIVITY STREAM (Cross-Domain Timeline) ======
export const activityStream = pgTable("activity_stream", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(), // sugu, sports, betting, finance, personal, system
  eventType: text("event_type").notNull(), // sale, purchase, bet_placed, match_played, anomaly, payroll, file_upload, bank_transaction, etc.
  title: text("title").notNull(),
  description: text("description"),
  occurredAt: timestamp("occurred_at").notNull(),
  entityType: text("entity_type"), // match, supplier, employee, bet, invoice, bank_statement, etc.
  entityId: text("entity_id"), // reference ID in source table
  metadata: jsonb("metadata").default({}), // flexible extra data (amounts, scores, supplier names, etc.)
  importance: integer("importance").notNull().default(5), // 1-10 scale
  restaurant: text("restaurant"), // val, maillane, or null for non-restaurant events
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertActivityStreamSchema = createInsertSchema(activityStream).omit({ id: true, createdAt: true });
export type InsertActivityStream = z.infer<typeof insertActivityStreamSchema>;
export type ActivityStream = typeof activityStream.$inferSelect;

// ====== ENTITY LINKS (Lightweight Relationship Graph) ======
export const entityLinks = pgTable("entity_links", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(), // match, bet, bank_statement, invoice, supplier, employee, prediction, anomaly, etc.
  sourceId: text("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  relationshipType: text("relationship_type").notNull(), // funds, predicts, employs, supplies, triggers, references, caused_by, etc.
  strength: real("strength").notNull().default(1.0), // 0-1 confidence/strength of relationship
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertEntityLinkSchema = createInsertSchema(entityLinks).omit({ id: true, createdAt: true });
export type InsertEntityLink = z.infer<typeof insertEntityLinkSchema>;
export type EntityLink = typeof entityLinks.$inferSelect;

// ====== ENTITY TAGS (Semantic Tagging) ======
export const entityTags = pgTable("entity_tags", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  tag: text("tag").notNull(),
  category: text("category"), // domain, status, priority, custom
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertEntityTagSchema = createInsertSchema(entityTags).omit({ id: true, createdAt: true });
export type InsertEntityTag = z.infer<typeof insertEntityTagSchema>;
export type EntityTag = typeof entityTags.$inferSelect;

export const irisProjects = pgTable("iris_projects", {
  id: serial("id").primaryKey(),
  ownerName: text("owner_name").notNull(),
  projectName: text("project_name").notNull(),
  subdomain: text("subdomain").notNull(),
  description: text("description"),
  githubRepo: text("github_repo"),
  port: integer("port"),
  techStack: text("tech_stack"),
  status: text("status").notNull().default("draft"),
  lastDeployedAt: timestamp("last_deployed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertIrisProjectSchema = createInsertSchema(irisProjects).omit({ id: true, createdAt: true, updatedAt: true, lastDeployedAt: true });
export type InsertIrisProject = z.infer<typeof insertIrisProjectSchema>;
export type IrisProject = typeof irisProjects.$inferSelect;

export const devopsDeployUrls = pgTable("devops_deploy_urls", {
  id: serial("id").primaryKey(),
  repoFullName: text("repo_full_name").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("devops_deploy_urls_repo_url_idx").on(table.repoFullName, table.url),
]);
export const insertDevopsDeployUrlSchema = createInsertSchema(devopsDeployUrls).omit({ id: true, createdAt: true });
export type InsertDevopsDeployUrl = z.infer<typeof insertDevopsDeployUrlSchema>;
export type DevopsDeployUrl = typeof devopsDeployUrls.$inferSelect;

export const uiSnapshots = pgTable("ui_snapshots", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  actionType: text("action_type").notNull(),
  currentPage: text("current_page").notNull(),
  currentTab: text("current_tab"),
  elementClicked: text("element_clicked"),
  visibleComponents: text("visible_components").array(),
  formState: jsonb("form_state"),
  dialogOpen: text("dialog_open"),
  sidebarState: text("sidebar_state"),
  scrollPosition: integer("scroll_position"),
  viewportWidth: integer("viewport_width"),
  viewportHeight: integer("viewport_height"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});
export const insertUiSnapshotSchema = createInsertSchema(uiSnapshots).omit({ id: true, createdAt: true });
export type InsertUiSnapshot = z.infer<typeof insertUiSnapshotSchema>;
export type UiSnapshot = typeof uiSnapshots.$inferSelect;

export const devmaxSessions = pgTable("devmax_sessions", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  displayName: text("display_name"),
  userId: text("user_id"),
  tenantId: text("tenant_id"),
  createdAt: timestamp("created_at").defaultNow(),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export const devmaxActivityLog = pgTable("devmax_activity_log", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const devmaxProjects = pgTable("devmax_projects", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  repoOwner: text("repo_owner"),
  repoName: text("repo_name"),
  repoUrl: text("repo_url"),
  techStack: text("tech_stack").array(),
  deploySlug: text("deploy_slug"),
  deployUrl: text("deploy_url"),
  stagingUrl: text("staging_url"),
  stagingPort: integer("staging_port"),
  productionUrl: text("production_url"),
  productionPort: integer("production_port"),
  environment: text("environment").default("staging"),
  lastDeployedAt: timestamp("last_deployed_at"),
  lastPromotedAt: timestamp("last_promoted_at"),
  status: text("status").default("active"),
  config: jsonb("config"),
  githubToken: text("github_token"),
  githubProvider: text("github_provider").default("owner"),
  githubUser: text("github_user"),
  githubScopes: text("github_scopes"),
  githubConnectedAt: timestamp("github_connected_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const devmaxChatHistory = pgTable("devmax_chat_history", {
  id: serial("id").primaryKey(),
  projectId: text("project_id"),
  sessionId: text("session_id").notNull(),
  threadId: integer("thread_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const devmaxProjectJournal = pgTable("devmax_project_journal", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(),
  sessionId: text("session_id"),
  entryType: text("entry_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  filesChanged: text("files_changed").array(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── MaxAI COBA (Chef Operator Business Assistant) for AppToOrder ───

export const cobaEvents = pgTable("coba_events", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  eventType: text("event_type").notNull(),
  severity: text("severity").default("info"),
  payload: jsonb("payload"),
  sessionId: text("session_id"),
  userId: text("user_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaReports = pgTable("coba_reports", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  reportType: text("report_type").notNull().default("weekly"),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  summary: jsonb("summary"),
  aiInsights: text("ai_insights"),
  pdfUrl: text("pdf_url"),
  pdfPath: text("pdf_path"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaEventSchema = createInsertSchema(cobaEvents).omit({ id: true, createdAt: true });
export type InsertCobaEvent = z.infer<typeof insertCobaEventSchema>;
export type CobaEvent = typeof cobaEvents.$inferSelect;

export const insertCobaReportSchema = createInsertSchema(cobaReports).omit({ id: true, createdAt: true });
export type InsertCobaReport = z.infer<typeof insertCobaReportSchema>;
export type CobaReport = typeof cobaReports.$inferSelect;

// ─── COBA Business Management (Multi-tenant Suguval for AppToOrder restaurants) ───

export const cobaPurchases = pgTable("coba_purchases", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  supplier: text("supplier").notNull(),
  description: text("description"),
  category: text("category").notNull().default("alimentaire"),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaPurchaseSchema = createInsertSchema(cobaPurchases).omit({ id: true, createdAt: true });
export type CobaPurchase = typeof cobaPurchases.$inferSelect;
export type InsertCobaPurchase = z.infer<typeof insertCobaPurchaseSchema>;

export const cobaExpenses = pgTable("coba_expenses", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  label: text("label").default("Non spécifié"),
  category: text("category").notNull().default("energie"),
  description: text("description").notNull().default(""),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").default(0),
  period: text("period"),
  frequency: text("frequency").default("mensuel"),
  dueDate: text("due_date"),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  paymentMethod: text("payment_method"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  invoiceNumber: text("invoice_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaExpenseSchema = createInsertSchema(cobaExpenses).omit({ id: true, createdAt: true });
export type CobaExpense = typeof cobaExpenses.$inferSelect;
export type InsertCobaExpense = z.infer<typeof insertCobaExpenseSchema>;

export const cobaBankEntries = pgTable("coba_bank_entries", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  bankName: text("bank_name").notNull().default("Banque Principale"),
  entryDate: text("entry_date").notNull(),
  label: text("label").notNull(),
  amount: real("amount").notNull(),
  balance: real("balance"),
  category: text("category"),
  isReconciled: boolean("is_reconciled").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaBankEntrySchema = createInsertSchema(cobaBankEntries).omit({ id: true, createdAt: true });
export type CobaBankEntry = typeof cobaBankEntries.$inferSelect;
export type InsertCobaBankEntry = z.infer<typeof insertCobaBankEntrySchema>;

export const cobaLoans = pgTable("coba_loans", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  bankName: text("bank_name").notNull(),
  loanLabel: text("loan_label").notNull(),
  loanType: text("loan_type").notNull().default("emprunt"),
  totalAmount: real("total_amount").notNull(),
  remainingAmount: real("remaining_amount").notNull(),
  monthlyPayment: real("monthly_payment").notNull(),
  interestRate: real("interest_rate"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaLoanSchema = createInsertSchema(cobaLoans).omit({ id: true, createdAt: true });
export type CobaLoan = typeof cobaLoans.$inferSelect;
export type InsertCobaLoan = z.infer<typeof insertCobaLoanSchema>;

export const cobaCashRegister = pgTable("coba_cash_entries", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  entryDate: text("entry_date").notNull(),
  totalRevenue: real("total_revenue").notNull(),
  cashAmount: real("cash_amount").default(0),
  cbAmount: real("cb_amount").default(0),
  ubereatsAmount: real("ubereats_amount").default(0),
  deliverooAmount: real("deliveroo_amount").default(0),
  onlineAmount: real("online_amount").default(0),
  otherAmount: real("other_amount").default(0),
  coversCount: integer("covers_count").default(0),
  averageTicket: real("average_ticket").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaCashRegisterSchema = createInsertSchema(cobaCashRegister).omit({ id: true, createdAt: true });
export type CobaCashRegister = typeof cobaCashRegister.$inferSelect;
export type InsertCobaCashRegister = z.infer<typeof insertCobaCashRegisterSchema>;

export const cobaEmployees = pgTable("coba_employees", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: text("role").notNull(),
  contractType: text("contract_type").notNull().default("CDI"),
  monthlySalary: real("monthly_salary"),
  hourlyRate: real("hourly_rate"),
  weeklyHours: real("weekly_hours").default(35),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaEmployeeSchema = createInsertSchema(cobaEmployees).omit({ id: true, createdAt: true });
export type CobaEmployee = typeof cobaEmployees.$inferSelect;
export type InsertCobaEmployee = z.infer<typeof insertCobaEmployeeSchema>;

export const cobaPayroll = pgTable("coba_payroll", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  period: text("period").notNull(),
  grossSalary: real("gross_salary").notNull(),
  netSalary: real("net_salary").notNull(),
  socialCharges: real("social_charges").default(0),
  employerCharges: real("employer_charges"),
  totalEmployerCost: real("total_employer_cost"),
  bonus: real("bonus").default(0),
  overtime: real("overtime").default(0),
  isPaid: boolean("is_paid").notNull().default(false),
  paidDate: text("paid_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaPayrollSchema = createInsertSchema(cobaPayroll).omit({ id: true, createdAt: true });
export type CobaPayroll = typeof cobaPayroll.$inferSelect;
export type InsertCobaPayroll = z.infer<typeof insertCobaPayrollSchema>;

export const cobaChatSessions = pgTable("coba_chat_sessions", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  proUserId: text("pro_user_id").notNull(),
  proUserName: text("pro_user_name"),
  restaurantName: text("restaurant_name"),
  status: text("status").notNull().default("active"),
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cobaChatMessages = pgTable("coba_chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  toolResults: jsonb("tool_results"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCobaChatSessionSchema = createInsertSchema(cobaChatSessions).omit({ id: true, createdAt: true, lastMessageAt: true, messageCount: true });
export type CobaChatSession = typeof cobaChatSessions.$inferSelect;
export type InsertCobaChatSession = z.infer<typeof insertCobaChatSessionSchema>;

export const insertCobaChatMessageSchema = createInsertSchema(cobaChatMessages).omit({ id: true, createdAt: true });
export type CobaChatMessage = typeof cobaChatMessages.$inferSelect;

export const superChatSessions = pgTable("superchat_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").default("SuperChat"),
  activePersonas: text("active_personas").array().default(["ulysse", "iris", "alfred", "maxai"]),
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const superChatMessages = pgTable("superchat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  sender: text("sender").notNull(),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSuperChatSessionSchema = createInsertSchema(superChatSessions).omit({ id: true, createdAt: true, lastMessageAt: true, messageCount: true });
export type SuperChatSession = typeof superChatSessions.$inferSelect;
export type InsertSuperChatSession = z.infer<typeof insertSuperChatSessionSchema>;

export const insertSuperChatMessageSchema = createInsertSchema(superChatMessages).omit({ id: true, createdAt: true });
export type SuperChatMessage = typeof superChatMessages.$inferSelect;
export type InsertSuperChatMessage = z.infer<typeof insertSuperChatMessageSchema>;
export type InsertCobaChatMessage = z.infer<typeof insertCobaChatMessageSchema>;
