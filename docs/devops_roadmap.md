# Ulysse DevOps Intelligence — Roadmap 5 Axes + DevMax SaaS

## Vue d'ensemble
Ulysse est un Senior Dev autonome avec un systeme d'intelligence DevOps a 5 axes.
DevMax est la plateforme SaaS multi-tenant construite par-dessus pour les clients externes.

**Derniere mise a jour:** Mars 2026

---

## Axe 1 — VISION & X-RAY
**Statut: OPERATIONNEL**

Ulysse voit tout ce qui se passe dans le codebase:
- Impact Map (graphe de dependances enrichi)
- CI Oracle (scoring de risque 0-100)
- Code Review AI (analyse de diff)
- Domain Health Summary (sante par domaine)

**Fichiers:**
- `server/services/devopsIntelligenceEngine.ts` (7 algorithmes)
- `server/services/devopsIntelligenceService.ts` (orchestration + rapports)

**Endpoints:**
- `GET /api/devops/intel/report?sha=X` — rapport pour un commit
- `GET /api/devops/intel/reports` — rapports recents
- `GET /api/devops/intel/domain-health` — sante des domaines
- `POST /api/devops/intel/run` — lancer manuellement

---

## Axe 2 — EXECUTION ORCHESTREE
**Statut: OPERATIONNEL**

Ulysse agit sur les PRs et commits:
- Analyse automatique des PRs
- Commentaires auto sur GitHub
- Plans de rollback generes
- Patch Advisor (3 niveaux)

**Endpoints:**
- `POST /api/devops/intel/pr-analyze` — analyser une PR + commenter

**Actions Ulysse:**
- `pr_analyze` — analyse complete d'une PR
- `commit_analyze` — analyse d'un commit

---

## Axe 3 — AUTO-AMELIORATION
**Statut: OPERATIONNEL**

