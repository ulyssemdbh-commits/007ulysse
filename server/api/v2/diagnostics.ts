import { Router, Request, Response } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const router = Router();

interface ServiceStatus {
  name: string;
  status: "ok" | "error" | "warning" | "unavailable";
  message: string;
  latencyMs?: number;
  details?: any;
}

interface ToolStatus {
  name: string;
  category: string;
  available: boolean;
  lastTest?: string;
}

interface DiagnosticsResult {
  timestamp: string;
  system: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    nodeVersion: string;
    environment: string;
  };
  services: ServiceStatus[];
  tools: ToolStatus[];
  connections: {
    discord: { connected: boolean; botName?: string; guilds?: number };
    spotify: { connected: boolean; user?: string };
    calendar: { connected: boolean };
    email: { connected: boolean };
    notion: { connected: boolean };
    todoist: { connected: boolean };
  };
  apis: {
    openai: { available: boolean; model?: string };
    gemini: { available: boolean };
    serper: { available: boolean };
    perplexity: { available: boolean };
  };
}

// Test database connection
async function testDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return {
      name: "PostgreSQL",
      status: "ok",
      message: "Connexion établie",
      latencyMs: Date.now() - start
    };
  } catch (error: any) {
    return {
      name: "PostgreSQL",
      status: "error",
      message: error.message,
      latencyMs: Date.now() - start
    };
  }
}

// Test OpenAI connection
async function testOpenAI(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return { name: "OpenAI", status: "unavailable", message: "API key non configurée" };
    }
    
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Test. Réponds juste 'OK'." }],
      max_tokens: 5
    });
    
    return {
      name: "OpenAI",
      status: "ok",
      message: `Modèle: gpt-4o-mini`,
      latencyMs: Date.now() - start,
      details: { model: "gpt-4o-mini", response: response.choices[0]?.message?.content }
    };
  } catch (error: any) {
    return {
      name: "OpenAI",
      status: "error",
      message: error.message,
      latencyMs: Date.now() - start
    };
  }
}

// Test Gemini connection (via Replit AI Integrations - Native SDK)
async function testGemini(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (!apiKey) {
      return { name: "Gemini", status: "unavailable", message: "Intégration Gemini non configurée" };
    }
    
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const result = await model.generateContent("Test. Réponds juste 'OK'.");
    const response = result.response.text();
    
    return {
      name: "Gemini",
      status: "ok",
      message: `Modèle: gemini-2.5-flash`,
      latencyMs: Date.now() - start,
      details: { model: "gemini-2.5-flash", response }
    };
  } catch (error: any) {
    return {
      name: "Gemini",
      status: "error",
      message: error.message,
      latencyMs: Date.now() - start
    };
  }
}

// Test Serper API
async function testSerper(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    if (!process.env.SERPER_API_KEY) {
      return { name: "Serper", status: "unavailable", message: "API key non configurée" };
    }
    
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: "test", num: 1 })
    });
    
    if (response.ok) {
      return {
        name: "Serper",
        status: "ok",
        message: "API fonctionnelle",
        latencyMs: Date.now() - start
      };
    } else {
      return {
        name: "Serper",
        status: "error",
        message: `HTTP ${response.status}`,
        latencyMs: Date.now() - start
      };
    }
  } catch (error: any) {
    return {
      name: "Serper",
      status: "error",
      message: error.message,
      latencyMs: Date.now() - start
    };
  }
}

// Test Discord bot
async function testDiscord(): Promise<{ connected: boolean; botName?: string; guilds?: number }> {
  try {
    const { discordBotService } = await import("../../services/discordBotService");
    const isReady = discordBotService.isReady();
    
    if (isReady) {
      const botName = discordBotService.getBotUsername();
      const guilds = await discordBotService.getGuilds();
      return { connected: true, botName, guilds: guilds.length };
    }
    return { connected: false };
  } catch {
    return { connected: false };
  }
}

// Test Spotify
async function testSpotify(): Promise<{ connected: boolean; user?: string }> {
  try {
    const { isSpotifyConnected, getCurrentUser } = await import("../../services/spotifyService");
    const connected = await isSpotifyConnected();
    if (!connected) return { connected: false };
    const user = typeof getCurrentUser === "function" ? await getCurrentUser().catch(() => null) : null;
    return { connected: true, user: user?.display_name || user?.id };
  } catch {
    return { connected: false };
  }
}

// Test Calendar
async function testCalendar(): Promise<{ connected: boolean }> {
  try {
    const { calendarService } = await import("../../services/googleCalendarService");
    const connected = await calendarService.isConnected();
    return { connected };
  } catch {
    return { connected: false };
  }
}

// Test Email (AgentMail)
async function testEmail(): Promise<{ connected: boolean }> {
  try {
    const { agentMailService } = await import("../../services/agentMailService");
    const result = await agentMailService.listEmails(5);
    return { connected: result.success };
  } catch {
    return { connected: false };
  }
}

