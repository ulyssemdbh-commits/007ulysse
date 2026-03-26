import { useState, useEffect, useCallback, useContext, Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-provider";
import { ArrowLeft, Menu, Upload, Sun, Moon, LogOut, X, ShoppingCart, Receipt, Landmark, Users } from "lucide-react";

import { SuguThemeCtx } from "./suguval/context";
import { TABS } from "./suguval/types";
import { DashboardTab } from "./suguval/DashboardTab";
import { AchatsTab } from "./suguval/AchatsTab";
import { FraisTab } from "./suguval/FraisTab";
import { BanqueTab } from "./suguval/BanqueTab";
import { CaisseTab } from "./suguval/CaisseTab";
import { RHTab } from "./suguval/GestionRHTab";
import { ComptabiliteTab } from "./suguval/ComptabiliteTab";
import { AuditTab } from "./suguval/AuditTab";
import { FileUploadModal } from "./suguval/FileUploadModal";
import { ArchivesTab } from "./suguval/ArchivesTab";
import { FournisseursTab } from "./suguval/GestionRHTab";
import { HubriseTab } from "./suguval/HubriseTab";
import { SuguChatWidget } from "@/components/sugu/SuguChatWidget";

// ====== ERROR BOUNDARY ======
class SuguErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
    constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
    componentDidCatch(error: Error, info: ErrorInfo) { console.error("[SuguValManagement] Crash:", error, info); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-center">
                    <div className="text-center space-y-4 max-w-md">
                        <div className="w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto text-3xl">⚠️</div>
                        <h2 className="text-xl font-bold text-red-400">Erreur SUGU Valentine</h2>
                        <p className="text-sm text-white/50">{this.state.error?.message || "Une erreur inattendue est survenue."}</p>
                        <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
                            className="px-4 py-2 bg-orange-500 rounded-lg text-sm font-medium hover:bg-orange-600 transition">
                            Recharger la page
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

// ====== DEDICATED VALENTINE LOGIN ======
function SuguValLogin() {
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
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-bold text-3xl text-white mb-4 shadow-lg shadow-amber-500/30">V</div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">SUGU Valentine</h1>
                    <p className="text-white/40 text-sm mt-1">Espace Comptable</p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
                    <div>
                        <label className="block text-sm font-medium text-white/60 mb-1.5">Identifiant</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                            placeholder="Votre identifiant"
                            autoComplete="username"
                            data-testid="input-valentine-username"
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
                                className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 pr-12"
                                placeholder="••••••••"
                                autoComplete="current-password"
                                data-testid="input-valentine-password"
                                required
                            />
                            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition" tabIndex={-1}>
                                {showPw ? "🙈" : "👁"}
                            </button>
                        </div>
                    </div>
                    {error && <p className="text-red-400 text-sm text-center" data-testid="text-valentine-login-error">{error}</p>}
                    <button
                        type="submit"
                        disabled={loading || !username || !password}
                        className="w-full py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20"
                        data-testid="button-valentine-login"
                    >
                        {loading ? "Connexion..." : "Se connecter"}
                    </button>
                </form>
                <p className="text-center text-white/20 text-xs mt-6">Accès réservé · SUGU Valentine</p>
            </div>
        </div>
    );
}

// ====== MAIN COMPONENT ======
export default function SuguValManagement() {
    const { user, isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                <div className="text-center">
                    <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-bold text-lg text-white mb-3 animate-pulse">V</div>
                    <p className="text-white/40 text-sm">Chargement...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !user) {
        return <SuguValLogin />;
    }

    const allowed = user.isOwner || user.role === "suguval_only";
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
            <SuguValManagementInner />
        </SuguErrorBoundary>
    );
}

