import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useTabListener } from "@/hooks/useAppNavigation";
import { queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  GitBranch, GitPullRequest, GitCommit, FolderGit2,
  ExternalLink, FileCode, ArrowLeft, Home,
  Activity, Globe, Server, RotateCcw,
  Command, ArrowUpDown, Crown, FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo, WorkflowRun, TreeItem } from "./devops/types";
import { langColor, useDebounce, getLastVisitedRepo, setLastVisitedRepo, getLastActiveTab, setLastActiveTab } from "./devops/helpers";
import { DevOpsChatBox } from "./devops/DevOpsChatBox";
import { HetznerServerTab } from "./devops/HetznerServerTab";
import { useDgm } from "./devops/useDgm";
import { PreviewTab } from "./devops/PreviewTab";
import { CicdTab } from "./devops/CicdTab";
import { RollbackTab } from "./devops/RollbackTab";
import { LibraryTab } from "./devops/LibraryTab";
import { LibraryTestTab } from "./devops/LibraryTestTab";
import { NewBranchDialog, NewPrDialog, PatchDialog } from "./devops/GitDialogs";
import { ProjectsTab, BranchesTab, CommitsTab, PrsTab } from "./devops/RepoTabs";
import { RepoDeployBar } from "./devops/RepoDeployBar";
import { RepoListView } from "./devops/RepoListView";
import { DgmTab } from "./devops/DgmTab";
import type { RunLogsState, DiffFile } from "./devops/types";
import { getErrMsg } from "./devops/types";
import { useDevOpsData } from "./devops/useDevOpsData";
import { useRepoFiles } from "./devops/useRepoFiles";
import { useStagingFiles } from "./devops/useStagingFiles";
import { useBrowserPreview } from "./devops/useBrowserPreview";

