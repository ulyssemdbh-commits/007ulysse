import type { UseMutationResult } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, GitBranch, Loader2, RotateCcw, Clock, CheckCircle, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo, Branch, Commit } from "./types";
import { timeAgo } from "./helpers";

interface RollbackTabProps {
  rollbackBranch: string;
  setRollbackBranch: (v: string) => void;
  rollbackConfirmSha: string | null;
  setRollbackConfirmSha: (v: string | null) => void;
  rollbackCommits: Commit[] | undefined;
  rollbackCommitsLoading: boolean;
  rollbackMutation: UseMutationResult<
    unknown,
    Error,
    { targetSha: string; createBackup: boolean }
  >;
  branches: Branch[] | undefined;
  selectedRepo: Repo;
}

export function RollbackTab({
  rollbackBranch, setRollbackBranch,
  rollbackConfirmSha, setRollbackConfirmSha,
  rollbackCommits, rollbackCommitsLoading,
  rollbackMutation, branches, selectedRepo,
}: RollbackTabProps) {
  return (
    <div className="space-y-4" data-testid="rollback-tab">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
        <div>
          <p className="text-sm font-medium text-destructive">Rollback System</p>
          <p className="text-[11px] text-muted-foreground">
            Force-push une branche vers un commit precedent. Un backup automatique de l'etat actuel est cree avant chaque rollback.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Branche cible :</span>
        </div>
        <Select
          value={rollbackBranch}
          onValueChange={(v) => {
            setRollbackBranch(v);
            setRollbackConfirmSha(null);
          }}
        >
          <SelectTrigger className="w-[200px] h-8" data-testid="select-rollback-branch">
            <SelectValue placeholder="Choisir une branche" />
          </SelectTrigger>
          <SelectContent>
            {branches?.map((b: Branch) => (
              <SelectItem key={b.name} value={b.name}>
                {b.name} {b.name === selectedRepo.default_branch ? "(default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {rollbackBranch && (
          <Badge variant="outline" className="text-[10px]">
            HEAD: {branches?.find(b => b.name === rollbackBranch)?.commit.sha.slice(0, 7) || "..."}
          </Badge>
        )}
      </div>

      {rollbackCommitsLoading && (
        <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement de l'historique...
        </div>
      )}

      {rollbackConfirmSha && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-destructive mb-1">Confirmer le rollback</p>
              <p className="text-[11px] text-muted-foreground mb-2">
                Cette action va force-push <code className="bg-muted px-1 rounded">{rollbackBranch}</code> vers le commit{" "}
                <code className="bg-muted px-1 rounded">{rollbackConfirmSha.slice(0, 7)}</code>.
                {" "}Un backup de l'etat actuel sera cree automatiquement.
              </p>
              <p className="text-[11px] text-muted-foreground mb-3">
                Commit: <strong>{rollbackCommits?.find(c => c.sha === rollbackConfirmSha)?.commit.message.split("\n")[0]}</strong>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => rollbackMutation.mutate({ targetSha: rollbackConfirmSha, createBackup: true })}
                  disabled={rollbackMutation.isPending}
                  data-testid="button-confirm-rollback"
                >
                  {rollbackMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <RotateCcw className="w-3 h-3 mr-1" />
                  )}
                  Rollback avec backup
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-destructive border-destructive/30"
                  onClick={() => rollbackMutation.mutate({ targetSha: rollbackConfirmSha, createBackup: false })}
                  disabled={rollbackMutation.isPending}
                  data-testid="button-confirm-rollback-no-backup"
                >
                  Rollback sans backup
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setRollbackConfirmSha(null)}
                  data-testid="button-cancel-rollback"
                >
                  Annuler
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {!rollbackCommitsLoading && rollbackCommits && rollbackCommits.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Historique ({rollbackCommits.length} commits) — Selectionnez un commit cible
            </span>
          </div>
          {rollbackCommits.map((c: Commit, idx: number) => {
            const isHead = idx === 0;
            const isSelected = rollbackConfirmSha === c.sha;
            return (
              <Card
                key={c.sha}
                className={cn(
                  "p-2.5 transition-all",
                  isHead && "border-green-500/30 bg-green-500/5",
                  isSelected && "ring-2 ring-destructive/50 border-destructive/40",
                  !isHead && !isSelected && "cursor-pointer hover:border-primary/40",
                )}
                onClick={() => {
                  if (!isHead) setRollbackConfirmSha(c.sha);
                }}
                data-testid={`rollback-commit-${c.sha.slice(0, 7)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <div className={cn(
                      "w-2 h-2 rounded-full mt-1.5 shrink-0",
                      isHead ? "bg-green-500" : "bg-muted-foreground/30"
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate" data-testid={`text-rollback-commit-${c.sha.slice(0, 7)}`}>
                        {c.commit.message.split("\n")[0]}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {c.commit.author.name} · {timeAgo(c.commit.author.date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isHead && (
                      <Badge className="text-[9px] h-4 bg-green-500/10 text-green-600 border-green-500/30">
                        HEAD
                      </Badge>
                    )}
                    <code className="text-[11px] text-muted-foreground font-mono">
                      {c.sha.slice(0, 7)}
                    </code>
                    {!isHead && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRollbackConfirmSha(c.sha);
                        }}
                        data-testid={`button-rollback-${c.sha.slice(0, 7)}`}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Rollback ici
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!rollbackBranch && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <RotateCcw className="w-8 h-8 mb-3 opacity-40" />
          <p className="text-sm">Selectionnez une branche pour voir l'historique</p>
        </div>
      )}
    </div>
  );
}
