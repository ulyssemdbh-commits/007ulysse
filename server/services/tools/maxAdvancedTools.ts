/**
 * MaxAI Advanced Tools — 5 capacités haut niveau branchées au cerveau Ulysse:
 *
 *   1. firecrawl_research   → web scraping profond (Jina Reader + cheerio)
 *   2. subagent_parallel    → exécution parallèle de N tool calls
 *   3. todo_planner         → planification + suivi de tâches multi-étapes
 *   4. code_sandbox         → exécution JS isolée (node:vm) avec timeout
 *   5. mcp_devops_bridge    → expose devops_server en MCP pour DeerFlow & co
 *
 * Chaque outil pulse le cerveau Ulysse et persiste les résultats notables.
 */

import OpenAI from "openai";
import * as vm from "node:vm";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { brainPulse } from "../sensory/BrainPulse";
import { memoryGraphService } from "../memoryGraphService";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────

const MAX_OUTPUT_CHARS = 60000;
const OWNER_USER_ID = 1; // Maurice — seul autorisé pour les capacités sensibles

const truncate = (s: string, n = MAX_OUTPUT_CHARS) =>
  s.length <= n ? s : s.slice(0, n) + `\n\n…[tronqué, ${s.length - n} chars de plus]`;

/** Bloque IPs privées/loopback/cloud-metadata pour empêcher SSRF. */
function assertSafeUrl(rawUrl: string): URL {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error(`URL invalide: ${rawUrl}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Protocole interdit: ${u.protocol}`);
  const host = u.hostname.toLowerCase();
  // Loopback / metadata / private ranges
  const blocked = [
    /^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^::1$/, /^\[?::1\]?$/,
    /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,                  // link-local + AWS/GCP metadata
    /^fc00:/, /^fe80:/,             // IPv6 ULA + link-local
    /^metadata\.google\.internal$/i,
    /\.internal$/i, /\.local$/i, /\.localhost$/i,
  ];
  for (const rx of blocked) {
    if (rx.test(host)) throw new Error(`Hôte interne bloqué (anti-SSRF): ${host}`);
  }
  return u;
}

async function persistMemory(userId: number | undefined, kind: string, summary: string, payload: any) {
  if (!userId) return;
  try {
    await memoryGraphService.recordObservation?.({
      userId,
      kind,
      summary: summary.slice(0, 500),
      payload,
      source: "maxai_advanced",
    });
  } catch {
    /* memoryGraph.recordObservation may not exist — best-effort */
  }
}

// ────────────────────────────────────────────────────────────────────
//  1. firecrawl_research — Web scraping profond (Jina Reader + cheerio)
// ────────────────────────────────────────────────────────────────────

const JINA_READER_BASE = "https://r.jina.ai/";

