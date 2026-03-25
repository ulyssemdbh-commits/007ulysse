import { db } from "../db";
import { dgmSessions, dgmTasks, dgmPipelineRuns } from "@shared/schema";
import { eq, sql, and, asc, inArray } from "drizzle-orm";

const LOG = "[DGM-V2]";

export const DGM_GOVERNANCE = {
  rule: "Ne rien casser. Sinon, carte blanche totale — tous les outils, tous les repos, toutes les actions.",
  autoMerge: true,
  autoDeploy: true,
  requireApproval: [] as string[],
  riskGatingThreshold: 85,
  selfHealOnFailure: true,
  maxSelfHealRetries: 3,
  allowedActions: [
    "decompose_objective",
    "run_pipeline",
    "run_parallel_pipeline",
    "create_branch",
    "create_pr",
    "merge_pr",
    "deploy",
    "rollback_on_failure",
    "code_review",
    "impact_analysis",
    "post_deploy_monitor",
    "auto_fix",
    "batch_pipeline",
  ],
  breakageProtection: {
    preDeployHealthCheck: true,
    postDeployHealthCheck: true,
    rollbackOnHealthFailure: true,
    maxRiskScoreAutoMerge: 85,
    blockOnCriticalRegression: true,
  },
  performance: {
    parallelFileFetch: true,
    maxParallelTasks: 5,
    fileContextChars: 8000,
    reviewContextChars: 6000,
    cacheTTLMs: 300_000,
    mergeWaitMs: 1000,
    maxRetryBackoffMs: 10_000,
  },
  owner: "Maurice",
  lastUpdated: "2026-03-17",
};

const REPO_APP_MAP: Record<string, string> = {
  "HorlogeMax": "horlogemax",
  "mdbhdev": "mdbhdev",
};

let _openaiInstance: any = null;
function getOpenAI() {
  if (!_openaiInstance) {
    const OpenAI = require("openai").default;
    _openaiInstance = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openaiInstance;
}

const _fileCache = new Map<string, { content: string; ts: number }>();
function getCachedFile(key: string): string | null {
  const entry = _fileCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DGM_GOVERNANCE.performance.cacheTTLMs) {
    _fileCache.delete(key);
    return null;
  }
  return entry.content;
}
function setCachedFile(key: string, content: string) {
  if (_fileCache.size > 200) {
    const oldest = [..._fileCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 50);
    oldest.forEach(([k]) => _fileCache.delete(k));
  }
  _fileCache.set(key, { content, ts: Date.now() });
}

const _circuitBreakers = new Map<string, { failures: number; openUntil: number }>();
function checkCircuit(service: string): boolean {
  const cb = _circuitBreakers.get(service);
  if (!cb) return true;
  if (Date.now() > cb.openUntil) {
    _circuitBreakers.delete(service);
    return true;
  }
  return false;
}
function recordFailure(service: string) {
  const cb = _circuitBreakers.get(service) || { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= 3) {
    cb.openUntil = Date.now() + 30_000;
    console.warn(`${LOG} Circuit breaker OPEN for ${service} (30s cooldown)`);
  }
  _circuitBreakers.set(service, cb);
}
function recordSuccess(service: string) {
  _circuitBreakers.delete(service);
}

export type PipelineStage =
  | "pending"
  | "impact_analysis"
  | "dev_patch"
  | "quality_check"
  | "code_review"
  | "pr_creation"
  | "ci_monitor"
  | "preview_audit"
  | "merge_deploy"
  | "post_deploy_monitor"
  | "completed"
  | "failed";

export interface PipelineConfig {
  owner: string;
  repo: string;
  branch?: string;
  autoMerge: boolean;
  autoDeploy: boolean;
  appName?: string;
  requireApproval: string[];
}

export interface ObjectiveDecomposition {
  objective: string;
  tasks: {
    title: string;
    description: string;
    testCriteria: string;
    impactedFiles?: string[];
    dependencies?: number[];
    priority?: "critical" | "high" | "medium" | "low";
  }[];
  estimatedComplexity: "low" | "medium" | "high" | "critical";
  estimatedDurationMinutes: number;
  parallelGroups?: number[][];
}

interface StageResult {
  success: boolean;
  data?: any;
  error?: string;
  nextStage?: PipelineStage;
  requiresApproval?: boolean;
  durationMs?: number;
}

interface PipelineMetrics {
  totalDurationMs: number;
  stageDurations: Record<string, number>;
  retryCount: number;
  filesProcessed: number;
  cacheHits: number;
  cacheMisses: number;
}

const _pendingLogs: Array<{
  sessionId: number; taskId: number; stage: string; status: string;
  input?: any; output?: any; durationMs?: number; error?: string;
}> = [];
let _flushTimer: NodeJS.Timeout | null = null;

async function flushPipelineLogs() {
  if (_pendingLogs.length === 0) return;
  const batch = _pendingLogs.splice(0, _pendingLogs.length);
  try {
    await db.insert(dgmPipelineRuns).values(batch.map(l => ({
      sessionId: l.sessionId,
      taskId: l.taskId,
      stage: l.stage,
      status: l.status,
      input: l.input || null,
      output: l.output || null,
      durationMs: l.durationMs || null,
      error: l.error || null,
    })));
  } catch (e: any) {
    console.error(`${LOG} Failed to flush ${batch.length} pipeline logs:`, e.message);
  }
}

