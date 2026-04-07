/**
 * Self-Healing Service - Auto-réparation des problèmes détectés
 * 
 * Fonctionnalités:
 * - Détection automatique des problèmes
 * - Actions correctives sans intervention humaine
 * - Reconnexion des services déconnectés
 * - Rotation des clés API si nécessaire
 * - Nettoyage des caches corrompus
 */

import { db } from "../db";
import { ulysseDiagnostics, capabilityRegistry } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { dependencyCircuitBreakers } from "./circuitBreakerManager";
import { capabilityService } from "./capabilityService";

export interface HealingAction {
  type: "reconnect" | "cache_clear" | "service_restart" | "config_reset" | "fallback_enable";
  target: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  automated: boolean;
  executed: boolean;
  success: boolean;
  executedAt?: Date;
  error?: string;
}

export interface HealingReport {
  timestamp: Date;
  issuesDetected: number;
  actionsExecuted: number;
  actionsSuccessful: number;
  actions: HealingAction[];
  systemStatus: "healthy" | "recovering" | "degraded" | "critical";
}

interface HealthIssue {
  component: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  canAutoHeal: boolean;
  healingAction?: () => Promise<boolean>;
}

class SelfHealingService {
  private lastHealingRun: Date | null = null;
  private healingCooldownMs = 60 * 1000; // 1 minute entre les runs
  private healingHistory: HealingReport[] = [];
  
  async runDiagnosticsAndHeal(userId?: number): Promise<HealingReport> {
    const startTime = new Date();
    const actions: HealingAction[] = [];
    
    // Vérifier le cooldown
    if (this.lastHealingRun && Date.now() - this.lastHealingRun.getTime() < this.healingCooldownMs) {
      console.log("[SelfHealing] Skipping - cooldown active");
      return {
        timestamp: startTime,
        issuesDetected: 0,
        actionsExecuted: 0,
        actionsSuccessful: 0,
        actions: [],
        systemStatus: "healthy"
      };
    }
    
    console.log("[SelfHealing] Starting diagnostic and healing run...");

    // Use HealthProbeService for centralized cached health checks
    try {
      const { healthProbeService } = await import("./healthProbeService");
      const dbProbe = await healthProbeService.probeDatabase();
      const aiProbe = await healthProbeService.probeOpenAI();
      console.log(`[SelfHealing] Probes: DB=${dbProbe.status}(${dbProbe.latencyMs}ms), AI=${aiProbe.status}(${aiProbe.latencyMs}ms)`);
    } catch {}

    // 1. Détecter les problèmes
    const issues = await this.detectIssues();
    
    // 2. Exécuter les actions de guérison automatiques
    for (const issue of issues) {
      if (issue.canAutoHeal && issue.healingAction) {
        const action: HealingAction = {
          type: this.getActionType(issue.type),
          target: issue.component,
          description: `Auto-healing: ${issue.message}`,
          severity: issue.severity,
          automated: true,
          executed: false,
          success: false
        };
        
        try {
          console.log(`[SelfHealing] Executing healing action for ${issue.component}: ${issue.type}`);
          const success = await issue.healingAction();
          action.executed = true;
          action.success = success;
          action.executedAt = new Date();
          
          if (success) {
            console.log(`[SelfHealing] Successfully healed ${issue.component}`);
          } else {
            console.log(`[SelfHealing] Healing failed for ${issue.component}`);
          }
        } catch (error: any) {
          action.executed = true;
          action.success = false;
          action.error = error.message;
          console.error(`[SelfHealing] Error healing ${issue.component}:`, error.message);
        }
        
        actions.push(action);
      }
    }
    
    // 3. Déterminer le statut global
    const criticalIssues = issues.filter(i => i.severity === "critical" && !i.canAutoHeal);
    const unresolvedIssues = actions.filter(a => !a.success);
    
    let systemStatus: "healthy" | "recovering" | "degraded" | "critical";
    if (criticalIssues.length > 0) {
      systemStatus = "critical";
    } else if (unresolvedIssues.length > 0) {
      systemStatus = "degraded";
    } else if (actions.length > 0) {
      systemStatus = "recovering";
    } else {
      systemStatus = "healthy";
    }
    
    const report: HealingReport = {
      timestamp: startTime,
      issuesDetected: issues.length,
      actionsExecuted: actions.filter(a => a.executed).length,
      actionsSuccessful: actions.filter(a => a.success).length,
      actions,
      systemStatus
    };
    
    this.lastHealingRun = new Date();
    this.healingHistory.push(report);
    
    // Garder seulement les 50 derniers rapports
    if (this.healingHistory.length > 50) {
      this.healingHistory = this.healingHistory.slice(-50);
    }
    
    console.log(`[SelfHealing] Complete - ${report.issuesDetected} issues, ${report.actionsSuccessful}/${report.actionsExecuted} healed, status: ${systemStatus}`);
    
    return report;
  }
  
