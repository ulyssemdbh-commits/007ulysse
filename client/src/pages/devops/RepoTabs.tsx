import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch, GitPullRequest, GitCommit, FolderGit2,
  ExternalLink, Star, Eye, Clock, Loader2,
  Activity, Code, Globe, Server, Rocket, ArrowLeft, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo, Branch, Commit, PullRequest, DeployedApp, DiffFile } from "./types";
import { timeAgo, langColor } from "./helpers";

interface ProjectsTabProps {
  repos: Repo[] | undefined;
  selectedRepo: Repo | null;
  hetznerAppMap: Map<string, DeployedApp>;
  deployUrls: Record<string, string[]> | undefined;
  selectRepo: (r: Repo) => void;
}

export function ProjectsTab({ repos, selectedRepo, hetznerAppMap, deployUrls, selectRepo }: ProjectsTabProps) {
  if (!repos?.length) return <p className="text-muted-foreground text-sm py-4">Chargement des projets...</p>;

  const projectRepos = repos.map(repo => {
    const hApp = hetznerAppMap.get(repo.name.toLowerCase());
    const allUrls = deployUrls?.[repo.full_name] || [];
    const ulysseProUrls = allUrls.filter(u => u.includes(".ulyssepro.org"));
    const hetznerDomain = hApp?.domain;
    if (hetznerDomain && !ulysseProUrls.some(u => u.includes(hetznerDomain))) {
      ulysseProUrls.unshift(`https://${hetznerDomain}`);
    }
    const liveUrls = [...new Set(ulysseProUrls)];
    const isLive = hApp && (hApp.status === "online" || hApp.status === "static" || hApp.status === "deployed");
    const isCurrentRepo = selectedRepo?.full_name === repo.full_name;
    return { repo, hApp, liveUrls, isLive, isCurrentRepo, allUrls };
  });

  const deployed = projectRepos.filter(p => p.hApp || p.liveUrls.length > 0);
  const active = projectRepos.filter(p => !p.hApp && p.liveUrls.length === 0 && !p.repo.private);
  const privateRepos = projectRepos.filter(p => !p.hApp && p.liveUrls.length === 0 && p.repo.private);

  const renderProjectCard = (p: typeof projectRepos[0]) => {
    const { repo, hApp, liveUrls, isLive, isCurrentRepo } = p;
    const daysSinceUpdate = Math.floor((Date.now() - new Date(repo.pushed_at || repo.updated_at).getTime()) / 86400000);
    const activityLevel = daysSinceUpdate < 1 ? "Tres actif" : daysSinceUpdate < 7 ? "Actif" : daysSinceUpdate < 30 ? "Modere" : "Inactif";
    const activityColor = daysSinceUpdate < 1 ? "text-green-500" : daysSinceUpdate < 7 ? "text-blue-500" : daysSinceUpdate < 30 ? "text-yellow-500" : "text-gray-400";

    return (
      <Card
        key={repo.full_name}
        className={cn("p-3 cursor-pointer hover:shadow-md transition-all border", isCurrentRepo && "ring-2 ring-primary/50 border-primary/30")}
        onClick={() => selectRepo(repo)}
        data-testid={`project-card-${repo.name}`}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <FolderGit2 className={cn("w-4 h-4 shrink-0", isLive ? "text-green-500" : "text-muted-foreground")} />
            <div className="min-w-0">
              <h4 className="text-sm font-semibold truncate">{repo.name}</h4>
              {repo.description && <p className="text-[11px] text-muted-foreground truncate">{repo.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isLive && (
              <Badge className="text-[9px] h-4 bg-green-500/10 text-green-600 border-green-500/30">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" />
                En ligne
              </Badge>
            )}
            {repo.private && <Badge variant="outline" className="text-[9px] h-4">Prive</Badge>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
          <div className="flex items-center gap-1.5 text-[11px]">
            <div className={cn("w-2 h-2 rounded-full", langColor(repo.language))} />
            <span className="text-muted-foreground">{repo.language || "N/A"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Activity className={cn("w-3 h-3", activityColor)} />
            <span className={activityColor}>{activityLevel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{timeAgo(repo.pushed_at || repo.updated_at)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Star className="w-3 h-3" />
            <span>{repo.stargazers_count}</span>
          </div>
        </div>
        {hApp && (
          <div className="mt-2 pt-2 border-t flex items-center gap-2 text-[11px]">
            <Server className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Hetzner</span>
            <Badge variant="outline" className="text-[8px] h-3.5 px-1">{hApp.type === "static" ? "HTML" : "Node"}</Badge>
            <span className="text-muted-foreground">Port {hApp.port}</span>
            {hApp.memory && <span className="text-muted-foreground ml-auto">{hApp.memory}</span>}
          </div>
        )}
        {liveUrls.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {liveUrls.slice(0, 2).map((url, i) => {
              let hostname = "";
              try { hostname = new URL(url).hostname; } catch { hostname = url; }
              return (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-primary hover:underline flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()} data-testid={`project-url-${repo.name}-${i}`}>
                  <Globe className="w-2.5 h-2.5" />{hostname}
                </a>
              );
            })}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-4" data-testid="projects-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">Projets DevOps</h3>
          <Badge variant="outline" className="text-[10px]">{repos.length} repos</Badge>
          {deployed.length > 0 && (
            <Badge className="text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
              {deployed.length} deploye{deployed.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>
      {deployed.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Rocket className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs font-medium">Deployes ({deployed.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{deployed.map(renderProjectCard)}</div>
        </div>
      )}
      {active.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Code className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-medium">En developpement ({active.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{active.map(renderProjectCard)}</div>
        </div>
      )}
      {privateRepos.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Prives ({privateRepos.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{privateRepos.map(renderProjectCard)}</div>
        </div>
      )}
    </div>
  );
}

interface BranchesTabProps {
  branches: Branch[] | undefined;
  selectedRepo: Repo;
  deleteBranchMutation: { mutate: (name: string) => void; isPending: boolean };
}

export function BranchesTab({ branches, selectedRepo, deleteBranchMutation }: BranchesTabProps) {
  return (
    <div className="space-y-1.5">
      {branches?.map((b) => (
        <Card key={b.name} className="p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-mono text-sm" data-testid={`text-branch-${b.name}`}>{b.name}</span>
              {b.protected && <Badge variant="secondary" className="text-[10px] h-4">protegee</Badge>}
              {b.name === selectedRepo.default_branch && <Badge variant="outline" className="text-[10px] h-4">default</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <code className="text-[11px] text-muted-foreground">{b.commit.sha.slice(0, 7)}</code>
              {b.name !== selectedRepo.default_branch && !b.protected && (
                <Button
                  size="sm" variant="ghost"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => { if (confirm(`Supprimer ${b.name} ?`)) deleteBranchMutation.mutate(b.name); }}
                  disabled={deleteBranchMutation.isPending}
                  data-testid={`button-delete-branch-${b.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
      {!branches?.length && <p className="text-muted-foreground text-sm">Aucune branche</p>}
    </div>
  );
}

interface CommitsTabProps {
  commits: Commit[] | undefined;
  commitsLoading: boolean;
  commitPage: number;
  setCommitPage: (fn: (p: number) => number) => void;
  commitDiff: { sha: string; message: string; files: DiffFile[] } | null;
  setCommitDiff: (v: null) => void;
  diffLoading: boolean;
  loadCommitDiff: (sha: string) => void;
}

export function CommitsTab({ commits, commitsLoading, commitPage, setCommitPage, commitDiff, setCommitDiff, diffLoading, loadCommitDiff }: CommitsTabProps) {
  if (commitDiff) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setCommitDiff(null)} data-testid="button-back-commits">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
          </Button>
          <code className="text-[11px] text-muted-foreground font-mono">{commitDiff.sha.slice(0, 7)}</code>
          <span className="text-sm font-medium truncate">{commitDiff.message.split("\n")[0]}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">{commitDiff.files.length} fichier{commitDiff.files.length > 1 ? "s" : ""}</div>
        {commitDiff.files.map((f, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/40 border-b">
              <span className={cn("text-[10px] font-bold px-1 py-0.5 rounded",
                f.status === "added" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : f.status === "removed" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              )}>
                {f.status === "added" ? "A" : f.status === "removed" ? "D" : "M"}
              </span>
              <span className="font-mono text-xs truncate">{f.filename}</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] shrink-0">
                {f.additions > 0 && <span className="text-green-600 dark:text-green-400">+{f.additions}</span>}
                {f.deletions > 0 && <span className="text-red-600 dark:text-red-400">-{f.deletions}</span>}
              </span>
            </div>
            {f.patch && (
              <pre className="text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto p-0 m-0">
                {f.patch.split("\n").map((line, li) => (
                  <div key={li} className={cn("px-2.5 py-0.5",
                    line.startsWith("+") && !line.startsWith("+++") ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300"
                    : line.startsWith("-") && !line.startsWith("---") ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                    : line.startsWith("@@") ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400"
                    : "text-muted-foreground"
                  )}>{line}</div>
                ))}
              </pre>
            )}
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {diffLoading && (
        <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement du diff...
        </div>
      )}
      {commits?.map((c) => (
        <Card key={c.sha} className="p-2.5 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => loadCommitDiff(c.sha)} data-testid={`card-commit-${c.sha.slice(0, 7)}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" data-testid={`text-commit-${c.sha.slice(0, 7)}`}>{c.commit.message.split("\n")[0]}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{c.commit.author.name} · {timeAgo(c.commit.author.date)}</p>
            </div>
            <code className="text-[11px] text-muted-foreground font-mono shrink-0">{c.sha.slice(0, 7)}</code>
          </div>
        </Card>
      ))}
      {!commitsLoading && commits && commits.length >= commitPage * 20 && (
        <Button variant="ghost" className="w-full text-xs h-8" onClick={() => setCommitPage((p) => p + 1)} data-testid="button-load-more-commits">
          Plus de commits
        </Button>
      )}
      {commitsLoading && (
        <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
        </div>
      )}
    </div>
  );
}

interface PrsTabProps {
  pullRequests: PullRequest[] | undefined;
  mergePrMutation: { mutate: (n: number) => void; isPending: boolean };
}

export function PrsTab({ pullRequests, mergePrMutation }: PrsTabProps) {
  return (
    <div className="space-y-1.5">
      {pullRequests?.map((pr) => (
        <Card key={pr.number} className="p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <GitPullRequest className={cn("w-3.5 h-3.5 shrink-0",
                pr.state === "open" ? "text-green-500" : pr.merged_at ? "text-purple-500" : "text-red-500"
              )} />
              <div className="min-w-0">
                <p className="text-sm truncate" data-testid={`text-pr-${pr.number}`}>#{pr.number} {pr.title}</p>
                <p className="text-[11px] text-muted-foreground">{pr.head.ref} → {pr.base.ref} · {timeAgo(pr.created_at)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant={pr.state === "open" ? "default" : "secondary"} className="text-[10px] h-5">
                {pr.merged_at ? "merged" : pr.state}
              </Badge>
              {pr.state === "open" && (
                <Button size="sm" variant="outline" className="h-6 text-[11px] px-2"
                  onClick={() => mergePrMutation.mutate(pr.number)}
                  disabled={mergePrMutation.isPending}
                  data-testid={`button-merge-pr-${pr.number}`}>
                  Merge
                </Button>
              )}
              <a href={pr.html_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </a>
            </div>
          </div>
        </Card>
      ))}
      {!pullRequests?.length && <p className="text-muted-foreground text-sm">Aucune PR</p>}
    </div>
  );
}
