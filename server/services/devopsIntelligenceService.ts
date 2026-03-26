import { devopsIntelligenceEngine, recordFileEvent } from "./devopsIntelligenceEngine";
import { githubService } from "./githubService";
import { db } from "../db";
import { devopsFileHistory } from "@shared/schema";
import { sql, desc } from "drizzle-orm";

export interface DevOpsReport {
  id: string;
  timestamp: string;
  repo?: string;
  sha?: string;
  prNumber?: number;
  ciRisk: { overall: number; riskLevel: string; warnings: string[]; recommendations: string[] } | null;
  impactMap: { nodeCount: number; edgeCount: number; domains: string[]; topFiles: string[] } | null;
  patchAdvice: { bestChoice: string; reasoning: string; patchCount: number } | null;
  learningGaps: number;
  codeReview: { score: number; verdict: string; issueCount: number } | null;
  fragilityAlerts: Array<{ file: string; score: number; trend: string }>;
  rollbackPlan: string | null;
}

const recentReports: DevOpsReport[] = [];
const MAX_REPORTS = 50;

function storeReport(report: DevOpsReport) {
  recentReports.unshift(report);
  if (recentReports.length > MAX_REPORTS) recentReports.pop();
}

export async function runIntelligenceForCommit(userId: number, repo: string, sha: string): Promise<DevOpsReport> {
  const repoFull = repo.includes("/") ? repo : `ulyssemdbh-commits/${repo}`;
  let files: Array<{ path: string; content?: string }> = [];
  let changes: Array<{ file: string; linesAdded: number; linesRemoved: number; changeType: string }> = [];
  let reviewFiles: any[] = [];

  try {
    const diff = await githubService.getCommitDiff(repoFull, sha);
    if (diff?.files) {
      files = diff.files.map((f: any) => ({ path: f.filename }));
      changes = diff.files.map((f: any) => ({
        file: f.filename,
        linesAdded: f.additions || 0,
        linesRemoved: f.deletions || 0,
        changeType: f.status === "added" ? "create" : f.status === "removed" ? "delete" : "modify",
      }));
      reviewFiles = diff.files;

      await recordFileEvent(diff.files.map((f: any) => ({
        filePath: f.filename,
        eventType: "commit",
        eventResult: "success",
        linesChanged: (f.additions || 0) + (f.deletions || 0),
        commitSha: sha,
        userId,
      })));
    }
  } catch (err: any) {
    console.error(`[DevOpsIntelService] Commit diff error: ${err.message}`);
  }

  return await buildReport(userId, { repo: repoFull, sha, files, changes, reviewFiles });
}

export async function runIntelligenceForPR(userId: number, repo: string, prNumber: number): Promise<DevOpsReport> {
  const repoFull = repo.includes("/") ? repo : `ulyssemdbh-commits/${repo}`;
  let files: Array<{ path: string; content?: string }> = [];
  let changes: Array<{ file: string; linesAdded: number; linesRemoved: number; changeType: string }> = [];
  let reviewFiles: any[] = [];

  try {
    const prFiles = await githubService.getPullRequestFiles(repoFull, prNumber);
    if (prFiles?.length) {
      files = prFiles.map((f: any) => ({ path: f.filename }));
      changes = prFiles.map((f: any) => ({
        file: f.filename,
        linesAdded: f.additions || 0,
        linesRemoved: f.deletions || 0,
        changeType: f.status === "added" ? "create" : f.status === "removed" ? "delete" : "modify",
      }));
      reviewFiles = prFiles;
    }
  } catch (err: any) {
    console.error(`[DevOpsIntelService] PR files error: ${err.message}`);
  }

  return await buildReport(userId, { repo: repoFull, prNumber, files, changes, reviewFiles });
}

export async function runIntelligenceManual(userId: number, payload: {
  files?: Array<{ path: string; content?: string }>;
  changes?: Array<{ file: string; linesAdded: number; linesRemoved: number; changeType: string }>;
  problem?: string;
  bugType?: string;
}): Promise<DevOpsReport> {
  return await buildReport(userId, {
    files: payload.files || [],
    changes: payload.changes || [],
    reviewFiles: [],
    problem: payload.problem,
    bugType: payload.bugType,
  });
}

