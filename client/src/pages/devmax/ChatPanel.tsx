import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw,
  Plus,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  File,
  Bot,
  Terminal,
  Zap,
  X,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  API,
  AUTH_API,
  DEVMAX_TOKEN_KEY,
  devmaxQueryClient,
  getDevmaxToken,
  devmaxFetch,
  useDevmaxAuth,
  ChatMessage,
} from "./types";
import { MarkdownContent } from "./AuthScreens";

const QUICK_COMMANDS: { icon: string; label: string; cmd: string; tab?: string; color: string }[] = [
  { icon: "🔍", label: "Status repo", cmd: "Donne-moi le status complet du repo: branches actives, derniers commits, PRs ouvertes, workflows CI/CD, et santé générale.", color: "emerald" },
  { icon: "🚀", label: "Deploy staging", cmd: "Déploie la branche main en staging. Lance le pipeline complet: preflight → backup → build → test → security → deploy → health check. Vérifie que l'URL staging est opérationnelle après.", color: "blue" },
  { icon: "⬆️", label: "Promote prod", cmd: "Promote le staging vers la production. Fais un backup avant, puis vérifie que l'URL production est opérationnelle après avec url_diagnose_all.", color: "purple" },
  { icon: "🔄", label: "Rollback", cmd: "Liste les snapshots de déploiement disponibles et propose un rollback si nécessaire.", color: "amber" },
  { icon: "🛡️", label: "Security scan", cmd: "Lance un scan de sécurité complet: secrets exposés, vulnérabilités des dépendances, headers HTTP, certificat SSL, patterns dangereux dans le code.", color: "red" },
  { icon: "📊", label: "Perf audit", cmd: "Analyse les performances de l'app: profile_app (CPU/mem/heap/TTFB), bundle_analyze (tailles, gzip, deps inutiles), et architecture_analyze (complexité, couplage, circular deps).", color: "cyan" },
  { icon: "🔧", label: "Fix URLs", cmd: "Lance url_diagnose_all pour diagnostiquer et corriger automatiquement TOUTES les URLs du projet (staging + production). Corrige les 502, 404, Nginx, PM2, SSL.", color: "orange" },
  { icon: "📝", label: "Full audit", cmd: "Audit profond complet du projet: browse_files, analyse architecture, security_scan, db_inspect, performance profile, CI/CD status, et synthèse avec recommandations.", color: "violet" },
];

const TAB_SUGGESTIONS: Record<string, { label: string; cmd: string }[]> = {
  overview: [
    { label: "Résumé santé projet", cmd: "Donne un résumé de santé du projet: dernière activité, derniers commits, PRs, état CI/CD, et métriques clés." },
    { label: "Recommandations", cmd: "Analyse le projet et propose les 5 améliorations prioritaires à faire maintenant." },
  ],
  branches: [
    { label: "Créer feature branch", cmd: "Crée une nouvelle branche feature/ à partir de main. Propose un nom basé sur les issues ouvertes ou le travail en cours." },
    { label: "Nettoyer branches", cmd: "Liste toutes les branches mergées ou stale (>30 jours sans commit) et propose un nettoyage." },
  ],
  commits: [
    { label: "Changelog récent", cmd: "Génère un changelog structuré à partir des 20 derniers commits (groupé par type: feat, fix, refactor, docs)." },
    { label: "Hotspots code", cmd: "Analyse les fichiers les plus modifiés récemment (hotspots) et identifie les zones à risque." },
  ],
  prs: [
    { label: "Review PR ouverte", cmd: "Prends la PR ouverte la plus récente, lis les changements, et fais une code review détaillée: qualité, bugs potentiels, suggestions." },
    { label: "Créer PR", cmd: "Crée une PR depuis la branche feature la plus récente vers main avec un titre et description auto-générés basés sur les commits." },
  ],
  cicd: [
    { label: "Relancer dernier run", cmd: "Relance le dernier workflow GitHub Actions qui a échoué. Analyse les logs d'erreur avant de relancer." },
    { label: "Diagnostic CI/CD", cmd: "Analyse tous les workflows: taux de succès, durées moyennes, échecs récurrents, et propose des optimisations." },
  ],
  files: [
    { label: "Architecture overview", cmd: "Fais un architecture_analyze complet: structure des dossiers, métriques, deps circulaires, complexité, et design patterns détectés." },
    { label: "Docs auto", cmd: "Génère la documentation automatique du projet avec docs_generate: README, structure, API endpoints, et commit DOCS.md." },
  ],
  deploy: [
    { label: "Pipeline complet", cmd: "Lance le full_pipeline: preflight → backup → build → test → security → deploy → health check. Rapport complet à chaque étape." },
    { label: "Status déploiement", cmd: "Vérifie le status de déploiement actuel: état staging, état production, derniers snapshots, et URLs opérationnelles." },
  ],
  rollback: [
    { label: "Lister snapshots", cmd: "Liste tous les snapshots de déploiement disponibles avec dates, branches, et tailles." },
    { label: "Rollback sécurisé", cmd: "Propose un rollback vers le dernier snapshot stable. Vérifie la santé avant et après." },
  ],
};

