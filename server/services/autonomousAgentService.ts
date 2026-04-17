import { executeToolCallV2Internal } from "./ulysseToolsServiceV2";
import { getOpenAI } from "./core/openaiClient";

type TaskStatus = "pending" | "planning" | "executing" | "completed" | "failed";

interface AgentStep {
  id: number;
  tool: string;
  args: Record<string, any>;
  description: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

interface AgentTask {
  id: string;
  goal: string;
  status: TaskStatus;
  steps: AgentStep[];
  createdAt: number;
  completedAt?: number;
  finalSummary?: string;
  userId: number;
}

const activeTasks = new Map<string, AgentTask>();

class AutonomousAgentService {
  private static instance: AutonomousAgentService;
  static getInstance(): AutonomousAgentService {
    if (!this.instance) this.instance = new AutonomousAgentService();
    return this.instance;
  }

  async planAndExecute(goal: string, userId: number = 1, maxSteps: number = 8): Promise<AgentTask> {
    const taskId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const task: AgentTask = { id: taskId, goal, status: "planning", steps: [], createdAt: Date.now(), userId };
    activeTasks.set(taskId, task);

    console.log(`[AutonomousAgent] 🚀 New task: "${goal}" (id: ${taskId})`);

    try {
      const { brainPulse, brainFocus } = await import("./sensory/BrainPulse");
      brainPulse(["prefrontal", "motor", "association"], "autonomousAgent", `planifie: ${goal.slice(0, 60)}`, {
        userId,
        autonomous: true,
        intensity: 3,
      });
      brainFocus("thinking");
    } catch { /* best-effort */ }

    try {
      const plan = await this.createPlan(goal, maxSteps);
      task.steps = plan;
      task.status = "executing";

      console.log(`[AutonomousAgent] 📋 Plan created: ${plan.length} steps`);

      for (let i = 0; i < task.steps.length; i++) {
        const step = task.steps[i];
        step.status = "executing";
        step.startedAt = Date.now();

        console.log(`[AutonomousAgent] ⚙️ Step ${i + 1}/${task.steps.length}: ${step.tool} — ${step.description}`);

        try {
          const result = await Promise.race([
            executeToolCallV2Internal(step.tool, step.args, userId),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Step timeout (30s)")), 30000)),
          ]);

          step.result = result;
          step.status = "completed";
          step.completedAt = Date.now();

          const nextSteps = task.steps.slice(i + 1);
          if (nextSteps.length > 0) {
            await this.adaptRemainingSteps(goal, task.steps.slice(0, i + 1), nextSteps, result);
          }

          console.log(`[AutonomousAgent] ✅ Step ${i + 1} done (${step.completedAt - step.startedAt!}ms)`);
        } catch (err: any) {
          step.error = err.message;
          step.status = "failed";
          step.completedAt = Date.now();
          console.error(`[AutonomousAgent] ❌ Step ${i + 1} failed: ${err.message}`);
        }
      }

      task.finalSummary = await this.generateSummary(task);
      task.status = "completed";
      task.completedAt = Date.now();

      console.log(`[AutonomousAgent] 🏁 Task completed in ${task.completedAt - task.createdAt}ms`);

      return task;
    } catch (error: any) {
      task.status = "failed";
      task.completedAt = Date.now();
      console.error(`[AutonomousAgent] 💀 Task failed: ${error.message}`);
      return task;
    }
  }