async function jinaFetchClean(url: string, timeoutMs = 15000): Promise<string> {
  assertSafeUrl(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(JINA_READER_BASE + url, {
      headers: { "X-Return-Format": "markdown", "Accept": "text/markdown" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Jina ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function rawFetchAndExtract(url: string, timeoutMs = 15000): Promise<{ title: string; text: string; links: string[] }> {
  assertSafeUrl(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 UlysseBot/1.0 (research)" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, iframe, svg").remove();
    const title = $("title").first().text().trim() || $("h1").first().text().trim() || url;
    const text = $("body").text().replace(/\s+/g, " ").trim();
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      try {
        const abs = new URL(href, url).toString();
        if (!links.includes(abs)) links.push(abs);
      } catch { /* invalid URL */ }
    });
    return { title, text: truncate(text, 30000), links: links.slice(0, 100) };
  } finally {
    clearTimeout(t);
  }
}

export async function executeFirecrawlResearch(args: Record<string, any>, userId?: number): Promise<string> {
  const action = (args.action || "fetch_clean") as "fetch_clean" | "fetch_raw" | "crawl_site" | "search_and_fetch";
  brainPulse(["sensory", "feature"], "firecrawl_research", `${action}: ${args.url || args.query || ""}`.slice(0, 100), { userId, intensity: 2 });

  try {
    if (action === "fetch_clean") {
      if (!args.url) return JSON.stringify({ error: "url requis" });
      const md = await jinaFetchClean(args.url, args.timeoutMs ?? 15000);
      await persistMemory(userId, "web_fetch", `Lecture: ${args.url}`, { url: args.url, length: md.length });
      return JSON.stringify({ ok: true, url: args.url, source: "jina_reader", markdown: truncate(md, 40000) });
    }

    if (action === "fetch_raw") {
      if (!args.url) return JSON.stringify({ error: "url requis" });
      const data = await rawFetchAndExtract(args.url, args.timeoutMs ?? 15000);
      await persistMemory(userId, "web_fetch_raw", `Scrape: ${args.url}`, { url: args.url, title: data.title });
      return JSON.stringify({ ok: true, url: args.url, ...data });
    }

    if (action === "crawl_site") {
      if (!args.url) return JSON.stringify({ error: "url requis" });
      const maxPages = Math.min(Math.max(args.maxPages ?? 5, 1), 15);
      const visited = new Set<string>();
      const queue: string[] = [args.url];
      const results: Array<{ url: string; title: string; excerpt: string }> = [];
      const sameOriginOnly = args.sameOriginOnly !== false;
      const origin = sameOriginOnly ? new URL(args.url).origin : null;

      while (queue.length > 0 && results.length < maxPages) {
        const next = queue.shift()!;
        if (visited.has(next)) continue;
        visited.add(next);
        try {
          const data = await rawFetchAndExtract(next, 10000);
          results.push({ url: next, title: data.title, excerpt: data.text.slice(0, 800) });
          for (const l of data.links) {
            if (visited.has(l) || queue.includes(l)) continue;
            if (origin && new URL(l).origin !== origin) continue;
            queue.push(l);
          }
        } catch (e: any) {
          results.push({ url: next, title: "ERROR", excerpt: e.message?.slice(0, 200) || "fetch failed" });
        }
      }
      brainPulse("hippocampus", "firecrawl_research", `crawl_site terminé: ${results.length} pages`, { userId, intensity: 3 });
      await persistMemory(userId, "web_crawl", `Crawl: ${args.url} (${results.length} pages)`, { url: args.url, pages: results.length });
      return JSON.stringify({ ok: true, root: args.url, pages_crawled: results.length, results });
    }

    if (action === "search_and_fetch") {
      if (!args.query) return JSON.stringify({ error: "query requis" });
      const ddgRes = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`, {
        headers: { "User-Agent": "Mozilla/5.0 UlysseBot/1.0" },
      });
      const html = await ddgRes.text();
      const $ = cheerio.load(html);
      const urls: string[] = [];
      $("a.result__a").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const u = new URL(href, "https://duckduckgo.com");
          const real = u.searchParams.get("uddg") || u.toString();
          if (real.startsWith("http") && !urls.includes(real)) urls.push(real);
        } catch {}
      });
      const top = urls.slice(0, Math.min(args.topN ?? 3, 5));
      const fetched = await Promise.all(top.map(async u => {
        try { return { url: u, markdown: truncate(await jinaFetchClean(u, 10000), 8000) }; }
        catch (e: any) { return { url: u, error: e.message?.slice(0, 200) }; }
      }));
      brainPulse("association", "firecrawl_research", `search "${args.query}" → ${fetched.length} pages`, { userId, intensity: 3 });
      await persistMemory(userId, "web_search", `Recherche: ${args.query}`, { query: args.query, urls: top });
      return JSON.stringify({ ok: true, query: args.query, results: fetched });
    }

    return JSON.stringify({ error: `Action inconnue: ${action}. Disponibles: fetch_clean, fetch_raw, crawl_site, search_and_fetch` });
  } catch (e: any) {
    brainPulse("prefrontal", "firecrawl_research", `ERREUR: ${e.message}`, { userId, intensity: 1 });
    return JSON.stringify({ error: e.message || String(e) });
  }
}

// ────────────────────────────────────────────────────────────────────
//  2. subagent_parallel — Exécution parallèle de plusieurs tool calls
// ────────────────────────────────────────────────────────────────────

export async function executeSubagentParallel(
  args: Record<string, any>,
  userId: number,
  executor: (toolName: string, args: Record<string, any>, userId: number) => Promise<string>
): Promise<string> {
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  if (tasks.length === 0) return JSON.stringify({ error: "tasks requis (array de {tool, args, label?})" });
  if (tasks.length > 8) return JSON.stringify({ error: "max 8 tâches en parallèle (reçu " + tasks.length + ")" });
  // Anti fork-bomb: pas de récursion subagent_parallel dans subagent_parallel
  for (const t of tasks) {
    if (t?.tool === "subagent_parallel") {
      return JSON.stringify({ error: "Récursion interdite: subagent_parallel ne peut pas s'invoquer lui-même (anti fork-bomb)." });
    }
  }

  const concurrency = Math.min(args.concurrency ?? tasks.length, tasks.length, 6);
  brainPulse(["motor", "prefrontal"], "subagent_parallel", `Lance ${tasks.length} sous-agents (concurrency=${concurrency})`, { userId, intensity: 4, autonomous: true });

  const startedAt = Date.now();
  const results: any[] = new Array(tasks.length);

  // Simple concurrency-limited runner
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      const task = tasks[idx];
      const t0 = Date.now();
      try {
        const out = await executor(task.tool, task.args || {}, userId);
        results[idx] = {
          label: task.label || task.tool,
          tool: task.tool,
          ok: true,
          durationMs: Date.now() - t0,
          result: typeof out === "string" && out.length > 5000 ? out.slice(0, 5000) + "…[tronqué]" : out,
        };
        brainPulse("motor", "subagent_parallel", `✓ ${task.tool} en ${Date.now() - t0}ms`, { userId, intensity: 2 });
      } catch (e: any) {
        results[idx] = { label: task.label || task.tool, tool: task.tool, ok: false, error: e.message || String(e), durationMs: Date.now() - t0 };
        brainPulse("prefrontal", "subagent_parallel", `✗ ${task.tool}: ${e.message?.slice(0, 80)}`, { userId, intensity: 1 });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const totalMs = Date.now() - startedAt;
  const okCount = results.filter(r => r?.ok).length;
  brainPulse("hippocampus", "subagent_parallel", `Terminé: ${okCount}/${tasks.length} réussis en ${totalMs}ms`, { userId, intensity: 4, autonomous: true });
  await persistMemory(userId, "parallel_run", `Parallel: ${tasks.map((t: any) => t.tool).join(", ")} (${okCount}/${tasks.length})`, { tasks: tasks.length, ok: okCount, totalMs });

  return JSON.stringify({ ok: true, totalMs, concurrency, succeeded: okCount, failed: tasks.length - okCount, results });
}

// ────────────────────────────────────────────────────────────────────
//  3. todo_planner — Plans persistants par user avec suivi d'étapes
// ────────────────────────────────────────────────────────────────────

interface TodoStep {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "done" | "skipped" | "failed";
  notes?: string;
  startedAt?: number;
  completedAt?: number;
  result?: string;
}
interface TodoPlan {
  objective: string;
  createdAt: number;
  steps: TodoStep[];
}

const todoPlans = new Map<number, TodoPlan>();
const TODO_PLAN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TODO_MAX_PLANS = 200;

function gcTodoPlans(): void {
  const now = Date.now();
  for (const [uid, plan] of todoPlans) {
    if (now - plan.createdAt > TODO_PLAN_TTL_MS) todoPlans.delete(uid);
  }
  if (todoPlans.size > TODO_MAX_PLANS) {
    // Évince les plus anciens
    const sorted = [...todoPlans.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [uid] of sorted.slice(0, todoPlans.size - TODO_MAX_PLANS)) {
      todoPlans.delete(uid);
    }
  }
}

function renderPlan(plan: TodoPlan): string {
  const lines = [`# 🎯 ${plan.objective}`, ""];
  for (const s of plan.steps) {
    const icon = s.status === "done" ? "✅" : s.status === "in_progress" ? "▶️" : s.status === "skipped" ? "⏭️" : s.status === "failed" ? "❌" : "⬜";
    lines.push(`${icon} **${s.id}.** ${s.title}${s.notes ? ` _(${s.notes})_` : ""}`);
  }
  const done = plan.steps.filter(s => s.status === "done").length;
  lines.push("", `Progression: **${done}/${plan.steps.length}**`);
  return lines.join("\n");
}

export async function executeTodoPlanner(args: Record<string, any>, userId: number): Promise<string> {
  const action = args.action as "plan" | "start" | "complete" | "fail" | "skip" | "get_status" | "clear" | "update_notes";
  brainPulse("prefrontal", "todo_planner", `${action}`, { userId, intensity: 2 });

  try {
    if (action === "plan") {
      if (!args.objective || !Array.isArray(args.steps) || args.steps.length === 0) {
        return JSON.stringify({ error: "objective + steps[] (array de strings) requis" });
      }
      const plan: TodoPlan = {
        objective: args.objective,
        createdAt: Date.now(),
        steps: args.steps.map((title: string, idx: number) => ({ id: idx + 1, title, status: "pending" as const })),
      };
      todoPlans.set(userId, plan);
      gcTodoPlans();
      brainPulse("hippocampus", "todo_planner", `Plan créé: ${plan.steps.length} étapes — ${plan.objective}`, { userId, intensity: 3 });
      await persistMemory(userId, "todo_plan", `Plan: ${plan.objective} (${plan.steps.length} étapes)`, plan);
      return JSON.stringify({ ok: true, plan: renderPlan(plan), totalSteps: plan.steps.length });
    }

    const plan = todoPlans.get(userId);
    if (!plan) return JSON.stringify({ error: "Aucun plan actif. Utilise action='plan' d'abord." });

    if (action === "get_status") {
      return JSON.stringify({ ok: true, plan: renderPlan(plan), raw: plan });
    }

    if (action === "clear") {
      todoPlans.delete(userId);
      return JSON.stringify({ ok: true, message: "Plan effacé." });
    }

    const stepId = Number(args.stepId);
    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return JSON.stringify({ error: `Étape ${stepId} introuvable. Étapes valides: 1-${plan.steps.length}` });

    if (action === "start") {
      step.status = "in_progress";
      step.startedAt = Date.now();
      if (args.notes) step.notes = args.notes;
      brainPulse("motor", "todo_planner", `▶ Étape ${stepId}: ${step.title}`, { userId, intensity: 2 });
    } else if (action === "complete") {
      step.status = "done";
      step.completedAt = Date.now();
      if (args.result) step.result = String(args.result).slice(0, 500);
      brainPulse(["motor", "hippocampus"], "todo_planner", `✓ Étape ${stepId} terminée`, { userId, intensity: 3 });
    } else if (action === "fail") {
      step.status = "failed";
      step.completedAt = Date.now();
      if (args.notes) step.notes = args.notes;
      brainPulse("prefrontal", "todo_planner", `✗ Étape ${stepId} a échoué`, { userId, intensity: 2 });
    } else if (action === "skip") {
      step.status = "skipped";
      step.completedAt = Date.now();
      if (args.notes) step.notes = args.notes;
    } else if (action === "update_notes") {
      step.notes = String(args.notes || "");
    } else {
      return JSON.stringify({ error: `Action inconnue: ${action}` });
    }

    return JSON.stringify({ ok: true, plan: renderPlan(plan), updatedStep: step });
  } catch (e: any) {
    return JSON.stringify({ error: e.message || String(e) });
  }
}

// ────────────────────────────────────────────────────────────────────
//  4. code_sandbox — Exécution JS isolée via node:vm
// ────────────────────────────────────────────────────────────────────

export async function executeCodeSandbox(args: Record<string, any>, userId?: number): Promise<string> {
  // Sécurité: node:vm n'est PAS un sandbox sûr (échappement possible via constructor chains).
  // Restriction stricte au owner uniquement.
  if (userId !== OWNER_USER_ID) {
    return JSON.stringify({ error: "code_sandbox réservé au owner Ulysse (sécurité: node:vm n'isole pas du process Node)." });
  }
  const code = String(args.code || "");
  if (!code) return JSON.stringify({ error: "code requis (string JS)" });
  const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 5000, 100), 30000);
  brainPulse(["sensory", "concept"], "code_sandbox", `Exécute ${code.length} chars (timeout=${timeoutMs}ms)`, { userId, intensity: 3 });

  const logs: string[] = [];
  const sandboxConsole = {
    log: (...a: any[]) => logs.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")),
    error: (...a: any[]) => logs.push("[ERROR] " + a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")),
    warn: (...a: any[]) => logs.push("[WARN] " + a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")),
    info: (...a: any[]) => logs.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")),
  };

  // Strict sandbox: NO require, NO process, NO globalThis access
  const sandbox: Record<string, any> = {
    console: sandboxConsole,
    Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Error, Promise,
    Map, Set, Symbol, parseInt, parseFloat, isNaN, isFinite,
    setTimeout: (fn: any, ms: number) => setTimeout(fn, Math.min(ms, timeoutMs)),
    clearTimeout,
    fetch: args.allowNetwork ? fetch : undefined,
    URL: args.allowNetwork ? URL : undefined,
    URLSearchParams: args.allowNetwork ? URLSearchParams : undefined,
    __input: args.input ?? null,
  };

  try {
    const context = vm.createContext(sandbox, { name: "maxai-sandbox" });
    const wrappedCode = `(async () => { ${code}\n })()`;
    const script = new vm.Script(wrappedCode, { filename: "sandbox.js" });
    const result = await Promise.race([
      script.runInContext(context, { timeout: timeoutMs, displayErrors: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms`)), timeoutMs + 1000)),
    ]);

    let serialized: string;
    try { serialized = result === undefined ? "undefined" : JSON.stringify(result, null, 2); }
    catch { serialized = String(result); }

    brainPulse("hippocampus", "code_sandbox", `✓ Exécuté avec succès`, { userId, intensity: 2 });
    return JSON.stringify({ ok: true, result: truncate(serialized, 10000), logs: logs.slice(0, 100), logCount: logs.length });
  } catch (e: any) {
    brainPulse("prefrontal", "code_sandbox", `✗ Erreur: ${e.message?.slice(0, 80)}`, { userId, intensity: 2 });
    return JSON.stringify({ ok: false, error: e.message || String(e), logs: logs.slice(0, 50) });
  }
}

// ────────────────────────────────────────────────────────────────────
//  4ter. deerflow_deep_research — délègue une recherche profonde
//        au backend DeerFlow Hetzner et trace l'état dans le brain.
//        Le résultat final arrive de manière asynchrone via le webhook
//        /api/webhooks/deerflow (signé HMAC) qui pulse aussi le brain.
// ────────────────────────────────────────────────────────────────────

const DEERFLOW_API_BASE = process.env.DEERFLOW_API_BASE || "https://deerflow.ulyssepro.org";
const DEERFLOW_RESEARCH_TIMEOUT = 12000;

const pendingResearches = new Map<string, { query: string; userId: number; startedAt: number }>();

export function getPendingDeerflowResearches() {
  // Nettoie les vieilles entrées (>2h)
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, info] of pendingResearches) {
    if (info.startedAt < cutoff) pendingResearches.delete(id);
  }
  return Array.from(pendingResearches.entries()).map(([id, info]) => ({ research_id: id, ...info }));
}

/** Appelé par le webhook quand DeerFlow renvoie un résultat → retire de pending. */
export function markDeerflowResearchCompleted(researchId: string | null | undefined): boolean {
  if (!researchId) return false;
  return pendingResearches.delete(researchId);
}

export async function executeDeerflowDeepResearch(args: Record<string, any>, userId?: number): Promise<string> {
  if (userId !== OWNER_USER_ID) {
    return JSON.stringify({ error: "deerflow_deep_research réservé au owner Ulysse." });
  }
  const action = String(args.action || "start") as "start" | "list_pending" | "ping" | "get_result";
  brainPulse(["association", "prefrontal"], "deerflow_deep_research", action, { userId, intensity: 2 });

  if (action === "ping") {
    try {
      const r = await fetch(`${DEERFLOW_API_BASE}/`, { signal: AbortSignal.timeout(5000) });
      return JSON.stringify({ ok: true, deerflow_status: r.status, base: DEERFLOW_API_BASE });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message, base: DEERFLOW_API_BASE });
    }
  }

  if (action === "list_pending") {
    return JSON.stringify({ ok: true, pending: getPendingDeerflowResearches() });
  }

  if (action === "get_result") {
    const thread_id = String(args.thread_id || "");
    if (!thread_id) return JSON.stringify({ error: "thread_id requis pour get_result" });
    try {
      const r = await fetch(`${DEERFLOW_API_BASE}/api/threads/${encodeURIComponent(thread_id)}/state`, {
        signal: AbortSignal.timeout(10000),
        headers: process.env.MCP_BRIDGE_TOKEN ? { "Authorization": `Bearer ${process.env.MCP_BRIDGE_TOKEN}` } : {},
      });
      if (!r.ok) return JSON.stringify({ ok: false, status: r.status, error: await r.text().catch(()=>"") });
      const state: any = await r.json();
      const messages = state?.values?.messages || [];
      const lastAi = [...messages].reverse().find((m: any) => m.type === "ai" || m.role === "assistant");
      return JSON.stringify({
        ok: true,
        thread_id,
        message_count: messages.length,
        last_response: lastAi?.content || lastAi?.text || null,
        next: state?.next || [],
      });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message });
    }
  }

  // action === "start" — utilise l'API LangGraph thread+run (DeerFlow 2.0)
  const query = String(args.query || "").trim();
  if (!query) return JSON.stringify({ error: "query requise (string)" });

  brainPulse(["sensory", "concept"], "deerflow_deep_research", `🔍 Lance: "${query.slice(0, 80)}"`, { userId, intensity: 4 });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.MCP_BRIDGE_TOKEN) headers["Authorization"] = `Bearer ${process.env.MCP_BRIDGE_TOKEN}`;

  try {
    // 1) Créer un thread
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DEERFLOW_RESEARCH_TIMEOUT);
    const threadRes = await fetch(`${DEERFLOW_API_BASE}/api/threads`, {
      method: "POST", headers, signal: ctrl.signal,
      body: JSON.stringify({ metadata: { source: "ulysse_maxai", userId } }),
    }).finally(() => clearTimeout(t));

    if (!threadRes.ok) {
      const errBody = await threadRes.text().catch(() => "");
      brainPulse("prefrontal", "deerflow_deep_research", `✗ DeerFlow ${threadRes.status}`, { userId, intensity: 2 });
      return JSON.stringify({ ok: false, status: "thread_create_failed", deerflow_status: threadRes.status, detail: errBody.slice(0, 300), hint: "Vérifie que le backend Python DeerFlow tourne (PM2 deerflow-backend)." });
    }
    const thread: any = await threadRes.json();
    const thread_id = thread.thread_id || thread.id;

    // 2) Lancer une run async (non-bloquante) sur l'agent lead
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), DEERFLOW_RESEARCH_TIMEOUT);
    const runRes = await fetch(`${DEERFLOW_API_BASE}/api/threads/${thread_id}/runs`, {
      method: "POST", headers, signal: ctrl2.signal,
      body: JSON.stringify({
        assistant_id: "lead_agent",
        input: { messages: [{ role: "user", content: query }] },
        metadata: { source: "ulysse_maxai", userId },
      }),
    }).finally(() => clearTimeout(t2));

    if (!runRes.ok && runRes.status !== 202) {
      const errBody = await runRes.text().catch(() => "");
      return JSON.stringify({ ok: false, status: "run_create_failed", thread_id, deerflow_status: runRes.status, detail: errBody.slice(0, 300) });
    }
    const run: any = await runRes.json().catch(() => ({}));
    const run_id = run.run_id || run.id;

    pendingResearches.set(thread_id, { query, userId, startedAt: Date.now() });
    brainPulse("hippocampus", "deerflow_deep_research", `✓ Run lancée (thread=${thread_id?.slice(0,8)})`, { userId, intensity: 3 });

    return JSON.stringify({
      ok: true,
      status: "dispatched",
      thread_id,
      run_id,
      message: `Recherche lancée sur DeerFlow Hetzner. Récupère le résultat avec action=get_result + thread_id (peut prendre 1-3 min selon profondeur).`,
    });
  } catch (e: any) {
    brainPulse("prefrontal", "deerflow_deep_research", `✗ ${e.message?.slice(0, 60)}`, { userId, intensity: 2 });
    return JSON.stringify({
      ok: false,
      status: "network_error",
      error: e.message || String(e),
      hint: "DeerFlow injoignable. Utilise firecrawl_research en attendant.",
    });
  }
}

// ────────────────────────────────────────────────────────────────────
//  4bis. code_sandbox_python / code_sandbox_shell — exécution multi-langage
//        via child_process.spawn dans un cwd jetable, owner-only.
// ────────────────────────────────────────────────────────────────────

interface SpawnSandboxResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  error?: string;
}

async function runIsolatedProcess(
  cmd: string,
  cmdArgs: string[],
  opts: { stdin?: string; timeoutMs: number; allowNetwork: boolean },
): Promise<SpawnSandboxResult> {
  const start = Date.now();
  const cwd = mkdtempSync(join(tmpdir(), "ulysse-sandbox-"));
  // env minimal — pas de propagation de secrets
  const env: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: cwd,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TMPDIR: cwd,
  };
  if (!opts.allowNetwork) {
    // Hint au runtime, pas une vraie isolation réseau (nécessiterait netns)
    env.NO_PROXY = "*";
    env.http_proxy = "http://127.0.0.1:1"; // proxy invalide → bloque la plupart des libs respectueuses
    env.https_proxy = "http://127.0.0.1:1";
  }

  return new Promise<SpawnSandboxResult>((resolve) => {
    // detached:true → le child devient leader d'un nouveau process group (PGID = child.pid)
    // ce qui permet de killer TOUT le sous-arbre (grandchildren via &, subprocess.Popen, etc.)
    // avec `process.kill(-pgid, signal)`. Critique pour vraie containment du timeout.
    const child = spawn(cmd, cmdArgs, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;

    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch { try { child.kill(signal); } catch { /* dernier recours */ } }
    };

    const settle = (payload: SpawnSandboxResult) => {
      if (settled) return;
      settled = true;
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* noop */ }
      resolve(payload);
    };

    const killer = setTimeout(() => {
      killed = true;
      killGroup("SIGTERM");
      // Si le groupe ne meurt pas en 500ms, SIGKILL
      setTimeout(() => killGroup("SIGKILL"), 500);
      // Garde-fou ultime: si aucun event 'close' n'arrive, on settle quand même après 1.5s
      setTimeout(() => settle({
        ok: false,
        stdout: truncate(stdout, 30000),
        stderr: truncate(stderr, 10000),
        exitCode: null,
        signal: "SIGKILL",
        durationMs: Date.now() - start,
        error: `Timeout ${opts.timeoutMs}ms — process group tué (force settle)`,
      }), 1500);
    }, opts.timeoutMs);

    child.stdout.on("data", (b) => { stdout += b.toString(); if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(0, MAX_OUTPUT_CHARS) + "…[tronqué]"; });
    child.stderr.on("data", (b) => { stderr += b.toString(); if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(0, MAX_OUTPUT_CHARS) + "…[tronqué]"; });
    if (opts.stdin) child.stdin.end(opts.stdin); else child.stdin.end();

    child.on("error", (err) => {
      clearTimeout(killer);
      settle({ ok: false, stdout, stderr, exitCode: null, signal: null, durationMs: Date.now() - start, error: err.message });
    });

    child.on("close", (code, signal) => {
      clearTimeout(killer);
      settle({
        ok: code === 0 && !killed,
        stdout: truncate(stdout, 30000),
        stderr: truncate(stderr, 10000),
        exitCode: code,
        signal: signal || null,
        durationMs: Date.now() - start,
        error: killed ? `Timeout ${opts.timeoutMs}ms — process group tué` : undefined,
      });
    });
  });
}

export async function executeCodeSandboxPython(args: Record<string, any>, userId?: number): Promise<string> {
  if (userId !== OWNER_USER_ID) {
    return JSON.stringify({ error: "code_sandbox_python réservé au owner Ulysse." });
  }
  const code = String(args.code || "");
  if (!code) return JSON.stringify({ error: "code requis (string Python)" });
  const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 10000, 200), 60000);
  const allowNetwork = !!args.allowNetwork;
  brainPulse(["sensory", "concept"], "code_sandbox_python", `Exécute ${code.length} chars (timeout=${timeoutMs}ms, net=${allowNetwork})`, { userId, intensity: 3 });

  // Préfère le python du venv .pythonlibs s'il existe, sinon python3 du PATH
  const pythonBin = process.env.PYTHON_BIN || "/home/runner/workspace/.pythonlibs/bin/python3";
  const result = await runIsolatedProcess(pythonBin, ["-I", "-c", code], { timeoutMs, allowNetwork });
  // Fallback PATH si binaire absent
  if (result.error?.includes("ENOENT")) {
    const r2 = await runIsolatedProcess("python3", ["-I", "-c", code], { timeoutMs, allowNetwork });
    Object.assign(result, r2);
  }

  if (result.ok) brainPulse("hippocampus", "code_sandbox_python", `✓ Exécuté en ${result.durationMs}ms`, { userId, intensity: 2 });
  else brainPulse("prefrontal", "code_sandbox_python", `✗ ${result.error || "exit " + result.exitCode}`, { userId, intensity: 2 });
  return JSON.stringify(result);
}

const SHELL_FORBIDDEN = /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|:\(\)\s*\{|>\s*\/etc\/|>\s*\/root\/\.ssh|chmod\s+777\s+\/|shutdown|reboot|halt|init\s+[06])/;

export async function executeCodeSandboxShell(args: Record<string, any>, userId?: number): Promise<string> {
  if (userId !== OWNER_USER_ID) {
    return JSON.stringify({ error: "code_sandbox_shell réservé au owner Ulysse." });
  }
  const command = String(args.command || "");
  if (!command) return JSON.stringify({ error: "command requise (string bash)" });
  if (SHELL_FORBIDDEN.test(command)) {
    return JSON.stringify({ error: "Commande bloquée: motif destructeur détecté (rm -rf /, mkfs, fork-bomb, écriture /etc/, etc.)" });
  }
  const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 10000, 200), 60000);
  const allowNetwork = !!args.allowNetwork;
  brainPulse(["sensory", "motor"], "code_sandbox_shell", `$ ${command.slice(0, 80)}`, { userId, intensity: 3 });

  const result = await runIsolatedProcess("/bin/bash", ["-c", command], { timeoutMs, allowNetwork });
  if (result.ok) brainPulse("hippocampus", "code_sandbox_shell", `✓ exit 0 en ${result.durationMs}ms`, { userId, intensity: 2 });
  else brainPulse("prefrontal", "code_sandbox_shell", `✗ ${result.error || "exit " + result.exitCode}`, { userId, intensity: 2 });
  return JSON.stringify(result);
}

// ────────────────────────────────────────────────────────────────────
//  Lecture du plan Todo actif (pour UI panel temps-réel)
// ────────────────────────────────────────────────────────────────────

export function getTodoPlanForUser(userId: number): TodoPlan | null {
  return todoPlans.get(userId) || null;
}

// ────────────────────────────────────────────────────────────────────
//  5. mcp_devops_bridge — Statut + URL du bridge MCP exposé
// ────────────────────────────────────────────────────────────────────

import { mcpDevopsServer } from "../mcp/devopsMcpServer";

export async function executeMcpDevopsBridge(args: Record<string, any>, userId?: number): Promise<string> {
  const action = (args.action || "status") as "status" | "list_tools" | "test_call" | "url";
  brainPulse("association", "mcp_devops_bridge", action, { userId, intensity: 1 });

  try {
    if (action === "status" || action === "url") {
      return JSON.stringify({
        ok: true,
        bridge_url: "https://ulyssepro.org/api/mcp/devops",
        protocol: "JSON-RPC 2.0 over HTTP",
        methods: ["initialize", "tools/list", "tools/call"],
        usage_deerflow: "Ajoute dans config DeerFlow MCP: { 'devops_ulysse': { 'url': 'https://ulyssepro.org/api/mcp/devops' } }",
        tools_exposed: mcpDevopsServer.listTools().length,
      });
    }
    if (action === "list_tools") {
      return JSON.stringify({ ok: true, tools: mcpDevopsServer.listTools() });
    }
    if (action === "test_call") {
      const result = await mcpDevopsServer.callTool(args.tool || "devops_server", args.toolArgs || { action: "status" }, userId || 1);
      return JSON.stringify({ ok: true, result });
    }
    return JSON.stringify({ error: `Action inconnue: ${action}` });
  } catch (e: any) {
    return JSON.stringify({ error: e.message || String(e) });
  }
}

// ────────────────────────────────────────────────────────────────────
//  Définitions OpenAI pour ces outils
// ────────────────────────────────────────────────────────────────────

// === APP DIAGNOSE & AUTO-FIX (502 / port mismatch / nginx) ===
// Permet à MaxAI/Ulysse de diagnostiquer et auto-réparer une URL en panne sur Hetzner
// (curl→detect 502→pm2 list/restart→port check→ecosystem env→rebuild si besoin).
export async function executeAppDiagnoseFix(
  args: Record<string, any>,
  userId?: number,
): Promise<string> {
  try {
    const OWNER_USER_ID = 1;
    if (userId !== undefined && userId !== OWNER_USER_ID) {
      return JSON.stringify({ error: "Owner only" });
    }
    const { sshService } = await import("../ssh");
    const domain = String(args.domain || "").trim();
    const appName = String(args.app_name || args.appName || "").trim();
    if (!domain || !appName) {
      return JSON.stringify({ error: "domain et app_name requis (ex: 007ulysse.ulyssepro.org / 007ulysse)" });
    }
    const result = await (sshService as any).diagnoseAndFixUrl({
      domain,
      appName,
      autoFix: args.auto_fix !== false,
      caller: "max",
    });
    return JSON.stringify(result);
  } catch (e: any) {
    return JSON.stringify({ error: e?.message || String(e) });
  }
}

export const maxAdvancedToolDefs: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "firecrawl_research",
      description: "Recherche & scraping web profond. Actions: fetch_clean (URL → markdown propre via Jina), fetch_raw (URL → titre/texte/liens via cheerio), crawl_site (BFS sur N pages d'un site), search_and_fetch (query DDG → top N résultats lus en markdown). Bien plus profond que browse_web pour l'investigation technique (docs, vendor changelogs, StackOverflow).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["fetch_clean", "fetch_raw", "crawl_site", "search_and_fetch"] },
          url: { type: "string", description: "URL cible (fetch_clean, fetch_raw, crawl_site)" },
          query: { type: "string", description: "Requête de recherche (search_and_fetch)" },
          maxPages: { type: "number", description: "Pages max pour crawl_site (1-15, défaut 5)" },
          topN: { type: "number", description: "Nb de résultats à lire pour search_and_fetch (1-5, défaut 3)" },
          sameOriginOnly: { type: "boolean", description: "Limiter le crawl au même origin (défaut true)" },
          timeoutMs: { type: "number" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "subagent_parallel",
      description: "Exécute jusqu'à 8 tool calls en parallèle (Promise.all avec limite de concurrence). Idéal pour audits multi-facettes: lancer architecture_analyze + security_scan + db_inspect + url_diagnose_all simultanément au lieu de séquentiellement (gain ~4x). Chaque tâche = { tool: string, args: object, label?: string }.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", description: "Nom de l'outil à invoquer" },
                args: { type: "object", description: "Arguments pour cet outil" },
                label: { type: "string", description: "Label humain pour ce sous-agent" },
              },
              required: ["tool"],
            },
          },
          concurrency: { type: "number", description: "Concurrence max (1-6, défaut = nb tâches)" },
        },
        required: ["tasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "todo_planner",
      description: "Plan d'action multi-étapes persistant pour le user actuel. Force la décomposition d'une tâche complexe en checklist visible et trackable. Actions: plan (créer avec objective + steps[]), start (démarrer étape stepId), complete (terminer étape), fail (marquer échec), skip (sauter), get_status (afficher), clear (effacer), update_notes.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["plan", "start", "complete", "fail", "skip", "get_status", "clear", "update_notes"] },
          objective: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          stepId: { type: "number" },
          notes: { type: "string" },
          result: { type: "string" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_sandbox",
      description: "Exécute du JavaScript dans une sandbox node:vm isolée (timeout configurable, pas de require/process/fs par défaut). Idéal pour tester un patch/algo/parser AVANT de l'appliquer en prod. Le code est wrappé en async; utilise return X pour renvoyer une valeur. Variable __input disponible si fournie.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code JS à exécuter (wrappé automatiquement en async IIFE)" },
          input: { description: "Donnée d'entrée accessible via la variable __input dans le code" },
          timeoutMs: { type: "number", description: "Timeout d'exécution (100-30000, défaut 5000)" },
          allowNetwork: { type: "boolean", description: "Autoriser fetch/URL/URLSearchParams (défaut false)" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deerflow_deep_research",
      description: "Délègue une recherche profonde à DeerFlow 2.0 sur Hetzner (LangGraph + lead_agent, https://deerflow.ulyssepro.org). Async: start crée un thread+run (non bloquant), get_result récupère l'état du thread après ~1-3 min. Pulse le brain à chaque étape. Actions: start (lance), get_result (récupère par thread_id), list_pending (en cours), ping (santé backend).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "list_pending", "ping", "get_result"] },
          query: { type: "string", description: "Sujet/question (action=start)" },
          thread_id: { type: "string", description: "Thread DeerFlow à interroger (action=get_result)" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_sandbox_python",
      description: "Exécute du Python 3 dans un cwd jetable (mkdtemp), env minimal, timeout configurable. Réservé au owner Ulysse. Utilise -I (isolated mode). Idéal pour calculs scientifiques, parsing pandas, prototypage d'algos. Retourne stdout/stderr/exitCode/durationMs.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code Python à exécuter" },
          timeoutMs: { type: "number", description: "Timeout (200-60000, défaut 10000)" },
          allowNetwork: { type: "boolean", description: "Lever le proxy invalide (défaut false)" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_sandbox_shell",
      description: "Exécute une commande bash dans un cwd jetable. Owner-only. Filtre les motifs destructeurs (rm -rf /, mkfs, fork-bomb, etc.). Idéal pour tests rapides (curl, jq, ls, awk). NE PAS utiliser pour du code persistant — utiliser les outils DevOps dédiés.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Commande bash à exécuter" },
          timeoutMs: { type: "number", description: "Timeout (200-60000, défaut 10000)" },
          allowNetwork: { type: "boolean", description: "Lever le proxy invalide (défaut false)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mcp_devops_bridge",
      description: "Bridge MCP (Model Context Protocol) qui expose devops_server à des clients externes (DeerFlow Ulysse, Claude Desktop, autres agents). URL: https://ulyssepro.org/api/mcp/devops. Actions: status (URL + métadonnées), list_tools (outils MCP exposés), test_call (test interne d'un appel MCP).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["status", "list_tools", "test_call", "url"] },
          tool: { type: "string", description: "Nom du tool MCP pour test_call" },
          toolArgs: { type: "object", description: "Arguments pour test_call" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "app_diagnose_fix",
      description: "Diagnostique et auto-répare une URL Hetzner en panne (502, port mismatch, PM2 down, nginx manquant). Curl le domaine, lit pm2 list, vérifie le port écouté vs nginx upstream, restart pm2 et rebuild si nécessaire. Owner only. Utiliser quand une app du portfolio Ulysse (007ulysse, deerflow, etc.) ne répond plus.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Domaine complet (ex: 007ulysse.ulyssepro.org)" },
          app_name: { type: "string", description: "Nom de l'app PM2 (ex: 007ulysse)" },
          auto_fix: { type: "boolean", description: "Appliquer les fix automatiquement (default true)" },
        },
        required: ["domain", "app_name"],
      },
    },
  },
];
