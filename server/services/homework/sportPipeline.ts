import OpenAI from "openai";
import type { UlysseHomework } from "@shared/schema";
import { canMakeCall, withRateLimit } from "../rateLimiter";
import { formatWebContentWithMediaForAI } from "../webfetch";
import { crawlAndScrape } from "../scraper/core";
import {
  autoVerifiedScrape,
  extractRankingTable,
  extractTopScorers,
  extractFixtures,
  fetchHtmlForScraper,
  type ExtractionType,
} from "../scraper/verified";
import { memoryService } from "../memory";
import { injectScrapedDataToFootdatas } from "../footdatasUlysseIntegration";
import * as matchEndirectService from "../matchEndirectService";
import { generateOptimizedPrompt } from "./promptBuilder";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ====== PERFORMANCE: Crawl result cache (2h TTL) - SCOPED BY USER ======
interface CrawlCacheEntry {
  content: string;
  title: string;
  timestamp: number;
}
const crawlCache = new Map<string, CrawlCacheEntry>();
const CRAWL_CACHE_TTL = 2 * 60 * 60 * 1000;
const CRAWL_CACHE_MAX_SIZE = 100;

function getCacheKey(userId: number, url: string): string {
  return `user:${userId}:${url}`;
}

function getCachedCrawl(userId: number, url: string): CrawlCacheEntry | null {
  const key = getCacheKey(userId, url);
  const entry = crawlCache.get(key);
  if (entry && Date.now() - entry.timestamp < CRAWL_CACHE_TTL) {
    console.log(`[HomeworkExecution] CACHE HIT for ${url} (age: ${Math.round((Date.now() - entry.timestamp) / 60000)}min)`);
    return entry;
  }
  if (entry) {
    crawlCache.delete(key);
  }
  return null;
}