function logPipelineRun(sessionId: number, taskId: number, stage: string, status: string, input?: any, output?: any, durationMs?: number, error?: string) {
  _pendingLogs.push({ sessionId, taskId, stage, status, input, output, durationMs, error });
  if (!_flushTimer) {
    _flushTimer = setTimeout(async () => {
      _flushTimer = null;
      await flushPipelineLogs();
    }, 500);
  }
}

async function logPipelineRunImmediate(sessionId: number, taskId: number, stage: string, status: string, input?: any, output?: any, durationMs?: number, error?: string) {
  try {
    await db.insert(dgmPipelineRuns).values({
      sessionId, taskId, stage, status,
      input: input || null, output: output || null,
      durationMs: durationMs || null, error: error || null,
    });
  } catch (e: any) {
    console.error(`${LOG} Failed to log pipeline run:`, e.message);
  }
}

async function fetchFileParallel(owner: string, repo: string, paths: string[], branch: string): Promise<{ path: string; content: string }[]> {
  const ghService = await import("./githubService");
  let cacheHits = 0;
  let cacheMisses = 0;

  const results = await Promise.allSettled(
    paths.map(async (filePath) => {
      const cacheKey = `${owner}/${repo}/${branch}/${filePath}`;
      const cached = getCachedFile(cacheKey);
      if (cached !== null) {
        cacheHits++;
        return { path: filePath, content: cached };
      }
      cacheMisses++;
      const fileData = await ghService.getFileContent(owner, repo, filePath, branch);
      if (fileData && (fileData as any).content) {
        const content = Buffer.from((fileData as any).content, "base64").toString("utf-8");
        setCachedFile(cacheKey, content);
        return { path: filePath, content };
      }
      return { path: filePath, content: "" };
    })
  );

  console.log(`${LOG} File fetch: ${cacheHits} cache hits, ${cacheMisses} misses, ${results.filter(r => r.status === "rejected").length} failures`);

  return results
    .filter((r): r is PromiseFulfilledResult<{ path: string; content: string }> => r.status === "fulfilled")
    .map(r => r.value);
}

