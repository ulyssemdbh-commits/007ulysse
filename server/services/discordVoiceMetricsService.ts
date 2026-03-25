import { db } from '../db';
import { ulysseMemory, conversations, messages } from '@shared/schema';
import { eq, sql, and, gte, desc } from 'drizzle-orm';

interface VoiceSessionMetrics {
  sessionId: string;
  guildId: string;
  channelId: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  transcriptionCount: number;
  ttsCount: number;
  sttErrors: number;
  ttsErrors: number;
  userInteractions: Map<string, UserVoiceStats>;
}

interface UserVoiceStats {
  discordId: string;
  username?: string;
  transcriptionCount: number;
  totalAudioDurationMs: number;
  topics: string[];
  lastInteraction: Date;
}

interface DiscordVoiceProfile {
  discordId: string;
  username?: string;
  totalSessions: number;
  totalTranscriptions: number;
  totalAudioDurationMs: number;
  avgSessionDurationMs: number;
  topTopics: { topic: string; count: number }[];
  lastInteraction: Date;
  firstInteraction: Date;
  preferredLanguage?: string;
}

interface GlobalVoiceMetrics {
  totalSessions: number;
  totalDurationMs: number;
  avgSessionDurationMs: number;
  totalTranscriptions: number;
  totalTTSResponses: number;
  sttErrorRate: number;
  ttsErrorRate: number;
  activeUsers: number;
  topUsers: { discordId: string; username?: string; count: number }[];
}

class DiscordVoiceMetricsService {
  private activeSessions: Map<string, VoiceSessionMetrics> = new Map();
  private sessionHistory: VoiceSessionMetrics[] = [];
  private userProfiles: Map<string, DiscordVoiceProfile> = new Map();
  private globalStats = {
    totalSessions: 0,
    totalTranscriptions: 0,
    totalTTS: 0,
    sttErrors: 0,
    ttsErrors: 0,
    totalDurationMs: 0
  };

  constructor() {
    console.log('[DiscordVoiceMetrics] Service initialized');
    this.loadFromBrain();
  }

  private async loadFromBrain(): Promise<void> {
    try {
      const memories = await db.select()
        .from(ulysseMemory)
        .where(eq(ulysseMemory.category, 'discord_voice_profile'));

      for (const memory of memories) {
        try {
          const profile = JSON.parse(memory.value);
          if (profile.discordId) {
            this.userProfiles.set(profile.discordId, {
              ...profile,
              lastInteraction: new Date(profile.lastInteraction),
              firstInteraction: new Date(profile.firstInteraction)
            });
          }
        } catch (e) {
          // Skip malformed entries
        }
      }

      const globalMemory = await db.select()
        .from(ulysseMemory)
        .where(
          and(
            eq(ulysseMemory.category, 'discord_voice_global'),
            eq(ulysseMemory.key, 'global_stats')
          )
        )
        .limit(1);

      if (globalMemory.length > 0) {
        try {
          const stats = JSON.parse(globalMemory[0].value);
          this.globalStats = { ...this.globalStats, ...stats };
        } catch (e) {
          // Use defaults
        }
      }

      console.log(`[DiscordVoiceMetrics] Loaded ${this.userProfiles.size} user profiles from Brain`);
    } catch (error: any) {
      console.error('[DiscordVoiceMetrics] Failed to load from Brain:', error.message);
    }
  }

  startSession(guildId: string, channelId: string): string {
    const sessionId = `voice_${guildId}_${Date.now()}`;
    
    const session: VoiceSessionMetrics = {
      sessionId,
      guildId,
      channelId,
      startTime: new Date(),
      transcriptionCount: 0,
      ttsCount: 0,
      sttErrors: 0,
      ttsErrors: 0,
      userInteractions: new Map()
    };

    this.activeSessions.set(guildId, session);
    this.globalStats.totalSessions++;
    
    console.log(`[DiscordVoiceMetrics] Session started: ${sessionId}`);
    return sessionId;
  }

