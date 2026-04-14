import { db } from "../db";
import { ulysseHomework, homeworkExecution, users, type UlysseHomework, type HomeworkExecution } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import OpenAI from "openai";
import { canMakeCall, withRateLimit } from "./rateLimiter";
import { searchWeb, formatSearchResultsForAI } from "./websearch";
import { fetchWebsiteWithMedia, formatWebContentWithMediaForAI } from "./webfetch";
import { crawlAndScrape } from "./scraper/core";
import { 
  autoVerifiedScrape, 
  scrapeRankingVerified, 
  scrapeMatchResultsVerified,
  scrapeOddsVerified,
  detectExtractionType,
  extractRankingTable,
  extractTopScorers,
  extractFixtures,
  fetchHtmlForScraper,
  type VerifiedScrapeResult,
  type ExtractionType
} from "./scraper/verified";
import { memoryService } from "./memory";
import { homeworkIntelligence } from "./homeworkIntelligence";
import { traceCollector } from "./traceCollector";
import { injectScrapedDataToFootdatas } from "./footdatasUlysseIntegration";
import * as matchEndirectService from "./matchEndirectService";

// ====== PERFORMANCE: Crawl result cache (2h TTL) - SCOPED BY USER ======
interface CrawlCacheEntry {
  content: string;
  title: string;
  timestamp: number;
}
const crawlCache = new Map<string, CrawlCacheEntry>();
const CRAWL_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
const CRAWL_CACHE_MAX_SIZE = 100;

// Cache key includes userId to prevent cross-user data leakage
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
    crawlCache.delete(key); // Expired
  }
  return null;
}

function setCachedCrawl(userId: number, url: string, content: string, title: string): void {
  const key = getCacheKey(userId, url);
  crawlCache.set(key, { content, title, timestamp: Date.now() });
  // Limit cache size with LRU eviction
  if (crawlCache.size > CRAWL_CACHE_MAX_SIZE) {
    const oldest = Array.from(crawlCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) crawlCache.delete(oldest[0]);
  }
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of crawlCache.entries()) {
    if (now - entry.timestamp > CRAWL_CACHE_TTL) {
      crawlCache.delete(key);
    }
  }
}, 10 * 60 * 1000); // Every 10 minutes

