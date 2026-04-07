import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Crown, CheckCircle, XCircle, Clock, Loader2, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DgmTask, Repo } from "./types";

interface DgmTabProps {
  selectedRepo: Repo | null;
  dgmActive: boolean;
  dgmObjective: string;
  setDgmObjective: (v: string) => void;
  dgmTasks: DgmTask[];
  dgmLoading: boolean;
  toggleDgm: (v: boolean) => void;
}

export function DgmTab({
  selectedRepo, dgmActive, dgmObjective, setDgmObjective,
  dgmTasks, dgmLoading, toggleDgm,
}: DgmTabProps) {
  return (
    <div className="space-y-4" data-testid="dgm-tab">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <Crown className={cn("w-5 h-5 shrink-0", dgmActive ? "text-amber-500" : "text-muted-foreground")} />
        <div>
          <p className="text-sm font-medium">DEV God Mode — {selectedRepo?.name}</p>
          <p className="text-[11px] text-muted-foreground">
            En mode God, Ulysse travaille en autonomie totale : une tache a la fois, 100% terminee et testee avant la suivante.
          </p>
        </div>
        {dgmActive && <Badge className="ml-auto bg-amber-500/20 text-amber-600 border-amber-500/30">ACTIF</Badge>}
      </div>

      {selectedRepo && !dgmActive && (
        <div>
          <label className="text-sm font-medium mb-1 block">Objectif (optionnel)</label>
          <Input
            placeholder="Ex: Refactor complet du module auth..."
            value={dgmObjective}
            onChange={(e) => setDgmObjective(e.target.value)}
            data-testid="input-dgm-objective"
          />
        </div>
      )}

      {dgmActive && dgmObjective && (
        <div className="text-sm p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
          <span className="font-medium text-amber-600">Objectif:</span> {dgmObjective}
        </div>
      )}

      {dgmActive && dgmTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Taches DGM</p>
          {dgmTasks.map((t, i) => (
            <div key={t.id} className={cn("flex items-center gap-2 text-sm p-2 rounded-md border", t.status === "tested" || t.status === "completed" ? "bg-green-500/10 border-green-500/20" : t.status === "running" ? "bg-amber-500/10 border-amber-500/20" : t.status === "failed" ? "bg-red-500/10 border-red-500/20" : "bg-muted/30 border-border")}>
              {t.status === "tested" || t.status === "completed" ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
              ) : t.status === "running" ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
              ) : t.status === "failed" ? (
                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="truncate">{i + 1}. {t.title}</span>
            </div>
          ))}
        </div>
      )}

      {selectedRepo && (
        <Button
          className={cn("w-full", dgmActive ? "bg-red-500 hover:bg-red-600" : "bg-amber-500 hover:bg-amber-600 text-black")}
          onClick={() => toggleDgm(!dgmActive)}
          disabled={dgmLoading}
          data-testid="button-dgm-confirm"
        >
          {dgmLoading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : dgmActive ? (
            <>
              <StopCircle className="w-4 h-4 mr-2" />
              Desactiver God Mode
            </>
          ) : (
            <>
              <Crown className="w-4 h-4 mr-2" />
              Activer God Mode
            </>
          )}
        </Button>
      )}
    </div>
  );
}
