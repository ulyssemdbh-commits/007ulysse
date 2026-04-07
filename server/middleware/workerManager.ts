import { redisSet, redisGet, redisIncr } from "../services/redisService";

export type WorkerType = "sports-sync" | "bank-import" | "doc-analysis" | "ai-heavy" | "email-batch" | "deployment";

interface WorkerConfig {
  type: WorkerType;
  label: string;
  maxConcurrency: number;
  maxMemoryMB: number;
  priority: number;
  domain: string;
}

interface WorkerTask {
  id: string;
  type: WorkerType;
  description: string;
  startedAt: number;
  status: "running" | "completed" | "failed";
  durationMs?: number;
  error?: string;
}

interface WorkerStats {
  type: WorkerType;
  label: string;
  domain: string;
  active: number;
  maxConcurrency: number;
  totalProcessed: number;
  totalFailed: number;
  avgDurationMs: number;
  lastActivity: number;
  queueDepth: number;
}

const WORKER_CONFIGS: WorkerConfig[] = [
  { type: "sports-sync", label: "Sports Sync", maxConcurrency: 2, maxMemoryMB: 128, priority: 3, domain: "ulysse" },
  { type: "bank-import", label: "Bank Import", maxConcurrency: 2, maxMemoryMB: 256, priority: 2, domain: "sugu" },
  { type: "doc-analysis", label: "Doc Analysis", maxConcurrency: 3, maxMemoryMB: 512, priority: 2, domain: "ulysse" },
  { type: "ai-heavy", label: "AI Heavy", maxConcurrency: 4, maxMemoryMB: 1024, priority: 1, domain: "ulysse" },
  { type: "email-batch", label: "Email Batch", maxConcurrency: 3, maxMemoryMB: 64, priority: 4, domain: "ulysse" },
  { type: "deployment", label: "Deployment", maxConcurrency: 2, maxMemoryMB: 256, priority: 1, domain: "devmax" },
];

class WorkerManager {
  private activeTasks: Map<string, WorkerTask> = new Map();
  private queues: Map<WorkerType, Array<{ id: string; description: string; execute: () => Promise<void>; resolve: (v: any) => void; reject: (e: any) => void }>> = new Map();
  private stats: Map<WorkerType, { totalProcessed: number; totalFailed: number; durations: number[]; lastActivity: number }> = new Map();
  private configs: Map<WorkerType, WorkerConfig> = new Map();

  constructor() {
    for (const cfg of WORKER_CONFIGS) {
      this.configs.set(cfg.type, cfg);
      this.queues.set(cfg.type, []);
      this.stats.set(cfg.type, { totalProcessed: 0, totalFailed: 0, durations: [], lastActivity: 0 });
    }
  }

  async submitTask<T>(type: WorkerType, description: string, fn: () => Promise<T>): Promise<T> {
    const config = this.configs.get(type);
    if (!config) throw new Error(`Unknown worker type: ${type}`);

    const activeForType = this.getActiveCountForType(type);
    const taskId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (activeForType < config.maxConcurrency) {
      return this.executeTask(taskId, type, description, fn);
    }

    return new Promise<T>((resolve, reject) => {
      const queue = this.queues.get(type)!;
      queue.push({
        id: taskId,
        description,
        execute: async () => {
          try {
            const result = await this.executeTask(taskId, type, description, fn);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        },
        resolve,
        reject,
      });
      this.syncQueueDepthToRedis(type);
    });
  }

  private async executeTask<T>(taskId: string, type: WorkerType, description: string, fn: () => Promise<T>): Promise<T> {
    const task: WorkerTask = { id: taskId, type, description, startedAt: Date.now(), status: "running" };
    this.activeTasks.set(taskId, task);

    await redisSet(`worker:task:${taskId}`, { type, description, startedAt: task.startedAt }, 3600);
    await redisIncr(`worker:${type}:submitted`, 86400);

    try {
      const result = await fn();
      const duration = Date.now() - task.startedAt;
      task.status = "completed";
      task.durationMs = duration;

      const s = this.stats.get(type)!;
      s.totalProcessed++;
      s.durations.push(duration);
      if (s.durations.length > 100) s.durations.shift();
      s.lastActivity = Date.now();

      await redisIncr(`worker:${type}:completed`, 86400);

      return result;
    } catch (error: any) {
      task.status = "failed";
      task.error = error.message;
      task.durationMs = Date.now() - task.startedAt;

      const s = this.stats.get(type)!;
      s.totalFailed++;
      s.lastActivity = Date.now();

      await redisIncr(`worker:${type}:failed`, 86400);
      throw error;
    } finally {
      this.activeTasks.delete(taskId);
      this.processQueue(type);
    }
  }

  private async processQueue(type: WorkerType): Promise<void> {
    const queue = this.queues.get(type)!;
    if (queue.length === 0) return;

    const config = this.configs.get(type)!;
    const activeCount = this.getActiveCountForType(type);

    if (activeCount < config.maxConcurrency) {
      const next = queue.shift()!;
      this.syncQueueDepthToRedis(type);
      next.execute();
    }
  }

  private getActiveCountForType(type: WorkerType): number {
    let count = 0;
    for (const task of this.activeTasks.values()) {
      if (task.type === type) count++;
    }
    return count;
  }

  private async syncQueueDepthToRedis(type: WorkerType): Promise<void> {
    const depth = (this.queues.get(type) || []).length;
    await redisSet(`worker:${type}:queue`, depth, 300);
  }

  getWorkerStats(): WorkerStats[] {
    const result: WorkerStats[] = [];

    for (const [type, config] of this.configs) {
      const s = this.stats.get(type)!;
      const avgDuration = s.durations.length > 0
        ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length)
        : 0;

      result.push({
        type,
        label: config.label,
        domain: config.domain,
        active: this.getActiveCountForType(type),
        maxConcurrency: config.maxConcurrency,
        totalProcessed: s.totalProcessed,
        totalFailed: s.totalFailed,
        avgDurationMs: avgDuration,
        lastActivity: s.lastActivity,
        queueDepth: (this.queues.get(type) || []).length,
      });
    }

    return result;
  }

  getActiveTasksList(): { id: string; type: WorkerType; description: string; runningMs: number }[] {
    const now = Date.now();
    return Array.from(this.activeTasks.values()).map(t => ({
      id: t.id,
      type: t.type,
      description: t.description,
      runningMs: now - t.startedAt,
    }));
  }

  getConfig(): WorkerConfig[] {
    return WORKER_CONFIGS;
  }
}

export const workerManager = new WorkerManager();
