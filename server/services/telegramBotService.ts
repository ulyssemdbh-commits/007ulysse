import { getOwnerUserId } from "./knowledgeSync";
import { db } from "../db";
import { sql } from "drizzle-orm";

interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  text?: string;
  voice?: { file_id: string; duration: number };
  photo?: { file_id: string }[];
  document?: { file_id: string; file_name: string; mime_type: string };
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

let botToken: string = process.env.TELEGRAM_BOT_TOKEN || "";
let webhookUrl: string = "";
let allowedChatIds: Set<number> = new Set();
let botInfo: { id: number; username: string; first_name: string } | null = null;
let isInitialized = false;

async function telegramApi(method: string, body?: any): Promise<any> {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return data.result;
}

export async function initTelegramBot(): Promise<{ success: boolean; username?: string; error?: string }> {
  try {
    botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    if (!botToken) return { success: false, error: "TELEGRAM_BOT_TOKEN not set" };

    botInfo = await telegramApi("getMe");
    isInitialized = true;
    console.log(`[Telegram] Bot initialized: @${botInfo!.username}`);
    return { success: true, username: botInfo!.username };
  } catch (e: any) {
    console.error("[Telegram] Init failed:", e.message);
    return { success: false, error: e.message };
  }
}

export async function setWebhook(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    await telegramApi("setWebhook", {
      url,
      allowed_updates: ["message"],
      drop_pending_updates: true
    });
    webhookUrl = url;
    console.log(`[Telegram] Webhook set: ${url}`);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function removeWebhook(): Promise<{ success: boolean }> {
  try {
    await telegramApi("deleteWebhook", { drop_pending_updates: true });
    webhookUrl = "";
    return { success: true };
  } catch (e: any) {
    return { success: false };
  }
}

export async function sendMessage(chatId: number, text: string, parseMode: string = "HTML"): Promise<any> {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    return telegramApi("sendMessage", { chat_id: chatId, text, parse_mode: parseMode });
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  let lastResult = null;
  for (const chunk of chunks) {
    lastResult = await telegramApi("sendMessage", { chat_id: chatId, text: chunk, parse_mode: parseMode });
  }
  return lastResult;
}

export async function sendTypingAction(chatId: number): Promise<void> {
  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch (_) {}
}

async function routeToUlysse(text: string, userId: number): Promise<string> {
  try {
    const { ulysseCoreEngine } = await import("./core/UlysseCoreEngine");
    const response = await ulysseCoreEngine.processMessage(text, userId, {
      source: "telegram",
      skipTools: false
    });
    return response?.text || response?.content || "Je n'ai pas pu traiter ta demande.";
  } catch (e: any) {
    console.error("[Telegram] Ulysse routing error:", e.message);
    return "Désolé, une erreur est survenue. Réessaie dans quelques instants.";
  }
}

function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/`(.*?)`/g, "<code>$1</code>");
}

export async function handleWebhookUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const username = msg.from.username || msg.from.first_name;

  if (allowedChatIds.size > 0 && !allowedChatIds.has(chatId)) {
    await sendMessage(chatId, "⛔ Accès non autorisé. Contacte l'administrateur.");
    console.log(`[Telegram] Unauthorized access from chat ${chatId} (${username})`);
    return;
  }

  console.log(`[Telegram] Message from ${username} (${chatId}): ${text.substring(0, 100)}`);

  if (text === "/start") {
    await sendMessage(chatId, `Salut ${msg.from.first_name}! 👋\n\nJe suis <b>Ulysse</b>, ton assistant IA personnel.\n\nEnvoie-moi n'importe quelle question ou commande, je suis là pour t'aider!\n\n<b>Commandes:</b>\n/briefing — Briefing du jour\n/tasks — Tâches en cours\n/weather — Météo Marseille\n/help — Aide`);
    return;
  }

  if (text === "/help") {
    await sendMessage(chatId, `<b>Commandes Ulysse Telegram:</b>\n\n/briefing — Génère ton briefing matinal\n/tasks — Tes tâches Todoist du jour\n/weather — Météo Marseille\n/stocks — Tes marchés\n/sugu — KPIs restaurants\n\nOu pose-moi n'importe quelle question!`);
    return;
  }

  if (text === "/briefing") {
    await sendTypingAction(chatId);
    const { generateBriefing } = await import("./morningBriefingService");
    const briefing = await generateBriefing();
    let response = `☀️ <b>${briefing.greeting}</b>\n📅 ${briefing.date}\n\n`;
    for (const s of briefing.sections) {
      response += `${s.icon} <b>${s.title}</b>\n${sanitizeHtml(s.content)}\n\n`;
    }
    await sendMessage(chatId, response);
    return;
  }

  if (text === "/weather") {
    await sendTypingAction(chatId);
    try {
      const { fetchMarseilleData } = await import("./marseilleWeather");
      const data = await fetchMarseilleData();
      await sendMessage(chatId, `☀️ <b>Météo Marseille</b>\n${data.weather.condition}\n🌡 ${data.weather.temperature}\n💧 ${data.weather.humidity}\n💨 ${data.weather.wind}`);
    } catch {
      await sendMessage(chatId, "Impossible de récupérer la météo.");
    }
    return;
  }

  if (text === "/tasks") {
    await sendTypingAction(chatId);
    try {
      const { getTasksDueToday } = await import("./todoistService");
      const tasks = await getTasksDueToday();
      if (tasks.length === 0) {
        await sendMessage(chatId, "✅ Aucune tâche prévue aujourd'hui !");
      } else {
        const lines = tasks.slice(0, 10).map((t, i) => `${i + 1}. ${t.content}`);
        await sendMessage(chatId, `📋 <b>Tâches du jour (${tasks.length})</b>\n\n${lines.join("\n")}`);
      }
    } catch {
      await sendMessage(chatId, "Impossible de charger les tâches.");
    }
    return;
  }

  await sendTypingAction(chatId);
  const ownerId = (await getOwnerUserId()) || 1;
  const response = await routeToUlysse(text, ownerId);
  const cleaned = sanitizeHtml(response);
  await sendMessage(chatId, cleaned);
}

export function addAllowedChat(chatId: number): void {
  allowedChatIds.add(chatId);
}

export function removeAllowedChat(chatId: number): void {
  allowedChatIds.delete(chatId);
}

export function getStatus(): { initialized: boolean; username?: string; webhookUrl: string; allowedChats: number[] } {
  return {
    initialized: isInitialized,
    username: botInfo?.username,
    webhookUrl,
    allowedChats: Array.from(allowedChatIds)
  };
}

export const telegramBotService = {
  init: initTelegramBot,
  setWebhook,
  removeWebhook,
  sendMessage,
  handleWebhookUpdate,
  addAllowedChat,
  removeAllowedChat,
  getStatus
};
