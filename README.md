# Ulysse — Assistant IA Personnel Autonome

## Presentation

Ulysse est un assistant IA personnel full-stack concu pour Maurice. Il combine gestion de projets, automatisation restaurant (SUGU Valentine & Sugumaillane), intelligence football et paris sportifs (Djedou Pronos), integration DevOps GitHub, assistant vocal, et un systeme multi-persona (Ulysse / Iris / Alfred / MaxAI).

Le systeme fonctionne de maniere autonome 24/7 avec des jobs planifies, une intelligence proactive, et des capacites d'auto-guerison.

**Derniere mise a jour:** 30 Mars 2026
**Tests:** 549/549 passing (38 fichiers)
**Modele IA principal:** GPT-5.1 (gpt-5.1-2025-11-13)

---

## Stack Technique

| Couche | Technologies |
|--------|-------------|
| **Frontend** | React 18, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion, TanStack React Query, wouter |
| **Backend** | Express.js, Node.js, API REST avec validation Zod |
| **Base de donnees** | PostgreSQL via Drizzle ORM (~150 tables) |
| **IA** | OpenAI GPT-5.1 (principal), GPT-4o (vision PDF), Gemini 2.5 Flash, Grok/xAI, Perplexity |
| **PWA** | Installable, push notifications, service worker, mode offline |
| **Voix** | WebSocket audio temps reel, TTS (OpenAI + Piper), STT (Whisper), reconnaissance vocale |

---

## Fonctionnalites Principales

### Assistant IA Multi-Persona
- **Ulysse** : Assistant principal — acces complet a 84+ outils. Parle francais, gere tout du DevOps aux listes de courses.
- **Iris** : Assistant des filles — gestion de projets isolee, aide aux devoirs, acces limite.
- **Alfred** : Persona majordome — interactions formelles et orientees service.

### Moteur IA Multi-Provider
- Orchestrateur avec abstraction de providers (OpenAI, Gemini, Grok)
- Circuit breaker par provider
- Apprentissage des reponses et cache de decisions
- Routage intelligent entre providers selon la complexite de la tache
- Orchestrateur V4 Action-First : function calling OpenAI avec 84 tool handlers via ActionHub
- Anti-Read-Loop : detection de boucles lecture-seulement MaxAI avec injection de message forcant l'ecriture

### Gestion Restaurant (SUGU)
Deux restaurants geres en parallele : **Valentine** (13011) et **Maillane** (13008).
- Checklist quotidienne des courses avec email automatique
- Gestion bancaire, achats, depenses, tresorerie
- Gestion employes, fiches de paie, absences
- Sante financiere et scoring P&L
- Detection d'anomalies (croisement banque vs factures)
- Integration POS via HubRise
- Surveillance AppToOrder (macommande.shop)
- Commentaires quotidiens filtres par date dans les emails
- **ChatCOBA** : Assistant IA embarque pour les clients pro de macommande.shop (widget flottant iframe, isolation stricte par tenant)

