import { db } from "../db";
import { conversationMessages, ulysseHomework, ulysseDiagnostics } from "@shared/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";

const LOG_PREFIX = "[DynamicPrioritizer]";

interface JobPriority {
  jobId: string;
  basePriority: number;
  contextBoost: number;
  timeBoost: number;
  urgencyBoost: number;
  finalPriority: number;
  reason: string;
}

interface SystemContext {
  hourOfDay: number;
  dayOfWeek: number;
  recentUserActivity: boolean;
  pendingHomework: number;
  activeIssues: number;
  lastLearningCycle: Date | null;
  isWeekend: boolean;
  isMorning: boolean;
  isEvening: boolean;
  isNight: boolean;
}

interface JobConfig {
  id: string;
  name: string;
  baseWeight: number;
  preferredHours?: number[];
  avoidHours?: number[];
  weekendOnly?: boolean;
  weekdayOnly?: boolean;
  activityDependent?: boolean;
  urgencyKeywords?: string[];
}

const JOB_CONFIGS: JobConfig[] = [
  { id: "homework-hourly", name: "Hourly Homework", baseWeight: 80, activityDependent: true },
  { id: "homework-daily", name: "Daily Homework", baseWeight: 70, preferredHours: [8, 9, 10, 18, 19, 20] },
  { id: "homework-weekly", name: "Weekly Homework", baseWeight: 60, weekendOnly: false, preferredHours: [9, 10, 11] },
  { id: "cache-cleanup", name: "Cache Cleanup", baseWeight: 30, preferredHours: [3, 4, 5], avoidHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18] },
  { id: "knowledge-sync", name: "Knowledge Sync", baseWeight: 50, activityDependent: true },
  { id: "agentmail-fetch", name: "AgentMail Fetch", baseWeight: 85, preferredHours: [7, 8, 9, 12, 13, 17, 18, 19] },
  { id: "agentmail-connectivity", name: "AgentMail Check", baseWeight: 40 },
  { id: "memory-optimization", name: "Memory Optimization", baseWeight: 45, preferredHours: [2, 3, 4, 5], avoidHours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
  { id: "self-healing", name: "Self-Healing", baseWeight: 95, urgencyKeywords: ["critical", "error", "failure"] },
  { id: "failure-pattern-analysis", name: "Failure Analysis", baseWeight: 70 },
  { id: "proactive-suggestions", name: "Proactive Suggestions", baseWeight: 55, activityDependent: true, preferredHours: [8, 9, 10, 17, 18, 19] },
  { id: "website-monitoring", name: "Website Monitoring", baseWeight: 65, preferredHours: [6, 7, 8, 18, 19, 20] },
  { id: "autonomous-learning", name: "Learning Cycle", baseWeight: 75, preferredHours: [1, 2, 3, 4, 5, 22, 23], avoidHours: [9, 10, 11, 12, 13, 14, 15, 16] },
  { id: "l5-cross-domain", name: "L5 Cross-Domain", baseWeight: 65, preferredHours: [2, 3, 4] },
  { id: "confidence-decay", name: "Confidence Decay", baseWeight: 50, preferredHours: [3, 4, 5] },
  { id: "homework-weekly-insights", name: "Weekly Insights", baseWeight: 60, weekendOnly: false, preferredHours: [10, 11, 18, 19] },
  { id: "weather-sync", name: "Weather Sync", baseWeight: 40, preferredHours: [6, 7, 8, 12, 18] },
  { id: "sports-daily-sync", name: "Sports Cache", baseWeight: 70, preferredHours: [10, 11, 14, 15, 18, 19, 20] },
  { id: "sports-verified-watch", name: "Sports Watch", baseWeight: 80, preferredHours: [14, 15, 16, 17, 18, 19, 20, 21, 22] },
  { id: "sports-odds-refresh", name: "Sports Odds", baseWeight: 75, preferredHours: [10, 11, 14, 15, 18, 19] },
  { id: "sports-prediction-tracking", name: "Prediction Tracking", baseWeight: 85, preferredHours: [22, 23, 0, 1] },
  { id: "sports-prediction-brain-learning", name: "Prediction Learning", baseWeight: 70, preferredHours: [2, 3, 4, 5] },
  { id: "brain-sync", name: "Brain Sync", baseWeight: 60, preferredHours: [3, 4, 5, 6] },
  { id: "screenshot-cache-cleanup", name: "Screenshot Cleanup", baseWeight: 25, preferredHours: [3, 4, 5] },
  { id: "suguval-ulysse-consult", name: "Suguval Consultation", baseWeight: 90, preferredHours: [23] },
  { id: "suguval-daily-email", name: "Suguval Email", baseWeight: 88, preferredHours: [23] },
  { id: "sugumaillane-ulysse-consult", name: "Sugumaillane Consultation", baseWeight: 90, preferredHours: [23] },
  { id: "sugumaillane-daily-email", name: "Sugumaillane Email", baseWeight: 88, preferredHours: [23] },
  { id: "sugu-email-recovery", name: "SUGU Recovery", baseWeight: 85, preferredHours: [6, 7] },
  { id: "geofence-actions", name: "Geofence Processor", baseWeight: 60 },
  { id: "location-cleanup", name: "Location Cleanup", baseWeight: 35, preferredHours: [3, 4, 5] },
  { id: "mars-history-cleanup", name: "MARS Cleanup", baseWeight: 30, preferredHours: [3, 4, 5] },
  { id: "homework-cache-cleanup", name: "Homework Cache Cleanup", baseWeight: 25, preferredHours: [3, 4, 5] },
  { id: "l4-auto-promotion", name: "L4 Auto Promotion", baseWeight: 65, preferredHours: [2, 3, 4, 5] },
  { id: "learning-quality-check", name: "Learning Quality Check", baseWeight: 55, preferredHours: [3, 4, 5, 6] }
];

