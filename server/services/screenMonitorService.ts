import { db } from "../db";
import { 
  screenMonitorPreferences, 
  screenMonitorSessions, 
  screenContextEvents,
  screenWorkPatterns,
  ulysseMemory,
  learningLog
} from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import OpenAI from "openai";
import { broadcastToUser } from "./realtimeSync";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const LOG_PREFIX = "[ScreenMonitor]";

// Session Profile Types - Intelligent categorization of user activity
export type SessionProfile = 
  | "focus_dev"      // VSCode, terminals, documentation - deep coding work
  | "focus_business" // Mail, Notion, Todoist, spreadsheets - business tasks
  | "learning"       // Educational content, tutorials, documentation
  | "trading"        // Financial apps, trading platforms, market analysis
  | "sports"         // Betting sites, sports stats, match tracking
  | "entertainment"  // YouTube, Netflix, social media, games
  | "admin"          // Banking, invoices, Sugu tools
  | "creative"       // Design tools, media editing
  | "communication"  // Messaging, video calls, emails
  | "mixed";         // No clear pattern

export interface SessionProfileResult {
  profile: SessionProfile;
  score: number;           // 0-100 confidence in this profile
  subProfiles: { profile: SessionProfile; score: number }[];
  focusLevel: "deep" | "moderate" | "scattered";
  windowSwitchRate: number; // switches per minute
  recommendation?: string;
}

// App categorization for profile detection
const APP_PROFILES: Record<string, SessionProfile[]> = {
  // Development
  "vscode": ["focus_dev"],
  "code": ["focus_dev"],
  "visual studio": ["focus_dev"],
  "webstorm": ["focus_dev"],
  "intellij": ["focus_dev"],
  "pycharm": ["focus_dev"],
  "terminal": ["focus_dev"],
  "powershell": ["focus_dev"],
  "cmd": ["focus_dev"],
  "git": ["focus_dev"],
  "github": ["focus_dev", "learning"],
  "stackoverflow": ["focus_dev", "learning"],
  "replit": ["focus_dev"],
  
  // Business
  "outlook": ["focus_business", "communication"],
  "gmail": ["focus_business", "communication"],
  "notion": ["focus_business", "learning"],
  "todoist": ["focus_business"],
  "slack": ["focus_business", "communication"],
  "teams": ["focus_business", "communication"],
  "excel": ["focus_business", "admin"],
  "sheets": ["focus_business", "admin"],
  "word": ["focus_business"],
  "docs": ["focus_business"],
  "trello": ["focus_business"],
  "asana": ["focus_business"],
  "jira": ["focus_business", "focus_dev"],
  
  // Admin
  "banque": ["admin"],
  "bank": ["admin"],
  "paypal": ["admin"],
  "stripe": ["admin"],
  "invoice": ["admin"],
  "facture": ["admin"],
  "sugu": ["admin"],
  
  // Trading
  "tradingview": ["trading"],
  "binance": ["trading"],
  "coinbase": ["trading"],
  "etoro": ["trading"],
  "degiro": ["trading"],
  "boursorama": ["trading"],
  "yahoo finance": ["trading"],
  "investing": ["trading"],
  
  // Sports/Betting
  "bet365": ["sports"],
  "unibet": ["sports"],
  "winamax": ["sports"],
  "betclic": ["sports"],
  "flashscore": ["sports"],
  "sofascore": ["sports"],
  "livescore": ["sports"],
  "matchendirect": ["sports"],
  "footmercato": ["sports"],
  "lequipe": ["sports"],
  
  // Entertainment
  "youtube": ["entertainment", "learning"],
  "netflix": ["entertainment"],
  "twitch": ["entertainment"],
  "spotify": ["entertainment"],
  "discord": ["entertainment", "communication"],
  "twitter": ["entertainment"],
  "facebook": ["entertainment", "communication"],
  "instagram": ["entertainment"],
  "reddit": ["entertainment", "learning"],
  "tiktok": ["entertainment"],
  
  // Learning
  "udemy": ["learning"],
  "coursera": ["learning"],
  "pluralsight": ["learning"],
  "documentation": ["learning", "focus_dev"],
  "mdn": ["learning", "focus_dev"],
  "wikipedia": ["learning"],
  
  // Creative
  "figma": ["creative"],
  "photoshop": ["creative"],
  "illustrator": ["creative"],
  "premiere": ["creative"],
  "davinci": ["creative"],
  "canva": ["creative"],
  
  // Communication
  "zoom": ["communication"],
  "meet": ["communication"],
  "whatsapp": ["communication"],
  "messenger": ["communication"],
  "signal": ["communication"],
  "telegram": ["communication"]
};

