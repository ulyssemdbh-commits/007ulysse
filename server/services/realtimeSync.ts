import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "http";
import { Duplex } from "stream";
import { verifyAccessToken } from "../api/v2/devices";
import { authService } from "./auth";

const SESSION_COOKIE_NAME = "ulysse_session";

// Extract session token from WebSocket request cookies
function extractSessionFromCookies(request: IncomingMessage): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
  
  return cookies[SESSION_COOKIE_NAME] || null;
}

// Validate session cookie and return user info if valid
export async function validateWebSocketSession(request: IncomingMessage): Promise<{ 
  userId: number; 
  isOwner: boolean;
  username?: string;
  displayName?: string;
} | null> {
  const sessionToken = extractSessionFromCookies(request);
  if (!sessionToken) return null;
  
  const result = await authService.validateSession(sessionToken);
  if (!result.success || !result.user) return null;
  
  return { 
    userId: result.user.id, 
    isOwner: result.user.isOwner ?? false,
    username: result.user.username,
    displayName: result.user.displayName ?? undefined
  };
}

export type SyncEventType = 
  | "memory.updated" 
  | "memory.deleted"
  | "files.updated" 
  | "diagnostics.updated" 
  | "homework.updated"
  | "homework.deleted"
  | "conversations.updated"
  | "conversation.message"
  | "task.progress"
  | "preview.request"
  | "search.results"
  | "face.search_results"
  | "face.list_results"
  | "talking.message"
  | "lightbox.show"
  | "lightbox.hide"
  | "dashboard.command"
  | "dashboard.update"
  | "image.generated"
  | "typing.update"
  | "typing.prethink"
  | "tasks.updated"
  | "notes.updated"
  | "projects.updated"
  | "sugu.purchases.updated"
  | "sugu.expenses.updated"
  | "sugu.bank.updated"
  | "sugu.cash.updated"
  | "sugu.checklist.updated"
  | "sugu.files.updated"
  | "sugu.employees.updated"
  | "sugu.payroll.updated"
  | "sugu.payroll.import.progress"
  | "sugu.payroll.import.complete"
  | "sugu.payroll.import.error"
  | "sugu.absences.updated"
  | "sugu.loans.updated"
  | "sports.updated"
  | "stocks.updated"
  | "bets.updated"
  | "anticipation.suggestion"
  | "anticipation.context"
  | "flow.morning_brief"
  | "action.execution.summary"
  | "email.preview"
  | "app.navigate";

export interface SyncEvent {
  type: SyncEventType;
  userId?: number;
  data?: any;
  timestamp: number;
}

export interface ConversationMessageEvent {
  type: "conversation.message";
  userId: number;
  data: {
    threadId?: string;
    message: {
      id: string;
      role: "user" | "assistant";
      content: string;
      timestamp: Date;
    };
    origin: string;
  };
  timestamp: number;
}

interface AuthenticatedWebSocket extends WebSocket {
  userId?: number;
  deviceId?: string;
  isAuthenticated?: boolean;
  sessionValidated?: boolean;
  httpRequest?: IncomingMessage;
  authTimeout?: NodeJS.Timeout;
  isGuest?: boolean;
}

const connectedClients = new Map<WebSocket, { userId?: number; deviceId?: string }>();

let syncWss: WebSocketServer | null = null;

