import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, ArrowLeft, Code, CheckCircle, ChevronRight, Folder, File,
} from "lucide-react";
import { API, type TreeItem } from "./types";

export default function FileBrowserTab() {
  const [branch, setBranch] = useState("main");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string; sha: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const { toast } = useToast();

  const { data: tree, isLoading } = useQuery<{ tree: TreeItem[] }>({
    queryKey: [API, "tree", branch],
    queryFn: () => fetch(`${API}/tree/${branch}`, { credentials: "include" }).then(r => r.json()),
  });

  const items = useMemo(() => {
    if (!tree?.tree) return [];
    const prefix = currentPath.join("/");
    return tree.tree
      .filter(item => {
        const parts = item.path.split("/");
        if (prefix) {
          if (!item.path.startsWith(prefix + "/")) return false;
          const remaining = item.path.slice(prefix.length + 1);
          return !remaining.includes("/");
        }
        return parts.length === 1;
      })
      .sort((a, b) => {
        if (a.type === "tree" && b.type !== "tree") return -1;
        if (a.type !== "tree" && b.type === "tree") return 1;
        return a.path.localeCompare(b.path);
      });
  }, [tree, currentPath]);

  const openFile = useCallback(async (path: string) => {
    try {
      const res = await fetch(`${API}/contents/${path}?ref=${branch}`, { credentials: "include" });
      const data = await res.json();
      const raw = atob(data.content?.replace(/\n/g, "") || "");
      const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      setFileContent({ path, content: decoded, sha: data.sha });
      setEditContent(decoded);
      setEditMode(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  }, [branch, toast]);

  const saveFile = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `${API}/contents/${fileContent!.path}`, {
        content: editContent,
        message: commitMsg || `Update ${fileContent!.path}`,
        branch,
        sha: fileContent!.sha,
      });
    },
    onSuccess: () => {
      toast({ title: "Fichier sauvegardé" });
      setEditMode(false);
      setCommitMsg("");
      queryClient.invalidateQueries({ queryKey: [API, "tree", branch] });
      queryClient.invalidateQueries({ queryKey: [API, "commits"] });
      if (fileContent) openFile(fileContent.path);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  if (fileContent) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setFileContent(null)} data-testid="button-back-files">
            <ArrowLeft className="w-4 h-4 mr-1" /> Retour
          </Button>
          <code className="text-xs text-muted-foreground">{fileContent.path}</code>
          <div className="flex-1" />
          {!editMode ? (
            <Button size="sm" onClick={() => setEditMode(true)} data-testid="button-edit-file">
              <Code className="w-3.5 h-3.5 mr-1" /> Éditer
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Message du commit"
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                className="w-48 h-8 text-xs"
              />
              <Button size="sm" onClick={() => saveFile.mutate()} disabled={saveFile.isPending} data-testid="button-save-file">
                {saveFile.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                <span className="ml-1">Sauver</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditMode(false); setEditContent(fileContent.content); }}>
                Annuler
              </Button>
            </div>
          )}
        </div>
        {editMode ? (
          <Textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            className="font-mono text-xs min-h-[400px]"
            data-testid="textarea-edit-file"
          />
        ) : (
          <ScrollArea className="h-[400px] rounded-md border">
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap">{fileContent.content}</pre>
          </ScrollArea>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={branch} onChange={e => setBranch(e.target.value)} className="w-32" />
        {currentPath.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setCurrentPath(p => p.slice(0, -1))} data-testid="button-nav-up">
            <ArrowLeft className="w-4 h-4 mr-1" /> ..
          </Button>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath([])}>root</span>
          {currentPath.map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3" />
              <span className="cursor-pointer hover:text-foreground" onClick={() => setCurrentPath(prev => prev.slice(0, i + 1))}>{p}</span>
            </span>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-1">
          {items.map(item => {
            const name = item.path.split("/").pop()!;
            const isDir = item.type === "tree";
            return (
              <div
                key={item.path}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer text-sm"
                onClick={() => isDir ? setCurrentPath(item.path.split("/")) : openFile(item.path)}
                data-testid={`file-item-${name}`}
              >
                {isDir ? <Folder className="w-4 h-4 text-blue-400" /> : <File className="w-4 h-4 text-muted-foreground" />}
                <span className="flex-1">{name}</span>
                {item.size && <span className="text-xs text-muted-foreground">{(item.size / 1024).toFixed(1)}KB</span>}
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">Dossier vide</p>
          )}
        </div>
      )}
    </div>
  );
}
