import * as cheerio from 'cheerio';
import { fetchWithRetry, DEFAULT_USER_AGENT, REQUEST_TIMEOUT } from './core';

// ======================= TYPES GÉNÉRIQUES =======================

export interface VerifiedScrapeResult<T> {
  ok: boolean;
  data?: T;
  attempts: number;
  diffs?: string[];
  extractionTime?: number;
  verified: boolean;
}

export interface VerifyOptions {
  maxAttempts?: number;
  delayMs?: number;
  strictMode?: boolean;
}

// ======================= TYPES SPÉCIFIQUES =======================

export interface RankingRow {
  position: number;
  name: string;
  points?: number;
  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  goalDiff?: number;
}

export interface ProductRow {
  name: string;
  price?: number;
  currency?: string;
  description?: string;
  url?: string;
  inStock?: boolean;
}

export interface ArticleData {
  title: string;
  date?: string;
  author?: string;
  summary?: string;
  content?: string;
  tags?: string[];
}

export interface TopScorerRow {
  position: number;
  name: string;
  team?: string;
  goals: number;
  assists?: number;
  matches?: number;
}

export interface MatchResult {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  date?: string;
  competition?: string;
  status?: string;
}

export interface Fixture {
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  date?: string;
  time?: string;
  matchday?: number;
  status?: 'scheduled' | 'played' | 'live';
}

export interface OddsData {
  homeTeam: string;
  awayTeam: string;
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
  bookmaker?: string;
  date?: string;
  league?: string; // Ligue/Championnat (Ligue 1, LaLiga, etc.)
}

// ======================= FONCTION GÉNÉRIQUE DE VÉRIFICATION =======================

export async function fetchHtmlForScraper(url: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(url, DEFAULT_USER_AGENT, REQUEST_TIMEOUT);
    if (!res || res.status !== 200) return null;
    return res.html;
  } catch (error) {
    console.error(`[VerifiedScraper] Fetch error for ${url}:`, error);
    return null;
  }
}

export type FetchHtmlFn = (url: string) => Promise<string | null>;

export async function verifiedScrape<T>(
  url: string,
  extractFn: (html: string) => T,
  compareFn: (a: T, b: T) => string[],
  options?: VerifyOptions,
  customFetchHtml?: FetchHtmlFn
): Promise<VerifiedScrapeResult<T>> {
  const maxAttempts = options?.maxAttempts ?? 2;
  const delayMs = options?.delayMs ?? 500;
  const strictMode = options?.strictMode ?? true;
  const startTime = Date.now();
  const fetchFn = customFetchHtml || fetchHtmlForScraper;

  let previous: T | null = null;
  let lastDiffs: string[] = [];
  let lastData: T | null = null;

  console.log(`[VerifiedScraper] Starting verified scrape for: ${url}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[VerifiedScraper] Attempt ${attempt}/${maxAttempts}...`);
    
    const html = await fetchFn(url);
    if (!html) {
      lastDiffs.push(`Attempt ${attempt}: no HTML (fetch failed)`);
      console.warn(`[VerifiedScraper] Attempt ${attempt} failed: no HTML`);
    } else {
      try {
        const data = extractFn(html);
        lastData = data;

        if (!previous) {
          previous = data;
          console.log(`[VerifiedScraper] Attempt ${attempt}: first extraction complete`);
        } else {
          const diffs = compareFn(previous, data);
          if (diffs.length === 0) {
            const extractionTime = Date.now() - startTime;
            console.log(`[VerifiedScraper] ✅ VERIFIED after ${attempt} attempts (${extractionTime}ms)`);
            return { 
              ok: true, 
              data, 
              attempts: attempt, 
              verified: true,
              extractionTime 
            };
          } else {
            lastDiffs = diffs;
            console.warn(`[VerifiedScraper] Attempt ${attempt} has diffs:`, diffs.slice(0, 3));
            previous = data;
          }
        }
      } catch (extractError) {
        lastDiffs.push(`Attempt ${attempt}: extraction error - ${extractError}`);
        console.error(`[VerifiedScraper] Extraction error:`, extractError);
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  const extractionTime = Date.now() - startTime;
  console.warn(`[VerifiedScraper] ❌ NOT VERIFIED after ${maxAttempts} attempts`);
  
  if (strictMode) {
    return { 
      ok: false, 
      attempts: maxAttempts, 
      diffs: lastDiffs, 
      verified: false,
      extractionTime 
    };
  }
  
  return { 
    ok: false, 
    data: lastData ?? undefined, 
    attempts: maxAttempts, 
    diffs: lastDiffs, 
    verified: false,
    extractionTime 
  };
}

// ======================= ULYSSE PARSER UTILITIES =======================

// Normalize team/player names (used across multiple extractors)
function normalizeTeamName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/[\n\r\t]/g, ' ')
    .trim();
}

// ======================= EXTRACTEURS SPÉCIALISÉS =======================

export function extractRankingTable(html: string): RankingRow[] {
  const $ = cheerio.load(html);
  const rows: RankingRow[] = [];

  const safeInt = (text: string): number => {
    const cleaned = text.replace(/[^\d\-]/g, '');
    return parseInt(cleaned, 10) || 0;
  };

  // Find the best ranking table (most columns, most rows with teams)
  let bestTable: { $table: cheerio.Cheerio<cheerio.Element>; score: number } | null = null;

  $('table').each((tableIndex, table) => {
    const $table = $(table);
    const headerText = $table.find('th').text().toLowerCase();
    const tableText = $table.text().toLowerCase();
    const firstRowText = $table.find('tr').first().text().toLowerCase();
    const rowCount = $table.find('tr').length;
    const colCount = $table.find('tr').first().find('td, th').length;
    
    // Score the table based on ranking indicators
    let score = 0;
    const rankingIndicators = ['pts', 'points', 'pos', 'cl.', 'équipe', 'team', 'club', 'j.', 'mp', 'v', 'n', 'd', 'gf', 'ga', 'diff', 'bp', 'bc', 'w', 'l'];
    rankingIndicators.forEach(ind => {
      if (headerText.includes(ind) || firstRowText.includes(ind)) score += 2;
      if (tableText.includes(ind)) score += 1;
    });
    
    // Bonus for having many rows (typical league table has 18-20 teams)
    if (rowCount >= 10 && rowCount <= 25) score += 5;
    // Bonus for having many columns (full stats)
    if (colCount >= 8) score += 3;
    
    if (score > (bestTable?.score || 0)) {
      bestTable = { $table, score };
    }
  });

  if (bestTable && bestTable.score >= 5) {
    const $table = bestTable.$table;
    let headerSkipped = false;
    
    // Detect column positions by header analysis
    const headers: string[] = [];
    $table.find('tr').first().find('td, th').each((i, cell) => {
      headers.push($(cell).text().trim().toLowerCase());
    });
    
    // Find column indices
    const posCol = headers.findIndex(h => ['cl.', 'pos', '#', 'rk', 'rang'].includes(h)) || 0;
    const nameCol = headers.findIndex(h => ['club', 'équipe', 'team', 'nom'].includes(h));
    const ptsCol = headers.findIndex(h => ['pts', 'points'].includes(h));
    
    $table.find('tr').each((i, el) => {
      const tds = $(el).find('td');
      if (tds.length < 3) return;
      
      // Skip header row
      const firstCellText = $(tds[0]).text().trim().toLowerCase();
      if (!headerSkipped && (firstCellText === 'cl.' || firstCellText === 'pos' || firstCellText === '#' || firstCellText === 'rk' || firstCellText === 'rang')) {
        headerSkipped = true;
        return;
      }

      // Use detected columns or default positions
      const posIdx = posCol >= 0 ? posCol : 0;
      const nameIdx = nameCol >= 0 ? nameCol : 1;
      
      const posText = $(tds[posIdx]).text().trim();
      const nameText = normalizeTeamName($(tds[nameIdx]).text());
      
      const position = safeInt(posText);
      if (position === 0 && !posText.match(/^\d/)) return;
      if (!nameText || nameText.length < 2) return;
      // Skip if name looks like a header
      if (['club', 'équipe', 'team'].includes(nameText.toLowerCase())) return;

      const row: RankingRow = {
        position: position || (rows.length + 1),
        name: nameText,
      };

      // Extract stats based on column count
      if (tds.length >= 9) {
        row.played = safeInt($(tds[2]).text());
        row.wins = safeInt($(tds[3]).text());
        row.draws = safeInt($(tds[4]).text());
        row.losses = safeInt($(tds[5]).text());
        row.goalsFor = safeInt($(tds[6]).text());
        row.goalsAgainst = safeInt($(tds[7]).text());
        row.points = ptsCol >= 0 ? safeInt($(tds[ptsCol]).text()) : safeInt($(tds[tds.length - 1]).text());
        row.goalDiff = (row.goalsFor || 0) - (row.goalsAgainst || 0);
      } else if (tds.length >= 4) {
        row.points = ptsCol >= 0 ? safeInt($(tds[ptsCol]).text()) : safeInt($(tds[tds.length - 1]).text());
      }

      rows.push(row);
    });
  }

  // Fallback: Look for div-based ranking
  if (rows.length === 0) {
    $('[class*="ranking"], [class*="classement"], [class*="standing"], [class*="table"], [class*="league"]').each((_, container) => {
      $(container).find('[class*="row"], [class*="team"], [class*="ligne"], [class*="item"]').each((i, el) => {
        const text = $(el).text().trim();
        const posMatch = text.match(/^(\d+)[.\s]/);
        if (posMatch) {
          const namePart = text.replace(/^\d+[.\s]+/, '').split(/\d/)[0].trim();
          const ptsMatch = text.match(/(\d+)\s*(?:pts?|points?)?\s*$/i);
          
          if (namePart && namePart.length >= 2 && !['club', 'équipe', 'team'].includes(namePart.toLowerCase())) {
            rows.push({
              position: parseInt(posMatch[1], 10),
              name: normalizeTeamName(namePart),
              points: ptsMatch ? parseInt(ptsMatch[1], 10) : undefined,
            });
          }
        }
      });
    });
  }

  console.log(`[extractRankingTable] Extracted ${rows.length} ranking rows`);
  return rows;
}

