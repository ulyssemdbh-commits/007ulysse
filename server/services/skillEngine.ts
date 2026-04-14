import { db } from "../db";
import { skills, skillSteps, skillExecutions } from "@shared/schema";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { traceCollector } from "./traceCollector";
import { BrainService } from "./brainService";

export interface SkillExecutionContext {
  userId: number;
  params?: Record<string, any>;
  agent?: string;
}

class SkillEngine {
  async createSkill(data: {
    userId: number;
    name: string;
    slug: string;
    description: string;
    category?: string;
    icon?: string;
    requiredTools?: string[];
    allowedAgents?: string[];
    triggerPatterns?: string[];
    metadata?: any;
    steps: Array<{
      name: string;
      toolName: string;
      parameters?: any;
      outputKey?: string;
      conditionExpr?: string;
      onErrorAction?: string;
    }>;
  }) {
    const [skill] = await db.insert(skills).values({
      userId: data.userId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      category: data.category || "general",
      icon: data.icon || "Zap",
      requiredTools: data.requiredTools || [],
      allowedAgents: data.allowedAgents || [],
      triggerPatterns: data.triggerPatterns || [],
      metadata: data.metadata,
    }).returning();

    if (data.steps.length > 0) {
      await db.insert(skillSteps).values(
        data.steps.map((s, i) => ({
          skillId: skill.id,
          stepOrder: i + 1,
          name: s.name,
          toolName: s.toolName,
          parameters: s.parameters,
          outputKey: s.outputKey,
          conditionExpr: s.conditionExpr,
          onErrorAction: s.onErrorAction || "stop",
        }))
      );
    }

    return skill;
  }