Boucle d'apprentissage: Bug → Gap → Homework
- Detection de bugs et events (commit/patch/review/revert/hotfix)
- Analyse de gaps d'apprentissage
- Creation auto de homework
- Fragilite dynamique (Algo #7)

**Fichiers:**
- `server/services/devopsLearningService.ts`
- `shared/schema.ts` (table devops_file_history)

**Endpoints:**
- `POST /api/devops/learning/process-bug` — traiter un bug (boucle complete)
- `POST /api/devops/learning/process-revert` — traiter un revert
- `POST /api/devops/learning/process-hotfix` — traiter un hotfix
- `GET /api/devops/learning/recent-incidents` — incidents recents
- `GET /api/devops/fragility/leaderboard` — top fichiers fragiles
- `GET /api/devops/fragility/check?file=X` — score d'un fichier

**Actions Ulysse:**
- `fragility_leaderboard` — classement fragilite
- `fragility_check` — verifier un fichier
- `process_bug` — boucle complete bug→gap→homework
- `report_bug` — signaler un bug simple
- `record_event` — enregistrer un evenement DevOps

---

## Axe 4 — OBSERVABILITE CORRELEE
**Statut: OPERATIONNEL**

Correlation d'incidents et alertes intelligentes:
- Diagnostic d'incident (endpoint, erreur, domaine)
- Smart alerts (patterns recurrents, modules fragiles)
- Correlation avec historique de fragilite

**Fichiers:**
- `server/services/incidentCorrelationService.ts`

**Endpoints:**
- `GET /api/devops/incidents/diagnose?endpoint=X&errorCode=500` — diagnostiquer un incident
- `GET /api/devops/incidents/smart-alerts` — alertes actives

**Actions Ulysse:**
- `diagnose_incident` — diagnostic correle
- `smart_alerts` — alertes intelligentes

---

## Axe 5 — CULTURE & UTILISATION
**Statut: OPERATIONNEL**

Integration dans le quotidien d'Ulysse:
- Work Journal: entries auto lors des analyses
- Scheduled Job: audit DevOps toutes les 12h
- Alertes Discord pour incidents critiques
- 16 actions Ulysse disponibles dans le chat

**Scheduled Job:**
- `devops-intelligence-audit` — audit toutes les 12h
  - Smart alerts check
  - Discord notification si critique
  - Work Journal si degradation detectee

---

## Resume des 16 Actions DevOps Ulysse

| Action | Axe | Description |
|--------|-----|-------------|
| impact_map | 1 | Graphe de dependances |
| analyze_impact | 1 | Analyser l'impact d'un fichier |
| ci_risk | 1 | Score de risque CI |
| code_review | 1 | Review de code |
| domain_health | 1 | Sante des domaines |
| patch_advice | 2 | Conseil de patch |
| pr_analyze | 2 | Analyse complete PR |
| commit_analyze | 2 | Analyse commit |
| learning_gaps | 3 | Detection de lacunes |
| full_report | 3 | Rapport complet |
| fragility_leaderboard | 3 | Top fichiers fragiles |
| fragility_check | 3 | Score fragilite fichier |
| record_event | 3 | Enregistrer event |
| report_bug / process_bug | 3 | Bug + boucle learning |
| diagnose_incident | 4 | Diagnostic incident |
| smart_alerts | 4 | Alertes intelligentes |

---

## DevMax SaaS — Features Multi-Tenant

### Architecture
- Dashboard: `/devmax` (PIN auth `102040`)
- Admin: `/devmax/123admin` (PIN auth `123admin`)
- 53 routes dans `server/routes/devopsMaxRoutes.ts`
- Auth: `server/routes/devmaxAuth.ts` avec fallback `MAURICE_GITHUB_PAT`

### Features Implementees

| # | Feature | Statut | Fichiers Cles |
|---|---------|--------|---------------|
| T001 | Plan Limits Enforcement | DONE | devopsMaxRoutes.ts, devmaxAuth.ts |
| T002 | Environment Variables UI | DONE | devopsMaxRoutes.ts, DevOpsMax.tsx, sshService.ts |
| T003 | Client Notifications | DONE | devopsMaxRoutes.ts, devmaxWebhook.ts |
| T004 | Guided Onboarding | DONE | DevOpsMax.tsx |
| T005 | Stripe Billing | PENDING | devopsMaxRoutes.ts, devmaxAuth.ts |
| T006 | Custom Domains (Cloudflare) | DONE | sshService.ts, devopsMaxRoutes.ts |
| T007 | Centralized Logs | DONE | sshService.ts, devopsMaxRoutes.ts, DevOpsMax.tsx |
| T008 | Per-Project Metrics | DONE | scheduledJobs.ts, devopsMaxRoutes.ts |
| T009 | Landing Page | DONE | DevMaxLanding.tsx |

### Plans & Limites
| Plan | Projets | Deploys/mois | Users |
|------|---------|-------------|-------|
| Free | 3 | 10 | 1 |
| Starter | 10 | 50 | 5 |
| Pro | 50 | 500 | 25 |
| Enterprise | Illimite | Illimite | Illimite |

### Conventions
- **Workflow immutable** : staging repo (`{repo}-test`) d'abord, puis promotion vers prod
- **Naming** : Dossier=`{slug}-dev`, PM2=`{slug}-dev`, URL=`{slug}-dev.ulyssepro.org`
- **Ports** : Max=6000-6100, Ulysse=5100-5200, Iris=5200-5300

### MaxAI Anti-Read-Loop
- `tool_choice: "required"` force pendant 4 premiers rounds de continuation
- Detection de rounds consecutifs lecture-seulement (browse_files/get_file)
- Injection de message systeme apres 2 rounds sans ecriture
- Logs: `[V2-Tools] 📖 Round X: read-only — streak: N`

### Jobs DevMax
- **URL Health Check** : Verifie toutes les URLs deployees (toutes les ~30 min)
- **Per-Project Metrics** : Collecte CPU/memoire PM2 par projet
- **SSL Certificate Check** : Verifie expiration des certificats
