import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fr } from "date-fns/locale";
import { PLATFORMS, getPlatformConfig } from "./config";
import {
  Plus,
  Loader2,
  Trash2,
  Users,
  Instagram,
  Facebook,
  AlertCircle,
} from "lucide-react";

export function InstagramConnectDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState<"guide" | "token">("guide");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    if (!token.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/commax/oauth/instagram/token", { token: token.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast({
        title: "Instagram connecté !",
        description: `@${data.instagramUsername} · ${data.longLived ? "Token 60 jours" : "Token court"}`,
      });
      setToken("");
      setStep("guide");
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setStep("guide"); setToken(""); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="w-5 h-5 text-pink-400" />
            Connecter Instagram
          </DialogTitle>
        </DialogHeader>

        {step === "guide" ? (
          <div className="space-y-4">
            <div className="bg-pink-500/5 border border-pink-500/20 rounded-lg p-4">
              <p className="text-sm font-medium text-pink-300 mb-2">Prérequis</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Compte Instagram <strong>Business</strong> ou <strong>Creator</strong></li>
                <li>• Lié à une Page Facebook</li>
              </ul>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Comment obtenir ton token (5 min) :</p>
              {[
                { n: 1, title: "Va sur le Graph API Explorer", url: "https://developers.facebook.com/tools/explorer", desc: "Connecte-toi avec ton compte Facebook" },
                { n: 2, title: "Sélectionne ton App", desc: "Si tu n'as pas d'app, crée-en une sur developers.facebook.com" },
                { n: 3, title: "Ajoute les permissions", desc: "instagram_basic · instagram_content_publish · pages_show_list · pages_read_engagement" },
                { n: 4, title: "Génère le token", desc: "Clique sur \"Generate Access Token\" → autorise → copie le token" },
              ].map((s) => (
                <div key={s.n} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{s.n}</div>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.desc}</p>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-400 hover:text-pink-300 flex items-center gap-1 mt-0.5">
                        Ouvrir le Graph Explorer →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button data-testid="button-instagram-next" onClick={() => setStep("token")} className="bg-pink-500/20 text-pink-300 border border-pink-500/30 hover:bg-pink-500/30">
                J'ai mon token →
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Access Token Instagram</Label>
              <Textarea
                data-testid="input-instagram-token"
                className="mt-1 font-mono text-xs min-h-[100px]"
                placeholder="EAABs... (colle ton token ici)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Le token sera validé puis échangé contre un token 60 jours si ton App Meta est configurée.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setStep("guide")}>← Retour</Button>
              <Button
                data-testid="button-instagram-connect"
                onClick={handleConnect}
                disabled={!token.trim() || loading}
                className="bg-gradient-to-r from-pink-500/80 to-purple-500/80 text-white hover:from-pink-500 hover:to-purple-500"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Instagram className="w-4 h-4 mr-2" />}
                Connecter
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Accounts Manager ─────────────────────────────────────────
export function AccountsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showInstagramDialog, setShowInstagramDialog] = useState(false);
  const [newAccount, setNewAccount] = useState({
    platform: "twitter",
    accountName: "",
    accountHandle: "",
    followersCount: 0,
  });

  // Handle OAuth callback from URL (after redirect from Meta OAuth)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("oauth_success");
    const oauthError = params.get("oauth_error");
    const token = params.get("token");
    if (oauthSuccess && token) {
      const accountName = params.get("name") || "Instagram";
      apiRequest("POST", "/api/commax/oauth/instagram/token", { token, accountName })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
            toast({ title: "Instagram connecté via OAuth !", description: `@${data.instagramUsername}` });
          }
        })
        .catch(() => {});
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    } else if (oauthError) {
      toast({ title: "Erreur OAuth", description: decodeURIComponent(oauthError), variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: accounts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/accounts"],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/commax/accounts", {
        ...newAccount,
        status: "connected",
        followersCount: Number(newAccount.followersCount),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
      setShowAddDialog(false);
      setNewAccount({ platform: "twitter", accountName: "", accountHandle: "", followersCount: 0 });
      toast({ title: "Compte ajouté !" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/commax/accounts/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/commax/accounts/${id}`, { status });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-medium">Comptes connectés</h3>
          <p className="text-sm text-muted-foreground">Gère tes comptes sociaux et leurs statuts</p>
        </div>
        <div className="flex gap-2">
          <Button
            data-testid="button-connect-instagram"
            variant="outline"
            className="border-pink-500/30 text-pink-400 hover:bg-pink-500/10 hover:text-pink-300"
            onClick={() => setShowInstagramDialog(true)}
          >
            <Instagram className="w-4 h-4 mr-2" />Instagram
          </Button>
          <Button data-testid="button-add-account" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />Ajouter
          </Button>
        </div>
      </div>

      <InstagramConnectDialog
        open={showInstagramDialog}
        onOpenChange={setShowInstagramDialog}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
          qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
        }}
      />

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Aucun compte configuré</p>
          <p className="text-sm">Clique sur "Ajouter un compte" pour commencer</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map((account: any) => {
            const cfg = getPlatformConfig(account.platform);
            const Icon = cfg.icon;
            const isConnected = account.status === "connected";
            return (
              <Card key={account.id} data-testid={`account-card-${account.id}`} className="bg-card/60 border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center border", cfg.bg, cfg.border)}>
                      <Icon className={cn("w-5 h-5", cfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{account.accountName}</div>
                      {account.accountHandle && <div className="text-xs text-muted-foreground">@{account.accountHandle}</div>}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{(account.followersCount || 0).toLocaleString("fr-FR")} abonnés</span>
                        <span className={cn("flex items-center gap-1", isConnected ? "text-green-400" : "text-gray-400")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-green-400" : "bg-gray-400")} />
                          {isConnected ? "Connecté" : "Déconnecté"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        data-testid={`switch-account-${account.id}`}
                        checked={isConnected}
                        onCheckedChange={(v) => toggleStatus.mutate({ id: account.id, status: v ? "connected" : "disconnected" })}
                      />
                      <Button
                        data-testid={`button-delete-account-${account.id}`}
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                        onClick={() => deleteMutation.mutate(account.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* OAuth Info */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-300 mb-1">Publication réelle via OAuth</p>
              <p className="text-muted-foreground text-xs">
                Pour activer la publication directe, configure les clés OAuth de chaque plateforme dans les variables d'environnement (TWITTER_API_KEY, INSTAGRAM_ACCESS_TOKEN, etc.). Ulysse prendra en charge la publication automatique une fois les tokens configurés.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add account dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un compte social</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Plateforme</Label>
              <Select value={newAccount.platform} onValueChange={(v) => setNewAccount((p) => ({ ...p, platform: v }))}>
                <SelectTrigger data-testid="select-platform" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nom du compte</Label>
              <Input
                data-testid="input-account-name"
                placeholder="ex: SUGU Valentine"
                value={newAccount.accountName}
                onChange={(e) => setNewAccount((p) => ({ ...p, accountName: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Handle / Pseudo</Label>
              <Input
                data-testid="input-account-handle"
                placeholder="ex: @suguvallentine"
                value={newAccount.accountHandle}
                onChange={(e) => setNewAccount((p) => ({ ...p, accountHandle: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Nombre d'abonnés</Label>
              <Input
                data-testid="input-followers"
                type="number"
                value={newAccount.followersCount}
                onChange={(e) => setNewAccount((p) => ({ ...p, followersCount: parseInt(e.target.value) || 0 }))}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Annuler</Button>
              <Button
                data-testid="button-confirm-add-account"
                onClick={() => addMutation.mutate()}
                disabled={!newAccount.accountName || addMutation.isPending}
              >
                Ajouter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Analytics ────────────────────────────────────────────────