export async function decomposeObjective(objective: string, repoContext: string): Promise<ObjectiveDecomposition> {
  const openai = getOpenAI();

  const systemPrompt = `Tu es un architecte logiciel senior EXPERT en décomposition de tâches haute performance.

Pour chaque tâche, fournis:
- title: titre concis (max 60 chars)
- description: ce qui doit être fait précisément — inclure les patterns de code, les imports nécessaires
- testCriteria: critères testables SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
- impactedFiles: fichiers probablement touchés (chemin relatif)
- dependencies: indices des tâches dont celle-ci dépend (0-indexed)
- priority: "critical" | "high" | "medium" | "low"

Règles STRICTES:
- Ordonne par dépendances (quick wins / fondations d'abord)
- Chaque tâche doit être autonome et testable INDIVIDUELLEMENT
- Inclure les migrations DB si nécessaire
- Inclure les tests si pertinent
- Max 10 tâches par objectif
- IDENTIFIER les tâches parallélisables (pas de dépendances entre elles)
- Grouper les tâches parallélisables dans "parallelGroups" (array d'arrays d'indices)

Réponds UNIQUEMENT en JSON valide:
{
  "tasks": [...],
  "estimatedComplexity": "low|medium|high|critical",
  "estimatedDurationMinutes": number,
  "parallelGroups": [[0, 1], [2, 3]]
}`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Repo: ${repoContext}\n\nObjectif: ${objective}` },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
  return {
    objective,
    tasks: parsed.tasks || [],
    estimatedComplexity: parsed.estimatedComplexity || "medium",
    estimatedDurationMinutes: parsed.estimatedDurationMinutes || 60,
    parallelGroups: parsed.parallelGroups || [],
  };
}

export async function createPipelineTasks(sessionId: number, decomposition: ObjectiveDecomposition): Promise<any[]> {
  const values = decomposition.tasks.map((t, i) => ({
    sessionId,
    sortOrder: i,
    title: t.title,
    description: t.description,
    testCriteria: t.testCriteria,
    impactedFiles: t.impactedFiles || null,
    pipelineStage: "pending" as const,
  }));

  const created = await db.insert(dgmTasks).values(values).returning();

  await db.update(dgmSessions).set({
    totalTasks: decomposition.tasks.length,
    objective: decomposition.objective,
  }).where(eq(dgmSessions.id, sessionId));

  const result = created.map((task, i) => ({ id: task.id, title: task.title, order: i }));
  console.log(`${LOG} Created ${result.length} pipeline tasks for session ${sessionId} (batch insert)`);
  return result;
}

export async function runImpactAnalysis(sessionId: number, taskId: number, config: PipelineConfig): Promise<StageResult> {
  const start = Date.now();
  try {
    const [task] = await db.select().from(dgmTasks).where(eq(dgmTasks.id, taskId));
    if (!task) return { success: false, error: "Task not found" };

    await db.update(dgmTasks).set({ pipelineStage: "impact_analysis" }).where(eq(dgmTasks.id, taskId));

    const { devopsIntelligenceEngine } = await import("./devopsIntelligenceEngine");
    const files = task.impactedFiles || [];
    const riskCheck = devopsIntelligenceEngine.autoRiskCheckForPatch(
      files.map(f => ({ path: f, content: "" }))
    );

    const durationMs = Date.now() - start;
    const result = {
      impactedFiles: files,
      riskScore: riskCheck.riskScore,
      riskLevel: riskCheck.riskLevel,
      warnings: riskCheck.warnings,
      recommendations: riskCheck.recommendations,
      fragileFiles: riskCheck.warnings.filter((w: string) => w.includes("fragile")),
      durationMs,
    };

    await db.update(dgmTasks).set({
      riskScore: riskCheck.riskScore,
      riskLevel: riskCheck.riskLevel,
    }).where(eq(dgmTasks.id, taskId));

    logPipelineRun(sessionId, taskId, "impact_analysis", "completed", { files }, result, durationMs);
    console.log(`${LOG} Impact analysis task ${taskId}: risk=${riskCheck.riskScore}/100 (${riskCheck.riskLevel}) [${durationMs}ms]`);

    return {
      success: true,
      data: result,
      nextStage: "dev_patch",
      requiresApproval: riskCheck.riskScore >= 70,
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    logPipelineRun(sessionId, taskId, "impact_analysis", "failed", null, null, durationMs, err.message);
    return { success: false, error: err.message, durationMs };
  }
}

export async function runDevPatch(
  sessionId: number,
  taskId: number,
  config: PipelineConfig,
  reviewFeedback?: string
): Promise<{ stageResult: StageResult; patchFiles: { path: string; content: string }[] }> {
  const start = Date.now();
  try {
    const [task] = await db.select().from(dgmTasks).where(eq(dgmTasks.id, taskId));
    if (!task) return { stageResult: { success: false, error: "Task not found" }, patchFiles: [] };

    await db.update(dgmTasks).set({ pipelineStage: "dev_patch" }).where(eq(dgmTasks.id, taskId));

    if (!checkCircuit("github")) {
      return { stageResult: { success: false, error: "GitHub circuit breaker open — too many recent failures" }, patchFiles: [] };
    }

    const impactedFiles = task.impactedFiles || [];
    let existingFiles: { path: string; content: string }[] = [];

    if (impactedFiles.length > 0) {
      existingFiles = await fetchFileParallel(config.owner, config.repo, impactedFiles.slice(0, 15), config.branch || "main");
    }

    if (existingFiles.length === 0) {
      try {
        const ghService = await import("./githubService");
        const tree = await ghService.getTree(config.owner, config.repo, config.branch || "main");
        const treeItems = ((tree as any)?.tree || []).filter((t: any) => t.type === "blob").slice(0, 20);
        const topFiles = treeItems.slice(0, 8).map((item: any) => item.path);
        existingFiles = await fetchFileParallel(config.owner, config.repo, topFiles, config.branch || "main");
      } catch {}
    }

    recordSuccess("github");

    const openai = getOpenAI();
    const [session] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, sessionId));
    const contextLimit = DGM_GOVERNANCE.performance.fileContextChars;
    const existingFilesContext = existingFiles.map(f => `--- ${f.path} ---\n${f.content.slice(0, contextLimit)}`).join("\n\n");

    const feedbackBlock = reviewFeedback
      ? `\n\nFEEDBACK DU REVIEW PRÉCÉDENT (corrige ces problèmes):\n${reviewFeedback}`
      : "";

    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: `Tu es un développeur senior EXPERT. Tu génères des modifications de code précises pour un repo GitHub.

RÈGLES STRICTES:
- Retourne UNIQUEMENT du JSON valide:
{
  "files": [
    { "path": "chemin/du/fichier", "content": "contenu complet du fichier modifié" }
  ],
  "explanation": "explication courte de ce qui a été modifié",
  "confidence": number (0-100)
}
- Le "content" doit être le fichier COMPLET après modification (pas un diff)
- Si le fichier n'existe pas, crée-le
- Ne modifie QUE ce qui est nécessaire pour la tâche
- Respecte le style de code existant
- Vérifie les imports, types, et la cohérence avec le reste du code
- Si un feedback de review est fourni, corrige TOUS les problèmes mentionnés` },
        { role: "user", content: `Repo: ${config.owner}/${config.repo}
Objectif global: ${session?.objective || "N/A"}
Tâche: ${task.title}
Description: ${task.description}
Critères de test: ${task.testCriteria}

Fichiers existants du repo:
${existingFilesContext || "(aucun fichier trouvé)"}${feedbackBlock}

Génère les modifications nécessaires.` },
      ],
      temperature: 0.15,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
    const patchFiles = (parsed.files || []).map((f: any) => ({ path: f.path, content: f.content }));
    const durationMs = Date.now() - start;

    console.log(`${LOG} Dev patch task ${taskId}: ${patchFiles.length} files (confidence: ${parsed.confidence || "N/A"}%) [${durationMs}ms]`);
    logPipelineRun(sessionId, taskId, "dev_patch", "completed",
      { filesCount: existingFiles.length, hasReviewFeedback: !!reviewFeedback },
      { patchCount: patchFiles.length, explanation: parsed.explanation, confidence: parsed.confidence },
      durationMs);

    return {
      stageResult: {
        success: patchFiles.length > 0,
        data: { patchFiles: patchFiles.length, explanation: parsed.explanation, confidence: parsed.confidence },
        nextStage: "code_review",
        durationMs,
      },
      patchFiles,
    };
  } catch (err: any) {
    recordFailure("github");
    const durationMs = Date.now() - start;
    console.error(`${LOG} Dev patch failed task ${taskId}: ${err.message} [${durationMs}ms]`);
    logPipelineRun(sessionId, taskId, "dev_patch", "failed", null, null, durationMs, err.message);
    return { stageResult: { success: false, error: err.message, durationMs }, patchFiles: [] };
  }
}

export async function runCodeReview(
  sessionId: number,
  taskId: number,
  config: PipelineConfig,
  patchFiles: { path: string; content: string }[]
): Promise<StageResult & { feedbackForRetry?: string }> {
  const start = Date.now();
  try {
    await db.update(dgmTasks).set({ pipelineStage: "code_review" }).where(eq(dgmTasks.id, taskId));

    const openai = getOpenAI();
    const reviewLimit = DGM_GOVERNANCE.performance.reviewContextChars;
    const filesSummary = patchFiles.map(f => `--- ${f.path} ---\n${f.content.slice(0, reviewLimit)}`).join("\n\n");

    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: `Tu es un code reviewer senior EXPERT. Analyse ce patch et fournis un review structuré en JSON:
{
  "approved": boolean,
  "score": number (0-100),
  "issues": [{"severity": "critical|warning|info", "file": string, "line": number|null, "description": string, "fix": string}],
  "improvements": [string],
  "securityFlags": [string],
  "complexity": "low|medium|high",
  "feedbackForDev": "string — résumé clair des corrections nécessaires si pas approuvé"
}

Critères d'approbation:
- score >= 70 → approved
- Pas d'issues "critical" → approved
- Vérifie: sécurité, performance, lisibilité, patterns fragiles, régressions
- feedbackForDev: DOIT être exploitable pour un retry automatique (spécifique, actionable)` },
        { role: "user", content: `Review ce patch pour ${config.owner}/${config.repo}:\n\n${filesSummary}` },
      ],
      temperature: 0.15,
      response_format: { type: "json_object" },
    });

    const review = JSON.parse(resp.choices[0]?.message?.content || "{}");
    const durationMs = Date.now() - start;

    const hasCritical = (review.issues || []).some((i: any) => i.severity === "critical");
    const effectiveApproval = review.score >= 70 && !hasCritical;
    review.approved = effectiveApproval;

    await db.update(dgmTasks).set({ reviewResult: review }).where(eq(dgmTasks.id, taskId));
    logPipelineRun(sessionId, taskId, "code_review",
      effectiveApproval ? "approved" : "changes_requested",
      { filesCount: patchFiles.length },
      review, durationMs);

    console.log(`${LOG} Code review task ${taskId}: ${effectiveApproval ? "APPROVED" : "REJECTED"} score=${review.score}/100 [${durationMs}ms]`);

    return {
      success: true,
      data: review,
      nextStage: effectiveApproval ? "pr_creation" : "dev_patch",
      requiresApproval: !effectiveApproval,
      durationMs,
      feedbackForRetry: !effectiveApproval ? (review.feedbackForDev || review.improvements?.join("; ") || "") : undefined,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    logPipelineRun(sessionId, taskId, "code_review", "failed", null, null, durationMs, err.message);
    return { success: false, error: err.message, durationMs };
  }
}

export async function runCreatePR(sessionId: number, taskId: number, config: PipelineConfig, patchFiles: { path: string; content: string }[], commitMessage: string): Promise<StageResult> {
  const start = Date.now();
  try {
    if (!checkCircuit("github")) {
      return { success: false, error: "GitHub circuit breaker open" };
    }

    await db.update(dgmTasks).set({ pipelineStage: "pr_creation" }).where(eq(dgmTasks.id, taskId));

    const [task] = await db.select().from(dgmTasks).where(eq(dgmTasks.id, taskId));
    const ts = Date.now().toString(36);
    const branchName = `dgm/task-${taskId}-${ts}-${task?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20) || "patch"}`;

    const ghService = await import("./githubService");

    let mainBranch = config.branch || "main";
    let branchInfo: any;
    try {
      branchInfo = await ghService.getBranch(config.owner, config.repo, mainBranch);
    } catch (e: any) {
      if (e.statusCode === 404 && mainBranch === "main") {
        const repoInfo = await ghService.githubApi(`/repos/${config.owner}/${config.repo}`);
        mainBranch = (repoInfo as any).default_branch || "master";
        branchInfo = await ghService.getBranch(config.owner, config.repo, mainBranch);
      } else {
        throw e;
      }
    }
    const sourceSha = branchInfo?.commit?.sha;
    if (!sourceSha) throw new Error(`Cannot resolve SHA for branch ${mainBranch}`);

    await ghService.createBranch(config.owner, config.repo, branchName, sourceSha);
    await ghService.applyPatch(config.owner, config.repo, branchName, patchFiles, commitMessage);

    const prTitle = `[DGM] ${task?.title || commitMessage}`;
    const prBody = `## DGM Pipeline V2 - Tâche #${taskId}\n\n**Objectif:** ${task?.description || "N/A"}\n\n**Fichiers modifiés:** ${patchFiles.length}\n${patchFiles.map(f => `- \`${f.path}\``).join("\n")}\n\n**Risk Score:** ${task?.riskScore || "N/A"}/100 (${task?.riskLevel || "unknown"})\n\n**Test Criteria:** ${task?.testCriteria || "N/A"}\n\n---\n*Généré automatiquement par DGM Pipeline V2*`;

    const pr = await ghService.createPullRequest(config.owner, config.repo, prTitle, prBody, branchName, mainBranch);
    const prNumber = (pr as any)?.number;
    const prUrl = (pr as any)?.html_url;
    const durationMs = Date.now() - start;

    recordSuccess("github");

    await db.update(dgmTasks).set({ prNumber, prUrl }).where(eq(dgmTasks.id, taskId));
    logPipelineRun(sessionId, taskId, "pr_creation", "completed", { branch: branchName, filesCount: patchFiles.length }, { prNumber, prUrl }, durationMs);

    console.log(`${LOG} PR #${prNumber} created task ${taskId}: ${prUrl} [${durationMs}ms]`);

    return {
      success: true,
      data: { prNumber, prUrl, branch: branchName },
      nextStage: config.autoMerge ? "merge_deploy" : "ci_monitor",
      durationMs,
    };
  } catch (err: any) {
    recordFailure("github");
    const durationMs = Date.now() - start;
    const details = err.structured ? JSON.stringify(err.structured) : "";
    console.error(`${LOG} PR creation FAILED task ${taskId}: ${err.message} ${details} [${durationMs}ms]`);
    logPipelineRun(sessionId, taskId, "pr_creation", "failed", { details: err.structured }, null, durationMs, err.message);
    return { success: false, error: err.message, durationMs };
  }
}

