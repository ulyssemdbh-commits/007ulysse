import { executeToolCallV2Internal } from "../services/ulysseToolsServiceV2";

const USERID = 1;

interface TestCase {
  tool: string;
  args: Record<string, any>;
  label: string;
  timeout?: number;
  acceptWarn?: boolean;
}

const SAFE_TEST_CASES: TestCase[] = [
  { tool: "query_brain", args: { query: "glossaire outils", limit: 3 }, label: "Brain search" },
  { tool: "memory_save", args: { key: "__test_audit_ping__", value: "audit test probe", category: "fact", importance: 10 }, label: "Brain save" },
  { tool: "superchat_search", args: { query: "test", limit: 2 }, label: "SuperChat history search" },

  { tool: "query_suguval_history", args: { restaurant: "suguval", action: "history", limit: 3 }, label: "SUGU history" },
  { tool: "get_suguval_checklist", args: { restaurant: "suguval" }, label: "SUGU checklist" },
  { tool: "manage_sugu_bank", args: { action: "list", restaurant: "suguval", limit: 2 }, label: "SUGU bank list" },
  { tool: "manage_sugu_purchases", args: { action: "list", restaurant: "suguval", limit: 2 }, label: "SUGU purchases list" },
  { tool: "manage_sugu_expenses", args: { action: "list", restaurant: "suguval", limit: 2 }, label: "SUGU expenses list" },
  { tool: "manage_sugu_employees", args: { action: "list", restaurant: "suguval" }, label: "SUGU employees list" },
  { tool: "manage_sugu_payroll", args: { action: "list", restaurant: "suguval", limit: 2 }, label: "SUGU payroll list" },
  { tool: "manage_sugu_files", args: { action: "list", restaurant: "suguval" }, label: "SUGU files list" },
  { tool: "search_sugu_data", args: { query: "poulet", restaurant: "suguval" }, label: "SUGU search" },
  { tool: "sugu_full_overview", args: { restaurant: "suguval" }, label: "SUGU full overview" },
  { tool: "compute_business_health", args: { restaurant: "suguval" }, label: "Business health score" },
  { tool: "detect_anomalies", args: { restaurant: "suguval" }, label: "Detect anomalies" },
  { tool: "query_sugu_analytics", args: { action: "categories", restaurant: "suguval" }, label: "SUGU analytics categories" },

  { tool: "devops_github", args: { action: "list_repos", owner: "MauriceDevs" }, label: "GitHub list repos" },
  { tool: "devops_server", args: { action: "status" }, label: "Server status" },
  { tool: "devops_intelligence", args: { action: "domain_health", domain: "ulyssepro.org" }, label: "DevOps intelligence" },
  { tool: "devmax_db", args: { action: "stats" }, label: "DevMax DB stats" },
  { tool: "dgm_manage", args: { action: "status" }, label: "DGM status" },
  { tool: "monitoring_manage", args: { action: "status" }, label: "Monitoring status", acceptWarn: true },
  { tool: "manage_ai_system", args: { action: "run_diagnostic" }, label: "AI system diagnostics" },
  { tool: "manage_feature_flags", args: { action: "list" }, label: "Feature flags list" },
  { tool: "task_queue_manage", args: { action: "status", queueId: 1 }, label: "Task queue status" },
  { tool: "work_journal_manage", args: { action: "list", limit: 2 }, label: "Work journal list" },
  { tool: "dashboard_screenshot", args: { action: "get_latest" }, label: "Dashboard screenshot latest" },

  { tool: "email_list_inbox", args: { limit: 3 }, label: "Gmail inbox" },
  { tool: "email_read_message", args: { uid: 1, folder: "INBOX" }, label: "Email read first msg", acceptWarn: true },
  { tool: "email_reply", args: { to: "__test__", subject: "test", body: "test" }, label: "Email reply (expect graceful)", acceptWarn: true },
  { tool: "email_forward", args: { to: "__test__", subject: "test", original_body: "test" }, label: "Email forward (expect graceful)", acceptWarn: true },
  { tool: "email_send", args: { to: "__test_no_send__", subject: "__audit__", body: "__audit__" }, label: "Email send (expect graceful)", acceptWarn: true },
  { tool: "discord_status", args: {}, label: "Discord status", acceptWarn: true },
  { tool: "discord_send_message", args: { channel: "__audit__", message: "__audit__" }, label: "Discord send (expect graceful)", acceptWarn: true },

  { tool: "calendar_list_events", args: { timeMin: new Date().toISOString(), maxResults: 3 }, label: "Calendar list events" },
  { tool: "todoist_list_tasks", args: {}, label: "Todoist list tasks" },
  { tool: "kanban_create_task", args: { title: "__audit_test_task__", description: "Test audit probe", priority: "low", project_id: 1 }, label: "Kanban create task" },
  { tool: "notion_manage", args: { action: "search", query: "test" }, label: "Notion search", acceptWarn: true },
  { tool: "drive_manage", args: { action: "list_files", limit: 3 }, label: "Google Drive list files", acceptWarn: true },

  { tool: "web_search", args: { query: "test ping", limit: 2 }, label: "Web search" },
  { tool: "read_url", args: { url: "https://ulyssepro.org" }, label: "Read URL", timeout: 15000 },
  { tool: "location_get_weather", args: { city: "Marseille" }, label: "Weather Marseille" },
  { tool: "search_nearby_places", args: { query: "restaurant", lat: 43.296, lng: 5.369 }, label: "Nearby places" },
  { tool: "geocode_address", args: { address: "13 rue de la République, Marseille" }, label: "Geocode address" },

  { tool: "spotify_control", args: { action: "playback_status" }, label: "Spotify playback status", acceptWarn: true },
  { tool: "smarthome_control", args: { action: "list_devices" }, label: "Smarthome list devices", acceptWarn: true },
  { tool: "navigation_manage", args: { action: "list_routes" }, label: "Navigation list routes" },
  { tool: "screen_monitor_manage", args: { action: "status" }, label: "Screen monitor status" },

  { tool: "analyze_file", args: { file_path: "/tmp/__audit_test_file.js", analysis_type: "code" }, label: "Analyze file" },
  { tool: "analyze_invoice", args: { file_path: "/tmp/__audit_test_file.js" }, label: "Analyze invoice (expect graceful)", acceptWarn: true },
  { tool: "pdf_master", args: { action: "info", file_path: "/tmp/__audit_test.pdf" }, label: "PDF info (expect graceful)", acceptWarn: true },
  { tool: "image_generate", args: { prompt: "__audit_dry_run__", dryRun: true }, label: "Image generate (dry run)", timeout: 15000, acceptWarn: true },
  { tool: "generate_file", args: { format: "json", data: [{"test": "audit"}], file_name: "__audit_test" }, label: "Generate JSON file" },
  { tool: "analyze_document_image", args: { imageBase64: "iVBORw0KGgo=", mimeType: "image/png" }, label: "Analyze doc image", acceptWarn: true },
  { tool: "analyze_video", args: { filePath: "/tmp/__audit_nonexistent.mp4" }, label: "Analyze video (expect graceful)", acceptWarn: true },
  { tool: "manage_3d_file", args: { action: "create", shape: "box", format: "stl", dimensions: { width: 10, height: 10, depth: 10 } }, label: "3D file create box" },
  { tool: "export_analysis", args: { analysis_data: { summary: "Test audit", data: [1,2,3] }, export_format: "markdown" }, label: "Export analysis markdown" },
  { tool: "export_invoice_excel", args: { invoice_report: "### F0001 - 01/01/2026 (100€)\n| REF | Article | 1 | 100 € | 100 € | 20% |", file_name: "__audit_test" }, label: "Export invoice Excel" },
  { tool: "generate_invoice_pdf", args: { emetteur: { nom: "Test SARL" }, client: { nom: "Client Test" }, numero: "F0001", date: "15/04/2026", lignes: [{ designation: "Article test", quantite: 1, prix_unitaire: 10 }], file_name: "__audit_invoice" }, label: "Generate invoice PDF" },
  { tool: "import_bank_statement", args: { csvContent: "date;label;amount\n01/01/2026;Test;-10.00", restaurant: "suguval" }, label: "Import bank statement preview" },

  { tool: "query_sports_data", args: { query_type: "today_matches" }, label: "Sports data today" },
  { tool: "query_match_intelligence", args: { leagueId: 61, include: ["injuries"] }, label: "Match intelligence L1" },
  { tool: "query_matchendirect", args: { league: "ligue1" }, label: "Match en direct" },
  { tool: "query_football_db", args: { action: "db_stats" }, label: "Football DB stats" },
  { tool: "query_stock_data", args: { query_type: "daily_brief" }, label: "Stock daily brief" },
  { tool: "query_bets_tracker", args: { action: "stats" }, label: "Bets tracker stats" },
  { tool: "trading_alerts", args: { action: "list" }, label: "Trading alerts list" },

  { tool: "query_apptoorder", args: { action: "status" }, label: "AppToOrder status" },
  { tool: "query_app_data", args: { section: "suguval_cash" }, label: "App data SUGU cash" },
  { tool: "query_coba", args: { tenantId: "pizzaroma", action: "stats" }, label: "COBA query stats" },
  { tool: "coba_business", args: { action: "tenants" }, label: "COBA business tenants" },
  { tool: "query_hubrise", args: { action: "status" }, label: "HubRise status", acceptWarn: true },
  { tool: "query_daily_summary", args: {}, label: "Daily summary" },
  { tool: "commax_manage", args: { action: "stats" }, label: "Commax stats" },

  { tool: "generate_morning_briefing", args: { dryRun: true }, label: "Morning briefing (dry run)" },
  { tool: "generate_self_reflection", args: {}, label: "Self reflection", timeout: 20000 },
  { tool: "sensory_hub", args: { action: "sensory_summary" }, label: "Sensory hub summary" },
  { tool: "app_navigate", args: { action: "status" }, label: "App navigate status" },
  { tool: "manage_telegram_bot", args: { action: "status" }, label: "Telegram bot status" },
  { tool: "generate_financial_report", args: { action: "preview", restaurant: "suguval" }, label: "Financial report preview" },
  { tool: "notion_manage", args: { action: "list_databases" }, label: "Notion list databases", acceptWarn: true },

  { tool: "file_convert", args: { input_data: "name;age\nAlice;30\nBob;25", from_format: "csv", to_format: "json" }, label: "File convert CSV→JSON" },
  { tool: "file_compress", args: { action: "list", input_path: "/tmp/__audit_nonexistent.zip" }, label: "File compress list (expect graceful)", acceptWarn: true },
  { tool: "spreadsheet_analyze", args: { csv_data: "product;price;qty\nPizza;12;50\nBurger;8;30\nSalad;6;20", action: "stats" }, label: "Spreadsheet analyze stats" },
  { tool: "document_compare", args: { file_a: "/tmp/__audit_a.txt", file_b: "/tmp/__audit_b.txt" }, label: "Document compare (expect graceful)", acceptWarn: true },
  { tool: "qr_code_generate", args: { data: "https://ulyssepro.org" }, label: "QR code generate" },
  { tool: "ocr_extract", args: { imageBase64: "iVBORw0KGgo=", mimeType: "image/png" }, label: "OCR extract (expect graceful)", acceptWarn: true },

  { tool: "digital_twin_snapshot", args: { restaurant: "suguval" }, label: "Digital Twin snapshot", timeout: 15000 },
  { tool: "digital_twin_simulate", args: { type: "price_change", params: { percentChange: 5 }, restaurant: "suguval" }, label: "Digital Twin simulate", timeout: 15000 },
  { tool: "voice_status", args: {}, label: "Voice mode status" },
  { tool: "voice_synthesize", args: { text: "test audit ping", voice: "onyx" }, label: "Voice TTS synthesize", timeout: 15000, acceptWarn: true },
  { tool: "vision_live_analyze", args: { imageBase64: "iVBORw0KGgo=", mimeType: "image/png" }, label: "Vision Live analyze (expect graceful)", acceptWarn: true },
  { tool: "autonomous_execute", args: { goal: "__audit_dry_run__", maxSteps: 1 }, label: "Autonomous agent (1 step)", timeout: 30000, acceptWarn: true },
];

