import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { GitCommit, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { API, timeAgo, type Commit } from "./types";

export default function RollbackTab() {
  const { toast } = useToast();
  const [branch, setBranch] = useState("main");
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  const { data: commits, isLoading } = useQuery<Commit[]>({
    queryKey: [API, "commits", branch, "rollback"],
    queryFn: () => fetch(`${API}/commits?branch=${branch}&per_page=15`, { credentials: "include" }).then(r => r.json()),
  });

  const rollback = useMutation({
    mutationFn: () => apiRequest("POST", `${API}/rollback`, { branch, targetSha: selectedSha, createBackup: true }),
    onSuccess: (data: any) => {
      toast({ title: "Rollback effectué", description: `Backup: ${data.backupBranch || "N/A"}` });
      setSelectedSha(null);
      queryClient.invalidateQueries({ queryKey: [API] });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input value={branch} onChange={e => setBranch(e.target.value)} className="w-40" placeholder="Branche" />
        {selectedSha && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => rollback.mutate()}
            disabled={rollback.isPending}
            data-testid="button-confirm-rollback"
          >
            {rollback.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
            Rollback vers {selectedSha.slice(0, 7)}
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-1">
          {commits?.map((c, i) => (
            <div
              key={c.sha}
              className={cn(
                "flex items-center gap-3 p-2 rounded-md text-sm cursor-pointer transition-colors",
                selectedSha === c.sha ? "bg-destructive/10 border border-destructive/30" : "hover:bg-muted",
                i === 0 && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => i > 0 && setSelectedSha(selectedSha === c.sha ? null : c.sha)}
              data-testid={`rollback-commit-${c.sha.slice(0, 7)}`}
            >
              <GitCommit className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{c.commit.message.split("\n")[0]}</span>
              <code className="text-xs text-muted-foreground font-mono">{c.sha.slice(0, 7)}</code>
              <span className="text-xs text-muted-foreground">{timeAgo(c.commit.author.date)}</span>
              {i === 0 && <Badge variant="secondary" className="text-xs">HEAD</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
