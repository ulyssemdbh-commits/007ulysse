import { db } from "../db";
import { ulysseHomework, suguvalEmailLogs, sugumaillaneEmailLogs } from "@shared/schema";
import { eq, and, lte, or, isNull, desc, sql } from "drizzle-orm";
import { homeworkExecutionService } from "./homeworkExecution";
import { syncSystemKnowledge, getOwnerUserId } from "./knowledgeSync";
import { dynamicJobPrioritizerService } from "./dynamicJobPrioritizer";
import { broadcastToUser } from "./realtimeSync";
import { loadService } from "../utils/serviceLoader";

const lazy = {
  suguval: () => loadService("suguvalService", () => import("./suguvalService").then(m => m.suguvalService)),
  sugumaillane: () => loadService("sugumaillaneService", () => import("./sugumaillaneService").then(m => m.sugumaillaneService)),
  sportsCache: () => loadService("sportsCacheService", () => import("./sportsCacheService").then(m => m.sportsCacheService)),
  sportsPredMem: () => loadService("sportsPredictionMemoryService", () => import("./sportsPredictionMemoryService").then(m => m.sportsPredictionMemoryService)),
  brainSync: () => loadService("brainSyncService", () => import("./brainSyncService").then(m => m.brainSyncService)),
  sportsWatch: () => loadService("sportsWatchService", () => import("./sportsWatchService").then(m => m.sportsWatchService)),
  learningOptimizer: () => loadService("learningOptimizerService", () => import("./learningOptimizer").then(m => m.learningOptimizerService)),
  autonomousInitiative: () => loadService("autonomousInitiativeEngine", () => import("./autonomousInitiativeEngine").then(m => m.autonomousInitiativeEngine)),
  autonomousLearning: () => loadService("autonomousLearningServiceV2", () => import("./autonomousLearningV2").then(m => m.autonomousLearningServiceV2)),
  brain: () => loadService("brainService", () => import("./brainService").then(m => m.brainService)),
  discord: () => loadService("discordService", () => import("./discordService").then(m => m.discordService)),
  actionHub: () => loadService("actionHub", () => import("./sensory/ActionHub").then(m => m.actionHub)),
  selfReflection: () => loadService("selfReflection", () => import("./selfReflectionJournal")),
};

interface ScheduledJob {
  id: string;
  name: string;
  interval: number;
  lastRun: number;
  enabled: boolean;
  execute: () => Promise<void>;
}

class JobScheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_FREQUENCY = 60 * 1000;

  start(): void {
    if (this.running) return;
    
    this.running = true;
    console.log("[JobScheduler] Starting job scheduler");
    
    this.registerDefaultJobs();
    
    homeworkExecutionService.cleanupOrphanedExecutions().catch(err => 
      console.error("[JobScheduler] Orphaned execution cleanup failed:", err)
    );
    
    this.checkInterval = setInterval(() => this.checkAndRunJobs(), this.CHECK_FREQUENCY);
    
    setTimeout(() => this.checkAndRunJobs(), 8000);
  }

  stop(): void {
    if (!this.running) return;
    
    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log("[JobScheduler] Stopped job scheduler");
  }

  registerJob(job: Omit<ScheduledJob, "lastRun">): void {
    let enabled = job.enabled;
    if (this.isLightMode() && !this.lightJobIds.has(job.id)) {
      enabled = false;
    }
    this.jobs.set(job.id, {
      ...job,
      enabled,
      lastRun: 0
    });
    if (!enabled && this.isLightMode()) {
      console.log(`[JobScheduler] SKIPPED (LIGHT_MODE): ${job.name}`);
    } else {
      console.log(`[JobScheduler] Registered job: ${job.name}`);
    }
  }

  private isLightMode(): boolean {
    return process.env.LIGHT_MODE === "true";
  }

  private lightJobIds = new Set([
    "cache-cleanup",
    "mars-history-cleanup",
    "homework-cache-cleanup",
    "usage-stats-cleanup",
    "database-metrics-cleanup",
    "coba-chat-history-cleanup",
    "location-cleanup",
    "memory-optimization",
    "screenshot-cache-cleanup",
    "devmax-url-monitoring",
    "devmax-ssl-check",
  ]);

  private registerDefaultJobs(): void {
    this.registerJob({
      id: "homework-hourly",
      name: "Hourly Homework Check",
      interval: 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        await this.executeDueHomework("hourly");
      }
    });

    this.registerJob({
      id: "homework-daily",
      name: "Daily Homework Execution",
      interval: 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        await this.executeDueHomework("daily");
      }
    });

    this.registerJob({
      id: "homework-weekly",
      name: "Weekly Homework Check",
      interval: 7 * 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        await this.executeDueHomework("weekly");
      }
    });

    this.registerJob({
      id: "cache-cleanup",
      name: "Cache Cleanup",
      interval: 30 * 60 * 1000,
      enabled: true,
      execute: async () => {
        const { cache, summaryCache, emailCache } = await import("./cache");
        console.log("[JobScheduler] Cache stats:", cache.getStats());
      }
    });

    this.registerJob({
      id: "knowledge-sync",
      name: "Ulysse Knowledge Sync",
      interval: 30 * 60 * 1000,
      enabled: true,
      execute: async () => {
        const ownerId = await getOwnerUserId();
        if (ownerId) {
          await syncSystemKnowledge(ownerId);
        } else {
          console.log("[JobScheduler] No owner found for knowledge sync");
        }
      }
    });

    const agentMailConfigured = !!process.env.AGENTMAIL_API_KEY;
    this.registerJob({
      id: "agentmail-fetch",
      name: "AgentMail Email Fetch",
      interval: 30 * 60 * 1000,
      enabled: agentMailConfigured,
      execute: async () => {
        await this.fetchAndProcessEmails();
      }
    });
    
    this.registerJob({
      id: "agentmail-connectivity",
      name: "AgentMail Connectivity Check",
      interval: 60 * 60 * 1000,
      enabled: agentMailConfigured,
      execute: async () => {
        await this.checkAgentMailConnectivity();
      }
    });

    // Geofence action processor - vérifie et exécute les actions de géofence en attente
    this.registerJob({
      id: "geofence-actions",
      name: "Geofence Action Processor",
      interval: 5 * 60 * 1000, // Every 5 minutes
      enabled: true,
      execute: async () => {
        await this.processGeofenceActions();
      }
    });

    // Location data cleanup - nettoie les anciennes données de localisation
    this.registerJob({
      id: "location-cleanup",
      name: "Location Data Cleanup",
      interval: 24 * 60 * 60 * 1000, // Daily
      enabled: true,
      execute: async () => {
        await this.cleanupLocationData();
      }
    });

    // Suguval Restaurant - Consultation Ulysse à 23h55 (analyse du panier)
    this.registerJob({
      id: "suguval-ulysse-consult",
      name: "Suguval Ulysse Consultation (23h55)",
      interval: 30 * 60 * 1000, // Check every 30 minutes
      enabled: true,
      execute: async () => {
        await this.consultSuguvalWithUlysse();
      }
    });

    // Suguval Restaurant - Email quotidien à 23h59 avec liste des courses
    // RÈGLE WEEKEND: Vendredi/Samedi/Dimanche → pas d'envoi; Lundi 02h00 → liste vendredi+weekend; Lundi-Jeudi 23h59 → normal
    this.registerJob({
      id: "suguval-daily-email",
      name: "Suguval Daily Email (23h59)",
      interval: 30 * 60 * 1000, // Check every 30 minutes
      enabled: true,
      execute: async () => {
        await this.sendSuguvalDailyEmail();
      }
    });

    // SUGU Maillane Restaurant - Consultation Ulysse à 23h55 (analyse du panier)
    this.registerJob({
      id: "sugumaillane-ulysse-consult",
      name: "Sugumaillane Ulysse Consultation (23h55)",
      interval: 30 * 60 * 1000, // Check every 30 minutes
      enabled: true,
      execute: async () => {
        await this.consultSugumaillaneWithUlysse();
      }
    });

    // SUGU Maillane Restaurant - Email quotidien à 23h59 avec liste des courses
    // RÈGLE WEEKEND: Vendredi/Samedi/Dimanche → pas d'envoi; Lundi 02h00 → liste vendredi+weekend; Lundi-Jeudi 23h59 → normal
    this.registerJob({
      id: "sugumaillane-daily-email",
      name: "Sugumaillane Daily Email (23h59)",
      interval: 30 * 60 * 1000, // Check every 30 minutes
      enabled: true,
      execute: async () => {
        await this.sendSugumaillaneDailyEmail();
      }
    });

    // SUGU Apply Future Items - Apply pre-planned items to today's checklist at 05:30
    this.registerJob({
      id: "sugu-apply-future-items",
      name: "SUGU Apply Future Items (05h30)",
      interval: 60 * 60 * 1000, // Check every hour
      enabled: true,
      execute: async () => {
        const now = new Date();
        const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
        const hour = parisTime.getHours();
        const minute = parisTime.getMinutes();
        if (hour === 5 && minute >= 30 && minute < 55) {
          try {
            const { suguvalService } = await import("./suguvalService");
            const { sugumaillaneService } = await import("./sugumaillaneService");
            const valResult = await suguvalService.applyFutureItemsForToday();
            if (valResult.applied > 0) console.log(`[JobScheduler] Suguval: ${valResult.applied} future items applied`);
            const maillaneResult = await sugumaillaneService.applyFutureItemsForToday();
            if (maillaneResult.applied > 0) console.log(`[JobScheduler] Sugumaillane: ${maillaneResult.applied} future items applied`);
          } catch (e) {
            console.error("[JobScheduler] Apply future items error:", e);
          }
        }
      }
    });

    // SUGU Email Recovery - Check for failed emails every morning at 6:00 and retry them
    this.registerJob({
      id: "sugu-email-recovery",
      name: "SUGU Email Recovery (6h00)",
      interval: 30 * 60 * 1000, // Check every 30 minutes
      enabled: true,
      execute: async () => {
        await this.recoverFailedSuguEmails();
      }
    });

    // Memory optimization - consolidate and decay old memories
    this.registerJob({
      id: "memory-optimization",
      name: "Memory Optimization",
      interval: 24 * 60 * 60 * 1000, // Daily
      enabled: true,
      execute: async () => {
        await this.optimizeMemory();
      }
    });

    this.registerJob({
      id: "self-healing",
      name: "Self-Healing Check",
      interval: 15 * 60 * 1000,
      enabled: true,
      execute: async () => {
        await this.runSelfHealing();
      }
    });

    // Failure pattern analysis - analyze and report patterns
    this.registerJob({
      id: "failure-pattern-analysis",
      name: "Failure Pattern Analysis",
      interval: 60 * 60 * 1000, // Hourly
      enabled: true,
      execute: async () => {
        await this.analyzeFailurePatterns();
      }
    });

    // Phase 3: Proactive suggestion generation
    this.registerJob({
      id: "proactive-suggestions",
      name: "Proactive Suggestion Generation",
      interval: 6 * 60 * 60 * 1000, // Every 6 hours
      enabled: !this.isLightMode(),
      execute: async () => {
        await this.generateProactiveSuggestions();
      }
    });

    // Website Monitoring - check monitored sites every 5 minutes
    this.registerJob({
      id: "website-monitoring",
      name: "Website Monitoring",
      interval: 5 * 60 * 1000, // Every 5 minutes
      enabled: true,
      execute: async () => {
        await this.runWebsiteMonitoring();
      }
    });

    // MARS History Cleanup - remove expired entries (31+ days old)
    this.registerJob({
      id: "mars-history-cleanup",
      name: "MARS History Cleanup",
      interval: 24 * 60 * 60 * 1000, // Daily
      enabled: true,
      execute: async () => {
        await this.cleanupMarsHistory();
      }
    });

    // Homework Intelligence Cache Cleanup - clear old cached prompts and patterns
    this.registerJob({
      id: "homework-cache-cleanup",
      name: "Homework Intelligence Cache Cleanup",
      interval: 24 * 60 * 60 * 1000, // Daily
      enabled: true,
      execute: async () => {
        await this.cleanupHomeworkCaches();
      }
    });

    // Autonomous Learning - Russian dolls progressive learning system
    this.registerJob({
      id: "autonomous-learning",
      name: "Autonomous Learning Cycle",
      interval: 4 * 60 * 60 * 1000, // Every 4 hours
      enabled: !this.isLightMode(),
      execute: async () => {
        await this.runAutonomousLearning();
      }
    });

    // L5 Cross-Domain Insights - Generate cross-domain connections
    this.registerJob({
      id: "l5-cross-domain",
      name: "L5 Cross-Domain Insights",
      interval: 12 * 60 * 60 * 1000, // Every 12 hours
      enabled: !this.isLightMode(),
      execute: async () => {
        try {
          await this.runL5CrossDomainInsights();
        } catch (error) {
          console.error("[JobScheduler] L5 Cross-Domain job error:", error);
        }
      }
    });

    // Confidence Decay - Apply decay to stale knowledge
    this.registerJob({
      id: "confidence-decay",
      name: "Knowledge Confidence Decay",
      interval: 24 * 60 * 60 * 1000, // Daily
      enabled: true,
      execute: async () => {
        try {
          await this.applyKnowledgeDecay();
        } catch (error) {
          console.error("[JobScheduler] Confidence Decay job error:", error);
        }
      }
    });

    // Weekly Homework Insights - generate weekly synthesis
    this.registerJob({
      id: "homework-weekly-insights",
      name: "Weekly Homework Insights",
      interval: 7 * 24 * 60 * 60 * 1000, // Weekly
      enabled: true,
      execute: async () => {
        await this.generateWeeklyHomeworkInsights();
      }
    });

    // Marseille Weather Sync - synchronisation horaire des données météo
    this.registerJob({
      id: "weather-sync",
      name: "Marseille Weather Sync",
      interval: 60 * 60 * 1000, // Toutes les heures
      enabled: true,
      execute: async () => {
        await this.syncMarseilleWeather();
      }
    });

    // Sports Cache Daily Sync - sync complète 1x/jour à 6h du matin OU si cache vide au startup
    this.registerJob({
      id: "sports-daily-sync",
      name: "Sports Daily Cache Sync",
      interval: 24 * 60 * 60 * 1000, // 1x par jour
      enabled: !this.isLightMode(),
      execute: async () => {
        const hour = new Date().getHours();
        
        // Check if today's cache is empty (catch-up sync on startup)
        const sportsCache = await lazy.sportsCache();
        const todaysMatches = await sportsCache.getMatchesForDate(new Date());
        const footballMatches = todaysMatches.filter((m: any) => m.sport === 'football');
        const needsCatchUp = footballMatches.length === 0;
        
        // Execute between 5-7h OR if cache is empty (startup catch-up)
        if (hour >= 5 && hour <= 7 || needsCatchUp) {
          const reason = needsCatchUp ? '(catch-up: cache vide)' : '(scheduled 5-7h)';
          console.log(`[JobScheduler] Running complete sports daily sync... ${reason}`);
          
          const sc = await lazy.sportsCache();
          const matchResult = await sc.syncDailyMatches();
          console.log(`[JobScheduler] Matches synced: ${matchResult.matchesProcessed}`);
          
          const oddsResult = await sc.refreshHourlyOdds();
          console.log(`[JobScheduler] Odds synced: ${oddsResult.oddsProcessed}`);
          
          const statsResult = await sc.syncTeamStats();
          console.log(`[JobScheduler] Team stats synced: ${statsResult.teamsProcessed}`);
          
          console.log(`[JobScheduler] Complete daily sync done: ${matchResult.matchesProcessed} matches, ${oddsResult.oddsProcessed} odds, ${statsResult.teamsProcessed} team stats`);
        }
      }
    });

    // Ulysse Weekly Self-Reflection Journal - every Sunday at 21:00 (9 PM Paris time)
    this.registerJob({
      id: "ulysse-weekly-journal",
      name: "Ulysse Weekly Self-Reflection Journal",
      interval: 60 * 60 * 1000, // Check every hour
      enabled: true,
      execute: async () => {
        await this.generateWeeklyUlysseJournal();
      }
    });

    // Ulysse Proactive Reports - SUGU alerts, AppToOrder health, system alerts (daily at 7 AM)
    this.registerJob({
      id: "ulysse-proactive-reports",
      name: "Ulysse Proactive Reports & Alerts",
      interval: 60 * 60 * 1000, // Check every hour
      enabled: true,
      execute: async () => {
        await this.generateProactiveAlerts();
      }
    });
    
    // Sports Verified Watch - Double-scrape vérification des classements 2x par jour
    this.registerJob({
      id: "sports-verified-watch",
      name: "Sports Verified Watch (Double-Scrape)",
      interval: 12 * 60 * 60 * 1000, // Toutes les 12 heures
      enabled: !this.isLightMode(),
      execute: async () => {
        const hour = new Date().getHours();
        // Execute at 7h and 19h (Paris time) 
        if (hour === 7 || hour === 19) {
          console.log("[JobScheduler] Running VERIFIED sports watch...");
          const ownerId = await getOwnerUserId() ?? 1;
          const sw = await lazy.sportsWatch();
          const results = await sw.runDailyWatch(ownerId);
          const verified = results.filter(r => r.verified).length;
          const failed = results.filter(r => !r.verified).length;
          console.log(`[JobScheduler] Verified sports watch completed: ${verified} verified, ${failed} failed`);
        }
      }
    });

    // Sports Odds Hourly Refresh - mise à jour des cotes toutes les heures
    this.registerJob({
      id: "sports-odds-refresh",
      name: "Sports Odds Hourly Refresh",
      interval: 60 * 60 * 1000, // Toutes les heures
      enabled: !this.isLightMode(),
      execute: async () => {
        const hour = new Date().getHours();
        // Only refresh odds during active betting hours (8h-23h)
        if (hour >= 8 && hour <= 23) {
          console.log("[JobScheduler] Running sports odds refresh...");
          const sc = await lazy.sportsCache();
          const result = await sc.refreshHourlyOdds();
          console.log(`[JobScheduler] Odds refresh completed: ${result.oddsProcessed} odds, ${result.apiCallsUsed} API calls`);
          
          console.log("[JobScheduler] Running multi-sport odds sync...");
          const multiResult = await sc.syncMultiSportOdds();
          console.log(`[JobScheduler] Multi-sport sync completed: ${multiResult.matchesCreated} matches, ${multiResult.oddsProcessed} odds`);
        }
      }
    });

    // Sports Prediction Results Tracking - tracks completed matches and updates prediction performance
    this.registerJob({
      id: "sports-prediction-tracking",
      name: "Sports Prediction Results Tracking",
      interval: 4 * 60 * 60 * 1000, // Every 4 hours
      enabled: !this.isLightMode(),
      execute: async () => {
        console.log("[JobScheduler] Running prediction results tracking...");
        try {
          const spm = await lazy.sportsPredMem();
          const result = await spm.trackCompletedMatches();
          console.log(`[JobScheduler] Prediction tracking completed: ${result.tracked} tracked, ${result.errors} errors`);
        } catch (error) {
          console.error("[JobScheduler] Prediction tracking error:", error);
        }
      }
    });

    // Sports Prediction Brain Learning - extracts learnings to Brain System + Feedback Loop
    this.registerJob({
      id: "sports-prediction-brain-learning",
      name: "Sports Prediction Brain Learning",
      interval: 24 * 60 * 60 * 1000, // Once per day
      enabled: !this.isLightMode(),
      execute: async () => {
        const hour = new Date().getHours();
        // Execute learning extraction at 2h (night, after most matches finished)
        if (hour >= 2 && hour <= 4) {
          console.log("[JobScheduler] Running prediction brain learning extraction...");
          try {
            const ownerId = await getOwnerUserId();
            if (!ownerId) {
              console.log("[JobScheduler] No owner found, skipping brain learning");
              return;
            }
            
            const spm = await lazy.sportsPredMem();
            const result = await spm.extractLearningsToBrain(ownerId);
            console.log(`[JobScheduler] Brain learning completed: ${result.processed} predictions processed, ${result.learnings.length} learnings extracted`);

            // 2. NEW: Feedback loop - adjust brain knowledge based on prediction results
            const { learningOptimizerService } = await import("./learningOptimizer");
            const feedbackResult = await learningOptimizerService.processPredictionBatch(ownerId, 7);
            console.log(`[JobScheduler] Feedback loop: ${feedbackResult.wins} wins, ${feedbackResult.losses} losses, ${feedbackResult.patternsCreated} patterns, ${feedbackResult.knowledgeUpdated} updated`);
          } catch (error) {
            console.error("[JobScheduler] Brain learning error:", error);
          }
        }
      }
    });

    this.registerJob({
      id: "brain-sync",
      name: "Brain System Synchronization",
      interval: 6 * 60 * 60 * 1000, // Every 6 hours
      enabled: true,
      execute: async () => {
        console.log("[JobScheduler] Running brain system synchronization...");
        try {
          const bs = await lazy.brainSync();
          const results = await bs.syncAllUsers();
          for (const { userId, result } of results) {
            if (result.migrated > 0 || result.connections > 0) {
              console.log(`[JobScheduler] Brain sync for user ${userId}: migrated=${result.migrated}, connections=${result.connections}`);
            }
          }
        } catch (error) {
          console.error("[JobScheduler] Brain sync error:", error);
        }
      }
    });

    this.registerJob({
      id: "screenshot-cache-cleanup",
      name: "Screenshot Cache Cleanup",
      interval: 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const fs = await import("fs");
          const path = await import("path");
          const cacheDir = path.join(process.cwd(), "data", "screenshots");
          if (!fs.existsSync(cacheDir)) return;
          const files = fs.readdirSync(cacheDir);
          const maxAge = 7 * 24 * 60 * 60 * 1000;
          let cleaned = 0;
          for (const file of files) {
            const filePath = path.join(cacheDir, file);
            const stat = fs.statSync(filePath);
            if (Date.now() - stat.mtimeMs > maxAge) {
              fs.unlinkSync(filePath);
              cleaned++;
            }
          }
          if (cleaned > 0) console.log(`[JobScheduler] Screenshot cache: ${cleaned} old files cleaned`);
        } catch (err: any) {
          console.warn(`[JobScheduler] Screenshot cache cleanup error: ${err.message}`);
        }
      }
    });

    // L4 Auto-Promotion (every 6 hours) - Promotes high-quality L2/L3 to L4
    this.registerJob({
      id: "l4-auto-promotion",
      name: "L4 Auto-Promotion",
      interval: 6 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        await this.runL4AutoPromotion();
      }
    });

    // Learning Quality Check (every 4 hours) - Accelerates high-quality topics
    this.registerJob({
      id: "learning-quality-check",
      name: "Learning Quality Check",
      interval: 4 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        await this.runLearningQualityCheck();
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // AUTONOMOUS INITIATIVE ENGINE - PROACTIVE CHECKS
    // ═══════════════════════════════════════════════════════════════

    this.registerJob({
      id: "proactive-initiative-check",
      name: "Proactive Initiative Check",
      interval: 15 * 60 * 1000,
      enabled: !this.isLightMode(),
      execute: async () => {
        try {
          const initEngine = await lazy.autonomousInitiative();
          const initiatives = await initEngine.runChecks();
          let acted = 0;
          let proposed = 0;

          for (const initiative of initiatives) {
            if (initiative.autonomyLevel === "act") {
              const result = await initEngine.executeInitiative(initiative);
              const ah = await lazy.actionHub();
              await ah.execute({
                name: `initiative_${initiative.type}`,
                params: { initiativeId: initiative.id, type: initiative.type, result },
                metadata: {
                  category: "system",
                  userId: 1,
                  persona: "ulysse",
                  source: "autonomous"
                }
              });
              broadcastToUser(1, {
                type: "diagnostics.updated",
                userId: 1,
                data: { event: "initiative.executed", initiative: { ...initiative, result } },
                timestamp: Date.now()
              });
              acted++;
            } else if (initiative.autonomyLevel === "propose") {
              broadcastToUser(1, {
                type: "diagnostics.updated",
                userId: 1,
                data: { event: "initiative.new", initiative },
                timestamp: Date.now()
              });
              proposed++;
            }
          }

          if (initiatives.length > 0) {
            console.log(`[Initiative] Checked: ${initiatives.length} new initiatives (${acted} acted, ${proposed} proposed)`);
          }
        } catch (error) {
          console.error("[JobScheduler] Proactive initiative check error:", error);
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // PROACTIVE OWNER JOBS - X2 FOCUS
    // ═══════════════════════════════════════════════════════════════

    // Owner Morning Brief (8h) - Daily summary for the owner
    this.registerJob({
      id: "owner-morning-brief",
      name: "Owner Morning Brief (8h)",
      interval: 60 * 60 * 1000, // Check every hour
      enabled: true,
      execute: async () => {
        const hour = new Date().getHours();
        if (hour === 8) {
          console.log("[JobScheduler] Generating owner morning brief...");
          try {
            const ownerId = await getOwnerUserId();
            if (!ownerId) return;

            const brief = await this.generateMorningBrief(ownerId);
            console.log(`[JobScheduler] Morning Brief: ${brief.summary}`);

            // Execute FlowService Morning Brief for rich multi-section brief
            try {
              const { flowService } = await import("./flowService");
              const briefResult = await flowService.executeFlow(ownerId, "morning_brief", "ulysse");
              if (briefResult.success) {
                console.log(`[FlowService] Morning Brief: ${briefResult.sections.length} sections generated`);
                broadcastToUser(ownerId, {
                  type: "flow.morning_brief",
                  userId: ownerId,
                  data: {
                    sections: briefResult.sections,
                    suggestedActions: briefResult.suggestedActions
                  },
                  timestamp: Date.now()
                });
              }
            } catch (err: any) {
              console.error("[FlowService] Morning Brief error:", err?.message);
            }

            // Store brief in memory for Ulysse to access
            const { brainService } = await import("./brainService");
            await brainService.addKnowledge(ownerId, {
              title: `Brief du ${new Date().toLocaleDateString("fr-FR")}`,
              content: brief.details,
              summary: brief.summary,
              type: "insight",
              category: "daily_brief",
              tags: ["brief", "daily", "proactive"],
              sourceType: "automated",
              importance: 85,
              confidence: 95
            });
          } catch (error) {
            console.error("[JobScheduler] Morning brief error:", error);
          }
        }
      }
    });

    // Daily Value Bets (12h) - Sports betting recommendations
    this.registerJob({
      id: "daily-value-bets",
      name: "Daily Value Bets (12h)",
      interval: 60 * 60 * 1000, // Check every hour
      enabled: true,
      execute: async () => {
        const hour = new Date().getHours();
        if (hour === 12) {
          console.log("[JobScheduler] Generating daily value bets...");
          try {
            const ownerId = await getOwnerUserId();
            if (!ownerId) return;

            const bets = await this.generateValueBets();
            console.log(`[JobScheduler] Value Bets: ${bets.length} recommendations`);
            
            if (bets.length > 0) {
              const { brainService } = await import("./brainService");
              await brainService.addKnowledge(ownerId, {
                title: `Paris du jour ${new Date().toLocaleDateString("fr-FR")}`,
                content: bets.map(b => `${b.match}: ${b.bet} (${b.confidence}%, value: ${b.value})`).join("\n"),
                summary: `${bets.length} paris recommandés aujourd'hui`,
                type: "recommendation",
                category: "sports_betting",
                tags: ["paris", "value", "daily", "proactive"],
                sourceType: "automated",
                importance: 80,
                confidence: bets.reduce((sum, b) => sum + b.confidence, 0) / bets.length
              });
            }
          } catch (error) {
            console.error("[JobScheduler] Value bets error:", error);
          }
        }
      }
    });

    // SUGU Daily Check (7h) - Stock/supply alerts
    this.registerJob({
      id: "sugu-daily-check",
      name: "SUGU Daily Check (7h)",
      interval: 60 * 60 * 1000, // Check every hour
      enabled: true,
      execute: async () => {
        const hour = new Date().getHours();
        if (hour === 7) {
          console.log("[JobScheduler] Running SUGU daily check...");
          try {
            const alerts = await this.generateSuguAlerts();
            if (alerts.length > 0) {
              console.log(`[JobScheduler] SUGU Alerts: ${alerts.length} issues detected`);
              
              const ownerId = await getOwnerUserId();
              if (ownerId) {
                const { brainService } = await import("./brainService");
                await brainService.addKnowledge(ownerId, {
                  title: `Alertes SUGU ${new Date().toLocaleDateString("fr-FR")}`,
                  content: alerts.join("\n"),
                  summary: `${alerts.length} alertes stock/approvisionnement`,
                  type: "alert",
                  category: "sugu",
                  tags: ["sugu", "stock", "alert", "proactive"],
                  sourceType: "automated",
                  importance: 90,
                  confidence: 95
                });
              }
            } else {
              console.log("[JobScheduler] SUGU Check: No alerts");
            }
          } catch (error) {
            console.error("[JobScheduler] SUGU check error:", error);
          }
        }
      }
    });

    // SUGU Supplier Knowledge Learning (2h nightly) - Autonomous invoice parsing improvement
    this.registerJob({
      id: "sugu-supplier-learning",
      name: "SUGU Supplier Learning (2h)",
      interval: 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        const hour = new Date().getHours();
        if (hour === 2) {
          console.log("[SuguLearning] Starting nightly supplier knowledge consolidation...");
          try {
            const { consolidateSupplierKnowledge } = await import("./suguLearningService");
            const valResult = await consolidateSupplierKnowledge("val");
            const maillaneResult = await consolidateSupplierKnowledge("maillane");
            console.log(`[SuguLearning] Done — Val: ${valResult.updated}/${valResult.total} suppliers | Maillane: ${maillaneResult.updated}/${maillaneResult.total} suppliers`);
          } catch (err: any) {
            console.error("[SuguLearning] Nightly job error:", err?.message);
          }
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // SELF-AWARENESS JOBS - PALIER 3
    // ═══════════════════════════════════════════════════════════════

    this.registerJob({
      id: "self-diagnostic",
      name: "Self Diagnostic",
      interval: 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        console.log("[JobScheduler] Running self-diagnostic...");
        try {
          const { selfAwarenessService } = await import("./selfAwarenessService");
          const { recordJobExecution } = await import("../api/systemStatus");
          
          const startTime = Date.now();
          const result = await selfAwarenessService.runDiagnostic('scheduled');
          const duration = Date.now() - startTime;
          
          recordJobExecution("Self Diagnostic", "success", duration);
          
          console.log(`[JobScheduler] Self-Diagnostic completed: healthScore=${result.summary.healthScore}, clarityMode=${result.clarityScore.mode}`);
          
          // If health is critical, log a warning
          if (result.summary.healthScore < 50) {
            console.warn(`[JobScheduler] CRITICAL: System health is ${result.summary.healthScore}/100`);
            
            // Store critical alert in brain for owner
            const ownerId = await getOwnerUserId();
            if (ownerId) {
              const { brainService } = await import("./brainService");
              await brainService.addKnowledge(ownerId, {
                title: `Alerte Système Critique ${new Date().toISOString()}`,
                content: `Health: ${result.summary.healthScore}/100\nClarity: ${result.clarityScore.score}/100 (${result.clarityScore.mode})\nDown: ${result.summary.downComponents.join(', ') || 'none'}\nDegraded: ${result.summary.degradedComponents.join(', ') || 'none'}`,
                summary: `Alerte système critique: health ${result.summary.healthScore}%`,
                type: "alert",
                category: "system",
                tags: ["system", "health", "critical", "diagnostic"],
                sourceType: "automated",
                importance: 100,
                confidence: 100
              });
            }
          }
        } catch (error) {
          console.error("[JobScheduler] Self-diagnostic error:", error);
          const { recordJobExecution } = await import("../api/systemStatus");
          recordJobExecution("Self Diagnostic", "failed", 0);
        }
      }
    });

    this.registerJob({
      id: "self-auto-heal",
      name: "Self Auto-Heal",
      interval: 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        console.log("[JobScheduler] Running auto-heal check...");
        try {
          const { selfAwarenessService } = await import("./selfAwarenessService");
          const { recordJobExecution } = await import("../api/systemStatus");
          
          const startTime = Date.now();
          const summary = await selfAwarenessService.getSummary();
          
          // Only run auto-heal if there are issues
          if (summary.healthScore < 80 || summary.degradedComponents.length > 0 || summary.downComponents.length > 0) {
            console.log(`[JobScheduler] Auto-heal triggered: health=${summary.healthScore}, degraded=${summary.degradedComponents.join(',')}`);
            
            // Try to refresh degraded caches
            if (summary.degradedComponents.includes('sports') || summary.degradedComponents.includes('cachesSports')) {
              try {
                const { sportsCacheService } = await import("./sportsCacheService");
                await sportsCacheService.syncDailyMatches().catch(() => {});
                console.log("[JobScheduler] Auto-heal: sports cache refreshed");
              } catch (e) {
                console.error("[JobScheduler] Auto-heal: sports cache refresh failed", e);
              }
            }
            
            // Try to reconnect agentmail if degraded
            if (summary.degradedComponents.includes('agentmail') || summary.downComponents.includes('agentmail')) {
              try {
                const { agentMailService } = await import("./agentMailService");
                await agentMailService.isConnected();
                console.log("[JobScheduler] Auto-heal: AgentMail connection tested");
              } catch (e) {
                console.error("[JobScheduler] Auto-heal: AgentMail reconnect failed", e);
              }
            }
            
            recordJobExecution("Self Auto-Heal", "success", Date.now() - startTime);
          } else {
            console.log("[JobScheduler] Auto-heal: System healthy, no action needed");
            recordJobExecution("Self Auto-Heal", "success", Date.now() - startTime);
          }
        } catch (error) {
          console.error("[JobScheduler] Auto-heal error:", error);
          const { recordJobExecution } = await import("../api/systemStatus");
          recordJobExecution("Self Auto-Heal", "failed", 0);
        }
      }
    });

    this.registerJob({
      id: "morning-briefing",
      name: "Morning Briefing Check",
      interval: 5 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { checkAndSendMorningBriefing } = await import("./morningBriefingService");
          await checkAndSendMorningBriefing();
        } catch (e) {
          console.error("[JobScheduler] Morning briefing check error:", e);
        }
      }
    });

    // Scheduled Financial Reports - check every hour
    this.registerJob({
      id: "scheduled-reports",
      name: "Scheduled Reports Check",
      interval: 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { checkAndSendScheduledReports } = await import("./reportGeneratorService");
          await checkAndSendScheduledReports();
        } catch (e) {
          console.error("[JobScheduler] Scheduled reports check error:", e);
        }
      }
    });

    this.registerJob({
      id: "apptoorder-monitor",
      name: "AppToOrder Monitoring (5min)",
      interval: 5 * 60 * 1000,
      enabled: !this.isLightMode(),
      execute: async () => {
        try {
          const { appToOrderMonitor } = await import("./appToOrderMonitorService");
          const { health, urls } = await appToOrderMonitor.runFullCycle();
          const urlOk = urls.filter(u => u.isAccessible).length;
          console.log(`[JobScheduler] AppToOrder: ${health?.overallStatus || "unreachable"}, URLs: ${urlOk}/${urls.length}`);
        } catch (e: any) {
          console.error("[JobScheduler] AppToOrder monitor error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "apptoorder-cleanup",
      name: "AppToOrder Data Cleanup",
      interval: 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { appToOrderMonitor } = await import("./appToOrderMonitorService");
          await appToOrderMonitor.cleanup(30);
        } catch (e: any) {
          console.error("[JobScheduler] AppToOrder cleanup error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "ai-diagnostic-run",
      name: "AI System Diagnostic Run",
      interval: 6 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { aiSystemIntegration } = await import("./aiSystemIntegration");
          const ownerId = await getOwnerUserId();
          if (ownerId) {
            const result = await aiSystemIntegration.runDiagnostic({
              userId: ownerId,
              runType: "scheduled",
              triggeredBy: "scheduler",
            });
            console.log(`[JobScheduler] AI Diagnostic: score=${result.overallScore}, findings=${result.findings.length}`);
          }
        } catch (e: any) {
          console.error("[JobScheduler] AI diagnostic error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "devops-intelligence-audit",
      name: "DevOps Intelligence Daily Audit",
      interval: 12 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const ownerId = await getOwnerUserId();
          if (!ownerId) return;
          const { incidentCorrelationService } = await import("./incidentCorrelationService");
          const alerts = await incidentCorrelationService.checkSmartAlerts();
          if (alerts.length > 0) {
            console.log(`[JobScheduler] DevOps Intelligence: ${alerts.length} smart alert(s)`);
            const critical = alerts.filter(a => a.severity === "critical");
            if (critical.length > 0) {
              try {
                const { discordService: ds } = await import("./discordService");
                await ds.sendMessage(`🔴 **DevOps Alert** — ${critical.length} alerte(s) critique(s):\n${critical.map(a => `• ${a.message}`).join("\n")}`, "devops");
              } catch {}
            }
          }
          const { devopsIntelligenceEngine: engine } = await import("./devopsIntelligenceEngine");
          const leaderboard = await engine.getFragilityLeaderboard(5);
          if (leaderboard.some(f => f.recentTrend === "degrading")) {
            console.log(`[JobScheduler] DevOps: Degrading modules detected`);
            try {
              const { workJournalService } = await import("./workJournalService");
              const degrading = leaderboard.filter(f => f.recentTrend === "degrading");
              await workJournalService.addEntry(ownerId, {
                title: "Modules en dégradation détectés",
                content: degrading.map(f => `${f.filePath}: ${f.combinedScore}/100`).join(", "),
                entryType: "note",
                context: "devops",
                tags: ["auto-audit", "degradation"],
                status: "pending",
              });
            } catch {}
          }
        } catch (e: any) {
          console.error("[JobScheduler] DevOps intelligence audit error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "behavior-pattern-analysis",
      name: "Behavior Pattern Analysis",
      interval: 12 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { behaviorService } = await import("./behaviorService");
          const ownerId = await getOwnerUserId();
          if (ownerId) {
            const created = await behaviorService.generateSuggestions(ownerId);
            if (created > 0) {
              console.log(`[JobScheduler] Behavior analysis: ${created} new suggestions created`);
            }
          }
        } catch (e: any) {
          console.error("[JobScheduler] Behavior analysis error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "usage-stats-cleanup",
      name: "Usage Events Cleanup (>90 days)",
      interval: 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { usageEvents } = await import("@shared/schema");
          const { lt } = await import("drizzle-orm");
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          const deleted = await db.delete(usageEvents)
            .where(lt(usageEvents.createdAt, ninetyDaysAgo))
            .returning();
          if (deleted.length > 0) {
            console.log(`[JobScheduler] Cleaned ${deleted.length} old usage events`);
          }
        } catch (e: any) {
          console.error("[JobScheduler] Usage cleanup error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "database-metrics-cleanup",
      name: "Database Metrics Cleanup (>30 days)",
      interval: 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { sql } = await import("drizzle-orm");
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const cutoff = thirtyDaysAgo.toISOString();

          const targets = [
            { table: "capability_changelog", col: "created_at" },
            { table: "perf_metrics", col: "created_at" },
            { table: "audit_logs", col: "timestamp" },
            { table: "learning_log", col: "created_at" },
            { table: "system_diagnostics", col: "created_at" },
            { table: "ulysse_diagnostics", col: "created_at" },
            { table: "diagnostic_runs", col: "started_at" },
            { table: "sports_sync_jobs", col: "created_at" },
            { table: "apptoorder_url_checks", col: "timestamp" },
            { table: "ui_snapshots", col: "created_at" },
          ];

          let totalDeleted = 0;
          const results: string[] = [];

          for (const { table, col } of targets) {
            try {
              const result = await db.execute(
                sql.raw(`DELETE FROM "${table}" WHERE "${col}" < '${cutoff}' RETURNING 1`)
              );
              const count = (result as any).rowCount || ((result as any).rows || []).length || 0;
              if (count > 0) {
                results.push(`${table}: ${count}`);
                totalDeleted += count;
              }
            } catch (tableErr: any) {
              console.warn(`[DbCleanup] Failed to clean ${table}: ${tableErr.message}`);
            }
          }

          if (totalDeleted > 0) {
            console.log(`[DbCleanup] Cleaned ${totalDeleted} old rows (>30d): ${results.join(", ")}`);
            try {
              await db.execute(sql.raw(`VACUUM ANALYZE`));
              console.log(`[DbCleanup] VACUUM ANALYZE completed`);
            } catch {}
          }
        } catch (e: any) {
          console.error("[DbCleanup] Cleanup error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "coba-chat-history-cleanup",
      name: "COBA Chat History Cleanup (>30 days per tenant)",
      interval: 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { cobaBusinessService } = await import("./cobaBusinessService");
          const result = await cobaBusinessService.cleanupOldChatHistory(30);
          if (result.messagesDeleted > 0) {
            console.log(`[JobScheduler] COBA chat cleanup: ${result.messagesDeleted} messages deleted across ${result.tenantsProcessed} tenants`);
          }
        } catch (e: any) {
          console.error("[JobScheduler] COBA chat cleanup error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "footdatas-squad-sync",
      name: "Footdatas Squad & Transfer Sync",
      interval: 7 * 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { footdatasService } = await import("./footdatasService");
          const result = await footdatasService.syncAllClubsFromAPI(10);
          console.log(`[JobScheduler] Footdatas sync: ${result.synced} clubs, ${result.total.players}P/${result.total.staff}S/${result.total.transfers}T/${result.total.trophies}Tr`);

          const clubs = await footdatasService.getAllClubs();
          for (const club of clubs.slice(0, 10)) {
            await footdatasService.generateClubStats(club.id);
          }
          console.log(`[JobScheduler] Footdatas stats generated for ${Math.min(clubs.length, 10)} clubs`);
        } catch (e: any) {
          console.error("[JobScheduler] Footdatas sync error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "stock-db-sync",
      name: "Stock Watchlist & Alerts DB Sync",
      interval: 4 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { tradingAlertsService } = await import("./tradingAlertsService");
          await tradingAlertsService.syncAlertsToDB();
          console.log(`[JobScheduler] Stock alerts synced to DB`);
        } catch (e: any) {
          console.error("[JobScheduler] Stock sync error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "monitoring-check",
      name: "Website Monitoring Active Check",
      interval: 10 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { checkAllSites } = await import("./monitoringService");
          const result = await checkAllSites();
          if (result.checked > 0 || result.alerts > 0) {
            console.log(`[JobScheduler] Monitoring: ${result.checked} sites checked, ${result.alerts} alerts`);
          }
        } catch (e: any) {
          console.error("[JobScheduler] Monitoring check error:", e.message);
        }
      }
    });

    const urlHealthState: Record<string, { down: boolean; notifiedAt: number; count: number }> = {};

    this.registerJob({
      id: "devmax-url-monitoring",
      name: "DevMax Deployed URLs Health Check",
      interval: 5 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { sshService } = await import("./sshService");
          const results = await sshService.checkAllDeployedUrls();
          if (results.length === 0) return;

          const unhealthy = results.filter(r => !r.healthy);
          const healthy = results.filter(r => r.healthy);
          const now = Date.now();
          const COOLDOWN = 30 * 60 * 1000;

          const newlyDown: typeof unhealthy = [];
          const recovered: typeof healthy = [];

          for (const u of unhealthy) {
            const prev = urlHealthState[u.url];
            if (!prev || !prev.down) {
              newlyDown.push(u);
              urlHealthState[u.url] = { down: true, notifiedAt: now, count: 1 };
            } else {
              prev.count++;
              if (now - prev.notifiedAt > COOLDOWN) {
                newlyDown.push(u);
                prev.notifiedAt = now;
              }
            }
          }

          for (const h of healthy) {
            const prev = urlHealthState[h.url];
            if (prev?.down) {
              recovered.push(h);
              urlHealthState[h.url] = { down: false, notifiedAt: 0, count: 0 };
            }
          }

          if (newlyDown.length > 0 || recovered.length > 0) {
            try {
              const { discordService } = await import("./discordService");
              const parts: string[] = [];
              if (newlyDown.length > 0) {
                const downList = newlyDown.map(u => {
                  const state = urlHealthState[u.url];
                  const suffix = state && state.count > 1 ? ` (down x${state.count})` : "";
                  return `  • ${u.project}: ${u.url} (${u.status || "timeout"})${suffix}`;
                }).join("\n");
                parts.push(`🔴 **${newlyDown.length} URL(s) down:**\n${downList}`);
              }
              if (recovered.length > 0) {
                const upList = recovered.map(h => `  • ${h.project}: ${h.url} (${h.responseTime}ms)`).join("\n");
                parts.push(`🟢 **${recovered.length} URL(s) recovered:**\n${upList}`);
              }
              const alertMessage = `**DevMax Monitoring** — ${healthy.length}/${results.length} healthy\n${parts.join("\n")}`;
              await discordService.sendMessage(alertMessage, "devops");

              broadcastToUser(1, {
                type: "devops.monitoring_alert",
                userId: 1,
                data: {
                  totalUrls: results.length,
                  healthyCount: healthy.length,
                  unhealthyCount: unhealthy.length,
                  newlyDown: newlyDown.map(u => ({ project: u.project, url: u.url, status: u.status })),
                  recovered: recovered.map(h => ({ project: h.project, url: h.url, responseTime: h.responseTime })),
                  message: alertMessage,
                },
                timestamp: Date.now(),
              });

              if (newlyDown.length > 0) {
                try {
                  const { sendPushNotification } = await import("./pushNotificationService");
                  await sendPushNotification(1, {
                    title: `🔴 ${newlyDown.length} app(s) DOWN`,
                    body: newlyDown.map(u => `${u.project}: ${u.url}`).join(", "),
                    tag: "devmax-monitoring",
                    data: { type: "monitoring_alert", url: "/devmax" },
                  });
                } catch {}
              }
            } catch {}
          }

          if (unhealthy.length > 0) {
            console.log(`[JobScheduler] DevMax URLs: ${healthy.length}/${results.length} healthy, ${unhealthy.length} DOWN (newAlerts=${newlyDown.length})`);
          }
        } catch (e: any) {
          console.error("[JobScheduler] DevMax URL monitoring error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "devmax-metrics-collect",
      name: "DevMax Per-Project Metrics Collection",
      interval: 5 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { sshService } = await import("./sshService");
          const projects = await db.execute(sql`SELECT id, deploy_slug FROM devmax_projects WHERE deploy_slug IS NOT NULL AND status = 'active'`).then((r: any) => r.rows || r).catch(() => []);
          if (!projects.length) return;
          const pm2Data = await sshService.executeCommand(
            `pm2 jlist 2>/dev/null || echo "[]"`,
            10000
          );
          let pm2Processes: any[] = [];
          try { pm2Processes = JSON.parse(pm2Data.output || "[]"); } catch {}
          if (!pm2Processes.length) return;
          let collected = 0;
          for (const proj of projects) {
            const slug = proj.deploy_slug;
            for (const env of ["staging", "production"] as const) {
              const pm2Name = env === "production" ? slug : `${slug}-dev`;
              const proc = pm2Processes.find((p: any) => p.name === pm2Name);
              if (proc) {
                const cpu = proc.monit?.cpu || 0;
                const memMb = Math.round((proc.monit?.memory || 0) / 1024 / 1024);
                const uptime = Math.round((Date.now() - (proc.pm2_env?.pm_uptime || 0)) / 1000);
                const restarts = proc.pm2_env?.restart_time || 0;
                const status = proc.pm2_env?.status || "unknown";
                await db.execute(sql`
                  INSERT INTO devmax_metrics (project_id, environment, cpu_percent, memory_mb, uptime_seconds, restarts, status)
                  VALUES (${proj.id}, ${env}, ${cpu}, ${memMb}, ${uptime}, ${restarts}, ${status})
                `).catch(() => {});
                collected++;
              }
            }
          }
          if (collected > 0) {
            await db.execute(sql`DELETE FROM devmax_metrics WHERE collected_at < NOW() - INTERVAL '7 days'`).catch(() => {});
          }
        } catch (e: any) {
          console.error("[JobScheduler] DevMax metrics collection error:", e.message);
        }
      }
    });

    this.registerJob({
      id: "devmax-ssl-check",
      name: "DevMax SSL Certificate Check",
      interval: 24 * 60 * 60 * 1000,
      enabled: true,
      execute: async () => {
        try {
          const { sshService } = await import("./sshService");
          const projects = await db.execute(sql`
            SELECT name, deploy_slug FROM devmax_projects WHERE deploy_slug IS NOT NULL
          `).then((r: any) => r.rows || r);

          const expiringSoon: string[] = [];
          for (const p of projects) {
            for (const domain of [`${p.deploy_slug}.ulyssepro.org`, `${p.deploy_slug}-dev.ulyssepro.org`]) {
              const ssl = await sshService.checkSslStatus(domain);
              if (ssl.valid && ssl.daysLeft !== undefined && ssl.daysLeft < 14) {
                expiringSoon.push(`${domain} (${ssl.daysLeft}j restants)`);
              }
            }
          }

          if (expiringSoon.length > 0) {
            console.log(`[JobScheduler] SSL: ${expiringSoon.length} cert(s) expiring soon`);
            try {
              const { discordService } = await import("./discordService");
              await discordService.sendMessage(
                `⚠️ **SSL Alert** — Certificats expirant bientot:\n${expiringSoon.map(s => `  - ${s}`).join("\n")}`,
                "devops"
              );
            } catch {}
          }
        } catch (e: any) {
          console.error("[JobScheduler] SSL check error:", e.message);
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PROACTIVE JOB HELPERS
  // ═══════════════════════════════════════════════════════════════

  private async generateMorningBrief(userId: number): Promise<{ summary: string; details: string }> {
    const parts: string[] = [];
    
    try {
      // 1. Today's calendar events
      const { calendarService } = await import("./googleCalendarService");
      const today = new Date();
      const events = await calendarService.getTodayEvents(userId);
      if (events.length > 0) {
        parts.push(`[Calendrier] ${events.length} evenement(s) aujourd'hui: ${events.slice(0, 3).map((e: any) => e.summary || "Sans titre").join(", ")}`);
      }
    } catch (e: unknown) {}

    try {
      // 2. High priority tasks
      const todoistService = (await import("./todoistService")).default;
      const tasks = await todoistService.getTasks?.() || [];
      const highPriority = tasks.filter((t: any) => t.priority >= 3);
      if (highPriority.length > 0) {
        parts.push(`[Taches] ${highPriority.length} tache(s) prioritaires`);
      }
    } catch (e: unknown) {}

    try {
      // 3. Today's matches with predictions
      const spm = await lazy.sportsPredMem();
      const matches = await spm.getRecentPredictions(1);
      const todayMatches = matches.filter(m => {
        const matchDate = new Date(m.matchDate);
        const today = new Date();
        return matchDate.toDateString() === today.toDateString();
      });
      if (todayMatches.length > 0) {
        parts.push(`[Sports] ${todayMatches.length} match(s) avec predictions`);
      }
    } catch (e: unknown) {}

    try {
      // 4. Pronos performance
      const spm2 = await lazy.sportsPredMem();
      const stats = await spm2.getPredictionStats();
      if (stats.total > 0) {
        parts.push(`[Pronos] ${stats.successRate}% de reussite (${stats.won}/${stats.total})`);
      }
    } catch (e: unknown) {}

    const summary = parts.length > 0 
      ? `Aujourd'hui: ${parts.length} points clés`
      : "Journée calme, pas d'événements majeurs";

    return {
      summary,
      details: parts.join("\n") || "Aucune information à signaler"
    };
  }

  private async generateValueBets(): Promise<Array<{ match: string; bet: string; confidence: number; value: number }>> {
    const bets: Array<{ match: string; bet: string; confidence: number; value: number }> = [];
    
    try {
      const spm = await lazy.sportsPredMem();
      const predictions = await spm.getRecentPredictions(1);
      const today = new Date();
      
      const todayPredictions = predictions.filter(p => {
        const matchDate = new Date(p.matchDate);
        return matchDate.toDateString() === today.toDateString() || 
               matchDate.getTime() > today.getTime();
      });

      for (const pred of todayPredictions.slice(0, 5)) {
        const recs = pred.recommendations as any;
        if (recs && recs.valueScore > 0 && recs.confidence >= 60) {
          bets.push({
            match: `${pred.homeTeam} vs ${pred.awayTeam}`,
            bet: recs.bestBet || "N/A",
            confidence: recs.confidence || 50,
            value: recs.valueScore || 0
          });
        }
      }

      // Sort by value score
      bets.sort((a, b) => b.value - a.value);
    } catch (e) {
      console.error("[ValueBets] Error generating bets:", e);
    }

    return bets.slice(0, 3);
  }

  private async generateSuguAlerts(): Promise<string[]> {
    const alerts: string[] = [];
    
    try {
      // Check Suguval/Sugumaillane for low stock alerts
      const suguval = await lazy.suguval();
      const sugumaillane = await lazy.sugumaillane();
      
      try {
        const suguvalAlerts = await suguval.getLowStockAlerts();
        for (const alert of suguvalAlerts) {
          alerts.push(`[Suguval] ${alert}`);
        }
      } catch (e) {}

      try {
        const maillaneAlerts = await sugumaillane.getLowStockAlerts();
        for (const alert of maillaneAlerts) {
          alerts.push(`[Sugumaillane] ${alert}`);
        }
      } catch (e) {}
    } catch (e) {
      console.error("[SuguAlerts] Error checking stock:", e);
    }

    return alerts;
  }

  private async runL4AutoPromotion(): Promise<void> {
    try {
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found for L4 auto-promotion");
        return;
      }

      console.log("[JobScheduler] Starting L4 auto-promotion...");
      const lo = await lazy.learningOptimizer();
      const result = await lo.autoPromoteBatch(ownerId);
      console.log(`[JobScheduler] L4 Auto-promotion complete: ${result.promoted}/${result.candidates} promoted`);
    } catch (error) {
      console.error("[JobScheduler] L4 auto-promotion error:", error);
    }
  }

  private async runLearningQualityCheck(): Promise<void> {
    try {
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found for learning quality check");
        return;
      }

      console.log("[JobScheduler] Running learning quality check...");
      const { learningProgress } = await import("@shared/schema");
      const topics = await db.select().from(learningProgress)
        .where(eq(learningProgress.userId, ownerId))
        .limit(10);

      let accelerated = 0;
      for (const topic of topics) {
        const lo = await lazy.learningOptimizer();
        const result = await lo.accelerateLearningCycle(ownerId, topic.id);
        if (result.accelerated) accelerated++;
      }

      console.log(`[JobScheduler] Learning quality check: ${accelerated}/${topics.length} topics accelerated`);
    } catch (error) {
      console.error("[JobScheduler] Learning quality check error:", error);
    }
  }

  private async cleanupMarsHistory(): Promise<void> {
    try {
      const { marsSearchHistory } = await import("@shared/schema");
      
      // Delete entries where expiresAt is in the past
      const result = await db.delete(marsSearchHistory)
        .where(lte(marsSearchHistory.expiresAt, new Date()));
      
      console.log(`[JobScheduler] MARS history cleanup: removed expired entries`);
    } catch (error) {
      console.error("[JobScheduler] MARS history cleanup error:", error);
    }
  }

  private async generateProactiveSuggestions(): Promise<void> {
    try {
      const { behaviorService } = await import("./behaviorService");
      const { users } = await import("@shared/schema");
      
      // Get owner user for proactive suggestions
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found, skipping proactive suggestions");
        return;
      }
      
      const suggestionsCreated = await behaviorService.generateSuggestions(ownerId);
      if (suggestionsCreated > 0) {
        console.log(`[JobScheduler] Generated ${suggestionsCreated} proactive suggestion(s) for owner`);
      }
    } catch (error) {
      console.error("[JobScheduler] Proactive suggestions error:", error);
    }
  }

  private async optimizeMemory(): Promise<void> {
    try {
      const { memoryService } = await import("./memory");
      const { users } = await import("@shared/schema");
      
      // Get all users for memory optimization
      const allUsers = await db.select({ id: users.id }).from(users);
      
      for (const user of allUsers) {
        const result = await memoryService.runOptimization(user.id);
        if (result.decayed > 0 || result.deleted > 0 || result.merged > 0) {
          console.log(`[JobScheduler] Memory optimization for user ${user.id}: decayed=${result.decayed}, deleted=${result.deleted}, merged=${result.merged}`);
        }
      }
    } catch (error) {
      console.error("[JobScheduler] Memory optimization error:", error);
    }
  }

  private async fetchAndProcessEmails(): Promise<void> {
    try {
      const { agentMailService } = await import("./agentMailService");
      
      // Check if AgentMail is connected
      const isConnected = await agentMailService.isConnected();
      if (!isConnected) {
        console.log("[JobScheduler] AgentMail not connected, skipping email fetch");
        return;
      }

      // Fetch and store new emails
      const result = await agentMailService.fetchAndStoreEmails();
      console.log(`[JobScheduler] AgentMail fetch complete: ${result.newEmails} new, ${result.processed} processed`);
      
      // Store summary in owner's memory
      const ownerId = await getOwnerUserId();
      if (ownerId && result.newEmails > 0) {
        await this.updateEmailMemory(ownerId, result);
      }
    } catch (error) {
      console.error("[JobScheduler] AgentMail fetch error:", error);
    }
  }
  
  private async checkAgentMailConnectivity(): Promise<void> {
    try {
      const { agentMailService } = await import("./agentMailService");
      const result = await agentMailService.testConnectivity();
      
      if (result.success) {
        console.log(`[JobScheduler] AgentMail connectivity OK: ${result.inboxes.join(', ')}`);
      } else {
        console.warn(`[JobScheduler] AgentMail connectivity FAILED: ${result.error}`);
      }
    } catch (error) {
      console.error("[JobScheduler] AgentMail connectivity check error:", error);
    }
  }

  private async processGeofenceActions(): Promise<void> {
    try {
      const { geofenceEvents, geofences, ulysseHomework } = await import("@shared/schema");
      
      // Get unprocessed geofence events
      const unprocessedEvents = await db.select({
        event: geofenceEvents,
        geofence: geofences
      })
        .from(geofenceEvents)
        .innerJoin(geofences, eq(geofenceEvents.geofenceId, geofences.id))
        .where(eq(geofenceEvents.actionExecuted, false))
        .limit(50);

      console.log(`[JobScheduler] Processing ${unprocessedEvents.length} geofence events`);

      for (const { event, geofence } of unprocessedEvents) {
        try {
          let actionResult = "no_action";

          if (geofence.linkedAction === "homework" && geofence.linkedActionId) {
            // Trigger homework execution
            const homework = await db.select()
              .from(ulysseHomework)
              .where(eq(ulysseHomework.id, geofence.linkedActionId))
              .limit(1);

            if (homework.length > 0) {
              await homeworkExecutionService.executeHomework(
                homework[0].userId,
                homework[0],
                "auto"
              );
              actionResult = `homework_${homework[0].id}_triggered_${event.eventType}`;
            }
          } else if (geofence.linkedAction === "notification") {
            // Log notification (actual push would require client-side implementation)
            console.log(`[Geofence] Notification: ${geofence.name} - ${event.eventType}`);
            actionResult = "notification_logged";
          }

          // Mark event as processed
          await db.update(geofenceEvents)
            .set({ 
              actionExecuted: true, 
              actionResult 
            })
            .where(eq(geofenceEvents.id, event.id));

        } catch (error) {
          console.error(`[JobScheduler] Failed to process geofence event ${event.id}:`, error);
          await db.update(geofenceEvents)
            .set({ 
              actionExecuted: true, 
              actionResult: `error: ${error}` 
            })
            .where(eq(geofenceEvents.id, event.id));
        }
      }
    } catch (error) {
      console.error("[JobScheduler] Geofence action processing error:", error);
    }
  }

  private async cleanupLocationData(): Promise<void> {
    try {
      const { locationPreferences, locationPoints, users } = await import("@shared/schema");
      
      // Get all users with location preferences
      const prefs = await db.select()
        .from(locationPreferences);

      // Group by user and get minimum retention
      const userRetention = new Map<number, number>();
      for (const pref of prefs) {
        const current = userRetention.get(pref.userId);
        if (!current || pref.retentionDays < current) {
          userRetention.set(pref.userId, pref.retentionDays);
        }
      }

      // Default retention for users without preferences
      const allUsers = await db.select({ id: users.id }).from(users);
      for (const user of allUsers) {
        if (!userRetention.has(user.id)) {
          userRetention.set(user.id, 30); // 30 days default
        }
      }

      let totalDeleted = 0;
      for (const [userId, retentionDays] of Array.from(userRetention.entries())) {
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        
        await db.delete(locationPoints)
          .where(and(
            eq(locationPoints.userId, userId),
            lte(locationPoints.recordedAt, cutoffDate)
          ));
      }

      console.log(`[JobScheduler] Location cleanup complete for ${userRetention.size} users`);
    } catch (error) {
      console.error("[JobScheduler] Location cleanup error:", error);
    }
  }

  // Suguval: Consultation Ulysse at 23:55 Paris time
  private suguvalLastConsultDate: string = "";
  
  // Sugumaillane: Tracking variables
  private sugumaillaneLastConsultDate: string = "";
  private sugumaillaneLastEmailDate: string = "";
  
  private async consultSuguvalWithUlysse(): Promise<void> {
    try {
      const now = new Date();
      const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const hour = parisTime.getHours();
      const minute = parisTime.getMinutes();
      const todayDate = parisTime.toISOString().split("T")[0];
      const dayOfWeek = parisTime.getDay(); // 0=Sunday, 5=Friday, 6=Saturday

      // Skip Friday (5) and Saturday (6) - restaurant closed
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        return; // No consultation on Friday/Saturday evenings
      }

      // Only consult at 23:55 and only once per day
      if (hour === 23 && minute === 55 && this.suguvalLastConsultDate !== todayDate) {
        console.log("[JobScheduler] Suguval: Ulysse consulting cart at 23:55...");
        this.suguvalLastConsultDate = todayDate;
        
        // Get the cart data for Ulysse to analyze
        const suguval = await lazy.suguval();
        const cartData = await suguval.getCheckedItemsForToday();
        const itemCount = cartData.length;
        
        if (itemCount > 0) {
          const ownerId = await getOwnerUserId();
          if (ownerId) {
            const { ulysseMemory } = await import("@shared/schema");
            await db.insert(ulysseMemory).values({
              userId: ownerId,
              category: "suguval",
              key: `cart_analysis_${todayDate}`,
              value: JSON.stringify({
                date: todayDate,
                itemCount,
                items: cartData,
                analyzedAt: new Date().toISOString()
              }),
              confidence: 100,
              source: "Suguval automatic analysis"
            }).onConflictDoNothing();
          }
          console.log(`[JobScheduler] Suguval: Ulysse analyzed ${itemCount} items in cart`);
        } else {
          console.log("[JobScheduler] Suguval: Cart is empty, nothing to analyze");
        }
      }
    } catch (error) {
      console.error("[JobScheduler] Suguval consultation error:", error);
    }
  }

  // Suguval: Send daily email at 23:59 Paris time
  // RÈGLE FERMETURE: Pas d'envoi vendredi soir ni samedi (fermé)
  // RÈGLE WEEKEND:
  // - Vendredi (5): PAS d'envoi → liste reste ouverte tout le weekend
  // - Samedi (6): PAS d'envoi
  // - Dimanche (0): Envoi à 23h59 de la liste vendredi+weekend, labelée "Lundi"
  // - Lundi-Jeudi: Envoi normal à 23h59 pour le lendemain
  // ROBUSTESSE: Fenêtre élargie 23:58-00:05 + catch-up au démarrage
  private suguvalLastEmailDate: string = "";

  private async sendSuguvalDailyEmail(): Promise<void> {
    try {
      const now = new Date();
      const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const hour = parisTime.getHours();
      const minute = parisTime.getMinutes();
      const todayDate = parisTime.toISOString().split("T")[0];
      const dayOfWeek = parisTime.getDay(); // 0=Sun, 1=Mon, 5=Fri, 6=Sat

      // Skip vendredi et samedi — liste reste ouverte jusqu'à dimanche 23h59
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        return;
      }

      // Fenêtre standard: 23:58-23:59 ou catch-up 00:00-00:05
      const isMainWindow = hour === 23 && minute >= 58;
      const isCatchUpWindow = hour === 0 && minute <= 5;

      if (!this.suguvalLastEmailDate) {
        const lastSent = await this.getLastSuguvalEmailDate();
        if (lastSent) {
          this.suguvalLastEmailDate = lastSent;
        }
      }

      if ((isMainWindow || isCatchUpWindow) && this.suguvalLastEmailDate !== todayDate) {
        let targetDate = todayDate;
        if (isCatchUpWindow) {
          const yesterday = new Date(parisTime);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split("T")[0];
          const yesterdayDOW = yesterday.getDay();
          // Ne rattrape pas si hier était vendredi ou samedi
          if (this.suguvalLastEmailDate !== yesterdayStr && yesterdayDOW !== 5 && yesterdayDOW !== 6) {
            targetDate = yesterdayStr;
            console.log(`[JobScheduler] Suguval: Catch-up sending yesterday's email (${yesterdayStr})`);
          }
        }

        console.log(`[JobScheduler] Suguval: Sending daily email (window: ${isMainWindow ? 'main' : 'catch-up'})...`);
        this.suguvalLastEmailDate = targetDate;
        await this.saveSuguvalEmailDate(targetDate);

        // Dimanche : envoie la liste vendredi+weekend pour Lundi
        if (dayOfWeek === 0) {
          console.log("[JobScheduler] Suguval: Dimanche 23h59 - envoi liste consolidée vendredi+weekend pour Lundi");
          const suguval = await lazy.suguval();
          const result = await suguval.sendDailyEmail("Lundi");
          console.log(`[JobScheduler] Suguval email result: ${result.message}`);
        } else {
          const suguval = await lazy.suguval();
          const result = await suguval.sendDailyEmail();
          console.log(`[JobScheduler] Suguval email result: ${result.message}`);
        }
      }
    } catch (error) {
      console.error("[JobScheduler] Suguval email error:", error);
    }
  }
  
  private async getLastSuguvalEmailDate(): Promise<string | null> {
    try {
      const result = await db.select().from(suguvalEmailLogs)
        .where(eq(suguvalEmailLogs.success, true))
        .orderBy(desc(suguvalEmailLogs.sentAt))
        .limit(1);
      if (result.length > 0 && result[0].emailDate) {
        return result[0].emailDate;
      }
      return null;
    } catch (e) {
      return null;
    }
  }
  
  private async saveSuguvalEmailDate(dateStr: string): Promise<void> {
    try {
      // This will be saved by suguvalService.sendDailyEmail via its own logging
      console.log(`[JobScheduler] Suguval email date persisted: ${dateStr}`);
    } catch (e) {
      // Ignore
    }
  }

  // Sugumaillane: Consultation Ulysse at 23:55 Paris time
  private async consultSugumaillaneWithUlysse(): Promise<void> {
    try {
      const now = new Date();
      const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const hour = parisTime.getHours();
      const minute = parisTime.getMinutes();
      const todayDate = parisTime.toISOString().split("T")[0];
      const dayOfWeek = parisTime.getDay();

      // Skip Friday (5) and Saturday (6) - restaurant closed
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        return;
      }

      // Only consult at 23:55 and only once per day
      if (hour === 23 && minute === 55 && this.sugumaillaneLastConsultDate !== todayDate) {
        console.log("[JobScheduler] Sugumaillane: Ulysse consulting cart at 23:55...");
        this.sugumaillaneLastConsultDate = todayDate;
        
        const sugumaillane = await lazy.sugumaillane();
        const cartData = await sugumaillane.getCheckedItemsForToday();
        const itemCount = cartData.length;
        
        if (itemCount > 0) {
          const ownerId = await getOwnerUserId();
          if (ownerId) {
            const { ulysseMemory } = await import("@shared/schema");
            await db.insert(ulysseMemory).values({
              userId: ownerId,
              category: "sugumaillane",
              key: `cart_analysis_${todayDate}`,
              value: JSON.stringify({
                date: todayDate,
                itemCount,
                items: cartData,
                analyzedAt: new Date().toISOString()
              }),
              confidence: 100,
              source: "Sugumaillane automatic analysis"
            }).onConflictDoNothing();
          }
          console.log(`[JobScheduler] Sugumaillane: Ulysse analyzed ${itemCount} items in cart`);
        } else {
          console.log("[JobScheduler] Sugumaillane: Cart is empty, nothing to analyze");
        }
      }
    } catch (error) {
      console.error("[JobScheduler] Sugumaillane consultation error:", error);
    }
  }

  // Sugumaillane: Send daily email at 23:59 Paris time
  // RÈGLE WEEKEND (identique Suguval):
  // - Vendredi (5): PAS d'envoi → liste reste ouverte tout le weekend
  // - Samedi (6): PAS d'envoi
  // - Dimanche (0): Envoi à 23h59 de la liste vendredi+weekend, labelée "Lundi"
  // - Lundi-Jeudi: Envoi normal à 23h59 pour le lendemain
  // ROBUSTESSE: Fenêtre élargie 23:58-00:05 + catch-up au démarrage
  private async sendSugumaillaneDailyEmail(): Promise<void> {
    try {
      const now = new Date();
      const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const hour = parisTime.getHours();
      const minute = parisTime.getMinutes();
      const todayDate = parisTime.toISOString().split("T")[0];
      const dayOfWeek = parisTime.getDay();

      // Skip vendredi et samedi — liste reste ouverte jusqu'à dimanche 23h59
      if (dayOfWeek === 5 || dayOfWeek === 6) {
        return;
      }

      // Fenêtre standard: 23:58-23:59 ou catch-up 00:00-00:05
      const isMainWindow = hour === 23 && minute >= 58;
      const isCatchUpWindow = hour === 0 && minute <= 5;

      if (!this.sugumaillaneLastEmailDate) {
        const lastSent = await this.getLastSugumaillaneEmailDate();
        if (lastSent) {
          this.sugumaillaneLastEmailDate = lastSent;
        }
      }

      if ((isMainWindow || isCatchUpWindow) && this.sugumaillaneLastEmailDate !== todayDate) {
        let targetDate = todayDate;
        if (isCatchUpWindow) {
          const yesterday = new Date(parisTime);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split("T")[0];
          const yesterdayDOW = yesterday.getDay();
          // Ne rattrape pas si hier était vendredi ou samedi
          if (this.sugumaillaneLastEmailDate !== yesterdayStr && yesterdayDOW !== 5 && yesterdayDOW !== 6) {
            targetDate = yesterdayStr;
            console.log(`[JobScheduler] Sugumaillane: Catch-up sending yesterday's email (${yesterdayStr})`);
          }
        }

        console.log(`[JobScheduler] Sugumaillane: Sending daily email (window: ${isMainWindow ? 'main' : 'catch-up'})...`);
        this.sugumaillaneLastEmailDate = targetDate;

        // Dimanche : envoie la liste vendredi+weekend pour Lundi
        if (dayOfWeek === 0) {
          console.log("[JobScheduler] Sugumaillane: Dimanche 23h59 - envoi liste consolidée vendredi+weekend pour Lundi");
          const sugumaillane = await lazy.sugumaillane();
          const result = await sugumaillane.sendDailyEmailWithRetry("Lundi");
          console.log(`[JobScheduler] Sugumaillane email result: ${result.message}`);
        } else {
          const sugumaillane = await lazy.sugumaillane();
          const result = await sugumaillane.sendDailyEmailWithRetry();
          console.log(`[JobScheduler] Sugumaillane email result: ${result.message}`);
        }
      }
    } catch (error) {
      console.error("[JobScheduler] Sugumaillane email error:", error);
    }
  }
  
  private async getLastSugumaillaneEmailDate(): Promise<string | null> {
    try {
      const result = await db.select().from(sugumaillaneEmailLogs)
        .where(eq(sugumaillaneEmailLogs.success, true))
        .orderBy(desc(sugumaillaneEmailLogs.sentAt))
        .limit(1);
      if (result.length > 0 && result[0].emailDate) {
        return result[0].emailDate;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // SUGU Email Recovery: Check for failed emails at 6:00 Paris time and retry them
  private suguRecoveryLastDate: string = "";
  private suguRecoveryStartupDone: boolean = false;
  
  private async recoverFailedSuguEmails(): Promise<void> {
    try {
      const now = new Date();
      const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const hour = parisTime.getHours();
      const minute = parisTime.getMinutes();
      const todayDate = parisTime.toISOString().split("T")[0];

      // CATCH-UP LOGIC: Run recovery at startup if we haven't done it today yet
      // This ensures recovery happens even if the process was down at 6:00 AM
      const shouldRunStartupRecovery = !this.suguRecoveryStartupDone && 
        this.suguRecoveryLastDate !== todayDate &&
        hour >= 6; // Only run catch-up if it's past 6:00 AM

      // Run recovery at 6:00 AM Paris time, or at startup if we missed 6:00
      if (shouldRunStartupRecovery || (hour === 6 && minute === 0 && this.suguRecoveryLastDate !== todayDate)) {
        const recoveryType = shouldRunStartupRecovery ? "startup catch-up" : "6:00";
        console.log(`[JobScheduler] SUGU: Running email recovery (${recoveryType})...`);
        this.suguRecoveryLastDate = todayDate;
        this.suguRecoveryStartupDone = true;

        // Recover Sugumaillane failed emails
        const sugumaillane = await lazy.sugumaillane();
        const maillaneResult = await sugumaillane.recoverFailedEmails();
        console.log(`[JobScheduler] Sugumaillane recovery: ${maillaneResult.recovered}/${maillaneResult.checked} emails recovered`);
        
        if (maillaneResult.failed.length > 0) {
          console.warn(`[JobScheduler] Sugumaillane unrecoverable: ${maillaneResult.failed.join(", ")}`);
        }

        // Recover Suguval failed emails
        try {
          const suguvalSvc = await lazy.suguval();
          const suguvalResult = await suguvalSvc.recoverFailedEmails();
          console.log(`[JobScheduler] Suguval recovery: ${suguvalResult.recovered}/${suguvalResult.checked} emails recovered`);
          if (suguvalResult.failed.length > 0) {
            console.warn(`[JobScheduler] Suguval unrecoverable: ${suguvalResult.failed.join(", ")}`);
          }
        } catch (e) {
          console.warn("[JobScheduler] Suguval recovery error:", e);
        }
      }
    } catch (error) {
      console.error("[JobScheduler] SUGU email recovery error:", error);
    }
  }

  private async updateEmailMemory(userId: number, result: { newEmails: number; processed: number; summary?: string }): Promise<void> {
    try {
      const { ulysseMemory } = await import("@shared/schema");
      const now = new Date();
      
      // Update or create email summary in memory
      const existingMemory = await db.select()
        .from(ulysseMemory)
        .where(and(
          eq(ulysseMemory.userId, userId),
          eq(ulysseMemory.category, "email"),
          eq(ulysseMemory.key, "latest_fetch")
        ))
        .limit(1);

      const value = JSON.stringify({
        fetchTime: now.toISOString(),
        newEmails: result.newEmails,
        processed: result.processed,
        summary: result.summary || `${result.newEmails} nouveaux emails reçus`
      });

      if (existingMemory.length > 0) {
        await db.update(ulysseMemory)
          .set({ value, updatedAt: now })
          .where(eq(ulysseMemory.id, existingMemory[0].id));
      } else {
        await db.insert(ulysseMemory).values({
          userId,
          category: "email",
          key: "latest_fetch",
          value,
          confidence: 100,
          source: "AgentMail automatic fetch"
        });
      }
    } catch (error) {
      console.error("[JobScheduler] Failed to update email memory:", error);
    }
  }

  private runningJobs = new Set<string>();
  private readonly MAX_CONCURRENT_JOBS = 6;

  private lastGcRun = 0;

  private async checkAndRunJobs(): Promise<void> {
    if (!this.running) return;
    
    const now = Date.now();
    
    if (typeof global.gc === "function" && now - this.lastGcRun > 5 * 60 * 1000) {
      try {
        const mem = process.memoryUsage();
        const heapPct = (mem.heapUsed / mem.heapTotal) * 100;
        if (heapPct > 85) {
          global.gc();
          this.lastGcRun = now;
          const after = process.memoryUsage();
          const freedMB = Math.round((mem.heapUsed - after.heapUsed) / 1024 / 1024);
          if (freedMB > 5) {
            console.log(`[JobScheduler] GC freed ${freedMB}MB (${Math.round((after.heapUsed / after.heapTotal) * 100)}% heap)`);
          }
        }
      } catch {}
    }
    
    let ownerId: number | null = null;
    try {
      ownerId = await getOwnerUserId();
    } catch (e) {
    }
    
    let skipJobs: string[] = [];
    let boostJobs: string[] = [];
    if (ownerId) {
      try {
        skipJobs = await dynamicJobPrioritizerService.getJobsToSkip(ownerId);
        boostJobs = await dynamicJobPrioritizerService.getJobsToBoost(ownerId);
      } catch (e) {
      }
    }
    
    const dueJobs: Array<{ id: string; job: ScheduledJob; boosted: boolean }> = [];
    
    for (const [id, job] of Array.from(this.jobs.entries())) {
      if (!job.enabled) continue;
      if (skipJobs.includes(id)) continue;
      if (this.runningJobs.has(id)) continue;
      
      const timeSinceLastRun = now - job.lastRun;
      const effectiveInterval = boostJobs.includes(id) 
        ? job.interval * 0.8 
        : job.interval;
      
      if (timeSinceLastRun >= effectiveInterval) {
        dueJobs.push({ id, job, boosted: boostJobs.includes(id) });
      }
    }

    dueJobs.sort((a, b) => {
      if (a.boosted && !b.boosted) return -1;
      if (!a.boosted && b.boosted) return 1;
      return a.job.interval - b.job.interval;
    });

    const slotsAvailable = this.MAX_CONCURRENT_JOBS - this.runningJobs.size;
    const batch = dueJobs.slice(0, slotsAvailable);

    for (const { id, job, boosted } of batch) {
      this.runningJobs.add(id);
      job.lastRun = now;

      const priorityLabel = boosted ? " [BOOSTED]" : "";
      console.log(`[JobScheduler] Running job: ${job.name}${priorityLabel} (${this.runningJobs.size}/${this.MAX_CONCURRENT_JOBS} slots)`);
      const jobStartTime = Date.now();

      const JOB_TIMEOUT = 120_000;
      const timeoutHandle = setTimeout(() => {
        if (this.runningJobs.has(id)) {
          console.warn(`[JobScheduler] Job TIMEOUT (${JOB_TIMEOUT / 1000}s): ${job.name} — freeing slot`);
          this.runningJobs.delete(id);
        }
      }, JOB_TIMEOUT);

      job.execute()
        .then(async () => {
          const duration = Date.now() - jobStartTime;
          console.log(`[JobScheduler] Completed job: ${job.name} in ${duration}ms`);
          try {
            const { metricsService } = await import("./metricsService");
            metricsService.recordJobExecution(id, job.name, true, duration);
          } catch {}
        })
        .catch(async (error) => {
          const duration = Date.now() - jobStartTime;
          console.error(`[JobScheduler] Job failed: ${job.name}`, error);
          try {
            const { metricsService } = await import("./metricsService");
            const errorMsg = error instanceof Error ? error.message : String(error);
            metricsService.recordJobExecution(id, job.name, false, duration, errorMsg);
          } catch {}
        })
        .finally(() => {
          clearTimeout(timeoutHandle);
          this.runningJobs.delete(id);
        });
    }

    if (dueJobs.length > batch.length) {
      console.log(`[JobScheduler] ${dueJobs.length - batch.length} jobs deferred (concurrency limit)`);
    }
  }

  private async runSelfHealing(): Promise<void> {
    try {
      const { selfHealingService } = await import("./selfHealingService");
      const report = await selfHealingService.runDiagnosticsAndHeal();
      
      if (report.actionsExecuted > 0) {
        console.log(`[JobScheduler] Self-healing: ${report.actionsSuccessful}/${report.actionsExecuted} issues resolved, status: ${report.systemStatus}`);
      }
    } catch (error) {
      console.error("[JobScheduler] Self-healing error:", error);
    }
  }

  private async analyzeFailurePatterns(): Promise<void> {
    try {
      const { failurePatternService } = await import("./failurePatternService");
      const { actionVerificationService } = await import("./actionVerificationService");
      const { users } = await import("@shared/schema");
      
      // Analyze patterns for all users (limiter à 10 pour éviter surcharge)
      const allUsers = await db.select({ id: users.id }).from(users).limit(10);
      
      for (const user of allUsers) {
        // Analyse patterns d'échec
        const analysis = await failurePatternService.analyzePatterns(user.id, 7);
        
        if (analysis.criticalPatterns > 0) {
          console.log(`[JobScheduler] User ${user.id} has ${analysis.criticalPatterns} critical failure patterns, health: ${analysis.overallHealth}%`);
        }
        
        // Auto-tuning des seuils de validation
        await actionVerificationService.autoTuneThresholds(user.id);
      }
    } catch (error) {
      console.error("[JobScheduler] Failure pattern analysis error:", error);
    }
  }

  private async executeDueHomework(recurrence: "daily" | "hourly" | "weekly"): Promise<void> {
    try {
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - this.getRecurrenceInterval(recurrence));
      
      const dueHomework = await db.select()
        .from(ulysseHomework)
        .where(
          and(
            eq(ulysseHomework.status, "pending"),
            eq(ulysseHomework.recurrence, recurrence),
            or(
              isNull(ulysseHomework.lastExecutedAt),
              lte(ulysseHomework.lastExecutedAt, cutoffTime)
            )
          )
        );

      console.log(`[JobScheduler] Found ${dueHomework.length} due ${recurrence} homework tasks`);

      const { homeworkIntelligence } = await import("./homeworkIntelligence");
      
      for (const homework of dueHomework) {
        try {
          const conditions = {
            timeWindow: { start: 6, end: 23 },
            maxRetries: 5,
            minIntervalHours: recurrence === "hourly" ? 0.5 : recurrence === "daily" ? 12 : 24 * 6
          };
          
          const check = await homeworkIntelligence.shouldExecuteNow(homework, conditions);
          if (!check.execute) {
            console.log(`[JobScheduler] Skipping homework ${homework.id}: ${check.reason}`);
            continue;
          }
          
          await homeworkExecutionService.executeHomework(homework.userId, homework, "auto");
        } catch (error) {
          console.error(`[JobScheduler] Failed to execute homework ${homework.id}:`, error);
        }
      }
    } catch (error) {
      console.error(`[JobScheduler] Error checking ${recurrence} homework:`, error);
    }
  }

  private getRecurrenceInterval(recurrence: string): number {
    switch (recurrence) {
      case "hourly": return 60 * 60 * 1000;
      case "daily": return 24 * 60 * 60 * 1000;
      case "weekly": return 7 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  private async runWebsiteMonitoring(): Promise<void> {
    try {
      const { checkAllSites } = await import("./monitoringService");
      const result = await checkAllSites();
      if (result.checked > 0) {
        console.log(`[JobScheduler] Website monitoring: ${result.checked} sites checked`);
      }
    } catch (error) {
      console.error("[JobScheduler] Website monitoring error:", error);
    }
  }

  private async cleanupHomeworkCaches(): Promise<void> {
    try {
      const { homeworkIntelligence } = await import("./homeworkIntelligence");
      homeworkIntelligence.clearOldCaches();
      const stats = homeworkIntelligence.getPromptCacheStats();
      console.log(`[JobScheduler] Homework cache cleanup: ${stats.size} prompts cached, avg score: ${stats.avgScore.toFixed(2)}`);
    } catch (error) {
      console.error("[JobScheduler] Homework cache cleanup error:", error);
    }
  }

  private async generateWeeklyUlysseJournal(): Promise<void> {
    try {
      const now = new Date();
      const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const dayOfWeek = parisTime.getDay(); // 0 = Sunday, 6 = Saturday
      const hour = parisTime.getHours();
      
      // Only run on Sunday (day 0) between 21:00-22:00 Paris time
      if (dayOfWeek !== 0 || hour !== 21) {
        return;
      }
      
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found, skipping Ulysse weekly journal");
        return;
      }
      
      console.log("[JobScheduler] Generating Ulysse weekly self-reflection journal...");
      
      const sr = await lazy.selfReflection();
      const journal = await sr.generateSelfReflectionJournal(ownerId);
      
      const brain = await lazy.brain();
      await brain.addKnowledge(ownerId, {
        type: "reflection",
        title: `Journal d'Introspection #${journal.journalNumber}`,
        category: "self-reflection",
        content: sr.formatJournalForChat(journal),
        sourceType: "autonomous",
        importance: 9
      });
      
      // Send Discord notification with action plan
      const criticalActions = journal.sections.actionPlan.items.filter((a: any) => a.priority === "critique");
      const actionSummary = journal.sections.actionPlan.items.slice(0, 2).map((a: any) => `• **[${a.owner}]** ${a.action} (${a.priority})`).join("\n");
      
      const discord = await lazy.discord();
      await discord.sendWebhook({
        username: "Ulysse",
        content: `📓 **Journal d'Introspection #${journal.journalNumber}** généré + ${journal.sections.actionPlan.items.length} actions`,
        embeds: [{
          title: `Journal #${journal.journalNumber}`,
          description: `Période: ${journal.period}`,
          color: 5814783, // Purple
          fields: [
            { name: "État actuel", value: journal.sections.present.suggestions?.slice(0, 2).join("\n") || "État analysé", inline: false },
            { name: "Plan d'action (semaine)", value: actionSummary || "Pas d'actions prioritaires", inline: false },
            { name: "Propositions", value: `${journal.sections.codeModifications.suggestions.length} code upgrades, ${journal.sections.workflowImprovements.suggestions.length} workflow improvements`, inline: true }
          ],
          footer: { text: "Ulysse Self-Reflection System" },
          timestamp: new Date().toISOString()
        }]
      });
      
      console.log(`[JobScheduler] Journal #${journal.journalNumber} generated with ${journal.sections.actionPlan.items.length} actions`);
    } catch (error) {
      console.error("[JobScheduler] Error generating Ulysse weekly journal:", error);
    }
  }

  private async generateProactiveAlerts(): Promise<void> {
    try {
      const now = new Date();
      const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const hour = parisTime.getHours();
      
      // Only run at 7 AM Paris time
      if (hour !== 7) {
        return;
      }
      
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        return;
      }
      
      console.log("[JobScheduler] Generating proactive alerts...");
      const alerts: string[] = [];
      
      const { metricsService } = await import("./metricsService");
      const health = metricsService.getSystemHealth();
      if (health.serverErrorRate > 0.05) {
        alerts.push(`⚠️ **Erreurs système** - Taux: ${(health.serverErrorRate * 100).toFixed(1)}% (seuil: 5%)`);
      }
      if (health.avgLatency > 500) {
        alerts.push(`🐌 **Latence élevée** - ${health.avgLatency}ms (normal: <300ms)`);
      }
      
      if (alerts.length > 0) {
        const discord = await lazy.discord();
        await discord.sendWebhook({
          username: "Ulysse Alert Bot",
          content: "🚨 **Alertes quotidiennes**",
          embeds: [{
            title: "État système",
            description: alerts.join("\n"),
            color: 16711680, // Red
            footer: { text: "Ulysse Proactive Monitoring" }
          }]
        });
      }
      
      console.log(`[JobScheduler] Proactive alerts check complete: ${alerts.length} alerts`);
    } catch (error) {
      console.error("[JobScheduler] Error generating proactive alerts:", error);
    }
  }

  private async generateWeeklyHomeworkInsights(): Promise<void> {
    try {
      const { homeworkIntelligence } = await import("./homeworkIntelligence");
      const { memoryService } = await import("./memory");
      
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found, skipping weekly insights");
        return;
      }
      
      const insights = await homeworkIntelligence.generateWeeklyInsights(ownerId);
      
      await memoryService.updateOrCreateMemory(
        ownerId,
        "knowledge",
        "weekly_homework_insights",
        insights,
        `weekly_insights:${new Date().toISOString().slice(0, 10)}`
      );
      
      console.log(`[JobScheduler] Generated weekly homework insights for owner`);
    } catch (error) {
      console.error("[JobScheduler] Weekly homework insights error:", error);
    }
  }

  private async syncMarseilleWeather(): Promise<void> {
    try {
      const { refreshWeatherCache, getCacheInfo } = await import("./marseilleWeather");
      await refreshWeatherCache();
      const cacheInfo = getCacheInfo();
      console.log(`[JobScheduler] Weather sync complete. Last update: ${cacheInfo.lastUpdate?.toLocaleString("fr-FR")}`);
    } catch (error) {
      console.error("[JobScheduler] Weather sync error:", error);
    }
  }

  private async runAutonomousLearning(): Promise<void> {
    try {
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found for autonomous learning");
        return;
      }

      console.log("[JobScheduler] Starting autonomous learning cycle for user", ownerId);
      const alv2 = await lazy.autonomousLearning();
      const results = await alv2.runLearningCycle(ownerId);
      
      console.log(`[JobScheduler] Autonomous learning complete: ${results.topicsProcessed} topics, ${results.totalFacts} facts, ${results.totalConnections} connections, ${results.totalInsights} insights`);
      
      if (results.errors.length > 0) {
        console.warn("[JobScheduler] Learning errors:", results.errors);
      }
    } catch (error) {
      console.error("[JobScheduler] Autonomous learning error:", error);
    }
  }

  private async runL5CrossDomainInsights(): Promise<void> {
    try {
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found for L5 cross-domain");
        return;
      }

      console.log("[JobScheduler] Starting L5 cross-domain insights generation...");
      const result = await autonomousLearningServiceV2.generateL5CrossDomainInsights(ownerId);
      console.log(`[JobScheduler] L5 Cross-Domain complete: ${result.generated} insights generated`);
    } catch (error) {
      console.error("[JobScheduler] L5 cross-domain error:", error);
    }
  }

  private async applyKnowledgeDecay(): Promise<void> {
    try {
      const ownerId = await getOwnerUserId();
      if (!ownerId) {
        console.log("[JobScheduler] No owner found for confidence decay");
        return;
      }

      console.log("[JobScheduler] Applying confidence decay...");
      const result = await autonomousLearningServiceV2.applyConfidenceDecay(ownerId);
      console.log(`[JobScheduler] Confidence decay complete: ${result.decayed} topics decayed`);
    } catch (error) {
      console.error("[JobScheduler] Confidence decay error:", error);
    }
  }

  getJobStatus(): { id: string; name: string; lastRun: number; enabled: boolean; nextRun: number }[] {
    const now = Date.now();
    const jobs = Array.from(this.jobs.values());
    return jobs.map(job => ({
      id: job.id,
      name: job.name,
      lastRun: job.lastRun,
      enabled: job.enabled,
      nextRun: job.lastRun + job.interval - now
    }));
  }
}

export const jobScheduler = new JobScheduler();
