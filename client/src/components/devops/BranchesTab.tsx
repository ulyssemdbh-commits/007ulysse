import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { GitBranch, RefreshCw, Plus, Loader2, Trash2 } from "lucide-react";
import { API, type Branch } from "./types";

export default function BranchesTab() {
  const { toast } = useToast();
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("main");

  const { data: branches, isLoading, refetch } = useQuery<Branch[]>({
    queryKey: [API, "branches"],
    queryFn: () => fetch(`${API}/branches`, { credentials: "include" }).then(r => r.json()),
  });

  const createBranch = useMutation({
    mutationFn: () => apiRequest("POST", `${API}/branches`, { branchName: newBranch, fromBranch }),
    onSuccess: () => {
      toast({ title: "Branche créée" });
      setNewBranch("");
      refetch();
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteBranch = useMutation({
    mutationFn: (name: string) => apiRequest("DELETE", `${API}/branches/${name}`),
    onSuccess: () => { toast({ title: "Branche supprimée" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nouvelle branche..."
          value={newBranch}
          onChange={e => setNewBranch(e.target.value)}
          className="flex-1"
          data-testid="input-new-branch"
        />
        <Input
          placeholder="depuis"
          value={fromBranch}
          onChange={e => setFromBranch(e.target.value)}
          className="w-32"
        />
        <Button
          size="sm"
          onClick={() => createBranch.mutate()}
          disabled={!newBranch || createBranch.isPending}
          data-testid="button-create-branch"
        >
          {createBranch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </Button>
        <Button size="icon" variant="ghost" onClick={() => refetch()} data-testid="button-refresh-branches">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {branches?.map(b => (
            <Card key={b.name} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-green-500" />
                  <span className="font-mono text-sm">{b.name}</span>
                  {b.protected && <Badge variant="secondary" className="text-xs">protégée</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-muted-foreground">{b.commit.sha.slice(0, 7)}</code>
                  {!b.protected && b.name !== "main" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => deleteBranch.mutate(b.name)}
                      data-testid={`button-delete-branch-${b.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