  endSession(guildId: string): VoiceSessionMetrics | null {
    const session = this.activeSessions.get(guildId);
    if (!session) return null;

    session.endTime = new Date();
    session.durationMs = session.endTime.getTime() - session.startTime.getTime();
    
    this.globalStats.totalDurationMs += session.durationMs;
    
    this.sessionHistory.push(session);
    if (this.sessionHistory.length > 100) {
      this.sessionHistory.shift();
    }

    this.activeSessions.delete(guildId);
    
    // Update user profiles
    const entries = Array.from(session.userInteractions.entries());
    for (const [discordId, stats] of entries) {
      this.updateUserProfile(discordId, stats, session);
    }

    // Persist to brain (fire and forget with error handling)
    this.saveToBrain().catch(err => {
      console.error('[DiscordVoiceMetrics] Failed to persist session:', err.message);
    });

    console.log(`[DiscordVoiceMetrics] Session ended: ${session.sessionId}, duration: ${session.durationMs}ms`);
    return session;
  }

  recordTranscription(
    guildId: string, 
    discordId: string, 
    transcription: string, 
    audioDurationMs: number,
    username?: string
  ): void {
    const session = this.activeSessions.get(guildId);
    if (!session) return;

    session.transcriptionCount++;
    this.globalStats.totalTranscriptions++;

    let userStats = session.userInteractions.get(discordId);
    if (!userStats) {
      userStats = {
        discordId,
        username,
        transcriptionCount: 0,
        totalAudioDurationMs: 0,
        topics: [],
        lastInteraction: new Date()
      };
      session.userInteractions.set(discordId, userStats);
    }

    userStats.transcriptionCount++;
    userStats.totalAudioDurationMs += audioDurationMs;
    userStats.lastInteraction = new Date();
    if (username) userStats.username = username;

    // Extract topics from transcription (simple keyword extraction)
    const topics = this.extractTopics(transcription);
    userStats.topics.push(...topics);

    console.log(`[DiscordVoiceMetrics] Transcription recorded for ${discordId}: "${transcription.substring(0, 50)}..."`);
  }

  recordTTS(guildId: string): void {
    const session = this.activeSessions.get(guildId);
    if (session) {
      session.ttsCount++;
    }
    this.globalStats.totalTTS++;
  }

  recordSTTError(guildId: string): void {
    const session = this.activeSessions.get(guildId);
    if (session) {
      session.sttErrors++;
    }
    this.globalStats.sttErrors++;
  }

  recordTTSError(guildId: string): void {
    const session = this.activeSessions.get(guildId);
    if (session) {
      session.ttsErrors++;
    }
    this.globalStats.ttsErrors++;
  }

