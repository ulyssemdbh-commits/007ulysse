import { footdatasService } from "./footdatasService";
import { TEAM_TO_LEAGUE_MAP } from "./footdatasInitializer";

export function detectLeagueFromTeamName(teamName: string): string | null {
  const normalized = teamName.toLowerCase().trim();
  
  if (TEAM_TO_LEAGUE_MAP.has(normalized)) {
    return TEAM_TO_LEAGUE_MAP.get(normalized)!;
  }
  
  for (const [key, league] of TEAM_TO_LEAGUE_MAP.entries()) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return league;
    }
  }
  
  return null;
}

export function detectTeamsFromText(text: string): string[] {
  const teams: string[] = [];
  const lowerText = text.toLowerCase();
  
  for (const teamName of TEAM_TO_LEAGUE_MAP.keys()) {
    if (lowerText.includes(teamName)) {
      teams.push(teamName);
    }
  }
  
  return [...new Set(teams)];
}

export function detectMatchupFromText(text: string): { home: string; away: string } | null {
  const teams = detectTeamsFromText(text);
  if (teams.length !== 2) return null;
  
  const matchPatterns = [
    /(\w+)\s*[-–—vs.]+\s*(\w+)/i,
    /(\w+)\s+contre\s+(\w+)/i,
    /(\w+)\s+vs\.?\s+(\w+)/i,
  ];
  
  const lowerText = text.toLowerCase();
  for (const pattern of matchPatterns) {
    const match = lowerText.match(pattern);
    if (match) {
      const [, team1, team2] = match;
      const home = teams.find(t => team1.includes(t) || t.includes(team1));
      const away = teams.find(t => team2.includes(t) || t.includes(team2));
      if (home && away && home !== away) {
        return { home, away };
      }
    }
  }
  
  return { home: teams[0], away: teams[1] };
}

export interface FootdatasExtraction {
  clubId: number;
  dataType: 'player' | 'staff' | 'transfer' | 'news' | 'ranking' | 'stats' | 'history';
  data: {
    rawMessage: string;
    rawResponse: string;
    context: string;
    matchup?: { home: string; away: string };
    extractedText?: string;
  };
  source: string;
  extractedAt: Date;
}

function extractRelevantContext(text: string, keywords: string[], maxLength: number = 200): string {
  const lowerText = text.toLowerCase();
  for (const keyword of keywords) {
    const idx = lowerText.indexOf(keyword.toLowerCase());
    if (idx !== -1) {
      const start = Math.max(0, idx - 50);
      const end = Math.min(text.length, idx + maxLength);
      return text.substring(start, end).trim();
    }
  }
  return text.substring(0, maxLength).trim();
}

export async function processFootdatasFromConversation(
  message: string,
  response: string,
  context?: { homework?: any; scrapeResult?: any }
): Promise<FootdatasExtraction[]> {
  const extractions: FootdatasExtraction[] = [];
  
  const teamsInMessage = detectTeamsFromText(message);
  const teamsInResponse = detectTeamsFromText(response);
  const allTeams = [...new Set([...teamsInMessage, ...teamsInResponse])];
  
  if (allTeams.length === 0) return extractions;
  
  const matchup = detectMatchupFromText(`${message} ${response}`);
  
  for (const teamName of allTeams) {
    const club = await footdatasService.getClubByName(teamName) ||
                 await footdatasService.getClubByShortName(teamName);
    
    if (!club) continue;
    
    const patterns = {
      transfer: /transfert|mercato|signe|rejoint|quitte|prêt|loan|sign|€|million/i,
      ranking: /classement|position|points|victoire|match|journée|standing/i,
      player: /joueur|player|goal|but|passe|assist|contrat|bless[eé]/i,
      news: /annonce|info|actu|news|officiel|communiqué/i,
      stats: /statistique|stat|performance|pourcentage|moyenne/i,
    };
    
    const fullText = `${message} ${response}`;
    let detectedType: FootdatasExtraction['dataType'] = 'news';
    let keywords: string[] = ['info'];
    
    if (patterns.transfer.test(fullText)) {
      detectedType = 'transfer';
      keywords = ['transfert', 'mercato', 'signe', 'million', '€'];
    } else if (patterns.ranking.test(fullText)) {
      detectedType = 'ranking';
      keywords = ['classement', 'position', 'points', 'victoire'];
    } else if (patterns.player.test(fullText)) {
      detectedType = 'player';
      keywords = ['joueur', 'but', 'passe', 'blessé'];
    } else if (patterns.stats.test(fullText)) {
      detectedType = 'stats';
      keywords = ['statistique', 'performance', 'moyenne'];
    }
    
    extractions.push({
      clubId: club.id,
      dataType: detectedType,
      data: {
        rawMessage: message.substring(0, 500),
        rawResponse: response.substring(0, 1000),
        context: context?.homework?.title || 'conversation',
        matchup: matchup || undefined,
        extractedText: extractRelevantContext(response, keywords),
      },
      source: 'conversation',
      extractedAt: new Date(),
    });
  }
  
  return extractions;
}

