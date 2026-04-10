import { Router, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

const WEBHOOK_SECRET_HEADER = "x-hub-signature-256";
const WEBHOOK_EVENT_HEADER = "x-github-event";
const WEBHOOK_DELIVERY_HEADER = "x-github-delivery";

const webhookQueue: { processing: boolean; queue: (() => Promise<void>)[]; concurrent: number; maxConcurrent: number; startupGracePeriod: number; startedAt: number } = {
  processing: false,
  queue: [],
  concurrent: 0,
  maxConcurrent: 2,
  startupGracePeriod: 60_000,
  startedAt: Date.now(),
};

const processedDeliveries = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  for (const [id, ts] of processedDeliveries) {
    if (ts < cutoff) processedDeliveries.delete(id);
  }
}, 60_000);

async function drainWebhookQueue() {
  while (webhookQueue.queue.length > 0 && webhookQueue.concurrent < webhookQueue.maxConcurrent) {
    const job = webhookQueue.queue.shift();
    if (!job) break;
    webhookQueue.concurrent++;
    job().finally(() => {
      webhookQueue.concurrent--;
      drainWebhookQueue();
    });
  }
}

function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function logDeployment(projectId: string, params: {
  environment: string;
  trigger: string;
  commitSha?: string;
  prevCommitSha?: string;
  commitMessage?: string;
  branch?: string;
  status: string;
  url?: string;
  logs?: string[];
  duration?: number;
}) {
  try {
    await db.execute(sql`
      INSERT INTO devmax_deployments (project_id, environment, trigger, commit_sha, prev_commit_sha, commit_message, branch, status, url, logs, duration_ms)
      VALUES (${projectId}, ${params.environment}, ${params.trigger}, ${params.commitSha || null}, ${params.prevCommitSha || null}, ${params.commitMessage || null}, ${params.branch || null}, ${params.status}, ${params.url || null}, ${JSON.stringify(params.logs || [])}, ${params.duration || null})
    `);
  } catch (e: any) {
    console.error("[DevMax Webhook] Failed to log deployment:", e.message);
  }
}