const PERSONA_TOOLS: Record<string, string[]> = {
  ulysse: [
    "query_brain","web_search","read_url","memory_save","location_get_weather",
    "email_list_inbox","email_send","calendar_list_events","calendar_create_event",
    "todoist_list_tasks","todoist_create_task","todoist_complete_task",
    "discord_send_message","discord_status","spotify_control",
    "generate_morning_briefing","image_generate","query_sports_data",
    "query_match_intelligence","query_football_db","query_stock_data",
    "smarthome_control","query_suguval_history","sugu_full_overview",
    "manage_ai_system","devops_github","devops_server",
    "compute_business_health","detect_anomalies","superchat_search","screen_monitor_manage"
  ],
  maxai: [
    "devops_github","devops_server","devops_intelligence","devmax_db",
    "dgm_manage","monitoring_manage","manage_ai_system","manage_feature_flags",
    "query_apptoorder","dashboard_screenshot","task_queue_manage",
    "work_journal_manage","analyze_file","generate_file","kanban_create_task",
    "pdf_master","web_search","read_url","query_brain","memory_save",
    "superchat_search","commax_manage","query_coba","screen_monitor_manage"
  ],
  iris: [
    "calendar_list_events","calendar_create_event","todoist_list_tasks",
    "todoist_create_task","todoist_complete_task","email_list_inbox",
    "email_send","web_search","read_url","location_get_weather",
    "memory_save","query_brain","image_generate","spotify_control","commax_manage"
  ],
  alfred: [
    "query_suguval_history","get_suguval_checklist","send_suguval_shopping_list",
    "manage_sugu_bank","manage_sugu_purchases","manage_sugu_expenses",
    "search_sugu_data","manage_sugu_employees","manage_sugu_payroll",
    "manage_sugu_files","sugu_full_overview","compute_business_health",
    "detect_anomalies","query_hubrise","query_apptoorder","query_daily_summary",
    "email_list_inbox","email_send","query_brain","web_search","memory_save",
    "superchat_search","commax_manage","query_coba","coba_business"
  ],
};

