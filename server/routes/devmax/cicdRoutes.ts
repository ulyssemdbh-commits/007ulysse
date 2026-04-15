import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { sql } from "drizzle-orm";
  import { githubService, withGitHubToken } from "../../services/githubService";
  import { getProjectRepo, withRepoToken } from "./opsHelpers";
  import { logDevmaxActivity, checkPlanLimits, sendDevmaxNotification } from "./devmaxMiddleware";
  
  const router = Router();

  router.get("/actions/runs", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const runs = await withRepoToken(repo.githubToken, () =>
      githubService.listWorkflowRuns(repo.owner, repo.name)
    );
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/actions/workflows", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const workflows = await withRepoToken(repo.githubToken, () =>
      githubService.listWorkflows(repo.owner, repo.name)
    );
    res.json(workflows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/actions/workflows/:workflow_id/dispatches", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { ref, inputs } = req.body;
    await withRepoToken(repo.githubToken, () =>
      githubService.triggerWorkflow(repo.owner, repo.name, req.params.workflow_id, ref || "main", inputs)
    );
    await logDevmaxActivity(req, "trigger_workflow", req.params.workflow_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/actions/runs/:run_id/rerun", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    await withRepoToken(repo.githubToken, () =>
      githubService.rerunWorkflow(repo.owner, repo.name, parseInt(req.params.run_id))
    );
    await logDevmaxActivity(req, "rerun_workflow", req.params.run_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/actions/runs/:run_id/cancel", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    await withRepoToken(repo.githubToken, () =>
      githubService.cancelWorkflowRun(repo.owner, repo.name, parseInt(req.params.run_id))
    );
    await logDevmaxActivity(req, "cancel_workflow", req.params.run_id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


  router.post("/setup-webhook", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const projectId = req.headers["x-devmax-project"] as string;
    const { branch } = req.body;

    const crypto = await import("crypto");
    const secret = crypto.randomBytes(32).toString("hex");

    const callbackUrl = `${req.protocol}://${req.get("host")}/api/devmax/webhook/github`;
    const externalUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/devmax/webhook/github`
      : callbackUrl;

    const stagingRepoName = `${repo.name}-test`;
    let webhookId: string | null = null;
    const webhookErrors: string[] = [];

    for (const targetRepo of [stagingRepoName, repo.name]) {
      try {
        const result = await withRepoToken(repo.githubToken, () =>
          githubService.createWebhook(repo.owner, targetRepo, {
            url: externalUrl,
            secret,
            events: ["push"],
            active: true,
          })
        );
        if (!webhookId) webhookId = String(result.id);
        console.log(`[DevMax] Webhook created on ${repo.owner}/${targetRepo}`);
      } catch (ghErr: any) {
        if (ghErr.message?.includes("already exists") || ghErr.status === 422) {
          if (!webhookId) webhookId = "existing";
          console.log(`[DevMax] Webhook already exists on ${repo.owner}/${targetRepo}`);
        } else {
          webhookErrors.push(`${targetRepo}: ${ghErr.message}`);
        }
      }
    }
    if (!webhookId && webhookErrors.length) {
      throw new Error(`Webhook setup failed: ${webhookErrors.join("; ")}`);
    }

    await db.execute(sql`
      UPDATE devmax_projects 
      SET webhook_secret = ${secret}, 
          webhook_id = ${webhookId},
          cicd_enabled = true,
          cicd_branch = ${branch || "main"},
          updated_at = NOW()
      WHERE id = ${projectId}
    `);

    await logDevmaxActivity(req, "setup-webhook", "main", { webhookId, branch: branch || "main" });

    res.json({
      success: true,
      webhookId,
      webhookUrl: externalUrl,
      branch: branch || "main",
      message: `CI/CD webhook configuré — push sur ${branch || "main"} → auto-deploy staging`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/toggle-cicd", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const { enabled, branch } = req.body;

    const setClauses: ReturnType<typeof sql>[] = [];
    if (typeof enabled === "boolean") setClauses.push(sql`cicd_enabled = ${enabled}`);
    if (branch) setClauses.push(sql`cicd_branch = ${branch}`);
    setClauses.push(sql`updated_at = NOW()`);

    const setQuery = sql.join(setClauses, sql`, `);
    await db.execute(sql`UPDATE devmax_projects SET ${setQuery} WHERE id = ${projectId}`);
    res.json({ success: true, enabled, branch });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


  export default router;
  