import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitCommit, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { API, timeAgo, type Commit } from "./types";

export default function CommitsTab() {
  const [branch, setBranch] = useState("main");
  const { data: commits, isLoading, refetch } = useQuery<Commit[]>({
    queryKey: [API, "commits", branch],
    queryFn: () => fetch(`${API}/commits?branch=${branch}&per_page=30`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Branche"
          value={branch}
          onChange={e => setBranch(e.target.value)}
          className="w-40"
        />
        <Button size="icon" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {commits?.map(c => (
            <Card key={c.sha} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <GitCommit className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="text-sm font-medium truncate">{c.commit.message.split("\n")[0]}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{c.commit.author.name}</span>
                    <span>{timeAgo(c.commit.author.date)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <code className="text-xs text-muted-foreground font-mono">{c.sha.slice(0, 7)}</code>
                  <a href={c.html_url} target="_blank" rel="noopener noreferrer">
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
