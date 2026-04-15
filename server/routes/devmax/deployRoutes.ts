import { Router, Request, Response } from "express";
  import { db } from "../../db";
  import { sql } from "drizzle-orm";
  import { githubService, withGitHubToken } from "../../services/githubService";
  import { getProjectRepo, withRepoToken } from "./opsHelpers";
  import { logDevmaxActivity, checkPlanLimits, sendDevmaxNotification } from "./devmaxMiddleware";
  
  import { runSourceCodePreflight, runPreDeployTests, runPostDeployTests, checkDeployHealth } from "../../services/devmax/testService";
  import { isTokenValid, resolveProjectGitHubToken } from "../../services/devmax/tokenService";

  const router = Router();

  router.post("/rollback", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const { branch, targetSha, createBackup } = req.body;
    if (!branch || !targetSha) {
      return res.status(400).json({ error: "branch and targetSha are required" });
    }
    const result = await withRepoToken(repo.githubToken, async () => {
      let backupBranch: string | null = null;
      if (createBackup !== false) {
        const branchData = await githubService.getBranch(repo.owner, repo.name, branch);
        const currentSha = branchData.commit.sha;
        backupBranch = `backup/${branch}/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
        await githubService.createBranch(repo.owner, repo.name, backupBranch, currentSha);
      }
      await githubService.forcePushBranch(repo.owner, repo.name, branch, targetSha);
      const commit = await githubService.getCommit(repo.owner, repo.name, targetSha);
      return { backupBranch, commit };
    });
    await logDevmaxActivity(req, "rollback", branch, { targetSha, backupBranch: result.backupBranch });
    res.json({
      success: true,
      rolledBackTo: targetSha,
      branch,
      backupBranch: result.backupBranch,
      commit: {
        sha: result.commit.sha,
        message: result.commit.commit?.message,
        author: result.commit.commit?.author?.name,
        date: result.commit.commit?.author?.date,
      }
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: "Query parameter 'q' required" });
    const result = await withRepoToken(repo.githubToken, () =>
      githubService.searchCode(repo.owner, repo.name, q)
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post("/preflight-check", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const logs: string[] = [];
    const preflight = await runSourceCodePreflight(repo.owner, repo.name, repo.githubToken, logs);
    res.json({ ...preflight, logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/deploy-staging", async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });

    const [proj] = await db.execute(sql`SELECT * FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r).catch(() => [null]);
    if (!proj) return res.status(404).json({ error: "Projet non trouvé" });

    const planCheck = await checkPlanLimits(proj?.tenant_id, "deploy");
    if (!planCheck.allowed) return res.status(403).json({ error: planCheck.reason, plan: planCheck.plan, usage: planCheck.usage, limit: planCheck.limit });

    const { buildCmd, startCmd, envVars, createDb } = req.body;

    const { sshService } = await import("../../services/sshService");
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const deploySlug = proj.deploy_slug || proj.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const appName = deploySlug;
    const stagingAppName = `${appName}-dev`;
    const stagingLogs: string[] = [];

    const dbFiles = await devmaxFileStorage.listFiles(projectId, "test");
    const hasGitHub = proj.repo_owner && proj.repo_name;
    const { branch: reqBranch } = req.body;
    const gitBranch = reqBranch || "main";

    if (dbFiles.length === 0 && !hasGitHub) {
      return res.status(422).json({
        success: false,
        message: "Aucun fichier test trouvé en DB et aucun repo GitHub configuré. Ajoutez des fichiers ou configurez un repo.",
        logs: ["No test files found in devmax_files and no GitHub repo configured"],
      });
    }

    const useGitHub = dbFiles.length === 0 && hasGitHub;
    let fileContents: { path: string; content: string }[] = [];

    if (!useGitHub) {
      for (const f of dbFiles) {
        if (f.type === "file") {
          const file = await devmaxFileStorage.getFile(projectId, "test", f.path);
          if (file) {
            fileContents.push({ path: file.file_path, content: file.content });
          }
        }
      }
      stagingLogs.push(`[0/8] Fichiers Tests chargés: ${fileContents.length} fichiers depuis DB`);
    } else {
      stagingLogs.push(`[0/8] Mode GitHub: déploiement depuis ${proj.repo_owner}/${proj.repo_name} (branche ${gitBranch})`);
    }

    const skipTests = req.body.skipTests === true;
    let preTestResult: TestSuiteResult | null = null;
    if (!skipTests) {
      try {
        preTestResult = await runPreDeployTests(appName, sshService);
        stagingLogs.push(`PRE-DEPLOY TESTS: ${preTestResult.passed}/${preTestResult.total} passed (${preTestResult.duration}ms)`);
        preTestResult.tests.forEach(t => stagingLogs.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
        if (preTestResult.blocking) {
          stagingLogs.push("⛔ Tests bloquants échoués — déploiement annulé");
          return res.status(422).json({
            success: false,
            message: `Déploiement annulé: ${preTestResult.failed} test(s) échoué(s)`,
            preDeployTests: preTestResult,
            logs: stagingLogs,
          });
        }
      } catch (testErr: any) {
        stagingLogs.push(`PRE-DEPLOY TESTS: erreur — ${testErr.message?.slice(0, 100)}`);
      }
    }

    const stagingDomain = `${stagingAppName}.ulyssepro.org`;
    let result: any;

    if (useGitHub) {
      const pat = process.env.MAURICE_GITHUB_PAT || "";
      const repoUrl = `https://${pat ? pat + "@" : ""}github.com/${proj.repo_owner}/${proj.repo_name}.git`;
      result = await sshService.deployApp({
        repoUrl,
        appName: stagingAppName,
        branch: gitBranch,
        buildCmd,
        startCmd,
        envVars,
        createDb,
        domain: stagingDomain,
        caller: "max",
        devmaxProjectId: projectId,
      });
    } else {
      result = await sshService.deployFromDbFiles({
        appName: stagingAppName,
        files: fileContents,
        buildCmd,
        startCmd,
        envVars,
        createDb,
        domain: stagingDomain,
        caller: "max",
        devmaxProjectId: projectId,
      });
    }

    let browserAccessible = false;
    let browserStatus = "unknown";
    const stagingUrl = `https://${stagingDomain}`;
    if (result.success) {
      const health = await checkDeployHealth(stagingUrl, sshService);
      browserAccessible = health.accessible;
      browserStatus = health.status;
    }

    let postTestResult: TestSuiteResult | null = null;
    if (result.success && !skipTests) {
      try {
        postTestResult = await runPostDeployTests(appName, "staging", sshService);
        stagingLogs.push(`POST-DEPLOY TESTS: ${postTestResult.passed}/${postTestResult.total} passed (${postTestResult.duration}ms)`);
        postTestResult.tests.forEach(t => stagingLogs.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
      } catch (testErr: any) {
        stagingLogs.push(`POST-DEPLOY TESTS: erreur — ${testErr.message?.slice(0, 100)}`);
      }
    }

    const productionDomain = `${appName}.ulyssepro.org`;
    const fullLogs = [...stagingLogs, ...(result.logs || [])];
    if (result.success) {
      fullLogs.push(`Browser check: ${browserStatus} (${browserAccessible ? "accessible" : "NOT accessible"})`);
    }

    if (result.success && projectId) {
      const sPort = result.port || null;
      await db.execute(sql`
        UPDATE devmax_projects 
        SET staging_url = ${stagingUrl}, 
            staging_port = ${sPort},
            production_url = ${"https://" + productionDomain},
            environment = 'staging',
            last_deployed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${projectId}
      `);
    }

    if (projectId) {
      const { logDeployment } = await import("../devmaxWebhook");
      await logDeployment(projectId, {
        environment: "staging",
        trigger: "manual",
        commitSha: undefined,
        branch: "test",
        status: result.success ? "success" : "failed",
        url: stagingUrl,
        logs: fullLogs,
        duration: Date.now() - startTime,
      }).catch((e: any) => console.warn("[DevMax] logDeployment staging error:", e.message));
    }

    await logDevmaxActivity(req, "deploy-staging", "test", {
      stagingUrl,
      browserAccessible,
      browserStatus,
      success: result.success,
      method: "db-files",
    });

    sendDevmaxNotification({
      tenantId: proj?.tenant_id,
      projectId,
      type: result.success ? "deploy_success" : "deploy_failed",
      title: result.success ? `Staging déployé: ${appName}` : `Échec déploiement: ${appName}`,
      message: result.success
        ? `Fichiers Tests déployés sur ${stagingUrl}. Status: ${browserStatus}`
        : `Le déploiement a échoué. ${result.message?.substring(0, 200)}`,
      metadata: { stagingUrl, browserStatus },
    }).catch(() => {});

    const testSummary = [];
    if (preTestResult) testSummary.push(`PRE: ${preTestResult.passed}/${preTestResult.total}`);
    if (postTestResult) testSummary.push(`POST: ${postTestResult.passed}/${postTestResult.total}`);
    const testLine = testSummary.length ? `\nTests: ${testSummary.join(" | ")}` : "";

    res.json({
      ...result,
      stagingUrl,
      browserAccessible,
      browserStatus,
      preDeployTests: preTestResult,
      postDeployTests: postTestResult,
      logs: fullLogs,
      method: "db-files",
      message: result.success
        ? `${result.message}\nSource: Fichiers Tests (DB)\nBrowser: ${browserStatus}${testLine}${!browserAccessible ? "\n⚠️ L'URL staging n'est pas encore accessible. Vérifiez DNS/SSL." : ""}`
        : result.message,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/promote-production", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const startTime = Date.now();

    const [proj] = await db.execute(sql`SELECT * FROM devmax_projects WHERE id = ${projectId}`).then((r: any) => r.rows || r).catch(() => [null]);
    if (!proj) return res.status(404).json({ error: "Projet non trouvé" });

    const { sshService } = await import("../../services/sshService");
    const { devmaxFileStorage } = await import("../../services/devmaxFileStorage");
    const deploySlug = proj.deploy_slug || proj.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const appName = deploySlug;
    const skipTests = req.body?.skipTests === true;
    const { buildCmd, startCmd } = req.body || {};
    const promoteLogs: string[] = [];

    const hasGitHub = !!(proj.repo_owner && proj.repo_name);
    promoteLogs.push(`[0] Mode: ${hasGitHub ? "GitHub + Deploy" : "DB Files → Deploy"}`);

    let preTestResult: TestSuiteResult | null = null;
    if (!skipTests) {
      try {
        preTestResult = await runPreDeployTests(appName, sshService);
        promoteLogs.push(`PRE-PROMOTE TESTS: ${preTestResult.passed}/${preTestResult.total} passed (${preTestResult.duration}ms)`);
        preTestResult.tests.forEach(t => promoteLogs.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
        if (preTestResult.blocking) {
          promoteLogs.push("⛔ Tests bloquants échoués — promotion annulée");
          return res.status(422).json({
            success: false,
            message: `Promotion annulée: ${preTestResult.failed} test(s) échoué(s)`,
            preDeployTests: preTestResult,
            logs: promoteLogs,
          });
        }
      } catch (testErr: any) {
        promoteLogs.push(`PRE-PROMOTE TESTS: erreur — ${testErr.message?.slice(0, 100)}`);
      }
    }

    const testFiles = await devmaxFileStorage.listFiles(projectId, "test");
    const fileContents: { path: string; content: string }[] = [];
    for (const f of testFiles) {
      if (f.type === "file") {
        const file = await devmaxFileStorage.getFile(projectId, "test", f.path);
        if (file) fileContents.push({ path: file.file_path, content: file.content });
      }
    }

    const hasDbFiles = fileContents.length > 0;

    if (!hasDbFiles && !hasGitHub) {
      return res.status(422).json({ success: false, message: "Aucun fichier test en DB et aucun repo GitHub configuré.", logs: promoteLogs });
    }

    if (hasDbFiles) {
      await devmaxFileStorage.deleteAll(projectId, "prod");
      for (const f of fileContents) {
        await devmaxFileStorage.saveFile(projectId, "prod", f.path, f.content);
      }
      promoteLogs.push(`[1] Fichiers Prod créés en DB: ${fileContents.length} fichiers copiés depuis Tests`);
    } else {
      promoteLogs.push(`[1] Mode GitHub direct — pas de fichiers test en DB, déploiement depuis repo`);
    }

    if (hasGitHub) {
      const githubToken = await resolveProjectGitHubToken(projectId);
      try {
        let mainBranch = "main";
        try {
          const mainRepo = await withRepoToken(githubToken, () => githubService.getRepo(proj.repo_owner, proj.repo_name));
          mainBranch = (mainRepo as any).default_branch || "main";
        } catch {}

        if (hasDbFiles) {
          let pushed = 0;
          for (const file of fileContents) {
            try {
              let existingSha: string | undefined;
              try {
                const existing = await withRepoToken(githubToken, () =>
                  githubService.getFileContent(proj.repo_owner, proj.repo_name, file.path, mainBranch)
                );
                existingSha = (existing as any).sha;
              } catch {}
              const b64Content = Buffer.from(file.content).toString("base64");
              await withRepoToken(githubToken, () =>
                githubService.createOrUpdateFileRaw(
                  proj.repo_owner, proj.repo_name, file.path, b64Content,
                  `[Prod] ${file.path}`, mainBranch, existingSha
                )
              );
              pushed++;
            } catch {}
          }
          promoteLogs.push(`[2] GitHub push: ${pushed}/${fileContents.length} fichiers → ${proj.repo_owner}/${proj.repo_name}`);
        } else {
          promoteLogs.push(`[2] GitHub: déploiement direct depuis repo (pas de push nécessaire)`);
        }

        const pat = process.env.MAURICE_GITHUB_PAT || "";
        const repoUrl = `https://${pat ? pat + "@" : ""}github.com/${proj.repo_owner}/${proj.repo_name}.git`;
        const result = await sshService.deployApp({
          repoUrl,
          appName,
          branch: mainBranch,
          buildCmd,
          startCmd,
          domain: `${appName}.ulyssepro.org`,
          caller: "max",
          devmaxProjectId: projectId,
        });

        let browserAccessible = false;
        let browserStatus = "unknown";
        const productionUrl = `https://${appName}.ulyssepro.org`;
        if (result.success) {
          const health = await checkDeployHealth(productionUrl, sshService);
          browserAccessible = health.accessible;
          browserStatus = health.status;
        }

        if (result.success && projectId) {
          await db.execute(sql`
            UPDATE devmax_projects SET production_url = ${productionUrl}, deploy_url = ${productionUrl}, environment = 'production', last_promoted_at = NOW(), updated_at = NOW() WHERE id = ${projectId}
          `);
        }

        const allLogs = [...promoteLogs, ...(result.logs || [])];
        if (projectId) {
          const { logDeployment } = await import("../devmaxWebhook");
          await logDeployment(projectId, {
            environment: "production", trigger: "manual", branch: mainBranch,
            status: result.success ? "success" : "failed", url: productionUrl, logs: allLogs, duration: Date.now() - startTime,
          }).catch(() => {});
        }

        await logDevmaxActivity(req, "promote-production", "main", { productionUrl, browserAccessible, browserStatus, success: result.success, method: "github" });

        res.json({ ...result, browserAccessible, browserStatus, preDeployTests: preTestResult, logs: allLogs, method: "github" });
      } catch (ghErr: any) {
        promoteLogs.push(`GitHub push error: ${ghErr.message?.substring(0, 200)}`);
        return res.status(500).json({ success: false, message: `Échec push GitHub: ${ghErr.message}`, logs: promoteLogs });
      }
    } else {
      const prodDomain = `${appName}.ulyssepro.org`;
      const result = await sshService.deployFromDbFiles({
        appName,
        files: fileContents,
        buildCmd,
        startCmd,
        domain: prodDomain,
        caller: "max",
        devmaxProjectId: projectId,
      });

      let browserAccessible = false;
      let browserStatus = "unknown";
      const productionUrl = `https://${prodDomain}`;
      if (result.success) {
        const health = await checkDeployHealth(productionUrl, sshService);
        browserAccessible = health.accessible;
        browserStatus = health.status;
      }

      if (result.success && projectId) {
        await db.execute(sql`
          UPDATE devmax_projects SET production_url = ${productionUrl}, deploy_url = ${productionUrl}, environment = 'production', last_promoted_at = NOW(), updated_at = NOW() WHERE id = ${projectId}
        `);
      }

      const allLogs = [...promoteLogs, ...(result.logs || [])];
      if (projectId) {
        const { logDeployment } = await import("../devmaxWebhook");
        await logDeployment(projectId, {
          environment: "production", trigger: "manual", branch: "main",
          status: result.success ? "success" : "failed", url: productionUrl, logs: allLogs, duration: Date.now() - startTime,
        }).catch(() => {});
      }

      await logDevmaxActivity(req, "promote-production", "main", { productionUrl, browserAccessible, browserStatus, success: result.success, method: "db" });

      res.json({ ...result, browserAccessible, browserStatus, preDeployTests: preTestResult, logs: allLogs, method: "db", productionUrl });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/deployment-snapshots", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../../services/sshService");
    const result = await sshService.listProductionSnapshots(repo.deploySlug);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/rollback-production", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;
    const projectId = req.headers["x-devmax-project"] as string;
    const { snapshotDir } = req.body;
    const startTime = Date.now();

    const { sshService } = await import("../../services/sshService");
    const appName = repo.deploySlug;

    const result = await sshService.rollbackProduction({
      appName,
      snapshotDir,
      caller: "max",
    });

    let browserAccessible = false;
    let browserStatus = "unknown";
    if (result.success && result.productionUrl) {
      const health = await checkDeployHealth(result.productionUrl, sshService);
      browserAccessible = health.accessible;
      browserStatus = health.status;
    }

    if (result.success && projectId) {
      await db.execute(sql`
        UPDATE devmax_projects 
        SET production_url = ${result.productionUrl},
            environment = 'production',
            updated_at = NOW()
        WHERE id = ${projectId}
      `);
    }

    if (projectId) {
      const { logDeployment } = await import("../devmaxWebhook");
      await logDeployment(projectId, {
        environment: "production",
        trigger: "rollback",
        branch: "main",
        status: result.success ? "success" : "failed",
        url: result.productionUrl,
        logs: result.logs,
        duration: Date.now() - startTime,
      });
    }

    await logDevmaxActivity(req, "rollback-production", "main", {
      productionUrl: result.productionUrl,
      restoredFrom: result.restoredFrom,
      browserAccessible,
      browserStatus,
      success: result.success,
    });

    res.json({
      ...result,
      browserAccessible,
      browserStatus,
      message: result.success
        ? `${result.message}\nBrowser: ${browserStatus}${!browserAccessible ? "\n⚠️ L'URL production n'est pas encore accessible depuis le navigateur." : ""}`
        : result.message,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/activity/live", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    const { getActivities, getRunningActivities } = await import("../../services/activityTracker");
    const running = getRunningActivities(projectId || undefined);
    const recent = getActivities(projectId || undefined, 15);

    let dgmSession: any = null;
    let dgmTasks: any[] = [];
    if (projectId) {
      try {
        const project = await db.execute(sql`SELECT repo_owner, repo_name FROM devmax_projects WHERE id = ${projectId}`);
        const row = project?.rows?.[0] as any;
        if (row) {
          const repoCtx = `${row.repo_owner}/${row.repo_name}`;
          const sessions = await db.execute(
            sql`SELECT * FROM dgm_sessions WHERE repo_context = ${repoCtx} AND active = true ORDER BY created_at DESC LIMIT 1`
          );
          if (sessions.rows?.length) {
            dgmSession = sessions.rows[0];
            const tasksResult = await db.execute(
              sql`SELECT * FROM dgm_tasks WHERE session_id = ${(dgmSession as any).id} ORDER BY sort_order`
            );
            dgmTasks = tasksResult.rows as any[];
          }
        }
      } catch (_) {}
    }

    res.json({ running, recent, dgmSession, dgmTasks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/deployment-status", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID required" });

    const session = (req as any).devmaxSession;
    const project = await db.execute(sql`
      SELECT staging_url, staging_port, production_url, production_port, 
             environment, last_deployed_at, last_promoted_at, deploy_url
      FROM devmax_projects 
      WHERE id = ${projectId}
    `);

    if (!project.rows?.length) return res.status(404).json({ error: "Project not found" });
    const p = project.rows[0] as any;

    res.json({
      stagingUrl: p.staging_url,
      stagingPort: p.staging_port,
      productionUrl: p.production_url || p.deploy_url,
      productionPort: p.production_port,
      environment: p.environment || "none",
      lastDeployedAt: p.last_deployed_at,
      lastPromotedAt: p.last_promoted_at,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/verify-repo-access", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../../services/sshService");
    const accessCheck = await sshService.verifyRepoAccess(repo.owner, repo.name);

    res.json({
      owner: repo.owner,
      name: repo.name,
      accessible: accessCheck.accessible,
      private: accessCheck.private,
      error: accessCheck.error,
      tokenAvailable: !!(await sshService.resolveGitHubToken()),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/connected-repos", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const token = repo.githubToken || process.env.MAURICE_GITHUB_PAT || "";
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "MaxAI-DevOps",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const prodName = repo.name;
    const testName = `${repo.name}-test`;

    const checkRepo = async (owner: string, name: string) => {
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
        if (r.ok) {
          const data = await r.json();
          const isEmpty = data.size === 0;
          let commitCount = 0;
          if (!isEmpty) {
            try {
              const cRes = await fetch(`https://api.github.com/repos/${owner}/${name}/commits?per_page=1`, { headers });
              if (cRes.ok) commitCount = 1;
              else if (cRes.status === 409) commitCount = 0;
            } catch {}
          }
          return {
            owner, name, fullName: `${owner}/${name}`,
            exists: true, accessible: true, private: data.private,
            defaultBranch: data.default_branch, language: data.language,
            updatedAt: data.updated_at,
            pushedAt: (isEmpty || commitCount === 0) ? null : data.pushed_at,
            url: data.html_url,
            empty: isEmpty || commitCount === 0,
            size: data.size,
          };
        }
        return { owner, name, fullName: `${owner}/${name}`, exists: r.status !== 404, accessible: false, private: null, error: r.status === 404 ? "Repo inexistant" : `HTTP ${r.status}` };
      } catch (e: any) {
        return { owner, name, fullName: `${owner}/${name}`, exists: false, accessible: false, private: null, error: e.message };
      }
    };

    const [prod, test] = await Promise.all([
      checkRepo(repo.owner, prodName),
      checkRepo(repo.owner, testName),
    ]);

    const projectId = req.headers["x-devmax-project"] as string;
    const projRow = await db.execute(sql`SELECT staging_url, production_url, deploy_slug, staging_port FROM devmax_projects WHERE id = ${projectId}`);
    const proj = projRow.rows?.[0] as any;
    const slug = proj?.deploy_slug || prodName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    res.json({
      production: { ...prod, role: "production", deployUrl: proj?.production_url || `https://${slug}.ulyssepro.org` },
      staging: { ...test, role: "staging", deployUrl: proj?.staging_url || `https://${slug}-dev.ulyssepro.org`, port: proj?.staging_port },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/setup-deploy-key", async (req: Request, res: Response) => {
  try {
    const repo = await getProjectRepo(req, res);
    if (!repo) return;

    const { sshService } = await import("../../services/sshService");
    const result = await sshService.setupVpsDeployKey(repo.owner, repo.name);

    await logDevmaxActivity(req, "setup-deploy-key", "n/a", {
      owner: repo.owner,
      repo: repo.name,
      success: result.success,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


  router.get("/deployments", async (req: Request, res: Response) => {
  try {
    const projectId = req.headers["x-devmax-project"] as string;
    if (!projectId) return res.status(400).json({ error: "Project ID requis" });
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const environment = req.query.environment as string;

    const deployments = environment
      ? await db.execute(sql`SELECT id, environment, trigger, commit_sha, commit_message, branch, status, url, duration_ms, created_at FROM devmax_deployments WHERE project_id = ${projectId} AND environment = ${environment} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r)
      : await db.execute(sql`SELECT id, environment, trigger, commit_sha, commit_message, branch, status, url, duration_ms, created_at FROM devmax_deployments WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT ${limit}`).then((r: any) => r.rows || r);
    res.json({ deployments });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


  export default router;
  