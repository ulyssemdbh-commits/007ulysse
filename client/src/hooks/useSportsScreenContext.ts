import { useEffect, useRef, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

interface SportsScreenState {
  page: "predictions" | "almanach";
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
}

const DEBOUNCE_MS = 1500;

export function useSportsScreenContext(page: "predictions" | "almanach") {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastJsonRef = useRef<string>("");

  const broadcast = useCallback((state: Partial<SportsScreenState>) => {
    const payload: SportsScreenState = { page, ...state } as SportsScreenState;
    const json = JSON.stringify(payload);
    if (json === lastJsonRef.current) return;
    lastJsonRef.current = json;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetch("/api/sports/screen-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: json,
      }).catch(() => {});
    }, DEBOUNCE_MS);
  }, [page]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      fetch("/api/sports/screen-context", {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {});
    };
  }, []);

  return { broadcast };
}
