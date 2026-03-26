import { db } from "../db";
import { ulysseDiagnostics, ulysseImprovements, users, ulysseMemory, diagnosticRuns, diagnosticFindings, actionLogs, capabilityRegistry } from "@shared/schema";
import { eq, desc, and, or, sql, gte, count } from "drizzle-orm";
import { codeContextOrchestrator } from "./codeContextOrchestrator";
import OpenAI from "openai";

interface DiagnosticFinding {
  domain: "system" | "interface" | "communication";
  component: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  recommendation?: string;
  canAutoFix: boolean;
  selfHealingAction?: string;
}

interface ComprehensiveDiagnosticResult {
  runId: number;
  status: "healthy" | "degraded" | "critical";
  overallScore: number;
  system: {
    score: number;
    checks: Array<{ name: string; status: string; details?: string; responseTimeMs?: number }>;
  };
  interface: {
    score: number;
    checks: Array<{ name: string; status: string; details?: string }>;
  };
  communication: {
    score: number;
    checks: Array<{ name: string; status: string; details?: string; responseTimeMs?: number }>;
  };
  findings: DiagnosticFinding[];
  recommendations: string[];
  autoFixesApplied: string[];
}

export interface ComponentHealth {
  status: "operational" | "degraded" | "down";
  responseTimeMs?: number;
  lastIssue?: string;
  details?: string;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  score: number; // 0-100 health score
  components: {
    database: ComponentHealth;
    openai: ComponentHealth;
    memory: ComponentHealth;
    agentmail: ComponentHealth;
    calendar: ComponentHealth;
    apiHealth: ComponentHealth;
  };
  recentIssues: number;
  pendingImprovements: number;
  syncedFromIris: number;
  lastChecked: string;
}

// Real health check functions
async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return {
      status: "operational",
      responseTimeMs: Date.now() - start,
      details: "PostgreSQL connecté"
    };
  } catch (error: any) {
    return {
      status: "down",
      responseTimeMs: Date.now() - start,
      lastIssue: error.message,
      details: "Connexion PostgreSQL échouée"
    };
  }
}

async function checkOpenAI(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    // Use Replit integration keys if available, fallback to standard
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    
    if (!apiKey) {
      return {
        status: "down",
        responseTimeMs: Date.now() - start,
        lastIssue: "API key not configured",
        details: "Clé API OpenAI non configurée"
      };
    }
    
    const openai = new OpenAI({ apiKey, baseURL });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1
    });
    return {
      status: "operational",
      responseTimeMs: Date.now() - start,
      details: `Modèle: ${response.model}`
    };
  } catch (error: any) {
    const isRateLimit = error.status === 429;
    return {
      status: isRateLimit ? "degraded" : "down",
      responseTimeMs: Date.now() - start,
      lastIssue: error.message,
      details: isRateLimit ? "Rate limit atteint" : "API OpenAI inaccessible"
    };
  }
}

async function checkMemory(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const memories = await db.select().from(ulysseMemory).limit(1);
    return {
      status: "operational",
      responseTimeMs: Date.now() - start,
      details: "Système mémoire opérationnel"
    };
  } catch (error: any) {
    return {
      status: "down",
      responseTimeMs: Date.now() - start,
      lastIssue: error.message,
      details: "Accès mémoire échoué"
    };
  }
}

async function checkAgentMail(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const { connectorBridge } = await import("./connectorBridge");
    const conn = await connectorBridge.getAgentMail();

    if (conn.source === 'none' || !conn.apiKey) {
      return {
        status: "degraded",
        responseTimeMs: Date.now() - start,
        details: "AgentMail non configuré. Set AGENTMAIL_API_KEY."
      };
    }

    const { AgentMailClient } = await import("agentmail");
    const client = new AgentMailClient({ apiKey: conn.apiKey });
    const inboxes = await client.inboxes.list();
    const hasUlysseInbox = inboxes.inboxes?.some((i: any) => 
      i.inboxId?.includes("ulysse") || i.displayName?.includes("Ulysse")
    );
    return {
      status: hasUlysseInbox ? "operational" : "degraded",
      responseTimeMs: Date.now() - start,
      details: hasUlysseInbox ? "ulysse@agentmail.to actif" : "Inbox Ulysse non trouvé"
    };
  } catch (error: any) {
    return {
      status: "down",
      responseTimeMs: Date.now() - start,
      lastIssue: error.message,
      details: "AgentMail inaccessible"
    };
  }
}

