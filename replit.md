# Ulysse (DevFlow) — AI Personal Assistant System

## Overview
Ulysse is a full-stack AI personal assistant system designed to provide a unified, intelligent assistant experience across various domains including project management (DevMax), restaurant automation (COBA Pro, SUGU), football/betting intelligence, and DevOps. It operates autonomously with scheduled jobs, proactive intelligence, and self-healing capabilities, aiming to deliver a comprehensive and intelligent assistant for both personal and professional use. The system is envisioned to be a comprehensive and intelligent assistant for both personal and professional use, capable of managing complex tasks and providing intelligent insights.

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
- **Action-First Orchestrator V4**: Unifies OpenAI function calling with 90 tool handlers via ActionHub.
- **Smart Model Router**: Routes tasks to providers based on complexity, token budget, and health.
- **AI Personas**: Four AIs with unified identity system: Ulysse (primary, full-stack assistant), Iris (family + community management), Alfred (restaurant operations), and MaxAI (DevOps + infrastructure). Each AI has self-awareness and collaboration rules.
- **Anti-Hallucination System**: Employs strict rules, multi-source verification, and verified memory entries.
- **Anti-Read-Loop System**: Detects and corrects AI agents performing consecutive read-only operations without progression.

### File Management & Deployment
- **DB-First File Architecture**: All test/staging files are stored in `devmax_files` table, enabling deployments directly from the database (via `deployFromDbFiles()`) without requiring a staging GitHub repo.
- **Local Test Preview**: Allows direct serving of test files from the DB for local preview.
- **Commax**: Full community management platform for mono-user with multi-tenant architecture support, including AI-powered content generation and Instagram OAuth.
- **SuperChat**: Multi-AI conversation interface routing messages to specific AI personas (Iris → Alfred → MaxAI → Ulysse).

### DevOps Platform (DevMax)
- A multi-tenant SaaS DevOps dashboard for project management with PIN-based authentication and project isolation.
- **Deployment System**: Staging/production pipeline with automated URL generation, Cloudflare DNS automation, and CI/CD via GitHub webhooks. Includes automated PRE-deploy and POST-deploy tests.
- **Deploy Isolation**: Enforces application isolation, protecting core Ulysse deployments.
- **SPA Auto-Diagnose & Repair**: Automatically detects and fixes common issues in SPA builds (e.g., missing entry points, outdated dependencies).
- **DGM (Dev God Mode) V2**: Autonomous development pipeline with 15 actions, including rollback capabilities, and Discord notifications.
- **Nginx Management**: Pro-level configuration, cleanup, logging, and security.
- **Orphaned Apps Cleanup**: Scans and flags unused deployments.
- **Security**: PIN hashing via bcrypt, webhook signature verification.
- **Scaffolding**: 9 project templates.
- **Anti-Loop Detection**: Semantic, error, and read-only loop detection.
- **Deep Code Analysis Protection System**: Multi-layer protection preventing destructive code changes.

### 3D File Management
- **Service**: Full STL/3MF parser, generator, editor, converter with AI tool `manage_3d_file` for analysis and editing.

### COBA Pro & ChatCOBA
- **COBA Pro**: Standalone restaurant management chat interface using DevMax PIN authentication, specialized MaxAI Chat with a COBA System Prompt and `coba_business` AI tool for CRUD operations.
- **ChatCOBA**: Embeddable AI chat widget providing tenant-isolated business intelligence for restaurant owners.

### DevOps Intelligence & 5-Axes System
- Seven custom algorithms for autonomous DevOps analysis (dependency mapping, risk scoring, patch advisories, code review) and a 5-Axes system integrating vision, execution orchestration, auto-amelioration, correlated observability, and culture.
- **Smart Sync**: Optimized GitHub push comparing SHA blob hashes, only uploading changed files to save API calls.

### DevOps Librairie-Test & Fichiers-Test
- **Librairie tab** (prod): Read-only file browser.
- **Librairie-Test tab** (staging): Full file browser supporting two staging strategies (branch staging or test repo) with auto-detection and promotion capabilities.
- **Fichiers-Test**: Available in both DevOpsMax and DevOpsIris for staging operations.

### SUGU — Restaurant Supply Management
- Daily grocery list management with categories, zones, checked items, comments, future items scheduling, and automated daily email. The `suguManagement` backend has been refactored into focused modules for document parsing, financial routes, HR, audit, file operations, suppliers, and expert backups.
- **Mobile Responsive**: Full mobile-first responsive design across all Suguval tabs (Dashboard, Achats, Caisse, Banque, Frais, Gestion RH). Paginations stack vertically (`flex-col sm:flex-row`), filter grids use `grid-cols-2` base, FormModal slides up as bottom-sheet on mobile, stat cards adapt to 2-col on small screens.

### Frontend & Service Refactoring
- Significant refactoring of `DevOpsMax.tsx`, `SuguMaillaneManagement.tsx`, `DevOps.tsx`, `SportsPredictions.tsx`, `Commax.tsx`, and `Dashboard.tsx` into smaller, manageable sub-modules and components.
- Consolidated duplicate or related backend services into single modules with proxy re-export files for backward compatibility.

### Ulysse Chat Widget & Cross-Chatbox Sync
- **Architecture**: `UlysseChatProvider` + `UlysseChatWidget`.
- **Features**: Context-aware, auto-hide, file upload, copy/paste, download responses, streaming markdown, draggable bubble, shared conversation sync via `localStorage`.

### PDF Master Service
- Central PDF orchestration with intelligent extraction (text, OCR, Vision AI), editing (merge, split, extract, rotate, add text, watermark, compress), and AI analysis (summarize, structured data, Q&A). Registered as `pdf_master` tool with 10 actions.

### Ulysse Tools V2
- Over 86 tool handlers covering data/memory, restaurant management, sports intelligence, communication/productivity, web/research, DevOps (GitHub Bridge, server actions, integrated browser), file/image/PDF processing, and utilities.

### Observability & Prometheus
- **`/metrics` endpoint**: Prometheus-compatible, exposing uptime, health, memory usage, AI request metrics, and cost data.
- **Memory leak safeguards**: Capped caches, feedback buffers, and voice pcmBuffer.

### Scalability & Performance
- Production-grade middleware for backpressure guards, concurrency limiting, circuit breaker registry, plan-aware tenant rate limiting, request prioritization, and health monitoring.
- Utilizes Redis for distributed rate limiting, session store, and caching.

### Job Scheduler & Autonomous Services
- 57+ scheduled jobs covering various domains like homework, cache cleanup, knowledge sync, daily emails, memory optimization, self-healing, proactive suggestions, and health checks.
- **DynamicJobPrioritizer**: Calculates job priorities.
- **SelfHealingService**: Detects and auto-heals system issues.

### Infrastructure
- **Hetzner VPS**: Primary production server (Ubuntu 24.04).
- **CI/CD Pipeline**: Automated deployment via GitHub webhooks (`deploy.sh` script).
- **File Storage (SUGU)**: Dual-mode with Replit Object Storage (development) and local filesystem (production).
- Enables 47 server actions via SSH.
- **Port & URL Convention**: Dynamic port allocation, standardized URL structure (`{slug}.ulyssepro.org` for production / `{slug}.dev.ulyssepro.org` for staging).
- **Auth & 2FA**: Owner (Maurice) has TOTP 2FA.
- **Cloudflare DNS Management**: UI panel in DevMax for DNS status, setup, proxy toggle.
- **DB Backup**: Automated daily via cron.
- **SSL**: Certbot auto-renew, Cloudflare for visitor-facing SSL.
- **Build System** (`script/build.ts`): esbuild CJS bundle.

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