function setCachedCrawl(userId: number, url: string, content: string, title: string): void {
  const key = getCacheKey(userId, url);
  crawlCache.set(key, { content, title, timestamp: Date.now() });
  if (crawlCache.size > CRAWL_CACHE_MAX_SIZE) {
    const oldest = Array.from(crawlCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) crawlCache.delete(oldest[0]);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(crawlCache.entries())) {
    if (now - entry.timestamp > CRAWL_CACHE_TTL) {
      crawlCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

interface VerifiedScrapeOutcome {
  used: boolean;
  verified: boolean;
  type: ExtractionType;
  data?: any;
  summary?: string;
  content?: string;
}

function extractLeagueFilter(instructions: string): string[] | undefined {
  const instructionsLower = instructions.toLowerCase();
  const leagues: string[] = [];

  if (instructionsLower.includes("ligue 1") || instructionsLower.includes("ligue 1 mcdonald")) {
    leagues.push("Ligue 1");
  }
  if (
    instructionsLower.includes("laliga") ||
    instructionsLower.includes("la liga") ||
    instructionsLower.includes("liga espagnole") ||
    instructionsLower.includes("primera division")
  ) {
    leagues.push("LaLiga");
  }
  if (instructionsLower.includes("premier league") || instructionsLower.includes("premierleague")) {
    leagues.push("Premier League");
  }
  if (instructionsLower.includes("bundesliga")) {
    leagues.push("Bundesliga");
  }
  if (instructionsLower.includes("serie a") || instructionsLower.includes("calcio")) {
    leagues.push("Serie A");
  }

  if (leagues.length > 0) {
    console.log(`[HomeworkExecution] 🎯 League filter detected: [${leagues.join(", ")}]`);
    return leagues;
  }

  return undefined;
}

async function tryVerifiedScrape(
  url: string,
  homeworkTitle: string,
  homeworkInstructions?: string | null,
): Promise<VerifiedScrapeOutcome> {
  const titleLower = homeworkTitle.toLowerCase();
  const urlLower = url.toLowerCase();

  const leagueFilter = homeworkInstructions ? extractLeagueFilter(homeworkInstructions) : undefined;

  // ======================= BETTING URL HANDLER =======================
  const bettingUrlPatterns = [
    /parionssport\.fdj\.fr/i,
    /winamax\.fr/i,
    /betclic\.fr/i,
    /unibet\.fr/i,
    /pmu\.fr.*paris/i,
    /zebet\.fr/i,
  ];

  const isBettingUrl = bettingUrlPatterns.some((pattern) => pattern.test(url));

  if (isBettingUrl) {
    console.log(`[HomeworkExecution] 🎰 BETTING URL detected - using cache & predictions: ${url}`);
    try {
      const { probabilityModelService } = await import("../probabilityModelService");
      const { sportsCacheService } = await import("../sportsCacheService");

      const isChampionsLeague = urlLower.includes("champions") || urlLower.includes("ldc");
      const isEuropaLeague = urlLower.includes("europa");
      const isLigue1 = urlLower.includes("ligue-1") || urlLower.includes("ligue1");
      const isPremierLeague = urlLower.includes("premier-league") || urlLower.includes("premierleague");
      const isLaLiga = urlLower.includes("laliga") || urlLower.includes("la-liga");
      const isSerieA = urlLower.includes("serie-a") || urlLower.includes("seriea");
      const isBundesliga = urlLower.includes("bundesliga");

      const competitionName = isChampionsLeague
        ? "Champions League"
        : isEuropaLeague
        ? "Europa League"
        : isLigue1
        ? "Ligue 1"
        : isPremierLeague
        ? "Premier League"
        : isLaLiga
        ? "La Liga"
        : isSerieA
        ? "Serie A"
        : isBundesliga
        ? "Bundesliga"
        : "Football";

      let todayMatches = await sportsCacheService.getMatchesForDate(new Date());
      let predictions = await probabilityModelService.analyzeTodayMatches();

      if (todayMatches.length === 0 && predictions.length === 0) {
        console.log(`[HomeworkExecution] 🎰 Cache empty - fetching upcoming ${competitionName} matches from API`);
        try {
          const upcomingMatches = await sportsCacheService.getUpcomingMatches(competitionName, 7);
          if (upcomingMatches.length > 0) {
            todayMatches = upcomingMatches;
            console.log(`[HomeworkExecution] 🎰 Fetched ${upcomingMatches.length} upcoming matches`);
          }
        } catch (apiErr) {
          console.log(`[HomeworkExecution] 🎰 API fetch failed:`, apiErr);
        }
      }

      console.log(`[HomeworkExecution] 🎰 Found ${todayMatches.length} matches, ${predictions.length} predictions`);

      let summary = `## 🎰 COTES ${competitionName.toUpperCase()}\n\n`;
      summary += `*Source: Cache sportif & Modèle de probabilité (sites de paris protégés)*\n\n`;

      if (predictions.length > 0) {
        summary += `### 📊 Prédictions du jour\n\n`;
        summary += `| Match | Prédiction | Confiance | Value |\n`;
        summary += `|:------|:-----------|:---------:|:------|\n`;

        for (const pred of predictions.slice(0, 10)) {
          const confidenceVal = pred.confidence ?? 0;
          const confidence = confidenceVal >= 0.7 ? "🟢 HIGH" : confidenceVal >= 0.5 ? "🟡 MEDIUM" : "🔴 LOW";
          const valueScore = pred.valueScore ?? 0;
          const value = valueScore > 0 ? "⭐ VALUE" : "-";
          const bestBet = pred.bestBet || pred.recommendations?.[0]?.prediction || "-";
          summary += `| ${pred.homeTeam} vs ${pred.awayTeam} | ${bestBet} | ${confidence} | ${value} |\n`;
        }
        summary += "\n";
      }

      if (todayMatches.length > 0) {
        summary += `### 📅 Matchs à venir (${todayMatches.length})\n\n`;
        for (const match of todayMatches.slice(0, 15)) {
          const matchDate = match.date
            ? new Date(match.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
            : "";
          const odds = match.odds
            ? ` | Cotes: 1=${match.odds.home?.toFixed(2)} X=${match.odds.draw?.toFixed(2)} 2=${match.odds.away?.toFixed(2)}`
            : "";
          summary += `- ${matchDate} **${match.homeTeam}** vs **${match.awayTeam}**${odds}\n`;
        }
      } else {
        summary += `*Aucun match ${competitionName} trouvé pour les prochains jours.*\n`;
        summary += `*Essayez de demander directement dans le chat pour une recherche plus approfondie.*\n`;
      }

      return {
        used: true,
        verified: todayMatches.length > 0 || predictions.length > 0,
        type: "odds" as ExtractionType,
        data: { predictions, matches: todayMatches },
        summary,
      };
    } catch (err) {
      console.error(`[HomeworkExecution] 🎰 Betting URL error:`, err);
      return {
        used: true,
        verified: false,
        type: "odds" as ExtractionType,
        summary: `## ⚠️ Site de paris protégé\n\nLe site ${url} bloque les accès automatisés.\n\n*Utilisez le chat pour demander les cotes - le système utilisera le cache sportif.*`,
      };
    }
  }
  // ======================= END BETTING URL HANDLER =======================

  const isSportsUrl =
    urlLower.includes("eurotopteam.com") ||
    urlLower.includes("flashscore") ||
    urlLower.includes("sofascore") ||
    urlLower.includes("livescore") ||
    urlLower.includes("/football/") ||
    urlLower.includes("/soccer/") ||
    urlLower.includes("/standings") ||
    urlLower.includes("/classement");

  const hasSportsKeywords =
    titleLower.includes("classement") ||
    titleLower.includes("ranking") ||
    titleLower.includes("score") ||
    titleLower.includes("résultat") ||
    titleLower.includes("cote") ||
    titleLower.includes("odds") ||
    titleLower.includes("match") ||
    titleLower.includes("buteur") ||
    titleLower.includes("championnat") ||
    titleLower.includes("football") ||
    titleLower.includes("ligue") ||
    titleLower.includes("league") ||
    titleLower.includes("serie") ||
    titleLower.includes("bundesliga") ||
    titleLower.includes("liga") ||
    titleLower.includes("coupe");

  const needsVerification =
    isSportsUrl ||
    hasSportsKeywords ||
    urlLower.includes("classement") ||
    urlLower.includes("standing") ||
    urlLower.includes("score") ||
    urlLower.includes("odds");

  if (!needsVerification) {
    return { used: false, verified: false, type: "unknown" };
  }

  // ====== MATCHENDIRECT.FR SPECIAL HANDLING ======
  const isMatchEndirectUrl = urlLower.includes("matchendirect.fr");

  if (isMatchEndirectUrl) {
    console.log(`[HomeworkExecution] 🔴 MATCHENDIRECT.FR PRIORITAIRE détecté: ${url}`);

    try {
      let targetLeague: "ligue1" | "laliga" | "premierLeague" | "bundesliga" | "serieA" | null = null;
      if (urlLower.includes("/ligue-1") || urlLower.includes("/france/")) targetLeague = "ligue1";
      else if (urlLower.includes("/la-liga") || urlLower.includes("/espagne/")) targetLeague = "laliga";
      else if (urlLower.includes("/premier-league") || urlLower.includes("/angleterre/")) targetLeague = "premierLeague";
      else if (urlLower.includes("/bundesliga") || urlLower.includes("/allemagne/")) targetLeague = "bundesliga";
      else if (urlLower.includes("/serie-a") || urlLower.includes("/italie/")) targetLeague = "serieA";

      const dateMatch = url.match(/resultat-foot-(\d{2})-(\d{2})-(\d{4})/);
      let dateToFetch: string;

      if (dateMatch) {
        dateToFetch = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        console.log(`[HomeworkExecution] 📅 Date extraite de l'URL: ${dateToFetch}`);
      } else {
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, "0");
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const yyyy = today.getFullYear();
        dateToFetch = `${dd}-${mm}-${yyyy}`;
        console.log(`[HomeworkExecution] 📅 Pas de date dans l'URL, utilisation de la date du jour: ${dateToFetch}`);
      }

      const matchResult = await matchEndirectService.fetchMatchEndirect(dateToFetch);

      if (matchResult.big5Matches.length > 0) {
        console.log(`[HomeworkExecution] ✅ MatchEnDirect: ${matchResult.big5Matches.length} matchs Big 5 trouvés pour ${dateToFetch}`);

        try {
          const { footdatasService } = await import("../footdatasService");
          const syncResult = await footdatasService.storeMatchEndirectData(matchResult);
          console.log(`[HomeworkExecution] 📦 FootdatasService sync: ${syncResult.stored} stored, ${syncResult.updated} updated`);
        } catch (syncErr) {
          console.error(`[HomeworkExecution] ⚠️ FootdatasService sync error:`, syncErr);
        }

        let matches = matchResult.big5Matches;
        let leagueName = "Big 5";

        if (targetLeague && matchResult.byLeague[targetLeague]) {
          matches = matchResult.byLeague[targetLeague];
          const leagueNames: Record<string, string> = {
            ligue1: "Ligue 1",
            laliga: "LaLiga",
            premierLeague: "Premier League",
            bundesliga: "Bundesliga",
            serieA: "Serie A",
          };
          leagueName = leagueNames[targetLeague] || targetLeague;
          console.log(`[HomeworkExecution] 🎯 Filtrage par ligue: ${leagueName} (${matches.length} matchs)`);
        }

        const matchLines = matches.map((m) => {
          const score = m.homeScore !== null && m.awayScore !== null ? `${m.homeScore}-${m.awayScore}` : "À venir";
          const statusIcon = m.status === "finished" ? "✅" : m.status === "live" ? "🔴" : "⏳";
          return `${statusIcon} ${m.homeTeam} vs ${m.awayTeam}: ${score}${m.time ? ` (${m.time})` : ""}`;
        });

        const formattedContent = `
════════════════════════════════════════
📅 MATCHS ${leagueName.toUpperCase()} DU ${matchResult.date}
════════════════════════════════════════
Total: ${matches.length} matchs

${matchLines.join("\n")}

Source: matchendirect.fr (VERIFIED)
════════════════════════════════════════`;

        return {
          used: true,
          verified: true,
          type: "matches" as ExtractionType,
          content: formattedContent,
          summary: `${matches.length} matchs ${leagueName} du ${matchResult.date} (matchendirect.fr)`,
          data: {
            matches,
            date: matchResult.date,
            league: leagueName,
            count: matches.length,
          },
        };
      } else {
        console.log(`[HomeworkExecution] ⚠️ MatchEnDirect: 0 matchs trouvés pour ${dateToFetch}`);
      }
    } catch (err) {
      console.error(`[HomeworkExecution] MatchEnDirect error:`, err);
    }
  }

  // Football league pages - extract ALL data (ranking + scorers + fixtures)
  const isFootballLeaguePage =
    urlLower.includes("eurotopteam.com/football/") ||
    (urlLower.includes("/football/") && urlLower.endsWith(".php"));

  if (isFootballLeaguePage) {
    console.log(`[HomeworkExecution] 🏆 FOOTBALL PAGE detected - extracting ALL data from ${url}`);
    try {
      const html = await fetchHtmlForScraper(url);
      if (html) {
        const ranking = extractRankingTable(html);
        const topScorers = extractTopScorers(html);
        const fixturesData = extractFixtures(html);

        console.log(`[HomeworkExecution] ✅ Football data: ${ranking.length} teams, ${topScorers.length} scorers, ${fixturesData.fixtures.length} fixtures`);

        let leagueName = "Unknown";
        let leagueCode = "";
        if (urlLower.includes("ligue1") || urlLower.includes("ligue-1")) {
          leagueName = "Ligue 1";
          leagueCode = "L1";
        } else if (urlLower.includes("premierleague") || urlLower.includes("premier-league")) {
          leagueName = "Premier League";
          leagueCode = "PL";
        } else if (urlLower.includes("laliga") || urlLower.includes("la-liga")) {
          leagueName = "LaLiga";
          leagueCode = "LL";
        } else if (urlLower.includes("seriea") || urlLower.includes("serie-a")) {
          leagueName = "Serie A";
          leagueCode = "SA";
        } else if (urlLower.includes("bundesliga")) {
          leagueName = "Bundesliga";
          leagueCode = "BL";
        }

        if (leagueCode) {
          try {
            if (ranking.length > 0) {
              const rankingData = ranking.map((r: any) => ({
                team: r.name,
                competition: leagueName,
                position: r.position,
                points: r.points,
                played: r.played,
                wins: r.wins,
                draws: r.draws,
                losses: r.losses,
                goalsFor: r.goalsFor,
                goalsAgainst: r.goalsAgainst,
                goalDifference: r.goalDiff,
              }));
              const rankResult = await injectScrapedDataToFootdatas("rankings", rankingData, url);
              console.log(`[HomeworkExecution] 📊 FOOTDATAS: Injected ${rankResult.itemsAdded} rankings, ${rankResult.itemsSkipped} skipped`);
            }

            if (topScorers.length > 0) {
              const scorerData = topScorers.map((s: any) => ({
                player: s.name,
                team: s.team,
                competition: leagueName,
                goals: s.goals,
                appearances: s.matches,
              }));
              const scorerResult = await injectScrapedDataToFootdatas("topscorers", scorerData, url);
              console.log(`[HomeworkExecution] ⚽ FOOTDATAS: Injected ${scorerResult.itemsAdded} top scorers`);
            }
          } catch (footdatasError) {
            console.error(`[HomeworkExecution] FOOTDATAS injection error:`, footdatasError);
          }
        }

        console.log(`[HomeworkExecution] ⚠️ Fixtures from eurotopteam.com IGNORED - matchendirect.fr is EXCLUSIVE source for matches`);

        let summary = "";

        if (ranking.length > 0) {
          summary += "## 📊 CLASSEMENT\n\n";
          summary += "| # | Équipe | Pts | V | N | D | BP | BC | Diff |\n";
          summary += "|--:|:-------|----:|--:|--:|--:|---:|---:|-----:|\n";
          summary += ranking
            .slice(0, 20)
            .map((r: any) => {
              const pts = r.points ?? "-";
              const v = r.wins ?? "-";
              const n = r.draws ?? "-";
              const d = r.losses ?? "-";
              const bp = r.goalsFor ?? "-";
              const bc = r.goalsAgainst ?? "-";
              const diff = r.goalDiff ?? (typeof bp === "number" && typeof bc === "number" ? bp - bc : "-");
              const diffStr = typeof diff === "number" ? (diff > 0 ? `+${diff}` : `${diff}`) : diff;
              return `| ${r.position} | ${r.name} | ${pts} | ${v} | ${n} | ${d} | ${bp} | ${bc} | ${diffStr} |`;
            })
            .join("\n");
          summary += "\n\n";
        }

        if (topScorers.length > 0) {
          summary += "## ⚽ MEILLEURS BUTEURS\n\n";
          summary += "| # | Joueur | Club | Buts |\n";
          summary += "|--:|:-------|:-----|-----:|\n";
          summary += topScorers
            .slice(0, 15)
            .map((s: any) => `| ${s.position} | ${s.name} | ${s.team || "-"} | ${s.goals} |`)
            .join("\n");
          summary += "\n\n";
        }

        summary += "\n📅 Pour les matchs du jour, consulter matchendirect.fr\n";

        if (summary.trim()) {
          return {
            used: true,
            verified: true,
            type: "ranking",
            data: { ranking, topScorers, fixtures: fixturesData },
            summary: summary.trim(),
          };
        }
      }
    } catch (error) {
      console.error(`[HomeworkExecution] Football page extraction error:`, error);
    }
  }

  console.log(`[HomeworkExecution] Using VERIFIED SCRAPER for: ${url}${leagueFilter ? ` (filter: ${leagueFilter.join(", ")})` : ""}`);

  try {
    const { type, result } = await autoVerifiedScrape(url, undefined, { maxAttempts: 2, leagueFilter });

    if (result.verified && result.ok && result.data) {
      console.log(`[HomeworkExecution] ✅ VERIFIED data extracted: type=${type}, items=${Array.isArray(result.data) ? result.data.length : 1}`);

      const execDate = new Date().toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      let summary = `📅 **Exécution: ${execDate}**\n\n[DONNÉES VÉRIFIÉES - ${type.toUpperCase()}]\n`;

      if (type === "football_page" && result.data) {
        const data = result.data as { ranking: any[]; topScorers: any[]; fixtures: { matchday?: number; fixtures: any[] } };

        if (data.fixtures?.fixtures?.length > 0) {
          const matchday = data.fixtures.matchday || "?";
          summary += `\n⚽ **JOURNÉE ${matchday}**\n`;
          summary += "| Domicile | | Score | | Extérieur |\n";
          summary += "|:---------|:-:|:-----:|:-:|:----------|\n";
          summary += data.fixtures.fixtures
            .slice(0, 15)
            .map((f: any) => {
              const homeScore = f.homeScore !== undefined ? f.homeScore : "-";
              const awayScore = f.awayScore !== undefined ? f.awayScore : "-";
              return `| ${f.homeTeam} | | ${homeScore} - ${awayScore} | | ${f.awayTeam} |`;
            })
            .join("\n");
          summary += "\n";
        }

        if (data.ranking?.length > 0) {
          summary += "\n📊 **CLASSEMENT**\n";
          summary += "| # | Équipe | Pts | V | N | D | BP | BC | Diff |\n";
          summary += "|--:|:-------|----:|--:|--:|--:|---:|---:|-----:|\n";
          summary += data.ranking
            .slice(0, 20)
            .map((r: any) => {
              const stats = r.stats || {};
              const pts = r.points ?? r.score ?? stats.Pts ?? "-";
              const v = stats.V ?? stats.wins ?? r.wins ?? "-";
              const n = stats.N ?? stats.draws ?? r.draws ?? "-";
              const d = stats.D ?? stats.losses ?? r.losses ?? "-";
              const bp = stats.BP ?? stats.goalsFor ?? r.goalsFor ?? "-";
              const bc = stats.BC ?? stats.goalsAgainst ?? r.goalsAgainst ?? "-";
              const diff = stats.Diff ?? r.goalDiff ?? (typeof bp === "number" && typeof bc === "number" ? bp - bc : "-");
              const diffStr = typeof diff === "number" ? (diff > 0 ? `+${diff}` : `${diff}`) : diff;
              return `| ${r.position} | ${r.name} | ${pts} | ${v} | ${n} | ${d} | ${bp} | ${bc} | ${diffStr} |`;
            })
            .join("\n");
          summary += "\n";
        }

        if (data.topScorers?.length > 0) {
          summary += "\n🥇 **MEILLEURS BUTEURS**\n";
          summary += data.topScorers
            .slice(0, 5)
            .map((s: any) => `${s.position}. ${s.name}${s.team ? ` (${s.team})` : ""} - ${s.goals} buts`)
            .join("\n");
        }
      } else if (type === "ranking" && Array.isArray(result.data)) {
        summary += "| # | Équipe | Pts | V | N | D | BP | BC | Diff |\n";
        summary += "|--:|:-------|----:|--:|--:|--:|---:|---:|-----:|\n";
        summary += result.data
          .slice(0, 20)
          .map((r: any) => {
            const stats = r.stats || {};
            const pts = r.points ?? r.score ?? stats.Pts ?? "-";
            const v = stats.V ?? stats.wins ?? r.wins ?? "-";
            const n = stats.N ?? stats.draws ?? r.draws ?? "-";
            const d = stats.D ?? stats.losses ?? r.losses ?? "-";
            const bp = stats.BP ?? stats.goalsFor ?? r.goalsFor ?? "-";
            const bc = stats.BC ?? stats.goalsAgainst ?? r.goalsAgainst ?? "-";
            const diff = stats.Diff ?? r.goalDiff ?? (typeof bp === "number" && typeof bc === "number" ? bp - bc : "-");
            const diffStr = typeof diff === "number" ? (diff > 0 ? `+${diff}` : `${diff}`) : diff;
            return `| ${r.position} | ${r.name} | ${pts} | ${v} | ${n} | ${d} | ${bp} | ${bc} | ${diffStr} |`;
          })
          .join("\n");
      } else if (type === "matches" && Array.isArray(result.data)) {
        const matchCount = result.data.length;
        summary += `## ⚽ RÉSULTATS DES MATCHS (${matchCount})\n\n`;
        summary += "| Domicile | Score | Extérieur |\n";
        summary += "|:---------|:-----:|:----------|\n";
        summary += result.data
          .map((m: any) => {
            const homeScore = m.homeScore !== undefined ? m.homeScore : "-";
            const awayScore = m.awayScore !== undefined ? m.awayScore : "-";
            return `| **${m.homeTeam}** | ${homeScore} - ${awayScore} | ${m.awayTeam} |`;
          })
          .join("\n");
      } else if (type === "odds" && Array.isArray(result.data)) {
        const oddsCount = result.data.length;
        summary += `## 🎰 COTES DES MATCHS (${oddsCount})\n\n`;
        summary += "| Ligue | Match | 1 (Dom) | N (Nul) | 2 (Ext) | Bookmaker |\n";
        summary += "|:------|:------|:-------:|:-------:|:-------:|:----------|\n";
        summary += result.data
          .map((o: any) => {
            const home = o.homeOdds ? o.homeOdds.toFixed(2) : "-";
            const draw = o.drawOdds ? o.drawOdds.toFixed(2) : "-";
            const away = o.awayOdds ? o.awayOdds.toFixed(2) : "-";
            const bookmaker = o.bookmaker || "-";
            const league = o.league || "-";
            return `| ${league} | **${o.homeTeam}** vs ${o.awayTeam} | ${home} | ${draw} | ${away} | ${bookmaker} |`;
          })
          .join("\n");
      } else if (type === "topscorers" && Array.isArray(result.data)) {
        const scorerCount = result.data.length;
        summary += `## ⚽ MEILLEURS BUTEURS (${scorerCount})\n\n`;
        summary += "| # | Joueur | Club | Buts |\n";
        summary += "|--:|:-------|:-----|-----:|\n";
        summary += result.data
          .map((s: any) => `| ${s.position} | **${s.name}** | ${s.team || "-"} | ${s.goals} |`)
          .join("\n");
      } else {
        summary += JSON.stringify(result.data, null, 2).substring(0, 2000);
      }

      return {
        used: true,
        verified: true,
        type,
        data: result.data,
        summary,
      };
    } else {
      console.warn(`[HomeworkExecution] ⚠️ Verified scrape FAILED: attempts=${result.attempts}, diffs=${result.diffs?.join(", ")}`);
      return {
        used: true,
        verified: false,
        type,
        summary: `[DONNÉES NON VÉRIFIÉES - ${type}] Les extractions ne correspondaient pas. Différences: ${result.diffs?.slice(0, 3).join("; ") || "N/A"}`,
      };
    }
  } catch (error) {
    console.error(`[HomeworkExecution] Verified scrape error:`, error);
    return { used: true, verified: false, type: "unknown" };
  }
}

export async function executeSportUrlFetchTask(
  userId: number,
  homework: UlysseHomework,
  url: string,
  personaName: string = "Ulysse",
): Promise<{ summary: string; artifacts: any }> {
  try {
    console.log(`[HomeworkExecution] Crawling URL via SUPER ULYSSE Scraper: ${url}`);

    const verifiedResult = await tryVerifiedScrape(url, homework.title, homework.instructions);

    if (verifiedResult.used && verifiedResult.verified && verifiedResult.summary) {
      console.log(`[HomeworkExecution] ✅ Using VERIFIED data for homework: ${homework.title}`);

      try {
        await memoryService.updateOrCreateMemory(
          userId,
          "sports_verified",
          `verified_${verifiedResult.type}_${homework.id}`,
          verifiedResult.summary.substring(0, 1500),
          `homework:${homework.id}:verified`,
          { verified: true, data: verifiedResult.data },
        );
        console.log(`[HomeworkExecution] 📝 Stored verified data in memory: verified_${verifiedResult.type}_${homework.id}`);
      } catch (memErr) {
        console.warn(`[HomeworkExecution] Failed to store verified data in memory:`, memErr);
      }

      return {
        summary: verifiedResult.summary,
        artifacts: {
          url,
          verified: true,
          type: verifiedResult.type,
          dataCount: Array.isArray(verifiedResult.data) ? verifiedResult.data.length : 1,
          data: verifiedResult.data,
        },
      };
    }

    if (verifiedResult.used && !verifiedResult.verified) {
      console.warn(`[HomeworkExecution] ⚠️ Verified scrape attempted but FAILED, falling back to standard scrape`);
    }

    const needsJsRendering = /flashscore|transfermarkt|sofascore|whoscored|fotmob/i.test(url);
    const scrapeMode = needsJsRendering ? "browser" : "auto";

    const scrapeResult = await crawlAndScrape({
      url,
      mode: scrapeMode,
      depth: 0,
      maxPages: 1,
      maxConcurrency: 1,
      linkScope: "none",
      extract: {
        text: true,
        links: false,
        metadata: true,
      },
    });

    const page = scrapeResult.pages[0];
    const textLength = page?.text?.length || 0;
    console.log(`[HomeworkExecution] Scrape result: mode=${scrapeResult.modeUsed}, status=${page?.status}, textLength=${textLength}`);

    if (!page || page.status !== 200 || textLength < 100) {
      const errorMsg = page?.error || "Content inaccessible or too short";
      console.log(`[HomeworkExecution] Scrape failed: ${errorMsg}`);
      return {
        summary: `Impossible d'accéder au site ${url}. ${errorMsg}`,
        artifacts: { url, error: errorMsg, processed: false, modeUsed: scrapeResult.modeUsed },
      };
    }

    if (textLength < 200) {
      console.log(`[HomeworkExecution] Partial content (${textLength} chars), may be incomplete`);
    }

    const fetchResult = {
      success: true,
      url: url,
      title: page.metadata?.title || "",
      content: page.text || "",
      error: undefined,
      media: undefined,
    };

    const webContent = formatWebContentWithMediaForAI(fetchResult);

    if (canMakeCall("combined")) {
      const optimizedPrompt = await generateOptimizedPrompt(homework, "url_fetch", personaName);
      console.log(`[HomeworkExecution] Using optimized prompt for URL fetch`);

      const taskDesc = `${homework.title} ${homework.description || ""}`.toLowerCase();
      const wantsEnrichment = /apprends|enseigne|explique|davantage|détail|approfondi|teach|learn|paracha|parasha|torah/i.test(taskDesc);
      let enrichmentContent = "";

      if (wantsEnrichment && canMakeCall("combined")) {
        const parashaMatch = fetchResult.content.match(/(?:paracha|parasha|parashat)\s+([A-Za-zÀ-ÿ'-]+(?:\s+[A-Za-zÀ-ÿ'-]+)?)/i);
        const parashaName = parashaMatch ? parashaMatch[1].replace(/[<>\/\[\]{}()]/g, "").trim() : null;
        if (parashaName) {
          console.log(`[HomeworkExecution] Enrichment (single-URL): generating teaching for paracha "${parashaName}"`);
          try {
            const teachResp = await withRateLimit("combined", () =>
              openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: "Tu es un érudit en Torah. Fournis un enseignement COMPLET et DÉTAILLÉ sur la paracha en français." },
                  { role: "user", content: `Cours complet sur la paracha ${parashaName}: résumé détaillé, thèmes, enseignements pratiques, commentaire de Rachi, midrash, et lien avec la vie moderne.` },
                ],
                temperature: 0.5,
                max_tokens: 2000,
              }),
              0,
            );
            const teaching = teachResp.choices[0].message.content || "";
            if (teaching) enrichmentContent = `\n\n--- 📚 ENSEIGNEMENT PARACHA ${parashaName.toUpperCase()} ---\n${teaching}`;
          } catch (e) {
            console.warn(`[HomeworkExecution] Enrichment teaching failed:`, e);
          }
        }
      }

      const maxTokens = wantsEnrichment ? 1500 : 800;

      const analysisResponse = await withRateLimit("combined", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                optimizedPrompt +
                (wantsEnrichment
                  ? `\n\nIMPORTANT: L'utilisateur veut APPRENDRE. Ne te contente pas d'extraire les données brutes. Fournis une réponse RICHE et ÉDUCATIVE. Si c'est une paracha, explique le résumé, les thèmes principaux, les enseignements et les leçons pratiques. Utilise les données du site ET tes connaissances pour enrichir la réponse.`
                  : ""),
            },
            {
              role: "user",
              content: `Tâche: ${homework.title}\n${homework.description || ""}\n\n${webContent}${enrichmentContent}`,
            },
          ],
          temperature: wantsEnrichment ? 0.5 : 0.3,
          max_tokens: maxTokens,
        }),
        0,
      );

      return {
        summary: analysisResponse.choices[0].message.content || `Contenu récupéré de ${url}`,
        artifacts: {
          url,
          title: fetchResult.title,
          contentLength: fetchResult.content.length,
          processed: true,
          enriched: wantsEnrichment,
        },
      };
    }

    return {
      summary: `Contenu extrait de ${url}:\n\n**${fetchResult.title}**\n\n${fetchResult.content.substring(0, 1000)}...`,
      artifacts: {
        url,
        title: fetchResult.title,
        contentLength: fetchResult.content.length,
        processed: true,
      },
    };
  } catch (error) {
    console.error(`[HomeworkExecution] URL fetch error:`, error);
    return {
      summary: `Erreur lors de l'accès à ${url}: ${error instanceof Error ? error.message : String(error)}`,
      artifacts: { url, error: String(error), processed: false },
    };
  }
}

