/**
 * Sports formatting — pure string transformation, no DB access.
 */
import type { MatchWithOdds } from "./cacheQueries";

/**
 * Format matches (with odds & interest scores) into a human-readable AI prompt.
 */
export function formatMatchesForAI(matches: MatchWithOdds[]): string {
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
                const hForm = (match.homeStats as Record<string, unknown>).formString as string | undefined;
                const aForm = (match.awayStats as Record<string, unknown>).formString as string | undefined;
                const hOver = (match.homeStats as Record<string, unknown>).over25Rate as number | undefined;
                const aOver = (match.awayStats as Record<string, unknown>).over25Rate as number | undefined;
                const hFormStr = hForm?.slice(0, 5) || "?";
                const aFormStr = aForm?.slice(0, 5) || "?";
                const hOverStr = hOver ? `${Math.round(hOver * 100)}%` : "?";
                const aOverStr = aOver ? `${Math.round(aOver * 100)}%` : "?";
                statsStr = ` [${hFormStr} vs ${aFormStr}, O2.5: ${hOverStr}/${aOverStr}]`;
            }

            // Add tags
            const tagsStr = match.interestTags?.length > 0 ? ` #${match.interestTags.slice(0, 2).join(" #")}` : "";

            const factors = match.interestFactors?.slice(0, 2).join(", ") || "";
            output += `${match.interestEmoji} [${match.bettingInterest}/100] ${time} ${match.homeTeam} vs ${match.awayTeam}${oddsStr}${statsStr}${factors ? ` (${factors})` : ""}${tagsStr}\n`;
        }
        output += "\n";
    }

    // Then show all matches by league
    const byLeague: Record<string, MatchWithOdds[]> = {};
    for (const match of matches) {
        if (!byLeague[match.league]) {
            byLeague[match.league] = [];
        }
        byLeague[match.league].push(match);
    }

    output += "**📅 TOUS LES MATCHS:**\n";

    for (const league of Object.keys(byLeague)) {
        const leagueMatches = byLeague[league];
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

            const interestTag = match.bettingInterest >= 50 ? ` ${match.interestEmoji}${match.bettingInterest}` : "";
            output += `- ${time}: ${match.homeTeam} vs ${match.awayTeam}${oddsStr}${interestTag}\n`;
        }
    }

    return output;
}
