# Ulysse (DevFlow) — AI Personal Assistant System

## Overview
Ulysse est un assistant IA full-stack multi-personas (Ulysse, Iris, Alfred, MaxAI) couvrant : project management (DevMax), restauration (COBA Pro, SUGU Valentine + Maillane), football/paris, DevOps Hetzner, communauté (Commax). Fonctionne de manière autonome avec jobs planifiés, intelligence proactive et auto-healing.

## User Preferences
- Communication : Français simple avec Maurice.
- Owner : Maurice (userId=1), accès famille pour Iris (filles).
- Sessions : devops, assistant, iris, iris-homework, max, voice, offline-sync.

## Codebase Reality (audit Apr 2026)
- **~352 000 lignes TypeScript** (server + client + shared).
- **266 services** dans `server/services/`.
- **70 fichiers de routes** dans `server/routes/`.
- **18 schémas Drizzle** dans `shared/schema/`.
- **45-50 jobs schedulés** (concurrency limit : 6 → 35-41 deferred/tick).
- Voir `docs/OPERATIONS.md` pour les commandes opérationnelles.

## System Architecture

### Core Stack
- **Frontend** : React 18 + TS, Tailwind + shadcn/ui, Framer Motion, TanStack React Query, wouter.
- **Backend** : Express.js, REST + Zod, PostgreSQL via Drizzle.
- **PWA** : installable, offline, push notifications VAPID.
- **Build** : `script/build.ts` (esbuild CJS, externals : bcrypt, sharp, playwright). Vérifie taille bundle 0.5-20 MB.

### Architecture Cerveau (Sensory + BrainHub)
Modèle "conscience centralisée" inspiré OpenJarvis :
- **BrainHub** (`server/services/sensory/BrainHub.ts`, 1076 lignes) : ConsciousnessState (focus, charge cognitive 0-100, working memory), attention engine avec defer queue si charge >70.
- **HearingHub** : web_voice, discord_voice, web_chat, siri, email, sms → intent + reference resolution + sentiment + PUGI enrichment.
- **VisionHub** : screen_monitor, scrape, screenshots, OCR, camera.
- **ActionHub** : exécute toutes les actions (90+ tool executors enregistrés via ulysseToolsV2). ⚠️ Pas de `max_depth` hard-codé — limitation par prompt seulement.
- **VoiceOutputHub** : TTS, dialogue mode, channel priority, voice mapping persona.
- **9 sous-cerveaux domaines** (`UlysseDomainBrain`) : sports, sugu, dev, personal, generic, finance, monitoring, email, studio.
- **Bridges** : ActionHubBridge / HearingHubBridge / VisionHubBridge / VoiceOutputHubBridge connectent les hubs aux services existants.
- **API** : `server/api/v2/sensory.ts` (12 endpoints).

### Pipeline Conversationnel (chemin réel)
1. `HearingHub.hear()` → normalisation
2. `BrainHub` capte `input_received`, focus = listening
3. `CoreConversationIntegration.analyzeQuery()` (`server/services/core/CoreConversationIntegration.ts`) :
   - Patterns simples → réponse directe
   - `UlysseCoreEngine` cache/pattern hit
4. `UnifiedRAGService` enrichit le contexte
5. `smartModelRouter` choisit modèle (gpt-4o pour code/finance, gemini pour vitesse, grok pour sport)
6. Si tools : `toolOrchestrator.executeParallel()` → ActionHub
7. `ulysseCoreEngine.callProvider()` → AI
8. `enhancedSelfCritiqueService` valide
9. `memoryGraphService.reinforce()` Hebbian (+0.5 / −0.4 / −0.6)
10. `VoiceOutputHub` ou retour API