// Helper to get persona name based on user role
async function getPersonaInfo(userId: number): Promise<{ name: string; ownerName: string; userName?: string; isExternal: boolean }> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      // Default to Ulysse for owner (userId 1) or unknown users
      return {
        name: userId === 1 ? "Ulysse" : "Iris",
        ownerName: "Maurice Djedou",
        userName: undefined,
        isExternal: false
      };
    }
    
    const isOwner = user.isOwner || user.role === "admin";
    const isExternal = user.role === "external";
    
    // Determine persona: Ulysse (owner), Alfred (external), Iris (approved family)
    let personaName: string;
    if (isOwner) {
      personaName = "Ulysse";
    } else if (isExternal) {
      personaName = "Max";
    } else {
      personaName = "Iris";
    }
    
    return {
      name: personaName,
      ownerName: "Maurice Djedou",
      userName: user.displayName || undefined,
      isExternal
    };
  } catch (error) {
    console.error("[HomeworkExecution] Failed to get persona info:", error);
    return {
      name: userId === 1 ? "Ulysse" : "Iris",
      ownerName: "Maurice Djedou",
      userName: undefined,
      isExternal: false
    };
  }
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export class HomeworkExecutionService {
  
  // ====== EXTRACT LEAGUE FILTER FROM HOMEWORK INSTRUCTIONS ======
  private extractLeagueFilter(instructions: string): string[] | undefined {
    const instructionsLower = instructions.toLowerCase();
    const leagues: string[] = [];
    
    // Detect Big 5 leagues in instructions
    if (instructionsLower.includes('ligue 1') || instructionsLower.includes("ligue 1 mcdonald")) {
      leagues.push('Ligue 1');
    }
    if (instructionsLower.includes('laliga') || instructionsLower.includes('la liga') || 
        instructionsLower.includes('liga espagnole') || instructionsLower.includes('primera division')) {
      leagues.push('LaLiga');
    }
    if (instructionsLower.includes('premier league') || instructionsLower.includes('premierleague')) {
      leagues.push('Premier League');
    }
    if (instructionsLower.includes('bundesliga')) {
      leagues.push('Bundesliga');
    }
    if (instructionsLower.includes('serie a') || instructionsLower.includes('calcio')) {
      leagues.push('Serie A');
    }
    
    // Only return filter if at least one league was explicitly mentioned
    if (leagues.length > 0) {
      console.log(`[HomeworkExecution] 🎯 League filter detected: [${leagues.join(', ')}]`);
      return leagues;
    }
    
    return undefined; // No filter = return all leagues
  }

  // ====== VERIFIED SCRAPING: Use double-scrape validation for critical data types ======
  private async tryVerifiedScrape(url: string, homeworkTitle: string, homeworkInstructions?: string): Promise<{
    used: boolean;
    verified: boolean;
    type: ExtractionType;
    data?: any;
    summary?: string;
  }> {
    const titleLower = homeworkTitle.toLowerCase();
    const urlLower = url.toLowerCase();
    
    // Extract league filter from instructions
    const leagueFilter = homeworkInstructions ? this.extractLeagueFilter(homeworkInstructions) : undefined;
    
    // ======================= BETTING URL HANDLER =======================
    // Sites de paris (ParionsSport, Winamax, etc.) bloquent le scraping
    // On utilise le cache sportif et le modèle de probabilité à la place
    const bettingUrlPatterns = [
      /parionssport\.fdj\.fr/i,
      /winamax\.fr/i,
      /betclic\.fr/i,
      /unibet\.fr/i,
      /pmu\.fr.*paris/i,
      /zebet\.fr/i,
    ];
    
    const isBettingUrl = bettingUrlPatterns.some(pattern => pattern.test(url));
    
    if (isBettingUrl) {
      console.log(`[HomeworkExecution] 🎰 BETTING URL detected - using cache & predictions: ${url}`);
      try {
        const { probabilityModelService } = await import("./probabilityModelService");
        const { sportsCacheService } = await import("./sportsCacheService");
        
        // Detect competition from URL
        const isChampionsLeague = urlLower.includes('champions') || urlLower.includes('ldc');
        const isEuropaLeague = urlLower.includes('europa');
        const isLigue1 = urlLower.includes('ligue-1') || urlLower.includes('ligue1');
        const isPremierLeague = urlLower.includes('premier-league') || urlLower.includes('premierleague');
        const isLaLiga = urlLower.includes('laliga') || urlLower.includes('la-liga');
        const isSerieA = urlLower.includes('serie-a') || urlLower.includes('seriea');
        const isBundesliga = urlLower.includes('bundesliga');
        
        const competitionName = isChampionsLeague ? 'Champions League' :
                               isEuropaLeague ? 'Europa League' :
                               isLigue1 ? 'Ligue 1' :
                               isPremierLeague ? 'Premier League' :
                               isLaLiga ? 'La Liga' :
                               isSerieA ? 'Serie A' :
                               isBundesliga ? 'Bundesliga' : 'Football';
        
        // Get cached matches and predictions
        let todayMatches = await sportsCacheService.getMatchesForDate(new Date());
        let predictions = await probabilityModelService.analyzeTodayMatches();
        
        // If cache is empty, try to fetch upcoming matches from API-Football
        if (todayMatches.length === 0 && predictions.length === 0) {
          console.log(`[HomeworkExecution] 🎰 Cache empty - fetching upcoming ${competitionName} matches from API`);
          try {
            // Get upcoming matches for next 7 days
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
            const confidence = pred.confidence >= 0.7 ? '🟢 HIGH' : pred.confidence >= 0.5 ? '🟡 MEDIUM' : '🔴 LOW';
            const value = pred.valueBet ? '⭐ VALUE' : '-';
            summary += `| ${pred.homeTeam} vs ${pred.awayTeam} | ${pred.prediction} | ${confidence} | ${value} |\n`;
          }
          summary += '\n';
        }
        
        if (todayMatches.length > 0) {
          summary += `### 📅 Matchs à venir (${todayMatches.length})\n\n`;
          for (const match of todayMatches.slice(0, 15)) {
            const matchDate = match.date ? new Date(match.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '';
            const odds = match.odds ? ` | Cotes: 1=${match.odds.home?.toFixed(2)} X=${match.odds.draw?.toFixed(2)} 2=${match.odds.away?.toFixed(2)}` : '';
            summary += `- ${matchDate} **${match.homeTeam}** vs **${match.awayTeam}**${odds}\n`;
          }
        } else {
          summary += `*Aucun match ${competitionName} trouvé pour les prochains jours.*\n`;
          summary += `*Essayez de demander directement dans le chat pour une recherche plus approfondie.*\n`;
        }
        
        return {
          used: true,
          verified: todayMatches.length > 0 || predictions.length > 0,
          type: 'odds' as ExtractionType,
          data: { predictions, matches: todayMatches },
          summary
        };
      } catch (err) {
        console.error(`[HomeworkExecution] 🎰 Betting URL error:`, err);
        return {
          used: true,
          verified: false,
          type: 'odds' as ExtractionType,
          summary: `## ⚠️ Site de paris protégé\n\nLe site ${url} bloque les accès automatisés.\n\n*Utilisez le chat pour demander les cotes - le système utilisera le cache sportif.*`
        };
      }
    }
    // ======================= END BETTING URL HANDLER =======================
    
    // Detect if this homework needs verified scraping
    // Generic detection: any sports/football URL or sports-related keywords
    const isSportsUrl = 
      urlLower.includes('eurotopteam.com') ||
      urlLower.includes('flashscore') || urlLower.includes('sofascore') ||
      urlLower.includes('livescore') || urlLower.includes('/football/') ||
      urlLower.includes('/soccer/') || urlLower.includes('/standings') ||
      urlLower.includes('/classement');
    
    const hasSportsKeywords = 
      titleLower.includes('classement') || titleLower.includes('ranking') ||
      titleLower.includes('score') || titleLower.includes('résultat') ||
      titleLower.includes('cote') || titleLower.includes('odds') ||
      titleLower.includes('match') || titleLower.includes('buteur') ||
      titleLower.includes('championnat') || titleLower.includes('football') ||
      titleLower.includes('ligue') || titleLower.includes('league') ||
      titleLower.includes('serie') || titleLower.includes('bundesliga') ||
      titleLower.includes('liga') || titleLower.includes('coupe');
    
    const needsVerification = isSportsUrl || hasSportsKeywords ||
      urlLower.includes('classement') || urlLower.includes('standing') ||
      urlLower.includes('score') || urlLower.includes('odds');
    
    if (!needsVerification) {
      return { used: false, verified: false, type: 'unknown' };
    }
    
    // ====== MATCHENDIRECT.FR SPECIAL HANDLING ======
    // Priority: Use matchEndirectService for date-based match data
    const isMatchEndirectUrl = urlLower.includes('matchendirect.fr');
    
    if (isMatchEndirectUrl) {
      console.log(`[HomeworkExecution] 🔴 MATCHENDIRECT.FR PRIORITAIRE détecté: ${url}`);
      
      try {
        // Detect league from URL
        let targetLeague: 'ligue1' | 'laliga' | 'premierLeague' | 'bundesliga' | 'serieA' | null = null;
        if (urlLower.includes('/ligue-1') || urlLower.includes('/france/')) targetLeague = 'ligue1';
        else if (urlLower.includes('/la-liga') || urlLower.includes('/espagne/')) targetLeague = 'laliga';
        else if (urlLower.includes('/premier-league') || urlLower.includes('/angleterre/')) targetLeague = 'premierLeague';
        else if (urlLower.includes('/bundesliga') || urlLower.includes('/allemagne/')) targetLeague = 'bundesliga';
        else if (urlLower.includes('/serie-a') || urlLower.includes('/italie/')) targetLeague = 'serieA';
        
        // Check if URL contains a date (format resultat-foot-DD-MM-YYYY)
        const dateMatch = url.match(/resultat-foot-(\d{2})-(\d{2})-(\d{4})/);
        let dateToFetch: string;
        
        if (dateMatch) {
          // URL already has date
          dateToFetch = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
          console.log(`[HomeworkExecution] 📅 Date extraite de l'URL: ${dateToFetch}`);
        } else {
          // Use today's date for league pages
          const today = new Date();
          const dd = String(today.getDate()).padStart(2, '0');
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const yyyy = today.getFullYear();
          dateToFetch = `${dd}-${mm}-${yyyy}`;
          console.log(`[HomeworkExecution] 📅 Pas de date dans l'URL, utilisation de la date du jour: ${dateToFetch}`);
        }
        
        // Fetch matches via matchEndirectService
        const matchResult = await matchEndirectService.fetchMatchEndirect(dateToFetch);
        
        if (matchResult.big5Matches.length > 0) {
          console.log(`[HomeworkExecution] ✅ MatchEnDirect: ${matchResult.big5Matches.length} matchs Big 5 trouvés pour ${dateToFetch}`);
          
          // *** SYNC → FOOTDATAS SERVICE ***
          try {
            const { footdatasService } = await import("./footdatasService");
            const syncResult = await footdatasService.storeMatchEndirectData(matchResult);
            console.log(`[HomeworkExecution] 📦 FootdatasService sync: ${syncResult.stored} stored, ${syncResult.updated} updated`);
          } catch (syncErr) {
            console.error(`[HomeworkExecution] ⚠️ FootdatasService sync error:`, syncErr);
          }
          
          // Filter by target league if specified
          let matches = matchResult.big5Matches;
          let leagueName = "Big 5";
          
          if (targetLeague && matchResult.byLeague[targetLeague]) {
            matches = matchResult.byLeague[targetLeague];
            const leagueNames: Record<string, string> = {
              ligue1: 'Ligue 1', laliga: 'LaLiga', premierLeague: 'Premier League',
              bundesliga: 'Bundesliga', serieA: 'Serie A'
            };
            leagueName = leagueNames[targetLeague] || targetLeague;
            console.log(`[HomeworkExecution] 🎯 Filtrage par ligue: ${leagueName} (${matches.length} matchs)`);
          }
          
          // Format for context
          const matchLines = matches.map(m => {
            const score = m.homeScore !== null && m.awayScore !== null 
              ? `${m.homeScore}-${m.awayScore}` 
              : 'À venir';
            const statusIcon = m.status === 'terminé' ? '✅' : m.status === 'en cours' ? '🔴' : '⏳';
            return `${statusIcon} ${m.homeTeam} vs ${m.awayTeam}: ${score}${m.time ? ` (${m.time})` : ''}`;
          });
          
          const formattedContent = `
════════════════════════════════════════
📅 MATCHS ${leagueName.toUpperCase()} DU ${matchResult.date}
════════════════════════════════════════
Total: ${matches.length} matchs

${matchLines.join('\n')}

Source: matchendirect.fr (VERIFIED)
════════════════════════════════════════`;
          
          return {
            used: true,
            verified: true,
            type: 'matches' as ExtractionType,
            content: formattedContent,
            summary: `${matches.length} matchs ${leagueName} du ${matchResult.date} (matchendirect.fr)`,
            structuredData: {
              matches: matches,
              date: matchResult.date,
              league: leagueName,
              count: matches.length
            }
          };
        } else {
          console.log(`[HomeworkExecution] ⚠️ MatchEnDirect: 0 matchs trouvés pour ${dateToFetch}`);
        }
      } catch (err) {
        console.error(`[HomeworkExecution] MatchEnDirect error:`, err);
      }
    }
    
    // Special handling for football league pages - extract ALL data (ranking + scorers + fixtures)
    // Generic: any eurotopteam football page or URL with /football/ path
    const isFootballLeaguePage = 
      urlLower.includes('eurotopteam.com/football/') ||
      (urlLower.includes('/football/') && urlLower.endsWith('.php'));
    
    if (isFootballLeaguePage) {
      console.log(`[HomeworkExecution] 🏆 FOOTBALL PAGE detected - extracting ALL data from ${url}`);
      try {
        const html = await fetchHtmlForScraper(url);
        if (html) {
          const ranking = extractRankingTable(html);
          const topScorers = extractTopScorers(html);
          const fixturesData = extractFixtures(html);
          
          console.log(`[HomeworkExecution] ✅ Football data: ${ranking.length} teams, ${topScorers.length} scorers, ${fixturesData.fixtures.length} fixtures`);
          
          // Detect league from URL for FOOTDATAS injection
          let leagueName = "Unknown";
          let leagueCode = "";
          let leagueId: number | undefined;
          if (urlLower.includes('ligue1') || urlLower.includes('ligue-1')) {
            leagueName = "Ligue 1";
            leagueCode = "L1";
            leagueId = 61;
          } else if (urlLower.includes('premierleague') || urlLower.includes('premier-league')) {
            leagueName = "Premier League";
            leagueCode = "PL";
            leagueId = 39;
          } else if (urlLower.includes('laliga') || urlLower.includes('la-liga')) {
            leagueName = "LaLiga";
            leagueCode = "LL";
            leagueId = 140;
          } else if (urlLower.includes('seriea') || urlLower.includes('serie-a')) {
            leagueName = "Serie A";
            leagueCode = "SA";
            leagueId = 135;
          } else if (urlLower.includes('bundesliga')) {
            leagueName = "Bundesliga";
            leagueCode = "BL";
            leagueId = 78;
          }
          
          // ====== INJECT INTO FOOTDATAS ======
          if (leagueCode) {
            try {
              // Inject rankings with competition info
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
                const rankResult = await injectScrapedDataToFootdatas('rankings', rankingData, url);
                console.log(`[HomeworkExecution] 📊 FOOTDATAS: Injected ${rankResult.itemsAdded} rankings, ${rankResult.itemsSkipped} skipped`);
              }
              
              // Inject top scorers
              if (topScorers.length > 0) {
                const scorerData = topScorers.map((s: any) => ({
                  player: s.name,
                  team: s.team,
                  competition: leagueName,
                  goals: s.goals,
                  appearances: s.matches,
                }));
                const scorerResult = await injectScrapedDataToFootdatas('topscorers', scorerData, url);
                console.log(`[HomeworkExecution] ⚽ FOOTDATAS: Injected ${scorerResult.itemsAdded} top scorers`);
              }
            } catch (footdatasError) {
              console.error(`[HomeworkExecution] FOOTDATAS injection error:`, footdatasError);
            }
          }
          
          // *** FIXTURES DISABLED FROM EUROTOPTEAM - USE MATCHENDIRECT.FR EXCLUSIVELY ***
          // matchendirect.fr is the ONLY source for match fixtures data
          // eurotopteam.com is only used for ranking/standings and top scorers
          console.log(`[HomeworkExecution] ⚠️ Fixtures from eurotopteam.com IGNORED - matchendirect.fr is EXCLUSIVE source for matches`);
          
          let summary = '';
          
          // 1. Ranking table
          if (ranking.length > 0) {
            summary += '## 📊 CLASSEMENT\n\n';
            summary += '| # | Équipe | Pts | V | N | D | BP | BC | Diff |\n';
            summary += '|--:|:-------|----:|--:|--:|--:|---:|---:|-----:|\n';
            summary += ranking.slice(0, 20).map((r: any) => {
              const pts = r.points ?? '-';
              const v = r.wins ?? '-';
              const n = r.draws ?? '-';
              const d = r.losses ?? '-';
              const bp = r.goalsFor ?? '-';
              const bc = r.goalsAgainst ?? '-';
              const diff = r.goalDiff ?? (typeof bp === 'number' && typeof bc === 'number' ? bp - bc : '-');
              const diffStr = typeof diff === 'number' ? (diff > 0 ? `+${diff}` : `${diff}`) : diff;
              return `| ${r.position} | ${r.name} | ${pts} | ${v} | ${n} | ${d} | ${bp} | ${bc} | ${diffStr} |`;
            }).join('\n');
            summary += '\n\n';
          }
          
          // 2. Top scorers
          if (topScorers.length > 0) {
            summary += '## ⚽ MEILLEURS BUTEURS\n\n';
            summary += '| # | Joueur | Club | Buts |\n';
            summary += '|--:|:-------|:-----|-----:|\n';
            summary += topScorers.slice(0, 15).map((s: any) => 
              `| ${s.position} | ${s.name} | ${s.team || '-'} | ${s.goals} |`
            ).join('\n');
            summary += '\n\n';
          }
          
          // *** FIXTURES DISPLAY DISABLED - USE MATCHENDIRECT.FR DATA ONLY ***
          // 3. Current/upcoming fixtures removed from eurotopteam.com output
          // Match data comes EXCLUSIVELY from matchendirect.fr
          summary += '\n📅 Pour les matchs du jour, consulter matchendirect.fr\n';
          
          if (summary.trim()) {
            return { 
              used: true, 
              verified: true, 
              type: 'ranking', 
              data: { ranking, topScorers, fixtures: fixturesData }, 
              summary: summary.trim()
            };
          }
        }
      } catch (error) {
        console.error(`[HomeworkExecution] Football page extraction error:`, error);
        // Fall through to regular scraping
      }
    }
    
    console.log(`[HomeworkExecution] Using VERIFIED SCRAPER for: ${url}${leagueFilter ? ` (filter: ${leagueFilter.join(', ')})` : ''}`);
    
    try {
      const { type, result } = await autoVerifiedScrape(url, undefined, { maxAttempts: 2, leagueFilter });
      
      if (result.verified && result.ok && result.data) {
        console.log(`[HomeworkExecution] ✅ VERIFIED data extracted: type=${type}, items=${Array.isArray(result.data) ? result.data.length : 1}`);
        
        // Format execution timestamp (Paris timezone)
        const execDate = new Date().toLocaleString('fr-FR', { 
          timeZone: 'Europe/Paris', 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        
        // Format verified data as summary with execution date at top
        let summary = `📅 **Exécution: ${execDate}**\n\n[DONNÉES VÉRIFIÉES - ${type.toUpperCase()}]\n`;
        
        // FULL FOOTBALL PAGE: Display fixtures, ranking, and top scorers
        if (type === 'football_page' && result.data) {
          const data = result.data as { ranking: any[]; topScorers: any[]; fixtures: { matchday?: number; fixtures: any[] } };
          
          // 1. FIXTURES TABLE (Current matchday)
          if (data.fixtures?.fixtures?.length > 0) {
            const matchday = data.fixtures.matchday || '?';
            summary += `\n⚽ **JOURNÉE ${matchday}**\n`;
            summary += '| Domicile | | Score | | Extérieur |\n';
            summary += '|:---------|:-:|:-----:|:-:|:----------|\n';
            summary += data.fixtures.fixtures.slice(0, 15).map((f: any) => {
              const homeScore = f.homeScore !== undefined ? f.homeScore : '-';
              const awayScore = f.awayScore !== undefined ? f.awayScore : '-';
              return `| ${f.homeTeam} | | ${homeScore} - ${awayScore} | | ${f.awayTeam} |`;
            }).join('\n');
            summary += '\n';
          }
          
          // 2. RANKING TABLE
          if (data.ranking?.length > 0) {
            summary += '\n📊 **CLASSEMENT**\n';
            summary += '| # | Équipe | Pts | V | N | D | BP | BC | Diff |\n';
            summary += '|--:|:-------|----:|--:|--:|--:|---:|---:|-----:|\n';
            summary += data.ranking.slice(0, 20).map((r: any) => {
              const stats = r.stats || {};
              const pts = r.points ?? r.score ?? stats.Pts ?? '-';
              const v = stats.V ?? stats.wins ?? r.wins ?? '-';
              const n = stats.N ?? stats.draws ?? r.draws ?? '-';
              const d = stats.D ?? stats.losses ?? r.losses ?? '-';
              const bp = stats.BP ?? stats.goalsFor ?? r.goalsFor ?? '-';
              const bc = stats.BC ?? stats.goalsAgainst ?? r.goalsAgainst ?? '-';
              const diff = stats.Diff ?? r.goalDiff ?? (typeof bp === 'number' && typeof bc === 'number' ? bp - bc : '-');
              const diffStr = typeof diff === 'number' ? (diff > 0 ? `+${diff}` : `${diff}`) : diff;
              return `| ${r.position} | ${r.name} | ${pts} | ${v} | ${n} | ${d} | ${bp} | ${bc} | ${diffStr} |`;
            }).join('\n');
            summary += '\n';
          }
          
          // 3. TOP SCORERS (shortened)
          if (data.topScorers?.length > 0) {
            summary += '\n🥇 **MEILLEURS BUTEURS**\n';
            summary += data.topScorers.slice(0, 5).map((s: any) => 
              `${s.position}. ${s.name}${s.team ? ` (${s.team})` : ''} - ${s.goals} buts`
            ).join('\n');
          }
        } else if (type === 'ranking' && Array.isArray(result.data)) {
          // Format as full markdown table with all stats
          summary += '| # | Équipe | Pts | V | N | D | BP | BC | Diff |\n';
          summary += '|--:|:-------|----:|--:|--:|--:|---:|---:|-----:|\n';
          summary += result.data.slice(0, 20).map((r: any) => {
            const stats = r.stats || {};
            const pts = r.points ?? r.score ?? stats.Pts ?? '-';
            const v = stats.V ?? stats.wins ?? r.wins ?? '-';
            const n = stats.N ?? stats.draws ?? r.draws ?? '-';
            const d = stats.D ?? stats.losses ?? r.losses ?? '-';
            const bp = stats.BP ?? stats.goalsFor ?? r.goalsFor ?? '-';
            const bc = stats.BC ?? stats.goalsAgainst ?? r.goalsAgainst ?? '-';
            const diff = stats.Diff ?? r.goalDiff ?? (typeof bp === 'number' && typeof bc === 'number' ? bp - bc : '-');
            const diffStr = typeof diff === 'number' ? (diff > 0 ? `+${diff}` : `${diff}`) : diff;
            return `| ${r.position} | ${r.name} | ${pts} | ${v} | ${n} | ${d} | ${bp} | ${bc} | ${diffStr} |`;
          }).join('\n');
        } else if (type === 'matches' && Array.isArray(result.data)) {
          // Show ALL matches in a clear table format
          const matchCount = result.data.length;
          summary += `## ⚽ RÉSULTATS DES MATCHS (${matchCount})\n\n`;
          summary += '| Domicile | Score | Extérieur |\n';
          summary += '|:---------|:-----:|:----------|\n';
          summary += result.data.map((m: any) => {
            const homeScore = m.homeScore !== undefined ? m.homeScore : '-';
            const awayScore = m.awayScore !== undefined ? m.awayScore : '-';
            return `| **${m.homeTeam}** | ${homeScore} - ${awayScore} | ${m.awayTeam} |`;
          }).join('\n');
        } else if (type === 'odds' && Array.isArray(result.data)) {
          // Show ALL odds in a clear table format with league column
          const oddsCount = result.data.length;
          summary += `## 🎰 COTES DES MATCHS (${oddsCount})\n\n`;
          summary += '| Ligue | Match | 1 (Dom) | N (Nul) | 2 (Ext) | Bookmaker |\n';
          summary += '|:------|:------|:-------:|:-------:|:-------:|:----------|\n';
          summary += result.data.map((o: any) => {
            const home = o.homeOdds ? o.homeOdds.toFixed(2) : '-';
            const draw = o.drawOdds ? o.drawOdds.toFixed(2) : '-';
            const away = o.awayOdds ? o.awayOdds.toFixed(2) : '-';
            const bookmaker = o.bookmaker || '-';
            const league = o.league || '-';
            return `| ${league} | **${o.homeTeam}** vs ${o.awayTeam} | ${home} | ${draw} | ${away} | ${bookmaker} |`;
          }).join('\n');
        } else if (type === 'topscorers' && Array.isArray(result.data)) {
          // Show ALL top scorers in a clear table format
          const scorerCount = result.data.length;
          summary += `## ⚽ MEILLEURS BUTEURS (${scorerCount})\n\n`;
          summary += '| # | Joueur | Club | Buts |\n';
          summary += '|--:|:-------|:-----|-----:|\n';
          summary += result.data.map((s: any) => 
            `| ${s.position} | **${s.name}** | ${s.team || '-'} | ${s.goals} |`
          ).join('\n');
        } else {
          summary += JSON.stringify(result.data, null, 2).substring(0, 2000);
        }
        
        return { 
          used: true, 
          verified: true, 
          type, 
          data: result.data, 
          summary 
        };
      } else {
        console.warn(`[HomeworkExecution] ⚠️ Verified scrape FAILED: attempts=${result.attempts}, diffs=${result.diffs?.join(', ')}`);
        return { 
          used: true, 
          verified: false, 
          type,
          summary: `[DONNÉES NON VÉRIFIÉES - ${type}] Les extractions ne correspondaient pas. Différences: ${result.diffs?.slice(0, 3).join('; ') || 'N/A'}`
        };
      }
    } catch (error) {
      console.error(`[HomeworkExecution] Verified scrape error:`, error);
      return { used: true, verified: false, type: 'unknown' };
    }
  }
  
  // META-PROMPTING: Generate an optimized, task-specific prompt with intelligent caching
  private async generateOptimizedPrompt(homework: UlysseHomework, taskType: "research" | "url_fetch" | "generic", personaName: string): Promise<string> {
    const taskContext = `${homework.title}\n${homework.description || ""}`;
    
    const personaStyles: Record<string, string> = {
      "Ulysse": "Tutoie l'utilisateur (Maurice), ton sarcastique mais bienveillant, efficace et direct",
      "Iris": "Tutoie l'utilisateur (famille), ton chaleureux et attentionné, style encourageant",
      "Max": "Vouvoie TOUJOURS l'utilisateur, ton professionnel de majordome britannique, courtois et respectueux"
    };
    
    const personaStyle = personaStyles[personaName] || personaStyles["Iris"];
    
    const generateNewPrompt = async (): Promise<string> => {
      try {
        if (!canMakeCall("combined")) {
          return this.getDefaultPrompt(taskType, personaName);
        }
        
        const response = await withRateLimit("combined", () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Tu es un expert en ingénierie de prompts. Génère un prompt système UNIQUE et OPTIMISÉ pour que ${personaName} accomplisse cette tâche avec excellence.

PERSONA ${personaName.toUpperCase()}:
${personaStyle}

RÈGLES:
- Le prompt doit être en français
- Maximum 150 mots
- Inclure le rôle précis, le ton conforme au persona, le format de sortie attendu
- Adapter au type de tâche: ${taskType === "research" ? "recherche/analyse d'informations" : taskType === "url_fetch" ? "extraction et synthèse de contenu web" : "préparation de tâche"}
- Spécifier les critères de qualité attendus
- Ne PAS inclure la tâche elle-même, seulement les instructions
- RESPECTER IMPÉRATIVEMENT le style du persona (tutoiement/vouvoiement)

🚨 RÈGLE CRITIQUE ANTI-HALLUCINATION 🚨
Le prompt DOIT INCLURE cette instruction: "INTERDICTION ABSOLUE d'inventer des données. Extraire UNIQUEMENT ce qui est explicitement présent dans le contenu source. Si données manquantes: répondre 'DONNÉES NON DISPONIBLES'."`
              },
              {
                role: "user",
                content: `Tâche à accomplir: "${taskContext}"\n\nGénère le prompt système optimal pour cette tâche spécifique, adapté au style de ${personaName}.`
              }
            ],
            temperature: 0.7,
            max_tokens: 250,
          }),
          0
        );
        
        const generatedPrompt = response.choices[0].message.content;
        if (generatedPrompt && generatedPrompt.length > 50) {
          console.log(`[HomeworkExecution] Generated optimized prompt (${generatedPrompt.length} chars)`);
          return generatedPrompt;
        }
        
        return this.getDefaultPrompt(taskType, personaName);
      } catch (error) {
        console.error("[HomeworkExecution] Failed to generate optimized prompt:", error);
        return this.getDefaultPrompt(taskType, personaName);
      }
    };
    
    return homeworkIntelligence.getOrGenerateOptimizedPrompt(
      homework,
      taskType,
      personaName,
      generateNewPrompt
    );
  }
  
  private getDefaultPrompt(taskType: "research" | "url_fetch" | "generic", personaName: string): string {
    // Persona-specific tone instructions
    const toneInstruction = personaName === "Max" 
      ? "Vouvoie l'utilisateur avec un ton professionnel de majordome."
      : personaName === "Ulysse"
      ? "Tutoie Maurice avec un ton direct et efficace."
      : "Tutoie l'utilisateur avec un ton chaleureux.";
    
    // CRITICAL: Anti-hallucination instruction - NEVER invent data
    const antiHallucinationRule = `

🚨🚨🚨 RÈGLE ABSOLUE - ZÉRO INVENTION 🚨🚨🚨
- Tu ne peux extraire QUE les données EXPLICITEMENT présentes dans le contenu fourni.
- Si une information n'est PAS dans le contenu: réponds "DONNÉES NON DISPONIBLES" pour cette partie.
- INTERDICTION TOTALE d'inventer des classements, scores, points, statistiques, noms d'équipes ou de joueurs.
- Si le crawl a échoué ou le contenu est vide/minimal: dis clairement "Je n'ai pas pu récupérer les données de ce site".
- Mieux vaut une réponse incomplète que des données FAUSSES.
- Chaque chiffre/classement que tu donnes DOIT être copié du contenu source, pas généré.`;
    
    switch (taskType) {
      case "research":
        return `Tu es ${personaName}, l'assistant personnel. ${toneInstruction} Résume les résultats de recherche de manière concise et utile. Maximum 3 paragraphes.${antiHallucinationRule}`;
      case "url_fetch":
        return `Tu es ${personaName}, l'assistant personnel. ${toneInstruction} Analyse le contenu de ce site web et fournis un résumé utile et structuré. Maximum 500 mots.${antiHallucinationRule}`;
      case "generic":
        return `Tu es ${personaName}, l'assistant personnel. ${toneInstruction} Prépare cette tâche en détail avec des explications pratiques.${antiHallucinationRule}`;
    }
  }
  
  async executeHomework(userId: number, homework: UlysseHomework, triggeredBy: "auto" | "manual" | "daily" = "auto"): Promise<HomeworkExecution | null> {
    try {
      const urgency = await homeworkIntelligence.detectUrgency(homework);
      console.log(`[HomeworkExecution] Starting execution for homework ${homework.id}: "${homework.title}" (urgency: ${urgency})`);

      const traceId = traceCollector.startTrace({
        userId,
        agent: "ulysse",
        model: "auto",
        query: `[Devoir] ${homework.title}`,
        domain: "homework",
        source: `homework_${triggeredBy}`,
      });

      const [execution] = await db.insert(homeworkExecution).values({
        homeworkId: homework.id,
        userId,
        triggeredBy,
        status: "running",
      }).returning();

      homeworkIntelligence.startExecution(execution.id);

      await db.update(ulysseHomework)
        .set({ status: "in_progress" })
        .where(and(eq(ulysseHomework.id, homework.id), eq(ulysseHomework.userId, userId)));

      try {
        const startTime = Date.now();
        const result = await this.performTask(userId, homework);
        const durationMs = Date.now() - startTime;

        const [completed] = await db.update(homeworkExecution)
          .set({
            status: "completed",
            completedAt: new Date(),
            resultSummary: result.summary,
            artifacts: result.artifacts,
          })
          .where(eq(homeworkExecution.id, execution.id))
          .returning();

        await homeworkIntelligence.endExecution(execution.id, true);
        
        const taskType = this.detectTaskTypeFromHomework(homework);
        const persona = await getPersonaInfo(userId);
        await homeworkIntelligence.updatePromptScore(homework, taskType, persona.name, true, {
          responseLength: result.summary?.length || 0,
          hasStructure: result.summary?.includes("\n") || false,
          completedFast: durationMs < 30000
        });

        const newStatus = homework.recurrence && homework.recurrence !== "none" ? "pending" : "completed";
        
        await db.update(ulysseHomework)
          .set({ 
            status: newStatus,
            lastExecutedAt: new Date(),
            notes: result.summary?.substring(0, 10000) || homework.notes,
          })
          .where(and(eq(ulysseHomework.id, homework.id), eq(ulysseHomework.userId, userId)));

        traceCollector.endTrace(traceId, {
          response: result.summary?.slice(0, 5000),
          status: "completed",
          metadata: { homeworkId: homework.id, executionId: execution.id, durationMs, triggeredBy },
        }).catch(() => {});

        console.log(`[HomeworkExecution] Completed homework ${homework.id} in ${durationMs}ms`);
        return completed;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[HomeworkExecution] Failed homework ${homework.id}:`, errorMessage);

        await homeworkIntelligence.endExecution(execution.id, false);
        await homeworkIntelligence.recordFailure(homework, error instanceof Error ? error : errorMessage, execution);
        
        const taskType = this.detectTaskTypeFromHomework(homework);
        const persona = await getPersonaInfo(userId);
        await homeworkIntelligence.updatePromptScore(homework, taskType, persona.name, false, {
          responseLength: 0,
          hasStructure: false,
          completedFast: false
        });

        await db.update(homeworkExecution)
          .set({
            status: "failed",
            completedAt: new Date(),
            error: errorMessage,
          })
          .where(eq(homeworkExecution.id, execution.id));

        await db.update(ulysseHomework)
          .set({ status: "pending" })
          .where(and(eq(ulysseHomework.id, homework.id), eq(ulysseHomework.userId, userId)));

        traceCollector.endTrace(traceId, {
          status: "error",
          errorMessage: errorMessage,
          metadata: { homeworkId: homework.id, executionId: execution.id, triggeredBy },
        }).catch(() => {});

        return null;
      }
    } catch (error) {
      console.error(`[HomeworkExecution] Error creating execution record:`, error);
      return null;
    }
  }

  private detectTaskTypeFromHomework(homework: UlysseHomework): "research" | "url_fetch" | "generic" {
    const content = `${homework.title} ${homework.description || ""}`.toLowerCase();
    if (content.includes("http") || content.includes("www") || content.includes(".com")) return "url_fetch";
    if (content.includes("recherche") || content.includes("cherche") || content.includes("trouve")) return "research";
    return "generic";
  }

  private async performTask(userId: number, homework: UlysseHomework): Promise<{ summary: string; artifacts: any }> {
    const taskContent = `${homework.title}\n${homework.description || ""}`;
    const taskContentLower = taskContent.toLowerCase();
    const persona = await getPersonaInfo(userId);
    
    // Check for direct URL fetch first - now handles MULTIPLE URLs
    const detectedUrls = this.detectUrls(taskContent);
    if (detectedUrls.length > 0 && canMakeCall("combined")) {
      console.log(`[HomeworkExecution] Processing ${detectedUrls.length} URL(s)`);
      return await this.executeMultiUrlFetchTask(userId, homework, detectedUrls, persona.name);
    }
    
    const isResearchTask = this.detectTaskType(taskContentLower);
    
    if (isResearchTask.needsWebSearch && canMakeCall("combined")) {
      return await this.executeResearchTask(userId, homework, isResearchTask.searchQuery, persona.name);
    }
    
    return await this.executeGenericTask(userId, homework, persona.name, persona.userName);
  }

  private detectUrls(content: string): string[] {
    // Pre-process: join URLs split across lines (common copy-paste issue)
    // Pattern: URL part ending with hyphen or path, followed by newline and continuation
    let cleanedContent = content;
    
    // Join URLs broken at hyphens: "coupes-d-\neurope" -> "coupes-d-europe"
    cleanedContent = cleanedContent.replace(/(https?:\/\/[^\s\n]*-)[\r\n]+([a-zA-Z0-9])/gi, '$1$2');
    
    // Join URLs broken at slashes: "paris-football/\ncoupes" -> "paris-football/coupes"
    cleanedContent = cleanedContent.replace(/(https?:\/\/[^\s\n]*\/)[\r\n]+([a-zA-Z0-9])/gi, '$1$2');
    
    // Match URLs with http/https OR www. prefix - supports multiple subdomains like enligne.parionssport.fdj.fr
    // Pattern: protocol + optional www + multiple subdomains + domain + TLD + optional path
    const urlPattern = /(?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?:\/[^\s\n)]*)?/gi;
    const matches = cleanedContent.match(urlPattern);
    if (matches && matches.length > 0) {
      // Deduplicate and normalize all URLs
      const uniqueUrls = [...new Set(matches.map(url => {
        // Clean trailing punctuation
        url = url.replace(/[),;.]+$/, '');
        // Ensure URL has protocol
        if (!url.startsWith('http')) {
          url = `https://${url}`;
        }
        return url;
      }))];
      console.log(`[HomeworkExecution] Detected ${uniqueUrls.length} unique URL(s):`, uniqueUrls);
      return uniqueUrls;
    }
    return [];
  }

  private detectTaskType(content: string): { needsWebSearch: boolean; searchQuery: string } {
    const searchKeywords = [
      "recherche", "cherche", "trouve", "infos", "information",
      "actualité", "news", "presse", "article", "consulte",
      "vérifie", "analyse", "compare", "liste", "prix",
      "météo", "horaire", "adresse", "contact", "site"
    ];
    
    const needsWebSearch = searchKeywords.some(keyword => content.includes(keyword));
    
    let searchQuery = content
      .replace(/consulte|recherche|cherche|trouve|vérifie/gi, "")
      .trim()
      .substring(0, 100);
    
    return { needsWebSearch, searchQuery };
  }

  private async executeUrlFetchTask(userId: number, homework: UlysseHomework, url: string, personaName: string = "Ulysse"): Promise<{ summary: string; artifacts: any }> {
    try {
      console.log(`[HomeworkExecution] Crawling URL via SUPER ULYSSE Scraper: ${url}`);
      
      // ====== PRIORITY: Try verified scraping for critical data types (rankings, scores, odds) ======
      const verifiedResult = await this.tryVerifiedScrape(url, homework.title, homework.instructions);
      
      if (verifiedResult.used && verifiedResult.verified && verifiedResult.summary) {
        console.log(`[HomeworkExecution] ✅ Using VERIFIED data for homework: ${homework.title}`);
        
        // Store verified data in memory for future reference
        try {
          await memoryService.updateOrCreateMemory(
            userId,
            'sports_verified',
            `verified_${verifiedResult.type}_${homework.id}`,
            verifiedResult.summary.substring(0, 1500),
            `homework:${homework.id}:verified`,
            { verified: true, data: verifiedResult.data }
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
            data: verifiedResult.data 
          }
        };
      }
      
      if (verifiedResult.used && !verifiedResult.verified) {
        console.warn(`[HomeworkExecution] ⚠️ Verified scrape attempted but FAILED, falling back to standard scrape`);
      }
      
      // ====== FALLBACK: Standard scraping ======
      // Detect if this needs JavaScript rendering (Flashscore, Transfermarkt, etc.)
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
          artifacts: { url, error: errorMsg, processed: false, modeUsed: scrapeResult.modeUsed }
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
        media: undefined
      };
      
      const webContent = formatWebContentWithMediaForAI(fetchResult);
      
      // Analyze the content with AI using META-PROMPTING
      if (canMakeCall("combined")) {
        const optimizedPrompt = await this.generateOptimizedPrompt(homework, "url_fetch", personaName);
        console.log(`[HomeworkExecution] Using optimized prompt for URL fetch`);
        
        const taskDesc = `${homework.title} ${homework.description || ""}`.toLowerCase();
        const wantsEnrichment = /apprends|enseigne|explique|davantage|détail|approfondi|teach|learn|paracha|parasha|torah/i.test(taskDesc);
        let enrichmentContent = "";
        
        if (wantsEnrichment && canMakeCall("combined")) {
          const parashaMatch = fetchResult.content.match(/(?:paracha|parasha|parashat)\s+([A-Za-zÀ-ÿ'-]+(?:\s+[A-Za-zÀ-ÿ'-]+)?)/i);
          const parashaName = parashaMatch ? parashaMatch[1].replace(/[<>\/\[\]{}()]/g, '').trim() : null;
          if (parashaName) {
            console.log(`[HomeworkExecution] Enrichment (single-URL): generating teaching for paracha "${parashaName}"`);
            try {
              const teachResp = await withRateLimit("combined", () =>
                openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [
                    { role: "system", content: "Tu es un érudit en Torah. Fournis un enseignement COMPLET et DÉTAILLÉ sur la paracha en français." },
                    { role: "user", content: `Cours complet sur la paracha ${parashaName}: résumé détaillé, thèmes, enseignements pratiques, commentaire de Rachi, midrash, et lien avec la vie moderne.` }
                  ],
                  temperature: 0.5,
                  max_tokens: 2000,
                }),
                0
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
                content: optimizedPrompt + (wantsEnrichment ? `\n\nIMPORTANT: L'utilisateur veut APPRENDRE. Ne te contente pas d'extraire les données brutes. Fournis une réponse RICHE et ÉDUCATIVE. Si c'est une paracha, explique le résumé, les thèmes principaux, les enseignements et les leçons pratiques. Utilise les données du site ET tes connaissances pour enrichir la réponse.` : "")
              },
              {
                role: "user",
                content: `Tâche: ${homework.title}\n${homework.description || ""}\n\n${webContent}${enrichmentContent}`
              }
            ],
            temperature: wantsEnrichment ? 0.5 : 0.3,
            max_tokens: maxTokens,
          }),
          0
        );
        
        return {
          summary: analysisResponse.choices[0].message.content || `Contenu récupéré de ${url}`,
          artifacts: { 
            url, 
            title: fetchResult.title,
            contentLength: fetchResult.content.length,
            processed: true,
            enriched: wantsEnrichment
          }
        };
      }
      
      // Fallback: just return extracted content
      return {
        summary: `Contenu extrait de ${url}:\n\n**${fetchResult.title}**\n\n${fetchResult.content.substring(0, 1000)}...`,
        artifacts: { 
          url, 
          title: fetchResult.title,
          contentLength: fetchResult.content.length,
          processed: true 
        }
      };
      
    } catch (error) {
      console.error(`[HomeworkExecution] URL fetch error:`, error);
      return {
        summary: `Erreur lors de l'accès à ${url}: ${error instanceof Error ? error.message : String(error)}`,
        artifacts: { url, error: String(error), processed: false }
      };
    }
  }

  // OPTIMIZED: Process MULTIPLE URLs with CACHE + PARALLELIZATION (2 concurrent)
  private async executeMultiUrlFetchTask(userId: number, homework: UlysseHomework, urls: string[], personaName: string = "Ulysse"): Promise<{ summary: string; artifacts: any }> {
    console.log(`[HomeworkExecution] Starting OPTIMIZED MULTI-URL fetch for ${urls.length} URLs`);
    
    const results: Array<{ url: string; success: boolean; title?: string; content?: string; error?: string; fromCache?: boolean }> = [];
    
    // STEP 1: Check cache first - instant results (scoped by userId for security)
    const uncachedUrls: string[] = [];
    for (const url of urls) {
      const cached = getCachedCrawl(userId, url);
      if (cached) {
        results.push({
          url,
          success: true,
          title: cached.title,
          content: cached.content,
          fromCache: true
        });
      } else {
        uncachedUrls.push(url);
      }
    }
    
    const cacheHits = results.length;
    console.log(`[HomeworkExecution] Cache: ${cacheHits}/${urls.length} hits, ${uncachedUrls.length} to crawl`);
    
    // STEP 2: Process uncached URLs in PARALLEL batches of 2
    const BATCH_SIZE = 2;
    for (let batchStart = 0; batchStart < uncachedUrls.length; batchStart += BATCH_SIZE) {
      const batch = uncachedUrls.slice(batchStart, batchStart + BATCH_SIZE);
      console.log(`[HomeworkExecution] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: Processing ${batch.length} URLs in parallel`);
      
      const batchResults = await Promise.all(batch.map(async (url, idx) => {
        const globalIdx = batchStart + idx + 1;
        console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] Processing via SUPER ULYSSE: ${url}`);
        
        try {
          // ====== PRIORITY: Try verified scraping first for rankings/scores/odds URLs ======
          const verifiedResult = await this.tryVerifiedScrape(url, homework.title, homework.instructions);
          
          // If handler was used (betting URL or sports URL), use its result
          if (verifiedResult.used && verifiedResult.summary) {
            if (verifiedResult.verified) {
              console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] ✅ VERIFIED data extracted`);
              
              // Store verified data in memory
              try {
                await memoryService.updateOrCreateMemory(
                  userId,
                  'sports_verified',
                  `verified_${verifiedResult.type}_${homework.id}_${globalIdx}`,
                  verifiedResult.summary.substring(0, 1500),
                  `homework:${homework.id}:verified:${globalIdx}`,
                  { verified: true, data: verifiedResult.data }
                );
              } catch (memErr) {
                console.warn(`[HomeworkExecution] Failed to store multi-URL verified data:`, memErr);
              }
            } else {
              console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] 🎰 Handler used (no matches available)`);
            }
            
            // Return handler result directly (no fallback to scraping for betting sites)
            return {
              url,
              success: true,
              title: verifiedResult.verified ? `[VÉRIFIÉ] ${verifiedResult.type}` : `[🎰] ${verifiedResult.type}`,
              content: verifiedResult.content || verifiedResult.summary,  // Use full content, fallback to summary
              verified: verifiedResult.verified
            };
          }
          
          if (verifiedResult.used && !verifiedResult.summary) {
            console.log(`[HomeworkExecution] [${globalIdx}/${uncachedUrls.length}] ⚠️ Handler failed, fallback to standard`);
          }
          
          // ====== FALLBACK: Standard scraping ======
          // Detect if this needs JavaScript rendering
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
            // Cache successful crawl (scoped by userId for security)
            setCachedCrawl(userId, url, page.text || "", page.metadata?.title || url);
            return {
              url,
              success: true,
              title: page.metadata?.title || url,
              content: page.text || ""
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
      }));
      
      results.push(...batchResults);
      
      // Small delay between batches (not individual URLs)
      if (batchStart + BATCH_SIZE < uncachedUrls.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Count successful fetches
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    
    console.log(`[HomeworkExecution] Completed: ${successfulResults.length}/${urls.length} URLs successful`);
    
    if (successfulResults.length === 0) {
      return {
        summary: `Impossible d'accéder aux ${urls.length} URLs demandées. Sites potentiellement bloqués ou utilisant JavaScript complexe.`,
        artifacts: { urls, totalUrls: urls.length, successCount: 0, errors: failedResults }
      };
    }
    
    // Combine all content for AI analysis
    // Use 12000 chars per source to capture full sports rankings (menus/navigation are often first 2000 chars)
    const combinedContent = successfulResults.map((r, idx) => 
      `\n---\n## SOURCE ${idx + 1}: ${r.title}\n**URL:** ${r.url}\n\n${r.content?.substring(0, 12000) || ""}`
    ).join("\n");
    
    // Generate combined summary with AI
    if (canMakeCall("combined")) {
      try {
        const optimizedPrompt = await this.generateOptimizedPrompt(homework, "url_fetch", personaName);
        
        // Detect enrichment request (user wants to LEARN, not just extract data)
        const taskFullText = `${homework.title} ${homework.description || ""}`;
        const wantsEnrichment = /apprends|enseigne|explique|davantage|détail|approfondi|teach|learn|paracha|parasha|torah/i.test(taskFullText);
        let enrichmentContent = "";
        
        if (wantsEnrichment) {
          console.log(`[HomeworkExecution] Enrichment mode detected for "${homework.title}"`);
          const allContent = successfulResults.map(r => r.content || "").join(" ");
          const parashaMatch = allContent.match(/(?:paracha|parasha|parashat)\s+([A-Za-zÀ-ÿ'-]+(?:\s+[A-Za-zÀ-ÿ'-]+)?)/i);
          const parashaName = parashaMatch ? parashaMatch[1].replace(/[<>\/\[\]{}()]/g, '').trim() : null;
          
          if (parashaName && canMakeCall("combined")) {
            console.log(`[HomeworkExecution] Enrichment: generating deep teaching about paracha "${parashaName}" via OpenAI`);
            try {
              const teachingResponse = await withRateLimit("combined", () =>
                openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [
                    { role: "system", content: `Tu es un érudit en Torah, spécialiste des textes bibliques et de leurs commentaires. Tu dois fournir un enseignement COMPLET et DÉTAILLÉ sur la paracha demandée en français. Ton cours doit être riche, captivant et accessible.` },
                    { role: "user", content: `Fais-moi un cours complet sur la paracha ${parashaName}. Inclus OBLIGATOIREMENT:\n\n1. 📖 RÉSUMÉ DÉTAILLÉ: L'histoire complète avec les personnages, les événements clés, les dialogues importants\n2. 🎯 THÈMES PRINCIPAUX: Les grands messages spirituels et moraux\n3. 💡 ENSEIGNEMENTS PRATIQUES: Les leçons concrètes pour la vie quotidienne\n4. 📚 COMMENTAIRE DE RACHI: Au moins un commentaire célèbre de Rachi sur cette paracha\n5. 🌟 ANECDOTE OU MIDRASH: Une histoire ou un midrash lié à cette paracha\n6. 🔗 LIEN AVEC LA VIE MODERNE: Comment appliquer ces enseignements aujourd'hui` }
                  ],
                  temperature: 0.5,
                  max_tokens: 2000,
                }),
                0
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
        
        // Detect if this is a sports ranking/classement task
        const isSportsClassement = /classement|ranking|standings|buteur|scorer|tabella|table|ligue|serie|league|bundesliga/i.test(taskFullText);
        
        // Special instruction for sports rankings: extract COMPLETE data with ANTI-HALLUCINATION
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
        
        const finalMaxTokens = wantsEnrichment ? 3000 : (isSportsClassement ? 4000 : 2000);
        
        const analysisResponse = await withRateLimit("combined", () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `${optimizedPrompt}\n\nTu analyses ${successfulResults.length} sources web différentes. Fais une synthèse structurée qui combine les informations de TOUTES les sources.${sportsInstruction}${enrichmentInstruction}`
              },
              {
                role: "user",
                content: `Tâche: ${homework.title}\n${homework.description || ""}\n\n${combinedContent}${enrichmentContent}`
              }
            ],
            temperature: wantsEnrichment ? 0.5 : 0.3,
            max_tokens: finalMaxTokens,
          }),
          0
        );
        
        let summary = analysisResponse.choices[0].message.content || "";
        
        // Add source list at the end
        summary += `\n\n---\n**Sources analysées (${successfulResults.length}/${urls.length}):**\n`;
        successfulResults.forEach((r, idx) => {
          summary += `${idx + 1}. ${r.title} - ${r.url}\n`;
        });
        
        if (failedResults.length > 0) {
          summary += `\n**Échecs (${failedResults.length}):** `;
          // Show full path, not just domain
          summary += failedResults.map(r => {
            try {
              const urlObj = new URL(r.url);
              return urlObj.pathname === '/' ? urlObj.hostname : urlObj.hostname + urlObj.pathname;
            } catch {
              return r.url;
            }
          }).join(', ');
        }
        
        return {
          summary,
          artifacts: {
            urls,
            totalUrls: urls.length,
            successCount: successfulResults.length,
            failedCount: failedResults.length,
            sources: successfulResults.map(r => ({ url: r.url, title: r.title })),
            processed: true
          }
        };
      } catch (aiError) {
        console.error(`[HomeworkExecution] AI analysis error:`, aiError);
      }
    }
    
    // Fallback: return raw combined content
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
        processed: true
      }
    };
  }

  private async executeResearchTask(userId: number, homework: UlysseHomework, searchQuery: string, personaName: string = "Ulysse"): Promise<{ summary: string; artifacts: any }> {
    try {
      const query = searchQuery || homework.title;
      console.log(`[HomeworkExecution] Performing web search for: "${query}"`);
      
      const searchResponse = await searchWeb(query);
      
      if (!searchResponse.success || searchResponse.results.length === 0) {
        return {
          summary: `Recherche effectuée pour "${homework.title}" mais aucun résultat trouvé.`,
          artifacts: { searchQuery: query, results: [] }
        };
      }

      const formattedResults = formatSearchResultsForAI(searchResponse);
      
      let summary = `Recherche web effectuée pour "${homework.title}":\n\n`;
      
      if (canMakeCall("combined")) {
        // META-PROMPTING: Generate optimized prompt for research task
        const optimizedPrompt = await this.generateOptimizedPrompt(homework, "research", personaName);
        console.log(`[HomeworkExecution] Using optimized prompt for research`);
        
        const analysisResponse = await withRateLimit("combined", () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: optimizedPrompt
              },
              {
                role: "user",
                content: `Tâche: ${homework.title}\n${homework.description || ""}\n\nRésultats:\n${formattedResults}`
              }
            ],
            temperature: 0.3,
            max_tokens: 500,
          }),
          0
        );
        
        summary = analysisResponse.choices[0].message.content || summary;
      } else {
        summary += searchResponse.results.slice(0, 3).map((r, i: number) => 
          `${i + 1}. ${r.title}\n   ${r.snippet}`
        ).join("\n\n");
      }

      await memoryService.updateOrCreateMemory(
        userId,
        "knowledge",
        `homework_research_${homework.id}`,
        summary.substring(0, 1500),
        `homework:${homework.id}:research`
      );

      return {
        summary,
        artifacts: {
          searchQuery: query,
          resultsCount: searchResponse.results.length,
          topResults: searchResponse.results.slice(0, 5)
        }
      };
    } catch (error) {
      console.error("[HomeworkExecution] Research task failed:", error);
      return {
        summary: `Erreur lors de la recherche pour "${homework.title}"`,
        artifacts: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  private async executeGenericTask(userId: number, homework: UlysseHomework, personaName: string = "Ulysse", userName?: string): Promise<{ summary: string; artifacts: any }> {
    const targetUser = userName || (personaName === "Ulysse" ? "Maurice" : "l'utilisateur");
    
    if (!canMakeCall("combined")) {
      return {
        summary: `Tâche "${homework.title}" enregistrée. ${personaName} la traitera lors de la prochaine conversation.`,
        artifacts: { processed: false, reason: "rate_limit" }
      };
    }

    try {
      // META-PROMPTING: Generate optimized prompt for generic task
      const optimizedPrompt = await this.generateOptimizedPrompt(homework, "generic", personaName);
      console.log(`[HomeworkExecution] Using optimized prompt for generic task`);
      
      const response = await withRateLimit("combined", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: optimizedPrompt
            },
            {
              role: "user",
              content: `Tâche: ${homework.title}\n\nDescription: ${homework.description || "Aucune description"}\n\nPrépare cette tâche en détail avec des explications pratiques pour ${targetUser}.`
            }
          ],
          temperature: 0.5,
          max_tokens: 1000,
        }),
        0
      );

      const summary = response.choices[0].message.content || `Tâche "${homework.title}" préparée.`;

      await memoryService.updateOrCreateMemory(
        userId,
        "homework",
        `homework_prep_${homework.id}`,
        summary.substring(0, 1500),
        `homework:${homework.id}:prep`
      );

      return {
        summary,
        artifacts: { processed: true }
      };
    } catch (error) {
      console.error("[HomeworkExecution] Generic task failed:", error);
      return {
        summary: `Tâche "${homework.title}" en attente de traitement.`,
        artifacts: { processed: false, error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  async cleanupOrphanedExecutions(): Promise<number> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const orphaned = await db.update(homeworkExecution)
        .set({ status: "failed", completedAt: new Date(), error: "Execution timed out (orphaned from server restart)" })
        .where(and(
          eq(homeworkExecution.status, "running"),
          sql`${homeworkExecution.startedAt} < ${oneHourAgo.toISOString()}`
        ))
        .returning();

      if (orphaned.length > 0) {
        console.log(`[HomeworkExecution] Cleaned up ${orphaned.length} orphaned executions`);
        const homeworkIds = [...new Set(orphaned.map(e => e.homeworkId))];
        for (const hId of homeworkIds) {
          await db.update(ulysseHomework)
            .set({ status: "pending" })
            .where(and(eq(ulysseHomework.id, hId), eq(ulysseHomework.status, "in_progress")));
        }
      }
      return orphaned.length;
    } catch (error) {
      console.error(`[HomeworkExecution] Cleanup error:`, error);
      return 0;
    }
  }

  async executeDailyTasks(userId: number): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tasks = await db.select().from(ulysseHomework).where(
      and(
        eq(ulysseHomework.userId, userId),
        eq(ulysseHomework.status, "pending"),
        sql`${ulysseHomework.recurrence} != 'none'`
      )
    );

    let executedCount = 0;

    for (const task of tasks) {
      const lastExecuted = task.lastExecutedAt ? new Date(task.lastExecutedAt) : null;
      
      if (lastExecuted) {
        lastExecuted.setHours(0, 0, 0, 0);
        if (lastExecuted.getTime() >= today.getTime()) {
          continue;
        }
      }

      const shouldExecute = this.shouldExecuteRecurringTask(task, today, lastExecuted);
      
      if (shouldExecute) {
        const conditions = {
          timeWindow: { start: 6, end: 23 },
          maxRetries: 5,
          minIntervalHours: 12
        };
        
        const check = await homeworkIntelligence.shouldExecuteNow(task, conditions);
        if (!check.execute) {
          console.log(`[HomeworkExecution] Skipping daily task ${task.id}: ${check.reason}`);
          continue;
        }
        
        const result = await this.executeHomework(userId, task, "daily");
        if (result) executedCount++;
      }
    }

    console.log(`[HomeworkExecution] Executed ${executedCount} daily tasks for user ${userId}`);
    return executedCount;
  }

  private shouldExecuteRecurringTask(task: UlysseHomework, today: Date, lastExecuted: Date | null): boolean {
    if (!lastExecuted) return true;

    const daysSinceLastExecution = Math.floor((today.getTime() - lastExecuted.getTime()) / (1000 * 60 * 60 * 24));

    switch (task.recurrence) {
      case "daily":
        return daysSinceLastExecution >= 1;
      case "weekly":
        return daysSinceLastExecution >= 7;
      case "monthly":
        return daysSinceLastExecution >= 30;
      case "yearly":
        return daysSinceLastExecution >= 365;
      default:
        return false;
    }
  }

  async getExecutionHistory(userId: number, homeworkId?: number, limit: number = 10): Promise<HomeworkExecution[]> {
    if (homeworkId) {
      return db.select().from(homeworkExecution)
        .where(and(
          eq(homeworkExecution.userId, userId),
          eq(homeworkExecution.homeworkId, homeworkId)
        ))
        .orderBy(sql`${homeworkExecution.startedAt} DESC`)
        .limit(limit);
    }
    
    return db.select().from(homeworkExecution)
      .where(eq(homeworkExecution.userId, userId))
      .orderBy(sql`${homeworkExecution.startedAt} DESC`)
      .limit(limit);
  }
}

export const homeworkExecutionService = new HomeworkExecutionService();