export function setupRealtimeSync(): WebSocketServer {
  syncWss = new WebSocketServer({ 
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 64 * 1024,
  });

  console.log("Realtime sync WebSocket server initialized on /ws/sync");

  syncWss.on("connection", (ws: AuthenticatedWebSocket, request: IncomingMessage) => {
    const connectionId = `ws_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[WS] Client connected: ${connectionId}`);
    connectedClients.set(ws, {});
    
    // Store request for session validation during auth
    ws.httpRequest = request;
    
    const AUTH_TIMEOUT_MS = 30000;

    ws.authTimeout = setTimeout(() => {
      if (!ws.isAuthenticated) {
        ws.isGuest = true;
        console.log(`[WS] Auth timeout for ${connectionId} - remains as guest`);
        ws.send(JSON.stringify({
          type: "auth.guest",
          message: "Connected as guest - authenticate to receive user-specific events",
          timestamp: Date.now(),
        }));
      }
    }, AUTH_TIMEOUT_MS);

    ws.send(JSON.stringify({ 
      type: "connected", 
      message: "Sync channel active - authenticate for full sync",
      timestamp: Date.now()
    }));

    // Handle disconnect/cleanup
    ws.on("close", () => {
      if (ws.authTimeout) clearTimeout(ws.authTimeout);
      connectedClients.delete(ws);
      const userId = connectedClients.get(ws)?.userId;
      console.log(`[WS] Disconnected: ${connectionId}${userId ? ` (userId=${userId})` : ''}`);
    });

    ws.on("error", (error) => {
      console.error(`[WS] Error on ${connectionId}:`, error);
    });

    ws.on("message", (data) => {
      try {
        if (data.toString().length > 64 * 1024) {
          ws.send(JSON.stringify({ type: "error", error: "Message too large", timestamp: Date.now() }));
          return;
        }
        const message = JSON.parse(data.toString());
        
        // Handle ping/pong heartbeat
        if (message.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          return;
        }
        
        if (message.type === "auth") {
          (async () => {
            let authenticatedUserId: number | null = null;
            let sessionValidated = false;
            
            // Method 1: JWT token authentication (mobile devices)
            if (message.token) {
              const tokenData = verifyAccessToken(message.token);
              if (tokenData) {
                authenticatedUserId = tokenData.userId;
                sessionValidated = true;
              }
            }
            
            // Method 2: Session cookie validation (web/cross-origin)
            // Validate the actual session cookie instead of trusting client-provided userId
            if (!authenticatedUserId && ws.httpRequest) {
              const sessionResult = await validateWebSocketSession(ws.httpRequest);
              if (sessionResult) {
                authenticatedUserId = sessionResult.userId;
                sessionValidated = true;
                console.log(`[RealtimeSync] Session validated from cookie for userId=${authenticatedUserId}`);
              }
            }
            
            // Fallback: Accept userId if it matches validated session (backward compat)
            // This prevents breaking existing clients but requires valid session
            if (!authenticatedUserId && message.userId && !sessionValidated) {
              console.warn(`[RealtimeSync] Rejecting auth with userId=${message.userId} - no valid session cookie`);
              ws.send(JSON.stringify({ type: "auth.failed", error: "Session validation required", timestamp: Date.now() }));
              return;
            }
            
            if (!authenticatedUserId) {
              ws.send(JSON.stringify({ type: "auth.failed", error: "Invalid or expired session", timestamp: Date.now() }));
              return;
            }
          
            const clientInfo = connectedClients.get(ws);
            if (clientInfo) {
              clientInfo.userId = authenticatedUserId;
              clientInfo.deviceId = message.deviceId || "unknown";
            }
            ws.userId = authenticatedUserId;
            ws.deviceId = message.deviceId || "unknown";
            ws.isAuthenticated = true;

            if (ws.authTimeout) {
              clearTimeout(ws.authTimeout);
              ws.authTimeout = undefined;
            }

            console.log(`Sync client authenticated: userId=${authenticatedUserId}, device=${ws.deviceId}`);
            ws.send(JSON.stringify({ type: "auth.success", userId: authenticatedUserId, timestamp: Date.now() }));
          })().catch((err) => {
            console.error("[RealtimeSync] Auth error:", err);
            ws.send(JSON.stringify({ type: "auth.failed", error: "Internal error", timestamp: Date.now() }));
          });
          return;
        }

        // Centralized auth check for all message types below
        if (!ws.isAuthenticated && message.type !== "ping" && message.type !== "auth") {
          ws.send(JSON.stringify({ type: "error", error: "Not authenticated", timestamp: Date.now() }));
          console.warn(`[RealtimeSync] Dropped ${message.type} from unauthenticated client ${ws.deviceId}`);
          return;
        }

        // ---- MESSAGE ROUTING ----

        if (message.type === "conversation.message") {
          const threadId = message.data?.threadId || "default";
          console.log(`[RealtimeSync] Broadcasting message from ${ws.deviceId} (thread: ${threadId}) to other devices for user ${ws.userId}`);
          broadcastToUser(ws.userId!, {
            type: "conversation.message",
            userId: ws.userId!,
            data: message.data,
            timestamp: Date.now()
          }, ws);
          return;
        }

        if (message.type === "talking.message") {
          console.log(`[RealtimeSync] Broadcasting talking message from ${ws.deviceId} to user ${ws.userId}`);
          broadcastToUser(ws.userId!, {
            type: "talking.message",
            userId: ws.userId!,
            data: message.data,
            timestamp: Date.now()
          }, ws);
          return;
        }

        if (message.type === "lightbox.show" || message.type === "lightbox.hide") {
          console.log(`[RealtimeSync] Broadcasting lightbox ${message.type} to user ${ws.userId}`);
          broadcastToUser(ws.userId!, {
            type: message.type,
            userId: ws.userId!,
            data: message.data,
            timestamp: Date.now()
          });
          return;
        }

        if (message.type === "dashboard.command") {
          console.log(`[RealtimeSync] Dashboard command from ${ws.deviceId}: ${message.data?.action}`);
          broadcastToUser(ws.userId!, {
            type: "dashboard.command",
            userId: ws.userId!,
            data: message.data,
            timestamp: Date.now()
          });
          return;
        }

        if (message.type === "dashboard.update") {
          console.log(`[RealtimeSync] Dashboard update from ${ws.deviceId}: ${message.data?.section}`);
          broadcastToUser(ws.userId!, {
            type: "dashboard.update",
            userId: ws.userId!,
            data: message.data,
            timestamp: Date.now()
          });
          return;
        }

        // Handle real-time typing updates for pre-thinking
        if (message.type === "typing.update") {
          const text = message.data?.text || "";
          const conversationId = message.data?.conversationId;
          
          if (text.length >= 10) {
            // Start pre-thinking when user has typed enough
            import("./preThinkingService").then(({ preThinkingService }) => {
              preThinkingService.analyze(ws.userId!, text, conversationId).then((prethink) => {
                if (prethink && prethink.intent) {
                  // Send pre-thinking status back to user
                  ws.send(JSON.stringify({
                    type: "typing.prethink",
                    data: prethink,
                    timestamp: Date.now()
                  }));
                }
              }).catch(() => {});
            }).catch(() => {});
          }
          return;
        }
      } catch (error) {
        console.error("Error parsing sync message:", error);
      }
    });

    ws.on("close", () => {
      console.log("Sync WebSocket client disconnected");
      if (ws.authTimeout) {
        clearTimeout(ws.authTimeout);
        ws.authTimeout = undefined;
      }
      ws.httpRequest = undefined;
      connectedClients.delete(ws);
    });

    ws.on("error", (error) => {
      console.error("Sync WebSocket error:", error);
      if (ws.authTimeout) {
        clearTimeout(ws.authTimeout);
        ws.authTimeout = undefined;
      }
      ws.httpRequest = undefined;
      connectedClients.delete(ws);
    });
  });

  setInterval(() => {
    if (!syncWss) return;
    const ping = JSON.stringify({ type: "server_ping", timestamp: Date.now() });
    connectedClients.forEach((clientInfo, client) => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(ping); } catch {}
      }
    });
  }, 30000);

  return syncWss;
}