export async function runMergeDeploy(sessionId: number, taskId: number, config: PipelineConfig): Promise<StageResult> {
  const start = Date.now();
  try {
    await db.update(dgmTasks).set({ pipelineStage: "merge_deploy" }).where(eq(dgmTasks.id, taskId));

    const [task] = await db.select().from(dgmTasks).where(eq(dgmTasks.id, taskId));
    if (!task?.prNumber) throw new Error("No PR number found for this task");

    const ghService = await import("./githubService");

    const merged = await ghService.mergePullRequest(config.owner, config.repo, task.prNumber);
    console.log(`${LOG} PR #${task.prNumber} merged task ${taskId}`);

    let deployResult: any = { merged: true };

    if (config.autoDeploy && config.appName) {
      try {
        console.log(`${LOG} Deploying ${config.appName} to VPS...`);
        const { sshService } = await import("./sshService");
        const updateResult = await sshService.updateApp(config.appName, config.branch || "main");
        deployResult.deploy = updateResult;
        console.log(`${LOG} VPS deploy SUCCESS: ${config.appName}: ${updateResult.message}`);
      } catch (deployErr: any) {
        deployResult.deployError = deployErr.message;
        console.error(`${LOG} VPS deploy FAILED ${config.appName}: ${deployErr.message}`);
      }
    } else if (config.autoDeploy && !config.appName) {
      console.log(`${LOG} autoDeploy=true but no appName mapped for repo ${config.repo}`);
    }

    const durationMs = Date.now() - start;
    await db.update(dgmTasks).set({ deployResult, pipelineStage: config.autoDeploy ? "post_deploy_monitor" : "completed" }).where(eq(dgmTasks.id, taskId));
    logPipelineRun(sessionId, taskId, "merge_deploy", "completed", { prNumber: task.prNumber }, deployResult, durationMs);

    return {
      success: true,
      data: deployResult,
      nextStage: config.autoDeploy ? "post_deploy_monitor" : "completed",
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    logPipelineRun(sessionId, taskId, "merge_deploy", "failed", null, null, durationMs, err.message);
    return { success: false, error: err.message, durationMs };
  }
}

export async function runPostDeployMonitor(sessionId: number, taskId: number, config: PipelineConfig): Promise<StageResult> {
  const start = Date.now();
  try {
    await db.update(dgmTasks).set({ pipelineStage: "post_deploy_monitor" }).where(eq(dgmTasks.id, taskId));

    let healthResult: any = { status: "unknown" };

    if (config.appName) {
      try {
        const { sshService } = await import("./sshService");
        const [health, logs] = await Promise.allSettled([
          sshService.serverHealth(),
          sshService.appLogs(config.appName, 20),
        ]);

        const healthData = health.status === "fulfilled" ? health.value : null;
        const logsData = logs.status === "fulfilled" ? logs.value : null;
        const hasErrors = logsData?.toLowerCase().includes("error") || logsData?.toLowerCase().includes("crash");

        healthResult = {
          status: hasErrors ? "degraded" : "healthy",
          serverHealth: healthData,
          recentErrors: hasErrors,
          logsPreview: logsData?.slice(0, 500),
        };
      } catch (monErr: any) {
        healthResult = { status: "check_failed", error: monErr.message };
      }
    }

    const durationMs = Date.now() - start;
    logPipelineRun(sessionId, taskId, "post_deploy_monitor", healthResult.status === "healthy" ? "completed" : "warning", null, healthResult, durationMs);

    await db.update(dgmTasks).set({
      pipelineStage: "completed",
      status: "tested",
      completedAt: new Date(),
      testedAt: new Date(),
      deployResult: healthResult,
    }).where(eq(dgmTasks.id, taskId));

    await db.update(dgmSessions).set({
      completedTasks: sql`(SELECT count(*) FROM dgm_tasks WHERE session_id = ${sessionId} AND status IN ('tested', 'completed'))`,
    }).where(eq(dgmSessions.id, sessionId));

    console.log(`${LOG} Post-deploy monitor task ${taskId}: ${healthResult.status} [${durationMs}ms]`);

    return { success: true, data: healthResult, nextStage: "completed", durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    logPipelineRun(sessionId, taskId, "post_deploy_monitor", "failed", null, null, durationMs, err.message);
    return { success: false, error: err.message, durationMs };
  }
}

export function getDefaultConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  const repo = overrides?.repo || "ulysseproject";
  const appName = overrides?.appName || REPO_APP_MAP[repo];
  return {
    owner: "ulyssemdbh-commits",
    repo,
    branch: "main",
    autoMerge: DGM_GOVERNANCE.autoMerge,
    autoDeploy: DGM_GOVERNANCE.autoDeploy,
    requireApproval: [...DGM_GOVERNANCE.requireApproval],
    ...overrides,
    ...(appName ? { appName } : {}),
  };
}

export async function runFullPipeline(sessionId: number, taskId: number, config: PipelineConfig, patchFiles: { path: string; content: string }[], commitMessage: string): Promise<{ stages: Record<string, StageResult>; finalStatus: string; metrics: PipelineMetrics }> {
  const pipelineStart = Date.now();
  const stages: Record<string, StageResult> = {};
  const metrics: PipelineMetrics = {
    totalDurationMs: 0,
    stageDurations: {},
    retryCount: 0,
    filesProcessed: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  console.log(`${LOG} ===== PIPELINE V2 START: Task ${taskId} =====`);
  console.log(`${LOG} Governance: ${DGM_GOVERNANCE.rule}`);
  console.log(`${LOG} Config: autoMerge=${config.autoMerge}, autoDeploy=${config.autoDeploy}, app=${config.appName || "none"}`);

  const impact = await runImpactAnalysis(sessionId, taskId, config);
  stages.impact_analysis = impact;
  metrics.stageDurations.impact_analysis = impact.durationMs || 0;
  if (!impact.success) {
    metrics.totalDurationMs = Date.now() - pipelineStart;
    return { stages, finalStatus: "failed_at_impact", metrics };
  }

  const riskScore = impact.data?.riskScore || 0;
  if (riskScore >= DGM_GOVERNANCE.breakageProtection.maxRiskScoreAutoMerge) {
    console.log(`${LOG} RISK ${riskScore} >= ${DGM_GOVERNANCE.breakageProtection.maxRiskScoreAutoMerge} — BLOCKED`);
    await logPipelineRunImmediate(sessionId, taskId, "risk_gate", "blocked",
      { riskScore, threshold: DGM_GOVERNANCE.breakageProtection.maxRiskScoreAutoMerge },
      { reason: "Risk too high" });
    metrics.totalDurationMs = Date.now() - pipelineStart;
    return { stages, finalStatus: "blocked_high_risk", metrics };
  }

  let finalPatchFiles = patchFiles;
  if (finalPatchFiles.length === 0) {
    const devPatch = await runDevPatch(sessionId, taskId, config);
    stages.dev_patch = devPatch.stageResult;
    metrics.stageDurations.dev_patch = devPatch.stageResult.durationMs || 0;
    if (!devPatch.stageResult.success || devPatch.patchFiles.length === 0) {
      metrics.totalDurationMs = Date.now() - pipelineStart;
      return { stages, finalStatus: "failed_at_dev_patch", metrics };
    }
    finalPatchFiles = devPatch.patchFiles;
    metrics.filesProcessed = finalPatchFiles.length;
  }

  let reviewPassed = false;
  let retryCount = 0;
  const maxRetries = DGM_GOVERNANCE.maxSelfHealRetries;

  while (!reviewPassed && retryCount <= maxRetries) {
    const review = await runCodeReview(sessionId, taskId, config, finalPatchFiles) as StageResult & { feedbackForRetry?: string };
    const stageKey = retryCount === 0 ? "code_review" : `code_review_retry_${retryCount}`;
    stages[stageKey] = review;
    metrics.stageDurations[stageKey] = review.durationMs || 0;

    if (!review.success) {
      metrics.totalDurationMs = Date.now() - pipelineStart;
      return { stages, finalStatus: "failed_at_review", metrics };
    }

    if (review.data?.approved) {
      reviewPassed = true;
      console.log(`${LOG} Review APPROVED${retryCount > 0 ? ` (after ${retryCount} retries)` : ""}`);
    } else if (retryCount < maxRetries && DGM_GOVERNANCE.selfHealOnFailure) {
      retryCount++;
      metrics.retryCount = retryCount;
      const feedback = review.feedbackForRetry || "";
      console.log(`${LOG} Review REJECTED — self-heal retry ${retryCount}/${maxRetries} with feedback: ${feedback.slice(0, 100)}...`);

      const retryPatch = await runDevPatch(sessionId, taskId, config, feedback);
      stages[`dev_patch_retry_${retryCount}`] = retryPatch.stageResult;
      metrics.stageDurations[`dev_patch_retry_${retryCount}`] = retryPatch.stageResult.durationMs || 0;

      if (retryPatch.stageResult.success && retryPatch.patchFiles.length > 0) {
        finalPatchFiles = retryPatch.patchFiles;
      } else {
        console.log(`${LOG} Self-heal patch generation failed — proceeding with last known patch`);
        reviewPassed = true;
      }
    } else {
      console.log(`${LOG} Review rejected after ${retryCount} retries — proceeding anyway (score: ${review.data?.score})`);
      reviewPassed = true;
    }
  }

  const pr = await runCreatePR(sessionId, taskId, config, finalPatchFiles, commitMessage);
  stages.pr_creation = pr;
  metrics.stageDurations.pr_creation = pr.durationMs || 0;
  if (!pr.success) {
    metrics.totalDurationMs = Date.now() - pipelineStart;
    return { stages, finalStatus: "failed_at_pr", metrics };
  }

  if (config.autoMerge) {
    await new Promise(r => setTimeout(r, DGM_GOVERNANCE.performance.mergeWaitMs));

    const merge = await runMergeDeploy(sessionId, taskId, config);
    stages.merge_deploy = merge;
    metrics.stageDurations.merge_deploy = merge.durationMs || 0;
    if (!merge.success) {
      console.log(`${LOG} Merge failed — breakage protection active`);
      metrics.totalDurationMs = Date.now() - pipelineStart;
      return { stages, finalStatus: "failed_at_merge", metrics };
    }

    if (config.autoDeploy && config.appName) {
      const monitor = await runPostDeployMonitor(sessionId, taskId, config);
      stages.post_deploy_monitor = monitor;
      metrics.stageDurations.post_deploy_monitor = monitor.durationMs || 0;

      if (!monitor.success && DGM_GOVERNANCE.breakageProtection.rollbackOnHealthFailure) {
        console.log(`${LOG} Post-deploy health FAILED — rollback needed`);
        await logPipelineRunImmediate(sessionId, taskId, "rollback", "triggered", null, { reason: "Post-deploy health check failed" });
        metrics.totalDurationMs = Date.now() - pipelineStart;
        return { stages, finalStatus: "deployed_but_unhealthy_rollback_needed", metrics };
      }
    }
  }

  const finalStatus = config.autoMerge ? "pipeline_complete" : "pr_created_awaiting_merge";
  metrics.totalDurationMs = Date.now() - pipelineStart;

  await flushPipelineLogs();

  console.log(`${LOG} ===== PIPELINE V2 END: Task ${taskId} → ${finalStatus} [${metrics.totalDurationMs}ms, ${metrics.retryCount} retries] =====`);

  return { stages, finalStatus, metrics };
}

export async function runParallelPipeline(
  sessionId: number,
  taskIds: number[],
  config: PipelineConfig,
  commitPrefix: string
): Promise<{ results: Record<number, { stages: Record<string, StageResult>; finalStatus: string; metrics: PipelineMetrics }>; totalDurationMs: number }> {
  const start = Date.now();
  const maxParallel = DGM_GOVERNANCE.performance.maxParallelTasks;
  const batches: number[][] = [];

  for (let i = 0; i < taskIds.length; i += maxParallel) {
    batches.push(taskIds.slice(i, i + maxParallel));
  }

  console.log(`${LOG} ===== PARALLEL PIPELINE: ${taskIds.length} tasks in ${batches.length} batches (max ${maxParallel} parallel) =====`);

  const results: Record<number, { stages: Record<string, StageResult>; finalStatus: string; metrics: PipelineMetrics }> = {};

  for (const batch of batches) {
    console.log(`${LOG} Running batch: tasks [${batch.join(", ")}]`);
    const batchResults = await Promise.allSettled(
      batch.map(taskId =>
        runFullPipeline(sessionId, taskId, config, [], `${commitPrefix} (task #${taskId})`)
      )
    );

    batchResults.forEach((result, idx) => {
      const taskId = batch[idx];
      if (result.status === "fulfilled") {
        results[taskId] = result.value;
      } else {
        results[taskId] = {
          stages: {},
          finalStatus: `batch_error: ${result.reason?.message || "unknown"}`,
          metrics: { totalDurationMs: 0, stageDurations: {}, retryCount: 0, filesProcessed: 0, cacheHits: 0, cacheMisses: 0 },
        };
      }
    });
  }

  const totalDurationMs = Date.now() - start;
  const succeeded = Object.values(results).filter(r => r.finalStatus === "pipeline_complete" || r.finalStatus === "pr_created_awaiting_merge").length;
  const failed = Object.values(results).filter(r => r.finalStatus.includes("failed") || r.finalStatus.includes("error")).length;

  console.log(`${LOG} ===== PARALLEL PIPELINE END: ${succeeded}/${taskIds.length} succeeded, ${failed} failed [${totalDurationMs}ms] =====`);

  return { results, totalDurationMs };
}

export async function getNextPendingTask(sessionId: number): Promise<any | null> {
  const [task] = await db.select().from(dgmTasks)
    .where(and(eq(dgmTasks.sessionId, sessionId), eq(dgmTasks.status, "pending")))
    .orderBy(asc(dgmTasks.sortOrder))
    .limit(1);
  return task || null;
}

export async function getIndependentPendingTasks(sessionId: number, decomposition?: ObjectiveDecomposition): Promise<any[]> {
  const allTasks = await db.select().from(dgmTasks)
    .where(eq(dgmTasks.sessionId, sessionId))
    .orderBy(asc(dgmTasks.sortOrder));

  const completedIds = new Set(
    allTasks.filter(t => t.status === "tested" || t.status === "completed").map(t => t.id)
  );

  const pendingTasks = allTasks.filter(t => t.status === "pending");

  if (!decomposition?.tasks || !decomposition.parallelGroups?.length) {
    return pendingTasks.slice(0, 1);
  }

  const readyTasks = pendingTasks.filter((task, _idx) => {
    const taskDef = decomposition.tasks[task.sortOrder];
    if (!taskDef?.dependencies?.length) return true;
    return taskDef.dependencies.every(depIdx => {
      const depTask = allTasks.find(t => t.sortOrder === depIdx);
      return depTask && completedIds.has(depTask.id);
    });
  });

  return readyTasks.slice(0, DGM_GOVERNANCE.performance.maxParallelTasks);
}

export async function getPipelineReport(sessionId: number): Promise<any> {
  const [[session], tasks, runs] = await Promise.all([
    db.select().from(dgmSessions).where(eq(dgmSessions.id, sessionId)),
    db.select().from(dgmTasks).where(eq(dgmTasks.sessionId, sessionId)).orderBy(asc(dgmTasks.sortOrder)),
    db.select().from(dgmPipelineRuns).where(eq(dgmPipelineRuns.sessionId, sessionId)).orderBy(asc(dgmPipelineRuns.createdAt)),
  ]);

  const totalDuration = runs.reduce((sum, r) => sum + (r.durationMs || 0), 0);
  const failedStages = runs.filter(r => r.status === "failed");
  const retryStages = runs.filter(r => r.stage.includes("retry"));

  const stageTiming: Record<string, { count: number; totalMs: number; avgMs: number }> = {};
  for (const run of runs) {
    if (!stageTiming[run.stage]) stageTiming[run.stage] = { count: 0, totalMs: 0, avgMs: 0 };
    stageTiming[run.stage].count++;
    stageTiming[run.stage].totalMs += run.durationMs || 0;
  }
  Object.values(stageTiming).forEach(s => { s.avgMs = Math.round(s.totalMs / s.count); });

  return {
    session: {
      id: session?.id,
      objective: session?.objective,
      repo: session?.repoContext,
      active: session?.active,
      totalTasks: session?.totalTasks,
      completedTasks: session?.completedTasks,
    },
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      pipelineStage: t.pipelineStage,
      riskScore: t.riskScore,
      riskLevel: t.riskLevel,
      prNumber: t.prNumber,
      prUrl: t.prUrl,
      reviewApproved: (t.reviewResult as any)?.approved,
      reviewScore: (t.reviewResult as any)?.score,
    })),
    pipeline: {
      version: "V2",
      totalRuns: runs.length,
      totalDurationMs: totalDuration,
      totalDurationFormatted: totalDuration >= 60_000
        ? `${Math.floor(totalDuration / 60_000)}m ${Math.round((totalDuration % 60_000) / 1000)}s`
        : `${Math.round(totalDuration / 1000)}s`,
      failedStages: failedStages.map(f => ({ stage: f.stage, taskId: f.taskId, error: f.error })),
      retryCount: retryStages.length,
      stageTiming,
    },
    summary: {
      tasksCompleted: tasks.filter(t => t.status === "tested" || t.status === "completed").length,
      tasksFailed: tasks.filter(t => t.status === "failed").length,
      tasksPending: tasks.filter(t => t.status === "pending").length,
      tasksRunning: tasks.filter(t => t.status === "running").length,
      prsCreated: tasks.filter(t => t.prNumber).length,
      avgRiskScore: tasks.filter(t => t.riskScore).length > 0
        ? Math.round(tasks.filter(t => t.riskScore).reduce((s, t) => s + (t.riskScore || 0), 0) / tasks.filter(t => t.riskScore).length)
        : 0,
    },
    governance: {
      maxParallelTasks: DGM_GOVERNANCE.performance.maxParallelTasks,
      maxSelfHealRetries: DGM_GOVERNANCE.maxSelfHealRetries,
      riskGatingThreshold: DGM_GOVERNANCE.riskGatingThreshold,
      selfHealEnabled: DGM_GOVERNANCE.selfHealOnFailure,
    },
  };
}

export function clearFileCache() {
  const size = _fileCache.size;
  _fileCache.clear();
  console.log(`${LOG} File cache cleared (${size} entries)`);
}

export function getCircuitBreakerStatus(): Record<string, { failures: number; openUntil: number; isOpen: boolean }> {
  const status: Record<string, any> = {};
  _circuitBreakers.forEach((cb, service) => {
    status[service] = { ...cb, isOpen: Date.now() < cb.openUntil };
  });
  return status;
}

export const dgmPipelineOrchestrator = {
  DGM_GOVERNANCE,
  getDefaultConfig,
  decomposeObjective,
  createPipelineTasks,
  runImpactAnalysis,
  runDevPatch,
  runCodeReview,
  runCreatePR,
  runMergeDeploy,
  runPostDeployMonitor,
  runFullPipeline,
  runParallelPipeline,
  getNextPendingTask,
  getIndependentPendingTasks,
  getPipelineReport,
  clearFileCache,
  getCircuitBreakerStatus,
};
