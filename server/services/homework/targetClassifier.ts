/**
 * Homework target classifier.
 *
 * Routes a homework (URL + free-text task) to the right extractor.
 * Reuses existing sport heuristics so sport homeworks keep flowing
 * through the legacy pipeline.
 */

export type HomeworkTargetType =
  | "sports_betting"
  | "sports_ranking"
  | "github_repo"
  | "web_article"
  | "pdf"
  | "notion"
  | "unknown";

export interface ClassifyInput {
  url?: string;
  text?: string;
}

export interface ClassifyResult {
  type: HomeworkTargetType;
  confidence: number; // 0..1
  reason: string;
}

const BETTING_HOSTS = [
  "parionssport.fdj.fr",
  "winamax.fr",
  "betclic.fr",
  "unibet.fr",
  "zebet.fr",
];

const SPORTS_RANKING_HOSTS = [
  "eurotopteam.com",
  "flashscore",
  "sofascore",
  "livescore",
  "matchendirect.fr",
];

const SPORTS_KEYWORDS = [
  "classement", "ranking", "standings",
  "buteur", "scorer", "cote", "odds",
  "match", "championnat", "football",
  "ligue", "league", "serie a", "bundesliga",
  "laliga", "premier league", "coupe",
];

const GITHUB_HOST_RX = /^(www\.)?github\.com$/i;
const NOTION_HOST_RX = /(\.|^)notion\.(so|site)$/i;
const PDF_PATH_RX = /\.pdf($|\?)/i;

function isSportsBettingUrl(host: string, path: string): boolean {
  if (BETTING_HOSTS.some(h => host.includes(h))) return true;
  if (host.includes("pmu.fr") && /paris/i.test(path)) return true;
  return false;
}

function isSportsRankingUrl(host: string, path: string): boolean {
  if (SPORTS_RANKING_HOSTS.some(h => host.includes(h))) return true;
  if (/\/(football|soccer|standings|classement|ranking)\b/i.test(path)) return true;
  return false;
}

function looksLikeSportsText(text: string): boolean {
  const t = text.toLowerCase();
  return SPORTS_KEYWORDS.some(k => t.includes(k));
}

export function classifyHomeworkTarget(input: ClassifyInput): ClassifyResult {
  const text = (input.text || "").trim();
  const rawUrl = (input.url || "").trim();

  if (rawUrl) {
    let host = "";
    let path = "";
    try {
      const u = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
      host = u.hostname.toLowerCase();
      path = u.pathname.toLowerCase();
    } catch {
      // fall through
    }

    if (host) {
      if (PDF_PATH_RX.test(rawUrl)) {
        return { type: "pdf", confidence: 0.95, reason: "URL ends in .pdf" };
      }
      if (GITHUB_HOST_RX.test(host)) {
        return { type: "github_repo", confidence: 0.95, reason: "github.com host" };
      }
      if (NOTION_HOST_RX.test(host)) {
        return { type: "notion", confidence: 0.9, reason: "notion host" };
      }
      if (isSportsBettingUrl(host, path)) {
        return { type: "sports_betting", confidence: 0.95, reason: "known betting host" };
      }
      if (isSportsRankingUrl(host, path)) {
        return { type: "sports_ranking", confidence: 0.85, reason: "sports ranking/scores host or path" };
      }
      // Unknown host but valid URL → treat as web article
      return { type: "web_article", confidence: 0.6, reason: "generic web URL" };
    }
  }

  if (text) {
    if (looksLikeSportsText(text)) {
      return { type: "sports_ranking", confidence: 0.5, reason: "sports keywords in task" };
    }
    if (/github\.com|repo|repository/i.test(text)) {
      return { type: "github_repo", confidence: 0.5, reason: "github mentioned in task" };
    }
    if (/\bpdf\b/i.test(text)) {
      return { type: "pdf", confidence: 0.5, reason: "pdf mentioned in task" };
    }
    if (/notion/i.test(text)) {
      return { type: "notion", confidence: 0.5, reason: "notion mentioned in task" };
    }
  }

  return { type: "unknown", confidence: 0.1, reason: "no signal" };
}

/**
 * Parse a github.com URL into owner/repo if possible.
 * Returns null when the URL is not a valid repo URL.
 */
export function parseGithubRepoUrl(rawUrl: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    if (!GITHUB_HOST_RX.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}
