/**
 * ACTION HUB BRIDGE - Harmonisation des systèmes d'exécution
 * 
 * Connecte ActionHub (centre sensoriel) avec ulysseToolsServiceV2 (77+ tools)
 * pour une architecture cohérente où TOUTES les actions passent par ActionHub.
 * 
 * Flow unifié:
 * [User Message] → [ActionIntentDetector] → [OpenAI] → [Tool Call] → [ActionHub] → [ulysseToolsServiceV2] → [Result]
 */

import { actionHub, ActionCategory, ActionMetadata } from "./ActionHub";
import { ulysseToolsV2 } from "../ulysseToolsServiceV2";

// Tool category map - aligned with actual tool names from ulysseToolsV2
const TOOL_CATEGORY_MAP: Record<string, ActionCategory> = {
  // Data & History
  query_suguval_history: "tool_call",
  get_suguval_checklist: "tool_call",
  send_suguval_shopping_list: "email",
  query_sports_data: "tool_call",
  query_match_intelligence: "tool_call",
  query_matchendirect: "tool_call",
  query_football_db: "tool_call",
  query_brain: "memory",
  query_stock_data: "tool_call",
  // Calendar
  calendar_list_events: "calendar",
  calendar_create_event: "calendar",
  // Email
  email_list_inbox: "email",
  email_read_message: "email",
  email_reply: "email",
  email_forward: "email",
  email_send: "email",
  // Smart Home
  smarthome_control: "domotique",
  // Location & Weather
  location_get_weather: "tool_call",
  search_nearby_places: "tool_call",
  geocode_address: "tool_call",
  // Web
  web_search: "web",
  read_url: "web",
  // Spotify
  spotify_control: "spotify",
  // Discord
  discord_send_message: "notification",
  discord_status: "tool_call",
  discord_add_reaction: "notification",
  discord_remove_reaction: "notification",
  discord_delete_message: "notification",
  discord_send_file: "notification",
  discord_create_invitation: "notification",
  discord_voice_status: "tool_call",
  // Memory
  memory_save: "memory",
  // Image & Media
  image_generate: "tool_call",
  analyze_video: "file",
  // Todoist
  todoist_create_task: "tool_call",
  todoist_list_tasks: "tool_call",
  todoist_complete_task: "tool_call",
  homework_manage: "tool_call",
  notes_manage: "tool_call",
  projects_manage: "tool_call",
  tasks_manage: "tool_call",
  conversations_manage: "tool_call",
  traces_query: "tool_call",
  security_audit: "tool_call",
  superchat_manage: "tool_call",
  // Kanban & Task Queue
  kanban_create_task: "tool_call",
  task_queue_manage: "tool_call",
  work_journal_manage: "tool_call",
  devops_intelligence: "tool_call",
  dgm_manage: "tool_call",
  // Files & Analysis
  analyze_file: "file",
  analyze_invoice: "file",
  analyze_document_image: "file",
  import_bank_statement: "file",
  generate_file: "file",
  export_analysis: "file",
  export_invoice_excel: "file",
  // Reports & Briefings
  generate_morning_briefing: "tool_call",
  generate_financial_report: "tool_call",
  generate_self_reflection: "tool_call",
  // Integrations
  notion_manage: "tool_call",
  drive_manage: "file",
  trading_alerts: "tool_call",
  navigation_manage: "tool_call",
  monitoring_manage: "tool_call",
  manage_telegram_bot: "notification",
  // SUGU Business
  manage_sugu_bank: "tool_call",
  manage_sugu_purchases: "tool_call",
  manage_sugu_expenses: "tool_call",
  manage_sugu_files: "file",
  manage_sugu_employees: "tool_call",
  manage_sugu_payroll: "tool_call",
  search_sugu_data: "tool_call",
  sugu_full_overview: "tool_call",
  // Business Intelligence
  compute_business_health: "tool_call",
  detect_anomalies: "tool_call",
  query_hubrise: "tool_call",
  manage_feature_flags: "tool_call",
  // Analytics
  query_bets_tracker: "tool_call",
  query_sugu_analytics: "tool_call",
  query_daily_summary: "tool_call",
  // App & System
  app_navigate: "tool_call",
  query_app_data: "tool_call",
  query_apptoorder: "tool_call",
  sensory_hub: "tool_call",
  manage_ai_system: "tool_call",
  // DevOps
  devops_github: "tool_call",
  devops_server: "tool_call",
  devmax_db: "tool_call",
  dashboard_screenshot: "tool_call",
  // PDF & 3D
  manage_3d_file: "file",
  generate_invoice_pdf: "file",
  pdf_master: "file",
  // COBA
  query_coba: "tool_call",
  coba_business: "tool_call",
  // SuperChat
  superchat_search: "tool_call",
  // Commax
  commax_manage: "tool_call",
  // Screen Monitor
  screen_monitor_manage: "tool_call",
};

let bridgeInitialized = false;

export function initializeActionHubBridge(): void {
  if (bridgeInitialized) {
    console.log("[ActionHubBridge] Déjà initialisé");
    return;
  }

  console.log("[ActionHubBridge] Initialisation du bridge...");
  
  const toolNames = ulysseToolsV2.map(t => t.function.name);
  let registered = 0;

  for (const toolName of toolNames) {
    const category = TOOL_CATEGORY_MAP[toolName] || "tool_call";
    
    actionHub.registerExecutor(toolName, async (params, metadata) => {
      const { executeToolCallV2Internal } = await import("../ulysseToolsServiceV2");
      
      try {
        const result = await executeToolCallV2Internal(toolName, params, metadata.userId);
        
        // Safely parse result - handle both JSON and plain text responses
        let parsedResult: any;
        if (typeof result === "string") {
          try {
            parsedResult = JSON.parse(result);
          } catch {
            // Tool returned plain text, wrap it
            parsedResult = { response: result };
          }
        } else {
          parsedResult = result;
        }
        
        return {
          success: true,
          result: parsedResult,
          canRollback: false
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message
        };
      }
    });
    
    registered++;
  }

  console.log(`[ActionHubBridge] ✅ ${registered} executors enregistrés dans ActionHub`);
  bridgeInitialized = true;
}

export async function executeViaActionHub(
  toolName: string,
  args: Record<string, any>,
  userId: number,
  source: "voice" | "chat" | "api" | "scheduled" | "autonomous" = "chat",
  conversationId?: number
): Promise<string> {
  const category = TOOL_CATEGORY_MAP[toolName] || "tool_call";
  
  const metadata: ActionMetadata = {
    category,
    userId,
    persona: "ulysse",
    source,
    conversationId
  };

  const result = await actionHub.execute({
    name: toolName,
    params: args,
    metadata
  });

  if (result.success) {
    return JSON.stringify(result.result || { success: true });
  } else {
    return JSON.stringify({ error: result.error || "Exécution échouée" });
  }
}

export function getActionHubStats() {
  return {
    bridgeInitialized,
    registeredTools: ulysseToolsV2.length,
    hubStats: actionHub.getStats()
  };
}
