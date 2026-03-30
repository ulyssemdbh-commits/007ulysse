import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { GitPullRequest, RefreshCw, Loader2, ExternalLink, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { API, timeAgo, type PullRequest } from "./types";

export default function PullRequestsTab() {
  const { toast } = useToast();
  const [prState, setPrState] = useState("open");

  const { data: pulls, isLoading, refetch } = useQuery<PullRequest[]>({
    queryKey: [API, "pulls", prState],
    queryFn: () => fetch(`${API}/pulls?state=${prState}`, { credentials: "include" }).then(r => r.json()),
  });

  const mergePR = useMutation({
    mutationFn: (number: number) => apiRequest("PUT", `${API}/pulls/${number}/merge`, { merge_method: "squash" }),
    onSuccess: () => { toast({ title: "PR fusionnée" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant={prState === "open" ? "default" : "outline"} onClick={() => setPrState("open")} data-testid="button-pr-open">
          Ouvertes
        </Button>
        <Button size="sm" variant={prState === "closed" ? "default" : "outline"} onClick={() => setPrState("closed")} data-testid="button-pr-closed">
          Fermées
        </Button>
        <Button size="icon" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : pulls?.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">Aucune pull request {prState === "open" ? "ouverte" : "fermée"}</p>
      ) : (
        <div className="space-y-2">
          {pulls?.map(pr => (
            <Card key={pr.number} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <GitPullRequest className={cn("w-4 h-4 shrink-0", pr.merged_at ? "text-purple-500" : pr.state === "open" ? "text-green-500" : "text-red-500")} />
                    <span className="text-sm font-medium">#{pr.number} {pr.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{pr.head.ref} → {pr.base.ref}</span>
                    <span>{timeAgo(pr.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pr.state === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mergePR.mutate(pr.number)}
                      disabled={mergePR.isPending}
                      data-testid={`button-merge-pr-${pr.number}`}
                    >
                      {mergePR.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
                      <span className="ml-1">Merge</span>
                    </Button>
                  )}
                  <a href={pr.html_url} target="_blank" rel="noopener noreferrer">
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
