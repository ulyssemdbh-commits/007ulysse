import type OpenAI from "openai";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ============================================================
// Sports Tool Definitions
// ============================================================

export const sportsToolDefs: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "query_sports_data",
            description: "Récupère données sportives du système Djedou Pronos: matchs, cotes, classements, prédictions intelligence-enhanced. Dashboard complet sur /sports/predictions avec 5 onglets (Matchs, Pronos, Classements, Buteurs, Blessures). Couvre Big 5 + 20 ligues européennes. 'next_match' = prochain match, 'recent_score' = dernier score, 'team_info' = les deux, 'predictions' = analyse Poisson+Cotes+Intelligence.",
            parameters: {
                type: "object",
                properties: {
                    query_type: { type: "string", enum: ["today_matches", "upcoming_matches", "next_match", "recent_score", "team_info", "team_stats", "odds", "predictions", "dashboard_info"] },
                    league: { type: "string", description: "Nom de la ligue (Ligue 1, Premier League, La Liga, Bundesliga, Serie A, Champions League, Europa League, etc.)" },
                    team: { type: "string", description: "Nom de l'équipe ou alias (OM, Marseille, PSG, Lyon, Lens, Monaco, Real Madrid, Barça, Man City, Liverpool, Arsenal, Juve, Bayern, BVB, etc.)" },
                    date: { type: "string", description: "Date au format YYYY-MM-DD" }
                },
                required: ["query_type"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "query_match_intelligence",
            description: "Analyse approfondie d'un match: blessures des 2 équipes, compositions probables, prédiction API Football, buteurs de la ligue. Utilise fixtureId pour un match spécifique ou teamId/leagueId pour des données générales. TOUJOURS utiliser avant de donner un pronostic pour maximiser la précision.",
            parameters: {
                type: "object",
                properties: {
                    fixtureId: { type: "number", description: "ID du match (fixture) pour lineups, events, prédiction API" },
                    homeTeamId: { type: "number", description: "ID équipe domicile pour blessures spécifiques" },
                    awayTeamId: { type: "number", description: "ID équipe extérieur pour blessures spécifiques" },
                    leagueId: { type: "number", description: "ID ligue (61=L1, 39=PL, 140=LL, 78=BL, 135=SA) pour buteurs/blessures ligue" },
                    include: {
                        type: "array",
                        items: { type: "string", enum: ["injuries", "lineups", "prediction", "topscorers", "events"] },
                        description: "Données à récupérer (défaut: toutes)"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "query_matchendirect",
            description: "Récupère le calendrier mondial des matchs de football depuis matchendirect.fr. Focus sur les Big 5 (Ligue 1, LaLiga, Premier League, Bundesliga, Serie A). Peut consulter le passé (scores), aujourd'hui (live/terminés), et le futur (à venir).",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "Date au format DD-MM-YYYY (ex: 01-02-2026). Laisser vide pour aujourd'hui." },
                    league: { type: "string", enum: ["all", "ligue1", "laliga", "premierLeague", "bundesliga", "serieA"], description: "Filtrer par ligue (défaut: all)" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "query_football_db",
            description: "Consulte la base de données football persistante (3 ans d'historique). Peut chercher des équipes, consulter les classements par saison, voir l'historique d'une équipe ou d'un championnat, et obtenir les stats DB.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["search_team", "team_history", "league_standings", "league_history", "db_stats"], description: "Action à effectuer" },
                    query: { type: "string", description: "Nom d'équipe pour search_team" },
                    team_id: { type: "number", description: "API team ID pour team_history" },
                    league_id: { type: "number", description: "API league ID (61=L1, 39=PL, 140=LL, 78=BL, 135=SA)" },
                    season: { type: "number", description: "Année de début de saison (ex: 2025 pour 2025/2026)" }
                },
                required: ["action"]
            }
        }
    },
];

// ============================================================
// Helper: load sports service dynamically
// ============================================================

async function loadSportsService(): Promise<any> {
    try {
        return (await import("../sportsCacheService")).sportsCacheService;
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`[SportsTools] Sports service not available: ${msg}`);
        return null;
    }
}

// ============================================================
// Handler: executeSportsQuery
// ============================================================