export async function executeSportMultiUrlFetchTask(
  userId: number,
  homework: UlysseHomework,
  urls: string[],
  personaName: string = "Ulysse",
): Promise<{ summary: string; artifacts: any }> {
  console.log(`[HomeworkExecution] Starting OPTIMIZED MULTI-URL fetch for ${urls.length} URLs`);

  const results: Array<{ url: string; success: boolean; title?: string; content?: string; error?: string; fromCache?: boolean; verified?: boolean }> = [];

  const uncachedUrls: string[] = [];
  for (const url of urls) {
    const cached = getCachedCrawl(userId, url);
    if (cached) {
      results.push({
        url,
        success: true,
        title: cached.title,
        content: cached.content,
        fromCache: true,
      });
    } else {
      uncachedUrls.push(url);
    }
  }

  const cacheHits = results.length;
  console.log(`[HomeworkExecution] Cache: ${cacheHits}/${urls.length} hits, ${uncachedUrls.length} to crawl`);

  const BATCH_SIZE = 2;
  for (let batchStart = 0; batchStart < uncachedUrls.length; batchStart += BATCH_SIZE) {
    const batch = uncachedUrls.slice(batchStart, batchStart + BATCH_SIZE);
    console.log(`[HomeworkExecution] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: Processing ${batch.length} URLs in parallel`);

    const batchResults = await Promise.all(
      batch.map(async (url, idx) => {
        const globalIdx = batchStart + idx + 1;
        console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] Processing via SUPER ULYSSE: ${url}`);

        try {
          const verifiedResult = await tryVerifiedScrape(url, homework.title, homework.instructions);

          if (verifiedResult.used && verifiedResult.summary) {
            if (verifiedResult.verified) {
              console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] ✅ VERIFIED data extracted`);

              try {
                await memoryService.updateOrCreateMemory(
                  userId,
                  "sports_verified",
                  `verified_${verifiedResult.type}_${homework.id}_${globalIdx}`,
                  verifiedResult.summary.substring(0, 1500),
                  `homework:${homework.id}:verified:${globalIdx}`,
                  { verified: true, data: verifiedResult.data },
                );
              } catch (memErr) {
                console.warn(`[HomeworkExecution] Failed to store multi-URL verified data:`, memErr);
              }
            } else {
              console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] 🎰 Handler used (no matches available)`);
            }

            return {
              url,
              success: true,
              title: verifiedResult.verified ? `[VÉRIFIÉ] ${verifiedResult.type}` : `[🎰] ${verifiedResult.type}`,
              content: verifiedResult.content || verifiedResult.summary,
              verified: verifiedResult.verified,
            };
          }

          if (verifiedResult.used && !verifiedResult.summary) {
            console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] ⚠️ Handler failed, fallback to standard`);
          }

          const needsJsRendering = /flashscore|transfermarkt|sofascore|whoscored|fotmob/i.test(url);
          const scrapeMode = needsJsRendering ? "browser" : "auto";

          const scrapeResult = await crawlAndScrape({
            url,
            mode: scrapeMode,
            depth: 0,
            maxPages: 1,
            maxConcurrency: 1,
            linkScope: "none",
            extract: {
              text: true,
              links: false,
              metadata: true,
            },
          });

          const page = scrapeResult.pages[0];
          const textLength = page?.text?.length || 0;
          console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] Result: mode=${scrapeResult.modeUsed}, status=${page?.status}, textLength=${textLength}`);

          if (page && page.status === 200 && textLength > 100) {
            setCachedCrawl(userId, url, page.text || "", page.metadata?.title || url);
            return {
              url,
              success: true,
              title: page.metadata?.title || url,
              content: page.text || "",
            };
          } else {
            const errorMsg = page?.error || "Content inaccessible or too short";
            console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] Insufficient: ${errorMsg}`);
            return { url, success: false, error: errorMsg };
          }
        } catch (error) {
          console.error(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] Error:`, error);
          return { url, success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );

    results.push(...batchResults);

    if (batchStart + BATCH_SIZE < uncachedUrls.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const successfulResults = results.filter((r) => r.success);
  const failedResults = results.filter((r) => !r.success);

  console.log(`[HomeworkExecution] Completed: ${successfulResults.length}/${urls.length} URLs successful`);

  if (successfulResults.length === 0) {
    return {
      summary: `Impossible d'accéder aux ${urls.length} URLs demandées. Sites potentiellement bloqués ou utilisant JavaScript complexe.`,
      artifacts: { urls, totalUrls: urls.length, successCount: 0, errors: failedResults },
    };
  }

  const combinedContent = successfulResults
    .map((r, idx) => `\n---\n## SOURCE ${idx + 1}: ${r.title}\n**URL:** ${r.url}\n\n${r.content?.substring(0, 12000) || ""}`)
    .join("\n");

  if (canMakeCall("combined")) {
    try {
      const optimizedPrompt = await generateOptimizedPrompt(homework, "url_fetch", personaName);

      const taskFullText = `${homework.title} ${homework.description || ""}`;
      const wantsEnrichment = /apprends|enseigne|explique|davantage|détail|approfondi|teach|learn|paracha|parasha|torah/i.test(taskFullText);
      let enrichmentContent = "";

      if (wantsEnrichment) {
        console.log(`[HomeworkExecution] Enrichment mode detected for "${homework.title}"`);
        const allContent = successfulResults.map((r) => r.content || "").join(" ");
        const parashaMatch = allContent.match(/(?:paracha|parasha|parashat)\s+([A-Za-zÀ-ÿ'-]+(?:\s+[A-Za-zÀ-ÿ'-]+)?)/i);
        const parashaName = parashaMatch ? parashaMatch[1].replace(/[<>\/\[\]{}()]/g, "").trim() : null;

        if (parashaName && canMakeCall("combined")) {
          console.log(`[HomeworkExecution] Enrichment: generating deep teaching about paracha "${parashaName}" via OpenAI`);
          try {
            const teachingResponse = await withRateLimit("combined", () =>
              openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: `Tu es un érudit en Torah, spécialiste des textes bibliques et de leurs commentaires. Tu dois fournir un enseignement COMPLET et DÉTAILLÉ sur la paracha demandée en français. Ton cours doit être riche, captivant et accessible.` },
                  { role: "user", content: `Fais-moi un cours complet sur la paracha ${parashaName}. Inclus OBLIGATOIREMENT:\n\n1. 📖 RÉSUMÉ DÉTAILLÉ: L'histoire complète avec les personnages, les événements clés, les dialogues importants\n2. 🎯 THÈMES PRINCIPAUX: Les grands messages spirituels et moraux\n3. 💡 ENSEIGNEMENTS PRATIQUES: Les leçons concrètes pour la vie quotidienne\n4. 📚 COMMENTAIRE DE RACHI: Au moins un commentaire célèbre de Rachi sur cette paracha\n5. 🌟 ANECDOTE OU MIDRASH: Une histoire ou un midrash lié à cette paracha\n6. 🔗 LIEN AVEC LA VIE MODERNE: Comment appliquer ces enseignements aujourd'hui` },
                ],
                temperature: 0.5,
                max_tokens: 2000,
              }),
              0,
            );
            const teaching = teachingResponse.choices[0].message.content || "";
            if (teaching) {
              enrichmentContent = `\n\n--- 📚 ENSEIGNEMENT SUR LA PARACHA ${parashaName.toUpperCase()} ---\n${teaching}`;
              console.log(`[HomeworkExecution] Enrichment: Generated ${teaching.length} chars teaching about paracha ${parashaName}`);
            }
          } catch (e) {
            console.warn(`[HomeworkExecution] Enrichment teaching generation failed:`, e);
          }
        }
      }

      const isSportsClassement = /classement|ranking|standings|buteur|scorer|tabella|table|ligue|serie|league|bundesliga/i.test(taskFullText);

      const sportsInstruction = isSportsClassement
        ? `\n\n⚠️ IMPORTANT - EXTRACTION COMPLÈTE REQUISE:
- Pour chaque championnat, extrais le classement COMPLET (positions 1 à 20 minimum)
- Inclus pour chaque équipe: position, nom, points, victoires, nuls, défaites, buts pour/contre
- Inclus le classement des buteurs avec les 10 premiers au minimum
- NE PAS RÉSUMER: on veut TOUTES les données brutes du classement, pas juste le TOP 3

📊 FORMAT TABLEAU OBLIGATOIRE - COLONNES ALIGNÉES:
Utilise EXACTEMENT ce format Markdown avec colonnes fixes et alignées:

| # | Équipe | Pts | V | N | D | BP | BC | Diff |
|--:|:-------|----:|--:|--:|--:|---:|---:|-----:|
| 1 | Bayern Munich | 50 | 16 | 2 | 1 | 72 | 16 | +56 |
| 2 | Borussia Dortmund | 42 | 12 | 6 | 1 | 38 | 17 | +21 |

RÈGLES DE FORMATAGE:
- Colonnes numériques alignées à droite (|--:| ou |---:|)
- Colonne équipe alignée à gauche (|:---|)
- Différence de buts avec signe +/- explicite
- Abréviations: Pts=Points, V=Victoires, N=Nuls, D=Défaites, BP=Buts Pour, BC=Buts Contre, Diff=Différence
- Numérotation avec # (pas "Position" en entier)
- Une seule ligne par équipe, données compactes

🚨🚨🚨 RÈGLE CRITIQUE ANTI-HALLUCINATION 🚨🚨🚨
- INTERDICTION ABSOLUE d'inventer des classements, scores, points ou statistiques
- Chaque ligne de classement DOIT être COPIÉE du contenu source fourni
- Si le contenu source ne contient PAS un classement complet: écris "CLASSEMENT NON DISPONIBLE - Le site n'a pas retourné ces données"
- NE JAMAIS générer un classement "plausible" - soit tu as la vraie donnée, soit tu dis "NON DISPONIBLE"
- Vérifie: chaque équipe/joueur mentionné apparaît-il EXPLICITEMENT dans le texte source ?`
        : `

🚨 RÈGLE ANTI-HALLUCINATION 🚨
- Extraire UNIQUEMENT les données explicitement présentes dans le contenu source
- Si information manquante: répondre "DONNÉES NON DISPONIBLES" pour cette partie
- NE JAMAIS inventer de chiffres, noms ou statistiques`;

      const enrichmentInstruction = wantsEnrichment
        ? `\n\n📚 MODE ÉDUCATIF ACTIVÉ: L'utilisateur veut APPRENDRE, pas juste recevoir des données brutes. Tu dois:
1. Extraire les informations factuelles (horaires, dates, noms)
2. PUIS fournir un VRAI COURS éducatif enrichi:
   - Résumé détaillé du sujet (si paracha: résumé de l'histoire biblique, personnages clés)
   - Thèmes principaux et messages spirituels
   - Enseignements pratiques pour la vie quotidienne
   - Anecdotes ou commentaires de grands rabbins si disponibles
   - Liens avec l'actualité ou la vie moderne
Utilise TOUTES les sources fournies ET tes connaissances pour créer un contenu riche et captivant.`
        : "";

      const finalMaxTokens = wantsEnrichment ? 3000 : isSportsClassement ? 4000 : 2000;

      const analysisResponse = await withRateLimit("combined", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `${optimizedPrompt}\n\nTu analyses ${successfulResults.length} sources web différentes. Fais une synthèse structurée qui combine les informations de TOUTES les sources.${sportsInstruction}${enrichmentInstruction}`,
            },
            {
              role: "user",
              content: `Tâche: ${homework.title}\n${homework.description || ""}\n\n${combinedContent}${enrichmentContent}`,
            },
          ],
          temperature: wantsEnrichment ? 0.5 : 0.3,
          max_tokens: finalMaxTokens,
        }),
        0,
      );

      let summary = analysisResponse.choices[0].message.content || "";

      summary += `\n\n---\n**Sources analysées (${successfulResults.length}/${urls.length}):**\n`;
      successfulResults.forEach((r, idx) => {
        summary += `${idx + 1}. ${r.title} - ${r.url}\n`;
      });

      if (failedResults.length > 0) {
        summary += `\n**Échecs (${failedResults.length}):** `;
        summary += failedResults
          .map((r) => {
            try {
              const urlObj = new URL(r.url);
              return urlObj.pathname === "/" ? urlObj.hostname : urlObj.hostname + urlObj.pathname;
            } catch {
              return r.url;
            }
          })
          .join(", ");
      }

      return {
        summary,
        artifacts: {
          urls,
          totalUrls: urls.length,
          successCount: successfulResults.length,
          failedCount: failedResults.length,
          sources: successfulResults.map((r) => ({ url: r.url, title: r.title })),
          processed: true,
        },
      };
    } catch (aiError) {
      console.error(`[HomeworkExecution] AI analysis error:`, aiError);
    }
  }

  let summary = `**Contenu extrait de ${successfulResults.length}/${urls.length} sources:**\n\n`;
  successfulResults.forEach((r, idx) => {
    summary += `### ${idx + 1}. ${r.title}\n${r.content?.substring(0, 12000)}...\n\n`;
  });

  return {
    summary,
    artifacts: {
      urls,
      totalUrls: urls.length,
      successCount: successfulResults.length,
      processed: true,
    },
  };
}
