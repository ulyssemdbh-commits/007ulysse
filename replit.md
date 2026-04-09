# Ulysse (DevFlow) — AI Personal Assistant System

## Overview
Ulysse is a full-stack AI personal assistant system designed to provide a unified, intelligent assistant experience across various domains including project management (DevMax), restaurant automation (COBA Pro, SUGU), football/betting intelligence, and DevOps. It operates autonomously with scheduled jobs, proactive intelligence, and self-healing capabilities, aiming to deliver a comprehensive and intelligent assistant for both personal and professional use.

## User Preferences
- Communication style: Simple, everyday French with Maurice.
- Owner: Maurice (userId=1), with family access for Iris (daughters).
- Sessions: devops, assistant, iris, iris-homework, max, voice, offline-sync contexts.

## System Architecture

### Core Stack
- **Frontend**: React 18 + TypeScript, Tailwind CSS + shadcn/ui, Framer Motion, TanStack React Query, wouter routing.
- **Backend**: Express.js on Node.js, RESTful API with Zod validation.
- **Database**: PostgreSQL via Drizzle ORM. Schema split into 16 domain modules under `shared/schema/` with barrel `index.ts`. Drizzle config points to `shared/schema/index.ts`.
- **PWA**: Installable, offline-enabled with push notifications.

### Lazy Loading Architecture (Task #3)
- **serviceLoader** (`server/utils/serviceLoader.ts`): Centralized `loadService(key, factory)` with in-memory cache for deferred imports.
- **scheduledJobs.ts**: 12+ services converted from static imports to lazy-loaded via `loadService()` — suguval, sugumaillane, sportsPredMem, sportsCache, sportsWatch, brain, brainSync, discord, learningOptimizer, autonomousLearning, autonomousInitiative, selfReflection, actionHub, metricsService.
- **routes.ts**: 35+ route modules converted from static imports to `lazyRouter()` wrappers — routes load only on first HTTP request. Critical routes (voice, auth, v2, data, chat, image, objectStorage) remain static.
- **Pattern**: `lazyRouter(() => import("./path"))` creates an Express middleware that dynamically imports and caches the router on first request.