  async updateSkill(id: number, data: Partial<{
    name: string;
    description: string;
    category: string;
    icon: string;
    enabled: boolean;
    requiredTools: string[];
    allowedAgents: string[];
    triggerPatterns: string[];
    metadata: any;
  }>) {
    const [updated] = await db.update(skills)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(skills.id, id))
      .returning();
    return updated;
  }

  async updateSkillSteps(skillId: number, steps: Array<{
    name: string;
    toolName: string;
    parameters?: any;
    outputKey?: string;
    conditionExpr?: string;
    onErrorAction?: string;
  }>) {
    await db.delete(skillSteps).where(eq(skillSteps.skillId, skillId));
    if (steps.length > 0) {
      await db.insert(skillSteps).values(
        steps.map((s, i) => ({
          skillId,
          stepOrder: i + 1,
          name: s.name,
          toolName: s.toolName,
          parameters: s.parameters,
          outputKey: s.outputKey,
          conditionExpr: s.conditionExpr,
          onErrorAction: s.onErrorAction || "stop",
        }))
      );
    }
  }

  async deleteSkill(id: number) {
    await db.delete(skillSteps).where(eq(skillSteps.skillId, id));
    await db.delete(skills).where(eq(skills.id, id));
  }

  async getSkill(id: number) {
    const [skill] = await db.select().from(skills).where(eq(skills.id, id));
    if (!skill) return null;
    const steps = await db.select().from(skillSteps)
      .where(eq(skillSteps.skillId, id))
      .orderBy(skillSteps.stepOrder);
    return { ...skill, steps };
  }

  async getSkillBySlug(slug: string) {
    const [skill] = await db.select().from(skills).where(eq(skills.slug, slug));
    if (!skill) return null;
    const steps = await db.select().from(skillSteps)
      .where(eq(skillSteps.skillId, skill.id))
      .orderBy(skillSteps.stepOrder);
    return { ...skill, steps };
  }

  async listSkills(params?: { userId?: number; category?: string; enabled?: boolean }) {
    const conditions: any[] = [];
    if (params?.userId) conditions.push(eq(skills.userId, params.userId));
    if (params?.category) conditions.push(eq(skills.category, params.category));
    if (params?.enabled !== undefined) conditions.push(eq(skills.enabled, params.enabled));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const result = await db.select().from(skills).where(where).orderBy(desc(skills.executionCount));

    const skillsWithSteps = await Promise.all(
      result.map(async (skill) => {
        const steps = await db.select().from(skillSteps)
          .where(eq(skillSteps.skillId, skill.id))
          .orderBy(skillSteps.stepOrder);
        return { ...skill, steps };
      })
    );

    return skillsWithSteps;
  }

  async getCatalog() {
    const allSkills = await db.select().from(skills)
      .where(eq(skills.enabled, true))
      .orderBy(skills.category, skills.name);

    const categories = new Map<string, typeof allSkills>();
    for (const skill of allSkills) {
      const cat = skill.category || "general";
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(skill);
    }

    return Object.fromEntries(categories);
  }

  async executeSkill(skillId: number, ctx: SkillExecutionContext): Promise<any> {
    const skill = await this.getSkill(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    if (!skill.enabled) throw new Error(`Skill disabled: ${skill.name}`);

    const steps = skill.steps;
    const traceId = traceCollector.startTrace({
      userId: ctx.userId,
      agent: ctx.agent || "system",
      model: "skill-engine",
      query: `Execute skill: ${skill.name}`,
      domain: skill.category,
      source: "skill",
    });

    const [execution] = await db.insert(skillExecutions).values({
      skillId: skill.id,
      userId: ctx.userId,
      traceId,
      status: "running",
      stepsCompleted: 0,
      totalSteps: steps.length,
      input: ctx.params,
    }).returning();

    const stepResults: any[] = [];
    const context: Record<string, any> = { ...ctx.params };
    let lastOutput: any = null;
    const startTime = Date.now();

    try {
      for (const step of steps) {
        const stepStart = Date.now();

        const resolvedParams = this.resolveParameters(step.parameters as any, context);

        traceCollector.addStep(traceId, {
          stepType: "tool_call",
          name: step.toolName,
          input: resolvedParams,
        });

        let result: any;
        try {
          const { executeToolCallV2 } = await import("./ulysseToolsServiceV2");
          result = await executeToolCallV2(step.toolName, resolvedParams, ctx.userId);
        } catch (toolErr: any) {
          result = { error: toolErr.message };
        }

        const stepLatency = Date.now() - stepStart;

        if (step.outputKey) {
          context[step.outputKey] = result;
        }
        lastOutput = result;

        const stepStatus = result?.error ? "error" : "success";
        stepResults.push({
          step: step.name,
          tool: step.toolName,
          status: stepStatus,
          latencyMs: stepLatency,
          output: result,
        });

        traceCollector.addStep(traceId, {
          stepType: "tool_result",
          name: step.toolName,
          output: result,
          latencyMs: stepLatency,
          status: stepStatus,
        });

        await db.update(skillExecutions)
          .set({ stepsCompleted: stepResults.length })
          .where(eq(skillExecutions.id, execution.id));

        if (stepStatus === "error" && step.onErrorAction === "stop") {
          throw new Error(`Step "${step.name}" failed: ${result?.error || "Unknown error"}`);
        }
      }

      const totalLatency = Date.now() - startTime;

      await db.update(skillExecutions).set({
        status: "completed",
        stepsCompleted: steps.length,
        output: lastOutput,
        latencyMs: totalLatency,
        stepResults,
        completedAt: new Date(),
      }).where(eq(skillExecutions.id, execution.id));

      await db.update(skills).set({
        executionCount: sql`${skills.executionCount} + 1`,
        successCount: sql`${skills.successCount} + 1`,
        avgLatencyMs: sql`COALESCE((${skills.avgLatencyMs} * ${skills.executionCount} + ${totalLatency}) / (${skills.executionCount} + 1), ${totalLatency})`,
        updatedAt: new Date(),
      }).where(eq(skills.id, skill.id));

      await traceCollector.endTrace(traceId, {
        response: JSON.stringify(lastOutput)?.slice(0, 5000),
        status: "completed",
        toolsUsed: steps.map(s => s.toolName),
        toolCallCount: steps.length,
      });

      try {
        const brainService = new BrainService();
        const outputSummary = typeof lastOutput === "string" ? lastOutput.slice(0, 500) : JSON.stringify(lastOutput)?.slice(0, 500);
        await brainService.addKnowledge(ctx.userId, {
          title: `[Skill] ${skill.name} — exécution réussie`,
          content: `Skill: ${skill.name} (${skill.slug})\nCatégorie: ${skill.category}\nÉtapes: ${steps.length}\nOutils: ${steps.map(s => s.toolName).join(", ")}\nLatence: ${totalLatency}ms\nRésultat: ${outputSummary}`,
          type: "insight" as any,
          category: (skill.category || "operational") as any,
          importance: 65,
          confidence: 90,
          sourceType: "skill_execution" as any,
        });
        console.log(`[SkillEngine] Execution result saved to Brain for skill ${skill.slug}`);
      } catch (brainErr: any) {
        console.error("[SkillEngine] Brain sync failed:", brainErr.message);
      }

      return { executionId: execution.id, traceId, status: "completed", steps: stepResults, output: lastOutput };

    } catch (err: any) {
      const totalLatency = Date.now() - startTime;

      await db.update(skillExecutions).set({
        status: "failed",
        latencyMs: totalLatency,
        errorMessage: err.message,
        stepResults,
        completedAt: new Date(),
      }).where(eq(skillExecutions.id, execution.id));

      await db.update(skills).set({
        executionCount: sql`${skills.executionCount} + 1`,
        updatedAt: new Date(),
      }).where(eq(skills.id, skill.id));

      await traceCollector.endTrace(traceId, {
        status: "failed",
        errorMessage: err.message,
        toolsUsed: steps.map(s => s.toolName),
        toolCallCount: stepResults.length,
      });

      return { executionId: execution.id, traceId, status: "failed", error: err.message, steps: stepResults };
    }
  }

  async getExecutions(params?: { skillId?: number; userId?: number; limit?: number }) {
    const conditions: any[] = [];
    if (params?.skillId) conditions.push(eq(skillExecutions.skillId, params.skillId));
    if (params?.userId) conditions.push(eq(skillExecutions.userId, params.userId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    return db.select().from(skillExecutions)
      .where(where)
      .orderBy(desc(skillExecutions.startedAt))
      .limit(params?.limit || 50);
  }

  private resolveParameters(params: Record<string, any> | null, context: Record<string, any>): Record<string, any> {
    if (!params) return {};
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
        const ref = value.slice(1, -1);
        resolved[key] = context[ref] ?? value;
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  async seedDefaultSkills(userId: number) {
    const existing = await db.select({ slug: skills.slug }).from(skills).where(eq(skills.userId, userId));
    const existingSlugs = new Set(existing.map(s => s.slug));

    const defaults = [
      {
        name: "Bilan Mensuel Resto",
        slug: "bilan-mensuel-resto",
        description: "Génère un bilan mensuel complet pour un restaurant : relevé bancaire, achats, santé financière",
        category: "business",
        icon: "BarChart3",
        requiredTools: ["search_sugu_data", "manage_sugu_bank", "compute_business_health"],
        allowedAgents: ["alfred", "ulysse"],
        triggerPatterns: ["bilan mensuel", "bilan du mois", "santé financière"],
        steps: [
          { name: "Récupérer données bancaires", toolName: "manage_sugu_bank", parameters: { action: "list_statements" }, outputKey: "bankData" },
          { name: "Récupérer achats", toolName: "search_sugu_data", parameters: { action: "search", type: "purchases" }, outputKey: "purchases" },
          { name: "Calculer santé financière", toolName: "compute_business_health", parameters: { bankData: "{bankData}", purchases: "{purchases}" }, outputKey: "healthScore" },
        ],
      },
      {
        name: "Morning Briefing",
        slug: "morning-briefing",
        description: "Briefing matinal : emails importants, calendrier du jour, pronos sports, météo",
        category: "daily",
        icon: "Sun",
        requiredTools: ["email_search", "calendar_list_events", "web_search"],
        allowedAgents: ["ulysse"],
        triggerPatterns: ["briefing du matin", "morning briefing", "résumé matinal"],
        steps: [
          { name: "Emails importants", toolName: "email_search", parameters: { query: "is:unread is:important", max_results: 5 }, outputKey: "emails" },
          { name: "Calendrier du jour", toolName: "calendar_list_events", parameters: { timeframe: "today" }, outputKey: "events" },
          { name: "Actualités clés", toolName: "web_search", parameters: { query: "actualités France restauration aujourd'hui" }, outputKey: "news" },
        ],
      },
      {
        name: "Deploy Ulysse",
        slug: "deploy-ulysse",
        description: "Déploie Ulysse : build, upload vers Hetzner, restart PM2, push GitHub",
        category: "devops",
        icon: "Rocket",
        requiredTools: ["devops_server"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["deploy ulysse", "déploie ulysse", "mise en prod"],
        steps: [
          { name: "Build production", toolName: "devops_server", parameters: { action: "exec", command: "npm run build" }, outputKey: "buildResult" },
          { name: "Upload vers Hetzner", toolName: "devops_server", parameters: { action: "deploy", target: "hetzner" }, outputKey: "uploadResult" },
          { name: "Push GitHub", toolName: "devops_github", parameters: { action: "smart_push" }, outputKey: "pushResult" },
        ],
      },
      {
        name: "Audit Sécurité",
        slug: "audit-securite",
        description: "Vérifie la sécurité du système : statut serveur, logs d'erreurs, santé des services",
        category: "devops",
        icon: "Shield",
        requiredTools: ["devops_server"],
        allowedAgents: ["maxai", "ulysse"],
        triggerPatterns: ["audit sécurité", "check sécurité", "état du système"],
        steps: [
          { name: "Statut serveur", toolName: "devops_server", parameters: { action: "status" }, outputKey: "serverStatus" },
          { name: "Logs d'erreurs", toolName: "devops_server", parameters: { action: "logs", filter: "error", lines: 50 }, outputKey: "errorLogs" },
        ],
      },
      {
        name: "Analyse Concurrent",
        slug: "analyse-concurrent",
        description: "Analyse un restaurant concurrent : avis Google, prix, positionnement",
        category: "business",
        icon: "Search",
        requiredTools: ["web_search"],
        allowedAgents: ["alfred", "ulysse", "iris"],
        triggerPatterns: ["analyse concurrent", "étude concurrence", "veille concurrentielle"],
        steps: [
          { name: "Recherche avis", toolName: "web_search", parameters: { query: "avis restaurant {restaurant_name}" }, outputKey: "reviews" },
          { name: "Recherche prix", toolName: "web_search", parameters: { query: "menu prix {restaurant_name}" }, outputKey: "pricing" },
        ],
      },
      {
        name: "Project Health Check",
        slug: "devmax-project-health",
        description: "Audit complet de santé d'un projet : statut serveur, URLs actives, logs d'erreurs, métriques PM2, espace disque. Première skill à lancer sur tout projet existant.",
        category: "devops",
        icon: "HeartPulse",
        requiredTools: ["devops_server", "devops_github"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["health check", "état du projet", "project health", "audit projet", "check santé"],
        steps: [
          { name: "Statut serveur PM2", toolName: "devops_server", parameters: { action: "status" }, outputKey: "serverStatus" },
          { name: "Logs d'erreurs récents", toolName: "devops_server", parameters: { action: "logs", filter: "error", lines: 100 }, outputKey: "errorLogs" },
          { name: "Espace disque & mémoire", toolName: "devops_server", parameters: { action: "exec", command: "df -h / && free -m" }, outputKey: "diskMemory" },
          { name: "URLs health check", toolName: "devops_server", parameters: { action: "exec", command: "curl -s -o /dev/null -w '%{http_code}' https://{project_domain}" }, outputKey: "urlCheck" },
          { name: "Derniers commits", toolName: "devops_github", parameters: { action: "list_commits", owner: "{owner}", repo: "{repo}", count: 5 }, outputKey: "recentCommits" },
          { name: "PRs ouvertes", toolName: "devops_github", parameters: { action: "list_pulls", owner: "{owner}", repo: "{repo}", state: "open" }, outputKey: "openPRs" },
        ],
      },
      {
        name: "Full Code Review",
        slug: "devmax-code-review",
        description: "Revue de code complète : analyse d'impact, risque CI, fragilité, recommandations de patch, et rapport DGM. À lancer avant chaque merge de PR importante.",
        category: "devops",
        icon: "Eye",
        requiredTools: ["devops_github"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["code review", "revue de code", "review PR", "analyser le code", "full review"],
        steps: [
          { name: "Analyser impact des changements", toolName: "devops_github", parameters: { action: "analyze_impact", owner: "{owner}", repo: "{repo}", branch: "{branch}" }, outputKey: "impactAnalysis" },
          { name: "Évaluer risque CI", toolName: "devops_github", parameters: { action: "ci_risk", owner: "{owner}", repo: "{repo}", branch: "{branch}" }, outputKey: "ciRisk" },
          { name: "Vérifier fragilité du code", toolName: "devops_github", parameters: { action: "fragility_check", owner: "{owner}", repo: "{repo}" }, outputKey: "fragilityReport" },
          { name: "Conseils de patch", toolName: "devops_github", parameters: { action: "patch_advice", owner: "{owner}", repo: "{repo}", branch: "{branch}" }, outputKey: "patchAdvice" },
          { name: "Rapport DGM complet", toolName: "devops_github", parameters: { action: "full_report", owner: "{owner}", repo: "{repo}" }, outputKey: "dgmReport" },
        ],
      },
      {
        name: "New Project Bootstrap",
        slug: "devmax-bootstrap-project",
        description: "Initialise un nouveau projet de A à Z : création repo GitHub, setup Nginx, SSL, DNS, PM2, premier deploy. Le setup complet en une seule commande.",
        category: "devops",
        icon: "Rocket",
        requiredTools: ["devops_server", "devops_github"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["nouveau projet", "bootstrap projet", "new project", "créer projet", "init project"],
        steps: [
          { name: "Créer repo GitHub", toolName: "devops_github", parameters: { action: "create_repo", name: "{project_name}", description: "{project_description}", private: true }, outputKey: "repoCreated" },
          { name: "Cloner sur serveur", toolName: "devops_server", parameters: { action: "exec", command: "cd /var/www && git clone git@github.com:{owner}/{project_name}.git" }, outputKey: "cloneResult" },
          { name: "Installer dépendances", toolName: "devops_server", parameters: { action: "exec", command: "cd /var/www/{project_name} && npm install" }, outputKey: "npmInstall" },
          { name: "Configurer Nginx", toolName: "devops_server", parameters: { action: "exec", command: "sudo cp /etc/nginx/sites-available/template.conf /etc/nginx/sites-available/{project_name}.conf && sudo sed -i 's/DOMAIN/{project_domain}/g' /etc/nginx/sites-available/{project_name}.conf && sudo ln -sf /etc/nginx/sites-available/{project_name}.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx" }, outputKey: "nginxSetup" },
          { name: "Générer certificat SSL", toolName: "devops_server", parameters: { action: "exec", command: "sudo certbot --nginx -d {project_domain} -d {project_domain_dev} --non-interactive --agree-tos" }, outputKey: "sslSetup" },
          { name: "Configurer PM2", toolName: "devops_server", parameters: { action: "exec", command: "cd /var/www/{project_name} && pm2 start ecosystem.config.js --env production && pm2 save" }, outputKey: "pm2Setup" },
        ],
      },
      {
        name: "Incident Response",
        slug: "devmax-incident-response",
        description: "Réponse automatique aux incidents : diagnostic, analyse des logs, identification de la cause, rollback si nécessaire, notification Discord. Pour les urgences production.",
        category: "devops",
        icon: "AlertTriangle",
        requiredTools: ["devops_server", "devops_github"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["incident", "site down", "production cassée", "urgence", "crash", "502", "500 error", "le site ne marche plus"],
        steps: [
          { name: "Diagnostic serveur immédiat", toolName: "devops_server", parameters: { action: "status" }, outputKey: "serverDiag" },
          { name: "Analyser logs d'erreur (200 dernières lignes)", toolName: "devops_server", parameters: { action: "logs", filter: "error", lines: 200 }, outputKey: "errorLogs" },
          { name: "Vérifier processus PM2", toolName: "devops_server", parameters: { action: "exec", command: "pm2 jlist" }, outputKey: "pm2Status" },
          { name: "Vérifier charge système", toolName: "devops_server", parameters: { action: "exec", command: "uptime && free -m && df -h /" }, outputKey: "systemLoad" },
          { name: "Identifier dernier déploiement", toolName: "devops_github", parameters: { action: "list_commits", owner: "{owner}", repo: "{repo}", count: 3 }, outputKey: "lastDeploys" },
          { name: "Tenter restart PM2", toolName: "devops_server", parameters: { action: "exec", command: "pm2 restart {pm2_app_name}" }, outputKey: "restartResult", onErrorAction: "continue" },
        ],
      },
      {
        name: "CI/CD Pipeline Audit",
        slug: "devmax-cicd-audit",
        description: "Audit complet du pipeline CI/CD : derniers workflows GitHub Actions, taux de succès, temps de build moyen, branches actives, PRs en attente. Vision 360° de la vélocité dev.",
        category: "devops",
        icon: "GitBranch",
        requiredTools: ["devops_github"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["audit ci/cd", "pipeline status", "état du ci", "github actions", "workflows status", "vélocité dev"],
        steps: [
          { name: "Derniers workflow runs", toolName: "devops_github", parameters: { action: "list_runs", owner: "{owner}", repo: "{repo}", count: 10 }, outputKey: "workflowRuns" },
          { name: "Branches actives", toolName: "devops_github", parameters: { action: "list_branches", owner: "{owner}", repo: "{repo}" }, outputKey: "branches" },
          { name: "PRs ouvertes", toolName: "devops_github", parameters: { action: "list_pulls", owner: "{owner}", repo: "{repo}", state: "open" }, outputKey: "openPRs" },
          { name: "Derniers commits sur main", toolName: "devops_github", parameters: { action: "list_commits", owner: "{owner}", repo: "{repo}", count: 15 }, outputKey: "mainCommits" },
          { name: "Analyse risque CI", toolName: "devops_github", parameters: { action: "ci_risk", owner: "{owner}", repo: "{repo}" }, outputKey: "ciRiskAnalysis" },
        ],
      },
      {
        name: "Smart Deploy & Verify",
        slug: "devmax-smart-deploy",
        description: "Déploiement intelligent avec vérification : build, tests, deploy sur staging, health check, puis promotion production. Rollback automatique si échec. Le deploy production sécurisé.",
        category: "devops",
        icon: "Shield",
        requiredTools: ["devops_server", "devops_github"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["smart deploy", "deploy sécurisé", "déployer en prod", "deploy et vérifie", "mise en production"],
        steps: [
          { name: "Pull derniers changements", toolName: "devops_server", parameters: { action: "exec", command: "cd /var/www/{project_name} && git pull origin main" }, outputKey: "gitPull" },
          { name: "Installer dépendances", toolName: "devops_server", parameters: { action: "exec", command: "cd /var/www/{project_name} && npm ci --production=false" }, outputKey: "npmInstall" },
          { name: "Build production", toolName: "devops_server", parameters: { action: "exec", command: "cd /var/www/{project_name} && npm run build" }, outputKey: "buildResult" },
          { name: "Restart process PM2", toolName: "devops_server", parameters: { action: "exec", command: "pm2 restart {pm2_app_name}" }, outputKey: "pm2Restart" },
          { name: "Attendre 5s et vérifier santé", toolName: "devops_server", parameters: { action: "exec", command: "sleep 5 && curl -s -o /dev/null -w '%{http_code}' https://{project_domain}" }, outputKey: "healthAfterDeploy" },
          { name: "Pousser tag de release", toolName: "devops_github", parameters: { action: "smart_push" }, outputKey: "pushResult" },
        ],
      },
      {
        name: "Weekly Digest",
        slug: "weekly-digest",
        description: "Résumé hebdomadaire : conversations clés de la semaine, tâches accomplies, pronostics résultats, agenda de la semaine prochaine",
        category: "daily",
        icon: "CalendarDays",
        requiredTools: ["calendar_list_events", "web_search"],
        allowedAgents: ["ulysse"],
        triggerPatterns: ["résumé hebdo", "weekly digest", "bilan de la semaine", "résumé de la semaine"],
        steps: [
          { name: "Agenda semaine écoulée", toolName: "calendar_list_events", parameters: { timeframe: "last_week" }, outputKey: "lastWeekEvents" },
          { name: "Agenda semaine prochaine", toolName: "calendar_list_events", parameters: { timeframe: "next_week" }, outputKey: "nextWeekEvents" },
          { name: "Actualités clés", toolName: "web_search", parameters: { query: "actualités France semaine résumé" }, outputKey: "weeklyNews" },
        ],
      },
      {
        name: "Social Media Pulse",
        slug: "social-media-pulse",
        description: "Analyse rapide des tendances réseaux sociaux : hashtags trending, best posts concurrents, idées de contenu pour la semaine",
        category: "business",
        icon: "TrendingUp",
        requiredTools: ["web_search"],
        allowedAgents: ["iris", "ulysse"],
        triggerPatterns: ["tendances réseaux", "social media pulse", "veille social media", "idées de contenu"],
        steps: [
          { name: "Tendances Twitter/X", toolName: "web_search", parameters: { query: "trending hashtags restauration France aujourd'hui" }, outputKey: "trendingHashtags" },
          { name: "Best practices CM resto", toolName: "web_search", parameters: { query: "meilleurs posts restaurants Instagram 2024 tips" }, outputKey: "bestPractices" },
          { name: "Idées contenu saisonnier", toolName: "web_search", parameters: { query: "idées contenu restaurant {month} saison" }, outputKey: "contentIdeas" },
        ],
      },
      {
        name: "Evening Wrap-up",
        slug: "evening-wrapup",
        description: "Synthèse de fin de journée : emails non lus restants, tâches en attente, rappels pour demain, résumé météo",
        category: "daily",
        icon: "Moon",
        requiredTools: ["email_search", "calendar_list_events", "web_search"],
        allowedAgents: ["ulysse"],
        triggerPatterns: ["résumé du soir", "evening wrapup", "bilan du jour", "fin de journée"],
        steps: [
          { name: "Emails non lus", toolName: "email_search", parameters: { query: "is:unread", max_results: 10 }, outputKey: "unreadEmails" },
          { name: "Événements demain", toolName: "calendar_list_events", parameters: { timeframe: "tomorrow" }, outputKey: "tomorrowEvents" },
          { name: "Météo demain", toolName: "web_search", parameters: { query: "météo demain {city}" }, outputKey: "tomorrowWeather" },
        ],
      },
      {
        name: "Fournisseurs Check",
        slug: "fournisseurs-check",
        description: "Vérification des fournisseurs : prix comparés, disponibilité, nouveaux produits de saison. Pour optimiser les achats restaurant.",
        category: "business",
        icon: "ShoppingCart",
        requiredTools: ["web_search", "search_sugu_data"],
        allowedAgents: ["alfred", "ulysse"],
        triggerPatterns: ["check fournisseurs", "prix fournisseurs", "comparer fournisseurs", "achats optimisés"],
        steps: [
          { name: "Derniers achats", toolName: "search_sugu_data", parameters: { action: "search", type: "purchases", period: "last_month" }, outputKey: "recentPurchases" },
          { name: "Prix marché", toolName: "web_search", parameters: { query: "prix gros alimentaire France restauration {month}" }, outputKey: "marketPrices" },
          { name: "Produits de saison", toolName: "web_search", parameters: { query: "produits de saison {month} France restaurant" }, outputKey: "seasonalProducts" },
        ],
      },
      {
        name: "Backup & Cleanup",
        slug: "devmax-backup-cleanup",
        description: "Maintenance serveur : vérification backups, nettoyage logs anciens, espace disque, rotation PM2 logs. Maintenance préventive automatisée.",
        category: "devops",
        icon: "HardDrive",
        requiredTools: ["devops_server"],
        allowedAgents: ["maxai"],
        triggerPatterns: ["backup", "cleanup", "maintenance serveur", "nettoyage", "espace disque"],
        steps: [
          { name: "Espace disque actuel", toolName: "devops_server", parameters: { action: "exec", command: "df -h / && du -sh /var/www/*/node_modules 2>/dev/null | sort -hr | head -5" }, outputKey: "diskUsage" },
          { name: "Rotation logs PM2", toolName: "devops_server", parameters: { action: "exec", command: "pm2 flush && echo 'PM2 logs flushed'" }, outputKey: "logRotation" },
          { name: "Nettoyage vieux fichiers tmp", toolName: "devops_server", parameters: { action: "exec", command: "find /tmp -type f -mtime +7 -delete 2>/dev/null; echo 'Old tmp files cleaned'" }, outputKey: "tmpCleanup" },
          { name: "Vérifier uptime services", toolName: "devops_server", parameters: { action: "exec", command: "pm2 jlist | python3 -c \"import sys,json; d=json.load(sys.stdin); [print(f'{p[\\\"name\\\"]}: {p[\\\"pm2_env\\\"][\\\"status\\\"]} (uptime: {round(p[\\\"pm2_env\\\"][\\\"pm_uptime\\\"]/3600000)}h)') for p in d]\" 2>/dev/null || pm2 status" }, outputKey: "serviceUptime" },
        ],
      },
      {
        name: "Match Day Briefing",
        slug: "match-day-briefing",
        description: "Briefing jour de match : matchs du jour Big 5, cotes, blessés clés, forme récente des équipes. Pour préparer les pronostics.",
        category: "daily",
        icon: "Trophy",
        requiredTools: ["web_search"],
        allowedAgents: ["ulysse"],
        triggerPatterns: ["matchs du jour", "briefing match", "pronostics aujourd'hui", "foot du jour"],
        steps: [
          { name: "Matchs du jour", toolName: "web_search", parameters: { query: "matchs football aujourd'hui Ligue 1 Premier League Liga Serie A Bundesliga" }, outputKey: "todayMatches" },
          { name: "Blessures et suspensions", toolName: "web_search", parameters: { query: "blessures suspensions football aujourd'hui" }, outputKey: "injuries" },
          { name: "Cotes et pronostics", toolName: "web_search", parameters: { query: "cotes pronostics football aujourd'hui experts" }, outputKey: "odds" },
        ],
      },
    ];

    for (const def of defaults) {
      if (existingSlugs.has(def.slug)) continue;
      await this.createSkill({ userId, ...def });
    }
  }
}

export const skillEngine = new SkillEngine();
