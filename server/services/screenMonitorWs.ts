import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { verifyAccessToken } from "../api/v2/devices";
import { screenMonitorService, ScreenFrame, ScreenAnalysis } from "./screenMonitorService";
import { broadcastToUser, validateWebSocketSession } from "./realtimeSync";

const LOG_PREFIX = "[ScreenMonitorWS]";

interface AuthenticatedScreenSocket extends WebSocket {
  userId?: number;
  deviceId?: string;
  deviceName?: string;
  isAuthenticated?: boolean;
  httpRequest?: IncomingMessage;
  remoteControlCapable?: boolean;
  remoteControlEnabled?: boolean;
}

interface ScreenMonitorMessage {
  type: "auth" | "frame" | "control" | "ping" | "capability" | "remote_control.status" | "remote_control.result";
  token?: string;
  userId?: number;
  deviceId?: string;
  deviceName?: string;
  frame?: {
    imageBase64: string;
    activeApp?: string;
    activeWindow?: string;
    timestamp: number;
  };
  action?: "start" | "pause" | "resume" | "stop";
}

const connectedScreenClients = new Map<WebSocket, { userId?: number; deviceId?: string }>();
let screenWss: WebSocketServer | null = null;

const latestFrames = new Map<number, { imageBase64: string; activeApp?: string; activeWindow?: string; timestamp: number }>();
const frameWaiters = new Map<number, { resolve: (frame: { imageBase64: string; activeApp?: string; activeWindow?: string; timestamp: number }) => void; timer: NodeJS.Timeout }>();
const frameListeners = new Map<number, Set<(info: { activeApp?: string; activeWindow?: string; timestamp: number }) => void>>();

export function addFrameListener(userId: number, cb: (info: { activeApp?: string; activeWindow?: string; timestamp: number }) => void): () => void {
  if (!frameListeners.has(userId)) frameListeners.set(userId, new Set());
  frameListeners.get(userId)!.add(cb);
  return () => { frameListeners.get(userId)?.delete(cb); };
}

export function getLatestFrame(userId: number) {
  return latestFrames.get(userId) || null;
}

export function waitForNextFrame(userId: number, timeoutMs = 5000): Promise<{ imageBase64: string; activeApp?: string; activeWindow?: string; timestamp: number } | null> {
  return new Promise((resolve) => {
    const existing = frameWaiters.get(userId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve(null);
    }

    const timer = setTimeout(() => {
      frameWaiters.delete(userId);
      resolve(null);
    }, timeoutMs);

    frameWaiters.set(userId, { resolve: (frame) => { clearTimeout(timer); frameWaiters.delete(userId); resolve(frame); }, timer });
  });
}

function notifyFrameWaiters(userId: number, frame: { imageBase64: string; activeApp?: string; activeWindow?: string; timestamp: number }) {
  latestFrames.set(userId, frame);
  const waiter = frameWaiters.get(userId);
  if (waiter) {
    waiter.resolve(frame);
  }
  const listeners = frameListeners.get(userId);
  if (listeners) {
    const info = { activeApp: frame.activeApp, activeWindow: frame.activeWindow, timestamp: frame.timestamp };
    for (const cb of listeners) {
      try { cb(info); } catch {}
    }
  }
}

export function setupScreenMonitorWs(): WebSocketServer {
  screenWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 5 * 1024 * 1024 // 5MB max for images
  });

  console.log(`${LOG_PREFIX} Screen Monitor WebSocket server initialized on /ws/screen`);

  screenWss.on("connection", (ws: AuthenticatedScreenSocket, request: IncomingMessage) => {
    console.log(`${LOG_PREFIX} New screen client connected`);
    connectedScreenClients.set(ws, {});
    
    // Store request for session validation during auth
    ws.httpRequest = request;

    const AUTH_TIMEOUT_MS = 10000;
    const authTimeout = setTimeout(() => {
      if (!ws.isAuthenticated) {
        console.log(`${LOG_PREFIX} Auth timeout - closing connection`);
        ws.close(4001, "Authentication timeout");
      }
    }, AUTH_TIMEOUT_MS);

    (ws as any).authTimeout = authTimeout;

    ws.send(JSON.stringify({
      type: "connected",
      message: "Screen monitor ready - authenticate to start",
      timestamp: Date.now()
    }));

    ws.on("message", async (data) => {
      try {
        const message: ScreenMonitorMessage = JSON.parse(data.toString());

        if (message.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          return;
        }

        if (message.type === "auth") {
          await handleAuth(ws, message, authTimeout);
          return;
        }

        if (!ws.isAuthenticated) {
          ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
          return;
        }

        if (message.type === "control") {
          await handleControl(ws, message);
          return;
        }

        if (message.type === "frame") {
          await handleFrame(ws, message);
          return;
        }

        if (message.type === "capability") {
          handleCapability(ws, message as any);
          return;
        }

        if (message.type === "remote_control.status" || message.type === "remote_control.result") {
          handleRemoteControlFeedback(ws, message as any);
          return;
        }

      } catch (error) {
        console.error(`${LOG_PREFIX} Error processing message:`, error);
        ws.send(JSON.stringify({ type: "error", error: "Invalid message" }));
      }
    });

    ws.on("close", async () => {
      console.log(`${LOG_PREFIX} Screen client disconnected`);
      // Clear auth timeout on disconnect
      if ((ws as any).authTimeout) {
        clearTimeout((ws as any).authTimeout);
        delete (ws as any).authTimeout;
      }
      // Clean up httpRequest reference to prevent memory leak
      ws.httpRequest = undefined;
      
      if (ws.isAuthenticated && ws.userId) {
        await screenMonitorService.endSession(ws.userId);
      }
      
      connectedScreenClients.delete(ws);
    });

    ws.on("error", (error) => {
      console.error(`${LOG_PREFIX} WebSocket error:`, error);
      // Clear auth timeout on error
      if ((ws as any).authTimeout) {
        clearTimeout((ws as any).authTimeout);
        delete (ws as any).authTimeout;
      }
      // Clean up httpRequest reference to prevent memory leak
      ws.httpRequest = undefined;
      connectedScreenClients.delete(ws);
    });
  });

  return screenWss;
}

