import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Users, FolderGit2, Activity, Globe, Shield, Plus, Trash2,
  Edit3, Eye, RefreshCw, Loader2, Lock, CheckCircle2, XCircle,
  Clock, Terminal, Rocket, ArrowLeft, BarChart3, Settings,
  MessageSquare, BookOpen, ExternalLink, Building2, Key, Mail,
  UserPlus, Crown, CreditCard, Zap, Send, Copy, AlertTriangle,
  TrendingUp, Database, Search, ChevronDown, ChevronRight,
  FileText, Server, ShieldCheck, MoreVertical, Link2, Cpu, Layers,
  Plug, Power, TestTube, Cloud, Phone, Hash, HardDrive, Calendar,
  Music, MessageCircle, Triangle, Flame, Link, CheckSquare,
} from "lucide-react";

const API = "/api/devmax";
const ADMIN_TOKEN_KEY = "devmax_admin_token";

function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

async function adminFetch(url: string, opts: RequestInit = {}) {
  const token = getAdminToken();
  return fetch(url, {
    ...opts,
    headers: { ...opts.headers as any, "x-devmax-admin": token || "", "Content-Type": "application/json" },
  });
}

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Spinner() {
  return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
}

const PLAN_COLORS: Record<string, string> = {
  free: "border-gray-500/50 text-gray-400",
  starter: "border-blue-500/50 text-blue-400",
  pro: "border-purple-500/50 text-purple-400",
  enterprise: "border-amber-500/50 text-amber-400",
};

const PLAN_LABELS: Record<string, string> = {
  free: "Free", starter: "Starter", pro: "Pro", enterprise: "Enterprise"
};

const INTEGRATION_ICONS: Record<string, any> = {
  Mail, BookOpen, Music, MessageCircle, Github: Globe, HardDrive, Calendar,
  CreditCard, CheckSquare, Hash, Cpu, Triangle, Database, Phone, Send,
  Cloud, Flame, Link,
};

const CATEGORY_COLORS: Record<string, string> = {
  communication: "text-blue-400", productivity: "text-green-400", media: "text-pink-400",
  development: "text-gray-300", storage: "text-cyan-400", payment: "text-yellow-400",
  ai: "text-purple-400", deployment: "text-orange-400", database: "text-emerald-400",
  custom: "text-gray-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  communication: "Communication", productivity: "Productivité", media: "Média",
  development: "Développement", storage: "Stockage", payment: "Paiement",
  ai: "Intelligence Artificielle", deployment: "Déploiement", database: "Base de données",
  custom: "Personnalisé",
};

const STATUS_STYLES: Record<string, { border: string; text: string; label: string }> = {
  connected: { border: "border-emerald-500/50", text: "text-emerald-400", label: "Connecté" },
  disconnected: { border: "border-gray-500/50", text: "text-gray-400", label: "Déconnecté" },
  error: { border: "border-red-500/50", text: "text-red-400", label: "Erreur" },
};

function AdminLoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!pin) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/admin/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) { setError("PIN invalide"); return; }
      const data = await res.json();
      localStorage.setItem(ADMIN_TOKEN_KEY, data.sessionId);
      onLogin(data.sessionId);
    } catch { setError("Erreur de connexion"); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-black flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
        <Card className="w-[420px] bg-white/90 dark:bg-gray-900/80 border-red-500/30 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-xl bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
              DevMax Platform Admin
            </CardTitle>
            <p className="text-xs text-gray-500 mt-1">Multi-tenant management &amp; monitoring</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input type="password" placeholder="Admin PIN..." value={pin}
              onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
              className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-center text-lg tracking-widest" data-testid="input-admin-pin" />
            {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            <Button className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500"
              onClick={handleLogin} disabled={loading || !pin} data-testid="button-admin-login">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
              Connexion Admin
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function PlatformHealthCards({ health }: { health: any }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!health) return null;
  const groups = [
    { title: "Tenants & Plans", items: [
      { label: "Tenants", value: health.total_tenants || 0, icon: Building2, color: "text-orange-400", bg: "from-orange-500 to-red-500" },
      { label: "Free", value: health.free_tenants || 0, icon: Zap, color: "text-gray-400", bg: "from-gray-500 to-gray-600" },
      { label: "Pro", value: health.pro_tenants || 0, icon: Crown, color: "text-purple-400", bg: "from-purple-500 to-violet-500" },
      { label: "Enterprise", value: health.enterprise_tenants || 0, icon: Building2, color: "text-amber-400", bg: "from-amber-500 to-orange-500" },
    ]},
    { title: "Users & Sessions", items: [
      { label: "Users", value: health.total_users || 0, icon: Users, color: "text-blue-400", bg: "from-blue-500 to-cyan-500" },
      { label: "Actifs", value: health.active_users || 0, icon: CheckCircle2, color: "text-green-400", bg: "from-green-500 to-emerald-500" },
      { label: "Sessions", value: health.active_sessions || 0, icon: Terminal, color: "text-cyan-400", bg: "from-cyan-500 to-blue-500" },
      { label: "API Keys", value: health.active_api_keys || 0, icon: Key, color: "text-yellow-400", bg: "from-yellow-500 to-amber-500" },
    ]},
    { title: "Projects & Usage", items: [
      { label: "Projets", value: health.total_projects || 0, icon: FolderGit2, color: "text-purple-400", bg: "from-purple-500 to-violet-500" },
      { label: "Deployes", value: health.deployed_projects || 0, icon: Rocket, color: "text-emerald-400", bg: "from-emerald-500 to-green-500" },
      { label: "Usage 24h", value: health.usage_24h || 0, icon: Activity, color: "text-pink-400", bg: "from-pink-500 to-rose-500" },
      { label: "Usage 7j", value: health.usage_7d || 0, icon: TrendingUp, color: "text-teal-400", bg: "from-teal-500 to-emerald-500" },
    ]},
  ];

  const toggleAll = () => {
    const allExpanded = groups.every(g => expanded[g.title]);
    const next: Record<string, boolean> = {};
    groups.forEach(g => { next[g.title] = !allExpanded; });
    setExpanded(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={toggleAll} className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1" data-testid="btn-toggle-all-stats">
          {groups.every(g => expanded[g.title]) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {groups.every(g => expanded[g.title]) ? "Tout replier" : "Tout deplier"}
        </button>
      </div>
      {groups.map(g => (
        <div key={g.title}>
          <button onClick={() => setExpanded(prev => ({ ...prev, [g.title]: !prev[g.title] }))} className="flex items-center gap-1.5 w-full text-left group cursor-pointer" data-testid={`btn-toggle-${g.title.replace(/\s+/g, "-").toLowerCase()}`}>
            {expanded[g.title] ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold group-hover:text-gray-300 transition-colors">{g.title}</h3>
            {!expanded[g.title] && (
              <span className="text-xs text-gray-600 ml-2">
                {g.items.map(item => `${item.label}: ${item.value}`).join(" · ")}
              </span>
            )}
          </button>
          <AnimatePresence>
            {expanded[g.title] && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  {g.items.map((item, i) => (
                    <motion.div key={item.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                      <Card className="overflow-hidden hover:shadow-lg transition-shadow bg-white/90 dark:bg-gray-900/60 border-gray-200 dark:border-gray-700">
                        <div className={`h-0.5 bg-gradient-to-r ${item.bg}`} />
                        <CardContent className="p-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <item.icon className={`w-4 h-4 ${item.color}`} />
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{item.label}</span>
                          </div>
                          <p className="text-2xl font-black text-gray-900 dark:text-white">{item.value}</p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function TenantsPanel() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "", slug: "", plan: "free", billingEmail: "", ownerId: "", trialMonths: "1",
    productionUrl: "", stagingUrl: "",
    githubOrg: "", githubRepo: "", githubToken: "",
    contactName: "", contactEmail: "", contactPhone: "", address: "",
    stripeCustomerId: "", paymentMethod: "none"
  });
  const [editMode, setEditMode] = useState(false);
  const [editCreds, setEditCreds] = useState(false);
  const [credsForm, setCredsForm] = useState({ login: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "member" });
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyForm, setApiKeyForm] = useState({ name: "", expiresInDays: "90" });
  const [newApiKey, setNewApiKey] = useState("");
  const [showAssign, setShowAssign] = useState(false);
  const [search, setSearch] = useState("");
  const [showAddIntegration, setShowAddIntegration] = useState(false);
  const [integrationCatalog, setIntegrationCatalog] = useState<any[]>([]);
  const [editingIntegration, setEditingIntegration] = useState<any>(null);
  const [integrationCreds, setIntegrationCreds] = useState<Record<string, string>>({});
  const [integrationFilter, setIntegrationFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, uRes, pRes] = await Promise.all([
        adminFetch(`${API}/admin/tenants`),
        adminFetch(`${API}/admin/users`),
        adminFetch(`${API}/admin/projects`),
      ]);
      if (tRes.ok) setTenants(await tRes.json());
      if (uRes.ok) { const d = await uRes.json(); setUsers(d.users || []); }
      if (pRes.ok) setAllProjects(await pRes.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (tenantId: string) => {
    try {
      const res = await adminFetch(`${API}/admin/tenants/${tenantId}?_t=${Date.now()}`);
      if (res.ok) setDetail(await res.json());
    } catch {}
  };

  const createTenant = async () => {
    if (!form.name || !form.slug) return;
    try {
      await adminFetch(`${API}/admin/tenants`, {
        method: "POST",
        body: JSON.stringify({ ...form, trialMonths: parseInt(form.trialMonths) || 0 }),
      });
      setShowCreate(false);
      setForm({
        name: "", slug: "", plan: "free", billingEmail: "", ownerId: "", trialMonths: "1",
        productionUrl: "", stagingUrl: "",
        githubOrg: "", githubRepo: "", githubToken: "",
        contactName: "", contactEmail: "", contactPhone: "", address: "",
        stripeCustomerId: "", paymentMethod: "none"
      });
      load();
    } catch {}
  };

  const updateTenant = async () => {
    if (!detail?.tenant?.id) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name, plan: form.plan, billingEmail: form.billingEmail,
          productionUrl: form.productionUrl, stagingUrl: form.stagingUrl,
          githubOrg: form.githubOrg, githubRepo: form.githubRepo, githubToken: form.githubToken,
          contactName: form.contactName, contactEmail: form.contactEmail, contactPhone: form.contactPhone,
          address: form.address, stripeCustomerId: form.stripeCustomerId, paymentMethod: form.paymentMethod
        }),
      });
      setEditMode(false);
      loadDetail(detail.tenant.id);
      load();
    } catch {}
  };

  const updateCredentials = async () => {
    if (!detail?.tenant?.id || !credsForm.password?.trim()) return;
    try {
      const body: any = { credentialPassword: credsForm.password.trim() };
      if (credsForm.login?.trim()) body.credentialLogin = credsForm.login.trim();
      const res = await adminFetch(`${API}/admin/tenants/${detail.tenant.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadDetail(detail.tenant.id);
        setEditCreds(false);
        setShowPassword(false);
      }
    } catch {}
  };

  const deleteTenant = async (id: string) => {
    if (!confirm("Supprimer ce tenant et dissocier tous les projets/utilisateurs ?")) return;
    try {
      await adminFetch(`${API}/admin/tenants/${id}`, { method: "DELETE" });
      setDetail(null);
      load();
    } catch {}
  };

  const addMember = async (userId: string, role: string) => {
    if (!detail?.tenant?.id) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/members`, {
        method: "POST", body: JSON.stringify({ userId, role }),
      });
      loadDetail(detail.tenant.id);
    } catch {}
  };

  const removeMember = async (userId: string) => {
    if (!detail?.tenant?.id || !confirm("Retirer ce membre ?")) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/members/${userId}`, { method: "DELETE" });
      loadDetail(detail.tenant.id);
    } catch {}
  };

  const sendInvite = async () => {
    if (!detail?.tenant?.id || !inviteForm.email) return;
    try {
      await adminFetch(`${API}/admin/invitations`, {
        method: "POST",
        body: JSON.stringify({ tenantId: detail.tenant.id, email: inviteForm.email, role: inviteForm.role }),
      });
      setShowInvite(false);
      setInviteForm({ email: "", role: "member" });
      loadDetail(detail.tenant.id);
    } catch {}
  };

  const createApiKey = async () => {
    if (!detail?.tenant?.id || !apiKeyForm.name) return;
    try {
      const res = await adminFetch(`${API}/admin/api-keys`, {
        method: "POST",
        body: JSON.stringify({ tenantId: detail.tenant.id, name: apiKeyForm.name, expiresInDays: parseInt(apiKeyForm.expiresInDays) || 90 }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewApiKey(data.key);
        setApiKeyForm({ name: "", expiresInDays: "90" });
        loadDetail(detail.tenant.id);
      }
    } catch {}
  };

  const deleteApiKey = async (keyId: string) => {
    if (!confirm("Supprimer cette cle API ?")) return;
    try {
      await adminFetch(`${API}/admin/api-keys/${keyId}`, { method: "DELETE" });
      loadDetail(detail.tenant.id);
    } catch {}
  };

  const toggleApiKey = async (keyId: string) => {
    try {
      await adminFetch(`${API}/admin/api-keys/${keyId}/toggle`, { method: "PUT" });
      loadDetail(detail.tenant.id);
    } catch {}
  };

  const assignProject = async (projectId: string) => {
    if (!detail?.tenant?.id) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/assign-project`, {
        method: "POST", body: JSON.stringify({ projectId }),
      });
      setShowAssign(false);
      loadDetail(detail.tenant.id);
      load();
    } catch {}
  };

  const deleteInvitation = async (invId: string) => {
    try {
      await adminFetch(`${API}/admin/invitations/${invId}`, { method: "DELETE" });
      loadDetail(detail.tenant.id);
    } catch {}
  };

  const loadCatalog = async () => {
    try {
      const res = await adminFetch(`${API}/admin/integration-catalog`);
      if (res.ok) { const data = await res.json(); setIntegrationCatalog(data.catalog || []); }
    } catch {}
  };

  const addIntegration = async (service: string) => {
    if (!detail?.tenant?.id) return;
    try {
      const res = await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/integrations`, {
        method: "POST", body: JSON.stringify({ service, credentials: integrationCreds }),
      });
      if (res.ok) {
        setShowAddIntegration(false);
        setIntegrationCreds({});
        setIntegrationFilter("");
        await loadDetail(detail.tenant.id);
      }
    } catch {}
  };

  const updateIntegration = async (integrationId: string) => {
    if (!detail?.tenant?.id) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/integrations/${integrationId}`, {
        method: "PUT", body: JSON.stringify({ credentials: integrationCreds }),
      });
      setEditingIntegration(null);
      setIntegrationCreds({});
      await loadDetail(detail.tenant.id);
    } catch {}
  };

  const toggleIntegration = async (integrationId: string, enabled: boolean) => {
    if (!detail?.tenant?.id) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/integrations/${integrationId}`, {
        method: "PUT", body: JSON.stringify({ enabled }),
      });
      await loadDetail(detail.tenant.id);
    } catch {}
  };

  const deleteIntegration = async (integrationId: string) => {
    if (!detail?.tenant?.id || !confirm("Supprimer cette intégration ?")) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/integrations/${integrationId}`, { method: "DELETE" });
      await loadDetail(detail.tenant.id);
    } catch {}
  };

  const testIntegration = async (integrationId: string) => {
    if (!detail?.tenant?.id) return;
    try {
      await adminFetch(`${API}/admin/tenants/${detail.tenant.id}/integrations/${integrationId}/test`, { method: "POST" });
      await loadDetail(detail.tenant.id);
    } catch {}
  };

  if (loading) return <Spinner />;

  if (detail) {
    const t = detail.tenant;
    const limits = typeof t.plan_limits === "string" ? JSON.parse(t.plan_limits) : (t.plan_limits || {});
    const memberIds = new Set((detail.members || []).map((m: any) => m.user_id));
    const availableUsers = users.filter(u => !memberIds.has(u.id));
    const unassignedProjects = allProjects.filter((p: any) => p.tenant_id !== t.id);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setDetail(null); setEditMode(false); }} data-testid="btn-back-tenants">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Tenants
          </Button>
          <span className="text-gray-500">/</span>
          <span className="font-semibold text-sm">{t.name}</span>
          <Badge variant="outline" className={`text-xs ${PLAN_COLORS[t.plan] || PLAN_COLORS.free}`}>{PLAN_LABELS[t.plan] || t.plan}</Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4 text-orange-400" /> Details du tenant</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditMode(!editMode); setForm({
                    name: t.name, slug: t.slug, plan: t.plan, billingEmail: t.billing_email || "", ownerId: t.owner_id || "", trialMonths: "",
                    productionUrl: t.production_url || "", stagingUrl: t.staging_url || "",
                    githubOrg: t.github_org || "", githubRepo: t.github_repo || "", githubToken: t.github_token || "",
                    contactName: t.contact_name || "", contactEmail: t.contact_email || "", contactPhone: t.contact_phone || "",
                    address: t.address || "", stripeCustomerId: t.stripe_customer_id || "", paymentMethod: t.payment_method || "none"
                  }); }} data-testid="btn-edit-tenant">
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-400" onClick={() => deleteTenant(t.id)} data-testid="btn-delete-tenant">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {editMode ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Identite</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Input placeholder="Nom" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                      <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} className="h-9 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-md px-3 text-sm cursor-pointer appearance-auto focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                        <option value="free">Free</option>
                        <option value="starter">Starter</option>
                        <option value="pro">Pro</option>
                        <option value="enterprise">Enterprise</option>
                      </select>
                      <Input placeholder="Email facturation" type="email" value={form.billingEmail} onChange={e => setForm(f => ({ ...f, billingEmail: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Deployments</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Input placeholder="URL Production" value={form.productionUrl} onChange={e => setForm(f => ({ ...f, productionUrl: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 font-mono text-xs" />
                      <Input placeholder="URL Staging" value={form.stagingUrl} onChange={e => setForm(f => ({ ...f, stagingUrl: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 font-mono text-xs" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">GitHub</p>
                    <div className="grid grid-cols-3 gap-3">
                      <Input placeholder="Organisation" value={form.githubOrg} onChange={e => setForm(f => ({ ...f, githubOrg: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                      <Input placeholder="Repo" value={form.githubRepo} onChange={e => setForm(f => ({ ...f, githubRepo: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 font-mono" />
                      <Input placeholder="Token" type="password" value={form.githubToken} onChange={e => setForm(f => ({ ...f, githubToken: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact & Adresse</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Input placeholder="Nom du contact" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                      <Input placeholder="Email contact" type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                      <Input placeholder="Telephone" type="tel" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700" />
                      <Input placeholder="Adresse postale" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 md:col-span-2" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Paiement</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Input placeholder="Stripe Customer ID" value={form.stripeCustomerId} onChange={e => setForm(f => ({ ...f, stripeCustomerId: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 font-mono text-xs" />
                      <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} className="h-9 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-md px-3 text-sm cursor-pointer appearance-auto focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                        <option value="none">Pas de paiement</option>
                        <option value="stripe">Stripe</option>
                        <option value="invoice">Facture manuelle</option>
                        <option value="bank_transfer">Virement bancaire</option>
                        <option value="other">Autre</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={updateTenant}><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Sauvegarder</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Annuler</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div><span className="text-gray-500 dark:text-gray-400">Slug:</span> <span className="font-mono text-blue-400 dark:text-blue-300">{t.slug}</span></div>
                    <div><span className="text-gray-500">Owner:</span> <span>{t.owner_display_name || t.owner_username || "—"}</span></div>
                    <div><span className="text-gray-500">Billing:</span> <span>{t.billing_email || "—"}</span></div>
                    <div><span className="text-gray-500">Status:</span> <Badge variant="outline" className={`text-xs ${t.billing_status === "active" ? "border-green-500/50 text-green-400" : "border-red-500/50 text-red-400"}`}>{t.billing_status}</Badge></div>
                    <div><span className="text-gray-500">Trial:</span> <span>{t.trial_ends_at ? fmt(t.trial_ends_at) : "—"}</span></div>
                    <div><span className="text-gray-500">Cree:</span> <span>{fmt(t.created_at)}</span></div>
                  </div>
                  {(t.production_url || t.staging_url) && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div><span className="text-gray-500">Production:</span> {t.production_url ? <a href={t.production_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline font-mono">{t.production_url}</a> : <span>—</span>}</div>
                      <div><span className="text-gray-500">Staging:</span> {t.staging_url ? <a href={t.staging_url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline font-mono">{t.staging_url}</a> : <span>—</span>}</div>
                    </div>
                  )}
                  {(t.github_org || t.github_repo) && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div><span className="text-gray-500">GitHub:</span> <span className="font-mono">{t.github_org}{t.github_repo ? `/${t.github_repo}` : ""}</span></div>
                      <div><span className="text-gray-500">Token:</span> <span>{t.github_token ? "***configure***" : "—"}</span></div>
                    </div>
                  )}
                  {(t.contact_name || t.contact_email || t.contact_phone || t.address) && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      {t.contact_name && <div><span className="text-gray-500">Contact:</span> <span>{t.contact_name}</span></div>}
                      {t.contact_email && <div><span className="text-gray-500">Email:</span> <span>{t.contact_email}</span></div>}
                      {t.contact_phone && <div><span className="text-gray-500">Tel:</span> <span>{t.contact_phone}</span></div>}
                      {t.address && <div className="col-span-2"><span className="text-gray-500">Adresse:</span> <span>{t.address}</span></div>}
                    </div>
                  )}
                  {(t.stripe_customer_id || (t.payment_method && t.payment_method !== "none")) && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      {t.stripe_customer_id && <div><span className="text-gray-500">Stripe:</span> <span className="font-mono">{t.stripe_customer_id}</span></div>}
                      {t.payment_method && t.payment_method !== "none" && <div><span className="text-gray-500">Paiement:</span> <Badge variant="outline" className="text-xs">{t.payment_method}</Badge></div>}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs flex items-center gap-1"><CreditCard className="w-3.5 h-3.5 text-purple-400" /> Limites du plan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Projets max</span><span className="font-mono">{limits.max_projects === -1 ? "∞" : limits.max_projects}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Users max</span><span className="font-mono">{limits.max_users === -1 ? "∞" : limits.max_users}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Deploys/mois</span><span className="font-mono">{limits.max_deploys_month === -1 ? "∞" : limits.max_deploys_month}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Stockage</span><span className="font-mono">{limits.max_storage_gb} GB</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Domaine custom</span>{limits.custom_domain ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-gray-600" />}</div>
                <div className="flex justify-between"><span className="text-gray-500">Support prioritaire</span>{limits.priority_support ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-gray-600" />}</div>
                <div className="flex justify-between"><span className="text-gray-500">Acces API</span>{limits.api_access ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-gray-600" />}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white/90 dark:bg-gray-900/60 border-orange-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Lock className="w-3.5 h-3.5 text-orange-400" /> Credentials DevMax</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Login</p>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-sm text-orange-400" data-testid="text-cred-login">{t.credential_login || "—"}</span>
                  {t.credential_login && <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => navigator.clipboard.writeText(t.credential_login)}><Copy className="w-3 h-3 text-gray-500" /></Button>}
                </div>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Mot de passe</p>
                {editCreds ? (
                  <div className="flex items-center gap-1">
                    <Input type={showPassword ? "text" : "password"} value={credsForm.password} onChange={e => setCredsForm(f => ({ ...f, password: e.target.value }))} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 font-mono text-xs h-7 flex-1" data-testid="input-cred-password" />
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowPassword(!showPassword)}><Eye className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-400" onClick={updateCredentials} data-testid="btn-save-creds"><CheckCircle2 className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400" onClick={() => setEditCreds(false)}><XCircle className="w-3.5 h-3.5" /></Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm" data-testid="text-cred-password">{t.credential_password_is_set ? "••••••••••••" : "—"}</span>
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { setEditCreds(true); setCredsForm({ login: t.credential_login || "", password: "" }); setShowPassword(false); }} data-testid="btn-edit-creds"><Edit3 className="w-3 h-3 text-orange-400" /></Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Membres ({detail.members?.length || 0})</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowInvite(!showInvite)} data-testid="btn-invite-member">
                    <Mail className="w-3 h-3 mr-1" /> Inviter
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <AnimatePresence>
                {showInvite && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-3 space-y-2 mb-2 border border-gray-300 dark:border-gray-700">
                      <p className="text-xs font-semibold">Envoyer une invitation</p>
                      <div className="flex gap-2">
                        <Input placeholder="Email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-xs h-8" data-testid="input-invite-email" />
                        <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded px-2 text-xs h-8">
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <Button size="sm" className="h-8" onClick={sendInvite} data-testid="btn-send-invite"><Send className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {detail.members?.map((m: any) => (
                <div key={m.user_id} className="flex items-center gap-2 bg-gray-100/60 dark:bg-gray-800/30 rounded px-2.5 py-1.5 text-xs">
                  <div className={`w-7 h-7 rounded flex items-center justify-center text-white font-bold text-xs ${m.role === "owner" ? "bg-gradient-to-br from-amber-500 to-orange-600" : m.role === "admin" ? "bg-gradient-to-br from-red-500 to-pink-600" : "bg-gradient-to-br from-blue-500 to-cyan-600"}`}>
                    {(m.display_name || m.username || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold">{m.display_name || m.username}</span>
                    <Badge variant="outline" className={`text-xs ml-1.5 ${m.role === "owner" ? "border-amber-500/50 text-amber-400" : m.role === "admin" ? "border-red-500/50 text-red-400" : "border-blue-500/50 text-blue-400"}`}>{m.role}</Badge>
                    {m.email && <span className="text-gray-500 ml-1.5">{m.email}</span>}
                  </div>
                  {m.role !== "owner" && (
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={() => removeMember(m.user_id)}><Trash2 className="w-3 h-3" /></Button>
                  )}
                </div>
              ))}

              {availableUsers.length > 0 && (
                <div className="mt-2 border-t border-gray-200 dark:border-gray-800 pt-2">
                  <p className="text-xs text-gray-500 mb-1">Ajouter un utilisateur existant :</p>
                  <div className="flex flex-wrap gap-1">
                    {availableUsers.slice(0, 5).map((u: any) => (
                      <Button key={u.id} size="sm" variant="outline" className="h-6 text-xs border-gray-300 dark:border-gray-700" onClick={() => addMember(u.id, "member")}>
                        <UserPlus className="w-2.5 h-2.5 mr-1" /> {u.display_name || u.username}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {detail.invitations?.filter((i: any) => i.status === "pending").length > 0 && (
                <div className="mt-2 border-t border-gray-200 dark:border-gray-800 pt-2">
                  <p className="text-xs text-gray-500 mb-1">Invitations en attente :</p>
                  {detail.invitations.filter((i: any) => i.status === "pending").map((inv: any) => (
                    <div key={inv.id} className="flex items-center gap-2 text-xs bg-yellow-900/10 rounded px-2 py-1 mb-1">
                      <Mail className="w-3 h-3 text-yellow-400" />
                      <span>{inv.email}</span>
                      <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-400">{inv.role}</Badge>
                      <span className="text-gray-600 ml-auto">expire {fmt(inv.expires_at)}</span>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400" onClick={() => deleteInvitation(inv.id)}><XCircle className="w-3 h-3" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs flex items-center gap-1"><FolderGit2 className="w-3.5 h-3.5" /> Projets ({detail.projects?.length || 0})</CardTitle>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowAssign(!showAssign)} data-testid="btn-assign-project">
                  <Link2 className="w-3 h-3 mr-1" /> Assigner
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <AnimatePresence>
                {showAssign && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-2 space-y-1.5 mb-2 border border-gray-300 dark:border-gray-700 max-h-[200px] overflow-y-auto">
                      <p className="text-xs text-gray-400">Assigner un projet existant :</p>
                      {unassignedProjects.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between bg-white/90 dark:bg-gray-900/60 rounded px-2 py-1 text-xs">
                          <span>{p.name}</span>
                          <Button size="sm" variant="ghost" className="h-5 text-xs text-blue-400" onClick={() => assignProject(p.id)}>
                            <Plus className="w-2.5 h-2.5 mr-0.5" /> Assigner
                          </Button>
                        </div>
                      ))}
                      {unassignedProjects.length === 0 && <p className="text-xs text-gray-600 text-center py-2">Tous les projets sont assignes</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {detail.projects?.map((p: any) => (
                <div key={p.id} className="flex items-center gap-2 bg-gray-100/60 dark:bg-gray-800/30 rounded px-2.5 py-1.5 text-xs">
                  <FolderGit2 className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                  <span className="font-semibold truncate">{p.name}</span>
                  {p.environment && <Badge variant="outline" className={`text-xs ${p.environment === "production" ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400"}`}>{p.environment}</Badge>}
                  <div className="ml-auto flex gap-1.5">
                    {p.staging_url && <a href={p.staging_url} target="_blank" rel="noopener noreferrer" className="text-amber-400"><Globe className="w-3 h-3" /></a>}
                    {p.production_url && <a href={p.production_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400"><Globe className="w-3 h-3" /></a>}
                  </div>
                </div>
              ))}
              {(!detail.projects || detail.projects.length === 0) && <p className="text-xs text-gray-600 text-center py-3">Aucun projet assigne</p>}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs flex items-center gap-1"><Key className="w-3.5 h-3.5 text-yellow-400" /> Cles API ({detail.apiKeys?.length || 0})</CardTitle>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowApiKey(!showApiKey)} data-testid="btn-create-api-key">
                  <Plus className="w-3 h-3 mr-1" /> Nouvelle
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <AnimatePresence>
                {showApiKey && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-3 space-y-2 mb-2 border border-gray-300 dark:border-gray-700">
                      <div className="flex gap-2">
                        <Input placeholder="Nom de la cle" value={apiKeyForm.name} onChange={e => setApiKeyForm(f => ({ ...f, name: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-xs h-8" data-testid="input-api-key-name" />
                        <Input placeholder="Expire (jours)" value={apiKeyForm.expiresInDays} onChange={e => setApiKeyForm(f => ({ ...f, expiresInDays: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-xs h-8 w-24" />
                        <Button size="sm" className="h-8" onClick={createApiKey}><Key className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {newApiKey && (
                <div className="bg-green-900/20 border border-green-500/30 rounded p-2 mb-2">
                  <p className="text-xs text-green-400 font-semibold mb-1">Cle API creee (copiez-la maintenant) :</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-green-300 bg-gray-900 px-2 py-1 rounded flex-1 truncate">{newApiKey}</code>
                    <Button size="sm" variant="ghost" className="h-6" onClick={() => { navigator.clipboard.writeText(newApiKey); }}><Copy className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 text-gray-400" onClick={() => setNewApiKey("")}><XCircle className="w-3 h-3" /></Button>
                  </div>
                </div>
              )}

              {detail.apiKeys?.map((k: any) => (
                <div key={k.id} className="flex items-center gap-2 bg-gray-100/60 dark:bg-gray-800/30 rounded px-2.5 py-1.5 text-xs">
                  <Key className={`w-3 h-3 ${k.active ? "text-yellow-400" : "text-gray-600"}`} />
                  <span className="font-semibold">{k.name}</span>
                  <code className="text-gray-500 font-mono text-xs">{k.key_prefix}...</code>
                  {!k.active && <Badge variant="outline" className="text-xs border-red-500/50 text-red-400">Inactif</Badge>}
                  <span className="text-gray-600 ml-auto">{k.last_used_at ? `Utilise ${fmt(k.last_used_at)}` : "Jamais utilise"}</span>
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => toggleApiKey(k.id)}>
                    {k.active ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-gray-500" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400" onClick={() => deleteApiKey(k.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
              {(!detail.apiKeys || detail.apiKeys.length === 0) && <p className="text-xs text-gray-600 text-center py-3">Aucune cle API</p>}
            </CardContent>
          </Card>

          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5 text-cyan-400" /> Usage 30j</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.usageStats?.length > 0 ? (
                <div className="space-y-1">
                  {detail.usageStats.map((u: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">{u.action}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-800 rounded overflow-hidden">
                          <div className="h-full bg-cyan-500 rounded" style={{ width: `${Math.min(100, (u.count / Math.max(1, detail.usageStats[0]?.count)) * 100)}%` }} />
                        </div>
                        <span className="font-mono text-gray-300 w-8 text-right">{u.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-600 text-center py-4">Aucune donnee d'usage</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-1"><Plug className="w-3.5 h-3.5 text-violet-400" /> Intégrations ({detail.integrations?.length || 0})</CardTitle>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setShowAddIntegration(!showAddIntegration); if (!integrationCatalog.length) loadCatalog(); }} data-testid="btn-add-integration">
                <Plus className="w-3 h-3 mr-1" /> Ajouter
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <AnimatePresence>
              {showAddIntegration && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-3 space-y-3 mb-2 border border-gray-300 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold">Catalogue d'intégrations</p>
                      <Input placeholder="Filtrer..." value={integrationFilter} onChange={e => setIntegrationFilter(e.target.value)} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-xs h-7 w-32" />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-[300px] overflow-y-auto">
                      {integrationCatalog
                        .filter(c => !detail.integrations?.some((i: any) => i.service === c.service))
                        .filter(c => !integrationFilter || c.label.toLowerCase().includes(integrationFilter.toLowerCase()) || c.category.toLowerCase().includes(integrationFilter.toLowerCase()))
                        .map((c: any) => {
                          const IconComp = INTEGRATION_ICONS[c.icon] || Plug;
                          return (
                            <button key={c.service} onClick={() => { setEditingIntegration({ ...c, isNew: true }); setIntegrationCreds({}); }} className="flex items-center gap-2 bg-white/80 dark:bg-gray-900/80 rounded px-2.5 py-2 text-left hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors border border-gray-200 dark:border-gray-700" data-testid={`catalog-${c.service}`}>
                              <IconComp className={`w-4 h-4 flex-shrink-0 ${CATEGORY_COLORS[c.category] || "text-gray-400"}`} />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate">{c.label}</p>
                                <p className="text-[10px] text-gray-500 truncate">{c.description}</p>
                              </div>
                            </button>
                          );
                        })}
                    </div>
                    {editingIntegration?.isNew && (
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                        <p className="text-xs font-semibold flex items-center gap-1.5">
                          {(() => { const IC = INTEGRATION_ICONS[editingIntegration.icon] || Plug; return <IC className="w-3.5 h-3.5 text-violet-400" />; })()}
                          Configurer {editingIntegration.label}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {editingIntegration.fields?.map((field: string) => (
                            <Input key={field} placeholder={field.replace(/_/g, " ")} type={field.includes("secret") || field.includes("token") || field.includes("key") || field.includes("password") ? "password" : "text"} value={integrationCreds[field] || ""} onChange={e => setIntegrationCreds(prev => ({ ...prev, [field]: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-xs h-8 font-mono" data-testid={`input-integ-${field}`} />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => addIntegration(editingIntegration.service)} data-testid="btn-save-integration"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Ajouter</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingIntegration(null); setIntegrationCreds({}); }}>Annuler</Button>
                        </div>
                      </div>
                    )}
                    <Button size="sm" variant="ghost" className="w-full text-xs text-gray-500" onClick={() => setShowAddIntegration(false)}>Fermer le catalogue</Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {detail.integrations?.map((integ: any) => {
              const catalogEntry = integrationCatalog.find((c: any) => c.service === integ.service) || { label: integ.service, icon: "Plug", category: "custom", fields: [] };
              const IconComp = INTEGRATION_ICONS[catalogEntry.icon] || Plug;
              const statusStyle = STATUS_STYLES[integ.status] || STATUS_STYLES.disconnected;
              const isEditing = editingIntegration?.id === integ.id && !editingIntegration?.isNew;

              return (
                <div key={integ.id} className="space-y-0">
                  <div className="flex items-center gap-2 bg-gray-100/60 dark:bg-gray-800/30 rounded px-2.5 py-2 text-xs">
                    <IconComp className={`w-4 h-4 flex-shrink-0 ${CATEGORY_COLORS[catalogEntry.category] || "text-gray-400"}`} />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold">{catalogEntry.label}</span>
                      <Badge variant="outline" className={`text-[10px] ml-1.5 ${statusStyle.border} ${statusStyle.text}`}>{statusStyle.label}</Badge>
                      {!integ.enabled && <Badge variant="outline" className="text-[10px] ml-1 border-gray-500/50 text-gray-500">Désactivé</Badge>}
                    </div>
                    {integ.last_sync_at && <span className="text-gray-500 text-[10px]">Sync {fmt(integ.last_sync_at)}</span>}
                    <div className="flex gap-0.5">
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => testIntegration(integ.id)} title="Tester"><TestTube className="w-3 h-3 text-violet-400" /></Button>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => toggleIntegration(integ.id, !integ.enabled)} title={integ.enabled ? "Désactiver" : "Activer"}><Power className={`w-3 h-3 ${integ.enabled ? "text-emerald-400" : "text-gray-500"}`} /></Button>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => { if (isEditing) { setEditingIntegration(null); setIntegrationCreds({}); } else { setEditingIntegration(integ); setIntegrationCreds({}); if (!integrationCatalog.length) loadCatalog(); } }}><Edit3 className="w-3 h-3 text-gray-400" /></Button>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400" onClick={() => deleteIntegration(integ.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>
                  {integ.last_error && <p className="text-[10px] text-red-400 px-2.5 mt-0.5">{integ.last_error}</p>}
                  <AnimatePresence>
                    {isEditing && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                        <div className="bg-gray-50 dark:bg-gray-800/50 rounded p-2.5 mt-1 space-y-2 border border-gray-300 dark:border-gray-700">
                          <p className="text-xs text-gray-500">Modifier les credentials :</p>
                          <div className="grid grid-cols-2 gap-2">
                            {(catalogEntry.fields || []).map((field: string) => (
                              <Input key={field} placeholder={field.replace(/_/g, " ")} type={field.includes("secret") || field.includes("token") || field.includes("key") || field.includes("password") ? "password" : "text"} value={integrationCreds[field] || ""} onChange={e => setIntegrationCreds(prev => ({ ...prev, [field]: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-xs h-7 font-mono" />
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7" onClick={() => updateIntegration(integ.id)}><CheckCircle2 className="w-3 h-3 mr-1" /> Sauvegarder</Button>
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditingIntegration(null); setIntegrationCreds({}); }}>Annuler</Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {(!detail.integrations || detail.integrations.length === 0) && !showAddIntegration && (
              <div className="text-center py-4">
                <Plug className="w-5 h-5 text-gray-600 mx-auto mb-1" />
                <p className="text-xs text-gray-600">Aucune intégration configurée</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Cliquez "Ajouter" pour configurer Gmail, Notion, Stripe et plus</p>
              </div>
            )}
          </CardContent>
        </Card>

        {detail.recentAudit?.length > 0 && (
          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-indigo-400" /> Audit recents</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[200px] overflow-y-auto space-y-1">
              {detail.recentAudit.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-gray-100/60 dark:bg-gray-800/30 rounded px-2 py-1">
                  <span className="text-gray-600 w-[110px] flex-shrink-0">{fmt(a.created_at)}</span>
                  <Badge variant="outline" className="text-xs h-4">{a.action}</Badge>
                  <span className="text-gray-400 truncate">{a.entity_type}:{a.entity_id?.substring(0, 8)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const filtered = tenants.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4" /> Tenants ({tenants.length})</h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 h-8 text-xs pl-7 w-40" />
          </div>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="btn-create-tenant"><Plus className="w-3.5 h-3.5 mr-1" /> Nouveau tenant</Button>
        </div>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="bg-gray-50 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700">
              <CardContent className="p-4 space-y-4">
                <p className="text-sm font-semibold flex items-center gap-2"><Building2 className="w-4 h-4 text-orange-400" /> Nouveau tenant</p>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Identite</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Input placeholder="Nom de l'organisation" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-") }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-tenant-name" />
                    <Input placeholder="Slug (URL)" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 font-mono" data-testid="input-tenant-slug" />
                    <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} className="h-9 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-md px-3 text-sm cursor-pointer appearance-auto focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" data-testid="select-tenant-plan">
                      <option value="free">Free</option>
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                    <select value={form.ownerId} onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))} className="h-9 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-md px-3 text-sm cursor-pointer appearance-auto focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                      <option value="">Pas de proprietaire</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                    </select>
                    <Input placeholder="Mois d'essai" type="number" value={form.trialMonths} onChange={e => setForm(f => ({ ...f, trialMonths: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" />
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">GitHub</p>
                  <div className="grid grid-cols-3 gap-3">
                    <Input placeholder="Organisation GitHub" value={form.githubOrg} onChange={e => setForm(f => ({ ...f, githubOrg: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-tenant-github-org" />
                    <Input placeholder="Repo principal" value={form.githubRepo} onChange={e => setForm(f => ({ ...f, githubRepo: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 font-mono" data-testid="input-tenant-github-repo" />
                    <Input placeholder="Token GitHub (optionnel)" type="password" value={form.githubToken} onChange={e => setForm(f => ({ ...f, githubToken: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-tenant-github-token" />
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact & Adresse</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Input placeholder="Nom du contact" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-tenant-contact-name" />
                    <Input placeholder="Email du contact" type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-tenant-contact-email" />
                    <Input placeholder="Telephone" type="tel" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-tenant-contact-phone" />
                    <Input placeholder="Adresse postale" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 md:col-span-2" data-testid="input-tenant-address" />
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Facturation</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Input placeholder="Email facturation" type="email" value={form.billingEmail} onChange={e => setForm(f => ({ ...f, billingEmail: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-tenant-billing-email" />
                    <Input placeholder="Stripe Customer ID (cus_...)" value={form.stripeCustomerId} onChange={e => setForm(f => ({ ...f, stripeCustomerId: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 font-mono text-xs" data-testid="input-tenant-stripe-id" />
                    <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} className="h-9 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-md px-3 text-sm cursor-pointer appearance-auto focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" data-testid="select-tenant-payment">
                      <option value="none">Pas de paiement</option>
                      <option value="stripe">Stripe</option>
                      <option value="invoice">Facture manuelle</option>
                      <option value="bank_transfer">Virement bancaire</option>
                      <option value="other">Autre</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={createTenant} data-testid="btn-save-tenant"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Creer le tenant</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        {filtered.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">Aucun tenant. Cliquez sur "Nouveau tenant" pour en creer un.</div>}
        {filtered.map((t: any) => (
          <Card key={t.id} className="bg-white/90 dark:bg-gray-900/60 border-gray-300 dark:border-gray-700/50 hover:border-orange-500/30 transition-colors cursor-pointer" onClick={() => loadDetail(t.id)} data-testid={`tenant-card-${t.slug}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-lg shadow-md">{(t.name || "?")[0].toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{t.name}</span>
                    <Badge variant="outline" className={`text-xs ${PLAN_COLORS[t.plan] || PLAN_COLORS.free}`}>{PLAN_LABELS[t.plan] || t.plan}</Badge>
                    {t.billing_status !== "active" && <Badge variant="destructive" className="text-xs">{t.billing_status}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span className="font-mono text-xs">{t.slug}</span>
                    <span>{t.member_count || 0} membres</span>
                    <span>{t.project_count || 0} projets</span>
                    <span>{t.usage_30d || 0} ops/30j</span>
                    {t.owner_username && <span>by @{t.owner_username}</span>}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UsersPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [form, setForm] = useState({ username: "", displayName: "", email: "", pin: "102040", role: "user" });
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${API}/admin/users`);
      if (res.ok) setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createUser = async () => {
    if (!form.username) return;
    try {
      await adminFetch(`${API}/admin/users`, { method: "POST", body: JSON.stringify(form) });
      setShowCreate(false);
      setForm({ username: "", displayName: "", email: "", pin: "102040", role: "user" });
      load();
    } catch {}
  };

  const updateUser = async () => {
    if (!editUser) return;
    try {
      await adminFetch(`${API}/admin/users/${editUser.id}`, { method: "PUT", body: JSON.stringify(form) });
      setEditUser(null);
      load();
    } catch {}
  };

  const deleteUser = async (id: string) => {
    if (!confirm("Supprimer cet utilisateur ?")) return;
    try { await adminFetch(`${API}/admin/users/${id}`, { method: "DELETE" }); load(); } catch {}
  };

  const toggleActive = async (user: any) => {
    try {
      await adminFetch(`${API}/admin/users/${user.id}`, { method: "PUT", body: JSON.stringify({ active: !user.active }) });
      load();
    } catch {}
  };

  if (loading) return <Spinner />;

  const users = data?.users || [];
  const filtered = users.filter((u: any) => !search || u.username?.toLowerCase().includes(search.toLowerCase()) || u.display_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4" /> Utilisateurs ({users.length})</h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 h-8 text-xs pl-7 w-40" />
          </div>
          <Button size="sm" variant="ghost" onClick={load} data-testid="btn-refresh-users"><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" onClick={() => { setShowCreate(true); setForm({ username: "", displayName: "", email: "", pin: "102040", role: "user" }); }} data-testid="btn-create-user">
            <Plus className="w-3.5 h-3.5 mr-1" /> Nouveau
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {(showCreate || editUser) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="bg-gray-50 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700">
              <CardContent className="p-4 space-y-3">
                <p className="text-sm font-semibold">{editUser ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Input placeholder="Nom d'utilisateur" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-username" />
                  <Input placeholder="Nom d'affichage" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-display-name" />
                  <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-email" />
                  <Input placeholder="PIN (defaut: 102040)" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))} className="bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700" data-testid="input-pin" />
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="h-9 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-md px-3 text-sm cursor-pointer appearance-auto focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" data-testid="select-role">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                    <option value="developer">Developer</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={editUser ? updateUser : createUser} data-testid="btn-save-user">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {editUser ? "Sauvegarder" : "Creer"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setEditUser(null); }}>Annuler</Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        {filtered.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">{search ? "Aucun resultat" : "Aucun utilisateur"}</div>}
        {filtered.map((user: any) => (
          <Card key={user.id} className={`bg-white/90 dark:bg-gray-900/60 border-gray-300 dark:border-gray-700/50 ${!user.active ? "opacity-50" : ""}`} data-testid={`user-card-${user.id}`}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg ${user.role === "admin" ? "bg-gradient-to-br from-red-500 to-orange-500" : "bg-gradient-to-br from-blue-500 to-cyan-500"}`}>
                {(user.display_name || user.username || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{user.display_name || user.username}</span>
                  <Badge variant="outline" className={`text-xs ${user.role === "admin" ? "border-red-500/50 text-red-400" : "border-blue-500/50 text-blue-400"}`}>{user.role}</Badge>
                  {!user.active && <Badge variant="destructive" className="text-xs">Inactif</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                  <span>@{user.username}</span>
                  {user.email && <span>{user.email}</span>}
                  <span>{user.project_count || 0} projets</span>
                  <span>{user.active_sessions || 0} sessions</span>
                  <span className="font-mono text-xs text-gray-600">{user.fingerprint?.substring(0, 8)}...</span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => toggleActive(user)} data-testid={`btn-toggle-${user.id}`}>
                  {user.active ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditUser(user); setForm({ username: user.username, displayName: user.display_name || "", email: user.email || "", pin: user.pin || "", role: user.role }); }} data-testid={`btn-edit-${user.id}`}>
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-300" onClick={() => deleteUser(user.id)} data-testid={`btn-delete-${user.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data?.fingerprints?.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1"><Terminal className="w-3 h-3" /> Fingerprints connus ({data.fingerprints.filter((f: any) => f.fingerprint !== "master-admin").length})</h4>
          <div className="space-y-1">
            {data.fingerprints.filter((f: any) => f.fingerprint !== "master-admin").map((fp: any) => (
              <div key={fp.fingerprint} className="flex items-center gap-2 bg-gray-100/60 dark:bg-gray-800/30 rounded px-3 py-1.5 text-xs">
                <span className="font-mono text-gray-400">{fp.fingerprint?.substring(0, 12)}...</span>
                <span className="text-gray-500">{fp.session_count} sessions</span>
                <span className="text-gray-600">{fmt(fp.last_active)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectsPanel() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${API}/admin/projects`);
      if (res.ok) setProjects(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (projectId: string) => {
    try {
      const res = await adminFetch(`${API}/admin/projects/${projectId}/detail`);
      if (res.ok) setDetail(await res.json());
    } catch {}
  };

  if (loading) return <Spinner />;

  if (detail) {
    return (
      <div className="space-y-4">
        <Button size="sm" variant="ghost" onClick={() => setDetail(null)} data-testid="btn-back-projects">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
        </Button>
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><FolderGit2 className="w-4 h-4 text-purple-400" /> {detail.project?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div><span className="text-gray-500">Repo:</span> <span className="font-mono">{detail.project?.repo_owner}/{detail.project?.repo_name}</span></div>
              <div><span className="text-gray-500 dark:text-gray-400">Slug:</span> <span className="font-mono">{detail.project?.deploy_slug}</span></div>
              <div><span className="text-gray-500">Staging:</span> <a href={detail.project?.staging_url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">{detail.project?.staging_url || "—"}</a></div>
              <div><span className="text-gray-500">Production:</span> <a href={detail.project?.production_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{detail.project?.production_url || "—"}</a></div>
              <div><span className="text-gray-500">Env:</span> <Badge variant="outline" className="text-xs">{detail.project?.environment || "—"}</Badge></div>
              <div><span className="text-gray-500">Cree:</span> {fmt(detail.project?.created_at)}</div>
            </div>
          </CardContent>
        </Card>

        {detail.journal?.length > 0 && (
          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-1"><BookOpen className="w-3 h-3" /> Journal ({detail.journal.length})</CardTitle></CardHeader>
            <CardContent className="max-h-[200px] overflow-y-auto space-y-1">
              {detail.journal.map((j: any, i: number) => (
                <div key={j.id || i} className="text-xs bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1 flex gap-2">
                  <Badge variant="outline" className="text-xs h-4">{j.entry_type}</Badge>
                  <span className="text-gray-300">{j.title}</span>
                  <span className="text-gray-600 ml-auto">{fmt(j.created_at)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {detail.recentChat?.length > 0 && (
          <Card className="bg-white/90 dark:bg-gray-900/60">
            <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Chat recent ({detail.recentChat.length})</CardTitle></CardHeader>
            <CardContent className="max-h-[250px] overflow-y-auto space-y-1">
              {detail.recentChat.map((msg: any, i: number) => (
                <div key={i} className={`text-xs rounded px-2 py-1 ${msg.role === "user" ? "bg-blue-900/20 border-l-2 border-blue-500" : "bg-gray-50 dark:bg-gray-800/50 border-l-2 border-gray-600"}`}>
                  <span className={`font-semibold ${msg.role === "user" ? "text-blue-400" : "text-gray-400"}`}>{msg.role}: </span>
                  <span className="text-gray-300">{(msg.content || "").substring(0, 200)}{msg.content?.length > 200 ? "..." : ""}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const filtered = projects.filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.deploy_slug?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><FolderGit2 className="w-4 h-4" /> Tous les projets ({projects.length})</h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 h-8 text-xs pl-7 w-40" />
          </div>
          <Button size="sm" variant="ghost" onClick={load} data-testid="btn-refresh-projects"><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      <div className="space-y-2">
        {filtered.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">{search ? "Aucun resultat" : "Aucun projet"}</div>}
        {filtered.map((p: any) => (
          <Card key={p.id} className="bg-white/90 dark:bg-gray-900/60 border-gray-300 dark:border-gray-700/50 hover:border-purple-500/30 transition-colors cursor-pointer" onClick={() => loadDetail(p.id)} data-testid={`project-card-${p.id}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white font-bold">{(p.name || "?")[0].toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{p.name}</span>
                    {p.environment && <Badge variant="outline" className={`text-xs ${p.environment === "production" ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400"}`}>{p.environment}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    {p.repo_owner && <span className="font-mono">{p.repo_owner}/{p.repo_name}</span>}
                    {p.owner_username && <span>par @{p.owner_username}</span>}
                    <span>{p.chat_count || 0} msgs</span>
                    <span>{p.journal_count || 0} journal</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {p.production_url && <a href={p.production_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 hover:underline flex items-center gap-0.5" onClick={e => e.stopPropagation()}><Globe className="w-3 h-3" /> prod</a>}
                  {p.staging_url && <a href={p.staging_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-400 hover:underline flex items-center gap-0.5" onClick={e => e.stopPropagation()}><Globe className="w-3 h-3" /> staging</a>}
                </div>
                <Eye className="w-4 h-4 text-gray-600" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DeployedAppsPanel() {
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${API}/admin/deployed-apps`);
      if (res.ok) setApps(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Rocket className="w-4 h-4" /> Apps deployees ({apps.length})</h3>
        <Button size="sm" variant="ghost" onClick={load} data-testid="btn-refresh-deployed"><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="space-y-2">
        {apps.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">Aucune app deployee</div>}
        {apps.map((app: any) => (
          <Card key={app.id} className="bg-white/90 dark:bg-gray-900/60 border-gray-300 dark:border-gray-700/50" data-testid={`deployed-${app.deploy_slug}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${app.environment === "production" ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{app.name}</span>
                    <Badge variant="outline" className={`text-xs ${app.environment === "production" ? "border-emerald-500/50 text-emerald-400" : "border-amber-500/50 text-amber-400"}`}>{app.environment || "staging"}</Badge>
                    {app.repo_owner && <span className="text-xs text-gray-500 font-mono">{app.repo_owner}/{app.repo_name}</span>}
                  </div>
                  <div className="flex items-center gap-4 mt-1.5">
                    {app.staging_url && (
                      <a href={app.staging_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-400 hover:underline flex items-center gap-1" data-testid={`link-staging-${app.deploy_slug}`}>
                        <Globe className="w-3 h-3" /> {app.staging_url.replace("https://", "")}<ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {app.production_url && (
                      <a href={app.production_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 hover:underline flex items-center gap-1" data-testid={`link-prod-${app.deploy_slug}`}>
                        <Globe className="w-3 h-3" /> {app.production_url.replace("https://", "")}<ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-600 mt-1">
                    {app.last_deployed_at && <span>Deploy: {fmt(app.last_deployed_at)}</span>}
                    {app.last_promoted_at && <span>Promoted: {fmt(app.last_promoted_at)}</span>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AuditPanel() {
  const [audit, setAudit] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"audit" | "activity">("audit");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, actRes] = await Promise.all([
        adminFetch(`${API}/admin/audit?limit=80`),
        adminFetch(`${API}/admin/activity?limit=80`),
      ]);
      if (aRes.ok) setAudit(await aRes.json());
      if (actRes.ok) setActivity(await actRes.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;

  const items = tab === "audit" ? audit : activity;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Audit & Activite</h3>
          <div className="flex bg-gray-800 rounded p-0.5 gap-0.5">
            <button className={`px-2 py-0.5 text-xs rounded ${tab === "audit" ? "bg-gray-700 text-white" : "text-gray-500"}`} onClick={() => setTab("audit")}>Audit</button>
            <button className={`px-2 py-0.5 text-xs rounded ${tab === "activity" ? "bg-gray-700 text-white" : "text-gray-500"}`} onClick={() => setTab("activity")}>Activite</button>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={load} data-testid="btn-refresh-audit"><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {items.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">Aucune entree</div>}
        {items.map((a: any, i: number) => (
          <div key={a.id || i} className="flex items-center gap-2 bg-gray-100/60 dark:bg-gray-800/30 rounded px-3 py-1.5 text-xs" data-testid={`audit-${i}`}>
            <span className="text-gray-600 w-[120px] flex-shrink-0">{fmt(a.created_at)}</span>
            <Badge variant="outline" className="text-xs h-4 flex-shrink-0">{a.action}</Badge>
            {tab === "audit" && a.entity_type && <span className="text-gray-500">{a.entity_type}</span>}
            <span className="text-gray-300 truncate">{a.target || a.entity_id?.substring(0, 12) || ""}</span>
            {(a.display_name || a.username) && <span className="text-gray-500 ml-auto flex-shrink-0">par {a.display_name || a.username}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function UsagePanel() {
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${API}/admin/usage?days=30`);
      if (res.ok) setUsage(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Usage Plateforme (30j)</h3>
        <Button size="sm" variant="ghost" onClick={load} data-testid="btn-refresh-usage"><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs">Par action</CardTitle></CardHeader>
          <CardContent>
            {usage?.byAction?.length > 0 ? (
              <div className="space-y-1.5">
                {usage.byAction.map((a: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 truncate mr-2">{a.action}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-24 h-1.5 bg-gray-800 rounded overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded" style={{ width: `${Math.min(100, (a.count / Math.max(1, usage.byAction[0]?.count)) * 100)}%` }} />
                      </div>
                      <span className="font-mono text-gray-300 w-10 text-right">{a.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-600 text-center py-4">Aucune donnee</p>}
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs">Par jour</CardTitle></CardHeader>
          <CardContent>
            {usage?.byDay?.length > 0 ? (
              <div className="flex items-end gap-1 h-32">
                {usage.byDay.slice(-14).map((d: any, i: number) => {
                  const max = Math.max(...usage.byDay.slice(-14).map((x: any) => parseInt(x.count) || 0));
                  const h = max > 0 ? ((parseInt(d.count) || 0) / max) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.day}: ${d.count} ops`}>
                      <span className="text-[8px] text-gray-500">{d.count}</span>
                      <div className="w-full bg-gray-800 rounded-t" style={{ height: `${Math.max(2, h)}%` }}>
                        <div className="w-full h-full bg-gradient-to-t from-purple-600 to-purple-400 rounded-t" />
                      </div>
                      <span className="text-[7px] text-gray-600 -rotate-45">{d.day?.substring(5)}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-gray-600 text-center py-4">Aucune donnee</p>}
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60 lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-xs">Par tenant</CardTitle></CardHeader>
          <CardContent>
            {usage?.byTenant?.length > 0 ? (
              <div className="space-y-1.5">
                {usage.byTenant.map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 font-mono truncate mr-2">{t.tenant_id?.substring(0, 12) || "sans-tenant"}...</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-32 h-1.5 bg-gray-800 rounded overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-orange-500 to-amber-500 rounded" style={{ width: `${Math.min(100, (t.count / Math.max(1, usage.byTenant[0]?.count)) * 100)}%` }} />
                      </div>
                      <span className="font-mono text-gray-300 w-10 text-right">{t.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-600 text-center py-4">Aucune donnee</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ScalabilityPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(`${API}/admin/scalability-health`);
      if (res.ok) setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  if (loading) return <Spinner />;
  if (!data) return <div className="text-center py-8 text-gray-500 text-sm">Erreur chargement</div>;

  const statusColor = data.status === "healthy" ? "text-green-400" : data.status === "degraded" ? "text-yellow-400" : "text-red-400";
  const statusBg = data.status === "healthy" ? "bg-green-500/10 border-green-500/20" : data.status === "degraded" ? "bg-yellow-500/10 border-yellow-500/20" : "bg-red-500/10 border-red-500/20";

  const uptimeHrs = Math.floor((data.uptime || 0) / 3600000);
  const uptimeMins = Math.floor(((data.uptime || 0) % 3600000) / 60000);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4" /> Scalabilite & Performance</h3>
        <div className="flex items-center gap-2">
          <button
            className={`text-xs px-2 py-0.5 rounded ${autoRefresh ? "bg-green-600/20 text-green-400" : "bg-gray-800 text-gray-500"}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            data-testid="btn-auto-refresh"
          >
            {autoRefresh ? "Live ON" : "Live OFF"}
          </button>
          <Button size="sm" variant="ghost" onClick={load} data-testid="btn-refresh-scalability"><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      <div className={`rounded-lg border p-3 ${statusBg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${data.status === "healthy" ? "bg-green-400" : data.status === "degraded" ? "bg-yellow-400" : "bg-red-400"} ${data.status === "critical" ? "animate-pulse" : ""}`} />
            <span className={`text-sm font-bold uppercase ${statusColor}`} data-testid="text-system-status">{data.status}</span>
          </div>
          <span className="text-xs text-gray-500">Uptime: {uptimeHrs}h {uptimeMins}m</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">Heap Memory</p>
            <p className="text-lg font-bold text-white" data-testid="text-heap-used">{data.memory?.heapUsedMB}MB</p>
            <div className="w-full h-1.5 bg-gray-800 rounded mt-1.5">
              <div className={`h-full rounded ${(data.memory?.heapPercent || 0) > 90 ? "bg-red-500" : (data.memory?.heapPercent || 0) > 75 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, data.memory?.heapPercent || 0)}%` }} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{data.memory?.heapPercent}% of {data.memory?.heapTotalMB}MB</p>
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">RSS Total</p>
            <p className="text-lg font-bold text-white" data-testid="text-rss">{data.memory?.rssMB}MB</p>
            <p className="text-xs text-gray-500 mt-1">{data.requests?.total || 0} requetes</p>
            <p className="text-xs text-gray-500">Erreurs: {data.requests?.errorRate || 0}%</p>
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">Response Time</p>
            <p className="text-lg font-bold text-white" data-testid="text-avg-response">{data.performance?.avgResponseMs}ms</p>
            <p className="text-xs text-gray-500 mt-1">p95: {data.performance?.p95ResponseMs}ms</p>
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">Redis</p>
            <div className="flex items-center gap-1.5 mt-1">
              <div className={`w-2 h-2 rounded-full ${data.redis?.connected ? "bg-green-400" : "bg-red-400"}`} />
              <span className={`text-sm font-bold ${data.redis?.connected ? "text-green-400" : "text-red-400"}`} data-testid="text-redis-status">{data.redis?.connected ? "Connected" : "Fallback"}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Hits: {data.redis?.hits || 0} | Miss: {data.redis?.misses || 0}</p>
            <p className="text-xs text-gray-500">Mem cache: {data.redis?.memoryFallbackSize || 0}</p>
          </CardContent>
        </Card>
      </div>

      {data.dbPool && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Database className="w-3.5 h-3.5" /> DB Pool</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-lg font-mono font-bold text-white" data-testid="text-db-total">{data.dbPool.totalCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Idle</p>
                <p className="text-lg font-mono font-bold text-green-400">{data.dbPool.idleCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Waiting</p>
                <p className="text-lg font-mono font-bold text-yellow-400" data-testid="text-db-waiting">{data.dbPool.waitingCount}</p>
              </div>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded mt-3 overflow-hidden flex">
              <div className="h-full bg-blue-500" style={{ width: `${((data.dbPool.totalCount - data.dbPool.idleCount) / 40) * 100}%` }} title="Active" />
              <div className="h-full bg-green-500/50" style={{ width: `${(data.dbPool.idleCount / 40) * 100}%` }} title="Idle" />
            </div>
            <p className="text-xs text-gray-500 mt-1">{data.dbPool.totalCount - data.dbPool.idleCount} active / {data.dbPool.idleCount} idle / 40 max</p>
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/90 dark:bg-gray-900/60">
        <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Zap className="w-3.5 h-3.5" /> Concurrency Limiter</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(data.concurrency || {}).map(([domain, info]: [string, any]) => (
              <div key={domain} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-24 flex-shrink-0 font-mono">{domain}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${info.active >= info.limit ? "bg-red-500" : info.active > 0 ? "bg-blue-500" : "bg-gray-700"}`}
                    style={{ width: `${(info.active / info.limit) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-300 w-16 text-right" data-testid={`text-concurrency-${domain}`}>
                  {info.active}/{info.limit}
                  {info.waiting > 0 && <span className="text-yellow-400 ml-1">+{info.waiting}w</span>}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {Object.keys(data.circuits || {}).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Circuit Breakers</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {Object.entries(data.circuits || {}).map(([name, info]: [string, any]) => (
                <div key={name} className="flex items-center justify-between bg-gray-100/60 dark:bg-gray-800/30 rounded px-3 py-1.5">
                  <span className="text-xs text-gray-400 font-mono">{name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs h-4 ${info.state === "closed" ? "text-green-400 border-green-400/30" : info.state === "open" ? "text-red-400 border-red-400/30" : "text-yellow-400 border-yellow-400/30"}`}>
                      {info.state}
                    </Badge>
                    {info.failures > 0 && <span className="text-xs text-red-400">{info.failures} fails</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(data.workers || []).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Cpu className="w-3.5 h-3.5" /> Workers Dedies (Palier 3)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.workers || []).map((w: any) => (
                <div key={w.type} className="bg-gray-100/60 dark:bg-gray-800/30 rounded p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{w.label}</span>
                      <Badge variant="outline" className="text-[8px] h-4 text-gray-400 border-gray-600">{w.domain}</Badge>
                    </div>
                    <span className="text-xs font-mono text-gray-300" data-testid={`text-worker-${w.type}`}>
                      {w.active}/{w.maxConcurrency} actifs
                      {w.queueDepth > 0 && <span className="text-yellow-400 ml-1">+{w.queueDepth} en attente</span>}
                    </span>
                  </div>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden mb-1.5">
                    <div
                      className={`h-full rounded ${w.active >= w.maxConcurrency ? "bg-red-500" : w.active > 0 ? "bg-blue-500" : "bg-gray-700"}`}
                      style={{ width: `${w.maxConcurrency > 0 ? (w.active / w.maxConcurrency) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>Traites: <span className="text-gray-300">{w.totalProcessed}</span></span>
                    <span>Echecs: <span className={w.totalFailed > 0 ? "text-red-400" : "text-gray-300"}>{w.totalFailed}</span></span>
                    <span>Moy: <span className="text-gray-300">{w.avgDurationMs}ms</span></span>
                    {w.lastActivity > 0 && <span>Derniere: <span className="text-gray-300">{Math.round((Date.now() - w.lastActivity) / 1000)}s</span></span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(data.domains || []).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Globe className="w-3.5 h-3.5" /> Isolation par Domaine (Palier 4)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data.domains || []).map((d: any) => {
                const statusColors: Record<string, string> = { healthy: "border-green-500/30 bg-green-500/5", degraded: "border-yellow-500/30 bg-yellow-500/5", isolated: "border-red-500/30 bg-red-500/5", offline: "border-gray-600 bg-gray-100/60 dark:bg-gray-800/30" };
                const dotColors: Record<string, string> = { healthy: "bg-green-400", degraded: "bg-yellow-400", isolated: "bg-red-400", offline: "bg-gray-500" };
                return (
                  <div key={d.name} className={`rounded-lg border p-3 ${statusColors[d.status] || statusColors.healthy}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-sm font-bold text-white">{d.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${dotColors[d.status] || dotColors.healthy}`} />
                        <span className="text-xs text-gray-400 uppercase">{d.status}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{d.description}</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500 block">Requetes</span>
                        <span className="text-white font-mono font-bold">{d.requests}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Erreurs</span>
                        <span className={`font-mono font-bold ${d.errorRate > 5 ? "text-red-400" : "text-white"}`}>{d.errorRate}%</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Latence</span>
                        <span className="text-white font-mono font-bold">{d.avgResponseMs}ms</span>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-2 text-xs text-gray-500">
                      <span>Rate: {d.rateLimit?.requestsPerMinute}/min</span>
                      <span>DB: {d.dbPool?.min}-{d.dbPool?.max}</span>
                      <span>CB: {d.circuitState}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {(data.roadmap || []).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> Roadmap Scalabilite</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data.roadmap || []).map((p: any) => {
                const statusBadge: Record<string, string> = { done: "bg-green-500/20 text-green-400 border-green-500/30", active: "bg-blue-500/20 text-blue-400 border-blue-500/30", planned: "bg-gray-700/30 text-gray-400 border-gray-600" };
                const statusLabel: Record<string, string> = { done: "Termine", active: "En cours", planned: "Prevu" };
                return (
                  <div key={p.palier} className="bg-gray-100/60 dark:bg-gray-800/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white bg-gray-700 px-2 py-0.5 rounded">P{p.palier}</span>
                        <span className="text-xs font-semibold text-white">{p.title}</span>
                      </div>
                      <Badge variant="outline" className={`text-xs h-4 ${statusBadge[p.status] || statusBadge.planned}`}>
                        {statusLabel[p.status] || p.status}
                      </Badge>
                    </div>
                    <div className="space-y-0.5">
                      {p.items.map((item: string, i: number) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs">
                          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status === "done" ? "bg-green-400" : p.status === "active" ? "bg-blue-400" : "bg-gray-600"}`} />
                          <span className="text-gray-400">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [health, setHealth] = useState<any>(null);

  const loadHealth = useCallback(async () => {
    try {
      const res = await adminFetch(`${API}/admin/platform-health`);
      if (res.ok) setHealth(await res.json());
    } catch {}
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-black text-gray-900 dark:text-gray-100">
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 backdrop-blur-xl sticky top-0 z-50 pt-safe">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold bg-gradient-to-r from-red-500 to-orange-500 dark:from-red-400 dark:to-orange-400 bg-clip-text text-transparent">DevMax Platform Admin</h1>
              <p className="text-xs text-gray-500">Multi-tenant SaaS management — ulyssepro.org</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button size="sm" variant="ghost" onClick={loadHealth} data-testid="btn-refresh-health"><RefreshCw className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => window.location.href = "/devmax"} data-testid="btn-goto-devmax">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> DevMax
            </Button>
            <Button size="sm" variant="ghost" className="text-red-400" onClick={onLogout} data-testid="btn-admin-logout">
              <Lock className="w-3.5 h-3.5 mr-1" /> Deconnexion
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <PlatformHealthCards health={health} />

        <Tabs defaultValue="tenants" className="space-y-4">
          <TabsList className="bg-white/90 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 p-1 flex-wrap h-auto">
            <TabsTrigger value="tenants" className="text-xs gap-1.5" data-testid="admin-tab-tenants">
              <Building2 className="w-3.5 h-3.5" /> Tenants
            </TabsTrigger>
            <TabsTrigger value="users" className="text-xs gap-1.5" data-testid="admin-tab-users">
              <Users className="w-3.5 h-3.5" /> Utilisateurs
            </TabsTrigger>
            <TabsTrigger value="projects" className="text-xs gap-1.5" data-testid="admin-tab-projects">
              <FolderGit2 className="w-3.5 h-3.5" /> Projets
            </TabsTrigger>
            <TabsTrigger value="deployed" className="text-xs gap-1.5" data-testid="admin-tab-deployed">
              <Rocket className="w-3.5 h-3.5" /> Deployes
            </TabsTrigger>
            <TabsTrigger value="usage" className="text-xs gap-1.5" data-testid="admin-tab-usage">
              <BarChart3 className="w-3.5 h-3.5" /> Usage
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs gap-1.5" data-testid="admin-tab-audit">
              <ShieldCheck className="w-3.5 h-3.5" /> Audit
            </TabsTrigger>
            <TabsTrigger value="scalability" className="text-xs gap-1.5" data-testid="admin-tab-scalability">
              <Activity className="w-3.5 h-3.5" /> Scalabilite
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tenants"><TenantsPanel /></TabsContent>
          <TabsContent value="users"><UsersPanel /></TabsContent>
          <TabsContent value="projects"><ProjectsPanel /></TabsContent>
          <TabsContent value="deployed"><DeployedAppsPanel /></TabsContent>
          <TabsContent value="usage"><UsagePanel /></TabsContent>
          <TabsContent value="audit"><AuditPanel /></TabsContent>
          <TabsContent value="scalability"><ScalabilityPanel /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function DevMaxAdminPage() {
  const [token, setToken] = useState<string | null>(getAdminToken());
  const [validating, setValidating] = useState(true);

  useEffect(() => {
    const t = getAdminToken();
    if (!t) { setValidating(false); return; }
    adminFetch(`${API}/admin/platform-health`)
      .then(res => { if (!res.ok) { localStorage.removeItem(ADMIN_TOKEN_KEY); setToken(null); } })
      .catch(() => { localStorage.removeItem(ADMIN_TOKEN_KEY); setToken(null); })
      .finally(() => setValidating(false));
  }, []);

  if (validating) {
    return <div className="min-h-screen bg-gray-100 dark:bg-gray-950 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-red-400" /></div>;
  }

  if (!token) return <AdminLoginPage onLogin={t => setToken(t)} />;

  return <AdminDashboard onLogout={() => { localStorage.removeItem(ADMIN_TOKEN_KEY); setToken(null); }} />;
}
