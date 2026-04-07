import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, GitPullRequest, Code, Loader2, Settings, Trash2, Save, X } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Branch } from "./types";

interface DeployUrlsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  urls: string[];
  setUrls: (v: string[]) => void;
  repoFullName: string;
}

export function DeployUrlsDialog({ open, onOpenChange, urls, setUrls, repoFullName }: DeployUrlsDialogProps) {
  const { toast } = useToast();
  const [newInput, setNewInput] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>URLs de deploiement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {urls.map((url, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={url}
                onChange={(e) => {
                  const next = [...urls];
                  next[i] = e.target.value;
                  setUrls(next);
                }}
                className="text-xs h-8 font-mono"
                data-testid={`input-url-${i}`}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive shrink-0"
                onClick={() => setUrls(urls.filter((_, j) => j !== i))}
                data-testid={`button-remove-url-${i}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              placeholder="https://example.com"
              value={newInput}
              onChange={(e) => setNewInput(e.target.value)}
              className="text-xs h-8 font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newInput.trim()) {
                  setUrls([...urls, newInput.trim()]);
                  setNewInput("");
                }
              }}
              data-testid="input-url-new"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              disabled={!newInput.trim()}
              onClick={() => {
                if (newInput.trim()) {
                  setUrls([...urls, newInput.trim()]);
                  setNewInput("");
                }
              }}
              data-testid="button-add-url"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
          <Button
            className="w-full"
            onClick={async () => {
              try {
                const filtered = urls.filter((u) => u.trim());
                await apiRequest("PUT", `/api/devops/deploy-urls/${repoFullName}`, { urls: filtered });
                queryClient.invalidateQueries({ queryKey: ["/api/devops/deploy-urls"] });
                toast({ title: "URLs mises a jour" });
                onOpenChange(false);
              } catch {
                toast({ title: "Erreur", variant: "destructive" });
              }
            }}
            data-testid="button-save-urls"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" /> Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface NewBranchDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchName: string;
  setBranchName: (v: string) => void;
  branchFrom: string;
  setBranchFrom: (v: string) => void;
  createMutation: { mutate: () => void; isPending: boolean };
}

export function NewBranchDialog({ open, onOpenChange, branchName, setBranchName, branchFrom, setBranchFrom, createMutation }: NewBranchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-new-branch">
          <Plus className="w-3 h-3 mr-1" /> Branche
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle branche</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="feature/ma-feature"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            data-testid="input-branch-name"
          />
          <Input
            placeholder="Depuis (ex: main)"
            value={branchFrom}
            onChange={(e) => setBranchFrom(e.target.value)}
            data-testid="input-branch-from"
          />
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !branchName}
            data-testid="button-create-branch"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Creer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface NewPrDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prTitle: string;
  setPrTitle: (v: string) => void;
  prBody: string;
  setPrBody: (v: string) => void;
  prHead: string;
  setPrHead: (v: string) => void;
  prBase: string;
  setPrBase: (v: string) => void;
  branches: Branch[] | undefined;
  createMutation: { mutate: () => void; isPending: boolean };
}

export function NewPrDialog({ open, onOpenChange, prTitle, setPrTitle, prBody, setPrBody, prHead, setPrHead, prBase, setPrBase, branches, createMutation }: NewPrDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-new-pr">
          <GitPullRequest className="w-3 h-3 mr-1" /> PR
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle Pull Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Titre" value={prTitle} onChange={(e) => setPrTitle(e.target.value)} data-testid="input-pr-title" />
          <Textarea placeholder="Description" value={prBody} onChange={(e) => setPrBody(e.target.value)} data-testid="input-pr-body" />
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Depuis</label>
              <Select value={prHead} onValueChange={setPrHead}>
                <SelectTrigger data-testid="select-pr-head">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  {branches?.filter((b) => b.name !== prBase).map((b) => (
                    <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="self-end pb-2 text-muted-foreground">→</span>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Vers</label>
              <Select value={prBase} onValueChange={setPrBase}>
                <SelectTrigger data-testid="select-pr-base">
                  <SelectValue placeholder="Cible" />
                </SelectTrigger>
                <SelectContent>
                  {branches?.filter((b) => b.name !== prHead).map((b) => (
                    <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !prTitle || !prHead}
            className="w-full"
            data-testid="button-create-pr"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Creer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PatchDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branch: string;
  setBranch: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
  files: string;
  setFiles: (v: string) => void;
  applyMutation: { mutate: () => void; isPending: boolean };
}

export function PatchDialog({ open, onOpenChange, branch, setBranch, message, setMessage, files, setFiles, applyMutation }: PatchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-apply-patch">
          <Code className="w-3 h-3 mr-1" /> Patch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Appliquer un patch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Branche cible" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="input-patch-branch" />
          <Input placeholder="Message de commit" value={message} onChange={(e) => setMessage(e.target.value)} data-testid="input-patch-message" />
          <Textarea
            placeholder={'[\n  { "path": "src/index.ts", "content": "console.log(\'hello\');" }\n]'}
            value={files}
            onChange={(e) => setFiles(e.target.value)}
            className="font-mono text-xs min-h-[120px]"
            data-testid="input-patch-files"
          />
          <Button
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending || !branch || !message}
            data-testid="button-submit-patch"
          >
            {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Appliquer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
