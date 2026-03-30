import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GitBranch, GitCommit, GitPullRequest, Activity, FileCode,
  Play, RotateCcw, Bot, Terminal, ExternalLink,
} from "lucide-react";
import { API, REPO_URL } from "./devops/types";
import BranchesTab from "./devops/BranchesTab";
import CommitsTab from "./devops/CommitsTab";
import PullRequestsTab from "./devops/PullRequestsTab";
import CICDTab from "./devops/CICDTab";
import FileBrowserTab from "./devops/FileBrowserTab";
import DevOpsChat from "./devops/DevOpsChat";
import RollbackTab from "./devops/RollbackTab";
import OverviewTab from "./devops/OverviewTab";

export default function DevOpsMax() {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: repo, isLoading: repoLoading } = useQuery<any>({
    queryKey: [API, "repo"],
    queryFn: () => fetch(`${API}/repo`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                DevOpsMax
                {repo && <Badge variant="outline" className="text-xs font-mono">{repo.default_branch || "main"}</Badge>}
              </h2>
              <p className="text-xs text-muted-foreground">ulyssemdbh-commits/devmax</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {repo && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {repo.language && <Badge variant="secondary">{repo.language}</Badge>}
              </div>
            )}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" data-testid="button-open-github">
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> GitHub
              </Button>
            </a>
          </div>
        </div>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start flex-wrap">
          <TabsTrigger value="overview" className="text-xs gap-1" data-testid="tab-overview">
            <Activity className="w-3.5 h-3.5" /> Vue d'ensemble
          </TabsTrigger>
          <TabsTrigger value="branches" className="text-xs gap-1" data-testid="tab-branches">
            <GitBranch className="w-3.5 h-3.5" /> Branches
          </TabsTrigger>
          <TabsTrigger value="commits" className="text-xs gap-1" data-testid="tab-commits">
            <GitCommit className="w-3.5 h-3.5" /> Commits
          </TabsTrigger>
          <TabsTrigger value="prs" className="text-xs gap-1" data-testid="tab-prs">
            <GitPullRequest className="w-3.5 h-3.5" /> PRs
          </TabsTrigger>
          <TabsTrigger value="cicd" className="text-xs gap-1" data-testid="tab-cicd">
            <Play className="w-3.5 h-3.5" /> CI/CD
          </TabsTrigger>
          <TabsTrigger value="files" className="text-xs gap-1" data-testid="tab-files">
            <FileCode className="w-3.5 h-3.5" /> Fichiers
          </TabsTrigger>
          <TabsTrigger value="chat" className="text-xs gap-1" data-testid="tab-devops-chat">
            <Bot className="w-3.5 h-3.5" /> Chat IA
          </TabsTrigger>
          <TabsTrigger value="rollback" className="text-xs gap-1" data-testid="tab-rollback">
            <RotateCcw className="w-3.5 h-3.5" /> Rollback
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab repo={repo} repoLoading={repoLoading} />
        </TabsContent>
        <TabsContent value="branches" className="mt-4">
          <BranchesTab />
        </TabsContent>
        <TabsContent value="commits" className="mt-4">
          <CommitsTab />
        </TabsContent>
        <TabsContent value="prs" className="mt-4">
          <PullRequestsTab />
        </TabsContent>
        <TabsContent value="cicd" className="mt-4">
          <CICDTab />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FileBrowserTab />
        </TabsContent>
        <TabsContent value="chat" className="mt-4">
          <DevOpsChat />
        </TabsContent>
        <TabsContent value="rollback" className="mt-4">
          <RollbackTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
