import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { sql } from "drizzle-orm";
  import { githubService, withGitHubToken } from "../../services/githubService";
  import { getProjectRepo, withRepoToken } from "./opsHelpers";
  import { logDevmaxActivity, checkPlanLimits, sendDevmaxNotification } from "./devmaxMiddleware";
  
  const router = Router();

  router.get("/repo", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const result = await withRepoToken(repo.githubToken, async () => {
      const [repoData, languages] = await Promise.all([
        githubService.getRepo(repo.owner, repo.name),
        githubService.getRepoLanguages(repo.owner, repo.name).catch(() => ({}))
      ]);
      return { ...repoData, languages, deploySlug: repo.deploySlug };
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/staging-info", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const branches = await withRepoToken(repo.githubToken, () => githubService.listBranches(repo.owner, repo.name));
    const hasStagingBranch = branches.some((b: any) => b.name === "staging");
    if (hasStagingBranch) {
      return res.json({ hasStagingBranch: true, useTestRepo: false, stagingRepo: null, stagingBranch: "staging" });
    }
    const testRepoName = `${repo.name}-test`;
    try {
      const testRepo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, testRepoName));
      if (testRepo) {
        return res.json({ hasStagingBranch: false, useTestRepo: true, stagingRepo: `${repo.owner}/${testRepoName}`, stagingBranch: testRepo.default_branch || "main" });
      }
    } catch {}
    res.json({ hasStagingBranch: false, useTestRepo: false, stagingRepo: null, stagingBranch: null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/branches", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const branches = await withRepoToken(repo.githubToken, () => githubService.listBranches(repo.owner, repo.name));
    res.json(branches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/branches", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branchName, fromBranch } = req.body;
    const result = await withRepoToken(repo.githubToken, async () => {
      const sourceBranch = await githubService.getBranch(repo.owner, repo.name, fromBranch || "main");
      return githubService.createBranch(repo.owner, repo.name, branchName, sourceBranch.commit.sha);
    });
    await logDevmaxActivity(req, "create_branch", branchName, { fromBranch });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/branches/:branch(*)", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const branchName = req.params.branch;
    await withRepoToken(repo.githubToken, () => githubService.deleteBranch(repo.owner, repo.name, branchName));
    await logDevmaxActivity(req, "delete_branch", branchName);
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/commits", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branch, per_page } = req.query;
    const commits = await withRepoToken(repo.githubToken, () =>
      githubService.listCommits(repo.owner, repo.name, branch as string, parseInt(per_page as string) || 20)
    );
    res.json(commits);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/commits/:sha", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const data = await withRepoToken(repo.githubToken, () =>
      githubService.githubApi(`/repos/${repo.owner}/${repo.name}/commits/${req.params.sha}`)
    );
    res.json(data);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/tree/:branch", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const branch = req.params.branch;
    let targetOwner = repo.owner;
    let targetName = repo.name;
    let targetBranch = branch;

    if (branch === "staging") {
      const branches = await withRepoToken(repo.githubToken, () => githubService.listBranches(repo.owner, repo.name));
      const hasStagingBranch = branches.some((b: any) => b.name === "staging");
      if (!hasStagingBranch) {
        const testRepoName = `${repo.name}-test`;
        try {
          const testRepo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, testRepoName));
          if (testRepo) {
            targetName = testRepoName;
            targetBranch = testRepo.default_branch || "main";
          }
        } catch {}
      }
    }

    const tree = await withRepoToken(repo.githubToken, async () => {
      const branchData = await githubService.getBranch(targetOwner, targetName, targetBranch);
      return githubService.getTree(targetOwner, targetName, branchData.commit.sha);
    });
    res.json(tree);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/contents/*", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const filePath = req.params[0];
    const { ref } = req.query;
    let targetName = repo.name;
    let targetRef = ref as string;

    if (ref === "staging") {
      const branches = await withRepoToken(repo.githubToken, () => githubService.listBranches(repo.owner, repo.name));
      const hasStagingBranch = branches.some((b: any) => b.name === "staging");
      if (!hasStagingBranch) {
        const testRepoName = `${repo.name}-test`;
        try {
          const testRepo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, testRepoName));
          if (testRepo) {
            targetName = testRepoName;
            targetRef = testRepo.default_branch || "main";
          }
        } catch {}
      }
    }

    const content = await withRepoToken(repo.githubToken, () =>
      githubService.getFileContent(repo.owner, targetName, filePath, targetRef)
    );
    res.json(content);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/contents/*", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const filePath = req.params[0];
    const { content, message, branch, sha, isBase64 } = req.body;

    let targetBranch = branch || "main";
    let targetRepoName = repo.name;

    if (branch === "staging") {
      const branches = await withRepoToken(repo.githubToken, () => githubService.listBranches(repo.owner, repo.name));
      const hasStagingBranch = branches.some((b: any) => b.name === "staging");
      if (!hasStagingBranch) {
        const testRepoName = `${repo.name}-test`;
        try {
          const testRepo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, testRepoName));
          if (testRepo) {
            targetRepoName = testRepoName;
            targetBranch = testRepo.default_branch || "main";
          }
        } catch {}
      }
    }

    if (content) {
      const { devopsIntelligenceEngine } = await import("../../services/devopsIntelligenceEngine");
      const decodedContent = isBase64 ? Buffer.from(content, "base64").toString("utf-8") : content;
      let originalContent: string | undefined;
      try {
        const existing = await withRepoToken(repo.githubToken, () =>
          githubService.getFileContent(repo.owner, targetRepoName, filePath, targetBranch)
        );
        if ((existing as any)?.content) {
          originalContent = Buffer.from((existing as any).content, "base64").toString("utf-8");
        }
      } catch {}

      const analysis = devopsIntelligenceEngine.deepCodeAnalysis(
        [{ path: filePath, content: decodedContent, originalContent }],
        targetBranch
      );

      if (analysis.blocked) {
        await logDevmaxActivity(req, "update_file_BLOCKED", filePath, { branch: targetBranch, riskScore: analysis.riskScore, destructiveScore: analysis.destructiveScore });
        return res.status(403).json({
          blocked: true,
          error: "Modification BLOQUÉE par l'analyse de code profonde",
          analysis: {
            summary: analysis.summary,
            riskScore: analysis.riskScore,
            destructiveScore: analysis.destructiveScore,
            warnings: analysis.warnings.slice(0, 10),
            structuralIssues: analysis.structuralIssues,
            recommendations: analysis.recommendations,
          }
        });
      }

      if (analysis.forceBranch && ["main", "master", "production", "prod"].includes(targetBranch)) {
        const safeBranch = `maxai/update-${Date.now()}`;
        await withRepoToken(repo.githubToken, () =>
          githubService.createBranch(repo.owner, repo.name, safeBranch, targetBranch)
        );
        const result = await withRepoToken(repo.githubToken, () =>
          githubService.createOrUpdateFile(repo.owner, repo.name, filePath, content, message || `Update ${filePath}`, safeBranch, sha)
        );
        let pr: any = null;
        try {
          pr = await withRepoToken(repo.githubToken, () =>
            githubService.createPullRequest(repo.owner, repo.name,
              `[MaxAI] ${message || `Update ${filePath}`}`,
              `## Analyse de code\nRisque: ${analysis.riskScore}/100\nDestructif: ${analysis.destructiveScore}\n\n${analysis.warnings.map((w: string) => `- ${w}`).join("\n")}`,
              safeBranch, targetBranch
            )
          );
        } catch {}
        await logDevmaxActivity(req, "update_file_redirected", filePath, { branch: safeBranch, riskScore: analysis.riskScore });
        return res.json({ success: true, redirected: true, branch: safeBranch, pr: pr ? { number: (pr as any).number } : null, analysis: { score: analysis.riskScore, level: analysis.riskLevel } });
      }
    }

    const result = await withRepoToken(repo.githubToken, async () => {
      if (isBase64) {
        return githubService.createOrUpdateFileRaw(repo.owner, targetRepoName, filePath, content, message, targetBranch, sha);
      }
      return githubService.createOrUpdateFile(repo.owner, targetRepoName, filePath, content, message, targetBranch, sha);
    });
    await logDevmaxActivity(req, "update_file", filePath, { branch: targetBranch, repo: targetRepoName });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/contents/*", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const filePath = req.params[0];
    const { message, branch } = req.body;
    const targetBranch = branch || "main";

    let defaultBranch = "main";
    try {
      const repoInfo = await withRepoToken(repo.githubToken, () => githubService.getRepo(repo.owner, repo.name));
      defaultBranch = (repoInfo as any).default_branch || "main";
    } catch {}

    const isOnDefault = targetBranch === defaultBranch || ["main", "master", "production", "prod"].includes(targetBranch);
    if (isOnDefault) {
      const basename = filePath.split("/").pop() || "";
      const { devopsIntelligenceEngine } = await import("../../services/devopsIntelligenceEngine");
      const fragile = devopsIntelligenceEngine.findFragileModule(basename);
      if (fragile && fragile.fragility >= 50) {
        await logDevmaxActivity(req, "delete_file_BLOCKED", filePath, { branch: targetBranch, fragility: fragile.fragility });
        return res.status(403).json({
          blocked: true,
          error: `Suppression BLOQUÉE: ${basename} est un module critique (fragilité ${fragile.fragility}/100)`,
          reason: fragile.reason
        });
      }

      const safeBranch = `maxai/delete-${Date.now()}`;
      await withRepoToken(repo.githubToken, () => githubService.createBranch(repo.owner, repo.name, safeBranch, targetBranch));
      const result = await withRepoToken(repo.githubToken, () =>
        githubService.deleteFile(repo.owner, repo.name, filePath, message || `Delete ${filePath}`, safeBranch)
      );
      let pr: any = null;
      try {
        pr = await withRepoToken(repo.githubToken, () =>
          githubService.createPullRequest(repo.owner, repo.name,
            `[MaxAI] Delete ${filePath}`,
            `Suppression de \`${filePath}\` redirigée vers branche de sécurité.`,
            safeBranch, targetBranch
          )
        );
      } catch {}
      await logDevmaxActivity(req, "delete_file_redirected", filePath, { branch: safeBranch });
      return res.json({ success: true, redirected: true, branch: safeBranch, pr: pr ? { number: (pr as any).number } : null, result });
    }

    const result = await withRepoToken(repo.githubToken, () =>
      githubService.deleteFile(repo.owner, repo.name, filePath, message || `Delete ${filePath}`, targetBranch)
    );
    await logDevmaxActivity(req, "delete_file", filePath, { branch: targetBranch });
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/patch", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branch, files, commitMessage } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files array required" });
    }
    if (!branch || !commitMessage) {
      return res.status(400).json({ error: "branch and commitMessage required" });
    }

    const { devopsIntelligenceEngine } = await import("../../services/devopsIntelligenceEngine");
    const filesWithOriginals = await Promise.all(files.map(async (f: any) => {
      let originalContent: string | undefined;
      try {
        const existing = await withRepoToken(repo.githubToken, () =>
          githubService.getFileContent(repo.owner, repo.name, f.path, branch)
        );
        if ((existing as any)?.content) {
          originalContent = Buffer.from((existing as any).content, "base64").toString("utf-8");
        }
      } catch {}
      return { path: f.path, content: f.content, originalContent };
    }));

    const analysis = devopsIntelligenceEngine.deepCodeAnalysis(filesWithOriginals, branch);

    if (analysis.blocked) {
      await logDevmaxActivity(req, "apply_patch_BLOCKED", branch, { filesCount: files.length, riskScore: analysis.riskScore, destructiveScore: analysis.destructiveScore });
      return res.status(403).json({
        blocked: true,
        error: "Patch BLOQUÉ par l'analyse de code profonde",
        analysis: {
          summary: analysis.summary,
          riskScore: analysis.riskScore,
          destructiveScore: analysis.destructiveScore,
          warnings: analysis.warnings.slice(0, 10),
          structuralIssues: analysis.structuralIssues,
          recommendations: analysis.recommendations,
        }
      });
    }

    if (analysis.forceBranch && ["main", "master", "production", "prod"].includes(branch)) {
      const safeBranch = `maxai/patch-${Date.now()}`;
      await withRepoToken(repo.githubToken, () =>
        githubService.createBranch(repo.owner, repo.name, safeBranch, branch)
      );
      const result = await withRepoToken(repo.githubToken, () =>
        githubService.applyPatch(repo.owner, repo.name, safeBranch, files, commitMessage)
      );
      let pr: any = null;
      try {
        pr = await withRepoToken(repo.githubToken, () =>
          githubService.createPullRequest(repo.owner, repo.name,
            `[MaxAI] ${commitMessage}`,
            `## Analyse de code profonde\nRisque: ${analysis.riskScore}/100 (${analysis.riskLevel})\nDestructif: ${analysis.destructiveScore}\nFichiers: ${files.length}\n\n${analysis.warnings.map((w: string) => `- ${w}`).join("\n")}`,
            safeBranch, branch
          )
        );
      } catch {}
      await logDevmaxActivity(req, "apply_patch_redirected", safeBranch, { filesCount: files.length, riskScore: analysis.riskScore });
      return res.json({
        success: true,
        redirected: true,
        branch: safeBranch,
        pr: pr ? { number: (pr as any).number, url: (pr as any).html_url } : null,
        result,
        analysis: { score: analysis.riskScore, level: analysis.riskLevel, destructiveScore: analysis.destructiveScore }
      });
    }

    const result = await withRepoToken(repo.githubToken, () =>
      githubService.applyPatch(repo.owner, repo.name, branch, files, commitMessage)
    );
    await logDevmaxActivity(req, "apply_patch", branch, { filesCount: files.length, commitMessage, riskScore: analysis.riskScore });
    res.json({ ...result, analysis: { score: analysis.riskScore, level: analysis.riskLevel, destructiveScore: analysis.destructiveScore } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


  export default router;
  