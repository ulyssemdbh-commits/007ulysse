import { randomUUID } from "crypto";
import { EventEmitter } from "events";

export type VoiceSessionState = "idle" | "listening" | "thinking" | "speaking";

export interface VoiceSessionInfo {
  sessionId: string;
  userId?: number;
  userName?: string;
  persona: "ulysse" | "iris" | "alfred";
  channel: "talking-v2" | "talking-v1" | "chat";
  state: VoiceSessionState;
  createdAt: number;
  lastActivity: number;
  conversationId?: number;
  metadata: Record<string, any>;
}

export interface VoiceSessionEvent {
  sessionId: string;
  type: string;
  data: Record<string, any>;
  timestamp: number;
}

class VoiceSessionManager extends EventEmitter {
  private sessions = new Map<string, VoiceSessionInfo>();
  private wsToSession = new Map<any, string>();
  private cleanupInterval: NodeJS.Timeout;

  private static SESSION_TTL = 30 * 60 * 1000;
  private static CLEANUP_INTERVAL = 60 * 1000;

  constructor() {
    super();
    this.setMaxListeners(200);

    this.cleanupInterval = setInterval(() => this.cleanup(), VoiceSessionManager.CLEANUP_INTERVAL);
  }

  createSession(ws: any, opts: {
    userId?: number;
    userName?: string;
    persona?: "ulysse" | "iris" | "alfred";
    channel?: "talking-v2" | "talking-v1" | "chat";
    conversationId?: number;
  } = {}): string {
    const sessionId = randomUUID();
    const now = Date.now();

    const session: VoiceSessionInfo = {
      sessionId,
      userId: opts.userId,
      userName: opts.userName,
      persona: opts.persona || "ulysse",
      channel: opts.channel || "chat",
      state: "idle",
      createdAt: now,
      lastActivity: now,
      conversationId: opts.conversationId,
      metadata: {},
    };

    this.sessions.set(sessionId, session);
    this.wsToSession.set(ws, sessionId);

    this.broadcast(sessionId, "session_created", { sessionId, persona: session.persona, channel: session.channel });
    return sessionId;
  }

  getSession(sessionId: string): VoiceSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByWs(ws: any): VoiceSessionInfo | undefined {
    const sid = this.wsToSession.get(ws);
    return sid ? this.sessions.get(sid) : undefined;
  }

  getSessionIdByWs(ws: any): string | undefined {
    return this.wsToSession.get(ws);
  }

  updateSession(sessionId: string, updates: Partial<VoiceSessionInfo>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    Object.assign(session, updates, { lastActivity: Date.now() });
  }

  transition(sessionId: string, newState: VoiceSessionState, extra: Record<string, any> = {}): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const oldState = session.state;
    if (oldState === newState) return;

    session.state = newState;
    session.lastActivity = Date.now();

    this.broadcast(sessionId, "state_change", { from: oldState, to: newState, ...extra });
  }

  sendTranscript(sessionId: string, text: string, isFinal: boolean): void {
    this.touch(sessionId);
    this.broadcast(sessionId, isFinal ? "transcript_final" : "transcript_partial", { text });
  }

  sendResponseChunk(sessionId: string, text: string): void {
    this.touch(sessionId);
    this.broadcast(sessionId, "response_chunk", { text });
  }

  sendResponseFull(sessionId: string, text: string, domain?: string): void {
    this.touch(sessionId);
    this.broadcast(sessionId, "response_full", { text, domain });
  }

  sendProgress(sessionId: string, message: string, detail?: string): void {
    this.touch(sessionId);
    this.broadcast(sessionId, "progress", { message, detail });
  }

  sendUIAction(sessionId: string, action: string, data: any): void {
    this.touch(sessionId);
    this.broadcast(sessionId, "ui_action", { action, data });
  }

  sendSystemCommand(sessionId: string, command: string, data: any): void {
    this.touch(sessionId);
    this.broadcast(sessionId, "system_command", { command, data });
  }

  sendError(sessionId: string, message: string): void {
    this.touch(sessionId);
    this.broadcast(sessionId, "error", { message });
  }

  sendDone(sessionId: string): void {
    this.touch(sessionId);
    this.broadcast(sessionId, "done", {});
  }

  removeSession(ws: any): void {
    const sid = this.wsToSession.get(ws);
    if (sid) {
      this.broadcast(sid, "session_closed", {});
      this.sessions.delete(sid);
      this.wsToSession.delete(ws);
    }
  }

  private touch(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.lastActivity = Date.now();
  }

  private broadcast(sessionId: string, type: string, data: Record<string, any>): void {
    const event: VoiceSessionEvent = {
      sessionId,
      type,
      data,
      timestamp: Date.now(),
    };
    this.emit(`session:${sessionId}`, event);
    this.emit("session_event", event);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sid, session] of this.sessions) {
      if (now - session.lastActivity > VoiceSessionManager.SESSION_TTL) {
        this.broadcast(sid, "session_expired", {});
        this.sessions.delete(sid);
        for (const [ws, wsid] of this.wsToSession) {
          if (wsid === sid) this.wsToSession.delete(ws);
        }
      }
    }
  }

  getStats(): { activeSessions: number; byChannel: Record<string, number>; byState: Record<string, number> } {
    const byChannel: Record<string, number> = {};
    const byState: Record<string, number> = {};
    for (const s of this.sessions.values()) {
      byChannel[s.channel] = (byChannel[s.channel] || 0) + 1;
      byState[s.state] = (byState[s.state] || 0) + 1;
    }
    return { activeSessions: this.sessions.size, byChannel, byState };
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
    this.wsToSession.clear();
    this.removeAllListeners();
  }
}

export const voiceSessionManager = new VoiceSessionManager();
