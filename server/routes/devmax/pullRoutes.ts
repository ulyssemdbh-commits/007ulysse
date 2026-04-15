import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { sql } from "drizzle-orm";
  import { githubService, withGitHubToken } from "../../services/githubService";
  import { getProjectRepo, withRepoToken } from "./opsHelpers";
  import { logDevmaxActivity, checkPlanLimits, sendDevmaxNotification } from "./devmaxMiddleware";
  
  const router = Router();

  router.get("/pulls", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { state } = req.query;
    const pulls = await withRepoToken(repo.githubToken, () =>
      githubService.listPullRequests(repo.owner, repo.name, state as string || "open")
    );
    res.json(pulls);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/pulls", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { title, body, head, base } = req.body;
    const pr = await withRepoToken(repo.githubToken, () =>
      githubService.createPullRequest(repo.owner, repo.name, title, body || "", head, base || "main")
    );
    await logDevmaxActivity(req, "create_pr", title, { head, base });
    res.json(pr);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/pulls/:pull_number/merge", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { merge_method } = req.body;
    const result = await withRepoToken(repo.githubToken, () =>
      githubService.mergePullRequest(repo.owner, repo.name, parseInt(req.params.pull_number), merge_method || "squash")
    );
    await logDevmaxActivity(req, "merge_pr", `#${req.params.pull_number}`);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/promote-staging", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const branches = await withRepoToken(repo.githubToken, () => githubService.listBranches(repo.owner, repo.name));
    const hasStagingBranch = branches.some((b: any) => b.name === "staging");

    if (hasStagingBranch) {
      const pr = await withRepoToken(repo.githubToken, () =>
        githubService.createPullRequest(
          repo.owner, repo.name,
          `[Deploy] Staging → Prod (${new Date().toLocaleDateString("fr-FR")})`,
          "Déploiement depuis staging.",
          "staging", "main"
        )
      );
      const prNumber = (pr as any).number;
      await withRepoToken(repo.githubToken, () =>
        githubService.mergePullRequest(repo.owner, repo.name, prNumber, "merge")
      );
      await logDevmaxActivity(req, "promote_staging", "branch_merge", { prNumber });
      return res.json({ success: true, method: "branch_merge", prNumber });
    }

    const testRepoName = `${repo.name}-test`;
    let testRepo: any;
    try {
      testRepo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, testRepoName));
    } catch {
      return res.status(404).json({ error: "Ni branche staging ni repo -test trouvé" });
    }

    const testBranch = testRepo.default_branch || "main";
    const testTree = await withRepoToken(repo.githubToken, () => githubService.getTree(repo.owner, testRepoName, testBranch));
    const files: { path: string; content: string }[] = [];

    for (const item of (testTree as any).tree || []) {
      if (item.type !== "blob") continue;
      try {
        const fileData = await withRepoToken(repo.githubToken, () =>
          githubService.getFileContent(repo.owner, testRepoName, item.path, testBranch)
        );
        files.push({ path: item.path, content: (fileData as any).content || "" });
      } catch {}
    }

    let mainBranch = "main";
    try {
      const mainRepo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, repo.name));
      mainBranch = (mainRepo as any).default_branch || "main";
    } catch {}

    let synced = 0;
    for (const file of files) {
      try {
        let existingSha: string | undefined;
        try {
          const existing = await withRepoToken(repo.githubToken, () =>
            githubService.getFileContent(repo.owner, repo.name, file.path, mainBranch)
          );
          existingSha = (existing as any).sha;
        } catch {}
        await withRepoToken(repo.githubToken, () =>
          githubService.createOrUpdateFileRaw(
            repo.owner, repo.name, file.path, file.content,
            `[Staging→Prod] Sync ${file.path}`, mainBranch, existingSha
          )
        );
        synced++;
      } catch {}
    }

    await logDevmaxActivity(req, "promote_staging", "test_repo_sync", { testRepo: testRepoName, filesSynced: synced });
    res.json({ success: true, method: "test_repo_sync", testRepo: testRepoName, filesSynced: synced, totalFiles: files.length });
  } catch (error: any) {
    const msg = error.message || "";
    if (msg.includes("422") || msg.toLowerCase().includes("no commits") || msg.toLowerCase().includes("already")) {
      return res.json({ success: true, method: "already_up_to_date", message: "Staging est déjà à jour avec la prod." });
    }
    res.status(500).json({ error: msg });
  }
});


  export default router;
  