import { useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Repo, Branch, Commit, PullRequest, WorkflowRun, TreeItem, DeployedApp, DiffFile } from "./types";
import { getLastVisitedRepo } from "./helpers";

export interface UseDevOpsDataArgs {
  selectedRepo: Repo | null;
  commitPage: number;
  rollbackBranch: string;
  newBranchName: string;
  newBranchFrom: string;
  prTitle: string;
  prBody: string;
  prHead: string;
  prBase: string;
  patchBranch: string;
  patchMessage: string;
  patchFiles: string;
  newRepoName: string;
  newRepoDesc: string;
  newRepoPrivate: boolean;
  newRepoTemplate: string;
  setNewBranchOpen: (v: boolean) => void;
  setNewBranchName: (v: string) => void;
  setNewPrOpen: (v: boolean) => void;
  setPrTitle: (v: string) => void;
  setPrBody: (v: string) => void;
  setPrHead: (v: string) => void;
  setNewRepoOpen: (v: boolean) => void;
  setNewRepoName: (v: string) => void;
  setNewRepoDesc: (v: string) => void;
  setNewRepoPrivate: (v: boolean) => void;
  setNewRepoTemplate: (v: string) => void;
  setPatchOpen: (v: boolean) => void;
  setPatchBranch: (v: string) => void;
  setPatchMessage: (v: string) => void;
  setPatchFiles: (v: string) => void;
  setRollbackConfirmSha: (v: string | null) => void;
}

