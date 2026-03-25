import { Router, Request, Response } from 'express';
import { apiFootballService, APIFootballService } from '../services/apiFootballService';
import { apiSportsOddsService } from '../services/apiSportsOddsService';
import { footdatasService } from '../services/footdatasService';
import { footballCacheService } from '../services/footballCacheService';
import { updateSportsScreen, getSportsScreen, clearSportsScreen } from '../services/sportsScreenContext';

const router = Router();

function parseOddsData(fixtureId: number, oddsData: any[], apiFootball: typeof apiFootballService, allMarketsMap: Record<number, any>): any | null {
  if (!oddsData || !oddsData.length) return null;
  const allMarkets = apiFootball.extractAllBettingMarkets(oddsData);
  if (allMarkets) {
    allMarketsMap[fixtureId] = allMarkets;
  }
  const bookmaker = oddsData[0]?.bookmakers?.[0];
  if (!bookmaker?.bets) return null;
  const match1X2 = bookmaker.bets.find((b: any) => b.name === 'Match Winner' || b.id === 1);
  const overUnder = bookmaker.bets.find((b: any) => b.id === 5 || b.name?.toLowerCase().includes('over/under'));
  const btts = bookmaker.bets.find((b: any) => b.id === 8 || b.name?.toLowerCase().includes('both teams'));
  const doubleChance = bookmaker.bets.find((b: any) => b.id === 12 || b.name?.toLowerCase().includes('double chance'));
  if (!match1X2?.values) return null;
  const result: any = {
    fixtureId,
    homeOdds: parseFloat(match1X2.values.find((v: any) => v.value === 'Home')?.odd) || null,
    drawOdds: parseFloat(match1X2.values.find((v: any) => v.value === 'Draw')?.odd) || null,
    awayOdds: parseFloat(match1X2.values.find((v: any) => v.value === 'Away')?.odd) || null,
    bookmaker: bookmaker?.name || 'Unknown',
    totalMarkets: allMarkets?.totalMarketsCount || 0,
  };
  if (overUnder?.values) {
    result.over25Odds = parseFloat(overUnder.values.find((v: any) => v.value?.includes('Over 2.5'))?.odd) || null;
    result.under25Odds = parseFloat(overUnder.values.find((v: any) => v.value?.includes('Under 2.5'))?.odd) || null;
  }
  if (btts?.values) {
    result.bttsYes = parseFloat(btts.values.find((v: any) => v.value === 'Yes')?.odd) || null;
    result.bttsNo = parseFloat(btts.values.find((v: any) => v.value === 'No')?.odd) || null;
  }
  if (doubleChance?.values) {
    result.dc1X = parseFloat(doubleChance.values.find((v: any) => v.value === 'Home/Draw')?.odd) || null;
    result.dcX2 = parseFloat(doubleChance.values.find((v: any) => v.value === 'Draw/Away')?.odd) || null;
    result.dc12 = parseFloat(doubleChance.values.find((v: any) => v.value === 'Home/Away')?.odd) || null;
  }
  return result;
}

// Big 5 European Leagues
const BIG5_LEAGUES = {
  L1: { id: 61, name: 'Ligue 1', code: 'L1', country: 'France' },
  PL: { id: 39, name: 'Premier League', code: 'PL', country: 'England' },
  LL: { id: 140, name: 'La Liga', code: 'LL', country: 'Spain' },
  BL: { id: 78, name: 'Bundesliga', code: 'BL', country: 'Germany' },
  SA: { id: 135, name: 'Serie A', code: 'SA', country: 'Italy' },
};

