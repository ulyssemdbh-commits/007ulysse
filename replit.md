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
- **Database**: PostgreSQL via Drizzle ORM.
- **PWA**: Installable, offline-enabled with push notifications.

### AI Engine & Personas
- **Ulysse Core Engine**: Orchestrates AI providers with circuit breakers, response learning, and decision caching.
- **Action-First Orchestrator V4**: Unifies OpenAI function calling with 84 tool handlers via ActionHub.
- **Smart Model Router**: Routes tasks to providers based on complexity, token budget, and health.
- **AI Personas**: Ulysse (primary, French), Iris (daughters' assistant), Max (DevMax professional persona), Alfred (tech/dev advisor). All personas possess Senior Dev Engineering capabilities.

### Commax — Community Management
- **Route**: `/commax` (frontend), `/api/commax` (backend)
- **Purpose**: Full community management platform propulsé par Ulysse. Conçu pour une utilisation mono-utilisateur avec architecture multi-tenant future.
- **Plateformes**: Twitter/X, Instagram, LinkedIn, Facebook, TikTok, YouTube, Threads, Pinterest
- **Fonctionnalités**:
  - Gestion des comptes sociaux (connexion, statut, followers)
  - Composer avec IA : génération de contenu via OpenAI GPT-4o-mini, variations par plateforme, hashtags, ton personnalisable
  - Posts CRUD : brouillons, planification, publication (simulée, prête pour OAuth réel)
  - Inbox mentions : affichage, marquage lu, réponse manuelle ou générée par IA
  - Templates de contenu réutilisables
  - Analytics : stats par plateforme, comptes, posts publiés
- **Tables DB**: `commax_accounts`, `commax_posts`, `commax_mentions`, `commax_templates`, `commax_analytics`
- **Accès Ulysse**: Full read/write via `/api/commax/*` (protégé par auth)
- **Instagram OAuth (LIVE)**: Real Graph API integration — token validation, automatic exchange to 60-day long-lived tokens (requires `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET`), single image + carousel publishing via `publishToInstagram()`. Frontend: `InstagramConnectDialog` with 4-step guide in AccountsManager.
- **Other Platforms OAuth**: Architecture ready — activate by configuring tokens in env vars (TWITTER_API_KEY, etc.)

### SuperChat — Multi-AI Conversation Interface
- **Route**: `/superchat` (frontend), `/api/superchat` (backend)
- **Concept**: Send a single message, get responses from multiple AI personas in sequence: Iris → Alfred → MaxAI → Ulysse (synthesis last, analyzes all other responses).
- **@Mention Routing**: Use `@iris`, `@alfred`, `@maxai`, or `@ulysse` in messages to route to specific AI(s) only.
- **Reply-To**: Reply to a specific AI message, which injects that message as context.
- **Session Management**: Create, rename, delete sessions with full history persistence.
- **Rendering**: Markdown rendering via `react-markdown` + `remark-gfm`. Ulysse synthesis messages marked with 👑 SYNTHÈSE badge.
- **Files**: `server/routes/superChatRoutes.ts`, `client/src/pages/SuperChat.tsx`, `shared/schema.ts` (tables: `superChatSessions`, `superChatMessages`).
- **Anti-Hallucination System**: Employs strict rules (e.g., forcing `browse_files` before code changes), multi-source verification, and verified memory entries.
- **Anti-Read-Loop System**: Detects and corrects AI agents performing consecutive read-only operations without progressing to code modification.
- **MaxAI Prompt V3**: Senior investigation methodology (6-step: understand→hypotheses→verify→dig deep→analyze→explain), structured communication, and no-future-promises execution discipline.

### DevMax — Independent DevOps Platform
- A multi-tenant SaaS DevOps dashboard for project management, accessible at `/devmax` with PIN-based authentication and project isolation.
- **Tenant Architecture**: Each `devmax_users` belongs to exactly one tenant via `tenant_id`. Multi-tenant security enforced: GET/PUT/DELETE routes verify ownership by tenant_id or fingerprint.
- **DevMax Platform Admin**: Manages organizations, plan tiers, billing, tenant management with role-based access, and integrations.
- **Deployment System**: Staging/production pipeline, URL auto-generation, Cloudflare DNS automation, and CI/CD via GitHub webhooks.
- **Nginx Management (Pro-level)**: Normalized lowercase config names, automatic duplicate cleanup, per-site access/error logs, HTTP2 + TLS, enhanced gzip, source file blocking, orphan config detection, auto-build on 404, security headers.
- **Orphaned Apps Cleanup**: Scans `/var/www/apps/`, checks GitHub repo existence, flags placeholder suffixes and empty dirs. Protected apps are never removed.
- **Key Features**: Plan Limits Enforcement, Environment Variables UI, Client Notifications, Guided Onboarding, Stripe Billing, Custom Domains, Centralized Logs, Per-Project Metrics, and a public Landing Page.
- **Conventions**: Workflow is immutable (all modifications go to staging first), consistent naming for folders, PM2 processes, and URLs.
- **Security**: PIN hashing via bcrypt (auto-migrates legacy SHA-256 hashes), webhook signature verification mandatory when secret configured, structured error handling in create_repo/scaffold_project.
- **Scaffolding**: 9 templates — express-api, react-vite, fullstack, nextjs, static-site, nestjs-prisma, fastapi, nestjs-fullstack, laravel. Handles existing repos gracefully.
- **Anti-Loop Detection**: Semantic loop detection (same tool+args), error loop detection (3 consecutive failures), read-only loop nudging.
- **Usage Tracking**: `devmax_usage_logs` table populated on project creation, deployment, and AI chat usage for tenant-level analytics.
- **Quota Enforcement**: Plan limits checked on project creation, deployment, user invitation, custom domains, and API access via `checkPlanLimits()`.

### 3D File Management (STL/3MF)
- **Service**: `server/services/stl3mfService.ts` — Full STL/3MF parser, generator, editor, converter.
- **AI Tool**: `manage_3d_file` — Actions: create, analyze, edit, convert. Supports box, sphere, cylinder, pyramid, torus primitives.
- **API Routes** (in `fileRoutes.ts`): `/files/generate/stl`, `/files/generate/3mf`, `/files/analyze-3d`, `/files/convert-3d`, `/files/edit-stl`.
- **Analysis**: Triangle count, vertex count, bounding box, dimensions, volume, surface area, mesh closure detection, center of mass.
- **Edit operations**: Scale, translate, rotate, merge.
- **Conversion**: STL↔3MF bidirectional.
- **Upload**: `.stl` and `.3mf` accepted in file upload filter.

### COBA Pro — Chef Operator Business Assistant
- A standalone restaurant management chat interface using DevMax PIN authentication, featuring a specialized MaxAI Chat with a COBA System Prompt. Includes an AI tool (`coba_business`) for CRUD operations and multi-tenant support.

### ChatCOBA — Embeddable AI Assistant for macommande.shop Pro Clients
- An AI chat widget embedded via iframe, providing tenant-isolated business intelligence for restaurant owners.
- Uses OpenAI GPT-4o-mini with 11 dedicated COBA tools. Features per-tenant chat history with 7-day context injection and 30-day auto-cleanup.

### DGM V2 — Dev God Mode Ultra-Performant
- Autonomous development pipeline with 14 actions, featuring parallel execution, intelligent decomposition, self-healing with feedback loops, in-memory file cache, and batch database writes.

### DevOps Intelligence Engine & 5-Axes System
- Seven custom algorithms for autonomous DevOps analysis (dependency mapping, risk scoring, patch advisories, code review) and a 5-Axes system integrating vision, execution orchestration, auto-amelioration, correlated observability, and culture.
- **Deep Code Analysis Protection System**: Multi-layer protection preventing MaxAI from making destructive code changes. Covers all write paths: `update_file`, `apply_patch`, `delete_file`.
  - **Structural comparison**: Extracts exports, imports, functions, classes from old and new code; detects lost exports/functions.
  - **Destructive change detection**: Blocks modifications that remove >85% of file content; warns at >50%; detects stub/placeholder code.
  - **Branch protection**: Forces modifications to a `maxai/*` branch + auto-creates PR when targeting default branch with risky changes.
  - **Base64 bypass closed**: Base64 content is decoded before analysis.
  - **Dynamic default branch**: Resolves actual repo default branch via GitHub API.
  - **Discord notifications**: All blocked/redirected operations are notified on Discord with full risk analysis.

### DevOps Librairie-Test (Staging Branch) & Fichiers-Test
- **Librairie tab** (prod): Read-only file browser.
- **Librairie-Test tab** (staging): Full file browser on the `staging` branch. Editable by Ulysse — view, edit, commit, and create files.
- **Deploy to Prod**: Creates a PR staging → main, validates CI/CD checks, compares branches, then merges.
- **Fichiers-Test**: Available in both DevOpsMax and DevOpsIris for staging branch operations (browse, edit, commit, deploy-to-prod via PR+merge).

### SUGU — Restaurant Supply Management
- **Suguval** and **Sugumaillane**: Daily grocery list management with categories, zones, checked items, comments, future items scheduling, and automated daily email. Weekly consolidation.

### Ulysse Chat Widget & Cross-Chatbox Sync
- **Architecture**: `UlysseChatProvider` (React Context) + `UlysseChatWidget` (floating component).
- **Context Awareness**: Each page sends its context (name, description) with messages.
- **Auto-hide**: Widget hidden on pages with dedicated chat.
- **Capabilities**: File upload, copy/paste text, download responses, streaming markdown, draggable bubble.
- **Persona**: Ulysse for owner, Iris for approved family.
- **Shared Conversation Sync**: All chatboxes share the same active conversation via `localStorage` and a `ulysse:chat-sync` CustomEvent bus.

### PDF Master Service
- Central PDF orchestration service with 10 capabilities.
- **Intelligent Extraction Cascade**: Text (pdf-parse) → OCR (Tesseract.js) → Vision AI (GPT-4o / Gemini 2.0 Flash).
- **Editing**: Merge, split, extract pages, rotate, add text, watermark, compress via `pdf-lib`.
- **AI Analysis**: Summarize, extract structured data, Q&A about any PDF content.
- **Tool Integration**: Registered as `pdf_master` tool with 10 actions.

### Ulysse Tools V2
- Over 86 tool handlers covering data/memory, restaurant management (SUGU), sports intelligence (Djedou Pronos), communication/productivity, web/research (MARS V2), DevOps (GitHub Bridge, server actions, integrated browser), file/image/PDF processing, and utilities.

### Observability & Prometheus
- **`/metrics` endpoint**: Prometheus-compatible text format, scrapable by any Prometheus instance.
- Exposes: `ulysse_uptime_seconds`, `ulysse_health_status`, `process_resident_memory_bytes`, `process_heap_used_bytes`, `ulysse_ai_requests_total`, `ulysse_ai_latency_avg_ms`, `ulysse_ai_tokens_total{direction}`, `ulysse_ai_errors_total`, `ulysse_ai_provider_requests_total{provider}`, `ulysse_preload_total`, `ulysse_cache_operations_total{result}`, `ulysse_api_error_rate`, `ulysse_job_success_rate`, `ulysse_ai_cost_usd_24h`.
- **Memory leak safeguards**: ContextOptimizer cache capped at 500 entries with 60s eviction timer, feedback buffer capped at 100, domain adjustments at 50. Voice pcmBuffer capped at 50MB with oldest-chunk trimming.

### Scalability & Performance Layer
- Production-grade middleware providing backpressure guards, concurrency limiting, circuit breaker registry, plan-aware tenant rate limiting, request prioritization, and health monitoring.
- Utilizes Redis for distributed rate limiting, session store, and caching.
- Includes a Worker Manager and Domain Isolation system.
- Memory pressure monitoring for heap usage.

### Job Scheduler & Autonomous Services
- 57+ scheduled jobs covering homework, cache cleanup, knowledge sync, AgentMail, geofence, SUGU daily emails, memory optimization, self-healing, proactive suggestions, website monitoring, autonomous learning, sports caches, DevMax health checks, metrics collection, SSL checks, and COBA chat history cleanup.
- **DynamicJobPrioritizer**: Calculates job priorities based on time of day, user activity, and pending tasks.
- **SelfHealingService**: Detects and auto-heals system issues.
- Concurrency limit of 4 simultaneous jobs.

### Infrastructure
- **Hetzner VPS**: Primary production server (Ubuntu 24.04). App runs at `/var/www/ulysse` via PM2 (id 164, port 5000).
- **CI/CD Pipeline — DevOpsMax 100% Autonome**:
  1. `scripts/github_push_api.ts` — Full project push (775 files) via Git Trees API with chunked progress tracking (200 files/run, resume from checkpoint). Targets both `007ulysse` and `ulysseproject` repos.
  2. GitHub webhooks on both repos → `https://ulyssepro.org/webhook/deploy` → nginx → port 9000 → `webhook-server.cjs` (PM2 id 30) → `/opt/ulysse/deploy.sh`
  3. `deploy.sh` (fully autonomous, no Replit needed): `git fetch 007ulysse main` → `git reset --hard` → `npm ci --include=dev` → `npm i pdfkit fontkit restructure` → `NODE_OPTIONS=--max-old-space-size=3072 npx tsx script/build.ts` → `pm2 restart ulysse` → health check HTTP 200
  4. Deploy script also at `scripts/hetzner_deploy.sh` (synced to GitHub)
- **File Storage (SUGU)**: Dual-mode with Replit Object Storage (development) and local filesystem (production).
- Enables 47 server actions via SSH.
- **Port & URL Convention**: Dynamic port allocation with PostgreSQL advisory lock (race-condition safe) and standardized URL structure (`{slug}.ulyssepro.org` for production / `{slug}.dev.ulyssepro.org` for staging) with Cloudflare proxy SSL.
- **Auth & 2FA**: Owner (Maurice) has TOTP 2FA. `userBootstrap.ts` HARDCODES `OWNER_PASSWORD_HASH` and resets the owner password at EVERY startup.
- **Cloudflare DNS Management**: Full UI panel in DevMax for DNS status, setup, proxy toggle per environment.
- **DB Backup**: Automated daily via cron, 14-day retention.
- **SSL**: Certbot auto-renew. Cloudflare handles visitor-facing SSL for production domains. Staging domains use Let's Encrypt wildcard certificate.
- **Build System** (`script/build.ts`): esbuild CJS bundle with allowlist/external strategy. Source maps enabled, `target: node18`, `minifyIdentifiers: false` (readable stack traces), post-build size validation (500KB–20MB), `metafile` bundle analysis, `dist/build-manifest.json` output. `googleapis` MUST stay external (breaks DefaultTransporter when bundled). `pdfkit`/`fontkit`/`restructure` in alwaysExternal (need manual install on Hetzner after `npm install`).

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