class DynamicJobPrioritizerService {
  private context: SystemContext | null = null;
  private lastContextUpdate: number = 0;
  private readonly CONTEXT_TTL = 5 * 60 * 1000;

  async getSystemContext(userId: number): Promise<SystemContext> {
    const now = Date.now();
    
    if (this.context && (now - this.lastContextUpdate) < this.CONTEXT_TTL) {
      return this.context;
    }

    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();
    
    const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);
    const [recentMessages] = await db.select({ count: count() })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.userId, userId),
        gte(conversationMessages.createdAt, fiveMinutesAgo)
      ));

    const [pendingHomework] = await db.select({ count: count() })
      .from(ulysseHomework)
      .where(and(
        eq(ulysseHomework.userId, userId),
        eq(ulysseHomework.status, "active")
      ));

    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const [activeIssues] = await db.select({ count: count() })
      .from(ulysseDiagnostics)
      .where(and(
        gte(ulysseDiagnostics.createdAt, oneDayAgo),
        sql`${ulysseDiagnostics.severity} IN ('critical', 'high')`
      ));

    this.context = {
      hourOfDay: currentHour,
      dayOfWeek: currentDay,
      recentUserActivity: (recentMessages?.count || 0) > 0,
      pendingHomework: pendingHomework?.count || 0,
      activeIssues: activeIssues?.count || 0,
      lastLearningCycle: null,
      isWeekend: currentDay === 0 || currentDay === 6,
      isMorning: currentHour >= 6 && currentHour < 12,
      isEvening: currentHour >= 18 && currentHour < 23,
      isNight: currentHour >= 23 || currentHour < 6
    };

    this.lastContextUpdate = now;
    return this.context;
  }

  async calculateJobPriority(jobId: string, userId: number): Promise<JobPriority> {
    const config = JOB_CONFIGS.find(j => j.id === jobId);
    if (!config) {
      return {
        jobId,
        basePriority: 50,
        contextBoost: 0,
        timeBoost: 0,
        urgencyBoost: 0,
        finalPriority: 50,
        reason: "Unknown job - default priority"
      };
    }

    const context = await this.getSystemContext(userId);
    
    let contextBoost = 0;
    let timeBoost = 0;
    let urgencyBoost = 0;
    const reasons: string[] = [];

    if (config.preferredHours?.includes(context.hourOfDay)) {
      timeBoost += 15;
      reasons.push("preferred hour");
    } else if (config.avoidHours?.includes(context.hourOfDay)) {
      timeBoost -= 20;
      reasons.push("avoid hour");
    }

    if (config.weekendOnly && !context.isWeekend) {
      timeBoost -= 30;
      reasons.push("weekday (weekend job)");
    }
    if (config.weekdayOnly && context.isWeekend) {
      timeBoost -= 30;
      reasons.push("weekend (weekday job)");
    }

    if (config.activityDependent) {
      if (context.recentUserActivity) {
        contextBoost += 20;
        reasons.push("user active");
      } else {
        contextBoost -= 10;
        reasons.push("user inactive");
      }
    }

    if (context.activeIssues > 0) {
      if (config.id === "self-healing" || config.id === "failure-pattern") {
        urgencyBoost += 30;
        reasons.push(`${context.activeIssues} active issues`);
      }
    }

    if (context.pendingHomework > 3 && config.id.startsWith("homework")) {
      urgencyBoost += 15;
      reasons.push(`${context.pendingHomework} pending homework`);
    }

    if (context.isNight) {
      if (["cache-cleanup", "memory-optimization", "autonomous-learning", "confidence-decay", "brain-sync"].includes(config.id)) {
        timeBoost += 10;
        reasons.push("night optimization window");
      }
    }

    const finalPriority = Math.max(0, Math.min(100, 
      config.baseWeight + contextBoost + timeBoost + urgencyBoost
    ));

    return {
      jobId,
      basePriority: config.baseWeight,
      contextBoost,
      timeBoost,
      urgencyBoost,
      finalPriority,
      reason: reasons.length > 0 ? reasons.join(", ") : "base priority"
    };
  }

  async getPrioritizedJobOrder(userId: number): Promise<JobPriority[]> {
    const priorities: JobPriority[] = [];
    
    for (const config of JOB_CONFIGS) {
      const priority = await this.calculateJobPriority(config.id, userId);
      priorities.push(priority);
    }

    priorities.sort((a, b) => b.finalPriority - a.finalPriority);

    console.log(`${LOG_PREFIX} Job priorities calculated:`, 
      priorities.slice(0, 5).map(p => `${p.jobId}:${p.finalPriority}`).join(", ")
    );

    return priorities;
  }

  async shouldRunJob(jobId: string, userId: number): Promise<{ should: boolean; priority: number; reason: string }> {
    const priority = await this.calculateJobPriority(jobId, userId);
    
    const should = priority.finalPriority >= 40;
    
    return {
      should,
      priority: priority.finalPriority,
      reason: should 
        ? `Priority ${priority.finalPriority}: ${priority.reason}`
        : `Skipped (priority ${priority.finalPriority} < 40): ${priority.reason}`
    };
  }

  private cachedPriorities: { ts: number; userId: number; data: JobPriority[] } | null = null;

  private async getCachedPriorities(userId: number): Promise<JobPriority[]> {
    const now = Date.now();
    if (this.cachedPriorities && this.cachedPriorities.userId === userId && now - this.cachedPriorities.ts < 5000) {
      return this.cachedPriorities.data;
    }
    const data = await this.getPrioritizedJobOrder(userId);
    this.cachedPriorities = { ts: now, userId, data };
    return data;
  }

  async getJobsToSkip(userId: number): Promise<string[]> {
    const priorities = await this.getCachedPriorities(userId);
    return priorities.filter(p => p.finalPriority < 40).map(p => p.jobId);
  }

  async getJobsToBoost(userId: number): Promise<string[]> {
    const priorities = await this.getCachedPriorities(userId);
    return priorities.filter(p => p.finalPriority >= 80).map(p => p.jobId);
  }

  getJobConfig(jobId: string): JobConfig | undefined {
    return JOB_CONFIGS.find(j => j.id === jobId);
  }

  async getContextSummary(userId: number): Promise<string> {
    const context = await this.getSystemContext(userId);
    
    return `Hour: ${context.hourOfDay}h | ` +
           `Day: ${context.isWeekend ? "Weekend" : "Weekday"} | ` +
           `User: ${context.recentUserActivity ? "Active" : "Inactive"} | ` +
           `Homework: ${context.pendingHomework} | ` +
           `Issues: ${context.activeIssues}`;
  }
}

export const dynamicJobPrioritizerService = new DynamicJobPrioritizerService();