function QuickRepoSwitcher({
  repos,
  currentRepo,
  onSwitch,
}: {
  repos: Repo[];
  currentRepo: Repo;
  onSwitch: (repo: Repo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search)
      return repos.filter((r) => r.id !== currentRepo.id).slice(0, 8);
    const q = search.toLowerCase();
    return repos
      .filter(
        (r) =>
          r.id !== currentRepo.id &&
          (r.name.toLowerCase().includes(q) ||
            r.full_name.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [repos, currentRepo, search]);

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 gap-1 text-xs text-muted-foreground"
        onClick={() => setOpen(!open)}
        data-testid="button-switch-repo"
      >
        <ArrowUpDown className="w-3 h-3" /> Changer
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-50 w-72 rounded-lg border border-border bg-background shadow-xl p-2"
            data-testid="repo-switcher-dropdown"
          >
            <Input
              placeholder="Rechercher un repo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs mb-1.5"
              autoFocus
              data-testid="input-switch-repo-search"
            />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted flex items-center gap-2 transition-colors"
                  onClick={() => {
                    onSwitch(r);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-testid={`switch-to-${r.name}`}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      langColor(r.language),
                    )}
                  />
                  <span className="text-xs font-medium truncate flex-1">
                    {r.name}
                  </span>
                  <Badge
                    variant={r.private ? "secondary" : "outline"}
                    className="text-[9px] h-4 shrink-0"
                  >
                    {r.private ? "P" : "O"}
                  </Badge>
                </button>
              ))}
              {!filtered.length && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Aucun autre repo
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function DevOps() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const debouncedSearch = useDebounce(searchFilter, 150);
  const [activeTab, setActiveTab] = useState(() => getLastActiveTab());
  useTabListener(setActiveTab, ["projects", "branches", "commits", "prs", "cicd", "library", "library-test", "preview", "editor", "server", "rollback"]);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchFrom, setNewBranchFrom] = useState("main");
  const [newPrOpen, setNewPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prHead, setPrHead] = useState("");
  const [prBase, setPrBase] = useState("main");
  const [patchOpen, setPatchOpen] = useState(false);
  const [patchBranch, setPatchBranch] = useState("");
  const [patchMessage, setPatchMessage] = useState("");
  const [patchFiles, setPatchFiles] = useState<string>("[]");
  const [newRepoOpen, setNewRepoOpen] = useState(false);
  const [urlsOpen, setUrlsOpen] = useState(false);
  const [urlsEdit, setUrlsEdit] = useState<string[]>([]);
  const [urlsNewInput, setUrlsNewInput] = useState("");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [newRepoTemplate, setNewRepoTemplate] = useState("portfolio");
  const [editDeployRepo, setEditDeployRepo] = useState<string | null>(null);
  const [editDeployInput, setEditDeployInput] = useState("");
  const [hetznerDeploying, setHetznerDeploying] = useState(false);
  const [hetznerDeployLog, setHetznerDeployLog] = useState<string | null>(null);
  const [commitPage, setCommitPage] = useState(1);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [rollbackBranch, setRollbackBranch] = useState("");
  const [rollbackConfirmSha, setRollbackConfirmSha] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    dgmActive, dgmSessionId, dgmObjective, dgmTasks,
    dgmLoading, dgmPanelOpen, dgmAllSessions,
    setDgmObjective, setDgmPanelOpen, toggleDgm,
  } = useDgm(selectedRepo?.full_name || null);

  useEffect(() => {
    setLastActiveTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (selectedRepo) return;
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape") {
        if (selectedRepo) {
          setSelectedRepo(null);
          setCurrentPath("");
          setSelectedFile(null);
          setPreviewHtml("");
          setCommitPage(1);
          fileContentCache.current.clear();
        }
      }
      if (selectedRepo && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tabMap: Record<string, string> = {
          "1": "branches",
          "2": "commits",
          "3": "prs",
          "4": "cicd",
          "5": "library",
          "6": "preview",
          "7": "server",
          "8": "rollback",
        };
        if (
          tabMap[e.key] &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          e.preventDefault();
          setActiveTab(tabMap[e.key]);
          if (tabMap[e.key] === "preview" && !previewHtml && !previewLoading) {
            buildPreview();
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRepo]);

  const {
    ghUser, repos, reposLoading, deployUrls, hetznerApps, hetznerAppMap,
    branches, commits, commitsLoading, pullRequests,
    workflowRuns, runsLoading, fileTree, treeLoading,
    hasStagingBranch, stagingTree, stagingTreeLoading,
    deleteBranchMutation, createRepoMutation, createBranchMutation,
    createPrMutation, applyPatchMutation, mergePrMutation,
    rollbackCommits, rollbackCommitsLoading, rollbackMutation,
  } = useDevOpsData({
    selectedRepo, commitPage, rollbackBranch,
    newBranchName, newBranchFrom, prTitle, prBody, prHead, prBase,
    patchBranch, patchMessage, patchFiles,
    newRepoName, newRepoDesc, newRepoPrivate, newRepoTemplate,
    setNewBranchOpen, setNewBranchName, setNewPrOpen, setPrTitle, setPrBody, setPrHead,
    setNewRepoOpen, setNewRepoName, setNewRepoDesc, setNewRepoPrivate, setNewRepoTemplate,
    setPatchOpen, setPatchBranch, setPatchMessage, setPatchFiles, setRollbackConfirmSha,
  });

  const staging = useStagingFiles(selectedRepo);
  const {
    stagingFile, setStagingFile,
    stagingPath, setStagingPath,
    stagingSearch, setStagingSearch,
    stagingFileLoading,
    stagingEditMode, setStagingEditMode,
    stagingEditContent, setStagingEditContent,
    stagingEditMsg, setStagingEditMsg,
    stagingSaving,
    stagingModified, setStagingModified,
    stagingDeploying,
    stagingDeployStatus,
    stagingOriginalRef, stagingEditRef,
    stagingContentCache,
    loadStagingFile,
    saveStagingFile,
    deployStagingToProd,
    resetStagingState,
  } = staging;

  const repoFiles = useRepoFiles(selectedRepo);
  const {
    selectedFile, setSelectedFile,
    fileLoading,
    currentPath, setCurrentPath,
    editMode, setEditMode,
    editCommitMsg, setEditCommitMsg,
    isFileModified, setIsFileModified,
    fileSearchQuery, setFileSearchQuery,
    fileContentCache,
    loadFileContent,
    createNewFile,
    getFileIcon, getSyntaxLang,
    resetFileState,
    showNewFileDialog, setShowNewFileDialog,
    newFileName, setNewFileName,
    newFileContent, setNewFileContent,
    creatingFile,
  } = repoFiles;

  const [chatExternalMessage, setChatExternalMessage] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<{
    sha: string;
    message: string;
    files: DiffFile[];
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const browser = useBrowserPreview(selectedRepo, deployUrls, fileTree);
  const {
    previewHtml, setPreviewHtml,
    previewLoading,
    previewIframeRef, browserIframeRef,
    browserUrl, setBrowserUrl,
    browserInputUrl, setBrowserInputUrl,
    browserHistory, setBrowserHistory,
    browserHistoryIndex, setBrowserHistoryIndex,
    browserLoading, setBrowserLoading,
    browserViewport, setBrowserViewport,
    browserPageInfo,
    browserSiteStatus,
    buildPreview,
    resetBrowserState,
  } = browser;

  const selectRepo = useCallback((repo: Repo) => {
    setSelectedRepo(repo);
    setActiveTab(getLastActiveTab());
    setCommitPage(1);
    setRollbackBranch(repo.default_branch);
    setRollbackConfirmSha(null);
    setLastVisitedRepo(repo.full_name);
    resetFileState();
    resetStagingState();
    resetBrowserState();
  }, [resetFileState, resetStagingState, resetBrowserState]);

  const switchRepo = useCallback((repo: Repo) => {
    setCommitDiff(null);
    setCommitPage(1);
    setSelectedRepo(repo);
    setLastVisitedRepo(repo.full_name);
    resetFileState();
    resetStagingState();
    resetBrowserState();
  }, [resetFileState, resetStagingState, resetBrowserState]);

  const prefetchRepoData = useCallback(
    (repoFullName: string, defaultBranch: string) => {
      queryClient.prefetchQuery({
        queryKey: ["/api/devops/repos", repoFullName, "branches"],
        queryFn: async () => {
          const res = await fetch(
            `/api/devops/repos/${repoFullName}/branches`,
            { credentials: "include" },
          );
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        },
        staleTime: 30000,
      });
      queryClient.prefetchQuery({
        queryKey: ["/api/devops/repos", repoFullName, "commits", 1],
        queryFn: async () => {
          const res = await fetch(
            `/api/devops/repos/${repoFullName}/commits?per_page=20`,
            { credentials: "include" },
          );
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        },
        staleTime: 20000,
      });
      queryClient.prefetchQuery({
        queryKey: ["/api/devops/repos", repoFullName, "tree"],
        queryFn: async () => {
          const res = await fetch(
            `/api/devops/repos/${repoFullName}/tree/${defaultBranch}`,
            { credentials: "include" },
          );
          return res.json();
        },
        staleTime: 30000,
      });
    },
    [],
  );

  const deployToHetzner = useCallback(async () => {
    setHetznerDeploying(true);
    setHetznerDeployLog("Deploiement ulysse sur Hetzner...");
    try {
      const res = await fetch("/api/devops/server/deploy-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ appName: "ulysse" }),
      });
      const data = await res.json();
      if (data.success) {
        setHetznerDeployLog(data.output || "Deploiement reussi");
        toast({
          title: "Deploiement Hetzner reussi",
          description: "ulyssepro.org mis a jour",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/devops/server/deployments"] });
      } else {
        setHetznerDeployLog(data.error || data.output || "Erreur inconnue");
        toast({
          title: "Erreur de deploiement",
          description: data.error || "Echec",
          variant: "destructive",
        });
      }
    } catch (err: unknown) {
      setHetznerDeployLog(getErrMsg(err));
      toast({
        title: "Erreur",
        description: getErrMsg(err),
        variant: "destructive",
      });
    }
    setHetznerDeploying(false);
  }, [toast]);

  const [runLogs, setRunLogs] = useState<RunLogsState | null>(null);
  const [runLogsLoading, setRunLogsLoading] = useState(false);


  const loadCommitDiff = useCallback(
    async (sha: string) => {
      if (!selectedRepo) return;
      setDiffLoading(true);
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/commits/${sha}`,
          { credentials: "include" },
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setCommitDiff({
          sha: data.sha || sha,
          message: data.commit?.message || "",
          files: data.files || [],
        });
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de charger le diff",
          variant: "destructive",
        });
      }
      setDiffLoading(false);
    },
    [selectedRepo, toast],
  );

  const loadRunJobs = useCallback(
    async (runId: number) => {
      if (!selectedRepo) return;
      setRunLogsLoading(true);
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/actions/runs/${runId}/jobs`,
          { credentials: "include" },
        );
        const data = await res.json();
        setRunLogs({
          runId,
          jobs: data.jobs || [],
          expandedJob: null,
          logs: {},
          logsLoading: {},
        });
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de charger les jobs",
          variant: "destructive",
        });
      }
      setRunLogsLoading(false);
    },
    [selectedRepo, toast],
  );

  const loadJobLogs = useCallback(
    async (jobId: number) => {
      if (!selectedRepo || !runLogs) return;
      setRunLogs((prev) =>
        prev
          ? { ...prev, logsLoading: { ...prev.logsLoading, [jobId]: true } }
          : prev,
      );
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/actions/jobs/${jobId}/logs`,
          { credentials: "include" },
        );
        const data = await res.json();
        setRunLogs((prev) =>
          prev
            ? {
                ...prev,
                expandedJob: prev.expandedJob === jobId ? null : jobId,
                logs: {
                  ...prev.logs,
                  [jobId]: data.logs || "Pas de logs disponibles",
                },
                logsLoading: { ...prev.logsLoading, [jobId]: false },
              }
            : prev,
        );
      } catch {
        setRunLogs((prev) =>
          prev
            ? {
                ...prev,
                expandedJob: prev.expandedJob === jobId ? null : jobId,
                logs: {
                  ...prev.logs,
                  [jobId]: "Erreur: impossible de recuperer les logs",
                },
                logsLoading: { ...prev.logsLoading, [jobId]: false },
              }
            : prev,
        );
      }
    },
    [selectedRepo, runLogs],
  );

  const filteredRepos = useMemo(() => {
    return repos?.filter(
      (r) =>
        r.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        r.description?.toLowerCase().includes(debouncedSearch.toLowerCase()),
    );
  }, [repos, debouncedSearch]);

  const filteredTreeItems = useMemo(() => {
    if (!fileTree?.tree || !fileSearchQuery.trim()) return null;
    const q = fileSearchQuery.toLowerCase();
    return fileTree.tree
      .filter((f) => f.type === "blob" && f.path.toLowerCase().includes(q))
      .slice(0, 50);
  }, [fileTree, fileSearchQuery]);

  const tabBadges = useMemo(() => {
    const openPrs =
      pullRequests?.filter((pr) => pr.state === "open").length || 0;
    const activeRuns =
      workflowRuns?.workflow_runs?.filter(
        (r: WorkflowRun) => r.status === "in_progress" || r.status === "queued",
      ).length || 0;
    const failedRuns =
      workflowRuns?.workflow_runs
        ?.filter((r: WorkflowRun) => r.conclusion === "failure")
        .slice(0, 5).length || 0;
    return {
      branches: branches?.length || 0,
      commits: commits?.length || 0,
      prs: openPrs,
      cicd: activeRuns > 0 ? activeRuns : failedRuns > 0 ? failedRuns : 0,
      cicdColor:
        activeRuns > 0 ? "bg-blue-500" : failedRuns > 0 ? "bg-red-500" : "",
      library: fileTree?.tree?.filter((f) => f.type === "blob").length || 0,
    };
  }, [branches, commits, pullRequests, workflowRuns, fileTree]);

  if (selectedRepo) {
    return (
      <div
        className="min-h-screen bg-background p-3 md:p-4 max-w-6xl mx-auto"
        data-testid="devops-repo-detail"
      >
        <div className="flex items-center gap-2 mb-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/")}
            data-testid="button-home-dashboard"
          >
            <Home className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setSelectedRepo(null);
              setCurrentPath("");
              setSelectedFile(null);
              setPreviewHtml("");
              setCommitPage(1);
              fileContentCache.current.clear();
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <FolderGit2 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">{selectedRepo.name}</h1>
          <span className="text-xs text-muted-foreground">
            {selectedRepo.full_name.split("/")[0]}
          </span>
          <Badge
            variant={selectedRepo.private ? "secondary" : "outline"}
            className="text-[10px] h-5"
          >
            {selectedRepo.private ? "Prive" : "Public"}
          </Badge>
          {repos && repos.length > 1 && (
            <QuickRepoSwitcher
              repos={repos}
              currentRepo={selectedRepo}
              onSwitch={switchRepo}
            />
          )}
          <a
            href={selectedRepo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1"
          >
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </a>
          <div className="ml-auto">
            <RepoDeployBar
              selectedRepo={selectedRepo}
              deployUrls={deployUrls}
              hetznerAppMap={hetznerAppMap}
              hetznerDeploying={hetznerDeploying}
              setHetznerDeploying={setHetznerDeploying}
              hetznerDeployLog={hetznerDeployLog}
              setHetznerDeployLog={setHetznerDeployLog}
              deployToHetzner={deployToHetzner}
              urlsOpen={urlsOpen}
              setUrlsOpen={setUrlsOpen}
              urlsEdit={urlsEdit}
              setUrlsEdit={setUrlsEdit}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <NewBranchDialog
            open={newBranchOpen} onOpenChange={setNewBranchOpen}
            branchName={newBranchName} setBranchName={setNewBranchName}
            branchFrom={newBranchFrom} setBranchFrom={setNewBranchFrom}
            createMutation={createBranchMutation}
          />
          <NewPrDialog
            open={newPrOpen} onOpenChange={setNewPrOpen}
            prTitle={prTitle} setPrTitle={setPrTitle}
            prBody={prBody} setPrBody={setPrBody}
            prHead={prHead} setPrHead={setPrHead}
            prBase={prBase} setPrBase={setPrBase}
            branches={branches}
            createMutation={createPrMutation}
          />
          <PatchDialog
            open={patchOpen} onOpenChange={setPatchOpen}
            branch={patchBranch} setBranch={setPatchBranch}
            message={patchMessage} setMessage={setPatchMessage}
            files={patchFiles} setFiles={setPatchFiles}
            applyMutation={applyPatchMutation}
          />
          <div className="ml-auto text-[10px] text-muted-foreground/40 hidden md:flex items-center gap-1">
            <Command className="w-3 h-3" /> 1-8 onglets · Esc retour
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9" data-testid="tabs-repo-detail">
            <TabsTrigger value="projects" className="text-xs gap-1 px-2.5">
              <FolderGit2 className="w-3.5 h-3.5" /> Projets
            </TabsTrigger>
            <TabsTrigger value="branches" className="text-xs gap-1 px-2.5">
              <GitBranch className="w-3.5 h-3.5" /> Branches
              {tabBadges.branches > 0 && (
                <span className="ml-0.5 text-[10px] text-muted-foreground">
                  {tabBadges.branches}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="commits" className="text-xs gap-1 px-2.5">
              <GitCommit className="w-3.5 h-3.5" /> Commits
            </TabsTrigger>
            <TabsTrigger value="prs" className="text-xs gap-1 px-2.5">
              <GitPullRequest className="w-3.5 h-3.5" /> PRs
              {tabBadges.prs > 0 && (
                <span className="ml-0.5 bg-green-500 text-white text-[9px] rounded-full w-4 h-4 inline-flex items-center justify-center">
                  {tabBadges.prs}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cicd" className="text-xs gap-1 px-2.5">
              <Activity className="w-3.5 h-3.5" /> CI/CD
              {tabBadges.cicd > 0 && (
                <span
                  className={cn(
                    "ml-0.5 text-white text-[9px] rounded-full w-4 h-4 inline-flex items-center justify-center",
                    tabBadges.cicdColor,
                  )}
                >
                  {tabBadges.cicd}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="library" className="text-xs gap-1 px-2.5">
              <FileCode className="w-3.5 h-3.5" /> Librairie
            </TabsTrigger>
            <TabsTrigger
              value="library-test"
              className="text-xs gap-1 px-2.5"
            >
              <FlaskConical className="w-3.5 h-3.5" /> Librairie-Test
              {hasStagingBranch && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />}
            </TabsTrigger>
            <TabsTrigger
              value="preview"
              className="text-xs gap-1 px-2.5"
              onClick={() => {
                if (!previewHtml && !previewLoading) buildPreview();
              }}
            >
              <Globe className="w-3.5 h-3.5" /> Apercu
            </TabsTrigger>
            <TabsTrigger value="server" className="text-xs gap-1 px-2.5">
              <Server className="w-3.5 h-3.5" /> Serveur
            </TabsTrigger>
            <TabsTrigger
              value="rollback"
              className="text-xs gap-1 px-2.5"
              onClick={() => {
                if (!rollbackBranch && selectedRepo) {
                  setRollbackBranch(selectedRepo.default_branch);
                }
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Rollback
            </TabsTrigger>
            <TabsTrigger
              value="dgm"
              className={cn("text-xs gap-1 px-2.5", dgmActive && "text-amber-600")}
            >
              <Crown className={cn("w-3.5 h-3.5", dgmActive ? "text-amber-500" : "")} /> DGM
              {dgmActive && <span className="ml-0.5 w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="mt-3">
            <ProjectsTab repos={repos} selectedRepo={selectedRepo} hetznerAppMap={hetznerAppMap} deployUrls={deployUrls} selectRepo={selectRepo} />
          </TabsContent>

          <TabsContent value="branches" className="mt-3">
            <BranchesTab branches={branches} selectedRepo={selectedRepo} deleteBranchMutation={deleteBranchMutation} />
          </TabsContent>

          <TabsContent value="commits" className="mt-3">
            <CommitsTab
              commits={commits} commitsLoading={commitsLoading}
              commitPage={commitPage} setCommitPage={setCommitPage}
              commitDiff={commitDiff} setCommitDiff={setCommitDiff}
              diffLoading={diffLoading} loadCommitDiff={loadCommitDiff}
            />
          </TabsContent>

          <TabsContent value="prs" className="mt-3">
            <PrsTab pullRequests={pullRequests} mergePrMutation={mergePrMutation} />
          </TabsContent>

          <TabsContent value="cicd" className="mt-3">
            <CicdTab
              runLogs={runLogs}
              setRunLogs={setRunLogs}
              runsLoading={runsLoading}
              runLogsLoading={runLogsLoading}
              workflowRuns={workflowRuns}
              selectedRepo={selectedRepo}
              loadRunJobs={loadRunJobs}
              loadJobLogs={loadJobLogs}
            />
          </TabsContent>

          <TabsContent value="library" className="mt-3">
            <LibraryTab
              selectedFile={selectedFile}
              setSelectedFile={setSelectedFile}
              editMode={editMode}
              setEditMode={setEditMode}
              editCommitMsg={editCommitMsg}
              setEditCommitMsg={setEditCommitMsg}
              isFileModified={isFileModified}
              setIsFileModified={setIsFileModified}
              currentPath={currentPath}
              setCurrentPath={setCurrentPath}
              fileSearchQuery={fileSearchQuery}
              setFileSearchQuery={setFileSearchQuery}
              fileTree={fileTree}
              treeLoading={treeLoading}
              fileLoading={fileLoading}
              filteredTreeItems={filteredTreeItems}
              selectedRepo={selectedRepo}
              loadFileContent={loadFileContent}
              getSyntaxLang={getSyntaxLang}
              getFileIcon={getFileIcon}
              createNewFile={createNewFile}
              showNewFileDialog={showNewFileDialog}
              setShowNewFileDialog={setShowNewFileDialog}
              newFileName={newFileName}
              setNewFileName={setNewFileName}
              newFileContent={newFileContent}
              setNewFileContent={setNewFileContent}
              creatingFile={creatingFile}
            />
          </TabsContent>

          <TabsContent value="library-test" className="mt-3">
            <LibraryTestTab
              hasStagingBranch={hasStagingBranch}
              stagingFile={stagingFile}
              setStagingFile={setStagingFile}
              stagingPath={stagingPath}
              setStagingPath={setStagingPath}
              stagingSearch={stagingSearch}
              setStagingSearch={setStagingSearch}
              stagingFileLoading={stagingFileLoading}
              stagingEditMode={stagingEditMode}
              setStagingEditMode={setStagingEditMode}
              stagingEditContent={stagingEditContent}
              setStagingEditContent={setStagingEditContent}
              stagingEditMsg={stagingEditMsg}
              setStagingEditMsg={setStagingEditMsg}
              stagingSaving={stagingSaving}
              stagingModified={stagingModified}
              setStagingModified={setStagingModified}
              stagingDeploying={stagingDeploying}
              stagingDeployStatus={stagingDeployStatus}
              stagingOriginalRef={stagingOriginalRef}
              stagingEditRef={stagingEditRef}
              stagingTree={stagingTree}
              stagingTreeLoading={stagingTreeLoading}
              loadStagingFile={loadStagingFile}
              saveStagingFile={saveStagingFile}
              deployStagingToProd={deployStagingToProd}
              getSyntaxLang={getSyntaxLang}
            />
          </TabsContent>

          <TabsContent value="preview" className="mt-3">
            <PreviewTab
              selectedRepo={selectedRepo}
              deployUrls={deployUrls}
              previewHtml={previewHtml}
              previewLoading={previewLoading}
              buildPreview={buildPreview}
              browserUrl={browserUrl}
              browserInputUrl={browserInputUrl}
              browserHistory={browserHistory}
              browserHistoryIndex={browserHistoryIndex}
              browserLoading={browserLoading}
              browserViewport={browserViewport}
              browserPageInfo={browserPageInfo}
              browserSiteStatus={browserSiteStatus}
              browserIframeRef={browserIframeRef}
              previewIframeRef={previewIframeRef}
              setBrowserUrl={setBrowserUrl}
              setBrowserInputUrl={setBrowserInputUrl}
              setBrowserHistory={setBrowserHistory}
              setBrowserHistoryIndex={setBrowserHistoryIndex}
              setBrowserLoading={setBrowserLoading}
              setBrowserViewport={setBrowserViewport}
              setChatExternalMessage={setChatExternalMessage}
              setPreviewHtml={setPreviewHtml}
            />
          </TabsContent>

          <TabsContent value="server" className="mt-3">
            <HetznerServerTab />
          </TabsContent>

          <TabsContent value="rollback" className="mt-3">
            <RollbackTab
              rollbackBranch={rollbackBranch}
              setRollbackBranch={setRollbackBranch}
              rollbackConfirmSha={rollbackConfirmSha}
              setRollbackConfirmSha={setRollbackConfirmSha}
              rollbackCommits={rollbackCommits}
              rollbackCommitsLoading={rollbackCommitsLoading}
              rollbackMutation={rollbackMutation}
              branches={branches}
              selectedRepo={selectedRepo}
            />
          </TabsContent>

          <TabsContent value="dgm" className="mt-3">
            <DgmTab
              selectedRepo={selectedRepo}
              dgmActive={dgmActive}
              dgmObjective={dgmObjective}
              setDgmObjective={setDgmObjective}
              dgmTasks={dgmTasks}
              dgmLoading={dgmLoading}
              toggleDgm={toggleDgm}
            />
          </TabsContent>
        </Tabs>
        <DevOpsChatBox
          repoContext={selectedRepo?.full_name}
          availableRepos={repos}
          externalMessage={chatExternalMessage}
          onExternalMessageConsumed={() => setChatExternalMessage(null)}
          activeTab={activeTab}
          previewUrl={browserUrl}
          previewHtml={previewHtml}
          dgmActive={dgmActive}
          dgmSessionId={dgmSessionId || undefined}
          dgmObjective={dgmObjective || undefined}
          dgmRepoContext={selectedRepo?.full_name || undefined}
          onActionComplete={() => {
            fileContentCache.current.clear();
            if (selectedFile) {
              loadFileContent(selectedFile.path);
            }
            if (activeTab === "preview") {
              setPreviewHtml("");
              buildPreview();
            }
          }}
        />
      </div>
    );
  }

  return (
    <RepoListView
      ghUser={ghUser}
      repos={repos}
      reposLoading={reposLoading}
      filteredRepos={filteredRepos}
      deployUrls={deployUrls}
      hetznerAppMap={hetznerAppMap}
      searchFilter={searchFilter}
      setSearchFilter={setSearchFilter}
      selectRepo={selectRepo}
      prefetchRepoData={prefetchRepoData}
      newRepoOpen={newRepoOpen}
      setNewRepoOpen={setNewRepoOpen}
      newRepoName={newRepoName}
      setNewRepoName={setNewRepoName}
      newRepoDesc={newRepoDesc}
      setNewRepoDesc={setNewRepoDesc}
      newRepoPrivate={newRepoPrivate}
      setNewRepoPrivate={setNewRepoPrivate}
      newRepoTemplate={newRepoTemplate}
      setNewRepoTemplate={setNewRepoTemplate}
      createRepoMutation={createRepoMutation}
      editDeployRepo={editDeployRepo}
      setEditDeployRepo={setEditDeployRepo}
      editDeployInput={editDeployInput}
      setEditDeployInput={setEditDeployInput}
      selectedRepo={selectedRepo}
      dgmActive={dgmActive}
      dgmSessionId={dgmSessionId}
      dgmObjective={dgmObjective}
      searchInputRef={searchInputRef}
    />
  );
}