export function handleSyncUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
  if (syncWss) {
    syncWss.handleUpgrade(request, socket, head, (ws) => {
      syncWss!.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
}

export function broadcastSyncEvent(event: SyncEvent) {
  const message = JSON.stringify(event);
  
  connectedClients.forEach((clientInfo, client) => {
    if (client.readyState === WebSocket.OPEN) {
      // If event has userId, only send to matching clients OR unauthenticated clients (for general sync)
      // If event has no userId, send to all clients
      if (event.userId && clientInfo.userId && event.userId !== clientInfo.userId) {
        return;
      }
      try {
        client.send(message);
      } catch (error) {
        console.error("Error broadcasting sync event:", error);
      }
    }
  });
}

export function broadcastToUser(userId: number, event: SyncEvent | ConversationMessageEvent, excludeSocket?: WebSocket) {
  const message = JSON.stringify(event);
  let broadcastCount = 0;
  const closedSockets: WebSocket[] = [];
  
  connectedClients.forEach((clientInfo, client) => {
    // Clean up closed sockets
    if (client.readyState !== WebSocket.OPEN) {
      closedSockets.push(client);
      return;
    }
    
    // Only send to matching user
    if (clientInfo.userId !== userId) {
      return;
    }
    
    // Skip excluded socket
    if (excludeSocket && client === excludeSocket) {
      return;
    }
    
    try {
      client.send(message);
      broadcastCount++;
    } catch (error) {
      console.error(`[Broadcast] Error sending to user ${userId}:`, error);
      closedSockets.push(client);
    }
  });
  
  // Clean up any closed sockets
  closedSockets.forEach(socket => connectedClients.delete(socket));
  
  if (broadcastCount > 0) {
    console.log(`[Broadcast] Sent ${event.type} to ${broadcastCount} device(s) for user ${userId}`);
  }
}

export function emitMemoryUpdated(userId?: number) {
  broadcastSyncEvent({
    type: "memory.updated",
    userId,
    timestamp: Date.now()
  });
}

export function emitMemoryDeleted(userId?: number) {
  broadcastSyncEvent({
    type: "memory.deleted",
    userId,
    timestamp: Date.now()
  });
}

export function emitFilesUpdated(userId?: number) {
  broadcastSyncEvent({
    type: "files.updated",
    userId,
    timestamp: Date.now()
  });
}

export function emitDiagnosticsUpdated() {
  broadcastSyncEvent({
    type: "diagnostics.updated",
    timestamp: Date.now()
  });
}

export function emitHomeworkUpdated(userId?: number) {
  broadcastSyncEvent({
    type: "homework.updated",
    userId,
    timestamp: Date.now()
  });
}

export function emitHomeworkDeleted(userId?: number) {
  broadcastSyncEvent({
    type: "homework.deleted",
    userId,
    timestamp: Date.now()
  });
}

export function emitConversationsUpdated(userId?: number) {
  broadcastSyncEvent({
    type: "conversations.updated",
    userId,
    timestamp: Date.now()
  });
}

export function emitConversationMessage(
  userId: number,
  conversationIdOrMessage: number | { id: string; role: "user" | "assistant"; content: string; timestamp: Date },
  roleOrThreadId?: string | "user" | "assistant",
  contentOrOrigin?: string,
  threadIdParam?: string,
  originParam: string = "server"
) {
  // Support both old signature (userId, message, threadId, origin) 
  // and new signature (userId, conversationId, role, content, threadId, origin)
  let message: { id: string; role: string; content: string; timestamp: Date; conversationId?: number };
  let threadId: string | undefined;
  let origin: string;

  if (typeof conversationIdOrMessage === 'object') {
    // Old signature: emitConversationMessage(userId, messageObj, threadId?, origin?)
    message = conversationIdOrMessage;
    threadId = roleOrThreadId as string | undefined;
    origin = contentOrOrigin || "server";
  } else {
    // New signature: emitConversationMessage(userId, conversationId, role, content, threadId?, origin?)
    const conversationId = conversationIdOrMessage;
    const role = roleOrThreadId as "user" | "assistant";
    const content = contentOrOrigin || "";
    threadId = threadIdParam;
    origin = originParam;
    
    message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role,
      content,
      timestamp: new Date(),
      conversationId
    };
  }

  broadcastToUser(userId, {
    type: "conversation.message",
    userId,
    data: {
      threadId,
      message,
      origin
    },
    timestamp: Date.now()
  });
}

export interface TaskProgress {
  taskId: string;
  stage: string;
  percentage: number;
  estimatedTimeRemaining?: number;
  currentStep?: string;
  totalSteps?: number;
  currentStepIndex?: number;
}

export function emitTaskProgress(userId: number, progress: TaskProgress) {
  broadcastToUser(userId, {
    type: "task.progress",
    userId,
    data: progress,
    timestamp: Date.now()
  });
}

// /talking message sync for ulysseproject.org integration
export interface TalkingMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  audioUrl?: string;
  origin: "talking" | "chat" | "voice";
}