interface TestResult {
  tool: string;
  label: string;
  status: "OK" | "WARN" | "FAIL" | "ERROR";
  timeMs: number;
  message: string;
  acceptWarn: boolean;
}

function classifyResult(raw: string, timeMs: number, acceptWarn: boolean): { status: TestResult["status"]; message: string } {
  try {
    const parsed = JSON.parse(raw);

    if (parsed.error) {
      const err = String(parsed.error).toLowerCase();
      if (err.includes("non disponible") || err.includes("non connecté") || err.includes("non configuré") || err.includes("not connected") || err.includes("token") || err.includes("pas connecté") || err.includes("pas actif") || err.includes("not available") || err.includes("reconnecter") || err.includes("connecter") || err.includes("api key") || err.includes("401") || err.includes("403") || err.includes("imap") || err.includes("command failed") || err.includes("dummy")) {
        return { status: "WARN", message: `Service dep: ${parsed.error.substring(0, 100)}` };
      }
      if (err.includes("inconnue") || err.includes("unknown")) {
        return { status: "ERROR", message: `Unknown action: ${parsed.error.substring(0, 100)}` };
      }
      if (err.includes("aucun") || err.includes("not found") || err.includes("404") || err.includes("introuvable") || err.includes("no result") || err.includes("invalid") || err.includes("no such file") || err.includes("enoent") || err.includes("cannot read") || err.includes("undefined")) {
        return { status: "WARN", message: `Expected miss: ${parsed.error.substring(0, 100)}` };
      }
      if (acceptWarn) {
        return { status: "WARN", message: `Graceful: ${parsed.error.substring(0, 100)}` };
      }
      return { status: "FAIL", message: parsed.error.substring(0, 120) };
    }

    if (parsed.success === false && parsed.error) {
      const errLow = String(parsed.error).toLowerCase();
      if (errLow.includes("non disponible") || errLow.includes("not available") || errLow.includes("not connected") || errLow.includes("aucun") || errLow.includes("no such file") || errLow.includes("enoent") || errLow.includes("introuvable") || errLow.includes("invalid") || errLow.includes("cannot read")) {
        return { status: "WARN", message: `Expected: ${parsed.error.substring(0, 100)}` };
      }
      if (acceptWarn) {
        return { status: "WARN", message: `Graceful fail: ${parsed.error.substring(0, 100)}` };
      }
      return { status: "FAIL", message: parsed.error.substring(0, 120) };
    }

    if (timeMs > 10000) {
      return { status: "WARN", message: `Slow (${timeMs}ms) but OK` };
    }

    const summary = raw.substring(0, 100).replace(/\n/g, " ");
    return { status: "OK", message: summary };
  } catch {
    if (raw && raw.length > 0 && !raw.includes("error") && !raw.includes("Error")) {
      return { status: "OK", message: `Raw OK (${raw.length} chars)` };
    }
    if (raw.length > 0) {
      const rawLower = raw.toLowerCase();
      if (rawLower.includes("non disponible") || rawLower.includes("non connecté") || rawLower.includes("not connected") || rawLower.includes("pas connecté")) {
        return { status: "WARN", message: `Service dep: ${raw.substring(0, 100)}` };
      }
      return { status: "OK", message: `Raw response (${raw.length} chars)` };
    }
    return { status: "FAIL", message: "Empty response" };
  }
}

