import { useState, useEffect, useCallback, Component, type ErrorInfo, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-provider";
import { SuguChatWidget } from "@/components/sugu/SuguChatWidget";
import {
    ShoppingCart, Receipt, Landmark, CreditCard, Users, BarChart3,
    Upload, Archive, Gauge, Building2, Sun, Moon, LogOut,
} from "lucide-react";
import { SuguThemeCtx } from "./sugumaillane/shared";
import { useTabListener } from "@/hooks/useAppNavigation";
import { DashboardTab } from "./sugumaillane/DashboardTab";
import { AchatsTab } from "./sugumaillane/AchatsTab";
import { FraisTab } from "./sugumaillane/FraisTab";
import { BanqueTab } from "./sugumaillane/BanqueTab";
import { CaisseTab } from "./sugumaillane/CaisseTab";
import { RHTab } from "./sugumaillane/RHTab";
import { FournisseursTab } from "./sugumaillane/FournisseursTab";
import { AuditTab, FileUploadModal } from "./sugumaillane/AuditTab";
import { ArchivesTab } from "./sugumaillane/ArchivesTab";

const TABS = [
    { id: "dashboard", label: "Dashboard", icon: Gauge },
    { id: "achats", label: "Achats", icon: ShoppingCart },
    { id: "frais", label: "Frais Généraux", icon: Receipt },
    { id: "banque", label: "Banque", icon: Landmark },
    { id: "caisse", label: "Journal de Caisse", icon: CreditCard },
    { id: "rh", label: "Gestion RH", icon: Users },
    { id: "fournisseurs", label: "Fournisseurs", icon: Building2 },
    { id: "audit", label: "Audits", icon: BarChart3 },
    { id: "archives", label: "Archives", icon: Archive },
];

class SuguErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
    constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
    componentDidCatch(error: Error, info: ErrorInfo) { console.error("[SuguMaillaneManagement] Crash:", error, info); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center">
                    <div className="text-center space-y-4 max-w-md">
                        <div className="w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto text-3xl">⚠️</div>
                        <h2 className="text-xl font-bold text-red-400">Erreur SUGU Maillane</h2>
                        <p className="text-sm text-white/50">{this.state.error?.message || "Une erreur inattendue est survenue."}</p>
                        <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
                            className="px-4 py-2 bg-teal-500 rounded-lg text-sm font-medium hover:bg-teal-600 transition">
                            Recharger la page
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

function SuguMaillaneLogin() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            await login(username, password);
        } catch (err: any) {
            setError(err.message || "Identifiants incorrects");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center font-bold text-3xl text-white mb-4 shadow-lg shadow-teal-500/30">M</div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">SUGU Maillane</h1>
                    <p className="text-white/40 text-sm mt-1">Espace Comptable</p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                    <div>
                        <label className="block text-sm font-medium text-white/60 mb-1.5">Identifiant</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500/50"
                            placeholder="Votre identifiant"
                            autoComplete="username"
                            data-testid="input-maillane-username"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-white/60 mb-1.5">Mot de passe</label>
                        <div className="relative">
                            <input
                                type={showPw ? "text" : "password"}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500/50 pr-12"
                                placeholder="••••••••"
                                autoComplete="current-password"
                                data-testid="input-maillane-password"
                                required
                            />
                            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition" tabIndex={-1}>
                                {showPw ? "🙈" : "👁"}
                            </button>
                        </div>
                    </div>
                    {error && <p className="text-red-400 text-sm text-center" data-testid="text-maillane-login-error">{error}</p>}
                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        className="w-full py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-teal-500/20"
                        data-testid="button-maillane-login"
                    >
                        {loading ? "Connexion..." : "Se connecter"}
                    </button>
                </form>
                <p className="text-center text-white/20 text-xs mt-6">Accès réservé · SUGU Maillane</p>
            </div>
        </div>
    );
}

export default function SuguMaillaneManagement() {
    const { user, isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                <div className="text-center">
                    <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center font-bold text-lg text-white mb-3 animate-pulse">M</div>
                    <p className="text-white/40 text-sm">Chargement...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !user) {
        return <SuguMaillaneLogin />;
    }

    const allowed = user.isOwner || user.role === "sugumaillane_only";
    if (!allowed) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                <div className="text-center text-white/60">
                    <p className="text-lg font-semibold text-red-400">Accès refusé</p>
                    <p className="text-sm mt-1">Vous n'avez pas les droits pour accéder à cette page.</p>
                </div>
            </div>
        );
    }

    return (
        <SuguErrorBoundary>
            <SuguMaillaneManagementInner />
        </SuguErrorBoundary>
    );
}

