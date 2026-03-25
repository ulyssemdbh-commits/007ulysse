import { db } from "../db";
import { cachedMatches, cachedOdds, sportsSyncJobs, cachedTeamStats } from "@shared/schema";
import { eq, gte, lte, and, desc, sql, or, inArray } from "drizzle-orm";
import { apiFootballService } from "./apiFootballService";
import { oddsApiService } from "./oddsApiService";
import { apiSportsOddsService, type ParsedOdds } from "./apiSportsOddsService";
import { sportsGameOddsService } from "./sportsGameOddsService";

interface LeagueConfig {
  id: number;
  name: string;
  country: string;
  sport: string;
}

const FOOTBALL_LEAGUES: LeagueConfig[] = [
  { id: 61, name: "Ligue 1", country: "France", sport: "football" },
  { id: 39, name: "Premier League", country: "England", sport: "football" },
  { id: 78, name: "Bundesliga", country: "Germany", sport: "football" },
  { id: 140, name: "La Liga", country: "Spain", sport: "football" },
  { id: 135, name: "Serie A", country: "Italy", sport: "football" },
  { id: 2, name: "Champions League", country: "Europe", sport: "football" },
  { id: 3, name: "Europa League", country: "Europe", sport: "football" },
];

const ODDS_LEAGUE_MAP: Record<string, string> = {
  "Ligue 1": "soccer_france_ligue_one",
  "Premier League": "soccer_epl",
  "Bundesliga": "soccer_germany_bundesliga",
  "La Liga": "soccer_spain_la_liga",
  "Serie A": "soccer_italy_serie_a",
  "Champions League": "soccer_uefa_champs_league",
  "Europa League": "soccer_uefa_europa_league",
};

// Multi-sport odds configuration for TheOddsAPI
const MULTI_SPORT_ODDS_KEYS: Record<string, { sport: string; oddsKey: string; leagueName: string }[]> = {
  basketball: [
    { sport: "basketball", oddsKey: "basketball_nba", leagueName: "NBA" },
  ],
  hockey: [
    { sport: "hockey", oddsKey: "icehockey_nhl", leagueName: "NHL" },
  ],
  nfl: [
    { sport: "americanfootball", oddsKey: "americanfootball_nfl", leagueName: "NFL" },
  ],
};

// League interest weights (higher = more attractive for betting)
const LEAGUE_INTEREST_SCORES: Record<string, number> = {
  "Champions League": 25,
  "Europa League": 20,
  "Premier League": 22,
  "La Liga": 18,
  "Serie A": 16,
  "Bundesliga": 15,
  "Ligue 1": 14,
};

