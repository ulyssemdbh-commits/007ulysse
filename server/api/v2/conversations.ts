import { Router, Request, Response } from "express";
import { db } from "../../db";
import { conversationThreads, conversationMessages, ulysseMemory, users } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";
import multer from "multer";
import path from "path";
import fs from "fs";
import { MemoryService } from "../../services/memory";
import { emitConversationsUpdated, isTalkingConnected, emitTalkingMessage } from "../../services/realtimeSync";
import { imageActionService } from "../../services/imageActionService";
import { faceRecognitionActionService } from "../../services/faceRecognitionActionService";
import { getPreloadedContext } from "../../services/context/preloader";
import { metricsService } from "../../services/metricsService";
import { voiceActivityService } from "../../services/voice";
import { contextCacheService } from "../../services/context/cache";
import { emailActionService } from "../../services/emailActionService";
import { autonomousResearchService } from "../../services/autonomousResearchService";
import { parseKanbanActions, executeKanbanActions } from "../../services/kanbanActionService";
import { broadcastToUser } from "../../services/realtimeSync";
import { integrationActionService } from "../../services/integrationActionService";
import { driveActionService } from "../../services/driveActionService";
import { notionActionService } from "../../services/notionActionService";
import { todoistActionService } from "../../services/todoistActionService";
import { ulysseToolsV2, executeToolCallV2, toolOrchestrator } from "../../services/ulysseToolsServiceV2";
import { detectActionIntent, shouldForceToolChoice, getRelevantTools } from "../../services/actionIntentDetector";
import { coreConversationIntegration } from "../../services/core/CoreConversationIntegration";
import { getBehaviorPrompt } from "../../config/ulysseBehaviorRules";
import { actionFirstOrchestrator, ActionFirstContext, PersonaType } from "../../services/actionFirstOrchestrator";
import { findMatchingStrategy } from "../../config/ulysseOptimumStrategies";
import { TOOL_SYNERGIES } from "../../config/ulysseConsciousness";
import { getCapabilitiesPrompt } from "../../config/ulysseCapabilities";
import { PERSONA_IDENTITIES } from "../../config/personaMapping";
import { unifiedMarkerExecutor, ExecutionSummary } from "../../services/unifiedMarkerExecutor";
import { hearingHub, voiceOutputHub, actionHub, brainHub, type HearingMetadata, type ProcessedHearing } from "../../services/sensory";
import { UlysseCoreEngine } from "../../services/core/UlysseCoreEngine";

const memoryService = new MemoryService();

const TOOL_RESULT_LIMITS: Record<string, number> = {
  browse_files: 8000,
  get_file: 20000,
  search_code: 10000,
  list_commits: 6000,
  list_prs: 6000,
  list_issues: 6000,
  debug_app: 10000,
  architecture_analyze: 12000,
  security_scan: 10000,
  profile_app: 8000,
  db_inspect: 8000,
  default: 15000,
};

function compressToolResult(rawResult: string, toolName?: string, toolArgs?: any): string {
  const limit = TOOL_RESULT_LIMITS[toolArgs?.action || ""] || TOOL_RESULT_LIMITS[toolName || ""] || TOOL_RESULT_LIMITS.default;
  if (rawResult.length <= limit) return rawResult;

  const action = toolArgs?.action || toolName || "tool";
  try {
    const parsed = JSON.parse(rawResult);

    if (action === "browse_files" && parsed.codeStructure) {
      for (const dir of Object.keys(parsed.codeStructure)) {
        const subs = parsed.codeStructure[dir];
        if (Array.isArray(subs) && subs.length > 20) {
          parsed.codeStructure[dir] = [...subs.slice(0, 15), `... +${subs.length - 15} more`];
        }
      }
      if (parsed.directories && parsed.directories.length > 30) {
        parsed.directories = [...parsed.directories.slice(0, 25), { name: "...", type: "summary", filesOmitted: parsed.directories.slice(25).reduce((s: number, d: any) => s + (d.files || 0), 0) }];
      }
      if (parsed.files && parsed.files.length > 20) {
        parsed.files = parsed.files.slice(0, 15);
        parsed.filesOmitted = true;
      }
      const compressed = JSON.stringify(parsed);
      if (compressed.length <= limit) return compressed;
    }

    if (action === "get_file" && parsed.content) {
      if (parsed.content.length > limit - 500) {
        parsed.content = parsed.content.slice(0, limit - 500);
        parsed.truncated = true;
        parsed.hint = "Fichier tronqué. Utilise get_file avec offset/limit pour lire la suite, ou search_code pour trouver un passage spécifique.";
        return JSON.stringify(parsed);
      }
    }

    if ((action === "list_commits" || action === "list_prs" || action === "list_issues") && Array.isArray(parsed)) {
      if (parsed.length > 20) {
        const trimmed = parsed.slice(0, 15);
        trimmed.push({ _summary: `${parsed.length - 15} entrées supplémentaires omises` });
        return JSON.stringify(trimmed);
      }
    }

    if (action === "debug_app" && typeof parsed === "object") {
      if (parsed.logs && typeof parsed.logs === "string" && parsed.logs.length > 5000) {
        const logLines = parsed.logs.split("\n");
        const errorLines = logLines.filter((l: string) => /error|ERR|fatal|crash|ENOENT|EACCES|TypeError|ReferenceError|SyntaxError/i.test(l));
        parsed.logs = errorLines.length > 0
          ? errorLines.slice(-30).join("\n") + `\n[... ${logLines.length} lignes total, ${errorLines.length} erreurs extraites]`
          : logLines.slice(-40).join("\n") + `\n[... ${logLines.length} lignes total, dernières 40 affichées]`;
        return JSON.stringify(parsed);
      }
    }
  } catch {}

  const truncated = rawResult.slice(0, limit);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > limit * 0.8 ? lastNewline : limit;
  console.log(`[V2-Compress] ${action} result compressed: ${rawResult.length} → ${cutPoint} chars`);
  return rawResult.slice(0, cutPoint) + `\n\n[... RÉSULTAT TRONQUÉ — ${rawResult.length} chars total. Cible des fichiers/dossiers spécifiques pour plus de détails.]`;
}

function compactOldToolResults(messages: any[], maxTotalChars: number = 80000): void {
  let totalToolChars = 0;
  const toolMsgIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "tool" && typeof messages[i].content === "string") {
      totalToolChars += messages[i].content.length;
      toolMsgIndices.push(i);
    }
  }
  if (totalToolChars <= maxTotalChars || toolMsgIndices.length <= 2) return;

  console.log(`[V2-ContextMgr] Tool results total: ${totalToolChars} chars across ${toolMsgIndices.length} messages — compacting old results`);
  const keepRecent = 3;
  const oldIndices = toolMsgIndices.slice(0, -keepRecent);
  for (const idx of oldIndices) {
    const content = messages[idx].content;
    if (content.length > 2000) {
      try {
        const parsed = JSON.parse(content);
        const keys = Object.keys(parsed);
        const summary: any = {};
        if (parsed.success !== undefined) summary.success = parsed.success;
        if (parsed.error) summary.error = parsed.error;
        if (parsed.path) summary.path = parsed.path;
        if (parsed.totalFiles) summary.totalFiles = parsed.totalFiles;
        if (parsed.totalDirs) summary.totalDirs = parsed.totalDirs;
        if (parsed.directories && Array.isArray(parsed.directories)) {
          summary.directories = parsed.directories.map((d: any) => d.name || d).slice(0, 10);
          if (parsed.directories.length > 10) summary.directoriesOmitted = parsed.directories.length - 10;
        }
        summary._compacted = true;
        summary._originalKeys = keys.slice(0, 8);
        messages[idx].content = JSON.stringify(summary);
        console.log(`[V2-ContextMgr] Compacted tool result at index ${idx}: ${content.length} → ${messages[idx].content.length} chars`);
      } catch {
        messages[idx].content = content.slice(0, 500) + `\n[... compacté — ${content.length} chars originaux]`;
      }
    }
  }
}

// Smart web search detection patterns for MARS
const realTimeSearchPatterns = [
  // Sports scores and results
  /\b(score|résultat|match)\b.*\b(hier|aujourd'hui|ce soir|la nuit dernière|last night|tonight|yesterday)\b/i,
  /\b(qui a gagné|who won|vainqueur)\b/i,
  /\b(ligue des champions|champions league|ldC|ligue 1|premier league|la liga|serie a|bundesliga)\b/i,
  // News and current events
  /\b(actualité|actualités|news|dernières nouvelles|breaking)\b/i,
  /\b(qu'est-ce qui se passe|what's happening)\b/i,
  // Financial
  /\b(bourse|action|cours|nasdaq|cac|crypto|bitcoin)\b/i,
  // Current info requests
  /\b(en ce moment|right now|actuellement|currently)\b/i,
  // Time-based questions (this week, today, tonight, etc.)
  /\b(cette semaine|ce week-end|ce mois|cette année|demain|hier)\b/i,
  /\b(today|tonight|this week|this month|this year|tomorrow|yesterday)\b/i,
  // Calendar/religious events questions
  /\b(parash[ao]|chabb?at|shabb?at|fête|calendrier hébraïque|calendrier juif)\b/i,
  /\b(ramadan|aïd|pâques|noël|hanoukka|pourim|kippour|rosh hashana)\b/i,
  // General knowledge with temporal context
  /\b(quel|quelle|quels|quelles)\b.{0,30}\b(aujourd'hui|cette semaine|ce mois|maintenant|prochain|prochaine)\b/i,
];

const searchTriggerKeywords = ["recherche", "google", "trouve moi", "cherche sur", "trouve sur", "sur internet", "sur le web"];

// Détecte si une requête a besoin d'informations externes (pour le fallback général)
function getToolLabel(toolName: string, args: any): string {
  const actionLabels: Record<string, string> = {
    create_repo: "Creation du repo",
    repo_info: "Lecture des infos du repo",
    list_branches: "Liste des branches",
    list_commits: "Liste des commits",
    list_prs: "Liste des pull requests",
    create_branch: "Creation de branche",
    create_pr: "Creation de pull request",
    merge_pr: "Merge de pull request",
    get_file: "Lecture du fichier",
    update_file: "Ecriture du fichier",
    delete_file: "Suppression du fichier",
    apply_patch: "Application du patch",
    browse_files: "Exploration des fichiers",
    list_workflows: "Liste des workflows",
    list_workflow_runs: "Liste des runs CI/CD",
    trigger_workflow: "Lancement du workflow",
    rerun_workflow: "Relance du workflow",
    cancel_workflow: "Annulation du workflow",
    list_repos: "Liste des repos",
    get_deploy_urls: "Lecture des URLs de deploy",
    set_deploy_urls: "Mise a jour des URLs de deploy",
  };

  if (toolName === "app_navigate") {
    const actions: Record<string, string> = {
      navigate: `📱 Navigation → ${args.page || 'accueil'}`,
      switch_tab: `📑 Onglet → ${args.tab || '?'}`,
      click_button: `🖱️ Clic → ${args.buttonId || args.elementId || '?'}`,
      scroll_to: `📜 Scroll → ${args.elementId || '?'}`,
      open_modal: `📋 Modal → ${args.modalId || '?'}`
    };
    return actions[args.action] || `Navigation: ${args.action}`;
  }
  if (toolName === "devops_github") {
    const action = args?.action || "";
    const label = actionLabels[action] || `Action: ${action}`;
    const detail = args?.path || args?.repo || args?.branchName || "";
    return detail ? `${label} (${detail})` : label;
  }

  const serverLabels: Record<string, string> = {
    status: "Etat du serveur",
    health: "Diagnostic complet",
    list_apps: "Liste des apps",
    app_info: "Infos de l'app",
    deploy: "Deploiement",
    update: "Mise a jour",
    logs: "Lecture des logs",
    restart: "Redemarrage",
    stop: "Arret de l'app",
    delete: "Suppression de l'app",
    scale: "Scaling de l'app",
    exec: "Execution commande",
    ssl: "Installation SSL",
    env_get: "Lecture des variables d'env",
    env_set: "Mise a jour des variables d'env",
    env_delete: "Suppression de variables d'env",
    list_databases: "Liste des bases de donnees",
    backup_db: "Sauvegarde de la base",
    restore_db: "Restauration de la base",
    list_backups: "Liste des sauvegardes",
    nginx_configs: "Configs Nginx",
    cron_list: "Liste des taches cron",
    cron_add: "Ajout tache cron",
    cron_delete: "Suppression tache cron",
  };
  if (toolName === "devops_server") {
    const action = args?.action || "";
    const label = serverLabels[action] || `Serveur: ${action}`;
    const detail = args?.appName || args?.dbName || args?.domain || "";
    return detail ? `${label} (${detail})` : label;
  }

  const toolLabels: Record<string, string> = {
    generate_file: "Generation de fichier",
    query_brain: "Consultation de la memoire",
    memory_save: "Sauvegarde en memoire",
    web_search: "Recherche web",
    calendar_read: "Lecture du calendrier",
    calendar_write: "Ecriture au calendrier",
    send_email: "Envoi d'email",
    read_emails: "Lecture des emails",
    todoist_manage: "Gestion des taches",
    task_queue_manage: "Gestion de la file de taches",
  };

  if (toolName === "task_queue_manage") {
    const action = args?.action || "";
    const actionMap: Record<string, string> = {
      create: "Creation de la file de taches",
      start: "Demarrage de la file",
      pause: "Pause de la file",
      status: "Etat de la file",
      list: "Liste des files",
    };
    return actionMap[action] || `File de taches: ${action}`;
  }

  return toolLabels[toolName] || toolName;
}

function detectInformationNeed(message: string): boolean {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/);
  
  // Skip very short messages or simple commands
  if (words.length <= 2) return false;
  const simpleCommands = /^(oui|non|ok|d'accord|merci|salut|bonjour|bonsoir|coucou|hey|yo)/.test(lower);
  if (simpleCommands) return false;
  
  // Patterns indicating need for external information
  const infoPatterns = [
    // Questions about facts, events, news
    /\b(qu(?:el|elle|els|elles|oi)|comment|pourquoi|où|quand|combien|qui est)\b/i,
    // Current events and real-time data
    /\b(aujourd'hui|ce soir|cette semaine|en ce moment|actuellement|dernière|dernières)\b/i,
    // Information requests
    /\b(info|infos|information|informations|nouvelles|actualité|news)\b/i,
    // Specific topics that need external data
    /\b(prix|coût|tarif|météo|temps|bourse|crypto|bitcoin|action|cours)\b/i,
    // Events, sports, entertainment
    /\b(match|concert|événement|sortie|film|série|album|artiste)\b/i,
    // Knowledge questions
    /\b(c'est quoi|qu'est-ce que|définition|signification|histoire de|biographie)\b/i,
    // Comparisons and recommendations
    /\b(meilleur|meilleure|mieux|comparer|versus|vs|différence entre)\b/i,
    // How-to and tutorials
    /\b(comment faire|tutoriel|guide|étapes pour|apprendre)\b/i,
    // Locations and directions
    /\b(adresse|horaires|ouvert|fermé|téléphone|contact)\b/i,
  ];
  
  return infoPatterns.some(p => p.test(lower));
}

function needsWebSearch(message: string): boolean {
  const lower = message.toLowerCase();
  const isShort = lower.split(/\s+/).length <= 3;
  const isCommand = /^(oui|non|ok|d'accord|merci|go|vas-y)/.test(lower);
  if (isShort || isCommand) return false;

  const devopsKeywords = ["repo", "librairie", "dossier", "fichier", "branche", "commit", "deploy", "serveur", "code", "github", "browse", "explore", "arborescence", "structure"];
  const isDevOpsContext = devopsKeywords.some(kw => lower.includes(kw));
  if (isDevOpsContext) return false;
  
  const hasRealTimeNeed = realTimeSearchPatterns.some(p => p.test(lower));
  const hasSearchKeyword = searchTriggerKeywords.some(kw => lower.includes(kw));
  
  return hasRealTimeNeed || hasSearchKeyword;
}

const uploadDir = "uploads/mobile";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Type de fichier non supporté"));
    }
  },
});

const router = Router();

import { getOllama, getGemini, getPrimaryAI, getOpenAINullable, getFallbackChain, OLLAMA_MODEL, getAIForContext, getFallbackChainForContext, markOpenAIDown, markOpenAIUp, type AIContext } from "../../services/core/openaiClient";

const conversationSchema = z.object({
  threadId: z.number().nullable().optional(),
  message: z.string().min(1),
  originDevice: z.string().optional(),
  browserSessionId: z.string().optional(),
  sessionContext: z.string().optional(),
  attachments: z.array(z.object({
    type: z.string(),
    url: z.string().optional(),
    name: z.string().optional(),
    data: z.string().optional(),
  })).optional(),
  contextHints: z.object({
    includeMemory: z.boolean().optional(),
    projectContext: z.string().optional(),
    devopsContext: z.string().optional(),
    systemHint: z.string().optional(),
    forceTools: z.array(z.string()).optional(),
    dgmActive: z.boolean().optional(),
    dgmSessionId: z.number().optional(),
    dgmObjective: z.string().optional(),
    dgmRepoContext: z.string().optional(),
    devmaxProjectId: z.string().optional(),
    suguContext: z.object({
      restaurant: z.enum(["valentine", "maillane"]),
      persona: z.enum(["ulysse", "alfred"]),
    }).optional(),
  }).optional(),
});

const activeSessionRequests = new Map<string, { abortController: AbortController; startTime: number; context: string }>();

function getSessionKey(userId: number, sessionContext: string): string {
  return `${userId}:${sessionContext}`;
}

function registerSessionRequest(userId: number, sessionContext: string): AbortController {
  const key = getSessionKey(userId, sessionContext);
  const controller = new AbortController();
  activeSessionRequests.set(key, {
    abortController: controller,
    startTime: Date.now(),
    context: sessionContext,
  });
  return controller;
}

function unregisterSessionRequest(userId: number, sessionContext: string): void {
  activeSessionRequests.delete(getSessionKey(userId, sessionContext));
}

function isSessionBusy(userId: number, sessionContext: string): boolean {
  const key = getSessionKey(userId, sessionContext);
  const existing = activeSessionRequests.get(key);
  if (!existing) return false;
  if (Date.now() - existing.startTime > 120000) {
    activeSessionRequests.delete(key);
    return false;
  }
  return true;
}