async function handleAuth(ws: AuthenticatedScreenSocket, message: ScreenMonitorMessage, authTimeout: NodeJS.Timeout) {
  let authenticatedUserId: number | null = null;
  let sessionValidated = false;

  // Method 1: JWT token authentication (desktop agents with token)
  if (message.token) {
    const tokenData = verifyAccessToken(message.token);
    if (tokenData) {
      authenticatedUserId = tokenData.userId;
      sessionValidated = true;
      console.log(`${LOG_PREFIX} Authenticated via JWT token for userId=${authenticatedUserId}`);
    }
  }

  // Method 2: Session cookie validation (web clients)
  if (!authenticatedUserId && ws.httpRequest) {
    const sessionResult = await validateWebSocketSession(ws.httpRequest);
    if (sessionResult) {
      authenticatedUserId = sessionResult.userId;
      sessionValidated = true;
      console.log(`${LOG_PREFIX} Authenticated via session cookie for userId=${authenticatedUserId}`);
    }
  }

  // Method 3: Allow userId auth for desktop agents (owner only, userId=1)
  // This is for trusted local agents that don't have browser session
  if (!authenticatedUserId && message.userId) {
    // Only allow this for the owner (userId=1) and require deviceId to be set
    if (message.userId === 1 && message.deviceId) {
      authenticatedUserId = message.userId;
      sessionValidated = true;
      console.log(`${LOG_PREFIX} Authenticated via userId for owner desktop agent, deviceId=${message.deviceId}`);
    } else {
      console.warn(`${LOG_PREFIX} Rejecting auth with userId=${message.userId} - only owner desktop agents allowed`);
      ws.send(JSON.stringify({ type: "auth.failed", error: "Only owner can connect without token", timestamp: Date.now() }));
      return;
    }
  }

  if (!authenticatedUserId) {
    ws.send(JSON.stringify({ type: "auth.failed", error: "Invalid or expired session", timestamp: Date.now() }));
    return;
  }

  const clientInfo = connectedScreenClients.get(ws);
  if (clientInfo) {
    clientInfo.userId = authenticatedUserId;
    clientInfo.deviceId = message.deviceId || "unknown";
    ws.userId = authenticatedUserId;
    ws.deviceId = message.deviceId || "desktop-agent";
    ws.deviceName = message.deviceName || "Desktop Agent";
    ws.isAuthenticated = true;
    
    clearTimeout(authTimeout);
    delete (ws as any).authTimeout;

    console.log(`${LOG_PREFIX} Client authenticated: userId=${authenticatedUserId}, device=${ws.deviceId}`);
    
    ws.send(JSON.stringify({
      type: "auth.success",
      userId: authenticatedUserId,
      timestamp: Date.now()
    }));
  }
}

async function handleControl(ws: AuthenticatedScreenSocket, message: ScreenMonitorMessage) {
  if (!ws.userId) return;

  switch (message.action) {
    case "start":
      const session = await screenMonitorService.startSession(ws.userId, ws.deviceId!, ws.deviceName);
      ws.send(JSON.stringify({
        type: "session.started",
        sessionId: session.id,
        timestamp: Date.now()
      }));
      
      broadcastToUser(ws.userId, {
        type: "memory.updated" as any,
        userId: ws.userId,
        data: { event: "screen_monitor_started", deviceId: ws.deviceId },
        timestamp: Date.now()
      });
      break;

    case "pause":
      await screenMonitorService.pauseSession(ws.userId);
      ws.send(JSON.stringify({ type: "session.paused", timestamp: Date.now() }));
      break;

    case "resume":
      await screenMonitorService.resumeSession(ws.userId);
      ws.send(JSON.stringify({ type: "session.resumed", timestamp: Date.now() }));
      break;

    case "stop":
      await screenMonitorService.endSession(ws.userId);
      ws.send(JSON.stringify({ type: "session.ended", timestamp: Date.now() }));
      
      broadcastToUser(ws.userId, {
        type: "memory.updated" as any,
        userId: ws.userId,
        data: { event: "screen_monitor_stopped" },
        timestamp: Date.now()
      });
      break;
  }
}

