import { useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  FolderGit2, Plus, Search, Star, Globe, RefreshCw, Loader2, Rocket, Home,
  Layout, BookOpen, Camera, Gamepad2, Music, ShoppingBag, Palette, Code, FilePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DeploymentsPanel } from "./DeploymentsPanel";
import { DevOpsChatBox } from "./DevOpsChatBox";
import type { Repo, DeployedApp } from "./types";
import { timeAgo, langColor } from "./helpers";

interface RepoListViewProps {
  ghUser: { login: string; avatar_url: string } | undefined;
  repos: Repo[] | undefined;
  reposLoading: boolean;
  filteredRepos: Repo[] | undefined;
  deployUrls: Record<string, string[]> | undefined;
  hetznerAppMap: Map<string, DeployedApp>;
  searchFilter: string;
  setSearchFilter: (v: string) => void;
  selectRepo: (r: Repo) => void;
  prefetchRepoData: (fullName: string, defaultBranch: string) => void;
  newRepoOpen: boolean;
  setNewRepoOpen: (v: boolean) => void;
  newRepoName: string;
  setNewRepoName: (v: string) => void;
  newRepoDesc: string;
  setNewRepoDesc: (v: string) => void;
  newRepoPrivate: boolean;
  setNewRepoPrivate: (v: boolean) => void;
  newRepoTemplate: string;
  setNewRepoTemplate: (v: string) => void;
  createRepoMutation: { mutate: () => void; isPending: boolean };
  editDeployRepo: string | null;
  setEditDeployRepo: (v: string | null) => void;
  editDeployInput: string;
  setEditDeployInput: (v: string) => void;
  selectedRepo: Repo | null;
  dgmActive: boolean;
  dgmSessionId: string | null;
  dgmObjective: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

const TEMPLATES = [
  { id: "portfolio", Icon: Layout, name: "Portfolio", color: "from-violet-500 to-purple-600", desc: "React, Tailwind" },
  { id: "blog", Icon: BookOpen, name: "Blog", color: "from-emerald-500 to-teal-600", desc: "Next.js, MDX" },
  { id: "galerie-photo", Icon: Camera, name: "Galerie Photo", color: "from-amber-500 to-orange-600", desc: "React, Lightbox" },
  { id: "jeu-web", Icon: Gamepad2, name: "Jeu Web", color: "from-red-500 to-pink-600", desc: "Phaser, TypeScript" },
  { id: "playlist", Icon: Music, name: "Playlist", color: "from-green-500 to-emerald-600", desc: "React, Spotify API" },
  { id: "boutique", Icon: ShoppingBag, name: "Boutique", color: "from-blue-500 to-indigo-600", desc: "React, Stripe" },
  { id: "art-design", Icon: Palette, name: "Art & Design", color: "from-pink-500 to-rose-600", desc: "React, Canvas" },
  { id: "react-vite", Icon: Code, name: "React+Vite", color: "from-cyan-500 to-blue-600", desc: "SPA classique" },
  { id: "empty", Icon: FilePlus, name: "Projet Libre", color: "from-slate-500 to-zinc-600", desc: "À définir" },
];

export function RepoListView(props: RepoListViewProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background p-3 md:p-4 max-w-6xl mx-auto" data-testid="devops-page">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back-dashboard">
            <Home className="w-4 h-4" />
          </Button>
          <FolderGit2 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">DevOps Ulysse</h1>
            {props.ghUser && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{props.ghUser.login}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={props.newRepoOpen} onOpenChange={props.setNewRepoOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8" data-testid="button-new-repo">
                <Plus className="w-3.5 h-3.5 mr-1" /> Nouveau
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nouveau projet</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium mb-2 block">Template</label>
                  <div className="grid grid-cols-3 gap-2">
                    {TEMPLATES.map((t) => (
                      <div
                        key={t.id}
                        className={cn(
                          "border rounded-lg p-2 cursor-pointer transition-all text-center",
                          props.newRepoTemplate === t.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40",
                        )}
                        onClick={() => {
                          props.setNewRepoTemplate(t.id);
                          if (!props.newRepoDesc) props.setNewRepoDesc(t.desc);
                        }}
                        data-testid={`template-${t.id}`}
                      >
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center mx-auto`}>
                          <t.Icon className="h-4 w-4 text-white" />
                        </div>
                        <p className="text-xs font-medium mt-1">{t.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Nom</label>
                  <Input
                    placeholder="mon-projet"
                    value={props.newRepoName}
                    onChange={(e) => props.setNewRepoName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, "-"))}
                    data-testid="input-new-repo-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Description</label>
                  <Input placeholder="Optionnel" value={props.newRepoDesc} onChange={(e) => props.setNewRepoDesc(e.target.value)} data-testid="input-new-repo-desc" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="repo-private" checked={props.newRepoPrivate} onChange={(e) => props.setNewRepoPrivate(e.target.checked)} className="rounded border-border" />
                  <label htmlFor="repo-private" className="text-sm">Prive</label>
                </div>
                <Button onClick={() => props.createRepoMutation.mutate()} disabled={props.createRepoMutation.isPending || !props.newRepoName.trim()} className="w-full" data-testid="button-confirm-create-repo">
                  {props.createRepoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  Creer
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" className="h-8" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/devops/repos"] })} data-testid="button-refresh-repos">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <DeploymentsPanel />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Rocket className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Repos GitHub</h2>
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          ref={props.searchInputRef}
          placeholder="Rechercher un repo... (Ctrl+K)"
          className="pl-9 h-9"
          value={props.searchFilter}
          onChange={(e) => props.setSearchFilter(e.target.value)}
          data-testid="input-search-repos"
        />
      </div>

      {props.reposLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {props.filteredRepos?.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              hetznerAppMap={props.hetznerAppMap}
              deployUrls={props.deployUrls}
              selectRepo={props.selectRepo}
              prefetchRepoData={props.prefetchRepoData}
            />
          ))}
        </div>
      )}
      {!props.reposLoading && !props.filteredRepos?.length && (
        <div className="text-center py-16 text-muted-foreground">
          <FolderGit2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Aucun repo</p>
        </div>
      )}

      <Dialog open={!!props.editDeployRepo} onOpenChange={(open) => { if (!open) props.setEditDeployRepo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>URLs de deploiement</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">{props.editDeployRepo}</p>
          <Textarea value={props.editDeployInput} onChange={(e) => props.setEditDeployInput(e.target.value)} placeholder="https://monapp.com" rows={3} className="text-sm" data-testid="input-deploy-urls" />
          <p className="text-[11px] text-muted-foreground">Une URL par ligne</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => props.setEditDeployRepo(null)} data-testid="button-cancel-deploy">Annuler</Button>
            <Button size="sm" data-testid="button-save-deploy" onClick={async () => {
              if (!props.editDeployRepo) return;
              const urls = props.editDeployInput.split("\n").map((u) => u.trim()).filter(Boolean);
              const [owner, repo] = props.editDeployRepo.split("/");
              await apiRequest("PUT", `/api/devops/deploy-urls/${owner}/${repo}`, { urls });
              queryClient.invalidateQueries({ queryKey: ["/api/devops/deploy-urls"] });
              props.setEditDeployRepo(null);
              toast({ title: "URLs mises a jour" });
            }}>Enregistrer</Button>
          </div>
        </DialogContent>
      </Dialog>

      <DevOpsChatBox
        repoContext={props.selectedRepo?.full_name}
        availableRepos={props.repos}
        dgmActive={props.dgmActive}
        dgmSessionId={props.dgmSessionId || undefined}
        dgmObjective={props.dgmObjective || undefined}
        dgmRepoContext={props.selectedRepo?.full_name || undefined}
      />
    </div>
  );
}

function RepoCard({ repo, hetznerAppMap, deployUrls, selectRepo, prefetchRepoData }: {
  repo: Repo;
  hetznerAppMap: Map<string, DeployedApp>;
  deployUrls: Record<string, string[]> | undefined;
  selectRepo: (r: Repo) => void;
  prefetchRepoData: (fullName: string, defaultBranch: string) => void;
}) {
  const hApp = hetznerAppMap.get(repo.name.toLowerCase());
  const isLive = hApp && ["online", "static", "deployed"].includes(hApp.status);
  const allUrls = deployUrls?.[repo.full_name] || [];
  const ulysseProUrls = allUrls.filter(u => u.includes(".ulyssepro.org"));
  const otherUrls = allUrls.filter(u => !u.includes(".ulyssepro.org"));
  const hetznerDomain = hApp?.domain;
  if (hetznerDomain && !ulysseProUrls.some(u => u.includes(hetznerDomain))) {
    ulysseProUrls.unshift(`https://${hetznerDomain}`);
  }
  const shownUlysseUrls = [...new Set(ulysseProUrls)];

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => selectRepo(repo)}
      onMouseEnter={() => prefetchRepoData(repo.full_name, repo.default_branch)}
      data-testid={`card-repo-${repo.name}`}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn("w-2 h-2 rounded-full shrink-0", langColor(repo.language))} />
          <h3 className="font-semibold text-sm truncate flex-1" data-testid={`text-repo-name-${repo.name}`}>{repo.name}</h3>
          <Badge variant={repo.private ? "secondary" : "outline"} className="text-[9px] h-4 shrink-0">{repo.private ? "P" : "O"}</Badge>
        </div>
        {repo.description && <p className="text-[11px] text-muted-foreground line-clamp-1 mb-1.5">{repo.description}</p>}
        <div className="flex flex-col gap-0.5">
          {shownUlysseUrls.map((url, i) => {
            let hostname = "";
            try { hostname = new URL(url).hostname; } catch { hostname = url.replace(/^https?:\/\//, ""); }
            return (
              <a key={`ulysse-${i}`} href={url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] flex items-center gap-1 truncate hover:underline"
                onClick={(e) => e.stopPropagation()} data-testid={`link-ulysse-${repo.name}-${i}`}>
                <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", isLive ? "bg-green-500" : "bg-yellow-500")} />
                <span className="truncate text-primary font-medium">{hostname}</span>
                {hApp && <Badge variant="outline" className="text-[7px] h-3 px-1 shrink-0">{hApp.type === "static" ? "HTML" : "Node"}</Badge>}
              </a>
            );
          })}
          {otherUrls.slice(0, 2).map((url, i) => (
            <a key={`deploy-${i}`} href={url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-primary hover:underline flex items-center gap-1 truncate"
              onClick={(e) => e.stopPropagation()} data-testid={`link-deploy-${repo.name}-${i}`}>
              <Globe className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{(() => { try { return new URL(url).hostname; } catch { return url; } })()}</span>
            </a>
          ))}
          {repo.homepage && !allUrls.includes(repo.homepage) && (
            <a href={repo.homepage} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:underline flex items-center gap-1 truncate"
              onClick={(e) => e.stopPropagation()} data-testid={`link-homepage-${repo.name}`}>
              <Globe className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{(() => { try { return new URL(repo.homepage).hostname; } catch { return repo.homepage; } })()}</span>
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
          {repo.language && <span>{repo.language}</span>}
          {repo.stargazers_count > 0 && (
            <span className="flex items-center gap-0.5"><Star className="w-2.5 h-2.5" />{repo.stargazers_count}</span>
          )}
          <span className="ml-auto">{timeAgo(repo.updated_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