async function buildReport(userId: number, opts: {
  repo?: string;
  sha?: string;
  prNumber?: number;
  files: Array<{ path: string; content?: string }>;
  changes: Array<{ file: string; linesAdded: number; linesRemoved: number; changeType: string }>;
  reviewFiles?: any[];
  problem?: string;
  bugType?: string;
}): Promise<DevOpsReport> {
  const reportId = `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let ciRisk = null;
  let impactMapSummary = null;
  let patchAdviceSummary = null;
  let learningGapCount = 0;
  let codeReviewSummary = null;
  const fragilityAlerts: Array<{ file: string; score: number; trend: string }> = [];

  if (opts.changes.length > 0) {
    try {
      const risk = devopsIntelligenceEngine.calculateCIRisk(opts.changes);
      ciRisk = { overall: risk.overall, riskLevel: risk.riskLevel, warnings: risk.warnings, recommendations: risk.recommendations };
    } catch {}
  }

  if (opts.files.length > 0) {
    try {
      const map = devopsIntelligenceEngine.buildImpactMap(opts.files);
      const topDomains = Object.entries(map.domainSummary)
        .sort((a, b) => b[1].avgCriticality - a[1].avgCriticality)
        .slice(0, 10);
      impactMapSummary = {
        nodeCount: map.nodes.length,
        edgeCount: map.edges.length,
        domains: topDomains.map(([d]) => d),
        topFiles: map.nodes.sort((a, b) => b.criticality - a.criticality).slice(0, 5).map(n => n.file),
      };
    } catch {}
  }

  if (opts.problem && opts.files.length > 0) {
    try {
      const advice = devopsIntelligenceEngine.generatePatchAdvice(
        opts.problem,
        opts.files.map(f => f.path),
        (opts.bugType as any) || "bug"
      );
      patchAdviceSummary = { bestChoice: advice.bestChoice, reasoning: advice.reasoning, patchCount: advice.patches.length };
    } catch {}
  }

  if (opts.reviewFiles?.length) {
    try {
      const review = devopsIntelligenceEngine.analyzeDiffForReview(opts.reviewFiles);
      codeReviewSummary = { score: review.score, verdict: review.verdict, issueCount: review.issues.length };
    } catch {}
  }

  try {
    for (const f of opts.files.slice(0, 20)) {
      const score = await devopsIntelligenceEngine.getDynamicFragilityForFile(f.path);
      if (score >= 50) {
        const scores = await devopsIntelligenceEngine.calculateDynamicFragility(f.path);
        fragilityAlerts.push({
          file: f.path,
          score,
          trend: scores[0]?.recentTrend || "stable",
        });
      }
    }
  } catch {}

  try {
    const gaps = await devopsIntelligenceEngine.analyzeLearningGaps(userId);
    learningGapCount = gaps.length;
  } catch {}

  let rollbackPlan: string | null = null;
  if (ciRisk && (ciRisk.riskLevel === "risky" || ciRisk.riskLevel === "dangerous")) {
    const revertCmd = opts.sha ? `git revert ${opts.sha}` : opts.prNumber ? `Fermer PR #${opts.prNumber} et revert le merge` : "git revert HEAD";
    const impactedEndpoints = opts.files
      .filter(f => f.path.includes("routes") || f.path.includes("api"))
      .map(f => f.path);
    rollbackPlan = `## Plan de rollback\n1. ${revertCmd}\n2. Vérifier les endpoints: ${impactedEndpoints.length ? impactedEndpoints.join(", ") : "N/A"}\n3. Surveiller les logs 15min post-revert\n4. Confirmer stabilité avant re-tentative`;
  }

  const report: DevOpsReport = {
    id: reportId,
    timestamp: new Date().toISOString(),
    repo: opts.repo,
    sha: opts.sha,
    prNumber: opts.prNumber,
    ciRisk,
    impactMap: impactMapSummary,
    patchAdvice: patchAdviceSummary,
    learningGaps: learningGapCount,
    codeReview: codeReviewSummary,
    fragilityAlerts,
    rollbackPlan,
  };

  storeReport(report);

  try {
    const { brainService } = await import("./brainService");
    await brainService.addKnowledge(userId, {
      title: `DevOps Report ${opts.sha?.slice(0, 7) || opts.prNumber || "manual"} — ${new Date().toLocaleDateString("fr-FR")}`,
      content: JSON.stringify({ risk: ciRisk?.riskLevel, score: ciRisk?.overall, domains: impactMapSummary?.domains, review: codeReviewSummary?.verdict }),
      type: "fact",
      category: "technical",
      importance: ciRisk && ciRisk.overall >= 60 ? 85 : 60,
      confidence: 90,
    });
  } catch {}

  try {
    const { workJournalService } = await import("./workJournalService");
    await workJournalService.addEntry(userId, {
      title: `Rapport DevOps Intel${opts.sha ? ` — commit ${opts.sha.slice(0, 7)}` : ""}${opts.prNumber ? ` — PR #${opts.prNumber}` : ""}`,
      content: `Risk: ${ciRisk?.overall || "N/A"}/100 (${ciRisk?.riskLevel || "N/A"}) | Review: ${codeReviewSummary?.score || "N/A"}/100 | ${fragilityAlerts.length} alerte(s) fragilité`,
      entryType: "note",
      context: "devops",
      tags: ["devops-intel", "auto-report"],
      status: "done",
      outcome: ciRisk ? `Score risque: ${ciRisk.overall}/100` : "Analyse complète",
    });
  } catch {}

  return report;
}