export interface InjectionScrapeResult {
  clubsUpdated: number;
  itemsAdded: number;
  itemsSkipped: number;
  errors: string[];
}

export async function injectScrapedDataToFootdatas(
  dataType: string,
  scrapedData: any[],
  sourceUrl: string
): Promise<InjectionScrapeResult> {
  const result: InjectionScrapeResult = {
    clubsUpdated: 0,
    itemsAdded: 0,
    itemsSkipped: 0,
    errors: [],
  };
  const updatedClubs = new Set<number>();
  
  if (dataType === 'rankings' && Array.isArray(scrapedData)) {
    for (const entry of scrapedData) {
      try {
        const teamName = entry.team || entry.teamName || entry.club;
        if (!teamName) continue;
        
        const club = await footdatasService.getClubByName(teamName) ||
                     await footdatasService.getClubByShortName(teamName);
        
        if (club) {
          const { isNew } = await footdatasService.upsertRanking({
            clubId: club.id,
            competition: entry.competition || detectLeagueFromTeamName(teamName) || 'Unknown',
            season: entry.season || getCurrentSeason(),
            matchday: entry.matchday,
            position: entry.position || entry.rank,
            points: entry.points || 0,
            matchesPlayed: entry.played || entry.matchesPlayed,
            wins: entry.wins || entry.w,
            draws: entry.draws || entry.d,
            losses: entry.losses || entry.l,
            goalsFor: entry.goalsFor || entry.gf,
            goalsAgainst: entry.goalsAgainst || entry.ga,
            goalDifference: entry.goalDifference || entry.gd,
            form: entry.form,
          });
          
          if (isNew) {
            result.itemsAdded++;
          } else {
            result.itemsSkipped++;
          }
          updatedClubs.add(club.id);
        }
      } catch (e: any) {
        result.errors.push(`Ranking ${entry.team}: ${e.message}`);
      }
    }
  }
  
  if (dataType === 'topscorers' && Array.isArray(scrapedData)) {
    for (const scorer of scrapedData) {
      try {
        const teamName = scorer.team || scorer.teamName;
        if (!teamName) continue;
        
        const club = await footdatasService.getClubByName(teamName) ||
                     await footdatasService.getClubByShortName(teamName);
        
        if (club) {
          const existingPlayer = await footdatasService.getPlayerByName(club.id, scorer.player || scorer.name);
          
          if (existingPlayer) {
            await footdatasService.upsertPlayerStats({
              playerId: existingPlayer.id,
              clubId: club.id,
              season: getCurrentSeason(),
              competition: scorer.competition || detectLeagueFromTeamName(teamName) || 'Unknown',
              goals: scorer.goals || scorer.buts || 0,
              appearances: scorer.appearances || scorer.matches || 0,
            });
            result.itemsAdded++;
            updatedClubs.add(club.id);
          }
        }
      } catch (e: any) {
        result.errors.push(`Topscorer ${scorer.player}: ${e.message}`);
      }
    }
  }
  
  if (dataType === 'transfers' && Array.isArray(scrapedData)) {
    for (const transfer of scrapedData) {
      try {
        const teamName = transfer.team || transfer.club || transfer.toClub || transfer.fromClub;
        if (!teamName) continue;
        
        const club = await footdatasService.getClubByName(teamName) ||
                     await footdatasService.getClubByShortName(teamName);
        
        if (club) {
          const { isNew } = await footdatasService.upsertTransfer({
            clubId: club.id,
            playerName: transfer.player || transfer.playerName,
            transferType: transfer.type || (transfer.toClub ? 'in' : 'out'),
            fromClub: transfer.fromClub,
            toClub: transfer.toClub,
            fee: transfer.fee || transfer.amount,
            transferDate: transfer.date ? new Date(transfer.date) : new Date(),
            transferWindow: transfer.window || getCurrentWindow(),
          });
          
          if (isNew) {
            result.itemsAdded++;
          } else {
            result.itemsSkipped++;
          }
          updatedClubs.add(club.id);
        }
      } catch (e: any) {
        result.errors.push(`Transfer ${transfer.player}: ${e.message}`);
      }
    }
  }
  
  if (dataType === 'news' && Array.isArray(scrapedData)) {
    for (const newsItem of scrapedData) {
      try {
        const teamName = newsItem.team || newsItem.club;
        if (!teamName) continue;
        
        const club = await footdatasService.getClubByName(teamName) ||
                     await footdatasService.getClubByShortName(teamName);
        
        if (club) {
          const { isNew } = await footdatasService.upsertNews({
            clubId: club.id,
            title: newsItem.title,
            content: newsItem.content || newsItem.summary,
            category: newsItem.category || 'general',
            sourceUrl: newsItem.url || sourceUrl,
            publishedAt: newsItem.date ? new Date(newsItem.date) : new Date(),
          });
          
          if (isNew) {
            result.itemsAdded++;
          } else {
            result.itemsSkipped++;
          }
          updatedClubs.add(club.id);
        }
      } catch (e: any) {
        result.errors.push(`News ${newsItem.title?.substring(0, 30)}: ${e.message}`);
      }
    }
  }
  
  result.clubsUpdated = updatedClubs.size;
  console.log(`[FOOTDATAS] Scrape injection: ${result.itemsAdded} added, ${result.itemsSkipped} skipped, ${result.errors.length} errors`);
  return result;
}