function SuguMaillaneManagementInner() {
    const [tab, setTab] = useState("dashboard");
    useTabListener(setTab, TABS.map(t => t.id), {
        "accueil": "dashboard", "vue": "dashboard", "apercu": "dashboard",
        "achat": "achats", "achats": "achats",
        "frais generaux": "frais", "frais généraux": "frais", "generaux": "frais",
        "journal": "caisse", "journal de caisse": "caisse",
        "gestion rh": "rh", "ressources humaines": "rh", "employes": "rh", "employés": "rh", "paie": "rh",
        "fournisseur": "fournisseurs",
        "audit": "audit", "audits": "audit",
        "archive": "archives",
    });
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [compactCards, setCompactCards] = useState(false);
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const isRestricted = user?.role === "sugumaillane_only";
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const handleDisconnect = useCallback(async () => {
        try { await logout(); window.location.reload(); } catch { window.location.reload(); }
    }, [logout]);

    const FAMILY_USERNAMES = ["MauriceDjedouadmin", "KellyIris001", "LennyIris002", "MickyIris003"];
    const isFamilyUser = FAMILY_USERNAMES.includes(user?.username || "");
    useEffect(() => {
        if (isFamilyUser) return;
        const INACTIVITY_MS = 2 * 60 * 1000;
        let timer: ReturnType<typeof setTimeout>;
        const reset = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { handleDisconnect(); }, INACTIVITY_MS);
        };
        const events: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
        events.forEach(e => window.addEventListener(e, reset, { passive: true }));
        reset();
        return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)); };
    }, [handleDisconnect, isFamilyUser]);

    const bg = isDark ? "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" : "bg-gradient-to-br from-slate-50 via-white to-slate-100";
    const textMain = isDark ? "text-white" : "text-slate-900";
    const textSub = isDark ? "text-white/50" : "text-slate-500";
    const headerBg = isDark ? "border-white/10 bg-black/40 backdrop-blur-xl" : "border-slate-200 bg-white/90 backdrop-blur-xl shadow-sm";
    const tabInactive = isDark ? "text-white/50 hover:text-white/80 hover:bg-white/5" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100";

    return (
        <SuguThemeCtx.Provider value={isDark}>
        <div className={`min-h-screen w-full overflow-x-hidden ${bg} ${textMain}`}>
            <div className={`border-b sticky top-0 z-50 ${headerBg} pt-safe`}>
                <div className="w-full max-w-[1600px] mx-auto px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-4 overflow-hidden">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center font-bold text-base sm:text-lg text-white flex-shrink-0">M</div>
                        <div className="min-w-0">
                            <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-teal-500 to-emerald-500 bg-clip-text text-transparent truncate">
                                SUGU Maillane
                            </h1>
                            <p className={`text-[10px] sm:text-xs ${textSub} truncate`}>Gestion du Restaurant{isRestricted ? ` — ${user?.displayName || user?.username}` : ""}</p>
                        </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setTheme(isDark ? "light" : "dark")}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${isDark ? "bg-white/10 hover:bg-white/20 text-yellow-400 hover:text-yellow-300" : "bg-slate-100 hover:bg-slate-200 text-teal-500 hover:text-teal-600"}`}
                            title={isDark ? "Mode jour" : "Mode nuit"}
                            data-testid="button-toggle-theme"
                        >
                            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            <span className="hidden sm:inline">{isDark ? "Jour" : "Nuit"}</span>
                        </button>
                        <button
                            onClick={handleDisconnect}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${isDark ? "bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 border border-red-500/20" : "bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 border border-red-200"}`}
                            title="Déconnexion"
                            data-testid="button-disconnect"
                        >
                            <LogOut className="w-4 h-4" />
                            <span className="hidden sm:inline">Quitter</span>
                        </button>
                    </div>
                </div>
                <div className="w-full max-w-[1600px] mx-auto px-2 sm:px-4 overflow-hidden">
                    <div className="flex gap-1 overflow-x-auto pb-2 items-center">
                        {TABS.map(tb => (
                            <button key={tb.id} onClick={() => setTab(tb.id)}
                                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${tab === tb.id
                                    ? "bg-gradient-to-r from-teal-500/20 to-emerald-500/20 text-teal-500 border border-teal-500/30 font-semibold"
                                    : tabInactive
                                    }`}>
                                <tb.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                                <span>{tb.label}</span>
                            </button>
                        ))}
                        <div className="ml-auto pl-2 flex-shrink-0">
                            <button onClick={() => setShowUploadModal(true)}
                                className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition whitespace-nowrap">
                                <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                <span className="hidden sm:inline">Transférer un Fichier</span>
                                <span className="sm:hidden">Upload</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="w-full max-w-[1600px] mx-auto px-2 sm:px-4 py-3 sm:py-6 overflow-x-hidden">
                {tab === "dashboard" && <DashboardTab onNavigate={setTab} restricted={isRestricted} compactCards={compactCards} setCompactCards={setCompactCards} />}
                {tab === "achats" && <AchatsTab compactCards={compactCards} setCompactCards={setCompactCards} />}
                {tab === "frais" && <FraisTab compactCards={compactCards} setCompactCards={setCompactCards} />}
                {tab === "banque" && <BanqueTab compactCards={compactCards} setCompactCards={setCompactCards} />}
                {tab === "caisse" && <CaisseTab compactCards={compactCards} setCompactCards={setCompactCards} />}
                {tab === "rh" && <RHTab />}
                {tab === "audit" && <AuditTab />}
                {tab === "archives" && <ArchivesTab />}
                {tab === "fournisseurs" && <FournisseursTab />}
            </div>

            <FileUploadModal open={showUploadModal} onClose={() => setShowUploadModal(false)} />

            {!isRestricted && (
                <SuguChatWidget
                    restaurant="maillane"
                    persona="alfred"
                    accentFrom="from-teal-500"
                    accentTo="to-emerald-600"
                    isDark={isDark}
                />
            )}
        </div>
        </SuguThemeCtx.Provider>
    );
}