export function extractTopScorers(html: string): TopScorerRow[] {
  const $ = cheerio.load(html);
  const scorers: TopScorerRow[] = [];

  const safeInt = (text: string): number => {
    const cleaned = text.replace(/[^\d]/g, '');
    return parseInt(cleaned, 10) || 0;
  };
  
  const normalizeName = (name: string): string => {
    return name.replace(/\s+/g, ' ').replace(/[\n\r\t]/g, ' ').trim();
  };

  // Find best scorer table by scoring
  let bestTable: { $table: cheerio.Cheerio<cheerio.Element>; score: number } | null = null;
  
  $('table').each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('th').text().toLowerCase();
    const firstRowText = $table.find('tr').first().text().toLowerCase();
    const tableText = $table.text().toLowerCase();
    
    let score = 0;
    const scorerIndicators = ['buteur', 'scorer', 'buts', 'goals', 'joueur', 'player', 'top', 'classement des buteurs'];
    scorerIndicators.forEach(ind => {
      if (headerText.includes(ind) || firstRowText.includes(ind)) score += 3;
      if (tableText.includes(ind)) score += 1;
    });
    
    // Penalty for ranking table indicators
    if (tableText.includes('pts') && tableText.includes('j.')) score -= 5;
    
    if (score > (bestTable?.score || 0)) {
      bestTable = { $table, score };
    }
  });

  if (bestTable && bestTable.score >= 3) {
    const $table = bestTable.$table;
    
    // Analyze headers to find column positions
    const headers: string[] = [];
    $table.find('tr').first().find('td, th').each((i, cell) => {
      headers.push($(cell).text().trim().toLowerCase());
    });
    
    const nameCol = headers.findIndex(h => ['buteur', 'joueur', 'player', 'scorer', 'nom'].includes(h));
    const teamCol = headers.findIndex(h => ['club', 'équipe', 'team'].includes(h));
    const goalsCol = headers.findIndex(h => ['buts', 'goals', 'g', 'b'].includes(h));
    
    let headerSkipped = false;
    $table.find('tr').each((i, el) => {
      const tds = $(el).find('td');
      if (tds.length < 3) return;

      // Skip header row
      const firstCellText = $(tds[0]).text().trim().toLowerCase();
      if (!headerSkipped && (firstCellText === 'cl.' || firstCellText === 'pos' || firstCellText === '#' || 
          firstCellText.includes('buteur') || firstCellText === 'rang')) {
        headerSkipped = true;
        return;
      }

      // Use detected columns or defaults
      const posIdx = 0;
      const nameIdx = nameCol >= 0 ? nameCol : 1;
      const teamIdx = teamCol >= 0 ? teamCol : 2;
      const goalsIdx = goalsCol >= 0 ? goalsCol : tds.length - 1;
      
      const posText = $(tds[posIdx]).text().trim();
      const nameText = normalizeName($(tds[nameIdx]).text());
      const teamText = tds.length >= 4 ? normalizeName($(tds[teamIdx]).text()) : undefined;
      const goalsText = $(tds[goalsIdx]).text().trim();
      
      if (!nameText || nameText.length < 2) return;
      // Skip header-like content
      if (['buteur', 'joueur', 'player'].includes(nameText.toLowerCase())) return;
      
      const position = safeInt(posText);
      if (position === 0 && !posText.match(/^\d/)) return;

      scorers.push({
        position: position || (scorers.length + 1),
        name: nameText,
        team: teamText,
        goals: safeInt(goalsText),
      });
    });
  }
  
  // Fallback: Look for div-based scorer lists
  if (scorers.length === 0) {
    $('[class*="scorer"], [class*="buteur"], [class*="topscorer"]').each((_, container) => {
      $(container).find('[class*="row"], [class*="player"], [class*="item"]').each((i, el) => {
        const text = $(el).text().trim();
        // Pattern: "1. Player Name - Team - 15 buts"
        const match = text.match(/^(\d+)[.\s]+([A-Za-zÀ-ÿ\s.'-]+?)(?:\s*[-–]\s*([A-Za-zÀ-ÿ\s.'-]+?))?\s*[-–]?\s*(\d+)\s*(?:buts?|goals?)?$/i);
        if (match) {
          scorers.push({
            position: parseInt(match[1], 10),
            name: normalizeName(match[2]),
            team: match[3] ? normalizeName(match[3]) : undefined,
            goals: parseInt(match[4], 10),
          });
        }
      });
    });
  }

  console.log(`[extractTopScorers] Extracted ${scorers.length} scorers`);
  return scorers;
}