export async function executeSportsQuery(args: { query_type: string; league?: string; team?: string; date?: string }): Promise<string> {
    const sportsService = await loadSportsService();
    if (!sportsService) return JSON.stringify({ error: "Service Sports non disponible" });

    const { query_type, league, team, date } = args;
    const targetDate = date ? new Date(date) : new Date();

    // Team name aliases for common abbreviations
    const teamAliases: Record<string, string[]> = {
        'marseille': ['om', 'olympique marseille', 'olympique de marseille', 'marseille'],
        'paris saint-germain': ['psg', 'paris', 'paris saint germain', 'paris sg'],
        'lyon': ['ol', 'olympique lyonnais', 'olympique lyon', 'lyon'],
        'monaco': ['as monaco', 'asm', 'monaco'],
        'lille': ['losc', 'lille osc', 'lille'],
        'nice': ['ogc nice', 'ogcn', 'nice'],
        'lens': ['rc lens', 'rcl', 'lens'],
        'rennes': ['stade rennais', 'srfc', 'rennes'],
        'real madrid': ['real', 'real madrid', 'madrid'],
        'barcelona': ['barça', 'barca', 'fcb', 'barcelona'],
        'manchester city': ['man city', 'city', 'manchester city', 'mci'],
        'manchester united': ['man utd', 'united', 'manchester united', 'manu'],
        'liverpool': ['lfc', 'liverpool'],
        'arsenal': ['afc', 'arsenal', 'gunners'],
        'chelsea': ['cfc', 'chelsea', 'blues'],
        'juventus': ['juve', 'juventus'],
        'inter': ['inter milan', 'inter', 'internazionale'],
        'ac milan': ['milan', 'ac milan', 'rossoneri'],
        'bayern': ['bayern munich', 'bayern', 'fcb', 'bayern münchen'],
        'dortmund': ['bvb', 'borussia dortmund', 'dortmund']
    };

    // Function to match team name with aliases
    const matchTeamName = (searchTerm: string, teamName: string): boolean => {
        const searchLower = searchTerm.toLowerCase().trim();
        const teamLower = teamName.toLowerCase().trim();

        // Direct match
        if (teamLower.includes(searchLower) || searchLower.includes(teamLower)) return true;

        // Check aliases
        for (const [canonical, aliases] of Object.entries(teamAliases)) {
            if (aliases.some(a => a.toLowerCase() === searchLower || searchLower.includes(a.toLowerCase()))) {
                if (teamLower.includes(canonical) || aliases.some(a => teamLower.includes(a.toLowerCase()))) {
                    return true;
                }
            }
        }
        return false;
    };

    switch (query_type) {
        case 'next_match': {
            // Search for next match of a specific team over the next 14 days
            if (!team) return JSON.stringify({ error: "Paramètre 'team' requis pour next_match" });

            try {
                // Get upcoming matches from cache for the next 14 days
                const upcomingMatches = await sportsService.getUpcomingMatches(league || 'Football', 14);

                // Filter by team name with aliases
                const teamMatches = upcomingMatches.filter((m: any) =>
                    matchTeamName(team, m.homeTeam) || matchTeamName(team, m.awayTeam)
                );

                if (teamMatches.length === 0) {
                    // If no matches found in cache, try to get matches for next 7 days from API
                    console.log(`[SPORTS-TOOL] No cache matches for ${team}, searching next 7 days...`);

                    const foundMatches: any[] = [];
                    for (let i = 0; i < 7; i++) {
                        const checkDate = new Date();
                        checkDate.setDate(checkDate.getDate() + i);

                        try {
                            const dayMatches = await sportsService.getMatchesForDate(checkDate);
                            const teamDayMatches = dayMatches.filter((m: any) =>
                                matchTeamName(team, m.homeTeam) || matchTeamName(team, m.awayTeam)
                            );
                            foundMatches.push(...teamDayMatches);

                            // Stop at first found match to save API calls
                            if (foundMatches.length > 0) break;
                        } catch (err) {
                            console.error(`[SPORTS-TOOL] Error checking date ${checkDate.toISOString()}:`, err);
                        }
                    }

                    if (foundMatches.length > 0) {
                        const match = foundMatches[0];
                        const matchDate = new Date(match.date || match.matchDate);
                        const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
                        const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

                        return JSON.stringify({
                            type: 'next_match',
                            team,
                            found: true,
                            match: {
                                homeTeam: match.homeTeam,
                                awayTeam: match.awayTeam,
                                date: match.date || match.matchDate,
                                dateFormatted: `${dayNames[matchDate.getDay()]} ${matchDate.getDate()} ${monthNames[matchDate.getMonth()]} ${matchDate.getFullYear()}`,
                                time: matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                                league: match.league,
                                competition: match.league
                            },
                            message: `Prochain match de ${team} trouvé via API`
                        });
                    }

                    return JSON.stringify({
                        type: 'next_match',
                        team,
                        found: false,
                        message: `Aucun match à venir trouvé pour ${team} dans les 7 prochains jours. Vérifie les données homework pour les matchs à venir.`
                    });
                }

                // Sort by date and get the nearest one
                const sortedMatches = teamMatches.sort((a: any, b: any) =>
                    new Date(a.date).getTime() - new Date(b.date).getTime()
                );

                const nextMatch = sortedMatches[0];
                const matchDate = new Date(nextMatch.date);
                const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
                const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

                return JSON.stringify({
                    type: 'next_match',
                    team,
                    found: true,
                    match: {
                        homeTeam: nextMatch.homeTeam,
                        awayTeam: nextMatch.awayTeam,
                        date: nextMatch.date,
                        dateFormatted: `${dayNames[matchDate.getDay()]} ${matchDate.getDate()} ${monthNames[matchDate.getMonth()]} ${matchDate.getFullYear()}`,
                        time: matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                        league: nextMatch.league,
                        competition: nextMatch.league
                    },
                    upcomingCount: sortedMatches.length,
                    message: `Prochain match de ${team}: ${nextMatch.homeTeam} vs ${nextMatch.awayTeam}`
                });
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error('[SPORTS-TOOL] Error in next_match:', error);
                return JSON.stringify({ error: `Erreur lors de la recherche: ${msg}` });
            }
        }
        case 'today_matches':
        case 'upcoming_matches': {
            let matches = await sportsService.getMatchesForDate(targetDate);

            if (matches.length === 0) {
                console.log('[SPORTS-TOOL] Cache empty for date, fetching directly from API-Football...');
                try {
                    const { apiFootballService } = await import("../apiFootballService");
                    const dateStr = targetDate.toISOString().split('T')[0];
                    const apiMatches = await apiFootballService.getTodayFootballMatches();
                    if (apiMatches && apiMatches.length > 0) {
                        const targetLeagueIds = [61, 39, 140, 78, 135, 2, 3];
                        const filtered = apiMatches.filter((m: any) => targetLeagueIds.includes(m.league?.id));
                        matches = filtered.map((m: any) => ({
                            id: m.fixture.id,
                            externalId: String(m.fixture.id),
                            sport: 'football',
                            league: m.league.name,
                            leagueId: m.league.id,
                            country: m.league.country,
                            homeTeam: m.teams.home.name,
                            awayTeam: m.teams.away.name,
                            homeTeamId: m.teams.home.id,
                            awayTeamId: m.teams.away.id,
                            homeTeamLogo: m.teams.home.logo,
                            awayTeamLogo: m.teams.away.logo,
                            matchDate: new Date(m.fixture.date),
                            venue: m.fixture.venue?.name || null,
                            status: m.fixture.status.short === "NS" ? "scheduled" :
                                m.fixture.status.short === "LIVE" || m.fixture.status.short === "1H" || m.fixture.status.short === "2H" || m.fixture.status.short === "HT" ? "live" :
                                m.fixture.status.short === "FT" ? "finished" : "scheduled",
                            homeScore: m.goals?.home ?? null,
                            awayScore: m.goals?.away ?? null,
                            stats: { round: m.league.round || null, referee: m.fixture.referee || null },
                        }));
                        console.log(`[SPORTS-TOOL] API fallback returned ${matches.length} matches from target leagues`);
                    }
                } catch (err) {
                    console.error('[SPORTS-TOOL] API fallback failed:', err);
                }
            }

            const filtered = matches.filter((m: any) => {
                if (league && !m.league.toLowerCase().includes(league.toLowerCase())) return false;
                if (team) {
                    if (!matchTeamName(team, m.homeTeam) && !matchTeamName(team, m.awayTeam)) return false;
                }
                return true;
            });

            if (filtered.length === 0 && league) {
                const allLeagues = [...new Set(matches.map((m: any) => m.league))];
                const dateStr = targetDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

                return JSON.stringify({
                    type: query_type,
                    date: targetDate.toISOString().split('T')[0],
                    matchCount: 0,
                    matches: [],
                    noMatchesMessage: `Aucun match de ${league} trouvé pour ${dateStr}. ${allLeagues.length > 0 ? `Matchs disponibles dans: ${allLeagues.join(', ')}` : 'Aucun match en cache pour cette date.'}`,
                    availableLeagues: allLeagues
                });
            }

            const enriched = filtered.slice(0, 15).map((m: any) => {
                const matchTime = m.matchDate ? new Date(m.matchDate) : null;
                const now = new Date();
                const shouldBeFinished = matchTime && (matchTime.getTime() + 2 * 60 * 60 * 1000 < now.getTime());
                const hasScore = m.homeScore !== null && m.homeScore !== undefined;
                return {
                    ...m,
                    scoreAvailable: hasScore,
                    scoreDisplay: hasScore ? `${m.homeScore}-${m.awayScore}` : null,
                    statusNote: !hasScore && shouldBeFinished ? "ATTENTION: match probablement terminé mais score non disponible — NE PAS inventer de score" : undefined
                };
            });
            return JSON.stringify({
                type: query_type,
                date: targetDate.toISOString().split('T')[0],
                matchCount: enriched.length,
                matches: enriched,
                warning: enriched.some((m: any) => m.statusNote) ? "Certains matchs n'ont pas de score disponible. Ne JAMAIS inventer un score — dire clairement que l'info n'est pas disponible." : undefined
            });
        }
        case 'odds': {
            const matchesWithOdds = await sportsService.getMatchesWithOdds(targetDate);
            return JSON.stringify({ type: 'odds', matches: matchesWithOdds.slice(0, 10) });
        }
        case 'team_stats': {
            if (!team) return JSON.stringify({ error: "Paramètre 'team' requis" });
            const stats = await sportsService.getTeamStats(team);
            return JSON.stringify({ type: 'team_stats', team, stats });
        }
        case 'predictions': {
            try {
                const { probabilityModelService } = await import("../probabilityModelService");
                const predictions = await probabilityModelService.analyzeTodayMatches();
                return JSON.stringify({ type: 'predictions', predictions: predictions.slice(0, 10) });
            } catch (e) {
                return JSON.stringify({ error: "Service prédictions non disponible" });
            }
        }
        case 'recent_score': {
            // Get recent match score for a team
            if (!team) return JSON.stringify({ error: "Paramètre 'team' requis pour recent_score" });

            try {
                const result = await sportsService.getRecentMatchScore(team);
                return JSON.stringify({
                    type: 'recent_score',
                    team,
                    found: result.found,
                    match: result.match || null,
                    message: result.message
                });
            } catch (e) {
                console.error(`[SPORTS-TOOL] Error getting recent score for ${team}:`, e);
                return JSON.stringify({ error: `Erreur lors de la récupération du score pour ${team}` });
            }
        }
        case 'team_info': {
            // Quick lookup: both next match and recent score
            if (!team) return JSON.stringify({ error: "Paramètre 'team' requis pour team_info" });

            try {
                const info = await sportsService.queryTeamInfo(team, 'both');
                return JSON.stringify({
                    type: 'team_info',
                    team,
                    info
                });
            } catch (e) {
                console.error(`[SPORTS-TOOL] Error getting team info for ${team}:`, e);
                return JSON.stringify({ error: `Erreur lors de la récupération des infos pour ${team}` });
            }
        }
        case 'dashboard_info': {
            const leagueIds: Record<string, number> = {
                'Ligue 1': 61, 'Premier League': 39, 'La Liga': 140, 'Bundesliga': 78, 'Serie A': 135,
                'Champions League': 2, 'Europa League': 3, 'Conference League': 848,
                'Eredivisie': 88, 'Liga Portugal': 94, 'Jupiler Pro': 144, 'Super Lig': 203,
                'Championship': 40, 'Liga MX': 262, 'MLS': 253
            };
            return JSON.stringify({
                type: 'dashboard_info',
                url: '/sports/predictions',
                tabs: ['Matchs', 'Pronos', 'Classements', 'Buteurs', 'Blessures'],
                leagues: leagueIds,
                dataPerMatch: ['Cotes 1X2', 'Over/Under 2.5', 'BTTS', 'Double Chance', 'All Markets', 'Lineups', 'Events', 'API Prediction', 'H2H', 'Injuries'],
                predictionModel: 'Poisson + Stats + Cotes + Intelligence (Blessures, API Prediction, H2H)',
                tools: ['query_sports_data', 'query_match_intelligence', 'query_matchendirect', 'query_football_db'],
                apiStatus: {
                    configured: process.env.API_FOOTBALL_KEY ? true : false,
                    plan: 'Pro (7500 req/day)'
                }
            });
        }
        default:
            return JSON.stringify({ error: `Type inconnu: ${query_type}` });
    }
}