export function DevOpsChatPanel({ currentTab }: { currentTab?: string }) {
  const { activeProject } = useDevmaxAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<{ name: string; type: string; dataUrl: string }[]>([]);
  const [showQuickCmds, setShowQuickCmds] = useState(false);
  const [projectContext, setProjectContext] = useState<string>("");
  const [historyLoaded, setHistoryLoaded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const repoFull = activeProject?.repo_owner && activeProject?.repo_name
    ? `${activeProject.repo_owner}/${activeProject.repo_name}`
    : "aucun repo";
  const auditTriggeredRef = useRef(false);
  const contextSuggestions = currentTab ? TAB_SUGGESTIONS[currentTab] || [] : [];

  useEffect(() => {
    const pid = activeProject?.id;
    if (!pid || historyLoaded === pid) return;

    const token = localStorage.getItem(DEVMAX_TOKEN_KEY) || "";
    if (!token) return;

    const loadHistory = async () => {
      try {
        const [chatRes, journalRes] = await Promise.all([
          devmaxFetch(`${AUTH_API}/chat/history/${pid}?limit=50`),
          devmaxFetch(`${AUTH_API}/journal/${pid}?limit=15`),
        ]);

        if (chatRes.ok) {
          const chatData = await chatRes.json();
          if (chatData.messages && chatData.messages.length > 0) {
            const restored: ChatMessage[] = chatData.messages
              .filter((m: any) => m.role !== "system" && !(m.content || "").includes("[SUPERCHAT CONTEXT"))
              .map((m: any) => ({
                role: m.role as "user" | "assistant",
                content: m.content || "",
              }));
            setMessages(restored);
            const lastThread = chatData.messages.find((m: any) => m.thread_id)?.thread_id;
            if (lastThread) setThreadId(lastThread);
          } else {
            setMessages([]);
            setThreadId(null);
          }
        }

        if (journalRes.ok) {
          const journalData = await journalRes.json();
          if (journalData.entries && journalData.entries.length > 0) {
            const journalSummary = journalData.entries
              .slice(0, 10)
              .map((e: any) => `- [${e.entry_type}] ${e.title}${e.description ? `: ${e.description}` : ""} (${new Date(e.created_at).toLocaleString("fr-FR")})`)
              .join("\n");
            setProjectContext(journalSummary);
          } else {
            setProjectContext("");
          }
        } else {
          console.warn("[MaxAI] Journal load failed:", journalRes.status);
          setProjectContext("");
        }

        setHistoryLoaded(pid);
      } catch (e) {
        console.error("[MaxAI] Failed to load chat history:", e);
        setMessages([{ role: "assistant" as const, content: "⚠️ Impossible de charger l'historique de conversation. Vous pouvez continuer à discuter normalement." }]);
        setHistoryLoaded(pid);
      }
    };

    loadHistory();
  }, [activeProject?.id, historyLoaded]);

  const saveChat = useCallback((role: string, content: string, tid?: number | null, toolCalls?: any) => {
    if (!content || content.length < 2) return;
    const pid = activeProject?.id;
    devmaxFetch(`${AUTH_API}/chat/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid || null, threadId: tid || null, role, content, toolCalls: toolCalls || null, metadata: { repo: repoFull } }),
    }).catch((e) => { console.warn("[MaxAI] Chat save failed:", e); });
  }, [activeProject?.id, repoFull]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const processFiles = useCallback((files: File[]) => {
    files.forEach(file => {
      if (file.size > 10 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, { name: file.name, type: file.type, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    processFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFiles]);

  const [isDragOver, setIsDragOver] = useState(false);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToProcess: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          const name = file.name === "image.png" && file.type.startsWith("image/")
            ? `screenshot-${Date.now()}.png`
            : file.name;
          const renamedFile = new File([file], name, { type: file.type });
          filesToProcess.push(renamedFile);
        }
      }
    }

    if (filesToProcess.length > 0) {
      e.preventDefault();
      processFiles(filesToProcess);
    }
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processFiles(Array.from(files));
    }
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const autoContinueCountRef = useRef(0);
  const pendingAutoContinueRef = useRef(false);
  const handleSendRef = useRef<Function | null>(null);

  const handleSend = useCallback(async (overrideMsg?: string, _unused1?: any, _unused2?: any, isAutoContinue?: boolean, isRetry?: boolean) => {
    const msg = overrideMsg || input.trim();
    if ((!msg && attachments.length === 0) || isLoading) return;
    if (!overrideMsg && !isAutoContinue) setInput("");

    if (isAutoContinue) {
      autoContinueCountRef.current += 1;
      if (autoContinueCountRef.current > 3) {
        autoContinueCountRef.current = 0;
        return;
      }
    } else {
      autoContinueCountRef.current = 0;
    }

    const currentAttachments = (isRetry || isAutoContinue) ? [] : [...attachments];
    setAttachments([]);

    const attachmentDesc = currentAttachments.length > 0 ? `\n[Fichiers: ${currentAttachments.map(a => a.name).join(", ")}]` : "";

    if (!isRetry && !isAutoContinue) {
      setMessages(prev => [...prev, {
        role: "user",
        content: msg + attachmentDesc,
        attachments: currentAttachments.map(a => ({ name: a.name, type: a.type, preview: a.type.startsWith("image/") ? a.dataUrl : undefined })),
      }]);
      saveChat("user", msg + attachmentDesc, threadId);
    } else if (isAutoContinue) {
      setMessages(prev => [...prev, {
        role: "user",
        content: "⚡ Auto-continue...",
      }]);
    }
    setIsLoading(true);

    const devopsActions = "Actions GitHub disponibles: list_repos, repo_info, list_branches, delete_branch, list_commits, list_prs, create_branch, create_pr, merge_pr, get_file, update_file, delete_file, apply_patch, browse_files, search_code, list_workflows, list_workflow_runs, trigger_workflow, rerun_workflow, cancel_workflow, create_repo, get_deploy_urls, set_deploy_urls, analyze_preview.";
    const tabContext = currentTab ? `\n[CONTEXTE] L'utilisateur regarde l'onglet "${currentTab}" du dashboard DevMax.` : "";
    const now = new Date();
    const dateStr = now.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Paris" });
    const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    const devopsHint = `[MAX — INGÉNIEUR LOGICIEL SENIOR] Tu es MaxAI, un ingenieur logiciel senior expert fullstack et DevOps. Tu n'es PAS Ulysse. Tu es un assistant DevOps strictement professionnel et technique.
[DATE & HEURE] Nous sommes le ${dateStr}, il est ${timeStr} (Europe/Paris).
[RÈGLES ABSOLUES]
- L'utilisateur est ANONYME. Tu ne connais PAS son nom, sa vie, ses habitudes. Tu ne l'appelles JAMAIS par un prénom.
- Tu ne mémorises AUCUNE donnée personnelle. Tu ignores totalement qui est derrière l'écran.
- Tu parles UNIQUEMENT de développement, code, DevOps, infrastructure, déploiement, architecture logicielle.
- Tu REFUSES poliment toute conversation personnelle, vie quotidienne, sport, cuisine, météo ou sujet non-technique. Réponds: "Je suis MaxAI, je ne traite que les sujets techniques et DevOps."
- Tu ne fais JAMAIS référence à Maurice, Ulysse, SUGU, restaurants, football, paris sportifs ou tout autre contexte extérieur.
- Ton ton est professionnel, concis, direct. Indicateurs ✓ ✗ uniquement.
[MÉTHODE D'INVESTIGATION — PENSE COMME UN SENIOR]
Tu CREUSES, FOUILLES et ANALYSES avant d'agir. Tu ne sautes JAMAIS à une solution sans comprendre le problème.
1. COMPRENDRE — Lis le contexte (journal, historique, code). Que s'est-il passé avant ? Quel est l'état actuel ?
2. HYPOTHÈSES — Face à un problème, liste 2-3 causes possibles. Explique ton raisonnement: "Le 502 peut venir de: (a) PM2 crashé, (b) Nginx mal config, (c) port incorrect."
3. VÉRIFIER — Diagnostique systématiquement chaque hypothèse. Communique chaque découverte: "✓ PM2 online → pas (a). Je vérifie (b)..."
4. CREUSER — Ne t'arrête JAMAIS au symptôme. Un "502" n'est pas un diagnostic. Descends à la cause racine.
5. ANALYSER — Quand un outil renvoie un résultat, EXTRAIS les infos pertinentes, identifie les anomalies.
6. EXPLIQUER — L'utilisateur doit comprendre TON raisonnement. "Je lance debug_app parce que le health check échoue mais PM2 est online — crash au démarrage probable."
[COMMUNICATION]
- Structure: contexte → diagnostic → actions → résultats → synthèse.
- Explique la CAUSE RACINE, pas le symptôme.
- Résume en fin de réponse: fait, marche, reste à faire.
- Priorise: critique d'abord, cosmétique après.
- Sois honnête: "Je ne peux pas vérifier X sans Y" plutôt que deviner.
[EXÉCUTION — PAS DE PROMESSES]
- Chaque réponse est TERMINALE. Pas de "plus tard".
- INTERDIT: "je vais lancer", "temps estimé", "prochaines actions". OBLIGATOIRE: exécuter MAINTENANT via les outils.
- Quand une action échoue, ANALYSE l'erreur et cherche une alternative — ne répète pas bêtement.
- Chaîne tes actions: diagnostic → correction → vérification → rapport.
Interface DevOps Bridge. Repo actif: ${repoFull}. Branche par defaut: main. ${devopsActions} Pour ecrire/modifier des fichiers: utilise devops_github/update_file. Tu as l'autorisation complete sur le repo.
[DB] Tu as un acces DB complet 24/7 via devmax_db (query/insert/update/delete/stats/project_summary) sur tes tables: devmax_projects, devmax_sessions, devmax_activity_log, dgm_sessions, dgm_tasks, dgm_pipeline_runs, devmax_chat_history, devmax_project_journal.
[JOURNAL — MÉMOIRE DE TRAVAIL] Apres chaque action importante, tu DOIS ajouter une entree au journal du projet via devmax_db insert dans devmax_project_journal (project_id, entry_type, title, description, files_changed). entry_type: code_edit|deploy|config|review|plan|roadmap|task_status|note|scaffold|fix|refactor.
- Utilise "roadmap" pour sauvegarder ta feuille de route complète du projet (objectifs, étapes, priorités).
- Utilise "task_status" pour marquer l'état d'une tâche (en cours, terminée, bloquée) avec ce qui reste à faire.
- Utilise "plan" pour les plans d'action avant exécution.
- AVANT de commencer un travail complexe, consulte le journal pour reprendre là où tu en étais.
[HISTORIQUE] Tous tes messages chat sont automatiquement sauvegardes dans devmax_chat_history. Tu peux les consulter via devmax_db query pour te rappeler des conversations passees et planifier. AVANT de commencer un travail complexe, consulte l'historique recent du projet.
[DEPLOY RULES] Quand tu deploies une app via devops_server/deploy, tu DOIS toujours passer caller='max'. AVANT de choisir un port, utilise devops_server action=list_apps pour voir les ports déjà utilisés. Utilise des ports dans la plage 6000+ pour tes apps. Les ports 5100-5200 sont reserves a Ulysse, les ports 5200-5300 a Iris. URL par defaut: appName.ulyssepro.org. Tu DOIS verifier qu'aucune app n'utilise deja le meme port avant de deployer.
[INGÉNIERIE COMPLÈTE — 47 ACTIONS SERVEUR via devops_server]
INFRA: status, health, list_apps, app_info, deploy, update, restart, stop, delete, cleanup_orphans, scale, exec, ssl
CLEANUP: cleanup_orphans (dryRun=true pour scanner, dryRun=false pour supprimer). Detecte les apps dont le repo GitHub n'existe plus, les dossiers vides, et les -placeholder. Apps protegees: ulysse, mdbhdev, devmax, devops, deploy-webhook, default.
ENV: env_get, env_set, env_delete, env_clone (cloner setup complet d'une app vers une autre)
DB: list_databases, backup_db, restore_db, list_backups, migrate_db (auto drizzle/prisma/knex), db_inspect (schema complet, indexes, foreign keys, slow queries, bloat, connexions)
CRON: cron_list, cron_add, cron_delete
NGINX: nginx_configs
ENGINEERING: install_packages, run_tests, analyze_deps, debug_app, refactor_check
SÉCURITÉ: security_scan (secrets+vulns+headers+SSL+dangerous patterns), backup_app (code+DB+nginx+env), rollback_app (Git reset+rebuild+health, steps=N)
PERFORMANCE: profile_app (CPU/mem/heap/TTFB/connexions/IO), perf_loadtest (N req x C concurrency), bundle_analyze (dist sizes, gzip, unused deps, source maps)
ARCHITECTURE: architecture_analyze (structure, métriques, circular deps, couplage, complexité cyclomatique, design patterns), docs_generate (auto-doc + commit DOCS.md)
GIT: git_intelligence (full_report, blame, bisect_errors, hotspots, branch_diff, cherry_pick)
API: api_test (auto-découverte endpoints + test HTTP codes/temps/tailles)
MONITORING: monitoring_setup (enable/disable/status/logs — cron 5min + auto-restart PM2)
SCAFFOLDING: scaffold_project (express-api|react-vite|fullstack|nextjs|static-html → repo complet)
SMART DEPLOY: Le systeme de deploy est INTELLIGENT — il lit automatiquement .env.example, detecte les process.env dans le code, auto-genere les secrets (JWT_SECRET, SESSION_SECRET, COOKIE_SECRET), cree la DB PostgreSQL si DATABASE_URL est requis, et lance les migrations Prisma/Drizzle. Quand tu deploies un projet existant depuis GitHub, le deploy s'occupe de TOUT. Tu n'as PAS besoin de demander les env vars a l'utilisateur — le systeme les detecte et les configure.
URL DIAGNOSTIC: url_diagnose (domain/appName → teste HTTP, Nginx, SSL, PM2 et CORRIGE auto: 502/404/503/000), url_diagnose_all (appName → teste ET corrige staging+production en une seule action)
PIPELINE: full_pipeline (7 étapes: preflight→backup→build→test→security→deploy→health check)
CYCLE: backup_app AVANT risque. architecture_analyze + security_scan + db_inspect régulièrement. full_pipeline pour le SDLC complet.
[URL AUTO-FIX] Quand tu deploies ou que l'utilisateur signale un probleme (502, 404, site inaccessible, "erreur", "ca marche pas", "down"), tu DOIS IMMÉDIATEMENT:
1. Lancer url_diagnose_all pour diagnostiquer ET corriger automatiquement (Nginx, SSL, PM2, ports, root path)
2. Si le diagnostic ne suffit pas, utilise debug_app pour voir les logs d'erreur
3. Propose une correction concrète et exécute-la toi-même
4. Re-vérifie avec url_diagnose après la correction
Tu ne DOIS JAMAIS juste dire "il faudrait configurer Nginx" sans le faire. Tu EXÉCUTES les corrections.
APRES chaque deploy, lance TOUJOURS url_diagnose_all pour verifier staging ET production.
[PROACTIVITÉ] Ne reste JAMAIS silencieux ou passif. Si une action échoue, diagnostique IMMÉDIATEMENT la cause avec les outils disponibles. L'utilisateur doit voir tes actions défiler en temps réel dans le chat — chaque outil que tu appelles s'affiche automatiquement. Plus tu utilises d'outils, plus l'utilisateur voit ton travail et se sent accompagné.${tabContext}
[PROJET ACTIF] ID: ${activeProject?.id || "aucun"}, Nom: ${activeProject?.name || "aucun"}, Repo: ${repoFull}.${projectContext ? `\n[JOURNAL RÉCENT DU PROJET]\n${projectContext}` : ""}
[MÉMOIRE CONVERSATION] ${messages.length > 0 ? `${messages.length} messages dans cette session. Derniers échanges ci-dessous — tu DOIS t'en servir pour assurer la continuité du travail. Si l'utilisateur dit "on reprend" ou "on continue", réfère-toi à ces échanges pour savoir exactement où on en était.` : "Aucun historique — nouvelle conversation."}`;
    const recentMessagesContext = messages.length > 0 ? messages.slice(-10).map(m => `[${m.role === "user" ? "USER" : "MAX"}]: ${m.content.slice(0, 300)}`).join("\n") : "";

    let messageContent = msg;
    if (currentAttachments.length > 0) {
      const fileDescs = currentAttachments.map(a => a.type.startsWith("image/") ? `[Image: ${a.name}]` : `[Fichier: ${a.name}]`).join("\n");
      messageContent = `${msg}\n\n${fileDescs}`;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const bodyPayload: any = {
        message: messageContent,
        threadId,
        originDevice: "web",
        sessionContext: "devops",
        contextHints: {
          systemHint: devopsHint + (recentMessagesContext ? `\n[DERNIERS ÉCHANGES]\n${recentMessagesContext}` : ""),
          devopsContext: `Repo: ${repoFull || "aucun"}. Branche: main. Projet: ${activeProject?.name || "aucun"} (ID: ${activeProject?.id || "N/A"}).`,
          forceTools: ["devops_github", "devops_server", "sensory_hub", "devmax_db", "dgm_manage"],
          dgmActive: true,
          dgmRepoContext: repoFull || undefined,
          devmaxProjectId: activeProject?.id || undefined,
          pageContext: { pageId: "devmax", pageName: "DevMax Command Center", pageDescription: "Console DevOps MaxAI — GitHub, CI/CD, déploiements, serveurs, pipelines et gestion de projets" },
        },
      };
      if (currentAttachments.length > 0) {
        bodyPayload.attachments = currentAttachments.map(a => ({ name: a.name, type: a.type, data: a.dataUrl }));
      }

      const token = getDevmaxToken();
      const res = await fetch("/api/v2/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "x-devmax-token": token || "",
        },
        credentials: "include",
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Erreur");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      const toolCallsCollected: any[] = [];
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "start" && data.threadId) setThreadId(data.threadId);
                else if (data.type === "tool_status") {
                  if (data.tool) toolCallsCollected.push({ tool: data.tool, label: data.label, status: data.status });
                  if (data.status === "executing") {
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      const activity = [...(last.toolActivity || [])];
                      activity.push({ tool: data.tool, label: data.label, status: "executing" });
                      updated[updated.length - 1] = { ...last, toolActivity: activity };
                      return updated;
                    });
                  } else if (data.status === "done" || data.status === "error") {
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      const activity = [...(last.toolActivity || [])];
                      const idx = activity.findLastIndex(a => a.tool === data.tool && a.status === "executing");
                      if (idx >= 0) activity[idx] = { ...activity[idx], status: data.status, durationMs: data.durationMs };
                      updated[updated.length - 1] = { ...last, toolActivity: activity };
                      return updated;
                    });
                  }
                } else if (data.type === "chunk" && data.content) {
                  fullContent += data.content;
                  const captured = fullContent;
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...updated[updated.length - 1], content: captured };
                    return updated;
                  });
                }
              } catch {}
            }
          }
        }
      }
      if (fullContent.length > 2) {
        saveChat("assistant", fullContent, threadId, toolCallsCollected.length > 0 ? toolCallsCollected : null);
      }
      devmaxQueryClient.invalidateQueries({ queryKey: [API] });

      const continuePatterns = [
        /je (vais|reviens|reviendrai|procède|lance)\b/i,
        /prochaines?\s+actions?\s*:/i,
        /temps\s+estim[eé]/i,
        /dans\s+\d+[\s-]*(minutes?|secondes?|min)/i,
        /je\s+(te|vous)\s+reviens/i,
        /lancement\s+en\s+cours/i,
        /je\s+commence\s+(le|la|l'|un|une)/i,
      ];
      const hasPromise = continuePatterns.some(p => p.test(fullContent));
      const hadToolCalls = toolCallsCollected.length > 0;
      if (hasPromise && !hadToolCalls && !isAutoContinue) {
        pendingAutoContinueRef.current = true;
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      const retryCount = (err._retryCount || 0);
      if (retryCount < 2 && (err.message === "Erreur" || err.message === "Failed to fetch" || err.message?.includes("network") || err.message?.includes("NetworkError"))) {
        console.log(`[MaxAI] Retry ${retryCount + 1}/2...`);
        err._retryCount = retryCount + 1;
        const delay = (retryCount + 1) * 2000;
        setMessages(prev => [...prev, { role: "assistant", content: `⏳ Connexion interrompue, nouvelle tentative (${retryCount + 1}/2)...` }]);
        await new Promise(r => setTimeout(r, delay));
        setMessages(prev => prev.slice(0, -1));
        setIsLoading(false);
        abortRef.current = null;
        return handleSend(messageContent, undefined, undefined, isAutoContinue);
      }
      const errDetail = err.message === "Erreur" ? "Le serveur n'a pas pu traiter la requête." : (err.message || "Connexion perdue.");
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${errDetail} Réessaie ou reformule ta demande en ciblant un dossier spécifique.` }]);
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, threadId, isLoading, attachments, repoFull, saveChat]);

  handleSendRef.current = handleSend;

  useEffect(() => {
    if (!isLoading && pendingAutoContinueRef.current) {
      pendingAutoContinueRef.current = false;
      const timer = setTimeout(() => {
        handleSendRef.current?.("Continue. Exécute maintenant les actions que tu as annoncées. Utilise les outils disponibles immédiatement.", undefined, undefined, true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  useEffect(() => {
    if (auditTriggeredRef.current) return;
    const proj = activeProject;
    if (proj?._triggerAudit && proj?.repo_owner && proj?.repo_name) {
      auditTriggeredRef.current = true;
      delete proj._triggerAudit;
      const slug = proj.deploy_slug || (proj.repo_name || proj.name).toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const auditMsg = `Nouveau projet "${proj.name}" créé avec le repo ${proj.repo_owner}/${proj.repo_name}.
URLs générées: ${slug}.ulyssepro.org (production) et ${slug}-dev.ulyssepro.org (staging).
Lance immédiatement un audit profond complet:
1. browse_files à la racine pour voir la structure complète du repo
2. Lis les fichiers clés: package.json, README.md, et les principaux fichiers de config
3. Analyse l'architecture, le tech stack, les dépendances, les scripts
4. Vérifie s'il y a un CI/CD, des tests, des workflows GitHub Actions
5. DIAGNOSTIC URLs: utilise devops_server url_diagnose_all avec appName="${slug}" pour tester ET corriger automatiquement les 2 URLs (staging + production). Corrige TOUS les problèmes détectés (502, 404, Nginx manquant, PM2 down, etc.)
6. Vérifie les deploy URLs et mets-les à jour si nécessaire
7. Propose une synthèse complète: forces, faiblesses, recommandations, prochaines actions suggérées

Sois exhaustif et structure ta réponse clairement. L'objectif est que les 2 URLs soient opérationnelles à la fin de l'audit.`;
      setTimeout(() => handleSend(auditMsg), 500);
    }
  }, [activeProject, handleSend]);

  return (
    <div className={cn("flex flex-col h-full relative", isDragOver && "ring-2 ring-cyan-500/50 rounded-xl")} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-emerald-500/10 backdrop-blur-sm rounded-xl border-2 border-dashed border-emerald-500/50">
          <div className="flex flex-col items-center gap-2 text-emerald-400">
            <Paperclip className="w-8 h-8" />
            <span className="text-sm font-medium">Déposez vos fichiers ici</span>
          </div>
        </div>
      )}
      <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileSelect} />
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-semibold">MaxAI</span>
        <Badge variant="outline" className="text-[10px] font-mono">Ingenieur Senior</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => { setMessages([]); setThreadId(null); setAttachments([]); setProjectContext(""); }} data-testid="button-clear-devops-chat">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                <Terminal className="w-7 h-7 opacity-50" />
              </div>
              <div>
                <p className="font-medium text-zinc-200">MaxAI — Ingénieur Senior DevOps</p>
                <p className="text-xs text-zinc-500 mt-1">Exécution réelle sur {repoFull !== "aucun repo" ? repoFull : "votre repo"} + serveur Hetzner</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 max-w-md mx-auto" data-testid="quick-commands-grid">
                {QUICK_COMMANDS.map(qc => (
                  <button key={qc.label} onClick={() => handleSend(qc.cmd)} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-gray-200/50 dark:bg-zinc-800/50 hover:bg-zinc-700/50 transition-all text-center group" data-testid={`quick-cmd-${qc.label.replace(/\s/g, '-').toLowerCase()}`}>
                    <span className="text-lg">{qc.icon}</span>
                    <span className="text-[10px] text-zinc-400 group-hover:text-zinc-200 leading-tight">{qc.label}</span>
                  </button>
                ))}
              </div>

              {contextSuggestions.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Suggestions pour l'onglet actif</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {contextSuggestions.map(s => (
                      <Button key={s.label} variant="outline" size="sm" className="text-[10px] rounded-xl border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/5" onClick={() => handleSend(s.cmd)} data-testid={`ctx-suggestion-${s.label.replace(/\s/g, '-').toLowerCase()}`}>
                        <Zap className="w-3 h-3 mr-1 text-emerald-400" />{s.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={cn("text-sm rounded-xl", msg.role === "user" ? "bg-emerald-500/10 ml-8 p-3" : "bg-zinc-800/60 mr-4 p-3")}>
              <p className="text-[10px] text-muted-foreground mb-1 font-medium">{msg.role === "user" ? "Vous" : "MaxAI"}</p>
              {msg.attachments?.map((a, j) => (
                <div key={j} className="mb-2">
                  {a.preview ? <img src={a.preview} alt={a.name} className="max-h-32 rounded-lg" /> : <Badge variant="outline" className="text-[10px]"><Paperclip className="w-2.5 h-2.5 mr-1" />{a.name}</Badge>}
                </div>
              ))}
              {msg.toolActivity && msg.toolActivity.length > 0 && (
                <div className="mb-3 rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 mb-1">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Actions MaxAI</span>
                    <span className="text-zinc-600">({msg.toolActivity.length})</span>
                  </div>
                  {msg.toolActivity.map((t, j) => (
                    <div key={j} className={`flex items-center gap-2.5 text-xs px-2 py-1.5 rounded-md transition-all ${t.status === "executing" ? "bg-amber-500/10 text-amber-300" : t.status === "done" ? "bg-emerald-500/5 text-zinc-300" : "bg-red-500/10 text-red-300"}`}>
                      {t.status === "executing" ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" /> : t.status === "done" ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                      <span className="flex-1">{t.label || t.tool}</span>
                      {t.durationMs != null && <span className="text-[10px] text-zinc-500 tabular-nums">{(t.durationMs / 1000).toFixed(1)}s</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="prose prose-sm prose-invert max-w-none text-sm">
                <MarkdownContent content={msg.content} />
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> MaxAI reflechit...
            </div>
          )}
        </div>
      </ScrollArea>

      {attachments.length > 0 && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {attachments.map((a, i) => (
            <div key={i} className="relative group">
              {a.type.startsWith("image/") ? (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
                  <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover" />
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`button-remove-attachment-${i}`}><X className="w-2.5 h-2.5 text-white" /></button>
                </div>
              ) : (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Paperclip className="w-2.5 h-2.5" />
                  {a.name.length > 20 ? a.name.slice(0, 17) + "..." : a.name}
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="ml-1 hover:text-destructive" data-testid={`button-remove-attachment-${i}`}><X className="w-2.5 h-2.5" /></button>
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showQuickCmds && messages.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 bg-zinc-900/50 rounded-lg border border-zinc-800" data-testid="quick-commands-inline">
              {QUICK_COMMANDS.map(qc => (
                <button key={qc.label} onClick={() => { handleSend(qc.cmd); setShowQuickCmds(false); }} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-emerald-500/40 active:scale-95 transition-all text-left cursor-pointer" disabled={isLoading} data-testid={`inline-cmd-${qc.label.replace(/\s/g, '-').toLowerCase()}`}>
                  <span className="text-base">{qc.icon}</span>
                  <span className="text-xs text-zinc-300 leading-tight truncate">{qc.label}</span>
                </button>
              ))}
            </div>
            {contextSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {contextSuggestions.map(s => (
                  <button key={s.label} onClick={() => { handleSend(s.cmd); setShowQuickCmds(false); }} className="text-[10px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all" disabled={isLoading}>
                    <Zap className="w-2.5 h-2.5 inline mr-0.5" />{s.label}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 mt-3">
        <Button type="button" size="icon" variant="ghost" className="rounded-xl shrink-0" onClick={() => fileInputRef.current?.click()} data-testid="button-attach-file">
          <Paperclip className="w-4 h-4" />
        </Button>
        {messages.length > 0 && (
          <Button type="button" size="icon" variant="ghost" className={cn("rounded-xl shrink-0", showQuickCmds && "bg-emerald-500/10 text-emerald-400")} onClick={() => setShowQuickCmds(p => !p)} data-testid="button-toggle-quick-cmds">
            <Zap className="w-4 h-4" />
          </Button>
        )}
        <Input value={input} onChange={e => setInput(e.target.value)} onPaste={handlePaste} placeholder={isLoading ? "MaxAI exécute..." : "Collez ou tapez ici..."} disabled={isLoading} className="flex-1 rounded-xl" data-testid="input-devops-chat" />
        <Button type="submit" size="icon" className="rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:opacity-90 text-white border-0" disabled={(!input.trim() && attachments.length === 0) || isLoading} data-testid="button-send-devops">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

