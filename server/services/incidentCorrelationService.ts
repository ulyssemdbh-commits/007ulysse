import { db } from "../db";
import { devopsFileHistory } from "@shared/schema";
import { sql, desc } from "drizzle-orm";
import { devopsIntelligenceEngine } from "./devopsIntelligenceEngine";

export interface IncidentDiagnosis {
  domain: string;
  endpoint?: string;
  recentChanges: Array<{
    filePath: string;
    eventType: string;
    eventResult: string;
    commitSha: string | null;
    description: string | null;
    changedAt: string;
    fragilityScore: number;
  }>;
  fragilityAlerts: Array<{
    file: string;
    score: number;
    trend: string;
    reason: string;
  }>;
  suspectedCause: string;
  confidence: number;
  recommendations: string[];
}

const ENDPOINT_DOMAIN_MAP: Record<string, string[]> = {
  "/api/sports": ["football_sports"],
  "/api/suguval": ["sugu_restaurant"],
  "/api/sugumaillane": ["sugu_restaurant"],
  "/api/auth": ["auth_security"],
  "/api/brain": ["brain_memory"],
  "/api/conversations": ["brain_memory", "ai_core"],
  "/api/devops": ["devops_github"],
  "/api/tasks": ["task_queue"],
  "/api/homework": ["ai_core"],
  "/api/hub": ["communication"],
  "/api/calendar": ["communication"],
  "/api/gmail": ["communication"],
  "/api/finance": ["finance_betting"],
};

function detectDomainFromEndpoint(endpoint: string): string[] {
  for (const [prefix, domains] of Object.entries(ENDPOINT_DOMAIN_MAP)) {
    if (endpoint.startsWith(prefix)) return domains;
  }
  if (endpoint.includes("sport") || endpoint.includes("foot") || endpoint.includes("match")) return ["football_sports"];
  if (endpoint.includes("sugu") || endpoint.includes("restaurant")) return ["sugu_restaurant"];
  if (endpoint.includes("auth") || endpoint.includes("login")) return ["auth_security"];
  return ["other"];
}

function detectDomainFromError(errorMessage: string): string[] {
  const domains: string[] = [];
  const msg = errorMessage.toLowerCase();
  if (msg.includes("database") || msg.includes("postgres") || msg.includes("drizzle")) domains.push("database");
  if (msg.includes("auth") || msg.includes("session") || msg.includes("token")) domains.push("auth_security");
  if (msg.includes("openai") || msg.includes("gemini") || msg.includes("ai")) domains.push("ai_core");
  if (msg.includes("github") || msg.includes("git")) domains.push("devops_github");
  if (msg.includes("socket") || msg.includes("connection")) domains.push("infrastructure");
  if (msg.includes("memory") || msg.includes("brain")) domains.push("brain_memory");
  return domains.length ? domains : ["other"];
}