// ============================================================
// Handler: executeMatchIntelligence
// ============================================================

export async function executeMatchIntelligence(args: { fixtureId?: number; homeTeamId?: number; awayTeamId?: number; leagueId?: number; include?: string[] }): Promise<string> {
    try {
        const { apiFootballService } = await import("../apiFootballService");

        if (!apiFootballService.isConfigured()) {
            return JSON.stringify({ error: "API Football non configurée" });
        }

        const { fixtureId, homeTeamId, awayTeamId, leagueId } = args;
        const includes = args.include || ["injuries", "lineups", "prediction", "topscorers"];
        const result: Record<string, any> = { type: "match_intelligence" };

        const fetches: Promise<void>[] = [];

        if (includes.includes("injuries") && fixtureId) {
            fetches.push(
                apiFootballService.getInjuries(undefined, undefined, fixtureId).then(injuries => {
                    result.injuries = injuries.length > 0
                        ? { count: injuries.length, details: apiFootballService.formatInjuries(injuries), raw: injuries.slice(0, 15) }
                        : { count: 0, details: "Aucune blessure signalée pour ce match" };
                }).catch(() => { result.injuries = { count: 0, details: "Données non disponibles" }; })
            );
        } else if (includes.includes("injuries") && leagueId) {
            fetches.push(
                apiFootballService.getInjuries(leagueId, new Date().getFullYear()).then(injuries => {
                    const relevantInjuries = injuries.filter(inj => {
                        if (homeTeamId && inj.team.id === homeTeamId) return true;
                        if (awayTeamId && inj.team.id === awayTeamId) return true;
                        if (!homeTeamId && !awayTeamId) return true;
                        return false;
                    });
                    result.injuries = {
                        count: relevantInjuries.length,
                        details: apiFootballService.formatInjuries(relevantInjuries),
                        byTeam: {
                            home: relevantInjuries.filter(i => homeTeamId && i.team.id === homeTeamId).map(i => ({ player: i.player.name, type: i.player.type, reason: i.player.reason })),
                            away: relevantInjuries.filter(i => awayTeamId && i.team.id === awayTeamId).map(i => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }))
                        }
                    };
                }).catch(() => { result.injuries = { count: 0, details: "Données non disponibles" }; })
            );
        }

        if (includes.includes("lineups") && fixtureId) {
            fetches.push(
                apiFootballService.getFixtureLineups(fixtureId).then(lineups => {
                    result.lineups = lineups.length > 0
                        ? { available: true, details: apiFootballService.formatLineups(lineups), formations: lineups.map(l => ({ team: l.team.name, formation: l.formation })) }
                        : { available: false, details: "Compositions non encore disponibles (trop tôt avant le match)" };
                }).catch(() => { result.lineups = { available: false, details: "Données non disponibles" }; })
            );
        }

        if (includes.includes("prediction") && fixtureId) {
            fetches.push(
                apiFootballService.getFixturePrediction(fixtureId).then(pred => {
                    if (pred) {
                        result.apiPrediction = {
                            winner: pred.predictions?.winner,
                            winOrDraw: pred.predictions?.win_or_draw,
                            underOver: pred.predictions?.under_over,
                            goals: pred.predictions?.goals,
                            advice: pred.predictions?.advice,
                            percentHome: pred.predictions?.percent?.home,
                            percentDraw: pred.predictions?.percent?.draw,
                            percentAway: pred.predictions?.percent?.away,
                            comparison: pred.comparison,
                            h2h: pred.h2h?.slice(0, 5).map((m: any) => ({
                                home: m.teams?.home?.name,
                                away: m.teams?.away?.name,
                                scoreHome: m.goals?.home,
                                scoreAway: m.goals?.away,
                                date: m.fixture?.date
                            }))
                        };
                    } else {
                        result.apiPrediction = { available: false, details: "Prédiction API non disponible pour ce match" };
                    }
                }).catch(() => { result.apiPrediction = { available: false, details: "Données non disponibles" }; })
            );
        }

        if (includes.includes("events") && fixtureId) {
            fetches.push(
                apiFootballService.getFixtureEvents(fixtureId).then(events => {
                    result.events = events.length > 0
                        ? { count: events.length, details: apiFootballService.formatEvents(events) }
                        : { count: 0, details: "Aucun événement (match pas encore joué ou pas de données)" };
                }).catch(() => { result.events = { count: 0, details: "Données non disponibles" }; })
            );
        }

        if (includes.includes("topscorers") && leagueId) {
            fetches.push(
                apiFootballService.getTopScorers(leagueId).then(scorers => {
                    result.topScorers = scorers.length > 0
                        ? {
                            count: scorers.length,
                            top5: scorers.slice(0, 5).map((s, i) => ({
                                rank: i + 1,
                                name: s.player.name,
                                team: s.statistics[0]?.team?.name,
                                goals: s.statistics[0]?.goals?.total || 0,
                                assists: s.statistics[0]?.goals?.assists || 0,
                                matches: s.statistics[0]?.games?.appearences || 0
                            }))
                        }
                        : { count: 0, details: "Classement non disponible" };
                }).catch(() => { result.topScorers = { count: 0, details: "Données non disponibles" }; })
            );
        }

        await Promise.all(fetches);

        const sections: string[] = ["=== INTELLIGENCE MATCH ==="];

        if (result.injuries) {
            sections.push(`\n--- BLESSURES (${result.injuries.count}) ---`);
            sections.push(result.injuries.details);
            if (result.injuries.byTeam) {
                if (result.injuries.byTeam.home?.length) sections.push(`Absents DOM: ${result.injuries.byTeam.home.map((i: any) => `${i.player} (${i.reason})`).join(', ')}`);
                if (result.injuries.byTeam.away?.length) sections.push(`Absents EXT: ${result.injuries.byTeam.away.map((i: any) => `${i.player} (${i.reason})`).join(', ')}`);
            }
        }

        if (result.lineups) {
            sections.push(`\n--- COMPOSITIONS ---`);
            sections.push(result.lineups.details);
        }

        if (result.apiPrediction && result.apiPrediction.advice) {
            sections.push(`\n--- PREDICTION API FOOTBALL ---`);
            sections.push(`Conseil: ${result.apiPrediction.advice}`);
            sections.push(`Favori: ${result.apiPrediction.winner?.name || 'N/A'} (${result.apiPrediction.percentHome || '?'}% / ${result.apiPrediction.percentDraw || '?'}% / ${result.apiPrediction.percentAway || '?'}%)`);
            if (result.apiPrediction.underOver) sections.push(`Under/Over: ${result.apiPrediction.underOver}`);
            if (result.apiPrediction.goals) sections.push(`Buts attendus: DOM ${result.apiPrediction.goals.home || '?'} - EXT ${result.apiPrediction.goals.away || '?'}`);
            if (result.apiPrediction.h2h?.length) {
                sections.push(`H2H récent: ${result.apiPrediction.h2h.map((h: any) => `${h.home} ${h.scoreHome}-${h.scoreAway} ${h.away}`).join(' | ')}`);
            }
        }

        if (result.events?.count > 0) {
            sections.push(`\n--- EVENTS (${result.events.count}) ---`);
            sections.push(result.events.details);
        }

        if (result.topScorers?.top5) {
            sections.push(`\n--- TOP BUTEURS LIGUE ---`);
            sections.push(result.topScorers.top5.map((s: any) => `${s.rank}. ${s.name} (${s.team}) - ${s.goals}B ${s.assists}A`).join('\n'));
        }

        sections.push(`\n--- NOTE ---`);
        sections.push(`Ces données alimentent le modèle Djedou Pronos (Poisson + Intelligence). Dashboard complet: /sports/predictions`);
        sections.push(`Impact blessures: 1-2 absents = -3%, 3+ absents = -6% sur probabilité équipe.`);
        sections.push(`API prediction cross-référencée à 15% du poids final. H2H: 3% par victoire de différence.`);

        result.formattedForAI = sections.join('\n');

        return JSON.stringify(result);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[MATCH-INTEL] Error:', msg);
        return JSON.stringify({ error: `Erreur intelligence match: ${msg}` });
    }
}

