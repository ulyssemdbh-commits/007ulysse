import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Building2, Plus, Trash2, Edit3, Eye, RefreshCw, ArrowLeft, Key, Mail,
  UserPlus, Crown, CreditCard, Zap, Send, Copy, CheckCircle2, XCircle,
  FolderGit2, Search, ChevronRight, ShieldCheck, Users, Lock, Globe,
  BarChart3, Plug, Power, TestTube, ExternalLink,
} from "lucide-react";
import { API, adminFetch, fmt, Spinner, PLAN_COLORS, PLAN_LABELS, INTEGRATION_ICONS, CATEGORY_COLORS, STATUS_STYLES } from "./shared";

export function TenantsPanel() {
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
