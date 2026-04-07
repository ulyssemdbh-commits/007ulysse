import { db } from "../db";
import { sql, desc, eq, and } from "drizzle-orm";
import {
  ulysseCumulativeInsights,
  ulysseTaskOutcomes,
  ulysseSkillScores,
  ulysseErrorMemory,
  ulysseToolPerformance,
} from "@shared/schema";

type AgentName = "ulysse" | "maxai" | "iris" | "alfred";

interface InsightInput {
  agent?: AgentName;
  category: string;
  subcategory?: string;
  insightType: string;
  title: string;
  content: string;
  correctApproach?: string;
  wrongApproach?: string;
  confidence?: number;
  impactScore?: number;
  sourceContext?: string;
  sourceProject?: string;
  sourceFiles?: string[];
  tags?: string[];
}

interface TaskOutcomeInput {
  agent?: AgentName;
  projectId?: string;
  taskType: string;
  taskDescription: string;
  outcome: "success" | "partial" | "failure" | "retry";
  filesChanged?: string[];
  toolsUsed?: string[];
  toolSequence?: string[];
  errorEncountered?: string;
  errorResolution?: string;
  durationMs?: number;
  retryCount?: number;
  metadata?: Record<string, any>;
}

interface ErrorInput {
  agent?: AgentName;
  errorMessage: string;
  errorContext?: string;
  resolution?: string;
  sourceProject?: string;
  sourceFiles?: string[];
  tags?: string[];
}

interface ToolCallInput {
  agent?: AgentName;
  toolName: string;
  success: boolean;
  durationMs: number;
  error?: string;
  combinedWith?: string[];
}

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36);
}

class CumulativeLearningEngine {
  private initialized = false;