### AI Engine & Personas
- **UlysseCoreEngine** (`server/services/core/UlysseCoreEngine.ts`) : orchestre OpenAI/Gemini/Grok/Perplexity, cache, circuit breakers (closed/open/half-open, cooldown 60-300s), response learning, decision caching.
- **openaiClient.ts** : instances centralisées + `wrapWithCircuitBreaker`.
- **Smart Model Router** : routage par complexité, domaine, perf history.
- **Action-First Orchestrator V4** : OpenAI function calling unifié avec ActionHub.
- **Personas** (`server/config/personaMapping.ts`) : Ulysse, Iris, Alfred, MaxAI — identité unifiée, self-awareness, règles de collaboration.
- **Anti-Hallucination** : `enhancedSelfCritique.ts` calcule confidence. Si < `minConfidence` (ex 85% emails, 80% sports) → blocage/nuance. Critères : absence d'utilisation outils, données >1h, langage trop affirmatif.
- **Anti-Read-Loop** : `ulysseBehaviorRules.ts` interdit boucles outil-même-params, scraper limite via `Set<URL>` + maxPages.
- **Cost tracking** : `metricsService.ts` persiste dans `devmax_ai_costs`. ⚠️ Pas de hard-stop budget.

### Couches d'apprentissage (chaînées dans CoreConversationIntegration)
1. **traceCollector.ts** : enregistre chaque interaction (steps, tools, latency, tokens).
2. **cumulativeLearningEngine.ts** : succès/échec par tâche + efficacité outils, mémoire d'erreurs partagée 4 agents.
3. **memoryGraphService.ts** : graphe mémoire (`memory_connections`), Hebbian reinforcement, autoConnect via embeddings cosine ≥ 0.72.
4. **embeddingHelper.ts** : OpenAI text-embedding-3-small 384 dim, cache LRU 2000 + dédup in-flight, stocké dans `ulysse_memory.metadata.embedding`.
5. **enhancedSelfCritique.ts** : critique post-réponse avec seuils tunables par domaine.
6. **autonomousLearningV2.ts** : 5 couches L1-L5 + decay.
7. **autonomousInitiativeEngine.ts** : 3 niveaux (observe/propose/act).
8. **metaLearningService.ts** : tick 60min recursive setTimeout (guard anti-overlap), auto-tune `embeddingThreshold`, `hebbianLearningRate`, `dgmRiskGatingThreshold`, seuils critique. Persiste dans `ulysse_memory` cat=meta_param userId=0.

### DGM Pipeline (`server/services/dgmPipelineOrchestrator.ts`, 1625 lignes)
Auto-développement / déploiement / healing.
- **Gouvernance** : règle d'or "ne rien casser", seuil auto-merge à 85% (mutable via metaLearning).
- **Auto-Code** : `decomposeObjective()` transforme objectif → tâches structurées JSON.
- **Auto-Heal** : `ensureProjectStructure()` répare package.json, workflows CI manquants.
- **Pipeline** : impact_analysis → dev_patch → quality_check → pr_creation → ci_monitor → merge_deploy.
- **Safety** : `waitForCI()` bloque merge si tests rouges (timeout 180s), rollback ×3.
- **REPO_APP_MAP** : `ulysseproject → ulysse` (et alias HorlogeMax, mdbhdev).

### File Management & Deployment
- **DB-First** : `devmax_files` table → `deployFromDbFiles()` sans staging GitHub.
- **Local Test Preview** : serve direct depuis DB.
- **Commax** : community management mono-user multi-tenant, AI content generation, Instagram OAuth.
- **SuperChat** : interface multi-AI routant vers persona.