export interface ScreenFrame {
  imageBase64: string;
  activeApp?: string;
  activeWindow?: string;
  timestamp: number;
}

export interface ScreenAnalysis {
  context: string;
  tags: string[];
  confidence: number;
  suggestions?: string[];
}

export class ScreenMonitorService {
  private static instance: ScreenMonitorService;
  private activeSessions = new Map<number, { sessionId: number; lastAnalysis: number; frameBuffer: ScreenFrame[]; recentAnalyses: string[] }>();
  private analysisInterval = 15000;
  private maxBufferSize = 10;
  private maxRecentAnalyses = 5;

  static getInstance(): ScreenMonitorService {
    if (!ScreenMonitorService.instance) {
      ScreenMonitorService.instance = new ScreenMonitorService();
    }
    return ScreenMonitorService.instance;
  }

  async getPreferences(userId: number) {
    const [prefs] = await db.select()
      .from(screenMonitorPreferences)
      .where(eq(screenMonitorPreferences.userId, userId))
      .limit(1);
    return prefs;
  }

  async ensurePreferencesEnabled(userId: number) {
    const prefs = await this.getPreferences(userId);
    if (!prefs) {
      await db.insert(screenMonitorPreferences)
        .values({ userId, isEnabled: true })
        .returning();
      console.log(`${LOG_PREFIX} Auto-created preferences for user ${userId} (enabled)`);
    } else if (!prefs.isEnabled) {
      await db.update(screenMonitorPreferences)
        .set({ isEnabled: true, updatedAt: new Date() })
        .where(eq(screenMonitorPreferences.userId, userId));
      console.log(`${LOG_PREFIX} Auto-enabled preferences for user ${userId}`);
    }
  }

  async setPreferences(userId: number, data: Partial<typeof screenMonitorPreferences.$inferInsert>) {
    const existing = await this.getPreferences(userId);
    
    if (existing) {
      const [updated] = await db.update(screenMonitorPreferences)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(screenMonitorPreferences.userId, userId))
        .returning();
      return updated;
    }
    
