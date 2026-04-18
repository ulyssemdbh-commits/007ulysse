/**
 * MCP (Model Context Protocol) Server — DevOps Bridge
 *
 * Expose les outils MaxAI DevOps (devops_server, devops_github, devmax_db,
 * dgm_manage, sensory_hub, etc.) à des clients MCP externes (DeerFlow Ulysse,
 * Claude Desktop, autres agents). Implémentation JSON-RPC 2.0 sur HTTP POST.
 *
 * Méthodes supportées:
 *   - initialize        → handshake MCP
 *   - tools/list        → liste les outils exposés
 *   - tools/call        → exécute un outil avec ses arguments
 *
 * Sécurité: Bearer token via env MCP_BRIDGE_TOKEN (vérification au niveau
 * du router Express).
 */

import { brainPulse } from "../sensory/BrainPulse";

// Catalogue minimal des outils DevOps qu'on expose en MCP.
// Pour chaque entrée: nom + description + JSON Schema.
interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

const EXPOSED_TOOLS: McpTool[] = [
  {
    name: "devops_server",
    description: "Gestion serveur Hetzner (apps PM2, nginx, SSL, DB, cron, deploy, audits). 50+ actions: status, health, list_apps, app_info, deploy, update, logs, restart, stop, delete, scale, exec, ssl, env_get, env_set, env_delete, list_databases, backup_db, restore_db, list_backups, nginx_configs, nginx_audit, nginx_catchall, verify_url, url_diagnose, url_diagnose_all, cron_list, cron_add, cron_delete, install_packages, run_tests, analyze_deps, debug_app, refactor_check, rollback_app, migrate_db, profile_app, log_search, security_scan, backup_app, scaffold_project, perf_loadtest, architecture_analyze, db_inspect, git_intelligence, api_test, bundle_analyze, env_clone, docs_generate, monitoring_setup, full_pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Une des actions listées dans la description (ex: status, list_apps, logs, restart, deploy, log_search, verify_url, security_scan)." },
        params: { type: "object", description: "Paramètres spécifiques à l'action (ex: { app: 'deerflow', lines: 100 } pour logs)." },
      },
      required: ["action"],
    },
  },
  {
    name: "devops_github",
    description: "Opérations GitHub: lecture/écriture fichiers, branches, PRs, commits, deploy hooks.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        branch: { type: "string" },
        content: { type: "string" },
        message: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "devmax_db",
    description: "Requêtes & inspection DB principale Ulysse. Actions: query, insert, update, delete, stats, project_summary.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["query", "insert", "update", "delete", "stats", "project_summary"] },
        sql: { type: "string" },
        table: { type: "string" },
        data: { type: "object" },
      },
      required: ["action"],
    },
  },
  {
    name: "sensory_hub",
    description: "Sens et conscience d'Ulysse: vision, audition, état cérébral. Actions: vision_analyze (screenshot URL + analyse GPT-4 Vision, params: url, prompt?), vision_webpage (analyse HTML/texte page, params: url, html_content), vision_stats, hearing_stats, brain_state (focus + charge cognitive), brain_stats, sensory_summary (résumé complet).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["vision_analyze", "vision_webpage", "vision_stats", "hearing_stats", "brain_state", "brain_stats", "sensory_summary"] },
        url: { type: "string" },
        prompt: { type: "string" },
        html_content: { type: "string" },
      },
      required: ["action"],
    },
  },
];

class DevopsMcpServer {
  listTools(): McpTool[] {
    return EXPOSED_TOOLS;
  }

  async callTool(name: string, args: Record<string, any>, userId: number): Promise<any> {
    const tool = EXPOSED_TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`Tool inconnu: ${name}. Disponibles: ${EXPOSED_TOOLS.map(t => t.name).join(", ")}`);

    brainPulse(["sensory", "association"], "mcp_bridge", `Appel externe MCP → ${name}`, { userId, intensity: 3 });

    // Lazy import pour éviter les dépendances circulaires avec ulysseToolsServiceV2
    const { executeToolCallV2 } = await import("../ulysseToolsServiceV2");
    const raw = await executeToolCallV2(name, args, userId);
    let parsed: any = raw;
    try { parsed = JSON.parse(raw); } catch { /* keep as string */ }
    return parsed;
  }

  /** JSON-RPC 2.0 dispatcher. */
  async handleRpc(body: any, userId: number): Promise<any> {
    const { jsonrpc, id, method, params } = body || {};
    if (jsonrpc !== "2.0") {
      return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" } };
    }

    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "ulysse-devops-mcp", version: "1.0.0" },
          },
        };
      }

      if (method === "tools/list") {
        return { jsonrpc: "2.0", id, result: { tools: this.listTools() } };
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = params?.arguments ?? {};
        if (!toolName) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: name required" } };
        }
        const result = await this.callTool(toolName, toolArgs, userId);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
            isError: false,
          },
        };
      }

      // Notifications MCP (notifications/initialized, etc.) → pas de réponse
      if (method?.startsWith("notifications/")) {
        return null;
      }

      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    } catch (e: any) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: e.message || "Internal error" },
      };
    }
  }
}

export const mcpDevopsServer = new DevopsMcpServer();