### DevOps Platform (DevMax)
SaaS multi-tenant, PIN auth, isolation projet.
- **Architecture modulaire** (`server/routes/devmax/`) : gitRoutes, pullRoutes, deployRoutes, cicdRoutes, dgmRoutes, infraRoutes, billingRoutes, secretsRoutes + auth/projectCrud/githubOAuth/chatJournal/admin. Index `opsIndex.ts` + `authIndex.ts`. Helpers `opsHelpers.ts` (getProjectRepo, withRepoToken).
- **Services** (`server/services/devmax/`) : tokenService (validation/résolution), testService (preflight, pre/post-deploy, health), cryptoService (AES-256-CBC, salt+IV par entrée, prefix `enc:`).
- **Deployment** : staging/prod, URL auto, Cloudflare DNS auto, CI/CD via GitHub webhooks. Tests PRE/POST automatisés.
- **Deploy Isolation** : protège core Ulysse.
- **SPA Auto-Diagnose & Repair** : missing entry points, deps périmées.
- **DGM V2** : 15 actions, rollback, Discord notifs.
- **Nginx** : config pro, cleanup, logs, security.
- **Orphaned Apps Cleanup** : scan + flag.
- **Sécurité** : bcrypt PIN, webhook signature, CSRF double-submit, Docker non-root, AES-256-CBC, rate-limit PIN (5 tries → 15min lock), session fingerprints, crash-if-missing pour `DEVMAX_ADMIN_PIN` et `SECRETS_ENCRYPTION_KEY`.
- **Scaffolding** : 9 templates.
- **Anti-Loop Detection** : sémantique, erreur, read-only.
- **Deep Code Analysis Protection** : multi-layer.

### Navigation Context System
- Registry `server/config/appNavigation.ts` : pages, tabs, agents.
- `buildNavigationContext(agent, pageId, tabId)` → contexte structuré IA.
- Injecté dans `unifiedContextService` via `DomainContexts.navigationContext`.
- `agent_traces.page_id` / `tab_id` pour tracking.

### Agent Traces & Observability
- `server/services/traceCollector.ts` : full traces.
- Schéma : `agent_traces` + `trace_steps`.
- Routes : GET traces (filtres source/model), GET stats (hourly, error rate, cost, page stats, feedback), POST feedback.
- Frontend : `client/src/pages/Traces.tsx` (collapsible steps, timeline, 8 panels analytics).

### Composable Skills Engine
- `server/services/skillEngine.ts` : CRUD, executeSkill avec trace, param resolution, Brain integration.
- Schéma : `skills`, `skill_steps`, `skill_executions`.
- Frontend `client/src/pages/Skills.tsx` : catalogue, pipeline editor, history.
- 18 skills pré-seedés (bilan-mensuel-resto, morning-briefing, deploy-ulysse, audit-securite, etc.).

### COBA Pro & ChatCOBA
- Resto management chat avec DevMax PIN, MaxAI Chat + COBA System Prompt + outil `coba_business`.
- ChatCOBA : widget embedabble, tenant-isolated.

### DevOps Intelligence & 5-Axes
- 7 algos custom (dependency mapping, risk scoring, patch advisories, code review).
- 5-Axes : vision, exec orchestration, auto-amelioration, observability corrélée, culture.
- **Smart Sync** : push GitHub par SHA blob (économie API).

### SUGU — Restaurant Supply
- Liste courses quotidienne par catégories/zones, futurs, email auto.
- `BaseSuguService` (`server/services/BaseSuguService.ts`) : CRUD/checks/stats/futurs/email health partagés.
- `SugumaillaneService` extends, `SuguvalService` standalone (zone-specific).
- Sync incrémental (`syncToMaillane()` upsert by name).
- **Sécurité** : `SUGUVAL_API_SECRET`, `requireSuguAuth`, `requireSuguSecret` sur email/admin. `SUGUVAL_EMAIL_TO` / `SUGUMAILLANE_EMAIL_TO`.
- Mobile responsive complet (Achats, Caisse, Banque, Frais, RH).

### Ulysse Tools V2 (`server/services/ulysseToolsV2.ts` + `server/services/tools/`)
~100 tool handlers : data/memory, resto, sports, comm/productivity, web/research, DevOps (GitHub Bridge, server actions, browser), file/image/PDF, utilities. ⚠️ Le prompt persona dit "170 outils" — synchroniser dynamiquement (`utilityToolDefs.length`).

### PDF Master Service
Extraction (text/OCR/Vision), édition (merge/split/extract/rotate/text/watermark/compress), AI analyse (summarize/structured/Q&A). Outil `pdf_master` : 10 actions.

