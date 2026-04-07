import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const devopsFileHistory = pgTable("devops_file_history", {
  id: serial("id").primaryKey(),
  filePath: text("file_path").notNull(),
  eventType: text("event_type").notNull(),
  eventResult: text("event_result").notNull().default("success"),
  riskScore: integer("risk_score"),
  linesChanged: integer("lines_changed").default(0),
  commitSha: text("commit_sha"),
  domains: text("domains").array(),
  description: text("description"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const codebaseGraphs = pgTable("codebase_graphs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
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

export const testRuns = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
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

export const buildRuns = pgTable("build_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
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

export const runtimeErrors = pgTable("runtime_errors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  source: text("source").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  stack: text("stack"),
  url: text("url"),
  userAgent: text("user_agent"),
  deviceId: text("device_id"),
  persona: text("persona"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  module: text("module").notNull(),
  feature: text("feature").notNull(),
  persona: text("persona"),
  durationMs: integer("duration_ms"),
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const perfMetrics = pgTable("perf_metrics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  type: text("type").notNull(),
  endpoint: text("endpoint"),
  method: text("method"),
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

export const assistantModes = pgTable("assistant_modes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  mode: text("mode").notNull().default("craft"),
  preferences: jsonb("preferences").$type<{
    strictness: number;
    autoFix: boolean;
    codeReview: boolean;
    suggestTests: boolean;
    debtTracking: boolean;
  }>(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const styleGuides = pgTable("style_guides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  rules: jsonb("rules").$type<Array<{
    category: string;
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

export const patchProposals = pgTable("patch_proposals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  diff: text("diff").notNull(),
  files: jsonb("files").$type<Array<{
    path: string;
    action: 'add' | 'modify' | 'delete';
    additions: number;
    deletions: number;
  }>>().notNull(),
  status: text("status").notNull().default("pending"),
  changelog: text("changelog"),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const devopsDeployUrls = pgTable("devops_deploy_urls", {
  id: serial("id").primaryKey(),
  repoFullName: text("repo_full_name").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("devops_deploy_urls_repo_url_idx").on(table.repoFullName, table.url),
]);

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

export const systemDiagnostics = pgTable("system_diagnostics", {
  id: serial("id").primaryKey(),
  healthScore: integer("health_score").notNull(),
  status: text("status").notNull(),
  clarityScore: integer("clarity_score").notNull(),
  clarityMode: text("clarity_mode").notNull(),
  components: jsonb("components").notNull(),
  warnings: text("warnings").array(),
  degradedComponents: text("degraded_components").array(),
  downComponents: text("down_components").array(),
  brainStats: jsonb("brain_stats"),
  triggeredBy: text("triggered_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

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
  alertType: text("alert_type").notNull(),
  targetValue: real("target_value").notNull(),
  currentValue: real("current_value"),
  isTriggered: boolean("is_triggered").default(false),
  triggeredAt: timestamp("triggered_at"),
  notifyMethod: text("notify_method").default("chat"),
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

export const insertDevopsFileHistorySchema = createInsertSchema(devopsFileHistory).omit({ id: true, createdAt: true });
export const insertCodebaseGraphSchema = createInsertSchema(codebaseGraphs).omit({ id: true, createdAt: true });
export const insertTestRunSchema = createInsertSchema(testRuns).omit({ id: true, startedAt: true });
export const insertBuildRunSchema = createInsertSchema(buildRuns).omit({ id: true, startedAt: true });
export const insertRuntimeErrorSchema = createInsertSchema(runtimeErrors).omit({ id: true, createdAt: true });
export const insertUsageEventSchema = createInsertSchema(usageEvents).omit({ id: true, createdAt: true });
export const insertPerfMetricSchema = createInsertSchema(perfMetrics).omit({ id: true, createdAt: true });
export const insertAssistantModeSchema = createInsertSchema(assistantModes).omit({ id: true, updatedAt: true });
export const insertStyleGuideSchema = createInsertSchema(styleGuides).omit({ id: true, createdAt: true });
export const insertPatchProposalSchema = createInsertSchema(patchProposals).omit({ id: true, createdAt: true });
export const insertDevopsDeployUrlSchema = createInsertSchema(devopsDeployUrls).omit({ id: true, createdAt: true });
export const insertIrisProjectSchema = createInsertSchema(irisProjects).omit({ id: true, createdAt: true, updatedAt: true, lastDeployedAt: true });
export const insertUiSnapshotSchema = createInsertSchema(uiSnapshots).omit({ id: true, createdAt: true });
export const insertSystemDiagnosticsSchema = createInsertSchema(systemDiagnostics).omit({ id: true, createdAt: true });
export const insertStockWatchlistSchema = createInsertSchema(stockWatchlists).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStockPortfolioSchema = createInsertSchema(stockPortfolio).omit({ id: true, addedAt: true, updatedAt: true });
export const insertStockAlertSchema = createInsertSchema(stockAlerts).omit({ id: true, createdAt: true, triggeredAt: true, isTriggered: true });
export const insertScreenshotCacheSchema = createInsertSchema(screenshotCache).omit({ id: true, createdAt: true });
export const insertDomainProfileSchema = createInsertSchema(domainProfiles).omit({ id: true });

export type DevopsFileHistoryEntry = typeof devopsFileHistory.$inferSelect;
export type InsertDevopsFileHistoryEntry = z.infer<typeof insertDevopsFileHistorySchema>;

export type CodebaseGraph = typeof codebaseGraphs.$inferSelect;
export type InsertCodebaseGraph = z.infer<typeof insertCodebaseGraphSchema>;

export type TestRun = typeof testRuns.$inferSelect;
export type InsertTestRun = z.infer<typeof insertTestRunSchema>;

export type BuildRun = typeof buildRuns.$inferSelect;
export type InsertBuildRun = z.infer<typeof insertBuildRunSchema>;

export type RuntimeError = typeof runtimeErrors.$inferSelect;
export type InsertRuntimeError = z.infer<typeof insertRuntimeErrorSchema>;

export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;

export type PerfMetric = typeof perfMetrics.$inferSelect;
export type InsertPerfMetric = z.infer<typeof insertPerfMetricSchema>;

export type AssistantMode = typeof assistantModes.$inferSelect;
export type InsertAssistantMode = z.infer<typeof insertAssistantModeSchema>;

export type StyleGuide = typeof styleGuides.$inferSelect;
export type InsertStyleGuide = z.infer<typeof insertStyleGuideSchema>;

export type PatchProposal = typeof patchProposals.$inferSelect;
export type InsertPatchProposal = z.infer<typeof insertPatchProposalSchema>;

export type DevopsDeployUrl = typeof devopsDeployUrls.$inferSelect;
export type InsertDevopsDeployUrl = z.infer<typeof insertDevopsDeployUrlSchema>;

export type IrisProject = typeof irisProjects.$inferSelect;
export type InsertIrisProject = z.infer<typeof insertIrisProjectSchema>;

export type UiSnapshot = typeof uiSnapshots.$inferSelect;
export type InsertUiSnapshot = z.infer<typeof insertUiSnapshotSchema>;

export type SystemDiagnostics = typeof systemDiagnostics.$inferSelect;
export type InsertSystemDiagnostics = z.infer<typeof insertSystemDiagnosticsSchema>;

export type StockWatchlist = typeof stockWatchlists.$inferSelect;
export type InsertStockWatchlist = z.infer<typeof insertStockWatchlistSchema>;

export type StockPortfolioPosition = typeof stockPortfolio.$inferSelect;
export type InsertStockPortfolioPosition = z.infer<typeof insertStockPortfolioSchema>;

export type StockAlert = typeof stockAlerts.$inferSelect;
export type InsertStockAlert = z.infer<typeof insertStockAlertSchema>;

export type StockQuoteCache = typeof stockQuoteCache.$inferSelect;

export type ScreenshotCache = typeof screenshotCache.$inferSelect;
export type InsertScreenshotCache = z.infer<typeof insertScreenshotCacheSchema>;

export type DomainProfileDb = typeof domainProfiles.$inferSelect;
export type InsertDomainProfile = z.infer<typeof insertDomainProfileSchema>;