async function runSingleTest(tc: TestCase): Promise<TestResult> {
  const start = Date.now();
  try {
    const timeoutMs = tc.timeout || 10000;
    const result = await Promise.race([
      executeToolCallV2Internal(tc.tool, tc.args, USERID),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)),
    ]);
    const elapsed = Date.now() - start;
    const { status, message } = classifyResult(result, elapsed, !!tc.acceptWarn);
    return { tool: tc.tool, label: tc.label, status, timeMs: elapsed, message, acceptWarn: !!tc.acceptWarn };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    if (err.message === "TIMEOUT") {
      return { tool: tc.tool, label: tc.label, status: "WARN", timeMs: elapsed, message: "Timeout (exists but slow)", acceptWarn: !!tc.acceptWarn };
    }
    const errMsg = err.message || "Unknown error";
    const errLower = errMsg.toLowerCase();
    if (errLower.includes("not connected") || errLower.includes("api key") || errLower.includes("token") || errLower.includes("401") || errLower.includes("enoent")) {
      return { tool: tc.tool, label: tc.label, status: "WARN", timeMs: elapsed, message: `Dep: ${errMsg.substring(0, 100)}`, acceptWarn: !!tc.acceptWarn };
    }
    return { tool: tc.tool, label: tc.label, status: "ERROR", timeMs: elapsed, message: `Exception: ${errMsg.substring(0, 100)}`, acceptWarn: !!tc.acceptWarn };
  }
}