### Job Scheduler & Autonomous (`server/services/scheduledJobs.ts`)
- 45-50 jobs : homework, cache cleanup, knowledge sync, daily emails, memory optim, self-healing, proactive, health checks.
- **DynamicJobPrioritizer** : priorités calculées (agentmail-fetch:100, self-healing:100, ...).
- **MAX_CONCURRENT_JOBS = 6** : 35-41 jobs deferred/tick. ⚠️ In-memory uniquement (pas de queue persistante type BullMQ — perte au restart).
- **SelfHealingService** : tick 15 min, reset circuit breakers, refresh capabilities cache, cooldown 1 min anti-boucle.

### Observability & Prometheus
- `/metrics` Prometheus : uptime, health, mem, AI metrics, cost.
- Memory leak safeguards : caches cappés, feedback buffers, voice pcmBuffer.
- MARSMetrics + perfProfiler génèrent format Prometheus natif.
- GC manuel déclenché si heap >85%.
- Pas de Grafana config (données prêtes mais non scrappées externe).

### Scalability & Performance
- Backpressure guards, concurrency limiting, circuit breaker registry, plan-aware tenant rate limit, request prio, health monitoring.
- Redis : rate limiting distribué, session store, cache.

### Infrastructure
- **Hetzner VPS** Ubuntu 24.04 (65.21.209.102), main app port 5000, `/var/www/ulysse`, PM2 id 164.
- **Pool DB** : `pg`, max 20 prod / 40 dev, min 2/5, idle 30s, conn timeout 10s. ⚠️ Logs "Pool connection established" fréquents → surveiller latence réseau ou requêtes bloquantes.
- **CI/CD** : GitHub webhooks → `deploy.sh`.
- **47 server actions** via SSH.
- **Port/URL** : dynamic alloc, `{slug}.ulyssepro.org` prod, `{slug}.dev.ulyssepro.org` staging.
- **Auth/2FA** : Maurice TOTP.
- **Cloudflare** : panel DevMax (DNS, proxy toggle).
- **Backup DB** : cron quotidien.
- **SSL** : certbot + Cloudflare.
- **File storage SUGU** : Replit Object Storage (dev) + filesystem (prod).

## ⚠️ Conventions & Anti-Patterns à respecter

### À FAIRE
- **Logging** : utiliser `createLogger(tag)` depuis `server/utils/logger.ts`. JSON en prod, lisible en dev. Niveaux : debug, info, warn, error, fatal.
- **Imports dynamiques** : si tu utilises `await import(...)`, vérifie `if (!service) throw new Error(...)` avant destructuration.
- **Validation routes** : middleware Zod sur toute route POST/PUT/PATCH manipulant des données.
- **Circuit breakers** : tous les appels providers IA doivent passer par `wrapWithCircuitBreaker` ou `UlysseCoreEngine`.
- **Cohérence prompts** : si tu modifies l'identité d'un persona dans `server/config/personaMapping.ts`, mets aussi à jour `scripts/generate_prompts_pdf.ts` (alimente le brain).

### À NE PAS FAIRE
- ❌ `console.log` en prod : utiliser le logger structuré (audit : 800+ console.log à migrer).
- ❌ `const { svc } = await import(...)` sans vérification : peut retourner undefined silencieusement (audit : 397 occurrences à risque).
- ❌ `catch {}` ou `catch (e) { return null }` sans log : masque les bugs (audit : 433 occurrences, dont auth.ts).
- ❌ Référencer `007ulysse` / `007ulysse-test` dans l'identité de Ulysseproject (prompts personas, .env header, README, etc.) — ce ne sont PAS des repos sur lesquels on travaille ici. Ce sont des apps déployées sur Hetzner que **DevMax gère** (au même titre que `horloge`, `testdeploy`, `mdbhdev`, etc.). Les seuls endroits légitimes : `dgmPipelineOrchestrator.REPO_APP_MAP` (mapping DevMax repo→app), `docs/OPERATIONS.md` (catalogue des apps Hetzner), et la table `devmax_files` / runtime DevMax.
- ❌ Modifier `vite.config.ts`, `server/vite.ts`, `drizzle.config.ts`, `package.json` sans nécessité absolue.

