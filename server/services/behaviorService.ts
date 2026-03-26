/**
 * Behavior Service - Phase 3 Proactive Prediction ML
 * 
 * Analyzes user behavior patterns to:
 * - Detect recurring routines (time-based, location-based)
 * - Generate proactive suggestions
 * - Learn from user feedback
 * 
 * Uses simple heuristics (not full ML) for pattern detection:
 * - Same action at similar time = routine
 * - Same action sequence = workflow
 * - Location-triggered actions = geofence automation
 */

import { db } from "../db";
import { 
  userBehaviorEvents, 
  proactiveSuggestions, 
  learnedPatterns,
  smartScenes
} from "@shared/schema";
import type { 
  UserBehaviorEvent, 
  ProactiveSuggestion, 
  InsertProactiveSuggestion,
  LearnedPattern,
  InsertLearnedPattern
} from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

interface PatternCandidate {
  type: string;
  name: string;
  conditions: Record<string, any>;
  actions: Array<{ type: string; id: number; action: string; params?: any }>;
  occurrences: number;
  confidence: number;
}

class BehaviorService {
  
  // Minimum occurrences to consider a pattern
  private readonly MIN_OCCURRENCES = 3;
  // Minimum confidence to show a suggestion
  private readonly MIN_CONFIDENCE = 50;
  // Time window for "same time" (in hours)
  private readonly TIME_WINDOW_HOURS = 1;
  
  // ============================================================================
  // EVENT ANALYSIS
  // ============================================================================
  
  /**
   * Analyze recent behavior events to detect patterns
   */
  async analyzePatterns(userId: number): Promise<PatternCandidate[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Get recent behavior events
    const events = await db.select()
      .from(userBehaviorEvents)
      .where(and(
        eq(userBehaviorEvents.userId, userId),
        gte(userBehaviorEvents.occurredAt, thirtyDaysAgo)
      ))
      .orderBy(desc(userBehaviorEvents.occurredAt))
      .limit(500);
    
    if (events.length < this.MIN_OCCURRENCES) {
      return [];
    }
    
    const patterns: PatternCandidate[] = [];
    
    // Detect time-based routines
    const timePatterns = this.detectTimePatterns(events);
    patterns.push(...timePatterns);
    
    // Detect day-of-week routines
    const dayPatterns = this.detectDayPatterns(events);
    patterns.push(...dayPatterns);
    
    // Detect action sequences
    const sequencePatterns = this.detectSequencePatterns(events);
    patterns.push(...sequencePatterns);
    
    return patterns.filter(p => p.confidence >= this.MIN_CONFIDENCE);
  }
  
  private detectTimePatterns(events: UserBehaviorEvent[]): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    
    // Group events by target and hour
    const byTargetAndHour = new Map<string, { hour: number; count: number; events: UserBehaviorEvent[] }[]>();
    
    for (const event of events) {
      if (!event.targetId || !event.targetName) continue;
      
      const key = `${event.targetType}:${event.targetId}`;
      const context = event.context as Record<string, any>;
      const hour = context?.hour ?? new Date(event.occurredAt || Date.now()).getHours();
      
      if (!byTargetAndHour.has(key)) {
        byTargetAndHour.set(key, []);
      }
      
      const entries = byTargetAndHour.get(key)!;
      let found = entries.find(e => Math.abs(e.hour - hour) <= this.TIME_WINDOW_HOURS);
      
      if (found) {
        found.count++;
        found.events.push(event);
      } else {
        entries.push({ hour, count: 1, events: [event] });
      }
    }
    
    // Find patterns with enough occurrences
    for (const [key, entries] of Array.from(byTargetAndHour.entries())) {
      for (const entry of entries) {
        if (entry.count >= this.MIN_OCCURRENCES) {
          const [targetType, targetIdStr] = key.split(":");
          const targetId = parseInt(targetIdStr);
          const lastEvent = entry.events[0];
          const newState = lastEvent.newState as Record<string, any>;
          
          patterns.push({
            type: "time_routine",
            name: `${lastEvent.targetName} à ${entry.hour}h`,
            conditions: {
              hour: entry.hour,
              hourRange: [Math.max(0, entry.hour - 1), Math.min(23, entry.hour + 1)],
            },
            actions: [{
              type: targetType || "device",
              id: targetId,
              action: lastEvent.eventType || "toggle",
              params: newState,
            }],
            occurrences: entry.count,
            confidence: Math.min(100, Math.round((entry.count / this.MIN_OCCURRENCES) * 50)),
          });
        }
      }
    }
    