### AI Engine & Personas
- **Ulysse Core Engine**: Orchestrates AI providers with circuit breakers, response learning, and decision caching.
- **Action-First Orchestrator V4**: Unifies OpenAI function calling with 90 tool handlers via ActionHub.
- **Smart Model Router**: Routes tasks to providers based on complexity, token budget, and health.
- **AI Personas**: 4 AIs with unified identity system in `server/config/personaMapping.ts` (PERSONA_IDENTITIES):
  - **Ulysse** 🧠 (primary, Maurice's brain): Full-stack assistant with 90+ tools, voice, vision, DevOps.
  - **Iris** 🌸 (family + Senior CM Commax): Daughters' assistant + community management expert.
  - **Alfred** 🎩 (business SUGU + COBA): Restaurant operations, finances, employees, suppliers.
  - **MaxAI** ⚡ (DevOps + infrastructure): Pipeline deploy, server monitoring, GitHub automation. DGM `auto_execute` action for full autonomous pipeline (decompose → code → review → PR → merge in one action). Enhanced with: `ensureProjectStructure` (auto-creates package-lock.json, fixes CI workflows v3→v4, npm ci→npm i), `waitForCI` (polls GitHub Actions check-runs before merge — blocks if CI fails), pre-deploy checklist in prompt.
  - Each AI has "CONSCIENCE DE SOI" (self-awareness of the other 3 AIs and collaboration rules).
  - `conversations.ts` uses `PERSONA_IDENTITIES.iris.identity` and `PERSONA_IDENTITIES.alfred.identity` — all identity changes go through `personaMapping.ts` ONLY.
  - COBA = client-facing version of Alfred for restaurant tenants on macommande.shop.
- **Anti-Hallucination System**: Employs strict rules (e.g., forcing `browse_files` before code changes), multi-source verification, and verified memory entries.
- **Anti-Read-Loop System**: Detects and corrects AI agents performing consecutive read-only operations without progressing to code modification.
- **DB-First File Architecture**: All test/staging files are stored in `devmax_files` table (branch `"test"`). No staging GitHub repo needed. `deploy-staging` reads files from DB branch "test" and deploys via SSH (`deployFromDbFiles`). `promote-production` copies test→prod in DB, then either pushes to GitHub + deploy (if `repo_owner/repo_name` configured) or deploys directly from DB files (if no GitHub).
- **storage_mode**: `"github"` (prod via GitHub push), `"db"` (everything in DB), `"hybrid"`. Auto-set based on whether repo_owner/repo_name are configured.
- **DB File Storage Service**: `server/services/devmaxFileStorage.ts` — CRUD (listFiles, getFile, saveFile, deleteFile, saveBatch, deleteAll), branch management (listBranches, copyBranch), stats. API routes: `/api/devmax/db-files/*`.
- **deployFromDbFiles()**: SSH deploy method in `server/services/ssh/deploy.ts` — writes files directly to server via SSH, builds, starts with PM2, configures nginx + SSL. Used by both staging and production (DB mode) deploys. Auto-injects `DATABASE_URL` from dedicated project DB if provisioned.
- **Dedicated Project DB**: Each DevMax project can have its own isolated PostgreSQL database on Hetzner. Provisioned via `POST /api/devmax/provision-db`. Status: `GET /api/devmax/provision-db/status`. Columns: `db_name`, `db_user`, `db_password`, `db_url`, `db_provisioned` on `devmax_projects`. The `DATABASE_URL` is auto-injected during deployment.
- **Local Test Preview**: `GET /api/devmax/preview/:projectId/*?branch=test` serves test files directly from DB as a local preview (HTML/CSS/JS with proper MIME types). Shown in LivePreviewPanel via "Test" tab alongside Staging/Production tabs.

### Commax — Community Management
- **Purpose**: Full community management platform propulsé par Ulysse. Conçu for mono-utilisateur with future multi-tenant architecture.
- **Platforms**: Twitter/X, Instagram, LinkedIn, Facebook, TikTok, YouTube, Threads, Pinterest
- **Functionalities**: Social account management, AI-powered content generation, post CRUD (drafts, scheduling, publishing), inbox mentions, content templates, analytics.
- **Instagram OAuth**: Real Graph API integration with automatic 60-day token exchange and single image/carousel publishing.

### SuperChat — Multi-AI Conversation Interface
- **Concept**: Send a single message, get responses from multiple AI personas in sequence: Iris → Alfred → MaxAI → Ulysse (synthesis last).
- **Features**: @Mention routing to specific AIs, reply-to context injection, session management with history persistence, Markdown rendering, Ulysse synthesis badging.

### DevOps GitHub Tools
- **analyze_repo**: Full-repo analysis command — reads all code files, extracts exports/imports/functions/classes, maps architecture, generates AI summary. Params: `path` (target folder), `depth` ('light'|'standard'|'deep'), `focus` (keyword filter). Priority command for "know this repo" requests.
- **get_file**: Auto-fallback for extensions (.js↔.ts, .jsx↔.tsx). Returns correction note when resolved.
- **browse_files**: Stack detection (TypeScript vs JavaScript), `keyFilesPerDir` showing actual file paths per directory.
- **search_code**: Hints on 0 results or errors pointing to browse_files as fallback.

### DevMax — Independent DevOps Platform
- A multi-tenant SaaS DevOps dashboard for project management with PIN-based authentication and project isolation.
- **Tenant Architecture**: Enforces project ownership via `tenant_id` or fingerprint.
- **Deployment System**: Staging/production pipeline, URL auto-generation, Cloudflare DNS automation, and CI/CD via GitHub webhooks. **Test Protocol**: Automated PRE-deploy (lint, typecheck, unit tests) and POST-deploy (PM2, HTTP, nginx, SSL, error logs) tests run before/after every staging and production deployment. Tests can also be triggered on-demand via `/run-tests-protocol` API or from DevMax/DevOps chat (`run_tests` with `command: "protocol"`).
- **Deploy Isolation**: `enforceAppIsolation()` in `deploy.ts` blocks any non-Ulysse caller from touching `/var/www/ulysse/`. DevMax projects always deploy to `/var/www/apps/<name>`. `deleteApp` also blocks deletion of protected apps (ulysse, mdbhdev, deploy-webhook). Dist backup/restore on build failure prevents broken builds from destroying production assets.
- **SPA Auto-Diagnose & Repair** (`deploy.ts`): Before and after SPA builds, automatically detects and fixes: missing entry points (main.tsx), missing vite.config.ts, missing tsconfig.json, outdated deps (React 17→18, Vite 2→5), missing peer deps, broken index.html references. Post-deploy content check detects if raw source is being served instead of built dist/ and triggers emergency rebuild.
- **LivePreviewPanel Error Handling**: Iframe preview shows loading state, detects load failures (502, X-Frame-Options blocks), displays clear error message with "Open in new tab" and "Retry" buttons instead of blank/forbidden icon.
- **DGM (Dev God Mode) V2 Enhancements** (`dgmPipelineOrchestrator.ts`): 15 actions including rollback. REPO_APP_MAP covers all repos (ulysseproject→ulysse, 007ulysse, 007ulysse-dev, horlogemax, mdbhdev). Concrete rollback via `runRollback()` (revert PR + redeploy app). Discord notifications auto on every pipeline completion/failure. Governance lastUpdated: 2026-04-07.
- **Nginx Management (Pro-level)**: Normalized configs, automatic cleanup, per-site logs, HTTP2+TLS, enhanced gzip, security headers.
- **Orphaned Apps Cleanup**: Scans and flags unused deployments.
- **Key Features**: Plan Limits Enforcement, Environment Variables UI, Client Notifications, Guided Onboarding, Stripe Billing, Custom Domains, Centralized Logs, Per-Project Metrics.
- **Security**: PIN hashing via bcrypt, webhook signature verification.
- **Scaffolding**: 9 project templates.
- **Anti-Loop Detection**: Semantic, error, and read-only loop detection.
- **Usage Tracking**: Logs project creation, deployment, and AI chat usage for analytics.
- **Deep Code Analysis Protection System**: Multi-layer protection preventing destructive code changes, including structural comparison, destructive change detection, branch protection, and Discord notifications for blocked operations.

### 3D File Management (STL/3MF)
- **Service**: Full STL/3MF parser, generator, editor, converter.
- **AI Tool**: `manage_3d_file` for create, analyze, edit, convert operations supporting primitives.
- **Analysis**: Triangle/vertex count, bounding box, dimensions, volume, surface area, mesh closure.
- **Edit operations**: Scale, translate, rotate, merge.
- **Conversion**: STL↔3MF bidirectional.

### COBA Pro — Chef Operator Business Assistant
- Standalone restaurant management chat interface using DevMax PIN authentication, specialized MaxAI Chat with a COBA System Prompt and `coba_business` AI tool for CRUD operations.

### ChatCOBA — Embeddable AI Assistant
- AI chat widget embedded via iframe, providing tenant-isolated business intelligence for restaurant owners with dedicated COBA tools and per-tenant chat history.

### DGM V2 — Dev God Mode Ultra-Performant
- Autonomous development pipeline with 14 actions, featuring parallel execution, intelligent decomposition, self-healing with feedback loops, in-memory file cache, and batch database writes.

### DevOps Intelligence Engine & 5-Axes System
- Seven custom algorithms for autonomous DevOps analysis (dependency mapping, risk scoring, patch advisories, code review) and a 5-Axes system integrating vision, execution orchestration, auto-amelioration, correlated observability, and culture.
- **Smart Sync**: Optimized GitHub push comparing SHA blob hashes, only uploading changed files to save API calls.

### DevOps Librairie-Test & Fichiers-Test
- **Librairie tab** (prod): Read-only file browser.
- **Librairie-Test tab** (staging): Full file browser supporting two staging strategies:
  1. **Branch staging**: Traditional `staging` branch in the main repo.
  2. **Test repo** (`{repo}-test`): Separate `-test` repo used as staging when no `staging` branch exists. Code lives in the test repo's default branch, then gets synced to the main repo for production via `/promote-staging`.
- **Auto-detection**: `/staging-info` endpoint detects which strategy applies. Routes `/tree/staging`, `/contents/*?ref=staging`, and `PUT /contents/*` with `branch=staging` automatically redirect to the `-test` repo when appropriate.
- **Promote staging**: `POST /promote-staging` handles both strategies — branch merge (PR staging→main) or test-repo sync (file-by-file copy from `-test` to main repo).
- **Fichiers-Test**: Available in both DevOpsMax and DevOpsIris for staging operations.

### SUGU — Restaurant Supply Management
- Daily grocery list management with categories, zones, checked items, comments, future items scheduling, and automated daily email. Weekly consolidation.
- **suguManagement backend**: Refactored from a 6,100-line monolith into 8 focused modules in `server/api/v2/suguManagement/`:
  - `shared.ts` (344L): Storage functions, constants, table init, tablesReady promise.
  - `documentParsers.ts` (748L): ParsedDocumentData/ParsedLoanData types, helpers, loan parsers, backfill functions.
  - `invoiceParsers.ts` (680L): parseDocumentPDF, splitTextByInvoices, parseMultiInvoicePDF.
  - `aiVisionParsers.ts` (313L): AI-based vision parsing (Gemini/GPT-4o).
  - `financialRoutes.ts` (604L): Purchases, expenses, bank CRUD, loans, cash register routes.
  - `hrRoutes.ts` (738L): Employees, payroll, absences routes.
  - `auditBankImportRoutes.ts` (533L): Audit overview, anomaly detection, bank PDF/CSV/text imports.
  - `filesRoutes.ts` (774L): File listing, upload, parse-preview, findOrCreateSupplier.
  - `fileOpsRoutes.ts` (257L): Download, email, delete, trash, purgeExpiredTrash.
  - `suppliersAnalyticsRoutes.ts` (446L): Suppliers CRUD, analytics/TVA.
  - `expertBackupRoutes.ts` (701L): Expert accounting reports, knowledge routes, backups, HubRise.
  - `index.ts` (86L): Pre-auth routes, auth middleware, sub-router mounting.

### Frontend Refactoring — Component Extraction
- **DevOpsMax.tsx** (5739L → 449L): Extracted 11 sub-modules in `client/src/pages/devmax/`:
  - `types.ts` (180L): Constants, helpers, context, interfaces.
  - `AuthScreens.tsx` (577L), `GitPanels.tsx` (233L), `InfraPanels.tsx` (567L), `DeployPanels.tsx` (722L), `FileBrowserPanels.tsx` (458L), `MiscPanels.tsx` (427L), `DGMPanel.tsx` (513L), `ChatPanel.tsx` (664L), `SettingsPanels.tsx` (658L), `MonitoringPanels.tsx` (399L), `ProfilePanels.tsx` (301L).
- **SuguMaillaneManagement.tsx** (4762L → 290L): Extracted 10 sub-modules in `client/src/pages/sugumaillane/`:
  - `shared.tsx` (424L): Theme context, Card, StatCard, FormModal, Field, helpers.
  - `DashboardTab.tsx` (341L), `AchatsTab.tsx` (392L), `FraisTab.tsx` (578L), `BanqueTab.tsx` (729L), `CaisseTab.tsx` (337L), `RHTab.tsx` (860L), `FournisseursTab.tsx` (355L), `AuditTab.tsx` (457L), `ArchivesTab.tsx` (238L).
- **DevOps.tsx** (6433L → 4445L): Extracted 5 sub-modules in `client/src/pages/devops/`:
  - `DevOpsChatBox.tsx` (990L), `DeploymentsPanel.tsx` (306L), `HetznerServerTab.tsx` (488L), `useDgm.ts` (119L), `PreviewTab.tsx` (378L).
- **SportsPredictions.tsx** (2157L → 1292L): Extracted `sports/types.ts` (178L), `sports/MatchComponents.tsx` (710L).
- **Commax.tsx** (1879L → 142L): Extracted 5 sub-modules in `client/src/pages/commax/`:
  - `config.ts` (44L), `ContentPanels.tsx` (674L), `AccountsPanels.tsx` (388L), `AnalyticsPanels.tsx` (322L), `IrisChat.tsx` (426L).
- **Dashboard.tsx** (2408L → 2266L): Extracted `client/src/hooks/useDashboardChat.ts` (196L) — message sending, streaming, error handling.

### Service Consolidation (Refactoring Task 2)
- **Merged services** — duplicate/related services fused into single modules with proxy re-export files for backward compatibility:
  - `marsScoring.ts` (346L): Merged `marsSourceBlacklist` + `marsResultScorer` — blacklist, quality evaluation, ML-inspired result scoring.
  - `marsAudit.ts` (437L): Merged `marsAuditContextService` + `marsAuditService` — context snapshots, query audit logging, stats.
  - `sportsContextBuilder.ts` (337L): Merged `sportsScreenContext` — screen state management + intelligent context builder.
  - `devopsIntelligenceService.ts` (557L): Merged `devopsLearningService` — intelligence reports + bug/revert/hotfix learning.
- **Barrel index files** for organized imports: `server/services/brain/index.ts`, `server/services/devops/index.ts`, `server/services/search/index.ts`.
- **Dead code removed**: `brainFacade.ts` (0 importers).

### Ulysse Chat Widget & Cross-Chatbox Sync
- **Architecture**: `UlysseChatProvider` + `UlysseChatWidget`.
- **Features**: Context-aware, auto-hide, file upload, copy/paste, download responses, streaming markdown, draggable bubble, shared conversation sync via `localStorage`.

### PDF Master Service
- Central PDF orchestration with 10 capabilities.
- **Intelligent Extraction Cascade**: Text (pdf-parse) → OCR (Tesseract.js) → Vision AI (GPT-4o / Gemini 2.0 Flash).
- **Editing**: Merge, split, extract pages, rotate, add text, watermark, compress.
- **AI Analysis**: Summarize, extract structured data, Q&A about PDF content.
- **Tool Integration**: Registered as `pdf_master` tool with 10 actions.

### Ulysse Tools V2
- Over 86 tool handlers covering data/memory, restaurant management, sports intelligence, communication/productivity, web/research, DevOps (GitHub Bridge, server actions, integrated browser), file/image/PDF processing, and utilities.

### Observability & Prometheus
- **`/metrics` endpoint**: Prometheus-compatible, exposing uptime, health, memory usage, AI request metrics, and cost data.
- **Memory leak safeguards**: ContextOptimizer cache, feedback buffer, domain adjustments, and voice pcmBuffer are capped.

### Scalability & Performance Layer
- Production-grade middleware for backpressure guards, concurrency limiting, circuit breaker registry, plan-aware tenant rate limiting, request prioritization, and health monitoring.
- Utilizes Redis for distributed rate limiting, session store, and caching.

### Job Scheduler & Autonomous Services
- 57+ scheduled jobs covering homework, cache cleanup, knowledge sync, AgentMail, geofence, SUGU daily emails, memory optimization, self-healing, proactive suggestions, website monitoring, autonomous learning, sports caches, DevMax health checks, metrics collection, SSL checks, and COBA chat history cleanup.
- **DynamicJobPrioritizer**: Calculates job priorities.
- **SelfHealingService**: Detects and auto-heals system issues.

### Infrastructure
- **Hetzner VPS**: Primary production server (Ubuntu 24.04).
- **CI/CD Pipeline — DevOpsMax 100% Autonome**: Automated deployment via GitHub webhooks, `deploy.sh` script handles git fetch, reset, npm install, build, and pm2 restart.
- **File Storage (SUGU)**: Dual-mode with Replit Object Storage (development) and local filesystem (production).
- Enables 47 server actions via SSH.
- **Port & URL Convention**: Dynamic port allocation, standardized URL structure (`{slug}.ulyssepro.org` for production / `{slug}.dev.ulyssepro.org` for staging).
- **Auth & 2FA**: Owner (Maurice) has TOTP 2FA. Owner password reset at every startup via `userBootstrap.ts`.
- **Cloudflare DNS Management**: UI panel in DevMax for DNS status, setup, proxy toggle.
- **DB Backup**: Automated daily via cron.
- **SSL**: Certbot auto-renew, Cloudflare for visitor-facing SSL.
- **Build System** (`script/build.ts`): esbuild CJS bundle with allowlist/external strategy, source maps, post-build size validation.

## External Dependencies

### AI Providers
- OpenAI (Chat, Vision, Images, TTS, STT)
- Google Gemini
- xAI (Grok)
- Perplexity

### Search & Scraping
- Serper.dev
- Brave Search
- Firecrawl
- Apify

### Communication
- Gmail
- AgentMail
- Discord
- Telegram

### Productivity
- Google Calendar
- Google Drive
- Todoist
- Notion
- GitHub

### Sports & Betting
- API-Football
- The Odds API
- FOOTDATAS
- MatchEnDirect

### Smart Home
- Tuya
- IFTTT

### Finance & Business
- Finnhub
- TwelveData
- AlphaVantage
- Spotify
- HubRise
- AppToOrder

### Infrastructure
- Hetzner VPS
- Cloudflare DNS
- Replit Object Storage
- Google Maps
- Open-Meteo
- MusicBrainz
- OSRM