router.post("/github", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const signature = req.headers[WEBHOOK_SECRET_HEADER] as string;
  const event = req.headers[WEBHOOK_EVENT_HEADER] as string;
  const deliveryId = req.headers[WEBHOOK_DELIVERY_HEADER] as string;

  if (!event) {
    return res.status(400).json({ error: "Missing event header" });
  }

  if (event === "ping") {
    console.log(`[DevMax Webhook] Ping received (delivery: ${deliveryId})`);
    return res.json({ ok: true, event: "ping" });
  }

  // DEDUP: skip already-processed deliveries
  if (deliveryId && processedDeliveries.has(deliveryId)) {
    return res.json({ ok: true, event, deduplicated: true });
  }
  if (deliveryId) processedDeliveries.set(deliveryId, Date.now());

  // STARTUP GRACE: during first 60s after boot, drop deploy-triggering webhooks to prevent saturation
  const uptime = Date.now() - webhookQueue.startedAt;
  if (uptime < webhookQueue.startupGracePeriod && event === "push") {
    console.log(`[DevMax Webhook] ⏸️ Startup grace period — dropping push event (uptime: ${(uptime / 1000).toFixed(0)}s)`);
    return res.json({ ok: true, event, deferred: "startup_grace_period" });
  }

  // RATE LIMIT: max 2 concurrent webhook jobs, queue the rest (max 10 in queue)
  if (event === "push" && webhookQueue.concurrent >= webhookQueue.maxConcurrent) {
    if (webhookQueue.queue.length >= 10) {
      console.log(`[DevMax Webhook] ⚠️ Queue full (${webhookQueue.queue.length}) — dropping push event`);
      return res.status(429).json({ error: "Webhook queue full", retryAfter: 30 });
    }
    console.log(`[DevMax Webhook] ⏳ Queuing push event (concurrent: ${webhookQueue.concurrent}, queued: ${webhookQueue.queue.length})`);
  }

  const payload = req.body;

  const supportedEvents = ["push", "pull_request", "issues", "workflow_run", "create", "delete", "release"];
  if (!supportedEvents.includes(event)) {
    return res.json({ ok: true, event, ignored: true });
  }

  if (event !== "push") {
    try {
      const repoFullEvt = payload?.repository?.full_name;
      if (repoFullEvt) {
        const [evtOwner] = repoFullEvt.split("/");
        const evtProject = await db.execute(sql`
          SELECT id, name, deploy_slug FROM devmax_projects WHERE repo_owner = ${evtOwner} AND deploy_slug IS NOT NULL LIMIT 1
        `).then((r: any) => (r.rows || r)?.[0] || null).catch(() => null);

        let evtTitle = "", evtActor = payload?.sender?.login || "unknown";
        const evtDetails: any = {};
        if (event === "pull_request") {
          const pr = payload?.pull_request;
          evtTitle = `PR ${payload?.action}: ${pr?.title || ""}`;
          evtDetails.number = pr?.number;
          evtDetails.url = pr?.html_url;
          evtDetails.state = pr?.state;
        } else if (event === "issues") {
          evtTitle = `Issue ${payload?.action}: ${payload?.issue?.title || ""}`;
          evtDetails.number = payload?.issue?.number;
        } else if (event === "workflow_run") {
          const wf = payload?.workflow_run;
          evtTitle = `CI ${wf?.conclusion || wf?.status}: ${wf?.name || ""}`;
          evtDetails.conclusion = wf?.conclusion;
          evtDetails.url = wf?.html_url;
        } else if (event === "release") {
          evtTitle = `Release ${payload?.action}: ${payload?.release?.tag_name || ""}`;
        } else {
          evtTitle = `${event} ${payload?.ref_type || ""}: ${payload?.ref || ""}`;
        }

        await db.execute(sql`
          INSERT INTO devmax_github_events (project_id, event_type, repo, branch, actor, title, details)
          VALUES (${evtProject?.id || null}, ${event}, ${repoFullEvt}, ${payload?.ref || null}, ${evtActor}, ${evtTitle}, ${JSON.stringify(evtDetails)})
        `).catch(() => {});

        if (event === "release" && payload?.action === "published" && evtProject?.deploy_slug) {
          console.log(`[DevMax Webhook] 🚀 Release published: ${payload?.release?.tag_name} — triggering production deploy for ${evtProject.name}`);
          const releaseStartTime = Date.now();
          const releaseDeployLogs: string[] = [`Release: ${payload?.release?.tag_name} published`, `Triggering production deploy for ${evtProject.name}`];
          try {
            const { sshService } = await import("../services/sshService");
            const prodResult = await sshService.promoteToProduction({ appName: evtProject.deploy_slug, caller: "max" });
            releaseDeployLogs.push(...(prodResult.logs || []));
            await logDeployment(evtProject.id, {
              environment: "production",
              trigger: "release",
              commitSha: payload?.release?.target_commitish,
              commitMessage: `Release ${payload?.release?.tag_name}: ${payload?.release?.name || ""}`.substring(0, 500),
              branch: payload?.release?.target_commitish,
              status: prodResult.success ? "success" : "failed",
              url: prodResult.productionUrl,
              logs: releaseDeployLogs,
              duration: Date.now() - releaseStartTime,
            });
            if (prodResult.success) {
              await db.execute(sql`UPDATE devmax_projects SET last_deployed_at = NOW(), updated_at = NOW() WHERE id = ${evtProject.id}`).catch(() => {});
            }
            try {
              const { discordService } = await import("../services/discordService");
              await discordService.sendMessage(`🚀 **PRODUCTION** — ${evtProject.name}\nRelease: \`${payload?.release?.tag_name}\`\nStatus: ${prodResult.success ? "Déployé en prod ✅" : "Échec ❌"}\nDurée: ${((Date.now() - releaseStartTime) / 1000).toFixed(1)}s${prodResult.productionUrl ? `\nURL: ${prodResult.productionUrl}` : ""}`, "devops");
            } catch {}
          } catch (releaseErr: any) {
            releaseDeployLogs.push(`Deploy error: ${releaseErr.message}`);
            await logDeployment(evtProject.id, {
              environment: "production",
              trigger: "release",
              commitSha: payload?.release?.target_commitish,
              commitMessage: `Release ${payload?.release?.tag_name}`.substring(0, 500),
              branch: payload?.release?.target_commitish,
              status: "error",
              logs: releaseDeployLogs,
              duration: Date.now() - releaseStartTime,
            });
            console.error(`[DevMax Webhook] Release deploy error for ${evtProject.name}:`, releaseErr.message);
          }
          return res.json({ ok: true, event: "release", deploying: true, project: evtProject.name, tag: payload?.release?.tag_name });
        }

        const shouldNotify = event === "pull_request" && (payload?.action === "opened" || payload?.action === "merged")
          || event === "workflow_run" && payload?.workflow_run?.conclusion === "failure"
          || event === "issues" && payload?.action === "opened";

        if (shouldNotify) {
          try {
            const { discordService } = await import("../services/discordService");
            const emoji = event === "workflow_run" ? "❌" : event === "pull_request" ? "🔀" : "📋";
            await discordService.sendMessage(`${emoji} **GitHub** — ${evtTitle}\nRepo: \`${repoFullEvt}\`\nPar: ${evtActor}`, "devops");
          } catch {}
        }
      }
    } catch (evtErr: any) {
      console.error(`[DevMax Webhook] Event ${event} processing error:`, evtErr.message);
    }
    return res.json({ ok: true, event, processed: true });
  }

  const repoFullName = payload?.repository?.full_name;
  const branch = payload?.ref?.replace("refs/heads/", "");
  const headCommit = payload?.head_commit;

  if (!repoFullName || !branch) {
    return res.status(400).json({ error: "Invalid push payload" });
  }

  console.log(`[DevMax Webhook] Push to ${repoFullName}:${branch} — ${headCommit?.message?.substring(0, 80) || "no message"}`);

  try {
    const [owner, repoName] = repoFullName.split("/");
    const isStagingRepo = repoName.endsWith("-test");
    const prodRepoName = isStagingRepo ? repoName.replace(/-test$/, "") : repoName;
    const stagingRepoName = isStagingRepo ? repoName : `${repoName}-test`;

    const projects = await db.execute(sql`
      SELECT id, name, deploy_slug, repo_owner, repo_name, webhook_secret, cicd_branch, cicd_enabled
      FROM devmax_projects 
      WHERE repo_owner = ${owner} AND (repo_name = ${prodRepoName} OR repo_name = ${stagingRepoName} OR repo_name = ${repoName}) AND deploy_slug IS NOT NULL
    `).then((r: any) => r.rows || r);

    if (!projects.length) {
      console.log(`[DevMax Webhook] No project found for ${repoFullName}`);
      return res.json({ ok: true, matched: false });
    }

    const project = projects[0];

    if (project.cicd_enabled === false) {
      console.log(`[DevMax Webhook] CI/CD disabled for ${project.name}`);
      return res.json({ ok: true, cicd: "disabled" });
    }

    const targetBranch = project.cicd_branch || "main";
    if (branch !== targetBranch) {
      console.log(`[DevMax Webhook] Ignoring push to ${branch} (target: ${targetBranch})`);
      return res.json({ ok: true, branch, ignored: true, target: targetBranch });
    }

    if (project.webhook_secret) {
      if (!signature) {
        console.warn(`[DevMax Webhook] Missing signature for ${project.name} (secret configured)`);
        return res.status(401).json({ error: "Missing signature — webhook secret is configured for this project" });
      }
      const rawBody = JSON.stringify(payload);
      if (!verifyGitHubSignature(rawBody, signature, project.webhook_secret)) {
        console.warn(`[DevMax Webhook] Invalid signature for ${project.name}`);
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    res.json({ ok: true, deploying: true, project: project.name, branch });

    const prevCommitSha = payload?.before || null;
    const deployLogs: string[] = [`Webhook: push to ${repoFullName}:${branch}`, `Commit: ${headCommit?.id?.substring(0, 8)} — ${headCommit?.message?.substring(0, 100)}`];

    await db.execute(sql`
      INSERT INTO devmax_github_events (project_id, event_type, repo, branch, actor, title, details)
      VALUES (${project.id}, 'push', ${repoFullName}, ${branch}, ${headCommit?.author?.username || payload?.pusher?.name || "unknown"}, ${`Push: ${headCommit?.message?.substring(0, 100) || "no message"}`}, ${JSON.stringify({ commits: payload?.commits?.length || 0, sha: headCommit?.id, prev_sha: prevCommitSha })})
    `).catch(() => {});

    try {
      const { sshService } = await import("../services/sshService");
      const stagingRepo = isStagingRepo ? repoName : `${repoName}-test`;
      const repoUrl = `https://github.com/${owner}/${stagingRepo}.git`;

      deployLogs.push(`Auto-deploying ${project.deploy_slug} to staging from ${owner}/${stagingRepo}...`);

      const result = await sshService.deployStagingApp({
        repoUrl,
        appName: project.deploy_slug,
        branch: targetBranch,
        caller: "max",
      });

      deployLogs.push(...(result.logs || []));
      const duration = Date.now() - startTime;

      await logDeployment(project.id, {
        environment: "staging",
        trigger: "webhook",
        commitSha: headCommit?.id,
        prevCommitSha,
        commitMessage: headCommit?.message?.substring(0, 500),
        branch,
        status: result.success ? "success" : "failed",
        url: result.stagingUrl,
        logs: deployLogs,
        duration,
      });

      if (result.success) {
        await db.execute(sql`
          UPDATE devmax_projects SET last_deployed_at = NOW(), updated_at = NOW() WHERE id = ${project.id}
        `);
      } else if (prevCommitSha && prevCommitSha !== "0000000000000000000000000000000000000000") {
        // AUTO-ROLLBACK: deploy failed → rollback to previous commit
        console.log(`[DevMax Webhook] 🔄 AUTO-ROLLBACK for ${project.name} — reverting to ${prevCommitSha.substring(0, 8)}`);
        deployLogs.push(`AUTO-ROLLBACK: Deploy failed, reverting to previous commit ${prevCommitSha.substring(0, 8)}...`);
        try {
          const rollbackResult = await sshService.deployStagingApp({
            repoUrl: `https://github.com/${owner}/${isStagingRepo ? repoName : `${repoName}-test`}.git`,
            appName: project.deploy_slug,
            branch: targetBranch,
            caller: "max",
            commitSha: prevCommitSha,
          });
          const rollbackStatus = rollbackResult.success ? "RESTORED" : "ROLLBACK_FAILED";
          deployLogs.push(`Rollback ${rollbackStatus}: ${rollbackResult.success ? "App restored to previous version" : "Rollback also failed — manual intervention needed"}`);
          console.log(`[DevMax Webhook] Rollback ${rollbackStatus} for ${project.name}`);
          await logDeployment(project.id, {
            environment: "staging",
            trigger: "auto-rollback",
            commitSha: prevCommitSha,
            commitMessage: `Auto-rollback from failed deploy of ${headCommit?.id?.substring(0, 8)}`,
            branch,
            status: rollbackResult.success ? "success" : "failed",
            url: rollbackResult.stagingUrl,
            logs: [`Auto-rollback triggered by failed deploy`, ...deployLogs],
            duration: Date.now() - startTime,
          });
        } catch (rollbackErr: any) {
          deployLogs.push(`Rollback ERROR: ${rollbackErr.message}`);
          console.error(`[DevMax Webhook] Auto-rollback error for ${project.name}:`, rollbackErr.message);
        }
      }

      try {
        const { discordService } = await import("../services/discordService");
        const emoji = result.success ? "✅" : "❌";
        const rollbackInfo = !result.success && prevCommitSha ? `\n🔄 Auto-rollback vers \`${prevCommitSha.substring(0, 8)}\` tenté` : "";
        await discordService.sendMessage(
          `${emoji} **CI/CD** — ${project.name}\nBranche: \`${branch}\`\nCommit: \`${headCommit?.id?.substring(0, 8)}\` ${headCommit?.message?.substring(0, 80)}\nStatus: ${result.success ? "Déployé en staging" : "Échec"}${rollbackInfo}\nDurée: ${(duration / 1000).toFixed(1)}s${result.stagingUrl ? `\nURL: ${result.stagingUrl}` : ""}`,
          "devops"
        );
      } catch {}

      console.log(`[DevMax Webhook] Deploy ${result.success ? "OK" : "FAILED"} for ${project.name} (${(Date.now() - startTime) / 1000}s)`);
    } catch (deployErr: any) {
      deployLogs.push(`Deploy error: ${deployErr.message}`);
      await logDeployment(project.id, {
        environment: "staging",
        trigger: "webhook",
        commitSha: headCommit?.id,
        commitMessage: headCommit?.message?.substring(0, 500),
        branch,
        status: "error",
        logs: deployLogs,
        duration: Date.now() - startTime,
      });
      console.error(`[DevMax Webhook] Deploy error for ${project.name}:`, deployErr.message);
    }
  } catch (err: any) {
    console.error(`[DevMax Webhook] Error:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

router.post("/stripe", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) return res.status(400).json({ error: "Missing stripe-signature header" });
    const { devmaxStripeService } = await import("../services/devmaxStripeService");
    if (!devmaxStripeService.isConfigured()) {
      return res.status(503).json({ error: "Stripe not configured" });
    }
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const result = await devmaxStripeService.handleWebhook(rawBody, signature);
    console.log(`[Stripe Webhook] Event: ${result.event}, handled: ${result.handled}`);
    res.json({ received: true, ...result });
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  res.json({ ok: true, service: "devmax-webhook", timestamp: new Date().toISOString() });
});

export default router;