// Calculate betting interest score (0-100) with team stats
function calculateBettingInterestScore(match: any, odds: any[], homeStats?: any, awayStats?: any): {
  score: number;
  factors: string[];
  tags: string[];
} {
  let score = 0;
  const factors: string[] = [];
  const tags: string[] = [];
  
  // 1. League attractiveness (0-25 points)
  const leagueScore = LEAGUE_INTEREST_SCORES[match.league] || 10;
  score += leagueScore;
  if (leagueScore >= 20) {
    factors.push("Ligue majeure");
    tags.push("top_league");
  }
  
  // 2. Odds balance / level gap analysis (0-25 points)
  if (odds && odds.length > 0) {
    const bestOdds = odds[0];
    const home = bestOdds.homeOdds || 0;
    const draw = bestOdds.drawOdds || 0;
    const away = bestOdds.awayOdds || 0;
    
    if (home && away) {
      // Close match = higher interest (odds between 1.8 and 2.5 for favorite)
      const minOdds = Math.min(home, away);
      const maxOdds = Math.max(home, away);
      const oddsRatio = maxOdds / minOdds;
      
      if (oddsRatio < 1.5) {
        // Very close match
        score += 25;
        factors.push("Match très serré");
        tags.push("balanced");
      } else if (oddsRatio < 2.5) {
        // Balanced match
        score += 18;
        factors.push("Match équilibré");
        tags.push("balanced");
      } else if (oddsRatio < 4) {
        // Clear favorite but not crushing
        score += 12;
        if (home < away) tags.push("favorite_home");
        else tags.push("favorite_away");
      } else {
        // Dominant favorite - less interesting
        score += 5;
        factors.push("Favori écrasant");
        if (home < away) tags.push("dominant_home");
        else tags.push("dominant_away");
      }
      
      // Value bet detection: favorite with odds > 1.8
      if (minOdds >= 1.8 && minOdds <= 2.2) {
        score += 10;
        factors.push("Cote value");
        tags.push("value_bet");
      }
      
      // Safe ticket potential: strong favorite (1.2-1.5)
      if (minOdds >= 1.15 && minOdds <= 1.5) {
        tags.push("good_for_safe_tickets");
      }
    }
    
    // Over/Under attractiveness
    if (bestOdds.overOdds && bestOdds.underOdds) {
      const overUnderBalance = Math.abs(bestOdds.overOdds - bestOdds.underOdds);
      if (overUnderBalance < 0.3) {
        score += 8;
        factors.push("O/U équilibré");
      }
    }
  } else {
    // No odds = less interesting
    score += 5;
  }
  
  // 3. Match importance based on teams (0-20 points)
  const bigTeams = [
    "PSG", "Paris Saint-Germain", "Marseille", "OM", "Lyon", "OL",
    "Real Madrid", "Barcelona", "Atletico Madrid",
    "Manchester United", "Manchester City", "Liverpool", "Arsenal", "Chelsea", "Tottenham",
    "Bayern", "Bayern Munich", "Borussia Dortmund",
    "Juventus", "AC Milan", "Inter", "Napoli", "AS Roma"
  ];
  
  const homeIsBig = bigTeams.some(t => match.homeTeam?.toLowerCase().includes(t.toLowerCase()));
  const awayIsBig = bigTeams.some(t => match.awayTeam?.toLowerCase().includes(t.toLowerCase()));
  
  if (homeIsBig && awayIsBig) {
    score += 20;
    factors.push("Gros match");
  } else if (homeIsBig || awayIsBig) {
    score += 12;
    factors.push("Équipe majeure");
  } else {
    score += 5;
  }
  
  // 4. Time slot attractiveness (0-15 points)
  const matchHour = new Date(match.matchDate).getHours();
  if (matchHour >= 20) {
    score += 15; // Prime time evening
    factors.push("Prime time");
  } else if (matchHour >= 17) {
    score += 12; // Late afternoon
  } else if (matchHour >= 14) {
    score += 8; // Early afternoon
  } else {
    score += 4; // Morning
  }
  
  // 5. Previous odds movement simulation (0-15 points)
  // For now, simulate based on match timing - matches closer to kickoff get bonus
  const now = new Date();
  const matchTime = new Date(match.matchDate);
  const hoursUntilMatch = (matchTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  if (hoursUntilMatch > 0 && hoursUntilMatch <= 3) {
    score += 15;
    factors.push("Imminent");
  } else if (hoursUntilMatch > 0 && hoursUntilMatch <= 6) {
    score += 10;
  } else if (hoursUntilMatch > 0 && hoursUntilMatch <= 12) {
    score += 5;
  }
  
  // 6. Team stats analysis (bonus 0-15 points)
  if (homeStats && awayStats) {
    // High scoring potential
    const avgGoals = ((homeStats.goalsForAvg || 0) + (awayStats.goalsForAvg || 0)) / 2;
    const totalGoals = (homeStats.goalsForAvg || 0) + (awayStats.goalsForAvg || 0);
    const avgOver25 = ((homeStats.over25Rate || 0) + (awayStats.over25Rate || 0)) / 2;
    const avgBtts = ((homeStats.bttsRate || 0) + (awayStats.bttsRate || 0)) / 2;
    
    if (avgOver25 >= 0.6 || avgGoals >= 1.5) {
      score += 8;
      factors.push("Match à buts");
      tags.push("high_scoring");
    }
    
    if (avgBtts >= 0.55) {
      tags.push("btts_likely");
    }
    
    // Form analysis
    const homeWinRate = homeStats.last10Wins / 10;
    const awayWinRate = awayStats.last10Wins / 10;
    const homeDrawRate = homeStats.last10Draws / 10;
    const awayDrawRate = awayStats.last10Draws / 10;
    
    if (homeWinRate >= 0.6 && awayWinRate >= 0.5) {
      score += 5;
      factors.push("Bonnes formes");
      tags.push("both_in_form");
    }
    
    // Good underdog value (away team in form against lower-form home)
    if (awayWinRate > homeWinRate + 0.2) {
      tags.push("underdog_value");
    }
    
    // Avoid flag: both teams in poor form
    if (homeWinRate < 0.3 && awayWinRate < 0.3) {
      tags.push("avoid");
    }
    
    // === TAGS STRATÉGIQUES AVANCÉS ===
    
    // COMBO_SAFE: Favori clair + bonne forme + défense solide
    const minOdds = odds?.[0] ? Math.min(odds[0].homeOdds || 99, odds[0].awayOdds || 99) : 99;
    const favoriteIsHome = odds?.[0] && odds[0].homeOdds < odds[0].awayOdds;
    const favoriteStats = favoriteIsHome ? homeStats : awayStats;
    const favoriteWinRate = favoriteIsHome ? homeWinRate : awayWinRate;
    
    if (minOdds >= 1.2 && minOdds <= 1.55 && favoriteWinRate >= 0.5 && (favoriteStats?.cleanSheetRate || 0) >= 0.25) {
      tags.push("combo_safe");
      factors.push("Combo safe");
    }
    
    // GOAL_FEST: Total buts attendus > 3
    if (totalGoals >= 3.5 || (avgOver25 >= 0.7 && avgBtts >= 0.6)) {
      tags.push("goal_fest");
      factors.push("Goal fest probable");
    }
    
    // LOW_SCORING: Matchs fermés, Under 2.5 probable
    if (totalGoals < 2.2 && avgOver25 < 0.45) {
      tags.push("low_scoring");
      tags.push("under_likely");
      factors.push("Match fermé");
    }
    
    // UPSET_ALERT: Outsider en meilleure forme que favori
    const underdogStats = favoriteIsHome ? awayStats : homeStats;
    const underdogWinRate = favoriteIsHome ? awayWinRate : homeWinRate;
    if (minOdds <= 1.6 && underdogWinRate > favoriteWinRate) {
      tags.push("upset_alert");
      factors.push("Alerte upset");
    }
    
    // DRAW_LIKELY: Beaucoup de nuls + match équilibré
    if (homeDrawRate >= 0.3 && awayDrawRate >= 0.3) {
      tags.push("draw_likely");
    }
    
    // CLEAN_SHEET_BET: Une équipe avec bon taux de clean sheet vs équipe qui marque peu
    const homeCleanSheet = homeStats.cleanSheetRate || 0;
    const awayCleanSheet = awayStats.cleanSheetRate || 0;
    const homeFailedToScore = homeStats.failedToScoreRate || 0;
    const awayFailedToScore = awayStats.failedToScoreRate || 0;
    
    if ((homeCleanSheet >= 0.35 && awayFailedToScore >= 0.25) || 
        (awayCleanSheet >= 0.35 && homeFailedToScore >= 0.25)) {
      tags.push("clean_sheet_bet");
    }
    
    // HOME_FORTRESS: Dom très forte à domicile
    if (homeStats.homeGoalsForAvg && homeStats.homeGoalsForAvg >= 2 && homeStats.homeGoalsAgainstAvg <= 0.8) {
      tags.push("home_fortress");
    }
    
    // AWAY_DANGER: Ext très dangereux à l'extérieur
    if (awayStats.awayGoalsForAvg && awayStats.awayGoalsForAvg >= 1.5) {
      tags.push("away_danger");
    }
    
    // FIRST_HALF_GOALS: Équipes qui scorent tôt (approximation via avg goals)
    if (totalGoals >= 3 && avgBtts >= 0.5) {
      tags.push("first_half_goals");
    }
    
    // LATE_DRAMA: Matches serrés avec équipes en forme = potentiel drama
    if (homeWinRate >= 0.4 && awayWinRate >= 0.4 && minOdds >= 1.8) {
      tags.push("late_drama");
    }
  }
  
  // Mark derby if big teams facing each other
  if (homeIsBig && awayIsBig) {
    tags.push("derby");
    tags.push("high_profile");
  }
  
  // Cap at 100
  score = Math.min(100, Math.max(0, score));
  
  return { score: Math.round(score), factors, tags };
}

// Get emoji indicator for score
function getInterestEmoji(score: number): string {
  if (score >= 80) return "🔥🔥";
  if (score >= 65) return "🔥";
  if (score >= 50) return "⭐";
  if (score >= 35) return "👀";
  return "📊";
}

class SportsCacheService {
  async syncDailyMatches(): Promise<{ matchesProcessed: number; apiCallsUsed: number }> {
    console.log("[SPORTS-CACHE] Starting daily matches sync...");
    
    const job = await db.insert(sportsSyncJobs).values({
      jobType: "daily_sync",
      sport: "football",
      status: "running",
      startedAt: new Date(),
    }).returning();
    
    let matchesProcessed = 0;
    let apiCallsUsed = 0;
    
    try {
      const today = new Date();
      const twoWeeksFromNow = new Date();
      twoWeeksFromNow.setDate(today.getDate() + 14);
      
      const todayStr = today.toISOString().split("T")[0];
      const twoWeeksStr = twoWeeksFromNow.toISOString().split("T")[0];
      
      const targetLeagueIds = FOOTBALL_LEAGUES.map(l => l.id);
      let filteredMatches: any[] = [];
      
      for (const league of FOOTBALL_LEAGUES) {
        try {
          const leagueMatches = await apiFootballService.getFixturesByLeague(league.id, todayStr, twoWeeksStr);
          apiCallsUsed++;
          filteredMatches.push(...leagueMatches);
        } catch (e: any) {
          console.warn(`[SPORTS-CACHE] Failed to fetch league ${league.name}:`, e.message);
        }
      }
      
      console.log(`[SPORTS-CACHE] Got ${filteredMatches.length} matches from ${FOOTBALL_LEAGUES.length} target leagues (next 14 days)`);
      
      for (const fixture of filteredMatches) {
        const league = FOOTBALL_LEAGUES.find(l => l.id === fixture.league?.id);
        if (!league) continue;
        
        const existingMatch = await db.select()
          .from(cachedMatches)
          .where(eq(cachedMatches.externalId, String(fixture.fixture.id)))
          .limit(1);
        
        const matchData = {
          externalId: String(fixture.fixture.id),
          sport: league.sport,
          league: league.name,
          leagueId: league.id,
          country: league.country,
          homeTeam: fixture.teams.home.name,
          awayTeam: fixture.teams.away.name,
          homeTeamId: fixture.teams.home.id, // Store team ID for stats lookup
          awayTeamId: fixture.teams.away.id, // Store team ID for stats lookup
          homeTeamLogo: fixture.teams.home.logo,
          awayTeamLogo: fixture.teams.away.logo,
          matchDate: new Date(fixture.fixture.date),
          venue: (fixture.fixture as any).venue?.name || null,
          status: fixture.fixture.status.short === "NS" ? "scheduled" : 
                  fixture.fixture.status.short === "LIVE" ? "live" :
                  fixture.fixture.status.short === "FT" ? "finished" : "scheduled",
          homeScore: fixture.goals?.home ?? null,
          awayScore: fixture.goals?.away ?? null,
          stats: {
            round: (fixture.league as any).round || null,
            referee: (fixture.fixture as any).referee || null,
          },
          updatedAt: new Date(),
        };
        
        if (existingMatch.length > 0) {
          await db.update(cachedMatches)
            .set(matchData)
            .where(eq(cachedMatches.id, existingMatch[0].id));
        } else {
          await db.insert(cachedMatches).values(matchData);
        }
        
        matchesProcessed++;
      }
      
      await db.update(sportsSyncJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          matchesProcessed,
          apiCallsUsed,
        })
        .where(eq(sportsSyncJobs.id, job[0].id));
      
      console.log(`[SPORTS-CACHE] Daily sync completed: ${matchesProcessed} matches, ${apiCallsUsed} API calls`);
      
    } catch (error: any) {
      console.error("[SPORTS-CACHE] Daily sync failed:", error.message);
      await db.update(sportsSyncJobs)
        .set({
          status: "failed",
          completedAt: new Date(),
          error: error.message,
          matchesProcessed,
          apiCallsUsed,
        })
        .where(eq(sportsSyncJobs.id, job[0].id));
    }
    
    return { matchesProcessed, apiCallsUsed };
  }

  async refreshHourlyOdds(): Promise<{ oddsProcessed: number; apiCallsUsed: number }> {
    console.log("[SPORTS-CACHE] Starting hourly odds refresh...");
    
    const job = await db.insert(sportsSyncJobs).values({
      jobType: "hourly_odds",
      sport: "football",
      status: "running",
      startedAt: new Date(),
    }).returning();
    
    let oddsProcessed = 0;
    let apiCallsUsed = 0;
    
    try {
      // Get ALL today's matches (not just future ones)
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      
      const todaysMatches = await db.select()
        .from(cachedMatches)
        .where(
          and(
            gte(cachedMatches.matchDate, startOfDay),
            lte(cachedMatches.matchDate, endOfDay),
            eq(cachedMatches.status, "scheduled")
          )
        );
      
      console.log(`[SPORTS-CACHE] Found ${todaysMatches.length} matches to update odds for`);
      
      const leagueGroups: Record<string, typeof todaysMatches> = {};
      for (const match of todaysMatches) {
        if (!leagueGroups[match.league]) {
          leagueGroups[match.league] = [];
        }
        leagueGroups[match.league].push(match);
      }
      
      // STRATEGY: Try API-Sports first (same key as API-Football), then TheOddsAPI as fallback
      let apiSportsSuccess = false;
      
      // STEP 1: Try API-Sports Odds (primary source - same API key as matches)
      if (apiSportsOddsService.isConfigured()) {
        console.log(`[SPORTS-CACHE] Trying API-Sports Odds first (primary source)...`);
        try {
          const apiSportsOdds = await apiSportsOddsService.getOddsForMajorLeagues();
          apiCallsUsed += 6; // Roughly 6 leagues
          
          if (apiSportsOdds.length > 0) {
            console.log(`[SPORTS-CACHE] API-Sports returned ${apiSportsOdds.length} odds`);
            
            for (const odds of apiSportsOdds) {
              // Find matching match in our cache by fixtureId
              const matchingMatch = todaysMatches.find((m: any) => m.externalId === odds.fixtureId);
              
              if (matchingMatch) {
                await db.delete(cachedOdds).where(eq(cachedOdds.matchId, matchingMatch.id));
                
                await db.insert(cachedOdds).values({
                  matchId: matchingMatch.id,
                  externalMatchId: odds.fixtureId.toString(),
                  bookmaker: odds.bookmaker,
                  market: "h2h",
                  homeOdds: odds.homeOdds,
                  drawOdds: odds.drawOdds,
                  awayOdds: odds.awayOdds,
                  overOdds: odds.over25Odds,
                  underOdds: odds.under25Odds,
                  bttsYes: odds.bttsYes,
                  bttsNo: odds.bttsNo,
                  oddsData: { source: "api-sports" },
                  fetchedAt: new Date(),
                });
                
                oddsProcessed++;
              }
            }
            
            apiSportsSuccess = oddsProcessed > 0;
            console.log(`[SPORTS-CACHE] API-Sports processed ${oddsProcessed} odds`);
          }
        } catch (apiSportsError: any) {
          console.warn(`[SPORTS-CACHE] API-Sports Odds failed:`, apiSportsError.message);
        }
      }
      
      // STEP 2: SportsGameOdds as first fallback (cost-effective per-event pricing)
      let sportsGameSuccess = false;
      if (!apiSportsSuccess && sportsGameOddsService.isConfigured()) {
        console.log(`[SPORTS-CACHE] Trying SportsGameOdds as fallback...`);
        try {
          const sgoOdds = await sportsGameOddsService.getFootballOdds();
          apiCallsUsed++;
          
          if (sgoOdds.length > 0) {
            console.log(`[SPORTS-CACHE] SportsGameOdds returned ${sgoOdds.length} football odds`);
            
            for (const odds of sgoOdds) {
              // Find matching match by team names
              const matchingMatch = todaysMatches.find((m: any) => 
                m.homeTeam.toLowerCase().includes(odds.homeTeam.toLowerCase().split(" ")[0]) ||
                odds.homeTeam.toLowerCase().includes(m.homeTeam.toLowerCase().split(" ")[0])
              );
              
              if (matchingMatch) {
                await db.delete(cachedOdds).where(eq(cachedOdds.matchId, matchingMatch.id));
                
                await db.insert(cachedOdds).values({
                  matchId: matchingMatch.id,
                  externalMatchId: odds.eventId,
                  bookmaker: odds.bookmaker,
                  market: "h2h",
                  homeOdds: odds.homeOdds,
                  drawOdds: odds.drawOdds,
                  awayOdds: odds.awayOdds,
                  overOdds: odds.over25Odds,
                  underOdds: odds.under25Odds,
                  bttsYes: null,
                  bttsNo: null,
                  oddsData: { source: "sportsgameodds", spread: odds.spread, totalLine: odds.totalLine },
                  fetchedAt: new Date(),
                });
                
                oddsProcessed++;
              }
            }
            
            sportsGameSuccess = oddsProcessed > 0;
            console.log(`[SPORTS-CACHE] SportsGameOdds processed ${oddsProcessed} football odds`);
          }
        } catch (sgoError: any) {
          console.warn(`[SPORTS-CACHE] SportsGameOdds failed:`, sgoError.message);
        }
      }
      
      // STEP 3: TheOddsAPI as last fallback for missing leagues
      if (!apiSportsSuccess && !sportsGameSuccess && oddsProcessed < todaysMatches.length / 2) {
        console.log(`[SPORTS-CACHE] Using TheOddsAPI as last fallback...`);
        
        for (const league of Object.keys(leagueGroups)) {
          const matches = leagueGroups[league];
          const oddsKey = ODDS_LEAGUE_MAP[league];
          if (!oddsKey) continue;
          
          // Skip leagues we already have odds for from API-Sports
          const matchIds = matches.map(m => m.id);
          const matchesWithOdds = matchIds.length > 0
            ? await db.select({ count: sql<number>`count(*)` })
                .from(cachedOdds)
                .where(inArray(cachedOdds.matchId, matchIds))
            : [{ count: 0 }];
          
          if (matchesWithOdds[0]?.count >= matches.length * 0.8) {
            console.log(`[SPORTS-CACHE] Skipping ${league} - already have odds from API-Sports`);
            continue;
          }
          
          // Delay between league fetches to avoid rate limits
          if (apiCallsUsed > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          console.log(`[SPORTS-CACHE] Fetching odds for ${league} from TheOddsAPI...`);
          let oddsResponse;
          try {
            oddsResponse = await oddsApiService.getOdds(oddsKey, { markets: "h2h,totals" });
            apiCallsUsed++;
          } catch (oddsError: any) {
            if (oddsError.message?.includes("429") || oddsError.message?.includes("rate") || oddsError.message?.includes("OUT_OF_USAGE")) {
              console.warn(`[SPORTS-CACHE] TheOddsAPI quota exceeded, continuing with API-Sports data`);
              break;
            }
            console.error(`[SPORTS-CACHE] Error fetching ${league} odds:`, oddsError.message);
            continue;
          }
          
          if (oddsResponse?.data) {
            for (const oddsEvent of oddsResponse.data) {
              const matchingMatch = matches.find((m: any) => 
                m.homeTeam.toLowerCase().includes(oddsEvent.home_team.toLowerCase().split(" ")[0]) ||
                oddsEvent.home_team.toLowerCase().includes(m.homeTeam.toLowerCase().split(" ")[0])
              );
              
              if (matchingMatch && oddsEvent.bookmakers?.length > 0) {
                // Only insert if we don't already have odds from API-Sports
                const existingOdds = await db.select().from(cachedOdds)
                  .where(eq(cachedOdds.matchId, matchingMatch.id)).limit(1);
                
                if (existingOdds.length === 0) {
                  for (const bookmaker of oddsEvent.bookmakers.slice(0, 3)) {
                    const h2hMarket = bookmaker.markets?.find((m: any) => m.key === "h2h");
                    const totalsMarket = bookmaker.markets?.find((m: any) => m.key === "totals");
                    
                    if (h2hMarket) {
                      const outcomes = h2hMarket.outcomes || [];
                      const homeOdds = outcomes.find((o: any) => o.name === oddsEvent.home_team)?.price;
                      const drawOdds = outcomes.find((o: any) => o.name === "Draw")?.price;
                      const awayOdds = outcomes.find((o: any) => o.name === oddsEvent.away_team)?.price;
                      
                      let overOdds, underOdds;
                      if (totalsMarket) {
                        const totalsOutcomes = totalsMarket.outcomes || [];
                        overOdds = totalsOutcomes.find((o: any) => o.name === "Over")?.price;
                        underOdds = totalsOutcomes.find((o: any) => o.name === "Under")?.price;
                      }
                      
                      await db.insert(cachedOdds).values({
                        matchId: matchingMatch.id,
                        externalMatchId: oddsEvent.id,
                        bookmaker: bookmaker.title,
                        market: "h2h",
                        homeOdds,
                        drawOdds,
                        awayOdds,
                        overOdds,
                        underOdds,
                        oddsData: { source: "theoddsapi", raw: bookmaker.markets },
                        fetchedAt: new Date(),
                      });
                      
                      oddsProcessed++;
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      console.log(`[SPORTS-CACHE] Dual-API odds refresh: API-Sports=${apiSportsSuccess ? 'OK' : 'FALLBACK'}, total=${oddsProcessed} odds`);
      
      await db.update(sportsSyncJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          oddsProcessed,
          apiCallsUsed,
        })
        .where(eq(sportsSyncJobs.id, job[0].id));
      
      console.log(`[SPORTS-CACHE] Hourly odds refresh completed: ${oddsProcessed} odds, ${apiCallsUsed} API calls`);
      
    } catch (error: any) {
      // Mark as partial_success if we processed some odds before error
      const finalStatus = oddsProcessed > 0 ? "partial_success" : "failed";
      console.error(`[SPORTS-CACHE] Hourly odds refresh ${finalStatus}:`, error.message);
      await db.update(sportsSyncJobs)
        .set({
          status: finalStatus,
          completedAt: new Date(),
          error: error.message,
          oddsProcessed,
          apiCallsUsed,
        })
        .where(eq(sportsSyncJobs.id, job[0].id));
    }
    
    return { oddsProcessed, apiCallsUsed };
  }

  /**
   * Sync matches and odds for non-football sports (NBA, NHL, NFL)
   * Uses TheOddsAPI directly to get events and odds
   */
  async syncMultiSportOdds(): Promise<{ matchesCreated: number; oddsProcessed: number; apiCallsUsed: number }> {
    console.log("[SPORTS-CACHE] Starting multi-sport odds sync (NBA, NHL, NFL)...");
    
    let matchesCreated = 0;
    let oddsProcessed = 0;
    let apiCallsUsed = 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // STEP 1: Try SportsGameOdds first (cost-effective per-event pricing)
    if (sportsGameOddsService.isConfigured()) {
      console.log("[SPORTS-CACHE] Trying SportsGameOdds for multi-sport...");
      try {
        const allOdds = await sportsGameOddsService.getAllSportsOdds();
        apiCallsUsed += 4; // 4 sport categories
        
        const sportDataMap: Record<string, { odds: typeof allOdds.nba; sport: string; league: string }> = {
          nba: { odds: allOdds.nba, sport: "basketball", league: "NBA" },
          nhl: { odds: allOdds.nhl, sport: "hockey", league: "NHL" },
          nfl: { odds: allOdds.nfl, sport: "americanfootball", league: "NFL" },
        };
        
        for (const [key, config] of Object.entries(sportDataMap)) {
          if (config.odds.length === 0) continue;
          
          console.log(`[SPORTS-CACHE] SportsGameOdds: ${config.odds.length} ${config.league} events found`);
          
          for (const event of config.odds) {
            const eventDate = new Date(event.startTime);
            if (eventDate < today || eventDate >= tomorrow) continue;
            
            // Check if match exists
            const existing = await db.select()
              .from(cachedMatches)
              .where(and(
                eq(cachedMatches.externalId, event.eventId),
                eq(cachedMatches.sport, config.sport)
              ))
              .limit(1);
            
            let matchId: number;
            
            if (existing.length === 0) {
              const [newMatch] = await db.insert(cachedMatches).values({
                externalId: event.eventId,
                sport: config.sport,
                league: config.league,
                leagueId: null,
                country: "USA",
                homeTeam: event.homeTeam,
                awayTeam: event.awayTeam,
                matchDate: eventDate,
                status: "scheduled",
                venue: null,
                round: null,
                homeTeamId: null,
                awayTeamId: null,
                matchData: { source: "sportsgameodds" },
              }).returning();
              
              matchId = newMatch.id;
              matchesCreated++;
            } else {
              matchId = existing[0].id;
            }
            
            // Insert odds
            await db.delete(cachedOdds).where(eq(cachedOdds.matchId, matchId));
            await db.insert(cachedOdds).values({
              matchId,
              externalMatchId: event.eventId,
              bookmaker: event.bookmaker,
              market: "h2h",
              homeOdds: event.homeOdds,
              drawOdds: event.drawOdds,
              awayOdds: event.awayOdds,
              overOdds: event.overOdds || null,
              underOdds: event.underOdds || null,
              bttsYes: null,
              bttsNo: null,
              oddsData: { 
                source: "sportsgameodds", 
                spread: event.spread, 
                spreadHome: event.spreadHome,
                spreadAway: event.spreadAway,
                totalLine: event.totalLine 
              },
              fetchedAt: new Date(),
            });
            
            oddsProcessed++;
          }
        }
        
        if (oddsProcessed > 0) {
          console.log(`[SPORTS-CACHE] SportsGameOdds processed ${oddsProcessed} multi-sport odds`);
          return { matchesCreated, oddsProcessed, apiCallsUsed };
        }
      } catch (sgoError: any) {
        console.warn(`[SPORTS-CACHE] SportsGameOdds multi-sport failed:`, sgoError.message);
      }
    }
    
    // STEP 2: TheOddsAPI fallback
    console.log("[SPORTS-CACHE] Falling back to TheOddsAPI for multi-sport...");
    
    for (const [sportKey, leagues] of Object.entries(MULTI_SPORT_ODDS_KEYS)) {
      for (const leagueConfig of leagues) {
        try {
          console.log(`[SPORTS-CACHE] Fetching ${leagueConfig.leagueName} events...`);
          
          // Get odds with events from TheOddsAPI
          const oddsResponse = await oddsApiService.getOdds(leagueConfig.oddsKey, { 
            markets: "h2h,spreads,totals" 
          });
          apiCallsUsed++;
          
          if (!oddsResponse?.data?.length) {
            console.log(`[SPORTS-CACHE] No ${leagueConfig.leagueName} events found`);
            continue;
          }
          
          for (const event of oddsResponse.data) {
            // Parse event time
            const eventDate = new Date(event.commence_time);
            
            // Only include today's events
            if (eventDate < today || eventDate >= tomorrow) {
              continue;
            }
            
            // Check if match already exists
            const existing = await db.select()
              .from(cachedMatches)
              .where(
                and(
                  eq(cachedMatches.externalId, event.id),
                  eq(cachedMatches.sport, leagueConfig.sport)
                )
              )
              .limit(1);
            
            let matchId: number;
            
            if (existing.length === 0) {
              // Create new match
              const [newMatch] = await db.insert(cachedMatches).values({
                externalId: event.id,
                sport: leagueConfig.sport,
                league: leagueConfig.leagueName,
                leagueId: null,
                country: "USA",
                homeTeam: event.home_team,
                awayTeam: event.away_team,
                matchDate: eventDate,
                status: "scheduled",
                venue: null,
                round: null,
                homeTeamId: null,
                awayTeamId: null,
                matchData: { oddsApiEvent: event },
              }).returning();
              
              matchId = newMatch.id;
              matchesCreated++;
            } else {
              matchId = existing[0].id;
            }
            
            // Process odds for this event
            if (event.bookmakers?.length > 0) {
              // Delete old odds
              await db.delete(cachedOdds)
                .where(eq(cachedOdds.matchId, matchId));
              
              // Insert new odds from top 3 bookmakers
              for (const bookmaker of event.bookmakers.slice(0, 3)) {
                const h2hMarket = bookmaker.markets?.find((m: any) => m.key === "h2h");
                const spreadsMarket = bookmaker.markets?.find((m: any) => m.key === "spreads");
                const totalsMarket = bookmaker.markets?.find((m: any) => m.key === "totals");
                
                if (h2hMarket) {
                  const outcomes = h2hMarket.outcomes || [];
                  const homeOdds = outcomes.find((o: any) => o.name === event.home_team)?.price;
                  const awayOdds = outcomes.find((o: any) => o.name === event.away_team)?.price;
                  
                  // For US sports, no draw
                  let overOdds, underOdds, spreadHome, spreadAway;
                  
                  if (totalsMarket) {
                    const totalsOutcomes = totalsMarket.outcomes || [];
                    overOdds = totalsOutcomes.find((o: any) => o.name === "Over")?.price;
                    underOdds = totalsOutcomes.find((o: any) => o.name === "Under")?.price;
                  }
                  
                  if (spreadsMarket) {
                    const spreadsOutcomes = spreadsMarket.outcomes || [];
                    spreadHome = spreadsOutcomes.find((o: any) => o.name === event.home_team)?.point;
                    spreadAway = spreadsOutcomes.find((o: any) => o.name === event.away_team)?.point;
                  }
                  
                  await db.insert(cachedOdds).values({
                    matchId,
                    externalMatchId: event.id,
                    bookmaker: bookmaker.title,
                    market: "h2h",
                    homeOdds,
                    awayOdds,
                    drawOdds: null, // No draw in US sports
                    overOdds,
                    underOdds,
                    oddsData: { 
                      raw: bookmaker.markets,
                      spreadHome,
                      spreadAway,
                      sport: leagueConfig.sport,
                    },
                    fetchedAt: new Date(),
                  });
                  
                  oddsProcessed++;
                }
              }
            }
          }
          
          // Rate limit delay
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error: any) {
          console.error(`[SPORTS-CACHE] Error syncing ${leagueConfig.leagueName}:`, error.message);
        }
      }
    }
    
    console.log(`[SPORTS-CACHE] Multi-sport sync completed: ${matchesCreated} matches, ${oddsProcessed} odds, ${apiCallsUsed} API calls`);
    
    return { matchesCreated, oddsProcessed, apiCallsUsed };
  }

  /**
   * Sync team statistics for today's matches
   * Runs after daily match sync to fetch form, goals avg, over2.5 rate, BTTS rate
   * Uses ~40-60 API calls (2 teams × 20-30 matches)
   */
  async syncTeamStats(): Promise<{ teamsProcessed: number; apiCallsUsed: number }> {
    console.log("[SPORTS-CACHE] Starting team stats sync...");
    
    const job = await db.insert(sportsSyncJobs).values({
      jobType: "stats_sync",
      sport: "football",
      status: "running",
      startedAt: new Date(),
    }).returning();
    
    let teamsProcessed = 0;
    let apiCallsUsed = 0;
    
    try {
      // Get today's matches (with team IDs stored from daily sync)
      const todaysMatches = await this.getMatchesForDate(new Date());
      console.log(`[SPORTS-CACHE] Syncing stats for ${todaysMatches.length} matches`);
      
      // Collect unique teams with their IDs (no search needed!)
      const teamsToSync = new Map<number, { teamId: number; teamName: string; league: string; leagueId: number | null }>();
      
      for (const match of todaysMatches) {
        if (match.homeTeamId) {
          teamsToSync.set(match.homeTeamId, { 
            teamId: match.homeTeamId,
            teamName: match.homeTeam, 
            league: match.league, 
            leagueId: match.leagueId 
          });
        }
        if (match.awayTeamId) {
          teamsToSync.set(match.awayTeamId, { 
            teamId: match.awayTeamId,
            teamName: match.awayTeam, 
            league: match.league, 
            leagueId: match.leagueId 
          });
        }
      }
      
      console.log(`[SPORTS-CACHE] ${teamsToSync.size} unique teams to sync (using stored team IDs)`);
      
      // Check which teams need update (not updated today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      for (const [teamId, teamInfo] of Array.from(teamsToSync.entries())) {
        // Check if already synced today
        const existingStats = await db.select()
          .from(cachedTeamStats)
          .where(eq(cachedTeamStats.teamId, teamId))
          .limit(1);
        
        if (existingStats.length > 0 && existingStats[0].lastUpdated && existingStats[0].lastUpdated >= today) {
          console.log(`[SPORTS-CACHE] Skipping ${teamInfo.teamName} (already synced today)`);
          continue;
        }
        
        // Rate limit protection (100 req/day limit)
        if (apiCallsUsed >= 85) {
          console.warn("[SPORTS-CACHE] Approaching API limit, stopping stats sync");
          break;
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Get team stats from last 10 matches (using stored team ID - no search needed!)
        const stats = await apiFootballService.getTeamStats(teamId, 10);
        apiCallsUsed++;
        
        if (!stats) {
          console.log(`[SPORTS-CACHE] No stats for ${teamInfo.teamName} (ID: ${teamId})`);
          continue;
        }
        
        // Upsert team stats
        const statsData = {
          teamId: teamId,
          teamName: teamInfo.teamName,
          league: teamInfo.league,
          leagueId: teamInfo.leagueId,
          formString: stats.formString,
          last10Wins: stats.last10Wins,
          last10Draws: stats.last10Draws,
          last10Losses: stats.last10Losses,
          goalsForAvg: stats.goalsForAvg,
          goalsAgainstAvg: stats.goalsAgainstAvg,
          over25Rate: stats.over25Rate,
          bttsRate: stats.bttsRate,
          cleanSheetRate: stats.cleanSheetRate,
          failedToScoreRate: stats.failedToScoreRate,
          homeGoalsForAvg: stats.homeGoalsForAvg,
          homeGoalsAgainstAvg: stats.homeGoalsAgainstAvg,
          homeOver25Rate: stats.homeOver25Rate,
          homeBttsRate: stats.homeBttsRate,
          awayGoalsForAvg: stats.awayGoalsForAvg,
          awayGoalsAgainstAvg: stats.awayGoalsAgainstAvg,
          awayOver25Rate: stats.awayOver25Rate,
          awayBttsRate: stats.awayBttsRate,
          matchesSampled: stats.matchesSampled,
          lastUpdated: new Date(),
        };
        
        if (existingStats.length > 0) {
          await db.update(cachedTeamStats)
            .set(statsData)
            .where(eq(cachedTeamStats.id, existingStats[0].id));
        } else {
          await db.insert(cachedTeamStats).values(statsData);
        }
        
        teamsProcessed++;
        console.log(`[SPORTS-CACHE] Synced ${teamInfo.teamName}: ${stats.formString} (${stats.goalsForAvg} buts/match)`);
      }
      
      await db.update(sportsSyncJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          matchesProcessed: teamsProcessed,
          apiCallsUsed,
        })
        .where(eq(sportsSyncJobs.id, job[0].id));
      
      console.log(`[SPORTS-CACHE] Team stats sync completed: ${teamsProcessed} teams, ${apiCallsUsed} API calls`);
      
    } catch (error: any) {
      const finalStatus = teamsProcessed > 0 ? "partial_success" : "failed";
      console.error(`[SPORTS-CACHE] Team stats sync ${finalStatus}:`, error.message);
      await db.update(sportsSyncJobs)
        .set({
          status: finalStatus,
          completedAt: new Date(),
          error: error.message,
          matchesProcessed: teamsProcessed,
          apiCallsUsed,
        })
        .where(eq(sportsSyncJobs.id, job[0].id));
    }
    
    return { teamsProcessed, apiCallsUsed };
  }

  /**
   * Get cached team stats for a team
   */
  async getTeamStats(teamName: string): Promise<any | null> {
    const stats = await db.select()
      .from(cachedTeamStats)
      .where(eq(cachedTeamStats.teamName, teamName))
      .limit(1);
    
    return stats[0] || null;
  }

  async getMatchesForDate(date: Date = new Date()): Promise<any[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    let matches = await db.select()
      .from(cachedMatches)
      .where(
        and(
          gte(cachedMatches.matchDate, startOfDay),
          lte(cachedMatches.matchDate, endOfDay)
        )
      )
      .orderBy(cachedMatches.matchDate);
    
    const now = new Date();
    const isToday = startOfDay.toDateString() === now.toDateString();
    
    if (isToday && matches.length > 0) {
      const staleScheduled = matches.filter(m => 
        m.status === 'scheduled' && 
        m.matchDate && 
        new Date(m.matchDate).getTime() + 2 * 60 * 60 * 1000 < now.getTime()
      );
      
      if (staleScheduled.length > 0) {
        console.log(`[SPORTS-CACHE] ${staleScheduled.length} matches should be finished but still marked scheduled, refreshing...`);
        try {
          await this.syncDailyMatches();
          matches = await db.select()
            .from(cachedMatches)
            .where(
              and(
                gte(cachedMatches.matchDate, startOfDay),
                lte(cachedMatches.matchDate, endOfDay)
              )
            )
            .orderBy(cachedMatches.matchDate);
        } catch (e: any) {
          console.error('[SPORTS-CACHE] Auto-refresh failed:', e.message);
        }
      }
    }
    
    return matches;
  }

  async getUpcomingMatches(competition: string = 'Football', days: number = 7): Promise<any[]> {
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(now.getDate() + days);
    
    // Map competition name to league IDs
    const leagueMap: Record<string, number[]> = {
      'Champions League': [2],
      'Europa League': [3],
      'Ligue 1': [61],
      'Premier League': [39],
      'La Liga': [140],
      'Serie A': [135],
      'Bundesliga': [78],
      'Football': [2, 3, 61, 39, 140, 135, 78]
    };
    
    const leagueIds = leagueMap[competition] || leagueMap['Football'];
    
    // First try cache
    const cachedResult = await db.select()
      .from(cachedMatches)
      .where(
        and(
          gte(cachedMatches.matchDate, now),
          lte(cachedMatches.matchDate, endDate)
        )
      )
      .orderBy(cachedMatches.matchDate)
      .limit(30);
    
    // Filter by league if specific competition
    const filtered = competition !== 'Football' 
      ? cachedResult.filter(m => m.league?.toLowerCase().includes(competition.toLowerCase().split(' ')[0]))
      : cachedResult;
    
    if (filtered.length > 0) {
      console.log(`[SPORTS-CACHE] Found ${filtered.length} cached upcoming matches for ${competition}`);
      return filtered.map(m => ({
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        date: m.matchDate,
        league: m.league,
        odds: null
      }));
    }
    
    // If cache empty, fetch from API-Football
    console.log(`[SPORTS-CACHE] Cache empty, fetching from API-Football for ${competition}`);
    try {
      const API_KEY = process.env.API_FOOTBALL_KEY;
      if (!API_KEY) {
        console.log(`[SPORTS-CACHE] No API-Football key available`);
        return [];
      }
      
      const fromDate = now.toISOString().split('T')[0];
      const toDate = endDate.toISOString().split('T')[0];
      
      const allMatches: any[] = [];
      for (const leagueId of leagueIds.slice(0, 2)) { // Limit API calls
        const response = await fetch(
          `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2025&from=${fromDate}&to=${toDate}`,
          {
            headers: {
              'x-rapidapi-key': API_KEY,
              'x-rapidapi-host': 'v3.football.api-sports.io'
            }
          }
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.response) {
            for (const match of data.response.slice(0, 15)) {
              allMatches.push({
                homeTeam: match.teams?.home?.name || 'Unknown',
                awayTeam: match.teams?.away?.name || 'Unknown',
                date: match.fixture?.date,
                league: match.league?.name || competition,
                odds: null
              });
            }
          }
        }
      }
      
      console.log(`[SPORTS-CACHE] Fetched ${allMatches.length} matches from API-Football`);
      return allMatches;
    } catch (err) {
      console.error(`[SPORTS-CACHE] API-Football error:`, err);
      return [];
    }
  }

  async getMatchesWithOdds(date: Date = new Date()): Promise<any[]> {
    const matches = await this.getMatchesForDate(date);
    
    const matchesWithOdds = await Promise.all(
      matches.map(async (match) => {
        // Get odds
        const odds = await db.select()
          .from(cachedOdds)
          .where(eq(cachedOdds.matchId, match.id))
          .orderBy(desc(cachedOdds.fetchedAt))
          .limit(3);
        
        // Get team stats
        const [homeStats, awayStats] = await Promise.all([
          this.getTeamStats(match.homeTeam),
          this.getTeamStats(match.awayTeam)
        ]);
        
        // Calculate betting interest score (now with stats)
        const { score: bettingInterest, factors: interestFactors, tags } = 
          calculateBettingInterestScore(match, odds, homeStats, awayStats);
        
        return { 
          ...match, 
          odds,
          homeStats,
          awayStats,
          bettingInterest,
          interestFactors,
          interestTags: tags,
          interestEmoji: getInterestEmoji(bettingInterest)
        };
      })
    );
    
    // Sort by betting interest (highest first)
    return matchesWithOdds.sort((a, b) => b.bettingInterest - a.bettingInterest);
  }

  async getWeekMatches(): Promise<any[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date();
    weekFromNow.setDate(today.getDate() + 7);
    
    const matches = await db.select()
      .from(cachedMatches)
      .where(
        and(
          gte(cachedMatches.matchDate, today),
          lte(cachedMatches.matchDate, weekFromNow)
        )
      )
      .orderBy(cachedMatches.matchDate);
    
    return matches;
  }

  async getLastSyncStatus(): Promise<any> {
    const lastSync = await db.select()
      .from(sportsSyncJobs)
      .orderBy(desc(sportsSyncJobs.createdAt))
      .limit(5);
    
    return lastSync;
  }

  async getCacheStats(): Promise<{
    totalMatches: number;
    totalOdds: number;
    lastDailySync: Date | null;
    lastOddsRefresh: Date | null;
  }> {
    const matchCount = await db.select({ count: sql<number>`count(*)` })
      .from(cachedMatches);
    
    const oddsCount = await db.select({ count: sql<number>`count(*)` })
      .from(cachedOdds);
    
    const lastDaily = await db.select()
      .from(sportsSyncJobs)
      .where(eq(sportsSyncJobs.jobType, "daily_sync"))
      .orderBy(desc(sportsSyncJobs.completedAt))
      .limit(1);
    
    const lastHourly = await db.select()
      .from(sportsSyncJobs)
      .where(eq(sportsSyncJobs.jobType, "hourly_odds"))
      .orderBy(desc(sportsSyncJobs.completedAt))
      .limit(1);
    
    return {
      totalMatches: Number(matchCount[0]?.count || 0),
      totalOdds: Number(oddsCount[0]?.count || 0),
      lastDailySync: lastDaily[0]?.completedAt || null,
      lastOddsRefresh: lastHourly[0]?.completedAt || null,
    };
  }

  formatMatchesForAI(matches: any[]): string {
    if (!matches || matches.length === 0) {
      return "Aucun match en cache pour cette date.";
    }
    
    // First, show top picks by betting interest
    const topPicks = matches.filter(m => m.bettingInterest >= 60).slice(0, 5);
    let output = "";
    
    if (topPicks.length > 0) {
      output += "**🎯 TOP PARIS DU JOUR:**\n";
      for (const match of topPicks) {
        const time = new Date(match.matchDate).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        
        let oddsStr = "";
        if (match.odds && match.odds.length > 0) {
          const bestOdds = match.odds[0];
          oddsStr = ` | 1=${bestOdds.homeOdds || "?"} N=${bestOdds.drawOdds || "?"} 2=${bestOdds.awayOdds || "?"}`;
        }
        
        // Add stats summary if available
        let statsStr = "";
        if (match.homeStats && match.awayStats) {
          const hForm = match.homeStats.formString?.slice(0, 5) || "?";
          const aForm = match.awayStats.formString?.slice(0, 5) || "?";
          const hOver = match.homeStats.over25Rate ? `${Math.round(match.homeStats.over25Rate * 100)}%` : "?";
          const aOver = match.awayStats.over25Rate ? `${Math.round(match.awayStats.over25Rate * 100)}%` : "?";
          statsStr = ` [${hForm} vs ${aForm}, O2.5: ${hOver}/${aOver}]`;
        }
        
        // Add tags
        const tagsStr = match.interestTags?.length > 0 ? ` #${match.interestTags.slice(0, 2).join(" #")}` : "";
        
        const factors = match.interestFactors?.slice(0, 2).join(", ") || "";
        output += `${match.interestEmoji} [${match.bettingInterest}/100] ${time} ${match.homeTeam} vs ${match.awayTeam}${oddsStr}${statsStr}${factors ? ` (${factors})` : ""}${tagsStr}\n`;
      }
      output += "\n";
    }
    
    // Then show all matches by league
    const byLeague: Record<string, any[]> = {};
    for (const match of matches) {
      if (!byLeague[match.league]) {
        byLeague[match.league] = [];
      }
      byLeague[match.league].push(match);
    }
    
    output += "**📅 TOUS LES MATCHS:**\n";
    
    for (const league of Object.keys(byLeague)) {
      const leagueMatches = byLeague[league];
      // Sort by time within league
      leagueMatches.sort((a, b) => new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime());
      
      output += `\n**${league}:**\n`;
      for (const match of leagueMatches) {
        const time = new Date(match.matchDate).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        
        let oddsStr = "";
        if (match.odds && match.odds.length > 0) {
          const bestOdds = match.odds[0];
          oddsStr = ` | 1=${bestOdds.homeOdds || "?"} N=${bestOdds.drawOdds || "?"} 2=${bestOdds.awayOdds || "?"}`;
        }
        
        // Show interest score inline
        const interestTag = match.bettingInterest >= 50 ? ` ${match.interestEmoji}${match.bettingInterest}` : "";
        
        output += `- ${time}: ${match.homeTeam} vs ${match.awayTeam}${oddsStr}${interestTag}\n`;
      }
    }
    
    return output;
  }

  // ==================== QUERY METHODS FOR ULYSSE ====================

  /**
   * Find next match for a team (upcoming or today)
   */
  async getNextMatchForTeam(teamName: string): Promise<{
    found: boolean;
    match?: any;
    message: string;
  }> {
    const normalizedTeam = teamName.toLowerCase().trim();
    const now = new Date();
    
    // Get matches from today onwards (next 7 days)
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 7);
    
    const matches = await db.select()
      .from(cachedMatches)
      .where(
        and(
          gte(cachedMatches.matchDate, now),
          lte(cachedMatches.matchDate, endDate)
        )
      )
      .orderBy(cachedMatches.matchDate);
    
    // Find match where team is playing (home or away)
    const teamMatch = matches.find(m => {
      const home = (m.homeTeam || '').toLowerCase();
      const away = (m.awayTeam || '').toLowerCase();
      return home.includes(normalizedTeam) || away.includes(normalizedTeam) ||
             normalizedTeam.includes(home.split(' ')[0]) || normalizedTeam.includes(away.split(' ')[0]);
    });
    
    if (teamMatch) {
      const matchDate = new Date(teamMatch.matchDate);
      const dateStr = matchDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      const timeStr = matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      
      return {
        found: true,
        match: teamMatch,
        message: `Le prochain match de ${teamName} est ${teamMatch.homeTeam} vs ${teamMatch.awayTeam} le ${dateStr} à ${timeStr} (${teamMatch.league}).`
      };
    }
    
    return {
      found: false,
      message: `Aucun match trouvé pour ${teamName} dans les 7 prochains jours.`
    };
  }

  /**
   * Get score of a recent match for a team
   */
  async getRecentMatchScore(teamName: string): Promise<{
    found: boolean;
    match?: any;
    message: string;
  }> {
    const normalizedTeam = teamName.toLowerCase().trim();
    const now = new Date();
    
    // Look at past 3 days
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 3);
    
    const matches = await db.select()
      .from(cachedMatches)
      .where(
        and(
          lte(cachedMatches.matchDate, now),
          gte(cachedMatches.matchDate, startDate)
        )
      )
      .orderBy(desc(cachedMatches.matchDate));
    
    // Find match where team played (with score)
    const teamMatch = matches.find(m => {
      const home = (m.homeTeam || '').toLowerCase();
      const away = (m.awayTeam || '').toLowerCase();
      const hasScore = m.homeScore !== null && m.awayScore !== null;
      const isTeam = home.includes(normalizedTeam) || away.includes(normalizedTeam) ||
                     normalizedTeam.includes(home.split(' ')[0]) || normalizedTeam.includes(away.split(' ')[0]);
      return isTeam && hasScore;
    });
    
    if (teamMatch) {
      const matchDate = new Date(teamMatch.matchDate);
      const dateStr = matchDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      
      return {
        found: true,
        match: teamMatch,
        message: `${teamMatch.homeTeam} ${teamMatch.homeScore} - ${teamMatch.awayScore} ${teamMatch.awayTeam} (${dateStr}, ${teamMatch.league}).`
      };
    }
    
    return {
      found: false,
      message: `Aucun score récent trouvé pour ${teamName}.`
    };
  }

  /**
   * Import fixtures from homework extraction into cache
   */
  async importFixturesFromHomework(
    fixtures: Array<{
      homeTeam: string;
      awayTeam: string;
      homeScore?: number;
      awayScore?: number;
      matchday?: number;
    }>,
    league: string,
    leagueId?: number
  ): Promise<{ imported: number; updated: number }> {
    let imported = 0;
    let updated = 0;
    
    for (const fixture of fixtures) {
      // Check if match already exists
      const existing = await db.select()
        .from(cachedMatches)
        .where(
          and(
            eq(cachedMatches.homeTeam, fixture.homeTeam),
            eq(cachedMatches.awayTeam, fixture.awayTeam),
            eq(cachedMatches.league, league)
          )
        )
        .limit(1);
      
      if (existing.length > 0) {
        // Update score if provided and match exists
        if (fixture.homeScore !== undefined && fixture.awayScore !== undefined) {
          await db.update(cachedMatches)
            .set({
              homeScore: fixture.homeScore,
              awayScore: fixture.awayScore,
              status: 'finished',
              lastSync: new Date()
            })
            .where(eq(cachedMatches.id, existing[0].id));
          updated++;
        }
      } else {
        // Insert new match (date estimated from matchday if possible)
        const estimatedDate = new Date();
        if (fixture.matchday) {
          // Rough estimation: current season started mid-August
          const seasonStart = new Date(new Date().getFullYear(), 7, 15); // August 15
          estimatedDate.setTime(seasonStart.getTime() + (fixture.matchday - 1) * 7 * 24 * 60 * 60 * 1000);
        }
        
        await db.insert(cachedMatches).values({
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          homeScore: fixture.homeScore ?? null,
          awayScore: fixture.awayScore ?? null,
          league,
          leagueId: leagueId ?? null,
          matchDate: estimatedDate,
          status: fixture.homeScore !== undefined ? 'finished' : 'scheduled',
          lastSync: new Date()
        });
        imported++;
      }
    }
    
    console.log(`[SPORTS-CACHE] Imported ${imported} new fixtures, updated ${updated} existing matches for ${league}`);
    return { imported, updated };
  }

  /**
   * Quick lookup: Ulysse asks about a team's next match or recent score
   */
  async queryTeamInfo(teamName: string, queryType: 'next' | 'score' | 'both' = 'both'): Promise<string> {
    let response = '';
    
    if (queryType === 'next' || queryType === 'both') {
      const nextMatch = await this.getNextMatchForTeam(teamName);
      if (nextMatch.found) {
        response += `📅 ${nextMatch.message}\n`;
      } else if (queryType === 'next') {
        response = nextMatch.message;
      }
    }
    
    if (queryType === 'score' || queryType === 'both') {
      const recentScore = await this.getRecentMatchScore(teamName);
      if (recentScore.found) {
        response += `⚽ Dernier résultat: ${recentScore.message}`;
      } else if (queryType === 'score') {
        response = recentScore.message;
      }
    }
    
    return response.trim() || `Aucune information trouvée pour ${teamName} dans le cache.`;
  }
}

export const sportsCacheService = new SportsCacheService();