## 🔴 Zones fragiles connues
- **Job Scheduler in-memory** : 35-41 jobs deferred par tick → migrer vers queue persistante (BullMQ + Redis) si charge augmente.
- ~~**ActionHub sans max_depth**~~ ✅ corrigé (avr. 2026) : `MAX_ACTION_DEPTH=5` exporté, `depth?:number` dans `ActionInput`, propagation auto via `AsyncLocalStorage` (`_depthContext`). Tout tool→hub.execute imbriqué hérite de `depth+1` sans modifier les signatures d'executor. Garde au tout début d'`execute()` retourne `cancelled` proprement et incrémente `totalActions` (cohérence métriques).
- **Pas de hard-stop budget IA** : tracking existe (`devmax_ai_costs`) mais pas de circuit-breaker quotidien.
- **3 URLs DOWN récurrentes en prod** : `007ulysse.ulyssepro.org`, `horloge.ulyssepro.org` (×81 down), `testdeploy.ulyssepro.org` — états perdus au restart car `urlHealthState` in-memory.
- **Schémas Drizzle** : pas d'index sur colonnes filtrées (`entry_date`, `supplier_id`, `is_paid`), pas de FK explicites dans `sugu.ts`.
- **Routes dupliquées** : `devopsRoutes.ts` / `devopsMaxRoutes.ts` / `irisDevopsRoutes.ts` à consolider.
- **Prompt persona "170 outils"** alors que ~100 tools réels → hallucinations possibles. Synchroniser dynamiquement.

## 🗺️ Index transversal (concepts → fichiers)
- **Identité Ulysse / personas** : `server/config/personaMapping.ts` + `scripts/generate_prompts_pdf.ts` (alimente brain) — toujours synchroniser les deux.
- **Tools définition** : `server/services/ulysseToolsV2.ts` + `server/services/tools/*.ts` (utilityTools, etc.).
- **Conversation flow** : `server/services/core/CoreConversationIntegration.ts` (entry point), `UlysseCoreEngine.ts` (provider routing).
- **Apprentissage** : `cumulativeLearningEngine`, `memoryGraphService`, `embeddingHelper`, `metaLearningService`, `enhancedSelfCritique`, `autonomousLearningV2`, `autonomousInitiativeEngine`.
- **Sensory** : `server/services/sensory/{BrainHub,HearingHub,VisionHub,ActionHub,VoiceOutputHub}.ts`.
- **DevMax** : `server/routes/devmax/`, `server/services/devmax/`.
- **SUGU** : `server/services/{BaseSuguService,suguvalService,sugumaillaneService}.ts` + `server/api/v2/sugu*`.
- **Schéma DB** : `shared/schema/{auth,brain,coba,commax,conversations,core,devices,devops,domotique,footdatas,geo,misc,skills,sports,sugu,suguMaillane,traces}.ts`.

## External Dependencies

### AI Providers
- OpenAI (Chat, Vision, Images, TTS, STT)
- Google Gemini
- xAI (Grok)
- Perplexity

### Search & Scraping
- Serper.dev, Brave Search, Firecrawl, Apify

### Communication
- Gmail, AgentMail, Discord, Telegram

### Productivity
- Google Calendar, Drive, Todoist, Notion, GitHub

### Sports & Betting
- API-Football, The Odds API, FOOTDATAS, MatchEnDirect

### Smart Home
- Tuya, IFTTT

### Finance & Business
- Finnhub, TwelveData, AlphaVantage, Spotify, HubRise, AppToOrder

### Infrastructure
- Hetzner VPS, Cloudflare DNS, Replit Object Storage, Google Maps, Open-Meteo, MusicBrainz, OSRM