// ============================================================
// Handler: executeFootballDbQuery
// ============================================================

export async function executeFootballDbQuery(args: { action: string; query?: string; team_id?: number; league_id?: number; season?: number }): Promise<string> {
    try {
        const { footballCacheService } = await import('../footballCacheService');
        const { action, query, team_id, league_id, season } = args;

        switch (action) {
            case "db_stats": {
                const stats = await footballCacheService.getDbStats();
                return JSON.stringify({
                    source: "football_db",
                    database: {
                        standingsEntries: stats.standings,
                        squadsCached: stats.squads,
                        teamStatsCached: stats.stats,
                        teamsInDb: stats.teams,
                        seasonsAvailable: stats.seasons.map(s => `${s}/${s + 1}`),
                    },
                    strategy: "DB-first, API-fallback. Data persists 3 years.",
                });
            }
            case "search_team": {
                if (!query) return JSON.stringify({ error: "query parameter required for search_team" });
                const results = await footballCacheService.searchTeamInDb(query);
                return JSON.stringify({
                    source: "football_db",
                    query,
                    results: results.map(r => ({
                        apiTeamId: r.apiTeamId,
                        name: r.teamName,
                        league: r.apiLeagueId,
                        logo: r.teamLogo,
                    })),
                    count: results.length,
                });
            }
            case "team_history": {
                if (!team_id) return JSON.stringify({ error: "team_id required for team_history" });
                const history = await footballCacheService.getTeamHistoryFromDb(team_id);
                return JSON.stringify({
                    source: "football_db",
                    team: history.team,
                    standings: history.standingsByseason,
                    stats: history.stats,
                });
            }
            case "league_standings": {
                if (!league_id) return JSON.stringify({ error: "league_id required for league_standings" });
                const s = season || (await import('../apiFootballService')).APIFootballService.getCurrentFootballSeason();
                const standings = await footballCacheService.getStandings(league_id, s);
                return JSON.stringify({
                    source: "football_db",
                    league: league_id,
                    season: `${s}/${s + 1}`,
                    standings: standings.slice(0, 20).map((t: any) => ({
                        rank: t.rank,
                        team: t.team?.name || t.teamName,
                        points: t.points,
                        played: t.all?.played || t.played,
                        win: t.all?.win || t.win,
                        draw: t.all?.draw || t.draw,
                        lose: t.all?.lose || t.lose,
                        gf: t.all?.goals?.for || t.goalsFor,
                        ga: t.all?.goals?.against || t.goalsAgainst,
                    })),
                });
            }
            case "league_history": {
                if (!league_id) return JSON.stringify({ error: "league_id required for league_history" });
                const history = await footballCacheService.getLeagueHistoryFromDb(league_id);
                return JSON.stringify({
                    source: "football_db",
                    league: league_id,
                    seasons: history,
                });
            }
            default:
                return JSON.stringify({ error: `Unknown action: ${action}`, availableActions: ["search_team", "team_history", "league_standings", "league_history", "db_stats"] });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[FOOTBALL-DB-TOOL] Error:', msg);
        return JSON.stringify({ error: msg, source: "football_db" });
    }
}

// ============================================================
// Handler: executeMatchEndirectQuery
// ============================================================

export async function executeMatchEndirectQuery(args: { date?: string; league?: string }): Promise<string> {
    try {
        const { date = '', league = 'all' } = args;
        const targetDate = date ? date : formatTodayForMatchEndirect();

        // ======= CHECK FOOTDATAS FIRST (from homework injection) =======
        try {
            const { footdatasService } = await import('../footdatasService');
            const storedMatches = await footdatasService.getMatchesByDate(targetDate);

            if (storedMatches.length > 0) {
                console.log(`[MATCHENDIRECT-TOOL] 📦 Found ${storedMatches.length} stored matches for ${targetDate}`);

                // ======= STALE DATA DETECTION =======
                // If the date is in the past and we have "scheduled" matches, data is STALE - force refresh
                const [day, month, year] = targetDate.split('-').map(Number);
                const matchDate = new Date(year, month - 1, day, 23, 59, 59);
                const now = new Date();
                const dateIsPast = matchDate < now;

                const scheduledMatches = storedMatches.filter(m =>
                    m.status === 'scheduled' || m.status === 'à venir' || m.status?.toLowerCase().includes('venir')
                );

                if (dateIsPast && scheduledMatches.length > 0) {
                    console.log(`[MATCHENDIRECT-TOOL] ⚠️ STALE DATA DETECTED: ${scheduledMatches.length} "scheduled" matches for past date ${targetDate} - forcing refresh`);
                    throw new Error('STALE_DATA_FORCE_REFRESH');
                }

                // Map league codes
                const leagueCodeMap: Record<string, string> = {
                    ligue1: 'L1', laliga: 'LL', premierLeague: 'PL', bundesliga: 'BL', serieA: 'SA'
                };

                let filteredStored = storedMatches;
                if (league !== 'all') {
                    const targetCode = leagueCodeMap[league] || league.toUpperCase();
                    filteredStored = storedMatches.filter(m => m.leagueCode === targetCode);
                }

                if (filteredStored.length > 0) {
                    const formattedMatches = filteredStored.map(m => ({
                        competition: m.competition || m.leagueCode,
                        home: m.homeTeam,
                        away: m.awayTeam,
                        score: m.homeScore !== null && m.awayScore !== null ? `${m.homeScore}-${m.awayScore}` : null,
                        status: m.status,
                        time: m.matchTime,
                    }));

                    const byLeague = {
                        ligue1: storedMatches.filter(m => m.leagueCode === 'L1').length,
                        laliga: storedMatches.filter(m => m.leagueCode === 'LL').length,
                        premierLeague: storedMatches.filter(m => m.leagueCode === 'PL').length,
                        bundesliga: storedMatches.filter(m => m.leagueCode === 'BL').length,
                        serieA: storedMatches.filter(m => m.leagueCode === 'SA').length,
                    };

                    return JSON.stringify({
                        type: 'matchendirect',
                        date: targetDate,
                        source: 'FootdatasService (homework injection from matchendirect.fr)',
                        fromCache: true,
                        totalMatches: storedMatches.length,
                        big5Total: storedMatches.length,
                        filteredLeague: league,
                        matchCount: filteredStored.length,
                        matches: formattedMatches,
                        byLeague,
                    });
                }
            }
        } catch (cacheErr: unknown) {
            const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
            if (msg !== 'STALE_DATA_FORCE_REFRESH') {
                console.log(`[MATCHENDIRECT-TOOL] Cache check failed, fetching live:`, cacheErr);
            }
        }

        // ======= FALLBACK: LIVE FETCH FROM MATCHENDIRECT.FR =======
        console.log(`[MATCHENDIRECT-TOOL] 🌐 Fetching live data for ${targetDate}`);
        const matchEndirectService = await import('../matchEndirectService');
        const result = await matchEndirectService.fetchMatchEndirect(targetDate);

        // Store to FootdatasService for future reuse
        try {
            const { footdatasService } = await import('../footdatasService');
            const syncResult = await footdatasService.storeMatchEndirectData(result);
            console.log(`[MATCHENDIRECT-TOOL] 📦 Synced to FootdatasService: ${syncResult.stored} stored, ${syncResult.updated} updated`);
        } catch (syncErr) {
            console.error(`[MATCHENDIRECT-TOOL] Sync error:`, syncErr);
        }

        let matches = result.big5Matches;
        if (league !== 'all' && league in result.byLeague) {
            matches = result.byLeague[league as keyof typeof result.byLeague];
        }

        const formattedMatches = matches.map(m => ({
            competition: m.competition,
            home: m.homeTeam,
            away: m.awayTeam,
            score: m.homeScore !== null && m.awayScore !== null ? `${m.homeScore}-${m.awayScore}` : null,
            status: m.status,
            time: m.time,
        }));

        return JSON.stringify({
            type: 'matchendirect',
            date: targetDate,
            source: 'matchendirect.fr (live)',
            fromCache: false,
            totalMatches: result.totalMatches,
            big5Total: result.big5Matches.length,
            filteredLeague: league,
            matchCount: matches.length,
            matches: formattedMatches,
            byLeague: {
                ligue1: result.byLeague.ligue1.length,
                laliga: result.byLeague.laliga.length,
                premierLeague: result.byLeague.premierLeague.length,
                bundesliga: result.byLeague.bundesliga.length,
                serieA: result.byLeague.serieA.length,
            }
        });
    } catch (error) {
        console.error('[MATCHENDIRECT-TOOL] Error:', error);
        return JSON.stringify({ error: `Erreur matchendirect: ${error instanceof Error ? error.message : 'Unknown'}` });
    }
}

// ============================================================
// Helper: formatTodayForMatchEndirect
// ============================================================

export function formatTodayForMatchEndirect(): string {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}-${month}-${year}`;
}