  private async createPlan(goal: string, maxSteps: number): Promise<AgentStep[]> {
    const openai = getOpenAI();

    const availableTools = [
      "query_brain", "memory_save", "web_search", "read_url", "email_list_inbox", "email_send",
      "calendar_list_events", "calendar_create_event", "todoist_list_tasks", "todoist_create_task",
      "homework_manage", "notes_manage", "projects_manage", "tasks_manage",
      "conversations_manage", "traces_query", "security_audit", "superchat_manage",
      "location_get_weather", "query_suguval_history", "sugu_full_overview", "compute_business_health",
      "detect_anomalies", "manage_sugu_bank", "manage_sugu_purchases", "manage_sugu_expenses",
      "manage_sugu_employees", "manage_sugu_payroll", "search_sugu_data", "query_sugu_analytics",
      "query_hubrise", "query_daily_summary", "devops_server", "devmax_db", "image_generate",
      "generate_file", "export_analysis", "export_invoice_excel", "generate_invoice_pdf",
      "analyze_file", "analyze_invoice", "query_sports_data", "query_stock_data",
      "generate_morning_briefing", "generate_financial_report", "digital_twin_simulate",
      "digital_twin_snapshot", "vision_live_analyze", "spotify_control", "discord_send_message",
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `Tu es un planificateur d'actions autonome. Tu reçois un objectif et tu dois créer un plan d'exécution étape par étape.

Outils disponibles: ${availableTools.join(", ")}

Règles:
- Maximum ${maxSteps} étapes
- Chaque étape doit utiliser UN outil avec ses arguments
- Les étapes s'exécutent séquentiellement — le résultat de l'étape N peut influencer l'étape N+1
- Sois concret: donne les vrais arguments, pas des placeholders
- Pour les emails, utilise le vrai contenu (pas "TODO")

Réponds en JSON strict:
[
  { "tool": "nom_outil", "args": {...}, "description": "Ce que fait cette étape" },
  ...
]`
        },
        { role: "user", content: `Objectif: ${goal}` }
      ],
      max_tokens: 1500,
      temperature: 0.2
    });

    const content = response.choices[0]?.message?.content || "[]";
    let parsed: any[];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = [{ tool: "query_brain", args: { query: goal }, description: "Recherche d'information pour l'objectif" }];
    }

    return parsed.slice(0, maxSteps).map((step, i) => ({
      id: i + 1,
      tool: step.tool,
      args: step.args || {},
      description: step.description || `Étape ${i + 1}`,
      status: "pending" as TaskStatus,
    }));
  }

  private async adaptRemainingSteps(goal: string, completedSteps: AgentStep[], remainingSteps: AgentStep[], lastResult: string): Promise<void> {
    try {
      const lastResultSummary = lastResult.substring(0, 500);

      const needsAdaptation = remainingSteps.some(s =>
        JSON.stringify(s.args).includes("{{") ||
        JSON.stringify(s.args).includes("PLACEHOLDER") ||
        JSON.stringify(s.args).includes("TODO")
      );

      if (!needsAdaptation) return;

      const openai = getOpenAI();
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `Tu adaptes les étapes restantes d'un plan basé sur le résultat de la dernière action.
Remplace les placeholders par de vraies valeurs basées sur le résultat obtenu.
Réponds en JSON: même format que l'entrée mais avec les args mis à jour.`
          },
          {
            role: "user",
            content: JSON.stringify({
              goal,
              lastStepResult: lastResultSummary,
              remainingSteps: remainingSteps.map(s => ({ tool: s.tool, args: s.args, description: s.description }))
            })
          }
        ],
        max_tokens: 800,
        temperature: 0.1
      });

      const content = response.choices[0]?.message?.content || "";
      const updated = JSON.parse(content.match(/\[[\s\S]*\]/)![0]);
      for (let i = 0; i < Math.min(updated.length, remainingSteps.length); i++) {
        if (updated[i].args) remainingSteps[i].args = updated[i].args;
        if (updated[i].description) remainingSteps[i].description = updated[i].description;
      }
    } catch {
    }
  }

  private async generateSummary(task: AgentTask): Promise<string> {
    const completedSteps = task.steps.filter(s => s.status === "completed");
    const failedSteps = task.steps.filter(s => s.status === "failed");

    const stepResults = completedSteps.map(s => {
      const resultPreview = (s.result || "").substring(0, 200);
      return `✅ ${s.description}: ${resultPreview}`;
    });

    const failedResults = failedSteps.map(s => `❌ ${s.description}: ${s.error}`);

    const totalTime = task.steps.reduce((s, step) => {
      if (step.startedAt && step.completedAt) return s + (step.completedAt - step.startedAt);
      return s;
    }, 0);

    return `🤖 **Mission accomplie** : "${task.goal}"

📊 **Résultat** : ${completedSteps.length}/${task.steps.length} étapes réussies (${Math.round(totalTime / 1000)}s)

${stepResults.join("\n")}
${failedResults.length > 0 ? "\n" + failedResults.join("\n") : ""}`;
  }

  getTask(taskId: string): AgentTask | undefined {
    return activeTasks.get(taskId);
  }

  getActiveTasks(): AgentTask[] {
    return [...activeTasks.values()].filter(t => t.status === "executing" || t.status === "planning");
  }

  getRecentTasks(limit: number = 10): AgentTask[] {
    return [...activeTasks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}

export const autonomousAgentService = AutonomousAgentService.getInstance();
