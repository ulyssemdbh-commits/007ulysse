import { type Dispatch, type SetStateAction } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, XCircle, Clock, Loader2, ArrowLeft,
  ChevronUp, ChevronDown, Minus, RotateCcw, StopCircle,
} from "lucide-react";
import type { Repo, WorkflowRun, RunLogsState, Job, JobStep } from "./types";
import { timeAgo } from "./helpers";

interface CicdTabProps {
  runLogs: RunLogsState | null;
  setRunLogs: Dispatch<SetStateAction<RunLogsState | null>>;
  runsLoading: boolean;
  runLogsLoading: boolean;
  workflowRuns: { workflow_runs: WorkflowRun[]; total_count: number } | undefined;
  selectedRepo: Repo;
  loadRunJobs: (runId: number) => void;
  loadJobLogs: (jobId: number) => void;
}

export function CicdTab({
  runLogs, setRunLogs, runsLoading, runLogsLoading,
  workflowRuns, selectedRepo, loadRunJobs, loadJobLogs,
}: CicdTabProps) {
  const { toast } = useToast();

  if (runLogs) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setRunLogs(null)}
            data-testid="button-back-cicd"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
          </Button>
          <span className="text-sm font-medium">
            Run #{runLogs.runId}
          </span>
        </div>
        {runLogs.jobs.map((job: Job) => (
          <Card
            key={job.id}
            className="overflow-hidden"
            data-testid={`card-job-${job.id}`}
          >
            <div
              className="flex items-center justify-between gap-2 px-2.5 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => {
                if (runLogs.logs[job.id]) {
                  setRunLogs((prev) =>
                    prev
                      ? {
                          ...prev,
                          expandedJob:
                            prev.expandedJob === job.id ? null : job.id,
                        }
                      : prev,
                  );
                } else {
                  loadJobLogs(job.id);
                }
              }}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {job.conclusion === "success" ? (
                  <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                ) : job.conclusion === "failure" ? (
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                ) : job.status === "in_progress" ? (
                  <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin shrink-0" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm truncate">{job.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {job.conclusion || job.status}
                    {job.steps && ` · ${job.steps.length} etapes`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {runLogs.logsLoading[job.id] && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                )}
                {runLogs.expandedJob === job.id ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </div>
            </div>
            {job.steps && job.steps.length > 0 && (
              <div className="border-t px-2.5 py-1.5 bg-muted/20">
                {job.steps.map((step: JobStep, si: number) => (
                  <div
                    key={si}
                    className="flex items-center gap-1.5 py-0.5 text-[11px]"
                  >
                    {step.conclusion === "success" ? (
                      <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                    ) : step.conclusion === "failure" ? (
                      <XCircle className="w-2.5 h-2.5 text-red-500" />
                    ) : step.conclusion === "skipped" ? (
                      <Minus className="w-2.5 h-2.5 text-muted-foreground" />
                    ) : (
                      <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">
                      {step.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {runLogs.expandedJob === job.id && runLogs.logs[job.id] && (
              <div className="border-t">
                <pre
                  className="text-[11px] font-mono p-2.5 overflow-x-auto max-h-[350px] overflow-y-auto bg-zinc-950 text-zinc-300"
                  data-testid={`logs-job-${job.id}`}
                >
                  {runLogs.logs[job.id]}
                </pre>
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {runsLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
        </div>
      )}
      {runLogsLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Jobs...
        </div>
      )}
      {workflowRuns?.workflow_runs?.some(
        (r: WorkflowRun) =>
          r.status === "in_progress" || r.status === "queued",
      ) && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-600 dark:text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          Workflows en cours — auto-refresh 8s
        </div>
      )}
      {workflowRuns?.workflow_runs?.map((run: WorkflowRun) => (
        <Card
          key={run.id}
          className="p-2.5 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => loadRunJobs(run.id)}
          data-testid={`card-run-${run.id}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {run.conclusion === "success" ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
              ) : run.conclusion === "failure" ? (
                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              ) : run.status === "in_progress" ? (
                <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm truncate">{run.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  #{run.run_number} · {run.head_branch} ·{" "}
                  {timeAgo(run.created_at)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Badge
                variant={
                  run.conclusion === "success"
                    ? "default"
                    : run.conclusion === "failure"
                      ? "destructive"
                      : "secondary"
                }
                className="text-[10px] h-5"
              >
                {run.conclusion || run.status}
              </Badge>
              {run.conclusion === "failure" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await apiRequest(
                        "POST",
                        `/api/devops/repos/${selectedRepo.full_name}/actions/runs/${run.id}/rerun`,
                      );
                      toast({ title: "Relance" });
                      queryClient.invalidateQueries({
                        queryKey: [
                          "/api/devops/repos",
                          selectedRepo.full_name,
                          "actions/runs",
                        ],
                      });
                    } catch {
                      toast({
                        title: "Erreur",
                        variant: "destructive",
                      });
                    }
                  }}
                  data-testid={`button-rerun-${run.id}`}
                >
                  <RotateCcw className="w-3 h-3" />
                </Button>
              )}
              {run.status === "in_progress" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await apiRequest(
                        "POST",
                        `/api/devops/repos/${selectedRepo.full_name}/actions/runs/${run.id}/cancel`,
                      );
                      toast({ title: "Annule" });
                      queryClient.invalidateQueries({
                        queryKey: [
                          "/api/devops/repos",
                          selectedRepo.full_name,
                          "actions/runs",
                        ],
                      });
                    } catch {
                      toast({
                        title: "Erreur",
                        variant: "destructive",
                      });
                    }
                  }}
                  data-testid={`button-cancel-${run.id}`}
                >
                  <StopCircle className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
      {!runsLoading && !workflowRuns?.workflow_runs?.length && (
        <p className="text-muted-foreground text-sm">
          Aucun workflow
        </p>
      )}
    </div>
  );
}