export function emitTalkingMessage(userId: number, message: TalkingMessage) {
  broadcastToUser(userId, {
    type: "talking.message",
    userId,
    data: message,
    timestamp: Date.now()
  });
}

// Lightbox control for ulysseproject.org integration
export interface LightboxContent {
  type: "image" | "video" | "document" | "code" | "html";
  url?: string;
  content?: string;
  title?: string;
  mimeType?: string;
}

export function emitLightboxShow(userId: number, content: LightboxContent) {
  broadcastToUser(userId, {
    type: "lightbox.show",
    userId,
    data: content,
    timestamp: Date.now()
  });
}

export function emitLightboxHide(userId: number) {
  broadcastToUser(userId, {
    type: "lightbox.hide",
    userId,
    timestamp: Date.now()
  });
}

// Dashboard commands for ulysseproject.org integration
export interface DashboardCommand {
  action: string;
  target?: string;
  params?: Record<string, any>;
  source: "talking" | "chat" | "external";
}

export function emitDashboardCommand(userId: number, command: DashboardCommand) {
  broadcastToUser(userId, {
    type: "dashboard.command",
    userId,
    data: command,
    timestamp: Date.now()
  });
}

export interface DashboardUpdate {
  section: string;
  data: any;
}

export function emitDashboardUpdate(userId: number, update: DashboardUpdate) {
  broadcastToUser(userId, {
    type: "dashboard.update",
    userId,
    data: update,
    timestamp: Date.now()
  });
}

