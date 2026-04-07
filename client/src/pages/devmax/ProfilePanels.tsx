import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  Loader2,
  Activity,
  Shield,
  X,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUTH_API,
  devmaxFetch,
  devmaxApiRequest,
  useDevmaxAuth,
  timeAgo,
} from "./types";

export function MonComptePanel() {
  const { toast } = useToast();
  const { currentUser } = useDevmaxAuth();
  const [accountTab, setAccountTab] = useState<"profile" | "security" | "sessions">("profile");

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ["devmax", "me"],
    queryFn: () => devmaxFetch(`${AUTH_API}/me`).then(r => r.json()),
  });

  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (profile) {
      setFormData({
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        displayName: profile.displayName || "",
        email: profile.email || "",
        phone: profile.phone || "",
        bio: profile.bio || "",
        timezone: profile.timezone || "Europe/Paris",
        githubUsername: profile.githubUsername || "",
        avatarUrl: profile.avatarUrl || "",
        sshPublicKey: profile.sshPublicKey || "",
      });
    }
  }, [profile]);

  const updateProfile = useMutation({
    mutationFn: () => devmaxApiRequest("PUT", `${AUTH_API}/me`, formData),
    onSuccess: () => { toast({ title: "Profil mis à jour" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const changePin = useMutation({
    mutationFn: () => {
      if (newPin !== confirmPin) throw new Error("Les PINs ne correspondent pas");
      return devmaxApiRequest("PUT", `${AUTH_API}/me/pin`, { currentPin: currentPin || undefined, newPin });
    },
    onSuccess: () => { toast({ title: "PIN modifié" }); setCurrentPin(""); setNewPin(""); setConfirmPin(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const changePassword = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) throw new Error("Les mots de passe ne correspondent pas");
      return devmaxApiRequest("PUT", `${AUTH_API}/me/password`, { currentPassword: currentPassword || undefined, newPassword });
    },
    onSuccess: () => { toast({ title: "Mot de passe modifié" }); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const [newLoginId, setNewLoginId] = useState("");
  const changeLoginId = useMutation({
    mutationFn: () => devmaxApiRequest("PUT", `${AUTH_API}/me/login-id`, { loginId: newLoginId }),
    onSuccess: () => { toast({ title: "Login ID mis à jour" }); setNewLoginId(""); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const revokeSession = useMutation({
    mutationFn: (sid: string) => devmaxApiRequest("DELETE", `${AUTH_API}/me/sessions/${sid}`),
    onSuccess: () => { toast({ title: "Session révoquée" }); refetch(); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>;
  }

  return (
    <div className="space-y-4" data-testid="mon-compte-panel">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center text-2xl font-bold text-emerald-400" data-testid="account-avatar">
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="Avatar" className="w-14 h-14 rounded-xl object-cover" />
          ) : (
            (profile?.firstName?.[0] || profile?.username?.[0] || "U").toUpperCase()
          )}
        </div>
        <div>
          <h2 className="text-lg font-bold text-white" data-testid="text-account-name">{profile?.displayName || profile?.username}</h2>
          <p className="text-sm text-zinc-400">{profile?.email || "Pas d'email"} · {profile?.role || "user"}</p>
          <div className="flex gap-2 mt-1">
            <Badge variant="secondary" className="text-[10px]">{profile?.projectCount || 0} projets</Badge>
            <Badge variant="secondary" className="text-[10px]">{profile?.activeSessions || 0} sessions</Badge>
            {profile?.hasPin && <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400">PIN actif</Badge>}
            {profile?.hasPassword && <Badge className="text-[10px] bg-blue-500/20 text-blue-400">Mot de passe actif</Badge>}
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-zinc-900/50 rounded-lg" data-testid="account-sub-tabs">
        {(["profile", "security", "sessions"] as const).map(tab => (
          <button key={tab} onClick={() => setAccountTab(tab)} className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all", accountTab === tab ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500 hover:text-zinc-300")} data-testid={`button-account-tab-${tab}`}>
            {tab === "profile" ? "Profil" : tab === "security" ? "Sécurité" : "Sessions"}
          </button>
        ))}
      </div>

      {accountTab === "profile" && (
        <Card className="bg-zinc-900/50 border-zinc-800" data-testid="account-profile-section">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Informations personnelles</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Prénom</label>
                <Input value={formData.firstName || ""} onChange={e => setFormData(p => ({ ...p, firstName: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-first-name" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Nom</label>
                <Input value={formData.lastName || ""} onChange={e => setFormData(p => ({ ...p, lastName: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-last-name" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Nom d'affichage</label>
              <Input value={formData.displayName || ""} onChange={e => setFormData(p => ({ ...p, displayName: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-display-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Email</label>
                <Input type="email" value={formData.email || ""} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-email" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Téléphone</label>
                <Input value={formData.phone || ""} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-phone" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Bio</label>
              <Textarea value={formData.bio || ""} onChange={e => setFormData(p => ({ ...p, bio: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm min-h-[60px]" data-testid="input-bio" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">GitHub Username</label>
                <Input value={formData.githubUsername || ""} onChange={e => setFormData(p => ({ ...p, githubUsername: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-github-username" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Fuseau horaire</label>
                <Input value={formData.timezone || ""} onChange={e => setFormData(p => ({ ...p, timezone: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-timezone" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">URL Avatar</label>
              <Input value={formData.avatarUrl || ""} onChange={e => setFormData(p => ({ ...p, avatarUrl: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-avatar-url" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Clé SSH publique</label>
              <Textarea value={formData.sshPublicKey || ""} onChange={e => setFormData(p => ({ ...p, sshPublicKey: e.target.value }))} className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm font-mono text-[10px] min-h-[50px]" data-testid="input-ssh-key" />
            </div>
            <Button onClick={() => updateProfile.mutate()} disabled={updateProfile.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="button-save-profile">
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Sauvegarder
            </Button>
          </CardContent>
        </Card>
      )}

      {accountTab === "security" && (
        <div className="space-y-4" data-testid="account-security-section">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Login ID</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-zinc-500">Login actuel : <span className="text-zinc-300 font-mono">{profile?.loginId || "Non défini"}</span></p>
              <div className="flex gap-2">
                <Input value={newLoginId} onChange={e => setNewLoginId(e.target.value)} placeholder="Nouveau Login ID" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8 flex-1" data-testid="input-new-login-id" />
                <Button onClick={() => changeLoginId.mutate()} disabled={!newLoginId || changeLoginId.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-change-login-id">
                  {changeLoginId.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Modifier"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Changer le PIN</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {profile?.hasPin && (
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">PIN actuel</label>
                  <Input type="password" value={currentPin} onChange={e => setCurrentPin(e.target.value)} placeholder="••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-current-pin" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Nouveau PIN (4-8 chiffres)</label>
                  <Input type="password" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-new-pin" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Confirmer</label>
                  <Input type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-confirm-pin" />
                </div>
              </div>
              <Button onClick={() => changePin.mutate()} disabled={!newPin || newPin.length < 4 || newPin !== confirmPin || changePin.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-change-pin">
                {changePin.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Lock className="w-3.5 h-3.5 mr-2" />}
                Modifier le PIN
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Mot de passe</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {profile?.hasPassword && (
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Mot de passe actuel</label>
                  <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-current-password" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Nouveau mot de passe (8+ car.)</label>
                  <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-new-password" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Confirmer</label>
                  <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" className="bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-white text-sm h-8" data-testid="input-confirm-password" />
                </div>
              </div>
              <Button onClick={() => changePassword.mutate()} disabled={!newPassword || newPassword.length < 8 || newPassword !== confirmPassword || changePassword.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-change-password">
                {changePassword.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Shield className="w-3.5 h-3.5 mr-2" />}
                Modifier le mot de passe
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {accountTab === "sessions" && (
        <Card className="bg-zinc-900/50 border-zinc-800" data-testid="account-sessions-section">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Sessions actives ({profile?.activeSessions || 0})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {profile?.sessions?.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-200/50 dark:bg-zinc-800/50 rounded-lg p-3 text-xs" data-testid={`session-${s.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-300 font-mono truncate">{s.id.slice(0, 12)}...</div>
                  <div className="text-zinc-500 mt-0.5">{s.user_agent?.slice(0, 50) || "Inconnu"}</div>
                  <div className="text-zinc-500">{s.ip_address || "IP inconnue"} · Dernière activité: {s.last_active_at ? timeAgo(s.last_active_at) : "?"}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revokeSession.mutate(s.id)} disabled={revokeSession.isPending} className="text-red-400 hover:text-red-300 hover:bg-red-500/10" data-testid={`button-revoke-session-${s.id}`}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {(!profile?.sessions || profile.sessions.length === 0) && (
              <p className="text-zinc-500 text-sm">Aucune session active</p>
            )}
          </CardContent>
        </Card>
      )}

      {profile?.recentActivity && profile.recentActivity.length > 0 && (
        <Card className="bg-zinc-900/50 border-zinc-800" data-testid="account-activity-section">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-zinc-300">Activité récente</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {profile.recentActivity.slice(0, 10).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                  <Activity className="w-3 h-3 text-zinc-600" />
                  <span className="text-zinc-300">{a.action}</span>
                  <span className="text-zinc-500">{a.target}</span>
                  <span className="ml-auto text-zinc-600">{a.created_at ? timeAgo(a.created_at) : ""}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
