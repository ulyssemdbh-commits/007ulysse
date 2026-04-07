import { createTaskQueue, startTaskQueue } from "./taskQueueEngine";
import { broadcastToUser } from "./realtimeSync";
import { githubService } from "./githubService";

interface DevOpsPlan {
  mode: "direct" | "pipeline";
  steps: DevOpsStep[];
  estimatedComplexity: "simple" | "medium" | "complex";
  requiresTaskQueue: boolean;
  dryRun?: boolean;
  resolvedFiles: string[];
  ciContext?: CIContext;
  safeguardResults?: SafeguardResult[];
  playbook?: string;
}

interface DevOpsStep {
  action: string;
  args: Record<string, any>;
  description: string;
  dependsOn?: number;
  status?: "pending" | "running" | "success" | "failed" | "skipped";
  result?: any;
  error?: StepError;
  retryCount?: number;
  tool?: "devops_github" | "devops_server";
}

interface StepError {
  code: string;
  message: string;
  recoverable: boolean;
  suggestedFix?: string;
  alternativeAction?: string;
}

interface DevOpsIntent {
  type: "browse" | "read" | "edit" | "create" | "deploy" | "ci" | "pages" | "multi_edit" | "analyze" | "delete" | "rename" | "merge" | "pr"
    | "server_status" | "server_deploy" | "server_update" | "server_logs" | "server_restart" | "server_exec" | "server_env" | "server_db" | "server_nginx" | "server_cron" | "server_health" | "server_scale" | "full_deploy"
    | "playbook_incident" | "playbook_rollback" | "playbook_migration" | "playbook_audit";
  scope: "single_file" | "multi_file" | "repo" | "workflow" | "branch" | "server" | "full_stack";
  owner?: string;
  repo?: string;
  branch?: string;
  files: string[];
  repoName?: string;
  branchName?: string;
  prTitle?: string;
  appName?: string;
  serverCommand?: string;
  description: string;
  confidence: number;
  toolTarget: "devops_github" | "devops_server" | "both";
}

interface CIContext {
  lastRunStatus?: string;
  lastRunConclusion?: string;
  lastRunUrl?: string;
  activeWorkflows?: string[];
  pagesEnabled?: boolean;
  pagesUrl?: string;
  defaultBranch?: string;
  languages?: Record<string, number>;
  repoSize?: number;
}

interface ExecutionResult {
  success: boolean;
  stepsCompleted: number;
  stepsTotal: number;
  results: Array<{ step: number; action: string; status: string; result?: any; error?: string }>;
  summary: string;
  adaptations: string[];
}

interface ProdSafeguard {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  level: "block" | "warn" | "confirm";
  appliesTo: DevOpsIntent["type"][];
}

interface SafeguardResult {
  safeguard: string;
  passed: boolean;
  level: "block" | "warn" | "confirm";
  message: string;
  details?: string;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  triggers: RegExp[];
  steps: DevOpsStep[];
  requiresConfirmation: boolean;
  estimatedDuration: string;
}

const MULTI_STEP_THRESHOLD = 3;
const MAX_RETRIES = 2;