export function useDevOpsData(args: UseDevOpsDataArgs) {
  const { toast } = useToast();
  const { selectedRepo, commitPage, rollbackBranch } = args;

  const { data: ghUser } = useQuery<{ login: string; avatar_url: string }>({
    queryKey: ["/api/devops/user"],
    staleTime: 300000,
  });

  const { data: repos, isLoading: reposLoading } = useQuery<Repo[]>({
    queryKey: ["/api/devops/repos"],
    staleTime: 30000,
  });

  const { data: deployUrls } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/devops/deploy-urls"],
    staleTime: 60000,
  });

  const { data: hetznerApps } = useQuery<DeployedApp[]>({
    queryKey: ["/api/devops/server/deployments"],
    staleTime: 30000,
  });

  const hetznerAppMap = useMemo(() => {
    const map = new Map<string, DeployedApp>();
    if (hetznerApps) {
      for (const app of hetznerApps) {
        map.set(app.name.toLowerCase(), app);
      }
    }
    return map;
  }, [hetznerApps]);

  useEffect(() => {
    if (!selectedRepo && repos?.length) {
      const lastRepo = getLastVisitedRepo();
      if (lastRepo) {
        const found = repos.find((r) => r.full_name === lastRepo);
        if (found) {
          queryClient.prefetchQuery({
            queryKey: ["/api/devops/repos", found.full_name, "branches"],
            queryFn: async () => {
              const res = await fetch(
                `/api/devops/repos/${found.full_name}/branches`,
                { credentials: "include" },
              );
              const data = await res.json();
              return Array.isArray(data) ? data : [];
            },
            staleTime: 30000,
          });
        }
      }
    }
  }, [repos, selectedRepo]);

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/branches`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo,
    staleTime: 30000,
  });

  const { data: commits, isLoading: commitsLoading } = useQuery<Commit[]>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "commits", commitPage],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/commits?per_page=${commitPage * 20}`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo,
    staleTime: 20000,
  });

  const { data: pullRequests } = useQuery<PullRequest[]>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "pulls"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/pulls?state=all`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo,
    staleTime: 30000,
  });

  const { data: workflowRuns, isLoading: runsLoading } = useQuery<{
    workflow_runs: WorkflowRun[];
    total_count: number;
  }>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "actions/runs"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/actions/runs`,
        { credentials: "include" },
      );
      return res.json();
    },
    enabled: !!selectedRepo,
    staleTime: 15000,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActive = data?.workflow_runs?.some(
        (r: WorkflowRun) => r.status === "in_progress" || r.status === "queued",
      );
      return hasActive ? 8000 : false;
    },
  });

  const { data: fileTree, isLoading: treeLoading } = useQuery<{
    tree: TreeItem[];
    sha: string;
    truncated: boolean;
  }>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "tree"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/tree/${selectedRepo!.default_branch}`,
        { credentials: "include" },
      );
      return res.json();
    },
    enabled: !!selectedRepo,
    staleTime: 30000,
  });

  const hasStagingBranch = useMemo(() => {
    return branches?.some((b: Branch) => b.name === "staging") || false;
  }, [branches]);

  const { data: stagingTree, isLoading: stagingTreeLoading } = useQuery<{
    tree: TreeItem[];
    sha: string;
    truncated: boolean;
  }>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "tree-staging"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/tree/staging`,
        { credentials: "include" },
      );
      return res.json();
    },
    enabled: !!selectedRepo && hasStagingBranch,
    staleTime: 30000,
  });

  const deleteBranchMutation = useMutation({
    mutationFn: async (branchName: string) => {
      return apiRequest("DELETE", `/api/devops/repos/${selectedRepo!.full_name}/branches/${branchName}`);
    },
    onSuccess: (_data: unknown, branchName: string) => {
      toast({ title: "Branche supprimee", description: branchName });
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erreur", description: err.message || "Impossible de supprimer la branche", variant: "destructive" });
    },
  });

  const createRepoMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/devops/repos", {
        name: args.newRepoName,
        description: args.newRepoDesc,
        isPrivate: args.newRepoPrivate,
        templateId: args.newRepoTemplate,
      });
    },
    onSuccess: () => {
      toast({ title: "Projet cree !", description: args.newRepoName });
      args.setNewRepoOpen(false);
      args.setNewRepoName("");
      args.setNewRepoDesc("");
      args.setNewRepoPrivate(false);
      args.setNewRepoTemplate("portfolio");
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erreur", description: err.message || "Impossible de creer le projet", variant: "destructive" });
    },
  });

  const createBranchMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/devops/repos/${selectedRepo!.full_name}/branches`, {
        branchName: args.newBranchName,
        fromBranch: args.newBranchFrom,
      });
    },
    onSuccess: () => {
      toast({ title: "Branche creee", description: `${args.newBranchName} depuis ${args.newBranchFrom}` });
      args.setNewBranchOpen(false);
      args.setNewBranchName("");
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const createPrMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/devops/repos/${selectedRepo!.full_name}/pulls`, {
        title: args.prTitle, body: args.prBody, head: args.prHead, base: args.prBase,
      });
    },
    onSuccess: () => {
      toast({ title: "PR creee" });
      args.setNewPrOpen(false);
      args.setPrTitle("");
      args.setPrBody("");
      args.setPrHead("");
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo?.full_name, "pulls"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const applyPatchMutation = useMutation({
    mutationFn: async () => {
      let files;
      try { files = JSON.parse(args.patchFiles); } catch { throw new Error("JSON invalide pour les fichiers"); }
      return apiRequest("POST", `/api/devops/repos/${selectedRepo!.full_name}/patch`, {
        branch: args.patchBranch, files, commitMessage: args.patchMessage,
      });
    },
    onSuccess: () => {
      toast({ title: "Patch applique" });
      args.setPatchOpen(false);
      args.setPatchBranch("");
      args.setPatchMessage("");
      args.setPatchFiles("[]");
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo?.full_name, "commits"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const mergePrMutation = useMutation({
    mutationFn: async (prNumber: number) => {
      return apiRequest("PUT", `/api/devops/repos/${selectedRepo!.full_name}/pulls/${prNumber}/merge`, { merge_method: "squash" });
    },
    onSuccess: () => {
      toast({ title: "PR mergee" });
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo?.full_name, "pulls"] });
    },
    onError: (err: Error) => {
      toast({ title: "Erreur merge", description: err.message, variant: "destructive" });
    },
  });

  const { data: rollbackCommits, isLoading: rollbackCommitsLoading } = useQuery<Commit[]>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "commits", "rollback", rollbackBranch],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/commits?per_page=50&sha=${rollbackBranch}`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo && !!rollbackBranch,
    staleTime: 15000,
  });

  const rollbackMutation = useMutation({
    mutationFn: async ({ targetSha, createBackup }: { targetSha: string; createBackup: boolean }) => {
      return apiRequest("POST", `/api/devops/repos/${selectedRepo!.full_name}/rollback`, {
        branch: rollbackBranch, targetSha, createBackup,
      });
    },
    onSuccess: async (res: Response) => {
      const data = await res.json();
      args.setRollbackConfirmSha(null);
      toast({
        title: "Rollback effectue",
        description: `${rollbackBranch} → ${data.rolledBackTo?.slice(0, 7)}${data.backupBranch ? ` (backup: ${data.backupBranch})` : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo?.full_name, "commits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"] });
    },
    onError: (err: Error) => {
      toast({ title: "Echec du rollback", description: err.message, variant: "destructive" });
    },
  });

  return {
    ghUser,
    repos, reposLoading,
    deployUrls,
    hetznerApps, hetznerAppMap,
    branches,
    commits, commitsLoading,
    pullRequests,
    workflowRuns, runsLoading,
    fileTree, treeLoading,
    hasStagingBranch,
    stagingTree, stagingTreeLoading,
    deleteBranchMutation,
    createRepoMutation,
    createBranchMutation,
    createPrMutation,
    applyPatchMutation,
    mergePrMutation,
    rollbackCommits, rollbackCommitsLoading,
    rollbackMutation,
  };
}