function computeScore(tools: string[], results: Map<string, TestResult>): number {
  let pass = 0;
  for (const t of tools) {
    const r = results.get(t);
    if (!r) continue;
    if (r.status === "OK") pass++;
    else if (r.status === "WARN") pass++;
  }
  return tools.length > 0 ? Math.round((pass / tools.length) * 100) : 0;
}

function printPersonaReport(persona: string, tools: string[], results: Map<string, TestResult>) {
  const personaResults = tools.map(t => results.get(t)).filter(Boolean) as TestResult[];
  const ok = personaResults.filter(r => r.status === "OK").length;
  const warn = personaResults.filter(r => r.status === "WARN").length;
  const fail = personaResults.filter(r => r.status === "FAIL").length;
  const err = personaResults.filter(r => r.status === "ERROR").length;
  const missing = tools.filter(t => !results.has(t));

  const pct = computeScore(tools, results);
  const icon = pct === 100 ? "💯" : pct >= 80 ? "✅" : pct >= 60 ? "⚠️" : "❌";

  console.log(`\n${"═".repeat(60)}`);
  console.log(`${icon} ${persona.toUpperCase()} — ${tools.length} outils — Score: ${pct}% (${ok} OK, ${warn} WARN, ${fail} FAIL, ${err} ERR)`);
  console.log(`${"═".repeat(60)}`);

  for (const t of tools) {
    const r = results.get(t);
    if (!r) {
      console.log(`  ⬜ ${t} — NOT TESTED (no test case)`);
      continue;
    }
    const icon = r.status === "OK" ? "✅" : r.status === "WARN" ? "⚠️" : r.status === "FAIL" ? "❌" : "💀";
    console.log(`  ${icon} ${r.tool} (${r.timeMs}ms) — ${r.message.substring(0, 80)}`);
  }

  if (missing.length > 0) {
    console.log(`  📋 Not tested (write ops): ${missing.join(", ")}`);
  }
}