export function extractMatchResults(html: string): MatchResult[] {
  const $ = cheerio.load(html);
  const matches: MatchResult[] = [];
  const seen = new Set<string>(); // Avoid duplicates

  const safeInt = (text: string): number => {
    const cleaned = text.replace(/[^\d]/g, '');
    return parseInt(cleaned, 10) || 0;
  };
  
  const addMatch = (homeTeam: string, homeScore: number | undefined, awayScore: number | undefined, awayTeam: string, league?: string) => {
    const home = homeTeam.trim().substring(0, 50);
    const away = awayTeam.trim().substring(0, 50);
    if (!home || !away || home.length < 2 || away.length < 2) return;
    
    // Skip if it looks like header/noise
    if (/^\d+$/.test(home) || /^\d+$/.test(away)) return;
    if (home.toLowerCase().includes('domicile') || away.toLowerCase().includes('extérieur')) return;
    
    const key = `${home.toLowerCase()}-${away.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    
    matches.push({
      homeTeam: home,
      homeScore: homeScore !== undefined ? homeScore : undefined,
      awayScore: awayScore !== undefined ? awayScore : undefined,
      awayTeam: away,
    });
  };

  // STRATEGY 1: Elements with match/fixture/result/score classes
  $('[class*="match"], [class*="fixture"], [class*="result"], [class*="score"], [class*="game"], [class*="event"]').each((_, el) => {
    const text = $(el).text().trim();
    
    // Pattern: Team1 Score-Score Team2
    const scoreMatch = text.match(/([A-Za-zÀ-ÿ\s.']+?)\s*(\d+)\s*[-:]\s*(\d+)\s*([A-Za-zÀ-ÿ\s.']+)/);
    if (scoreMatch) {
      addMatch(scoreMatch[1], safeInt(scoreMatch[2]), safeInt(scoreMatch[3]), scoreMatch[4]);
    }
    
    // Pattern: Team1 vs Team2 (upcoming match, no score)
    const upcomingMatch = text.match(/([A-Za-zÀ-ÿ\s.']+?)\s+(?:vs?|contre|@)\s+([A-Za-zÀ-ÿ\s.']+)/i);
    if (upcomingMatch && !scoreMatch) {
      addMatch(upcomingMatch[1], undefined, undefined, upcomingMatch[2]);
    }
  });

  // STRATEGY 2: Table rows with scores
  $('table tr').each((i, el) => {
    if (i === 0) return;
    const tds = $(el).find('td');
    if (tds.length < 3) return;

    const rowText = $(el).text();
    const scoreMatch = rowText.match(/(\d+)\s*[-:]\s*(\d+)/);
    
    if (tds.length >= 3) {
      const homeTeam = $(tds[0]).text().trim();
      const awayTeam = $(tds[tds.length - 1]).text().trim();
      
      if (homeTeam && awayTeam) {
        if (scoreMatch) {
          addMatch(homeTeam, safeInt(scoreMatch[1]), safeInt(scoreMatch[2]), awayTeam);
        } else {
          // Upcoming match without score
          addMatch(homeTeam, undefined, undefined, awayTeam);
        }
      }
    }
  });

  // STRATEGY 3: Global text extraction for sites like matchendirect.fr
  // Look for pattern: Team1 Score-Score Team2 anywhere in the page
  const pageText = $('body').text();
  
  // Match patterns like "Lyon 1 - 0 Lille" or "Real Madrid 2-1 Rayo Vallecano"
  const globalPattern = /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.']+?)\s+(\d+)\s*[-–]\s*(\d+)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.']+?)(?:\s|$|\n|,|\.)/g;
  let globalMatch;
  while ((globalMatch = globalPattern.exec(pageText)) !== null) {
    const [_, home, homeScore, awayScore, away] = globalMatch;
    // Validate team names
    if (isLikelyTeamName(home.trim()) || isLikelyTeamName(away.trim())) {
      addMatch(home, safeInt(homeScore), safeInt(awayScore), away);
    }
  }
  
  // STRATEGY 4: Look for specific container patterns (matchendirect.fr style)
  $('[class*="rencontre"], [class*="encounter"], [class*="league"], [class*="competition"]').each((_, container) => {
    const text = $(container).text();
    const parts = text.match(/([A-Za-zÀ-ÿ\s.']+?)\s*(\d+)\s*[-–:]\s*(\d+)\s*([A-Za-zÀ-ÿ\s.']+)/g);
    if (parts) {
      parts.forEach(part => {
        const m = part.match(/([A-Za-zÀ-ÿ\s.']+?)\s*(\d+)\s*[-–:]\s*(\d+)\s*([A-Za-zÀ-ÿ\s.']+)/);
        if (m) {
          addMatch(m[1], safeInt(m[2]), safeInt(m[3]), m[4]);
        }
      });
    }
  });

  console.log(`[extractMatchResults] Extracted ${matches.length} matches (${seen.size} unique)`);
  return matches;
}

// ======================= ULYSSE SUPER PARSER V2 =======================
// Intelligent multi-format extraction system

// Team name database for smart detection
const TEAM_PATTERNS = {
  french: /\b(RC|AS|OGC|FC|PSG|OM|OL|LOSC|SCO|AJ|SM|Olympique|Paris|Stade|Racing|Lille|Monaco|Marseille|Lyon|Lens|Nice|Rennes|Nantes|Auxerre|Brest|Metz|Angers|Lorient|Toulouse|Strasbourg|Montpellier|Reims|Le Havre|Clermont|Saint.?Etienne|Guingamp|Caen|Amiens|Dijon|Troyes)\b/i,
  english: /\b(FC|United|City|Villa|Palace|Forest|Hotspur|Athletic|Albion|Wanderers|Arsenal|Chelsea|Liverpool|Everton|Brighton|Wolves|Fulham|Bournemouth|Southampton|Ipswich|Leicester|Newcastle|Brentford|Crystal|West Ham|Manchester|Aston|Nottingham|Tottenham|Leeds|Burnley|Sheffield|Norwich|Watford|Luton)\b/i,
  spanish: /\b(Real|Atlético|Athletic|Barcelona|Sevilla|Valencia|Villarreal|Betis|Celta|Espanyol|Getafe|Granada|Mallorca|Osasuna|Rayo|Girona|Almería|Cadiz|Elche|Levante)\b/i,
  german: /\b(Bayern|Borussia|Dortmund|Leipzig|Leverkusen|Frankfurt|Wolfsburg|Freiburg|Gladbach|Union|Hoffenheim|Mainz|Augsburg|Köln|Stuttgart|Werder|Hertha|Schalke|Bochum)\b/i,
  italian: /\b(Juventus|Inter|Milan|Roma|Lazio|Napoli|Atalanta|Fiorentina|Bologna|Torino|Sassuolo|Udinese|Empoli|Monza|Lecce|Verona|Genoa|Salernitana|Cagliari)\b/i,
};

function isLikelyTeamName(text: string): boolean {
  if (!text || text.length < 3 || text.length > 50) return false;
  
  // Exclude common false positives
  const excludePatterns = [
    /^(pts?|points?|but|goal|win|draw|loss|match|score|date|time|stat)s?$/i,
    /^\d+$/,                                    // Pure numbers only
    /^[-–—]+$/,                                 // Just dashes
    /^[A-Z]{1,2}$/,                             // Single/double letters (W, L, D)
    /^(journ[eéè]+e?|jornada|giornata|spieltag|matchday|matchweek|round)\s*\d*/i,
    /^(classement|ranking|standings|tableau)/i,
    /^(buteurs?|scorers?|meilleurs?)/i,
    /^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)/i,
    /^(january|february|march|april|may|june|july|august|september|october|november|december)/i,
    /^\d{1,2}[\/\-\.]\d{1,2}([\/\-\.]\d{2,4})?$/, // Dates
    /^\d{1,2}:\d{2}$/,                           // Times
  ];
  
  if (excludePatterns.some(p => p.test(text))) return false;
  
  // Check against all known team patterns (high confidence)
  if (Object.values(TEAM_PATTERNS).some(p => p.test(text))) return true;
  
  // Check for common club name patterns
  const clubPatterns = [
    /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ][a-zàâäçéèêëîïôöùûü]+(\s+[A-Za-zÀ-ÿ\d]+)*$/,  // Capitalized words
    /^(FC|AC|AS|SC|RC|CF|US|SS|SL|VfB|VfL|TSG|RB|BSC)\s/i,               // Common prefixes with space
    /^1\.\s*(FC|FSV|FFC)/i,                                              // German 1.FC, 1.FSV patterns
    /(United|City|FC|CF|Club|Athletic|Sporting|Real|Inter)$/i,           // Common suffixes
    /^[A-Za-zÀ-ÿ]{3,}\s+(FC|CF|SC|AC)$/i,                               // City + FC pattern
    /^Rasen[Bb]all/i,                                                    // RasenBallsport
    /^(Werder|Eintracht|Borussia|Fortuna|Arminia)\s/i,                   // German club prefixes
    /gladbach$/i,                                                         // Mönchengladbach
  ];
  
  return clubPatterns.some(p => p.test(text));
}

function extractMatchday(html: string, $: cheerio.CheerioAPI): number | undefined {
  const pageText = $('body').text();
  
  // Ordered from most specific to least specific
  const patterns = [
    /Journ[eéè]+e?\s*n[°o]\s*(\d+)/i,       // "Journée n° 20"
    /Journ[eéè]+e?\s+(\d{1,2})\b/i,         // "Journée 20" (word boundary)
    /Jornada\s*(\d+)/i,                      // Spanish
    /Giornata\s*(\d+)/i,                     // Italian
    /Spieltag\s*(\d+)/i,                     // German
    /Matchweek\s*(\d+)/i,
    /Matchday\s*(\d+)/i,
    /Round\s*(\d+)/i,
    /Gameweek\s*(\d+)/i,
    /GW\s*(\d+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = pageText.match(pattern);
    if (match) {
      const matchday = parseInt(match[1], 10);
      if (matchday > 0 && matchday <= 50) { // Sanity check
        console.log(`[extractFixtures] Found matchday: ${matchday}`);
        return matchday;
      }
    }
  }
  
  // Try specific elements
  let matchday: number | undefined;
  $('p.text2, h2, h3, .matchday, .journee, .round').each((_, el) => {
    if (matchday) return;
    const text = $(el).text().trim();
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const val = parseInt(match[1], 10);
        if (val > 0 && val <= 50) {
          matchday = val;
          return false;
        }
      }
    }
  });
  
  return matchday;
}

function detectTableType($table: cheerio.Cheerio<cheerio.Element>, $: cheerio.CheerioAPI): 'ranking' | 'fixtures' | 'scorers' | 'unknown' {
  const tableText = $table.text().toLowerCase();
  const headerText = $table.find('th, tr:first-child td').text().toLowerCase();
  
  // Ranking table indicators
  const rankingIndicators = ['pts', 'points', 'cl.', 'équipe', 'team', 'club', 'w', 'l', 'd', 'gf', 'ga', 'gd', 'diff', 'bp', 'bc'];
  const rankingScore = rankingIndicators.filter(i => headerText.includes(i) || tableText.includes(i)).length;
  
  // Scorer table indicators
  const scorerIndicators = ['buteur', 'scorer', 'buts', 'goals', 'joueur', 'player', 'assists'];
  const scorerScore = scorerIndicators.filter(i => headerText.includes(i) || tableText.includes(i)).length;
  
  // Fixture table indicators
  const fixtureIndicators = ['journ', 'matchday', 'vs', 'result', 'score', '-', ':'];
  const fixtureScore = fixtureIndicators.filter(i => tableText.includes(i)).length;
  
  // Check for team name patterns in table
  let teamCount = 0;
  $table.find('td').each((_, td) => {
    const text = $(td).text().trim();
    if (isLikelyTeamName(text)) teamCount++;
  });
  
  // Decision logic
  if (scorerScore >= 2 && headerText.includes('but')) return 'scorers';
  if (rankingScore >= 3 && $table.find('tr').length >= 10) return 'ranking';
  if (teamCount >= 4 && fixtureScore >= 1) return 'fixtures';
  if (teamCount >= 10 && rankingScore >= 2) return 'ranking';
  
  return 'unknown';
}

export function extractFixtures(html: string): { matchday?: number; fixtures: Fixture[] } {
  const $ = cheerio.load(html);
  const fixtures: Fixture[] = [];
  
  const matchday = extractMatchday(html, $);
  const allTables = $('table').toArray();
  
  // =============================================================================
  // STRATEGY 0: Separated tables format (eurotopteam.com style)
  // Teams in one table, scores in a separate table with ONLY numbers/dashes
  // =============================================================================
  
  // Analyze all tables to classify them
  interface TableAnalysis {
    index: number;
    element: cheerio.Element;
    cells: string[];
    isScoreOnly: boolean;
    isTeamTable: boolean;
    teamCount: number;
    scoreCount: number;
  }
  
  const tableAnalyses: TableAnalysis[] = allTables.map((table, index) => {
    const cells: string[] = [];
    $(table).find('td, TD').each((_, td) => {
      const text = $(td).text().trim();
      if (text) cells.push(text);
    });
    
    // Count score-like cells (0-99 or "-")
    const scoreLikeCells = cells.filter(c => /^\d{1,2}$/.test(c) || c === '-');
    
    // Count team-like cells (text, 3+ chars, not pure numbers)
    const teamLikeCells = cells.filter(c => 
      c.length >= 3 && 
      !/^\d+$/.test(c) && 
      !/^[-–—]$/.test(c) &&
      isLikelyTeamName(c)
    );
    
    return {
      index,
      element: table,
      cells,
      isScoreOnly: cells.length >= 6 && scoreLikeCells.length === cells.length,
      isTeamTable: teamLikeCells.length >= 6,
      teamCount: teamLikeCells.length,
      scoreCount: scoreLikeCells.length,
    };
  });
  
  // Find best score-only table and corresponding team table
  const scoreOnlyTables = tableAnalyses.filter(t => t.isScoreOnly);
  
  console.log(`[extractFixtures] Analyzed ${allTables.length} tables, ${scoreOnlyTables.length} score-only tables found`);
  if (scoreOnlyTables.length === 0 && allTables.length > 0) {
    // Debug: show why no score-only tables found
    tableAnalyses.slice(0, 5).forEach((t, i) => {
      console.log(`[extractFixtures] Table ${i}: ${t.cells.length} cells, scoreCount=${t.scoreCount}, isScoreOnly=${t.isScoreOnly}`);
    });
  }
  
  for (const scoreTable of scoreOnlyTables) {
    // Look for team table BEFORE this score table
    const candidateTeamTables = tableAnalyses
      .filter(t => t.index < scoreTable.index && t.isTeamTable)
      .filter(t => {
        const $t = $(t.element);
        const tableType = detectTableType($t, $);
        return tableType !== 'ranking' && tableType !== 'scorers';
      })
      .sort((a, b) => b.index - a.index); // Prefer closest table
    
    if (candidateTeamTables.length === 0) continue;
    
    const teamsTable = candidateTeamTables[0];
    
    // Parse unique teams (deduplicated, in order)
    const teamCells: string[] = [];
    const seen = new Set<string>();
    $(teamsTable.element).find('td, TD').each((_, td) => {
      const text = normalizeTeamName($(td).text());
      if (text && text.length >= 3 && isLikelyTeamName(text) && !seen.has(text)) {
        teamCells.push(text);
        seen.add(text);
      }
    });
    
    // Parse scores (in order)
    const scoreCells: (number | null)[] = [];
    $(scoreTable.element).find('td, TD').each((_, td) => {
      const text = $(td).text().trim();
      if (/^\d{1,2}$/.test(text)) {
        scoreCells.push(parseInt(text, 10));
      } else if (/^[-–—]$/.test(text)) {
        scoreCells.push(null);
      }
    });
    
    const numMatches = Math.floor(teamCells.length / 2);
    const numScorePairs = Math.floor(scoreCells.length / 2);
    
    // Validate matching counts
    if (numMatches >= 3 && Math.abs(numMatches - numScorePairs) <= 1) {
      console.log(`[extractFixtures] Separated tables: ${teamCells.length} teams, ${scoreCells.length} scores`);
      
      for (let j = 0; j < numMatches; j++) {
        const homeTeam = teamCells[j * 2];
        const awayTeam = teamCells[j * 2 + 1];
        const homeScore = scoreCells[j * 2] ?? null;
        const awayScore = scoreCells[j * 2 + 1] ?? null;
        
        if (homeTeam && awayTeam) {
          fixtures.push({
            homeTeam,
            awayTeam,
            matchday,
            status: (homeScore !== null && awayScore !== null) ? 'played' : 'scheduled',
            ...(homeScore !== null && { homeScore }),
            ...(awayScore !== null && { awayScore }),
          });
        }
      }
      
      if (fixtures.length > 0) {
        console.log(`[extractFixtures] Strategy 0: ${fixtures.length} fixtures extracted`);
        break;
      }
    }
  }
  
  // =============================================================================
  // STRATEGY 0b: Inline score format (Team1 X - Y Team2 in same cell/row)
  // =============================================================================
  if (fixtures.length === 0) {
    const inlineScorePatterns = [
      /^(.+?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})\s+(.+?)$/,  // Team1 1 - 2 Team2
      /^(.+?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})$/,          // Team1 1 - 2 (no away team, next cell)
    ];
    
    $('table').each((_, table) => {
      const $table = $(table);
      const tableType = detectTableType($table, $);
      if (tableType === 'ranking' || tableType === 'scorers') return;
      
      $table.find('tr').each((_, tr) => {
        const rowText = $(tr).text().replace(/\s+/g, ' ').trim();
        
        for (const pattern of inlineScorePatterns) {
          const match = rowText.match(pattern);
          if (match) {
            const homeTeam = normalizeTeamName(match[1]);
            const awayTeam = match[4] ? normalizeTeamName(match[4]) : '';
            
            if (homeTeam.length >= 3 && (awayTeam.length >= 3 || !match[4])) {
              // Look for away team in same row if not captured
              if (!awayTeam) {
                const cells = $(tr).find('td').toArray();
                for (let i = cells.length - 1; i >= 0; i--) {
                  const cellText = normalizeTeamName($(cells[i]).text());
                  if (cellText.length >= 3 && isLikelyTeamName(cellText) && cellText !== homeTeam) {
                    fixtures.push({
                      homeTeam,
                      awayTeam: cellText,
                      homeScore: parseInt(match[2], 10),
                      awayScore: parseInt(match[3], 10),
                      matchday,
                      status: 'played',
                    });
                    break;
                  }
                }
              } else {
                fixtures.push({
                  homeTeam,
                  awayTeam,
                  homeScore: parseInt(match[2], 10),
                  awayScore: parseInt(match[3], 10),
                  matchday,
                  status: 'played',
                });
              }
            }
          }
        }
      });
    });
    
    if (fixtures.length > 0) {
      console.log(`[extractFixtures] Strategy 0b: ${fixtures.length} inline fixtures extracted`);
    }
  }
  
  // Strategy 1: Look for fixture tables (standard format)
  if (fixtures.length === 0) {
  $('table').each((_, table) => {
    const $table = $(table);
    const tableType = detectTableType($table, $);
    
    if (tableType === 'ranking' || tableType === 'scorers') return;
    
    // Extract all cells organized by row
    const rows: { teams: string[]; scores: number[] }[] = [];
    
    $table.find('tr').each((_, tr) => {
      const tds = $(tr).find('td');
      const rowTeams: string[] = [];
      const rowScores: number[] = [];
      
      tds.each((_, td) => {
        const text = normalizeTeamName($(td).text());
        if (!text) return;
        
        // Check if it's a score (single number 0-99 or dash)
        if (/^(\d{1,2})$/.test(text)) {
          rowScores.push(parseInt(text, 10));
        } else if (text !== '-' && text.length >= 3 && isLikelyTeamName(text)) {
          rowTeams.push(text);
        }
      });
      
      // Valid fixture row: exactly 2 teams
      if (rowTeams.length === 2) {
        rows.push({ teams: rowTeams, scores: rowScores });
      }
    });
    
    // Convert rows to fixtures
    rows.forEach(row => {
      const fixture: Fixture = {
        homeTeam: row.teams[0],
        awayTeam: row.teams[1],
        matchday,
        status: row.scores.length >= 2 ? 'played' : 'scheduled',
      };
      if (row.scores.length >= 2) {
        fixture.homeScore = row.scores[0];
        fixture.awayScore = row.scores[1];
      }
      fixtures.push(fixture);
    });
  });
  } // End of Strategy 1 conditional block
  
  // Strategy 2: Look for match containers (modern sites)
  if (fixtures.length === 0) {
    $('[class*="match"], [class*="fixture"], [class*="event"], [class*="game"]').each((_, el) => {
      const $match = $(el);
      const text = $match.text();
      
      // Pattern: "Team1 X - Y Team2" or "Team1 X:Y Team2"
      const scorePattern = /([A-Za-zÀ-ÿ\s.]+?)\s*(\d+)\s*[-:]\s*(\d+)\s*([A-Za-zÀ-ÿ\s.]+)/;
      const match = text.match(scorePattern);
      
      if (match) {
        const homeTeam = normalizeTeamName(match[1]);
        const awayTeam = normalizeTeamName(match[4]);
        
        if (homeTeam.length >= 3 && awayTeam.length >= 3) {
          fixtures.push({
            homeTeam,
            awayTeam,
            homeScore: parseInt(match[2], 10),
            awayScore: parseInt(match[3], 10),
            matchday,
            status: 'played',
          });
        }
      }
    });
  }
  
  // Strategy 3: Parse structured data (JSON-LD)
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const json = JSON.parse($(script).html() || '');
      if (json['@type'] === 'SportsEvent' || json.type === 'match') {
        const homeTeam = json.homeTeam?.name || json.home;
        const awayTeam = json.awayTeam?.name || json.away;
        if (homeTeam && awayTeam) {
          fixtures.push({
            homeTeam: normalizeTeamName(homeTeam),
            awayTeam: normalizeTeamName(awayTeam),
            homeScore: json.homeTeamScore,
            awayScore: json.awayTeamScore,
            matchday,
          });
        }
      }
    } catch {}
  });
  
  console.log(`[extractFixtures] Extracted ${fixtures.length} fixtures for matchday ${matchday || 'unknown'}`);
  
  // Deduplicate by normalized team names
  const seen = new Set<string>();
  const uniqueFixtures = fixtures.filter(f => {
    const key = `${f.homeTeam.toLowerCase()}|${f.awayTeam.toLowerCase()}`;
    const reverseKey = `${f.awayTeam.toLowerCase()}|${f.homeTeam.toLowerCase()}`;
    if (seen.has(key) || seen.has(reverseKey)) return false;
    seen.add(key);
    return true;
  });
  
  return { matchday, fixtures: uniqueFixtures };
}

export function extractProductList(html: string): ProductRow[] {
  const $ = cheerio.load(html);
  const products: ProductRow[] = [];

  const extractPrice = (text: string): { price: number; currency: string } | null => {
    const match = text.match(/([\d\s,.]+)\s*(€|EUR|USD|\$|£)/i) || 
                  text.match(/(€|EUR|USD|\$|£)\s*([\d\s,.]+)/i);
    if (match) {
      const priceStr = match[1].replace(/\s/g, '').replace(',', '.');
      const price = parseFloat(priceStr);
      const currency = match[2] || '€';
      if (!isNaN(price)) {
        return { price, currency };
      }
    }
    return null;
  };

  $('[class*="product"], [class*="item"], [class*="card"]').each((_, el) => {
    const $el = $(el);
    
    const name = $el.find('[class*="name"], [class*="title"], h2, h3, h4').first().text().trim();
    const priceText = $el.find('[class*="price"]').first().text().trim();
    const description = $el.find('[class*="desc"], [class*="summary"]').first().text().trim();
    const url = $el.find('a').first().attr('href');
    
    if (name && name.length > 2) {
      const priceData = extractPrice(priceText);
      products.push({
        name,
        price: priceData?.price,
        currency: priceData?.currency,
        description: description || undefined,
        url: url || undefined,
        inStock: !$el.text().toLowerCase().includes('rupture') && 
                 !$el.text().toLowerCase().includes('out of stock'),
      });
    }
  });

  return products;
}

export function extractArticleContent(html: string): ArticleData {
  const $ = cheerio.load(html);
  
  const title = $('h1').first().text().trim() || 
                $('[class*="title"]').first().text().trim() ||
                $('title').text().trim();

  const dateMatch = $('time').attr('datetime') || 
                    $('[class*="date"]').first().text().trim() ||
                    $('meta[property="article:published_time"]').attr('content');

  const author = $('[class*="author"]').first().text().trim() ||
                 $('meta[name="author"]').attr('content');

  const summary = $('[class*="summary"], [class*="excerpt"], [class*="lead"]').first().text().trim() ||
                  $('meta[name="description"]').attr('content');

  const contentParts: string[] = [];
  $('article p, [class*="content"] p, .post-content p').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 50) {
      contentParts.push(text);
    }
  });

  const tags: string[] = [];
  $('[class*="tag"], [rel="tag"]').each((_, el) => {
    const tag = $(el).text().trim();
    if (tag && tag.length < 50) {
      tags.push(tag);
    }
  });

  return {
    title,
    date: dateMatch || undefined,
    author: author || undefined,
    summary: summary || undefined,
    content: contentParts.join('\n\n') || undefined,
    tags: tags.length > 0 ? tags : undefined,
  };
}

// ======================= ULYSSE ODDS PARSER V2 =======================
// Intelligent multi-format odds extraction for betting sites

export function extractOddsData(html: string, leagueFilter?: string[]): OddsData[] {
  const $ = cheerio.load(html);
  const odds: OddsData[] = [];
  const seenMatches = new Set<string>();

  // League name normalization map
  const leagueNormalize: Record<string, string> = {
    'ligue 1': 'Ligue 1',
    'ligue 1 mcdonald': 'Ligue 1',
    'ligue 1 uber eats': 'Ligue 1',
    'laliga': 'LaLiga',
    'la liga': 'LaLiga',
    'liga espagnole': 'LaLiga',
    'primera division': 'LaLiga',
    'premier league': 'Premier League',
    'championship': 'Championship',
    'bundesliga': 'Bundesliga',
    'serie a': 'Serie A',
    'calcio': 'Serie A',
    'eredivisie': 'Eredivisie',
    'liga portugal': 'Liga Portugal',
    'primeira liga': 'Liga Portugal',
    'jupiler pro': 'Jupiler Pro League',
    'super lig': 'Süper Lig',
    'super league': 'Super League',
    'superlig': 'Süper Lig',
    'grece': 'Super League Greece',
    'greece': 'Super League Greece',
    'argentine': 'Liga Argentina',
    'argentina': 'Liga Argentina',
  };

  const normalizeLeague = (name: string): string => {
    const lower = name.toLowerCase().trim();
    for (const [key, value] of Object.entries(leagueNormalize)) {
      if (lower.includes(key)) return value;
    }
    return name.trim();
  };

  // Big 5 leagues for filtering
  const big5Leagues = ['Ligue 1', 'LaLiga', 'Premier League', 'Bundesliga', 'Serie A'];

  const shouldInclude = (league?: string): boolean => {
    if (!leagueFilter || leagueFilter.length === 0) return true;
    if (!league) return false;
    const normalizedLeague = normalizeLeague(league);
    return leagueFilter.some(f => 
      normalizedLeague.toLowerCase().includes(f.toLowerCase()) ||
      f.toLowerCase().includes(normalizedLeague.toLowerCase())
    );
  };

  const safeFloat = (text: string): number | undefined => {
    if (!text) return undefined;
    const cleaned = text.replace(',', '.').replace(/[^\d.]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) || val < 1 || val > 100 ? undefined : val; // Valid odds range
  };

  const normalizeTeam = (name: string): string => {
    return name
      .replace(/\s+/g, ' ')
      .replace(/[\n\r\t]/g, ' ')
      .replace(/^\d+\.\s*/, '') // Remove position numbers
      .trim();
  };

  const addOdds = (entry: OddsData) => {
    const key = `${entry.homeTeam.toLowerCase()}-${entry.awayTeam.toLowerCase()}`;
    if (!seenMatches.has(key) && entry.homeTeam && entry.awayTeam) {
      // Apply league filter if specified
      if (!shouldInclude(entry.league)) return;
      seenMatches.add(key);
      odds.push(entry);
    }
  };

  // Strategy 1: JSON-LD structured data (most reliable)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}');
      const events = Array.isArray(json) ? json : [json];
      events.forEach(event => {
        if (event['@type'] === 'SportsEvent' && event.homeTeam && event.awayTeam) {
          addOdds({
            homeTeam: normalizeTeam(event.homeTeam.name || event.homeTeam),
            awayTeam: normalizeTeam(event.awayTeam.name || event.awayTeam),
            date: event.startDate,
          });
        }
      });
    } catch {}
  });

  // Strategy 2: Matchendirect.fr / standard odds tables with league context
  // First, build a map of league sections
  const leagueSections: { element: cheerio.Element, league: string }[] = [];
  
  // Find league headers (h2, h3, div with league names, etc.)
  $('h2, h3, h4, .league-title, .competition-title, [class*="competition"], [class*="league-name"]').each((_, el) => {
    const text = $(el).text().trim();
    // Check if this looks like a league name
    if (text.length > 3 && text.length < 50 && 
        (text.includes('Ligue') || text.includes('Liga') || text.includes('League') || 
         text.includes('Serie') || text.includes('Bundesliga') || text.includes('Eredivisie') ||
         text.includes('Jupiler') || text.includes('Portugal') || text.includes('Grèce') ||
         text.includes('Argentine') || text.includes('Championship') || text.includes('Super'))) {
      leagueSections.push({ element: el, league: normalizeLeague(text) });
    }
  });

  // Function to find league for an element based on preceding headers
  const findLeagueForElement = (el: cheerio.Element): string | undefined => {
    // Look for the closest preceding league header
    let current = el;
    let maxLookback = 20; // Don't look back too far
    
    while (current && maxLookback > 0) {
      const prev = $(current).prev().get(0);
      if (!prev) {
        current = $(current).parent().get(0) as cheerio.Element;
        maxLookback--;
        continue;
      }
      
      // Check if this is a league section header
      const prevText = $(prev).text().trim();
      for (const section of leagueSections) {
        if ($(section.element).text().trim() === prevText) {
          return section.league;
        }
      }
      
      // Also check for league name in class or data attributes
      const classList = $(prev).attr('class') || '';
      const dataLeague = $(prev).attr('data-league') || $(prev).attr('data-competition');
      if (dataLeague) return normalizeLeague(dataLeague);
      
      current = prev as cheerio.Element;
      maxLookback--;
    }
    
    return undefined;
  };

  $('table').each((_, table) => {
    const $table = $(table);
    const tableText = $table.text().toLowerCase();
    
    // Check if this looks like an odds table
    if (!tableText.includes('cote') && !tableText.includes('odds') && 
        !tableText.includes('1') && !tableText.includes('2')) {
      return;
    }

    // Try to find league context for this table
    const tableLeague = findLeagueForElement(table);

    // Find header row to identify columns
    const $header = $table.find('tr').first();
    const headerCells = $header.find('th, td').map((_, th) => $(th).text().trim().toLowerCase()).get();
    
    let homeOddsCol = -1, drawOddsCol = -1, awayOddsCol = -1, bookmakerCol = -1;
    
    headerCells.forEach((h, i) => {
      if (h === '1' || h.includes('home') || h.includes('dom')) homeOddsCol = i;
      else if (h === 'n' || h === 'x' || h.includes('draw') || h.includes('nul')) drawOddsCol = i;
      else if (h === '2' || h.includes('away') || h.includes('ext')) awayOddsCol = i;
      else if (h.includes('book') || h.includes('site')) bookmakerCol = i;
    });

    $table.find('tr').each((rowIdx, row) => {
      if (rowIdx === 0) return; // Skip header
      
      const $row = $(row);
      const cells = $row.find('td').map((_, td) => $(td).text().trim()).get();
      
      // Check if this row itself contains league info (some sites have league rows)
      let rowLeague = tableLeague;
      const rowClass = $row.attr('class') || '';
      const rowDataLeague = $row.attr('data-league') || $row.attr('data-competition');
      if (rowDataLeague) rowLeague = normalizeLeague(rowDataLeague);
      
      // Try to find teams in the row
      let homeTeam = '', awayTeam = '', matchDate = '';
      let home: number | undefined, draw: number | undefined, away: number | undefined;
      let bookmaker: string | undefined;

      // Look for team names (usually in first cells, separated by - or vs)
      const teamCell = cells.find(c => c.includes(' - ') || c.includes(' vs ') || 
                                        /[A-Z][a-z]+.*[A-Z][a-z]+/.test(c));
      
      if (teamCell) {
        const teamMatch = teamCell.match(/([A-Za-zÀ-ÿ\s.'-]+)\s*[-–vs]+\s*([A-Za-zÀ-ÿ\s.'-]+)/i);
        if (teamMatch) {
          homeTeam = normalizeTeam(teamMatch[1]);
          awayTeam = normalizeTeam(teamMatch[2]);
        }
      }

      // If no teams found, try first two cells with team-like names
      if (!homeTeam || !awayTeam) {
        const teamLike = cells.filter(c => 
          /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ][a-zàâäçéèêëîïôöùûü]+/.test(c) && 
          c.length > 2 && c.length < 30
        );
        if (teamLike.length >= 2) {
          homeTeam = normalizeTeam(teamLike[0]);
          awayTeam = normalizeTeam(teamLike[1]);
        }
      }

      // Extract odds from identified columns or by pattern
      if (homeOddsCol >= 0 && cells[homeOddsCol]) home = safeFloat(cells[homeOddsCol]);
      if (drawOddsCol >= 0 && cells[drawOddsCol]) draw = safeFloat(cells[drawOddsCol]);
      if (awayOddsCol >= 0 && cells[awayOddsCol]) away = safeFloat(cells[awayOddsCol]);
      if (bookmakerCol >= 0 && cells[bookmakerCol]) bookmaker = cells[bookmakerCol];

      // Fallback: find 3 consecutive odds-like numbers (1.xx format)
      if (!home || !away) {
        const oddsPattern = cells.filter(c => /^\d+[.,]\d{2}$/.test(c));
        if (oddsPattern.length >= 2) {
          home = safeFloat(oddsPattern[0]);
          if (oddsPattern.length >= 3) {
            draw = safeFloat(oddsPattern[1]);
            away = safeFloat(oddsPattern[2]);
          } else {
            away = safeFloat(oddsPattern[1]);
          }
        }
      }

      // Extract date
      const dateMatch = cells.find(c => /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(c) ||
                                         /\d{1,2}\s+(jan|fév|mar|avr|mai|jui|aoû|sep|oct|nov|déc)/i.test(c));
      if (dateMatch) matchDate = dateMatch;

      if (homeTeam && awayTeam && (home || away)) {
        addOdds({
          homeTeam,
          awayTeam,
          homeOdds: home,
          drawOdds: draw,
          awayOdds: away,
          bookmaker,
          date: matchDate || undefined,
          league: rowLeague,
        });
      }
    });
  });

  // Strategy 3: Div-based odds containers (modern sites)
  const oddsSelectors = [
    '[class*="match-odds"]', '[class*="event-odds"]', '[class*="fixture-odds"]',
    '[class*="cote-match"]', '[class*="betting-row"]', '[class*="match-row"]',
    '[class*="event-row"]', '[data-match]', '[data-event]'
  ];

  $(oddsSelectors.join(', ')).each((_, el) => {
    const $el = $(el);
    const text = $el.text();
    
    // Team extraction
    const teamMatch = text.match(/([A-Za-zÀ-ÿ\s.'-]{2,25})\s*[-–vs]+\s*([A-Za-zÀ-ÿ\s.'-]{2,25})/i);
    if (!teamMatch) return;

    const homeTeam = normalizeTeam(teamMatch[1]);
    const awayTeam = normalizeTeam(teamMatch[2]);

    // Find all odds in this container
    const oddsMatches = text.match(/(\d+[.,]\d{2})/g) || [];
    const validOdds = oddsMatches.map(o => safeFloat(o)).filter(o => o !== undefined) as number[];

    if (validOdds.length >= 2) {
      addOdds({
        homeTeam,
        awayTeam,
        homeOdds: validOdds[0],
        drawOdds: validOdds.length >= 3 ? validOdds[1] : undefined,
        awayOdds: validOdds[validOdds.length - 1],
      });
    }
  });

  // Strategy 4: Global text pattern matching (fallback)
  if (odds.length === 0) {
    const bodyText = $('body').text();
    // Match patterns like "Team A - Team B   1.50  3.20  4.50"
    const matchRegex = /([A-Za-zÀ-ÿ\s.'-]{3,25})\s*[-–vs]+\s*([A-Za-zÀ-ÿ\s.'-]{3,25})\s+(\d+[.,]\d{2})\s+(\d+[.,]\d{2})(?:\s+(\d+[.,]\d{2}))?/gi;
    let match;
    while ((match = matchRegex.exec(bodyText)) !== null) {
      const homeTeam = normalizeTeam(match[1]);
      const awayTeam = normalizeTeam(match[2]);
      
      if (homeTeam.length > 2 && awayTeam.length > 2) {
        addOdds({
          homeTeam,
          awayTeam,
          homeOdds: safeFloat(match[3]),
          drawOdds: match[5] ? safeFloat(match[4]) : undefined,
          awayOdds: safeFloat(match[5] || match[4]),
        });
      }
    }
  }

  console.log(`[OddsParser] Extracted ${odds.length} odds entries via multi-strategy parser`);
  return odds;
}

// ======================= COMPARATEURS SPÉCIALISÉS =======================

export function compareRankingResults(a: RankingRow[], b: RankingRow[]): string[] {
  const diffs: string[] = [];

  if (a.length !== b.length) {
    diffs.push(`Row count mismatch: ${a.length} vs ${b.length}`);
  }

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ra = a[i];
    const rb = b[i];

    if (ra.position !== rb.position) {
      diffs.push(`Row ${i + 1}: position ${ra.position} != ${rb.position}`);
    }
    if (ra.name !== rb.name) {
      diffs.push(`Row ${i + 1}: name "${ra.name}" != "${rb.name}"`);
    }
    if (ra.points !== rb.points) {
      diffs.push(`Row ${i + 1}: points ${ra.points ?? 'n/a'} != ${rb.points ?? 'n/a'}`);
    }
  }

  return diffs;
}

export function compareTopScorers(a: TopScorerRow[], b: TopScorerRow[]): string[] {
  const diffs: string[] = [];

  if (a.length !== b.length) {
    diffs.push(`Scorer count mismatch: ${a.length} vs ${b.length}`);
  }

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i].name !== b[i].name) {
      diffs.push(`Scorer ${i + 1}: name "${a[i].name}" != "${b[i].name}"`);
    }
    if (a[i].goals !== b[i].goals) {
      diffs.push(`Scorer ${i + 1}: goals ${a[i].goals} != ${b[i].goals}`);
    }
  }

  return diffs;
}

export function compareMatchResults(a: MatchResult[], b: MatchResult[]): string[] {
  const diffs: string[] = [];

  if (a.length !== b.length) {
    diffs.push(`Match count mismatch: ${a.length} vs ${b.length}`);
  }

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ma = a[i];
    const mb = b[i];

    if (ma.homeTeam !== mb.homeTeam || ma.awayTeam !== mb.awayTeam) {
      diffs.push(`Match ${i + 1}: teams differ`);
    }
    if (ma.homeScore !== mb.homeScore || ma.awayScore !== mb.awayScore) {
      diffs.push(`Match ${i + 1}: score ${ma.homeScore}-${ma.awayScore} != ${mb.homeScore}-${mb.awayScore}`);
    }
  }

  return diffs;
}

export function compareProducts(a: ProductRow[], b: ProductRow[]): string[] {
  const diffs: string[] = [];

  if (a.length !== b.length) {
    diffs.push(`Product count mismatch: ${a.length} vs ${b.length}`);
  }

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i].name !== b[i].name) {
      diffs.push(`Product ${i + 1}: name differs`);
    }
    if (a[i].price !== b[i].price) {
      diffs.push(`Product ${i + 1}: price ${a[i].price} != ${b[i].price}`);
    }
  }

  return diffs;
}

export function compareArticles(a: ArticleData, b: ArticleData): string[] {
  const diffs: string[] = [];

  if (a.title !== b.title) {
    diffs.push(`Title differs: "${a.title?.slice(0, 50)}" vs "${b.title?.slice(0, 50)}"`);
  }
  if (a.date !== b.date) {
    diffs.push(`Date differs: ${a.date} vs ${b.date}`);
  }
  if ((a.content?.length || 0) !== (b.content?.length || 0)) {
    const lenDiff = Math.abs((a.content?.length || 0) - (b.content?.length || 0));
    if (lenDiff > 100) {
      diffs.push(`Content length differs by ${lenDiff} chars`);
    }
  }

  return diffs;
}

export function compareOdds(a: OddsData[], b: OddsData[]): string[] {
  const diffs: string[] = [];

  if (a.length !== b.length) {
    diffs.push(`Odds count mismatch: ${a.length} vs ${b.length}`);
  }

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i].homeOdds !== b[i].homeOdds) {
      diffs.push(`Odds ${i + 1}: home ${a[i].homeOdds} != ${b[i].homeOdds}`);
    }
    if (a[i].awayOdds !== b[i].awayOdds) {
      diffs.push(`Odds ${i + 1}: away ${a[i].awayOdds} != ${b[i].awayOdds}`);
    }
  }

  return diffs;
}

// ======================= FONCTIONS DE HAUT NIVEAU =======================

export async function scrapeRankingVerified(url: string, options?: VerifyOptions): Promise<VerifiedScrapeResult<RankingRow[]>> {
  return verifiedScrape<RankingRow[]>(
    url,
    extractRankingTable,
    compareRankingResults,
    { maxAttempts: 2, delayMs: 800, ...options }
  );
}

export async function scrapeTopScorersVerified(url: string, options?: VerifyOptions): Promise<VerifiedScrapeResult<TopScorerRow[]>> {
  return verifiedScrape<TopScorerRow[]>(
    url,
    extractTopScorers,
    compareTopScorers,
    { maxAttempts: 2, delayMs: 800, ...options }
  );
}

export async function scrapeMatchResultsVerified(url: string, options?: VerifyOptions): Promise<VerifiedScrapeResult<MatchResult[]>> {
  return verifiedScrape<MatchResult[]>(
    url,
    extractMatchResults,
    compareMatchResults,
    { maxAttempts: 2, delayMs: 600, ...options }
  );
}

export async function scrapeProductsVerified(url: string, options?: VerifyOptions): Promise<VerifiedScrapeResult<ProductRow[]>> {
  return verifiedScrape<ProductRow[]>(
    url,
    extractProductList,
    compareProducts,
    { maxAttempts: 2, delayMs: 500, ...options }
  );
}

export async function scrapeArticleVerified(url: string, options?: VerifyOptions): Promise<VerifiedScrapeResult<ArticleData>> {
  return verifiedScrape<ArticleData>(
    url,
    extractArticleContent,
    compareArticles,
    { maxAttempts: 2, delayMs: 500, ...options }
  );
}

export async function scrapeOddsVerified(url: string, options?: VerifyOptions & { leagueFilter?: string[] }): Promise<VerifiedScrapeResult<OddsData[]>> {
  const leagueFilter = options?.leagueFilter;
  
  // Create extraction function with league filter
  const extractWithFilter = (html: string) => extractOddsData(html, leagueFilter);
  
  return verifiedScrape<OddsData[]>(
    url,
    extractWithFilter,
    compareOdds,
    { maxAttempts: 3, delayMs: 1000, ...options }
  );
}

// ======================= EXTRACTION COMBINÉE FOOTBALL =======================

export interface FootballPageData {
  ranking: RankingRow[];
  topScorers: TopScorerRow[];
  fixtures: { matchday?: number; fixtures: Fixture[] };
}

export function extractFootballPageData(html: string): FootballPageData {
  return {
    ranking: extractRankingTable(html),
    topScorers: extractTopScorers(html),
    fixtures: extractFixtures(html),
  };
}

export async function scrapeFootballPageVerified(url: string, options?: VerifyOptions): Promise<VerifiedScrapeResult<FootballPageData>> {
  const compareFn = (a: FootballPageData, b: FootballPageData): string[] => {
    const diffs: string[] = [];
    diffs.push(...compareRankingResults(a.ranking, b.ranking));
    diffs.push(...compareTopScorers(a.topScorers, b.topScorers));
    if (a.fixtures.matchday !== b.fixtures.matchday) {
      diffs.push(`Matchday differs: ${a.fixtures.matchday} vs ${b.fixtures.matchday}`);
    }
    if (a.fixtures.fixtures.length !== b.fixtures.fixtures.length) {
      diffs.push(`Fixtures count: ${a.fixtures.fixtures.length} vs ${b.fixtures.fixtures.length}`);
    }
    return diffs;
  };

  return verifiedScrape<FootballPageData>(
    url,
    extractFootballPageData,
    compareFn,
    { maxAttempts: 2, delayMs: 800, ...options }
  );
}

// ======================= AUTO-DÉTECTION DU TYPE =======================

export type ExtractionType = 'ranking' | 'topscorers' | 'matches' | 'products' | 'article' | 'odds' | 'football_page' | 'unknown';

export function detectExtractionType(url: string, content?: string): ExtractionType {
  const urlLower = url.toLowerCase();
  const contentLower = (content || '').toLowerCase();
  
  // PRIORITY 1: Explicit odds/betting sites (before anything else)
  // These sites should always use odds extraction even if they have "match" in URL
  const oddsSites = ['matchendirect.fr/cotes', 'coteur.com', 'comparateur-cotes', 'betclic', 'winamax', 'unibet', 'betway'];
  if (oddsSites.some(s => urlLower.includes(s))) {
    return 'odds';
  }
  
  // PRIORITY 2: URL patterns for odds
  if (urlLower.includes('/cotes') || urlLower.includes('/odds') || 
      urlLower.includes('/pronostic') || urlLower.includes('/betting')) {
    return 'odds';
  }
  
  // Football league pages with FULL data (ranking + fixtures + scorers)
  const footballPageSites = ['eurotopteam'];
  const leagueKeywords = ['premierleague', 'ligue1', 'seriea', 'laliga', 'bundesliga', 'championsleague', 'europaleague'];
  
  if (footballPageSites.some(s => urlLower.includes(s)) && leagueKeywords.some(l => urlLower.includes(l))) {
    return 'football_page';
  }
  
  // Sports ranking sites (only ranking, not full page data)
  const rankingOnlySites = ['sofascore', 'flashscore', 'livescore'];
  if (rankingOnlySites.some(s => urlLower.includes(s)) && leagueKeywords.some(l => urlLower.includes(l))) {
    return 'ranking';
  }
  
  if (urlLower.includes('classement') || urlLower.includes('standing') || 
      urlLower.includes('ranking') || urlLower.includes('table') ||
      contentLower.includes('classement') || contentLower.includes('pts')) {
    return 'ranking';
  }
  
  if (urlLower.includes('buteur') || urlLower.includes('scorer') || 
      urlLower.includes('goalscorer') || contentLower.includes('meilleur buteur')) {
    return 'topscorers';
  }
  
  if (urlLower.includes('resultat') || urlLower.includes('result') || 
      urlLower.includes('match') || urlLower.includes('fixture')) {
    return 'matches';
  }
  
  if (urlLower.includes('product') || urlLower.includes('produit') || 
      urlLower.includes('shop') || urlLower.includes('boutique') ||
      contentLower.includes('ajouter au panier') || contentLower.includes('add to cart')) {
    return 'products';
  }
  
  // General odds keywords (lower priority)
  if (urlLower.includes('cote') || urlLower.includes('odds') || 
      urlLower.includes('bet') || urlLower.includes('pari')) {
    return 'odds';
  }
  
  if (urlLower.includes('article') || urlLower.includes('news') || 
      urlLower.includes('blog') || urlLower.includes('actualite')) {
    return 'article';
  }
  
  return 'unknown';
}

export interface AutoVerifiedScrapeOptions extends VerifyOptions {
  leagueFilter?: string[]; // Filter for specific leagues (Ligue 1, LaLiga, etc.)
}

export async function autoVerifiedScrape(
  url: string, 
  typeHint?: ExtractionType,
  options?: AutoVerifiedScrapeOptions
): Promise<{ type: ExtractionType; result: VerifiedScrapeResult<any> }> {
  const type = typeHint || detectExtractionType(url);
  const urlLower = url.toLowerCase();
  
  console.log(`[VerifiedScraper] Auto-detected type: ${type} for ${url}`);
  
  // For football league pages (eurotopteam, etc.), use full page extraction (ranking + fixtures + scorers)
  const footballSites = ['eurotopteam', 'sofascore', 'flashscore'];
  const isFootballLeaguePage = footballSites.some(s => urlLower.includes(s)) && 
    (urlLower.includes('ligue') || urlLower.includes('league') || urlLower.includes('liga') || 
     urlLower.includes('serie') || urlLower.includes('bundesliga'));
  
  if (isFootballLeaguePage && type === 'ranking') {
    console.log(`[VerifiedScraper] Using FULL FOOTBALL PAGE extraction for: ${url}`);
    return { type: 'football_page' as ExtractionType, result: await scrapeFootballPageVerified(url, options) };
  }
  
  switch (type) {
    case 'ranking':
      return { type, result: await scrapeRankingVerified(url, options) };
    case 'topscorers':
      return { type, result: await scrapeTopScorersVerified(url, options) };
    case 'matches':
      return { type, result: await scrapeMatchResultsVerified(url, options) };
    case 'products':
      return { type, result: await scrapeProductsVerified(url, options) };
    case 'odds':
      return { type, result: await scrapeOddsVerified(url, { ...options, leagueFilter: options?.leagueFilter }) };
    case 'article':
      return { type, result: await scrapeArticleVerified(url, options) };
    default:
      return { type, result: await scrapeArticleVerified(url, options) };
  }
}

console.log('[VerifiedScraper] Super Ulysse Extraction Engine loaded');