// --- Data sync emitters for cross-device real-time updates ---

export function emitTasksUpdated(userId?: number) {
  broadcastSyncEvent({ type: "tasks.updated", userId, timestamp: Date.now() });
}

export function emitNotesUpdated(userId?: number) {
  broadcastSyncEvent({ type: "notes.updated", userId, timestamp: Date.now() });
}

export function emitProjectsUpdated(userId?: number) {
  broadcastSyncEvent({ type: "projects.updated", userId, timestamp: Date.now() });
}

export function emitSuguPurchasesUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.purchases.updated", userId, timestamp: Date.now() });
}

export function emitSuguExpensesUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.expenses.updated", userId, timestamp: Date.now() });
}

export function emitSuguBankUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.bank.updated", userId, timestamp: Date.now() });
}

export function emitSuguCashUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.cash.updated", userId, timestamp: Date.now() });
}

export function emitSuguChecklistUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.checklist.updated", userId, timestamp: Date.now() });
}

export function emitSuguFilesUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.files.updated", userId, timestamp: Date.now() });
}

export function emitSuguEmployeesUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.employees.updated", userId, timestamp: Date.now() });
}

export function emitSuguPayrollUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.payroll.updated", userId, timestamp: Date.now() });
}

export function emitSuguAbsencesUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.absences.updated", userId, timestamp: Date.now() });
}

export function emitSuguLoansUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sugu.loans.updated", userId, timestamp: Date.now() });
}

export function emitSportsUpdated(userId?: number) {
  broadcastSyncEvent({ type: "sports.updated", userId, timestamp: Date.now() });
}

export function emitStocksUpdated(userId?: number) {
  broadcastSyncEvent({ type: "stocks.updated", userId, timestamp: Date.now() });
}

export function emitBetsUpdated(userId?: number) {
  broadcastSyncEvent({ type: "bets.updated", userId, timestamp: Date.now() });
}

// Get connected clients count for diagnostics
export function getConnectedClientsCount(): number {
  return connectedClients.size;
}

export function getAuthenticatedClientsCount(): number {
  let count = 0;
  connectedClients.forEach((info) => {
    if (info.userId) count++;
  });
  return count;
}

// Check if /talking app is connected for a specific user
export function isTalkingConnected(userId: number): boolean {
  let found = false;
  connectedClients.forEach((info) => {
    if (info.userId === userId && info.deviceId === "talking") {
      found = true;
    }
  });
  return found;
}

// Get all connected device IDs for a user
export function getConnectedDevices(userId: number): string[] {
  const devices: string[] = [];
  connectedClients.forEach((info) => {
    if (info.userId === userId && info.deviceId) {
      devices.push(info.deviceId);
    }
  });
  return devices;
}

// Send TTS request to /talking app for a specific user
// This is used when chat sends a message and /talking should speak it
export function sendTTSToTalking(userId: number, text: string, origin: "chat" | "voice" = "chat"): boolean {
  let sent = false;
  connectedClients.forEach((info, client) => {
    if (info.userId === userId && info.deviceId === "talking" && client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({
          type: "tts_request",
          data: {
            text,
            origin,
            timestamp: Date.now()
          }
        }));
        sent = true;
        console.log(`[RealtimeSync] Sent TTS request to /talking for user ${userId}: "${text.substring(0, 50)}..."`);
      } catch (error) {
        console.error("[RealtimeSync] Error sending TTS to talking:", error);
      }
    }
  });
  return sent;
}

// Send a message to /talking app indicating assistant response is ready
export function notifyTalkingOfResponse(userId: number, content: string, messageId?: string): boolean {
  let sent = false;
  connectedClients.forEach((info, client) => {
    if (info.userId === userId && info.deviceId === "talking" && client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({
          type: "chat_response",
          data: {
            content,
            messageId,
            timestamp: Date.now(),
            speakIt: true // Tells /talking to speak this response
          }
        }));
        sent = true;
        console.log(`[RealtimeSync] Notified /talking of response for user ${userId}`);
      } catch (error) {
        console.error("[RealtimeSync] Error notifying talking:", error);
      }
    }
  });
  return sent;
}
