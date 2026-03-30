import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, RefreshCw, Loader2, ExternalLink, CheckCircle, XCircle,
  Clock, RotateCcw, StopCircle,
} from "lucide-react";
import { API, timeAgo, type WorkflowRun } from "./types";

export default function CICDTab() {
  const { toast } = useToast();

  const { data: runs, isLoading, refetch } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: [API, "actions", "runs"],
    queryFn: () => fetch(`${API}/actions/runs`, { credentials: "include" }).then(r => r.json()),
  });

  const rerun = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API}/actions/runs/${id}/rerun`),
    onSuccess: () => { toast({ title: "Relancé" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `${API}/actions/runs/${id}/cancel`),
    onSuccess: () => { toast({ title: "Annulé" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const workflowRuns = runs?.workflow_runs || [];

  function statusIcon(run: WorkflowRun) {
    if (run.status === "in_progress" || run.status === "queued") return <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />;
    if (run.conclusion === "success") return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (run.conclusion === "failure") return <XCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" /> GitHub Actions
        </h3>
        <Button size="icon" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : workflowRuns.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">Aucun workflow exécuté</p>
      ) : (
        <div className="space-y-2">
          {workflowRuns.slice(0, 20).map(run => (
            <Card key={run.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {statusIcon(run)}
                  <div className="min-w-0">
                    <span className="text-sm font-medium truncate block">{run.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>#{run.run_number}</span>
                      <span>{run.head_branch}</span>
                      <span>{timeAgo(run.created_at)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {(run.status === "completed" && run.conclusion === "failure") && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => rerun.mutate(run.id)} data-testid={`button-rerun-${run.id}`}>
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(run.status === "in_progress" || run.status === "queued") && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancel.mutate(run.id)} data-testid={`button-cancel-${run.id}`}>
                      <StopCircle className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                  <a href={run.html_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
