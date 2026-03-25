export interface SportsScreenState {
  page: "predictions" | "almanach" | null;
  tab?: string;
  selectedLeague?: string;
  selectedTeamId?: number;
  selectedTeamName?: string;
  selectedMatchId?: number;
  selectedMatchLabel?: string;
  visiblePredictions?: Array<{
    fixtureId: number;
    homeTeam: string;
    awayTeam: string;
    bestBet: string;
    confidence: number;
    odds?: number;
  }>;
  cumulativeOdds?: number;
  riskLevel?: string;
  standings?: { position: number; team: string; points: number }[];
  updatedAt: number;
}

const userScreenState = new Map<number, SportsScreenState>();

const STALE_AFTER_MS = 5 * 60 * 1000;

export function updateSportsScreen(userId: number, state: Partial<SportsScreenState>) {
  const existing = userScreenState.get(userId);
  userScreenState.set(userId, {
    ...existing,
    ...state,
    updatedAt: Date.now(),
  });
}

export function getSportsScreen(userId: number): SportsScreenState | null {
  const state = userScreenState.get(userId);
  if (!state) return null;
  if (Date.now() - state.updatedAt > STALE_AFTER_MS) {
    userScreenState.delete(userId);
    return null;
  }
  return state;
}

export function clearSportsScreen(userId: number) {
  userScreenState.delete(userId);
}

export function formatSportsContextForAI(userId: number): string | null {
  const state = getSportsScreen(userId);
  if (!state || !state.page) return null;

  const lines: string[] = [];
  const ageSeconds = Math.round((Date.now() - state.updatedAt) / 1000);
  lines.push(`[CONTEXTE ÉCRAN LIVE - il y a ${ageSeconds}s]`);

  if (state.page === "predictions") {
    lines.push(`Page: Djedou Pronos (onglet: ${state.tab || "matchs"})`);
    if (state.riskLevel) lines.push(`Niveau de risque: ${state.riskLevel}`);
    if (state.visiblePredictions && state.visiblePredictions.length > 0) {
      lines.push(`Pronostics affichés (${state.visiblePredictions.length}):`);
      for (const p of state.visiblePredictions) {
        lines.push(`  - ${p.homeTeam} vs ${p.awayTeam}: ${p.bestBet} (confiance ${p.confidence}%${p.odds ? `, cote ${p.odds.toFixed(2)}` : ""})`);
      }
      if (state.cumulativeOdds) {
        lines.push(`Cote cumulée: x${state.cumulativeOdds.toFixed(2)}`);
      }
    }
    if (state.selectedMatchId && state.selectedMatchLabel) {
      lines.push(`Match sélectionné: ${state.selectedMatchLabel}`);
    }
  } else if (state.page === "almanach") {
    lines.push(`Page: Foot-Almanach`);
    if (state.selectedLeague) lines.push(`Ligue: ${state.selectedLeague}`);
    if (state.selectedTeamName) lines.push(`Équipe: ${state.selectedTeamName}`);
    if (state.tab) lines.push(`Vue: ${state.tab}`);
    if (state.standings && state.standings.length > 0) {
      lines.push(`Classement visible (top 5):`);
      for (const s of state.standings.slice(0, 5)) {
        lines.push(`  ${s.position}. ${s.team} - ${s.points} pts`);
      }
    }
  }

  return lines.join("\n");
}