    const [created] = await db.insert(screenMonitorPreferences)
      .values({ userId, ...data })
      .returning();
    return created;
  }

  async ensurePersistentSession(userId: number, deviceId: string, deviceName?: string) {
    const existing = this.activeSessions.get(userId);
    if (existing) {
      const [sess] = await db.select()
        .from(screenMonitorSessions)
        .where(and(eq(screenMonitorSessions.id, existing.sessionId), eq(screenMonitorSessions.status, "active")))
        .limit(1);
      if (sess) {
        console.log(`${LOG_PREFIX} Reusing existing session #${sess.id} for user ${userId}`);
        return sess;
      }
    }
    return this.startSession(userId, deviceId, deviceName);
  }

  async startSession(userId: number, deviceId: string, deviceName?: string) {
    await this.endActiveSessions(userId);

    const [session] = await db.insert(screenMonitorSessions)
      .values({
        userId,
        deviceId,
        deviceName,
        status: "active",
        totalFrames: 0,
        totalAnalyses: 0
      })
      .returning();

    this.activeSessions.set(userId, {
      sessionId: session.id,
      lastAnalysis: Date.now(),
      frameBuffer: [],
      recentAnalyses: []
    });

    console.log(`${LOG_PREFIX} Session started for user ${userId}, device ${deviceId}`);
    return session;
  }

  async endSession(userId: number) {
    const sessionData = this.activeSessions.get(userId);
    if (sessionData) {
      await db.update(screenMonitorSessions)
        .set({ 
          status: "ended", 
          endedAt: new Date() 
        })
        .where(eq(screenMonitorSessions.id, sessionData.sessionId));
      
      this.activeSessions.delete(userId);
      console.log(`${LOG_PREFIX} Session ended for user ${userId}`);
    }
    return { success: true };
  }

  async pauseSession(userId: number) {
    const sessionData = this.activeSessions.get(userId);
    if (sessionData) {
      await db.update(screenMonitorSessions)
        .set({ status: "paused" })
        .where(eq(screenMonitorSessions.id, sessionData.sessionId));
      console.log(`${LOG_PREFIX} Session paused for user ${userId}`);
    }
    return { success: true };
  }

  async resumeSession(userId: number) {
    const sessionData = this.activeSessions.get(userId);
    if (sessionData) {
      await db.update(screenMonitorSessions)
        .set({ status: "active" })
        .where(eq(screenMonitorSessions.id, sessionData.sessionId));
      console.log(`${LOG_PREFIX} Session resumed for user ${userId}`);
    }
    return { success: true };
  }

  private async endActiveSessions(userId: number) {
    await db.update(screenMonitorSessions)
      .set({ status: "ended", endedAt: new Date() })
      .where(and(
        eq(screenMonitorSessions.userId, userId),
        eq(screenMonitorSessions.status, "active")
      ));
  }

  async processFrame(userId: number, frame: ScreenFrame): Promise<ScreenAnalysis | null> {
    const sessionData = this.activeSessions.get(userId);
    if (!sessionData) {
      console.log(`${LOG_PREFIX} No active session for user ${userId}`);
      return null;
    }

    sessionData.frameBuffer.push(frame);
    if (sessionData.frameBuffer.length > this.maxBufferSize) {
      sessionData.frameBuffer.shift();
    }

    await db.update(screenMonitorSessions)
      .set({ totalFrames: sql`${screenMonitorSessions.totalFrames} + 1` })
      .where(eq(screenMonitorSessions.id, sessionData.sessionId));

    const now = Date.now();
    if (now - sessionData.lastAnalysis < this.analysisInterval) {
      return null;
    }

    sessionData.lastAnalysis = now;

    try {
      const analysis = await this.analyzeScreen(frame, sessionData.recentAnalyses);

      if (this.isDuplicateAnalysis(analysis.context, sessionData.recentAnalyses)) {
        return null;
      }

      sessionData.recentAnalyses.push(analysis.context);
      if (sessionData.recentAnalyses.length > this.maxRecentAnalyses) {
        sessionData.recentAnalyses.shift();
      }
      
      await db.insert(screenContextEvents).values({
        userId,
        sessionId: sessionData.sessionId,
        activeApp: frame.activeApp,
        activeWindow: this.sanitizeWindowTitle(frame.activeWindow),
        context: analysis.context,
        tags: analysis.tags,
        confidence: analysis.confidence
      });

      await db.update(screenMonitorSessions)
        .set({ totalAnalyses: sql`${screenMonitorSessions.totalAnalyses} + 1` })
        .where(eq(screenMonitorSessions.id, sessionData.sessionId));

      await this.updateWorkPatterns(userId, frame, analysis);
      
      await this.logScreenLearning(userId, analysis, frame);
      
      await this.checkAndSyncSignificantPatterns(userId);

      console.log(`${LOG_PREFIX} Analyzed screen for user ${userId}: ${analysis.context.substring(0, 150)}`);
      return analysis;
    } catch (error) {
      console.error(`${LOG_PREFIX} Analysis error:`, error);
      return null;
    }
  }

  private isDuplicateAnalysis(newContext: string, recentAnalyses: string[]): boolean {
    if (recentAnalyses.length === 0) return false;
    const lastAnalysis = recentAnalyses[recentAnalyses.length - 1];
    const newWords = new Set(newContext.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const lastWords = new Set(lastAnalysis.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (newWords.size === 0 || lastWords.size === 0) return false;
    let overlap = 0;
    for (const w of newWords) { if (lastWords.has(w)) overlap++; }
    const similarity = overlap / Math.max(newWords.size, lastWords.size);
    return similarity > 0.7;
  }

  private async analyzeScreen(frame: ScreenFrame, recentAnalyses: string[]): Promise<ScreenAnalysis> {
    const historyContext = recentAnalyses.length > 0
      ? `\n\nAnalyses précédentes (NE PAS répéter):\n${recentAnalyses.slice(-3).map((a, i) => `${i + 1}. ${a}`).join("\n")}`
      : "";

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: `Tu es Ulysse, un assistant IA qui observe l'écran de Maurice pour comprendre précisément son activité.

RÈGLES D'ANALYSE :
1. LIS le texte visible à l'écran — noms de fichiers, titres d'onglets, contenu des cellules, URLs, noms de menus
2. IDENTIFIE les données spécifiques : noms de produits, montants, dates, noms de fournisseurs, noms de clients
3. DÉCRIS l'action en cours avec PRÉCISION : "Édite la ligne 45 du fichier tarifs_fournisseur_metro.xlsx, colonne Prix HT" plutôt que "travaille sur Excel"
4. Si c'est un tableur : lis les en-têtes de colonnes, le nom de la feuille, les données visibles
5. Si c'est un navigateur : lis l'URL, le titre de la page, le contenu principal
6. Si c'est du code : identifie le langage, le fichier, la fonction en cours d'édition
7. JAMAIS de descriptions vagues comme "travaille sur un fichier" ou "consulte une feuille de calcul"

TAGS DISPONIBLES (choisis 2-4 les plus pertinents) :
- coding, devops, terminal, git
- browsing, research, documentation, learning
- spreadsheet, accounting, invoicing, pricing, inventory
- restaurant_management, food_ordering, supplier, menu_planning
- email, messaging, calendar, communication, video_call
- trading, finance, banking, crypto
- sports, betting, analytics
- design, media, creative
- entertainment, social_media, gaming
- admin, hr, payroll, legal
- writing, notes, planning, project_management

SUGGESTIONS : Donne 1-2 suggestions UTILES et SPÉCIFIQUES au contexte observé (pas de généralités).

Réponds UNIQUEMENT en JSON : {"context": "description précise et détaillée (3-4 phrases)", "tags": ["tag1", "tag2", "tag3"], "confidence": 0.85, "suggestions": ["suggestion spécifique"]}${historyContext}`
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${frame.imageBase64}`,
                detail: "auto"
              }
            },
            {
              type: "text",
              text: `App: ${frame.activeApp || 'inconnue'} | Fenêtre: ${frame.activeWindow || 'inconnue'} | Heure: ${new Date().toLocaleTimeString('fr-FR')}`
            }
          ]
        }
      ]
    });

    const content = response.choices[0]?.message?.content || "";
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          context: parsed.context || "Activité non identifiée",
          tags: parsed.tags || ["unknown"],
          confidence: parsed.confidence || 0.5,
          suggestions: parsed.suggestions
        };
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} Failed to parse analysis:`, e);
    }

    return {
      context: content.substring(0, 300) || "Activité en cours",
      tags: ["unknown"],
      confidence: 0.5
    };
  }

  private sanitizeWindowTitle(title?: string): string | undefined {
    if (!title) return undefined;
    
    const sensitivePatterns = [
      /password/i,
      /mot de passe/i,
      /connexion/i,
      /login/i,
      /bank/i,
      /banque/i,
      /credit/i,
      /paypal/i,
      /stripe/i
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(title)) {
        return "[Contenu sensible masqué]";
      }
    }

    return title.substring(0, 100);
  }

  private async updateWorkPatterns(userId: number, frame: ScreenFrame, analysis: ScreenAnalysis) {
    if (!frame.activeApp) return;

    const existingPattern = await db.select()
      .from(screenWorkPatterns)
      .where(and(
        eq(screenWorkPatterns.userId, userId),
        eq(screenWorkPatterns.patternType, "app_usage"),
        eq(screenWorkPatterns.patternName, frame.activeApp)
      ))
      .limit(1);

    if (existingPattern.length > 0) {
      await db.update(screenWorkPatterns)
        .set({
          occurrences: sql`${screenWorkPatterns.occurrences} + 1`,
          lastObserved: new Date(),
          confidence: sql`LEAST(${screenWorkPatterns.confidence} + 0.01, 1.0)`
        })
        .where(eq(screenWorkPatterns.id, existingPattern[0].id));
    } else {
      await db.insert(screenWorkPatterns).values({
        userId,
        patternType: "app_usage",
        patternName: frame.activeApp,
        patternData: {
          tags: analysis.tags,
          firstSeen: new Date().toISOString(),
          timeOfDay: new Date().getHours()
        },
        occurrences: 1,
        confidence: 0.3
      });
    }
  }

  async getActiveSession(userId: number) {
    const [session] = await db.select()
      .from(screenMonitorSessions)
      .where(and(
        eq(screenMonitorSessions.userId, userId),
        eq(screenMonitorSessions.status, "active")
      ))
      .orderBy(desc(screenMonitorSessions.startedAt))
      .limit(1);
    return session;
  }

  async getRecentContext(userId: number, limit = 10) {
    return db.select()
      .from(screenContextEvents)
      .where(eq(screenContextEvents.userId, userId))
      .orderBy(desc(screenContextEvents.timestamp))
      .limit(limit);
  }

  async getWorkPatterns(userId: number) {
    return db.select()
      .from(screenWorkPatterns)
      .where(eq(screenWorkPatterns.userId, userId))
      .orderBy(desc(screenWorkPatterns.occurrences));
  }

  async getCurrentContext(userId: number): Promise<string | null> {
    const events = await this.getRecentContext(userId, 3);
    if (events.length === 0) return null;

    const contexts = events.map(e => `${e.activeApp}: ${e.context}`).join(". ");
    return contexts;
  }

  async getSessionStats(userId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sessions = await db.select()
      .from(screenMonitorSessions)
      .where(and(
        eq(screenMonitorSessions.userId, userId),
        gte(screenMonitorSessions.startedAt, today)
      ));

    const totalFrames = sessions.reduce((sum, s) => sum + s.totalFrames, 0);
    const totalAnalyses = sessions.reduce((sum, s) => sum + s.totalAnalyses, 0);
    const activeSession = sessions.find(s => s.status === "active");

    return {
      totalSessionsToday: sessions.length,
      totalFrames,
      totalAnalyses,
      isActive: !!activeSession,
      currentDevice: activeSession?.deviceName || activeSession?.deviceId
    };
  }

  isSessionActive(userId: number): boolean {
    return this.activeSessions.has(userId);
  }

  /**
   * Sync significant screen patterns to Memory and Learning systems
   * Called when patterns reach significance thresholds
   */
  async syncPatternToMemoryAndLearning(userId: number, pattern: typeof screenWorkPatterns.$inferSelect) {
    try {
      const memoryKey = `screen_pattern_${pattern.patternType}_${pattern.patternName}`;
      
      const existingMemory = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          eq(ulysseMemory.key, memoryKey)
        ))
        .limit(1);

      const memoryValue = `L'utilisateur utilise fréquemment ${pattern.patternName} (${pattern.occurrences} fois observé). Tags: ${JSON.stringify((pattern.patternData as any)?.tags || [])}. Activité typique de ${(pattern.patternData as any)?.timeOfDay || 'journée'}h.`;

      if (existingMemory.length > 0) {
        await db.update(ulysseMemory)
          .set({
            value: memoryValue,
            updatedAt: new Date()
          })
          .where(eq(ulysseMemory.id, existingMemory[0].id));
      } else {
        await db.insert(ulysseMemory).values({
          userId,
          key: memoryKey,
          value: memoryValue,
          category: "habit",
          source: "screen_monitor",
          verified: true,
          confidence: Math.round(pattern.confidence * 100)
        });
      }

      await db.insert(learningLog).values({
        userId,
        topic: `Pattern écran: ${pattern.patternName}`,
        content: `Pattern appris: ${pattern.patternName} (${pattern.patternType}). Occurrences: ${pattern.occurrences}, Confiance: ${Math.round(pattern.confidence * 100)}%`,
        learningType: "pattern",
        sourceType: "observation",
        sourceContext: JSON.stringify({
          patternId: pattern.id,
          occurrences: pattern.occurrences,
          confidence: pattern.confidence,
          tags: (pattern.patternData as any)?.tags
        }),
        impactScore: Math.min(80, 30 + pattern.occurrences),
        wasApplied: true
      });

      broadcastToUser(userId, { 
        type: "memory.updated",
        data: { 
          source: "screen_pattern",
          key: memoryKey 
        }
      });

      console.log(`${LOG_PREFIX} Pattern synced to memory & learning: ${pattern.patternName}`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error syncing pattern to memory:`, error);
    }
  }

  /**
   * Check if patterns need to be synced to memory (threshold-based)
   * Also triggers flow suggestions when session profile is strong
   */
  async checkAndSyncSignificantPatterns(userId: number) {
    const patterns = await db.select()
      .from(screenWorkPatterns)
      .where(and(
        eq(screenWorkPatterns.userId, userId),
        sql`${screenWorkPatterns.occurrences} >= 10`,
        sql`${screenWorkPatterns.confidence} >= 0.5`
      ));

    for (const pattern of patterns) {
      if (pattern.occurrences % 10 === 0) {
        await this.syncPatternToMemoryAndLearning(userId, pattern);
      }
    }
    
    // Check for flow suggestions based on session profile confidence
    // Only suggest flows when profile is strong (> 50% confidence)
    try {
      const profile = await this.computeSessionProfile(userId, 15);
      if (profile.score >= 50 && profile.profile !== "mixed") {
        await this.broadcastFlowSuggestion(userId);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error checking flow suggestion:`, error);
    }
  }

  /**
   * Log learning event for AI analysis improvement
   */
  async logScreenLearning(userId: number, analysis: ScreenAnalysis, frame: ScreenFrame) {
    if (analysis.confidence >= 0.8 && analysis.tags.length > 0) {
      try {
        await db.insert(learningLog).values({
          userId,
          topic: `Activité écran: ${frame.activeApp || 'inconnu'}`,
          content: `Analyse haute confiance: ${analysis.context}`,
          learningType: "insight",
          sourceType: "observation",
          sourceContext: JSON.stringify({
            app: frame.activeApp,
            window: frame.activeWindow,
            tags: analysis.tags,
            confidence: analysis.confidence,
            suggestions: analysis.suggestions
          }),
          impactScore: Math.round(analysis.confidence * 60),
          wasApplied: true
        });
      } catch (error) {
        console.error(`${LOG_PREFIX} Error logging screen learning:`, error);
      }
    }
  }

  /**
   * Get aggregated insights for brain sync
   */
  async getInsightsForBrain(userId: number) {
    const patterns = await db.select()
      .from(screenWorkPatterns)
      .where(and(
        eq(screenWorkPatterns.userId, userId),
        sql`${screenWorkPatterns.occurrences} >= 5`
      ))
      .orderBy(desc(screenWorkPatterns.occurrences))
      .limit(20);

    const recentEvents = await db.select()
      .from(screenContextEvents)
      .where(eq(screenContextEvents.userId, userId))
      .orderBy(desc(screenContextEvents.timestamp))
      .limit(50);

    const tagCounts: Record<string, number> = {};
    for (const event of recentEvents) {
      const tags = event.tags as string[] || [];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Get session profile for additional context
    const sessionProfile = await this.computeSessionProfile(userId);

    return {
      topApps: patterns.slice(0, 5).map(p => ({
        name: p.patternName,
        uses: p.occurrences,
        confidence: p.confidence
      })),
      activityTags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count })),
      totalAnalyses: recentEvents.length,
      lastActivity: recentEvents[0]?.timestamp || null,
      sessionProfile
    };
  }

  /**
   * Compute current session profile based on recent activity
   * Analyzes app usage, tags, and window switching patterns
   */
  async computeSessionProfile(userId: number, timeWindowMinutes = 30): Promise<SessionProfileResult> {
    const cutoff = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    
    const recentEvents = await db.select()
      .from(screenContextEvents)
      .where(and(
        eq(screenContextEvents.userId, userId),
        gte(screenContextEvents.timestamp, cutoff)
      ))
      .orderBy(desc(screenContextEvents.timestamp));

    if (recentEvents.length === 0) {
      return {
        profile: "mixed",
        score: 0,
        subProfiles: [],
        focusLevel: "scattered",
        windowSwitchRate: 0,
        recommendation: "Aucune activité récente détectée"
      };
    }

    // Count profile matches
    const profileScores: Record<SessionProfile, number> = {
      focus_dev: 0,
      focus_business: 0,
      learning: 0,
      trading: 0,
      sports: 0,
      entertainment: 0,
      admin: 0,
      creative: 0,
      communication: 0,
      mixed: 0
    };

    const appsSeen = new Set<string>();
    let windowSwitches = 0;
    let lastApp = "";

    for (const event of recentEvents) {
      const appName = (event.activeApp || "").toLowerCase();
      
      if (lastApp && lastApp !== appName) {
        windowSwitches++;
      }
      lastApp = appName;
      
      if (appName && !appsSeen.has(appName)) {
        appsSeen.add(appName);
      }

      // Match app to profiles
      for (const [appKey, profiles] of Object.entries(APP_PROFILES)) {
        if (appName.includes(appKey)) {
          for (const profile of profiles) {
            profileScores[profile] += 2;
          }
        }
      }

      // Match tags to profiles
      const tags = (event.tags as string[]) || [];
      for (const tag of tags) {
        const tagLower = tag.toLowerCase();
        if (tagLower.includes("coding") || tagLower.includes("development") || tagLower.includes("programming")) {
          profileScores.focus_dev += 1;
        }
        if (tagLower.includes("email") || tagLower.includes("work") || tagLower.includes("meeting")) {
          profileScores.focus_business += 1;
        }
        if (tagLower.includes("learning") || tagLower.includes("tutorial") || tagLower.includes("documentation")) {
          profileScores.learning += 1;
        }
        if (tagLower.includes("trading") || tagLower.includes("finance") || tagLower.includes("stock")) {
          profileScores.trading += 1;
        }
        if (tagLower.includes("sport") || tagLower.includes("football") || tagLower.includes("betting")) {
          profileScores.sports += 1;
        }
        if (tagLower.includes("entertainment") || tagLower.includes("video") || tagLower.includes("gaming")) {
          profileScores.entertainment += 1;
        }
      }
    }

    // Calculate time span in minutes
    const timeSpan = Math.max(1, (recentEvents[0].timestamp.getTime() - recentEvents[recentEvents.length - 1].timestamp.getTime()) / 60000);
    const windowSwitchRate = windowSwitches / timeSpan;

    // Determine focus level
    let focusLevel: "deep" | "moderate" | "scattered";
    if (windowSwitchRate < 1 && appsSeen.size <= 3) {
      focusLevel = "deep";
    } else if (windowSwitchRate < 3 && appsSeen.size <= 6) {
      focusLevel = "moderate";
    } else {
      focusLevel = "scattered";
    }

    // Sort profiles by score
    const sortedProfiles = Object.entries(profileScores)
      .filter(([_, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]);

    const topProfile = sortedProfiles[0];
    const totalScore = sortedProfiles.reduce((sum, [_, score]) => sum + score, 0);

    const mainProfile: SessionProfile = topProfile ? topProfile[0] as SessionProfile : "mixed";
    const mainScore = topProfile ? Math.round((topProfile[1] / Math.max(1, totalScore)) * 100) : 0;

    const subProfiles = sortedProfiles.slice(0, 3).map(([profile, score]) => ({
      profile: profile as SessionProfile,
      score: Math.round((score / Math.max(1, totalScore)) * 100)
    }));

    // Generate recommendation based on profile
    let recommendation: string | undefined;
    
    if (focusLevel === "scattered" && profileScores.entertainment > profileScores.focus_dev + profileScores.focus_business) {
      recommendation = "Tu sembles distrait. Veux-tu que je te rappelle tes 3 tâches prioritaires ?";
    } else if (mainProfile === "focus_dev" && focusLevel === "deep") {
      recommendation = "Mode focus dev détecté. Je peux t'aider avec du code ou de la doc.";
    } else if (mainProfile === "sports" && profileScores.sports > 5) {
      recommendation = "On dirait que c'est le moment du Foot Lab ?";
    } else if (mainProfile === "trading" && profileScores.trading > 5) {
      recommendation = "Envie d'un point marché ou d'une analyse ?";
    }

    return {
      profile: mainProfile,
      score: mainScore,
      subProfiles,
      focusLevel,
      windowSwitchRate: Math.round(windowSwitchRate * 10) / 10,
      recommendation
    };
  }

  /**
   * Suggest flows based on current screen activity patterns
   */
  async suggestFlowFromPatterns(userId: number): Promise<{
    suggestedFlow: string | null;
    reason: string;
    confidence: number;
  }> {
    const profile = await this.computeSessionProfile(userId, 15);
    const hour = new Date().getHours();

    // Flow suggestions based on profile + time
    if (profile.profile === "sports" && profile.score > 50) {
      return {
        suggestedFlow: "FootLab",
        reason: `Activité sports détectée (${profile.score}% du temps)`,
        confidence: profile.score
      };
    }

    if (profile.profile === "trading" && profile.score > 50) {
      return {
        suggestedFlow: "Trading",
        reason: `Analyse de marchés en cours`,
        confidence: profile.score
      };
    }

    if (hour >= 7 && hour <= 9 && (profile.profile === "focus_business" || profile.profile === "communication")) {
      return {
        suggestedFlow: "Morning",
        reason: "Début de journée avec activité business/mail",
        confidence: 70
      };
    }

    if (profile.profile === "admin" && profile.score > 40) {
      return {
        suggestedFlow: "Sugu",
        reason: "Activité administrative/Sugu détectée",
        confidence: profile.score
      };
    }

    if (profile.focusLevel === "scattered" && profile.windowSwitchRate > 4) {
      return {
        suggestedFlow: "Focus",
        reason: "Beaucoup de changements de fenêtre - besoin de focus ?",
        confidence: 60
      };
    }

    return {
      suggestedFlow: null,
      reason: "Pas de flow suggéré pour l'activité actuelle",
      confidence: 0
    };
  }

  /**
   * Get Kanban/task suggestions based on screen activity
   */
  async getKanbanSuggestions(userId: number): Promise<{
    suggestions: Array<{
      type: "create_task" | "link_project" | "update_status";
      context: string;
      projectSuggestion?: string;
      taskTitle?: string;
      confidence: number;
    }>;
  }> {
    const profile = await this.computeSessionProfile(userId, 60);
    const suggestions: Array<{
      type: "create_task" | "link_project" | "update_status";
      context: string;
      projectSuggestion?: string;
      taskTitle?: string;
      confidence: number;
    }> = [];

    // Map profiles to project contexts
    const profileToProject: Record<SessionProfile, string> = {
      focus_dev: "Développement",
      focus_business: "Travail",
      trading: "Trading",
      sports: "Sport/Pronos",
      admin: "SUGU",
      learning: "Formation",
      creative: "Créatif",
      communication: "Communication",
      entertainment: "Perso",
      mixed: "Général"
    };

    if (profile.score > 60 && profile.focusLevel === "deep") {
      suggestions.push({
        type: "link_project",
        context: profile.profile,
        projectSuggestion: profileToProject[profile.profile],
        confidence: profile.score
      });
    }

    // Suggest task based on sustained activity
    if (profile.focusLevel === "deep" && profile.profile === "focus_dev") {
      const recentEvents = await this.getRecentContext(userId, 5);
      const windows = recentEvents.map(e => e.activeWindow).filter(Boolean);
      
      if (windows.length > 0) {
        const commonWindow = windows[0];
        suggestions.push({
          type: "create_task",
          context: "dev",
          projectSuggestion: "Développement",
          taskTitle: `Travail sur: ${commonWindow?.slice(0, 50)}`,
          confidence: 70
        });
      }
    }

    return { suggestions };
  }

  /**
   * Generate enriched brain context with session profile
   * For injection into BrainContextService
   */
  async generateBrainScreenContext(userId: number): Promise<string> {
    const prefs = await this.getPreferences(userId);
    if (!prefs?.enabled) {
      return "";
    }

    const insights = await this.getInsightsForBrain(userId);
    const stats = await this.getSessionStats(userId);

    if (insights.totalAnalyses === 0 || !stats.isActive) {
      return "";
    }

    const lastActivityAge = insights.lastActivity 
      ? Math.round((Date.now() - new Date(insights.lastActivity).getTime()) / 60000)
      : null;

    if (lastActivityAge && lastActivityAge > 10) {
      return "";
    }

    const lines: string[] = ["### Contexte écran récent"];

    // Session profile
    if (insights.sessionProfile && insights.sessionProfile.score > 30) {
      const profileLabels: Record<SessionProfile, string> = {
        focus_dev: "🖥️ Focus développement",
        focus_business: "💼 Focus business",
        learning: "📚 Apprentissage",
        trading: "📈 Trading/Finance",
        sports: "⚽ Sports/Pronos",
        entertainment: "🎬 Divertissement",
        admin: "📋 Administration",
        creative: "🎨 Création",
        communication: "💬 Communication",
        mixed: "🔀 Activité mixte"
      };
      
      const focusLabels = {
        deep: "concentration profonde",
        moderate: "concentration modérée",
        scattered: "attention dispersée"
      };

      lines.push(`- Mode de travail: ${profileLabels[insights.sessionProfile.profile]} (${insights.sessionProfile.score}%)`);
      lines.push(`- Niveau de focus: ${focusLabels[insights.sessionProfile.focusLevel]}`);
      
      if (insights.sessionProfile.recommendation) {
        lines.push(`- Suggestion: ${insights.sessionProfile.recommendation}`);
      }
    }

    // Top apps
    if (insights.topApps.length > 0) {
      const appsStr = insights.topApps.slice(0, 3).map(a => `${a.name} (${a.uses})`).join(", ");
      lines.push(`- Apps principales: ${appsStr}`);
    }

    // Activity tags
    if (insights.activityTags.length > 0) {
      const tagsStr = insights.activityTags.slice(0, 5).map(t => t.tag).join(", ");
      lines.push(`- Tags d'activité: ${tagsStr}`);
    }

    // Last activity time
    if (lastActivityAge !== null) {
      lines.push(`- Dernière activité: il y a ${lastActivityAge} minute${lastActivityAge > 1 ? 's' : ''}`);
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Broadcast flow suggestion to user via realtime
   */
  async broadcastFlowSuggestion(userId: number) {
    const suggestion = await this.suggestFlowFromPatterns(userId);
    
    if (suggestion.suggestedFlow && suggestion.confidence >= 50) {
      broadcastToUser(userId, {
        type: "flow.suggestion",
        data: {
          flowName: suggestion.suggestedFlow,
          reason: suggestion.reason,
          confidence: suggestion.confidence
        }
      });
      
      console.log(`${LOG_PREFIX} Flow suggestion broadcast: ${suggestion.suggestedFlow} (${suggestion.confidence}%)`);
    }
  }
}

export const screenMonitorService = ScreenMonitorService.getInstance();
