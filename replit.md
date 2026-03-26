# Ulysse (DevFlow) — AI Personal Assistant System

## Overview
Ulysse is a full-stack AI personal assistant system designed to provide a unified, intelligent assistant experience across various domains including project management, restaurant automation (COBA Pro, SUGU), football/betting intelligence, and DevOps (DevMax). It operates autonomously with scheduled jobs, proactive intelligence, and self-healing capabilities, aiming to deliver a comprehensive and intelligent assistant for both personal and professional use.

## User Preferences
- Communication style: Simple, everyday French with Maurice.
- Owner: Maurice (userId=1), with family access for Iris (daughters).
- Sessions: devops, assistant, iris, iris-homework, max, voice, offline-sync contexts.

## System Architecture

### Core Stack
- **Frontend**: React 18 + TypeScript, Tailwind CSS + shadcn/ui, Framer Motion, TanStack React Query, wouter routing.
- **Backend**: Express.js on Node.js, RESTful API with Zod validation.
- **Database**: PostgreSQL via Drizzle ORM.
- **PWA**: Installable, offline-enabled with push notifications.

### AI Engine & Personas
- **Ulysse Core Engine**: Orchestrates AI providers with circuit breakers, response learning, and decision caching.
- **Action-First Orchestrator V4**: Unifies OpenAI function calling with 84 tool handlers via ActionHub.
- **Smart Model Router**: Routes tasks to providers based on complexity, token budget, and health.
- **AI Personas**: Ulysse (primary, French), Iris (daughters' assistant), Max (DevMax professional persona). All personas possess Senior Dev Engineering capabilities.
- **Anti-Hallucination System**: Employs strict rules (e.g., forcing `browse_files` before code changes), multi-source verification, and verified memory entries.
- **Anti-Read-Loop System**: Detects and corrects AI agents performing consecutive read-only operations without progressing to code modification.
- **MaxAI Prompt V3**: Senior investigation methodology (6-step: understand→hypotheses→verify→dig deep→analyze→explain), structured communication (context→diagnostic→actions→results→synthesis), and no-future-promises execution discipline. Dual prompt: client `devopsHint` (DevOpsMax.tsx) + server `personaBlock` (conversations.ts).

### DevMax — Independent DevOps Platform
- A multi-tenant SaaS DevOps dashboard for project management, accessible at `/devmax` with PIN-based authentication and project isolation.
- **Tenant Architecture (1 user = 1 tenant)**: Each `devmax_users` belongs to exactly one tenant via `tenant_id`. No `devmax_tenant_members` junction table — tenant membership is determined solely by `devmax_users.tenant_id`. Credentials are hashed with pbkdf2 (salt:hash format). Legacy plaintext credentials auto-migrate on login.
- **DevMax Platform Admin**: Manages organizations, plan tiers, billing, tenant management with role-based access, and integrations.
- **Deployment System**: Staging/production pipeline, URL auto-generation, Cloudflare DNS automation, and CI/CD via GitHub webhooks.
- **Nginx Management (Pro-level)**: Normalized lowercase config names (`normalizeNginxName`), automatic duplicate cleanup (`nginxCleanupCmd`), per-site access/error logs, HTTP2 + TLS 1.2/1.3, enhanced gzip (wasm/fonts), source file blocking (.ts/.tsx/.jsx/.map), orphan config detection, auto-build on 404 (diagnoseAndFixUrl), security headers on all blocks.
- **Orphaned Apps Cleanup**: `cleanupOrphanedApps(dryRun)` in `server/services/ssh/apps.ts` — scans `/var/www/apps/`, checks GitHub repo existence via API, flags `-placeholder` suffixes and empty dirs. Protected apps list (ulysse, mdbhdev, devmax, etc.) are never removed. Available via chat (`devops_server action=cleanup_orphans`), REST (`POST /api/devops/server/cleanup-orphans`), and UI button in Hetzner tab. Dry-run mode by default; explicit `dryRun:false` to delete.
- **Key Features**: Plan Limits Enforcement, Environment Variables UI, Client Notifications, Guided Onboarding, Stripe Billing, Custom Domains, Centralized Logs, Per-Project Metrics, and a public Landing Page.
- **Conventions**: Workflow is immutable (all modifications go to staging first), consistent naming for folders, PM2 processes, and URLs.

### COBA Pro — Chef Operator Business Assistant
- A standalone restaurant management chat interface using DevMax PIN authentication, featuring a specialized MaxAI Chat with a COBA System Prompt.
- Includes an AI tool (`coba_business`) for CRUD operations across 38 actions and multi-tenant support.

### ChatCOBA — Embeddable AI Assistant for macommande.shop Pro Clients
- An AI chat widget embedded via iframe, providing tenant-isolated business intelligence for restaurant owners.
- Uses OpenAI GPT-4o-mini with 11 dedicated COBA tools.
- Features per-tenant chat history with 7-day context injection and 30-day auto-cleanup.

### DGM V2 — Dev God Mode Ultra-Performant
- Autonomous development pipeline with 14 actions, featuring parallel execution, intelligent decomposition, self-healing with feedback loops, in-memory file cache, and batch database writes.

### DevOps Intelligence Engine & 5-Axes System
- Seven custom algorithms for autonomous DevOps analysis (dependency mapping, risk scoring, patch advisories, code review) and a 5-Axes system integrating vision, execution orchestration, auto-amelioration, correlated observability, and culture.
- **Deep Code Analysis Protection System** (`deepCodeAnalysis` in `devopsIntelligenceEngine.ts`): Multi-layer protection preventing MaxAI from making destructive code changes. Covers all write paths: `update_file`, `apply_patch`, `delete_file` — both via AI tools (`utilityTools.ts`) and REST API routes (`devopsMaxRoutes.ts`).
  - **Structural comparison**: Extracts exports, imports, functions, classes from old and new code; detects lost exports/functions.
  - **Destructive change detection**: Blocks modifications that remove >85% of file content; warns at >50%; detects stub/placeholder code (TODO patterns, comment-only files).
  - **Branch protection**: Forces modifications to a `maxai/*` branch + auto-creates PR when targeting default branch with risky changes. Fragile module deletions on default branches are fully blocked.
  - **Base64 bypass closed**: Base64 content is decoded before analysis — no bypass possible.
  - **Dynamic default branch**: Resolves actual repo default branch via GitHub API instead of hardcoded list.
  - **Discord notifications**: All blocked/redirected operations are notified on Discord with full risk analysis.

### DevOps Librairie-Test (Staging Branch)
- **Librairie tab** (prod): Read-only file browser showing the repo's default branch. No edit/upload/delete.
- **Librairie-Test tab** (staging): Full file browser on the `staging` branch. Editable by Ulysse — view, edit, commit, and create files on staging only.
- **Deploy to Prod**: Creates a PR staging → main, validates CI/CD checks (blocks on failure/pending), compares branches, then merges. Handles 422 (already in sync) gracefully.
- **Routes added**: `/api/devops/repos/:owner/:repo/commits/:sha/status`, `/api/devops/repos/:owner/:repo/compare/:basehead`.

### Fichiers-Test — Staging File Browser (DevOpsMax + DevOpsIris)
- **DevOpsMax** (`DevOpsMax.tsx`): New "Fichiers-Test" tab (`StagingFileBrowserPanel`) alongside existing "Fichiers" tab. Uses `devmaxFetch`/`devmaxApiRequest`/`devmaxQueryClient` patterns. Locked to `staging` branch — browse, edit, commit. "Déployer en Prod" button creates PR staging→main and merges. Shows loader while branches load, then "no staging" fallback if branch doesn't exist.
- **DevOpsIris** (`DevOpsIris.tsx`): "Fichiers-Test" button on each project card (visible when `githubRepo` is set). Opens dialog with `IrisStagingBrowser` component using standard `fetch`/`queryClient` against `/api/devops/repos/:owner/:repo/*` routes. Same staging workflow: browse, edit, commit, deploy-to-prod via PR+merge.

### SUGU — Restaurant Supply Management
- **Suguval** and **Sugumaillane**: Daily grocery list management with categories, zones, checked items, comments, future items scheduling, and automated daily email at 23:59. Weekly consolidation on Sunday.

### Ulysse Chat Widget & Cross-Chatbox Sync
- **Architecture**: `UlysseChatProvider` (React Context in App.tsx) + `UlysseChatWidget` (floating component).
- **Context Awareness**: Each page sends its context (name, description) with messages so Ulysse/Iris knows where Maurice is and adapts instantly.
- **Auto-hide**: Widget hidden on pages with dedicated chat (Dashboard, TalkingApp, DevOps, SuguVal, SuguMaillane, Assistant, Iris Dashboard, TalkingIris).
- **Capabilities**: File upload (drag/drop, paste images), copy/paste text, download responses, streaming markdown, draggable bubble.
- **Persona**: Ulysse for owner, Iris for approved family.
- **Shared Conversation Sync**: All chatboxes share the same active conversation via localStorage key `ulysse-active-conversation` and a `ulysse:chat-sync` CustomEvent bus. Dashboard, Widget, and SuguChatWidget use the same v1 API (`/api/conversations/:id/messages`). SuguChatWidget injects restaurant context as a message prefix. DevOps keeps the v2 API (for specialized tool routing — GitHub, deploy, forceTools) but emits sync events so other chatboxes are notified.
- **Exported Sync Utilities**: `emitChatSync(convId, source)`, `getSharedConversationId()`, `setSharedConversationId(id)` from `UlysseChatContext.tsx`.
- **Files**: `client/src/contexts/UlysseChatContext.tsx`, `client/src/components/UlysseChatWidget.tsx`, `client/src/components/sugu/SuguChatWidget.tsx`.

### PDF Master Service
- **`server/services/pdfMasterService.ts`**: Central PDF orchestration service with 10 capabilities.
- **Intelligent Extraction Cascade**: Text (pdf-parse) → OCR (Tesseract.js) → Vision AI (GPT-4o / Gemini 2.0 Flash). Never fails on scanned PDFs.
- **Editing**: Merge, split, extract pages, rotate, add text, watermark, compress — all via `pdf-lib`.
- **AI Analysis**: Summarize, extract structured data, Q&A about any PDF content — with OpenAI + Gemini fallback.
- **Tool Integration**: Registered as `pdf_master` tool in `ulysseToolsServiceV2.ts` with 10 actions.
- **FileService Integration**: `fileService.readPDF()` now delegates to PDFMaster when pdf-parse returns empty text (scanned PDFs).

### Ulysse Tools V2
- Over 86 tool handlers covering data/memory, restaurant management (SUGU), sports intelligence (Djedou Pronos), communication/productivity, web/research (MARS V2), DevOps (GitHub Bridge, server actions, integrated browser), file/image/PDF processing, and utilities.

### Scalability & Performance Layer
- Production-grade middleware providing backpressure guards, concurrency limiting, circuit breaker registry, plan-aware tenant rate limiting, request prioritization, and health monitoring.
- Utilizes Redis for distributed rate limiting, session store, and caching.
- Includes a Worker Manager and Domain Isolation system for Ulysse AI, SUGU Restaurant, DevMax SaaS, and AppToOrder.
- Memory pressure monitoring for heap usage.

### Job Scheduler & Autonomous Services
- 57+ scheduled jobs covering homework, cache cleanup, knowledge sync, AgentMail, geofence, SUGU daily emails, memory optimization, self-healing, proactive suggestions, website monitoring, autonomous learning, sports caches, DevMax health checks, metrics collection, SSL checks, and COBA chat history cleanup.
- **DynamicJobPrioritizer**: Calculates job priorities based on time of day, user activity, and pending tasks.
- **SelfHealingService**: Detects and auto-heals system issues (circuit breakers, high failure rates, unavailable capabilities, DB connection).
- Concurrency limit of 4 simultaneous jobs.

### Infrastructure
- **Hetzner VPS**: Primary production server (Ubuntu 24.04, 16 CPU, 61 GB RAM, 437 GB disk). App runs at `/var/www/ulysse` via PM2.
- **LIGHT_MODE**: MUST remain `false` on Hetzner. Was `true` on Replit to save memory but disables 55+ scheduled jobs, Footdatas, AgentMail, and Discord Bot. Hetzner has 61 GB RAM — no need for it.
- **PM2 Startup**: Use `set -a && source .env && set +a && pm2 start ecosystem.config.cjs --update-env`. The `source .env` is required because PM2's `env_file` alone doesn't propagate all env vars correctly. JSON values in `.env` must use base64 encoding (e.g., `TALKING_PINS_B64`) since bash `source` strips double quotes.
- **CI/CD Pipeline**: Replit → GitHub (`ulyssemdbh-commits/ulysseproject`) → Webhook on Hetzner for auto-deployment.
- **File Storage (SUGU)**: Dual-mode with Replit Object Storage (development) and local filesystem `/opt/ulysse/storage` (production).
- Enables 47 server actions via SSH for deployment, updates, and environment management.
- **Port & URL Convention**: Dynamic port allocation and standardized URL structure (`{slug}.ulyssepro.org` for production / `{slug}.dev.ulyssepro.org` for staging) with Cloudflare proxy SSL.
- **Auth & 2FA**: Owner (Maurice) has TOTP 2FA. The `requireAuth` middleware exempts `/2fa/*`, auth routes, `/files/upload`, `/media/upload`, `/ui-snapshots`, and `/keep-alive` from 2FA enforcement (exact path matching, no substring). `userBootstrap.ts` HARDCODES `OWNER_PASSWORD_HASH` and resets the owner password at EVERY startup — never change the password in DB without updating this constant. Gmail 2FA delivery requires valid Google Mail OAuth token; if expired, falls back to Discord.
- **Cloudflare DNS Management**: Full UI panel in DevMax for DNS status, setup, proxy toggle per environment. API routes: `dns-status`, `dns-setup`, `dns-toggle-proxy`, `dns-records` (DELETE).
- **DB Backup**: Automated daily at 03:00 via cron (`/usr/local/bin/backup-ulysse-db.sh`), 14-day retention, stored in `/var/backups/postgresql/`.
- **SSL**: Certbot auto-renew (2x daily via systemd timer). Cloudflare handles visitor-facing SSL (Full mode) for production domains. Staging domains (`*.dev.ulyssepro.org`) use a Let's Encrypt wildcard certificate via `certbot-dns-cloudflare` plugin (auto-renewing). Certificate path: `/etc/letsencrypt/live/dev.ulyssepro.org/`. The `sslCertForDomain()` helper in `server/services/ssh/helpers.ts` automatically selects the correct certificate based on domain.
- **Known Pending Issues**: Google Drive OAuth token expired (needs re-auth), Google Mail token expired (2FA falls back to Discord), AgentMail inbox limit exceeded (plan limit).

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