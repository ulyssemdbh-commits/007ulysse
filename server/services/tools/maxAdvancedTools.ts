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
];