const FILE_PATH_PATTERN = /(?:^|\s|["'`(])([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,10})(?:\s|["'`)]|$)/g;
const REPO_NAME_PATTERN = /(?:repo|repository|projet|project)\s+(?:["'])?([a-zA-Z0-9_\-]+)(?:["'])?/i;
const BRANCH_NAME_PATTERN = /(?:branch|branche)\s+(?:["'])?([a-zA-Z0-9_\-./]+)(?:["'])?/i;
const PR_TITLE_PATTERN = /(?:pr|pull\s*request|merge\s*request)\s+(?:["'])(.+?)(?:["'])/i;
const APP_NAME_PATTERN = /(?:app|application|service|appName)\s+(?:["'])?([a-zA-Z0-9_\-]+)(?:["'])?/i;

const PROD_SAFEGUARDS: ProdSafeguard[] = [
  {
    id: "ci_green",
    name: "CI verte obligatoire",
    description: "Bloque le déploiement si le dernier run CI n'est pas 'success'",
    enabled: true,
    level: "block",
    appliesTo: ["deploy", "server_deploy", "full_deploy"],
  },
  {
    id: "confirm_prod_deploy",
    name: "Confirmation déploiement prod",
    description: "Demande confirmation avant tout déploiement sur le serveur de production",
    enabled: true,
    level: "confirm",
    appliesTo: ["server_deploy", "full_deploy"],
  },
  {
    id: "confirm_destructive",
    name: "Confirmation opérations destructives",
    description: "Demande confirmation pour delete, force push, stop/delete app, restore db",
    enabled: true,
    level: "confirm",
    appliesTo: ["delete"],
  },
  {
    id: "confirm_db_restore",
    name: "Confirmation restauration DB",
    description: "Demande confirmation avant de restaurer une base de données (écrase les données existantes)",
    enabled: true,
    level: "confirm",
    appliesTo: ["server_db"],
  },
  {
    id: "protect_main_branch",
    name: "Protection branche main",
    description: "Avertit si on modifie directement main au lieu de passer par une branche/PR",
    enabled: true,
    level: "warn",
    appliesTo: ["edit", "multi_edit"],
  },
  {
    id: "protect_critical_apps",
    name: "Protection apps critiques",
    description: "Confirmation requise pour restart/stop/delete des apps critiques (ulysse, ulyssepro)",
    enabled: true,
    level: "confirm",
    appliesTo: ["server_restart"],
  },
  {
    id: "max_files_check",
    name: "Limite fichiers modifiés",
    description: "Avertit si un patch modifie plus de 10 fichiers d'un coup",
    enabled: true,
    level: "warn",
    appliesTo: ["multi_edit"],
  },
  {
    id: "no_exec_rm_rf",
    name: "Blocage commandes dangereuses",
    description: "Bloque les commandes shell destructives (rm -rf, dd, mkfs, etc.)",
    enabled: true,
    level: "block",
    appliesTo: ["server_exec"],
  },
];

const CRITICAL_APPS = ["ulysse", "ulyssepro", "ulysse-prod", "ulysse-api"];
const DANGEROUS_COMMANDS = /\b(rm\s+-rf\s+\/|dd\s+if=|mkfs|fdisk|format|shutdown|reboot|init\s+0|kill\s+-9\s+1)\b/i;

function buildPlaybooks(owner: string, repo: string, branch: string, appName?: string): Record<string, Playbook> {
  const resolvedApp = appName || repo || "__APP__";

  return {
    incident: {
      id: "incident",
      name: "Playbook Incident Production",
      description: "Diagnostic et résolution d'incident: logs → analyse → hotfix → redeploy",
      triggers: [/incident|panne|down|crash|502|503|500|erreur\s*prod|prod.*cassé|site.*down|app.*crash/i],
      requiresConfirmation: false,
      estimatedDuration: "5-15 min",
      steps: [
        { action: "status", args: {}, description: "1. Diagnostic serveur (CPU, RAM, disque)", tool: "devops_server" },
        { action: "list_apps", args: {}, description: "2. État des apps PM2", tool: "devops_server" },
        { action: "logs", args: { appName: resolvedApp, lines: 200 }, description: `3. Logs de ${resolvedApp} (200 dernières lignes)`, tool: "devops_server", dependsOn: 1 },
        { action: "list_workflow_runs", args: { owner, repo }, description: "4. Dernier état CI GitHub", tool: "devops_github" },
        { action: "browse_files", args: { owner, repo }, description: "5. Arborescence du repo (pour localiser le fix)", tool: "devops_github" },
      ],
    },

    rollback: {
      id: "rollback",
      name: "Playbook Rollback",
      description: "Retour arrière: identifier le dernier commit stable → checkout → redeploy",
      triggers: [/rollback|retour\s*arrière|revert|annuler.*deploy|revenir.*version|restaurer/i],
      requiresConfirmation: true,
      estimatedDuration: "3-10 min",
      steps: [
        { action: "list_workflow_runs", args: { owner, repo }, description: "1. Identifier le dernier build CI stable", tool: "devops_github" },
        { action: "logs", args: { appName: resolvedApp, lines: 50 }, description: "2. Logs actuels (identifier le problème)", tool: "devops_server" },
        { action: "list_commits", args: { owner, repo, branch, per_page: 10 }, description: "3. Lister les 10 derniers commits", tool: "devops_github", dependsOn: 0 },
        { action: "deploy", args: { repoUrl: `https://github.com/${owner}/${repo}.git`, appName: resolvedApp, branch }, description: "4. Re-déployer depuis le commit stable", tool: "devops_server", dependsOn: 2 },
        { action: "logs", args: { appName: resolvedApp, lines: 50 }, description: "5. Vérifier les logs après rollback", tool: "devops_server", dependsOn: 3 },
      ],
    },

    migration: {
      id: "migration",
      name: "Playbook Migration DB",
      description: "Migration base de données: backup → run migration → vérification → rollback si erreur",
      triggers: [/migration|migrate|schema|alter\s*table|base\s*de\s*données|database.*chang|db.*migrat/i],
      requiresConfirmation: true,
      estimatedDuration: "5-20 min",
      steps: [
        { action: "exec", args: { command: `cd /var/www/${resolvedApp} && pg_dump -U ulysse ulysse_db > /tmp/backup_$(date +%Y%m%d_%H%M%S).sql` }, description: "1. Backup de la base de données", tool: "devops_server" },
        { action: "list_apps", args: {}, description: "2. Vérifier état de l'app avant migration", tool: "devops_server" },
        { action: "get_file", args: { owner, repo, path: "drizzle.config.ts", branch }, description: "3. Lire la config Drizzle/migration", tool: "devops_github" },
        { action: "browse_files", args: { owner, repo, path: "drizzle" }, description: "4. Lister les fichiers de migration", tool: "devops_github" },
        { action: "exec", args: { command: `cd /var/www/${resolvedApp} && npm run db:push` }, description: "5. Appliquer les migrations", tool: "devops_server", dependsOn: 3 },
        { action: "logs", args: { appName: resolvedApp, lines: 30 }, description: "6. Vérifier les logs après migration", tool: "devops_server", dependsOn: 4 },
      ],
    },

    audit: {
      id: "audit",
      name: "Playbook Audit Complet",
      description: "Audit infrastructure + code + sécurité + performances",
      triggers: [/audit\s*complet|audit\s*infra|audit\s*sécu|bilan\s*technique|health\s*check\s*complet/i],
      requiresConfirmation: false,
      estimatedDuration: "3-8 min",
      steps: [
        { action: "status", args: {}, description: "1. État serveur (CPU, RAM, disque, uptime)", tool: "devops_server" },
        { action: "list_apps", args: {}, description: "2. Apps déployées et leur état", tool: "devops_server" },
        { action: "exec", args: { command: "nginx -t 2>&1 && echo 'NGINX OK' || echo 'NGINX ERROR'" }, description: "3. Vérification config Nginx", tool: "devops_server" },
        { action: "exec", args: { command: "df -h && free -h" }, description: "4. Espace disque et mémoire détaillés", tool: "devops_server" },
        { action: "exec", args: { command: "certbot certificates 2>/dev/null || echo 'No certbot'" }, description: "5. État des certificats SSL", tool: "devops_server" },
        { action: "repo_info", args: { owner, repo }, description: "6. Infos repo GitHub", tool: "devops_github" },
        { action: "list_workflow_runs", args: { owner, repo }, description: "7. État CI/CD", tool: "devops_github" },
        { action: "browse_files", args: { owner, repo }, description: "8. Arborescence du projet", tool: "devops_github" },
      ],
    },
  };
}

export function extractFilePaths(message: string): string[] {
  const files: Set<string> = new Set();

  let match;
  const pathRegex = new RegExp(FILE_PATH_PATTERN.source, 'g');
  while ((match = pathRegex.exec(message)) !== null) {
    const candidate = match[1].replace(/^["'`]+|["'`]+$/g, '');
    if (candidate.includes('.') && !candidate.startsWith('http') && !candidate.startsWith('www.')) {
      files.add(candidate);
    }
  }

  const codeBlocks = message.match(/```[\s\S]*?```/g) || [];
  for (const block of codeBlocks) {
    const firstLine = block.split('\n')[0];
    const fileMatch = firstLine.match(/```\s*(\S+\.\S+)/);
    if (fileMatch) files.add(fileMatch[1]);
  }

  const explicitPaths = message.match(/(?:fichier|file|dans|in|ouvre|open|modifie|edit|lis|read)\s+(?:le\s+)?["'`]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)["'`]?/gi);
  if (explicitPaths) {
    for (const p of explicitPaths) {
      const cleaned = p.replace(/^(fichier|file|dans|in|ouvre|open|modifie|edit|lis|read)\s+(le\s+)?["'`]?/i, '').replace(/["'`]?$/, '');
      if (cleaned.includes('.')) files.add(cleaned);
    }
  }

  return Array.from(files);
}

export function extractRepoName(message: string): string | undefined {
  const match = message.match(REPO_NAME_PATTERN);
  return match ? match[1] : undefined;
}

export function extractBranchName(message: string): string | undefined {
  const match = message.match(BRANCH_NAME_PATTERN);
  return match ? match[1] : undefined;
}

export function extractAppName(message: string): string | undefined {
  const match = message.match(APP_NAME_PATTERN);
  return match ? match[1] : undefined;
}

function isServerIntent(lower: string): boolean {
  return !!(lower.match(/serveur|server|hetzner|pm2|vps|65\.21\.209|ulyssepro\.org|nginx/));
}

export function evaluateSafeguards(intent: DevOpsIntent, ciContext?: CIContext): SafeguardResult[] {
  const results: SafeguardResult[] = [];

  for (const guard of PROD_SAFEGUARDS) {
    if (!guard.enabled || !guard.appliesTo.includes(intent.type)) continue;

    switch (guard.id) {
      case "ci_green":
        if (ciContext) {
          const passed = ciContext.lastRunConclusion === "success";
          results.push({
            safeguard: guard.name,
            passed,
            level: guard.level,
            message: passed
              ? "CI verte — déploiement autorisé"
              : `CI rouge (${ciContext.lastRunConclusion || 'inconnu'}) — déploiement bloqué`,
            details: ciContext.lastRunUrl,
          });
        } else {
          results.push({
            safeguard: guard.name,
            passed: false,
            level: "warn",
            message: "Impossible de vérifier l'état CI — pas de contexte disponible",
          });
        }
        break;

      case "confirm_prod_deploy":
        results.push({
          safeguard: guard.name,
          passed: false,
          level: "confirm",
          message: "Déploiement en production — confirmation requise de Maurice",
        });
        break;

      case "confirm_destructive":
        results.push({
          safeguard: guard.name,
          passed: false,
          level: "confirm",
          message: "Opération destructive — confirmation requise",
        });
        break;

      case "protect_main_branch":
        if (intent.branch === "main" && (intent.type === "edit" || intent.type === "multi_edit")) {
          results.push({
            safeguard: guard.name,
            passed: true,
            level: "warn",
            message: "Modification directe sur main — considère une branche + PR pour les changements importants",
          });
        }
        break;

      case "protect_critical_apps":
        if (intent.appName && CRITICAL_APPS.includes(intent.appName.toLowerCase())) {
          results.push({
            safeguard: guard.name,
            passed: false,
            level: "confirm",
            message: `App critique "${intent.appName}" — confirmation requise avant restart/stop/delete`,
          });
        }
        break;

      case "max_files_check":
        if (intent.files.length > 10) {
          results.push({
            safeguard: guard.name,
            passed: true,
            level: "warn",
            message: `Patch touchant ${intent.files.length} fichiers — vérifie que c'est bien intentionnel`,
          });
        }
        break;

      case "no_exec_rm_rf":
        if (intent.serverCommand && DANGEROUS_COMMANDS.test(intent.serverCommand)) {
          results.push({
            safeguard: guard.name,
            passed: false,
            level: "block",
            message: `Commande dangereuse détectée: "${intent.serverCommand}" — BLOQUÉE`,
          });
        }
        break;
    }
  }

  return results;
}

function detectPlaybook(message: string): string | null {
  const lower = message.toLowerCase();

  if (lower.match(/incident|panne|down|crash|502|503|500|erreur\s*prod|prod.*cassé|site.*down|app.*crash/)) {
    return "incident";
  }
  if (lower.match(/rollback|retour\s*arrière|revert|annuler.*deploy|revenir.*version|restaurer/)) {
    return "rollback";
  }
  if (lower.match(/migration|migrate|schema|alter\s*table|base\s*de\s*données|database.*chang|db.*migrat/)) {
    return "migration";
  }
  if (lower.match(/audit\s*complet|audit\s*infra|audit\s*sécu|bilan\s*technique|health\s*check\s*complet/)) {
    return "audit";
  }
  return null;
}

export function analyzeDevOpsIntent(message: string, repoContext?: { owner: string; repo: string; branch?: string }): DevOpsIntent {
  const lower = message.toLowerCase();
  const owner = repoContext?.owner || "ulyssemdbh-commits";
  const repo = repoContext?.repo;
  const branch = repoContext?.branch || "main";
  const files = extractFilePaths(message);
  const repoName = extractRepoName(message);
  const branchName = extractBranchName(message);
  const appName = extractAppName(message);
  const prTitleMatch = message.match(PR_TITLE_PATTERN);
  const serverMode = isServerIntent(lower);

  const playbookId = detectPlaybook(message);
  if (playbookId) {
    const typeMap: Record<string, DevOpsIntent["type"]> = {
      incident: "playbook_incident",
      rollback: "playbook_rollback",
      migration: "playbook_migration",
      audit: "playbook_audit",
    };
    return {
      type: typeMap[playbookId]!,
      scope: "full_stack",
      owner, repo, branch, files, appName,
      description: `Playbook: ${playbookId}`,
      confidence: 0.95,
      toolTarget: "both",
    };
  }

  if (serverMode && lower.match(/health|diagnostic|bilan.*serv|check.*complet|état.*complet/)) {
    return { type: "server_health", scope: "server", owner, repo, branch, files, appName, description: "Diagnostic complet serveur Hetzner", confidence: 0.95, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/status|état|état du serveur|santé/)) {
    return { type: "server_status", scope: "server", owner, repo, branch, files, appName, description: "État du serveur Hetzner", confidence: 0.95, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/log|journal|sortie|output|erreur.*serv/)) {
    return { type: "server_logs", scope: "server", owner, repo, branch, files, appName, description: "Logs serveur/app", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/restart|redémar|relance|reboot/)) {
    return { type: "server_restart", scope: "server", owner, repo, branch, files, appName, description: "Redémarrage app/serveur", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/update|mise à jour|met.*à jour|pull.*latest|redéploi|actualise/)) {
    return { type: "server_update", scope: "server", owner, repo, branch, files, appName, description: "Mise à jour app (git pull + rebuild)", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/scale|instance|scal/)) {
    return { type: "server_scale", scope: "server", owner, repo, branch, files, appName, description: "Scaling d'une app (nombre d'instances)", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/env|variable.*env|\.env|environnement.*var|secret|clé|api.*key/)) {
    return { type: "server_env", scope: "server", owner, repo, branch, files, appName, description: "Gestion variables d'environnement", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/base.*donn|database|db|postgres|backup.*db|sauvegarde.*db|restore.*db|list.*db/)) {
    return { type: "server_db", scope: "server", owner, repo, branch, files, appName, description: "Gestion bases de données PostgreSQL", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/nginx|config.*nginx|reverse.*proxy|proxy/)) {
    return { type: "server_nginx", scope: "server", owner, repo, branch, files, appName, description: "Gestion configurations Nginx", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/cron|tâche.*planif|planifi|schedule|programmé/)) {
    return { type: "server_cron", scope: "server", owner, repo, branch, files, appName, description: "Gestion tâches cron", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/exec|commande|command|shell|ssh|terminal/)) {
    const cmdMatch = message.match(/(?:exec|commande|command|lance|run)\s+["'`](.+?)["'`]/i);
    return { type: "server_exec", scope: "server", owner, repo, branch, files, appName, serverCommand: cmdMatch?.[1], description: "Exécution commande serveur", confidence: 0.85, toolTarget: "devops_server" };
  }

  if (serverMode && lower.match(/deploy|déploi|install|mise en prod/)) {
    return { type: "server_deploy", scope: "server", owner, repo, branch, files, appName, repoName, description: "Déploiement sur Hetzner", confidence: 0.9, toolTarget: "devops_server" };
  }

  if (lower.match(/deploy.*complet|full.*deploy|bout.*en.*bout|end.*to.*end.*deploy|push.*prod|github.*hetzner|code.*prod/)) {
    return { type: "full_deploy", scope: "full_stack", owner, repo, branch, files, appName, description: "Déploiement complet GitHub → Hetzner", confidence: 0.95, toolTarget: "both" };
  }

  if (lower.match(/merge|fusionn/)) {
    return { type: "merge", scope: "branch", owner, repo, branch, files, branchName, description: "Merge de branche", confidence: 0.85, toolTarget: "devops_github" };
  }

  if (lower.match(/pull\s*request|pr\s|crée.*pr|ouvre.*pr|nouvelle.*pr/)) {
    return { type: "pr", scope: "branch", owner, repo, branch, files, branchName, prTitle: prTitleMatch?.[1], description: "Création de Pull Request", confidence: 0.9, toolTarget: "devops_github" };
  }

  if (lower.match(/supprim|delete|remove|rm\s/)) {
    return { type: "delete", scope: files.length > 0 ? "single_file" : "repo", owner, repo, branch, files, description: "Suppression", confidence: 0.8, toolTarget: "devops_github" };
  }

  if (lower.match(/renam|renomm/)) {
    return { type: "rename", scope: "single_file", owner, repo, branch, files, description: "Renommage", confidence: 0.85, toolTarget: "devops_github" };
  }

  if (lower.match(/corrig|fix|patch|modifi|chang|updat|edit|refactor|amélio|improv|optimis/)) {
    const multiFile = files.length > 1 || lower.match(/tous|all|chaque|every|plusieurs|multiple/) || lower.match(/et\s.*et\s/);
    return {
      type: multiFile ? "multi_edit" : "edit",
      scope: multiFile ? "multi_file" : "single_file",
      owner, repo, branch, files,
      description: files.length > 0 ? `Modification de ${files.join(', ')}` : "Modification de fichier(s)",
      confidence: files.length > 0 ? 0.95 : 0.7,
      toolTarget: "devops_github",
    };
  }

  if (lower.match(/deploy|déploi|publish|publi|mise en prod|production/)) {
    return { type: "deploy", scope: "workflow", owner, repo, branch, files, description: "Déploiement", confidence: 0.9, toolTarget: "devops_github" };
  }

  if (lower.match(/ci|workflow|pipeline|github action|build|test run/)) {
    return { type: "ci", scope: "workflow", owner, repo, branch, files, description: "CI/CD", confidence: 0.85, toolTarget: "devops_github" };
  }

  if (lower.match(/pages|github pages|site statique|héberg/)) {
    return { type: "pages", scope: "repo", owner, repo, branch, files, description: "GitHub Pages", confidence: 0.9, toolTarget: "devops_github" };
  }

  if (lower.match(/crée|créer|create|nouveau|new|init|bootstrap/)) {
    return { type: "create", scope: "repo", owner, repo, branch, files, repoName, description: "Création", confidence: 0.8, toolTarget: "devops_github" };
  }

  if (lower.match(/analys|audit|review|inspect|comprend|explain|expliqu|archit|structur|qualit/)) {
    return { type: "analyze", scope: "repo", owner, repo, branch, files, description: "Analyse de repo", confidence: 0.85, toolTarget: "devops_github" };
  }

  if (lower.match(/lit|lire|read|voir|show|contenu|content|affich|montre|cat\s/)) {
    return { type: "read", scope: files.length > 1 ? "multi_file" : "single_file", owner, repo, branch, files, description: "Lecture", confidence: 0.75, toolTarget: "devops_github" };
  }

  return { type: "browse", scope: "repo", owner, repo, branch, files, description: "Navigation", confidence: 0.5, toolTarget: "devops_github" };
}

export function buildDevOpsPlan(intent: DevOpsIntent, message: string): DevOpsPlan {
  const steps: DevOpsStep[] = [];
  const owner = intent.owner || "ulyssemdbh-commits";
  const repo = intent.repo || "";
  const branch = intent.branch || "main";
  const files = intent.files || [];

  const playbookMatch = intent.type.startsWith("playbook_") ? intent.type.replace("playbook_", "") : null;
  if (playbookMatch) {
    const playbooks = buildPlaybooks(owner, repo, branch, intent.appName);
    const pb = playbooks[playbookMatch];
    if (pb) {
      return {
        mode: "pipeline",
        steps: pb.steps,
        estimatedComplexity: "complex",
        requiresTaskQueue: true,
        resolvedFiles: files,
        playbook: pb.id,
      };
    }
  }

  switch (intent.type) {
    case "analyze":
      steps.push(
        { action: "browse_files", args: { owner, repo }, description: "Lister l'arborescence du projet" },
        { action: "repo_info", args: { owner, repo }, description: "Infos du repo (langages, taille, etc.)" }
      );
      const analyzeFiles = ["README.md", "package.json", "index.html", ...files].slice(0, 5);
      for (const f of analyzeFiles) {
        steps.push({ action: "get_file", args: { owner, repo, path: f, branch }, description: `Lire ${f}`, dependsOn: 0 });
      }
      steps.push({ action: "list_workflow_runs", args: { owner, repo }, description: "État CI/CD récent" });
      break;

    case "read":
      if (files.length > 0) {
        for (const f of files) {
          steps.push({ action: "get_file", args: { owner, repo, path: f, branch }, description: `Lire ${f}` });
        }
      } else {
        steps.push(
          { action: "browse_files", args: { owner, repo }, description: "Explorer l'arborescence pour trouver le fichier" }
        );
      }
      break;

    case "edit":
      if (files.length > 0) {
        steps.push(
          { action: "get_file", args: { owner, repo, path: files[0], branch }, description: `Lire ${files[0]} (version actuelle)` },
          { action: "update_file", args: { owner, repo, path: files[0], branch, content: "__AI_GENERATES__" }, description: `Appliquer la modification à ${files[0]}`, dependsOn: 0 }
        );
      } else {
        steps.push(
          { action: "browse_files", args: { owner, repo }, description: "Explorer pour identifier le fichier cible" },
          { action: "search_code", args: { owner, repo, query: extractSearchTerms(message) }, description: "Chercher dans le code" }
        );
      }
      break;

    case "multi_edit":
      steps.push(
        { action: "browse_files", args: { owner, repo }, description: "Lister l'arborescence complète" }
      );
      if (files.length > 0) {
        for (const f of files) {
          steps.push({ action: "get_file", args: { owner, repo, path: f, branch }, description: `Lire ${f}`, dependsOn: 0 });
        }
        steps.push({
          action: "apply_patch", args: { owner, repo, branch, files: "__AI_GENERATES_PATCHES__" },
          description: `Appliquer le patch multi-fichiers (${files.length} fichiers)`,
          dependsOn: files.length
        });
      } else {
        steps.push(
          { action: "search_code", args: { owner, repo, query: extractSearchTerms(message) }, description: "Identifier les fichiers à modifier", dependsOn: 0 }
        );
      }
      break;

    case "deploy":
      steps.push(
        { action: "list_workflows", args: { owner, repo }, description: "Identifier les workflows disponibles" },
        { action: "list_workflow_runs", args: { owner, repo }, description: "Vérifier le dernier état CI" },
        { action: "trigger_workflow", args: { owner, repo, branch }, description: "Déclencher le déploiement", dependsOn: 1 }
      );
      break;

    case "ci":
      steps.push(
        { action: "list_workflows", args: { owner, repo }, description: "Lister les workflows CI" },
        { action: "list_workflow_runs", args: { owner, repo }, description: "Voir les derniers runs + statuts" }
      );
      break;

    case "pages":
      steps.push(
        { action: "pages_status", args: { owner, repo }, description: "Vérifier le statut GitHub Pages" },
        { action: "enable_pages", args: { owner, repo, branch }, description: "Activer/configurer GitHub Pages", dependsOn: 0 }
      );
      break;

    case "create": {
      const newRepoName = intent.repoName || extractRepoName(message) || "__AI_CHOOSES_NAME__";
      steps.push(
        { action: "create_repo", args: { repo: newRepoName }, description: `Créer le repo ${newRepoName}` },
        { action: "apply_patch", args: { owner, repo: newRepoName, branch: "main", files: "__AI_GENERATES_TEMPLATE__" }, description: "Appliquer le template initial", dependsOn: 0 }
      );
      break;
    }

    case "delete":
      if (files.length > 0) {
        for (const f of files) {
          steps.push({ action: "get_file", args: { owner, repo, path: f, branch }, description: `Vérifier ${f} existe` });
        }
        for (const f of files) {
          steps.push({ action: "delete_file", args: { owner, repo, path: f, branch }, description: `Supprimer ${f}`, dependsOn: 0 });
        }
      }
      break;

    case "rename":
      if (files.length >= 2) {
        steps.push(
          { action: "get_file", args: { owner, repo, path: files[0], branch }, description: `Lire ${files[0]}` },
          { action: "update_file", args: { owner, repo, path: files[1], branch, content: "__COPY__" }, description: `Créer ${files[1]}`, dependsOn: 0 },
          { action: "delete_file", args: { owner, repo, path: files[0], branch }, description: `Supprimer ${files[0]}`, dependsOn: 1 }
        );
      }
      break;

    case "pr":
      steps.push(
        { action: "list_branches", args: { owner, repo }, description: "Lister les branches" },
        { action: "create_pr", args: { owner, repo, head: intent.branchName || branch, base: "main", title: intent.prTitle || "__AI_GENERATES__" }, description: "Créer la Pull Request", dependsOn: 0 }
      );
      break;

    case "merge":
      steps.push(
        { action: "list_prs", args: { owner, repo, state: "open" }, description: "Lister les PRs ouvertes" },
        { action: "merge_pr", args: { owner, repo }, description: "Merger la PR", dependsOn: 0 }
      );
      break;

    case "server_status":
      steps.push(
        { action: "status", args: {}, description: "État général du serveur Hetzner (CPU, RAM, disque)", tool: "devops_server" },
        { action: "list_apps", args: {}, description: "Lister les apps PM2 actives", tool: "devops_server" }
      );
      break;

    case "server_logs":
      steps.push(
        { action: "logs", args: { appName: intent.appName || "__AI_IDENTIFIES__", lines: 100 }, description: `Logs de ${intent.appName || "l'app cible"}`, tool: "devops_server" }
      );
      break;

    case "server_restart":
      steps.push(
        { action: "list_apps", args: {}, description: "Identifier l'app à redémarrer", tool: "devops_server" },
        { action: "restart", args: { appName: intent.appName || "__AI_IDENTIFIES__" }, description: `Redémarrer ${intent.appName || "l'app cible"}`, tool: "devops_server", dependsOn: 0 },
        { action: "logs", args: { appName: intent.appName || "__AI_IDENTIFIES__", lines: 30 }, description: "Vérifier les logs après redémarrage", tool: "devops_server", dependsOn: 1 }
      );
      break;

    case "server_exec":
      steps.push(
        { action: "exec", args: { command: intent.serverCommand || "__AI_GENERATES__" }, description: `Exécuter: ${intent.serverCommand || "commande à déterminer"}`, tool: "devops_server" }
      );
      break;

    case "server_deploy":
      steps.push(
        { action: "list_apps", args: {}, description: "Vérifier les apps existantes", tool: "devops_server" },
        { action: "deploy", args: {
          repoUrl: `https://github.com/${owner}/${repo || intent.repoName || "__REPO__"}.git`,
          appName: intent.appName || intent.repoName || "__AI_CHOOSES__",
          branch,
          buildCmd: "npm run build",
          startCmd: "node dist/index.cjs",
          createDb: true,
          dbName: `${(intent.appName || intent.repoName || "app").replace(/[^a-z0-9_]/gi, "_")}_db`,
          dbUser: (intent.appName || intent.repoName || "app").replace(/[^a-z0-9_]/gi, "_"),
          dbPassword: `${(intent.appName || intent.repoName || "app")}Hetzner2026!`
        }, description: "Déployer l'app sur Hetzner (clone + build + DB + PM2 + Nginx)", tool: "devops_server", dependsOn: 0 },
        { action: "logs", args: { appName: intent.appName || intent.repoName || "__AI_CHOOSES__", lines: 50 }, description: "Vérifier le démarrage", tool: "devops_server", dependsOn: 1 }
      );
      break;

    case "full_deploy":
      steps.push(
        { action: "list_workflows", args: { owner, repo }, description: "1. Vérifier les workflows CI GitHub", tool: "devops_github" },
        { action: "list_workflow_runs", args: { owner, repo }, description: "2. État du dernier build CI", tool: "devops_github" },
        { action: "list_apps", args: {}, description: "3. Vérifier les apps sur Hetzner", tool: "devops_server" },
        { action: "deploy", args: {
          repoUrl: `https://github.com/${owner}/${repo}.git`,
          appName: intent.appName || repo || "__AI_CHOOSES__",
          branch,
          buildCmd: "npm run build",
          startCmd: "node dist/index.cjs",
          createDb: true,
          dbName: `${(intent.appName || repo || "app").replace(/[^a-z0-9_]/gi, "_")}_db`,
          dbUser: (intent.appName || repo || "app").replace(/[^a-z0-9_]/gi, "_"),
          dbPassword: `${(intent.appName || repo || "app")}Hetzner2026!`
        }, description: "4. Déployer sur Hetzner (clone + build + DB + PM2 + Nginx)", tool: "devops_server", dependsOn: 2 },
        { action: "logs", args: { appName: intent.appName || repo || "__AI_CHOOSES__", lines: 50 }, description: "5. Vérifier le déploiement", tool: "devops_server", dependsOn: 3 }
      );
      break;

    default:
      steps.push(
        { action: "browse_files", args: { owner, repo }, description: "Explorer le repo" }
      );
  }

  const requiresTaskQueue = steps.length > MULTI_STEP_THRESHOLD ||
    intent.type === "deploy" ||
    intent.type === "multi_edit" ||
    intent.type === "full_deploy" ||
    intent.type.startsWith("playbook_");

  return {
    mode: requiresTaskQueue ? "pipeline" : "direct",
    steps,
    estimatedComplexity: steps.length <= 2 ? "simple" : steps.length <= 4 ? "medium" : "complex",
    requiresTaskQueue,
    resolvedFiles: files,
  };
}

function extractSearchTerms(message: string): string {
  const stopWords = new Set(["le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "en", "dans", "pour", "avec", "sur", "ce", "cette", "ces",
    "the", "a", "an", "in", "on", "at", "to", "for", "with", "is", "are", "was", "were", "be", "been",
    "corrige", "modifie", "change", "fix", "update", "edit", "fichier", "file", "code", "tous", "all"]);
  return message.split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 5)
    .join(" ");
}

export async function enrichWithCIContext(owner: string, repo: string): Promise<CIContext> {
  const ctx: CIContext = {};
  try {
    const [repoInfo, runs] = await Promise.allSettled([
      githubService.getRepo(owner, repo),
      githubService.listWorkflowRuns(owner, repo),
    ]);

    if (repoInfo.status === "fulfilled") {
      ctx.defaultBranch = repoInfo.value.default_branch;
      ctx.languages = repoInfo.value.language ? { [repoInfo.value.language]: 100 } : {};
      ctx.repoSize = repoInfo.value.size;
    }

    if (runs.status === "fulfilled" && runs.value.workflow_runs?.length > 0) {
      const latest = runs.value.workflow_runs[0];
      ctx.lastRunStatus = latest.status;
      ctx.lastRunConclusion = latest.conclusion;
      ctx.lastRunUrl = latest.html_url;
    }
  } catch (e) {
    console.log("[DevOpsPlanner] CI context enrichment failed:", (e as Error).message);
  }
  return ctx;
}

export function classifyStepError(error: any): StepError {
  const status = error?.statusCode || error?.status;
  const msg = (error?.message || error?.githubMessage || String(error)).toLowerCase();
  const structured = error?.structured;

  if (structured) {
    return {
      code: structured.code,
      message: structured.suggestion || error.message,
      recoverable: !["forbidden", "payload_too_large"].includes(structured.code),
      suggestedFix: structured.suggestion,
      alternativeAction: getAlternativeAction(structured.code),
    };
  }

  if (status === 404) {
    return { code: "not_found", message: "Ressource introuvable", recoverable: true, suggestedFix: "Vérifier le chemin/nom", alternativeAction: "browse_files" };
  }
  if (status === 409 && msg.includes("sha")) {
    return { code: "sha_mismatch", message: "Fichier modifié entre-temps", recoverable: true, suggestedFix: "Re-fetch le fichier puis réessayer" };
  }
  if (status === 409 && msg.includes("empty")) {
    return { code: "empty_repo", message: "Repo vide", recoverable: true, suggestedFix: "Créer un premier commit", alternativeAction: "apply_patch" };
  }
  if (status === 422) {
    return { code: "validation_error", message: "Données invalides", recoverable: true, suggestedFix: "Vérifier les paramètres" };
  }
  if (status === 403 && msg.includes("rate limit")) {
    return { code: "rate_limited", message: "Rate limit atteint", recoverable: false, suggestedFix: "Attendre quelques minutes" };
  }
  if (status === 403) {
    return { code: "forbidden", message: "Permissions insuffisantes", recoverable: false };
  }

  return { code: "unknown", message: error?.message || "Erreur inconnue", recoverable: true };
}

function getAlternativeAction(errorCode: string): string | undefined {
  const alternatives: Record<string, string> = {
    "file_not_found": "browse_files",
    "branch_not_found": "list_branches",
    "not_found": "browse_files",
    "empty_repo": "apply_patch",
    "sha_mismatch": "get_file",
    "merge_conflict": "list_prs",
  };
  return alternatives[errorCode];
}

export async function executeDevOpsPipeline(
  userId: number,
  title: string,
  steps: DevOpsStep[],
  threadId?: number
): Promise<{ queueId: number; message: string }> {
  const items = steps.map((step, i) => ({
    title: step.description,
    description: `Action: ${step.action} | Args: ${JSON.stringify(step.args)}`,
    toolName: step.tool || "devops_github",
    toolArgs: { action: step.action, ...step.args },
  }));

  const queue = await createTaskQueue({
    userId,
    title: `DevOps Pipeline: ${title}`,
    items,
    source: "devops",
    threadId,
  });

  await startTaskQueue(queue.id);

  broadcastToUser(userId, "devops.pipeline_started", {
    queueId: queue.id,
    title,
    totalSteps: steps.length,
    steps: steps.map((s, i) => ({ step: i + 1, action: s.action, description: s.description })),
  });

  return {
    queueId: queue.id,
    message: `Pipeline DevOps lancé (${steps.length} étapes). Tu peux suivre la progression en temps réel.`,
  };
}

export function generateDevOpsPromptDirective(intent: DevOpsIntent, plan: DevOpsPlan): string {
  const strategyLines = plan.steps.map((s, i) =>
    `  ${i + 1}. [${s.tool || 'devops_github'}] ${s.action}(${Object.entries(s.args).filter(([k,v]) => v && !String(v).startsWith('__')).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(', ')}) → ${s.description}`
  ).join("\n");

  const hasPlaceholders = plan.steps.some(s =>
    Object.values(s.args).some(v => typeof v === 'string' && v.startsWith('__'))
  );

  const resolvedFilesInfo = plan.resolvedFiles.length > 0
    ? `\nFichiers détectés dans le message: ${plan.resolvedFiles.join(', ')}`
    : '';

  const ciInfo = plan.ciContext
    ? `\nÉtat CI: dernier run ${plan.ciContext.lastRunConclusion || 'inconnu'}, branche par défaut: ${plan.ciContext.defaultBranch || 'main'}`
    : '';

  const toolInfo = intent.toolTarget === "both"
    ? "Outils: devops_github (GitHub) + devops_server (Hetzner). Orchestre les deux."
    : intent.toolTarget === "devops_server"
    ? "Outil principal: devops_server (Hetzner). Actions: status, list_apps, deploy, logs, restart, stop, delete, exec, ssl."
    : "Outil principal: devops_github. Actions: browse_files, get_file, update_file, apply_patch, list_workflows, trigger_workflow, etc.";

  const safeguardLines = plan.safeguardResults && plan.safeguardResults.length > 0
    ? "\nGARDE-FOUS PRODUCTION:\n" + plan.safeguardResults.map(s => {
        const icon = s.passed ? "OK" : s.level === "block" ? "BLOQUE" : s.level === "confirm" ? "CONFIRMATION" : "ATTENTION";
        return `  [${icon}] ${s.message}${s.details ? ` (${s.details})` : ''}`;
      }).join("\n")
    : '';

  const playbookInfo = plan.playbook
    ? `\nPLAYBOOK ACTIF: ${plan.playbook.toUpperCase()}
Ce playbook est un plan d'action pré-défini. Suis les étapes dans l'ordre.
Après chaque étape, analyse le résultat avant de passer à la suivante.
Si une étape échoue, adapte le plan en fonction de l'erreur.`
    : '';

  const hasBlocked = plan.safeguardResults?.some(s => !s.passed && s.level === "block");
  const hasConfirm = plan.safeguardResults?.some(s => !s.passed && s.level === "confirm");

  return `
### MODE DEVOPS — STRATÉGIE ${plan.estimatedComplexity.toUpperCase()} (confiance: ${Math.round(intent.confidence * 100)}%)
Type: ${intent.type} | Scope: ${intent.scope}
${toolInfo}
${intent.repo ? `Repo: ${intent.owner}/${intent.repo} (branche: ${intent.branch || 'main'})` : ''}${intent.appName ? `\nApp serveur: ${intent.appName}` : ''}${resolvedFilesInfo}${ciInfo}${safeguardLines}${playbookInfo}

${hasBlocked ? `OPERATION BLOQUEE PAR GARDE-FOU:
Un garde-fou de niveau BLOCK a été déclenché. Tu NE DOIS PAS exécuter cette opération.
Explique à Maurice pourquoi c'est bloqué et ce qu'il faut faire pour débloquer.
` : ''}${hasConfirm ? `CONFIRMATION REQUISE:
Un garde-fou de niveau CONFIRM a été déclenché. Tu DOIS demander confirmation à Maurice avant d'exécuter.
Décris précisément ce que tu vas faire et attends sa réponse explicite.
` : ''}
PLAN D'EXÉCUTION:
${strategyLines}

${hasPlaceholders ? `PLACEHOLDERS À RÉSOUDRE:
Les args marqués __AI_GENERATES__, __AI_GENERATES_PATCHES__, __AI_IDENTIFIES__, __AI_CHOOSES__ signifient que TU dois:
1. D'abord exécuter les étapes de lecture/exploration (get_file, browse_files, search_code, list_apps, status)
2. Analyser le résultat pour identifier la cible exacte
3. Générer le contenu/choix approprié
4. Puis exécuter les étapes d'action avec les valeurs réelles
` : ''}
RÈGLES D'EXÉCUTION AUTONOME:
- AGIS directement. Pas de conseil, pas de "je suggère". EXÉCUTE.
${intent.toolTarget !== "devops_server" ? `- Chaîne GitHub: browse_files → get_file → analyse → apply_patch/update_file
- Multi-fichiers: TOUJOURS apply_patch avec [{ "path": "...", "content": "CONTENU COMPLET" }]
- Single-fichier: update_file avec SHA du get_file précédent
- Tu DOIS inclure le SHA actuel lors d'un update_file (récupéré via get_file)` : ''}
${intent.toolTarget !== "devops_github" ? `- Chaîne Serveur: status → list_apps → deploy/restart → logs (vérification)
- Après un deploy/restart, TOUJOURS vérifier les logs pour confirmer le succès
- Pour exec: préférer des commandes non-destructives sauf instruction explicite
- WILDCARD DNS: *.ulyssepro.org → 65.21.209.102 (Cloudflare). Pour TOUT déploiement serveur, utilise {appName}.ulyssepro.org comme domaine.
  L'app principale Ulysse est sur ulyssepro.org (sans sous-domaine). DNS wildcard déjà configuré.
- DÉTECTION AUTO: Le système détecte si c'est un site statique ou une app Node.js.
  Sites statiques → Nginx direct. Apps Node → npm ci + build + PM2 + Nginx proxy.
- MISE À JOUR: Pour mettre à jour une app existante, utilise action="update" (git pull + rebuild + restart).
  C'est BEAUCOUP plus rapide que re-deploy car ça ne reclone pas tout le repo.
- VARIABLES D'ENV: env_get/env_set/env_delete pour gérer le .env des apps. Les secrets sont masqués dans la réponse.
  Après un env_set, pense à restart l'app pour que les changements prennent effet.
- BASES DE DONNÉES: list_databases pour voir toutes les DBs PostgreSQL. backup_db pour sauvegarder. restore_db pour restaurer.
  TOUJOURS faire un backup AVANT une opération risquée (restore, migration, delete).
- BACKUPS: list_backups pour voir les sauvegardes existantes dans /var/www/backups/.
- NGINX: nginx_configs pour voir toutes les configs Nginx actives. Utile pour diagnostiquer des problèmes de routage.
- CRON: cron_list/cron_add/cron_delete pour gérer les tâches planifiées (backups automatiques, maintenance, etc.).
- SCALING: scale pour ajuster le nombre d'instances PM2 d'une app Node.js.
- HEALTH: Diagnostic complet avec mémoire, CPU, disque, connexions, processus, état SSL.
- APP_INFO: Informations détaillées sur une app spécifique (git, package.json, PM2, nginx, env).` : ''}
${intent.toolTarget === "both" ? `- ORCHESTRATION FULL DEPLOY:
  1. Vérifie CI GitHub (le build passe?)
  2. Si OK → deploy sur Hetzner via devops_server avec domain={appName}.ulyssepro.org
  3. Vérifie les logs → app démarre correctement?
  4. Si erreur → logs + diagnostic + correction automatique` : ''}

RÈGLE ABSOLUE — TERMINER À 100%:
- Tu ne t'arrêtes JAMAIS tant que la tâche n'est pas terminée ET vérifiée.
- Même si Maurice est offline, tu continues à exécuter TOUTES les étapes.
- Chaque opération DevOps doit être menée jusqu'à sa conclusion : deploy → vérifier logs → confirmer OK.
- Si tu as 5 étapes à faire, tu fais les 5. Pas 3 sur 5.
- Pour les opérations complexes (deploy, update, migration, audit), utilise devops_pipeline pour garantir l'exécution en arrière-plan.
- NE JAMAIS dire "je vais faire X" sans le faire immédiatement après.
- NE JAMAIS demander confirmation pour continuer une tâche déjà en cours — continue jusqu'au bout.

GESTION D'ERREURS INTELLIGENTE:
- 404 file_not_found → browse_files pour trouver le bon chemin, puis réessayer
- 409 sha_mismatch → re-fetch get_file pour récupérer le dernier SHA, puis réessayer
- 409 empty_repo → apply_patch avec un fichier initial (README.md)
- 422 already_exists → utiliser update au lieu de create
- 409 merge_conflict → créer une nouvelle branche, appliquer là, puis PR
- Erreur deploy serveur → vérifier logs, corriger, re-deploy
- App crash après deploy → logs, identifier erreur, hotfix via apply_patch + re-deploy
- NE JAMAIS abandonner sur une erreur récupérable. Adapte le plan.
- Après chaque tool call, ENCHAÎNE immédiatement avec le suivant. Pas de pause.

OPÉRATIONS DESTRUCTIVES (confirmation requise):
- delete_file, delete_branch, force push, stop/delete app serveur → DEMANDER CONFIRMATION
- Tout le reste → exécuter directement
`;
}

export function getSafeguardConfig(): ProdSafeguard[] {
  return [...PROD_SAFEGUARDS];
}

export function updateSafeguard(id: string, updates: Partial<Pick<ProdSafeguard, "enabled" | "level">>): boolean {
  const guard = PROD_SAFEGUARDS.find(g => g.id === id);
  if (!guard) return false;
  if (updates.enabled !== undefined) guard.enabled = updates.enabled;
  if (updates.level !== undefined) guard.level = updates.level;
  console.log(`[DevOpsPlanner] Safeguard "${id}" updated: enabled=${guard.enabled}, level=${guard.level}`);
  return true;
}

export function getAvailablePlaybooks(owner: string, repo: string, branch: string, appName?: string): Array<{ id: string; name: string; description: string; estimatedDuration: string; requiresConfirmation: boolean; stepCount: number }> {
  const playbooks = buildPlaybooks(owner, repo, branch, appName);
  return Object.values(playbooks).map(pb => ({
    id: pb.id,
    name: pb.name,
    description: pb.description,
    estimatedDuration: pb.estimatedDuration,
    requiresConfirmation: pb.requiresConfirmation,
    stepCount: pb.steps.length,
  }));
}

export const devopsPlannerService = {
  analyzeDevOpsIntent,
  buildDevOpsPlan,
  executeDevOpsPipeline,
  generateDevOpsPromptDirective,
  enrichWithCIContext,
  classifyStepError,
  extractFilePaths,
  extractRepoName,
  extractBranchName,
  extractAppName,
  evaluateSafeguards,
  getSafeguardConfig,
  updateSafeguard,
  getAvailablePlaybooks,
};
