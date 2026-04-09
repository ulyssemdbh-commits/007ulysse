import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Users, FolderGit2, Activity, Shield, Loader2, Lock, Rocket,
  ArrowLeft, BarChart3, ShieldCheck, Building2,
} from "lucide-react";
import { API, ADMIN_TOKEN_KEY, adminFetch, getAdminToken } from "./devmax/admin/shared";
import { PlatformHealthCards, UsersPanel, ProjectsPanel, DeployedAppsPanel, AuditPanel, UsagePanel } from "./devmax/admin/panels";
import { TenantsPanel } from "./devmax/admin/TenantsPanel";
import { ScalabilityPanel } from "./devmax/admin/ScalabilityPanel";
import { RefreshCw } from "lucide-react";

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
