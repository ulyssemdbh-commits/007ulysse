import * as gh from "./githubService";

export interface ZombiePr {
  number: number;
  title: string;
  branch: string;
  createdAt: string;
  ageHours: number;
  user: string;
}

export interface JanitorOptions {
  titlePrefix?: string;
  authorLogin?: string;
  olderThanHours?: number;
  excludeMerged?: boolean;
  deleteBranch?: boolean;
  dryRun?: boolean;
  reason?: string;
  sessionId?: string;
}

const DEFAULT_DGM_PREFIX = "[DGM]";
const DEFAULT_REASON =
  "Auto-closed by DGM Janitor. This PR was abandoned by a self-healing loop that did not converge. " +
  "If you needed it, reopen and rebase on main.";

function ageHoursOf(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
}

export async function listOpenZombies(
  owner: string,
  repo: string,
  opts: JanitorOptions = {},
): Promise<ZombiePr[]> {
  const prefix = opts.titlePrefix ?? DEFAULT_DGM_PREFIX;
  const minAge = opts.olderThanHours ?? 0;
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch: any[] = await gh.listAllPullRequests(owner, repo, {
      state: "open",
      per_page: 100,
      page,
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all
    .filter((p) => (prefix ? String(p.title || "").startsWith(prefix) : true))
    .filter((p) => (opts.authorLogin ? p.user?.login === opts.authorLogin : true))
    .filter((p) => ageHoursOf(p.created_at) >= minAge)
    .map((p) => ({
      number: p.number,
      title: p.title,
      branch: p.head?.ref || "",
      createdAt: p.created_at,
      ageHours: ageHoursOf(p.created_at),
      user: p.user?.login || "",
    }));
}

export async function closeZombies(
  owner: string,
  repo: string,
  opts: JanitorOptions = {},
): Promise<{
  found: number;
  closed: number;
  branchesDeleted: number;
  failed: Array<{ number: number; error: string }>;
  zombies: ZombiePr[];
  dryRun: boolean;
}> {
  const dryRun = opts.dryRun === true;
  const reason = opts.reason || DEFAULT_REASON;
  const zombies = await listOpenZombies(owner, repo, opts);
  const result = {
    found: zombies.length,
    closed: 0,
    branchesDeleted: 0,
    failed: [] as Array<{ number: number; error: string }>,
    zombies,
    dryRun,
  };

  if (dryRun) return result;

  for (const z of zombies) {
    try {
      await gh.createIssueComment(owner, repo, z.number, reason).catch(() => undefined);
      await gh.closePullRequest(owner, repo, z.number);
      result.closed++;
      if (opts.deleteBranch !== false && z.branch && z.branch !== "main" && z.branch !== "master") {
        try {
          await gh.deleteBranch(owner, repo, z.branch);
          result.branchesDeleted++;
        } catch {}
      }
    } catch (e: any) {
      result.failed.push({ number: z.number, error: e?.message || String(e) });
    }
  }
  return result;
}

const recentDgmPrTimestamps = new Map<string, number[]>();

export function recordDgmPrCreation(repoKey: string): void {
  const now = Date.now();
  const arr = recentDgmPrTimestamps.get(repoKey) || [];
  const cutoff = now - 24 * 3_600_000;
  const filtered = arr.filter((t) => t >= cutoff);
  filtered.push(now);
  recentDgmPrTimestamps.set(repoKey, filtered);
}

export function countDgmPrsLast24h(repoKey: string): number {
  const arr = recentDgmPrTimestamps.get(repoKey) || [];
  const cutoff = Date.now() - 24 * 3_600_000;
  return arr.filter((t) => t >= cutoff).length;
}

export function shouldFreezeDgmRepo(
  repoKey: string,
  maxPrPer24h: number,
): { freeze: boolean; count: number; max: number; reason?: string } {
  const count = countDgmPrsLast24h(repoKey);
  if (count >= maxPrPer24h) {
    return {
      freeze: true,
      count,
      max: maxPrPer24h,
      reason: `Circuit breaker DGM: ${count}/${maxPrPer24h} PRs créés sur ${repoKey} dans les dernières 24h. Freeze pour éviter une boucle de spam.`,
    };
  }
  return { freeze: false, count, max: maxPrPer24h };
}