async function handleFrame(ws: AuthenticatedScreenSocket, message: ScreenMonitorMessage) {
  if (!ws.userId || !message.frame) return;

  const frame: ScreenFrame = {
    imageBase64: message.frame.imageBase64,
    activeApp: message.frame.activeApp,
    activeWindow: message.frame.activeWindow,
    timestamp: message.frame.timestamp || Date.now()
  };

  notifyFrameWaiters(ws.userId, {
    imageBase64: frame.imageBase64,
    activeApp: frame.activeApp,
    activeWindow: frame.activeWindow,
    timestamp: frame.timestamp
  });

  const analysis = await screenMonitorService.processFrame(ws.userId, frame);

  if (analysis) {
    ws.send(JSON.stringify({
      type: "analysis",
      data: analysis,
      timestamp: Date.now()
    }));

    broadcastToUser(ws.userId, {
      type: "memory.updated" as any,
      userId: ws.userId,
      data: {
        event: "screen_context_update",
        context: analysis.context,
        tags: analysis.tags,
        suggestions: analysis.suggestions
      },
      timestamp: Date.now()
    });
  } else {
    ws.send(JSON.stringify({
      type: "frame.received",
      timestamp: Date.now()
    }));
  }
}

function handleCapability(ws: AuthenticatedScreenSocket, message: any) {
  if (!ws.userId) return;
  const capable = !!message.remoteControl;
  ws.remoteControlCapable = capable;
  console.log(`${LOG_PREFIX} Agent capability: remoteControl=${capable}, platform=${message.platform}`);

  broadcastToUser(ws.userId, {
    type: "memory.updated" as any,
    userId: ws.userId,
    data: {
      event: "screen_agent_capability",
      remoteControlCapable: capable,
      platform: message.platform,
      deviceId: ws.deviceId
    },
    timestamp: Date.now()
  });
}

function handleRemoteControlFeedback(ws: AuthenticatedScreenSocket, message: any) {
  if (!ws.userId) return;

  if (message.type === "remote_control.status") {
    ws.remoteControlEnabled = !!message.enabled;
    console.log(`${LOG_PREFIX} Remote control ${message.enabled ? "ENABLED" : "DISABLED"} for user ${ws.userId}`);
  }

  broadcastToUser(ws.userId, {
    type: "memory.updated" as any,
    userId: ws.userId,
    data: {
      event: message.type,
      enabled: message.enabled,
      cmd: message.cmd,
      success: message.success,
      msg: message.msg
    },
    timestamp: Date.now()
  });
}

export function sendRemoteControlCommand(userId: number, payload: object): boolean {
  const entries = Array.from(connectedScreenClients.entries());
  for (const [ws, info] of entries) {
    if (info.userId === userId) {
      try {
        ws.send(JSON.stringify({ ...payload, timestamp: Date.now() }));
        return true;
      } catch (e) {
        console.error(`${LOG_PREFIX} Failed to send command to agent:`, e);
        return false;
      }
    }
  }
  return false;
}

export function isAgentRemoteControlCapable(userId: number): boolean {
  const entries = Array.from(connectedScreenClients.entries());
  for (const [ws, info] of entries) {
    if (info.userId === userId) {
      return !!(ws as AuthenticatedScreenSocket).remoteControlCapable;
    }
  }
  return false;
}

export function isAgentRemoteControlEnabled(userId: number): boolean {
  const entries = Array.from(connectedScreenClients.entries());
  for (const [ws, info] of entries) {
    if (info.userId === userId) {
      return !!(ws as AuthenticatedScreenSocket).remoteControlEnabled;
    }
  }
  return false;
}

export function handleScreenUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
  if (screenWss) {
    screenWss.handleUpgrade(request, socket, head, (ws) => {
      screenWss!.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
}

export function getConnectedScreenClients(): Map<WebSocket, { userId?: number; deviceId?: string }> {
  return connectedScreenClients;
}

export function isUserScreenActive(userId: number): boolean {
  const entries = Array.from(connectedScreenClients.entries());
  for (const [, info] of entries) {
    if (info.userId === userId) {
      return true;
    }
  }
  return false;
}

export async function pauseUserSession(userId: number): Promise<void> {
  const entries = Array.from(connectedScreenClients.entries());
  for (const [ws, info] of entries) {
    if (info.userId === userId) {
      ws.send(JSON.stringify({ type: "session.paused", timestamp: Date.now() }));
    }
  }
  await screenMonitorService.pauseSession(userId);
}

export async function resumeUserSession(userId: number): Promise<void> {
  const entries = Array.from(connectedScreenClients.entries());
  for (const [ws, info] of entries) {
    if (info.userId === userId) {
      ws.send(JSON.stringify({ type: "session.resumed", timestamp: Date.now() }));
    }
  }
  await screenMonitorService.resumeSession(userId);
}

export async function stopUserSession(userId: number): Promise<void> {
  const entries = Array.from(connectedScreenClients.entries());
  for (const [ws, info] of entries) {
    if (info.userId === userId) {
      ws.send(JSON.stringify({ type: "session.ended", timestamp: Date.now() }));
    }
  }
}
