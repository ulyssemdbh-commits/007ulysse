const MAX_ENTRIES = 50;
const ENTRY_TTL_MS = 10 * 60 * 1000;

export interface ActivityEntry {
  id: string;
  persona: string;
  toolName: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  projectId?: string;
  error?: string;
}

const activities: ActivityEntry[] = [];

function generateId(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pruneOld() {
  const cutoff = Date.now() - ENTRY_TTL_MS;
  while (activities.length > 0 && activities[0].startedAt < cutoff) {
    activities.shift();
  }
  while (activities.length > MAX_ENTRIES) {
    activities.shift();
  }
}

export function trackStart(opts: {
  persona: string;
  toolName: string;
  label: string;
  projectId?: string;
}): string {
  pruneOld();
  const id = generateId();
  activities.push({
    id,
    persona: opts.persona,
    toolName: opts.toolName,
    label: opts.label,
    status: "running",
    startedAt: Date.now(),
    projectId: opts.projectId,
  });
  return id;
}

export function trackEnd(id: string, success: boolean, durationMs?: number, error?: string) {
  const entry = activities.find(a => a.id === id);
  if (entry) {
    entry.status = success ? "done" : "error";
    entry.completedAt = Date.now();
    entry.durationMs = durationMs;
    if (error) entry.error = error;
  }
}

export function getActivities(projectId?: string, limit = 20): ActivityEntry[] {
  pruneOld();
  let filtered = projectId
    ? activities.filter(a => a.projectId === projectId || !a.projectId)
    : activities;
  return filtered.slice(-limit).reverse();
}

export function getRunningActivities(projectId?: string): ActivityEntry[] {
  pruneOld();
  let filtered = projectId
    ? activities.filter(a => a.status === "running" && (a.projectId === projectId || !a.projectId))
    : activities.filter(a => a.status === "running");
  return filtered;
}