function SuguValManagementInner() {
    const [tab, setTab] = useState("dashboard");
    const [, navigate] = useLocation();
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [compactCards, setCompactCards] = useState(true);
    const [caisseOpenNew, setCaisseOpenNew] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const isRestricted = user?.role === "suguval_only";
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const handleDisconnect = useCallback(async () => {
        try { await logout(); window.location.reload(); } catch { window.location.reload(); }
    }, [logout]);

    // ====== AUTO-LOGOUT AFTER 2 MIN INACTIVITY (accountants only) ======
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

    return (
        <SuguThemeCtx.Provider value={isDark}>
            <div className={`min-h-screen w-full overflow-x-hidden ${bg} ${textMain}`}>
                {/* Header */}
                <div className={`border-b sticky top-0 z-50 ${headerBg} pt-safe`}>
                    <div className="w-full max-w-[1600px] mx-auto px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-4 overflow-hidden">
                        <button onClick={() => setMenuOpen(v => !v)}
                            className={`p-2 rounded-lg transition flex-shrink-0 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-200"}`}
                            title="Menu" data-testid="button-burger-menu">
                            <Menu className="w-5 h-5" />
                        </button>
                        {!isRestricted && (
                            <button onClick={() => navigate("/")} className={`p-1.5 sm:p-2 rounded-lg transition flex-shrink-0 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-200"}`} title="Retour" data-testid="button-back-home">
                                <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                        )}
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center font-bold text-base sm:text-lg text-white flex-shrink-0">S</div>
                            <div className="min-w-0">
                                <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent truncate">SUGU Valentine</h1>
                                <p className={`text-[10px] sm:text-xs ${textSub} truncate`}>{TABS.find(t => t.id === tab)?.label || "Dashboard"}</p>
                            </div>
                        </div>
                        <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => setTab("achats")}
                                data-testid="shortcut-achats"
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${tab === "achats" ? isDark ? "bg-orange-500/30 text-orange-300" : "bg-orange-100 text-orange-700" : isDark ? "bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90" : "bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800"}`}
                                title="Aller aux Achats">
                                <ShoppingCart className="w-3.5 h-3.5" />
                                Achats
                            </button>
                            <button onClick={() => setTab("frais")}
                                data-testid="shortcut-frais"
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${tab === "frais" ? isDark ? "bg-orange-500/30 text-orange-300" : "bg-orange-100 text-orange-700" : isDark ? "bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90" : "bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800"}`}
                                title="Aller aux Frais Généraux">
                                <Receipt className="w-3.5 h-3.5" />
                                Frais
                            </button>
                            <button onClick={() => setTab("banque")}
                                data-testid="shortcut-banque"
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${tab === "banque" ? isDark ? "bg-orange-500/30 text-orange-300" : "bg-orange-100 text-orange-700" : isDark ? "bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90" : "bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800"}`}
                                title="Aller à la Banque">
                                <Landmark className="w-3.5 h-3.5" />
                                Banque
                            </button>
                            <button onClick={() => setTab("rh")}
                                data-testid="shortcut-rh"
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${tab === "rh" ? isDark ? "bg-orange-500/30 text-orange-300" : "bg-orange-100 text-orange-700" : isDark ? "bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90" : "bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800"}`}
                                title="Aller à la Gestion RH">
                                <Users className="w-3.5 h-3.5" />
                                RH
                            </button>
                        </div>
                        <div className="ml-auto flex items-center gap-2 shrink-0">
                            {!isRestricted && (
                                <button onClick={() => setShowUploadModal(true)}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition whitespace-nowrap">
                                    <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                    <span className="hidden sm:inline">Transférer</span>
                                </button>
                            )}
                            <button
                                onClick={() => setTheme(isDark ? "light" : "dark")}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${isDark ? "bg-white/10 hover:bg-white/20 text-yellow-400 hover:text-yellow-300" : "bg-slate-100 hover:bg-slate-200 text-amber-500 hover:text-amber-600"}`}
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
                </div>

                {/* Lateral drawer */}
                {menuOpen && (
                    <div className="fixed inset-0 z-[200] flex" onClick={() => setMenuOpen(false)}>
                        <div className={`w-64 h-full ${isDark ? "bg-slate-900 border-r border-white/10" : "bg-white border-r border-slate-200"} shadow-2xl flex flex-col`} onClick={e => e.stopPropagation()}>
                            <div className={`flex items-center justify-between px-4 py-4 border-b ${isDark ? "border-white/10" : "border-slate-200"}`}>
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center font-bold text-white text-sm">S</div>
                                    <span className={`font-semibold text-sm ${isDark ? "text-white" : "text-slate-800"}`}>Manager</span>
                                </div>
                                <button onClick={() => setMenuOpen(false)} className={`p-1.5 rounded-lg ${isDark ? "hover:bg-white/10 text-white/50" : "hover:bg-slate-100 text-slate-400"} transition`}>
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <nav className="flex-1 overflow-y-auto py-2">
                                {TABS.map(tb => (
                                    <button key={tb.id} onClick={() => { setTab(tb.id); setMenuOpen(false); }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all ${tab === tb.id
                                            ? isDark ? "bg-orange-500/15 text-orange-400 border-r-2 border-orange-500" : "bg-orange-50 text-orange-600 border-r-2 border-orange-500"
                                            : isDark ? "text-white/60 hover:text-white hover:bg-white/5" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                                        <tb.icon className={`w-4 h-4 flex-shrink-0 ${tab === tb.id ? "text-orange-500" : ""}`} />
                                        {tb.label}
                                    </button>
                                ))}
                            </nav>
                            {!isRestricted && (
                                <div className={`p-3 border-t ${isDark ? "border-white/10" : "border-slate-200"}`}>
                                    <button onClick={() => { setShowUploadModal(true); setMenuOpen(false); }}
                                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition">
                                        <Upload className="w-4 h-4" /> Transférer un Fichier
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 bg-black/40 backdrop-blur-sm" />
                    </div>
                )}

                {/* Content */}
                <div className="w-full max-w-[1600px] mx-auto px-2 sm:px-4 py-3 sm:py-6 overflow-x-hidden">
                    {tab === "dashboard" && <DashboardTab onNavigate={setTab} onOpenUpload={() => setShowUploadModal(true)} onOpenNewCaisse={() => { setCaisseOpenNew(true); setTab("caisse"); }} restricted={isRestricted} compactCards={compactCards} setCompactCards={setCompactCards} />}
                    {tab === "achats" && <AchatsTab compactCards={compactCards} setCompactCards={setCompactCards} restricted={isRestricted} />}
                    {tab === "frais" && <FraisTab compactCards={compactCards} setCompactCards={setCompactCards} restricted={isRestricted} />}
                    {tab === "banque" && <BanqueTab compactCards={compactCards} setCompactCards={setCompactCards} restricted={isRestricted} />}
                    {tab === "caisse" && <CaisseTab compactCards={compactCards} setCompactCards={setCompactCards} restricted={isRestricted} autoOpenForm={caisseOpenNew} onAutoOpenDone={() => setCaisseOpenNew(false)} />}
                    {tab === "rh" && <RHTab restricted={isRestricted} />}
                    {tab === "audit" && <AuditTab restricted={isRestricted} />}
                    {tab === "comptabilite" && <ComptabiliteTab />}
                    {tab === "archives" && <ArchivesTab restricted={isRestricted} />}
                    {tab === "fournisseurs" && <FournisseursTab restricted={isRestricted} />}
                    {tab === "hubrise" && <HubriseTab />}
                </div>

                {/* Global Upload Modal */}
                <FileUploadModal open={showUploadModal} onClose={() => setShowUploadModal(false)} />

                {/* Chat Ulysse Widget */}
                {!isRestricted && (
                    <SuguChatWidget
                        restaurant="valentine"
                        persona="ulysse"
                        accentFrom="from-amber-500"
                        accentTo="to-orange-600"
                        isDark={isDark}
                    />
                )}
            </div>
        </SuguThemeCtx.Provider>
    );
}