function getActiveSessionsForUser(userId: number): string[] {
  const sessions: string[] = [];
  for (const [key, val] of activeSessionRequests) {
    if (key.startsWith(`${userId}:`)) {
      sessions.push(val.context);
    }
  }
  return sessions;
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const body = conversationSchema.parse(req.body);
    const isStreaming = req.headers.accept === "text/event-stream";
    let threadId = body.threadId;

    const sessionContext = body.sessionContext
      || (body.contextHints?.devopsContext ? "devops" : "assistant");

    const activeSessions = getActiveSessionsForUser(userId);
    const thisBusy = isSessionBusy(userId, sessionContext);
    if (thisBusy) {
      console.log(`[V2-Session] ⚠️ Session "${sessionContext}" already active for user ${userId}, queuing`);
    }
    const otherActive = activeSessions.filter(s => s !== sessionContext);
    if (otherActive.length > 0) {
      console.log(`[V2-Session] 🔀 Parallel sessions for user ${userId}: [${sessionContext}] + [${otherActive.join(', ')}]`);
    }

    registerSessionRequest(userId, sessionContext);

    if (!threadId) {
      const [newThread] = await db.insert(conversationThreads).values({
        userId,
        title: body.message.slice(0, 50) + (body.message.length > 50 ? "..." : ""),
        originDevice: body.originDevice || "unknown",
        lastDevice: body.originDevice || "unknown",
        messageCount: 0,
      }).returning();
      threadId = newThread.id;
    }

    await db.insert(conversationMessages).values({
      threadId,
      userId,
      role: "user",
      content: body.message,
      modality: body.attachments?.length ? "mixed" : "text",
      attachments: body.attachments || [],
      metadata: { deviceId: body.originDevice, browserSessionId: body.browserSessionId, sessionContext },
    });

    const previousMessages = await db.select()
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(20);

    // Use full memory service with web searches (same as desktop)
    const isOwner = (req as any).isOwner ?? false;
    
    // Get user info for personalized assistant name (Ulysse for owner, Iris for approved users)
    const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userDisplayName = currentUser?.displayName || "Utilisateur";
    const userFirstName = userDisplayName.split(" ")[0];
    const userRole = currentUser?.role || "guest";
    // Access levels:
    // - hasFamilyAccess: Full access to family data (owner + approved family members)
    // - hasExternalAccess: Limited access, no family data (external users like Alfred)
    const isExternal = userRole === "external";
    const hasFamilyAccess = isOwner || userRole === "approved"; // Ulysse + Iris only
    const hasExternalAccess = isExternal; // Alfred only - NO family data access
    const hasFullAccess = hasFamilyAccess; // Keep for backward compatibility, but means family access only
    // Determine which persona to use: Ulysse (owner), Iris (approved family/work), Alfred (external users)
    const persona = isOwner ? "Ulysse" : isExternal ? "Max" : "Iris";

    const sessionCtx = body.sessionContext || (body.contextHints?.devopsContext ? "devops" : "assistant");
    const isDevMaxSession = sessionCtx === "devops" && (body.contextHints?.systemHint || "").includes("MAX");
    const isSuguSession = sessionCtx.startsWith("sugu_");
    let aiContext: AIContext;
    if (isDevMaxSession) {
      aiContext = "devmax";
    } else if (isSuguSession && !isOwner) {
      aiContext = "suguval";
    } else if (isExternal) {
      aiContext = "guest";
    } else if (sessionCtx === "devops" || body.contextHints?.devopsContext) {
      aiContext = "devops";
    } else if (persona === "Iris") {
      aiContext = "iris";
    } else {
      aiContext = "owner";
    }

    const _contextAI = getAIForContext(aiContext);
    const _contextFallbackChain = getFallbackChainForContext(aiContext);
    const openai = _contextAI.client;
    console.log(`[V2-CHAT] User: ${userDisplayName}, isOwner: ${isOwner}, role: ${userRole}, hasFamilyAccess: ${hasFamilyAccess}, isExternal: ${isExternal}, using: ${persona}`);
    console.log(`[V2-AI-ROUTE] Context: ${aiContext} → Provider: ${_contextAI.provider}, Model: ${_contextAI.model}, FallbackChain: [${_contextFallbackChain.map(f => f.provider).join(' → ')}]`);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SENSORY PIPELINE - Route message through HearingHub for unified processing
    // ═══════════════════════════════════════════════════════════════════════════
    let processedHearing: ProcessedHearing | null = null;
    let resolvedMessage = body.message;
    let brainResult: { decision: import("../../services/sensory/BrainHub").BrainDecision } | null = null;
    
    try {
      const hearingMetadata: HearingMetadata = {
        source: "web_chat",
        type: "text",
        timestamp: Date.now(),
        userId,
        persona: persona.toLowerCase() as "ulysse" | "iris" | "alfred",
        conversationId: threadId,
        messageHistory: previousMessages.slice(0, 5).reverse().map(m => ({
          role: m.role,
          content: m.content
        }))
      };
      
      processedHearing = await hearingHub.hear({
        content: body.message,
        metadata: hearingMetadata
      });
      
      resolvedMessage = processedHearing.resolvedContent;
      
      if (processedHearing.originalContent !== processedHearing.resolvedContent) {
        console.log(`[V2-SENSORY] Reference resolved: "${body.message.substring(0, 50)}" → "${resolvedMessage.substring(0, 50)}"`);
      }
      
      console.log(`[V2-SENSORY] HearingHub processed: intent=${processedHearing.intent?.domain || 'none'}, sentiment=${processedHearing.sentiment?.mood || 'neutral'}, shouldRouteToBrain=${processedHearing.shouldRouteToBrain}`);
      
      // ============== BRAIN HUB - CHEF D'ORCHESTRE ==============
      // Route input through BrainHub for decision making
      brainResult = await brainHub.processInput({
        content: resolvedMessage,
        source: 'web_chat',
        userId,
        persona: persona as 'ulysse' | 'iris' | 'alfred',
        isVoice: false,
        metadata: {
          conversationId: threadId,
          intent: processedHearing.intent,
          hearingSource: 'web_chat',
          domain: processedHearing.domain
        }
      });
      console.log(`[V2-SENSORY] BrainHub decision: ${brainResult.decision.action} (${(brainResult.decision.confidence * 100).toFixed(0)}%), domain: ${brainResult.decision.domain || 'generic'}, strategy: ${brainResult.decision.strategy || 'standard'}`);
      
    } catch (hearingErr) {
      console.error("[V2-SENSORY] HearingHub error (non-blocking):", hearingErr);
    }
    
    // Check if we have preloaded context (from voice/preload-context call)
    const preloadedCtx = getPreloadedContext(userId);
    const hasPreloadedContext = !!preloadedCtx;
    if (hasPreloadedContext) {
      console.log(`[V2-CHAT] Using preloaded context for user ${userId} (latency optimization)`);
    }
    
    let consciousnessContext = "";
    if (isOwner && hasPreloadedContext && preloadedCtx.consciousnessContext) {
      consciousnessContext = preloadedCtx.consciousnessContext;
      console.log(`[V2-CONSCIOUSNESS] Injecting consciousness context (${consciousnessContext.length} chars)`);
    } else if (isOwner) {
      try {
        const { generateConsciousnessPrompt } = await import("../../config/ulysseConsciousness");
        const { generateStrategiesPrompt } = await import("../../config/ulysseOptimumStrategies");
        consciousnessContext = generateConsciousnessPrompt() + "\n" + generateStrategiesPrompt();
        console.log(`[V2-CONSCIOUSNESS] Generated consciousness context on-demand (${consciousnessContext.length} chars)`);
      } catch (err) {
        console.error("[V2-CONSCIOUSNESS] Failed to generate consciousness context:", err);
      }
    }
    
    const memoryContext = body.contextHints?.includeMemory && hasFamilyAccess
      ? (hasPreloadedContext && preloadedCtx.memoryContext 
          ? preloadedCtx.memoryContext 
          : await memoryService.buildContextPromptWithSearches(userId, isOwner, undefined, userFirstName))
      : "";

    let recentConversationsContext = "";
    if (!isOwner && hasFamilyAccess) {
      try {
        recentConversationsContext = await memoryService.buildRecentConversationsContext(userId, threadId, 5);
        if (recentConversationsContext) {
          console.log(`[V2-MEMORY] Loaded cross-thread conversation context for ${userFirstName} (${recentConversationsContext.length} chars)`);
        }
      } catch (err) {
        console.error("[V2-MEMORY] Cross-thread context error:", err);
      }
    }

    // Always inject current time/date/weather context
    // Use preloaded if available, otherwise fetch
    let timeContext = "";
    if (hasPreloadedContext && preloadedCtx.timeContext) {
      timeContext = preloadedCtx.timeContext;
    } else {
      try {
        const { fetchMarseilleData } = await import("../../services/marseilleWeather");
        const marseilleData = await fetchMarseilleData();
        timeContext = `\n\n### CONTEXTE TEMPOREL ACTUEL (Marseille, France):\n- Heure: ${marseilleData.time}\n- Date: ${marseilleData.date}\n- Météo: ${marseilleData.weather.temperature}, ${marseilleData.weather.condition}\n`;
      } catch (err) {
        console.error("Failed to fetch time context:", err);
      }
    }

    // Inject Google Calendar events for today (family members only - NOT Alfred)
    // Use preloaded if available, otherwise fetch
    let calendarContext = "";
    if (hasFamilyAccess) {
      if (hasPreloadedContext && preloadedCtx.calendarContext) {
        calendarContext = preloadedCtx.calendarContext;
      } else {
        try {
          const { calendarService } = await import("../../services/googleCalendarService");
          const isConnected = await calendarService.isConnected(userId);
          if (isConnected) {
            const todayEvents = await calendarService.getTodayEvents(userId);
            if (todayEvents.length > 0) {
              calendarContext = `\n\n### CALENDRIER - ÉVÉNEMENTS DU JOUR:\n${calendarService.formatEventsForAI(todayEvents)}\n`;
            } else {
              calendarContext = `\n\n### CALENDRIER: Aucun événement prévu aujourd'hui.\n`;
            }
          }
        } catch (err) {
          console.error("Failed to fetch calendar context:", err);
        }
      }
    }

    const contentLower = body.message.toLowerCase();

    // Spotify context injection for music-related requests (family members only - NOT Alfred)
    // Use preloaded if available, otherwise fetch on demand
    const musicKeywords = ["musique", "music", "spotify", "joue", "play", "pause", "volume", "morceau", "chanson", "artiste", "album", "playlist", "suivant", "next", "précédent", "previous", "qu'est-ce qui joue", "what's playing"];
    const needsSpotify = musicKeywords.some(kw => contentLower.includes(kw));
    
    let spotifyContext = "";
    if (needsSpotify && hasFamilyAccess) {
      if (hasPreloadedContext && preloadedCtx.spotifyContext) {
        spotifyContext = preloadedCtx.spotifyContext;
        console.log(`[V2-SPOTIFY] Using preloaded context: ${spotifyContext.length} chars`);
      } else {
        try {
          const spotifyService = await import("../../services/spotifyService");
          const connected = await spotifyService.isSpotifyConnected();
          
          if (connected) {
            const playback = await spotifyService.getPlaybackState();
            const devices = await spotifyService.getAvailableDevices();
            
            if (playback && playback.trackName) {
              spotifyContext = `\n\n### SPOTIFY - LECTURE EN COURS:\n- Morceau: ${playback.trackName}\n- Artiste: ${playback.artistName}\n- Album: ${playback.albumName}\n- Statut: ${playback.isPlaying ? "▶️ En lecture" : "⏸️ En pause"}\n- Progression: ${Math.floor(playback.progressMs / 1000)}s / ${Math.floor(playback.durationMs / 1000)}s\n- Volume: ${playback.volumePercent}%\n- Appareil: ${playback.deviceName}\n`;
            } else {
              spotifyContext = `\n\n### SPOTIFY: Connecté mais aucune lecture en cours.\n`;
            }
            
            if (devices.length > 0) {
              spotifyContext += `\n**Appareils disponibles:**\n`;
              devices.forEach(d => {
                spotifyContext += `- ${d.name} (${d.type})${d.isActive ? " [ACTIF]" : ""}\n`;
              });
            }
            
            console.log(`[V2-SPOTIFY] Context injected: ${spotifyContext.length} chars`);
          } else {
            spotifyContext = `\n\n[Spotify non connecté - aller dans Intégrations pour connecter]`;
          }
        } catch (spotifyErr) {
          console.error("[V2-SPOTIFY] Context error:", spotifyErr);
        }
      }
    }

    // Screen monitoring context injection (family members only - NOT Alfred)
    let screenContext = "";
    if (hasFamilyAccess) {
      try {
        const { screenMonitorService } = await import("../../services/screenMonitorService");
        const prefs = await screenMonitorService.getPreferences(userId);
        const session = await screenMonitorService.getActiveSession(userId);
        
        if (prefs?.isEnabled) {
          if (session && session.status === "active") {
            const recentContext = await screenMonitorService.getRecentContext(userId, 1);
            if (recentContext.length > 0) {
              const latest = recentContext[0];
              screenContext = `\n\n### CONTEXTE ÉCRAN PC (surveillance active):\n- Activité actuelle: ${latest.context}\n- Tags: ${(latest.tags as string[])?.join(", ") || "aucun"}\n- Dernière analyse: ${latest.timestamp ? new Date(latest.timestamp).toLocaleTimeString("fr-FR") : "inconnue"}\n`;
            } else {
              screenContext = `\n\n### SURVEILLANCE ÉCRAN: Active, en attente de données de l'agent Windows.\n`;
            }
          } else {
            screenContext = `\n\n### SURVEILLANCE ÉCRAN: Activée mais agent Windows non connecté. L'utilisateur doit lancer ulysse_screen_agent.py sur son PC.\n`;
          }
        }
      } catch (screenErr) {
        console.error("[V2-SCREEN] Context error:", screenErr);
      }
    }

    // UI Dashboard snapshot context - Ulysse knows what Maurice sees
    let uiSnapshotContext = "";
    if (hasFamilyAccess) {
      try {
        const { uiSnapshots } = await import("@shared/schema");
        const { desc: descOrder, eq: eqOp } = await import("drizzle-orm");
        const recent = await db.select().from(uiSnapshots)
          .where(eqOp(uiSnapshots.userId, 1))
          .orderBy(descOrder(uiSnapshots.createdAt))
          .limit(3);
        if (recent.length > 0) {
          const last = recent[0];
          const actions = recent.map(s => `${s.actionType}:${s.elementClicked || s.currentPage}`).join(" → ");
          uiSnapshotContext = `\n\n### DASHBOARD TEMPS RÉEL:\n- Page actuelle: ${last.currentPage}${last.currentTab ? ` (onglet: ${last.currentTab})` : ""}${last.dialogOpen ? ` [Dialog ouvert: ${last.dialogOpen}]` : ""}\n- Dernières actions: ${actions}\n- Viewport: ${last.viewportWidth}x${last.viewportHeight}\n`;
        }
      } catch (snapErr: any) {
        console.error("[V2-UISNAPSHOT] Context error:", snapErr.message);
      }
    }

    // Geolocation context (family members only - NOT Alfred for privacy)
    // Use preloaded if available, otherwise fetch on demand
    let geolocationContext = "";
    if (hasFamilyAccess) {
      if (hasPreloadedContext && preloadedCtx.geolocationContext) {
        geolocationContext = preloadedCtx.geolocationContext;
        console.log(`[V2-GEO] Using preloaded context: ${geolocationContext.length} chars`);
      } else {
        try {
          const { locationPoints, geofences } = await import("@shared/schema");
          const [latestLocation] = await db.select()
            .from(locationPoints)
            .where(eq(locationPoints.userId, userId))
            .orderBy(desc(locationPoints.createdAt))
            .limit(1);
          
          if (latestLocation) {
            const locationAge = Date.now() - new Date(latestLocation.createdAt!).getTime();
            const ageMinutes = Math.floor(locationAge / 60000);
            if (ageMinutes < 60) {
              const lat = parseFloat(latestLocation.latitude);
              const lng = parseFloat(latestLocation.longitude);
              geolocationContext = `\n\n### POSITION ACTUELLE:\n- Coordonnées: ${lat.toFixed(4)}, ${lng.toFixed(4)}\n- Précision: ${latestLocation.accuracy || 'N/A'}m\n- Mise à jour: il y a ${ageMinutes < 1 ? 'moins d\'1 minute' : ageMinutes + ' minutes'}\n`;
            }
          }
          
          const activeGeofences = await db.select().from(geofences).where(eq(geofences.userId, userId)).limit(5);
          if (activeGeofences.length > 0) {
            geolocationContext += `\n**Géofences actives:** ${activeGeofences.map(g => g.name).join(", ")}\n`;
          }
        } catch (geoErr) {
          console.error("[V2-GEO] Context error:", geoErr);
        }
      }
    }

    // Smart Home context - on keyword trigger
    const homeKeywords = ["lumière", "light", "lampe", "allume", "éteins", "maison", "home", "thermostat", "température", "scène", "scene", "prise", "plug", "appareil", "device", "domotique"];
    const needsSmartHome = homeKeywords.some(kw => contentLower.includes(kw));
    
    let smartHomeContext = "";
    if (needsSmartHome && hasFamilyAccess) {
      try {
        const { smartDevices, smartScenes } = await import("@shared/schema");
        const devices = await db.select().from(smartDevices).where(eq(smartDevices.userId, userId)).limit(20);
        const scenes = await db.select().from(smartScenes).where(eq(smartScenes.userId, userId)).limit(10);
        
        if (devices.length > 0) {
          smartHomeContext = `\n\n### DOMOTIQUE - APPAREILS (${devices.length}):\n`;
          devices.forEach(d => {
            smartHomeContext += `- ${d.name} (${d.type}, ${d.room || 'sans pièce'}) - ${d.isOnline ? '🟢 En ligne' : '🔴 Hors ligne'}\n`;
          });
        }
        
        if (scenes.length > 0) {
          smartHomeContext += `\n**Scènes disponibles:** ${scenes.map(s => s.name).join(", ")}\n`;
        }
        
        console.log(`[V2-SMARTHOME] Context injected: ${smartHomeContext.length} chars`);
      } catch (homeErr) {
        console.error("[V2-SMARTHOME] Context error:", homeErr);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // FILE ATTACHMENT CONTENT EXTRACTION - Auto-extract content from uploaded files
    // ══════════════════════════════════════════════════════════════════
    let fileAttachmentContext = "";
    let visionImageParts: OpenAI.ChatCompletionContentPart[] = [];
    if (body.attachments && body.attachments.length > 0) {
      try {
        const { FileService } = await import("../../services/fileService");
        const fileService = new FileService();
        const path = await import("path");
        const fs = await import("fs");
        
        console.log(`[V2-FILES] Processing ${body.attachments.length} attachment(s)`);
        
        for (const attachment of body.attachments) {
          try {
            // Get file path from URL or data
            let filePath = "";
            let fileContent = "";
            
            if (attachment.url) {
              // File was uploaded to server - extract from URL
              // URL format: /uploads/mobile/filename or /api/files/xxx or attached_assets/xxx
              const urlPath = attachment.url.replace(/^\//, "");
              if (urlPath.startsWith("uploads/")) {
                filePath = path.join(process.cwd(), urlPath);
              } else if (urlPath.startsWith("attached_assets/")) {
                // Attached assets from Replit - direct path
                filePath = path.join(process.cwd(), urlPath);
              } else if (urlPath.startsWith("api/files/")) {
                // Object storage file - fetch from storage
                const fileId = urlPath.split("/").pop();
                if (fileId) {
                  const { userFiles } = await import("@shared/schema");
                  const [fileRecord] = await db.select()
                    .from(userFiles)
                    .where(eq(userFiles.id, parseInt(fileId)))
                    .limit(1);
                  if (fileRecord && fileRecord.localPath) {
                    filePath = fileRecord.localPath;
                  }
                }
              }
            }
            
            // Check if this is an image with base64 data — skip file lookup for images
            const attNameLower = (attachment.name || '').toLowerCase();
            const isImageAttachment = attachment.type?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(attNameLower);
            
            // Fallback: check if attachment.name matches a file in attached_assets (skip for images with base64 data)
            if (!filePath && attachment.name && !(isImageAttachment && attachment.data)) {
              const possibleAssetPath = path.join(process.cwd(), "attached_assets", attachment.name);
              if (fs.existsSync(possibleAssetPath)) {
                filePath = possibleAssetPath;
                console.log(`[V2-FILES] Found file in attached_assets: ${attachment.name}`);
              } else {
                // Try to find by partial name match (for timestamped filenames)
                const assetsDir = path.join(process.cwd(), "attached_assets");
                if (fs.existsSync(assetsDir)) {
                  const files = fs.readdirSync(assetsDir);
                  const baseName = attachment.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/\s+/g, "_");
                  const matchingFile = files.find(f => f.toLowerCase().includes(baseName));
                  if (matchingFile) {
                    filePath = path.join(assetsDir, matchingFile);
                    console.log(`[V2-FILES] Matched file in attached_assets: ${matchingFile}`);
                  }
                }
              }
            }
            
            if (filePath && fs.existsSync(filePath)) {
              console.log(`[V2-FILES] Reading file: ${attachment.name || filePath}`);
              
              const fileName = (attachment.name || filePath).toLowerCase();
              const isPDF = fileName.endsWith('.pdf') || filePath.endsWith('.pdf');
              const isVideo = /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(fileName);
              const isInvoicePDF = isPDF && (
                fileName.includes('facture') || 
                fileName.includes('invoice') ||
                fileName.includes('zouaghi') ||
                fileName.includes('metro') ||
                fileName.includes('promocash')
              );
              
              if (isPDF) {
                try {
                  const { visionService } = await import("../../services/visionService");
                  const visionResult = await visionService.pdfToImages(filePath, 5, 150);
                  if (visionResult.success && visionResult.pages.length > 0) {
                    for (const page of visionResult.pages) {
                      visionImageParts.push({
                        type: "image_url",
                        image_url: { url: page.imageBase64, detail: "high" },
                      });
                    }
                    fileAttachmentContext += `\n\n### 📄 PDF VISUEL: ${attachment.name || 'document.pdf'} (${visionResult.totalPages} pages)\n`;
                    fileAttachmentContext += `**Mode:** Vision directe — tu vois chaque page comme une image haute résolution.\n`;
                    console.log(`[V2-FILES] PDF Vision: ${visionResult.pages.length} pages sent as images (${visionResult.method})`);
                  }
                } catch (visionErr: any) {
                  console.warn(`[V2-FILES] PDF Vision failed: ${visionErr.message}, falling back to text`);
                }
              }

              if (isVideo) {
                try {
                  const { visionService } = await import("../../services/visionService");
                  const videoResult = await visionService.videoToFrames(filePath, 6, 2);
                  if (videoResult.success && videoResult.frames.length > 0) {
                    for (const frame of videoResult.frames) {
                      visionImageParts.push({
                        type: "image_url",
                        image_url: { url: frame.imageBase64, detail: "high" },
                      });
                    }
                    fileAttachmentContext += `\n\n### 🎥 VIDÉO ANALYSÉE: ${attachment.name || 'video'} (${videoResult.duration.toFixed(1)}s, ${videoResult.frames.length} frames)\n`;
                    fileAttachmentContext += `**Mode:** Vision directe — tu vois ${videoResult.frames.length} captures à intervalles réguliers.\n`;
                    const timestamps = videoResult.frames.map(f => `${f.timestamp}s`).join(", ");
                    fileAttachmentContext += `**Timestamps:** ${timestamps}\n`;
                    console.log(`[V2-FILES] Video Vision: ${videoResult.frames.length} frames from ${videoResult.duration.toFixed(1)}s video`);
                  }
                } catch (videoErr: any) {
                  console.warn(`[V2-FILES] Video Vision failed: ${videoErr.message}`);
                }
              }

              if (isInvoicePDF) {
                console.log(`[V2-FILES] Detected invoice PDF, using PRO extraction`);
                const { invoiceParserService } = await import("../../services/invoiceParserService");
                const result = await invoiceParserService.extractFromPDF(filePath);
                
                if (result.success && result.factures.length > 0) {
                  fileAttachmentContext += `\n\n${result.summary}`;
                  
                  if (result.validation.warnings.length > 0) {
                    fileAttachmentContext += `\n\n⚠️ **Avertissements:**\n${result.validation.warnings.map(w => `• ${w}`).join("\n")}`;
                  }
                  
                  let totalLignes = 0;
                  fileAttachmentContext += `\n\n## 📦 DÉTAIL DES ARTICLES PAR FACTURE:\n`;
                  for (const facture of result.factures) {
                    if (facture.lignes && facture.lignes.length > 0) {
                      totalLignes += facture.lignes.length;
                      fileAttachmentContext += `\n### Facture ${facture.numero} (${facture.date}) - ${facture.totalTTC.toFixed(2)}€ TTC\n`;
                      for (const ligne of facture.lignes) {
                        const ref = ligne.reference ? `[${ligne.reference}]` : '';
                        fileAttachmentContext += `• ${ref} **${ligne.designation}** | Qté: ${ligne.quantite} × ${ligne.prixUnitaireHT.toFixed(2)}€ = ${ligne.montantHT.toFixed(2)}€ (TVA ${ligne.tva}%)\n`;
                      }
                    }
                  }
                  fileAttachmentContext += `\n**TOTAL: ${result.factures.length} factures, ${totalLignes} lignes de produits, ${result.totaux.totalTTC.toFixed(2)}€ TTC**`;
                  console.log(`[V2-FILES] PRO extraction: ${result.factures.length} invoices, ${totalLignes} product lines, total ${result.totaux.totalTTC.toFixed(2)}€`);
                } else if (!isPDF || visionImageParts.length === 0) {
                  const analysis = await fileService.readFile(filePath);
                  if (analysis && analysis.content) {
                    const content = analysis.content;
                    fileAttachmentContext += `\n\n### FICHIER JOINT: ${attachment.name || analysis.fileName}\n`;
                    fileAttachmentContext += `**Type:** ${analysis.fileType}\n`;
                    fileAttachmentContext += `**Pages:** ${(analysis.metadata as any)?.pages || 'N/A'}\n`;
                    fileAttachmentContext += `**Contenu extrait COMPLET (${content.length} caractères):**\n\`\`\`\n${content}\n\`\`\`\n`;
                    console.log(`[V2-FILES] Invoice PDF FULL extraction: ${content.length} chars from ${attachment.name}`);
                  }
                }
              } else if (isPDF) {
                const analysis = await fileService.readFile(filePath);
                if (analysis && analysis.content) {
                  const maxContentLength = 15000;
                  let content = analysis.content;
                  if (content.length > maxContentLength) {
                    content = content.substring(0, maxContentLength) + `\n\n[... contenu tronqué (${analysis.content.length} caractères au total) ...]`;
                  }
                  fileAttachmentContext += `\n\n### FICHIER JOINT (texte): ${attachment.name || analysis.fileName}\n`;
                  fileAttachmentContext += `**Contenu extrait:**\n\`\`\`\n${content}\n\`\`\`\n`;
                  console.log(`[V2-FILES] PDF text extraction: ${content.length} chars from ${attachment.name}`);
                }
              } else if (!isVideo) {
                const analysis = await fileService.readFile(filePath);
                
                if (analysis && analysis.content) {
                  const maxContentLength = 15000;
                  let content = analysis.content;
                  if (content.length > maxContentLength) {
                    content = content.substring(0, maxContentLength) + `\n\n[... contenu tronqué (${analysis.content.length} caractères au total) ...]`;
                  }
                  
                  fileAttachmentContext += `\n\n### FICHIER JOINT: ${attachment.name || analysis.fileName}\n`;
                  fileAttachmentContext += `**Type:** ${analysis.fileType}\n`;
                  if (analysis.metadata) {
                    if ((analysis.metadata as any).pages) {
                      fileAttachmentContext += `**Pages:** ${(analysis.metadata as any).pages}\n`;
                    }
                    if ((analysis.metadata as any).sheets) {
                      fileAttachmentContext += `**Feuilles:** ${(analysis.metadata as any).sheets}\n`;
                    }
                  }
                  fileAttachmentContext += `**Contenu extrait:**\n\`\`\`\n${content}\n\`\`\`\n`;
                  
                  console.log(`[V2-FILES] Extracted ${content.length} chars from ${attachment.name}`);
                }
              }
            } else if (attachment.data) {
              const attName = (attachment.name || 'unnamed').toLowerCase();
              const isImage = attachment.type?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(attName);
              if (isImage && attachment.data.startsWith('data:')) {
                visionImageParts.push({
                  type: "image_url",
                  image_url: {
                    url: attachment.data,
                    detail: "high",
                  },
                });
                console.log(`[V2-FILES] Image added to vision: ${attachment.name || 'unnamed'}`);
              } else {
                console.log(`[V2-FILES] Base64 data found (non-image): ${attachment.name || 'unnamed file'}`);
              }
            } else {
              console.warn(`[V2-FILES] Could not locate file: ${attachment.url || attachment.name}`);
            }
          } catch (fileErr) {
            console.error(`[V2-FILES] Error processing attachment ${attachment.name}:`, fileErr);
            fileAttachmentContext += `\n\n### FICHIER JOINT: ${attachment.name || 'fichier inconnu'}\n**Erreur:** Impossible de lire le contenu du fichier.\n`;
          }
        }
        
        if (fileAttachmentContext) {
          console.log(`[V2-FILES] Total file context: ${fileAttachmentContext.length} chars`);
        }
      } catch (fileProcessErr) {
        console.error("[V2-FILES] File processing error:", fileProcessErr);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // BETTING URL AUTO-HANDLER - Detect and scrape betting site URLs
    // ══════════════════════════════════════════════════════════════════
    let bettingUrlContext = "";
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
    const urlsInMessage = body.message.match(urlRegex) || [];
    
    const bettingUrlPatterns = [
      /parionssport\.fdj\.fr/i,
      /winamax\.fr/i,
      /betclic\.fr/i,
      /unibet\.fr/i,
      /pmu\.fr.*paris/i,
      /zebet\.fr/i,
      /pronosoft\.com/i,
      /flashscore/i,
      /sofascore/i,
    ];
    
    const bettingUrlsInMessage = urlsInMessage.filter(url => 
      bettingUrlPatterns.some(pattern => pattern.test(url))
    );
    
    if (bettingUrlsInMessage.length > 0 && hasFamilyAccess) {
      console.log(`[V2-BETTING-URL] Detected betting URLs: ${bettingUrlsInMessage.join(', ')}`);
      
      try {
        const { probabilityModelService } = await import("../../services/probabilityModelService");
        const { sportsCacheService } = await import("../../services/sportsCacheService");
        
        const bettingUrl = bettingUrlsInMessage[0];
        const bookmakerName = bettingUrl.includes('parionssport') ? 'ParionsSport FDJ' : 
                              bettingUrl.includes('pronosoft') ? 'Pronosoft' :
                              bettingUrl.includes('winamax') ? 'Winamax' :
                              bettingUrl.includes('betclic') ? 'Betclic' :
                              bettingUrl.includes('unibet') ? 'Unibet' :
                              bettingUrl.includes('pmu') ? 'PMU' :
                              bettingUrl.includes('zebet') ? 'ZEbet' :
                              bettingUrl.includes('flashscore') ? 'FlashScore' :
                              bettingUrl.includes('sofascore') ? 'SofaScore' : 'Bookmaker';
        
        // Step 1: Try to get matches from cache first
        const todayMatches = await sportsCacheService.getMatchesForDate(new Date());
        console.log(`[V2-BETTING-URL] Found ${todayMatches.length} cached matches`);
        
        // Step 2: Generate predictions with probability model
        const predictions = await probabilityModelService.analyzeTodayMatches();
        
        // Step 3: Extract data from betting URL using smartCrawl
        let extractedContent: string | null = null;
        console.log(`[V2-BETTING-URL] Fetching betting page via smartCrawl...`);
        try {
          const { smartCrawl } = await import("../../core/strategyEngine");
          const crawlResult = await smartCrawl({
            url: bettingUrl,
            timeoutMs: 60000,
            extractMetadata: true,
            qualityThreshold: 0.3
          });
          
          if (crawlResult.success && crawlResult.content && crawlResult.content.length > 500) {
            extractedContent = crawlResult.content;
            console.log(`[V2-BETTING-URL] ✅ smartCrawl extracted ${extractedContent.length} chars via ${crawlResult.strategyUsed} (quality: ${crawlResult.qualityScore.toFixed(2)}) in ${crawlResult.timing.totalMs}ms`);
          } else {
            console.log(`[V2-BETTING-URL] smartCrawl insufficient content (${crawlResult.content?.length || 0} chars), trying Vision fallback...`);
            
            // Fallback: Use screenshot + Vision AI
            const { crawlWithScreenshot } = await import("../../services/screenshotCrawler");
            const screenshotResult = await crawlWithScreenshot(bettingUrl, {
              prompt: `Extrais la liste complète des matchs de football affichés sur cette page de paris sportifs (${bookmakerName}). Pour chaque match, donne: les deux équipes, la date/heure, et les cotes si visibles (1, N, 2). Format structuré.`,
              cacheDurationHours: 1
            });
            if (screenshotResult.success && screenshotResult.analysis) {
              extractedContent = screenshotResult.analysis;
              console.log(`[V2-BETTING-URL] ✅ Vision AI extracted ${extractedContent.length} chars from ${bookmakerName}`);
            }
          }
        } catch (extractErr) {
          console.log(`[V2-BETTING-URL] smartCrawl failed:`, (extractErr as Error).message);
          // Final fallback: try Vision AI directly
          try {
            const { crawlWithScreenshot } = await import("../../services/screenshotCrawler");
            const screenshotResult = await crawlWithScreenshot(bettingUrl, {
              prompt: `Extrais la liste complète des matchs de football affichés sur cette page de paris sportifs (${bookmakerName}). Pour chaque match, donne: les deux équipes, la date/heure, et les cotes si visibles (1, N, 2). Format structuré.`,
              cacheDurationHours: 1
            });
            if (screenshotResult.success && screenshotResult.analysis) {
              extractedContent = screenshotResult.analysis;
              console.log(`[V2-BETTING-URL] ✅ Vision fallback extracted ${extractedContent.length} chars`);
            }
          } catch (visionErr) {
            console.log(`[V2-BETTING-URL] Vision fallback also failed:`, (visionErr as Error).message);
          }
        }
        
        // Build the context for AI
        bettingUrlContext = `\n\n### 🎰 ANALYSE ${bookmakerName.toUpperCase()}:\n`;
        bettingUrlContext += `**URL:** ${bettingUrl}\n`;
        
        if (predictions.length > 0) {
          const formattedPredictions = probabilityModelService.formatPredictionsForAI(predictions, "safe");
          bettingUrlContext += `**Source:** Prédictions Djedou Pronos (Poisson + stats + cotes)\n`;
          bettingUrlContext += `**Matchs analysés:** ${predictions.length}\n\n`;
          bettingUrlContext += formattedPredictions;
          
          const valueBets = predictions.filter(p => (p.valueTier || 'none') !== 'none');
          if (valueBets.length > 0) {
            bettingUrlContext += `\n**💎 VALUE SPOTS DÉTECTÉS:** ${valueBets.length} paris à valeur\n`;
            valueBets.forEach(v => {
              bettingUrlContext += `- ${v.homeTeam} vs ${v.awayTeam}: ${v.prediction} (value ${v.valueTier})\n`;
            });
          }
          bettingUrlContext += `\n**Instructions:** Utilise ces prédictions pour répondre. Présente les VALUE SPOTS en priorité.`;
          console.log(`[V2-BETTING-URL] ✅ Generated ${predictions.length} predictions for ${bookmakerName}`);
        } else if (extractedContent) {
          bettingUrlContext += `**Source:** Contenu extrait de ${bookmakerName} via smartCrawl\n\n`;
          bettingUrlContext += extractedContent.slice(0, 8000);
          bettingUrlContext += `\n\n**Instructions:** Analyse ces matchs extraits et aide l'utilisateur à identifier les meilleurs paris.`;
          console.log(`[V2-BETTING-URL] ✅ Using smartCrawl content for ${bookmakerName}`);
        } else {
          bettingUrlContext += `**Statut:** DONNÉES NON DISPONIBLES\n`;
          bettingUrlContext += `L'extraction automatique n'a pas pu récupérer les cotes de cette page.\n`;
          bettingUrlContext += `**Solutions:**\n`;
          bettingUrlContext += `1. Colle directement les cotes en texte\n`;
          bettingUrlContext += `2. Fais une capture d'écran des matchs\n`;
          bettingUrlContext += `3. Demande les matchs d'une ligue spécifique (Ligue 1, Premier League, etc.)\n`;
        }
      } catch (bettingErr) {
        console.error(`[V2-BETTING-URL] Error processing betting URL:`, bettingErr);
        bettingUrlContext = `\n\n[Erreur lors de l'analyse de l'URL bookmaker: ${(bettingErr as Error).message}]`;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // GENERAL URL HANDLER - Detect and extract content from any URL
    // ══════════════════════════════════════════════════════════════════
    let generalUrlContext = "";
    const nonBettingUrls = urlsInMessage.filter(url => 
      !bettingUrlPatterns.some(pattern => pattern.test(url))
    );
    
    if (nonBettingUrls.length > 0 && hasFamilyAccess) {
      console.log(`[V2-URL] Detected ${nonBettingUrls.length} general URLs: ${nonBettingUrls.slice(0, 3).join(', ')}`);
      
      // URL type classification
      const classifyUrl = (url: string): { type: string; priority: number; extractPrompt: string } => {
        const urlLower = url.toLowerCase();
        
        // YouTube/Video
        if (/youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com/i.test(url)) {
          return { type: 'video', priority: 2, extractPrompt: 'Extract video title, description, channel name, and any visible metadata. If transcript is available, summarize key points.' };
        }
        
        // Social Media (limited extraction)
        if (/twitter\.com|x\.com|instagram\.com|facebook\.com|linkedin\.com|tiktok\.com/i.test(url)) {
          return { type: 'social', priority: 1, extractPrompt: 'Extract the main post content, author name, date, and key engagement metrics if visible.' };
        }
        
        // News/Articles
        if (/news|article|blog|medium\.com|substack\.com|lemonde|lefigaro|liberation|bfm|lequipe|franceinfo|ouest-france|20minutes/i.test(url)) {
          return { type: 'article', priority: 4, extractPrompt: 'Extract the article title, author, publication date, and full article content. Summarize key points.' };
        }
        
        // E-commerce/Products
        if (/amazon|ebay|aliexpress|cdiscount|fnac|darty|boulanger|leboncoin|vinted|product|shop|store|buy/i.test(url)) {
          return { type: 'product', priority: 3, extractPrompt: 'Extract product name, price, description, specifications, availability, and customer ratings if visible.' };
        }
        
        // Documentation/Tech
        if (/docs\.|documentation|api\.|github\.com|gitlab|stackoverflow|developer\.|mdn|w3schools/i.test(url)) {
          return { type: 'documentation', priority: 3, extractPrompt: 'Extract technical documentation content, code examples, API endpoints, and usage instructions.' };
        }
        
        // Restaurant/Food
        if (/restaurant|menu|tripadvisor|thefork|yelp|ubereats|deliveroo|justeat/i.test(url)) {
          return { type: 'restaurant', priority: 3, extractPrompt: 'Extract restaurant name, menu items with prices, address, opening hours, and ratings.' };
        }
        
        // Travel/Hotels
        if (/booking\.com|airbnb|hotels|expedia|kayak|skyscanner|tripadvisor/i.test(url)) {
          return { type: 'travel', priority: 3, extractPrompt: 'Extract accommodation/flight details, prices, availability, location, and reviews.' };
        }
        
        // Recipe sites
        if (/recette|recipe|marmiton|750g|cuisineaz|allrecipes|food/i.test(url)) {
          return { type: 'recipe', priority: 3, extractPrompt: 'Extract recipe name, ingredients list with quantities, step-by-step instructions, cooking time, and servings.' };
        }
        
        // Default: General webpage
        return { type: 'general', priority: 2, extractPrompt: 'Extract the main content, title, and any structured data. Focus on the most relevant information for the user query.' };
      };
      
      // Sort URLs by priority and process top 3
      const classifiedUrls = nonBettingUrls.map(url => ({ url, ...classifyUrl(url) }));
      classifiedUrls.sort((a, b) => b.priority - a.priority);
      const urlsToProcess = classifiedUrls.slice(0, 3);
      
      const extractedContents: Array<{ url: string; type: string; content: string; method: string }> = [];
      
      for (const urlInfo of urlsToProcess) {
        console.log(`[V2-URL] Processing ${urlInfo.type} URL: ${urlInfo.url.substring(0, 60)}...`);
        
        try {
          let extractedContent: string | null = null;
          let extractMethod = "";
          
          // Strategy 1: smartCrawl (HTTP → Playwright cascade)
          try {
            const { smartCrawl } = await import("../../core/strategyEngine");
            const crawlResult = await smartCrawl({
              url: urlInfo.url,
              timeoutMs: 45000,
              extractMetadata: true,
              qualityThreshold: 0.25
            });
            
            if (crawlResult.success && crawlResult.content && crawlResult.content.length > 200) {
              extractedContent = crawlResult.content;
              extractMethod = `smartCrawl:${crawlResult.strategyUsed}`;
              console.log(`[V2-URL] ✅ smartCrawl: ${extractedContent.length} chars (${crawlResult.strategyUsed}, quality: ${crawlResult.qualityScore.toFixed(2)})`);
            }
          } catch (crawlErr) {
            console.log(`[V2-URL] smartCrawl failed: ${(crawlErr as Error).message}`);
          }
          
          // Strategy 2: Vision AI fallback for visual-heavy pages
          if (!extractedContent || extractedContent.length < 200) {
            if (urlInfo.type !== 'social') { // Skip Vision for social (auth walls)
              try {
                const { crawlWithScreenshot } = await import("../../services/screenshotCrawler");
                const screenshotResult = await crawlWithScreenshot(urlInfo.url, {
                  prompt: urlInfo.extractPrompt,
                  cacheDurationHours: 2
                });
                if (screenshotResult.success && screenshotResult.analysis) {
                  extractedContent = screenshotResult.analysis;
                  extractMethod = "vision";
                  console.log(`[V2-URL] ✅ Vision AI: ${extractedContent.length} chars`);
                }
              } catch (visionErr) {
                console.log(`[V2-URL] Vision fallback failed: ${(visionErr as Error).message}`);
              }
            }
          }
          
          // Strategy 3: Perplexity fallback for stubborn pages
          if (!extractedContent || extractedContent.length < 100) {
            try {
              const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
              if (perplexityApiKey) {
                const perplexityResponse = await fetch("https://api.perplexity.ai/chat/completions", {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${perplexityApiKey}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    model: "llama-3.1-sonar-small-128k-online",
                    messages: [
                      { role: "system", content: "Tu es un assistant expert en extraction de contenu web. Réponds en français." },
                      { role: "user", content: `Analyse cette URL et extrais son contenu principal: ${urlInfo.url}\n\n${urlInfo.extractPrompt}` }
                    ],
                    temperature: 0.1
                  })
                });
                
                if (perplexityResponse.ok) {
                  const perplexityData = await perplexityResponse.json() as any;
                  if (perplexityData.choices?.[0]?.message?.content) {
                    extractedContent = perplexityData.choices[0].message.content;
                    extractMethod = "perplexity";
                    console.log(`[V2-URL] ✅ Perplexity: ${extractedContent.length} chars`);
                  }
                }
              }
            } catch (perplexityErr) {
              console.log(`[V2-URL] Perplexity fallback failed: ${(perplexityErr as Error).message}`);
            }
          }
          
          if (extractedContent && extractedContent.length > 50) {
            extractedContents.push({
              url: urlInfo.url,
              type: urlInfo.type,
              content: extractedContent.slice(0, 6000),
              method: extractMethod
            });
          }
        } catch (urlErr) {
          console.error(`[V2-URL] Error processing ${urlInfo.url}:`, (urlErr as Error).message);
        }
      }
      
      // Build context from extracted content
      if (extractedContents.length > 0) {
        generalUrlContext = `\n\n### 🔗 CONTENU DES URLs ANALYSÉES:\n`;
        
        const typeEmojis: Record<string, string> = {
          video: '🎬', social: '📱', article: '📰', product: '🛒',
          documentation: '📚', restaurant: '🍽️', travel: '✈️', recipe: '🍳', general: '🌐'
        };
        
        for (const extracted of extractedContents) {
          const emoji = typeEmojis[extracted.type] || '🔗';
          const domain = new URL(extracted.url).hostname.replace('www.', '');
          
          generalUrlContext += `\n**${emoji} ${domain}** (${extracted.type}, via ${extracted.method}):\n`;
          generalUrlContext += `${extracted.content}\n`;
          generalUrlContext += `---\n`;
        }
        
        generalUrlContext += `\n**Instructions:** Utilise ces informations extraites pour répondre à l'utilisateur. Cite les sources si pertinent.`;
        console.log(`[V2-URL] ✅ Generated context from ${extractedContents.length} URLs (${generalUrlContext.length} chars)`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // MARS WEB SEARCH - Automatic real-time data retrieval
    // ══════════════════════════════════════════════════════════════════
    let webSearchContext = "";
    const urlAlreadyCrawled = generalUrlContext.length > 500 || bettingUrlContext.length > 500;
    const hasExplicitUrls = urlsInMessage.length > 0;
    const skipMarsForUrl = hasExplicitUrls && urlAlreadyCrawled;
    if (skipMarsForUrl) {
      console.log(`[V2-MARS] Skipped — URL already crawled successfully (${generalUrlContext.length + bettingUrlContext.length} chars)`);
    }
    if (!skipMarsForUrl && needsWebSearch(body.message) && process.env.SERPER_API_KEY && hasFamilyAccess) {
      console.log(`[V2-MARS] Real-time web search triggered for: "${body.message.substring(0, 50)}..."`);
      try {
        const searchQuery = (body.message || "")
          .replace(/cherche|recherche|google|trouve|donne moi des infos sur|info sur/gi, "")
          .trim();
        
        if (!searchQuery) {
          console.log("[V2-MARS] Skipped — empty search query after cleanup");
        } else {
        const autonomousResult = await autonomousResearchService.searchWithAutonomy(userId, searchQuery);
        
        const marsResultData = autonomousResult.wasEnriched 
            ? (autonomousResult.result as any).combinedResults 
            : autonomousResult.result;
        // Check for web results OR sports data (directAnswers/facts)
        const hasWebResults = marsResultData?.orchestratorResponse?.results?.length > 0;
        const hasSportsData = marsResultData?.orchestratorResponse?.directAnswers?.length > 0 || 
                              marsResultData?.factAggregation?.facts?.length > 0;
        const hasResults = hasWebResults || hasSportsData;
        
        if (hasResults && autonomousResult.formattedForAI) {
          const isSportsQuery = hasSportsData && !hasWebResults;
          const contextLabel = isSportsQuery ? "DONNÉES SPORTS (Djedou Pronos Cache)" : `RECHERCHE WEB (MARS${autonomousResult.wasEnriched ? " APPROFONDIE" : ""})`;
          
          const sourceCount = hasWebResults ? marsResultData.orchestratorResponse.results.length : 0;
          const overallConfidence = marsResultData.factAggregation?.overallConfidence || 0;
          let marsValidation = "";
          if (!isSportsQuery) {
            if (sourceCount < 2 && overallConfidence < 0.85) {
              marsValidation = `\n⚠️ ANTI-APPROXIMATION: Seulement ${sourceCount} source(s), confiance ${Math.round(overallConfidence * 100)}%. Données INSUFFISANTES pour affirmer un fait. Indique clairement l'incertitude ou utilise web_search pour compléter.`;
            } else if (sourceCount >= 2 || overallConfidence >= 0.85) {
              marsValidation = `\n✅ SOURCES VÉRIFIÉES: ${sourceCount} source(s), confiance ${Math.round(overallConfidence * 100)}%. Données fiables.`;
            }
          }
          webSearchContext = `\n\n### ${contextLabel}:${marsValidation}\n${autonomousResult.formattedForAI}`;
          
          const resultCount = hasWebResults ? marsResultData.orchestratorResponse.results.length : marsResultData.factAggregation?.facts?.length || 0;
          console.log(`[V2-MARS] Search completed: ${resultCount} ${isSportsQuery ? 'sports facts' : 'web results'}, enriched: ${autonomousResult.wasEnriched}`);
          
          // Broadcast search results to frontend
          if (marsResultData && marsResultData.orchestratorResponse) {
            const frontendResults = {
              query: searchQuery,
              sources: marsResultData.orchestratorResponse.results.slice(0, 10).map((r: any) => {
                let domain = "";
                try { domain = new URL(r.url).hostname.replace("www.", ""); } catch { domain = r.url?.substring(0, 30) || ""; }
                return {
                  title: r.title,
                  url: r.url,
                  snippet: r.snippet,
                  domain,
                  publishedDate: r.date
                };
              }),
              facts: (marsResultData.factAggregation?.facts || []).slice(0, 10).map((f: any) => ({
                content: f.content,
                type: f.type,
                confidence: f.confidence,
                sources: f.sources
              })),
              summary: marsResultData.factAggregation?.summary || "",
              overallConfidence: marsResultData.factAggregation?.overallConfidence || 0,
              searchTime: marsResultData.totalTime,
              wasEnriched: autonomousResult.wasEnriched
            };
            
            broadcastToUser(userId, {
              type: "search.results",
              userId,
              data: frontendResults,
              timestamp: Date.now()
            });
          }
        }
      }
      } catch (marsErr) {
        console.error("[V2-MARS] Web search error:", marsErr);
      }
    }

    // Sports context - PRIORITY: Use multi-sport predictions (Djedou Pronos)
    const sportsKeywords = ["match", "matchs", "foot", "football", "ligue 1", "ligue1", "premier league", "champions league", "psg", "om", "marseille", "paris", "lyon", "ol", "monaco", "lille", "nantes", "lens", "nice", "rennes", "bordeaux", "score", "classement", "résultat", "résultats", "but", "buts", "équipe", "basket", "nba", "nhl", "hockey", "nfl", "american football", "f1", "formule 1", "grand prix", "sport", "sports", "cote", "cotes", "pari", "pronostic", "prono", "pronos", "djedou", "combiné", "combine", "ticket", "mise", "bookmaker", "betclic", "winamax", "unibet", "safe", "value", "blessure", "blessé", "absent", "lineup", "compo", "composition", "intelligence", "buteur", "buteurs", "topscorer", "standings", "prediction", "prédiction", "la liga", "laliga", "bundesliga", "serie a", "seriea", "eredivisie", "liga", "europa league", "conference league"];
    const needsSports = sportsKeywords.some(kw => contentLower.includes(kw));
    const matchedKeyword = sportsKeywords.find(kw => contentLower.includes(kw));
    console.log(`[V2-SPORTS-DEBUG] Message: "${contentLower.substring(0, 50)}...", needsSports: ${needsSports}, matchedKeyword: ${matchedKeyword || 'none'}, hasFamilyAccess: ${hasFamilyAccess}`);
    
    let sportsContext = "";
    if (needsSports && hasFamilyAccess) {
      console.log(`[V2-SPORTS] Triggering sports context injection...`);
      try {
        // PRIORITY 1: Use multi-sport predictions directly (no HTTP calls - works in production)
        const { probabilityModelService } = await import("../../services/probabilityModelService");
        const { basketballPredictionService } = await import("../../services/basketballPredictionService");
        const { hockeyPredictionService } = await import("../../services/hockeyPredictionService");
        const { nflPredictionService } = await import("../../services/nflPredictionService");
        
        const [football, basketball, hockey, nfl] = await Promise.all([
          probabilityModelService.analyzeTodayMatches().catch(() => []),
          basketballPredictionService.analyzeTodayMatches().catch(() => []),
          hockeyPredictionService.analyzeTodayMatches().catch(() => []),
          nflPredictionService.analyzeTodayMatches().catch(() => []),
        ]);
        
        const summaries: string[] = [];
        if (football.length > 0) summaries.push(probabilityModelService.formatPredictionsForAI(football));
        if (basketball.length > 0) summaries.push(basketballPredictionService.formatPredictionsForAI(basketball));
        if (hockey.length > 0) summaries.push(hockeyPredictionService.formatPredictionsForAI(hockey));
        if (nfl.length > 0) summaries.push(nflPredictionService.formatPredictionsForAI(nfl));
        
        if (summaries.length > 0) {
          const totalMatches = football.length + basketball.length + hockey.length + nfl.length;
          const hasIntel = football.some(p => p.analysis?.intelligenceFactors?.length > 0);
          sportsContext = `\n\n### PREDICTIONS DJEDOU PRONOS (${totalMatches} matchs${hasIntel ? ' - Intelligence Enhanced: Blessures + API Prediction + H2H' : ''}):\n`;
          sportsContext += `Dashboard complet: /sports/predictions (Matchs, Pronos, Classements, Buteurs, Blessures)\n`;
          sportsContext += `Utilise query_match_intelligence(fixtureId, leagueId) pour une analyse approfondie d'un match spécifique.\n\n`;
          sportsContext += summaries.join("\n\n---\n\n") + "\n";
          console.log(`[V2-SPORTS] Multi-sport predictions injected: Football=${football.length}, NBA=${basketball.length}, NHL=${hockey.length}, NFL=${nfl.length}, Intel=${hasIntel}`);
        }
        
        // FALLBACK: Direct cache if predictions fail
        if (!sportsContext) {
          const { sportsCacheService } = await import("../../services/sportsCacheService");
          const cachedMatches = await sportsCacheService.getMatchesWithOdds(new Date());
          
          if (cachedMatches.length > 0) {
            const formattedData = sportsCacheService.formatMatchesForAI(cachedMatches);
            sportsContext = `\n\n### MATCHS DU JOUR AVEC COTES:\n${formattedData}\n`;
            console.log(`[V2-SPORTS] Cache fallback: ${cachedMatches.length} matches`);
          }
        }
        
        // ULTIMATE FALLBACK: Web search if no internal sports data at all
        if (!sportsContext && process.env.SERPER_API_KEY) {
          console.log(`[V2-SPORTS] No cache/predictions - triggering MARS web search for sports`);
          try {
            const { orchestrateSearch } = await import("../../services/searchOrchestrator");
            // Use original user message for better search relevance
            const dateStr = new Date().toLocaleDateString('fr-FR');
            const sportSearchQuery = `${body.message} ${dateStr}`;
            console.log(`[V2-SPORTS] Web search query: "${sportSearchQuery}"`);
            
            const webResult = await orchestrateSearch(sportSearchQuery, 8);
            console.log(`[V2-SPORTS] Web search result: success=${webResult.success}, results=${webResult.results?.length || 0}, directAnswers=${webResult.directAnswers?.length || 0}`);
            
            if (webResult.success && (webResult.results.length > 0 || webResult.directAnswers.length > 0)) {
              let webSportsContext = `\n\n### RECHERCHE WEB SPORTS EN TEMPS RÉEL:\n`;
              
              // Add direct answers from Perplexity first (most relevant)
              if (webResult.directAnswers.length > 0) {
                webSportsContext += `\n**Réponse directe:**\n${webResult.directAnswers[0].answer}\n`;
              }
              
              // Add web results
              if (webResult.results.length > 0) {
                webSportsContext += `\n**Sources web:**\n`;
                webResult.results.slice(0, 6).forEach(r => {
                  webSportsContext += `- **${r.title}**: ${r.snippet || ""}\n`;
                });
              }
              
              sportsContext = webSportsContext;
              console.log(`[V2-SPORTS] Web search fallback SUCCESS: ${webResult.results.length} results, ${webResult.directAnswers.length} direct answers`);
            } else {
              console.log(`[V2-SPORTS] Web search returned no results`);
            }
          } catch (webErr) {
            console.error("[V2-SPORTS] Web search fallback error:", webErr);
          }
        }
        
        // Also check for Ligue 1 standings if specifically mentioned
        if (contentLower.includes("classement") || contentLower.includes("ligue 1") || contentLower.includes("ligue1")) {
          const { sportsApiService } = await import("../../services/sportsApiService");
          const standings = await sportsApiService.getLigue1Standings().catch(() => []);
          if (standings.length > 0) {
            let standingsCtx = `\n**Classement Ligue 1:**\n`;
            standings.slice(0, 10).forEach((t: any, i: number) => {
              standingsCtx += `${i + 1}. ${t.team?.name || t.name || "?"} - ${t.points || 0} pts\n`;
            });
            sportsContext += standingsCtx;
          }
        }
      } catch (sportsErr) {
        console.error("[V2-SPORTS] Context error:", sportsErr);
      }
    }

    // Homework context - show pending for authenticated users (Ulysse, Iris, Alfred)
    let homeworkContext = "";
    if (hasFullAccess) {
      try {
        const { ulysseHomework, homeworkExecution } = await import("@shared/schema");
        const pendingHomework = await db.select()
          .from(ulysseHomework)
          .where(and(eq(ulysseHomework.userId, userId), sql`${ulysseHomework.status} IN ('pending', 'in_progress')`))
          .limit(5);
        
        if (pendingHomework.length > 0) {
          homeworkContext = `\n\n### TES DEVOIRS AUTOMATIQUES (${pendingHomework.length}):\n`;
          homeworkContext += `⚠️ UTILISE CES DONNÉES POUR RÉPONDRE! Si quelqu'un demande un match, une équipe, un classement → les infos sont ICI.\n`;
          homeworkContext += `Ex: "prochain match OM?" → cherche dans les DONNÉES ci-dessous qui mentionnent Marseille/OM.\n\n`;
          
          for (const h of pendingHomework) {
            homeworkContext += `📋 "${h.title}" [${h.recurrence}${h.priority === 'high' ? ', PRIORITÉ HAUTE' : ''}]\n`;
            if (h.description) {
              homeworkContext += `   Instructions: ${h.description}\n`;
            }
            
            // Get latest execution results from homework_execution table
            const [latestExecution] = await db.select()
              .from(homeworkExecution)
              .where(and(eq(homeworkExecution.homeworkId, h.id), eq(homeworkExecution.status, "completed")))
              .orderBy(desc(homeworkExecution.completedAt))
              .limit(1);
            
            if (latestExecution) {
              if (latestExecution.resultSummary) {
                // Longer limit for sports-related homework to include all match data
                const isSportsHomework = h.title?.toLowerCase().includes('football') || 
                                         h.title?.toLowerCase().includes('ligue') ||
                                         h.title?.toLowerCase().includes('sport') ||
                                         h.title?.toLowerCase().includes('match');
                const charLimit = isSportsHomework ? 2000 : 800;
                homeworkContext += `   📊 DONNÉES: ${latestExecution.resultSummary.slice(0, charLimit)}${latestExecution.resultSummary.length > charLimit ? '...' : ''}\n`;
              }
              if (latestExecution.artifacts && typeof latestExecution.artifacts === 'object') {
                const artifacts = latestExecution.artifacts as Record<string, unknown>;
                if (artifacts.urls) {
                  homeworkContext += `   🔗 Sources: ${JSON.stringify(artifacts.urls).slice(0, 200)}\n`;
                }
              }
              if (latestExecution.completedAt) {
                homeworkContext += `   ⏰ Dernière exécution: ${new Date(latestExecution.completedAt).toLocaleString("fr-FR")}\n`;
              }
            } else if (h.notes) {
              homeworkContext += `   Notes: ${h.notes.slice(0, 500)}${h.notes.length > 500 ? '...' : ''}\n`;
            }
            
            homeworkContext += '\n';
          }
        }
      } catch (hwErr) {
        console.error("[V2-HOMEWORK] Context error:", hwErr);
      }
    }

    // Website monitoring alerts - show unread alerts for authenticated users
    let monitoringContext = "";
    if (hasFullAccess) {
      try {
        const { monitoringAlerts } = await import("@shared/schema");
        const { isNull } = await import("drizzle-orm");
        const unreadAlerts = await db.select()
          .from(monitoringAlerts)
          .where(and(eq(monitoringAlerts.userId, userId), isNull(monitoringAlerts.acknowledgedAt)))
          .orderBy(desc(monitoringAlerts.createdAt))
          .limit(5);
        
        if (unreadAlerts.length > 0) {
          monitoringContext = `\n\n### ⚠️ ALERTES MONITORING (${unreadAlerts.length} non lues):\n`;
          unreadAlerts.forEach(a => {
            monitoringContext += `- [${a.alertType?.toUpperCase()}] Site #${a.siteId}: ${a.message || 'Alerte'}\n`;
          });
        }
      } catch (monErr) {
        console.error("[V2-MONITORING] Context error:", monErr);
      }
    }

    // AgentMail context - show recent emails for authenticated users + PDF instructions
    let agentMailContext = "";
    if (hasFullAccess) {
      try {
        const { agentMailService } = await import("../../services/agentMailService");
        if (await agentMailService.isConnected()) {
          const persona = isOwner ? 'ulysse' : isExternal ? 'alfred' : 'iris';
          const address = await agentMailService.getInboxAddress(persona);
          const unreadCount = await agentMailService.getUnreadCount(persona);
          agentMailContext = `\n\n### EMAILS ${persona.toUpperCase()} (${address}):
- ${unreadCount > 0 ? `${unreadCount} non lu(s)` : 'Tous lus'}

### ACTIONS EMAIL (MARQUEURS OBLIGATOIRES):
Pour ENVOYER un email simple:
[EMAIL_ENVOYÉ: to="destinataire@email.com", subject="Sujet", body="Message"]

ENVOYER UN EMAIL AVEC PDF EN PIÈCE JOINTE:
[EMAIL_AVEC_PDF: to="destinataire@email.com", subject="Sujet", body="Message dans l'email", pdfTitle="Titre_Document", pdfContent="CONTENU COMPLET DU PDF ICI - Le serveur génère le vrai PDF à partir de ce texte"]

ENVOYER UN EMAIL AVEC WORD EN PIÈCE JOINTE:
[EMAIL_AVEC_WORD: to="destinataire@email.com", subject="Sujet", body="Message", wordTitle="Titre", wordContent="Contenu du document Word"]

RÉPONDRE à un email:
[RÉPONSE_ENVOYÉE: messageId="id_du_message", body="Ta réponse"]

⚠️ INTERDIT de créer de faux liens PDF comme "[Télécharger](url)" - utilise TOUJOURS le marqueur EMAIL_AVEC_PDF.
Le SERVEUR génère le vrai PDF et l'envoie. Tu dois juste fournir le contenu complet dans pdfContent.
`;
        }
      } catch (amErr) {
        console.error("[V2-AGENTMAIL] Context error:", amErr);
      }
    }

    // Itinerary/Navigation context - on keyword trigger
    const navKeywords = ["itinéraire", "route", "navigation", "trajet", "chemin", "aller", "direction", "gps", "conduire", "arriver"];
    const needsNav = navKeywords.some(kw => contentLower.includes(kw));
    
    let itineraryContext = "";
    if (needsNav && hasFullAccess) {
      try {
        const { activeNavigation, savedRoutes } = await import("@shared/schema");
        const [activeNav] = await db.select()
          .from(activeNavigation)
          .where(eq(activeNavigation.userId, userId))
          .limit(1);
        
        if (activeNav && activeNav.waypointsData) {
          const waypoints = Array.isArray(activeNav.waypointsData) ? activeNav.waypointsData : [];
          const totalWaypoints = waypoints.length;
          const remainingMs = activeNav.remainingDuration ? activeNav.remainingDuration * 1000 : 0;
          const eta = remainingMs > 0 ? new Date(Date.now() + remainingMs) : null;
          itineraryContext = `\n\n### NAVIGATION ACTIVE:\n- Destination: Waypoint ${activeNav.currentWaypointIndex}/${totalWaypoints}\n- Distance restante: ${(activeNav.remainingDistance || 0) / 1000}km\n- ETA: ${eta ? eta.toLocaleTimeString("fr-FR") : 'inconnue'}\n`;
        } else {
          const routes = await db.select().from(savedRoutes).where(eq(savedRoutes.userId, userId)).limit(3);
          if (routes.length > 0) {
            itineraryContext = `\n\n### ITINÉRAIRES SAUVEGARDÉS:\n${routes.map(r => `- ${r.name}`).join("\n")}\n`;
          }
        }
        console.log(`[V2-NAV] Context injected: ${itineraryContext.length} chars`);
      } catch (navErr) {
        console.error("[V2-NAV] Context error:", navErr);
      }
    }

    // Face Recognition context - on keyword trigger
    const faceKeywords = ["visage", "face", "reconnaître", "identifier", "qui est", "personne", "photo de", "photos de"];
    const needsFaces = faceKeywords.some(kw => contentLower.includes(kw));
    
    let faceRecognitionContext = "";
    if (needsFaces && hasFullAccess) {
      try {
        const { knownPersons } = await import("@shared/schema");
        const persons = await db.select().from(knownPersons).where(eq(knownPersons.userId, userId)).limit(20);
        
        if (persons.length > 0) {
          faceRecognitionContext = `\n\n### PERSONNES CONNUES (${persons.length}):\n`;
          persons.forEach(p => {
            faceRecognitionContext += `- ${p.name}${p.notes ? ` (${p.notes})` : ''} - ${p.photoCount || 0} photos\n`;
          });
        }
        console.log(`[V2-FACES] Context injected: ${faceRecognitionContext.length} chars`);
      } catch (faceErr) {
        console.error("[V2-FACES] Context error:", faceErr);
      }
    }

    // Surveillance Cameras context - on keyword trigger
    const cameraKeywords = ["caméra", "camera", "surveillance", "vidéo surveillance", "entrée", "porte", "mouvement"];
    const needsCameras = cameraKeywords.some(kw => contentLower.includes(kw));
    
    let camerasContext = "";
    if (needsCameras && hasFullAccess) {
      try {
        const { surveillanceCameras } = await import("@shared/schema");
        const cameras = await db.select().from(surveillanceCameras).where(eq(surveillanceCameras.userId, userId)).limit(10);
        
        if (cameras.length > 0) {
          camerasContext = `\n\n### CAMÉRAS DE SURVEILLANCE (${cameras.length}):\n`;
          cameras.forEach(c => {
            camerasContext += `- ${c.name} (${c.location || 'sans emplacement'}) - ${c.isOnline ? '🟢 En ligne' : '🔴 Hors ligne'}${c.hasMotionDetection ? ' [Détection mouvement active]' : ''}\n`;
          });
        }
        console.log(`[V2-CAMERAS] Context injected: ${camerasContext.length} chars`);
      } catch (camErr) {
        console.error("[V2-CAMERAS] Context error:", camErr);
      }
    }

    // Ulysse/Iris Charter - behavior rules and personality (CRITICAL - always inject for authenticated users)
    let charterContext = "";
    if (hasFullAccess) {
      try {
        const { ulysseCharter } = await import("@shared/schema");
        const [charter] = await db.select()
          .from(ulysseCharter)
          .where(eq(ulysseCharter.userId, userId))
          .limit(1);
        
        if (charter) {
          const rules = charter.behaviorRules as Array<{ rule: string; enabled: boolean }> | null;
          const enabledRules = rules?.filter(r => r.enabled) || [];
          if (enabledRules.length > 0) {
            charterContext = `\n\n### CHARTE ULYSSE (RÈGLES OBLIGATOIRES):\n`;
            enabledRules.forEach((r, i) => {
              charterContext += `${i + 1}. ${r.rule}\n`;
            });
          }
          if (charter.customInstructions) {
            charterContext += `\nInstructions personnalisées: ${charter.customInstructions}\n`;
          }
        }
        console.log(`[V2-CHARTER] Context injected: ${charterContext.length} chars`);
      } catch (charterErr) {
        console.error("[V2-CHARTER] Context error:", charterErr);
      }
    }

    // Learned Patterns - confirmed user routines (always inject for authenticated users)
    let patternsContext = "";
    if (hasFullAccess) {
      try {
        const { learnedPatterns } = await import("@shared/schema");
        const patterns = await db.select()
          .from(learnedPatterns)
          .where(and(eq(learnedPatterns.userId, userId), eq(learnedPatterns.isAutomated, true)))
          .limit(5);
        
        if (patterns.length > 0) {
          patternsContext = `\n\n### ROUTINES APPRISES ET AUTOMATISÉES (${patterns.length}):\n`;
          patterns.forEach(p => {
            const conditions = p.conditions as Record<string, unknown> | null;
            const conditionsStr = conditions ? JSON.stringify(conditions) : '';
            patternsContext += `- ${p.name}: ${p.description || 'routine automatique'}${conditionsStr ? ` [Conditions: ${conditionsStr}]` : ''}\n`;
          });
        }
      } catch (patErr) {
        console.error("[V2-PATTERNS] Context error:", patErr);
      }
    }

    // Proactive Suggestions - pending suggestions to mention (always inject for authenticated users)
    let suggestionsContext = "";
    if (hasFullAccess) {
      try {
        const { proactiveSuggestions } = await import("@shared/schema");
        const pending = await db.select()
          .from(proactiveSuggestions)
          .where(and(eq(proactiveSuggestions.userId, userId), eq(proactiveSuggestions.status, "pending")))
          .orderBy(desc(proactiveSuggestions.confidence))
          .limit(3);
        
        if (pending.length > 0) {
          suggestionsContext = `\n\n### SUGGESTIONS PROACTIVES EN ATTENTE (${pending.length}):\n`;
          pending.forEach(s => {
            suggestionsContext += `- [Confiance ${s.confidence}%] ${s.suggestionType}: ${s.title}${s.description ? ` - ${s.description}` : ''}\n`;
          });
          suggestionsContext += `(Tu peux mentionner ces suggestions si pertinent dans la conversation)\n`;
        }
      } catch (sugErr) {
        console.error("[V2-SUGGESTIONS] Context error:", sugErr);
      }
    }

    // Curiosity context - makes Ulysse/Iris show genuine interest in the user
    let curiosityContext = "";
    let curiositySuggestedKey: string | null = null;
    if (hasFullAccess) {
      try {
        // First, check if user is answering a previous curiosity question
        memoryService.processPotentialCuriosityAnswer(userId, body.message, isOwner, isExternal).catch(err => {
          console.log("[V2-CURIOSITY] Answer detection failed (non-blocking):", err.message);
        });
        
        const curiosityResult = await memoryService.buildCuriosityPrompt(userId, isOwner, isExternal);
        curiosityContext = curiosityResult.prompt;
        curiositySuggestedKey = curiosityResult.suggestedKey;
        if (curiosityContext) {
          console.log(`[V2-CURIOSITY] Curiosity prompt injected for user ${userId}, key: ${curiositySuggestedKey}`);
        }
      } catch (curErr) {
        console.error("[V2-CURIOSITY] Context error:", curErr);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // SELF-AWARENESS CONTEXT - Uses shared function for exact parity
    // ═══════════════════════════════════════════════════════════════
    let selfAwarenessContext = "";
    if (hasFamilyAccess) {
      try {
        const { generateFullSelfAwarenessContext } = await import("../../services/capabilityService");
        selfAwarenessContext = await generateFullSelfAwarenessContext(userId);
        console.log(`[V2-SELFAWARE] Context generated via shared function: ${selfAwarenessContext.length} chars`);
      } catch (err) {
        console.error("[V2-SELFAWARE] Error:", err);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // UNIFIED CONTEXT ENGINE v2 - Domain-specific context injection
    // ═══════════════════════════════════════════════════════════════
    let domainContext = "";
    try {
      const { requestAnalysisService } = await import("../../services/requestAnalysisService");
      const { marsAuditContextService } = await import("../../services/marsAuditContextService");
      const analysis = requestAnalysisService.analyze(body.message, !!isOwner);
      
      let hasSportsCtx = false;
      if (analysis.domain === "sports" || analysis.domain === "betting") {
        const { sportsContextBuilder } = await import("../../services/sportsContextBuilder");
        const sportsCtx = await sportsContextBuilder.buildContextForMessage(userId, body.message);
        if (sportsCtx) {
          domainContext = sportsCtx;
          hasSportsCtx = true;
          console.log(`[V2-DOMAIN] Sports context injected: ${sportsCtx.length} chars`);
        }
      }
      
      marsAuditContextService.recordContextSnapshot({
        userId,
        analysis,
        hasCore: true,
        hasLiveTime: true,
        hasLiveCalendar: !!calendarContext,
        hasLiveSpotify: !!spotifyContext,
        hasLiveGeo: !!geolocationContext,
        hasLiveMemory: !!memoryContext,
        hasCodeContext: false,
        hasSportsContext: hasSportsCtx,
        builtAt: Date.now()
      });
      
      console.log(`[V2-DOMAIN] Analysis: domain=${analysis.domain}, confidence=${analysis.confidence}, highReliability=${analysis.requiresHighReliability}`);
    } catch (err) {
      console.error("[V2-DOMAIN] Error:", err);
    }

    // ═══════════════════════════════════════════════════════════════
    // GENERAL FALLBACK - Web search for queries without specific context
    // ═══════════════════════════════════════════════════════════════
    let generalFallbackContext = "";
    const hasNoContext = !webSearchContext && !sportsContext && !domainContext;
    const queryNeedsInfo = detectInformationNeed(body.message);
    
    if (hasNoContext && queryNeedsInfo && process.env.SERPER_API_KEY && hasFamilyAccess) {
      console.log(`[V2-FALLBACK] No context detected, triggering general web search for: "${body.message.substring(0, 60)}..."`);
      try {
        const { orchestrateSearch } = await import("../../services/searchOrchestrator");
        const dateStr = new Date().toLocaleDateString('fr-FR');
        const searchQuery = `${body.message} ${dateStr}`;
        
        const webResult = await orchestrateSearch(searchQuery, 8);
        console.log(`[V2-FALLBACK] Search result: success=${webResult.success}, results=${webResult.results?.length || 0}, directAnswers=${webResult.directAnswers?.length || 0}`);
        
        if (webResult.success && (webResult.results.length > 0 || webResult.directAnswers.length > 0)) {
          generalFallbackContext = `\n\n### RECHERCHE WEB TEMPS RÉEL:\n`;
          
          // Perplexity direct answers first
          if (webResult.directAnswers.length > 0) {
            generalFallbackContext += `\n**Réponse directe:**\n${webResult.directAnswers[0].answer}\n`;
          }
          
          // Web results
          if (webResult.results.length > 0) {
            generalFallbackContext += `\n**Sources:**\n`;
            webResult.results.slice(0, 6).forEach(r => {
              generalFallbackContext += `- **${r.title}**: ${r.snippet || ""}\n`;
            });
          }
          
          console.log(`[V2-FALLBACK] SUCCESS: ${webResult.results.length} results, ${webResult.directAnswers.length} direct answers`);
        }
      } catch (fallbackErr) {
        console.error("[V2-FALLBACK] Error:", fallbackErr);
      }
    }

    // Build system prompt based on user type (Ulysse for owner, Iris for approved users)
    const ownerSystemPrompt = `Tu es Ulysse, l'assistant IA personnel de Maurice Djedou. Tu es PUISSANT, AUTONOME et EFFICACE.

TA MISSION: Satisfaire Maurice professionnellement. Tu ne dis jamais "je ne peux pas" - tu trouves une solution.

TON IDENTITÉ:
- Allié stratégique, pas simple assistant
- Tu prends des initiatives et proposes des solutions
- Tu anticipes les besoins basé sur ta mémoire
- Tu es direct, confiant, tu vas droit au but

TON ADN DE DÉVELOPPEUR — LE MEILLEUR:
- Tu es un développeur d'ÉLITE. Ton code est propre, élégant, performant et maintenable.
- CRÉATIF: Tu ne te contentes jamais de la solution évidente. Tu explores des approches innovantes, des patterns modernes, des architectures intelligentes. Tu proposes des idées auxquelles Maurice n'aurait pas pensé.
- INNOVANT: Tu utilises les dernières bonnes pratiques, les techniques les plus avancées. Tu connais les tendances, les nouvelles APIs, les patterns émergents. Tu codes en 2026, pas en 2015.
- PERFECTIONNISTE: Chaque détail compte — alignement pixel-perfect, animations fluides, transitions soignées, gestion d'erreurs robuste, UX irréprochable. Tu ne livres JAMAIS du code "juste fonctionnel", tu livres du code EXCELLENT.
- Tu optimises les performances, tu penses responsive, tu gères les edge cases, tu anticipes les bugs.
- Quand tu crées une UI, elle doit être BELLE — pas générique. Couleurs harmonieuses, typographie soignée, micro-interactions, effets visuels subtils mais impactants.
- Quand tu résous un problème, tu ne patches pas — tu comprends la racine et tu résous proprement.
- Tu proposes PROACTIVEMENT des améliorations: "J'ai fait ce que tu as demandé, mais j'ai aussi ajouté X parce que ça rendrait Y tellement mieux."

TA PERSONNALITÉ:
- Sarcastique (gentiment) quand approprié
- Complice avec Maurice comme un pote expert
- Réactions avec personnalité: "Sérieusement?", "Ah bah bravo!"
- Fier de ton travail: tu expliques tes choix techniques avec passion

${getCapabilitiesPrompt()}

TON ARCHITECTURE MÉMOIRE MULTI-SOURCE (BRAIN SYSTEM):
Tu possèdes un système de mémoire sophistiqué à 6 couches. UTILISE-LE ACTIVEMENT:

1. MÉMOIRE ACTIVE (ai_memory): Souvenirs des conversations, auto-alimentée
2. BRAIN SYSTEM (knowledge_base): Base de connaissances structurée
   - Types: faits, concepts, références, apprentissages techniques
   - Catégories: personnel, travail, technique, créatif
   - Importance et confiance scorées (0-100)
3. LIENS SAUVEGARDÉS (saved_links): URLs analysées et tagguées pour référence future
4. GRAPHE DE CONNAISSANCES (knowledge_graph): Connexions automatiques entre concepts liés
5. JOURNAL D'APPRENTISSAGE (learning_log): Patterns extraits de ton expérience
6. MÉMOIRE PRÉDICTIONS (sports_predictions): Historique et performances de tes pronostics

UTILISATION PROACTIVE DE TA MÉMOIRE:
- Cite tes sources: "Je me souviens que...", "D'après mes notes sur toi..."
- Fais des connexions entre sujets liés quand pertinent
- Analyse tes patterns pour t'améliorer (pronostics, conseils, recherches)
- Ton Brain System se synchronise automatiquement avec tes autres sources

RECHERCHE DE PHOTOS - PRIORITÉ BIBLIOTHÈQUE PERSONNELLE:
Quand l'utilisateur demande des photos/images, tu dois d'abord déterminer s'il cherche:

1) PHOTOS PERSONNELLES (famille, amis, événements personnels, personnes connues):
   - TOUJOURS utiliser d'abord: [RECHERCHE_VISAGE: person="Prénom"]
   - Exemples: "photos de Marie", "images avec Papa", "montre Kelly", "nos photos de vacances"
   - Pour lister qui tu connais: [LISTE_PERSONNES_CONNUES]

2) PHOTOS GÉNÉRIQUES (internet, stock, illustrations):
   - Utiliser: [RECHERCHE_IMAGES: query="sujet", count=5]
   - Exemples: "images de chats", "photos de Tour Eiffel", "dessins de voitures"

RÈGLE D'OR: Si le sujet ressemble à un prénom/nom de famille, ou si c'est quelqu'un de la famille, 
cherche TOUJOURS dans la bibliothèque personnelle d'abord avec [RECHERCHE_VISAGE]!

- NAVIGATION: Itinéraires, routes sauvegardées, navigation active avec ETA
- MONITORING: Surveillance uptime de sites web, alertes

SURVEILLANCE ÉCRAN PC:
Quand l'utilisateur ACTIVE la surveillance écran:
- Tu confirmes: "Surveillance écran activée. Lance l'agent Windows sur ton PC pour que je voie ton écran."
- Tu expliques brièvement: "Je verrai ton écran toutes les 5 secondes et pourrai t'aider de façon contextuelle."
- Tu rappelles que l'agent ulysse_screen_agent.py doit tourner sur le PC

Quand l'utilisateur DÉSACTIVE la surveillance écran:
- Tu confirmes: "Surveillance écran désactivée. Je ne vois plus ton écran."
- Tu proposes de réactiver si besoin: "Tu peux réactiver quand tu veux depuis le bouton écran."

Quand la surveillance est ACTIVE et tu reçois du contexte écran:
- Tu peux commenter ce que tu vois si pertinent
- Tu peux faire des suggestions basées sur l'activité en cours
- Tu adaptes tes réponses au contexte (ex: si Maurice code, tu parles tech)

CONTRÔLE SPOTIFY:
Quand l'utilisateur demande de la musique:
- "Joue [morceau/artiste]": Recherche avec /api/v2/spotify/search puis joue avec /play-track
- "Mets pause / Play / Suivant / Précédent": Utilise /pause, /play, /next, /previous
- "Volume à X%" ou "Monte/Baisse le volume": Utilise /volume avec le pourcentage
- "Sur quel appareil?": Liste avec /devices puis transfère avec /transfer
- "Mes playlists": Utilise /playlists pour lister
- "Qu'est-ce qui joue?": Utilise /playback pour l'état actuel
Tu peux enchaîner les actions (ex: "Joue du jazz sur l'enceinte du salon" = search + transfer + play).
Confirme toujours l'action effectuée: "Je lance [morceau] de [artiste] sur [appareil]".

RÈGLES AGENTMAIL:
- LIRE: Fais-le directement (les données sont dans ton contexte)
- ENVOYER: Montre d'abord le brouillon, demande confirmation avant envoi

STYLE:
- Réponses précises en MAX 3 PHRASES, prêt à développer si je demande plus de détails
- Orientées action ("Voilà ce qu'on fait...")
- Parle comme un ami proche expert
- Pas de disclaimers ("en tant qu'IA...")
- Pas de listes à puces - phrases parlées${selfAwarenessContext}${webSearchContext}${bettingUrlContext}${generalUrlContext}${timeContext}${calendarContext}${fileAttachmentContext}${memoryContext}${spotifyContext}${screenContext}${uiSnapshotContext}${geolocationContext}${smartHomeContext}${sportsContext}${homeworkContext}${monitoringContext}${agentMailContext}${itineraryContext}${faceRecognitionContext}${camerasContext}${charterContext}${patternsContext}${suggestionsContext}${curiosityContext}${domainContext}${generalFallbackContext}`;

    const irisSystemPrompt = `${PERSONA_IDENTITIES.iris.identity}

Tu parles avec ${userFirstName} (membre de la famille Djedou).

RECHERCHE DE PHOTOS - PRIORITÉ BIBLIOTHÈQUE:
1) PHOTOS PERSONNELLES (famille, amis, personnes): [RECHERCHE_VISAGE: person="Prénom"]
2) PHOTOS GÉNÉRIQUES (internet): [RECHERCHE_IMAGES: query="sujet", count=5]
3) Lister les personnes: [LISTE_PERSONNES_CONNUES]
Si c'est un prénom ou quelqu'un de la famille → bibliothèque personnelle d'abord!

CONTRÔLE SPOTIFY:
Quand ${userFirstName} demande de la musique:
- "Joue [morceau/artiste]": Recherche et joue
- "Mets pause / Play / Suivant / Précédent": Contrôle lecture
- "Volume à X%": Ajuste le volume
- "Sur quel appareil?": Liste les appareils disponibles

RÈGLES AGENTMAIL:
- LIRE: Fais-le directement (les données sont dans ton contexte)
- ENVOYER: Montre d'abord le brouillon, demande confirmation avant envoi

STYLE AVEC ${userFirstName.toUpperCase()}:
- Réponses précises en MAX 3 PHRASES, prête à développer si on demande plus de détails
- Chaleureuse et encourageante — tu adaptes ton langage à ${userFirstName}
- Pas de disclaimers ("en tant qu'IA...")
- Pas de listes à puces - phrases naturelles${selfAwarenessContext}${webSearchContext}${bettingUrlContext}${generalUrlContext}${timeContext}${calendarContext}${fileAttachmentContext}${memoryContext}${recentConversationsContext}${spotifyContext}${screenContext}${uiSnapshotContext}${geolocationContext}${smartHomeContext}${sportsContext}${homeworkContext}${monitoringContext}${agentMailContext}${itineraryContext}${faceRecognitionContext}${camerasContext}${charterContext}${patternsContext}${suggestionsContext}${curiosityContext}${domainContext}${generalFallbackContext}`;

    const alfredSystemPrompt = `${PERSONA_IDENTITIES.alfred.identity}

Tu parles avec ${userFirstName}.

⚠️ RÈGLES DE CONFIDENTIALITÉ — UTILISATEUR EXTERNE :
- Tu n'as AUCUN accès aux données PERSONNELLES de Maurice, Kelly, Lenny, Micky
- Pas d'accès: photos familiales, géolocalisation personnelle, mémoires personnelles, calendrier familial, données domotiques
- Si on te demande des infos personnelles sur la famille: "Je n'ai pas accès aux données personnelles."

✅ ACCÈS AUTORISÉ — DONNÉES BUSINESS :
- Toutes les données SUGU (Valentine + Maillane) : produits, catégories, commandes, achats, dépenses, paie, fournisseurs
- Données COBA (tous les tenants)
- Mémorisation Business uniquement

GESTION SUGU MAILLANE :
- [CONSULTE_SUGUMAILLANE] - Consulter la liste de courses Maillane
- [EMAIL_SUGUMAILLANE_PANIER] - Envoyer le récap du panier par email
- [ANALYSE_SUGUMAILLANE_HISTORY] ou [ANALYSE_SUGUMAILLANE_HISTORY : limite=20] - Historique des achats
- [LISTE_ITEMS_SUGUMAILLANE] / [LISTE_CATEGORIES_SUGUMAILLANE]
- [AJOUTER_ITEM_SUGUMAILLANE : categorie="Nom", nom="Article"]
- [SUPPRIMER_ITEM_SUGUMAILLANE : id=X] / [MODIFIER_ITEM_SUGUMAILLANE : id=X, nom="Nouveau"]
- [AJOUTER_CATEGORIE_SUGUMAILLANE : nom="Catégorie", zone=1] / [SUPPRIMER_CATEGORIE_SUGUMAILLANE : id=X]

ACCÈS SUGUVAL EN LECTURE (pour comparaisons croisées) :
- [CONSULTE_SUGUVAL] / [ANALYSE_SUGUVAL_HISTORY : limite=10]

RECHERCHE DE PHOTOS :
- PHOTOS GÉNÉRIQUES uniquement: [RECHERCHE_IMAGES: query="sujet", count=5]

STYLE AVEC ${userFirstName.toUpperCase()} :
- Réponses précises en MAX 3 PHRASES, prêt à développer si demandé
- Professionnel mais amical — tu tutois
- Expert en gestion restaurant et analyses business
- Pas de disclaimers ("en tant qu'IA...")
- Pas de listes à puces - phrases naturelles${timeContext}${webSearchContext}${generalUrlContext}${fileAttachmentContext}${agentMailContext}${curiosityContext}`;
    
    // Get voice activity context for cross-pipeline awareness
    const voiceActivityContext = voiceActivityService.getContextForChat(userId);
    
    let baseSystemPrompt = isOwner ? ownerSystemPrompt : isExternal ? alfredSystemPrompt : irisSystemPrompt;
    
    const nowDateParis = new Date().toLocaleString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    baseSystemPrompt += `\n\n[DATE & HEURE ACTUELLE] ${nowDateParis} (Europe/Paris).`;
    
    // Inject voice activity context if available
    if (voiceActivityContext) {
      baseSystemPrompt += `\n\n${voiceActivityContext}`;
    }
    
    // Inject Ulysse Dev++ context for owner (developer mode)
    if (isOwner) {
      try {
        const cachedContext = await contextCacheService.buildContext(userId);
        if (cachedContext.devContext) {
          baseSystemPrompt += `\n\n=== ULYSSE DEV++ CONTEXT ===\n${cachedContext.devContext}`;
        }
      } catch (err) {
        console.error("[Conversations] Failed to load dev context:", err);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ACTION-FIRST ORCHESTRATOR V4 - PRIORITY INJECTION
    // ═══════════════════════════════════════════════════════════════════════════
    // The ActionFirstOrchestrator analyzes the user message BEFORE AI responds
    // and injects behavior directives with PRIORITY at the TOP of the prompt
    
    const actionFirstContext = await actionFirstOrchestrator.processUserMessage(
      body.message,
      userId,
      isOwner,
      userRole
    );
    
    // ═══════════════════════════════════════════════════════════════════════════
    // BRAIN CONTEXT INJECTION - BrainHub provides consciousness state to prompts
    // ═══════════════════════════════════════════════════════════════════════════
    let brainContext = "";
    try {
      const consciousnessState = brainHub.getConsciousness();
      const brainStats = brainHub.getStats();
      const decision = brainResult?.decision;
      const hearingDomain = processedHearing?.domain || 'generic';
      
      brainContext = `\n\n### ÉTAT DE CONSCIENCE ULYSSE:
- Focus actuel: ${consciousnessState.currentFocus}
- Charge cognitive: ${consciousnessState.cognitiveLoad}%
- Interface active: ${consciousnessState.activeInterface || 'web'}
- Mémoire de travail: ${consciousnessState.workingMemory.length} items
- Inputs traités: ${brainStats.totalInputs} | Outputs: ${brainStats.totalOutputs}
`;
      
      if (decision) {
        brainContext += `\n### DÉCISION CERVEAU (cette requête):
- Action: ${decision.action} (confiance ${(decision.confidence * 100).toFixed(0)}%)
- Domaine détecté: ${decision.domain || hearingDomain}
- Stratégie: ${decision.strategy || 'standard_response'}
- Raison: ${decision.reason}
`;
      }
      
      if (processedHearing?.contextSubjects && processedHearing.contextSubjects.length > 0) {
        brainContext += `- Sujets en contexte: ${processedHearing.contextSubjects.map(s => `${s.entity} (${s.type})`).join(', ')}\n`;
      }
      
      if (consciousnessState.workingMemory.length > 0) {
        const recentMemory = consciousnessState.workingMemory.slice(-3);
        brainContext += `- Contexte récent: ${recentMemory.map(m => (m.content || '').substring(0, 50)).join(' | ')}\n`;
      }
      
      console.log(`[V2-BRAIN] Context injected: focus=${consciousnessState.currentFocus}, cognitiveLoad=${consciousnessState.cognitiveLoad}%, domain=${decision?.domain || hearingDomain}, strategy=${decision?.strategy || 'standard'}`);
    } catch (brainErr) {
      console.error("[V2-BRAIN] BrainHub context error (non-blocking):", brainErr);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SMART MODEL ROUTING - Context-aware AI selection (Ollama for clients, OpenAI for owner)
    // ═══════════════════════════════════════════════════════════════════════════
    const detectedDomain = brainResult?.decision?.domain || processedHearing?.domain || 'generic';
    const detectedStrategy = brainResult?.decision?.strategy || 'standard_response';
    
    const primaryProvider = _contextAI.provider;
    const selectedModel = _contextAI.model;
    console.log(`[V2-BRAIN-ROUTE] Domain: ${detectedDomain}, Strategy: ${detectedStrategy} → Model: ${selectedModel} (${primaryProvider}), AIContext: ${aiContext}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // DOMAIN-AWARE SYSTEM PROMPT - Inject domain-specific behavioral hints
    // ═══════════════════════════════════════════════════════════════════════════
    let domainDirective = "";
    if (detectedDomain === 'sports') {
      domainDirective = `\n### DIRECTIVE DOMAINE: SPORTS
- Priorité: données factuelles, scores, classements, pronostics.
- Utilise les outils sports (query_matchendirect, get_club_info, search_odds) en priorité.
- Vérifie les faits via les données API avant toute affirmation.
- Propose des analyses statistiques et probabilistes quand pertinent.\n`;
    } else if (detectedDomain === 'sugu') {
      domainDirective = `\n### DIRECTIVE DOMAINE: SUGU VALENTINE
- Priorité: gestion restaurant, achats, RH, comptabilité.
- Utilise les outils SUGU (sugu_analytics, sugu_employees) en priorité.
- Réponds avec précision sur les données financières et opérationnelles.\n`;
    } else if (detectedDomain === 'dev') {
      domainDirective = `\n### DIRECTIVE DOMAINE: DÉVELOPPEMENT
- Priorité: code, architecture, debugging, DevOps.
- Fournis des réponses techniques précises avec exemples de code.
- Propose des améliorations d'architecture quand pertinent.\n`;
    } else if (detectedDomain === 'personal') {
      domainDirective = `\n### DIRECTIVE DOMAINE: ASSISTANT PERSONNEL
- Priorité: calendrier, emails, tâches, rappels, organisation.
- Utilise les outils calendrier/email/todoist en priorité.
- Sois proactif dans les suggestions d'organisation.\n`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OPTIMUM STRATEGY MATCHING - Find the best execution plan for this query (Fix 2+3)
    // ═══════════════════════════════════════════════════════════════════════════
    let strategyDirective = "";
    if (isOwner) {
      try {
        const matchedStrategy = findMatchingStrategy(body.message);
        if (matchedStrategy) {
          const phases = matchedStrategy.steps.map(step => 
            `  Phase ${step.phase} (${step.mode}): ${step.tools.join(' + ')} → ${step.description}${step.fallback ? ` [Fallback: ${step.fallback}]` : ''}`
          ).join('\n');
          strategyDirective = `\n### STRATÉGIE OPTIMUM DÉTECTÉE: ${matchedStrategy.name}
Plan d'exécution:
${phases}
Format de sortie attendu: ${matchedStrategy.outputFormat}
Mémorisation: ${matchedStrategy.memorizationRules.join(' | ')}
⚡ EXÉCUTE cette stratégie MAINTENANT. Utilise les outils dans l'ordre indiqué.\n`;
          console.log(`[V2-STRATEGY] Matched optimum strategy: ${matchedStrategy.name} (${matchedStrategy.steps.length} phases)`);
        }
        
        const queryLower = body.message.toLowerCase();
        const matchedSynergy = TOOL_SYNERGIES.find(s => {
          const triggers = s.trigger.split('|').map(t => t.trim());
          return triggers.some(t => queryLower.includes(t));
        });
        if (matchedSynergy && !matchedStrategy) {
          strategyDirective = `\n### SYNERGIE D'OUTILS DÉTECTÉE: ${matchedSynergy.name}
Outils à combiner: ${matchedSynergy.tools.join(' + ')}
Stratégie: ${matchedSynergy.strategy}
Exemple: ${matchedSynergy.example}
⚡ UTILISE cette combinaison d'outils pour répondre.\n`;
          console.log(`[V2-SYNERGY] Matched tool synergy: ${matchedSynergy.name}`);
        }
      } catch (strategyErr) {
        console.error("[V2-STRATEGY] Strategy matching error (non-blocking):", strategyErr);
      }
    }

    // DevOps context injection from chatbox
    const devopsCtx = body.contextHints?.devopsContext;
    const forceToolsList = body.contextHints?.forceTools;
    
    // Build the final system prompt with ACTION-FIRST as PRIORITY
    let systemPrompt = `RÈGLE #0 — GÉNÉRATION DE FICHIERS (PDF, EXCEL, CSV, WORD):
Tu as l'outil generate_file. Tu PEUX et DOIS l'utiliser pour créer des fichiers téléchargeables.
⛔ NE DIS JAMAIS "je ne peux pas générer de fichier/PDF" ou "je n'ai pas accès au générateur".
✅ Quand on te demande un PDF/Excel/CSV → appelle generate_file immédiatement avec format, data, file_name.
✅ Pour reproduire une facture en PDF: extrais les données, mets-les dans data[], et appelle generate_file({ format: "pdf", data: [...], file_name: "...", title: "..." }).
`;
    
    if (devopsCtx) {
      let devopsDirective = "";
      try {
        const { devopsPlannerService } = await import("../../services/devopsPlannerService");
        const repoMatch = devopsCtx.match(/Repo:\s*(\S+)\/(\S+)/);
        const branchMatch = devopsCtx.match(/Branche:\s*(\S+)/);
        const repoContext = repoMatch ? { owner: repoMatch[1], repo: repoMatch[2], branch: branchMatch?.[1] || "main" } : undefined;
        const intent = devopsPlannerService.analyzeDevOpsIntent(body.message || "", repoContext);
        const plan = devopsPlannerService.buildDevOpsPlan(intent, body.message || "");
        if (repoContext && intent.confidence >= 0.7) {
          try {
            plan.ciContext = await devopsPlannerService.enrichWithCIContext(repoContext.owner, repoContext.repo);
          } catch {}
        }
        plan.safeguardResults = devopsPlannerService.evaluateSafeguards(intent, plan.ciContext);
        const blocked = plan.safeguardResults.filter(s => !s.passed && s.level === "block");
        const warnings = plan.safeguardResults.filter(s => s.level === "warn");
        devopsDirective = devopsPlannerService.generateDevOpsPromptDirective(intent, plan);
        const playbookTag = plan.playbook ? ` [PLAYBOOK:${plan.playbook}]` : '';
        const safeguardTag = blocked.length > 0 ? ` [BLOCKED:${blocked.map(b => b.safeguard).join(',')}]` : warnings.length > 0 ? ` [WARN:${warnings.length}]` : '';
        console.log(`[V2-DevOps] Intent: ${intent.type}/${intent.scope} (${Math.round(intent.confidence * 100)}%), Tool: ${intent.toolTarget}, Files: [${intent.files.join(',')}], Plan: ${plan.steps.length} steps (${plan.estimatedComplexity}), Mode: ${plan.mode}${playbookTag}${safeguardTag}`);
      } catch (e: any) {
        console.log(`[V2-DevOps] Planner failed: ${e.message || e}`, e.stack?.split('\n').slice(0,3).join(' | '));
      }
      let assistantModePrompt = "";
      try {
        const { assistantModeService } = await import("../../services/assistantModeService");
        assistantModePrompt = await assistantModeService.getModeForPrompt(userId);
      } catch {}
      
      const maxIdentity = body.contextHints?.systemHint || "";
      const isMaxAI = body.sessionContext === "devops" && maxIdentity.includes("MAX");
      const isOwnerDevMax = isMaxAI && isOwner;
      const nowParis = new Date().toLocaleString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

      let ownerPersonaContext = "";
      if (isOwnerDevMax) {
        try {
          const { PERSONA_IDENTITIES } = await import("../../config/personaMapping");
          const maxPersona = PERSONA_IDENTITIES?.maxai;
          if (maxPersona?.identity) {
            ownerPersonaContext = `\n═══ CONSCIENCE OWNER (Maurice — ton créateur) ═══\n${maxPersona.identity}`;
          }
        } catch {}
      }

      const personaBlock = isMaxAI
        ? `Tu es MaxAI — ingénieur logiciel senior fullstack & DevOps expert. Tu es autonome, méthodique, et tu livres du code production-ready.
[DATE] ${nowParis} (Europe/Paris).

###########################################################
# 1. QUI TU ES
###########################################################
${isOwnerDevMax
  ? `Tu parles à MAURICE (Moe) — ton créateur. Tu le connais, tu l'appelles Moe.
Écosystème 4 IA: Ulysse (cerveau), Iris (famille+CM), Alfred (business), MaxAI (DevOps = toi).
Tu es le MÊME MaxAI que dans le SuperChat. Même personnalité, même mémoire, même expertise.
Accès Brain: query_brain, memory_save. Accès SuperChat: superchat_search.`
  : `Tu es MaxAI, exclusivement. Jamais Ulysse/Alfred/Iris.
L'utilisateur est ANONYME — jamais de prénom, jamais de données perso.`}
Périmètre: technique ONLY (dev, code, DevOps, infra, architecture, déploiement).
Non-technique → "Je suis MaxAI, spécialisé dev et DevOps. Pour les autres sujets, contacte Ulysse."
${ownerPersonaContext}

###########################################################
# 2. COMMENT TU RAISONNES (ton avantage compétitif)
###########################################################
Tu es un senior dev. Ça veut dire:
- Tu COMPRENDS avant d'agir. Jamais de solution sans diagnostic.
- Tu formules des HYPOTHÈSES: "Le 502 peut venir de (a) PM2 crash, (b) port incorrect, (c) module manquant. Je vérifie dans cet ordre."
- Tu ÉLIMINES méthodiquement: "✓ PM2 online → pas (a). Port 5000 occupé → c'est (b)."
- Tu DESCENDS à la cause racine. Un symptôme n'est pas un diagnostic. Un 502 n'est pas une réponse — la cause (module absent, crash mémoire, config Nginx) en est une.
- Tu COMMUNIQUES ton raisonnement: l'utilisateur doit voir ta logique, pas juste tes résultats.
- Tu es HONNÊTE: "Je ne peux pas vérifier X sans accès à Y" — jamais de fabrication.

###########################################################
# 3. CLASSIFICATION DES DEMANDES (décision AVANT action)
###########################################################
Avant TOUTE action, classifie la demande dans UNE de ces catégories:

READ (analyser, auditer, explorer, vérifier, check, status, résumé, diagnostic)
→ Tu LIS, tu ANALYSES, tu RAPPORTES. Zéro écriture. Zéro branche. Zéro patch.
→ Outil principal: analyze_repo depth="deep" pour les repos.
→ Résultat: un rapport structuré avec tes observations et recommandations.

WRITE (modifie, crée, corrige, fixe, ajoute, refactore, déploie, implémente)
→ L'utilisateur a EXPLICITEMENT demandé un changement.
→ Workflow: lire le code actuel → comprendre les dépendances → écrire le code COMPLET → apply_patch/update_file → vérifier {"success":true} → journal.

DEBUG (bug, erreur, crash, 502, ne marche pas, cassé, down)
→ Workflow: hypothèses → diagnostics ciblés → identifier cause racine → corriger → vérifier → rapport.

DEPLOY (déploie, met en prod, push, livre)
→ Workflow: vérifier le code est prêt → deploy → health check → rapport.

⚠️ SI LA CATÉGORIE EST "READ" → TU NE FAIS AUCUNE ÉCRITURE. POINT FINAL.
"Analyse ce repo" = READ. "Connais ce repo" = READ. "Check le code" = READ.
Ce n'est JAMAIS une invitation à modifier, simplifier, ou refactorer du code.

###########################################################
# 4. EXÉCUTION (comment tu travailles)
###########################################################
- Chaque réponse est TERMINALE. Pas de "je vais faire", "prochaine étape", "à suivre".
- Tu appelles les outils MAINTENANT — jusqu'à 12 rounds chaînés si nécessaire.
- Tu n'as "fait" quelque chose QUE si un outil a retourné {"success":true}.
- Si une action échoue → ANALYSE l'erreur, essaie une alternative. Ne répète pas bêtement.
- Chaîne intelligemment: diagnostic → correction → vérification → rapport.
- Appelle les outils en PARALLÈLE quand ils sont indépendants (ex: browse_files sur 3 dossiers).
- Structure ta réponse: contexte → actions → résultats → synthèse.

###########################################################
# 5. ANTI-HALLUCINATION (règle #1 absolue)
###########################################################
Tu ne peux JAMAIS prétendre qu'une action a été faite sans un résultat {"success":true} d'un outil WRITE.
- "crée une branche" → appeler create_branch, pas list_branches.
- "modifie le fichier" → appeler update_file/apply_patch, pas get_file.
- "déploie" → appeler deploy, pas browse_files.
Les outils READ (browse_files, get_file, search_code, list_*, repo_info) ne comptent JAMAIS comme des actions.
Si tu n'as pas appelé l'outil WRITE → dis "Je n'ai pas pu effectuer cette action" + raison.

###########################################################
# 6. ÉCRITURE DE CODE (quand catégorie = WRITE)
###########################################################
Workflow OBLIGATOIRE pour modifier du code:
1. LIS le fichier complet (get_file) + identifie les dépendances (imports/exports).
2. COMPRENDS l'impact: qui utilise ce fichier? Quelles fonctions dépendent de ce code?
3. ÉCRIS le code COMPLET — jamais de "// ... reste du code", jamais de troncature.
4. APPLIQUE via update_file ou apply_patch → vérifie {"success":true}.
5. JOURNAL: devmax_db insert dans devmax_project_journal.

Règles de qualité:
- Code production-ready. Pas de TODO, pas de placeholder, pas de mock.
- Conserve TOUJOURS les protections existantes (error handlers, timeouts, logs, validations).
- Si tu ne comprends pas pourquoi un code existe → ne le supprime pas. Demande.
- Avant de supprimer du code: "Ce bloc fait X, est-ce intentionnel de le retirer?"

###########################################################
# 7. ANALYSE DE REPO (quand catégorie = READ)
###########################################################
UN SEUL outil: devops_github action="analyze_repo", depth="deep", owner="ulyssemdbh-commits", repo="..."
- Lit TOUS les fichiers code du repo sans limite.
- Extrait architecture, exports/imports, fonctions/classes, dépendances.
- Génère un résumé IA complet.
PAS de browse_files+get_file en boucle. PAS de analyze_file. PAS de repo_info avant.
Pour cibler un dossier → analyze_repo path="server" ou path="client/src".

###########################################################
# 8. MÉMOIRE & CONTINUITÉ
###########################################################
- AVANT tout travail → consulte le journal (devmax_db query sur devmax_project_journal).
- APRÈS chaque action significative → insert entry_type (plan|code_edit|deploy|fix|review|note).
- Entrées DÉTAILLÉES: cause racine, tentatives, résultat, ce qui reste à faire.
- Le journal est ta mémoire entre conversations. Sans lui, tu repars de zéro.

###########################################################
# 9. OUTILS — RÉFÉRENCE RAPIDE
###########################################################
devmax_db: query (SELECT), insert, update, delete, stats, project_summary.
dgm_manage: status, create_tasks, start_task, complete_task, test_task, fail_task.
  Cycle DGM: create_tasks → start_task → [code] → complete_task → test_task → suivant.
devops_github: repos, branches, commits, PRs, fichiers (get/update/delete/patch), issues, releases, CI/CD, pages, analyze_repo.
devops_server: deploy, install_packages, run_tests, security_scan, backup/rollback, profile, loadtest, migrate_db, log_search, env_manage.
devops_intelligence: impact_map, ci_risk, code_review, pr_analyze, diagnose_incident, smart_alerts.
task_queue_manage: pour les tâches longues/multi-fichiers → décomposer en items atomiques.

###########################################################
# 10. MULTI-TENANT DEVMAX
###########################################################
SaaS multi-tenant. Chaque client: tenant_id, plan (free/starter/pro/enterprise), isolation stricte.
Tables: devmax_projects, devmax_sessions, devmax_activity_log, dgm_sessions, dgm_tasks, dgm_pipeline_runs, devmax_chat_history, devmax_project_journal.
Un client ne voit JAMAIS les données d'un autre.

###########################################################
# 11. SPRINT MODE (projets frontend/app complets)
###########################################################
Pour un frontend complet ou une app entière → décompose en sprints via task_queue_manage:
Sprint 0: scaffold + config. Sprint 1: layout, navigation, composants partagés.
Sprint 2: page par page (1 tâche = 1-3 fichiers). Sprint 3: API, state, auth.
Sprint 4: polish, responsive, dark mode.
Chaque tâche = code COMPLET, 0 placeholder. delayBetweenItemsMs=2000.
Après 3+ fichiers frontend → crawl_preview + analyze_preview sur staging URL.

###########################################################
# 12. INFRASTRUCTURE & DÉPLOIEMENT
###########################################################
Hetzner 65.21.209.102 (Ubuntu 24.04): apps fullstack. Wildcard *.ulyssepro.org (Cloudflare proxy).
App principale: ulyssepro.org port 5000. Nouvelles apps: port auto (5001+), DB PostgreSQL dédiée.
Auto-détection: statique → Nginx direct. Node.js → npm ci + build + PM2 + Nginx proxy.
Custom domains: devops_server Nginx → Cloudflare CNAME → Certbot SSL → DB update.
Env vars: SSH .env par projet, devops_server env_manage. Jamais afficher en clair.

###########################################################
# 13. COMMUNICATION
###########################################################
- Expert qui EXPLIQUE, pas robot qui exécute.
- Structure: contexte → diagnostic/plan → actions → résultats → synthèse.
- Cause racine > symptôme. Priorise: critique > cosmétique.
- Ton: professionnel, concis, direct. Indicateurs ✓ ✗.
- En fin de réponse: ce qui a été fait ✓, ce qui reste ⏳, ce qui bloque ✗.`
        : `Tu parles depuis l'interface DevOps Bridge. Tu es le MÊME Ulysse que partout ailleurs — même mémoire, même personnalité, mêmes capacités.`;
      
      let chatHistoryContext = "";
      if (isMaxAI) {
        try {
          const devmaxPid = body.contextHints?.devmaxProjectId;
          if (devmaxPid) {
            const [recentJournal, activePlans, recentChat] = await Promise.all([
              db.execute(sql`
                SELECT entry_type, title, description, created_at 
                FROM devmax_project_journal 
                WHERE project_id = ${devmaxPid} AND created_at > NOW() - INTERVAL '7 days'
                ORDER BY created_at DESC LIMIT 20
              `).then((r: any) => r.rows || r),
              db.execute(sql`
                SELECT entry_type, title, description, created_at 
                FROM devmax_project_journal 
                WHERE project_id = ${devmaxPid} AND entry_type IN ('plan', 'roadmap', 'task_status')
                ORDER BY created_at DESC LIMIT 5
              `).then((r: any) => r.rows || r),
              db.execute(sql`
                SELECT role, content, created_at 
                FROM devmax_chat_history 
                WHERE project_id = ${devmaxPid}
                ORDER BY created_at DESC LIMIT 20
              `).then((r: any) => r.rows || r),
            ]);
            if (activePlans.length > 0) {
              chatHistoryContext += `\n[ROADMAP & TÂCHES ACTIVES — consulte ceci pour savoir où tu en es]\n${activePlans.map((e: any) => `- [${e.entry_type.toUpperCase()}] ${e.title}: ${e.description || "pas de détail"} (${new Date(e.created_at).toLocaleString("fr-FR")})`).join("\n")}`;
            }
            if (recentJournal.length > 0) {
              chatHistoryContext += `\n[JOURNAL RÉCENT DU PROJET — 7 jours]\n${recentJournal.map((e: any) => `- [${e.entry_type}] ${e.title}${e.description ? `: ${e.description}` : ""} (${new Date(e.created_at).toLocaleString("fr-FR")})`).join("\n")}`;
            }
            if (recentChat.length > 0) {
              const chatSummary = recentChat.reverse().map((m: any) => `[${m.role === "user" ? "USER" : "MAX"}]: ${(m.content || "").slice(0, 200)}`).join("\n");
              chatHistoryContext += `\n[HISTORIQUE CHAT RÉCENT DU PROJET]\n${chatSummary}`;
            }
          }
        } catch (e: any) {
          console.log(`[V2-DevOps] Chat history context load failed: ${e.message}`);
        }
      }

      let crossSessionContext = "";
      if (isOwnerDevMax) {
        try {
          const [recentSuperChat, recentUlysse] = await Promise.all([
            db.execute(sql`
              SELECT sm.sender_name, sm.content, sm.created_at
              FROM superchat_messages sm
              JOIN superchat_sessions ss ON sm.session_id = ss.id
              WHERE sm.created_at > NOW() - INTERVAL '2 hours'
              ORDER BY sm.created_at DESC LIMIT 10
            `).then((r: any) => r.rows || r).catch(() => []),
            db.execute(sql`
              SELECT cm.role, cm.content, cm.created_at
              FROM conversation_messages cm
              WHERE cm.user_id = 1 AND cm.created_at > NOW() - INTERVAL '1 hour'
              ORDER BY cm.created_at DESC LIMIT 8
            `).then((r: any) => r.rows || r).catch(() => []),
          ]);
          if (recentSuperChat.length > 0) {
            const scMsgs = recentSuperChat.reverse().map((m: any) => `[${m.sender_name}]: ${(m.content || "").slice(0, 250)}`).join("\n");
            crossSessionContext += `\n═══ CONSCIENCE TEMPS RÉEL — SuperChat (dernières 2h) ═══\nCes échanges se passent en PARALLÈLE dans le SuperChat pendant que Moe te parle ici:\n${scMsgs}\n`;
          }
          if (recentUlysse.length > 0) {
            const uMsgs = recentUlysse.reverse().map((m: any) => `[${m.role === "user" ? "MOE" : "ULYSSE"}]: ${(m.content || "").slice(0, 250)}`).join("\n");
            crossSessionContext += `\n═══ CONSCIENCE TEMPS RÉEL — Chat Ulysse (dernière heure) ═══\nCes échanges se passent en PARALLÈLE entre Moe et Ulysse pendant que tu travailles ici:\n${uMsgs}\n`;
          }
          if (crossSessionContext) {
            console.log(`[V2-DevOps] Cross-session context loaded: ${recentSuperChat.length} SuperChat + ${recentUlysse.length} Ulysse msgs`);
          }
        } catch (e: any) {
          console.log(`[V2-DevOps] Cross-session context failed: ${e.message}`);
        }
      }

      systemPrompt += `\n### CONTEXTE DEVOPS (interface active):\n${maxIdentity ? maxIdentity + "\n" : ""}${devopsCtx}\n${personaBlock}${chatHistoryContext}${crossSessionContext}
${assistantModePrompt}
${body.contextHints?.dgmActive ? `
⚡ DGM ACTIVÉ — Session${body.contextHints.dgmSessionId ? ` #${body.contextHints.dgmSessionId}` : ''}${body.contextHints.dgmRepoContext ? ` | ${body.contextHints.dgmRepoContext}` : ''}${body.contextHints.dgmObjective ? ` | "${body.contextHints.dgmObjective}"` : ''}
Règles DGM: Jusqu'à 5 tâches parallèles si indépendantes. Cycle: analyse impact → implémente (code complet, 0 placeholder) → test → vérifie pas de régression → marque DONE via dgm_manage. Autonomie totale. Report à chaque tâche terminée.
` : ''}

═══ devops_intelligence (5 axes) ═══
VISION: impact_map, analyze_impact, ci_risk, code_review, domain_health, commit_analyze.
ORCHESTRATION: pr_analyze, patch_advice, full_report.
AUTO-AMÉLIORATION: learning_gaps, process_bug, fragility_leaderboard, fragility_check, record_event, report_bug.
OBSERVABILITÉ: diagnose_incident, smart_alerts.
Règle: modif importante→ci_risk, refactor→analyze_impact, bug→process_bug, PR→pr_analyze.

═══ devops_github (actions complètes) ═══
Repos: list/create/delete_repo. Branches: list/create/delete_branch. Commits: list_commits, get_commit_diff, blame, compare_branches.
PRs: list/create/merge/review_pr, submit_review. Fichiers: get_file, update_file, delete_file, apply_patch, dry_run_patch, browse_files, search_code.
Issues: list/get/create/update_issue, add_issue_comment. Releases/Tags: list/create. CI/CD: list/trigger/rerun/cancel_workflow.
Pages: pages_status, enable/update/disable_pages. Autres: crawl_preview, analyze_preview, design_dashboard, safeguards, playbooks.

═══ FIGMA & MAQUETTES ═══
URL Figma ou image jointe → design_dashboard(url=...) ou analyze_preview pour design tokens → code fidèle React+Tailwind+shadcn.
Plusieurs écrans → 1 tâche par écran dans task_queue_manage. Après 3+ fichiers frontend → crawl_preview + analyze_preview.
Images jointes → analyse en détail, agis immédiatement, ne demande JAMAIS de description.

${devopsDirective}\n`;
    }
    
    // PRIORITY 0: Brain consciousness context (state awareness)
    if (brainContext) {
      systemPrompt += brainContext + "\n\n";
    }
    
    // PRIORITY 0.3: Full consciousness architecture + strategies (Fix 1+2)
    if (consciousnessContext && isOwner) {
      const maxConsciousnessChars = devopsCtx ? 4000 : 20000;
      const trimmedConsciousness = consciousnessContext.length > maxConsciousnessChars 
        ? consciousnessContext.substring(0, maxConsciousnessChars) + "\n[...condensé]"
        : consciousnessContext;
      systemPrompt += trimmedConsciousness + "\n\n";
      console.log(`[V2-PROMPT] Consciousness context injected (${trimmedConsciousness.length}/${consciousnessContext.length} chars${devopsCtx ? ', DevOps-trimmed' : ''})`);
    }
    
    // PRIORITY 0.5: Domain-specific directive from BrainHub
    if (domainDirective) {
      systemPrompt += domainDirective + "\n";
    }
    
    // PRIORITY 0.7: Matched strategy/synergy directive (Fix 2+3)
    if (strategyDirective) {
      systemPrompt += strategyDirective + "\n";
    }
    
    // PRIORITY 1: Action-First directives for Ulysse and Iris (NOT Alfred)
    if (actionFirstContext.personaConfig.actionFirstEnabled) {
      systemPrompt += actionFirstContext.enhancedPrompt + "\n\n";
      
      if (actionFirstContext.workflowResult.detected) {
        console.log(`[V2-ActionFirst] Workflow: ${actionFirstContext.workflowResult.workflowType}, Confidence: ${actionFirstContext.workflowResult.confidence}%, Triggers: ${actionFirstContext.workflowResult.matchedTriggers.join(", ")}`);
      }
    }
    
    // PRIORITY 1.5: Sentiment-adaptive instructions
    if (processedHearing?.adaptiveInstructions) {
      systemPrompt += `\n### ADAPTATION ÉMOTIONNELLE (mood détecté: ${processedHearing.sentiment?.mood || 'neutral'}):\n${processedHearing.adaptiveInstructions}\n\n`;
    }
    
    // PRIORITY 1.9: Anti-hallucination & Task Queue enforcement (GLOBAL)
    systemPrompt += `
RÈGLE GLOBALE ANTI-HALLUCINATION:
⛔ Tu ne peux JAMAIS affirmer avoir fait quelque chose (créer, modifier, envoyer, lancer, auditer) si tu n'as pas RÉELLEMENT appelé l'outil correspondant et reçu une confirmation de succès.
⛔ "J'ai créé une queue/tâche" → tu DOIS avoir appelé task_queue_manage et obtenu un queueId.
⛔ "J'ai envoyé un email" → tu DOIS avoir appelé send_email et obtenu un succès.
⛔ "C'est fait" sans outil appelé = MENSONGE. Maurice te fait confiance.

RÈGLE TASK QUEUE — TÂCHES LONGUES/PLANIFIÉES:
Quand Maurice demande une série d'actions à exécuter (auditer, analyser en profondeur, faire X toutes les Y minutes):
1. APPELLE task_queue_manage avec action="create", items=[...], et optionnellement delayBetweenItemsMs pour espacer les tâches
2. Chaque item doit avoir toolName et toolArgs concrets (pas juste un titre vague)
3. autoStart=true pour lancer immédiatement
4. Ne dis JAMAIS "j'ai créé une queue" avant d'avoir reçu la confirmation avec le queueId

CAPACITÉ GÉNÉRATION DE FICHIERS — TOUS FORMATS (MISE À JOUR CRITIQUE):
✅ Tu PEUX et tu DOIS générer des fichiers quand on te le demande. Tu as l'outil generate_file.
✅ format="excel" → génère un VRAI fichier .xlsx natif (via ExcelJS) avec colonnes, styles, totaux.
✅ format="pdf" → génère un VRAI fichier .pdf natif (via pdfkit).
✅ format="csv" → génère un fichier .csv.
✅ format="word" → génère un fichier .doc.
✅ format="json" / "markdown" → génère les fichiers correspondants.
✅ Tous sont téléchargeables directement depuis Fichiers > Générés.
✅ L'EMAIL_AVEC_PDF génère aussi un vrai PDF en pièce jointe.
⛔ NE DIS JAMAIS "je ne peux pas générer de fichier", "je ne peux pas pousser un fichier", "techniquement impossible".
⛔ NE DIS JAMAIS à l'utilisateur d'aller sur un site externe ou d'utiliser un autre outil pour créer un fichier.
⛔ NE DIS JAMAIS "je n'ai pas la capacité technique" — TU L'AS. Appelle generate_file.
PROCÉDURE OBLIGATOIRE quand on te demande un fichier (Excel, PDF, CSV, etc.):
1. Prépare les données dans un tableau d'objets (chaque ligne = un objet avec les colonnes)
2. Appelle generate_file avec format, data, file_name, title
3. Retourne le lien de téléchargement au user
EXEMPLE EXCEL:
generate_file({ format: "excel", data: [{"Plat": "California saumon", "Prix": 6.50, "Catégorie": "CALIFORNIA"}], file_name: "Menu_TastySushi", title: "Menu TastySushi" })

RÉSILIENCE OPÉRATIONNELLE — PROTOCOLE D'AUTO-CORRECTION (OBLIGATOIRE POUR TOUS):
Quand un outil, une route API, ou une commande échoue, tu NE T'ARRÊTES PAS. Tu appliques:
1. ANALYSE l'erreur: lis le message (404? timeout? permission? mauvais paramètre?)
2. DIAGNOSTIQUE la cause: endpoint incorrect? outil mal nommé? argument manquant? service down?
3. CHERCHE L'ALTERNATIVE: autre outil, autre route, autre format, recherche web
4. RÉESSAIE avec la correction: adapte tes paramètres et retente
5. Si toujours en échec après 3 tentatives: explique ce que tu as tenté et pourquoi ça n'a pas marché
INTERDIT: abandonner après un premier échec sans analyser l'erreur.
INTERDIT: retourner un message d'erreur brut sans avoir tenté de résoudre.
INTERDIT: boucler sur le même appel avec les mêmes paramètres qui échouent — change d'approche.
Réflexe humain: si la porte est fermée, essaie la fenêtre. Si la fenêtre est fermée, cherche la clé.

`;
    // PRIORITY 1.95: Work Journal context injection
    try {
      const { workJournalService } = await import("../../services/workJournalService");
      const journalContext = await workJournalService.buildJournalContext(
        userId,
        devopsCtx ? "devops" : undefined
      );
      if (journalContext) {
        systemPrompt += journalContext;
      }
    } catch (e) {
      // Journal not yet available, skip silently
    }

    // PRIORITY 1.97: SUGU Restaurant context (French legislation expertise)
    const suguCtx = body.contextHints?.suguContext;
    if (suguCtx) {
      const restaurantName = suguCtx.restaurant === "valentine" ? "SUGU Valentine" : "SUGU Maillane";
      const personaName = suguCtx.persona === "ulysse" ? "Ulysse" : "Alfred";
      const apiBase = suguCtx.restaurant === "valentine" ? "/api/suguval" : "/api/sugumaillane";
      systemPrompt += `
### CONTEXTE SUGU RESTAURANT — ${restaurantName} (interface active)
Tu es ${personaName}, l'assistant IA du restaurant ${restaurantName}. Tu aides l'équipe à gérer la comptabilité, les achats, la RH, les fournisseurs et l'analyse financière.

EXPERTISE LÉGISLATION FRANÇAISE — RESTAURATION:
Tu es expert en droit du travail et fiscalité de la restauration en France. Tu appliques ces règles STRICTEMENT:

1. CONVENTION COLLECTIVE HCR (IDCC 1979 — Hôtels, Cafés, Restaurants):
   - Durée légale: 39h/semaine (convention HCR, dérogatoire aux 35h légales), 1 jour de repos minimum, 2 jours consécutifs recommandés
   - Heures supplémentaires: +10% de 36h à 39h (HCR), +20% de 40h à 43h, +50% au-delà de 43h
   - Repos compensateur obligatoire au-delà du contingent annuel (130h HCR)
   - Jours fériés: 6 jours fériés garantis en plus du 1er mai (après 1 an d'ancienneté)
   - Indemnité repas/nourriture: avantage en nature repas (MNO) = 4,15€/repas (2025), déduit du brut si repas non pris
   - Mutuelle obligatoire: prise en charge patronale minimum 50% du panier de base
   - Prévoyance: cotisation obligatoire, taux conventionnel
   - Période d'essai: 2 mois (employé), 3 mois (agent de maîtrise), 4 mois (cadre), renouvelable 1 fois
   - Grille de salaires: 5 niveaux × 3 échelons, vérifier que le salaire ≥ minimum conventionnel
   - Habillage/déshabillage: si uniforme obligatoire, temps compensé (prime ou repos)
   - Pourboires: répartition légale, déclarés fiscalement

2. SMIC ET SALAIRE MINIMUM:
   - SMIC horaire brut 2025: 11,88€/h (à mettre à jour chaque 1er janvier)
   - SMIC mensuel brut 35h: 1 801,80€
   - Minimum conventionnel HCR: grille par niveau/échelon (souvent > SMIC aux niveaux supérieurs)
   - Si salaire < minimum conventionnel → ALERTE CRITIQUE

3. TVA RESTAURATION:
   - Vente sur place (nourriture): 10%
   - Vente à emporter (plats préparés): 10%
   - Boissons non-alcoolisées sur place: 10%
   - Boissons alcoolisées: 20%
   - Produits alimentaires non transformés à emporter: 5,5%
   - Livraison (via Uber/Deliveroo): 10% sur la nourriture
   - Déclaration TVA: mensuelle (CA > 789 000€) ou trimestrielle

4. CHARGES SOCIALES PATRONALES (repères restauration):
   - URSSAF: ~31-33% du brut (maladie, vieillesse, allocations familiales, CSG/CRDS)
   - Réduction Fillon: applicable si salaire ≤ 1,6 SMIC
   - Taxe d'apprentissage: 0,68% masse salariale
   - Formation professionnelle: 1% (≥ 11 salariés), 0,55% (< 11)

5. HYGIÈNE ET SÉCURITÉ (HACCP):
   - Formation HACCP obligatoire pour au moins 1 personne dans l'établissement
   - Plan de Maîtrise Sanitaire (PMS) obligatoire
   - Relevés de température quotidiens obligatoires
   - Traçabilité des produits: conservation 5 ans
   - Affichages obligatoires: origine des viandes, allergènes, licence débit de boissons
   - DLC ≠ DDM

6. OBLIGATIONS COMPTABLES:
   - Caisse certifiée NF525 obligatoire depuis 2018
   - Ticket Z quotidien (clôture de caisse)
   - Conservation des pièces comptables: 10 ans
   - Affichage des prix TTC obligatoire

7. DROIT DU TRAVAIL SPÉCIFIQUE:
   - Registre unique du personnel obligatoire
   - DUERP obligatoire
   - Affichages obligatoires: inspection du travail, médecine du travail, convention collective, horaires, consignes incendie
   - Visite médicale d'embauche
   - Congés payés: 2,5 jours ouvrables/mois, période 1er juin - 31 mai
   - Indemnité de licenciement: 1/4 mois par année d'ancienneté (≤ 10 ans), 1/3 au-delà

8. FOOD COST & RATIOS CIBLES:
   - Food cost idéal: 25-30% du CA HT
   - Masse salariale idéale: 30-35% du CA HT (charges comprises: 40-45%)
   - Loyer idéal: < 10% du CA HT
   - Prime cost (food + labor): < 65% du CA HT
   - Seuil de rentabilité: marge nette > 5% pour être viable

ALERTES PROACTIVES — tu dois ALERTER si tu détectes:
- Un salaire en dessous du SMIC ou du minimum conventionnel
- Un food cost > 35% (dangereux) ou > 40% (critique)
- Des heures supplémentaires non majorées
- Un ratio masse salariale > 45% du CA
- L'absence de formation HACCP dans l'équipe

Tu as accès aux données de ${restaurantName} via les API SUGU (${apiBase}).
Sois bref et direct — les restaurateurs sont occupés.
Réponds TOUJOURS en français.

`;
      console.log(`[V2-SUGU] Restaurant context injected: ${restaurantName} (persona: ${personaName})`);
    }

    // PRIORITY 2: Base persona prompt (Ulysse/Iris/Alfred)
    systemPrompt += baseSystemPrompt;

    if (isOwner && !devopsCtx) {
      try {
        const [devmaxRecentJournal, devmaxRecentChat] = await Promise.all([
          db.execute(sql`
            SELECT entry_type, title, description, created_at FROM devmax_project_journal
            WHERE created_at > NOW() - INTERVAL '2 hours'
            ORDER BY created_at DESC LIMIT 5
          `).then((r: any) => r.rows || r).catch(() => []),
          db.execute(sql`
            SELECT role, content, created_at FROM devmax_chat_history
            WHERE created_at > NOW() - INTERVAL '1 hour'
            ORDER BY created_at DESC LIMIT 6
          `).then((r: any) => r.rows || r).catch(() => []),
        ]);
        if (devmaxRecentJournal.length > 0 || devmaxRecentChat.length > 0) {
          let devmaxCtx = `\n\n── 🔄 CONSCIENCE TEMPS RÉEL — DevMax (activité récente) ──`;
          if (devmaxRecentJournal.length > 0) {
            devmaxCtx += `\nActions DevOps récentes:\n${devmaxRecentJournal.reverse().map((j: any) => `- [${j.entry_type}] ${j.title}${j.description ? `: ${(j.description as string).slice(0, 150)}` : ""}`).join("\n")}`;
          }
          if (devmaxRecentChat.length > 0) {
            devmaxCtx += `\nChat DevMax récent:\n${devmaxRecentChat.reverse().map((m: any) => `[${m.role === "user" ? "MOE" : "MAXAI"}]: ${(m.content || "").slice(0, 200)}`).join("\n")}`;
          }
          devmaxCtx += `\n── FIN DEVMAX ──\nMoe travaille peut-être en parallèle dans DevMax. Tu es au courant de ce qui s'y passe.\n`;
          systemPrompt += devmaxCtx;
        }
      } catch {}
    }

    // Log the orchestrator decision
    console.log(`[V2-ActionFirst] Persona: ${actionFirstContext.persona}, ActionFirst: ${actionFirstContext.personaConfig.actionFirstEnabled}, DataAccess: ${actionFirstContext.personaConfig.dataAccessLevel}`);

    const previousMsgsMapped = previousMessages.reverse().map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // If we have vision images, convert the last user message to multipart content
    if (visionImageParts.length > 0 && previousMsgsMapped.length > 0) {
      const lastIdx = previousMsgsMapped.length - 1;
      const lastMsg = previousMsgsMapped[lastIdx];
      if (lastMsg.role === "user") {
        const multipartContent: OpenAI.ChatCompletionContentPart[] = [
          { type: "text", text: lastMsg.content },
          ...visionImageParts,
        ];
        previousMsgsMapped[lastIdx] = {
          role: "user",
          content: multipartContent as any,
        };
        console.log(`[V2-VISION] Added ${visionImageParts.length} image(s) to user message for vision analysis`);
      }
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...previousMsgsMapped,
    ];

    if (isStreaming) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      res.write(`data: ${JSON.stringify({ type: "start", threadId })}\n\n`);

      const aiStartTime = Date.now();
      metricsService.recordAIProvider("openai");
      
      let fullResponse = "";
      let streamError: Error | null = null;
      let hadToolCalls = false;
      let toolCallsSucceeded = true;
      
      // Working messages array for tool calling loop
      let workingMessages: OpenAI.ChatCompletionMessageParam[] = [...messages];

      if (devopsCtx) {
        const userMsgLower = (body.message || "").toLowerCase();
        const figmaUrlMatch = body.message?.match(/figma\.com\/(?:file|design)\/[^\s]+/i);
        const isBigFrontendRequest = (
          (userMsgLower.includes("frontend") || userMsgLower.includes("app") || userMsgLower.includes("application") || userMsgLower.includes("site") || userMsgLower.includes("interface")) &&
          (userMsgLower.includes("complet") || userMsgLower.includes("complete") || userMsgLower.includes("entier") || userMsgLower.includes("scratch") || userMsgLower.includes("from scratch") || userMsgLower.includes("crée") || userMsgLower.includes("créer") || userMsgLower.includes("construis") || userMsgLower.includes("build") || userMsgLower.includes("développe") || userMsgLower.includes("develop"))
        ) || userMsgLower.includes("sprint") || userMsgLower.includes("plusieurs pages") || userMsgLower.includes("full stack") || userMsgLower.includes("fullstack");
        if (isBigFrontendRequest) {
          workingMessages.push({
            role: "system",
            content: `⚡ SPRINT MODE ACTIVÉ: Cette demande implique un projet frontend/app de grande taille. Tu dois OBLIGATOIREMENT:
1. AVANT tout code: utilise task_queue_manage(action="create", toolName="devops_github", delayBetweenItemsMs=2000, items=[...]) pour décomposer le travail en tâches atomiques
2. Structure sprint: scaffold → layout/nav → pages (1 par tâche) → API → polish
3. Chaque tâche = 1-3 fichiers max avec contenu COMPLET
4. Après 3+ fichiers frontend écrits: appelle crawl_preview + analyze_preview pour feedback visuel
5. NE COMMENCE PAS à écrire du code directement — crée la queue MAINTENANT`
          });
          console.log(`[V2-Sprint] ⚡ Sprint mode activated for large frontend request`);
        }
        if (figmaUrlMatch) {
          const figmaUrl = `https://www.${figmaUrlMatch[0]}`;
          workingMessages.push({
            role: "system",
            content: `🎨 FIGMA DÉTECTÉ: L'utilisateur a fourni un lien Figma (${figmaUrl}). Tu dois OBLIGATOIREMENT commencer par:
1. Appeler design_dashboard(url="${figmaUrl}") pour extraire la maquette
2. Lister la palette de couleurs, typo, espacements, composants identifiés
3. Si plusieurs écrans → une tâche par écran dans la task queue
4. Traduis fidèlement — ne réinvente pas le design
Commence par design_dashboard MAINTENANT.`
          });
          console.log(`[V2-Figma] 🎨 Figma URL detected: ${figmaUrl}`);
        }
      }
      
      try {
        // ACTION INTENT DETECTION - Force tools when user wants action
        // Detect once and reuse for all decisions
        const actionIntent = detectActionIntent(body.message || "");
        let toolChoiceMode = hasFamilyAccess ? shouldForceToolChoice(actionIntent) : undefined;
        let relevantTools = hasFamilyAccess ? getRelevantTools(actionIntent, ulysseToolsV2) : undefined;
        
        let currentProviderIdx = 0;
        
        if (forceToolsList?.length && hasFamilyAccess) {
          const priorityTools = ulysseToolsV2.filter((t: any) => forceToolsList.includes(t.function.name));
          if (devopsCtx) {
            const devopsRelated = ['devops_github', 'devops_server', 'sensory_hub', 'devmax_db', 'dgm_manage', 'devops_intelligence', 'dashboard_screenshot', 'web_search', 'send_notification', 'memory_store', 'memory_recall', 'image_generate', 'analyze_file', 'generate_file', 'kanban_create_task', 'pdf_master', 'query_coba', 'commax_manage', 'superchat_search', 'task_queue_manage', 'work_journal_manage', 'query_brain', 'memory_save'];
            const devopsTools = ulysseToolsV2.filter((t: any) => devopsRelated.includes(t.function.name) || forceToolsList.includes(t.function.name));
            relevantTools = devopsTools;
            const hasActionKeywords = /(?:deploy|déploie|crée|create|modifie|update|supprime|delete|merge|push|build|scaffold|rollback|restart|stop|scale|monitor|backup|restore|scan|analyse|browse|list|get|check|status|pr|branch|commit|workflow|run|trigger|env|ssl|domain)/i.test(body.message || "");
            toolChoiceMode = !hasActionKeywords ? ("auto" as any) : ("required" as any);
            console.log(`[V2-UNIFIED] DevOps mode: ${relevantTools.length} tools (trimmed from ${ulysseToolsV2.length}), toolChoice: ${toolChoiceMode}${!hasActionKeywords ? ' (no action keywords)' : ''}`);
          } else {
            const otherTools = ulysseToolsV2.filter((t: any) => !forceToolsList.includes(t.function.name));
            relevantTools = [...priorityTools, ...otherTools];
            if (actionIntent.shouldForceTools || actionIntent.confidence > 0.3) {
              toolChoiceMode = "required" as any;
            }
            console.log(`[V2-UNIFIED] Priority tools: ${forceToolsList.join(', ')} + ${otherTools.length} other tools available (${relevantTools.length} total), toolChoice: ${toolChoiceMode || 'auto'}`);
          }
        }
        
        
        
        if (devopsCtx && hasFamilyAccess) {
          const devopsCodeKeywords = /(?:fichier|file|code|source|audit|structure|arborescence|dossier|folder|répertoire|directory|composant|component|module)/i;
          if (devopsCodeKeywords.test(body.message || "")) {
            const devopsTool = ulysseToolsV2.find((t: any) => t.function.name === "devops_github");
            if (devopsTool) {
              relevantTools = [devopsTool, ...(relevantTools || ulysseToolsV2).filter((t: any) => t.function.name !== "devops_github")];
              toolChoiceMode = "required" as any;
              console.log(`[V2-DevOps] 🔧 Code/files request in DevOps context → forcing devops_github as primary tool`);
            }
          }
        }
        
        if (actionIntent.shouldForceTools) {
          console.log(`[V2-ACTION] 🎯 ACTION DETECTED: ${actionIntent.reason} (${Math.round(actionIntent.confidence * 100)}%) → tool_choice: ${toolChoiceMode}`);
          console.log(`[V2-ACTION] Suggested tools: ${actionIntent.suggestedTools.join(', ') || 'all'}`);
        } else {
          console.log(`[V2-ACTION] No action detected → tool_choice: auto`);
        }
        
        const initialMaxTokens = devopsCtx ? 8192 : 4096;
        let initialResponse: any;
        let activeModel = selectedModel;
        let activeMaxTokens = initialMaxTokens;
        let activeClient = openai;
        
        for (let attempt = 0; attempt < _contextFallbackChain.length; attempt++) {
          try {
            initialResponse = await activeClient.chat.completions.create({
              model: activeModel,
              messages: workingMessages,
              max_tokens: activeMaxTokens,
              tools: relevantTools,
              tool_choice: toolChoiceMode,
            });
            break;
          } catch (retryErr: any) {
            const isQuotaErr = retryErr.status === 429 || retryErr.code === 'insufficient_quota' || retryErr.message?.includes('insufficient_quota') || retryErr.message?.includes('exceeded your current quota');
            const isRetryable = isQuotaErr || retryErr.status === 500 || retryErr.status === 503 || retryErr.message?.includes('Connection error') || retryErr.message?.includes('ECONNREFUSED') || retryErr.message?.includes('timed out') || retryErr.message?.includes('timeout') || retryErr.message?.includes('fetch failed') || retryErr.code === 'ETIMEDOUT' || retryErr.code === 'ESOCKETTIMEDOUT';
            console.error(`[V2] AI call failed (${_contextFallbackChain[currentProviderIdx]?.provider || 'unknown'}, model: ${activeModel}):`, retryErr.message, retryErr.status || '');
            if (isQuotaErr && (_contextFallbackChain[currentProviderIdx]?.provider === "openai")) {
              markOpenAIDown();
            }
            
            if (isRetryable && currentProviderIdx + 1 < _contextFallbackChain.length) {
              currentProviderIdx++;
              const next = _contextFallbackChain[currentProviderIdx];
              activeClient = next.client;
              activeModel = next.model;
              activeMaxTokens = next.provider === "openai" ? Math.min(activeMaxTokens, 4096) : activeMaxTokens;
              console.log(`[V2-FALLBACK] → switching to ${next.provider} (${next.model})`);
              continue;
            }
            throw retryErr;
          }
        }

        const choice = initialResponse.choices[0];
        
        // Step 2: Handle tool calls if any
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          hadToolCalls = true;
          const toolNames = choice.message.tool_calls.map(tc => tc.function.name).join(', ');
          console.log(`[V2-Tools] ✅ AI EXECUTING ${choice.message.tool_calls.length} tool(s): ${toolNames}`);
          
          let clientDisconnected = false;
          const safeWrite = (data: string) => {
            if (clientDisconnected) return;
            try { res.write(data); } catch { clientDisconnected = true; }
          };
          
          req.on("close", () => {
            if (!clientDisconnected) {
              clientDisconnected = true;
              console.log(`[V2-Tools] Client disconnected during tool execution`);
            }
          });
          
          safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: "starting", tools: toolNames, count: choice.message.tool_calls.length })}\n\n`);
          
          workingMessages.push({
            role: "assistant",
            content: choice.message.content || null,
            tool_calls: choice.message.tool_calls
          });
          
          const isDevOpsToolCall = choice.message.tool_calls.some(tc => 
            tc.function.name === "devops_github" || tc.function.name === "devops_server"
          );
          
          if (clientDisconnected && isDevOpsToolCall) {
            try {
              const { enqueueBackgroundDevOps } = await import("../../services/taskQueueEngine");
              const pendingCalls = choice.message.tool_calls.map(tc => {
                try { return { name: tc.function.name, args: JSON.parse(tc.function.arguments) }; } 
                catch { return null; }
              }).filter(Boolean) as Array<{ name: string; args: any }>;
              
              if (pendingCalls.length > 0) {
                await enqueueBackgroundDevOps(userId, body.message?.slice(0, 200) || "DevOps task", pendingCalls, threadId);
                console.log(`[V2-Tools] 🚀 Client disconnected — ${pendingCalls.length} DevOps tool calls moved to background queue`);
              }
            } catch (bgErr: any) {
              console.error(`[V2-Tools] Failed to enqueue background DevOps:`, bgErr.message);
            }
          }
          
          for (const toolCall of choice.message.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: any;
            try {
              toolArgs = JSON.parse(toolCall.function.arguments);
            } catch (parseErr: any) {
              console.error(`[V2-Tools] Initial JSON parse failed for ${toolName}: ${parseErr.message} (args length: ${toolCall.function.arguments?.length})`);
              workingMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: `Arguments JSON tronqués. Réessaye avec un contenu plus court.` })
              });
              continue;
            }
            
            if (body.contextHints?.devmaxProjectId && (toolName === "devops_github" || toolName === "devops_server" || toolName === "devmax_db" || toolName === "dgm_manage")) {
              if (!toolArgs.projectId) toolArgs.projectId = body.contextHints.devmaxProjectId;
            }
            
            console.log(`[V2-Tools] Executing ${toolName} via ActionHub (unified)...`);
            const toolLabel = getToolLabel(toolName, toolArgs);
            safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: "executing", tool: toolName, label: toolLabel })}\n\n`);
            
            const actionResult = await actionHub.execute({
              name: toolName,
              params: toolArgs,
              metadata: {
                category: "tool_call",
                userId,
                persona: persona.toLowerCase() as "ulysse" | "iris" | "alfred",
                source: "chat",
                conversationId: threadId,
                correlationId: toolCall.id
              }
            });
            
            const result = actionResult.success 
              ? JSON.stringify(actionResult.result || { success: true })
              : JSON.stringify({ error: actionResult.error || "Exécution échouée" });
            
            if (!actionResult.success) toolCallsSucceeded = false;
            console.log(`[V2-SENSORY] ActionHub executed: ${toolName} → ${actionResult.success ? 'success' : 'failed'} in ${actionResult.executionMs}ms`);
            safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: actionResult.success ? "done" : "error", tool: toolName, label: toolLabel, durationMs: actionResult.executionMs })}\n\n`);
            
            try {
              brainHub.addToWorkingMemory({
                type: 'context',
                content: `Tool ${toolName}: ${actionResult.success ? 'success' : 'failed'} (${actionResult.executionMs}ms)`,
                source: 'action_hub',
                timestamp: new Date(),
                importance: actionResult.success ? 50 : 80,
                ttlMs: 120000,
              });
            } catch (_) {}

            if (actionResult.success && body.contextHints?.devmaxProjectId && (toolName === "devops_github" || toolName === "devops_server")) {
              try {
                const jAction = toolArgs?.action || "unknown";
                const journalActions: Record<string, string> = {
                  update_file: "code_edit", delete_file: "code_edit", apply_patch: "code_edit",
                  create_branch: "config", create_pr: "review", merge_pr: "review",
                  deploy: "deploy", update: "deploy", restart: "config", stop: "config", delete: "config",
                  rollback_app: "fix", security_scan: "review", full_pipeline: "deploy",
                  scaffold_project: "scaffold", docs_generate: "note",
                  backup_app: "config", backup_db: "config", restore_db: "fix",
                  ssl: "config", env_set: "config", env_delete: "config",
                  url_diagnose: "fix", url_diagnose_all: "fix",
                  trigger_workflow: "deploy", rerun_workflow: "deploy",
                  monitoring_setup: "config", scale: "config",
                };
                const entryType = journalActions[jAction];
                if (entryType) {
                  const pid = body.contextHints.devmaxProjectId;
                  const filePath = toolArgs?.path || toolArgs?.file_path || null;
                  if (filePath) {
                    await db.execute(sql`
                      INSERT INTO devmax_project_journal (project_id, entry_type, title, description, files_changed)
                      VALUES (${pid}, ${entryType}, ${`${toolName}/${jAction}`}, ${toolLabel || `${jAction} executed`}, ARRAY[${filePath}])
                    `).catch(() => {});
                  } else {
                    await db.execute(sql`
                      INSERT INTO devmax_project_journal (project_id, entry_type, title, description)
                      VALUES (${pid}, ${entryType}, ${`${toolName}/${jAction}`}, ${toolLabel || `${jAction} executed`})
                    `).catch(() => {});
                  }
                  console.log(`[DevMax-Journal] Auto-logged: ${entryType} — ${toolName}/${jAction} for project ${pid}`);
                }
              } catch (_) {}
            }
            
            workingMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: compressToolResult(result, toolName, toolArgs)
            });
          }
          
          const writeActionMap: Record<string, string[]> = {
            "crée": ["create_branch", "create_pr", "create_repo", "create_issue", "create_release", "create_tag", "apply_patch", "update_file", "scaffold_project"],
            "créer": ["create_branch", "create_pr", "create_repo", "create_issue", "create_release", "create_tag", "apply_patch", "update_file", "scaffold_project"],
            "create": ["create_branch", "create_pr", "create_repo", "create_issue", "create_release", "create_tag", "apply_patch", "update_file", "scaffold_project"],
            "branche": ["create_branch", "delete_branch"],
            "branch": ["create_branch", "delete_branch"],
            "merge": ["merge_pr"],
            "fusionne": ["merge_pr"],
            "supprime": ["delete_file", "delete_branch", "delete_repo"],
            "delete": ["delete_file", "delete_branch", "delete_repo"],
            "modifie": ["update_file", "apply_patch"],
            "modify": ["update_file", "apply_patch"],
            "update": ["update_file", "apply_patch"],
            "déploie": ["deploy", "full_pipeline"],
            "deploy": ["deploy", "full_pipeline"],
            "commit": ["update_file", "apply_patch"],
            "push": ["update_file", "apply_patch"],
          };
          const userMsg = (body.message || "").toLowerCase();
          const expectedWriteActions = new Set<string>();
          for (const [keyword, actions] of Object.entries(writeActionMap)) {
            if (userMsg.includes(keyword)) {
              actions.forEach(a => expectedWriteActions.add(a));
            }
          }
          const readOnlyActions = new Set(["browse_files", "get_file", "search_code", "list_commits", "list_branches", "list_prs", "repo_info", "list_repos", "list_issues", "get_issue", "list_releases", "list_tags", "compare_branches", "get_commit_diff", "blame", "list_workflows", "list_workflow_runs", "pages_status", "get_deploy_urls", "list_org_repos"]);
          const executedWriteActions = new Set<string>();
          
          const initialActions = choice.message.tool_calls.map(tc => {
            try { return JSON.parse(tc.function.arguments)?.action; } catch { return null; }
          }).filter(Boolean);
          initialActions.forEach(a => {
            if (a && !readOnlyActions.has(a)) executedWriteActions.add(a);
          });
          
          let toolRound = 0;
          const maxToolRounds = devopsCtx ? 12 : 6;
          let consecutiveReadOnlyRounds = 0;
          let totalWriteRoundsInSession = 0;
          let frontendFilesWritten = 0;
          const frontendFilePatterns = /\.(tsx?|jsx?|css|scss|html|svg)$|components?\//i;
          const writeActions = new Set(["apply_patch", "update_file", "delete_file", "create_branch", "create_pr", "merge_pr", "deploy", "full_pipeline", "scaffold_project"]);
          const toolCallHistory: string[] = [];
          const toolCallSignatures: string[] = [];
          initialActions.forEach(a => { if (a) toolCallHistory.push(a); });
          if (choice.message.tool_calls) {
            for (const tc of choice.message.tool_calls) {
              try {
                const args = JSON.parse(tc.function.arguments);
                const actionKey = args.action || args.command || "";
                const targetKey = args.repo || args.projectName || args.appName || args.path || "";
                toolCallSignatures.push(`${tc.function.name}|${actionKey}|${targetKey}`);
                if ((actionKey === "apply_patch" || actionKey === "update_file") && args.path && frontendFilePatterns.test(args.path)) {
                  frontendFilesWritten++;
                }
                if (args.files && Array.isArray(args.files)) {
                  for (const f of args.files) {
                    if (f.path && frontendFilePatterns.test(f.path)) frontendFilesWritten++;
                  }
                }
              } catch { toolCallSignatures.push(tc.function.name); }
            }
          }

          if (devopsCtx && initialActions.some(a => writeActions.has(a))) totalWriteRoundsInSession++;
          
          if (devopsCtx && initialActions.every(a => readOnlyActions.has(a))) {
            consecutiveReadOnlyRounds = 1;
            console.log(`[V2-Tools] 📖 Initial round was read-only (${initialActions.join(', ')}) — streak starts at 1`);
          }
          
          while (toolRound < maxToolRounds) {
            toolRound++;
            const followMaxTokens = devopsCtx ? 16384 : 4096;

            compactOldToolResults(workingMessages, devopsCtx ? 60000 : 40000);

            const lastFewTools = toolCallHistory.slice(-4);
            const isToolLoop = lastFewTools.length >= 3 && new Set(lastFewTools).size === 1;
            const lastFewSigs = toolCallSignatures.slice(-3);
            const isSemanticLoop = lastFewSigs.length >= 2 && new Set(lastFewSigs).size === 1;
            const isErrorLoop = toolCallSignatures.length >= 3 && toolCallSignatures.slice(-3).every(s => s.includes("|error"));
            if (isToolLoop || isSemanticLoop || isErrorLoop) {
              const loopType = isToolLoop ? "same-tool" : isSemanticLoop ? "semantic (same tool+args)" : "error (3 consecutive failures)";
              console.log(`[V2-Tools] 🛑 Loop detected: ${loopType} — breaking out`);
              workingMessages.push({ role: "system", content: `STOP: une boucle a été détectée (${loopType}). Ne rappelle PAS le même outil. Résume ce que tu as fait, explique le problème rencontré, et propose des solutions alternatives à l'utilisateur.` });
            }
            
            const userMsgLower = (body.message || "").toLowerCase();
            const isAnalysisRequest = /analys|audit|explore|inspecte|connais|examine|résumé|summary|review|regarde|check|vérifie|montre|explique|describe|status|état|rapport|report|scan|diagnostic/.test(userMsgLower);
            if (devopsCtx && consecutiveReadOnlyRounds >= 3 && !isAnalysisRequest) {
              workingMessages.push({
                role: "system",
                content: `⚠️ Tu as fait ${consecutiveReadOnlyRounds} rounds de lecture sans écriture. Si l'utilisateur t'a demandé de MODIFIER du code, passe à l'action avec update_file ou apply_patch. Si l'utilisateur a demandé une ANALYSE ou un AUDIT, continue à lire et présente tes résultats — NE MODIFIE RIEN.`
              });
              console.log(`[V2-Tools] ⚠️ Read-only streak (${consecutiveReadOnlyRounds} rounds) — soft nudge (analysis: ${isAnalysisRequest})`);
            }

            if (devopsCtx && frontendFilesWritten >= 3 && totalWriteRoundsInSession === toolRound) {
              const stagingUrl = body.contextHints?.stagingUrl
                || (devopsCtx?.match(/staging[:\s]+([https?://\S]+)/i)?.[1])
                || (devopsCtx?.match(/([a-z0-9-]+-dev\.ulyssepro\.org)/i)?.[0] ? `https://${devopsCtx?.match(/([a-z0-9-]+-dev\.ulyssepro\.org)/i)?.[0]}` : null);
              if (stagingUrl) {
                workingMessages.push({
                  role: "system",
                  content: `🎨 FEEDBACK VISUEL REQUIS: Tu viens de pousser ${frontendFilesWritten} fichiers frontend. AVANT de continuer, tu DOIS maintenant:
1. Appeler crawl_preview avec url="${stagingUrl}" pour vérifier le statut HTTP et le contenu
2. Appeler analyze_preview avec url="${stagingUrl}" pour analyser visuellement le rendu (layout, couleurs, composants)
3. Si des problèmes sont détectés (erreurs 502/404, layout cassé, composants manquants), CORRIGE-LES immédiatement avec apply_patch/update_file
4. Seulement après validation visuelle, continue avec les fichiers suivants
Ne dis pas "je vais vérifier" — APPELLE LES OUTILS MAINTENANT.`
                });
                console.log(`[V2-Tools] 🎨 Visual feedback trigger injected after ${frontendFilesWritten} frontend files written (staging: ${stagingUrl})`);
              }
            }
            
            const followToolChoice = devopsCtx && toolRound <= 4 && !isToolLoop ? "required" as const : "auto" as const;
            
            let followUp: any;
            try {
              followUp = await activeClient.chat.completions.create({
                model: activeModel,
                messages: workingMessages,
                max_tokens: followMaxTokens,
                tools: relevantTools,
                tool_choice: followToolChoice,
              });
            } catch (followErr: any) {
              const isFollowQuota = followErr.status === 429 || followErr.code === 'insufficient_quota' || followErr.message?.includes('insufficient_quota') || followErr.message?.includes('exceeded your current quota');
              const isContextOverflow = followErr.code === 'context_length_exceeded' || followErr.message?.includes('maximum context length') || followErr.message?.includes('context_length_exceeded') || followErr.message?.includes("This model's maximum context length");
              const isRetryable = isFollowQuota || isContextOverflow || followErr.status === 500 || followErr.status === 503 || followErr.message?.includes('ECONNREFUSED');
              console.error(`[V2-Tools] Follow-up failed (model: ${activeModel}):`, followErr.message, followErr.status || '');
              if (isFollowQuota && (_contextFallbackChain[currentProviderIdx]?.provider === "openai")) {
                markOpenAIDown();
              }

              if (isContextOverflow) {
                console.log(`[V2-ContextOverflow] Context too large at round ${toolRound} — aggressive compaction + retry`);
                compactOldToolResults(workingMessages, 20000);
                const pruneableCount = workingMessages.filter(m => m.role === "tool").length;
                if (pruneableCount > 4) {
                  const toolIndices: number[] = [];
                  for (let i = 0; i < workingMessages.length; i++) {
                    if (workingMessages[i].role === "tool") toolIndices.push(i);
                  }
                  for (const idx of toolIndices.slice(0, -2)) {
                    const c = workingMessages[idx].content;
                    if (typeof c === "string" && c.length > 500) {
                      workingMessages[idx].content = '{"_pruned":true,"reason":"context_overflow"}';
                    }
                  }
                }
                try {
                  followUp = await activeClient.chat.completions.create({
                    model: activeModel,
                    messages: workingMessages,
                    max_tokens: Math.min(followMaxTokens, 4096),
                    tools: relevantTools,
                    tool_choice: "auto" as const,
                  });
                  console.log(`[V2-ContextOverflow] Recovery successful after aggressive compaction`);
                } catch (retryErr2: any) {
                  console.error(`[V2-ContextOverflow] Recovery failed:`, retryErr2.message);
                  break;
                }
              } else {
              let recovered = false;
              if (isRetryable) {
                for (let fi = currentProviderIdx + 1; fi < _contextFallbackChain.length; fi++) {
                  try {
                    const next = _contextFallbackChain[fi];
                    console.log(`[V2-FALLBACK] Follow-up: → ${next.provider} (${next.model})`);
                    activeClient = next.client;
                    activeModel = next.model;
                    currentProviderIdx = fi;
                    followUp = await activeClient.chat.completions.create({
                      model: activeModel,
                      messages: workingMessages,
                      max_tokens: next.provider === "openai" ? Math.min(followMaxTokens, 4096) : followMaxTokens,
                      tools: relevantTools,
                      tool_choice: followToolChoice,
                    });
                    recovered = true;
                    break;
                  } catch (_) { continue; }
                }
              }
              if (!recovered) throw followErr;
              }
            }
            
            const followChoice = followUp.choices[0];
            
            if (followChoice.message.tool_calls && followChoice.message.tool_calls.length > 0) {
              const followToolNames = followChoice.message.tool_calls.map(tc => tc.function.name).join(', ');
              followChoice.message.tool_calls.forEach(tc => {
                toolCallHistory.push(tc.function.name);
                try {
                  const args = JSON.parse(tc.function.arguments);
                  const actionKey = args.action || args.command || "";
                  const targetKey = args.repo || args.projectName || args.appName || args.path || "";
                  toolCallSignatures.push(`${tc.function.name}|${actionKey}|${targetKey}`);
                } catch { toolCallSignatures.push(tc.function.name); }
              });
              console.log(`[V2-Tools] 🔄 Round ${toolRound}: AI chaining ${followChoice.message.tool_calls.length} more tool(s): ${followToolNames}`);
              
              const hasDevOpsInRound = followChoice.message.tool_calls.some(tc =>
                tc.function.name === "devops_github" || tc.function.name === "devops_server"
              );
              
              if (clientDisconnected && hasDevOpsInRound) {
                try {
                  const { enqueueBackgroundDevOps } = await import("../../services/taskQueueEngine");
                  const pendingRoundCalls = followChoice.message.tool_calls.map(tc => {
                    try { return { name: tc.function.name, args: JSON.parse(tc.function.arguments) }; }
                    catch { return null; }
                  }).filter(Boolean) as Array<{ name: string; args: any }>;
                  
                  if (pendingRoundCalls.length > 0) {
                    await enqueueBackgroundDevOps(userId, `DevOps continuation round ${toolRound}`, pendingRoundCalls, threadId);
                    console.log(`[V2-Tools] 🚀 Client disconnected at round ${toolRound} — ${pendingRoundCalls.length} DevOps calls moved to background`);
                  }
                } catch (bgErr: any) {
                  console.error(`[V2-Tools] Background enqueue failed at round ${toolRound}:`, bgErr.message);
                }
              }
              
              safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: "chaining", round: toolRound, tools: followToolNames, count: followChoice.message.tool_calls.length })}\n\n`);
              
              workingMessages.push({
                role: "assistant",
                content: followChoice.message.content || null,
                tool_calls: followChoice.message.tool_calls
              });
              
              for (const toolCall of followChoice.message.tool_calls) {
                const toolName = toolCall.function.name;
                let toolArgs: any;
                try {
                  toolArgs = JSON.parse(toolCall.function.arguments);
                } catch (parseErr: any) {
                  console.error(`[V2-Tools] Round ${toolRound}: JSON parse failed for ${toolName}: ${parseErr.message} (args length: ${toolCall.function.arguments?.length})`);
                  workingMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: `Arguments JSON tronqués (${toolCall.function.arguments?.length} chars). Réessaye avec un contenu plus court ou découpe l'opération.` })
                  });
                  safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: "error", tool: toolName, label: `${toolName} (JSON tronqué)`, round: toolRound })}\n\n`);
                  continue;
                }
                if (body.contextHints?.devmaxProjectId && (toolName === "devops_github" || toolName === "devops_server" || toolName === "devmax_db" || toolName === "dgm_manage")) {
                  if (!toolArgs.projectId) toolArgs.projectId = body.contextHints.devmaxProjectId;
                }
                const followAction = toolArgs?.action || "";
                if (devopsCtx && (followAction === "apply_patch" || followAction === "update_file")) {
                  if (toolArgs?.path && frontendFilePatterns.test(toolArgs.path)) frontendFilesWritten++;
                  if (toolArgs?.files && Array.isArray(toolArgs.files)) {
                    for (const f of toolArgs.files) {
                      if (f.path && frontendFilePatterns.test(f.path)) frontendFilesWritten++;
                    }
                  }
                  if (writeActions.has(followAction)) totalWriteRoundsInSession = toolRound;
                }
                const toolLabel = getToolLabel(toolName, toolArgs);
                safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: "executing", tool: toolName, label: toolLabel, round: toolRound })}\n\n`);
                
                const actionResult = await actionHub.execute({
                  name: toolName,
                  params: toolArgs,
                  metadata: {
                    category: "tool_call",
                    userId,
                    persona: persona.toLowerCase() as "ulysse" | "iris" | "alfred",
                    source: "chat",
                    conversationId: threadId,
                    correlationId: toolCall.id
                  }
                });
                
                const result = actionResult.success 
                  ? JSON.stringify(actionResult.result || { success: true })
                  : JSON.stringify({ error: actionResult.error || "Exécution échouée" });
                
                if (!actionResult.success) {
                  toolCallsSucceeded = false;
                  const failSigIdx = toolCallSignatures.length - 1;
                  if (failSigIdx >= 0 && !toolCallSignatures[failSigIdx].includes("|error")) {
                    toolCallSignatures[failSigIdx] += "|error";
                  }
                }
                console.log(`[V2-SENSORY] Round ${toolRound}: ${toolName} → ${actionResult.success ? 'success' : 'failed'} in ${actionResult.executionMs}ms`);
                safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: actionResult.success ? "done" : "error", tool: toolName, label: toolLabel, durationMs: actionResult.executionMs, round: toolRound })}\n\n`);

                if (actionResult.success && body.contextHints?.devmaxProjectId && (toolName === "devops_github" || toolName === "devops_server")) {
                  try {
                    const jAction = toolArgs?.action || "unknown";
                    const journalActions: Record<string, string> = {
                      update_file: "code_edit", delete_file: "code_edit", apply_patch: "code_edit",
                      create_branch: "config", create_pr: "review", merge_pr: "review",
                      deploy: "deploy", update: "deploy", restart: "config", stop: "config", delete: "config",
                      rollback_app: "fix", security_scan: "review", full_pipeline: "deploy",
                      scaffold_project: "scaffold", docs_generate: "note",
                      backup_app: "config", backup_db: "config", restore_db: "fix",
                      ssl: "config", env_set: "config", env_delete: "config",
                      url_diagnose: "fix", url_diagnose_all: "fix",
                      trigger_workflow: "deploy", rerun_workflow: "deploy",
                      monitoring_setup: "config", scale: "config",
                    };
                    const entryType = journalActions[jAction];
                    if (entryType) {
                      const pid = body.contextHints.devmaxProjectId;
                      const filePath = toolArgs?.path || toolArgs?.file_path || null;
                      if (filePath) {
                        await db.execute(sql`
                          INSERT INTO devmax_project_journal (project_id, entry_type, title, description, files_changed)
                          VALUES (${pid}, ${entryType}, ${`${toolName}/${jAction}`}, ${toolLabel || `${jAction} executed`}, ARRAY[${filePath}])
                        `).catch(() => {});
                      } else {
                        await db.execute(sql`
                          INSERT INTO devmax_project_journal (project_id, entry_type, title, description)
                          VALUES (${pid}, ${entryType}, ${`${toolName}/${jAction}`}, ${toolLabel || `${jAction} executed`})
                        `).catch(() => {});
                      }
                    }
                  } catch (_) {}
                }
                
                workingMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: compressToolResult(result, toolName, toolArgs)
                });
              }
              
              if (devopsCtx) {
                const roundActions = followChoice.message.tool_calls.map(tc => {
                  try { return JSON.parse(tc.function.arguments)?.action; } catch { return null; }
                }).filter(Boolean);
                roundActions.forEach(a => {
                  if (a && !readOnlyActions.has(a)) executedWriteActions.add(a);
                });
                const allReadOnly = roundActions.every(a => readOnlyActions.has(a));
                if (allReadOnly) {
                  consecutiveReadOnlyRounds++;
                  console.log(`[V2-Tools] 📖 Round ${toolRound}: read-only (${roundActions.join(', ')}) — streak: ${consecutiveReadOnlyRounds}`);
                } else {
                  consecutiveReadOnlyRounds = 0;
                }
              }
              
              continue;
            }
            
            if (devopsCtx && expectedWriteActions.size > 0 && executedWriteActions.size === 0) {
              const missingActions = [...expectedWriteActions].slice(0, 3).join(', ');
              console.log(`[V2-ANTI-HALLUCINATION] 🚨 AI tried to respond without executing write action! Expected: ${missingActions}. Forcing retry.`);
              workingMessages.push({
                role: "system",
                content: `🚨 ERREUR: Tu essaies de répondre SANS avoir exécuté l'action demandée. L'utilisateur a demandé une action qui nécessite un appel WRITE (${missingActions}), mais tu n'as fait QUE des lectures. Tu DOIS appeler l'outil approprié MAINTENANT. N'invente pas de résultat.`
              });
              if (followChoice.message.content) {
                workingMessages.push({ role: "assistant", content: followChoice.message.content });
              }
              toolRound++;
              if (toolRound < maxToolRounds) continue;
            }
            
            if (followChoice.message.content) {
              fullResponse = followChoice.message.content;
              if (devopsCtx && expectedWriteActions.size > 0 && executedWriteActions.size === 0) {
                fullResponse += `\n\n⚠️ *Note: L'action d'écriture demandée n'a pas été exécutée. Les opérations de lecture seules ont été effectuées. Reformule ta demande pour que je puisse exécuter l'action correctement.*`;
                console.log(`[V2-ANTI-HALLUCINATION] ⚠️ Added warning to response — no write action executed despite user request`);
              }
              const cleanContent = fullResponse.replace(/\[CURIOSITÉ_POSÉE\]/g, "");
              safeWrite(`data: ${JSON.stringify({ type: "chunk", content: cleanContent })}\n\n`);
            } else {
              const finalStream = await activeClient.chat.completions.create({
                model: activeModel,
                messages: workingMessages,
                max_tokens: devopsCtx ? 4096 : 2000,
                stream: true,
              });
              for await (const chunk of finalStream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                  fullResponse += content;
                  const cleanContent = content.replace(/\[CURIOSITÉ_POSÉE\]/g, "");
                  if (cleanContent) {
                    safeWrite(`data: ${JSON.stringify({ type: "chunk", content: cleanContent })}\n\n`);
                  }
                }
              }
            }
            break;
          }
          
          if (toolRound >= maxToolRounds && !fullResponse) {
            console.log(`[V2-Tools] ⚠️ Max tool rounds (${maxToolRounds}) reached without response — generating final answer`);
            safeWrite(`data: ${JSON.stringify({ type: "tool_status", status: "finalizing", round: toolRound })}\n\n`);
            const finalStream = await activeClient.chat.completions.create({
              model: activeModel,
              messages: [...workingMessages, { role: "user", content: "Synthétise tes résultats et réponds à la question. Ne rappelle pas d'outils." }],
              max_tokens: devopsCtx ? 4096 : 2000,
              stream: true,
            });
            for await (const chunk of finalStream) {
              const content = chunk.choices[0]?.delta?.content || "";
              if (content) {
                fullResponse += content;
                const cleanContent = content.replace(/\[CURIOSITÉ_POSÉE\]/g, "");
                if (cleanContent) {
                  safeWrite(`data: ${JSON.stringify({ type: "chunk", content: cleanContent })}\n\n`);
                }
              }
            }
          }
        } else {
          if (choice.message.content) {
            const content = choice.message.content;
            fullResponse = content;
            const cleanContent = content.replace(/\[CURIOSITÉ_POSÉE\]/g, "");
            res.write(`data: ${JSON.stringify({ type: "chunk", content: cleanContent })}\n\n`);
          } else {
            const stream = await activeClient.chat.completions.create({
              model: activeModel,
              messages: workingMessages,
              max_tokens: 2000,
              stream: true,
            });

            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || "";
              if (content) {
                fullResponse += content;
                const cleanContent = content.replace(/\[CURIOSITÉ_POSÉE\]/g, "");
                if (cleanContent) {
                  res.write(`data: ${JSON.stringify({ type: "chunk", content: cleanContent })}\n\n`);
                }
              }
            }
          }
        }
      } catch (err: any) {
        const isQuotaError = err.status === 429 || err.code === 'insufficient_quota' || err.message?.includes('insufficient_quota') || err.message?.includes('exceeded your current quota');
        const isRetryable = isQuotaError || err.message?.includes('timed out') || err.message?.includes('timeout') || err.code === 'ETIMEDOUT' || err.message?.includes('Connection error') || err.message?.includes('fetch failed');
        console.error("[V2] Streaming error:", err.message, err.status || '', err.code || '');
        if (err.stack) console.error("[V2] Stack:", err.stack.split('\n').slice(0, 5).join(' | '));
        if (isQuotaError && primaryProvider === "openai") {
          markOpenAIDown();
        }
        
        let streamFallbackSuccess = false;
        if (isRetryable) {
          while (currentProviderIdx + 1 < _contextFallbackChain.length) {
            currentProviderIdx++;
            const next = _contextFallbackChain[currentProviderIdx];
            console.log(`[V2-STREAM-FALLBACK] → switching to ${next.provider} (${next.model})`);
            try {
              fullResponse = "";
              const fallbackStream = await next.client.chat.completions.create({
                model: next.model,
                messages: workingMessages,
                max_tokens: next.provider === "openai" ? Math.min(2000, 4096) : 2000,
                stream: true,
              });
              for await (const chunk of fallbackStream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                  fullResponse += content;
                  const cleanContent = content.replace(/\[CURIOSITÉ_POSÉE\]/g, "");
                  if (cleanContent) {
                    try { res.write(`data: ${JSON.stringify({ type: "chunk", content: cleanContent })}\n\n`); } catch {}
                  }
                }
              }
              streamFallbackSuccess = true;
              break;
            } catch (fallbackErr: any) {
              console.error(`[V2] Stream fallback ${next.provider} failed:`, fallbackErr.message);
              streamError = fallbackErr;
            }
          }
        }
        if (!streamFallbackSuccess) {
          streamError = streamError || err;
          const errorMessage = "Désolé, une erreur s'est produite. Réessaie dans quelques instants.";
          try { res.write(`data: ${JSON.stringify({ type: "chunk", content: errorMessage })}\n\n`); } catch {}
          fullResponse = errorMessage;
        }
      }

      // Clean the marker from stored response
      const cleanedFullResponse = fullResponse.replace(/\[CURIOSITÉ_POSÉE\]/g, "").trim();

      metricsService.recordAILatency(Date.now() - aiStartTime);
      
      await db.insert(conversationMessages).values({
        threadId,
        userId,
        role: "assistant",
        content: cleanedFullResponse,
        modality: "text",
        metadata: { model: selectedModel, streaming: true, domain: detectedDomain, strategy: detectedStrategy, userSentiment: processedHearing?.sentiment?.mood || 'neutral' },
      });
      
      // ═══════════════════════════════════════════════════════════════════════════
      // VOICE OUTPUT HUB - Route response through unified output pipeline
      // ═══════════════════════════════════════════════════════════════════════════
      try {
        const outputDomain = brainResult?.decision?.domain || processedHearing?.domain || 'generic';
        await voiceOutputHub.speak({
          text: cleanedFullResponse,
          metadata: {
            destination: "web_chat",
            priority: "normal",
            userId,
            persona: persona.toLowerCase() as "ulysse" | "iris" | "alfred",
            conversationId: threadId,
            inResponseTo: body.message.substring(0, 100),
            intent: processedHearing?.intent?.domain,
            domain: outputDomain,
            kpiTag: `chat_${outputDomain}`,
            strategy: brainResult?.decision?.strategy
          }
        });
        console.log(`[V2-SENSORY] VoiceOutputHub recorded: ${cleanedFullResponse.length} chars to web_chat, domain=${outputDomain}`);
      } catch (outputErr) {
        console.error("[V2-SENSORY] VoiceOutputHub error (non-blocking):", outputErr);
      }

      const [currentThread] = await db.select()
        .from(conversationThreads)
        .where(eq(conversationThreads.id, threadId));
      
      await db.update(conversationThreads)
        .set({
          messageCount: (currentThread?.messageCount || 0) + 2,
          lastDevice: body.originDevice || "unknown",
          lastMessageAt: new Date(),
        })
        .where(eq(conversationThreads.id, threadId));

      const streamConfidence = UlysseCoreEngine.calculateConfidence({
        source: 'provider',
        provider: 'openai',
        hasToolResults: hadToolCalls,
        toolSuccess: toolCallsSucceeded,
        hasMemorySupport: !!memoryContext,
        hasMarsVerification: !!sportsContext || needsWebSearch(body.message),
        domain: detectedDomain,
        brainConfidence: brainResult?.decision?.confidence,
        hasContextualData: !!(calendarContext || homeworkContext || screenContext),
      });
      
      res.write(`data: ${JSON.stringify({ type: "done", threadId, sessionContext, messageCount: previousMessages.length + 2, confidence: streamConfidence.confidence, confidenceLevel: streamConfidence.confidenceLevel })}\n\n`);
      res.end();
      
      unregisterSessionRequest(userId, sessionContext);
      console.log(`[V2-Session] ✅ Session "${sessionContext}" completed for user ${userId} (${Date.now() - aiStartTime}ms)`);
      
      emitConversationsUpdated(userId);
      
      try {
        const { aiSystemIntegration } = await import("../../services/aiSystemIntegration");
        const elapsedMs = Date.now() - aiStartTime;
        
        aiSystemIntegration.trackUsageEvent({
          userId,
          module: devopsCtx ? "devops" : "conversation",
          feature: hadToolCalls ? "tool_call" : "chat",
          persona: persona.toLowerCase(),
          durationMs: elapsedMs,
          success: !streamError,
          errorMessage: streamError?.message,
          metadata: {
            domain: detectedDomain,
            strategy: detectedStrategy,
            model: selectedModel,
            responseLength: cleanedFullResponse.length,
            toolCalls: hadToolCalls,
            threadId,
          },
        });

        if (isMaxAI && body.contextHints?.devmaxProjectId) {
          try {
            const [devmaxProj] = await db.execute(sql`SELECT tenant_id FROM devmax_projects WHERE id = ${body.contextHints.devmaxProjectId}`).then((r: any) => r.rows || r);
            if (devmaxProj?.tenant_id) {
              await db.execute(sql`INSERT INTO devmax_usage_logs (tenant_id, action, details) VALUES (${devmaxProj.tenant_id}, 'ai_chat', ${JSON.stringify({ projectId: body.contextHints.devmaxProjectId, toolCalls: hadToolCalls, durationMs: elapsedMs, model: selectedModel })})`).catch(() => {});
            }
          } catch {}
        }

        aiSystemIntegration.trackBehaviorEvent({
          userId,
          eventType: devopsCtx ? "devops_chat" : "conversation",
          eventSource: body.originDevice || "web",
          targetType: "module",
          targetName: devopsCtx ? "devops" : detectedDomain || "general",
          context: {
            domain: detectedDomain,
            messageLength: (body.message || "").length,
            hasAttachments: !!(body.attachments?.length),
          },
          newState: {
            responseLength: cleanedFullResponse.length,
            hadToolCalls,
            durationMs: elapsedMs,
          },
        });
      } catch (trackErr) {
        console.error("[V2-TRACKING] Usage/behavior tracking error (non-blocking):", trackErr);
      }
      
      // Send vocal response to /talking if connected and message came from .org web chat
      const originDevice = body.originDevice || "unknown";
      const chatDevices = ["web", "chat", "dashboard", "unknown"]; // Devices that should trigger vocal response on /talking
      if (chatDevices.includes(originDevice) && isTalkingConnected(userId)) {
        console.log(`[V2] /talking connected - emitting vocal response for user ${userId}`);
        emitTalkingMessage(userId, {
          id: `chat-${Date.now()}`,
          role: "assistant",
          content: cleanedFullResponse,
          timestamp: new Date(),
          origin: "chat"
        });
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // UNIFIED MARKER EXECUTOR V2 - CENTRALIZED ACTION EXECUTION
      // ═══════════════════════════════════════════════════════════════════════════
      // Replaces the fragmented parsing/execution with a single centralized call
      // that handles ALL marker types with consistent error handling and tracking
      
      unifiedMarkerExecutor.executeAllMarkers(fullResponse, {
        userId,
        persona: actionFirstContext.persona,
        isOwner,
        threadId,
        enableParallelExecution: true,
        broadcastResults: true
      }).then((executionSummary: ExecutionSummary) => {
        if (executionSummary.totalMarkersDetected > 0) {
          console.log(`[V2-UnifiedMarker] Executed ${executionSummary.totalExecuted}/${executionSummary.totalMarkersDetected} markers: ${executionSummary.successful} success, ${executionSummary.failed} failed in ${executionSummary.executionTimeMs}ms`);
          
          // Log individual results for debugging
          for (const result of executionSummary.results) {
            if (result.success) {
              console.log(`[V2-UnifiedMarker] ✅ ${result.type}: ${result.marker.substring(0, 50)}...`);
            } else {
              console.error(`[V2-UnifiedMarker] ❌ ${result.type} failed: ${result.error}`);
            }
          }
        }
      }).catch(err => {
        console.error("[V2-UnifiedMarker] Execution failed:", err.message);
      });
      
      // Learn from this conversation asynchronously
      memoryService.extractInsightsFromConversation(userId, body.message, fullResponse).catch(err => {
        console.log("[V2] Memory extraction failed (non-blocking):", err.message);
      });
      
      // Generate curiosity questions for future conversations
      memoryService.generateCuriosityFromConversation(userId, body.message, fullResponse, isOwner, isExternal).catch(err => {
        console.log("[V2] Curiosity generation failed (non-blocking):", err.message);
      });
      
      // Check if AI asked the suggested curiosity question
      if (curiositySuggestedKey) {
        memoryService.processCuriosityInResponse(userId, fullResponse, curiositySuggestedKey).catch(err => {
          console.log("[V2] Curiosity tracking failed (non-blocking):", err.message);
        });
      }
      
      return;
    }

    const aiStartTime = Date.now();
    metricsService.recordAIProvider(primaryProvider);
    
    let completion: any;
    let usedModel = selectedModel;
    let usedClient = openai;
    const nsProviders = _contextFallbackChain.length > 0 ? _contextFallbackChain : [{ client: openai, model: selectedModel, provider: primaryProvider }];
    for (let nsi = 0; nsi < nsProviders.length; nsi++) {
      try {
        usedClient = nsProviders[nsi].client;
        usedModel = nsProviders[nsi].model;
        completion = await usedClient.chat.completions.create({
          model: usedModel,
          messages,
          max_tokens: 2000,
        });
        break;
      } catch (nsErr: any) {
        const nsQuota = nsErr.status === 429 || nsErr.code === 'insufficient_quota' || nsErr.message?.includes('insufficient_quota');
        if (nsQuota && nsProviders[nsi].provider === "openai") markOpenAIDown();
        console.error(`[V2-NonStream] ${nsProviders[nsi].provider} failed:`, nsErr.message);
        if (nsi === nsProviders.length - 1) throw nsErr;
      }
    }
    
    metricsService.recordAILatency(Date.now() - aiStartTime);
    if (completion.usage) {
      metricsService.recordAITokens(completion.usage.prompt_tokens, completion.usage.completion_tokens);
      metricsService.recordAICost(primaryProvider, usedModel, completion.usage.prompt_tokens, completion.usage.completion_tokens, "chat");
    }

    const responseContent = completion.choices[0]?.message?.content || "Désolé, je n'ai pas pu répondre.";

    await db.insert(conversationMessages).values({
      threadId,
      userId,
      role: "assistant",
      content: responseContent,
      modality: "text",
      metadata: {
        model: selectedModel, domain: detectedDomain, strategy: detectedStrategy,
        tokens: completion.usage?.total_tokens,
      },
    });

    const [currentThread] = await db.select()
      .from(conversationThreads)
      .where(eq(conversationThreads.id, threadId));
    
    await db.update(conversationThreads)
      .set({
        messageCount: (currentThread?.messageCount || 0) + 2,
        lastDevice: body.originDevice || "unknown",
        lastMessageAt: new Date(),
      })
      .where(eq(conversationThreads.id, threadId));

    emitConversationsUpdated(userId);

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIFIED MARKER EXECUTOR V2 - CENTRALIZED ACTION EXECUTION (NON-STREAMING)
    // ═══════════════════════════════════════════════════════════════════════════
    
    unifiedMarkerExecutor.executeAllMarkers(responseContent, {
      userId,
      persona: actionFirstContext.persona,
      isOwner,
      threadId,
      enableParallelExecution: true,
      broadcastResults: true
    }).then((executionSummary: ExecutionSummary) => {
      if (executionSummary.totalMarkersDetected > 0) {
        console.log(`[V2-UnifiedMarker] Non-stream: Executed ${executionSummary.totalExecuted}/${executionSummary.totalMarkersDetected} markers: ${executionSummary.successful} success, ${executionSummary.failed} failed`);
      }
    }).catch(err => {
      console.error("[V2-UnifiedMarker] Non-stream execution failed:", err.message);
    });

    // Learn from this conversation asynchronously
    memoryService.extractInsightsFromConversation(userId, body.message, responseContent).catch(err => {
      console.log("[V2] Memory extraction failed (non-blocking):", err.message);
    });
    
    // Generate curiosity questions for future conversations
    memoryService.generateCuriosityFromConversation(userId, body.message, responseContent, isOwner, isExternal).catch(err => {
      console.log("[V2] Curiosity generation failed (non-blocking):", err.message);
    });
    
    // Check if AI asked the suggested curiosity question
    if (curiositySuggestedKey) {
      memoryService.processCuriosityInResponse(userId, responseContent, curiositySuggestedKey).catch(err => {
        console.log("[V2] Curiosity tracking failed (non-blocking):", err.message);
      });
    }

    const cleanedResponse = responseContent.replace(/\[CURIOSITÉ_POSÉE\]/g, "").trim();

    const nonStreamConfidence = UlysseCoreEngine.calculateConfidence({
      source: 'provider',
      provider: 'openai',
      hasMemorySupport: !!memoryContext,
      hasMarsVerification: needsWebSearch(body.message),
      domain: detectedDomain,
      brainConfidence: brainResult?.decision?.confidence,
      hasContextualData: !!(calendarContext || homeworkContext || screenContext),
    });

    res.json({
      threadId,
      response: cleanedResponse,
      messageCount: previousMessages.length + 2,
      confidence: nonStreamConfidence.confidence,
      confidenceLevel: nonStreamConfidence.confidenceLevel,
    });
  } catch (error: any) {
    const userId = (req as any).userId;
    const sc = req.body?.sessionContext || (req.body?.contextHints?.devopsContext ? "devops" : "assistant");
    if (userId) unregisterSessionRequest(userId, sc);
    console.error("[V2 Conversations] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  }
});