export async function diagnoseIncident(opts: {
  endpoint?: string;
  errorCode?: number;
  errorMessage?: string;
  domain?: string;
  hoursBack?: number;
}): Promise<IncidentDiagnosis> {
  const hoursBack = opts.hoursBack || 24;
  let domains: string[] = [];

  if (opts.domain) domains = [opts.domain];
  else if (opts.endpoint) domains = detectDomainFromEndpoint(opts.endpoint);
  else if (opts.errorMessage) domains = detectDomainFromError(opts.errorMessage);

  const primaryDomain = domains[0] || "other";

  const result: any = await db.execute(sql`
    SELECT file_path, event_type, event_result, commit_sha, description, risk_score, created_at, domains
    FROM devops_file_history
    WHERE created_at > NOW() - INTERVAL '1 hour' * ${hoursBack}
    AND (
      domains && ARRAY[${sql.raw(domains.map(d => `'${d}'`).join(","))}]::text[]
      OR event_result IN ('bug', 'revert', 'hotfix', 'failure')
    )
    ORDER BY created_at DESC
    LIMIT 30
  `);

  const rows = (result.rows || result || []);

  const recentChanges: IncidentDiagnosis["recentChanges"] = [];
  const seenFiles = new Set<string>();

  for (const row of rows) {
    if (seenFiles.has(row.file_path)) continue;
    seenFiles.add(row.file_path);

    let fragilityScore = 0;
    try {
      fragilityScore = await devopsIntelligenceEngine.getDynamicFragilityForFile(row.file_path);
    } catch {}

    recentChanges.push({
      filePath: row.file_path,
      eventType: row.event_type,
      eventResult: row.event_result,
      commitSha: row.commit_sha,
      description: row.description,
      changedAt: new Date(row.created_at).toISOString(),
      fragilityScore,
    });
  }

  const fragilityAlerts: IncidentDiagnosis["fragilityAlerts"] = [];
  try {
    const leaderboard = await devopsIntelligenceEngine.getFragilityLeaderboard(20);
    for (const entry of leaderboard) {
      const entryDomains = Object.keys(devopsIntelligenceEngine.DOMAIN_PATTERNS).filter(d => {
        const patterns = devopsIntelligenceEngine.DOMAIN_PATTERNS[d]?.patterns || [];
        return patterns.some((p: string) => entry.filePath.toLowerCase().includes(p.toLowerCase()));
      });
      if (entryDomains.some(d => domains.includes(d)) || entry.combinedScore >= 80) {
        fragilityAlerts.push({
          file: entry.filePath,
          score: entry.combinedScore,
          trend: entry.recentTrend,
          reason: entry.reason,
        });
      }
    }
  } catch {}

  const suspectedFiles = recentChanges
    .filter(c => c.fragilityScore >= 50 || c.eventResult !== "success")
    .map(c => c.filePath);

  let suspectedCause = "Pas assez de données pour déterminer la cause.";
  let confidence = 20;

  if (suspectedFiles.length > 0) {
    const topSuspect = recentChanges.sort((a, b) => b.fragilityScore - a.fragilityScore)[0];
    suspectedCause = `Modification récente de ${topSuspect.filePath} (fragilité: ${topSuspect.fragilityScore}/100, event: ${topSuspect.eventResult})`;
    confidence = Math.min(90, 30 + topSuspect.fragilityScore * 0.5 + (topSuspect.eventResult !== "success" ? 20 : 0));
  } else if (fragilityAlerts.length > 0) {
    suspectedCause = `Zone fragile active: ${fragilityAlerts[0].file} (score: ${fragilityAlerts[0].score}/100, tendance: ${fragilityAlerts[0].trend})`;
    confidence = 40;
  }

  const recommendations: string[] = [];
  if (recentChanges.some(c => c.eventResult === "bug" || c.eventResult === "failure")) {
    recommendations.push("Vérifier les commits récents marqués comme bug/failure");
  }
  if (fragilityAlerts.some(a => a.trend === "degrading")) {
    recommendations.push("Modules en dégradation détectés — stabilisation prioritaire");
  }
  if (suspectedFiles.length > 0) {
    recommendations.push(`Inspecter: ${suspectedFiles.slice(0, 3).join(", ")}`);
  }
  if (opts.errorCode && opts.errorCode >= 500) {
    recommendations.push("Vérifier les logs serveur pour stack traces détaillées");
  }
  recommendations.push("Lancer un rapport DevOps Intelligence complet sur les fichiers suspects");

  return {
    domain: primaryDomain,
    endpoint: opts.endpoint,
    recentChanges: recentChanges.slice(0, 10),
    fragilityAlerts: fragilityAlerts.slice(0, 5),
    suspectedCause,
    confidence: Math.round(confidence),
    recommendations,
  };
}

export async function checkSmartAlerts(): Promise<Array<{
  type: "fragile_change" | "degrading_domain" | "repeated_bug";
  severity: "info" | "warning" | "critical";
  message: string;
  domain: string;
  files: string[];
}>> {
  const alerts: Array<any> = [];

  try {
    const recentResult: any = await db.execute(sql`
      SELECT file_path, event_result, domains, created_at
      FROM devops_file_history
      WHERE created_at > NOW() - INTERVAL '2 hours'
      AND event_result IN ('bug', 'failure', 'revert')
    `);
    const recentBugs = (recentResult.rows || recentResult || []);

    for (const bug of recentBugs) {
      const score = await devopsIntelligenceEngine.getDynamicFragilityForFile(bug.file_path);
      if (score >= 70) {
        alerts.push({
          type: "fragile_change",
          severity: score >= 85 ? "critical" : "warning",
          message: `Module fragile ${bug.file_path} (score: ${score}/100) a eu un ${bug.event_result} récent`,
          domain: bug.domains?.[0] || "unknown",
          files: [bug.file_path],
        });
      }
    }

    const bugCountResult: any = await db.execute(sql`
      SELECT file_path, COUNT(*) as bug_count
      FROM devops_file_history
      WHERE event_result IN ('bug', 'failure', 'revert')
      AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY file_path
      HAVING COUNT(*) >= 3
    `);
    const repeatedBugs = (bugCountResult.rows || bugCountResult || []);
    for (const rb of repeatedBugs) {
      alerts.push({
        type: "repeated_bug",
        severity: "critical",
        message: `${rb.file_path} a eu ${rb.bug_count} incidents en 7 jours — pattern récurrent détecté`,
        domain: "multi",
        files: [rb.file_path],
      });
    }
  } catch (err: any) {
    console.error(`[IncidentCorrelation] Smart alerts error: ${err.message}`);
  }

  return alerts;
}

export const incidentCorrelationService = {
  diagnoseIncident,
  checkSmartAlerts,
};