  async ensureTables(): Promise<void> {
    if (this.initialized) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ulysse_cumulative_insights (
          id SERIAL PRIMARY KEY,
          agent TEXT NOT NULL DEFAULT 'ulysse',
          category TEXT NOT NULL,
          subcategory TEXT,
          insight_type TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          correct_approach TEXT,
          wrong_approach TEXT,
          confidence INTEGER NOT NULL DEFAULT 50,
          occurrences INTEGER NOT NULL DEFAULT 1,
          impact_score INTEGER NOT NULL DEFAULT 50,
          source_context TEXT,
          source_project TEXT,
          source_files TEXT[] DEFAULT '{}',
          tags TEXT[] DEFAULT '{}',
          last_seen_at TIMESTAMP DEFAULT NOW(),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ulysse_task_outcomes (
          id SERIAL PRIMARY KEY,
          agent TEXT NOT NULL DEFAULT 'ulysse',
          project_id TEXT,
          task_type TEXT NOT NULL,
          task_description TEXT NOT NULL,
          outcome TEXT NOT NULL,
          files_changed TEXT[] DEFAULT '{}',
          tools_used TEXT[] DEFAULT '{}',
          tool_sequence TEXT[] DEFAULT '{}',
          error_encountered TEXT,
          error_resolution TEXT,
          duration_ms INTEGER,
          retry_count INTEGER NOT NULL DEFAULT 0,
          insights_extracted INTEGER NOT NULL DEFAULT 0,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ulysse_skill_scores (
          id SERIAL PRIMARY KEY,
          agent TEXT NOT NULL DEFAULT 'ulysse',
          skill TEXT NOT NULL,
          domain TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 50,
          total_attempts INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          fail_count INTEGER NOT NULL DEFAULT 0,
          streak_current INTEGER NOT NULL DEFAULT 0,
          streak_best INTEGER NOT NULL DEFAULT 0,
          last_attempt_at TIMESTAMP DEFAULT NOW(),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ulysse_error_memory (
          id SERIAL PRIMARY KEY,
          agent TEXT NOT NULL DEFAULT 'ulysse',
          error_signature TEXT NOT NULL,
          error_message TEXT NOT NULL,
          error_context TEXT,
          resolution TEXT,
          resolution_confidence INTEGER NOT NULL DEFAULT 0,
          hit_count INTEGER NOT NULL DEFAULT 1,
          last_hit_at TIMESTAMP DEFAULT NOW(),
          source_project TEXT,
          source_files TEXT[] DEFAULT '{}',
          tags TEXT[] DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ulysse_tool_performance (
          id SERIAL PRIMARY KEY,
          agent TEXT NOT NULL DEFAULT 'ulysse',
          tool_name TEXT NOT NULL,
          total_calls INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          fail_count INTEGER NOT NULL DEFAULT 0,
          avg_duration_ms INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          best_combinations TEXT[] DEFAULT '{}',
          common_errors JSONB DEFAULT '[]',
          last_used_at TIMESTAMP DEFAULT NOW(),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      this.initialized = true;
      console.log("[CumulativeLearning] Tables prêtes");
    } catch (e: any) {
      console.error(`[CumulativeLearning] Init error: ${e.message}`);
    }
  }

  async recordInsight(input: InsightInput): Promise<number | null> {
    try {
      await this.ensureTables();
      const agent = input.agent || "ulysse";
      const sigHash = hashStr(`${agent}:${input.category}:${input.title}`);

      const existing: any = await db.execute(sql`
        SELECT id, occurrences, confidence FROM ulysse_cumulative_insights
        WHERE agent = ${agent} AND category = ${input.category}
          AND title = ${input.title}
        LIMIT 1
      `).then((r: any) => (r.rows || r)[0]);

      if (existing) {
        const newConf = Math.min(100, (existing.confidence || 50) + 5);
        const newOcc = (existing.occurrences || 1) + 1;
        await db.execute(sql`
          UPDATE ulysse_cumulative_insights
          SET occurrences = ${newOcc}, confidence = ${newConf}, last_seen_at = NOW(),
              content = CASE WHEN length(${input.content}) > length(content) THEN ${input.content} ELSE content END,
              correct_approach = COALESCE(${input.correctApproach || null}, correct_approach),
              wrong_approach = COALESCE(${input.wrongApproach || null}, wrong_approach)
          WHERE id = ${existing.id}
        `);
        return existing.id;
      }

      const [inserted]: any = await db.execute(sql`
        INSERT INTO ulysse_cumulative_insights (agent, category, subcategory, insight_type, title, content, correct_approach, wrong_approach, confidence, impact_score, source_context, source_project, source_files, tags)
        VALUES (${agent}, ${input.category}, ${input.subcategory || null}, ${input.insightType}, ${input.title}, ${input.content}, ${input.correctApproach || null}, ${input.wrongApproach || null}, ${input.confidence || 50}, ${input.impactScore || 50}, ${input.sourceContext || null}, ${input.sourceProject || null}, ${sql.raw(`'{${(input.sourceFiles || []).map(f => `"${f.replace(/"/g, '\\"')}"`).join(',')}}' `)}, ${sql.raw(`'{${(input.tags || []).map(t => `"${t.replace(/"/g, '\\"')}"`).join(',')}}' `)})
        RETURNING id
      `).then((r: any) => r.rows || r);

      console.log(`[CumulativeLearning] Insight enregistré [${agent}/${input.category}]: ${input.title}`);
      return inserted?.id || null;
    } catch (e: any) {
      console.error(`[CumulativeLearning] recordInsight error: ${e.message}`);
      return null;
    }
  }

  async recordTaskOutcome(input: TaskOutcomeInput): Promise<void> {
    try {
      await this.ensureTables();
      const agent = input.agent || "ulysse";

      await db.execute(sql`
        INSERT INTO ulysse_task_outcomes (agent, project_id, task_type, task_description, outcome, files_changed, tools_used, tool_sequence, error_encountered, error_resolution, duration_ms, retry_count, metadata)
        VALUES (${agent}, ${input.projectId || null}, ${input.taskType}, ${input.taskDescription.slice(0, 500)}, ${input.outcome}, ${sql.raw(`'{${(input.filesChanged || []).map(f => `"${f}"`).join(',')}}' `)}, ${sql.raw(`'{${(input.toolsUsed || []).map(t => `"${t}"`).join(',')}}' `)}, ${sql.raw(`'{${(input.toolSequence || []).map(t => `"${t}"`).join(',')}}' `)}, ${input.errorEncountered || null}, ${input.errorResolution || null}, ${input.durationMs || null}, ${input.retryCount || 0}, ${JSON.stringify(input.metadata || {})}::jsonb)
      `);

      const domain = this.classifyDomain(input.taskType, input.toolsUsed || []);
      await this.updateSkillScore(agent, input.taskType, domain, input.outcome === "success" || input.outcome === "partial");

      if (input.outcome === "success" && input.toolSequence && input.toolSequence.length > 1) {
        await this.recordInsight({
          agent,
          category: "tool_strategy",
          insightType: "success_pattern",
          title: `Séquence efficace: ${input.toolSequence.join(" → ")}`,
          content: `Pour "${input.taskType}": ${input.toolSequence.join(" → ")} — durée ${input.durationMs || "?"}ms`,
          confidence: 60,
          impactScore: 40,
          tags: input.toolsUsed,
        });
      }

      if (input.errorEncountered && input.errorResolution) {
        await this.recordError({
          agent,
          errorMessage: input.errorEncountered,
          errorContext: `Tâche: ${input.taskDescription.slice(0, 200)}`,
          resolution: input.errorResolution,
          sourceProject: input.projectId || undefined,
          sourceFiles: input.filesChanged,
          tags: [input.taskType],
        });
        await this.recordInsight({
          agent,
          category: "error_resolution",
          insightType: "failure_lesson",
          title: `Résolu: ${input.errorEncountered.slice(0, 100)}`,
          content: `Erreur: ${input.errorEncountered}\nRésolution: ${input.errorResolution}`,
          correctApproach: input.errorResolution,
          wrongApproach: input.errorEncountered,
          confidence: 70,
          impactScore: 60,
          sourceFiles: input.filesChanged,
        });
      }

      console.log(`[CumulativeLearning] Task outcome [${agent}]: ${input.outcome} — ${input.taskType}`);
    } catch (e: any) {
      console.error(`[CumulativeLearning] recordTaskOutcome error: ${e.message}`);
    }
  }

  async recordError(input: ErrorInput): Promise<void> {
    try {
      await this.ensureTables();
      const agent = input.agent || "ulysse";
      const sig = hashStr(`${agent}:${input.errorMessage.slice(0, 100)}`);

      const existing: any = await db.execute(sql`
        SELECT id, hit_count FROM ulysse_error_memory
        WHERE agent = ${agent} AND error_signature = ${sig}
        LIMIT 1
      `).then((r: any) => (r.rows || r)[0]);

      if (existing) {
        await db.execute(sql`
          UPDATE ulysse_error_memory
          SET hit_count = ${(existing.hit_count || 1) + 1}, last_hit_at = NOW(),
              resolution = COALESCE(${input.resolution || null}, resolution),
              resolution_confidence = CASE WHEN ${input.resolution || null} IS NOT NULL THEN GREATEST(resolution_confidence + 10, 80) ELSE resolution_confidence END
          WHERE id = ${existing.id}
        `);
        return;
      }

      await db.execute(sql`
        INSERT INTO ulysse_error_memory (agent, error_signature, error_message, error_context, resolution, resolution_confidence, source_project, source_files, tags)
        VALUES (${agent}, ${sig}, ${input.errorMessage.slice(0, 500)}, ${input.errorContext || null}, ${input.resolution || null}, ${input.resolution ? 60 : 0}, ${input.sourceProject || null}, ${sql.raw(`'{${(input.sourceFiles || []).map(f => `"${f}"`).join(',')}}' `)}, ${sql.raw(`'{${(input.tags || []).map(t => `"${t}"`).join(',')}}' `)})
      `);
    } catch (e: any) {
      console.error(`[CumulativeLearning] recordError error: ${e.message}`);
    }
  }

  async recordToolCall(input: ToolCallInput): Promise<void> {
    try {
      await this.ensureTables();
      const agent = input.agent || "ulysse";

      const existing: any = await db.execute(sql`
        SELECT id, total_calls, success_count, fail_count, avg_duration_ms, best_combinations, common_errors
        FROM ulysse_tool_performance
        WHERE agent = ${agent} AND tool_name = ${input.toolName}
        LIMIT 1
      `).then((r: any) => (r.rows || r)[0]);

      if (existing) {
        const tc = (existing.total_calls || 0) + 1;
        const sc = (existing.success_count || 0) + (input.success ? 1 : 0);
        const fc = (existing.fail_count || 0) + (input.success ? 0 : 1);
        const avgDur = Math.round(((existing.avg_duration_ms || 0) * (tc - 1) + input.durationMs) / tc);

        let combos = existing.best_combinations || [];
        if (input.success && input.combinedWith && input.combinedWith.length > 0) {
          const comboKey = [input.toolName, ...input.combinedWith].sort().join("+");
          if (!combos.includes(comboKey)) {
            combos = [...combos.slice(-4), comboKey];
          }
        }

        let errors = existing.common_errors || [];
        if (!input.success && input.error) {
          const shortErr = input.error.slice(0, 100);
          const existingErr = errors.find((e: any) => e.msg === shortErr);
          if (existingErr) {
            existingErr.count = (existingErr.count || 1) + 1;
          } else {
            errors = [...errors.slice(-9), { msg: shortErr, count: 1 }];
          }
        }

        await db.execute(sql`
          UPDATE ulysse_tool_performance
          SET total_calls = ${tc}, success_count = ${sc}, fail_count = ${fc},
              avg_duration_ms = ${avgDur}, last_used_at = NOW(),
              last_error = ${!input.success && input.error ? input.error.slice(0, 300) : sql.raw("last_error")},
              best_combinations = ${sql.raw(`'{${combos.map((c: string) => `"${c}"`).join(',')}}' `)},
              common_errors = ${JSON.stringify(errors)}::jsonb
          WHERE id = ${existing.id}
        `);
      } else {
        const combos = input.success && input.combinedWith ? [input.toolName, ...input.combinedWith].sort().join("+") : null;
        const errors = !input.success && input.error ? [{ msg: input.error.slice(0, 100), count: 1 }] : [];
        await db.execute(sql`
          INSERT INTO ulysse_tool_performance (agent, tool_name, total_calls, success_count, fail_count, avg_duration_ms, last_error, best_combinations, common_errors)
          VALUES (${agent}, ${input.toolName}, 1, ${input.success ? 1 : 0}, ${input.success ? 0 : 1}, ${input.durationMs}, ${input.error?.slice(0, 300) || null}, ${sql.raw(combos ? `'{"${combos}"}' ` : "'{}'")}, ${JSON.stringify(errors)}::jsonb)
        `);
      }
    } catch (e: any) {
      console.error(`[CumulativeLearning] recordToolCall error: ${e.message}`);
    }
  }

  private async updateSkillScore(agent: string, skill: string, domain: string, success: boolean): Promise<void> {
    try {
      const existing: any = await db.execute(sql`
        SELECT id, score, total_attempts, success_count, fail_count, streak_current, streak_best
        FROM ulysse_skill_scores
        WHERE agent = ${agent} AND skill = ${skill} AND domain = ${domain}
        LIMIT 1
      `).then((r: any) => (r.rows || r)[0]);

      if (existing) {
        const ta = (existing.total_attempts || 0) + 1;
        const sc = (existing.success_count || 0) + (success ? 1 : 0);
        const fc = (existing.fail_count || 0) + (success ? 0 : 1);
        const streak = success ? (existing.streak_current || 0) + 1 : 0;
        const bestStreak = Math.max(existing.streak_best || 0, streak);
        const rate = ta > 0 ? Math.round((sc / ta) * 100) : 50;
        const momentum = streak > 3 ? Math.min(10, streak - 3) : 0;
        const newScore = Math.min(100, Math.max(10, rate + momentum));

        await db.execute(sql`
          UPDATE ulysse_skill_scores
          SET score = ${newScore}, total_attempts = ${ta}, success_count = ${sc}, fail_count = ${fc},
              streak_current = ${streak}, streak_best = ${bestStreak}, last_attempt_at = NOW()
          WHERE id = ${existing.id}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO ulysse_skill_scores (agent, skill, domain, score, total_attempts, success_count, fail_count, streak_current, streak_best)
          VALUES (${agent}, ${skill}, ${domain}, ${success ? 60 : 40}, 1, ${success ? 1 : 0}, ${success ? 0 : 1}, ${success ? 1 : 0}, ${success ? 1 : 0})
        `);
      }
    } catch (e: any) {
      console.error(`[CumulativeLearning] updateSkillScore error: ${e.message}`);
    }
  }

  async findSimilarError(agent: AgentName, errorMessage: string): Promise<{ resolution: string; confidence: number } | null> {
    try {
      await this.ensureTables();
      const keywords = errorMessage.slice(0, 100).split(/[\s:,]+/).filter(w => w.length > 3).slice(0, 5);
      if (keywords.length === 0) return null;

      const likeClause = keywords.map(k => `error_message ILIKE '%${k.replace(/'/g, "''")}%'`).join(" OR ");
      const results: any = await db.execute(sql.raw(`
        SELECT error_message, resolution, resolution_confidence, hit_count
        FROM ulysse_error_memory
        WHERE agent = '${agent}' AND resolution IS NOT NULL AND resolution_confidence >= 50
          AND (${likeClause})
        ORDER BY resolution_confidence DESC, hit_count DESC
        LIMIT 1
      `)).then((r: any) => r.rows || r);

      if (results.length > 0 && results[0].resolution) {
        return { resolution: results[0].resolution, confidence: results[0].resolution_confidence };
      }
      return null;
    } catch {
      return null;
    }
  }

  async generateLearningContext(agent: AgentName, options?: { maxInsights?: number; maxErrors?: number; includeTools?: boolean; domain?: string }): Promise<string> {
    try {
      await this.ensureTables();
      const maxI = options?.maxInsights || 15;
      const maxE = options?.maxErrors || 8;
      const parts: string[] = [];

      const domainFilter = options?.domain ? sql` AND (category = ${options.domain} OR subcategory = ${options.domain})` : sql``;
      const insights: any = await db.execute(sql`
        SELECT category, insight_type, title, content, correct_approach, wrong_approach, confidence, occurrences, impact_score
        FROM ulysse_cumulative_insights
        WHERE agent = ${agent} AND confidence >= 40
        ${domainFilter}
        ORDER BY (confidence * impact_score * occurrences) DESC
        LIMIT ${maxI}
      `).then((r: any) => r.rows || r);

      if (insights.length > 0) {
        parts.push("### LEÇONS APPRISES (mémoire cumulative)");
        for (const i of insights) {
          let line = `• [${i.category}/${i.insight_type}] ${i.title} (confiance: ${i.confidence}%, vu ${i.occurrences}x)`;
          if (i.correct_approach) line += `\n  ✅ Bonne approche: ${i.correct_approach.slice(0, 150)}`;
          if (i.wrong_approach) line += `\n  ❌ Mauvaise approche: ${i.wrong_approach.slice(0, 150)}`;
          parts.push(line);
        }
      }

      const errors: any = await db.execute(sql`
        SELECT error_message, resolution, resolution_confidence, hit_count
        FROM ulysse_error_memory
        WHERE agent = ${agent} AND resolution IS NOT NULL AND resolution_confidence >= 50
        ORDER BY hit_count DESC, resolution_confidence DESC
        LIMIT ${maxE}
      `).then((r: any) => r.rows || r);

      if (errors.length > 0) {
        parts.push("\n### ERREURS CONNUES ET RÉSOLUTIONS");
        for (const e of errors) {
          parts.push(`• ${e.error_message.slice(0, 100)} → ${e.resolution.slice(0, 150)} (confiance: ${e.resolution_confidence}%, vu ${e.hit_count}x)`);
        }
      }

      if (options?.includeTools !== false) {
        const tools: any = await db.execute(sql`
          SELECT tool_name, total_calls, success_count, fail_count, avg_duration_ms, last_error, best_combinations
          FROM ulysse_tool_performance
          WHERE agent = ${agent} AND total_calls >= 3
          ORDER BY total_calls DESC
          LIMIT 12
        `).then((r: any) => r.rows || r);

        if (tools.length > 0) {
          parts.push("\n### PERFORMANCE DES OUTILS");
          for (const t of tools) {
            const rate = t.total_calls > 0 ? Math.round((t.success_count / t.total_calls) * 100) : 0;
            let line = `• ${t.tool_name}: ${rate}% succès (${t.total_calls} appels, ~${t.avg_duration_ms}ms)`;
            if (t.best_combinations?.length > 0) line += ` — Combos: ${t.best_combinations.slice(0, 3).join(", ")}`;
            if (rate < 70 && t.last_error) line += `\n  ⚠️ Dernière erreur: ${t.last_error.slice(0, 100)}`;
            parts.push(line);
          }
        }
      }

      const skills: any = await db.execute(sql`
        SELECT skill, domain, score, total_attempts, streak_current, streak_best
        FROM ulysse_skill_scores
        WHERE agent = ${agent} AND total_attempts >= 3
        ORDER BY score DESC
        LIMIT 10
      `).then((r: any) => r.rows || r);

      if (skills.length > 0) {
        parts.push("\n### COMPÉTENCES ACQUISES");
        const strong = skills.filter((s: any) => s.score >= 70);
        const weak = skills.filter((s: any) => s.score < 50);
        if (strong.length > 0) {
          parts.push("Forces: " + strong.map((s: any) => `${s.skill} (${s.score}/100, streak ${s.streak_best})`).join(", "));
        }
        if (weak.length > 0) {
          parts.push("À améliorer: " + weak.map((s: any) => `${s.skill} (${s.score}/100, ${s.fail_count} échecs)`).join(", "));
        }
      }

      const recentOutcomes: any = await db.execute(sql`
        SELECT outcome, COUNT(*) as cnt FROM ulysse_task_outcomes
        WHERE agent = ${agent} AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY outcome
      `).then((r: any) => r.rows || r);

      if (recentOutcomes.length > 0) {
        const stats: Record<string, number> = {};
        for (const r of recentOutcomes) stats[r.outcome] = parseInt(r.cnt);
        const total = Object.values(stats).reduce((a, b) => a + b, 0);
        const succRate = total > 0 ? Math.round(((stats.success || 0) + (stats.partial || 0) * 0.5) / total * 100) : 0;
        parts.push(`\n### BILAN 30 JOURS: ${total} tâches, ${succRate}% réussite (${stats.success || 0} succès, ${stats.partial || 0} partiels, ${stats.failure || 0} échecs)`);
      }

      if (parts.length === 0) {
        return "\n## APPRENTISSAGE CUMULATIF\nMode initialisation — commence à enregistrer les patterns dès cette interaction.\n";
      }

      return `\n## 🧠 APPRENTISSAGE CUMULATIF (${agent.toUpperCase()})\n${parts.join("\n")}\n\n📌 Utilise ces leçons. Après cette interaction, les succès/échecs seront automatiquement enregistrés.\n`;
    } catch (e: any) {
      console.error(`[CumulativeLearning] generateLearningContext error: ${e.message}`);
      return "";
    }
  }

  async getStats(agent?: AgentName): Promise<Record<string, any>> {
    try {
      await this.ensureTables();
      const agentFilter = agent ? sql` WHERE agent = ${agent}` : sql``;
      const [insightCount, outcomeCount, skillCount, errorCount, toolCount] = await Promise.all([
        db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ulysse_cumulative_insights${agent ? ` WHERE agent = '${agent}'` : ""}`)).then((r: any) => parseInt((r.rows || r)[0]?.cnt || "0")),
        db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ulysse_task_outcomes${agent ? ` WHERE agent = '${agent}'` : ""}`)).then((r: any) => parseInt((r.rows || r)[0]?.cnt || "0")),
        db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ulysse_skill_scores${agent ? ` WHERE agent = '${agent}'` : ""}`)).then((r: any) => parseInt((r.rows || r)[0]?.cnt || "0")),
        db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ulysse_error_memory${agent ? ` WHERE agent = '${agent}'` : ""}`)).then((r: any) => parseInt((r.rows || r)[0]?.cnt || "0")),
        db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM ulysse_tool_performance${agent ? ` WHERE agent = '${agent}'` : ""}`)).then((r: any) => parseInt((r.rows || r)[0]?.cnt || "0")),
      ]);
      return { insights: insightCount, outcomes: outcomeCount, skills: skillCount, errors: errorCount, tools: toolCount };
    } catch {
      return { insights: 0, outcomes: 0, skills: 0, errors: 0, tools: 0 };
    }
  }

  async decayOldInsights(): Promise<number> {
    try {
      await this.ensureTables();
      const result: any = await db.execute(sql`
        UPDATE ulysse_cumulative_insights
        SET confidence = GREATEST(10, confidence - 5)
        WHERE last_seen_at < NOW() - INTERVAL '60 days' AND confidence > 10
      `);
      const count = result?.rowCount || 0;
      if (count > 0) console.log(`[CumulativeLearning] Decay: ${count} insights vieillis`);
      return count;
    } catch {
      return 0;
    }
  }

  private classifyDomain(taskType: string, tools: string[]): string {
    const lower = (taskType + " " + tools.join(" ")).toLowerCase();
    if (lower.match(/github|git|pr|branch|deploy|devops|server|ssh/)) return "devops";
    if (lower.match(/sugu|restaurant|hubrise|caisse|commande/)) return "business";
    if (lower.match(/email|discord|notification|sms|calendar/)) return "communication";
    if (lower.match(/search|web|research|veille|crawl/)) return "research";
    if (lower.match(/brain|memory|knowledge|learn/)) return "knowledge";
    if (lower.match(/homework|task|planning|schedule/)) return "productivity";
    if (lower.match(/code|file|patch|test|build/)) return "engineering";
    if (lower.match(/design|ui|css|frontend|component/)) return "design";
    return "general";
  }
}

export const cumulativeLearningEngine = new CumulativeLearningEngine();