function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  
  if (month >= 7) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

function getCurrentWindow(): string {
  const month = new Date().getMonth() + 1;
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 1 && month <= 2) return 'winter';
  return 'other';
}

async function resolveClub(clubName: string) {
  return await footdatasService.getClubByName(clubName) ||
         await footdatasService.getClubByShortName(clubName);
}

export const FOOTDATAS_ULYSSE_TOOLS = {
  name: 'footdatas',
  description: 'Access and manage football data for Big 5 European leagues (Ligue 1, LaLiga, Premier League, Bundesliga, Serie A)',
  functions: {
    getClubInfo: {
      description: 'Get complete information about a football club',
      parameters: {
        clubName: { type: 'string', description: 'Club name or short name (e.g., OM, PSG, Real Madrid)' },
      },
      handler: async (params: { clubName: string }) => {
        return footdatasService.getClubSummaryForAI(params.clubName);
      },
    },
    getClubForm: {
      description: 'Get recent form and performance summary for a club (rankings, stats, recent transfers)',
      parameters: {
        clubName: { type: 'string', description: 'Club name or short name' },
        nbMatches: { type: 'number', description: 'Number of recent matches to consider', default: 5 },
      },
      handler: async (params: { clubName: string; nbMatches?: number }) => {
        const club = await resolveClub(params.clubName);
        if (!club) return `Club ${params.clubName} not found`;
        return footdatasService.getClubFormForAI(club.id, params.nbMatches || 5);
      },
    },
    getKeyPlayers: {
      description: 'Get key players for a club based on goals, assists, and playing time',
      parameters: {
        clubName: { type: 'string', description: 'Club name or short name' },
        limit: { type: 'number', description: 'Number of key players to return', default: 5 },
      },
      handler: async (params: { clubName: string; limit?: number }) => {
        const club = await resolveClub(params.clubName);
        if (!club) return `Club ${params.clubName} not found`;
        return footdatasService.getKeyPlayersForAI(club.id, params.limit || 5);
      },
    },
    searchClubs: {
      description: 'Search for football clubs by name',
      parameters: {
        query: { type: 'string', description: 'Search query' },
      },
      handler: async (params: { query: string }) => {
        const clubs = await footdatasService.searchClubs(params.query);
        return clubs.map(c => `${c.name} (${c.shortName})`).join(', ') || 'No clubs found';
      },
    },
    getLeagueClubs: {
      description: 'Get all clubs from a specific league',
      parameters: {
        leagueCode: { type: 'string', description: 'League code: L1, LL, PL, BL, SA' },
      },
      handler: async (params: { leagueCode: string }) => {
        const league = await footdatasService.getLeagueByCode(params.leagueCode);
        if (!league) return `League ${params.leagueCode} not found`;
        const clubs = await footdatasService.getClubsByLeague(league.id);
        return clubs.map(c => c.name).join(', ');
      },
    },
    getClubPlayers: {
      description: 'Get all players from a club',
      parameters: {
        clubName: { type: 'string', description: 'Club name or short name' },
      },
      handler: async (params: { clubName: string }) => {
        const club = await resolveClub(params.clubName);
        if (!club) return `Club ${params.clubName} not found`;
        const players = await footdatasService.getPlayers(club.id);
        if (players.length === 0) return `No players registered for ${club.name}`;
        return players.map(p => `#${p.shirtNumber || '?'} ${p.name} (${p.position || 'N/A'})`).join('\n');
      },
    },
    getClubTransfers: {
      description: 'Get recent transfers for a club',
      parameters: {
        clubName: { type: 'string', description: 'Club name or short name' },
        limit: { type: 'number', description: 'Number of transfers to return', default: 10 },
      },
      handler: async (params: { clubName: string; limit?: number }) => {
        const club = await resolveClub(params.clubName);
        if (!club) return `Club ${params.clubName} not found`;
        const transfers = await footdatasService.getRecentTransfers(club.id, params.limit || 10);
        if (transfers.length === 0) return `No transfers registered for ${club.name}`;
        return transfers.map(t => {
          const direction = t.transferType.includes('in') ? '←' : '→';
          return `${direction} ${t.playerName} (${t.fee || 'N/A'}) - ${t.transferWindow}`;
        }).join('\n');
      },
    },
    getClubTrophies: {
      description: 'Get trophy cabinet for a club',
      parameters: {
        clubName: { type: 'string', description: 'Club name or short name' },
      },
      handler: async (params: { clubName: string }) => {
        const club = await resolveClub(params.clubName);
        if (!club) return `Club ${params.clubName} not found`;
        const trophyCount = await footdatasService.getTrophyCount(club.id);
        if (trophyCount.length === 0) return `No trophies registered for ${club.name}`;
        return trophyCount.map(t => `${t.competition}: ${t.count}x`).join('\n');
      },
    },
    getClubRanking: {
      description: 'Get current league ranking for a club',
      parameters: {
        clubName: { type: 'string', description: 'Club name or short name' },
      },
      handler: async (params: { clubName: string }) => {
        const club = await resolveClub(params.clubName);
        if (!club) return `Club ${params.clubName} not found`;
        const ranking = await footdatasService.getLatestRanking(club.id, club.currentLeague || 'league');
        if (!ranking) return `No ranking data for ${club.name}`;
        return `${club.name}: ${ranking.position}e (${ranking.points} pts) - ${ranking.goalsFor || 0} buts marqués, ${ranking.goalsAgainst || 0} encaissés`;
      },
    },
    extractAndStore: {
      description: 'Extract football data from a conversation and store in database',
      parameters: {
        message: { type: 'string', description: 'User message' },
        response: { type: 'string', description: 'AI response' },
      },
      handler: async (params: { message: string; response: string }) => {
        const extractions = await processFootdatasFromConversation(params.message, params.response);
        return `Extracted ${extractions.length} data points from conversation`;
      },
    },
    getStoredMatches: {
      description: 'Get stored matches from database (injected by homework from matchendirect.fr). Use this FIRST before fetching live data.',
      parameters: {
        date: { type: 'string', description: 'Date in DD-MM-YYYY format (e.g., 02-02-2026). Leave empty for today.' },
        league: { type: 'string', description: 'League code: L1, LL, PL, BL, SA, or all' },
      },
      handler: async (params: { date?: string; league?: string }) => {
        const targetDate = params.date || formatDateDDMMYYYY(new Date());
        const matches = await footdatasService.getMatchesByDate(targetDate);
        
        if (matches.length === 0) {
          return `Aucun match stocké pour le ${targetDate}. Utilisez query_matchendirect pour récupérer les données live.`;
        }
        
        let filtered = matches;
        if (params.league && params.league !== 'all') {
          filtered = matches.filter(m => m.leagueCode === params.league.toUpperCase());
        }
        
        if (filtered.length === 0) {
          return `Aucun match ${params.league || 'Big 5'} stocké pour le ${targetDate}.`;
        }
        
        const byLeague = new Map<string, typeof filtered>();
        for (const m of filtered) {
          const league = m.leagueCode || 'Unknown';
          if (!byLeague.has(league)) byLeague.set(league, []);
          byLeague.get(league)!.push(m);
        }
        
        let result = `📅 MATCHS DU ${targetDate} (depuis base de données)\n\n`;
        for (const [league, leagueMatches] of byLeague) {
          const leagueName = { L1: 'Ligue 1', LL: 'LaLiga', PL: 'Premier League', BL: 'Bundesliga', SA: 'Serie A' }[league] || league;
          result += `🏆 ${leagueName}:\n`;
          for (const m of leagueMatches) {
            const score = m.status === 'finished' && m.homeScore !== null 
              ? `${m.homeScore}-${m.awayScore}` 
              : m.status === 'scheduled' ? `${m.matchTime || 'TBD'}` : m.status;
            result += `  • ${m.homeTeam} vs ${m.awayTeam} [${score}]\n`;
          }
          result += '\n';
        }
        
        result += `\n📊 Source: FootdatasService (homework injection from matchendirect.fr)`;
        return result;
      },
    },
    getRecentlyStoredMatches: {
      description: 'Get all recently stored matches from homework executions (last 7 days)',
      parameters: {
        league: { type: 'string', description: 'League code: L1, LL, PL, BL, SA, or all' },
        limit: { type: 'number', description: 'Max matches to return', default: 50 },
      },
      handler: async (params: { league?: string; limit?: number }) => {
        const leagueCode = params.league && params.league !== 'all' ? params.league.toUpperCase() : undefined;
        const matches = leagueCode 
          ? await footdatasService.getMatchesByLeague(leagueCode, params.limit || 50)
          : await footdatasService.getRecentMatches(params.limit || 50);
        
        if (matches.length === 0) {
          return `Aucun match stocké${leagueCode ? ` pour ${leagueCode}` : ''}.`;
        }
        
        const byDate = new Map<string, typeof matches>();
        for (const m of matches) {
          const date = m.matchDate || 'Unknown';
          if (!byDate.has(date)) byDate.set(date, []);
          byDate.get(date)!.push(m);
        }
        
        let result = `📊 MATCHS STOCKÉS${leagueCode ? ` (${leagueCode})` : ' (Big 5)'}\n\n`;
        for (const [date, dateMatches] of byDate) {
          result += `📅 ${date}:\n`;
          for (const m of dateMatches) {
            const score = m.status === 'finished' && m.homeScore !== null 
              ? `${m.homeScore}-${m.awayScore}` 
              : m.status;
            result += `  [${m.leagueCode}] ${m.homeTeam} vs ${m.awayTeam} [${score}]\n`;
          }
        }
        
        return result;
      },
    },
  },
};

function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}
