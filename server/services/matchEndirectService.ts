import * as cheerio from 'cheerio';

interface MatchEndirectMatch {
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: 'scheduled' | 'live' | 'finished';
  time: string;
  date: string;
  matchUrl: string;
}

interface MatchEndirectResult {
  date: string;
  totalMatches: number;
  big5Matches: MatchEndirectMatch[];
  byLeague: {
    ligue1: MatchEndirectMatch[];
    laliga: MatchEndirectMatch[];
    premierLeague: MatchEndirectMatch[];
    bundesliga: MatchEndirectMatch[];
    serieA: MatchEndirectMatch[];
  };
}

const BIG5_COMPETITION_PATTERNS: Record<string, RegExp> = {
  ligue1: /France\s*:\s*(Ligue\s*1|Première Division)(?!\s*Femmes)/i,
  laliga: /Espagne\s*:\s*(La\s*Liga|Liga|Primera Division)(?!\s*Femmes)/i,
  premierLeague: /Angleterre\s*:\s*Premier\s*League(?!\s*Femmes)/i,
  bundesliga: /Allemagne\s*:\s*Bundesliga(?!\s*Femmes)/i,
  serieA: /Italie\s*:\s*Serie\s*A(?!\s*Femmes)/i,
};

const EXCLUDE_WOMEN_PATTERN = /femmes|women|féminin/i;

function formatDateForUrl(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function parseDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date();
}

export async function fetchMatchEndirect(date: Date | string): Promise<MatchEndirectResult> {
  const targetDate = typeof date === 'string' ? parseDate(date) : date;
  const dateStr = formatDateForUrl(targetDate);
  const url = `https://www.matchendirect.fr/resultat-foot-${dateStr}/`;
  
  console.log(`[MatchEnDirect] Fetching matches for ${dateStr}...`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    return parseMatchEndirect(html, dateStr);
  } catch (error) {
    console.error(`[MatchEnDirect] Error fetching ${url}:`, error);
    throw error;
  }
}

function parseMatchEndirect(html: string, dateStr: string): MatchEndirectResult {
  const $ = cheerio.load(html);
  
  const result: MatchEndirectResult = {
    date: dateStr,
    totalMatches: 0,
    big5Matches: [],
    byLeague: {
      ligue1: [],
      laliga: [],
      premierLeague: [],
      bundesliga: [],
      serieA: [],
    },
  };
  
  const matchElements = $('a[data-team1][data-team2]').toArray();
  console.log(`[MatchEnDirect] Found ${matchElements.length} match elements`);
  
  for (const el of matchElements) {
    const $el = $(el);
    const competition = $el.attr('data-competitionname') || '';
    const team1 = $el.attr('data-team1')?.trim() || '';
    const team2 = $el.attr('data-team2')?.trim() || '';
    const score1Str = $el.attr('data-score1')?.trim() || '';
    const score2Str = $el.attr('data-score2')?.trim() || '';
    const href = $el.attr('href') || '';
    
    if (!team1 || !team2) continue;
    
    const score1 = score1Str && /^\d+$/.test(score1Str) ? parseInt(score1Str, 10) : null;
    const score2 = score2Str && /^\d+$/.test(score2Str) ? parseInt(score2Str, 10) : null;
    
    const scoreText = $el.find('.lm3_score').text().trim().toLowerCase();
    let status: 'scheduled' | 'live' | 'finished' = 'scheduled';
    if (scoreText === 'v' || scoreText === '') {
      status = 'scheduled';
    } else if (score1 !== null && score2 !== null) {
      const isLive = $el.closest('tr').find('.lm1_minuteLive').length > 0 || 
                     scoreText.includes('mi-temps') || 
                     /^\d+$/.test(scoreText);
      status = isLive ? 'live' : 'finished';
    }
    
    const timeEl = $el.closest('tr').find('.lm2_timeXxX, .lm1_time');
    const time = timeEl.text().trim() || '';
    
    const match: MatchEndirectMatch = {
      competition,
      homeTeam: team1,
      awayTeam: team2,
      homeScore: score1,
      awayScore: score2,
      status,
      time,
      date: dateStr,
      matchUrl: href.startsWith('http') ? href : `https://www.matchendirect.fr${href}`,
    };
    
    result.totalMatches++;
    
    for (const [league, pattern] of Object.entries(BIG5_COMPETITION_PATTERNS)) {
      if (pattern.test(competition) && !EXCLUDE_WOMEN_PATTERN.test(competition)) {
        result.big5Matches.push(match);
        result.byLeague[league as keyof typeof result.byLeague].push(match);
        break;
      }
    }
  }
  
  console.log(`[MatchEnDirect] Parsed ${result.totalMatches} total, ${result.big5Matches.length} Big 5 matches`);
  console.log(`[MatchEnDirect] By league: L1=${result.byLeague.ligue1.length}, LL=${result.byLeague.laliga.length}, PL=${result.byLeague.premierLeague.length}, BL=${result.byLeague.bundesliga.length}, SA=${result.byLeague.serieA.length}`);
  
  return result;
}

export async function getMatchesForDate(date: Date | string): Promise<MatchEndirectMatch[]> {
  const result = await fetchMatchEndirect(date);
  return result.big5Matches;
}

export async function getMatchesForLeague(date: Date | string, league: 'ligue1' | 'laliga' | 'premierLeague' | 'bundesliga' | 'serieA'): Promise<MatchEndirectMatch[]> {
  const result = await fetchMatchEndirect(date);
  return result.byLeague[league];
}

export async function getMatchesForDateRange(startDate: Date, endDate: Date): Promise<Map<string, MatchEndirectMatch[]>> {
  const results = new Map<string, MatchEndirectMatch[]>();
  const current = new Date(startDate);
  
  while (current <= endDate) {
    const dateStr = formatDateForUrl(current);
    try {
      const dayResult = await fetchMatchEndirect(current);
      results.set(dateStr, dayResult.big5Matches);
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error(`[MatchEnDirect] Error for ${dateStr}:`, error);
    }
    current.setDate(current.getDate() + 1);
  }
  
  return results;
}

export function formatMatchSummary(matches: MatchEndirectMatch[]): string {
  if (matches.length === 0) return 'Aucun match Big 5 trouvé.';
  
  const byCompetition = new Map<string, MatchEndirectMatch[]>();
  for (const match of matches) {
    const comp = match.competition;
    if (!byCompetition.has(comp)) byCompetition.set(comp, []);
    byCompetition.get(comp)!.push(match);
  }
  
  const lines: string[] = [];
  for (const [comp, compMatches] of byCompetition) {
    lines.push(`\n**${comp}** (${compMatches.length} matchs)`);
    for (const m of compMatches) {
      const score = m.homeScore !== null && m.awayScore !== null 
        ? `${m.homeScore}-${m.awayScore}` 
        : m.status === 'live' ? 'EN COURS' : 'À venir';
      const timeInfo = m.time ? ` (${m.time})` : '';
      lines.push(`- ${m.homeTeam} vs ${m.awayTeam}: ${score}${timeInfo}`);
    }
  }
  
  return lines.join('\n');
}

export const matchEndirectService = {
  fetchMatchEndirect,
  getMatchesForDate,
  getMatchesForLeague,
  getMatchesForDateRange,
  formatMatchSummary,
  formatDateForUrl,
};

export default matchEndirectService;
