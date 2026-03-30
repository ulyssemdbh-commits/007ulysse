import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch, GitCommit, GitPullRequest, Activity, Loader2, CheckCircle, XCircle,
} from "lucide-react";
import { API, timeAgo, type Branch, type Commit, type PullRequest, type WorkflowRun } from "./types";

export default function OverviewTab({ repo, repoLoading }: { repo: any; repoLoading: boolean }) {
  const { data: branches } = useQuery<Branch[]>({
    queryKey: [API, "branches"],
    queryFn: () => fetch(`${API}/branches`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: commits } = useQuery<Commit[]>({
    queryKey: [API, "commits", "main", "overview"],
    queryFn: () => fetch(`${API}/commits?branch=main&per_page=5`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: pulls } = useQuery<PullRequest[]>({
    queryKey: [API, "pulls", "open", "overview"],
    queryFn: () => fetch(`${API}/pulls?state=open`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: runs } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: [API, "actions", "runs", "overview"],
    queryFn: () => fetch(`${API}/actions/runs`, { credentials: "include" }).then(r => r.json()),
  });

  if (repoLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const lastRun = runs?.workflow_runs?.[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><GitBranch className="w-4 h-4" /> Branches</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{branches?.length || 0}</p>
          <div className="mt-2 space-y-1">
            {branches?.slice(0, 3).map(b => (
              <div key={b.name} className="flex items-center gap-2 text-xs">
                <GitBranch className="w-3 h-3 text-green-500" />
                <span className="font-mono">{b.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><GitPullRequest className="w-4 h-4" /> Pull Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{pulls?.length || 0} <span className="text-sm font-normal text-muted-foreground">ouvertes</span></p>
          <div className="mt-2 space-y-1">
            {pulls?.slice(0, 3).map(pr => (
              <div key={pr.number} className="text-xs truncate">
                <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
              </div>
            ))}
            {(!pulls || pulls.length === 0) && <p className="text-xs text-muted-foreground">Aucune PR ouverte</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> CI/CD</CardTitle>
        </CardHeader>
        <CardContent>
          {lastRun ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {lastRun.conclusion === "success" ? <CheckCircle className="w-5 h-5 text-green-500" /> :
                 lastRun.conclusion === "failure" ? <XCircle className="w-5 h-5 text-red-500" /> :
                 <Loader2 className="w-5 h-5 animate-spin text-yellow-500" />}
                <span className="text-sm font-medium">{lastRun.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">#{lastRun.run_number} · {lastRun.head_branch} · {timeAgo(lastRun.created_at)}</p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Aucun workflow</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><GitCommit className="w-4 h-4" /> Derniers commits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {commits?.slice(0, 4).map(c => (
              <div key={c.sha} className="text-xs">
                <div className="flex items-center gap-2">
                  <code className="text-muted-foreground font-mono">{c.sha.slice(0, 7)}</code>
                  <span className="truncate flex-1">{c.commit.message.split("\n")[0]}</span>
                </div>
                <span className="text-muted-foreground">{timeAgo(c.commit.author.date)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {repo?.description && (
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{repo.description}</p>
            {repo.languages && Object.keys(repo.languages).length > 0 && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {Object.entries(repo.languages).map(([lang, bytes]: [string, any]) => (
                  <Badge key={lang} variant="outline" className="text-xs">{lang}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
