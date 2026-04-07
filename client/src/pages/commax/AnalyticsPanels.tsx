import { useState } from "react";
import { PLATFORMS, getPlatformConfig, PlatformBadge } from "./config";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fr } from "date-fns/locale";
import {
  Plus,
  Send,
  Trash2,
  Copy,
  Users,
  Layers,
  BarChart2,
} from "lucide-react";

export function Analytics() {
  const { data: posts = [] } = useQuery<any[]>({ queryKey: ["/api/commax/posts"] });
  const { data: accounts = [] } = useQuery<any[]>({ queryKey: ["/api/commax/accounts"] });

  const published = posts.filter((p: any) => p.status === "published");
  const platformCounts: Record<string, number> = {};
  for (const post of published) {
    for (const platform of (post.platforms || [])) {
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-green-400/10 flex items-center justify-center">
                <Send className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{published.length}</div>
                <div className="text-xs text-muted-foreground">Posts publiés</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-blue-400/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {accounts.reduce((s: number, a: any) => s + (a.followersCount || 0), 0).toLocaleString("fr-FR")}
                </div>
                <div className="text-xs text-muted-foreground">Abonnés totaux</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-purple-400/10 flex items-center justify-center">
                <BarChart2 className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{accounts.filter((a: any) => a.status === "connected").length}</div>
                <div className="text-xs text-muted-foreground">Plateformes actives</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Posts per platform */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader>
          <CardTitle className="text-sm">Posts publiés par plateforme</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(platformCounts).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Aucun post publié pour l'instant
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(platformCounts).sort(([, a], [, b]) => b - a).map(([platform, count]) => {
                const cfg = getPlatformConfig(platform);
                const Icon = cfg.icon;
                const max = Math.max(...Object.values(platformCounts));
                return (
                  <div key={platform} className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center border shrink-0", cfg.bg, cfg.border)}>
                      <Icon className={cn("w-4 h-4", cfg.color)} />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm">{cfg.label}</span>
                        <span className="text-sm font-medium">{count}</span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", cfg.bg.replace("bg-", "bg-"))}
                          style={{ width: `${(count / max) * 100}%`, backgroundColor: undefined }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accounts detail */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader>
          <CardTitle className="text-sm">Détail des comptes</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Aucun compte configuré</div>
          ) : (
            <div className="space-y-2">
              {accounts.map((account: any) => {
                const cfg = getPlatformConfig(account.platform);
                const Icon = cfg.icon;
                return (
                  <div key={account.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", cfg.bg)}>
                        <Icon className={cn("w-4 h-4", cfg.color)} />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{account.accountName}</div>
                        {account.accountHandle && <div className="text-xs text-muted-foreground">@{account.accountHandle}</div>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{(account.followersCount || 0).toLocaleString("fr-FR")}</div>
                      <div className="text-xs text-muted-foreground">abonnés</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Templates ────────────────────────────────────────────────
export function Templates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: "", content: "", platforms: [] as string[], tags: [] as string[] });
  const [tagInput, setTagInput] = useState("");

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/templates"],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/commax/templates", newTemplate);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/templates"] });
      setShowAdd(false);
      setNewTemplate({ name: "", content: "", platforms: [], tags: [] });
      toast({ title: "Template créé !" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/commax/templates/${id}`, {});
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/commax/templates"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-medium">Templates de contenu</h3>
          <p className="text-sm text-muted-foreground">Réutilise tes formats de posts préférés</p>
        </div>
        <Button data-testid="button-add-template" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-2" />Nouveau template
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Layers className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Aucun template</p>
          <p className="text-sm">Crée des modèles pour accélérer ta création de contenu</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t: any) => (
            <Card key={t.id} data-testid={`template-card-${t.id}`} className="bg-card/60 border-border/50 hover:border-border transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium text-sm">{t.name}</div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { navigator.clipboard.writeText(t.content); toast({ title: "Copié !" }); }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      data-testid={`button-delete-template-${t.id}`}
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                      onClick={() => deleteMutation.mutate(t.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{t.content}</p>
                <div className="flex flex-wrap gap-1">
                  {(t.platforms || []).map((p: string) => <PlatformBadge key={p} platform={p} />)}
                  {(t.tags || []).map((tag: string) => (
                    <span key={tag} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">#{tag}</span>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Utilisé {t.usageCount || 0} fois</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom du template</Label>
              <Input
                data-testid="input-template-name"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate((p) => ({ ...p, name: e.target.value }))}
                placeholder="ex: Post d'annonce événement"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Contenu</Label>
              <Textarea
                data-testid="input-template-content"
                value={newTemplate.content}
                onChange={(e) => setNewTemplate((p) => ({ ...p, content: e.target.value }))}
                placeholder="Écris ton template ici... Tu peux utiliser des variables comme {nom}, {date}, etc."
                rows={5}
                className="mt-1 bg-background/50"
              />
            </div>
            <div>
              <Label>Plateformes cibles</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PLATFORMS.slice(0, 6).map((p) => {
                  const active = newTemplate.platforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setNewTemplate((prev) => ({
                        ...prev,
                        platforms: active ? prev.platforms.filter((x) => x !== p.id) : [...prev.platforms, p.id],
                      }))}
                      className={cn("px-2 py-1 rounded-lg border text-xs font-medium transition-all", active ? "bg-primary/10 text-primary border-primary/30" : "border-border/50 text-muted-foreground")}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Annuler</Button>
              <Button
                data-testid="button-confirm-template"
                onClick={() => addMutation.mutate()}
                disabled={!newTemplate.name || !newTemplate.content || addMutation.isPending}
              >
                Créer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Mini Iris Chat ────────────────────────────────────────────
interface MiniMsg { role: "user" | "iris"; content: string; streaming?: boolean }

