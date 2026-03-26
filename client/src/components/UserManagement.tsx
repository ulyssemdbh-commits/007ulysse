import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Plus, Pencil, Trash2, Eye, EyeOff, X, Check, Loader2, Shield, Crown, KeyRound } from "lucide-react";

interface AppUser {
  id: number;
  username: string;
  plainPassword: string | null;
  displayName: string | null;
  role: string;
  isOwner: boolean;
  createdAt: string;
}

const roleLabels: Record<string, string> = {
  admin: "Admin",
  owner: "Propriétaire",
  approved: "Approuvé",
  guest: "Invité",
  external: "Externe",
};

const roleBadge = (role: string, isOwner: boolean) => {
  if (isOwner) return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (role === "approved" || role === "admin") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (role === "external") return "bg-blue-500/10 text-blue-600 border-blue-500/20";
  return "bg-slate-500/10 text-slate-600 border-slate-500/20";
};

export function UserManagement() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [formData, setFormData] = useState({ username: "", password: "", displayName: "", role: "approved" });
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery<AppUser[]>({
    queryKey: ["/api/auth/all-users"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/auth/create-user", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/all-users"] });
      toast({ title: "Utilisateur créé" });
      resetForm();
    },
    onError: async (err: any) => {
      let msg = "Erreur";
      try { const r = await err.json?.(); msg = r?.error || msg; } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<typeof formData> }) =>
      apiRequest("PUT", `/api/auth/update-user/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/all-users"] });
      toast({ title: editingUser?.isOwner ? "Mot de passe modifié" : "Utilisateur modifié" });
      resetForm();
    },
    onError: () => toast({ title: "Erreur modification", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/auth/delete-user/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/all-users"] });
      toast({ title: "Utilisateur supprimé" });
      setConfirmDelete(null);
    },
    onError: () => toast({ title: "Erreur suppression", variant: "destructive" }),
  });

  const resetForm = () => {
    setFormData({ username: "", password: "", displayName: "", role: "approved" });
    setShowForm(false);
    setEditingUser(null);
    setShowPassword(false);
  };

  const startEdit = (u: AppUser) => {
    setEditingUser(u);
    setFormData({ username: u.username, password: u.isOwner ? "" : (u.plainPassword || ""), displayName: u.displayName || "", role: u.role });
    setShowForm(true);
    setShowPassword(u.isOwner ? false : true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      const updates: any = {};
      if (editingUser.isOwner) {
        if (!formData.password || formData.password.length < 4) {
          toast({ title: "Le mot de passe doit contenir au moins 4 caractères", variant: "destructive" });
          return;
        }
        updates.password = formData.password;
      } else {
        if (formData.username !== editingUser.username) updates.username = formData.username;
        if (formData.displayName !== (editingUser.displayName || "")) updates.displayName = formData.displayName;
        if (formData.password && formData.password !== (editingUser.plainPassword || "")) updates.password = formData.password;
      }
      if (Object.keys(updates).length === 0) {
        toast({ title: "Aucune modification" });
        return;
      }
      updateMutation.mutate({ id: editingUser.id, data: updates });
    } else {
      if (!formData.username || !formData.password) {
        toast({ title: "Nom d'utilisateur et mot de passe requis", variant: "destructive" });
        return;
      }
      createMutation.mutate(formData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2" data-testid="title-user-management">
              <Users className="h-5 w-5" />
              Gestion des utilisateurs
            </CardTitle>
            <CardDescription>Ajoutez, modifiez ou supprimez les accès à l'application</CardDescription>
          </div>
          {!showForm && (
            <Button
              data-testid="btn-add-user"
              onClick={() => { resetForm(); setShowForm(true); }}
              size="sm"
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <form onSubmit={handleSubmit} className="p-4 rounded-xl border bg-muted/30 space-y-3" data-testid="form-user">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold">
                {editingUser?.isOwner ? "Changer le mot de passe" : editingUser ? `Modifier — ${editingUser.username}` : "Nouvel utilisateur"}
              </h4>
              <button type="button" onClick={resetForm} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!(editingUser?.isOwner) && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nom d'utilisateur</label>
                  <input
                    data-testid="input-username"
                    type="text"
                    value={formData.username}
                    onChange={e => setFormData(f => ({ ...f, username: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="identifiant"
                    required={!editingUser}
                  />
                </div>
              )}
              <div className={editingUser?.isOwner ? "sm:col-span-2" : ""}>
                <label className="text-xs text-muted-foreground mb-1 block">
                  {editingUser?.isOwner ? "Nouveau mot de passe" : <>Mot de passe {editingUser && <span className="text-muted-foreground/60">(laisser vide pour ne pas changer)</span>}</>}
                </label>
                <div className="relative">
                  <input
                    data-testid="input-password"
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={e => setFormData(f => ({ ...f, password: e.target.value }))}
                    className="w-full px-3 py-2 pr-10 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder={editingUser?.isOwner ? "nouveau mot de passe" : editingUser ? "••••••" : "mot de passe"}
                    required={editingUser?.isOwner || !editingUser}
                    minLength={4}
                    autoFocus={!!editingUser?.isOwner}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    data-testid="btn-toggle-password"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {!(editingUser?.isOwner) && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nom affiché</label>
                  <input
                    data-testid="input-displayname"
                    type="text"
                    value={formData.displayName}
                    onChange={e => setFormData(f => ({ ...f, displayName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="Nom affiché"
                  />
                </div>
              )}
              {!editingUser && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Rôle</label>
                  <select
                    data-testid="select-role"
                    value={formData.role}
                    onChange={e => setFormData(f => ({ ...f, role: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="approved">Approuvé</option>
                    <option value="guest">Invité</option>
                    <option value="external">Externe</option>
                  </select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>Annuler</Button>
              <Button type="submit" size="sm" disabled={isPending} data-testid="btn-submit-user" className="gap-1.5">
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {editingUser ? "Enregistrer" : "Créer"}
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement...
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Aucun utilisateur</p>
        ) : (
          <div className="divide-y rounded-xl border overflow-hidden">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition" data-testid={`row-user-${u.id}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex items-center justify-center w-9 h-9 rounded-full ${u.isOwner ? "bg-amber-500/10" : "bg-primary/10"}`}>
                    {u.isOwner ? <Crown className="h-4 w-4 text-amber-600" /> : <Shield className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{u.displayName || u.username}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${roleBadge(u.role, u.isOwner)}`}>
                        {u.isOwner ? "Owner" : roleLabels[u.role] || u.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="truncate">@{u.username} · ID: {u.id}</span>
                      {u.plainPassword && (
                        <button
                          type="button"
                          onClick={() => setShowPasswords(p => ({ ...p, [u.id]: !p[u.id] }))}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 transition text-[10px] font-medium shrink-0"
                          data-testid={`btn-show-pw-${u.id}`}
                        >
                          {showPasswords[u.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {showPasswords[u.id] ? u.plainPassword : "•••••"}
                        </button>
                      )}
                      {!u.plainPassword && !u.isOwner && (
                        <span className="text-[10px] text-muted-foreground/50 italic">mdp non enregistré</span>
                      )}
                    </div>
                  </div>
                </div>
                {u.isOwner && (
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      data-testid={`btn-change-pw-owner`}
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => startEdit(u)}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Changer mdp
                    </Button>
                  </div>
                )}
                {!u.isOwner && (
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      data-testid={`btn-edit-user-${u.id}`}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => startEdit(u)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {confirmDelete === u.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          data-testid={`btn-confirm-delete-${u.id}`}
                          variant="destructive"
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => deleteMutation.mutate(u.id)}
                          disabled={deleteMutation.isPending}
                        >
                          {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Confirmer
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setConfirmDelete(null)}>Non</Button>
                      </div>
                    ) : (
                      <Button
                        data-testid={`btn-delete-user-${u.id}`}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(u.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
