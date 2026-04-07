import { Button } from "@/components/ui/button";
import { Loader2, Rocket, Upload, Globe, Settings, X } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Repo, DeployedApp } from "./types";
import { getErrMsg } from "./types";
import { DeployUrlsDialog } from "./GitDialogs";

interface RepoDeployBarProps {
  selectedRepo: Repo;
  deployUrls: Record<string, string[]> | undefined;
  hetznerAppMap: Map<string, DeployedApp>;
  hetznerDeploying: boolean;
  setHetznerDeploying: (v: boolean) => void;
  hetznerDeployLog: string | null;
  setHetznerDeployLog: (v: string | null) => void;
  deployToHetzner: () => void;
  urlsOpen: boolean;
  setUrlsOpen: (v: boolean) => void;
  urlsEdit: string[];
  setUrlsEdit: (v: string[]) => void;
}

export function RepoDeployBar({
  selectedRepo, deployUrls, hetznerAppMap,
  hetznerDeploying, setHetznerDeploying,
  hetznerDeployLog, setHetznerDeployLog,
  deployToHetzner,
  urlsOpen, setUrlsOpen, urlsEdit, setUrlsEdit,
}: RepoDeployBarProps) {
  const { toast } = useToast();
  const repoName = selectedRepo.name.toLowerCase();
  const isUlysseProject = repoName === "ulysseproject";
  const hetznerApp = hetznerAppMap.get(repoName) || (isUlysseProject ? hetznerAppMap.get("ulysse") : null);
  const allUrls = [
    ...new Set([
      ...(deployUrls?.[selectedRepo.full_name] || []),
      ...(selectedRepo.homepage ? [selectedRepo.homepage] : []),
    ]),
  ].filter(
    (u) => !u.includes(".replit.app") && !u.includes(".replit.dev") && !u.includes("github.io"),
  );

  return (
    <>
      <div className="flex items-center gap-2">
        {isUlysseProject && (
          <Button size="sm" variant="default" className="gap-1.5 h-8"
            onClick={deployToHetzner} disabled={hetznerDeploying} data-testid="button-deploy-hetzner">
            {hetznerDeploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            Deploy Hetzner
          </Button>
        )}
        {!isUlysseProject && hetznerApp && (
          <Button size="sm" variant="default" className="gap-1.5 h-8"
            onClick={async () => {
              setHetznerDeploying(true);
              setHetznerDeployLog(`Deploiement ${repoName} sur Hetzner...`);
              try {
                const res = await fetch("/api/devops/server/deploy-repo", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ appName: repoName }),
                });
                const data = await res.json();
                setHetznerDeployLog(data.output || data.error || "Done");
                toast({
                  title: data.success ? "Deploiement reussi" : "Erreur",
                  description: data.success ? `${repoName} mis a jour sur Hetzner` : data.error,
                  variant: data.success ? "default" : "destructive",
                });
                queryClient.invalidateQueries({ queryKey: ["/api/devops/server/deployments"] });
              } catch (err: unknown) {
                setHetznerDeployLog(getErrMsg(err));
                toast({ title: "Erreur", description: getErrMsg(err), variant: "destructive" });
              }
              setHetznerDeploying(false);
            }}
            disabled={hetznerDeploying} data-testid="button-deploy-hetzner-repo">
            {hetznerDeploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            Deploy Hetzner
          </Button>
        )}
        {hetznerApp && (
          <Button size="sm" variant="outline" className="gap-1.5 h-8"
            onClick={async () => {
              setHetznerDeploying(true);
              setHetznerDeployLog(`Push du code ${repoName} vers GitHub...`);
              try {
                const appNameForPush = isUlysseProject ? "ulysse" : repoName;
                const res = await fetch("/api/devops/server/push-code", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ appName: appNameForPush, message: `Update ${repoName} from Ulysse DevOps` }),
                });
                const data = await res.json();
                setHetznerDeployLog(data.output || data.error || "Done");
                toast({
                  title: data.success ? "Push reussi" : "Erreur",
                  description: data.success ? `Code pousse sur GitHub` : data.error,
                  variant: data.success ? "default" : "destructive",
                });
              } catch (err: unknown) {
                setHetznerDeployLog(getErrMsg(err));
                toast({ title: "Erreur", description: getErrMsg(err), variant: "destructive" });
              }
              setHetznerDeploying(false);
            }}
            disabled={hetznerDeploying} data-testid="button-push-code">
            {hetznerDeploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Push Code
          </Button>
        )}
        {allUrls.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" data-testid={`button-open-live-${i}`}>
              <Globe className="w-3.5 h-3.5" />{" "}
              {(() => { try { return new URL(url).hostname; } catch { return "Live"; } })()}
            </Button>
          </a>
        ))}
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
          onClick={() => { setUrlsEdit(deployUrls?.[selectedRepo.full_name] || []); setUrlsOpen(true); }}
          data-testid="button-manage-urls">
          <Settings className="w-3.5 h-3.5" />
        </Button>
        <DeployUrlsDialog open={urlsOpen} onOpenChange={setUrlsOpen} urls={urlsEdit} setUrls={setUrlsEdit} repoFullName={selectedRepo.full_name} />
      </div>

      {hetznerDeployLog && (
        <div className="mb-3">
          <div className="bg-black/90 text-green-400 rounded-lg p-2.5 text-[11px] font-mono max-h-32 overflow-auto whitespace-pre-wrap flex items-start justify-between gap-2">
            <span>{hetznerDeployLog}</span>
            <button onClick={() => setHetznerDeployLog(null)} className="text-zinc-500 hover:text-zinc-300 shrink-0 mt-0.5">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