export async function postPRComment(repo: string, prNumber: number, report: DevOpsReport): Promise<boolean> {
  try {
    const repoFull = repo.includes("/") ? repo : `ulyssemdbh-commits/${repo}`;
    const riskEmoji = report.ciRisk
      ? report.ciRisk.riskLevel === "safe" ? "✅" : report.ciRisk.riskLevel === "caution" ? "⚠️" : report.ciRisk.riskLevel === "risky" ? "🟠" : "🔴"
      : "❓";

    let body = `## ${riskEmoji} Rapport DevOps Intelligence — Ulysse\n\n`;
    if (report.ciRisk) {
      body += `### CI Oracle: ${report.ciRisk.overall}/100 (${report.ciRisk.riskLevel.toUpperCase()})\n`;
      if (report.ciRisk.warnings.length) body += report.ciRisk.warnings.map(w => `- ${w}`).join("\n") + "\n";
    }
    if (report.codeReview) {
      body += `\n### Code Review: ${report.codeReview.score}/100 — ${report.codeReview.verdict}\n- ${report.codeReview.issueCount} problème(s) détecté(s)\n`;
    }
    if (report.impactMap) {
      body += `\n### Impact Map\n- ${report.impactMap.nodeCount} fichiers, domaines: ${report.impactMap.domains.join(", ")}\n- Fichiers clés: ${report.impactMap.topFiles.slice(0, 3).join(", ")}\n`;
    }
    if (report.fragilityAlerts.length) {
      body += `\n### ⚡ Alertes Fragilité\n`;
      for (const a of report.fragilityAlerts) {
        body += `- **${a.file}**: ${a.score}/100 (${a.trend === "degrading" ? "📈 Dégradation" : a.trend === "improving" ? "📉 Amélioration" : "➡️ Stable"})\n`;
      }
    }
    if (report.patchAdvice) {
      body += `\n### Patch Advisor\n- Best: **${report.patchAdvice.bestChoice}** — ${report.patchAdvice.reasoning}\n`;
    }
    if (report.ciRisk?.recommendations?.length) {
      body += `\n### 💡 Recommandations\n${report.ciRisk.recommendations.map(r => `- ${r}`).join("\n")}\n`;
    }
    if (report.rollbackPlan) {
      body += `\n${report.rollbackPlan}\n`;
    }
    body += `\n---\n*Généré par Ulysse DevOps Intelligence Engine*`;

    await githubService.createPullRequestReview(repoFull, prNumber, body, "COMMENT");

    if (report.ciRisk && (report.ciRisk.riskLevel === "risky" || report.ciRisk.riskLevel === "dangerous")) {
      try {
        const token = await getGitHubToken();
        if (token) {
          const label = `devops:${report.ciRisk.riskLevel}`;
          await fetch(`https://api.github.com/repos/${repoFull}/issues/${prNumber}/labels`, {
            method: "POST",
            headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ labels: [label] }),
          });
        }
      } catch {}
    }

    return true;
  } catch (err: any) {
    console.error(`[DevOpsIntelService] PR comment error: ${err.message}`);
    return false;
  }
}