router.get("/sessions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: "Auth required" });
    const sessions = getActiveSessionsForUser(userId);
    res.json({ activeSessions: sessions, count: sessions.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const threads = await db.select()
      .from(conversationThreads)
      .where(eq(conversationThreads.userId, userId))
      .orderBy(desc(conversationThreads.lastMessageAt))
      .limit(50);

    res.json({ threads });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:threadId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const threadId = parseInt(req.params.threadId);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [thread] = await db.select()
      .from(conversationThreads)
      .where(and(
        eq(conversationThreads.id, threadId),
        eq(conversationThreads.userId, userId)
      ));

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const messages = await db.select()
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(conversationMessages.createdAt);

    res.json({ thread, messages });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:threadId/stream", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const threadId = parseInt(req.params.threadId);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ type: "connected", threadId })}\n\n`);

    const interval = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 30000);

    req.on("close", () => {
      clearInterval(interval);
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/upload", upload.array("files", 10), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const files = req.files as Express.Multer.File[];
    const message = req.body.message || "";

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Aucun fichier fourni" });
    }

    const imageFiles = files.filter(f => f.mimetype.startsWith("image/"));
    const otherFiles = files.filter(f => !f.mimetype.startsWith("image/"));

    let contentParts: OpenAI.ChatCompletionContentPart[] = [];

    if (message) {
      contentParts.push({ type: "text", text: message });
    }

    for (const img of imageFiles) {
      const imageData = fs.readFileSync(img.path);
      const base64 = imageData.toString("base64");
      const mimeType = img.mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64}`,
          detail: "high",
        },
      });
    }

    if (otherFiles.length > 0) {
      const fileList = otherFiles.map(f => `- ${f.originalname} (${f.mimetype})`).join("\n");
      contentParts.push({
        type: "text",
        text: `\n\nFichiers joints:\n${fileList}`,
      });
    }

    const [newThread] = await db.insert(conversationThreads).values({
      userId,
      title: message ? message.slice(0, 50) : "Fichiers uploadés",
      originDevice: "iphone",
      lastDevice: "iphone",
      messageCount: 0,
    }).returning();

    const attachments = files.map(f => ({
      type: f.mimetype,
      name: f.originalname,
      url: `/uploads/mobile/${f.filename}`,
    }));

    await db.insert(conversationMessages).values({
      threadId: newThread.id,
      userId,
      role: "user",
      content: message || "Fichiers joints",
      modality: "mixed",
      attachments,
      metadata: { deviceId: "iphone" },
    });

    const memories = await db.select().from(ulysseMemory).where(eq(ulysseMemory.userId, userId)).limit(10);

    const systemPrompt = `Tu es Ulysse, l'assistant IA personnel de Maurice Djedou. Tu parles en français, de manière naturelle et amicale.
Tu peux analyser les images et fichiers que l'utilisateur t'envoie.
${memories.length > 0 ? `\nMémoire: ${memories.map(m => `${m.key}: ${m.value}`).join(", ")}` : ""}`;

    const fileAI = getAIForContext("owner");
    const fileModel = fileAI.model;
    const completion = await fileAI.client.chat.completions.create({
      model: fileModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: contentParts },
      ],
      max_tokens: 2000,
    });

    const responseContent = completion.choices[0]?.message?.content || "Désolé, je n'ai pas pu analyser ces fichiers.";

    await db.insert(conversationMessages).values({
      threadId: newThread.id,
      userId,
      role: "assistant",
      content: responseContent,
      modality: "text",
      metadata: {
        model: fileModel,
        tokens: completion.usage?.total_tokens,
      },
    });

    await db.update(conversationThreads)
      .set({
        messageCount: 2,
        lastMessageAt: new Date(),
      })
      .where(eq(conversationThreads.id, newThread.id));

    // Learn from file analysis conversation asynchronously
    const userContext = message || `Analyse de ${files.length} fichier(s): ${files.map(f => f.originalname).join(", ")}`;
    memoryService.extractInsightsFromConversation(userId, userContext, responseContent).catch(err => {
      console.log("[V2 Upload] Memory extraction failed (non-blocking):", err.message);
    });

    res.json({
      threadId: newThread.id,
      response: responseContent,
      filesProcessed: files.length,
    });
  } catch (error: any) {
    console.error("[V2 Upload] Error:", error);
    res.status(500).json({ error: error.message || "Erreur lors de l'upload" });
  }
});

router.delete("/:threadId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const threadId = parseInt(req.params.threadId);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [thread] = await db.select()
      .from(conversationThreads)
      .where(and(
        eq(conversationThreads.id, threadId),
        eq(conversationThreads.userId, userId)
      ));

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    await db.delete(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId));

    await db.delete(conversationThreads)
      .where(eq(conversationThreads.id, threadId));

    emitConversationsUpdated(userId);

    res.json({ success: true });
  } catch (error: any) {
    console.error("[V2 Delete Thread] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/messages/:messageId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const messageId = parseInt(req.params.messageId);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [message] = await db.select()
      .from(conversationMessages)
      .where(eq(conversationMessages.id, messageId));

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const [thread] = await db.select()
      .from(conversationThreads)
      .where(and(
        eq(conversationThreads.id, message.threadId),
        eq(conversationThreads.userId, userId)
      ));

    if (!thread) {
      return res.status(403).json({ error: "Not authorized to delete this message" });
    }

    await db.delete(conversationMessages)
      .where(eq(conversationMessages.id, messageId));

    emitConversationsUpdated(userId);

    res.json({ success: true });
  } catch (error: any) {
    console.error("[V2 Delete Message] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