    return patterns;
  }
  
  private detectDayPatterns(events: UserBehaviorEvent[]): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    
    // Group events by target, day of week, and hour
    const byTargetDayHour = new Map<string, { 
      days: Set<number>; 
      hour: number; 
      count: number; 
      events: UserBehaviorEvent[] 
    }>();
    
    for (const event of events) {
      if (!event.targetId || !event.targetName) continue;
      
      const context = event.context as Record<string, any>;
      const hour = context?.hour ?? new Date(event.occurredAt || Date.now()).getHours();
      const day = context?.dayOfWeek ?? new Date(event.occurredAt || Date.now()).getDay();
      
      const key = `${event.targetType}:${event.targetId}:${hour}`;
      
      if (!byTargetDayHour.has(key)) {
        byTargetDayHour.set(key, { days: new Set(), hour, count: 0, events: [] });
      }
      
      const entry = byTargetDayHour.get(key)!;
      entry.days.add(day);
      entry.count++;
      entry.events.push(event);
    }
    
    // Find weekday-only or weekend-only patterns
    for (const [key, entry] of Array.from(byTargetDayHour.entries())) {
      if (entry.count < this.MIN_OCCURRENCES) continue;
      
      const days = Array.from(entry.days);
      const isWeekdayOnly = days.every((d: number) => d >= 1 && d <= 5);
      const isWeekendOnly = days.every((d: number) => d === 0 || d === 6);
      
      if ((isWeekdayOnly || isWeekendOnly) && days.length >= 2) {
        const [targetType, targetIdStr] = key.split(":");
        const targetId = parseInt(targetIdStr);
        const lastEvent = entry.events[0];
        const newState = lastEvent.newState as Record<string, any>;
        
        patterns.push({
          type: "day_routine",
          name: `${lastEvent.targetName} ${isWeekdayOnly ? "en semaine" : "le weekend"} à ${entry.hour}h`,
          conditions: {
            hour: entry.hour,
            dayOfWeek: days,
            isWeekend: isWeekendOnly,
          },
          actions: [{
            type: targetType || "device",
            id: targetId,
            action: lastEvent.eventType || "toggle",
            params: newState,
          }],
          occurrences: entry.count,
          confidence: Math.min(100, Math.round((entry.count / this.MIN_OCCURRENCES) * 60)),
        });
      }
    }
    
    return patterns;
  }
  
  private detectSequencePatterns(events: UserBehaviorEvent[]): PatternCandidate[] {
    // Detect sequences of actions that happen together (within 5 minutes)
    const patterns: PatternCandidate[] = [];
    const sequences = new Map<string, { actions: any[]; count: number }>();
    
    // Sort by time
    const sorted = [...events].sort((a, b) => 
      new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime()
    );
    
    // Find pairs of actions within 5 minutes
    for (let i = 0; i < sorted.length - 1; i++) {
      const first = sorted[i];
      const second = sorted[i + 1];
      
      if (!first.targetId || !second.targetId) continue;
      if (first.targetId === second.targetId) continue; // Skip same device
      
      const timeDiff = new Date(second.occurredAt || 0).getTime() - 
                      new Date(first.occurredAt || 0).getTime();
      
      if (timeDiff <= 300000) { // 5 minutes
        const key = `${first.targetType}:${first.targetId}->${second.targetType}:${second.targetId}`;
        
        if (!sequences.has(key)) {
          sequences.set(key, {
            actions: [
              { type: first.targetType, id: first.targetId, name: first.targetName },
              { type: second.targetType, id: second.targetId, name: second.targetName },
            ],
            count: 0,
          });
        }
        
        sequences.get(key)!.count++;
      }
    }
    
    // Convert to patterns
    for (const [key, seq] of Array.from(sequences.entries())) {
      if (seq.count >= this.MIN_OCCURRENCES) {
        patterns.push({
          type: "sequence",
          name: `${seq.actions[0].name} puis ${seq.actions[1].name}`,
          conditions: {
            sequence: true,
          },
          actions: seq.actions.map((a: any) => ({
            type: a.type || "device",
            id: a.id,
            action: "toggle",
          })),
          occurrences: seq.count,
          confidence: Math.min(100, Math.round((seq.count / this.MIN_OCCURRENCES) * 40)),
        });
      }
    }
    
    return patterns;
  }
  
  // ============================================================================
  // SUGGESTION GENERATION
  // ============================================================================
  
  /**
   * Generate suggestions from detected patterns
   */
  async generateSuggestions(userId: number): Promise<number> {
    const patterns = await this.analyzePatterns(userId);
    let created = 0;
    
    for (const pattern of patterns) {
      // Check if we already have a similar suggestion
      const existing = await db.select()
        .from(proactiveSuggestions)
        .where(and(
          eq(proactiveSuggestions.userId, userId),
          eq(proactiveSuggestions.title, pattern.name),
          eq(proactiveSuggestions.status, "pending")
        ))
        .limit(1);
      
      if (existing.length > 0) continue;
      
      // Check if user already rejected a similar pattern
      const rejected = await db.select()
        .from(learnedPatterns)
        .where(and(
          eq(learnedPatterns.userId, userId),
          eq(learnedPatterns.name, pattern.name),
          eq(learnedPatterns.isConfirmed, false)
        ))
        .limit(1);
      
      if (rejected.length > 0) continue;
      
      // Create suggestion
      const suggestion: InsertProactiveSuggestion = {
        userId,
        suggestionType: pattern.type === "sequence" ? "automation" : "routine",
        title: pattern.name,
        description: `Détecté ${pattern.occurrences} fois. Voulez-vous automatiser?`,
        action: pattern.actions.length > 1 ? "scene" : "device",
        actionTarget: pattern.actions[0]?.id?.toString(),
        actionParams: pattern.actions[0]?.params || {},
        confidence: pattern.confidence,
        basedOnPatterns: [pattern],
        triggerConditions: pattern.conditions,
        status: "pending",
      };
      
      await db.insert(proactiveSuggestions).values(suggestion);
      created++;
      
      console.log(`[BehaviorService] Created suggestion: "${pattern.name}" (confidence: ${pattern.confidence}%)`);
    }
    
    return created;
  }
  
  /**
   * Get pending suggestions for a user
   */
  async getPendingSuggestions(userId: number): Promise<ProactiveSuggestion[]> {
    return db.select()
      .from(proactiveSuggestions)
      .where(and(
        eq(proactiveSuggestions.userId, userId),
        eq(proactiveSuggestions.status, "pending")
      ))
      .orderBy(desc(proactiveSuggestions.confidence));
  }
  
  /**
   * Respond to a suggestion
   */
  async respondToSuggestion(
    userId: number, 
    suggestionId: number, 
    response: "accept" | "reject" | "automate"
  ): Promise<boolean> {
    const [suggestion] = await db.select()
      .from(proactiveSuggestions)
      .where(and(
        eq(proactiveSuggestions.id, suggestionId),
        eq(proactiveSuggestions.userId, userId)
      ));
    
    if (!suggestion) return false;
    
    // Update suggestion status
    const newStatus = response === "reject" ? "rejected" : "accepted";
    await db.update(proactiveSuggestions)
      .set({
        status: newStatus,
        respondedAt: new Date(),
        userFeedback: response,
      })
      .where(eq(proactiveSuggestions.id, suggestionId));
    
    // If accepted or automated, create a learned pattern
    if (response === "accept" || response === "automate") {
      const patterns = suggestion.basedOnPatterns as PatternCandidate[];
      const pattern = patterns[0];
      
      if (pattern) {
        const learnedPattern: InsertLearnedPattern = {
          userId,
          patternType: pattern.type,
          name: pattern.name,
          description: suggestion.description || undefined,
          conditions: pattern.conditions,
          actions: pattern.actions,
          confidence: pattern.confidence,
          occurrences: pattern.occurrences,
          isConfirmed: true,
          isAutomated: response === "automate",
        };
        
        await db.insert(learnedPatterns).values(learnedPattern);
        
        // If automated, create a smart scene
        if (response === "automate" && pattern.actions.length > 0) {
          await db.insert(smartScenes).values({
            userId,
            name: pattern.name,
            description: `Auto-créé depuis pattern détecté`,
            actions: pattern.actions.map(a => ({
              deviceId: a.id,
              action: a.action,
              params: a.params || {},
            })),
            trigger: "schedule",
            triggerConfig: pattern.conditions,
            isActive: true,
          });
          
          console.log(`[BehaviorService] Auto-created scene: "${pattern.name}"`);
        }
      }
    }
    
    // If rejected, save to prevent future suggestions
    if (response === "reject") {
      const patterns = suggestion.basedOnPatterns as PatternCandidate[];
      const pattern = patterns[0];
      
      if (pattern) {
        await db.insert(learnedPatterns).values({
          userId,
          patternType: pattern.type,
          name: pattern.name,
          conditions: pattern.conditions,
          actions: pattern.actions,
          confidence: 0,
          occurrences: pattern.occurrences,
          isConfirmed: false,
          isAutomated: false,
        });
      }
    }
    
    console.log(`[BehaviorService] Suggestion ${suggestionId} ${response}ed`);
    return true;
  }
  
  // ============================================================================
  // LEARNED PATTERNS
  // ============================================================================
  
  async getLearnedPatterns(userId: number): Promise<LearnedPattern[]> {
    return db.select()
      .from(learnedPatterns)
      .where(and(
        eq(learnedPatterns.userId, userId),
        eq(learnedPatterns.isConfirmed, true)
      ))
      .orderBy(desc(learnedPatterns.confidence));
  }
  
  async getAutomatedPatterns(userId: number): Promise<LearnedPattern[]> {
    return db.select()
      .from(learnedPatterns)
      .where(and(
        eq(learnedPatterns.userId, userId),
        eq(learnedPatterns.isAutomated, true)
      ));
  }
  
  async updatePatternAutomation(
    userId: number, 
    patternId: number, 
    automate: boolean
  ): Promise<boolean> {
    const result = await db.update(learnedPatterns)
      .set({ isAutomated: automate, updatedAt: new Date() })
      .where(and(
        eq(learnedPatterns.id, patternId),
        eq(learnedPatterns.userId, userId)
      ))
      .returning();
    
    return result.length > 0;
  }
  
  // ============================================================================
  // STATS
  // ============================================================================
  
  async getStats(userId: number): Promise<{
    totalEvents: number;
    patternsDetected: number;
    pendingSuggestions: number;
    automatedPatterns: number;
  }> {
    const [events] = await db.select({ count: sql<number>`count(*)` })
      .from(userBehaviorEvents)
      .where(eq(userBehaviorEvents.userId, userId));
    
    const [patterns] = await db.select({ count: sql<number>`count(*)` })
      .from(learnedPatterns)
      .where(and(eq(learnedPatterns.userId, userId), eq(learnedPatterns.isConfirmed, true)));
    
    const [suggestions] = await db.select({ count: sql<number>`count(*)` })
      .from(proactiveSuggestions)
      .where(and(eq(proactiveSuggestions.userId, userId), eq(proactiveSuggestions.status, "pending")));
    
    const [automated] = await db.select({ count: sql<number>`count(*)` })
      .from(learnedPatterns)
      .where(and(eq(learnedPatterns.userId, userId), eq(learnedPatterns.isAutomated, true)));
    
    return {
      totalEvents: Number(events?.count) || 0,
      patternsDetected: Number(patterns?.count) || 0,
      pendingSuggestions: Number(suggestions?.count) || 0,
      automatedPatterns: Number(automated?.count) || 0,
    };
  }
}

export const behaviorService = new BehaviorService();