async function getGitHubToken(): Promise<string | null> {
  try {
    const { connectorBridge } = await import("./connectorBridge");
    const token = await connectorBridge.getGitHubToken();
    return token;
  } catch {
    return process.env.GITHUB_TOKEN || null;
  }
}

export function getRecentReports(limit = 20): DevOpsReport[] {
  return recentReports.slice(0, limit);
}

export function getReportById(id: string): DevOpsReport | undefined {
  return recentReports.find(r => r.id === id);
}

export async function getDomainHealthSummary(): Promise<Record<string, {
  avgFragility: number;
  recentEvents: number;
  recentBugs: number;
  trend: string;
  topFiles: Array<{ file: string; score: number }>;
}>> {
  try {
    const result: any = await db.execute(sql`
      SELECT 
        unnest(domains) as domain,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE event_result IN ('bug', 'failure', 'revert')) as bugs,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as recent,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND event_result IN ('bug', 'failure', 'revert')) as recent_bugs,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days' AND created_at <= NOW() - INTERVAL '7 days') as older,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days' AND created_at <= NOW() - INTERVAL '7 days' AND event_result IN ('bug', 'failure', 'revert')) as older_bugs
      FROM devops_file_history
      GROUP BY unnest(domains)
      ORDER BY bugs DESC
    `);

    const rows = result.rows || result || [];
    const summary: Record<string, any> = {};

    for (const row of rows) {
      const d = row.domain;
      const recent = Number(row.recent) || 0;
      const recentBugs = Number(row.recent_bugs) || 0;
      const older = Number(row.older) || 0;
      const olderBugs = Number(row.older_bugs) || 0;
      const recentRate = recent > 0 ? recentBugs / recent : 0;
      const olderRate = older > 0 ? olderBugs / older : 0;
      let trend = "stable";
      if (recent >= 2 && older >= 2) {
        if (recentRate > olderRate + 0.15) trend = "degrading";
        else if (recentRate < olderRate - 0.15) trend = "improving";
      }

      summary[d] = {
        avgFragility: Math.round(((Number(row.bugs) || 0) / Math.max(Number(row.total), 1)) * 100),
        recentEvents: recent,
        recentBugs,
        trend,
        topFiles: [],
      };
    }

    const fragility = await devopsIntelligenceEngine.getFragilityLeaderboard(30);
    for (const f of fragility) {
      const basename = f.filePath.split("/").pop() || "";
      const domains = Object.keys(devopsIntelligenceEngine.DOMAIN_PATTERNS).filter(d => {
        const patterns = devopsIntelligenceEngine.DOMAIN_PATTERNS[d]?.patterns || [];
        return patterns.some((p: string) => f.filePath.toLowerCase().includes(p.toLowerCase()));
      });
      for (const d of domains) {
        if (summary[d]) {
          summary[d].topFiles.push({ file: f.filePath, score: f.combinedScore });
        }
      }
    }

    for (const d of Object.keys(summary)) {
      summary[d].topFiles = summary[d].topFiles.slice(0, 5);
    }

    return summary;
  } catch (err: any) {
    console.error(`[DevOpsIntelService] Domain health error: ${err.message}`);
    return {};
  }
}

export const devopsIntelligenceService = {
  runIntelligenceForCommit,
  runIntelligenceForPR,
  runIntelligenceManual,
  postPRComment,
  getRecentReports,
  getReportById,
  getDomainHealthSummary,
};