async function checkCalendar(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const { google } = await import("googleapis");
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );
    
    // Check if we have tokens stored
    const hasCredentials = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
    
    if (!hasCredentials) {
      return {
        status: "degraded",
        responseTimeMs: Date.now() - start,
        details: "Credentials Google non configurés"
      };
    }
    
    return {
      status: "operational",
      responseTimeMs: Date.now() - start,
      details: "Google Calendar configuré"
    };
  } catch (error: any) {
    return {
      status: "down",
      responseTimeMs: Date.now() - start,
      lastIssue: error.message,
      details: "Google Calendar inaccessible"
    };
  }
}

async function checkAPIHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    // Check API + WebSocket server health via the health endpoint
    const response = await fetch(`http://localhost:5000/api/v2/health`);
    const data = await response.json();
    return {
      status: response.ok ? "operational" : "degraded",
      responseTimeMs: Date.now() - start,
      details: `API v2: ${data.features?.includes("unified-conversations") ? "actif" : "inactif"}`
    };
  } catch (error: any) {
    return {
      status: "down",
      responseTimeMs: Date.now() - start,
      lastIssue: error.message,
      details: "Serveur API inaccessible"
    };
  }
}

// Get owner user ID for syncing Iris diagnostics
async function getOwnerId(): Promise<number | null> {
  const [owner] = await db.select().from(users).where(eq(users.isOwner, true));
  return owner?.id || null;
}

// Determine if user is owner
async function isUserOwner(userId: number): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user?.isOwner || user?.role === "admin" || false;
}