### Intelligence Football (Djedou Pronos)
- Big 5 + 20 ligues europeennes
- Base de donnees FOOTDATAS (3 ans d'historique)
- Predictions IA avec scoring de confiance
- Suivi des paris (ROI, win rate, bankroll)
- Cotes en temps reel (API-Football + The Odds API)
- Calendrier mondial MatchEnDirect
- Analyses approfondies (blessures, compos, forme)

### Communication & Productivite
- **Email** : Gmail + AgentMail (lecture, envoi, reponse, transfert)
- **Calendrier** : Google Calendar (creation, liste des evenements)
- **Todoist** : Creation, liste, completion de taches
- **Discord** : Bot complet (messages, reactions, fichiers, invitations, voice)
- **Spotify** : Controle de lecture et recherche
- **Notion** : Base de connaissances
- **Google Drive** : Gestion de fichiers
- **Telegram** : Bot de notifications

### Recherche Web (MARS V2)
- Multi-moteur : Serper, Perplexity Sonar, Brave Search
- Scraping intelligent avec fallbacks (HTTP, Jina, Firecrawl, Apify, Playwright)
- Verification multi-source avec scoring de fiabilite

### Traitement de Fichiers
- OCR et extraction (PDF, Excel, Word)
- Extraction de factures avec validation mathematique
- Analyse video (frames + Whisper + GPT-4 Vision)
- Generation de fichiers (Excel, CSV, PDF, Word, JSON)
- Generation d'images IA (12 styles artistiques)

### Voix
- 3 canaux : WebSocket (audio binaire temps reel), SSE (evenements texte), HTTP (API standard)
- TTS via OpenAI + Piper (local, cache de 19 phrases)
- STT via Whisper
- Reconnaissance du locuteur pour authentification vocale
- TalkingApp V3 Pro avec routeur d'intention par domaine

### Maison Connectee
- Controle Tuya (appareils connectes)
- Automatisation IFTTT (webhooks)

### Finance
- Donnees boursieres (Finnhub, TwelveData, AlphaVantage)
- Alertes de trading
- Portefeuille et watchlists

---

## DevMax — Plateforme DevOps SaaS Multi-Tenant

### Vue d'ensemble
Plateforme DevOps independante accessible a `/devmax` avec authentification id and password, isolation de projet, et base de donnees dediee. Dashboard complet: overview, branches, commits, PRs, CI/CD, fichiers, chat IA, rollback, deploy, GitHub, et journal de projet.

### Admin Platform (`/devmax/123admin`)
Panel de gestion multi-tenant SaaS avec auth separee.
- **Architecture Multi-Tenant** : Organisations, plans (Free/Starter/Pro/Enterprise), facturation, limites.
- **Gestion Tenants** : Vues detaillees, membres, roles, invitations, cles API.
- **Integrations** : 18 services (Gmail, Notion, GitHub, Stripe, OpenAI...) avec activation par tenant.

### Features SaaS Implementees
| Feature | Statut | Description |
|---------|--------|-------------|
| Plan Limits | DONE | Middleware check limites (projets, deploys/mois, users) |
| Env Variables UI | DONE | Get/set/delete variables d'env sur VPS depuis le dashboard |
| Client Notifications | DONE | Email/webhook sur deploy, promotion, SSL, downtime |
| Guided Onboarding | DONE | Wizard: account → plan → GitHub → premier deploy |
| Stripe Billing | PENDING | Checkout, webhooks paiement, suivi usage, factures |
| Custom Domains | DONE | DNS Cloudflare auto + SSL auto pour domaines custom |
| Centralized Logs | DONE | PM2 logs en DB, recherche/filtre depuis dashboard |
| Per-Project Metrics | DONE | CPU/memoire par process PM2, charts dashboard |
| Landing Page | DONE | Page marketing publique `/devmax` |

### Conventions DevMax
- **Workflow immutable** : Toutes modifs → repo staging (`{repo}-test`). Prod via "Promouvoir en Prod".
- **Naming** : Dossier=`{slug}-dev`, PM2=`{slug}-dev`, URL=`{slug}-dev.ulyssepro.org`.
- **Ports** : Max=6000-6100, Ulysse=5100-5200, Iris=5200-5300.

### MaxAI — Anti-Read-Loop
MaxAI (IA de codage) est protege contre les boucles de lecture-seulement :
- `tool_choice: "required"` force pendant les 4 premiers rounds de continuation
- Detection de rounds consecutifs browse_files/get_file sans ecriture
- Apres 2 rounds lecture-seulement : injection d'un message systeme forcant apply_patch/update_file

### ChatCOBA — Assistant IA pour Clients Pro macommande.shop
Widget de chat IA embarquable dans macommande.shop, reserve aux clients professionnels (restaurateurs).
- **Isolation absolue** : chaque restaurant est une entreprise 100% independante. COBA ne partage, compare ou reference jamais de donnees entre tenants.
- **11 outils COBA** : synthese financiere, achats, depenses, banque, employes, paie, fournisseurs, absences, emprunts, caisse, audit.
- **Integration** : script `coba-embed.js` (bulle flottante) + `coba-widget.html` (chat iframe autonome).
- **API** : `POST /api/coba/chat/message`, `GET /api/coba/chat/history`, `POST /api/coba/chat/clear`.
- **Auth** : header `x-coba-key`, CORS restreint a macommande.shop et ulysseproject.org.
- **URL API** : `https://ulysseproject.org`

---

## DevOps MaxAI Intelligence — Systeme 5 Axes

Ulysse et MaxAI sont des **Senior Dev autonome** avec un systeme d'intelligence DevOps a 5 axes.
Ulysse analyse, corrige, teste et challenge MaxAI dans son travail de senior dev autonome.

### Axe 1 — Vision & X-Ray
- **Impact Map** : Graphe de dependances enrichi (14 domaines)
- **CI Oracle** : Scoring de risque 0-100
- **Code Review AI** : Analyse statique de diff (secrets, eval, XSS, console.log)
- **Domain Health** : Sante par domaine

### Axe 2 — Execution Orchestree
- Analyse automatique des Pull Requests
- Commentaires auto sur GitHub
- Plans de rollback generes
- Patch Advisor (3 niveaux : minimal/modere/structural)

### Axe 3 — Auto-Amelioration
- Detection de bugs et evenements (commit/patch/review/revert/hotfix)
- Analyse de gaps d'apprentissage
- Creation automatique de homework
- Fragilite dynamique : apprentissage depuis l'historique reel des bugs/reverts/hotfix

### Axe 4 — Observabilite Correlee
- Diagnostic d'incident (par endpoint, code erreur, domaine)
- Smart alerts (patterns recurrents, modules fragiles)
- Correlation avec historique de fragilite

### Axe 5 — Culture & Utilisation
- Work Journal automatique lors des analyses
- Audit DevOps programme toutes les 12h
- Alertes Discord pour incidents critiques
- 16+ actions DevOps disponibles dans le chat

### 7 Algorithmes DevOps
1. **BRAIN_IMPACT_MAP** — Graphe de dependances fichier → domaine
2. **ULYSSE_CI_ORACLE** — Scoring de risque (sensibilite, volume, criticite, fragilite historique, cross-domain)
3. **AUTO_PATCH_ADVISOR** — 3 niveaux de patchs avec auto-ranking
4. **HOMEWORK_BRAIN_PLANNER** — Detection de lacunes d'apprentissage
5. **CODE_REVIEW_AI** — Analyse statique de diff
6. **AUTO_RISK_CHECK** — Hook auto sur chaque apply_patch
7. **DYNAMIC_FRAGILITY_LEARNING** — Apprentissage dynamique des fragilites

---

## COBA Pro — Chef Operator Business Assistant

Interface chat standalone de gestion restaurant accessible a `/pro/:slug`.
- Prompt systeme COBA specialise (comptabilite, RH, fournisseurs, paie, audit)
- Outil IA `coba_business` avec 38 actions CRUD
- Support multi-tenant

---

## Integration GitHub

### 46+ Actions GitHub
**Repos & Branches:** `list_repos`, `repo_info`, `create_repo`, `delete_repo`, `list_org_repos`, `list_branches`, `create_branch`, `delete_branch`, `compare_branches`

**Fichiers & Code:** `browse_files`, `get_file`, `update_file`, `delete_file`, `apply_patch`, `dry_run_patch`, `search_code`, `blame`

**Commits & Historique:** `list_commits`, `get_commit_diff`

**Pull Requests:** `list_prs`, `create_pr`, `merge_pr`, `review_pr`, `submit_review`

**Issues:** `list_issues`, `get_issue`, `create_issue`, `update_issue`, `add_issue_comment`

**Releases & Tags:** `list_releases`, `create_release`, `list_tags`, `create_tag`

**CI/CD (GitHub Actions):** `list_workflows`, `list_workflow_runs`, `trigger_workflow`, `rerun_workflow`, `cancel_workflow`

**GitHub Pages:** `pages_status`, `enable_pages`, `update_pages`, `disable_pages`, `pages_build`

**Deploiement & Monitoring:** `get_deploy_urls`, `set_deploy_urls`, `crawl_preview`, `analyze_preview`

### Serveur Dedie (Hetzner)
47 actions serveur via SSH :
- Deploy, update, restart, stop, delete, scale (PM2)
- Gestion d'environnement (get/set/delete variables)
- Base de donnees (list, backup, restore PostgreSQL)
- Monitoring (CPU, memoire, disque, connexions, SSL)
- Configuration automatique Nginx + SSL
- URL diagnostic et auto-fix

---

## Systemes Autonomes

### Jobs Planifies (56+ jobs)
- Email quotidien SUGU (liste de courses, consultation IA 23h55, envoi 23h59, recovery 06h00)
- Suivi des predictions sportives, cotes horaires, cache sync
- Diagnostics d'auto-conscience
- Auto-guerison (detection d'erreurs + fix auto + cache refresh deduplique)
- Optimisation du systeme IA
- Sync FOOTDATAS (Big 5)
- Refresh cache bourse
- Monitoring AppToOrder (5 min)
- Briefing matinal (8h)
- Value Bets quotidiens (12h)
- Audit DevOps Intelligence (12h)
- Analyse de comportement
- Apprentissage autonome V3 (multi-couches), tres important
- Prioritisation dynamique des jobs (scores 0-100, cache 5s)
- DevMax : URL health check, metrics collection, SSL check

### Observabilite & Prometheus
- **`GET /metrics`** : Endpoint Prometheus-compatible (text format), scrapable par toute instance Prometheus
- 20+ metriques exposees : uptime, health status, memoire RSS/heap, requetes IA total/latence/tokens/erreurs/cout, cache hits, taux succes jobs
- **Securite** : Restreindre via nginx IP (`allow 127.0.0.1; deny all;`) en production
- **Memory leak safeguards** : ContextOptimizer cache cap 500 entries + eviction 60s, pcmBuffer voix cap 50MB avec trim automatique

### Auto-Guerison (SelfHealingService)
- Surveillance des erreurs runtime et findings diagnostiques
- Detection de circuit breakers ouverts, taux d'echec eleves, capabilities indisponibles
- Healing automatique avec `refreshCache()` deduplique (1 seul appel par cycle)
- Pattern circuit breaker par service
- Alertes Discord

### Apprentissage Autonome V3
- Apprentissage multi-couches avec classification de patterns
- 5 niveaux : Faits → Connexions → Insights → Cross-Domain → Meta
- Scoring de confiance avec decay temporel
- Integration Brain-Orchestrator

### PUGI (Proactive Ulysse General Intelligence)
Meta-intelligence pour initiative, anticipation, analyse de value bets, et monitoring de sante.

### Systeme Sensoriel (5 Hubs)
- **BrainHub** : Coordination centrale
- **HearingHub** : Traitement audio et reconnaissance vocale
- **VisionHub** : Analyse d'image, flux camera, OCR
- **ActionHub** : Execution d'outils et automatisation (84 executors)
- **VoiceOutputHub** : Synthese vocale

---

## Structure du Projet

```
client/                     # Frontend React
  src/
    pages/                  # 36+ pages (Dashboard, Assistant, DevOps, Sports, SUGU, etc.)
    components/             # Composants UI reutilisables
    hooks/                  # Hooks React personnalises
    lib/                    # Utilitaires et configuration
server/                     # Backend Express
  api/v2/                   # API V2 (conversations, health, suguManagement)
  routes/                   # ~40 fichiers de routes
  services/                 # Services metier
    core/                   # UlysseCoreEngine, providers IA
    tools/                  # Definitions d'outils (4 fichiers)
    sensory/                # Systeme sensoriel (5 hubs)
  config/                   # Configuration (personas, capabilities, consciousness)
  middleware/               # Scalabilite, securite, domain isolation
shared/
  schema.ts                 # Schema Drizzle ORM (~150 tables, ~4200 lignes)
docs/                       # Documentation
  devops_roadmap.md         # Roadmap 5 Axes DevOps
  DEPLOYMENT.md             # Guide de deploiement
  SUGU_FLOW.md              # Flux quotidien SUGU
  ULYSSE_CAPABILITIES_GUIDE.md  # Guide des 98+ capacites
  RESERVED_VM_CONFIG.md     # Configuration Reserved VM
```

---

## Pages Frontend (36+ pages)

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | Vue d'ensemble avec widgets |
| UnifiedDashboard | `/unified` | Dashboard combine |
| Assistant | `/assistant` | Interface chat Ulysse |
| TalkingApp | `/talking` | Interface vocale |
| TalkingIris | `/talking-iris` | Interface vocale Iris |
| DevOps | `/devops` | Repos GitHub, fichiers, preview, CI/CD |
| DevOpsIris | `/devops-iris` | Projets des filles |
| DevOpsMax | `/devmax` | Dashboard DevMax SaaS |
| DevMaxLanding | `/devmax` (public) | Landing page marketing |
| COBA Pro | `/pro/:slug` | Chat gestion restaurant |
| Tasks | `/tasks` | Tableau kanban |
| Projects | `/projects` | Gestion de projets |
| Notes | `/notes` | Editeur de notes Markdown |
| Emails | `/emails` | Gestion email |
| SportsPredictions | `/sports` | Dashboard Djedou Pronos |
| FootAlmanach | `/foot-almanach` | Base de donnees football |
| Finances | `/finances` | Bourse et trading |
| SUGU Valentine | `/sugu` | Gestion Valentine |
| SUGU Maillane | `/sugumaillane` | Gestion Maillane |
| BrainDashboard | `/brain` | Memoire et connaissances IA |
| IrisDashboard | `/iris` | Vue d'ensemble Iris |
| IrisHomework | `/iris/homework` | Gestion des devoirs |
| AlfredApp | `/alfred` | Interface Alfred |
| UlysseInsights | `/insights` | Analytics et KPIs IA |
| Diagnostics | `/diagnostics` | Sante systeme |
| SecurityDashboard | `/security` | Audit de securite |
| Settings | `/settings` | Preferences |

---

## Integrations Externes

### Providers IA
| Service | Usage |
|---------|-------|
| OpenAI | Chat (GPT-5.1), Vision (GPT-4o), Images (gpt-image-1), TTS, STT (Whisper) |
| Google Gemini | Chat alternatif (2.5-pro/flash) |
| xAI (Grok) | Provider de fallback |
| Perplexity | Reponses informees par le web |

### Recherche & Scraping
| Service | Usage |
|---------|-------|
| Serper.dev | Recherche web principale |
| Brave Search | Recherche alternative |
| Firecrawl | Crawling web avance |
| Apify | Scraping specialise (Playwright) |

### Communication
| Service | Usage |
|---------|-------|
| Gmail | Lecture et envoi d'emails |
| AgentMail | Service email dedie IA |
| Discord | Bot + webhooks notifications |
| Telegram | Bot notifications |

### Productivite
| Service | Usage |
|---------|-------|
| Google Calendar | Gestion d'evenements |
| Google Drive | Gestion de fichiers |
| Todoist | Gestion de taches |
| Notion | Base de connaissances |
| GitHub | Gestion de repositories |

### Sports & Paris
| Service | Usage |
|---------|-------|
| API-Football | Donnees football et cotes (RapidAPI) |
| The Odds API | Cotes de paris |
| FOOTDATAS | Base Big 5 ligues europeennes |
| MatchEnDirect | Calendrier mondial football |

### Infrastructure
| Service | Usage |
|---------|-------|
| Hetzner SSH | Serveur dedie (65.21.209.102) |
| Cloudflare | DNS, SSL, CDN |
| Replit Object Storage | Stockage binaire (GCS) |
| Google Maps / Nominatim | Geolocalisation et routage |
| Open-Meteo | Donnees meteo |

---

## Securite

- Authentification par session avec hachage bcrypt
- Authentification WebAuthn/biometrique
- 2FA obligatoire en production
- Chiffrement des tokens stockes (AES-256-GCM)
- Isolation des donnees par userId
- Helmet avec CSP, CORS
- Audit logging, rate limiting, protection brute force
- Routes owner-only pour operations sensibles
- Isolation par domaine (Ulysse AI, SUGU, DevMax, AppToOrder)

---

## Performance

- Compression HTTP (gzip niveau 6)
- PerfProfiler V2 : insertions batch (25 metriques, flush 10s)
- Surveillance memoire (MemoryPressureMonitor: WARNING 75%, CRITICAL 90%)
- Pool DB : 20 connexions max prod / 40 dev, timeout 10s connexion, 30s statement
- Serving statique : index.html en memoire, cache immutable 1 an + ETag
- Build Vite : CSS code splitting, chunks vendor/ui/charts/maps
- NODE_OPTIONS : `--max-old-space-size=3072`
- DynamicJobPrioritizer : cache 5s pour eviter calculs redondants
- SelfHealing : `refreshCache()` deduplique par cycle

---

## Deploiements

Ulysse a deux deployments independants (NON synchronises) :

- **Replit** → Environnement de developpement. Utilise les connecteurs Replit.
- **Hetzner AX42** → `https://ulyssepro.org` — Serveur de production autonome. Code a `/var/www/ulysse`, PM2 process `ulysse`, Nginx+Cloudflare SSL, PostgreSQL `ulysse_db`. Deploy script: `./deploy.sh`.

---

## Licence

Projet prive — Maurice D (MDBH)
