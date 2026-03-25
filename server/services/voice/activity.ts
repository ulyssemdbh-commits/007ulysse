/**
 * Voice Activity Service - Enhanced Version
 * Tracks voice activity, sessions, and authentication status per user
 */

export type VoiceEventType =
  | "transcript"
  | "response"
  | "speaker_rejected"
  | "speaker_verified"
  | "error";

export type VoiceAuthLevel = "reject" | "limited" | "full";

export interface VoiceEvent {
  type: VoiceEventType;
  timestamp: Date;
  content: string;
  confidence?: number;
  persona?: "ulysse" | "iris" | "alfred";
  speakerId?: string;
  authLevel?: VoiceAuthLevel;
  sessionId?: string;
}

export interface UserVoiceActivity {
  events: VoiceEvent[];
  lastActivity: Date;
  isCurrentlyInCall: boolean;
  currentSessionId: string | null;
  lastAuthLevel: VoiceAuthLevel | null;
  lastAuthConfidence: number | null;
}

const MAX_EVENTS_PER_USER = 40;
const ACTIVITY_EXPIRY_MS = 30 * 60 * 1000;

function generateSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class VoiceActivityService {
  private activities: Map<number, UserVoiceActivity> = new Map();

  private getOrCreateActivity(userId: number): UserVoiceActivity {
    let activity = this.activities.get(userId);
    if (!activity) {
      activity = {
        events: [],
        lastActivity: new Date(),
        isCurrentlyInCall: false,
        currentSessionId: null,
        lastAuthLevel: null,
        lastAuthConfidence: null,
      };
      this.activities.set(userId, activity);
    }
    return activity;
  }

  logEvent(
    userId: number,
    event: Omit<VoiceEvent, "timestamp" | "sessionId"> & { sessionId?: string | null }
  ) {
    const activity = this.getOrCreateActivity(userId);

    const sessionId =
      event.sessionId ??
      activity.currentSessionId ??
      (activity.isCurrentlyInCall ? generateSessionId() : null);

    if (!activity.currentSessionId && sessionId) {
      activity.currentSessionId = sessionId;
    }

    const fullEvent: VoiceEvent = {
      ...event,
      timestamp: new Date(),
      sessionId: sessionId || undefined,
    };

    activity.events.push(fullEvent);

    if (activity.events.length > MAX_EVENTS_PER_USER) {
      activity.events = activity.events.slice(-MAX_EVENTS_PER_USER);
    }

    activity.lastActivity = new Date();

    if (event.type === "speaker_verified") {
      activity.lastAuthLevel = event.authLevel ?? "full";
      activity.lastAuthConfidence = event.confidence ?? null;
    } else if (event.type === "speaker_rejected") {
      activity.lastAuthLevel = "reject";
      activity.lastAuthConfidence = event.confidence ?? null;
    }
  }

  setInCall(userId: number, inCall: boolean) {
    const activity = this.getOrCreateActivity(userId);
    activity.isCurrentlyInCall = inCall;
    activity.lastActivity = new Date();

    if (inCall && !activity.currentSessionId) {
      activity.currentSessionId = generateSessionId();
    }

    if (!inCall) {
      activity.currentSessionId = null;
      activity.lastAuthLevel = null;
      activity.lastAuthConfidence = null;
    }
  }

  getRecentActivity(userId: number, limitMinutes: number = 10): VoiceEvent[] {
    const activity = this.activities.get(userId);
    if (!activity) return [];

    const cutoff = new Date(Date.now() - limitMinutes * 60 * 1000);
    return activity.events.filter((e) => e.timestamp > cutoff);
  }

  isUserInCall(userId: number): boolean {
    const activity = this.activities.get(userId);
    if (!activity) return false;

    const recentThreshold = new Date(Date.now() - 5 * 60 * 1000);
    if (activity.lastActivity < recentThreshold) {
      activity.isCurrentlyInCall = false;
      activity.currentSessionId = null;
    }

    return activity.isCurrentlyInCall;
  }

  getLastAuthLevel(userId: number): { level: VoiceAuthLevel | null; confidence: number | null } {
    const activity = this.activities.get(userId);
    if (!activity) return { level: null, confidence: null };
    return {
      level: activity.lastAuthLevel,
      confidence: activity.lastAuthConfidence,
    };
  }

  getContextForChat(userId: number): string | null {
    const activity = this.activities.get(userId);
    const recentEvents = this.getRecentActivity(userId, 10);
    if (!activity || recentEvents.length === 0) return null;

    const inCall = this.isUserInCall(userId);
    const lastAuthLevel = activity.lastAuthLevel;
    const lastAuthConf = activity.lastAuthConfidence;

    const lines: string[] = [];

    lines.push(
      `### Activité Vocale Récente (${inCall ? "EN APPEL" : "pas en appel"})`
    );

    if (lastAuthLevel) {
      const confStr =
        lastAuthConf !== null
          ? `${Math.round((lastAuthConf || 0) * 100)}%`
          : "N/A";
      lines.push(
        `- Dernier statut de reconnaissance vocale: **${lastAuthLevel.toUpperCase()}** (confiance: ${confStr})`
      );
    }

    lines.push("");

    for (const event of recentEvents.slice(-5)) {
      const time = event.timestamp.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      switch (event.type) {
        case "transcript":
          lines.push(`- [${time}] Maurice a dit: "${event.content}"`);
          break;
        case "response":
          lines.push(
            `- [${time}] Tu as répondu: "${event.content.substring(0, 100)}${
              event.content.length > 100 ? "..." : ""
            }"`
          );
          break;
        case "speaker_rejected":
          lines.push(
            `- [${time}] [WARN] Voix non reconnue (confiance: ${Math.round(
              (event.confidence || 0) * 100
            )}%) - "${event.content}"`
          );
          break;
        case "speaker_verified":
          lines.push(
            `- [${time}] [OK] Voix de Maurice confirmée (confiance: ${Math.round(
              (event.confidence || 0) * 100
            )}%)`
          );
          break;
        case "error":
          lines.push(`- [${time}] [ERR] Erreur vocale: ${event.content}`);
          break;
      }
    }

    return lines.join("\n");
  }

  getActiveVoiceUsers(): Array<{
    userId: number;
    inCall: boolean;
    lastActivity: Date;
    lastAuthLevel: VoiceAuthLevel | null;
  }> {
    const res: Array<{
      userId: number;
      inCall: boolean;
      lastActivity: Date;
      lastAuthLevel: VoiceAuthLevel | null;
    }> = [];
    for (const [userId, activity] of this.activities.entries()) {
      res.push({
        userId,
        inCall: this.isUserInCall(userId),
        lastActivity: activity.lastActivity,
        lastAuthLevel: activity.lastAuthLevel,
      });
    }
    return res;
  }

  cleanup() {
    const now = Date.now();
    for (const [userId, activity] of this.activities.entries()) {
      if (now - activity.lastActivity.getTime() > ACTIVITY_EXPIRY_MS) {
        this.activities.delete(userId);
      }
    }
  }
}

export const voiceActivityService = new VoiceActivityService();

setInterval(() => {
  voiceActivityService.cleanup();
}, 10 * 60 * 1000);