  private extractTopics(text: string): string[] {
    const topics: string[] = [];
    const lowerText = text.toLowerCase();

    const topicKeywords: Record<string, string[]> = {
      'football': ['foot', 'match', 'équipe', 'joueur', 'ligue', 'champion', 'but', 'gardien', 'om', 'psg', 'marseille'],
      'météo': ['météo', 'temps', 'pluie', 'soleil', 'température', 'chaud', 'froid'],
      'musique': ['musique', 'chanson', 'spotify', 'playlist', 'artiste', 'album'],
      'travail': ['travail', 'boulot', 'projet', 'réunion', 'deadline', 'boss'],
      'famille': ['famille', 'enfant', 'parent', 'frère', 'soeur', 'maman', 'papa'],
      'tech': ['code', 'bug', 'app', 'site', 'serveur', 'api', 'discord'],
      'sport': ['sport', 'tennis', 'basket', 'nba', 'rugby', 'f1', 'course'],
      'paris': ['pari', 'cote', 'pronostic', 'bet', 'mise'],
      'actualité': ['news', 'actualité', 'info', 'politique', 'économie'],
      'divertissement': ['film', 'série', 'netflix', 'jeu', 'game', 'youtube']
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => lowerText.includes(kw))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  private updateUserProfile(
    discordId: string, 
    sessionStats: UserVoiceStats, 
    session: VoiceSessionMetrics
  ): void {
    let profile = this.userProfiles.get(discordId);
    
    if (!profile) {
      profile = {
        discordId,
        username: sessionStats.username,
        totalSessions: 0,
        totalTranscriptions: 0,
        totalAudioDurationMs: 0,
        avgSessionDurationMs: 0,
        topTopics: [],
        lastInteraction: new Date(),
        firstInteraction: new Date()
      };
    }

    profile.totalSessions++;
    profile.totalTranscriptions += sessionStats.transcriptionCount;
    profile.totalAudioDurationMs += sessionStats.totalAudioDurationMs;
    profile.lastInteraction = sessionStats.lastInteraction;
    if (sessionStats.username) profile.username = sessionStats.username;

    // Update average session duration
    const sessionDuration = session.durationMs || 0;
    profile.avgSessionDurationMs = 
      (profile.avgSessionDurationMs * (profile.totalSessions - 1) + sessionDuration) / profile.totalSessions;

    // Update topic counts
    const topicCounts = new Map<string, number>();
    for (const existing of profile.topTopics) {
      topicCounts.set(existing.topic, existing.count);
    }
    for (const topic of sessionStats.topics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }
    
    profile.topTopics = Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    this.userProfiles.set(discordId, profile);
  }

  private async saveToBrain(): Promise<void> {
    try {
      // Save global stats - use upsert pattern (delete old, insert new)
      await db.delete(ulysseMemory)
        .where(
          and(
            eq(ulysseMemory.userId, 1),
            eq(ulysseMemory.category, 'discord_voice_global'),
            eq(ulysseMemory.key, 'global_stats')
          )
        );
      
      await db.insert(ulysseMemory)
        .values({
          userId: 1,
          category: 'discord_voice_global',
          key: 'global_stats',
          value: JSON.stringify(this.globalStats),
          confidence: 100,
          source: 'discord_voice_metrics'
        });

      // Save user profiles
      for (const [discordId, profile] of this.userProfiles) {
        const key = `discord_user_${discordId}`;
        
        await db.delete(ulysseMemory)
          .where(
            and(
              eq(ulysseMemory.userId, 1),
              eq(ulysseMemory.category, 'discord_voice_profile'),
              eq(ulysseMemory.key, key)
            )
          );
        
        await db.insert(ulysseMemory)
          .values({
            userId: 1,
            category: 'discord_voice_profile',
            key,
            value: JSON.stringify(profile),
            confidence: 100,
            source: 'discord_voice_metrics'
          });
      }

      console.log('[DiscordVoiceMetrics] Saved to Brain');
    } catch (error: any) {
      console.error('[DiscordVoiceMetrics] Failed to save to Brain:', error.message);
    }
  }

  getGlobalMetrics(): GlobalVoiceMetrics {
    const sttErrorRate = this.globalStats.totalTranscriptions > 0 
      ? (this.globalStats.sttErrors / this.globalStats.totalTranscriptions) * 100 
      : 0;
    
    const ttsErrorRate = this.globalStats.totalTTS > 0 
      ? (this.globalStats.ttsErrors / this.globalStats.totalTTS) * 100 
      : 0;

    const avgSessionDuration = this.globalStats.totalSessions > 0 
      ? this.globalStats.totalDurationMs / this.globalStats.totalSessions 
      : 0;

    const topUsers = Array.from(this.userProfiles.values())
      .sort((a, b) => b.totalTranscriptions - a.totalTranscriptions)
      .slice(0, 5)
      .map(p => ({ 
        discordId: p.discordId, 
        username: p.username, 
        count: p.totalTranscriptions 
      }));

    return {
      totalSessions: this.globalStats.totalSessions,
      totalDurationMs: this.globalStats.totalDurationMs,
      avgSessionDurationMs: avgSessionDuration,
      totalTranscriptions: this.globalStats.totalTranscriptions,
      totalTTSResponses: this.globalStats.totalTTS,
      sttErrorRate,
      ttsErrorRate,
      activeUsers: this.userProfiles.size,
      topUsers
    };
  }

  getUserProfile(discordId: string): DiscordVoiceProfile | null {
    return this.userProfiles.get(discordId) || null;
  }

  getAllProfiles(): DiscordVoiceProfile[] {
    return Array.from(this.userProfiles.values())
      .sort((a, b) => b.totalTranscriptions - a.totalTranscriptions);
  }

  getActiveSession(guildId: string): VoiceSessionMetrics | null {
    return this.activeSessions.get(guildId) || null;
  }

  getRecentSessions(limit: number = 10): VoiceSessionMetrics[] {
    return this.sessionHistory.slice(-limit).reverse();
  }

  generateBrainContext(discordId: string): string {
    const profile = this.userProfiles.get(discordId);
    if (!profile) return '';

    const topTopics = profile.topTopics.slice(0, 3).map(t => t.topic).join(', ');
    const avgDuration = Math.round(profile.avgSessionDurationMs / 1000 / 60);
    
    return `[Profil Discord Vocal] ${profile.username || discordId}: ` +
      `${profile.totalSessions} sessions, ${profile.totalTranscriptions} messages vocaux, ` +
      `durée moyenne ${avgDuration}min, sujets favoris: ${topTopics || 'divers'}`;
  }
}

export const discordVoiceMetrics = new DiscordVoiceMetricsService();