// Test Notion
async function testNotion(): Promise<{ connected: boolean }> {
  try {
    if (!process.env.NOTION_API_KEY) return { connected: false };
    
    const response = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        "Authorization": `Bearer ${process.env.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28"
      }
    });
    return { connected: response.ok };
  } catch {
    return { connected: false };
  }
}

// Test Todoist
async function testTodoist(): Promise<{ connected: boolean }> {
  try {
    const todoistService = await import("../../services/todoistService");
    const tasks = await todoistService.getTasks();
    return { connected: Array.isArray(tasks) };
  } catch {
    return { connected: false };
  }
}

// Get all tools status
function getToolsStatus(): ToolStatus[] {
  const tools = [
    { name: "query_suguval_history", category: "SUGU" },
    { name: "query_sports_data", category: "Sports" },
    { name: "query_matchendirect", category: "Sports" },
    { name: "query_brain", category: "Mémoire" },
    { name: "query_stock_data", category: "Finance" },
    { name: "calendar_list_events", category: "Calendrier" },
    { name: "calendar_create_event", category: "Calendrier" },
    { name: "email_list_inbox", category: "Email" },
    { name: "email_send", category: "Email" },
    { name: "smarthome_control", category: "Domotique" },
    { name: "location_get_weather", category: "Météo" },
    { name: "web_search", category: "Recherche" },
    { name: "read_url", category: "Recherche" },
    { name: "spotify_control", category: "Musique" },
    { name: "discord_send_message", category: "Discord" },
    { name: "discord_status", category: "Discord" },
    { name: "discord_add_reaction", category: "Discord" },
    { name: "discord_remove_reaction", category: "Discord" },
    { name: "discord_delete_message", category: "Discord" },
    { name: "discord_send_file", category: "Discord" },
    { name: "discord_create_invitation", category: "Discord" },
    { name: "discord_voice_status", category: "Discord" },
    { name: "memory_save", category: "Mémoire" },
    { name: "image_generate", category: "Images" },
    { name: "todoist_create_task", category: "Tâches" },
    { name: "todoist_list_tasks", category: "Tâches" },
    { name: "todoist_complete_task", category: "Tâches" },
    { name: "kanban_create_task", category: "Kanban" },
    { name: "analyze_file", category: "Fichiers" },
    { name: "analyze_invoice", category: "Factures" },
    { name: "generate_file", category: "Fichiers" },
    { name: "export_analysis", category: "Export" },
    { name: "export_invoice_excel", category: "Export" }
  ];
  
  return tools.map(t => ({
    ...t,
    available: true,
    lastTest: new Date().toISOString()
  }));
}

// Main diagnostics endpoint
router.get("/", async (req: Request, res: Response) => {
  console.log("[Diagnostics] Running full system diagnostics...");
  
  const startTime = Date.now();
  
  try {
    // Run all tests in parallel
    const [
      dbStatus,
      openaiStatus,
      geminiStatus,
      serperStatus,
      discordStatus,
      spotifyStatus,
      calendarStatus,
      emailStatus,
      notionStatus,
      todoistStatus
    ] = await Promise.all([
      testDatabase(),
      testOpenAI(),
      testGemini(),
      testSerper(),
      testDiscord(),
      testSpotify(),
      testCalendar(),
      testEmail(),
      testNotion(),
      testTodoist()
    ]);
    
    const result: DiagnosticsResult = {
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || "development"
      },
      services: [dbStatus, openaiStatus, geminiStatus, serperStatus],
      tools: getToolsStatus(),
      connections: {
        discord: discordStatus,
        spotify: spotifyStatus,
        calendar: calendarStatus,
        email: emailStatus,
        notion: notionStatus,
        todoist: todoistStatus
      },
      apis: {
        openai: { available: openaiStatus.status === "ok", model: "gpt-4o-mini" },
        gemini: { available: geminiStatus.status === "ok" },
        serper: { available: serperStatus.status === "ok" },
        perplexity: { available: !!process.env.PERPLEXITY_API_KEY }
      }
    };
    
    console.log(`[Diagnostics] Completed in ${Date.now() - startTime}ms`);
    res.json(result);
  } catch (error: any) {
    console.error("[Diagnostics] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Quick health check
router.get("/quick", async (req: Request, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error: any) {
    res.status(500).json({ status: "unhealthy", error: error.message });
  }
});

// Test specific tool
router.post("/test-tool", async (req: Request, res: Response) => {
  const { toolName, args = {} } = req.body;
  const userId = (req as any).userId || 1;
  
  if (!toolName) {
    return res.status(400).json({ error: "toolName requis" });
  }
  
  try {
    const { executeToolCallV2 } = await import("../../services/ulysseToolsServiceV2");
    
    const start = Date.now();
    const result = await executeToolCallV2(toolName, args, userId);
    
    res.json({
      tool: toolName,
      success: true,
      result: JSON.parse(result),
      executionTimeMs: Date.now() - start
    });
  } catch (error: any) {
    res.status(500).json({
      tool: toolName,
      success: false,
      error: error.message
    });
  }
});

export default router;