// All European Competitions (for comprehensive coverage)
const ALL_EUROPEAN_LEAGUES = {
  // Big 5 Leagues
  L1: { id: 61, name: 'Ligue 1', code: 'L1', country: 'France', flag: '🇫🇷' },
  PL: { id: 39, name: 'Premier League', code: 'PL', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  LL: { id: 140, name: 'La Liga', code: 'LL', country: 'Spain', flag: '🇪🇸' },
  BL: { id: 78, name: 'Bundesliga', code: 'BL', country: 'Germany', flag: '🇩🇪' },
  SA: { id: 135, name: 'Serie A', code: 'SA', country: 'Italy', flag: '🇮🇹' },
  // European Cups
  UCL: { id: 2, name: 'Champions League', code: 'UCL', country: 'Europe', flag: '🏆' },
  UEL: { id: 3, name: 'Europa League', code: 'UEL', country: 'Europe', flag: '🥈' },
  UECL: { id: 848, name: 'Conference League', code: 'UECL', country: 'Europe', flag: '🥉' },
  // Second Divisions
  L2: { id: 62, name: 'Ligue 2', code: 'L2', country: 'France', flag: '🇫🇷' },
  EFL: { id: 40, name: 'Championship', code: 'EFL', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  LL2: { id: 141, name: 'La Liga 2', code: 'LL2', country: 'Spain', flag: '🇪🇸' },
  BL2: { id: 79, name: '2. Bundesliga', code: 'BL2', country: 'Germany', flag: '🇩🇪' },
  SB: { id: 136, name: 'Serie B', code: 'SB', country: 'Italy', flag: '🇮🇹' },
  // National Cups
  CDF: { id: 66, name: 'Coupe de France', code: 'CDF', country: 'France', flag: '🇫🇷' },
  FAC: { id: 45, name: 'FA Cup', code: 'FAC', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  CDR: { id: 143, name: 'Copa del Rey', code: 'CDR', country: 'Spain', flag: '🇪🇸' },
  DFB: { id: 81, name: 'DFB Pokal', code: 'DFB', country: 'Germany', flag: '🇩🇪' },
  CI: { id: 137, name: 'Coppa Italia', code: 'CI', country: 'Italy', flag: '🇮🇹' },
  // Other Top Leagues
  ERE: { id: 88, name: 'Eredivisie', code: 'ERE', country: 'Netherlands', flag: '🇳🇱' },
  JPL: { id: 144, name: 'Jupiler Pro League', code: 'JPL', country: 'Belgium', flag: '🇧🇪' },
  PRI: { id: 94, name: 'Primeira Liga', code: 'PRI', country: 'Portugal', flag: '🇵🇹' },
};

const LEAGUE_IDS = {
  LIGUE_1: 61,
  PREMIER_LEAGUE: 39,
  CHAMPIONS_LEAGUE: 2
};

router.get('/status', async (req: Request, res: Response) => {
  try {
    const configured = apiFootballService.isConfigured();
    res.json({
      configured,
      sports: configured ? ['football', 'basketball', 'f1'] : [],
      rateLimit: '100 requests/day per sport',
      message: configured ? 'API-Football ready' : 'API_FOOTBALL_KEY not configured'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/football/live', async (req: Request, res: Response) => {
  try {
    const matches = await apiFootballService.getLiveFootballMatches();
    res.json({ 
      matches,
      formatted: apiFootballService.formatFootballMatches(matches),
      count: matches.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/football/today', async (req: Request, res: Response) => {
  try {
    const matches = await apiFootballService.getTodayFootballMatches();
    res.json({ 
      matches,
      formatted: apiFootballService.formatFootballMatches(matches),
      count: matches.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/football/team/:teamName', async (req: Request, res: Response) => {
  try {
    const matches = await apiFootballService.getFootballMatchesByTeam(req.params.teamName);
    res.json({ 
      matches,
      formatted: apiFootballService.formatFootballMatches(matches),
      count: matches.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/football/ligue1/standings', async (req: Request, res: Response) => {
  try {
    const standings = await apiFootballService.getLeagueStandings(LEAGUE_IDS.LIGUE_1);
    res.json({ 
      standings,
      formatted: apiFootballService.formatStandings(standings),
      count: standings.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/football/premier-league/standings', async (req: Request, res: Response) => {
  try {
    const standings = await apiFootballService.getLeagueStandings(LEAGUE_IDS.PREMIER_LEAGUE);
    res.json({ 
      standings,
      formatted: apiFootballService.formatStandings(standings),
      count: standings.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/basketball/live', async (req: Request, res: Response) => {
  try {
    const games = await apiFootballService.getLiveBasketballGames();
    res.json({ 
      games,
      formatted: apiFootballService.formatBasketballGames(games),
      count: games.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/basketball/today', async (req: Request, res: Response) => {
  try {
    const games = await apiFootballService.getTodayBasketballGames();
    res.json({ 
      games,
      formatted: apiFootballService.formatBasketballGames(games),
      count: games.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/f1/races', async (req: Request, res: Response) => {
  try {
    const races = await apiFootballService.getF1Races();
    res.json({ 
      races,
      count: races.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/f1/standings', async (req: Request, res: Response) => {
  try {
    const standings = await apiFootballService.getF1DriverStandings();
    res.json({ 
      standings,
      formatted: apiFootballService.formatF1Standings(standings),
      count: standings.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD ENRICHI - Big 5 Matchs avec Cotes et Stats
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard/big5/upcoming', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 14;
    const allLeagues = req.query.all === 'true';
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);
    
    const fromStr = today.toISOString().split('T')[0];
    const toStr = endDate.toISOString().split('T')[0];
    
    const targetLeagues = allLeagues ? ALL_EUROPEAN_LEAGUES : BIG5_LEAGUES;
    
    const leaguePromises = Object.entries(targetLeagues).map(async ([code, league]) => {
      const matches = await apiFootballService.getFixturesByLeague(league.id, fromStr, toStr);
      return { code, league, matches };
    });
    
    const results = await Promise.all(leaguePromises);
    
    const allFixtureIds = new Set<number>();
    for (const { matches } of results) {
      for (const m of matches) {
        allFixtureIds.add(m.fixture.id);
      }
    }

    const currentYear = today.getFullYear();
    const season = today.getMonth() >= 7 ? currentYear : currentYear - 1;

    const oddsMap: Record<number, any> = {};
    const allMarketsMap: Record<number, any> = {};
    try {
      const leagueOddsPromises = Object.entries(targetLeagues).map(async ([code, league]) => {
        const leagueOdds = await apiFootballService.getOddsForLeague(league.id, season);
        return { code, leagueId: league.id, odds: leagueOdds };
      });
      const leagueOddsResults = await Promise.all(leagueOddsPromises);

      let totalFound = 0;
      const missingFixtures: number[] = [];

      for (const { odds: leagueOdds } of leagueOddsResults) {
        leagueOdds.forEach((oddsData: any, fixtureId: number) => {
          if (!allFixtureIds.has(fixtureId)) return;
          const parsed = parseOddsData(fixtureId, oddsData, apiFootballService, allMarketsMap);
          if (parsed) {
            oddsMap[fixtureId] = parsed;
            totalFound++;
          }
        });
      }

      Array.from(allFixtureIds).forEach(fid => {
        if (!oddsMap[fid]) missingFixtures.push(fid);
      });

      if (missingFixtures.length > 0) {
        console.log(`[Dashboard] Fetching ${missingFixtures.length} missing fixtures individually`);
        for (let i = 0; i < missingFixtures.length; i += 5) {
          const chunk = missingFixtures.slice(i, i + 5);
          const chunkResults = await Promise.all(chunk.map(async (fid) => {
            try {
              const odds = await apiFootballService.getOddsForFixture(fid);
              if (odds && odds.length > 0) {
                return parseOddsData(fid, odds, apiFootballService, allMarketsMap);
              }
            } catch {}
            return null;
          }));
          for (const r of chunkResults) {
            if (r) { oddsMap[r.fixtureId] = r; totalFound++; }
          }
          if (i + 5 < missingFixtures.length) await new Promise(r => setTimeout(r, 250));
        }
      }
      console.log(`[Dashboard] Odds coverage: ${totalFound}/${allFixtureIds.size} fixtures (${Math.round(totalFound/allFixtureIds.size*100)}%)`);
    } catch (e) {
      console.log('[Dashboard] Failed to fetch odds, continuing without:', (e as Error).message);
    }
    
    // Format matches with enriched data including odds
    const matchesByLeague: Record<string, any[]> = {};
    let totalMatches = 0;
    
    for (const { code, league, matches } of results) {
      matchesByLeague[code] = matches.map(m => {
        const matchOdds = oddsMap[m.fixture.id];
        return {
          fixtureId: m.fixture.id,
          date: m.fixture.date,
          status: m.fixture.status.short,
          league: { id: league.id, name: league.name, code },
          homeTeam: {
            id: m.teams.home.id,
            name: m.teams.home.name,
            logo: m.teams.home.logo,
          },
          awayTeam: {
            id: m.teams.away.id,
            name: m.teams.away.name,
            logo: m.teams.away.logo,
          },
          goals: m.goals,
          odds: matchOdds ? {
            homeOdds: matchOdds.homeOdds,
            drawOdds: matchOdds.drawOdds,
            awayOdds: matchOdds.awayOdds,
            over25Odds: matchOdds.over25Odds,
            under25Odds: matchOdds.under25Odds,
            bttsYes: matchOdds.bttsYes,
            bttsNo: matchOdds.bttsNo,
            dc1X: matchOdds.dc1X,
            dcX2: matchOdds.dcX2,
            dc12: matchOdds.dc12,
            bookmaker: matchOdds.bookmaker,
            totalMarkets: matchOdds.totalMarkets || 0,
          } : null,
        };
      });
      totalMatches += matches.length;
    }
    
    res.json({
      success: true,
      period: { from: fromStr, to: toStr },
      totalMatches,
      matchesByLeague,
      leagues: allLeagues ? ALL_EUROPEAN_LEAGUES : BIG5_LEAGUES,
      allMarketsMap, // Include full betting markets data
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get ALL betting markets for a specific fixture
router.get('/dashboard/match/:fixtureId/all-markets', async (req: Request, res: Response) => {
  try {
    const fixtureId = parseInt(req.params.fixtureId);
    
    const odds = await apiFootballService.getOddsForFixture(fixtureId);
    if (!odds || !odds.length) {
      return res.json({ success: true, fixtureId, markets: null, message: 'No odds available' });
    }
    
    const allMarkets = apiFootballService.extractAllBettingMarkets(odds);
    
    res.json({
      success: true,
      fixtureId,
      ...allMarkets,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dashboard/match/:fixtureId/enriched', async (req: Request, res: Response) => {
  try {
    const fixtureId = parseInt(req.params.fixtureId);
    
    // Fetch odds and fixture info in parallel
    const [odds, fixture] = await Promise.all([
      apiFootballService.getOddsForFixture(fixtureId),
      apiFootballService.getFixtureById(fixtureId),
    ]);
    
    // Extract all betting markets
    const allMarkets = odds ? apiFootballService.extractAllBettingMarkets(odds) : null;
    
    res.json({
      success: true,
      fixtureId,
      fixture,
      allMarkets,
      quickOdds: allMarkets?.markets?.matchWinner ? {
        homeOdds: allMarkets.markets.matchWinner.home,
        drawOdds: allMarkets.markets.matchWinner.draw,
        awayOdds: allMarkets.markets.matchWinner.away,
        bookmaker: allMarkets.bookmaker,
        totalMarkets: allMarkets.totalMarketsCount,
      } : null,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dashboard/odds/date/:date', async (req: Request, res: Response) => {
  try {
    const dateStr = req.params.date; // Format: YYYY-MM-DD
    const dateObj = new Date(dateStr + 'T00:00:00Z');
    const leagueId = req.query.league ? parseInt(req.query.league as string) : undefined;
    
    // Fetch odds for all Big 5 leagues on this date
    const big5Ids = Object.values(BIG5_LEAGUES).map(l => l.id);
    const targetLeagues = leagueId ? [leagueId] : big5Ids;
    
    const oddsPromises = targetLeagues.map(async (lid) => {
      const odds = await apiSportsOddsService.getOddsForDate(dateObj, lid);
      return { leagueId: lid, odds };
    });
    
    const results = await Promise.all(oddsPromises);
    const allOdds = results.flatMap(r => r.odds || []);
    
    res.json({
      success: true,
      date: dateStr,
      count: allOdds.length,
      odds: allOdds,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dashboard/team/:teamName/stats', async (req: Request, res: Response) => {
  try {
    const teamName = req.params.teamName;
    
    // Try Footdatas first
    const footdatasClubs = await footdatasService.searchClubs(teamName);
    
    if (footdatasClubs.length > 0) {
      const club = footdatasClubs[0];
      const teamData = await footdatasService.getTeamDataForPrediction(club.name, club.name);
      
      res.json({
        success: true,
        source: 'footdatas',
        team: {
          id: club.id,
          name: club.name,
          logo: club.logoUrl,
        },
        stats: teamData,
      });
      return;
    }
    
    // Fallback to API Football
    const matches = await apiFootballService.getFootballMatchesByTeam(teamName);
    if (matches.length > 0) {
      const teamId = matches[0].teams.home.name.toLowerCase().includes(teamName.toLowerCase())
        ? matches[0].teams.home.id
        : matches[0].teams.away.id;
      const stats = await apiFootballService.getTeamStats(teamId);
      
      res.json({
        success: true,
        source: 'api-football',
        team: {
          id: teamId,
          name: teamName,
        },
        stats,
      });
      return;
    }
    
    res.json({ success: false, error: 'Team not found' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const [liveMatches, todayMatches, basketball] = await Promise.allSettled([
      apiFootballService.getLiveFootballMatches(),
      apiFootballService.getTodayFootballMatches(),
      apiFootballService.getTodayBasketballGames()
    ]);

    const summary = [];
    
    if (liveMatches.status === 'fulfilled' && liveMatches.value.length > 0) {
      summary.push(`⚽ MATCHS EN DIRECT:\n${apiFootballService.formatFootballMatches(liveMatches.value.slice(0, 5))}`);
    }
    
    if (todayMatches.status === 'fulfilled' && todayMatches.value.length > 0) {
      summary.push(`📅 MATCHS DU JOUR:\n${apiFootballService.formatFootballMatches(todayMatches.value.slice(0, 5))}`);
    }
    
    if (basketball.status === 'fulfilled' && basketball.value.length > 0) {
      summary.push(`🏀 BASKETBALL:\n${apiFootballService.formatBasketballGames(basketball.value.slice(0, 3))}`);
    }

    res.json({
      summary: summary.join('\n\n') || 'Aucun match en cours ou à venir.',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// MATCH CONTEXT (Events, Lineups, Predictions, Live Odds)
// ═══════════════════════════════════════════════════════════════

router.get('/fixture/:fixtureId/events', async (req: Request, res: Response) => {
  try {
    const fixtureId = parseInt(req.params.fixtureId);
    if (isNaN(fixtureId)) return res.status(400).json({ error: 'Invalid fixture ID' });
    const events = await apiFootballService.getFixtureEvents(fixtureId);
    res.json({ success: true, count: events.length, events, formatted: apiFootballService.formatEvents(events) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/fixture/:fixtureId/lineups', async (req: Request, res: Response) => {
  try {
    const fixtureId = parseInt(req.params.fixtureId);
    if (isNaN(fixtureId)) return res.status(400).json({ error: 'Invalid fixture ID' });
    const lineups = await apiFootballService.getFixtureLineups(fixtureId);
    res.json({ success: true, count: lineups.length, lineups, formatted: apiFootballService.formatLineups(lineups) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/fixture/:fixtureId/prediction', async (req: Request, res: Response) => {
  try {
    const fixtureId = parseInt(req.params.fixtureId);
    if (isNaN(fixtureId)) return res.status(400).json({ error: 'Invalid fixture ID' });
    const prediction = await apiFootballService.getFixturePrediction(fixtureId);
    res.json({ success: true, prediction });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/fixture/:fixtureId/odds/live', async (req: Request, res: Response) => {
  try {
    const fixtureId = parseInt(req.params.fixtureId);
    if (isNaN(fixtureId)) return res.status(400).json({ error: 'Invalid fixture ID' });
    const odds = await apiFootballService.getLiveOdds(fixtureId);
    res.json({ success: true, count: odds.length, odds });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PEOPLE (Players, Squads, Coaches, Injuries, Transfers, Trophies)
// ═══════════════════════════════════════════════════════════════

router.get('/players/search/:name', async (req: Request, res: Response) => {
  try {
    const name = req.params.name;
    const leagueId = req.query.league ? parseInt(req.query.league as string) : undefined;
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    const players = await apiFootballService.searchPlayer(name, leagueId, season);
    res.json({ success: true, count: players.length, players });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/players/:playerId', async (req: Request, res: Response) => {
  try {
    const playerId = parseInt(req.params.playerId);
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });
    const player = await apiFootballService.getPlayerStats(playerId, season);
    res.json({ success: true, player });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/teams/:teamId/squad', async (req: Request, res: Response) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (isNaN(teamId)) return res.status(400).json({ error: 'Invalid team ID' });
    const squad = await apiFootballService.getTeamSquad(teamId);
    res.json({ success: true, squad });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/injuries', async (req: Request, res: Response) => {
  try {
    const leagueId = req.query.league ? parseInt(req.query.league as string) : undefined;
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    const fixtureId = req.query.fixture ? parseInt(req.query.fixture as string) : undefined;
    const injuries = await apiFootballService.getInjuries(leagueId, season, fixtureId);
    res.json({ success: true, count: injuries.length, injuries, formatted: apiFootballService.formatInjuries(injuries) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/transfers', async (req: Request, res: Response) => {
  try {
    const playerId = req.query.player ? parseInt(req.query.player as string) : undefined;
    const teamId = req.query.team ? parseInt(req.query.team as string) : undefined;
    if (!playerId && !teamId) return res.status(400).json({ error: 'Provide player or team parameter' });
    const transfers = await apiFootballService.getTransfers(playerId, teamId);
    res.json({ success: true, count: transfers.length, transfers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/coaches', async (req: Request, res: Response) => {
  try {
    const teamId = req.query.team ? parseInt(req.query.team as string) : undefined;
    const coachId = req.query.id ? parseInt(req.query.id as string) : undefined;
    if (!teamId && !coachId) return res.status(400).json({ error: 'Provide team or id parameter' });
    const coaches = await apiFootballService.getCoach(teamId, coachId);
    res.json({ success: true, count: coaches.length, coaches });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/trophies', async (req: Request, res: Response) => {
  try {
    const playerId = req.query.player ? parseInt(req.query.player as string) : undefined;
    const coachId = req.query.coach ? parseInt(req.query.coach as string) : undefined;
    if (!playerId && !coachId) return res.status(400).json({ error: 'Provide player or coach parameter' });
    const trophies = await apiFootballService.getTrophies(playerId, coachId);
    res.json({ success: true, count: trophies.length, trophies });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FOOT-ALMANACH (Countries, Leagues, Teams, Standings)
// ═══════════════════════════════════════════════════════════════

router.get('/almanach/countries', async (_req: Request, res: Response) => {
  try {
    const countriesMap: Record<string, { name: string; leagues: { id: number; name: string; code: string; type: string }[] }> = {};
    for (const [code, league] of Object.entries(ALL_EUROPEAN_LEAGUES)) {
      const country = league.country;
      if (!countriesMap[country]) {
        countriesMap[country] = { name: country, leagues: [] };
      }
      countriesMap[country].leagues.push({ id: league.id, name: league.name, code, type: code.length <= 3 && !['UCL', 'UEL'].includes(code) ? 'league' : 'cup' });
    }
    const countries = Object.values(countriesMap).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, countries });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/available-seasons', async (_req: Request, res: Response) => {
  try {
    const current = APIFootballService.getCurrentFootballSeason();
    const seasons = [current, current - 1, current - 2].map(y => ({
      year: y,
      label: `${y}/${y + 1}`,
      isCurrent: y === current,
    }));
    res.json({ success: true, seasons });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/standings/:leagueId', async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const season = req.query.season ? parseInt(req.query.season as string) : APIFootballService.getCurrentFootballSeason();
    if (isNaN(leagueId)) return res.status(400).json({ error: 'Invalid league ID' });
    const standings = await footballCacheService.getStandings(leagueId, season);
    const leagueInfo = Object.values(ALL_EUROPEAN_LEAGUES).find(l => l.id === leagueId);
    res.json({ success: true, standings, league: leagueInfo || null, season });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/team/:teamId', async (req: Request, res: Response) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    if (isNaN(teamId)) return res.status(400).json({ error: 'Invalid team ID' });
    const [squad, stats] = await Promise.all([
      footballCacheService.getTeamSquad(teamId, season),
      footballCacheService.getTeamStats(teamId, 10, season),
    ]);

    if (squad?.players) {
      const numberMap = new Map<number, any[]>();
      for (const p of squad.players) {
        const num = p.number ?? -1;
        if (!numberMap.has(num)) numberMap.set(num, []);
        numberMap.get(num)!.push(p);
      }
      const kept = new Set<any>();
      for (const [num, players] of numberMap) {
        if (num === -1 || players.length === 1) {
          players.forEach(p => kept.add(p));
        } else {
          const best = players.reduce((a, b) => (a.age || 0) > (b.age || 0) ? a : b);
          kept.add(best);
        }
      }
      squad.players = squad.players.filter((p: any) => {
        if (!kept.has(p)) return false;
        const num = p.number ?? 0;
        const age = p.age ?? 30;
        if (num >= 50 && age < 21) return false;
        return true;
      });
    }

    res.json({ success: true, squad, stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/player/:playerId', async (req: Request, res: Response) => {
  try {
    const playerId = parseInt(req.params.playerId);
    const season = req.query.season ? parseInt(req.query.season as string) : APIFootballService.getCurrentFootballSeason();
    const teamId = req.query.team ? parseInt(req.query.team as string) : undefined;
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });
    const playerInfo = await apiFootballService.getPlayerStats(playerId, season);
    if (!playerInfo) return res.status(404).json({ success: false, error: 'Player not found' });

    const DOMESTIC_LEAGUE_IDS = new Set([
      61, 62,
      39, 40,
      140, 141,
      78, 79,
      135, 136,
      144, 88, 94, 203, 119, 197, 253, 188,
      169, 106, 113, 235, 179, 271, 345, 218, 327, 332,
    ]);

    const allStats = playerInfo.statistics || [];
    const clubStats = teamId
      ? allStats.filter(s => s.team.id === teamId)
      : allStats.filter(s => s.league.country !== playerInfo.player.nationality);

    const domesticStat = clubStats.find(s => DOMESTIC_LEAGUE_IDS.has(s.league.id));

    function aggregateStats(statsArr: typeof allStats) {
      if (!statsArr.length) return null;
      const base = statsArr[0];
      const agg = {
        team: base.team,
        league: { ...base.league },
        games: { ...base.games },
        goals: { ...base.goals },
        shots: { ...base.shots },
        passes: { ...base.passes },
        tackles: { ...base.tackles },
        duels: { ...base.duels },
        dribbles: { ...base.dribbles },
        fouls: { ...base.fouls },
        cards: { ...base.cards },
        penalty: { ...base.penalty },
      };
      for (const s of statsArr.slice(1)) {
        agg.games.appearences += s.games.appearences || 0;
        agg.games.lineups += s.games.lineups || 0;
        agg.games.minutes += s.games.minutes || 0;
        agg.goals.total = (agg.goals.total || 0) + (s.goals.total || 0);
        agg.goals.assists = (agg.goals.assists || 0) + (s.goals.assists || 0);
        agg.goals.conceded = (agg.goals.conceded || 0) + (s.goals.conceded || 0);
        agg.shots.total = (agg.shots.total || 0) + (s.shots.total || 0);
        agg.shots.on = (agg.shots.on || 0) + (s.shots.on || 0);
        agg.passes.total = (agg.passes.total || 0) + (s.passes.total || 0);
        agg.passes.key = (agg.passes.key || 0) + (s.passes.key || 0);
        agg.tackles.total = (agg.tackles.total || 0) + (s.tackles.total || 0);
        agg.tackles.blocks = (agg.tackles.blocks || 0) + (s.tackles.blocks || 0);
        agg.tackles.interceptions = (agg.tackles.interceptions || 0) + (s.tackles.interceptions || 0);
        agg.duels.total = (agg.duels.total || 0) + (s.duels.total || 0);
        agg.duels.won = (agg.duels.won || 0) + (s.duels.won || 0);
        agg.dribbles.attempts = (agg.dribbles.attempts || 0) + (s.dribbles.attempts || 0);
        agg.dribbles.success = (agg.dribbles.success || 0) + (s.dribbles.success || 0);
        agg.fouls.drawn = (agg.fouls.drawn || 0) + (s.fouls.drawn || 0);
        agg.fouls.committed = (agg.fouls.committed || 0) + (s.fouls.committed || 0);
        agg.cards.yellow += s.cards.yellow || 0;
        agg.cards.yellowred += s.cards.yellowred || 0;
        agg.cards.red += s.cards.red || 0;
        agg.penalty.won = (agg.penalty.won || 0) + (s.penalty.won || 0);
        agg.penalty.scored = (agg.penalty.scored || 0) + (s.penalty.scored || 0);
        agg.penalty.missed = (agg.penalty.missed || 0) + (s.penalty.missed || 0);
      }
      const ratings = statsArr
        .map(s => s.games.rating ? parseFloat(s.games.rating) : null)
        .filter((r): r is number => r !== null);
      if (ratings.length > 0) {
        const weights = statsArr.map(s => s.games.appearences || 1);
        const validWeights = weights.filter((_, i) => statsArr[i].games.rating);
        const weightedSum = ratings.reduce((sum, r, i) => sum + r * validWeights[i], 0);
        const totalWeight = validWeights.reduce((a, b) => a + b, 0);
        agg.games.rating = (weightedSum / totalWeight).toFixed(1);
      }
      return agg;
    }

    const allCompAgg = clubStats.length > 1 ? aggregateStats(clubStats) : null;
    if (allCompAgg) {
      allCompAgg.league.name = "Toutes competitions";
    }

    const bestDomestic = domesticStat || clubStats.reduce((best, s) =>
      DOMESTIC_LEAGUE_IDS.has(s.league.id) || (s.games.appearences || 0) > (best?.games.appearences || 0) ? s : best
    , clubStats[0]) || allStats[0];
    const primaryStat = bestDomestic;
    const ordered = [primaryStat, ...allStats.filter(s => s !== primaryStat)];
    playerInfo.statistics = ordered;

    const domesticLeagueName = domesticStat?.league.name
      || clubStats.find(s => DOMESTIC_LEAGUE_IDS.has(s.league.id))?.league.name
      || null;

    res.json({
      success: true,
      player: playerInfo,
      aggregated: allCompAgg,
      domesticLeagueName,
      competitions: clubStats.map(s => ({
        league: s.league.name,
        leagueId: s.league.id,
        matches: s.games.appearences,
        goals: s.goals.total || 0,
        assists: s.goals.assists || 0,
        rating: s.games.rating,
        minutes: s.games.minutes,
        cards: { yellow: s.cards.yellow, red: s.cards.red + s.cards.yellowred },
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/db-stats', async (_req: Request, res: Response) => {
  try {
    const stats = await footballCacheService.getDbStats();
    res.json({ success: true, ...stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/team-history/:apiTeamId', async (req: Request, res: Response) => {
  try {
    const apiTeamId = parseInt(req.params.apiTeamId);
    if (isNaN(apiTeamId)) return res.status(400).json({ error: 'Invalid team ID' });
    const history = await footballCacheService.getTeamHistoryFromDb(apiTeamId);
    res.json({ success: true, ...history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/league-history/:leagueId', async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    if (isNaN(leagueId)) return res.status(400).json({ error: 'Invalid league ID' });
    const history = await footballCacheService.getLeagueHistoryFromDb(leagueId);
    res.json({ success: true, seasons: history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/almanach/search-team', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    if (!q) return res.status(400).json({ error: 'Query required' });
    const results = await footballCacheService.searchTeamInDb(q);
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// COMPETITION META (Seasons, Top Scorers)
// ═══════════════════════════════════════════════════════════════

router.get('/seasons', async (req: Request, res: Response) => {
  try {
    const seasons = await apiFootballService.getSeasons();
    res.json({ success: true, count: seasons.length, seasons });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/leagues/:leagueId/topscorers', async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    if (isNaN(leagueId)) return res.status(400).json({ error: 'Invalid league ID' });
    const scorers = await apiFootballService.getTopScorers(leagueId, season);
    res.json({ success: true, count: scorers.length, scorers, formatted: apiFootballService.formatTopScorers(scorers) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/leagues/:leagueId/topassists', async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    if (isNaN(leagueId)) return res.status(400).json({ error: 'Invalid league ID' });
    const assists = await apiFootballService.getTopAssists(leagueId, season);
    res.json({ success: true, count: assists.length, assists, formatted: apiFootballService.formatTopScorers(assists) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/leagues/:leagueId/topcards', async (req: Request, res: Response) => {
  try {
    const leagueId = parseInt(req.params.leagueId);
    const season = req.query.season ? parseInt(req.query.season as string) : undefined;
    if (isNaN(leagueId)) return res.status(400).json({ error: 'Invalid league ID' });
    const cards = await apiFootballService.getTopCards(leagueId, season);
    res.json({ success: true, count: cards.length, cards });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/screen-context', (req: Request, res: Response) => {
  const userId = (req as any).userId || (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const state = req.body;
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'Invalid state' });
  updateSportsScreen(userId, state);
  res.json({ ok: true });
});

router.delete('/screen-context', (req: Request, res: Response) => {
  const userId = (req as any).userId || (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  clearSportsScreen(userId);
  res.json({ ok: true });
});

router.get('/screen-context', (req: Request, res: Response) => {
  const userId = (req as any).userId || (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const ctx = getSportsScreen(userId);
  res.json({ context: ctx });
});

export default router;
