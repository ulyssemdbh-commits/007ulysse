/**
 * Centralized sports constants — single source of truth for leagues, teams, IDs.
 * Import from here instead of hardcoding per service file.
 */

// ── League Master Configuration ─────────────────────────────

export interface LeagueConfig {
    key: string;
    name: string;
    country: string;
    sport: 'football' | 'basketball' | 'hockey' | 'american_football' | 'baseball' | 'tennis' | 'mma';
    apiFootballId: number;       // API-Sports/API-Football numeric ID (0 = n/a)
    oddsApiKey: string;          // TheOddsAPI sport key
    sgoId: string;               // SportsGameOdds league ID
    interestScore: number;       // 1-10, used for prioritization
}

export const LEAGUES: LeagueConfig[] = [
    // ── Football ──
    { key: 'ligue1', name: 'Ligue 1', country: 'France', sport: 'football', apiFootballId: 61, oddsApiKey: 'soccer_france_ligue_one', sgoId: 'LIGUE_1_FR', interestScore: 10 },
    { key: 'premierleague', name: 'Premier League', country: 'England', sport: 'football', apiFootballId: 39, oddsApiKey: 'soccer_epl', sgoId: 'EPL', interestScore: 9 },
    { key: 'laliga', name: 'La Liga', country: 'Spain', sport: 'football', apiFootballId: 140, oddsApiKey: 'soccer_spain_la_liga', sgoId: 'LA_LIGA', interestScore: 8 },
    { key: 'bundesliga', name: 'Bundesliga', country: 'Germany', sport: 'football', apiFootballId: 78, oddsApiKey: 'soccer_germany_bundesliga', sgoId: 'BUNDESLIGA', interestScore: 7 },
    { key: 'seriea', name: 'Serie A', country: 'Italy', sport: 'football', apiFootballId: 135, oddsApiKey: 'soccer_italy_serie_a', sgoId: 'SERIE_A_IT', interestScore: 7 },
    { key: 'championsleague', name: 'Champions League', country: 'Europe', sport: 'football', apiFootballId: 2, oddsApiKey: 'soccer_uefa_champs_league', sgoId: 'UEFA_CHAMPIONS_LEAGUE', interestScore: 10 },
    { key: 'europaleague', name: 'Europa League', country: 'Europe', sport: 'football', apiFootballId: 3, oddsApiKey: 'soccer_uefa_europa_league', sgoId: 'UEFA_EUROPA_LEAGUE', interestScore: 6 },
    // ── American Sports ──
    { key: 'nba', name: 'NBA', country: 'USA', sport: 'basketball', apiFootballId: 0, oddsApiKey: 'basketball_nba', sgoId: 'NBA', interestScore: 8 },
    { key: 'nfl', name: 'NFL', country: 'USA', sport: 'american_football', apiFootballId: 0, oddsApiKey: 'americanfootball_nfl', sgoId: 'NFL', interestScore: 7 },
    { key: 'nhl', name: 'NHL', country: 'USA', sport: 'hockey', apiFootballId: 0, oddsApiKey: 'ice_hockey_nhl', sgoId: 'NHL', interestScore: 6 },
    { key: 'mlb', name: 'MLB', country: 'USA', sport: 'baseball', apiFootballId: 0, oddsApiKey: 'baseball_mlb', sgoId: 'MLB', interestScore: 5 },
    // ── Other ──
    { key: 'tennis', name: 'ATP/WTA', country: 'World', sport: 'tennis', apiFootballId: 0, oddsApiKey: 'tennis_atp_french_open', sgoId: 'ATP', interestScore: 5 },
    { key: 'ufc', name: 'UFC', country: 'World', sport: 'mma', apiFootballId: 0, oddsApiKey: 'mma_mixed_martial_arts', sgoId: 'UFC', interestScore: 4 },
];

// ── Lookup Helpers ──────────────────────────────────────────

const _byKey = new Map(LEAGUES.map(l => [l.key, l]));
const _byApiFootballId = new Map(LEAGUES.filter(l => l.apiFootballId > 0).map(l => [l.apiFootballId, l]));
const _byOddsApiKey = new Map(LEAGUES.map(l => [l.oddsApiKey, l]));

export function getLeagueByKey(key: string): LeagueConfig | undefined {
    return _byKey.get(key.toLowerCase().replace(/[\s_-]/g, ''));
}

export function getLeagueByApiFootballId(id: number): LeagueConfig | undefined {
    return _byApiFootballId.get(id);
}

export function getLeagueByOddsApiKey(key: string): LeagueConfig | undefined {
    return _byOddsApiKey.get(key);
}

export function getFootballLeagues(): LeagueConfig[] {
    return LEAGUES.filter(l => l.sport === 'football');
}

export function getLeaguesByInterest(minScore = 7): LeagueConfig[] {
    return LEAGUES.filter(l => l.interestScore >= minScore).sort((a, b) => b.interestScore - a.interestScore);
}

// ── Big Teams ───────────────────────────────────────────────

export const BIG_FOOTBALL_TEAMS = new Set([
    // France
    'Paris Saint-Germain', 'PSG', 'Olympique de Marseille', 'OM', 'Olympique Lyonnais', 'OL',
    'AS Monaco', 'LOSC Lille', 'Stade Rennais',
    // England
    'Manchester City', 'Arsenal', 'Liverpool', 'Manchester United', 'Chelsea', 'Tottenham',
    // Spain
    'Real Madrid', 'FC Barcelona', 'Barcelona', 'Atletico Madrid',
    // Germany
    'Bayern Munich', 'Bayern München', 'Borussia Dortmund',
    // Italy
    'Juventus', 'Inter Milan', 'AC Milan', 'SSC Napoli', 'Napoli',
]);

export function isBigTeam(teamName: string): boolean {
    for (const big of BIG_FOOTBALL_TEAMS) {
        if (teamName.toLowerCase().includes(big.toLowerCase())) return true;
    }
    return false;
}