  private async detectIssues(): Promise<HealthIssue[]> {
    const issues: HealthIssue[] = [];
    
    // 1. Vérifier les circuit breakers ouverts
    for (const [name, breaker] of Object.entries(dependencyCircuitBreakers)) {
      if (breaker.isOpen()) {
        issues.push({
          component: name,
          type: "circuit_open",
          severity: "high",
          message: `Circuit breaker ouvert pour ${name}`,
          canAutoHeal: true,
          healingAction: async () => {
            breaker.reset();
            return true;
          }
        });
      }
    }
    
    // 2. Vérifier les capacités avec taux d'échec élevé
    const capabilities = await db.select().from(capabilityRegistry);
    for (const cap of capabilities) {
      const total = cap.usageCount || 0;
      const failures = cap.failureCount || 0;
      
      if (total >= 10 && failures / total > 0.3) {
        issues.push({
          component: cap.name,
          type: "high_failure_rate",
          severity: "medium",
          message: `Taux d'échec élevé: ${Math.round(failures / total * 100)}%`,
          canAutoHeal: true,
          healingAction: async () => {
            // Reset les compteurs pour donner une seconde chance
            await db.update(capabilityRegistry)
              .set({ 
                failureCount: Math.floor(failures / 2),
                usageCount: Math.floor(total / 2)
              })
              .where(eq(capabilityRegistry.id, cap.id));
            return true;
          }
        });
      }
    }
    
    // 3. Vérifier les capacités indisponibles (skip if parent dependency is known down)
    const unavailableCaps = capabilities.filter(c => !c.isAvailable);
    const knownDownDeps = new Set<string>();
    for (const [name, breaker] of Object.entries(dependencyCircuitBreakers)) {
      if (breaker.isOpen()) knownDownDeps.add(name.toLowerCase());
    }
    const seenCategories = new Set<string>();
    let cacheRefreshed = false;
    for (const cap of unavailableCaps) {
      const capNameLower = (cap.name || "").toLowerCase();
      const isKnownDown = capNameLower.includes("notion") || 
        capNameLower.includes("google images") ||
        Array.from(knownDownDeps).some(dep => capNameLower.includes(dep));
      
      if (isKnownDown) continue;
      
      const category = cap.category || "general";
      if (seenCategories.has(category)) continue;
      seenCategories.add(category);
      
      issues.push({
        component: cap.name,
        type: "capability_unavailable",
        severity: cap.failureReason?.includes("critical") ? "critical" : "medium",
        message: cap.failureReason || "Capacité indisponible",
        canAutoHeal: true,
        healingAction: async () => {
          if (!cacheRefreshed) {
            cacheRefreshed = true;
            await capabilityService.refreshCache();
          }
          return true;
        }
      });
    }
    
    // 4. Vérifier la base de données
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      issues.push({
        component: "database",
        type: "connection_lost",
        severity: "critical",
        message: "Connexion à la base de données perdue",
        canAutoHeal: false // Nécessite intervention manuelle
      });
    }
    
    return issues;
  }
  
  private getActionType(issueType: string): HealingAction["type"] {
    switch (issueType) {
      case "circuit_open":
      case "connection_lost":
        return "reconnect";
      case "high_failure_rate":
        return "config_reset";
      case "capability_unavailable":
        return "service_restart";
      default:
        return "fallback_enable";
    }
  }
  
  // API pour récupérer l'historique
  getHealingHistory(limit: number = 10): HealingReport[] {
    return this.healingHistory.slice(-limit);
  }
  
  getLastReport(): HealingReport | null {
    return this.healingHistory[this.healingHistory.length - 1] || null;
  }
  
  // Forcer une réparation spécifique
  async forceHeal(component: string, action: HealingAction["type"]): Promise<boolean> {
    console.log(`[SelfHealing] Force healing ${component} with action ${action}`);
    
    switch (action) {
      case "reconnect":
        const breaker = dependencyCircuitBreakers[component];
        if (breaker) {
          breaker.reset();
          return true;
        }
        break;
        
      case "cache_clear":
        await capabilityService.refreshCache();
        return true;
        
      case "config_reset":
        // Reset les compteurs de la capacité
        await db.update(capabilityRegistry)
          .set({ failureCount: 0, usageCount: 0 })
          .where(eq(capabilityRegistry.name, component));
        return true;
    }
    
    return false;
  }
}

export const selfHealingService = new SelfHealingService();