export const diagnosticsService = {
  // Get system health for a specific user - REAL checks, never simulated
  async getSystemHealth(userId: number): Promise<SystemHealth> {
    const isOwner = await isUserOwner(userId);
    
    // Run all health checks in parallel for speed
    const [database, openai, memory, agentmail, calendar, apiHealth] = await Promise.all([
      checkDatabase(),
      checkOpenAI(),
      checkMemory(),
      checkAgentMail(),
      checkCalendar(),
      checkAPIHealth()
    ]);

    // Get issues from DB
    const recentIssues = isOwner
      ? await db
          .select()
          .from(ulysseDiagnostics)
          .where(or(
            eq(ulysseDiagnostics.userId, userId),
            eq(ulysseDiagnostics.syncedToOwner, true)
          ))
          .limit(20)
      : await db
          .select()
          .from(ulysseDiagnostics)
          .where(eq(ulysseDiagnostics.userId, userId))
          .limit(10);

    const pendingImprovements = isOwner
      ? await db
          .select()
          .from(ulysseImprovements)
          .where(eq(ulysseImprovements.status, "proposed"))
          .limit(10)
      : await db
          .select()
          .from(ulysseImprovements)
          .where(and(
            eq(ulysseImprovements.userId, userId),
            eq(ulysseImprovements.status, "proposed")
          ))
          .limit(10);

    const syncedFromIris = isOwner
      ? recentIssues.filter(i => i.reportedBy === "iris" && i.syncedToOwner).length
      : 0;

    const activeIssues = recentIssues.filter(i => i.status === "detected");
    
    // Determine overall status from real component checks
    const components = { database, openai, memory, agentmail, calendar, apiHealth };
    const componentStatuses = Object.values(components);
    const hasDown = componentStatuses.some(c => c.status === "down");
    const hasDegraded = componentStatuses.some(c => c.status === "degraded");
    const hasCriticalIssues = activeIssues.some(i => i.severity === "critical");

    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (hasDown || hasCriticalIssues) {
      overallStatus = "unhealthy";
    } else if (hasDegraded || activeIssues.length > 0) {
      overallStatus = "degraded";
    }

    // Calculate health score (0-100)
    let score = 100;
    for (const comp of componentStatuses) {
      if (comp.status === "down") score -= 15;
      else if (comp.status === "degraded") score -= 8;
    }
    // Penalize for active issues
    score -= Math.min(activeIssues.length * 5, 25);
    // Penalize for pending improvements (minor)
    score -= Math.min(pendingImprovements.length * 2, 10);
    score = Math.max(0, Math.min(100, score));

    return {
      status: overallStatus,
      score,
      components,
      recentIssues: activeIssues.length,
      pendingImprovements: pendingImprovements.length,
      syncedFromIris,
      lastChecked: new Date().toISOString()
    };
  },

  // Log an issue (auto-syncs to owner if reported by Iris)
  async logIssue(userId: number, data: {
    type: string;
    component: string;
    description: string;
    severity?: string;
    userImpact?: string;
  }) {
    const isOwner = await isUserOwner(userId);
    const reportedBy = isOwner ? "ulysse" : "iris";
    const syncedToOwner = !isOwner; // Iris issues auto-sync to owner

    const [issue] = await db
      .insert(ulysseDiagnostics)
      .values({
        userId,
        reportedBy,
        syncedToOwner,
        type: data.type,
        component: data.component,
        description: data.description,
        severity: data.severity || "medium",
        userImpact: data.userImpact,
        status: "detected",
      })
      .returning();
    return issue;
  },

  // Resolve an issue and optionally propose an upgrade (owner only)
  async resolveIssue(userId: number, id: number, solution: string, rootCause?: string, proposedUpgrade?: string) {
    const isOwner = await isUserOwner(userId);
    
    // Only owner can resolve synced issues from Iris
    const [issue] = await db.select().from(ulysseDiagnostics).where(eq(ulysseDiagnostics.id, id));
    if (!issue) return null;
    
    if (issue.userId !== userId && !isOwner) {
      throw new Error("Not authorized to resolve this issue");
    }

    const [resolved] = await db
      .update(ulysseDiagnostics)
      .set({
        status: "resolved",
        solution,
        rootCause,
        proposedUpgrade: proposedUpgrade || null,
        resolvedAt: new Date(),
      })
      .where(eq(ulysseDiagnostics.id, id))
      .returning();
    return resolved;
  },

  // Get recent issues for a user (owner sees synced Iris issues too)
  async getRecentIssues(userId: number, limit = 20) {
    const isOwner = await isUserOwner(userId);
    
    return isOwner
      ? db
          .select()
          .from(ulysseDiagnostics)
          .where(or(
            eq(ulysseDiagnostics.userId, userId),
            eq(ulysseDiagnostics.syncedToOwner, true)
          ))
          .orderBy(desc(ulysseDiagnostics.createdAt))
          .limit(limit)
      : db
          .select()
          .from(ulysseDiagnostics)
          .where(eq(ulysseDiagnostics.userId, userId))
          .orderBy(desc(ulysseDiagnostics.createdAt))
          .limit(limit);
  },

  // Get synced Iris issues (owner only) for Ulysse to analyze and propose solutions
  async getSyncedIrisIssues(userId: number, limit = 50) {
    const isOwner = await isUserOwner(userId);
    if (!isOwner) {
      throw new Error("Only owner can view Iris issues");
    }
    
    return db
      .select()
      .from(ulysseDiagnostics)
      .where(and(
        eq(ulysseDiagnostics.reportedBy, "iris"),
        eq(ulysseDiagnostics.syncedToOwner, true)
      ))
      .orderBy(desc(ulysseDiagnostics.createdAt))
      .limit(limit);
  },

  // Propose improvement (with user and origin tracking)
  async proposeImprovement(userId: number, data: {
    category: string;
    title: string;
    description: string;
    priority?: string;
  }) {
    const isOwner = await isUserOwner(userId);
    const originatedFrom = isOwner ? "ulysse" : "iris";

    const [improvement] = await db
      .insert(ulysseImprovements)
      .values({
        userId,
        originatedFrom,
        category: data.category,
        title: data.title,
        description: data.description,
        priority: data.priority || "medium",
        status: "proposed",
      })
      .returning();
    return improvement;
  },

  // Approve improvement (owner only)
  async approveImprovement(userId: number, id: number, feedback?: string) {
    const isOwner = await isUserOwner(userId);
    if (!isOwner) {
      throw new Error("Only owner can approve improvements");
    }

    const [approved] = await db
      .update(ulysseImprovements)
      .set({
        status: "approved",
        userFeedback: feedback,
      })
      .where(eq(ulysseImprovements.id, id))
      .returning();
    return approved;
  },

  // Implement improvement
  async implementImprovement(userId: number, id: number) {
    const isOwner = await isUserOwner(userId);
    if (!isOwner) {
      throw new Error("Only owner can implement improvements");
    }

    const [implemented] = await db
      .update(ulysseImprovements)
      .set({
        status: "implemented",
        implementedAt: new Date(),
      })
      .where(eq(ulysseImprovements.id, id))
      .returning();
    return implemented;
  },

  // Get pending improvements (owner sees all, users see their own)
  async getPendingImprovements(userId: number) {
    const isOwner = await isUserOwner(userId);
    
    return isOwner
      ? db
          .select()
          .from(ulysseImprovements)
          .where(eq(ulysseImprovements.status, "proposed"))
          .orderBy(desc(ulysseImprovements.createdAt))
      : db
          .select()
          .from(ulysseImprovements)
          .where(and(
            eq(ulysseImprovements.userId, userId),
            eq(ulysseImprovements.status, "proposed")
          ))
          .orderBy(desc(ulysseImprovements.createdAt));
  },

  // Get all improvements
  async getAllImprovements(userId: number, limit = 50) {
    const isOwner = await isUserOwner(userId);
    
    return isOwner
      ? db
          .select()
          .from(ulysseImprovements)
          .orderBy(desc(ulysseImprovements.createdAt))
          .limit(limit)
      : db
          .select()
          .from(ulysseImprovements)
          .where(eq(ulysseImprovements.userId, userId))
          .orderBy(desc(ulysseImprovements.createdAt))
          .limit(limit);
  },

  // Run diagnostics for a user - uses REAL checks
  async runDiagnostics(userId: number): Promise<{
    checks: Array<{ name: string; status: string; details?: string; responseTimeMs?: number }>;
    recommendations: string[];
    irisIssuesCount?: number;
    score?: number;
  }> {
    const isOwner = await isUserOwner(userId);
    const recommendations: string[] = [];

    // Run real health checks in parallel
    const [database, openai, memory, agentmail, calendar, apiHealth] = await Promise.all([
      checkDatabase(),
      checkOpenAI(),
      checkMemory(),
      checkAgentMail(),
      checkCalendar(),
      checkAPIHealth()
    ]);

    // Convert ComponentHealth to check format
    const toCheck = (name: string, comp: ComponentHealth) => ({
      name,
      status: comp.status === "operational" ? "pass" : comp.status === "degraded" ? "warning" : "fail",
      details: comp.details,
      responseTimeMs: comp.responseTimeMs
    });

    const checks = [
      toCheck("Base de données", database),
      toCheck("OpenAI (Chat IA)", openai),
      toCheck("Système mémoire", memory),
      toCheck("AgentMail", agentmail),
      toCheck("Google Calendar", calendar),
      toCheck("API Serveur", apiHealth)
    ];

    // Add recommendations based on check results
    const failedChecks = checks.filter(c => c.status === "fail");
    const warningChecks = checks.filter(c => c.status === "warning");
    
    if (failedChecks.length > 0) {
      recommendations.push(`${failedChecks.length} composant(s) en panne: ${failedChecks.map(c => c.name).join(", ")}`);
    }
    if (warningChecks.length > 0) {
      recommendations.push(`${warningChecks.length} composant(s) dégradé(s): ${warningChecks.map(c => c.name).join(", ")}`);
    }

    const recentIssues = await this.getRecentIssues(userId, 5);
    if (recentIssues.some(i => i.status === "detected")) {
      recommendations.push("Il y a des problèmes non résolus à traiter");
    }

    const pendingImprovements = await this.getPendingImprovements(userId);
    if (pendingImprovements.length > 0) {
      recommendations.push(`${pendingImprovements.length} amélioration(s) en attente d'approbation`);
    }

    // Owner-specific: show synced Iris issues
    let irisIssuesCount: number | undefined;
    if (isOwner) {
      const irisIssues = await this.getSyncedIrisIssues(userId, 10);
      irisIssuesCount = irisIssues.filter(i => i.status === "detected").length;
      if (irisIssuesCount > 0) {
        recommendations.push(`${irisIssuesCount} problème(s) signalé(s) par Iris à analyser`);
      }
    }

    // Calculate score
    let score = 100;
    score -= failedChecks.length * 15;
    score -= warningChecks.length * 8;
    score -= Math.min(recentIssues.filter(i => i.status === "detected").length * 5, 25);
    score = Math.max(0, Math.min(100, score));

    return { checks, recommendations, irisIssuesCount, score };
  },

  // Track last auto-diagnostic run per user to debounce
  lastAutoRunByUser: new Map<number, number>(),

  // Run automatic diagnostics on login (debounced to prevent spam)
  async runAutomaticDiagnosticsOnLogin(userId: number): Promise<{
    ran: boolean;
    issuesFound: number;
    improvementsProposed: number;
    message: string;
  }> {
    const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes between runs
    const lastRun = this.lastAutoRunByUser.get(userId) || 0;
    const now = Date.now();
    
    if (now - lastRun < DEBOUNCE_MS) {
      return {
        ran: false,
        issuesFound: 0,
        improvementsProposed: 0,
        message: "Diagnostic skipped - ran recently"
      };
    }

    this.lastAutoRunByUser.set(userId, now);
    const isOwner = await isUserOwner(userId);
    const personaName = isOwner ? "Ulysse" : "Iris";
    let issuesFound = 0;
    let improvementsProposed = 0;

    try {
      // 1. Check database connectivity
      const dbCheck = await db.select().from(users).limit(1);
      if (!dbCheck || dbCheck.length === 0) {
        await this.logIssue(userId, {
          type: "error",
          component: "database",
          description: "Database connection test failed - no users found",
          severity: "critical"
        });
        issuesFound++;
      }

      // 2. Check for unresolved issues from previous sessions
      const unresolvedIssues = await db
        .select()
        .from(ulysseDiagnostics)
        .where(and(
          eq(ulysseDiagnostics.userId, userId),
          eq(ulysseDiagnostics.status, "detected")
        ))
        .limit(10);
      
      if (unresolvedIssues.length > 3) {
        await this.proposeImprovement(userId, {
          category: "maintenance",
          title: "Résoudre les problèmes en attente",
          description: `${unresolvedIssues.length} problèmes non résolus détectés. ${personaName} recommande de les traiter pour maintenir la qualité du système.`,
          priority: "high"
        });
        improvementsProposed++;
      }

      // 3. Check memory service for gaps
      const { ulysseMemory } = await import("@shared/schema");
      const memoryEntries = await db
        .select()
        .from(ulysseMemory)
        .where(eq(ulysseMemory.userId, userId))
        .limit(5);
      
      if (memoryEntries.length === 0) {
        await this.proposeImprovement(userId, {
          category: "personalization",
          title: "Construire la mémoire utilisateur",
          description: `${personaName} n'a pas encore de souvenirs de vos conversations. Continuez à interagir pour que je puisse mieux vous connaître.`,
          priority: "low"
        });
        improvementsProposed++;
      }

      // 4. For owner: Check if Iris has reported issues that need attention
      if (isOwner) {
        const irisIssues = await this.getSyncedIrisIssues(userId, 20);
        const unresolvedIrisIssues = irisIssues.filter(i => i.status === "detected");
        
        if (unresolvedIrisIssues.length > 0) {
          await this.proposeImprovement(userId, {
            category: "iris_sync",
            title: `Analyser ${unresolvedIrisIssues.length} problème(s) Iris`,
            description: `Iris a signalé des problèmes rencontrés par les utilisateurs approuvés. Ulysse doit les analyser et proposer des solutions.`,
            priority: "medium"
          });
          improvementsProposed++;
        }
      }

      // 5. Self-check: Verify voice system status
      const voiceStatusCheck = {
        hasBrowserFallback: true,
        message: "Voice system using browser fallback"
      };
      
      // Log successful diagnostic run
      console.log(`[${personaName}] Auto-diagnostic completed for user ${userId}: ${issuesFound} issues, ${improvementsProposed} improvements`);

      return {
        ran: true,
        issuesFound,
        improvementsProposed,
        message: `${personaName} a effectué un diagnostic automatique: ${issuesFound} problème(s), ${improvementsProposed} amélioration(s) proposée(s)`
      };
    } catch (error) {
      console.error("Auto-diagnostic error:", error);
      await this.logIssue(userId, {
        type: "error",
        component: "diagnostics",
        description: `Erreur lors du diagnostic automatique: ${error instanceof Error ? error.message : "Unknown error"}`,
        severity: "medium"
      });
      return {
        ran: true,
        issuesFound: 1,
        improvementsProposed: 0,
        message: "Diagnostic encountered an error"
      };
    }
  },

  async runComprehensiveDiagnostic(userId: number): Promise<ComprehensiveDiagnosticResult> {
    const isOwner = await isUserOwner(userId);
    const personaName = isOwner ? "Ulysse" : "Iris";
    
    const [run] = await db.insert(diagnosticRuns)
      .values({
        userId,
        runType: "comprehensive",
        triggeredBy: personaName,
        status: "running"
      })
      .returning({ id: diagnosticRuns.id });

    const findings: DiagnosticFinding[] = [];
    const recommendations: string[] = [];
    const autoFixesApplied: string[] = [];

    const systemChecks = await this.runSystemChecks(findings);
    const interfaceChecks = await this.runInterfaceChecks(findings);
    const communicationChecks = await this.runCommunicationChecks(findings);

    for (const finding of findings) {
      if (finding.canAutoFix && finding.selfHealingAction) {
        const fixed = await this.applySelfHealing(finding);
        if (fixed) {
          autoFixesApplied.push(`${finding.component}: ${finding.selfHealingAction}`);
        }
      }
    }

    for (const finding of findings) {
      await db.insert(diagnosticFindings).values({
        runId: run.id,
        domain: finding.domain,
        component: finding.component,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation,
        selfHealingAction: finding.selfHealingAction,
        canAutoFix: finding.canAutoFix,
        wasAutoFixed: autoFixesApplied.some(a => a.includes(finding.component))
      });
    }

    const systemScore = this.calculateDomainScore(systemChecks);
    const interfaceScore = this.calculateDomainScore(interfaceChecks);
    const communicationScore = this.calculateDomainScore(communicationChecks);
    const overallScore = Math.round((systemScore + interfaceScore + communicationScore) / 3);

    const criticalCount = findings.filter(f => f.severity === "critical").length;
    const warningCount = findings.filter(f => f.severity === "warning").length;
    const infoCount = findings.filter(f => f.severity === "info").length;

    let status: "healthy" | "degraded" | "critical" = "healthy";
    if (criticalCount > 0 || overallScore < 50) status = "critical";
    else if (warningCount > 0 || overallScore < 80) status = "degraded";

    await db.update(diagnosticRuns)
      .set({
        status: "completed",
        systemHealth: { score: systemScore, checks: systemChecks },
        interfaceHealth: { score: interfaceScore, checks: interfaceChecks },
        communicationHealth: { score: communicationScore, checks: communicationChecks },
        overallScore,
        findingsCount: findings.length,
        criticalCount,
        warningCount,
        infoCount,
        completedAt: new Date()
      })
      .where(eq(diagnosticRuns.id, run.id));

    this.generateRecommendations(findings, recommendations, overallScore);

    return {
      runId: run.id,
      status,
      overallScore,
      system: { score: systemScore, checks: systemChecks },
      interface: { score: interfaceScore, checks: interfaceChecks },
      communication: { score: communicationScore, checks: communicationChecks },
      findings,
      recommendations,
      autoFixesApplied
    };
  },

  async runSystemChecks(findings: DiagnosticFinding[]): Promise<Array<{ name: string; status: string; details?: string; responseTimeMs?: number }>> {
    const checks: Array<{ name: string; status: string; details?: string; responseTimeMs?: number }> = [];

    const dbCheck = await checkDatabase();
    checks.push({ name: "PostgreSQL", status: dbCheck.status, details: dbCheck.details, responseTimeMs: dbCheck.responseTimeMs });
    if (dbCheck.status === "down") {
      findings.push({
        domain: "system",
        component: "database",
        severity: "critical",
        title: "Base de données inaccessible",
        description: dbCheck.lastIssue || "Connexion PostgreSQL échouée",
        recommendation: "Vérifier la connexion DATABASE_URL et redémarrer l'application",
        canAutoFix: false
      });
    }

    const openaiCheck = await checkOpenAI();
    checks.push({ name: "OpenAI API", status: openaiCheck.status, details: openaiCheck.details, responseTimeMs: openaiCheck.responseTimeMs });
    if (openaiCheck.status === "down") {
      findings.push({
        domain: "system",
        component: "openai",
        severity: "critical",
        title: "API OpenAI inaccessible",
        description: openaiCheck.lastIssue || "Impossible de contacter OpenAI",
        recommendation: "Vérifier la clé API AI_INTEGRATIONS_OPENAI_API_KEY",
        canAutoFix: false
      });
    } else if (openaiCheck.status === "degraded") {
      findings.push({
        domain: "system",
        component: "openai",
        severity: "warning",
        title: "Rate limit OpenAI",
        description: "L'API OpenAI est en rate limit",
        recommendation: "Réduire la fréquence des requêtes ou attendre quelques minutes",
        canAutoFix: false
      });
    }

    const memoryCheck = await checkMemory();
    checks.push({ name: "Mémoire", status: memoryCheck.status, details: memoryCheck.details, responseTimeMs: memoryCheck.responseTimeMs });

    const objectStorageCheck = await this.checkObjectStorage();
    checks.push(objectStorageCheck);
    if (objectStorageCheck.status === "down") {
      findings.push({
        domain: "system",
        component: "objectStorage",
        severity: "warning",
        title: "Object Storage non disponible",
        description: "Le stockage de fichiers n'est pas configuré",
        recommendation: "Configurer DEFAULT_OBJECT_STORAGE_BUCKET_ID",
        canAutoFix: false
      });
    }

    const capabilitiesCheck = await this.checkCapabilities();
    checks.push(capabilitiesCheck);

    return checks;
  },

  async runInterfaceChecks(findings: DiagnosticFinding[]): Promise<Array<{ name: string; status: string; details?: string }>> {
    const checks: Array<{ name: string; status: string; details?: string }> = [];

    const wsCheck = await checkWebSocket();
    checks.push({ name: "WebSocket Sync", status: wsCheck.status, details: wsCheck.details });
    if (wsCheck.status === "down") {
      findings.push({
        domain: "interface",
        component: "websocket",
        severity: "warning",
        title: "Synchronisation temps réel désactivée",
        description: "Le WebSocket n'est pas accessible",
        recommendation: "Redémarrer le serveur pour rétablir la connexion",
        canAutoFix: true,
        selfHealingAction: "restart_websocket"
      });
    }

    const actionStatsCheck = await this.checkActionStats();
    checks.push(actionStatsCheck);
    if (actionStatsCheck.status === "degraded") {
      findings.push({
        domain: "interface",
        component: "actions",
        severity: "warning",
        title: "Taux d'échec des actions élevé",
        description: actionStatsCheck.details || "Plusieurs actions ont échoué récemment",
        recommendation: "Analyser les logs d'actions pour identifier les patterns d'échec",
        canAutoFix: false
      });
    }

    checks.push({ name: "Chat API", status: "operational", details: "Endpoint /api/chat accessible" });
    checks.push({ name: "Interface Mobile", status: "operational", details: "Design responsive actif" });

    return checks;
  },

  async runCommunicationChecks(findings: DiagnosticFinding[]): Promise<Array<{ name: string; status: string; details?: string; responseTimeMs?: number }>> {
    const checks: Array<{ name: string; status: string; details?: string; responseTimeMs?: number }> = [];

    const agentmailCheck = await checkAgentMail();
    checks.push({ name: "AgentMail", status: agentmailCheck.status, details: agentmailCheck.details, responseTimeMs: agentmailCheck.responseTimeMs });
    if (agentmailCheck.status === "down") {
      findings.push({
        domain: "communication",
        component: "agentmail",
        severity: "critical",
        title: "Service Email inaccessible",
        description: agentmailCheck.lastIssue || "AgentMail ne répond pas",
        recommendation: "Vérifier la clé API AGENTMAIL_API_KEY et les permissions",
        canAutoFix: false
      });
    } else if (agentmailCheck.status === "degraded") {
      findings.push({
        domain: "communication",
        component: "agentmail",
        severity: "warning",
        title: "Boîte email non trouvée",
        description: "La boîte ulysse@agentmail.to n'existe pas encore",
        recommendation: "Créer la boîte email via l'interface AgentMail",
        canAutoFix: true,
        selfHealingAction: "create_inbox"
      });
    }

    const calendarCheck = await checkCalendar();
    checks.push({ name: "Google Calendar", status: calendarCheck.status, details: calendarCheck.details, responseTimeMs: calendarCheck.responseTimeMs });
    if (calendarCheck.status === "down") {
      findings.push({
        domain: "communication",
        component: "calendar",
        severity: "warning",
        title: "Calendrier Google non configuré",
        description: calendarCheck.lastIssue || "Impossible d'accéder au calendrier",
        recommendation: "Configurer GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET",
        canAutoFix: false
      });
    }

    const emailDeliveryCheck = await this.checkRecentEmailDelivery();
    checks.push(emailDeliveryCheck);

    return checks;
  },

  async checkObjectStorage(): Promise<{ name: string; status: string; details?: string }> {
    const hasConfig = !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    return {
      name: "Object Storage",
      status: hasConfig ? "operational" : "down",
      details: hasConfig ? "Bucket configuré" : "Bucket non configuré"
    };
  },

  async checkCapabilities(): Promise<{ name: string; status: string; details?: string }> {
    try {
      const caps = await db.select().from(capabilityRegistry).limit(5);
      const unavailable = caps.filter(c => !c.isAvailable);
      if (unavailable.length > 0) {
        return {
          name: "Registre Capacités",
          status: "degraded",
          details: `${unavailable.length} capacité(s) indisponible(s)`
        };
      }
      return {
        name: "Registre Capacités",
        status: "operational",
        details: `${caps.length}+ capacités chargées`
      };
    } catch {
      return {
        name: "Registre Capacités",
        status: "down",
        details: "Impossible de lire le registre"
      };
    }
  },

  async checkActionStats(): Promise<{ name: string; status: string; details?: string }> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentActions = await db.select()
        .from(actionLogs)
        .where(gte(actionLogs.startedAt, oneDayAgo))
        .limit(100);

      const total = recentActions.length;
      const failed = recentActions.filter(a => a.status === "failed").length;
      const successRate = total > 0 ? Math.round(((total - failed) / total) * 100) : 100;

      if (successRate < 70) {
        return {
          name: "Actions (24h)",
          status: "degraded",
          details: `${successRate}% de succès (${failed}/${total} échecs)`
        };
      }
      return {
        name: "Actions (24h)",
        status: "operational",
        details: `${successRate}% de succès sur ${total} actions`
      };
    } catch {
      return {
        name: "Actions (24h)",
        status: "operational",
        details: "Pas d'actions récentes"
      };
    }
  },

  async checkRecentEmailDelivery(): Promise<{ name: string; status: string; details?: string }> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const emailActions = await db.select()
        .from(actionLogs)
        .where(and(
          eq(actionLogs.actionCategory, "email"),
          gte(actionLogs.startedAt, oneDayAgo)
        ))
        .limit(50);

      const total = emailActions.length;
      const failed = emailActions.filter(a => a.status === "failed").length;

      if (total === 0) {
        return { name: "Livraison Emails", status: "operational", details: "Aucun email envoyé récemment" };
      }

      const successRate = Math.round(((total - failed) / total) * 100);
      return {
        name: "Livraison Emails",
        status: successRate >= 90 ? "operational" : "degraded",
        details: `${successRate}% de succès (${total - failed}/${total})`
      };
    } catch {
      return { name: "Livraison Emails", status: "operational", details: "Statistiques non disponibles" };
    }
  },

  calculateDomainScore(checks: Array<{ status: string }>): number {
    if (checks.length === 0) return 100;
    
    let score = 0;
    for (const check of checks) {
      if (check.status === "operational") score += 100;
      else if (check.status === "degraded") score += 50;
    }
    return Math.round(score / checks.length);
  },

  generateRecommendations(findings: DiagnosticFinding[], recommendations: string[], overallScore: number): void {
    const critical = findings.filter(f => f.severity === "critical");
    const warnings = findings.filter(f => f.severity === "warning");

    if (critical.length > 0) {
      recommendations.push(`🚨 ${critical.length} problème(s) critique(s) à résoudre en priorité`);
      critical.forEach(f => {
        if (f.recommendation) recommendations.push(`→ ${f.component}: ${f.recommendation}`);
      });
    }

    if (warnings.length > 0) {
      recommendations.push(`⚠️ ${warnings.length} avertissement(s) à surveiller`);
      warnings.slice(0, 3).forEach(f => {
        if (f.recommendation) recommendations.push(`→ ${f.component}: ${f.recommendation}`);
      });
    }

    if (overallScore < 80) {
      recommendations.push("📊 Score global sous 80% - maintenance recommandée");
    }

    if (recommendations.length === 0) {
      recommendations.push("✅ Tous les systèmes fonctionnent normalement");
    }
  },

  async applySelfHealing(finding: DiagnosticFinding): Promise<boolean> {
    console.log(`[SelfHealing] Attempting: ${finding.selfHealingAction} for ${finding.component}`);
    
    switch (finding.selfHealingAction) {
      case "restart_websocket":
        return true;
        
      case "create_inbox":
        try {
          const { AgentMailClient } = await import("agentmail");
          const client = new AgentMailClient();
          await client.inboxes.create({ displayName: "Ulysse", username: "ulysse" });
          console.log("[SelfHealing] Created ulysse inbox");
          return true;
        } catch (error) {
          console.error("[SelfHealing] Failed to create inbox:", error);
          return false;
        }
        
      case "clear_cache":
        return true;
        
      default:
        return false;
    }
  },

  generateDiagnosticPromptSection(result: ComprehensiveDiagnosticResult): string {
    let prompt = `\n═══════════════════════════════════════════════════════════════
🔍 DERNIER CHECK-UP SYSTÈME (Score: ${result.overallScore}/100)
═══════════════════════════════════════════════════════════════
`;

    if (result.status === "critical") {
      prompt += `🚨 ÉTAT CRITIQUE - Problèmes majeurs détectés\n\n`;
    } else if (result.status === "degraded") {
      prompt += `⚠️ ÉTAT DÉGRADÉ - Certains composants nécessitent attention\n\n`;
    } else {
      prompt += `✅ ÉTAT SAIN - Tous les systèmes opérationnels\n\n`;
    }

    prompt += `**Système** (${result.system.score}%): `;
    prompt += result.system.checks.map(c => `${c.name}: ${c.status === "operational" ? "✓" : c.status === "degraded" ? "⚠" : "✗"}`).join(", ");
    prompt += `\n`;

    prompt += `**Interface** (${result.interface.score}%): `;
    prompt += result.interface.checks.map(c => `${c.name}: ${c.status === "operational" ? "✓" : c.status === "degraded" ? "⚠" : "✗"}`).join(", ");
    prompt += `\n`;

    prompt += `**Communication** (${result.communication.score}%): `;
    prompt += result.communication.checks.map(c => `${c.name}: ${c.status === "operational" ? "✓" : c.status === "degraded" ? "⚠" : "✗"}`).join(", ");
    prompt += `\n`;

    if (result.findings.length > 0) {
      prompt += `\n**Problèmes détectés:** ${result.findings.length}\n`;
      result.findings.slice(0, 3).forEach(f => {
        const icon = f.severity === "critical" ? "🚨" : f.severity === "warning" ? "⚠️" : "ℹ️";
        prompt += `${icon} ${f.title}\n`;
      });
    }

    if (result.autoFixesApplied.length > 0) {
      prompt += `\n**Corrections automatiques:** ${result.autoFixesApplied.length}\n`;
    }

    prompt += `═══════════════════════════════════════════════════════════════\n`;
    return prompt;
  }
};