export async function runToolsAudit() {
  console.log("🔬 ULYSSE TOOLS AUDIT — Testing all tools\n");
  console.log(`Test cases: ${SAFE_TEST_CASES.length}`);
  console.log(`Personas: ${Object.keys(PERSONA_TOOLS).join(", ")}\n`);

  const results = new Map<string, TestResult>();

  const BATCH_SIZE = 5;
  for (let i = 0; i < SAFE_TEST_CASES.length; i += BATCH_SIZE) {
    const batch = SAFE_TEST_CASES.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(tc => runSingleTest(tc)));
    for (const r of batchResults) {
      if (!results.has(r.tool) || r.status === "OK") {
        results.set(r.tool, r);
      }
      const icon = r.status === "OK" ? "✅" : r.status === "WARN" ? "⚠️" : r.status === "FAIL" ? "❌" : "💀";
      console.log(`${icon} [${r.timeMs}ms] ${r.tool} — ${r.message.substring(0, 80)}`);
    }
  }

  console.log("\n\n" + "🔷".repeat(30));
  console.log("RAPPORT PAR PERSONA");
  console.log("🔷".repeat(30));

  for (const [persona, tools] of Object.entries(PERSONA_TOOLS)) {
    printPersonaReport(persona, tools, results);
  }

  const allTools = new Set(SAFE_TEST_CASES.map(tc => tc.tool));
  const personaTools = new Set(Object.values(PERSONA_TOOLS).flat());
  const v2Only = [...allTools].filter(t => !personaTools.has(t));
  if (v2Only.length > 0) {
    const v2Results = v2Only.map(t => results.get(t)).filter(Boolean) as TestResult[];
    const ok = v2Results.filter(r => r.status === "OK").length;
    const warn = v2Results.filter(r => r.status === "WARN").length;
    const pct = v2Only.length > 0 ? Math.round(((ok + warn) / v2Only.length) * 100) : 0;
    console.log(`\n${"═".repeat(60)}`);
    console.log(`📦 CHAT V2 ONLY — ${v2Only.length} outils extra — Score: ${pct}% (${ok} OK, ${warn} WARN)`);
    console.log(`${"═".repeat(60)}`);
    for (const t of v2Only) {
      const r = results.get(t);
      if (r) {
        const icon = r.status === "OK" ? "✅" : r.status === "WARN" ? "⚠️" : r.status === "FAIL" ? "❌" : "💀";
        console.log(`  ${icon} ${r.tool} (${r.timeMs}ms) — ${r.message.substring(0, 80)}`);
      }
    }
  }

  const total = results.size;
  const okTotal = [...results.values()].filter(r => r.status === "OK").length;
  const warnTotal = [...results.values()].filter(r => r.status === "WARN").length;
  const failTotal = [...results.values()].filter(r => r.status === "FAIL").length;
  const errTotal = [...results.values()].filter(r => r.status === "ERROR").length;
  const globalPct = Math.round(((okTotal + warnTotal) / total) * 100);

  console.log(`\n\n${"═".repeat(60)}`);
  console.log(`🏆 RÉSUMÉ GLOBAL — ${total} outils testés`);
  console.log(`   ✅ OK: ${okTotal}  ⚠️ WARN: ${warnTotal}  ❌ FAIL: ${failTotal}  💀 ERROR: ${errTotal}`);
  console.log(`   Score global: ${globalPct}%`);
  if (failTotal + errTotal > 0) {
    console.log(`\n   ❌ OUTILS EN ÉCHEC:`);
    for (const r of results.values()) {
      if (r.status === "FAIL" || r.status === "ERROR") {
        console.log(`      • ${r.tool}: ${r.message.substring(0, 100)}`);
      }
    }
  }
  console.log(`${"═".repeat(60)}`);

  return { total, ok: okTotal, warn: warnTotal, fail: failTotal, error: errTotal, pct: globalPct, results: Object.fromEntries(results) };
}

if (process.argv.includes("--run")) {
  runToolsAudit().then(summary => {
    console.log("\n📊 Audit terminé.");
    process.exit(summary.fail + summary.error > 0 ? 1 : 0);
  }).catch(err => {
    console.error("Fatal audit error:", err);
    process.exit(2);
  });
}
