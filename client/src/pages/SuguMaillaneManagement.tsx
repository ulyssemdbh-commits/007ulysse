import { useState, useRef, useEffect, useMemo, useCallback, useContext, createContext, Component, type ErrorInfo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-provider";

// ====== SUGU THEME CONTEXT ======
const SuguThemeCtx = createContext(true);
function useSuguDark() { return useContext(SuguThemeCtx); }

import type { Purchase, Expense, BankEntry, Loan, CashEntry, Employee, Payroll, Absence, AuditOverview, SuguFile, SugumTrashItem, Supplier, Anomaly, AnomaliesResponse } from "./sugu/types";
import { FILE_CATEGORIES, PURCHASE_CATEGORIES, EXPENSE_CATEGORIES, CONTRACT_TYPES, ABSENCE_TYPES, PAYMENT_METHODS, MOIS_COURT, fmt, fmtEur, fmtEurSigned, safeFloat, safeInt, t, fmtDate, fmtDateShort, catLabel, bankOpType } from "./sugu/helpers";
import { SuguChatWidget } from "@/components/sugu/SuguChatWidget";
import { uploadFileAsBase64 } from "@/lib/uploadBase64";

// ====== ERROR BOUNDARY ======
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
import {
    ShoppingCart, Receipt, Landmark, CreditCard, Users, BarChart3,
    Plus, Trash2, Edit, Edit2, Check, X, TrendingUp, TrendingDown,
    Calendar, DollarSign, UserCheck, Clock, AlertTriangle, Building2,
    Upload, FileText, Loader2, Archive, FolderOpen, Image, Download, Search, Filter,
    ChevronUp, ChevronDown, Gauge, Home, ExternalLink, Utensils, ShieldAlert, RefreshCw, Eye,
    Sun, Moon, LogOut, Minimize2, Maximize2, CalendarRange, Paperclip, RotateCcw, Mail
} from "lucide-react";

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

// ====== DEDICATED MAILLANE LOGIN ======
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

// ====== MAIN COMPONENT ======
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
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [compactCards, setCompactCards] = useState(false);
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const isRestricted = user?.role === "sugumaillane_only";
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

    // Shared theme-aware class helpers
    const bg = isDark ? "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" : "bg-gradient-to-br from-slate-50 via-white to-slate-100";
    const textMain = isDark ? "text-white" : "text-slate-900";
    const textSub = isDark ? "text-white/50" : "text-slate-500";
    const textMuted = isDark ? "text-white/40" : "text-slate-400";
    const headerBg = isDark ? "border-white/10 bg-black/40 backdrop-blur-xl" : "border-slate-200 bg-white/90 backdrop-blur-xl shadow-sm";
    const tabInactive = isDark ? "text-white/50 hover:text-white/80 hover:bg-white/5" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100";

    return (
        <SuguThemeCtx.Provider value={isDark}>
        <div className={`min-h-screen w-full overflow-x-hidden ${bg} ${textMain}`}>
            {/* Header */}
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
                {/* Tabs + upload */}
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

            {/* Content */}
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

            {/* Global Upload Modal */}
            <FileUploadModal open={showUploadModal} onClose={() => setShowUploadModal(false)} />

            {/* Chat Alfred Widget */}
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

// ====== CARD WRAPPER ======
function Card({ title, icon: Icon, children, action, extra, cardId, defaultCollapsed }: { title: string; icon: any; children: React.ReactNode; action?: React.ReactNode; extra?: React.ReactNode; cardId?: string; defaultCollapsed?: boolean }) {
    const dk = useSuguDark();
    const storageKey = useMemo(() => {
        const raw = cardId || title;
        return raw ? `sugum-card-${raw.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
    }, [cardId, title]);

    const [collapsed, setCollapsed] = useState(() => {
        if (!storageKey || typeof window === "undefined") return defaultCollapsed ?? false;
        const saved = localStorage.getItem(storageKey);
        if (saved === "collapsed") return true;
        if (saved === "expanded") return false;
        return defaultCollapsed ?? false;
    });

    useEffect(() => {
        if (!storageKey || typeof window === "undefined") return;
        localStorage.setItem(storageKey, collapsed ? "collapsed" : "expanded");
    }, [collapsed, storageKey]);

    return (
        <div className={dk ? "bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm" : "bg-white border border-slate-200 rounded-2xl shadow-sm"}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 text-teal-500" />
                    <h2 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{title}</h2>
                </div>
                <div className="flex items-center gap-2">
                    {extra}
                    {action}
                    <button
                        onClick={() => setCollapsed(v => !v)}
                        className={`p-2 rounded-lg transition ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}
                        title={collapsed ? "Agrandir la carte" : "Réduire la carte"}
                        aria-label={collapsed ? "Agrandir la carte" : "Réduire la carte"}
                    >
                        {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                </div>
            </div>
            {!collapsed && <div className="p-5">{children}</div>}
        </div>
    );
}

// ====== STAT CARD ======
function StatCard({ label, value, icon: Icon, trend, color = "orange", compact, warning }: { label: string; value: string; icon: any; trend?: "up" | "down"; color?: string; compact?: boolean; warning?: string }) {
    const dk = useSuguDark();
    const darkMap: Record<string, string> = {
        orange: "from-teal-500/20 to-teal-600/10 border-teal-500/20",
        green: "from-green-500/20 to-green-600/10 border-green-500/20",
        red: "from-red-500/20 to-red-600/10 border-red-500/20",
        blue: "from-blue-500/20 to-blue-600/10 border-blue-500/20",
        purple: "from-purple-500/20 to-purple-600/10 border-purple-500/20",
    };
    const lightMap: Record<string, string> = {
        orange: "from-teal-50 to-teal-100/60 border-teal-200",
        green: "from-green-50 to-green-100/60 border-green-200",
        red: "from-red-50 to-red-100/60 border-red-200",
        blue: "from-blue-50 to-blue-100/60 border-blue-200",
        purple: "from-purple-50 to-purple-100/60 border-purple-200",
    };
    const iconDkMap: Record<string, string> = { orange: "text-teal-400", green: "text-green-400", red: "text-red-400", blue: "text-blue-400", purple: "text-purple-400" };
    const iconLtMap: Record<string, string> = { orange: "text-teal-500", green: "text-green-600", red: "text-red-500", blue: "text-blue-500", purple: "text-purple-500" };

    if (compact) {
        return (
            <div className={`bg-gradient-to-br ${dk ? darkMap[color] : lightMap[color]} border rounded-lg px-3 py-2 flex items-center gap-2`} title={warning || undefined}>
                <Icon className={`w-4 h-4 flex-shrink-0 ${dk ? (iconDkMap[color] || "text-white/60") : (iconLtMap[color] || "text-slate-500")}`} />
                <p className={`text-sm font-bold ${dk ? "text-white" : "text-slate-800"} truncate`}>{value}</p>
                <p className={`text-[10px] ${dk ? "text-white/50" : "text-slate-500"} truncate hidden sm:block`}>{label}</p>
                {warning && <span className="ml-auto text-amber-400 text-xs flex-shrink-0" title={warning}>⚠</span>}
                {!warning && trend === "up" && <TrendingUp className="w-3 h-3 text-green-500 flex-shrink-0 ml-auto" />}
                {!warning && trend === "down" && <TrendingDown className="w-3 h-3 text-red-500 flex-shrink-0 ml-auto" />}
            </div>
        );
    }

    return (
        <div className={`bg-gradient-to-br ${dk ? darkMap[color] : lightMap[color]} border rounded-xl p-4`}>
            <div className="flex items-center justify-between mb-2">
                <Icon className={`w-5 h-5 ${dk ? (iconDkMap[color] || "text-white/60") : (iconLtMap[color] || "text-slate-500")}`} />
                <div className="flex items-center gap-1">
                    {warning && <span className="text-amber-400 text-xs" title={warning}>⚠</span>}
                    {trend === "up" && <TrendingUp className="w-4 h-4 text-green-500" />}
                    {trend === "down" && <TrendingDown className="w-4 h-4 text-red-500" />}
                </div>
            </div>
            <p className={`text-2xl font-bold ${dk ? "text-white" : "text-slate-800"}`}>{value}</p>
            <p className={`text-xs mt-1 ${dk ? "text-white/50" : "text-slate-500"}`}>{label}</p>
            {warning && <p className="text-[10px] text-amber-400 mt-1 leading-tight">{warning}</p>}
        </div>
    );
}

// ====== FORM MODAL ======
function FormModal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
    const dk = useSuguDark();
    if (!open) return null;
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className={`${dk ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"} border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{title}</h3>
                    <button onClick={onClose} className={`p-1 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`} title="Fermer"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">{children}</div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    const dk = useSuguDark();
    return (
        <label className="block">
            <span className={`block text-sm mb-1 ${dk ? "text-white/60" : "text-slate-600"}`}>{label}</span>
            {children}
        </label>
    );
}

function useInputClass() {
    const dk = useSuguDark();
    return dk
        ? "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50 [color-scheme:dark]"
        : "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30";
}

const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50";
const selectClass = inputClass;
const btnPrimary = "bg-gradient-to-r from-teal-500 to-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center gap-2";
const btnDanger = "bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg text-xs hover:bg-red-500/30 transition";

// ====== DASHBOARD BOSS TAB ======
function CardSizeToggle({ compact, setCompact }: { compact: boolean; setCompact: (v: boolean) => void }) {
    const dk = useSuguDark();
    return (
        <button
            onClick={() => setCompact(!compact)}
            className={`p-1.5 rounded-lg transition ${dk ? "hover:bg-white/10 text-white/50 hover:text-white/80" : "hover:bg-slate-200 text-slate-400 hover:text-slate-600"}`}
            title={compact ? "Agrandir les cartes" : "Réduire les cartes"}
            data-testid="button-toggle-card-size"
        >
            {compact ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
        </button>
    );
}

function DashboardTab({ onNavigate, restricted, compactCards, setCompactCards }: { onNavigate: (tab: string) => void; restricted?: boolean; compactCards: boolean; setCompactCards: (v: boolean) => void }) {
    const dk = useSuguDark();
    const year = new Date().getFullYear().toString();

    const { data: audit, isLoading: auditLoading } = useQuery<AuditOverview | null>({
        queryKey: ["/api/v2/sugumaillane-management/audit/overview", year],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugumaillane-management/audit/overview?year=${year}`, { credentials: "include" });
            if (!res.ok) return null;
            return res.json();
        },
    });

    const { data: anomaliesData, isLoading: anomLoading } = useQuery<AnomaliesResponse | null>({
        queryKey: ["/api/v2/sugumaillane-management/anomalies"],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugumaillane-management/anomalies?days=30`, { credentials: "include" });
            if (!res.ok) return null;
            return res.json();
        },
    });

    const { data: employees = [] } = useQuery<Employee[]>({
        queryKey: ["/api/v2/sugumaillane-management/employees"],
    });

    const { data: cashEntries = [] } = useQuery<CashEntry[]>({
        queryKey: ["/api/v2/sugumaillane-management/cash"],
    });

    const loading = auditLoading || anomLoading;
    const activeEmps = employees.filter(e => e.isActive);
    const anomalies = anomaliesData?.anomalies || [];
    const highSeverity = anomalies.filter(a => a.severity === "haute").length;
    const medSeverity = anomalies.filter(a => a.severity === "moyenne").length;

    // Last 7 cash entries for mini sparkline
    const last7Cash = [...cashEntries].sort((a, b) => b.entryDate.localeCompare(a.entryDate)).slice(0, 7).reverse();
    const maxCash = Math.max(...last7Cash.map(c => c.totalRevenue), 1);

    // Health score (simple heuristic)
    const healthScore = audit ? Math.min(100, Math.max(0,
        50
        + (parseFloat(audit.profitMargin) > 0 ? 20 : -10)
        + (audit.unpaidPurchases < 1000 ? 10 : -5)
        + (audit.unpaidExpenses < 500 ? 10 : -5)
        + (highSeverity === 0 ? 10 : -highSeverity * 5)
    )) : 0;

    const healthColor = healthScore >= 70 ? "text-green-400" : healthScore >= 40 ? "text-yellow-400" : "text-red-400";
    const healthBg = healthScore >= 70 ? "from-green-500/20 to-green-600/10 border-green-500/20" : healthScore >= 40 ? "from-yellow-500/20 to-yellow-600/10 border-yellow-500/20" : "from-red-500/20 to-red-600/10 border-red-500/20";

    if (loading) {
        return (
            <div className={`flex items-center justify-center py-20 gap-3 ${dk ? "text-white/50" : "text-slate-500"}`}>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Chargement du Dashboard Boss...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 w-full min-w-0">
            {/* Hero header */}
            <div className="bg-gradient-to-r from-teal-500/10 via-emerald-500/5 to-slate-900/50 border border-teal-500/20 rounded-2xl p-4 sm:p-6 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 min-w-0">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                            <Utensils className={`w-5 h-5 sm:w-7 sm:h-7 ${dk ? "text-white" : "text-slate-800"}`} />
                        </div>
                        <div>
                            <h2 className="text-lg sm:text-2xl font-bold text-[#525050] leading-tight">SUGU Maillane — Dashboard Boss</h2>
                            <p className={`text-xs sm:text-sm ${dk ? "text-white/50" : "text-slate-500"}`}>Vue d'ensemble {year} • Mise à jour en temps réel</p>
                        </div>
                    </div>
                    {!restricted && (
                        <div className="flex flex-wrap gap-2 sm:ml-auto">
                            <a href="/courses/sugumaillane" className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg text-xs sm:text-sm ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition`}>
                                <ShoppingCart className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Courses du jour
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    )}
                </div>
            </div>
            {/* KPI Row */}
            <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${dk ? "text-white/40" : "text-slate-400"}`}>Indicateurs clés</span>
                <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
            </div>
            <div className={`grid ${compactCards ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 md:grid-cols-4 lg:grid-cols-6"} gap-3`}>
                {/* Health Score */}
                {compactCards ? (
                    <div className={`bg-gradient-to-br ${healthBg} border rounded-lg px-3 py-2 flex items-center gap-2 cursor-pointer hover:opacity-90 transition`} onClick={() => onNavigate("audit")}>
                        <Gauge className={`w-4 h-4 flex-shrink-0 ${dk ? "text-white/60" : "text-slate-600"}`} />
                        <p className={`text-sm font-bold ${healthColor} truncate`}>{healthScore}</p>
                        <p className={`text-[10px] ${dk ? "text-white/50" : "text-slate-500"} truncate hidden sm:block`}>Score Santé</p>
                        <span className={`text-[10px] font-bold ${healthColor} ml-auto flex-shrink-0`}>
                            {healthScore >= 70 ? "BON" : healthScore >= 40 ? "MOYEN" : "ALERTE"}
                        </span>
                    </div>
                ) : (
                    <div className={`bg-gradient-to-br ${healthBg} border rounded-xl p-4 cursor-pointer hover:opacity-90 transition`} onClick={() => onNavigate("audit")}>
                        <div className="flex items-center justify-between mb-2">
                            <Gauge className={`w-5 h-5 ${dk ? "text-white/60" : "text-slate-600"}`} />
                            <span className={`text-xs font-bold ${healthColor}`}>
                                {healthScore >= 70 ? "BON" : healthScore >= 40 ? "MOYEN" : "ALERTE"}
                            </span>
                        </div>
                        <p className={`text-3xl font-bold ${healthColor}`}>{healthScore}</p>
                        <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"} mt-1`}>Score Santé</p>
                    </div>
                )}

                <StatCard label={`CA ${year}`} value={fmtEur(audit?.totalRevenue)} icon={TrendingUp} color="green" compact={compactCards} />
                <StatCard label="Marge opérat." value={audit ? `${audit.profitMargin}%` : "-"} icon={BarChart3}
                    color={audit && parseFloat(audit.profitMargin) > 0 ? "green" : "red"}
                    trend={audit && parseFloat(audit.profitMargin) > 0 ? "up" : "down"} compact={compactCards} />
                <StatCard label="CA / jour moy." value={fmtEur(audit?.avgDailyRevenue)} icon={DollarSign} color="blue" compact={compactCards} />
                <StatCard label="Ticket moyen" value={fmtEur(audit?.avgTicket)} icon={CreditCard} color="purple" compact={compactCards} />
                <StatCard label="Employés actifs" value={String(activeEmps.length)} icon={UserCheck} color="orange" compact={compactCards} />
            </div>
            {/* Second row: financial state + alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Financial Snapshot */}
                <div className={`lg:col-span-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5 overflow-hidden`}>
                    <div className="flex items-center gap-2 mb-4 min-w-0">
                        <Landmark className="w-5 h-5 text-teal-400 flex-shrink-0" />
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} truncate`}>Synthèse Financière</h3>
                        <button onClick={() => onNavigate("audit")} className="ml-auto text-xs text-teal-400 hover:underline flex items-center gap-1">
                            Voir audit complet <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                    {audit ? (
                        <div className="space-y-4">
                            {/* Cost breakdown bar */}
                            <div className="space-y-2">
                                {[
                                    { label: "Achats", value: audit.costBreakdown.achats, color: "bg-teal-500" },
                                    { label: "Frais Généraux", value: audit.costBreakdown.fraisGeneraux, color: "bg-blue-500" },
                                    { label: "Salaires", value: audit.costBreakdown.salaires, color: "bg-purple-500" },
                                    { label: "Charges Sociales", value: audit.costBreakdown.chargesSociales, color: "bg-pink-500" },
                                    { label: "Emprunts", value: audit.costBreakdown.emprunts, color: "bg-red-500" },
                                ].map(item => {
                                    const pct = audit.totalCosts > 0 ? (item.value / audit.totalCosts) * 100 : 0;
                                    return (
                                        <div key={item.label} className="flex items-center gap-2 min-w-0">
                                            <span className={`text-xs ${dk ? "text-white/50" : "text-slate-500"} w-24 sm:w-28 flex-shrink-0 truncate`}>{item.label}</span>
                                            <div className={`flex-1 min-w-0 ${dk ? "bg-white/5" : "bg-slate-100"} rounded-full h-2`}>
                                                <div className={`${item.color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(100, Math.round(pct))}%` }} />
                                            </div>
                                            <span className={`text-xs ${dk ? "text-white/70" : "text-slate-700"} w-20 sm:w-24 text-right flex-shrink-0 tabular-nums`}>{fmtEur(item.value)}</span>
                                            <span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} w-8 text-right flex-shrink-0 tabular-nums`}>{pct.toFixed(0)}%</span>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Key metrics row */}
                            <div className={`grid grid-cols-3 gap-3 pt-2 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                                <div>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Impayés fourn.</p>
                                    <p className={`text-lg font-bold ${audit.unpaidPurchases > 2000 ? "text-red-400" : dk ? "text-white" : "text-slate-800"}`}>
                                        {fmtEur(audit.unpaidPurchases)}
                                    </p>
                                </div>
                                <div>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Impayés frais</p>
                                    <p className={`text-lg font-bold ${audit.unpaidExpenses > 1000 ? "text-red-400" : dk ? "text-white" : "text-slate-800"}`}>
                                        {fmtEur(audit.unpaidExpenses)}
                                    </p>
                                </div>
                                <div>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Capital emprunts</p>
                                    <p className={`text-lg font-bold ${dk ? "text-white" : "text-slate-800"}`}>{fmtEur(audit.totalRemainingLoans)}</p>
                                </div>
                            </div>
                            {/* Mini revenue chart for last 7 days caisse */}
                            {last7Cash.length > 0 && (
                                <div className={`pt-3 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} mb-2`}>CA 7 derniers jours (caisse)</p>
                                    <div className="flex items-end gap-1 h-16">
                                        {last7Cash.map((c, i) => (
                                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                                <div className="w-full bg-gradient-to-t from-teal-500 to-teal-400 rounded-t min-h-[4px]" style={{ height: `${Math.round(c.totalRevenue / maxCash * 100)}%` }} />
                                                <span className={`text-[9px] ${dk ? "text-white/30" : "text-slate-300"}`}>{fmtDateShort(c.entryDate)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className={`text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Aucune donnée financière pour {year}</p>
                    )}
                </div>

                {/* Anomalies / Alerts */}
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <div className="flex items-center gap-2 mb-4">
                        <ShieldAlert className="w-5 h-5 text-red-400" />
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Alertes & Anomalies</h3>
                        <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${highSeverity > 0 ? "bg-red-500/20 text-red-400" :
                            medSeverity > 0 ? "bg-yellow-500/20 text-yellow-400" :
                                "bg-green-500/20 text-green-400"
                            }`}>
                            {anomalies.length === 0 ? "RAS" : `${anomalies.length} alerte${anomalies.length > 1 ? "s" : ""}`}
                        </span>
                    </div>
                    {anomalies.length === 0 ? (
                        <div className="text-center py-6">
                            <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
                            <p className={`text-sm ${dk ? "text-white/50" : "text-slate-500"}`}>Aucune anomalie détectée sur 30 jours</p>
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                            {anomalies.slice(0, 15).map((a, i) => (
                                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${a.severity === "haute" ? "bg-red-500/10 border-red-500/20" :
                                    a.severity === "moyenne" ? "bg-yellow-500/10 border-yellow-500/20" :
                                        "bg-blue-500/10 border-blue-500/20"
                                    }`}>
                                    <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${a.severity === "haute" ? "text-red-400" :
                                        a.severity === "moyenne" ? "text-yellow-400" : "text-blue-400"
                                        }`} />
                                    <div className="min-w-0">
                                        <span className={`text-[10px] font-bold uppercase ${a.severity === "haute" ? "text-red-400" :
                                            a.severity === "moyenne" ? "text-yellow-400" : "text-blue-400"
                                            }`}>
                                            {a.type.replace(/_/g, " ")}
                                        </span>
                                        <p className={`text-xs ${dk ? "text-white/70" : "text-slate-700"} mt-0.5`}>{a.description}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {/* Quick actions row */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                {[
                    { id: "achats", label: "Achats", icon: ShoppingCart, desc: "Factures fournisseurs", badge: audit ? `${fmt(audit.costBreakdown.achats)}` : undefined },
                    { id: "frais", label: "Frais Gén.", icon: Receipt, desc: "Charges fixes", badge: audit?.unpaidExpenses ? `${fmt(audit.unpaidExpenses)} impayés` : undefined },
                    { id: "banque", label: "Banque", icon: Landmark, desc: "Relevés & écritures" },
                    { id: "caisse", label: "Caisse", icon: CreditCard, desc: "Journal CA quotidien" },
                    { id: "rh", label: "RH", icon: Users, desc: `${activeEmps.length} employé${activeEmps.length > 1 ? "s" : ""}` },
                    { id: "audit", label: "Audit", icon: BarChart3, desc: "Bilan complet" },
                    { id: "archives", label: "Archives", icon: Archive, desc: "Documents classés" },
                ].map(item => (
                    <button key={item.id} onClick={() => onNavigate(item.id)}
                        className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-4 ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition text-left group`}>
                        <item.icon className="w-5 h-5 text-teal-400 mb-2 group-hover:scale-110 transition-transform" />
                        <p className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"}`}>{item.label}</p>
                        <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"} mt-0.5`}>{item.desc}</p>
                        {item.badge && <p className="text-[10px] text-teal-400 mt-1 font-mono">{item.badge}</p>}
                    </button>
                ))}
            </div>
            {/* Monthly revenue trend */}
            {audit?.monthlyRevenue && Object.keys(audit.monthlyRevenue).length > 0 && (
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-5 h-5 text-teal-400" />
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Évolution CA Mensuel {year}</h3>
                        <button onClick={() => onNavigate("audit")} className="ml-auto text-xs text-teal-400 hover:underline flex items-center gap-1">Détails <ExternalLink className="w-3 h-3" /></button>
                    </div>
                    <div className="flex items-end gap-2 h-24">
                        {Object.entries(audit.monthlyRevenue).sort().map(([month, revenue]) => {
                            const maxMonthRev = Math.max(...Object.values(audit.monthlyRevenue), 1);
                            const pct = (revenue / maxMonthRev) * 100;
                            return (
                                <div key={month} className="flex-1 flex flex-col items-center gap-1">
                                    <span className={`text-[9px] ${dk ? "text-white/50" : "text-slate-500"} font-mono`}>{fmt(revenue)}</span>
                                    <div className="w-full bg-gradient-to-t from-teal-500 to-emerald-500 rounded-t min-h-[4px]" style={{ height: `${Math.max(5, pct)}%` }} />
                                    <span className={`text-[9px] ${dk ? "text-white/30" : "text-slate-300"}`}>{month.slice(5)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {/* RH quick summary */}
            {activeEmps.length > 0 && (
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <div className="flex items-center gap-2 mb-3">
                        <Users className="w-5 h-5 text-teal-400" />
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Équipe Active</h3>
                        <button onClick={() => onNavigate("rh")} className="ml-auto text-xs text-teal-400 hover:underline flex items-center gap-1">
                            Gérer RH <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                        {activeEmps.slice(0, 10).map(emp => (
                            <div key={emp.id} className={`flex items-center gap-3 ${dk ? "bg-white/5" : "bg-white"} rounded-lg p-3`}>
                                <div className={`w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-xs font-bold ${dk ? "text-white" : "text-slate-800"}`}>
                                    {emp.firstName[0]}{emp.lastName[0]}
                                </div>
                                <div className="min-w-0">
                                    <p className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`}>{emp.firstName} {emp.lastName}</p>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"}`}>{emp.role || emp.contractType}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className={`flex gap-4 mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-200"} text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>
                        <span>Masse salariale: <strong className={`${dk ? "text-white" : "text-slate-800"}`}>{fmtEur(activeEmps.reduce((s, e) => s + (e.monthlySalary || 0), 0))}/mois</strong></span>
                        <span>CDI: {activeEmps.filter(e => e.contractType === "CDI").length}</span>
                        <span>CDD: {activeEmps.filter(e => e.contractType === "CDD").length}</span>
                        <span>Extra: {activeEmps.filter(e => e.contractType === "Extra").length}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

const fmtSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo` : `${(bytes / 1024).toFixed(0)} Ko`;
const isFileMimeImage = (mime: string) => mime.startsWith("image/");
const isFilePreviewable = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");

function FilePreviewModal({ file, onClose }: { file: SuguFile; onClose: () => void }) {
    const dk = useSuguDark();
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className={`relative w-[95vw] max-w-5xl h-[90vh] ${dk ? "bg-slate-900" : "bg-white"} rounded-2xl shadow-2xl border ${dk ? "border-white/10" : "border-slate-200"} flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-3 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                        <Eye className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <span className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`}>{file.originalName}</span>
                        <span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{fmtSize(file.fileSize)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <a href={`/api/v2/sugumaillane-management/files/${file.id}/download`} target="_blank" rel="noreferrer"
                            className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition" title="Ouvrir dans un nouvel onglet">
                            <ExternalLink className="w-4 h-4" />
                        </a>
                        <a href={`/api/v2/sugumaillane-management/files/${file.id}/download`} download={file.originalName}
                            className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition" title="Télécharger">
                            <Download className="w-4 h-4" />
                        </a>
                        <button onClick={onClose} className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition" title="Fermer" data-testid="btn-close-preview">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    {isFileMimeImage(file.mimeType) ? (
                        <div className="flex items-center justify-center h-full p-4">
                            <img src={`/api/v2/sugumaillane-management/files/${file.id}/download`} alt={file.originalName} className="max-w-full max-h-full object-contain rounded-lg" />
                        </div>
                    ) : (
                        <iframe src={`/api/v2/sugumaillane-management/files/${file.id}/download`} className="w-full h-full border-0" title={file.originalName} />
                    )}
                </div>
            </div>
        </div>
    );
}

// ====== INLINE EMAIL SEND (reusable) ======
function InlineEmailSend({ fileId, onDone }: { fileId: number; onDone: () => void }) {
    const dk = useSuguDark();
    const [email, setEmail] = useState("x.markassuza@eyssautier.com");
    const [sending, setSending] = useState(false);
    const { toast } = useToast();
    const qc = useQueryClient();
    return (
        <div className={`flex items-center gap-2 mt-1 p-2 rounded-lg ${dk ? "bg-white/5 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={`flex-1 text-xs px-2 py-1.5 rounded border ${dk ? "bg-white/10 border-white/20 text-white" : "bg-white border-slate-300 text-slate-800"}`} placeholder="email@example.com" data-testid="input-email-send" />
            <button disabled={sending || !email.includes("@")} onClick={async () => {
                setSending(true);
                try {
                    await apiRequest("POST", `/api/v2/sugumaillane-management/files/${fileId}/send-email`, { to: email });
                    toast({ title: `Envoyé à ${email}` });
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
                    onDone();
                } catch { toast({ title: "Erreur d'envoi", variant: "destructive" }); }
                setSending(false);
            }} className="px-2 py-1.5 text-xs rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition disabled:opacity-50" data-testid="btn-confirm-email-send">
                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Envoyer"}
            </button>
            <button onClick={onDone} className="px-1.5 py-1.5 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"><X className="w-3 h-3" /></button>
        </div>
    );
}

// ====== CATEGORY FILES SECTION (reusable in Banque / RH tabs) ======
function CategoryFiles({ category, label }: { category: string; label: string }) {
    const dk = useSuguDark();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);
    const [emailFileId, setEmailFileId] = useState<number | null>(null);

    const { data: files = [] } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugumaillane-management/files", category],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugumaillane-management/files?category=${category}`, { credentials: "include" });
            return res.json();
        }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/trash"] });
            toast({ title: "Fichier déplacé dans la corbeille", description: "Vous avez 7 jours pour le restaurer depuis l'onglet Archives." });
        },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le fichier", variant: "destructive" }); }
    });

    const emailCount = files.filter(f => f.emailedTo && f.emailedTo.length > 0).length;

    if (files.length === 0) return null;

    return (
        <Card title={`Documents ${label}`} icon={FolderOpen} extra={files.length > 0 && <span className={`text-xs px-2 py-0.5 rounded-full ${emailCount === files.length ? "bg-emerald-500/20 text-emerald-400" : emailCount > 0 ? "bg-orange-500/20 text-orange-400" : "bg-slate-500/20 text-slate-400"}`}>{emailCount}/{files.length} envoyé</span>}>
            <div className="space-y-2">
                {files.map(f => (
                    <div key={f.id}>
                        <div className={`flex items-center gap-3 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-2.5 ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition`}>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                {isFileMimeImage(f.mimeType) ? <Image className="w-4 h-4 text-purple-400" /> : <FileText className="w-4 h-4 text-blue-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`} title={f.originalName}>{f.originalName}</p>
                                <div className={`flex items-center gap-2 text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>
                                    {f.supplier && <span>{f.supplier}</span>}
                                    {f.fileDate && <span>{fmtDate(f.fileDate)}</span>}
                                    <span>{fmtSize(f.fileSize)}</span>
                                    {f.emailedTo && f.emailedTo.length > 0 && <span className="text-emerald-400">envoyé</span>}
                                </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <button
                                    onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugumaillane-management/files/${f.id}/download`, "_blank")}
                                    className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-1.5 rounded-lg text-xs hover:bg-purple-500/30 transition flex items-center gap-1"
                                    title="Aperçu"
                                    data-testid={`btn-preview-file-${f.id}`}
                                >
                                    <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setEmailFileId(emailFileId === f.id ? null : f.id)}
                                    className={`px-2 py-1.5 rounded-lg text-xs transition flex items-center gap-1 ${f.emailedTo?.length ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30"}`}
                                    title="Envoyer par email" data-testid={`btn-email-file-${f.id}`}>
                                    <Mail className="w-3.5 h-3.5" />
                                </button>
                                <a href={`/api/v2/sugumaillane-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                    className={btnPrimary + " !px-2 !py-1.5"} title="Télécharger">
                                    <Download className="w-3.5 h-3.5" />
                                </a>
                                <button onClick={() => { if (confirm(`Mettre "${f.originalName}" dans la corbeille ?\n\nVous aurez 7 jours pour le restaurer.`)) deleteMut.mutate(f.id); }} className={btnDanger} title="Déplacer dans la corbeille" data-testid={`button-delete-file-${f.id}`}>
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        {emailFileId === f.id && <InlineEmailSend fileId={f.id} onDone={() => setEmailFileId(null)} />}
                    </div>
                ))}
            </div>
            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        </Card>
    );
}

// ====== ACHATS TAB ======
function AchatsTab({ compactCards, setCompactCards }: { compactCards: boolean; setCompactCards: (v: boolean) => void }) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
    const [form, setForm] = useState<Partial<Purchase>>({ category: "alimentaire", isPaid: false, paymentMethod: "virement" });
    const [editForm, setEditForm] = useState<Partial<Purchase>>({});
    const [searchTerm, setSearchTerm] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "unpaid">("all");
    const [sort, setSort] = useState<{ field: "date" | "supplier" | "category" | "amount" | "paid"; dir: "asc" | "desc" }>({ field: "date", dir: "desc" });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [quickSupplier, setQuickSupplier] = useState("");
    const [quickAmount, setQuickAmount] = useState("");
    const [quickCategory, setQuickCategory] = useState("alimentaire");
    const [quickInvDate, setQuickInvDate] = useState(new Date().toISOString().substring(0, 10));

    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);
    const { data: purchases = [] } = useQuery<Purchase[]>({ queryKey: ["/api/v2/sugumaillane-management/purchases"] });
    const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] });
    const { data: achatsFiles = [] } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugumaillane-management/files", "achats"],
        queryFn: async () => { const r = await fetch("/api/v2/sugumaillane-management/files?category=achats", { credentials: "include" }); return r.json(); }
    });

    const defaultForm = { category: "alimentaire", isPaid: false, paymentMethod: "virement" };

    const createMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/purchases", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/purchases"] }); setShowForm(false); setForm(defaultForm); toast({ title: "Achat enregistré" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible d'enregistrer l'achat: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const quickCreateMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/purchases", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/purchases"] }); setQuickSupplier(""); setQuickAmount(""); toast({ title: "Achat ajouté (rapide)" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugumaillane-management/purchases/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/purchases"] }); setEditingPurchase(null); toast({ title: "Achat modifié" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible de modifier l'achat: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/purchases/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/purchases"] }); toast({ title: "Achat supprimé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer l'achat", variant: "destructive" }); }
    });

    const togglePaid = useMutation({
        mutationFn: (p: Purchase) => apiRequest("PUT", `/api/v2/sugumaillane-management/purchases/${p.id}`, { isPaid: !p.isPaid }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/purchases"] }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier le statut", variant: "destructive" }); }
    });

    const openEdit = (p: Purchase) => {
        setEditingPurchase(p);
        setEditForm({ supplier: p.supplier, category: p.category, description: p.description, amount: p.amount, taxAmount: p.taxAmount, invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate, dueDate: p.dueDate, isPaid: p.isPaid, paymentMethod: p.paymentMethod });
    };

    const totalTTC = purchases.reduce((s, p) => s + (p.amount || 0), 0);
    const totalTVA = purchases.reduce((s, p) => s + (p.taxAmount || 0), 0);
    const unpaid = purchases.filter(p => !p.isPaid).reduce((s, p) => s + p.amount, 0);

    const today = useMemo(() => new Date(), []);

    const { filtered, pageData, totalPages, stats, filteredTotalTTC, filteredTotalTVA } = useMemo(() => {
        const withMeta = purchases.map(p => {
            const due = p.dueDate ? new Date(`${p.dueDate}T00:00:00`) : null;
            const isOverdue = !p.isPaid && due && due < today;
            const isDueSoon = !p.isPaid && due && due >= today && (due.getTime() - today.getTime()) <= 30 * 86400000;
            return { ...p, due, isOverdue: !!isOverdue, isDueSoon: !!isDueSoon };
        });

        let list = withMeta;
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            list = list.filter(p => p.supplier.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q) || (p.invoiceNumber || "").toLowerCase().includes(q));
        }
        if (categoryFilter !== "all") list = list.filter(p => p.category === categoryFilter);
        if (paidFilter === "paid") list = list.filter(p => p.isPaid);
        if (paidFilter === "unpaid") list = list.filter(p => !p.isPaid);

        list = [...list].sort((a, b) => {
            let cmp = 0;
            switch (sort.field) {
                case "date": cmp = (a.invoiceDate || "").localeCompare(b.invoiceDate || ""); break;
                case "supplier": cmp = a.supplier.localeCompare(b.supplier, "fr", { sensitivity: "base" }); break;
                case "category": cmp = a.category.localeCompare(b.category); break;
                case "amount": cmp = a.amount - b.amount; break;
                case "paid": cmp = Number(a.isPaid) - Number(b.isPaid); break;
            }
            return sort.dir === "asc" ? cmp : -cmp;
        });

        const byCategory: Record<string, number> = {};
        list.forEach(p => { const k = normalizeCatKey(p.category); byCategory[k] = (byCategory[k] || 0) + p.amount; });
        const overdueCount = withMeta.filter(p => p.isOverdue).length;
        const dueSoonCount = withMeta.filter(p => p.isDueSoon).length;

        const tp = Math.max(1, Math.ceil(list.length / pageSize));
        const cp = Math.min(page, tp);
        const pageSlice = list.slice((cp - 1) * pageSize, cp * pageSize);
        const filteredTotalTTC = list.reduce((s, p) => s + (p.amount || 0), 0);
        const filteredTotalTVA = list.reduce((s, p) => s + (p.taxAmount || 0), 0);
        return { filtered: list, pageData: pageSlice, totalPages: tp, stats: { byCategory, overdueCount, dueSoonCount }, filteredTotalTTC, filteredTotalTVA };
    }, [purchases, searchTerm, categoryFilter, paidFilter, sort, page, pageSize, today]);

    useEffect(() => { setPage(1); }, [searchTerm, categoryFilter, paidFilter, sort]);

    const exportCSV = () => {
        if (filtered.length === 0) return toast({ title: "Aucune donnée à exporter" });
        const header = ["Date Facture", "Fournisseur", "Catégorie", "Description", "N° Facture", "Montant TTC", "TVA", "Échéance", "Payé", "Mode Paiement"];
        const rows = filtered.map(p => [p.invoiceDate || "", p.supplier, catLabel(p.category), p.description || "", p.invoiceNumber || "", String(p.amount ?? ""), String(p.taxAmount ?? ""), p.dueDate || "", p.isPaid ? "oui" : "non", p.paymentMethod || ""]);
        const csv = [header, ...rows].map(r => r.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "achats.csv"; a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${dk ? "text-white/40" : "text-slate-400"}`}>Indicateurs clés</span>
                <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
            </div>
            <div className={`grid ${compactCards ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 md:grid-cols-6"} gap-3`}>
                <StatCard label="Total TTC" value={fmt(totalTTC)} icon={ShoppingCart} color="orange" compact={compactCards} />
                <StatCard label="Total TVA" value={fmt(totalTVA)} icon={Receipt} color="blue" compact={compactCards} />
                <StatCard label="Impayés" value={fmt(unpaid)} icon={AlertTriangle} color="red" compact={compactCards} />
                <StatCard label="Fournisseurs" value={String(new Set(purchases.map(p => p.supplier)).size)} icon={Building2} color="blue" compact={compactCards} />
                <StatCard label="Échéances < 30j" value={String(stats.dueSoonCount)} icon={Clock} color="orange" compact={compactCards} />
                <StatCard label="En retard" value={String(stats.overdueCount)} icon={AlertTriangle} color="red" compact={compactCards} />
            </div>

            {/* Search + Filters */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 items-center">
                <div className={`flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2`}>
                    <Search className={`w-4 h-4 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Rechercher fournisseur, n° facture..." className="bg-transparent w-full text-sm focus:outline-none" />
                </div>
                <select title="Filtrer par catégorie" className={ic} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                    <option value="all">Toutes les catégories</option>
                    {PURCHASE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select>
                <select title="Filtrer par statut de paiement" className={ic} value={paidFilter} onChange={e => setPaidFilter(e.target.value as any)}>
                    <option value="all">Payé + Impayé</option>
                    <option value="unpaid">Impayés</option>
                    <option value="paid">Payés</option>
                </select>
                <div className="flex gap-2">
                    <button onClick={exportCSV} className={`px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap`}>Export CSV</button>
                </div>
            </div>

            {/* Quick-add bar */}
            <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3 flex flex-col gap-2 lg:flex-row lg:items-end`}>
                <div className="flex-1 min-w-[160px]">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Fournisseur</label>
                    <input value={quickSupplier} onChange={e => setQuickSupplier(e.target.value)} className={ic} placeholder="METRO, POMONA..." />
                </div>
                <div className="w-full lg:w-36">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Montant TTC (€)</label>
                    <input type="number" step="0.01" placeholder="0.00" value={quickAmount} onChange={e => setQuickAmount(e.target.value)} className={ic} />
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Catégorie</label>
                    <select title="Catégorie achat" className={ic} value={quickCategory} onChange={e => setQuickCategory(e.target.value)}>
                        {PURCHASE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Date facture</label>
                    <input type="date" placeholder="Date" value={quickInvDate} onChange={e => setQuickInvDate(e.target.value)} className={ic} />
                </div>
                <button onClick={() => {
                    const amount = parseFloat(quickAmount || "0");
                    if (!quickSupplier.trim()) return toast({ title: "Fournisseur requis", variant: "destructive" });
                    if (!amount || amount <= 0) return toast({ title: "Montant invalide", variant: "destructive" });
                    quickCreateMut.mutate({ supplier: quickSupplier.trim(), category: quickCategory, amount, invoiceDate: quickInvDate, isPaid: false, paymentMethod: "virement" });
                }} className={`px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-emerald-500 ${dk ? "text-white" : "text-slate-800"} text-sm font-semibold whitespace-nowrap`}>
                    + Ajout rapide
                </button>
            </div>

            {/* Breakdown by category */}
            {Object.keys(stats.byCategory).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, total]) => (
                        <div key={cat} className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3`}>
                            <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{catLabel(cat)}</p>
                            <p className="text-lg font-bold font-mono">{fmt(total)}</p>
                        </div>
                    ))}
                </div>
            )}

            <Card title="Liste des Achats" icon={ShoppingCart}
                action={<button onClick={() => setShowForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouvel Achat</button>}>
                {purchases.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun achat enregistré</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    {([
                                        { id: "date", label: "Date" },
                                        { id: "supplier", label: "Fournisseur" },
                                        { id: "category", label: "Catégorie" },
                                        { id: "amount", label: "Montant TTC" },
                                        { id: "paid", label: "Payé" }
                                    ] as const).map(col => (
                                        <th key={col.id} className={`${col.id === "amount" ? "text-right" : col.id === "paid" ? "text-center" : "text-left"} py-2 px-2`}>
                                            <button onClick={() => setSort(s => s.field === col.id ? { field: col.id, dir: s.dir === "asc" ? "desc" : "asc" } : { field: col.id, dir: col.id === "supplier" ? "asc" : "desc" })} className={`flex items-center gap-1 ${col.id === "amount" ? "w-full justify-end" : ""} ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:text-white" : "hover:text-slate-900"}`}>
                                                <span>{col.label}</span>
                                                {sort.field === col.id && (sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                            </button>
                                        </th>
                                    ))}
                                    <th className="text-right py-2 px-2">TVA</th>
                                    <th className="text-left py-2 px-2">N° Facture</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageData.map(p => {
                                    const rowClass = p.isOverdue ? "bg-red-500/5" : p.isDueSoon ? "bg-teal-500/5" : "";
                                    return (
                                        <tr key={p.id} className={`${rowClass} border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                            <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"} whitespace-nowrap`}>
                                                {fmtDate(p.invoiceDate)}
                                                {p.isOverdue && <span className="ml-1 text-[11px] text-red-300">Retard</span>}
                                                {!p.isOverdue && p.isDueSoon && <span className="ml-1 text-[11px] text-teal-300">Éch. 30j</span>}
                                            </td>
                                            <td className="py-2 px-2 font-medium">{p.supplier}</td>
                                            <td className="py-2 px-2"><CategoryBadge cat={p.category} /></td>
                                            <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(p.amount)}</td>
                                            <td className="py-2 px-2 text-center">
                                                <button onClick={() => togglePaid.mutate(p)}
                                                    className={`w-6 h-6 rounded-full border flex items-center justify-center ${p.isPaid ? "bg-green-500/20 border-green-500/50 text-green-400" : `${dk ? "border-white/20" : "border-slate-300"} ${dk ? "text-white/30" : "text-slate-300"}`}`}>
                                                    {p.isPaid && <Check className="w-3 h-3" />}
                                                </button>
                                            </td>
                                            <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/50" : "text-slate-500"}`}>{p.taxAmount ? fmt(p.taxAmount) : "—"}</td>
                                            <td className={`py-2 px-2 ${dk ? "text-white/40" : "text-slate-400"} text-xs`}>{p.invoiceNumber || "—"}</td>
                                            <td className="py-2 px-2 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {(() => { const f = achatsFiles.find(f => p.notes?.includes(f.originalName)); return f ? (
                                                        <button onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugumaillane-management/files/${f.id}/download`, "_blank")} className="p-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 transition-colors" title={`Voir facture: ${f.originalName}`}><Eye className="w-3 h-3" /></button>
                                                    ) : null; })()}
                                                    <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>
                                                    <button onClick={() => { if (confirm("Supprimer cet achat ?")) deleteMut.mutate(p.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-teal-500/30 bg-teal-500/5">
                                    <td className={`py-3 px-2 font-bold ${dk ? "text-white/80" : "text-slate-800"}`} colSpan={3}>TOTAL TTC</td>
                                    <td className="py-3 px-2 text-right font-mono font-bold text-teal-400 text-base">{fmt(filteredTotalTTC)}</td>
                                    <td></td>
                                    <td className="py-3 px-2 text-right font-mono text-teal-300">{fmt(filteredTotalTVA)}</td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        </table>
                        <div className={`flex items-center justify-between py-3 text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2">{filtered.length} lignes • Page {page} / {totalPages}<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>/page</span>
                            <div className="flex gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(1)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            {/* Modal Nouvel Achat */}
            <FormModal title="Nouvel Achat" open={showForm} onClose={() => setShowForm(false)}>
                <Field label="Fournisseur">
                    <input className={ic} list="achats-suppliers-list" value={form.supplier || ""} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Ex: METRO, POMONA, TRANSGOURMET..." />
                    <datalist id="achats-suppliers-list">{suppliers.filter(s => s.isActive).map(s => <option key={s.id} value={s.name} />)}</datalist>
                </Field>
                <Field label="Catégorie">
                    <select aria-label="Catégorie" className={ic} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                        {PURCHASE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </Field>
                <Field label="Description"><input className={ic} value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Facture, bon de livraison..." /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Montant TTC (€)"><input aria-label="Montant TTC (€)" type="number" step="0.01" className={ic} value={form.amount ?? ""} onChange={e => setForm({ ...form, amount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="TVA (€)"><input type="number" step="0.01" className={ic} value={form.taxAmount ?? ""} onChange={e => setForm({ ...form, taxAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} placeholder="0.00" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="N° Facture"><input aria-label="N° Facture" className={ic} value={form.invoiceNumber || ""} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} /></Field>
                    <Field label="Date facture"><input aria-label="Date facture" type="date" className={ic} value={form.invoiceDate || ""} onChange={e => setForm({ ...form, invoiceDate: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Échéance"><input aria-label="Échéance" type="date" className={ic} value={form.dueDate || ""} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
                    <Field label="Mode de paiement">
                        <select aria-label="Mode de paiement" className={ic} value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
                            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{catLabel(m)}</option>)}
                        </select>
                    </Field>
                </div>
                <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                    <input type="checkbox" checked={form.isPaid || false} onChange={e => setForm({ ...form, isPaid: e.target.checked })} className="rounded" />
                    Déjà payé
                </label>
                <button onClick={() => createMut.mutate(form)} className={btnPrimary + " w-full justify-center"} disabled={!form.supplier || form.amount == null}>
                    <Check className="w-4 h-4" /> Enregistrer
                </button>
            </FormModal>

            {/* Modal Modifier Achat */}
            <FormModal title="Modifier l'Achat" open={!!editingPurchase} onClose={() => setEditingPurchase(null)}>
                <Field label="Fournisseur">
                    <input className={ic} list="achats-edit-suppliers-list" value={editForm.supplier || ""} onChange={e => setEditForm({ ...editForm, supplier: e.target.value })} placeholder="Ex: METRO, POMONA, TRANSGOURMET..." />
                    <datalist id="achats-edit-suppliers-list">{suppliers.filter(s => s.isActive).map(s => <option key={s.id} value={s.name} />)}</datalist>
                </Field>
                <Field label="Catégorie">
                    <select aria-label="Catégorie" className={ic} value={editForm.category || "alimentaire"} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                        {PURCHASE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </Field>
                <Field label="Description"><input className={ic} value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} placeholder="Facture, bon de livraison..." /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Montant TTC (€)"><input aria-label="Montant TTC (€)" type="number" step="0.01" className={ic} value={editForm.amount ?? ""} onChange={e => setEditForm({ ...editForm, amount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="TVA (€)"><input type="number" step="0.01" className={ic} value={editForm.taxAmount ?? ""} onChange={e => setEditForm({ ...editForm, taxAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} placeholder="0.00" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="N° Facture"><input aria-label="N° Facture" className={ic} value={editForm.invoiceNumber || ""} onChange={e => setEditForm({ ...editForm, invoiceNumber: e.target.value })} /></Field>
                    <Field label="Date facture"><input aria-label="Date facture" type="date" className={ic} value={editForm.invoiceDate || ""} onChange={e => setEditForm({ ...editForm, invoiceDate: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Échéance"><input aria-label="Échéance" type="date" className={ic} value={editForm.dueDate || ""} onChange={e => setEditForm({ ...editForm, dueDate: e.target.value })} /></Field>
                    <Field label="Mode de paiement">
                        <select aria-label="Mode de paiement" className={ic} value={editForm.paymentMethod || ""} onChange={e => setEditForm({ ...editForm, paymentMethod: e.target.value })}>
                            <option value="">—</option>
                            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{catLabel(m)}</option>)}
                        </select>
                    </Field>
                </div>
                <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                    <input type="checkbox" checked={editForm.isPaid || false} onChange={e => setEditForm({ ...editForm, isPaid: e.target.checked })} className="rounded" />
                    Payé
                </label>
                <button onClick={() => editingPurchase && updateMut.mutate({ id: editingPurchase.id, data: editForm })} className={btnPrimary + " w-full justify-center"} disabled={!editForm.supplier || editForm.amount == null}>
                    <Check className="w-4 h-4" /> Sauvegarder
                </button>
            </FormModal>

            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        </div>
    );
}

// ====== FRAIS GÉNÉRAUX TAB ======
function FraisTab({ compactCards, setCompactCards }: { compactCards: boolean; setCompactCards: (v: boolean) => void }) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
    const [form, setForm] = useState<Partial<Expense>>({ category: "energie", isPaid: false, isRecurring: true, period: new Date().toISOString().substring(0, 7) });
    const [editForm, setEditForm] = useState<Partial<Expense>>({});
    const [quickLabel, setQuickLabel] = useState("");
    const [quickAmount, setQuickAmount] = useState<string>("");
    const [quickCategory, setQuickCategory] = useState<string>("energie");
    const [quickDue, setQuickDue] = useState<string>("");
    const [quickTax, setQuickTax] = useState<string>("");
    const [searchTerm, setSearchTerm] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "unpaid">("all");
    const [viewDueSoon, setViewDueSoon] = useState(false);
    const [viewOverdue, setViewOverdue] = useState(false);
    const [sort, setSort] = useState<{ field: "due" | "amount" | "label" | "category" | "paid"; dir: "asc" | "desc" }>({ field: "due", dir: "desc" });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [savedView, setSavedView] = useState<any | null>(null);

    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);
    const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/v2/sugumaillane-management/expenses"] });
    const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] });
    const { data: fraisFiles = [] } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugumaillane-management/files", "frais_generaux"],
        queryFn: async () => { const r = await fetch("/api/v2/sugumaillane-management/files?category=frais_generaux", { credentials: "include" }); return r.json(); }
    });

    const defaultForm = { category: "energie", isPaid: false, isRecurring: true, period: new Date().toISOString().substring(0, 7) };
    const suggestedTax: Record<string, number> = { energie: 0.2, telecom: 0.2, assurance: 0.2, loyer: 0.0, comptabilite: 0.2, entretien: 0.2, autre: 0.2 };

    const createMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/expenses", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/expenses"] }); setShowForm(false); setForm(defaultForm); toast({ title: "Frais enregistré" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible d'enregistrer le frais: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugumaillane-management/expenses/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/expenses"] }); setEditingExpense(null); toast({ title: "Frais modifié" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible de modifier le frais: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const quickCreateMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/expenses", data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/expenses"] });
            setQuickLabel("");
            setQuickAmount("");
            setQuickDue("");
            setQuickTax("");
            toast({ title: "Frais ajouté (rapide)" });
        },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible d'ajouter: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/expenses/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/expenses"] }); toast({ title: "Frais supprimé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le frais", variant: "destructive" }); }
    });

    const togglePaid = useMutation({
        mutationFn: (e: Expense) => apiRequest("PUT", `/api/v2/sugumaillane-management/expenses/${e.id}`, { isPaid: !e.isPaid }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/expenses"] }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier le statut", variant: "destructive" }); }
    });

    const openEdit = (e: Expense) => {
        setEditingExpense(e);
        setEditForm({ label: e.label, category: e.category, description: e.description, amount: e.amount, taxAmount: e.taxAmount, invoiceNumber: e.invoiceNumber, period: e.period, frequency: e.frequency, dueDate: e.dueDate, isPaid: e.isPaid, paidDate: e.paidDate, paymentMethod: e.paymentMethod, isRecurring: e.isRecurring, notes: e.notes });
    };

    const totalTTC = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const totalTVA = expenses.reduce((s, e) => s + (e.taxAmount || 0), 0);
    const unpaid = expenses.filter(e => !e.isPaid).reduce((s, e) => s + e.amount, 0);

    const today = useMemo(() => new Date(), []);

    const {
        filtered,
        pageData,
        totalPages,
        stats,
        duplicateIds,
        filteredTotalTTC,
        filteredTotalTVA
    } = useMemo(() => {
        const withMeta = expenses.map(e => {
            const due = e.dueDate ? new Date(`${e.dueDate}T00:00:00`) : (e.period ? new Date(`${e.period}-01T00:00:00`) : null);
            const isOverdue = !e.isPaid && due && due < today;
            const isDueSoon = !e.isPaid && due && due >= today && (due.getTime() - today.getTime()) <= 30 * 24 * 60 * 60 * 1000;
            const key = `${(e.label || "").toLowerCase()}|${e.amount}|${due ? due.toISOString().slice(0, 10) : e.period || ""}|${(e as any).invoiceNumber || ""}`;
            return { ...e, due, isOverdue, isDueSoon, key } as Expense & { due: Date | null; isOverdue: boolean; isDueSoon: boolean; key: string };
        });

        // Duplicates (same label+amount+date/period+invoiceNumber)
        const keyCount: Record<string, number> = {};
        withMeta.forEach(e => { keyCount[e.key] = (keyCount[e.key] || 0) + 1; });
        const dupIds = new Set(withMeta.filter(e => keyCount[e.key] > 1).map(e => e.id));

        let list = withMeta;

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            list = list.filter(e =>
                (e.label || "").toLowerCase().includes(q) ||
                (e.description || "").toLowerCase().includes(q) ||
                (e.notes || "").toLowerCase().includes(q)
            );
        }
        if (categoryFilter !== "all") {
            list = list.filter(e => e.category === categoryFilter);
        }
        if (paidFilter === "paid") list = list.filter(e => e.isPaid);
        if (paidFilter === "unpaid") list = list.filter(e => !e.isPaid);
        if (viewDueSoon) list = list.filter(e => e.isDueSoon);
        if (viewOverdue) list = list.filter(e => e.isOverdue);

        const compare = (a: any, b: any, field: string) => {
            if (field === "due") return (a.due?.getTime() || 0) - (b.due?.getTime() || 0);
            if (field === "amount") return (a.amount || 0) - (b.amount || 0);
            if (field === "label") return (a.label || "").localeCompare(b.label || "");
            if (field === "category") return (a.category || "").localeCompare(b.category || "");
            if (field === "paid") return Number(a.isPaid) - Number(b.isPaid);
            return 0;
        };

        list = [...list].sort((a, b) => {
            const base = compare(a, b, sort.field);
            return sort.dir === "asc" ? base : -base;
        });

        const byCategory: Record<string, number> = {};
        list.forEach(e => { const k = normalizeCatKey(e.category); byCategory[k] = (byCategory[k] || 0) + e.amount; });

        const dueSoonCount = list.filter(e => e.isDueSoon).length;
        const overdueCount = list.filter(e => e.isOverdue).length;
        const recurringCount = list.filter(e => e.isRecurring).length;

        const totalPagesCalc = Math.max(1, Math.ceil(list.length / pageSize));
        const currentPage = Math.min(page, totalPagesCalc);
        const start = (currentPage - 1) * pageSize;
        const pageSlice = list.slice(start, start + pageSize);

        const filteredTotalTTC = list.reduce((s, e) => s + (e.amount || 0), 0);
        const filteredTotalTVA = list.reduce((s, e) => s + (e.taxAmount || 0), 0);
        return {
            filtered: list,
            pageData: pageSlice,
            totalPages: totalPagesCalc,
            stats: { byCategory, dueSoonCount, overdueCount, recurringCount },
            duplicateIds: dupIds,
            filteredTotalTTC,
            filteredTotalTVA
        };
    }, [expenses, searchTerm, categoryFilter, paidFilter, viewDueSoon, viewOverdue, sort, page, pageSize, today]);

    useEffect(() => {
        setPage(1);
    }, [searchTerm, categoryFilter, paidFilter, viewDueSoon, viewOverdue, sort]);

    // Persist and restore a single saved view (filters + sort)
    useEffect(() => {
        try {
            const raw = localStorage.getItem("sugu-frais-view");
            if (raw) {
                const parsed = JSON.parse(raw);
                setSavedView(parsed);
            }
        } catch { /* ignore */ }
    }, []);

    const saveCurrentView = () => {
        const payload = { searchTerm, categoryFilter, paidFilter, viewDueSoon, viewOverdue, sort };
        localStorage.setItem("sugu-frais-view", JSON.stringify(payload));
        setSavedView(payload);
        toast({ title: "Vue sauvegardée" });
    };

    const applySavedView = () => {
        if (!savedView) return;
        setSearchTerm(savedView.searchTerm || "");
        setCategoryFilter(savedView.categoryFilter || "all");
        setPaidFilter(savedView.paidFilter || "all");
        setViewDueSoon(!!savedView.viewDueSoon);
        setViewOverdue(!!savedView.viewOverdue);
        if (savedView.sort) setSort(savedView.sort);
        toast({ title: "Vue appliquée" });
    };

    const exportCSV = () => {
        if (filtered.length === 0) return toast({ title: "Aucune donnée à exporter" });
        const header = ["Fournisseur", "Catégorie", "MontantTTC", "TVA", "Échéance", "Période", "Payé", "Récurrent", "Notes"];
        const rows = filtered.map(e => [
            e.label || "",
            catLabel(e.category),
            String(e.amount ?? ""),
            String(e.taxAmount ?? ""),
            e.dueDate || "",
            e.period || "",
            e.isPaid ? "oui" : "non",
            e.isRecurring ? "oui" : "non",
            e.notes || ""
        ]);
        const csv = [header, ...rows]
            .map(r => r.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(","))
            .join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "frais_generaux.csv";
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${dk ? "text-white/40" : "text-slate-400"}`}>Indicateurs clés</span>
                <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
            </div>
            <div className={`grid ${compactCards ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-4"} gap-4`}>
                <StatCard label="Total TTC" value={fmt(totalTTC)} icon={Receipt} color="orange" compact={compactCards} />
                <StatCard label="Impayés" value={fmt(unpaid)} icon={AlertTriangle} color="red" compact={compactCards} />
                <StatCard label="Échéances < 30j" value={String(stats.dueSoonCount)} icon={Clock} color="blue" compact={compactCards} />
                <StatCard label="En retard" value={String(stats.overdueCount)} icon={AlertTriangle} color="red" compact={compactCards} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 items-center">
                <div className={`flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2`}>
                    <Search className={`w-4 h-4 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Rechercher fournisseur, notes..."
                        className="bg-transparent w-full text-sm focus:outline-none"
                    />
                </div>
                <select title="Filtrer par catégorie" className={ic} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                    <option value="all">Toutes les catégories</option>
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select>
                <select title="Filtrer par statut de paiement" className={ic} value={paidFilter} onChange={e => setPaidFilter(e.target.value as any)}>
                    <option value="all">Payé + Impayé</option>
                    <option value="unpaid">Impayés</option>
                    <option value="paid">Payés</option>
                </select>
                <div className="flex gap-2">
                    <button onClick={() => { setViewDueSoon(false); setViewOverdue(false); }} className={`px-3 py-2 text-sm rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"}`}>Tous</button>
                    <button onClick={() => { setViewDueSoon(true); setViewOverdue(false); }} className={`px-3 py-2 text-sm rounded-lg border ${viewDueSoon ? "bg-teal-500/20 border-teal-500/50 text-teal-200" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"}`}`}>Échéances 30j</button>
                    <button onClick={() => { setViewOverdue(true); setViewDueSoon(false); }} className={`px-3 py-2 text-sm rounded-lg border ${viewOverdue ? "bg-red-500/20 border-red-500/50 text-red-200" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"}`}`}>En retard</button>
                    <button onClick={exportCSV} className={`px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"}`}>Export CSV</button>
                    <button onClick={saveCurrentView} className={`px-3 py-2 text-sm rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"}`}>Sauvegarder vue</button>
                    <button onClick={applySavedView} disabled={!savedView} className={`px-3 py-2 text-sm rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Appliquer vue</button>
                </div>
            </div>

            <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3 flex flex-col gap-2 lg:flex-row lg:items-end`}>
                <div className="flex-1 min-w-[160px]">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Fournisseur</label>
                    <input value={quickLabel} onChange={e => setQuickLabel(e.target.value)} className={ic} placeholder="EDF, Orange..." />
                </div>
                <div className="w-full lg:w-36">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Montant TTC (€)</label>
                    <input type="number" step="0.01" placeholder="0.00" value={quickAmount} onChange={e => setQuickAmount(e.target.value)} className={ic} />
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Catégorie</label>
                    <select title="Catégorie frais" className={ic} value={quickCategory} onChange={e => {
                        const val = e.target.value;
                        setQuickCategory(val);
                        if (!quickTax && suggestedTax[val] !== undefined) {
                            const amt = parseFloat(quickAmount || "0");
                            const t = suggestedTax[val];
                            if (!isNaN(amt) && t >= 0) setQuickTax(((amt * t)).toFixed(2));
                        }
                    }}>
                        {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Échéance</label>
                    <input type="date" placeholder="Date" value={quickDue} onChange={e => setQuickDue(e.target.value)} className={ic} />
                </div>
                <div className="w-full lg:w-32">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>TVA (€) sugg.</label>
                    <input type="number" step="0.01" placeholder="0.00" value={quickTax} onChange={e => setQuickTax(e.target.value)} className={ic} />
                </div>
                <button
                    onClick={() => {
                        const amount = parseFloat(quickAmount || "0");
                        if (!quickLabel.trim()) return toast({ title: "Fournisseur requis", variant: "destructive" });
                        if (!amount || amount <= 0) return toast({ title: "Montant invalide", variant: "destructive" });
                        quickCreateMut.mutate({
                            label: quickLabel.trim(),
                            category: quickCategory,
                            amount,
                            taxAmount: quickTax ? parseFloat(quickTax) : undefined,
                            dueDate: quickDue || undefined,
                            isPaid: false,
                            isRecurring: true,
                            period: new Date().toISOString().substring(0, 7)
                        });
                    }}
                    className={`px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-emerald-500 ${dk ? "text-white" : "text-slate-800"} text-sm font-semibold whitespace-nowrap`}
                >
                    + Ajout rapide
                </button>
            </div>

            {/* Breakdown by category */}
            {Object.keys(stats.byCategory).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, total]) => (
                        <div key={cat} className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3`}>
                            <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{catLabel(cat)}</p>
                            <p className="text-lg font-bold font-mono">{fmt(total)}</p>
                        </div>
                    ))}
                </div>
            )}

            <Card title="Liste des Frais Généraux" icon={Receipt}
                action={<button onClick={() => setShowForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouveau Frais</button>}>
                {expenses.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun frais enregistré</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    {([
                                        { id: "due", label: "Date" },
                                        { id: "label", label: "Fournisseur" },
                                        { id: "category", label: "Catégorie" },
                                        { id: "amount", label: "Montant TTC" },
                                        { id: "paid", label: "Payé" }
                                    ] as const).map(col => (
                                        <th key={col.id} className={`${col.id === "amount" ? "text-right" : col.id === "paid" ? "text-center" : "text-left"} py-2 px-2`}>
                                            <button onClick={() => setSort(s => s.field === col.id ? { field: col.id, dir: s.dir === "asc" ? "desc" : "asc" } : { field: col.id, dir: col.id === "label" ? "asc" : "desc" })} className={`flex items-center gap-1 ${col.id === "amount" ? "w-full justify-end" : ""} ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:text-white" : "hover:text-slate-900"}`}>
                                                <span>{col.label}</span>
                                                {sort.field === col.id && (sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                            </button>
                                        </th>
                                    ))}
                                    <th className={`text-left py-2 px-2 ${dk ? "text-white/40" : "text-slate-400"} text-xs`}>Invoice N°</th>
                                    <th className="text-right py-2 px-2">TVA</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageData.map(e => {
                                    const rowClass = e.isOverdue ? "bg-red-500/5" : e.isDueSoon ? "bg-teal-500/5" : "";
                                    return (
                                        <tr key={e.id} className={`${rowClass} border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                            <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"} whitespace-nowrap`}>
                                                {e.dueDate ? new Date(e.dueDate + "T00:00:00").toLocaleDateString("fr-FR") : e.period || "—"}
                                                {e.isOverdue && <span className="ml-2 text-[11px] text-red-300">Retard</span>}
                                                {!e.isOverdue && e.isDueSoon && <span className="ml-2 text-[11px] text-teal-300">Échéance 30j</span>}
                                                {duplicateIds.has(e.id) && <span className="ml-2 text-[11px] text-purple-300">Doublon?</span>}
                                            </td>
                                            <td className="py-2 px-2 font-medium">{e.label || "—"}</td>
                                            <td className="py-2 px-2"><CategoryBadge cat={e.category} /></td>
                                            <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(e.amount)}</td>
                                            <td className="py-2 px-2 text-center">
                                                <button onClick={() => togglePaid.mutate(e)}
                                                    className={`w-6 h-6 rounded-full border flex items-center justify-center ${e.isPaid ? "bg-green-500/20 border-green-500/50 text-green-400" : `${dk ? "border-white/20" : "border-slate-300"} ${dk ? "text-white/30" : "text-slate-300"}`}`}>
                                                    {e.isPaid && <Check className="w-3 h-3" />}
                                                </button>
                                            </td>
                                            <td className={`py-2 px-2 text-left font-mono text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{(e as any).invoiceNumber || "—"}</td>
                                            <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/50" : "text-slate-500"}`}>{e.taxAmount ? fmt(e.taxAmount) : "—"}</td>
                                            <td className="py-2 px-2 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {(() => { const f = fraisFiles.find(f => e.notes?.includes(f.originalName)); return f ? (
                                                        <button onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugumaillane-management/files/${f.id}/download`, "_blank")} className="p-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 transition-colors" title={`Voir facture: ${f.originalName}`}><Eye className="w-3 h-3" /></button>
                                                    ) : null; })()}
                                                    <button onClick={() => openEdit(e)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>
                                                    <button onClick={() => { if (confirm("Supprimer ce frais ?")) deleteMut.mutate(e.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-teal-500/30 bg-teal-500/5">
                                    <td className={`py-3 px-2 font-bold ${dk ? "text-white/80" : "text-slate-800"}`} colSpan={3}>TOTAL TTC</td>
                                    <td className="py-3 px-2 text-right font-mono font-bold text-teal-400 text-base">{fmt(filteredTotalTTC)}</td>
                                    <td></td>
                                    <td></td>
                                    <td className="py-3 px-2 text-right font-mono text-teal-300">{fmt(filteredTotalTVA)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                        <div className={`flex items-center justify-between py-3 text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2">{filtered.length} lignes • Page {page} / {totalPages}<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>/page</span>
                            <div className="flex gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(1)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            {/* Modal Nouveau Frais */}
            <FormModal title="Nouveau Frais Général" open={showForm} onClose={() => setShowForm(false)}>
                <Field label="Fournisseur">
                    <input className={ic} list="frais-suppliers-list" value={form.label || ""} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Ex: EDF, Orange, AXA..." />
                    <datalist id="frais-suppliers-list">{suppliers.filter(s => s.isActive).map(s => <option key={s.id} value={s.name} />)}</datalist>
                </Field>
                <Field label="Catégorie">
                    <select aria-label="Catégorie" className={ic} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                        {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Montant TTC (€)"><input aria-label="Montant TTC (€)" type="number" step="0.01" className={ic} value={form.amount ?? ""} onChange={e => setForm({ ...form, amount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="TVA (€)"><input type="number" step="0.01" className={ic} value={form.taxAmount ?? ""} onChange={e => setForm({ ...form, taxAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} placeholder="0.00" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Date d'échéance"><input aria-label="Date d'échéance" type="date" className={ic} value={(form as any).dueDate || ""} onChange={e => setForm({ ...form, dueDate: e.target.value } as any)} /></Field>
                    <Field label="Période (YYYY-MM)"><input aria-label="Période (YYYY-MM)" type="text" pattern="\d{4}-\d{2}" className={ic} value={form.period || ""} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="2026-01" /></Field>
                </div>
                <Field label="Description"><input className={ic} value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Facture, abonnement..." /></Field>
                <div className="flex items-center gap-4">
                    <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                        <input type="checkbox" checked={form.isRecurring} onChange={e => setForm({ ...form, isRecurring: e.target.checked })} className="rounded" />
                        Récurrent
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                        <input type="checkbox" checked={form.isPaid} onChange={e => setForm({ ...form, isPaid: e.target.checked })} className="rounded" />
                        Déjà payé
                    </label>
                </div>
                <Field label="Notes"><input aria-label="Notes" className={ic} value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
                <button onClick={() => createMut.mutate(form)} className={btnPrimary + " w-full justify-center"} disabled={!form.label || form.amount == null}>
                    <Check className="w-4 h-4" /> Enregistrer
                </button>
            </FormModal>

            {/* Modal Modifier Frais */}
            <FormModal title="Modifier le Frais" open={!!editingExpense} onClose={() => setEditingExpense(null)}>
                <Field label="Fournisseur">
                    <input className={ic} list="frais-edit-suppliers-list" value={editForm.label || ""} onChange={e => setEditForm({ ...editForm, label: e.target.value })} placeholder="Ex: EDF, Orange, AXA..." />
                    <datalist id="frais-edit-suppliers-list">{suppliers.filter(s => s.isActive).map(s => <option key={s.id} value={s.name} />)}</datalist>
                </Field>
                <Field label="Catégorie">
                    <select aria-label="Catégorie" className={ic} value={editForm.category || "energie"} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                        {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Montant TTC (€)"><input aria-label="Montant TTC (€)" type="number" step="0.01" className={ic} value={editForm.amount ?? ""} onChange={e => setEditForm({ ...editForm, amount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="TVA (€)"><input type="number" step="0.01" className={ic} value={editForm.taxAmount ?? ""} onChange={e => setEditForm({ ...editForm, taxAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} placeholder="0.00" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Date d'échéance"><input aria-label="Date d'échéance" type="date" className={ic} value={editForm.dueDate || ""} onChange={e => setEditForm({ ...editForm, dueDate: e.target.value })} /></Field>
                    <Field label="Période (YYYY-MM)"><input aria-label="Période (YYYY-MM)" type="text" pattern="\d{4}-\d{2}" className={ic} value={editForm.period || ""} onChange={e => setEditForm({ ...editForm, period: e.target.value })} placeholder="2026-01" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Description"><input className={ic} value={editForm.description || ""} onChange={e => setEditForm({ ...editForm, description: e.target.value })} placeholder="Facture, abonnement..." /></Field>
                    <Field label="Invoice N°"><input className={ic} value={(editForm as any).invoiceNumber || ""} onChange={e => setEditForm({ ...editForm, invoiceNumber: e.target.value } as any)} placeholder="Ex: F123456" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Fréquence">
                        <select aria-label="Fréquence" className={ic} value={editForm.frequency || "mensuel"} onChange={e => setEditForm({ ...editForm, frequency: e.target.value })}>
                            <option value="mensuel">Mensuel</option>
                            <option value="trimestriel">Trimestriel</option>
                            <option value="annuel">Annuel</option>
                        </select>
                    </Field>
                    <Field label="Moyen de paiement">
                        <select aria-label="Moyen de paiement" className={ic} value={editForm.paymentMethod || ""} onChange={e => setEditForm({ ...editForm, paymentMethod: e.target.value })}>
                            <option value="">—</option>
                            <option value="virement">Virement</option>
                            <option value="prelevement">Prélèvement</option>
                            <option value="cb">Carte bancaire</option>
                            <option value="cheque">Chèque</option>
                            <option value="especes">Espèces</option>
                        </select>
                    </Field>
                </div>
                <div className="flex items-center gap-4">
                    <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                        <input type="checkbox" checked={editForm.isRecurring || false} onChange={e => setEditForm({ ...editForm, isRecurring: e.target.checked })} className="rounded" />
                        Récurrent
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                        <input type="checkbox" checked={editForm.isPaid || false} onChange={e => setEditForm({ ...editForm, isPaid: e.target.checked })} className="rounded" />
                        Payé
                    </label>
                </div>
                <Field label="Notes"><input aria-label="Notes" className={ic} value={editForm.notes || ""} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></Field>
                <button onClick={() => editingExpense && updateMut.mutate({ id: editingExpense.id, data: editForm })} className={btnPrimary + " w-full justify-center"} disabled={!editForm.label || editForm.amount == null}>
                    <Check className="w-4 h-4" /> Sauvegarder
                </button>
            </FormModal>

            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        </div>
    );
}

// ====== CATEGORY BADGE ======
const categoryLabels: Record<string, { label: string; color: string }> = {
    encaissement_cb: { label: "CB", color: "bg-green-500/20 text-green-400" },
    plateforme: { label: "Plateforme", color: "bg-blue-500/20 text-blue-400" },
    encaissement_virement: { label: "Virement +", color: "bg-emerald-500/20 text-emerald-400" },
    virement_recu: { label: "Virement +", color: "bg-emerald-500/20 text-emerald-400" },
    achat_fournisseur: { label: "Fournisseur", color: "bg-teal-500/20 text-teal-400" },
    remboursement_fournisseur: { label: "Rembt Fourn.", color: "bg-lime-500/20 text-lime-400" },
    commission_plateforme: { label: "Com. Plateforme", color: "bg-rose-500/20 text-rose-400" },
    loyer: { label: "Loyer", color: "bg-purple-500/20 text-purple-400" },
    salaire: { label: "Salaire", color: "bg-pink-500/20 text-pink-400" },
    virement_interne: { label: "Vir. interne", color: "bg-slate-500/20 text-slate-400" },
    virement_emis: { label: "Virement -", color: "bg-red-500/20 text-red-400" },
    frais_bancaires: { label: "Frais banque", color: "bg-yellow-500/20 text-yellow-400" },
    assurance: { label: "Assurance", color: "bg-cyan-500/20 text-cyan-400" },
    emprunt: { label: "Emprunt", color: "bg-violet-500/20 text-violet-400" },
    leasing: { label: "Leasing", color: "bg-violet-500/20 text-violet-400" },
    energie: { label: "Énergie", color: "bg-teal-500/20 text-teal-400" },
    carburant: { label: "Carburant", color: "bg-teal-500/20 text-teal-400" },
    telecom: { label: "Télécom", color: "bg-sky-500/20 text-sky-400" },
    charges_sociales: { label: "Charges", color: "bg-rose-500/20 text-rose-400" },
    vehicule: { label: "Véhicule", color: "bg-lime-500/20 text-lime-400" },
    equipement: { label: "Équipement", color: "bg-teal-500/20 text-teal-400" },
    prelevement: { label: "Prélèvement", color: "bg-stone-500/20 text-stone-400" },
    credit_divers: { label: "Divers +", color: "bg-gray-500/20 text-gray-400" },
    debit_divers: { label: "Divers -", color: "bg-gray-500/20 text-gray-400" },
    divers: { label: "Divers", color: "bg-gray-500/20 text-gray-400" },
    // Achats & Fournisseurs categories
    alimentaire: { label: "Alimentaire", color: "bg-teal-500/20 text-teal-400" },
    boissons: { label: "Boissons", color: "bg-blue-500/20 text-blue-400" },
    emballages: { label: "Emballages", color: "bg-yellow-500/20 text-yellow-400" },
    entretien: { label: "Entretien", color: "bg-cyan-500/20 text-cyan-400" },
    produits_entretien: { label: "Entretien", color: "bg-cyan-500/20 text-cyan-400" },
    comptabilite: { label: "Comptabilité", color: "bg-indigo-500/20 text-indigo-400" },
    assurances: { label: "Assurances", color: "bg-cyan-500/20 text-cyan-400" },
    vehicules: { label: "Véhicules", color: "bg-lime-500/20 text-lime-400" },
    plateformes: { label: "Plateformes", color: "bg-blue-500/20 text-blue-400" },
    materiels: { label: "Matériels", color: "bg-teal-500/20 text-teal-400" },
    eau: { label: "Eau", color: "bg-sky-500/20 text-sky-400" },
    autre: { label: "Autre", color: "bg-gray-500/20 text-gray-400" },
    // Frais Généraux categories
    loyer_fg: { label: "Loyer", color: "bg-purple-500/20 text-purple-400" },
};
function normalizeCatKey(c: string): string {
    const k = c.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["electricite", "energie", "energy", "electricite"].includes(k)) return "energie";
    if (["eau", "water", "eau potable"].includes(k)) return "eau";
    if (["telecom", "telecommunications", "telecomunications"].includes(k)) return "telecom";
    if (["fournitures", "equipement", "materiel", "materiels"].includes(k)) return "materiels";
    if (["plateforme", "plateformes"].includes(k)) return "plateformes";
    if (["assurance", "assurances"].includes(k)) return "assurances";
    if (["vehicule", "vehicules"].includes(k)) return "vehicules";
    if (["produits_entretien"].includes(k)) return "entretien";
    return k;
}
function CategoryBadge({ cat }: { cat?: string | null }) {
    const dk = useSuguDark();
    if (!cat) return <span className={`${dk ? "text-white/30" : "text-slate-300"} text-xs`}>—</span>;
    const key = normalizeCatKey(cat);
    const info = categoryLabels[key] || { label: cat, color: `${dk ? "bg-white/10" : "bg-slate-100"} ${dk ? "text-white/60" : "text-slate-600"}` };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${info.color}`}>{info.label}</span>;
}

// ====== BANQUE TAB ======
function BanqueTab({ compactCards, setCompactCards }: { compactCards: boolean; setCompactCards: (v: boolean) => void }) {
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showBankForm, setShowBankForm] = useState(false);
    const [showLoanForm, setShowLoanForm] = useState(false);
    const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
    const [editingBankId, setEditingBankId] = useState<number | null>(null);
    const dk = useSuguDark();
    const ic = useInputClass();
    const [bankForm, setBankForm] = useState<Partial<BankEntry>>({ bankName: "", isReconciled: false, entryDate: new Date().toISOString().substring(0, 10) });
    const [loanForm, setLoanForm] = useState<Partial<Loan>>({ bankName: "", loanType: "emprunt" });
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<any>(null);
    const [lastImportFile, setLastImportFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const loanFileInputRef = useRef<HTMLInputElement>(null);
    const loanImportInputRef = useRef<HTMLInputElement>(null);
    const [attachingLoanId, setAttachingLoanId] = useState<number | null>(null);
    const [loanPreviewFile, setLoanPreviewFile] = useState<SuguFile | null>(null);
    const [importingLoanDoc, setImportingLoanDoc] = useState(false);
    const [loanDocConfidence, setLoanDocConfidence] = useState<"high" | "medium" | "low" | null>(null);
    const [pendingLoanFile, setPendingLoanFile] = useState<File | null>(null);
    const { user: authUser } = useAuth();
    const [bankSortCol, setBankSortCol] = useState<"date" | "label" | "type" | "debit" | "credit" | "solde">("date");
    const [bankSortDir, setBankSortDir] = useState<"asc" | "desc">("desc");
    const [bankSearch, setBankSearch] = useState("");
    const [reconciledFilter, setReconciledFilter] = useState<"all" | "yes" | "no">("all");
    const [bankFlowFilter, setBankFlowFilter] = useState<"all" | "credit" | "debit">("all");
    const [bankPage, setBankPage] = useState(1);
    const [bankPageSize, setBankPageSize] = useState(30);
    const toggleBankSort = (col: typeof bankSortCol) => {
        if (bankSortCol === col) setBankSortDir(d => d === "asc" ? "desc" : "asc");
        else { setBankSortCol(col); setBankSortDir("desc"); }
    };
    const SortIcon = ({ col }: { col: typeof bankSortCol }) => (
        bankSortCol === col
            ? (bankSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />)
            : <ChevronDown className="w-3 h-3 inline ml-0.5 opacity-0 group-hover:opacity-40" />
    );
    const [resettingBank, setResettingBank] = useState(false);
    const handleBankReset = async () => {
        if (!confirm("⚠️ ATTENTION : Supprimer TOUTES les écritures bancaires et fichiers banque de Maillane ? Cette action est irréversible.")) return;
        setResettingBank(true);
        try {
            const r = await fetch("/api/v2/sugumaillane-management/bank-reset-all", { method: "DELETE", credentials: "include" });
            const data = await r.json();
            if (data.success) {
                toast({ title: "Reset effectué", description: "Toutes les écritures bancaires ont été supprimées." });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/bank"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            } else {
                toast({ title: "Erreur", description: data.error || "Échec du reset", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Erreur réseau", variant: "destructive" });
        } finally {
            setResettingBank(false);
        }
    };

    const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>, replace = false) => {
        const file = e.target.files?.[0] || lastImportFile;
        if (!file) return;
        const ext = file.name.toLowerCase().split(".").pop() || "";
        if (!["pdf", "csv"].includes(ext)) {
            toast({ title: "Fichier invalide", description: "Seuls les fichiers PDF et CSV sont acceptés", variant: "destructive" });
            return;
        }
        setImporting(true);
        setImportResult(null);
        try {
            const baseEndpoint = ext === "csv" ? "/api/v2/sugumaillane-management/bank/import-csv" : "/api/v2/sugumaillane-management/bank/import-pdf";
            const endpoint = replace ? `${baseEndpoint}?replace=true` : baseEndpoint;
            const res = await uploadFileAsBase64(endpoint, file);
            const data = await res.json();
            if (!res.ok) {
                toast({ title: "Erreur d'import", description: data.error || "Erreur inconnue", variant: "destructive" });
                setImportResult({ error: data.error, details: data.details });
            } else if (data.hasExisting && data.imported === 0 && !replace) {
                // Period already exists — offer to replace
                setLastImportFile(file);
                setImportResult({ ...data, canReplace: true });
                toast({ title: "Période déjà importée", description: "Vous pouvez remplacer les données existantes" });
            } else {
                toast({ title: "Import réussi", description: data.message });
                setImportResult(data);
                setLastImportFile(null);
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/bank"] });
            }
        } catch (err) {
            toast({ title: "Erreur", description: "Impossible d'importer le fichier", variant: "destructive" });
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const { data: bankEntries = [] } = useQuery<BankEntry[]>({ queryKey: ["/api/v2/sugumaillane-management/bank"] });
    const { data: loans = [] } = useQuery<Loan[]>({ queryKey: ["/api/v2/sugumaillane-management/loans"] });

    const createBankMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/bank", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/bank"] }); setShowBankForm(false); setBankForm({ bankName: "", isReconciled: false, entryDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Écriture ajoutée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible d'ajouter l'écriture", variant: "destructive" }); }
    });
    const updateBankMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugumaillane-management/bank/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/bank"] }); setShowBankForm(false); setEditingBankId(null); setBankForm({ bankName: "", isReconciled: false, entryDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Écriture modifiée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier l'écriture", variant: "destructive" }); }
    });
    const toggleReconcileMut = useMutation({
        mutationFn: ({ id, isReconciled }: { id: number; isReconciled: boolean }) => apiRequest("PUT", `/api/v2/sugumaillane-management/bank/${id}`, { isReconciled }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/bank"] }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier le rapprochement", variant: "destructive" }); }
    });
    const deleteBankMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/bank/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/bank"] }); toast({ title: "Écriture supprimée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer l'écriture", variant: "destructive" }); }
    });
    const createLoanMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/loans", data),
        onSuccess: async (newLoan: any) => {
            if (pendingLoanFile && newLoan?.id) {
                try {
                    const uploadRes = await uploadFileAsBase64("/api/v2/sugumaillane-management/files", pendingLoanFile, {
                        category: "emprunt",
                        fileType: "file",
                        description: `Contrat emprunt — ${pendingLoanFile.name}`,
                    });
                    if (uploadRes.ok) {
                        const uploadData = await uploadRes.json();
                        await fetch(`/api/v2/sugumaillane-management/loans/${newLoan.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalFileId: uploadData.id }) });
                    }
                } catch {}
                setPendingLoanFile(null);
            }
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/loans"] });
            setShowLoanForm(false); setEditingLoan(null); setLoanForm({ bankName: "", loanType: "emprunt" }); setLoanDocConfidence(null);
            toast({ title: "Financement ajouté" });
        },
        onError: () => { toast({ title: "Erreur", description: "Impossible d'ajouter le financement", variant: "destructive" }); }
    });
    const updateLoanMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugumaillane-management/loans/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/loans"] }); setShowLoanForm(false); setEditingLoan(null); setLoanForm({ bankName: "", loanType: "emprunt" }); toast({ title: "Financement mis à jour" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de mettre à jour le financement", variant: "destructive" }); }
    });
    const deleteLoanMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/loans/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/loans"] }); toast({ title: "Financement supprimé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le financement", variant: "destructive" }); }
    });

    const totalCredit = bankEntries.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const totalDebit = bankEntries.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);

    // Compute running balance: sort chronologically, derive opening balance from first known balance, then cumulate
    const balanceMap = new Map<number, number>();
    const chronoEntries = [...bankEntries].sort((a, b) => {
        const dateCmp = a.entryDate.localeCompare(b.entryDate);
        return dateCmp !== 0 ? dateCmp : a.id - b.id;
    });
    // Derive opening balance from the first entry that has a stored balance
    let openingBalance = 0;
    for (let i = 0; i < chronoEntries.length; i++) {
        const e = chronoEntries[i];
        if (e.balance != null) {
            // opening = storedBalance - sum(amounts from first to this entry inclusive)
            const partialSum = chronoEntries.slice(0, i + 1).reduce((s, x) => s + x.amount, 0);
            openingBalance = e.balance - partialSum;
            break;
        }
    }
    let runningBalance = openingBalance;
    for (const entry of chronoEntries) {
        runningBalance += entry.amount;
        balanceMap.set(entry.id, runningBalance);
    }
    const lastBalance = chronoEntries.length > 0 ? (balanceMap.get(chronoEntries[chronoEntries.length - 1].id) ?? 0) : 0;

    // Sorted display entries (separate from chronoEntries which drives balance calc)
    const displayEntries = useMemo(() => {
        let list = [...chronoEntries];
        // search
        if (bankSearch.trim()) {
            const q = bankSearch.toLowerCase();
            list = list.filter(e => e.label.toLowerCase().includes(q) || (e.notes || "").toLowerCase().includes(q) || (e.bankName || "").toLowerCase().includes(q));
        }
        // reconciled filter
        if (reconciledFilter === "yes") list = list.filter(e => e.isReconciled);
        if (reconciledFilter === "no") list = list.filter(e => !e.isReconciled);
        // flow filter
        if (bankFlowFilter === "credit") list = list.filter(e => e.amount > 0);
        if (bankFlowFilter === "debit") list = list.filter(e => e.amount < 0);

        list.sort((a, b) => {
            let cmp = 0;
            switch (bankSortCol) {
                case "date": cmp = a.entryDate.localeCompare(b.entryDate) || (a.id - b.id); break;
                case "label": cmp = a.label.localeCompare(b.label, "fr", { sensitivity: "base" }); break;
                case "type": cmp = (bankOpType(a.category) || "").localeCompare(bankOpType(b.category) || "", "fr"); break;
                case "debit": { const ad = a.amount < 0 ? Math.abs(a.amount) : 0; const bd = b.amount < 0 ? Math.abs(b.amount) : 0; cmp = ad - bd; break; }
                case "credit": { const ac = a.amount > 0 ? a.amount : 0; const bc = b.amount > 0 ? b.amount : 0; cmp = ac - bc; break; }
                case "solde": cmp = (balanceMap.get(a.id) ?? 0) - (balanceMap.get(b.id) ?? 0); break;
            }
            return bankSortDir === "asc" ? cmp : -cmp;
        });
        return list;
    }, [chronoEntries, bankSearch, reconciledFilter, bankFlowFilter, bankSortCol, bankSortDir, balanceMap]);

    const bankTotalPages = Math.max(1, Math.ceil(displayEntries.length / bankPageSize));
    const bankCurrentPage = Math.min(bankPage, bankTotalPages);
    const bankPageData = displayEntries.slice((bankCurrentPage - 1) * bankPageSize, bankCurrentPage * bankPageSize);
    const reconciledCount = bankEntries.filter(e => e.isReconciled).length;
    const unreconciledCount = bankEntries.length - reconciledCount;

    useEffect(() => { setBankPage(1); }, [bankSearch, reconciledFilter, bankFlowFilter]);

    const exportBankCSV = () => {
        if (displayEntries.length === 0) return toast({ title: "Aucune donnée à exporter" });
        const header = ["Date", "Libellé", "Type", "Débit", "Crédit", "Solde", "Banque", "Rapproché", "Notes"];
        const rows = displayEntries.map(e => [e.entryDate, e.label, bankOpType(e.category), e.amount < 0 ? String(Math.abs(e.amount)) : "", e.amount > 0 ? String(e.amount) : "", String(balanceMap.get(e.id) ?? ""), e.bankName, e.isReconciled ? "oui" : "non", e.notes || ""]);
        const csv = [header, ...rows].map(r => r.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "releve_bancaire.csv"; a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${dk ? "text-white/40" : "text-slate-400"}`}>Indicateurs clés</span>
                <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
            </div>
            <div className={`grid ${compactCards ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 md:grid-cols-6"} gap-3`}>
                <StatCard label="Solde actuel" value={fmt(lastBalance)} icon={Landmark} color={lastBalance >= 0 ? "green" : "red"} compact={compactCards} />
                <StatCard label="Total Crédits" value={fmt(totalCredit)} icon={TrendingUp} color="green" compact={compactCards} />
                <StatCard label="Total Débits" value={fmt(totalDebit)} icon={TrendingDown} color="red" compact={compactCards} />
                <StatCard label="Emprunts restants" value={fmt(loans.reduce((s, l) => s + l.remainingAmount, 0))} icon={CreditCard} color="purple" compact={compactCards} />
                <StatCard label="Rapprochées" value={String(reconciledCount)} icon={Check} color="green" compact={compactCards} />
                <StatCard label="Non rapprochées" value={String(unreconciledCount)} icon={AlertTriangle} color="orange" compact={compactCards} />
            </div>

            {/* Search + Filters */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-2 items-center">
                <div className={`flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2 lg:col-span-2`}>
                    <Search className={`w-4 h-4 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <input value={bankSearch} onChange={e => setBankSearch(e.target.value)} placeholder="Rechercher libellé, banque, notes..." className="bg-transparent w-full text-sm focus:outline-none" />
                </div>
                <select title="Filtrer par rapprochement" className={ic} value={reconciledFilter} onChange={e => setReconciledFilter(e.target.value as any)}>
                    <option value="all">Toutes écritures</option>
                    <option value="yes">Rapprochées</option>
                    <option value="no">Non rapprochées</option>
                </select>
                <select title="Filtrer par flux" className={ic} value={bankFlowFilter} onChange={e => setBankFlowFilter(e.target.value as any)}>
                    <option value="all">Crédits + Débits</option>
                    <option value="credit">Crédits uniquement</option>
                    <option value="debit">Débits uniquement</option>
                </select>
                <button onClick={exportBankCSV} className={`px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap`}>Export CSV</button>
            </div>
            {(authUser?.isOwner || authUser?.role === "admin") && (
                <div className="flex justify-end">
                    <button onClick={handleBankReset} disabled={resettingBank} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 text-sm font-medium transition disabled:opacity-50">
                        <Trash2 className="w-4 h-4" />
                        {resettingBank ? "Suppression..." : "🗑 Reset toutes les données bancaires"}
                    </button>
                </div>
            )}

            {/* Hidden loan import input (parse + prefill) */}
            <input ref={loanImportInputRef} type="file" accept=".pdf" className="hidden"
                onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImportingLoanDoc(true);
                    try {
                        const res = await uploadFileAsBase64("/api/v2/sugumaillane-management/loans/parse-document", file);
                        if (!res.ok) throw new Error("parse failed");
                        const parsed = await res.json();
                        setPendingLoanFile(file);
                        setLoanDocConfidence(parsed.confidence || "low");
                        setEditingLoan(null);
                        setLoanForm({
                            loanLabel: parsed.loanLabel || "",
                            bankName: parsed.bankName || "",
                            loanType: parsed.loanType || "emprunt",
                            totalAmount: parsed.totalAmount,
                            remainingAmount: parsed.remainingAmount,
                            monthlyPayment: parsed.monthlyPayment,
                            interestRate: parsed.interestRate,
                            startDate: parsed.startDate || "",
                            endDate: parsed.endDate || "",
                            notes: parsed.notes || "",
                        });
                        setShowLoanForm(true);
                        toast({ title: `Document analysé (${parsed.detectedDocType?.replace("_", " ") || "PDF"})`, description: `Confiance: ${parsed.confidence === "high" ? "élevée ✓" : parsed.confidence === "medium" ? "moyenne" : "faible — vérifiez les champs"}` });
                    } catch {
                        toast({ title: "Erreur d'analyse", description: "Impossible d'extraire les données du document", variant: "destructive" });
                    }
                    setImportingLoanDoc(false);
                    if (loanImportInputRef.current) loanImportInputRef.current.value = "";
                }} />

            {/* Hidden loan file input */}
            <input ref={loanFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
                onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file || attachingLoanId == null) return;
                    try {
                        const uploadRes = await uploadFileAsBase64("/api/v2/sugumaillane-management/files", file, {
                            category: "emprunt",
                            fileType: "file",
                            description: `Contrat emprunt — ${file.name}`,
                        });
                        if (!uploadRes.ok) { toast({ title: "Erreur upload", variant: "destructive" }); return; }
                        const uploadData = await uploadRes.json();
                        await fetch(`/api/v2/sugumaillane-management/loans/${attachingLoanId}`, {
                            method: "PUT", credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ originalFileId: uploadData.id })
                        });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/loans"] });
                        toast({ title: "Fichier joint à l'emprunt" });
                    } catch { toast({ title: "Erreur", variant: "destructive" }); }
                    setAttachingLoanId(null);
                    if (loanFileInputRef.current) loanFileInputRef.current.value = "";
                }} />

            {/* ===== FINANCEMENT SECTION ===== */}
            {(() => {
                const LOAN_TYPES: Record<string, { label: string; color: string; bg: string; icon: string }> = {
                    emprunt: { label: "Emprunt", color: "text-violet-400", bg: "bg-violet-500/20 border-violet-500/30", icon: "🏦" },
                    loa: { label: "LOA", color: "text-blue-400", bg: "bg-blue-500/20 border-blue-500/30", icon: "🚗" },
                    lld: { label: "LLD", color: "text-cyan-400", bg: "bg-cyan-500/20 border-cyan-500/30", icon: "📋" },
                };
                const totalMonthly = loans.reduce((s, l) => s + l.monthlyPayment, 0);
                const totalRemaining = loans.reduce((s, l) => s + l.remainingAmount, 0);
                const totalOriginal = loans.reduce((s, l) => s + l.totalAmount, 0);
                const totalInterestCost = loans.reduce((s, l) => {
                    if (!l.endDate) return s;
                    const monthsLeft = Math.max(0, Math.round((new Date(l.endDate).getTime() - Date.now()) / (30.44 * 86400000)));
                    const totalPaid = monthsLeft * l.monthlyPayment;
                    return s + Math.max(0, totalPaid - l.remainingAmount);
                }, 0);
                const getMonthsLeft = (l: Loan) => {
                    if (l.endDate) return Math.max(0, Math.round((new Date(l.endDate).getTime() - Date.now()) / (30.44 * 86400000)));
                    if (l.monthlyPayment > 0) return Math.ceil(l.remainingAmount / l.monthlyPayment);
                    return null;
                };
                const getPctRepaid = (l: Loan) => l.totalAmount > 0 ? Math.min(100, Math.round(((l.totalAmount - l.remainingAmount) / l.totalAmount) * 100)) : 0;

                return (
                    <Card title="Financements & Engagements" icon={CreditCard}
                        action={
                            <div className="flex items-center gap-2">
                                <button onClick={() => loanImportInputRef.current?.click()} disabled={importingLoanDoc} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition ${dk ? "border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300" : "border-violet-500/30 bg-violet-50 hover:bg-violet-100 text-violet-600"} disabled:opacity-50`}>
                                    {importingLoanDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                                    Importer PDF
                                </button>
                                <button onClick={() => { setEditingLoan(null); setLoanForm({ bankName: "", loanType: "emprunt" }); setLoanDocConfidence(null); setPendingLoanFile(null); setShowLoanForm(true); }} className={btnPrimary}><Plus className="w-4 h-4" /> Nouveau</button>
                            </div>
                        }>
                        {/* KPI strip */}
                        {loans.length > 0 && (
                            <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 pb-5 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3`}>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"} mb-0.5`}>Engagement total</p>
                                    <p className={`text-lg font-bold font-mono ${dk ? "text-white" : "text-slate-800"}`}>{fmtEur(totalOriginal)}</p>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"}`}>{loans.length} contrat{loans.length > 1 ? "s" : ""}</p>
                                </div>
                                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3`}>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"} mb-0.5`}>Mensualités totales</p>
                                    <p className="text-lg font-bold font-mono text-teal-400">{fmtEur(totalMonthly)}<span className={`text-xs ${dk ? "text-white/30" : "text-slate-400"}`}>/mois</span></p>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"}`}>{fmtEur(totalMonthly * 12)}/an</p>
                                </div>
                                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3`}>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"} mb-0.5`}>Capital restant dû</p>
                                    <p className="text-lg font-bold font-mono text-red-400">{fmtEur(totalRemaining)}</p>
                                    <div className={`mt-1.5 ${dk ? "bg-white/10" : "bg-slate-200"} rounded-full h-1.5 overflow-hidden`}>
                                        <div className="bg-gradient-to-r from-teal-500 to-emerald-400 h-1.5 rounded-full transition-all" style={{ width: `${totalOriginal > 0 ? Math.round(((totalOriginal - totalRemaining) / totalOriginal) * 100) : 0}%` }} />
                                    </div>
                                </div>
                                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3`}>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"} mb-0.5`}>Coût intérêts estimé</p>
                                    <p className="text-lg font-bold font-mono text-amber-400">{fmtEur(totalInterestCost)}</p>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"}`}>sur durées restantes</p>
                                </div>
                            </div>
                        )}

                        {loans.length === 0 ? (
                            <div className="text-center py-8">
                                <CreditCard className={`w-10 h-10 mx-auto mb-3 ${dk ? "text-white/20" : "text-slate-200"}`} />
                                <p className={`${dk ? "text-white/40" : "text-slate-400"}`}>Aucun financement enregistré</p>
                                <p className={`text-xs mt-1 ${dk ? "text-white/25" : "text-slate-300"}`}>Ajoutez un emprunt bancaire, une LOA ou une LLD</p>
                            </div>
                        ) : (
                            <div className="grid gap-4">
                                {loans.map(l => {
                                    const typeInfo = LOAN_TYPES[l.loanType] || LOAN_TYPES.emprunt;
                                    const pct = getPctRepaid(l);
                                    const monthsLeft = getMonthsLeft(l);
                                    const interestLeft = l.endDate
                                        ? Math.max(0, Math.round((new Date(l.endDate).getTime() - Date.now()) / (30.44 * 86400000)) * l.monthlyPayment - l.remainingAmount)
                                        : null;
                                    const isExpiringSoon = monthsLeft != null && monthsLeft <= 3;
                                    const isExpired = monthsLeft != null && monthsLeft === 0;

                                    return (
                                        <div key={l.id} className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-4 ${isExpiringSoon && !isExpired ? "ring-1 ring-amber-500/40" : ""} ${isExpired ? "ring-1 ring-green-500/40" : ""}`}>
                                            {/* Header row */}
                                            <div className="flex items-start justify-between gap-3 mb-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${typeInfo.bg} ${typeInfo.color}`}>{typeInfo.icon} {typeInfo.label}</span>
                                                        {isExpiringSoon && !isExpired && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400">⚡ Fin imminente</span>}
                                                        {isExpired && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/30 text-green-400">✓ Soldé</span>}
                                                    </div>
                                                    <p className={`font-semibold mt-1.5 ${dk ? "text-white" : "text-slate-800"}`}>{l.loanLabel}</p>
                                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} mt-0.5`}>
                                                        {l.bankName}{l.interestRate != null ? ` • ${l.interestRate}% /an` : ""}
                                                        {l.startDate ? ` • Début ${fmtDateShort(l.startDate)}` : ""}
                                                        {l.endDate ? ` • Fin ${fmtDateShort(l.endDate)}` : ""}
                                                    </p>
                                                    {l.notes && <p className={`text-xs mt-1 italic ${dk ? "text-white/30" : "text-slate-400"}`}>{l.notes}</p>}
                                                    {l.originalFile && (
                                                        <button onClick={() => setLoanPreviewFile(l.originalFile!)} className="mt-1 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition">
                                                            <FileText className="w-3 h-3" />{l.originalFile.originalName}
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Action buttons */}
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    {l.originalFile ? (
                                                        <button onClick={() => setLoanPreviewFile(l.originalFile!)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition" title="Voir le document">
                                                            <Eye className="w-3.5 h-3.5" />
                                                        </button>
                                                    ) : (
                                                        <button onClick={() => { setAttachingLoanId(l.id); loanFileInputRef.current?.click(); }}
                                                            className="p-1.5 rounded-lg transition bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400"
                                                            title="Joindre un document">
                                                            <Paperclip className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => { setEditingLoan(l); setLoanForm({ ...l }); setShowLoanForm(true); }} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition" title="Modifier">
                                                        <Edit2 className="w-3.5 h-3.5 text-teal-400" />
                                                    </button>
                                                    <button onClick={() => { if (confirm("Supprimer ce financement ?")) deleteLoanMut.mutate(l.id); }} className={btnDanger + " !p-1.5"} title="Supprimer">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Metrics row */}
                                            <div className={`grid grid-cols-3 gap-3 pt-3 border-t ${dk ? "border-white/5" : "border-slate-100"}`}>
                                                <div>
                                                    <p className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"} mb-0.5`}>Mensualité</p>
                                                    <p className={`font-mono font-bold text-sm ${dk ? "text-white" : "text-slate-800"}`}>{fmtEur(l.monthlyPayment)}</p>
                                                </div>
                                                <div>
                                                    <p className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"} mb-0.5`}>Capital restant</p>
                                                    <p className="font-mono font-bold text-sm text-red-400">{fmtEur(l.remainingAmount)}</p>
                                                </div>
                                                <div>
                                                    <p className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"} mb-0.5`}>Durée restante</p>
                                                    <p className={`font-mono font-bold text-sm ${monthsLeft != null && monthsLeft <= 6 ? "text-amber-400" : dk ? "text-white" : "text-slate-800"}`}>
                                                        {monthsLeft != null ? `${monthsLeft} mois` : "—"}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Progress bar */}
                                            <div className="mt-3">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>Remboursé {pct}%</span>
                                                    <span className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>
                                                        {interestLeft != null && interestLeft > 0 ? `~${fmtEur(interestLeft)} intérêts restants` : ""}
                                                    </span>
                                                </div>
                                                <div className={`${dk ? "bg-white/10" : "bg-slate-100"} rounded-full h-2 overflow-hidden`}>
                                                    <div
                                                        className={`h-2 rounded-full transition-all ${pct >= 75 ? "bg-gradient-to-r from-green-500 to-emerald-400" : pct >= 40 ? "bg-gradient-to-r from-teal-500 to-cyan-400" : "bg-gradient-to-r from-red-500 to-orange-500"}`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between mt-0.5">
                                                    <span className={`text-[9px] ${dk ? "text-white/20" : "text-slate-300"}`}>{fmtEur(l.totalAmount - l.remainingAmount)} remboursé</span>
                                                    <span className={`text-[9px] ${dk ? "text-white/20" : "text-slate-300"}`}>{fmtEur(l.totalAmount)} initial</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                );
            })()}
            {loanPreviewFile && <FilePreviewModal file={loanPreviewFile} onClose={() => setLoanPreviewFile(null)} />}

            {/* Import Result Banner */}
            {importResult && (
                <div className={`rounded-xl border p-4 ${importResult.error ? "border-red-500/30 bg-red-500/10" : "border-green-500/30 bg-green-500/10"}`}>
                    <div className="flex items-center justify-between">
                        <div>
                            {importResult.error ? (
                                <p className="text-red-400 font-medium">{importResult.error}</p>
                            ) : importResult.canReplace ? (
                                <>
                                    <p className="text-yellow-400 font-medium">Cette période est déjà importée ({importResult.skipped} opérations)</p>
                                    <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"} mt-1`}>Période: {importResult.period}</p>
                                    <button onClick={() => {
                                        if (lastImportFile) {
                                            const dt = new DataTransfer();
                                            dt.items.add(lastImportFile);
                                            if (fileInputRef.current) fileInputRef.current.files = dt.files;
                                            handleFileImport({ target: { files: dt.files } } as any, true);
                                        }
                                    }} className="mt-2 px-3 py-1.5 bg-teal-500/20 border border-teal-500/40 text-teal-400 rounded-lg text-xs font-medium hover:bg-teal-500/30 transition">
                                        🔄 Remplacer les données de cette période
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p className="text-green-400 font-medium">{importResult.message}</p>
                                    <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"} mt-1`}>
                                        Période: {importResult.period} • Banque: {importResult.bankName}
                                        {importResult.skipped > 0 && ` • ${importResult.skipped} doublons ignorés`}
                                    </p>
                                </>
                            )}
                        </div>
                        <button onClick={() => setImportResult(null)} className={`p-1 ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} rounded`} title="Fermer"><X className="w-4 h-4" /></button>
                    </div>
                </div>
            )}

            {/* Bank Entries */}
            <Card title="Relevé Bancaire" icon={Landmark}
                action={
                    <div className="flex gap-2">
                        <input ref={fileInputRef} type="file" accept=".pdf,.csv" onChange={handleFileImport} className="hidden" aria-label="Importer fichier PDF ou CSV" />
                        <button onClick={() => fileInputRef.current?.click()} className={btnPrimary} disabled={importing} title="Importer un relevé PDF ou CSV">
                            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {importing ? "Import..." : "Importer PDF/CSV"}
                        </button>
                        <button onClick={() => setShowBankForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouvelle Écriture</button>
                    </div>
                }>
                {bankEntries.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucune écriture bancaire</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <th className={`text-left py-2 px-3 cursor-pointer select-none group ${dk ? "hover:text-white/70" : "hover:text-slate-700"} transition-colors`} onClick={() => toggleBankSort("date")}>Date <SortIcon col="date" /></th>
                                    <th className={`text-left py-2 px-3 cursor-pointer select-none group ${dk ? "hover:text-white/70" : "hover:text-slate-700"} transition-colors`} onClick={() => toggleBankSort("label")}>Description <SortIcon col="label" /></th>
                                    <th className={`text-left py-2 px-3 cursor-pointer select-none group ${dk ? "hover:text-white/70" : "hover:text-slate-700"} transition-colors`} onClick={() => toggleBankSort("type")}>Type <SortIcon col="type" /></th>
                                    <th className={`text-right py-2 px-3 cursor-pointer select-none group ${dk ? "hover:text-white/70" : "hover:text-slate-700"} transition-colors`} onClick={() => toggleBankSort("debit")}>Débit <SortIcon col="debit" /></th>
                                    <th className={`text-right py-2 px-3 cursor-pointer select-none group ${dk ? "hover:text-white/70" : "hover:text-slate-700"} transition-colors`} onClick={() => toggleBankSort("credit")}>Crédit <SortIcon col="credit" /></th>
                                    <th className={`text-right py-2 px-3 cursor-pointer select-none group ${dk ? "hover:text-white/70" : "hover:text-slate-700"} transition-colors`} onClick={() => toggleBankSort("solde")}>Solde <SortIcon col="solde" /></th>
                                    <th className="text-center py-2 px-2">Rapp.</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bankPageData.map(e => (
                                    <tr key={e.id} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"} ${!e.isReconciled ? "bg-yellow-500/[0.03]" : ""}`}>
                                        <td className={`py-2 px-3 ${dk ? "text-white/60" : "text-slate-600"} whitespace-nowrap`}>{fmtDateShort(e.entryDate)}</td>
                                        <td className="py-2 px-3 max-w-[400px] truncate" title={e.label}>{e.label}</td>
                                        <td className="py-2 px-3"><CategoryBadge cat={e.category} /></td>
                                        <td className="py-2 px-3 text-right font-mono text-red-400">{e.amount < 0 ? `-${fmtEur(e.amount)}` : ""}</td>
                                        <td className="py-2 px-3 text-right font-mono text-green-400">{e.amount > 0 ? `+${fmtEur(e.amount)}` : ""}</td>
                                        <td className={`py-2 px-3 text-right font-mono ${(balanceMap.get(e.id) ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtEurSigned(balanceMap.get(e.id) ?? 0)}</td>
                                        <td className="py-2 px-2 text-center">
                                            <button
                                                onClick={() => toggleReconcileMut.mutate({ id: e.id, isReconciled: !e.isReconciled })}
                                                disabled={toggleReconcileMut.isPending}
                                                title={e.isReconciled ? "Marquer comme non rapproché" : "Marquer comme rapproché"}
                                                data-testid={`toggle-reconcile-${e.id}`}
                                                className={`inline-flex items-center justify-center w-5 h-5 rounded-full border text-xs transition-all hover:scale-110 active:scale-95 cursor-pointer ${e.isReconciled ? "bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/40" : `${dk ? "border-white/20 text-white/20 hover:border-green-500/50 hover:text-green-400" : "border-slate-300 text-slate-200 hover:border-green-500/50 hover:text-green-400"}`}`}
                                            >
                                                {e.isReconciled ? "✓" : ""}
                                            </button>
                                        </td>
                                        <td className="py-2 px-2 text-right flex gap-1 justify-end">
                                            <button onClick={() => { setEditingBankId(e.id); setBankForm({ bankName: e.bankName, entryDate: e.entryDate, label: e.label, amount: e.amount, balance: e.balance, category: e.category, isReconciled: e.isReconciled, notes: e.notes }); setShowBankForm(true); }} className={btnPrimary} title="Modifier"><Edit className="w-3 h-3" /></button>
                                            <button onClick={() => { if (confirm("Supprimer cette écriture ?")) deleteBankMut.mutate(e.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className={`flex items-center justify-between py-3 text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2">{displayEntries.length} écritures • Page {bankCurrentPage} / {bankTotalPages}
                                <select value={bankPageSize} onChange={e => { setBankPageSize(Number(e.target.value)); setBankPage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}>
                                    <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                                </select>/page
                            </span>
                            <div className="flex gap-2">
                                <button disabled={bankPage <= 1} onClick={() => setBankPage(1)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button disabled={bankPage <= 1} onClick={() => setBankPage(p => Math.max(1, p - 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button disabled={bankPage >= bankTotalPages} onClick={() => setBankPage(p => Math.min(bankTotalPages, p + 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={bankPage >= bankTotalPages} onClick={() => setBankPage(bankTotalPages)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            {/* Bank Form */}
            <FormModal title={editingBankId ? "Modifier Écriture Bancaire" : "Nouvelle Écriture Bancaire"} open={showBankForm} onClose={() => { setShowBankForm(false); setEditingBankId(null); setBankForm({ bankName: "", isReconciled: false, entryDate: new Date().toISOString().substring(0, 10) }); }}>
                <Field label="Banque"><input aria-label="Banque" className={ic} value={bankForm.bankName || ""} onChange={e => setBankForm({ ...bankForm, bankName: e.target.value })} /></Field>
                <Field label="Date"><input aria-label="Date" type="date" className={ic} value={bankForm.entryDate || ""} onChange={e => setBankForm({ ...bankForm, entryDate: e.target.value })} /></Field>
                <Field label="Libellé"><input aria-label="Libellé" className={ic} value={bankForm.label || ""} onChange={e => setBankForm({ ...bankForm, label: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Montant (€)"><input type="number" step="0.01" className={ic} value={bankForm.amount ?? ""} onChange={e => setBankForm({ ...bankForm, amount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} placeholder="-500 ou +1200" /></Field>
                    <Field label="Solde après"><input aria-label="Solde après" type="number" step="0.01" className={ic} value={bankForm.balance ?? ""} onChange={e => setBankForm({ ...bankForm, balance: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <Field label="Catégorie">
                    <select aria-label="Catégorie" className={ic} value={bankForm.category || ""} onChange={e => setBankForm({ ...bankForm, category: e.target.value || undefined })}>
                        <option value="">— Aucune —</option>
                        {Object.entries(categoryLabels).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                </Field>
                <Field label="Notes"><input aria-label="Notes" className={ic} value={bankForm.notes || ""} onChange={e => setBankForm({ ...bankForm, notes: e.target.value })} /></Field>
                <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                    <input type="checkbox" checked={bankForm.isReconciled || false} onChange={e => setBankForm({ ...bankForm, isReconciled: e.target.checked })} className="rounded" />
                    Rapproché
                </label>
                <button onClick={() => {
                    if (editingBankId) {
                        updateBankMut.mutate({ id: editingBankId, data: bankForm });
                    } else {
                        createBankMut.mutate(bankForm);
                    }
                }} className={btnPrimary + " w-full justify-center"} disabled={!bankForm.bankName || !bankForm.label}>
                    <Check className="w-4 h-4" /> {editingBankId ? "Modifier" : "Enregistrer"}
                </button>
            </FormModal>

            {/* Loan Form */}
            <FormModal title={editingLoan ? "Modifier le financement" : (pendingLoanFile ? `Import PDF : ${pendingLoanFile.name.slice(0, 30)}` : "Nouveau Financement")} open={showLoanForm} onClose={() => { setShowLoanForm(false); setEditingLoan(null); setLoanDocConfidence(null); setPendingLoanFile(null); }}>
                {loanDocConfidence && (
                    <div className={`flex items-start gap-3 p-3 rounded-xl border mb-1 ${loanDocConfidence === "high" ? "bg-green-500/10 border-green-500/30" : loanDocConfidence === "medium" ? "bg-amber-500/10 border-amber-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                        <span className="text-lg">{loanDocConfidence === "high" ? "✅" : loanDocConfidence === "medium" ? "⚠️" : "❌"}</span>
                        <div>
                            <p className={`text-xs font-semibold ${loanDocConfidence === "high" ? "text-green-400" : loanDocConfidence === "medium" ? "text-amber-400" : "text-red-400"}`}>
                                {loanDocConfidence === "high" ? "Extraction automatique réussie — vérifiez les données" : loanDocConfidence === "medium" ? "Extraction partielle — vérifiez et complétez les champs" : "Extraction limitée — saisissez les champs manuellement"}
                            </p>
                            <p className={`text-[11px] mt-0.5 ${dk ? "text-white/40" : "text-slate-400"}`}>Les données ont été extraites depuis le document PDF. {pendingLoanFile && "Le fichier sera automatiquement joint à l'emprunt."}</p>
                        </div>
                    </div>
                )}
                <Field label="Type de financement">
                    <select className={ic} value={loanForm.loanType || "emprunt"} onChange={e => setLoanForm({ ...loanForm, loanType: e.target.value })}>
                        <option value="emprunt">🏦 Emprunt bancaire</option>
                        <option value="loa">🚗 LOA — Location avec Option d'Achat</option>
                        <option value="lld">📋 LLD — Location Longue Durée</option>
                    </select>
                </Field>
                <Field label="Libellé"><input className={ic} value={loanForm.loanLabel || ""} onChange={e => setLoanForm({ ...loanForm, loanLabel: e.target.value })} placeholder="Ex: Crédit travaux SG, LOA Renault Clio..." /></Field>
                <Field label="Établissement / Bailleur"><input aria-label="Banque ou bailleur" className={ic} value={loanForm.bankName || ""} onChange={e => setLoanForm({ ...loanForm, bankName: e.target.value })} placeholder="Banque, organisme financier..." /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Montant total / financé (€)"><input aria-label="Montant total" type="number" step="0.01" className={ic} value={loanForm.totalAmount ?? ""} onChange={e => setLoanForm({ ...loanForm, totalAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Capital restant dû (€)"><input aria-label="Capital restant" type="number" step="0.01" className={ic} value={loanForm.remainingAmount ?? ""} onChange={e => setLoanForm({ ...loanForm, remainingAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Loyer / Mensualité (€)"><input aria-label="Mensualité" type="number" step="0.01" className={ic} value={loanForm.monthlyPayment ?? ""} onChange={e => setLoanForm({ ...loanForm, monthlyPayment: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Taux annuel (%)"><input aria-label="Taux" type="number" step="0.01" className={ic} value={loanForm.interestRate ?? ""} onChange={e => setLoanForm({ ...loanForm, interestRate: e.target.value === "" ? undefined : safeFloat(e.target.value) })} placeholder="0.00" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Date de début"><input aria-label="Date début" type="date" className={ic} value={loanForm.startDate || ""} onChange={e => setLoanForm({ ...loanForm, startDate: e.target.value })} /></Field>
                    <Field label="Date de fin / échéance"><input aria-label="Date fin" type="date" className={ic} value={loanForm.endDate || ""} onChange={e => setLoanForm({ ...loanForm, endDate: e.target.value })} /></Field>
                </div>
                <Field label="Notes / référence contrat"><textarea className={ic + " h-16 resize-none"} value={loanForm.notes || ""} onChange={e => setLoanForm({ ...loanForm, notes: e.target.value })} placeholder="Réf. contrat, conditions particulières..." /></Field>
                <button onClick={() => {
                    if (editingLoan) {
                        updateLoanMut.mutate({ id: editingLoan.id, data: loanForm });
                    } else {
                        createLoanMut.mutate(loanForm);
                    }
                }} className={btnPrimary + " w-full justify-center"} disabled={!loanForm.loanLabel || !loanForm.totalAmount || updateLoanMut.isPending || createLoanMut.isPending}>
                    {(updateLoanMut.isPending || createLoanMut.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {editingLoan ? "Mettre à jour" : "Enregistrer"}
                </button>
            </FormModal>

            <CategoryFiles category="banque" label="Banque" />
        </div>
    );
}

// ====== JOURNAL DE CAISSE TAB ======
function MiniCalendar({ dateFrom, dateTo, onChange, dk }: {
    dateFrom: string; dateTo: string;
    onChange: (from: string, to: string) => void;
    dk: boolean;
}) {
    const today = new Date();
    const initY = dateFrom ? parseInt(dateFrom.slice(0, 4)) : today.getFullYear();
    const initM = dateFrom ? parseInt(dateFrom.slice(5, 7)) - 1 : today.getMonth();
    const [viewYear, setViewYear] = useState(initY);
    const [viewMonth, setViewMonth] = useState(initM);
    const [hoverDate, setHoverDate] = useState("");
    const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
    const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    let startDow = (firstDay.getDay() + 6) % 7;
    const cells: (string | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
        cells.push(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const prevMonth = () => { let m = viewMonth - 1, y = viewYear; if (m < 0) { m = 11; y--; } setViewMonth(m); setViewYear(y); };
    const nextMonth = () => { let m = viewMonth + 1, y = viewYear; if (m > 11) { m = 0; y++; } setViewMonth(m); setViewYear(y); };
    const handleClick = (ds: string) => {
        if (!dateFrom || (dateFrom && dateTo)) { onChange(ds, ""); }
        else { onChange(ds < dateFrom ? ds : dateFrom, ds < dateFrom ? dateFrom : ds); }
    };
    const todayStr = today.toISOString().slice(0, 10);
    const effectiveTo = dateTo || hoverDate;
    const lo = dateFrom && effectiveTo ? (dateFrom < effectiveTo ? dateFrom : effectiveTo) : "";
    const hi = dateFrom && effectiveTo ? (dateFrom < effectiveTo ? effectiveTo : dateFrom) : "";
    return (
        <div className="select-none">
            <div className="flex items-center justify-between mb-2">
                <button onClick={prevMonth} className={`p-1.5 rounded-lg text-lg font-bold transition ${dk ? "hover:bg-white/10 text-white/60" : "hover:bg-slate-100 text-slate-500"}`}>‹</button>
                <span className={`text-sm font-semibold ${dk ? "text-white/80" : "text-slate-700"}`}>{MONTHS_FR[viewMonth]} {viewYear}</span>
                <button onClick={nextMonth} className={`p-1.5 rounded-lg text-lg font-bold transition ${dk ? "hover:bg-white/10 text-white/60" : "hover:bg-slate-100 text-slate-500"}`}>›</button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
                {DAYS.map((d, i) => <div key={i} className={`text-[10px] font-bold py-1 ${dk ? "text-white/30" : "text-slate-400"}`}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
                {cells.map((ds, i) => {
                    if (!ds) return <div key={i} />;
                    const isStart = ds === dateFrom;
                    const isEnd = ds === dateTo;
                    const inRange = lo && hi && ds > lo && ds < hi;
                    const isToday = ds === todayStr;
                    return (
                        <button key={ds} onClick={() => handleClick(ds)}
                            onMouseEnter={() => { if (dateFrom && !dateTo) setHoverDate(ds); }}
                            onMouseLeave={() => setHoverDate("")}
                            data-testid={`cal-day-${ds}`}
                            className={[
                                "text-xs py-1.5 w-full rounded transition-colors leading-none",
                                isStart || isEnd ? "bg-teal-500 text-white font-bold" : "",
                                inRange && !isStart && !isEnd ? (dk ? "bg-teal-500/25 text-teal-200" : "bg-teal-100 text-teal-700") : "",
                                !isStart && !isEnd && !inRange && isToday ? "font-bold underline" : "",
                                !isStart && !isEnd && !inRange ? (dk ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-100 text-slate-600") : "",
                            ].filter(Boolean).join(" ")}
                        >{parseInt(ds.slice(8))}</button>
                    );
                })}
            </div>
            {(dateFrom || dateTo) && (
                <p className={`text-[11px] mt-2 text-center ${dk ? "text-white/40" : "text-slate-400"}`}>
                    <span className="font-medium text-teal-400">{dateFrom || "…"}</span> → <span className="font-medium text-teal-400">{dateTo || "…"}</span>
                </p>
            )}
        </div>
    );
}

function CaisseTab({ compactCards, setCompactCards }: { compactCards: boolean; setCompactCards: (v: boolean) => void }) {
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [editingCash, setEditingCash] = useState<CashEntry | null>(null);
    const [form, setForm] = useState<Partial<CashEntry>>({ entryDate: new Date().toISOString().substring(0, 10) });
    const dk = useSuguDark();
    const ic = useInputClass();
    const [editForm, setEditForm] = useState<Partial<CashEntry>>({});
    const [caisseSortCol, setCaisseSortCol] = useState<"date" | "ca" | "covers" | "ticket">("date");
    const [caisseSortDir, setCaisseSortDir] = useState<"asc" | "desc">("desc");
    const [caissePage, setCaissePage] = useState(1);
    const [caissePageSize, setCaissePageSize] = useState(25);
    const [showDateRange, setShowDateRange] = useState(false);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const dateRangeRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showDateRange) return;
        const handler = (e: MouseEvent) => { if (dateRangeRef.current && !dateRangeRef.current.contains(e.target as Node)) setShowDateRange(false); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showDateRange]);

    const { data: entries = [] } = useQuery<CashEntry[]>({ queryKey: ["/api/v2/sugumaillane-management/cash"] });
    const { data: summary } = useQuery<any>({ queryKey: ["/api/v2/sugumaillane-management/cash/summary"] });

    const createMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/cash", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/cash"] }); qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/cash/summary"] }); setShowForm(false); setForm({ entryDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Journée enregistrée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible d'enregistrer la journée", variant: "destructive" }); }
    });

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugumaillane-management/cash/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/cash"] }); qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/cash/summary"] }); setEditingCash(null); toast({ title: "Journée modifiée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier la journée", variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/cash/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/cash"] }); qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/cash/summary"] }); toast({ title: "Entrée supprimée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer l'entrée", variant: "destructive" }); }
    });

    const filteredEntries = useMemo(() => {
        if (!dateFrom && !dateTo) return entries;
        return entries.filter(e => {
            const d = e.entryDate;
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            return true;
        });
    }, [entries, dateFrom, dateTo]);

    const totalRevenue = filteredEntries.reduce((s, e) => s + e.totalRevenue, 0);
    const totalCovers = filteredEntries.reduce((s, e) => s + (e.coversCount || 0), 0);
    const avgTicket = totalCovers > 0 ? totalRevenue / totalCovers : 0;
    const totalTVA10 = filteredEntries.reduce((s, e) => s + (e.coversCount || 0), 0);
    const totalTVA20 = filteredEntries.reduce((s, e) => s + (e.averageTicket || 0), 0);
    const totalCash = filteredEntries.reduce((s, e) => s + (e.cashAmount || 0), 0);
    const totalCB = filteredEntries.reduce((s, e) => s + (e.cbAmount || 0), 0);
    const totalCBZEN = filteredEntries.reduce((s, e) => s + (e.cbzenAmount || 0), 0);
    const totalTR = filteredEntries.reduce((s, e) => s + (e.trAmount || e.ticketRestoAmount || 0), 0);
    const totalCTR = filteredEntries.reduce((s, e) => s + (e.ctrAmount || 0), 0);
    const totalUbereats = filteredEntries.reduce((s, e) => s + (e.ubereatsAmount || 0), 0);
    const totalDeliveroo = filteredEntries.reduce((s, e) => s + (e.deliverooAmount || 0), 0);
    const totalCheque = filteredEntries.reduce((s, e) => s + (e.chequeAmount || 0), 0);
    const totalVirement = filteredEntries.reduce((s, e) => s + (e.virementAmount || 0), 0);
    const nbJours = filteredEntries.length;

    const sortedEntries = useMemo(() => {
        const list = [...filteredEntries].sort((a, b) => {
            let cmp = 0;
            switch (caisseSortCol) {
                case "date": cmp = a.entryDate.localeCompare(b.entryDate); break;
                case "ca": cmp = a.totalRevenue - b.totalRevenue; break;
                case "covers": cmp = (a.coversCount || 0) - (b.coversCount || 0); break;
                case "ticket": cmp = (a.averageTicket || 0) - (b.averageTicket || 0); break;
            }
            return caisseSortDir === "asc" ? cmp : -cmp;
        });
        return list;
    }, [entries, caisseSortCol, caisseSortDir]);

    const caisseTotalPages = Math.max(1, Math.ceil(sortedEntries.length / caissePageSize));
    const caisseCurrentPage = Math.min(caissePage, caisseTotalPages);
    const caissePageData = sortedEntries.slice((caisseCurrentPage - 1) * caissePageSize, caisseCurrentPage * caissePageSize);

    const toggleCaisseSort = (col: typeof caisseSortCol) => {
        if (caisseSortCol === col) setCaisseSortDir(d => d === "asc" ? "desc" : "asc");
        else { setCaisseSortCol(col); setCaisseSortDir("desc"); }
    };

    const openEditCash = (e: CashEntry) => {
        setEditingCash(e);
        setEditForm({ entryDate: e.entryDate, totalRevenue: e.totalRevenue, cashAmount: e.cashAmount, cbAmount: e.cbAmount, cbzenAmount: e.cbzenAmount, trAmount: e.trAmount || e.ticketRestoAmount, ctrAmount: e.ctrAmount, ubereatsAmount: e.ubereatsAmount, deliverooAmount: e.deliverooAmount, chequeAmount: e.chequeAmount, virementAmount: e.virementAmount, coversCount: e.coversCount, notes: e.notes });
    };

    const exportCaisseCSV = () => {
        if (sortedEntries.length === 0) return toast({ title: "Aucune donnée à exporter" });
        const header = ["Date", "CA Total", "Espèces", "CB", "CBZEN", "TR", "CTR", "Ubereats", "Deliveroo", "Chèque", "Virement", "Couverts", "Ticket Moyen", "Notes"];
        const rows = sortedEntries.map(e => [e.entryDate, String(e.totalRevenue), String(e.cashAmount ?? ""), String(e.cbAmount ?? ""), String(e.cbzenAmount ?? ""), String(e.trAmount || e.ticketRestoAmount || ""), String(e.ctrAmount ?? ""), String(e.ubereatsAmount ?? ""), String(e.deliverooAmount ?? ""), String(e.chequeAmount ?? ""), String(e.virementAmount ?? ""), String(e.coversCount ?? ""), String(e.averageTicket ?? ""), e.notes || ""]);
        const csv = [header, ...rows].map(r => r.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "journal_caisse.csv"; a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${dk ? "text-white/40" : "text-slate-400"}`}>Indicateurs clés</span>
                <div className="flex items-center gap-2">
                    <div className="relative" ref={dateRangeRef}>
                        <button onClick={() => setShowDateRange(v => !v)} data-testid="btn-date-range" className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${(dateFrom || dateTo) ? "bg-teal-500/20 border-teal-500/40 text-teal-400" : (dk ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10" : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100")}`}>
                            <CalendarRange className="w-3.5 h-3.5" />
                            {dateFrom || dateTo ? `${dateFrom || "…"} → ${dateTo || "…"}` : "Période"}
                            {(dateFrom || dateTo) && <span onClick={e => { e.stopPropagation(); setDateFrom(""); setDateTo(""); }} className="ml-1 hover:text-red-400">×</span>}
                        </button>
                        {showDateRange && (
                            <div className={`absolute right-0 top-full mt-1 z-50 ${dk ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"} border rounded-xl p-3 shadow-2xl w-64`}>
                                <MiniCalendar dateFrom={dateFrom} dateTo={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} dk={dk} />
                            </div>
                        )}
                    </div>
                    <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
                </div>
            </div>
            <div className={`grid ${compactCards ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 md:grid-cols-4 lg:grid-cols-6"} gap-3`}>
                <StatCard label="CA Total" value={fmt(totalRevenue)} icon={DollarSign} color="green" compact={compactCards} />
                <StatCard label="TVA 10%" value={fmt(totalTVA10)} icon={Receipt} color="blue" compact={compactCards} />
                <StatCard label="TVA 20%" value={fmt(totalTVA20)} icon={Receipt} color="orange" compact={compactCards} />
                <StatCard label="Jours" value={String(nbJours)} icon={Calendar} color="purple" compact={compactCards} />
                <StatCard label="Espèces" value={fmt(totalCash)} icon={DollarSign} color="green" compact={compactCards} />
                <StatCard label="CB" value={fmt(totalCB)} icon={CreditCard} color="blue" compact={compactCards} />
            </div>

            {/* Payment breakdown visual */}
            {totalRevenue > 0 && (() => {
                const paymentTypes = [
                    { label: "Espèces", amount: totalCash, color: "bg-green-500" },
                    { label: "CB", amount: totalCB, color: "bg-blue-500" },
                    { label: "CBZEN", amount: totalCBZEN, color: "bg-cyan-500" },
                    { label: "TR", amount: totalTR, color: "bg-purple-500" },
                    { label: "CTR", amount: totalCTR, color: "bg-violet-500" },
                    { label: "Ubereats", amount: totalUbereats, color: "bg-emerald-500" },
                    { label: "Deliveroo", amount: totalDeliveroo, color: "bg-teal-500" },
                    { label: "Chèque", amount: totalCheque, color: "bg-teal-500" },
                    { label: "Virement", amount: totalVirement, color: "bg-indigo-500" },
                ];
                const active = paymentTypes.filter(p => p.amount > 0);
                const accountedFor = active.reduce((s, p) => s + p.amount, 0);
                const other = totalRevenue - accountedFor;
                return (
                    <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} mb-3 flex items-center gap-2`}><BarChart3 className="w-5 h-5 text-teal-400" /> Répartition encaissements</h3>
                        <div className="flex gap-0.5 h-6 rounded-full overflow-hidden">
                            {active.map(p => <div key={p.label} className={`${p.color} h-full transition-all`} style={{ width: `${(p.amount / totalRevenue) * 100}%` }} title={`${p.label}: ${fmt(p.amount)}`} />)}
                            {other > 0 && <div className={`${dk ? "bg-white/20" : "bg-slate-200"} h-full transition-all`} style={{ width: `${(other / totalRevenue) * 100}%` }} title={`Autre: ${fmt(other)}`} />}
                        </div>
                        <div className={`flex flex-wrap gap-3 mt-2 text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>
                            {active.map(p => <span key={p.label} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${p.color}`} /> {p.label} {((p.amount / totalRevenue) * 100).toFixed(0)}%</span>)}
                            {other > 0 && <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${dk ? "bg-white/20" : "bg-slate-200"}`} /> Autre {((other / totalRevenue) * 100).toFixed(0)}%</span>}
                        </div>
                    </div>
                );
            })()}

            {/* Monthly breakdown */}
            {summary?.monthly && Object.keys(summary.monthly).length > 0 && (
                <Card title="Synthèse Mensuelle" icon={BarChart3}>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {Object.entries(summary.monthly as Record<string, any>).sort().map(([month, data]: [string, any]) => (
                            <div key={month} className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3`}>
                                <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{month}</p>
                                <p className="text-lg font-bold font-mono text-green-400">{fmt(data.revenue)}</p>
                                <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{data.covers} couverts • {data.days} jours</p>
                                {data.covers > 0 && <p className="text-xs text-teal-400 font-mono">{fmt(data.revenue / data.covers)}/couvert</p>}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <Card title="Journal de Caisse" icon={CreditCard}
                action={
                    <div className="flex gap-2">
                        <button onClick={exportCaisseCSV} className={`px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap flex items-center gap-1`}><Download className="w-3 h-3" /> CSV</button>
                        <button onClick={() => setShowForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouvelle Journée</button>
                    </div>
                }>
                {entries.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucune journée enregistrée</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <th className={`text-left py-2 px-2 cursor-pointer ${dk ? "hover:text-white/70" : "hover:text-slate-700"}`} onClick={() => toggleCaisseSort("date")}>Date {caisseSortCol === "date" && (caisseSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}</th>
                                    <th className={`text-right py-2 px-2 cursor-pointer ${dk ? "hover:text-white/70" : "hover:text-slate-700"}`} onClick={() => toggleCaisseSort("ca")}>CA Total {caisseSortCol === "ca" && (caisseSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}</th>
                                    <th className="text-right py-2 px-2">Espèces</th>
                                    <th className="text-right py-2 px-2">CB</th>
                                    <th className="text-right py-2 px-2">CBZEN</th>
                                    <th className="text-right py-2 px-2">TR</th>
                                    <th className="text-right py-2 px-2">CTR</th>
                                    <th className="text-right py-2 px-2">Ubereats</th>
                                    <th className="text-right py-2 px-2">Deliveroo</th>
                                    <th className="text-right py-2 px-2">Chèque</th>
                                    <th className="text-right py-2 px-2">Virement</th>
                                    <th className={`text-right py-2 px-2 cursor-pointer ${dk ? "hover:text-white/70" : "hover:text-slate-700"}`} onClick={() => toggleCaisseSort("covers")}>Couverts {caisseSortCol === "covers" && (caisseSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}</th>
                                    <th className={`text-right py-2 px-2 cursor-pointer ${dk ? "hover:text-white/70" : "hover:text-slate-700"}`} onClick={() => toggleCaisseSort("ticket")}>T.Moyen {caisseSortCol === "ticket" && (caisseSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {caissePageData.map(e => (
                                    <tr key={e.id} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                        <td className="py-2 px-2 font-medium whitespace-nowrap">{fmtDate(e.entryDate)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-green-400 font-bold">{fmt(e.totalRevenue)}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.cashAmount ? fmt(e.cashAmount) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.cbAmount ? fmt(e.cbAmount) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.cbzenAmount ? fmt(e.cbzenAmount) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{(e.trAmount || e.ticketRestoAmount) ? fmt(e.trAmount || e.ticketRestoAmount || 0) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.ctrAmount ? fmt(e.ctrAmount) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.ubereatsAmount ? fmt(e.ubereatsAmount) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.deliverooAmount ? fmt(e.deliverooAmount) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.chequeAmount ? fmt(e.chequeAmount) : "-"}</td>
                                        <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/60" : "text-slate-600"}`}>{e.virementAmount ? fmt(e.virementAmount) : "-"}</td>
                                        <td className="py-2 px-2 text-right">{e.coversCount || "-"}</td>
                                        <td className="py-2 px-2 text-right font-mono text-teal-400">{e.averageTicket ? fmt(e.averageTicket) : "-"}</td>
                                        <td className="py-2 px-2 text-right flex gap-1 justify-end">
                                            <button onClick={() => openEditCash(e)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>
                                            <button onClick={() => { if (confirm("Supprimer cette journée ?")) deleteMut.mutate(e.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className={`flex items-center justify-between py-3 text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2">{sortedEntries.length} jours • Page {caisseCurrentPage} / {caisseTotalPages}<select value={caissePageSize} onChange={e => { setCaissePageSize(Number(e.target.value)); setCaissePage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>/page</span>
                            <div className="flex gap-2">
                                <button disabled={caissePage <= 1} onClick={() => setCaissePage(1)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button disabled={caissePage <= 1} onClick={() => setCaissePage(p => Math.max(1, p - 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button disabled={caissePage >= caisseTotalPages} onClick={() => setCaissePage(p => Math.min(caisseTotalPages, p + 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={caissePage >= caisseTotalPages} onClick={() => setCaissePage(caisseTotalPages)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            {/* New Day Form */}
            <FormModal title="Nouvelle Journée" open={showForm} onClose={() => setShowForm(false)}>
                <Field label="Date"><input aria-label="Date" type="date" className={ic} value={form.entryDate || ""} onChange={e => setForm({ ...form, entryDate: e.target.value })} data-testid="input-cash-date" /></Field>
                <Field label="CA Total (€)"><input aria-label="CA Total (€)" type="number" step="0.01" className={ic} value={form.totalRevenue ?? ""} onChange={e => setForm({ ...form, totalRevenue: e.target.value === "" ? undefined : safeFloat(e.target.value) })} data-testid="input-cash-total" /></Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Espèces (€)"><input aria-label="Espèces (€)" type="number" step="0.01" className={ic} value={form.cashAmount ?? ""} onChange={e => setForm({ ...form, cashAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="CB (€)"><input aria-label="CB (€)" type="number" step="0.01" className={ic} value={form.cbAmount ?? ""} onChange={e => setForm({ ...form, cbAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="CBZEN (€)"><input aria-label="CBZEN (€)" type="number" step="0.01" className={ic} value={form.cbzenAmount ?? ""} onChange={e => setForm({ ...form, cbzenAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="TR - Ticket Restaurant (€)"><input aria-label="TR (€)" type="number" step="0.01" className={ic} value={form.trAmount ?? ""} onChange={e => setForm({ ...form, trAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="CTR - Carte TR (€)"><input aria-label="CTR (€)" type="number" step="0.01" className={ic} value={form.ctrAmount ?? ""} onChange={e => setForm({ ...form, ctrAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Ubereats (€)"><input aria-label="Ubereats (€)" type="number" step="0.01" className={ic} value={form.ubereatsAmount ?? ""} onChange={e => setForm({ ...form, ubereatsAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Deliveroo (€)"><input aria-label="Deliveroo (€)" type="number" step="0.01" className={ic} value={form.deliverooAmount ?? ""} onChange={e => setForm({ ...form, deliverooAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Chèque (€)"><input aria-label="Chèque (€)" type="number" step="0.01" className={ic} value={form.chequeAmount ?? ""} onChange={e => setForm({ ...form, chequeAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <Field label="Virement (€)"><input aria-label="Virement (€)" type="number" step="0.01" className={ic} value={form.virementAmount ?? ""} onChange={e => setForm({ ...form, virementAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                <Field label="Nombre de couverts"><input aria-label="Nombre de couverts" type="number" className={ic} value={form.coversCount ?? ""} onChange={e => setForm({ ...form, coversCount: e.target.value === "" ? undefined : safeInt(e.target.value) })} /></Field>
                <Field label="Notes"><input aria-label="Notes" className={ic} value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
                <button onClick={() => createMut.mutate(form)} className={btnPrimary + " w-full justify-center"} disabled={!form.totalRevenue}>
                    <Check className="w-4 h-4" /> Enregistrer
                </button>
            </FormModal>

            {/* Edit Day Form */}
            <FormModal title="Modifier la Journée" open={!!editingCash} onClose={() => setEditingCash(null)}>
                <Field label="Date"><input aria-label="Date" type="date" className={ic} value={editForm.entryDate || ""} onChange={e => setEditForm({ ...editForm, entryDate: e.target.value })} /></Field>
                <Field label="CA Total (€)"><input aria-label="CA Total (€)" type="number" step="0.01" className={ic} value={editForm.totalRevenue ?? ""} onChange={e => setEditForm({ ...editForm, totalRevenue: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Espèces (€)"><input aria-label="Espèces (€)" type="number" step="0.01" className={ic} value={editForm.cashAmount ?? ""} onChange={e => setEditForm({ ...editForm, cashAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="CB (€)"><input aria-label="CB (€)" type="number" step="0.01" className={ic} value={editForm.cbAmount ?? ""} onChange={e => setEditForm({ ...editForm, cbAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="CBZEN (€)"><input aria-label="CBZEN (€)" type="number" step="0.01" className={ic} value={editForm.cbzenAmount ?? ""} onChange={e => setEditForm({ ...editForm, cbzenAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="TR - Ticket Restaurant (€)"><input aria-label="TR (€)" type="number" step="0.01" className={ic} value={editForm.trAmount ?? ""} onChange={e => setEditForm({ ...editForm, trAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="CTR - Carte TR (€)"><input aria-label="CTR (€)" type="number" step="0.01" className={ic} value={editForm.ctrAmount ?? ""} onChange={e => setEditForm({ ...editForm, ctrAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Ubereats (€)"><input aria-label="Ubereats (€)" type="number" step="0.01" className={ic} value={editForm.ubereatsAmount ?? ""} onChange={e => setEditForm({ ...editForm, ubereatsAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Deliveroo (€)"><input aria-label="Deliveroo (€)" type="number" step="0.01" className={ic} value={editForm.deliverooAmount ?? ""} onChange={e => setEditForm({ ...editForm, deliverooAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Chèque (€)"><input aria-label="Chèque (€)" type="number" step="0.01" className={ic} value={editForm.chequeAmount ?? ""} onChange={e => setEditForm({ ...editForm, chequeAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <Field label="Virement (€)"><input aria-label="Virement (€)" type="number" step="0.01" className={ic} value={editForm.virementAmount ?? ""} onChange={e => setEditForm({ ...editForm, virementAmount: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                <Field label="Nombre de couverts"><input aria-label="Nombre de couverts" type="number" className={ic} value={editForm.coversCount ?? ""} onChange={e => setEditForm({ ...editForm, coversCount: e.target.value === "" ? undefined : safeInt(e.target.value) })} /></Field>
                <Field label="Notes"><input aria-label="Notes" className={ic} value={editForm.notes || ""} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></Field>
                <button onClick={() => editingCash && updateMut.mutate({ id: editingCash.id, data: editForm })} className={btnPrimary + " w-full justify-center"} disabled={!editForm.totalRevenue}>
                    <Check className="w-4 h-4" /> Sauvegarder
                </button>
            </FormModal>
        </div>
    );
}

// ====== EMPLOYEE FILES SECTION ======
function EmployeeFilesSection({ employeeId, employeeName, restricted }: { employeeId: number; employeeName: string; restricted?: boolean }) {
    const dk = useSuguDark();
    const qc = useQueryClient();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);

    const { data: files = [], isLoading } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugumaillane-management/files", "employee", employeeId],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugumaillane-management/files?employeeId=${employeeId}`, { credentials: "include" });
            return res.json();
        }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            toast({ title: "Fichier supprimé" });
        },
    });

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const res = await uploadFileAsBase64("/api/v2/sugumaillane-management/files", file, {
                category: "rh",
                employeeId: String(employeeId),
                description: `Document ${employeeName}`,
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Erreur upload"); }
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            toast({ title: "Document ajouté", description: file.name });
        } catch (err: any) {
            toast({ title: "Erreur", description: err?.message || "Impossible d'uploader le fichier", variant: "destructive" });
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                    <FolderOpen className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <span className={`text-xs font-medium ${dk ? "text-white/50" : "text-slate-500"}`}>
                        Documents ({files.length})
                    </span>
                </div>
                {!restricted && (
                    <>
                        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={handleUpload} className="hidden" data-testid={`input-emp-file-m-${employeeId}`} />
                        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${dk ? "bg-white/5 hover:bg-white/10 text-white/60" : "bg-slate-100 hover:bg-slate-200 text-slate-600"} transition`} data-testid={`btn-upload-emp-file-m-${employeeId}`}>
                            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            {uploading ? "Upload..." : "Ajouter"}
                        </button>
                    </>
                )}
            </div>
            {isLoading ? (
                <div className="flex items-center justify-center py-2"><Loader2 className={`w-4 h-4 animate-spin ${dk ? "text-white/30" : "text-slate-300"}`} /></div>
            ) : files.length === 0 ? (
                <p className={`text-xs text-center py-2 ${dk ? "text-white/30" : "text-slate-400"}`}>Aucun document</p>
            ) : (
                <div className="space-y-1">
                    {files.map(f => (
                        <div key={f.id} className={`flex items-center gap-2 ${dk ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-slate-50 border-slate-200 hover:bg-slate-100"} border rounded-lg px-2 py-1.5 transition`} data-testid={`emp-file-row-m-${f.id}`}>
                            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                {isFileMimeImage(f.mimeType) ? <Eye className="w-2.5 h-2.5 text-purple-400" /> : <FileText className="w-2.5 h-2.5 text-blue-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium truncate ${dk ? "text-white/80" : "text-slate-700"}`} title={f.originalName}>{f.originalName}</p>
                                <p className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>{new Date(f.createdAt).toLocaleDateString("fr-FR")} • {fmtSize(f.fileSize)}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugumaillane-management/files/${f.id}/download`, "_blank")}
                                    className={`p-1 rounded ${dk ? "hover:bg-white/10 text-purple-400" : "hover:bg-slate-200 text-purple-500"} transition`} title="Aperçu" data-testid={`btn-preview-emp-file-m-${f.id}`}>
                                    <Eye className="w-3 h-3" />
                                </button>
                                <a href={`/api/v2/sugumaillane-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                    className={`p-1 rounded ${dk ? "hover:bg-white/10 text-blue-400" : "hover:bg-slate-200 text-blue-500"} transition`} title="Télécharger" data-testid={`btn-download-emp-file-m-${f.id}`}>
                                    <Download className="w-3 h-3" />
                                </a>
                                {!restricted && (
                                    <button onClick={() => { if (confirm(`Supprimer "${f.originalName}" ?`)) deleteMut.mutate(f.id); }}
                                        className={`p-1 rounded ${dk ? "hover:bg-red-500/20 text-red-400" : "hover:bg-red-100 text-red-500"} transition`} title="Supprimer" data-testid={`btn-delete-emp-file-m-${f.id}`}>
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        </div>
    );
}

// ====== EMPLOYEE COST SECTION ======
function MEmployeeCostSection({ employeeId, payrolls, dk }: { employeeId: number; payrolls: Payroll[]; dk: boolean }) {
    const empPayrolls = useMemo(() =>
        payrolls.filter(p => p.employeeId === employeeId).sort((a, b) => b.period.localeCompare(a.period)),
        [payrolls, employeeId]
    );

    if (empPayrolls.length === 0) return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                <span className={`text-xs font-medium ${dk ? "text-white/50" : "text-slate-500"}`}>Suivi des coûts</span>
            </div>
            <p className={`text-xs text-center py-2 ${dk ? "text-white/30" : "text-slate-400"}`}>Aucune fiche de paie</p>
        </div>
    );

    const totalGross = empPayrolls.reduce((s, p) => s + p.grossSalary, 0);
    const totalNet = empPayrolls.reduce((s, p) => s + p.netSalary, 0);
    const totalCharges = empPayrolls.reduce((s, p) => s + (p.socialCharges || 0), 0);
    const avgGross = totalGross / empPayrolls.length;

    return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                <span className={`text-xs font-medium ${dk ? "text-white/50" : "text-slate-500"}`}>
                    Suivi des coûts ({empPayrolls.length} fiche{empPayrolls.length > 1 ? "s" : ""})
                </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"}`}>Total brut</p>
                    <p className="text-xs font-mono font-bold text-orange-400">{fmt(totalGross)}</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"}`}>Total net versé</p>
                    <p className="text-xs font-mono font-bold text-green-400">{fmt(totalNet)}</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"}`}>Moy. brut/mois</p>
                    <p className="text-xs font-mono font-bold text-blue-400">{fmt(avgGross)}</p>
                </div>
            </div>
            <div className="space-y-1">
                {empPayrolls.map(p => (
                    <div key={p.id} className={`flex items-center justify-between ${dk ? "bg-white/5 hover:bg-white/10" : "bg-slate-50 hover:bg-slate-100"} rounded-lg px-2.5 py-1.5 transition`} data-testid={`emp-cost-row-m-${p.id}`}>
                        <span className={`text-xs font-medium ${dk ? "text-white/60" : "text-slate-600"}`}>{p.period}</span>
                        <div className="flex items-center gap-3 text-xs font-mono">
                            <span className={dk ? "text-white/40" : "text-slate-400"}>Brut <span className="text-orange-400 font-medium">{fmt(p.grossSalary)}</span></span>
                            <span className={dk ? "text-white/40" : "text-slate-400"}>Net <span className="text-green-400 font-medium">{fmt(p.netSalary)}</span></span>
                            {(p.socialCharges || 0) > 0 && <span className={dk ? "text-white/40" : "text-slate-400"}>Ch. <span className="text-red-400 font-medium">{fmt(p.socialCharges || 0)}</span></span>}
                        </div>
                    </div>
                ))}
            </div>
            {totalCharges > 0 && (
                <div className={`mt-2 text-right text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>
                    Total charges salariales: <span className="text-red-400 font-mono">{fmt(totalCharges)}</span>
                </div>
            )}
        </div>
    );
}

// ====== EMPLOYEE CARD (MAILLANE) ======
function MEmployeeCard({ employee: e, dk, onEdit, onDelete, payrolls }: { employee: Employee; dk: boolean; onEdit: () => void; onDelete: () => void; payrolls: Payroll[] }) {
    const [showDetails, setShowDetails] = useState(false);
    const empPayrollCount = payrolls.filter(p => p.employeeId === e.id).length;
    const contractColor: Record<string, string> = { CDI: "text-green-400", CDD: "text-blue-400", Extra: "text-teal-400", Stage: "text-purple-400" };
    return (
        <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl ${!e.isActive ? "opacity-50" : ""}`} data-testid={`emp-card-m-${e.id}`}>
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center font-bold text-sm">
                        {e.firstName[0]}{e.lastName[0]}
                    </div>
                    <div>
                        <p className="font-medium">{e.firstName} {e.lastName}</p>
                        <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{e.role} • <span className={contractColor[e.contractType] || (dk ? "text-white/60" : "text-slate-600")}>{e.contractType}</span> • Depuis {fmtDate(e.startDate)}{e.contractType === "CDD" && e.endDate ? ` → ${fmtDate(e.endDate)}` : ""}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="font-mono font-bold">{fmt(e.monthlySalary ?? 0)}<span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>/mois</span></p>
                        {e.weeklyHours && <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{e.weeklyHours}h/sem</p>}
                    </div>
                    <button onClick={() => setShowDetails(v => !v)} className={`p-1.5 rounded-lg transition-colors relative ${showDetails ? "bg-teal-500/20 text-teal-400" : dk ? "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60" : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"}`} title="Détails & Documents" data-testid={`btn-toggle-files-m-${e.id}`}>
                        <FolderOpen className="w-3.5 h-3.5" />
                        {empPayrollCount > 0 && !showDetails && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-teal-500 text-[8px] text-white flex items-center justify-center font-bold">{empPayrollCount}</span>
                        )}
                    </button>
                    <button onClick={onEdit} className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>
                    <button onClick={onDelete} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                </div>
            </div>
            {showDetails && (
                <div className="px-4 pb-4">
                    <MEmployeeCostSection employeeId={e.id} payrolls={payrolls} dk={dk} />
                    <EmployeeFilesSection employeeId={e.id} employeeName={`${e.firstName} ${e.lastName}`} />
                </div>
            )}
        </div>
    );
}

// ====== GESTION RH TAB ======
function RHTab() {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showEmpForm, setShowEmpForm] = useState(false);
    const [showPayrollForm, setShowPayrollForm] = useState(false);
    const [showAbsenceForm, setShowAbsenceForm] = useState(false);
    const [empForm, setEmpForm] = useState<Partial<Employee>>({ contractType: "CDI", isActive: true, startDate: new Date().toISOString().substring(0, 10) });
    const [payForm, setPayForm] = useState<Partial<Payroll>>({ period: new Date().toISOString().substring(0, 7) });
    const [absForm, setAbsForm] = useState<Partial<Absence>>({ type: "conge", isApproved: false, startDate: new Date().toISOString().substring(0, 10) });
    const [rhSearch, setRhSearch] = useState("");
    const [contractFilter, setContractFilter] = useState<string>("all");
    const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");

    const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
    const { data: payrolls = [] } = useQuery<Payroll[]>({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
    const { data: absences = [] } = useQuery<Absence[]>({ queryKey: ["/api/v2/sugumaillane-management/absences"] });

    const createEmpMut = useMutation({
        mutationFn: (data: any) => {
            // Normalize undefined → null for nullable fields (Zod requires null, not undefined)
            const normalized = {
                ...data,
                monthlySalary: data.monthlySalary ?? null,
                hourlyRate: data.hourlyRate ?? null,
                weeklyHours: data.weeklyHours ?? null,
                phone: data.phone ?? null,
                email: data.email ?? null,
                notes: data.notes ?? null,
                endDate: data.endDate ?? null,
            };
            return apiRequest("POST", "/api/v2/sugumaillane-management/employees", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] }); setShowEmpForm(false); setEmpForm({ contractType: "CDI", isActive: true, startDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Employé ajouté" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'ajouter l'employé", variant: "destructive" }); }
    });
    const deleteEmpMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/employees/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] }); toast({ title: "Employé supprimé" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer l'employé", variant: "destructive" }); }
    });
    const updateEmpMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<Employee> }) => apiRequest("PUT", `/api/v2/sugumaillane-management/employees/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] }); setEditingEmpId(null); toast({ title: "Employé mis à jour" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de mettre à jour", variant: "destructive" }); }
    });
    const [editingEmpId, setEditingEmpId] = useState<number | null>(null);
    const [editEmpData, setEditEmpData] = useState<Partial<Employee>>({});
    const deletePayMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/payroll/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] }); toast({ title: "Fiche de paie supprimée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer la fiche de paie", variant: "destructive" }); }
    });
    const [viewingPayroll, setViewingPayroll] = useState<Payroll | null>(null);
    const createPayMut = useMutation({
        mutationFn: (data: any) => {
            const normalized = {
                ...data,
                socialCharges: data.socialCharges ?? null,
                bonus: data.bonus ?? null,
                overtime: data.overtime ?? null,
                paidDate: data.paidDate ?? null,
                notes: data.notes ?? null,
            };
            return apiRequest("POST", "/api/v2/sugumaillane-management/payroll", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] }); setShowPayrollForm(false); setPayForm({ period: new Date().toISOString().substring(0, 7) }); toast({ title: "Fiche de paie ajoutée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'ajouter la fiche de paie", variant: "destructive" }); }
    });
    const createAbsMut = useMutation({
        mutationFn: (data: any) => {
            const normalized = {
                ...data,
                endDate: data.endDate ?? null,
                duration: data.duration ?? null,
                reason: data.reason ?? null,
                notes: data.notes ?? null,
            };
            return apiRequest("POST", "/api/v2/sugumaillane-management/absences", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/absences"] }); setShowAbsenceForm(false); setAbsForm({ type: "conge", isApproved: false, startDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Absence enregistrée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'enregistrer l'absence", variant: "destructive" }); }
    });
    const deleteAbsMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/absences/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/absences"] }); toast({ title: "Absence supprimée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer l'absence", variant: "destructive" }); }
    });

    const activeEmps = employees.filter(e => e.isActive);
    const totalMonthlySalary = activeEmps.reduce((s, e) => s + (e.monthlySalary ?? 0), 0);
    const pendingAbsences = absences.filter(a => !a.isApproved).length;
    const totalPayrollGross = payrolls.reduce((s, p) => s + p.grossSalary, 0);
    const totalPayrollNet = payrolls.reduce((s, p) => s + p.netSalary, 0);

    const filteredEmps = useMemo(() => {
        let list = [...employees];
        if (rhSearch.trim()) {
            const q = rhSearch.toLowerCase();
            list = list.filter(e => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || (e.role || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q));
        }
        if (contractFilter !== "all") list = list.filter(e => e.contractType === contractFilter);
        if (activeFilter === "active") list = list.filter(e => e.isActive);
        if (activeFilter === "inactive") list = list.filter(e => !e.isActive);
        return list;
    }, [employees, rhSearch, contractFilter, activeFilter]);

    const exportRhCSV = () => {
        if (filteredEmps.length === 0) return toast({ title: "Aucune donnée à exporter" });
        const header = ["Prénom", "Nom", "Poste", "Contrat", "Salaire Mensuel", "Heures/sem", "Actif", "Date Entrée", "Téléphone", "Email"];
        const rows = filteredEmps.map(e => [e.firstName, e.lastName, e.role, e.contractType, String(e.monthlySalary ?? ""), String(e.weeklyHours ?? ""), e.isActive ? "oui" : "non", e.startDate, e.phone || "", e.email || ""]);
        const csv = [header, ...rows].map(r => r.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "employes.csv"; a.click();
        URL.revokeObjectURL(url);
    };

    const payrollPdfRef = useRef<HTMLInputElement>(null);
    const [importingPayroll, setImportingPayroll] = useState(false);
    const [payrollImportResult, setPayrollImportResult] = useState<any>(null);
    const [reparsing, setReparsing] = useState(false);

    const handleReparseAll = async () => {
        if (!confirm("Re-parser tous les bulletins de paie PDF ? Cela mettra à jour les montants.")) return;
        setReparsing(true);
        try {
            const resp = await fetch("/api/v2/sugumaillane-management/payroll/reparse-all", { method: "POST", credentials: "include" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || "Erreur");
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
            toast({ title: "Re-parsing terminé", description: `${data.updated || 0} mis à jour, ${data.created || 0} créés, ${data.failed || 0} échoués sur ${data.total || 0} fichiers` });
        } catch (err: any) {
            toast({ title: "Erreur", description: err?.message || "Impossible de re-parser", variant: "destructive" });
        } finally {
            setReparsing(false);
        }
    };

    const [importProgress, setImportProgress] = useState<string | null>(null);

    const handlePayrollPdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            toast({ title: "Format invalide", description: "Seuls les fichiers PDF sont acceptés", variant: "destructive" });
            return;
        }
        setImportingPayroll(true);
        setImportProgress("Envoi du fichier...");
        setPayrollImportResult(null);
        try {
            const resp = await uploadFileAsBase64("/api/v2/sugumaillane-management/payroll/import-pdf", file, { autoCreate: "true" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || "Erreur d'import");

            if (data.async) {
                setImportProgress("Analyse du bulletin en cours...");
                toast({ title: "Bulletin reçu", description: "Analyse en cours, un instant..." });

                const startTime = Date.now();
                const maxWait = 120000;
                const pollInterval = 3000;

                const pollForCompletion = async (): Promise<void> => {
                    if (Date.now() - startTime > maxWait) {
                        setImportProgress(null);
                        setImportingPayroll(false);
                        toast({ title: "Import en cours", description: "Le traitement prend plus de temps que prévu." });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
                        return;
                    }

                    await new Promise(r => setTimeout(r, pollInterval));

                    try {
                        const statusResp = await fetch(`/api/v2/sugumaillane-management/payroll/import-status/${data.importId}`, { credentials: "include" });
                        if (statusResp.ok) {
                            const statusData = await statusResp.json();
                            if (statusData.status === "complete") {
                                setPayrollImportResult(statusData.result);
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
                                const msgs: string[] = [];
                                const r = statusData.result;
                                if (r?.actions?.employeeCreated) msgs.push(`Employé créé: ${r.parsed?.employee?.firstName} ${r.parsed?.employee?.lastName}`);
                                if (r?.actions?.payrollCreated) msgs.push(`Fiche de paie ${r.parsed?.period} ajoutée`);
                                if (!r?.actions?.employeeCreated && r?.actions?.employeeId) msgs.push(`Employé existant mis à jour`);
                                if (r?.warnings?.length) msgs.push(`⚠️ ${r.warnings.join(", ")}`);
                                toast({ title: "Bulletin importé avec succès", description: msgs.join(" • ") || `Confiance: ${r?.confidence || "N/A"}` });
                                setImportProgress(null);
                                setImportingPayroll(false);
                                return;
                            } else if (statusData.status === "error") {
                                throw new Error(statusData.error || "Erreur de traitement");
                            } else if (statusData.step) {
                                setImportProgress(statusData.step);
                            }
                        }
                    } catch (pollErr: any) {
                        if (pollErr?.message?.includes("Erreur")) {
                            setImportProgress(null);
                            setImportingPayroll(false);
                            toast({ title: "Erreur d'import", description: pollErr.message, variant: "destructive" });
                            return;
                        }
                    }

                    return pollForCompletion();
                };

                pollForCompletion().catch(() => {
                    setImportProgress(null);
                    setImportingPayroll(false);
                });
            } else {
                setPayrollImportResult(data);
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
                const msgs: string[] = [];
                if (data.actions?.employeeCreated) msgs.push(`Employé créé: ${data.parsed?.employee?.firstName} ${data.parsed?.employee?.lastName}`);
                if (data.actions?.payrollCreated) msgs.push(`Fiche de paie ${data.parsed?.period} ajoutée`);
                if (!data.actions?.employeeCreated && data.actions?.employeeId) msgs.push(`Employé existant mis à jour`);
                if (data.warnings?.length) msgs.push(`⚠️ ${data.warnings.join(", ")}`);
                toast({ title: "Bulletin importé avec succès", description: msgs.join(" • ") || `Confiance: ${data.confidence || "N/A"}` });
                setImportingPayroll(false);
            }
        } catch (err: any) {
            toast({ title: "Erreur d'import", description: err?.message || "Impossible de lire le bulletin de paie", variant: "destructive" });
            setImportProgress(null);
            setImportingPayroll(false);
        } finally {
            if (payrollPdfRef.current) payrollPdfRef.current.value = "";
        }
    };

    const empName = (id: number) => {
        const emp = employees.find(emp => emp.id === id);
        return emp ? `${emp.firstName} ${emp.lastName}` : `#${id}`;
    };

    const typeLabel: Record<string, string> = { conge: "Congé", maladie: "Maladie", retard: "Retard", absence: "Absence", formation: "Formation" };
    const contractColor: Record<string, string> = { CDI: "text-green-400", CDD: "text-blue-400", Extra: "text-teal-400", Stage: "text-purple-400" };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <StatCard label="Effectif actif" value={String(activeEmps.length)} icon={Users} color="blue" />
                <StatCard label="Masse salariale/mois" value={fmt(totalMonthlySalary)} icon={DollarSign} color="orange" />
                <StatCard label="Absences en attente" value={String(pendingAbsences)} icon={AlertTriangle} color="red" />
                <StatCard label="Fiches de paie" value={String(payrolls.length)} icon={Receipt} color="purple" />
                <StatCard label="Total brut versé" value={fmt(totalPayrollGross)} icon={TrendingUp} color="green" />
                <StatCard label="Total net versé" value={fmt(totalPayrollNet)} icon={DollarSign} color="green" />
            </div>

            {/* Contract mix */}
            {activeEmps.length > 0 && (
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} mb-3 flex items-center gap-2`}><Users className="w-5 h-5 text-teal-400" /> Répartition des contrats</h3>
                    <div className="flex gap-1 h-6 rounded-full overflow-hidden">
                        {CONTRACT_TYPES.map(ct => {
                            const count = activeEmps.filter(e => e.contractType === ct).length;
                            if (count === 0) return null;
                            const pct = (count / activeEmps.length) * 100;
                            const colors: Record<string, string> = { CDI: "bg-green-500", CDD: "bg-blue-500", Extra: "bg-teal-500", Stage: "bg-purple-500" };
                            return <div key={ct} className={`${colors[ct] || (dk ? "bg-white/20" : "bg-slate-200")} h-full transition-all`} style={{ width: `${pct}%` }} title={`${ct}: ${count}`} />;
                        })}
                    </div>
                    <div className={`flex gap-4 mt-2 text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>
                        {CONTRACT_TYPES.map(ct => {
                            const count = activeEmps.filter(e => e.contractType === ct).length;
                            if (count === 0) return null;
                            const colors: Record<string, string> = { CDI: "bg-green-500", CDD: "bg-blue-500", Extra: "bg-teal-500", Stage: "bg-purple-500" };
                            return <span key={ct} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${colors[ct]}`} /> {ct} ({count})</span>;
                        })}
                    </div>
                </div>
            )}

            {/* Search + Filters */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-2 items-center">
                <div className={`flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2 lg:col-span-2`}>
                    <Search className={`w-4 h-4 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <input value={rhSearch} onChange={e => setRhSearch(e.target.value)} placeholder="Rechercher nom, poste, email..." className="bg-transparent w-full text-sm focus:outline-none" />
                </div>
                <select title="Filtrer par type de contrat" className={ic} value={contractFilter} onChange={e => setContractFilter(e.target.value)}>
                    <option value="all">Tous les contrats</option>
                    {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select title="Filtrer par statut" className={ic} value={activeFilter} onChange={e => setActiveFilter(e.target.value as any)}>
                    <option value="all">Tous</option>
                    <option value="active">Actifs</option>
                    <option value="inactive">Inactifs</option>
                </select>
                <button onClick={exportRhCSV} className={`px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap`}>Export CSV</button>
            </div>

            {/* Employees */}
            <Card title={`Employés (${filteredEmps.length})`} icon={Users}
                action={<button onClick={() => setShowEmpForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouvel Employé</button>}>
                {filteredEmps.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun employé trouvé</p>
                ) : (
                    <div className="grid gap-3">
                        {filteredEmps.map(e => (
                            <MEmployeeCard
                                key={e.id}
                                employee={e}
                                dk={dk}
                                payrolls={payrolls}
                                onEdit={() => { setEditingEmpId(e.id); setEditEmpData({ firstName: e.firstName, lastName: e.lastName, role: e.role, contractType: e.contractType, monthlySalary: e.monthlySalary, hourlyRate: e.hourlyRate, weeklyHours: e.weeklyHours, isActive: e.isActive, phone: e.phone, email: e.email, notes: e.notes }); }}
                                onDelete={() => { if (confirm("Supprimer cet employé ?")) deleteEmpMut.mutate(e.id); }}
                            />
                        ))}
                    </div>
                )}
            </Card>

            {/* Absences */}
            <Card title="Absences & Congés" icon={Clock}
                action={<button onClick={() => setShowAbsenceForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Déclarer Absence</button>}>
                {absences.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-4`}>Aucune absence</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <th className="text-left py-2 px-2">Employé</th>
                                    <th className="text-left py-2 px-2">Type</th>
                                    <th className="text-left py-2 px-2">Début</th>
                                    <th className="text-left py-2 px-2">Fin</th>
                                    <th className="text-center py-2 px-2">Durée</th>
                                    <th className="text-center py-2 px-2">Statut</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {absences.map(a => (
                                    <tr key={a.id} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                        <td className="py-2 px-2">{empName(a.employeeId)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{typeLabel[a.type] || a.type}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{fmtDate(a.startDate)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{a.endDate ? fmtDate(a.endDate) : "-"}</td>
                                        <td className="py-2 px-2 text-center">{a.duration ? `${a.duration}j` : "-"}</td>
                                        <td className="py-2 px-2 text-center">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${a.isApproved ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                                                {a.isApproved ? "Approuvé" : "En attente"}
                                            </span>
                                        </td>
                                        <td className="py-2 px-2 text-right">
                                            <button onClick={() => { if (confirm("Supprimer cette absence ?")) deleteAbsMut.mutate(a.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Payroll quick-add */}
            <Card title="Fiches de Paie" icon={DollarSign}
                action={<div className="flex gap-2">
                    <input ref={payrollPdfRef} type="file" accept=".pdf" onChange={handlePayrollPdfImport} className="hidden" data-testid="input-payroll-pdf" />
                    <button onClick={() => payrollPdfRef.current?.click()} className={btnPrimary} disabled={importingPayroll} data-testid="button-import-payroll-pdf" title="Importer un bulletin de paie PDF">
                        {importingPayroll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {importingPayroll ? (importProgress || "Traitement...") : "Import..."}
                    </button>
                    <button onClick={handleReparseAll} className={`px-3 py-2 text-xs rounded-lg ${dk ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" : "bg-amber-100 text-amber-700 hover:bg-amber-200"} transition flex items-center gap-1`} disabled={reparsing} data-testid="button-reparse-payroll" title="Re-parser tous les bulletins PDF existants">
                        {reparsing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        {reparsing ? "Re-parse..." : "Re-parser"}
                    </button>
                    <button onClick={() => setShowPayrollForm(true)} className={btnPrimary} data-testid="button-add-payroll"><Plus className="w-4 h-4" /> Ajouter Fiche</button>
                </div>}>
                {payrolls.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-4`}>Aucune fiche de paie</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <th className="text-left py-2 px-2">Employé</th>
                                    <th className="text-left py-2 px-2">Période</th>
                                    <th className="text-right py-2 px-2">Brut</th>
                                    <th className="text-right py-2 px-2">Net</th>
                                    <th className="text-right py-2 px-2">Charges</th>
                                    <th className="text-right py-2 px-2">Primes</th>
                                    <th className="text-center py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payrolls.map(p => (
                                    <tr key={p.id} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                        <td className="py-2 px-2">{empName(p.employeeId)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{p.period}</td>
                                        <td className="py-2 px-2 text-right font-mono">{fmt(p.grossSalary)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-green-400">{fmt(p.netSalary)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-red-400">{p.socialCharges ? fmt(p.socialCharges) : "-"}</td>
                                        <td className="py-2 px-2 text-right font-mono text-teal-400">{p.bonus ? fmt(p.bonus) : "-"}</td>
                                        <td className="py-2 px-2 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => setViewingPayroll(p)} className={`p-1.5 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} text-blue-400 hover:text-blue-300 transition`} title="Voir détails" data-testid={`button-view-payroll-${p.id}`}>
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => { if (confirm("Supprimer cette fiche de paie ?")) deletePayMut.mutate(p.id); }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition" title="Supprimer" data-testid={`button-delete-payroll-${p.id}`}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {payrollImportResult && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2" data-testid="payroll-import-result">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-emerald-400">Résultat Import Bulletin de Paie</h4>
                        <button onClick={() => setPayrollImportResult(null)} className={`${dk ? "text-white/40" : "text-slate-400"} ${dk ? "hover:text-white/60" : "hover:text-slate-600"} text-xs`}>✕ Fermer</button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Employé:</span> <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{payrollImportResult.parsed?.employee?.firstName} {payrollImportResult.parsed?.employee?.lastName}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Période:</span> <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{payrollImportResult.parsed?.period || "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Brut:</span> <span className={`${dk ? "text-white" : "text-slate-800"} font-mono`}>{payrollImportResult.parsed?.grossSalary ? fmt(payrollImportResult.parsed.grossSalary) : "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Net:</span> <span className="text-green-400 font-mono">{payrollImportResult.parsed?.netSalary ? fmt(payrollImportResult.parsed.netSalary) : "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Charges:</span> <span className="text-red-400 font-mono">{payrollImportResult.parsed?.socialCharges ? fmt(payrollImportResult.parsed.socialCharges) : "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Poste:</span> <span className={`${dk ? "text-white" : "text-slate-800"}`}>{payrollImportResult.parsed?.employee?.role || "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Confiance:</span> <span className="text-yellow-400">{payrollImportResult.confidence || "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Source:</span> <span className={`${dk ? "text-white/60" : "text-slate-600"}`}>{payrollImportResult.source || "N/A"}</span></div>
                    </div>
                    {payrollImportResult.parsed?.congesRestants != null && (
                        <div className={`text-xs ${dk ? "text-white/60" : "text-slate-600"}`}>Congés restants: <span className={`${dk ? "text-white" : "text-slate-800"}`}>{payrollImportResult.parsed.congesRestants}j</span></div>
                    )}
                    {payrollImportResult.warnings?.length > 0 && (
                        <div className="text-xs text-yellow-400/80">{payrollImportResult.warnings.join(" • ")}</div>
                    )}
                </div>
            )}

            <FormModal title="Détail Fiche de Paie" open={!!viewingPayroll} onClose={() => setViewingPayroll(null)}>
                {viewingPayroll && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Employé</span>
                                <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{empName(viewingPayroll.employeeId)}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Période</span>
                                <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{viewingPayroll.period}</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Salaire Brut</span>
                                <span className={`${dk ? "text-white" : "text-slate-800"} font-mono text-lg`}>{fmt(viewingPayroll.grossSalary)}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Salaire Net</span>
                                <span className="text-green-400 font-mono text-lg">{fmt(viewingPayroll.netSalary)}</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Charges Sociales</span>
                                <span className="text-red-400 font-mono">{viewingPayroll.socialCharges ? fmt(viewingPayroll.socialCharges) : "-"}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Primes</span>
                                <span className="text-teal-400 font-mono">{viewingPayroll.bonus ? fmt(viewingPayroll.bonus) : "-"}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Heures Sup.</span>
                                <span className="text-teal-400 font-mono">{viewingPayroll.overtime ? fmt(viewingPayroll.overtime) : "-"}</span>
                            </div>
                        </div>
                        <div className={`flex gap-2 pt-2 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                            {viewingPayroll.pdfPath && (
                                <a href={`/api/v2/sugumaillane-management/files/${viewingPayroll.pdfPath}/download`} target="_blank" rel="noreferrer"
                                    className={btnPrimary + " flex items-center gap-2"} data-testid="button-view-pdf-payroll">
                                    <FileText className="w-3.5 h-3.5" /> Voir PDF Original
                                </a>
                            )}
                            <button onClick={() => { if (confirm("Supprimer cette fiche de paie ?")) { deletePayMut.mutate(viewingPayroll.id); setViewingPayroll(null); } }} className={btnDanger + " flex items-center gap-2"} data-testid="button-delete-payroll-modal">
                                <Trash2 className="w-3.5 h-3.5" /> Supprimer
                            </button>
                        </div>
                    </div>
                )}
            </FormModal>

            <CategoryFiles category="rh" label="Ressources Humaines" />

            {/* Forms */}
            <FormModal title="Nouvel Employé" open={showEmpForm} onClose={() => setShowEmpForm(false)}>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Prénom"><input aria-label="Prénom" className={ic} value={empForm.firstName || ""} onChange={e => setEmpForm({ ...empForm, firstName: e.target.value })} /></Field>
                    <Field label="Nom"><input aria-label="Nom" className={ic} value={empForm.lastName || ""} onChange={e => setEmpForm({ ...empForm, lastName: e.target.value })} /></Field>
                </div>
                <Field label="Poste"><input className={ic} value={empForm.role || ""} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} placeholder="Ex: Serveur, Cuisinier..." /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Type de contrat">
                        <select aria-label="Type de contrat" className={ic} value={empForm.contractType} onChange={e => setEmpForm({ ...empForm, contractType: e.target.value })}>
                            {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </Field>
                    <Field label="Date d'entrée"><input aria-label="Date d'entrée" type="date" className={ic} value={empForm.startDate || ""} onChange={e => setEmpForm({ ...empForm, startDate: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Field label="Salaire mensuel (€)"><input aria-label="Salaire mensuel (€)" type="number" step="0.01" className={ic} value={empForm.monthlySalary ?? ""} onChange={e => setEmpForm({ ...empForm, monthlySalary: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Taux horaire (€)"><input aria-label="Taux horaire (€)" type="number" step="0.01" className={ic} value={empForm.hourlyRate ?? ""} onChange={e => setEmpForm({ ...empForm, hourlyRate: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Heures/sem"><input aria-label="Heures/sem" type="number" className={ic} value={empForm.weeklyHours ?? ""} onChange={e => setEmpForm({ ...empForm, weeklyHours: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Téléphone"><input className={ic} value={empForm.phone || ""} onChange={e => setEmpForm({ ...empForm, phone: e.target.value || undefined })} placeholder="06 ..." /></Field>
                    <Field label="Email"><input type="email" className={ic} value={empForm.email || ""} onChange={e => setEmpForm({ ...empForm, email: e.target.value || undefined })} placeholder="email@..." /></Field>
                </div>
                <Field label="Notes"><input className={ic} value={empForm.notes || ""} onChange={e => setEmpForm({ ...empForm, notes: e.target.value || undefined })} placeholder="Notes..." /></Field>
                <button onClick={() => createEmpMut.mutate(empForm)} className={btnPrimary + " w-full justify-center"} disabled={!empForm.firstName || !empForm.lastName || !empForm.role || createEmpMut.isPending}>
                    {createEmpMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                </button>
            </FormModal>

            <FormModal title="Nouvelle Fiche de Paie" open={showPayrollForm} onClose={() => setShowPayrollForm(false)}>
                <Field label="Employé">
                    <select aria-label="Employé" className={ic} value={payForm.employeeId ?? ""} onChange={e => setPayForm({ ...payForm, employeeId: parseInt(e.target.value) })}>
                        <option value="">-- Sélectionner --</option>
                        {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                    </select>
                </Field>
                <Field label="Période (YYYY-MM)"><input aria-label="Période (YYYY-MM)" type="text" pattern="\d{4}-\d{2}" className={ic} value={payForm.period || ""} onChange={e => setPayForm({ ...payForm, period: e.target.value })} placeholder="2026-01" /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Salaire brut (€)"><input aria-label="Salaire brut (€)" type="number" step="0.01" className={ic} value={payForm.grossSalary ?? ""} onChange={e => setPayForm({ ...payForm, grossSalary: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Salaire net (€)"><input aria-label="Salaire net (€)" type="number" step="0.01" className={ic} value={payForm.netSalary ?? ""} onChange={e => setPayForm({ ...payForm, netSalary: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Field label="Charges sociales (€)"><input aria-label="Charges sociales (€)" type="number" step="0.01" className={ic} value={payForm.socialCharges ?? ""} onChange={e => setPayForm({ ...payForm, socialCharges: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Primes (€)"><input aria-label="Primes (€)" type="number" step="0.01" className={ic} value={payForm.bonus ?? ""} onChange={e => setPayForm({ ...payForm, bonus: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Heures sup. (€)"><input aria-label="Heures sup. (€)" type="number" step="0.01" className={ic} value={payForm.overtime ?? ""} onChange={e => setPayForm({ ...payForm, overtime: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <button onClick={() => createPayMut.mutate(payForm)} className={btnPrimary + " w-full justify-center"} disabled={!payForm.employeeId || !payForm.grossSalary || createPayMut.isPending}>
                    {createPayMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                </button>
            </FormModal>

            <FormModal title="Déclarer Absence" open={showAbsenceForm} onClose={() => setShowAbsenceForm(false)}>
                <Field label="Employé">
                    <select aria-label="Employé" className={ic} value={absForm.employeeId ?? ""} onChange={e => setAbsForm({ ...absForm, employeeId: parseInt(e.target.value) })}>
                        <option value="">-- Sélectionner --</option>
                        {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                    </select>
                </Field>
                <Field label="Type">
                    <select aria-label="Type" className={ic} value={absForm.type} onChange={e => setAbsForm({ ...absForm, type: e.target.value })}>
                        {ABSENCE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Date début"><input aria-label="Date début" type="date" className={ic} value={absForm.startDate || ""} onChange={e => setAbsForm({ ...absForm, startDate: e.target.value })} /></Field>
                    <Field label="Date fin"><input aria-label="Date fin" type="date" className={ic} value={absForm.endDate || ""} onChange={e => setAbsForm({ ...absForm, endDate: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Durée (jours)"><input aria-label="Durée (jours)" type="number" className={ic} value={absForm.duration ?? ""} onChange={e => setAbsForm({ ...absForm, duration: parseInt(e.target.value) })} /></Field>
                    <Field label="Raison"><input aria-label="Raison" className={ic} value={absForm.reason || ""} onChange={e => setAbsForm({ ...absForm, reason: e.target.value })} /></Field>
                </div>
                <button onClick={() => createAbsMut.mutate(absForm)} className={btnPrimary + " w-full justify-center"} disabled={!absForm.employeeId || createAbsMut.isPending}>
                    {createAbsMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                </button>
            </FormModal>

            {/* Edit Employee Modal */}
            <FormModal title="Modifier Employé" open={editingEmpId !== null} onClose={() => setEditingEmpId(null)}>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Prénom"><input aria-label="Prénom" className={ic} value={editEmpData.firstName || ""} onChange={e => setEditEmpData({ ...editEmpData, firstName: e.target.value })} /></Field>
                    <Field label="Nom"><input aria-label="Nom" className={ic} value={editEmpData.lastName || ""} onChange={e => setEditEmpData({ ...editEmpData, lastName: e.target.value })} /></Field>
                </div>
                <Field label="Poste"><input aria-label="Poste" className={ic} value={editEmpData.role || ""} onChange={e => setEditEmpData({ ...editEmpData, role: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Type de contrat">
                        <select aria-label="Type de contrat" className={ic} value={editEmpData.contractType || "CDI"} onChange={e => setEditEmpData({ ...editEmpData, contractType: e.target.value })}>
                            {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </Field>
                    <Field label="Actif">
                        <select aria-label="Actif" className={ic} value={editEmpData.isActive ? "true" : "false"} onChange={e => setEditEmpData({ ...editEmpData, isActive: e.target.value === "true" })}>
                            <option value="true">Oui</option>
                            <option value="false">Non</option>
                        </select>
                    </Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Field label="Salaire mensuel (€)"><input aria-label="Salaire mensuel (€)" type="number" step="0.01" className={ic} value={editEmpData.monthlySalary ?? ""} onChange={e => setEditEmpData({ ...editEmpData, monthlySalary: e.target.value === "" ? null : safeFloat(e.target.value) })} /></Field>
                    <Field label="Taux horaire (€)"><input aria-label="Taux horaire (€)" type="number" step="0.01" className={ic} value={editEmpData.hourlyRate ?? ""} onChange={e => setEditEmpData({ ...editEmpData, hourlyRate: e.target.value === "" ? null : safeFloat(e.target.value) })} /></Field>
                    <Field label="Heures/sem"><input aria-label="Heures/sem" type="number" className={ic} value={editEmpData.weeklyHours ?? ""} onChange={e => setEditEmpData({ ...editEmpData, weeklyHours: e.target.value === "" ? null : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Téléphone"><input aria-label="Téléphone" className={ic} value={editEmpData.phone || ""} onChange={e => setEditEmpData({ ...editEmpData, phone: e.target.value || null })} /></Field>
                    <Field label="Email"><input aria-label="Email" type="email" className={ic} value={editEmpData.email || ""} onChange={e => setEditEmpData({ ...editEmpData, email: e.target.value || null })} /></Field>
                </div>
                <Field label="Notes"><input aria-label="Notes" className={ic} value={editEmpData.notes || ""} onChange={e => setEditEmpData({ ...editEmpData, notes: e.target.value || null })} /></Field>
                <button onClick={() => editingEmpId && updateEmpMut.mutate({ id: editingEmpId, data: editEmpData })} className={btnPrimary + " w-full justify-center"} disabled={!editEmpData.firstName || !editEmpData.lastName || updateEmpMut.isPending}>
                    {updateEmpMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Mettre à jour
                </button>
            </FormModal>
        </div>
    );
}

const SUPPLIER_CATEGORIES = ["alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurances", "vehicules", "plateformes", "materiels", "autre"];

function FournisseursTab() {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showForm, setShowForm] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);
    const [form, setForm] = useState<Partial<Supplier>>({ category: "alimentaire", isActive: true });
    const [editForm, setEditForm] = useState<Partial<Supplier>>({});
    const [searchTerm, setSearchTerm] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [sort, setSort] = useState<{ field: "name" | "category" | "city" | "totalPurchases"; dir: "asc" | "desc" }>({ field: "name", dir: "asc" });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [quickName, setQuickName] = useState("");
    const [quickCategory, setQuickCategory] = useState("alimentaire");
    const [quickSiret, setQuickSiret] = useState("");

    const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] });

    const defaultForm: Partial<Supplier> = { category: "alimentaire", isActive: true };

    const createMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/suppliers", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] }); setShowForm(false); setForm(defaultForm); toast({ title: "Fournisseur créé" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible de créer le fournisseur: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const quickCreateMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugumaillane-management/suppliers", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] }); setQuickName(""); setQuickSiret(""); toast({ title: "Fournisseur ajouté (rapide)" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugumaillane-management/suppliers/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] }); setEditingSupplier(null); toast({ title: "Fournisseur modifié" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible de modifier le fournisseur: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/suppliers/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] }); toast({ title: "Fournisseur supprimé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le fournisseur", variant: "destructive" }); }
    });

    const toggleActive = useMutation({
        mutationFn: (s: Supplier) => apiRequest("PUT", `/api/v2/sugumaillane-management/suppliers/${s.id}`, { isActive: !s.isActive }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/suppliers"] }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier le statut", variant: "destructive" }); }
    });

    const openEdit = (s: Supplier) => {
        setEditingSupplier(s);
        setEditForm({
            name: s.name, shortName: s.shortName, siret: s.siret, tvaNumber: s.tvaNumber,
            accountNumber: s.accountNumber, address: s.address, city: s.city, postalCode: s.postalCode,
            phone: s.phone, email: s.email, website: s.website, contactName: s.contactName,
            category: s.category, paymentTerms: s.paymentTerms, defaultPaymentMethod: s.defaultPaymentMethod,
            bankIban: s.bankIban, bankBic: s.bankBic, notes: s.notes, isActive: s.isActive
        });
    };

    const totalSuppliers = suppliers.length;
    const activeSuppliers = suppliers.filter(s => s.isActive).length;
    const totalAchats = suppliers.reduce((s, sup) => s + (sup.totalPurchases || 0), 0);
    const totalFactures = suppliers.reduce((s, sup) => s + (sup.invoiceCount || 0), 0);

    const { filtered, pageData, totalPages } = useMemo(() => {
        let list = [...suppliers];
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            list = list.filter(s =>
                s.name.toLowerCase().includes(q) ||
                (s.siret || "").toLowerCase().includes(q) ||
                (s.city || "").toLowerCase().includes(q) ||
                (s.category || "").toLowerCase().includes(q)
            );
        }
        if (categoryFilter !== "all") list = list.filter(s => s.category === categoryFilter);

        list.sort((a, b) => {
            let cmp = 0;
            switch (sort.field) {
                case "name": cmp = a.name.localeCompare(b.name, "fr", { sensitivity: "base" }); break;
                case "category": cmp = (a.category || "").localeCompare(b.category || ""); break;
                case "city": cmp = (a.city || "").localeCompare(b.city || "", "fr", { sensitivity: "base" }); break;
                case "totalPurchases": cmp = (a.totalPurchases || 0) - (b.totalPurchases || 0); break;
            }
            return sort.dir === "asc" ? cmp : -cmp;
        });

        const tp = Math.max(1, Math.ceil(list.length / pageSize));
        const cp = Math.min(page, tp);
        const pageSlice = list.slice((cp - 1) * pageSize, cp * pageSize);
        return { filtered: list, pageData: pageSlice, totalPages: tp };
    }, [suppliers, searchTerm, categoryFilter, sort, page, pageSize]);

    useEffect(() => { setPage(1); }, [searchTerm, categoryFilter]);

    const supplierFormFields = (f: Partial<Supplier>, setF: (v: Partial<Supplier>) => void) => (
        <>
            <Field label="Nom"><input data-testid="input-supplier-name" className={ic} value={f.name || ""} onChange={e => setF({ ...f, name: e.target.value })} placeholder="METRO, POMONA..." /></Field>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Nom court"><input data-testid="input-supplier-shortname" className={ic} value={f.shortName || ""} onChange={e => setF({ ...f, shortName: e.target.value })} /></Field>
                <Field label="Catégorie">
                    <select data-testid="select-supplier-category" aria-label="Catégorie" className={ic} value={f.category || "alimentaire"} onChange={e => setF({ ...f, category: e.target.value })}>
                        {SUPPLIER_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <Field label="SIRET"><input data-testid="input-supplier-siret" className={ic} value={f.siret || ""} onChange={e => setF({ ...f, siret: e.target.value })} /></Field>
                <Field label="N° TVA"><input data-testid="input-supplier-tva" className={ic} value={f.tvaNumber || ""} onChange={e => setF({ ...f, tvaNumber: e.target.value })} /></Field>
            </div>
            <Field label="N° Compte"><input data-testid="input-supplier-account" className={ic} value={f.accountNumber || ""} onChange={e => setF({ ...f, accountNumber: e.target.value })} /></Field>
            <Field label="Adresse"><input data-testid="input-supplier-address" className={ic} value={f.address || ""} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Ville"><input data-testid="input-supplier-city" className={ic} value={f.city || ""} onChange={e => setF({ ...f, city: e.target.value })} /></Field>
                <Field label="Code postal"><input data-testid="input-supplier-postal" className={ic} value={f.postalCode || ""} onChange={e => setF({ ...f, postalCode: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Téléphone"><input data-testid="input-supplier-phone" className={ic} value={f.phone || ""} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
                <Field label="Email"><input data-testid="input-supplier-email" type="email" className={ic} value={f.email || ""} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
            </div>
            <Field label="Site web"><input data-testid="input-supplier-website" className={ic} value={f.website || ""} onChange={e => setF({ ...f, website: e.target.value })} /></Field>
            <Field label="Nom du contact"><input data-testid="input-supplier-contact" className={ic} value={f.contactName || ""} onChange={e => setF({ ...f, contactName: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Conditions de paiement"><input data-testid="input-supplier-payment-terms" className={ic} value={f.paymentTerms || ""} onChange={e => setF({ ...f, paymentTerms: e.target.value })} placeholder="30 jours..." /></Field>
                <Field label="Mode de paiement par défaut">
                    <select data-testid="select-supplier-payment-method" aria-label="Mode de paiement" className={ic} value={f.defaultPaymentMethod || ""} onChange={e => setF({ ...f, defaultPaymentMethod: e.target.value })}>
                        <option value="">—</option>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{catLabel(m)}</option>)}
                    </select>
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <Field label="IBAN"><input data-testid="input-supplier-iban" className={ic} value={f.bankIban || ""} onChange={e => setF({ ...f, bankIban: e.target.value })} /></Field>
                <Field label="BIC"><input data-testid="input-supplier-bic" className={ic} value={f.bankBic || ""} onChange={e => setF({ ...f, bankBic: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><textarea data-testid="input-supplier-notes" className={ic + " min-h-[60px]"} value={f.notes || ""} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
            <label className={`flex items-center gap-2 text-sm ${dk ? "text-white/60" : "text-slate-600"}`}>
                <input type="checkbox" checked={f.isActive ?? true} onChange={e => setF({ ...f, isActive: e.target.checked })} className="rounded" />
                Fournisseur actif
            </label>
        </>
    );

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total fournisseurs" value={String(totalSuppliers)} icon={Building2} color="blue" />
                <StatCard label="Fournisseurs actifs" value={String(activeSuppliers)} icon={UserCheck} color="green" />
                <StatCard label="Total achats" value={fmt(totalAchats)} icon={ShoppingCart} color="orange" />
                <StatCard label="Total factures" value={String(totalFactures)} icon={Receipt} color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 items-center">
                <div className={`flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2`}>
                    <Search className={`w-4 h-4 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <input data-testid="input-search-suppliers" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Rechercher nom, SIRET, ville, catégorie..." className="bg-transparent w-full text-sm focus:outline-none" />
                </div>
                <select data-testid="select-filter-category" title="Filtrer par catégorie" className={ic} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                    <option value="all">Tous</option>
                    {SUPPLIER_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select>
                <div className="flex gap-2 justify-end">
                    <button data-testid="button-new-supplier" onClick={() => setShowForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouveau fournisseur</button>
                </div>
            </div>

            <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3 flex flex-col gap-2 lg:flex-row lg:items-end`}>
                <div className="flex-1 min-w-[160px]">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Nom</label>
                    <input data-testid="input-quick-supplier-name" value={quickName} onChange={e => setQuickName(e.target.value)} className={ic} placeholder="METRO, POMONA..." />
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Catégorie</label>
                    <select data-testid="select-quick-supplier-category" title="Catégorie" className={ic} value={quickCategory} onChange={e => setQuickCategory(e.target.value)}>
                        {SUPPLIER_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </select>
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>SIRET</label>
                    <input data-testid="input-quick-supplier-siret" value={quickSiret} onChange={e => setQuickSiret(e.target.value)} className={ic} placeholder="123 456 789 00012" />
                </div>
                <button data-testid="button-quick-add-supplier" onClick={() => {
                    if (!quickName.trim()) return toast({ title: "Nom requis", variant: "destructive" });
                    quickCreateMut.mutate({ name: quickName.trim(), category: quickCategory, siret: quickSiret.trim() || undefined, isActive: true });
                }} className={`px-4 py-2 rounded-lg bg-gradient-to-r from-teal-500 to-emerald-500 ${dk ? "text-white" : "text-slate-800"} text-sm font-semibold whitespace-nowrap`}>
                    + Ajout rapide
                </button>
            </div>

            <Card title="Liste des Fournisseurs" icon={Building2}
                action={<span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{filtered.length} fournisseur{filtered.length > 1 ? "s" : ""}</span>}>
                {suppliers.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun fournisseur enregistré</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    {([
                                        { id: "name", label: "Nom" },
                                        { id: "category", label: "Catégorie" },
                                        { id: "city", label: "Ville" },
                                        { id: "totalPurchases", label: "Total achats" }
                                    ] as const).map(col => (
                                        <th key={col.id} className={`${col.id === "totalPurchases" ? "text-right" : "text-left"} py-2 px-2`}>
                                            <button data-testid={`button-sort-${col.id}`} onClick={() => setSort(s => s.field === col.id ? { field: col.id, dir: s.dir === "asc" ? "desc" : "asc" } : { field: col.id, dir: col.id === "name" ? "asc" : "desc" })} className={`flex items-center gap-1 ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:text-white" : "hover:text-slate-900"}`}>
                                                <span>{col.label}</span>
                                                {sort.field === col.id && (sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                            </button>
                                        </th>
                                    ))}
                                    <th className="text-left py-2 px-2">Téléphone</th>
                                    <th className="text-left py-2 px-2">SIRET</th>
                                    <th className="text-center py-2 px-2">N° Fact.</th>
                                    <th className="text-center py-2 px-2">Statut</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageData.map(s => (
                                    <tr key={s.id} data-testid={`row-supplier-${s.id}`} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"} cursor-pointer`}
                                        onClick={() => setDetailSupplier(s)}>
                                        <td className="py-2 px-2 font-medium">{s.name}</td>
                                        <td className="py-2 px-2"><CategoryBadge cat={s.category} /></td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{s.city || "—"}</td>
                                        <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(s.totalPurchases || 0)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/50" : "text-slate-500"} text-xs`}>{s.phone || "—"}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/40" : "text-slate-400"} text-xs font-mono`}>{s.siret || "—"}</td>
                                        <td className={`py-2 px-2 text-center ${dk ? "text-white/50" : "text-slate-500"}`}>{s.invoiceCount || 0}</td>
                                        <td className="py-2 px-2 text-center">
                                            <button data-testid={`button-toggle-active-${s.id}`} onClick={e => { e.stopPropagation(); toggleActive.mutate(s); }}
                                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.isActive ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>
                                                {s.isActive ? "Actif" : "Inactif"}
                                            </button>
                                        </td>
                                        <td className="py-2 px-2 text-right" onClick={e => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-1">
                                                <button data-testid={`button-edit-supplier-${s.id}`} onClick={() => openEdit(s)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>
                                                <button data-testid={`button-delete-supplier-${s.id}`} onClick={() => { if (confirm("Supprimer ce fournisseur ?")) deleteMut.mutate(s.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className={`flex items-center justify-between py-3 text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2">{filtered.length} fournisseur{filtered.length > 1 ? "s" : ""} • Page {page} / {totalPages}<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>/page</span>
                            <div className="flex gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(1)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button data-testid="button-prev-page" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button data-testid="button-next-page" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className={`px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            <FormModal title="Fiche Fournisseur" open={!!detailSupplier} onClose={() => setDetailSupplier(null)}>
                {detailSupplier && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white font-bold text-lg">
                                {detailSupplier.name[0]}
                            </div>
                            <div>
                                <p className={`font-semibold text-lg ${dk ? "text-white" : "text-slate-800"}`}>{detailSupplier.name}</p>
                                {detailSupplier.shortName && <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{detailSupplier.shortName}</p>}
                            </div>
                            <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${detailSupplier.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                                {detailSupplier.isActive ? "Actif" : "Inactif"}
                            </span>
                        </div>
                        {([
                            { l: "Catégorie", v: catLabel(detailSupplier.category || "") },
                            { l: "SIRET", v: detailSupplier.siret },
                            { l: "N° TVA", v: detailSupplier.tvaNumber },
                            { l: "N° Compte", v: detailSupplier.accountNumber },
                            { l: "Adresse", v: [detailSupplier.address, detailSupplier.postalCode, detailSupplier.city].filter(Boolean).join(", ") },
                            { l: "Téléphone", v: detailSupplier.phone },
                            { l: "Email", v: detailSupplier.email },
                            { l: "Site web", v: detailSupplier.website },
                            { l: "Contact", v: detailSupplier.contactName },
                            { l: "Conditions paiement", v: detailSupplier.paymentTerms },
                            { l: "Mode paiement", v: detailSupplier.defaultPaymentMethod ? catLabel(detailSupplier.defaultPaymentMethod) : undefined },
                            { l: "IBAN", v: detailSupplier.bankIban },
                            { l: "BIC", v: detailSupplier.bankBic },
                            { l: "Total achats", v: fmt(detailSupplier.totalPurchases || 0) },
                            { l: "Nb factures", v: String(detailSupplier.invoiceCount || 0) },
                            { l: "Dernière facture", v: detailSupplier.lastInvoiceDate ? fmtDate(detailSupplier.lastInvoiceDate) : undefined },
                            { l: "Notes", v: detailSupplier.notes },
                        ] as { l: string; v?: string }[]).filter(r => r.v).map(r => (
                            <div key={r.l} className={`flex items-start gap-2 py-1 border-b ${dk ? "border-white/5" : "border-slate-100"}`}>
                                <span className={`text-xs w-32 flex-shrink-0 ${dk ? "text-white/40" : "text-slate-400"}`}>{r.l}</span>
                                <span className={`text-sm ${dk ? "text-white/80" : "text-slate-700"}`}>{r.v}</span>
                            </div>
                        ))}
                        <div className="flex gap-2 pt-2">
                            <button data-testid="button-detail-edit" onClick={() => { openEdit(detailSupplier); setDetailSupplier(null); }} className={btnPrimary + " flex-1 justify-center"}>
                                <Edit className="w-4 h-4" /> Modifier
                            </button>
                        </div>
                    </div>
                )}
            </FormModal>

            <FormModal title="Nouveau Fournisseur" open={showForm} onClose={() => setShowForm(false)}>
                {supplierFormFields(form, setForm)}
                <button data-testid="button-submit-create-supplier" onClick={() => createMut.mutate(form)} className={btnPrimary + " w-full justify-center"} disabled={!form.name || createMut.isPending}>
                    {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                </button>
            </FormModal>

            <FormModal title="Modifier le Fournisseur" open={!!editingSupplier} onClose={() => setEditingSupplier(null)}>
                {supplierFormFields(editForm, setEditForm)}
                <button data-testid="button-submit-edit-supplier" onClick={() => editingSupplier && updateMut.mutate({ id: editingSupplier.id, data: editForm })} className={btnPrimary + " w-full justify-center"} disabled={!editForm.name || updateMut.isPending}>
                    {updateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Mettre à jour
                </button>
            </FormModal>
        </div>
    );
}

// ====== AUDIT TAB ======
function AuditTab() {
    const dk = useSuguDark();
    const ic = useInputClass();
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear.toString());
    const [yearSynced, setYearSynced] = useState(false);
    const { toast } = useToast();
    const { data: audit, isLoading } = useQuery<AuditOverview>({ queryKey: [`/api/v2/sugumaillane-management/audit/overview?year=${selectedYear}`] });

    useEffect(() => {
        if (audit && !yearSynced && audit.year !== selectedYear) {
            setSelectedYear(audit.year);
            setYearSynced(true);
        }
    }, [audit, yearSynced, selectedYear]);

    if (isLoading) return <div className={`flex items-center justify-center py-12 gap-2 ${dk ? "text-white/40" : "text-slate-400"}`}><Loader2 className="w-5 h-5 animate-spin" /> Chargement de l'analyse...</div>;
    if (!audit) return <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-12`}>Aucune donnée disponible</p>;

    const months = Object.entries(audit.monthlyRevenue || {}).sort();
    const maxRev = Math.max(...months.map(([, v]) => v), 1);

    const exportAuditCSV = () => {
        const header = ["Métrique", "Valeur"];
        const rows = [
            ["CA " + selectedYear, String(audit.totalRevenue)],
            ["Coûts totaux", String(audit.totalCosts)],
            ["Résultat exploitation", String(audit.operatingProfit)],
            ["Marge", audit.profitMargin + "%"],
            ["Ticket moyen", String(audit.avgTicket)],
            ["CA moyen/jour", String(audit.avgDailyRevenue)],
            ["Couverts", String(audit.totalCovers)],
            ["Jours ouverture", String(audit.operatingDays)],
            ["Achats", String(audit.costBreakdown.achats)],
            ["Frais Généraux", String(audit.costBreakdown.fraisGeneraux)],
            ["Salaires", String(audit.costBreakdown.salaires)],
            ["Charges Sociales", String(audit.costBreakdown.chargesSociales)],
            ["Emprunts", String(audit.costBreakdown.emprunts)],
            ["Impayés fournisseurs", String(audit.unpaidPurchases)],
            ["Impayés frais", String(audit.unpaidExpenses)],
            ["Capital restant emprunts", String(audit.totalRemainingLoans)],
        ];
        months.forEach(([m, v]) => rows.push(["CA " + m, String(v)]));
        const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `audit_${selectedYear}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            {/* Year selector + export */}
            <div className="flex items-center gap-3">
                <select title="Sélectionner l'année" className={ic + " w-32"} value={selectedYear} onChange={e => { setSelectedYear(e.target.value); setYearSynced(true); }}>
                    {(audit.availableYears && audit.availableYears.length > 0
                        ? [...new Set([...audit.availableYears, currentYear.toString()])].sort((a, b) => Number(b) - Number(a))
                        : Array.from({ length: 5 }, (_, i) => (currentYear - i).toString())
                    ).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <h2 className={`text-lg font-bold ${dk ? "text-white" : "text-slate-800"}`}>Bilan comptable — {audit.year}</h2>
                <button onClick={exportAuditCSV} className={`ml-auto px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap flex items-center gap-1`}><Download className="w-3 h-3" /> Export CSV</button>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label={`CA ${selectedYear}`} value={fmt(audit.totalRevenue)} icon={DollarSign} color="green" />
                <StatCard label="Coûts totaux" value={fmt(audit.totalCosts)} icon={TrendingDown} color="red" />
                <StatCard label="Résultat d'exploitation" value={fmt(audit.operatingProfit)} icon={TrendingUp} color={audit.operatingProfit >= 0 ? "green" : "red"} />
                <StatCard label="Marge" value={`${audit.profitMargin}%`} icon={BarChart3} color={(parseFloat(audit.profitMargin) || 0) >= 0 ? "green" : "red"} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Ticket moyen" value={fmt(audit.avgTicket)} icon={Receipt} color="orange" />
                <StatCard label="CA moyen/jour" value={fmt(audit.avgDailyRevenue)} icon={Calendar} color="blue" />
                <StatCard label="Couverts total" value={String(audit.totalCovers)} icon={Users} color="purple" />
                <StatCard label="Jours d'ouverture" value={String(audit.operatingDays)} icon={Calendar} color="blue" />
            </div>

            {/* Revenue chart — using inline style for dynamic widths */}
            {months.length > 0 && (
                <Card title={`CA Mensuel ${selectedYear}`} icon={BarChart3}>
                    <div className="space-y-2">
                        {months.map(([month, revenue]) => (
                            <div key={month} className="flex items-center gap-3">
                                <span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} w-20`}>{month}</span>
                                <div className={`flex-1 ${dk ? "bg-white/5" : "bg-white"} rounded-full h-6 overflow-hidden`}>
                                    <div className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full rounded-full flex items-center justify-end pr-2 transition-all min-w-[40px]" style={{ width: `${Math.round((revenue / maxRev) * 100)}%` }}>
                                        <span className="text-xs font-mono font-bold">{fmt(revenue)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Cost breakdown */}
            <Card title="Répartition des Coûts" icon={Receipt}>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[
                        { label: "Achats", value: audit.costBreakdown.achats, color: "from-teal-500/20 to-teal-600/10 border-teal-500/20" },
                        { label: "Frais Généraux", value: audit.costBreakdown.fraisGeneraux, color: "from-blue-500/20 to-blue-600/10 border-blue-500/20" },
                        { label: "Salaires", value: audit.costBreakdown.salaires, color: "from-purple-500/20 to-purple-600/10 border-purple-500/20" },
                        { label: "Charges Sociales", value: audit.costBreakdown.chargesSociales, color: "from-red-500/20 to-red-600/10 border-red-500/20" },
                        { label: "Emprunts", value: audit.costBreakdown.emprunts, color: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/20" },
                    ].map(item => (
                        <div key={item.label} className={`bg-gradient-to-br ${item.color} border rounded-xl p-4`}>
                            <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{item.label}</p>
                            <p className="text-xl font-bold font-mono">{fmt(item.value ?? 0)}</p>
                            <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{audit.totalCosts > 0 ? (((item.value ?? 0) / audit.totalCosts) * 100).toFixed(1) : 0}%</p>
                        </div>
                    ))}
                </div>
                {/* Visual bar */}
                {audit.totalCosts > 0 && (
                    <div className="mt-4">
                        <div className="flex gap-0.5 h-4 rounded-full overflow-hidden">
                            {[
                                { value: audit.costBreakdown.achats, color: "bg-teal-500" },
                                { value: audit.costBreakdown.fraisGeneraux, color: "bg-blue-500" },
                                { value: audit.costBreakdown.salaires, color: "bg-purple-500" },
                                { value: audit.costBreakdown.chargesSociales, color: "bg-red-500" },
                                { value: audit.costBreakdown.emprunts, color: "bg-yellow-500" },
                            ].map((item, i) => {
                                const pct = (item.value / audit.totalCosts) * 100;
                                if (pct < 0.5) return null;
                                return <div key={i} className={`${item.color} h-full transition-all`} style={{ width: `${pct}%` }} />;
                            })}
                        </div>
                    </div>
                )}
            </Card>

            {/* Alerts */}
            <Card title="Alertes Financières" icon={AlertTriangle}>
                <div className="space-y-3">
                    {audit.unpaidPurchases > 0 && (
                        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                            <AlertTriangle className="w-5 h-5 text-red-400" />
                            <div>
                                <p className="text-sm font-medium text-red-400">Achats impayés</p>
                                <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{fmt(audit.unpaidPurchases)} en factures fournisseurs impayées</p>
                            </div>
                        </div>
                    )}
                    {audit.unpaidExpenses > 0 && (
                        <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                            <AlertTriangle className="w-5 h-5 text-yellow-400" />
                            <div>
                                <p className="text-sm font-medium text-yellow-400">Frais impayés</p>
                                <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{fmt(audit.unpaidExpenses)} en frais généraux impayés</p>
                            </div>
                        </div>
                    )}
                    {audit.totalRemainingLoans > 0 && (
                        <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
                            <Landmark className="w-5 h-5 text-blue-400" />
                            <div>
                                <p className="text-sm font-medium text-blue-400">Capital restant dû</p>
                                <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{fmt(audit.totalRemainingLoans)} d'emprunts restants</p>
                            </div>
                        </div>
                    )}
                    {parseFloat(audit.profitMargin) < 10 && audit.totalRevenue > 0 && (
                        <div className="flex items-center gap-3 bg-teal-500/10 border border-teal-500/20 rounded-xl p-3">
                            <TrendingDown className="w-5 h-5 text-teal-400" />
                            <div>
                                <p className="text-sm font-medium text-teal-400">Marge faible</p>
                                <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>La marge d'exploitation est de {audit.profitMargin}% — en dessous de 10%</p>
                            </div>
                        </div>
                    )}
                    {audit.unpaidPurchases === 0 && audit.unpaidExpenses === 0 && (parseFloat(audit.profitMargin) || 0) >= 10 && (
                        <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                            <UserCheck className="w-5 h-5 text-green-400" />
                            <div>
                                <p className="text-sm font-medium text-green-400">Aucune alerte</p>
                                <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Tous les indicateurs financiers sont sains</p>
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {/* Summary */}
            <Card title="Informations" icon={Building2}>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Effectif actif:</span> <span className="font-medium">{audit.activeEmployees} employés</span></div>
                    <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Jours d'ouverture:</span> <span className="font-medium">{audit.operatingDays} jours</span></div>
                    <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Année:</span> <span className="font-medium">{selectedYear}</span></div>
                    <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>CA moyen/jour:</span> <span className="font-mono font-medium">{fmt(audit.avgDailyRevenue)}</span></div>
                    <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Coût salarial/CA:</span> <span className="font-mono font-medium">{audit.totalRevenue > 0 ? ((audit.costBreakdown.salaires / audit.totalRevenue) * 100).toFixed(1) : 0}%</span></div>
                    <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Achats/CA:</span> <span className="font-mono font-medium">{audit.totalRevenue > 0 ? ((audit.costBreakdown.achats / audit.totalRevenue) * 100).toFixed(1) : 0}%</span></div>
                </div>
            </Card>
        </div>
    );
}

// ====== FILE UPLOAD MODAL ======
function FileUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [fileType, setFileType] = useState<"photo" | "file">("file");
    const [category, setCategory] = useState("achats");
    const [supplier, setSupplier] = useState("");
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [fileDate, setFileDate] = useState(new Date().toISOString().substring(0, 10));
    const [parsePreviewLoading, setParsePreviewLoading] = useState(false);
    const [parsePreviewData, setParsePreviewData] = useState<{ parsed: any; confidence: number; matchedSupplier: any | null } | null>(null);
    const [parsePreviewError, setParsePreviewError] = useState<string | null>(null);

    if (!open) return null;

    const triggerParsePreview = async (file: File) => {
        if (!["achats", "frais_generaux"].includes(category)) return;
        setParsePreviewData(null);
        setParsePreviewError(null);
        setParsePreviewLoading(true);
        try {
            const res = await uploadFileAsBase64("/api/v2/sugumaillane-management/files/parse-preview", file, { category });
            const data = await res.json();
            if (data.success && data.parsed) {
                setParsePreviewData(data);
                if (data.parsed.supplier && !supplier) setSupplier(data.parsed.supplier);
                if (data.parsed.amount && !amount) setAmount(String(data.parsed.amount));
                if (data.parsed.date) {
                    const parsedMs = new Date(data.parsed.date).getTime();
                    const eighteenMonthsAgo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
                    const sixMonthsAhead = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
                    if (!isNaN(parsedMs) && parsedMs >= eighteenMonthsAgo && parsedMs <= sixMonthsAhead) {
                        setFileDate(data.parsed.date);
                    } else {
                        console.warn(`[FileUpload-M] AI date "${data.parsed.date}" out of range, keeping form date`);
                    }
                }
            } else {
                setParsePreviewError("Parsing automatique non disponible pour ce fichier — vérifiez les champs manuellement.");
            }
        } catch {
            setParsePreviewError("Erreur lors du parsing automatique.");
        } finally {
            setParsePreviewLoading(false);
        }
    };

    const handleUpload = async () => {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
            toast({ title: "Aucun fichier sélectionné", variant: "destructive" });
            return;
        }
        setUploading(true);
        try {
            const extra: Record<string, string> = { category, fileType };
            if (supplier) extra.supplier = supplier;
            if (amount) extra.amount = amount;
            if (description) extra.description = description;
            extra.fileDate = fileDate;
            if (parsePreviewData?.parsed) {
                extra.parsedJson = JSON.stringify(parsePreviewData.parsed);
            }

            const res = await uploadFileAsBase64("/api/v2/sugumaillane-management/files", file, extra);
            const data = await res.json();
            if (!res.ok) {
                toast({ title: "Erreur", description: data.error, variant: "destructive" });
            } else {
                const catLabel = FILE_CATEGORIES.find(c => c.value === category)?.label;
                if (data.autoCreateError) {
                    toast({ title: "Fichier transféré (frais non créé)", description: `${file.name} → ${catLabel}. Erreur: ${data.autoCreateError}`, variant: "destructive" });
                } else if (data.linkedExpenseId) {
                    toast({ title: "Fichier transféré + frais créé", description: `${file.name} → ${catLabel} (frais #${data.linkedExpenseId})` });
                } else if (data.multiInvoice && data.invoiceCount > 1) {
                    toast({ title: `${data.invoiceCount} factures détectées et créées`, description: `${file.name} → ${catLabel} (achats #${data.linkedPurchaseIds?.join(", #")})` });
                } else if (data.linkedPurchaseId) {
                    toast({ title: "Fichier transféré + achat créé", description: `${file.name} → ${catLabel} (achat #${data.linkedPurchaseId})` });
                } else if (data.autoDetected && data.employeeCreated) {
                    toast({ title: "Bulletin importé + employé créé", description: `${file.name} → Employé et fiche de paie créés automatiquement` });
                } else if (data.autoDetected) {
                    toast({ title: "Bulletin importé + paie ajoutée", description: `${file.name} → Fiche de paie ajoutée à l'employé existant` });
                } else {
                    toast({ title: "Fichier transféré", description: `${file.name} → ${catLabel}` });
                }
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/expenses"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/purchases"] });
                if (data.autoDetected) {
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
                }
                onClose();
                setSupplier(""); setAmount(""); setDescription(""); setFileType("file");
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        } catch {
            toast({ title: "Erreur", description: "Impossible de transférer le fichier", variant: "destructive" });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className={`${dk ? "bg-slate-900" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl w-full max-w-lg`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} flex items-center gap-2`}>
                        <Upload className="w-5 h-5 text-emerald-400" />
                        Transférer un Fichier
                    </h3>
                    <button onClick={onClose} className={`p-1 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`} title="Fermer"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">
                    {/* File Type Choice */}
                    <div>
                        <label className={`block text-sm ${dk ? "text-white/60" : "text-slate-600"} mb-2`}>Type de transfert</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => setFileType("photo")}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition ${fileType === "photo" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"} ${dk ? "text-white/50" : "text-slate-500"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}`}>
                                <Image className="w-5 h-5" /> Photo
                            </button>
                            <button onClick={() => setFileType("file")}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition ${fileType === "file" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"} ${dk ? "text-white/50" : "text-slate-500"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}`}>
                                <FileText className="w-5 h-5" /> Fichier
                            </button>
                        </div>
                    </div>

                    {/* Category */}
                    <Field label="Catégorie">
                        <select aria-label="Catégorie" className={ic} value={category} onChange={e => setCategory(e.target.value)}>
                            {FILE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                    </Field>

                    {/* File Input */}
                    <Field label={fileType === "photo" ? "Sélectionner une photo" : "Sélectionner un fichier"}>
                        <input ref={fileInputRef} type="file"
                            aria-label={fileType === "photo" ? "Sélectionner une photo" : "Sélectionner un fichier"}
                            accept={fileType === "photo" ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"}
                            className={ic + " file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-emerald-500/20 file:text-emerald-400"}
                            onChange={e => { const f = e.target.files?.[0]; if (f) triggerParsePreview(f); }} />
                    </Field>

                    {/* ── Parse Preview Panel ── */}
                    {parsePreviewLoading && (
                        <div className={`flex items-center gap-2 p-3 rounded-xl border ${dk ? "border-blue-500/30 bg-blue-500/10" : "border-blue-200 bg-blue-50"}`}>
                            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                            <span className={`text-sm ${dk ? "text-blue-300" : "text-blue-700"}`}>Analyse IA en cours...</span>
                        </div>
                    )}
                    {parsePreviewError && (
                        <div className={`p-3 rounded-xl border text-sm ${dk ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                            ⚠️ {parsePreviewError}
                        </div>
                    )}
                    {parsePreviewData && !parsePreviewLoading && (() => {
                        const { parsed, confidence, matchedSupplier } = parsePreviewData;
                        const confColor = confidence >= 80 ? "emerald" : confidence >= 60 ? "amber" : "red";
                        const confLabel = confidence >= 80 ? "Haute confiance" : confidence >= 60 ? "Confiance moyenne" : "Vérifiez les données";
                        return (
                            <div className={`rounded-xl border ${dk ? "border-emerald-500/20 bg-emerald-500/5" : "border-emerald-200 bg-emerald-50"} p-3 space-y-2`} data-testid="parse-preview-panel">
                                <div className="flex items-center justify-between">
                                    <span className={`text-xs font-semibold ${dk ? "text-white/60" : "text-slate-500"}`}>Résultat de l'analyse IA</span>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${confColor === "emerald" ? "bg-emerald-500/20 text-emerald-400" : confColor === "amber" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                                        {confidence}% — {confLabel}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    {parsed.supplier && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">Fournisseur:</span> <strong>{parsed.supplier}</strong></div>}
                                    {parsed.amount && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">Montant:</span> <strong>{parsed.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong></div>}
                                    {parsed.date && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">Date:</span> <strong>{parsed.date}</strong></div>}
                                    {parsed.invoiceNumber && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">N° facture:</span> <strong>{parsed.invoiceNumber}</strong></div>}
                                    {parsed.taxAmount && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">TVA:</span> <strong>{parsed.taxAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong></div>}
                                </div>
                                {matchedSupplier && (
                                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${dk ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700"}`}>
                                        🔗 <span>Fournisseur lié : <strong>{matchedSupplier.name}</strong></span>
                                    </div>
                                )}
                                {!matchedSupplier && parsed.supplier && (
                                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${dk ? "bg-slate-700/60 text-white/50" : "bg-slate-100 text-slate-500"}`}>
                                        ➕ Nouveau fournisseur détecté — sera créé automatiquement si besoin
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Supplier */}
                    <Field label="Fournisseur / Expéditeur (optionnel)">
                        <input className={ic} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Ex: Métro, SCP Seguin, Elly..." data-testid="input-upload-supplier" />
                    </Field>

                    {/* Amount */}
                    {(category === "achats" || category === "frais_generaux") && (
                        <Field label="Montant TTC (€) — extrait du PDF sinon renseignez-le">
                            <input type="number" step="0.01" className={ic} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ex: 484.38" data-testid="input-upload-amount" />
                        </Field>
                    )}

                    {/* Description */}
                    <Field label="Description (optionnel)">
                        <input className={ic} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Facture décembre 2024" />
                    </Field>

                    {/* Date */}
                    <Field label="Date du document">
                        <input aria-label="Date du document" type="date" className={ic} value={fileDate} onChange={e => setFileDate(e.target.value)} />
                    </Field>

                    <button onClick={handleUpload} className={btnPrimary + " w-full justify-center"} disabled={uploading}>
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? "Transfert en cours..." : "Transférer"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ====== ARCHIVES TAB ======
function ArchivesTab() {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [filterCat, setFilterCat] = useState<string>("");
    const [searchTerm, setSearchTerm] = useState("");

    const { data: files = [], isLoading } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugumaillane-management/files", filterCat],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filterCat) params.set("category", filterCat);
            const res = await fetch(`/api/v2/sugumaillane-management/files?${params}`, { credentials: "include" });
            return res.json();
        }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/trash"] });
            toast({ title: "Fichier déplacé dans la corbeille", description: "Vous avez 7 jours pour le restaurer." });
        },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le fichier", variant: "destructive" }); }
    });

    const { data: trashItems = [], isLoading: trashLoading } = useQuery<SugumTrashItem[]>({
        queryKey: ["/api/v2/sugumaillane-management/trash"],
        queryFn: async () => {
            const res = await fetch("/api/v2/sugumaillane-management/trash", { credentials: "include" });
            if (!res.ok) throw new Error("Erreur chargement corbeille");
            return res.json();
        },
        refetchInterval: 30000,
    });

    const restoreTrashMut = useMutation({
        mutationFn: (id: number) => apiRequest("POST", `/api/v2/sugumaillane-management/trash/${id}/restore`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/trash"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            toast({ title: "Fichier restauré", description: "Le fichier a été remis dans les archives." });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de restaurer le fichier", variant: "destructive" })
    });

    const deleteTrashMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/trash/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/trash"] });
            toast({ title: "Suppression définitive effectuée" });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de supprimer définitivement", variant: "destructive" })
    });

    const filteredFiles = searchTerm
        ? files.filter(f =>
            f.originalName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (f.supplier || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
            (f.description || "").toLowerCase().includes(searchTerm.toLowerCase())
        )
        : files;

    const catLabel = (cat: string) => FILE_CATEGORIES.find(c => c.value === cat)?.label || cat;

    const totalFiles = files.length;
    const totalSize = files.reduce((s, f) => s + f.fileSize, 0);
    const byCat = FILE_CATEGORIES.map(c => ({
        ...c,
        count: files.filter(f => f.category === c.value).length
    }));

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total fichiers" value={String(totalFiles)} icon={Archive} color="blue" />
                <StatCard label="Taille totale" value={fmtSize(totalSize)} icon={FolderOpen} color="purple" />
                {byCat.filter(c => c.count > 0).slice(0, 2).map(c => (
                    <StatCard key={c.value} label={c.label} value={String(c.count)} icon={FileText} color="orange" />
                ))}
            </div>

            {/* Filters */}
            <Card title="Archives" icon={Archive}
                action={
                    <div className="flex gap-2 items-center">
                        <div className="relative">
                            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${dk ? "text-white/30" : "text-slate-300"}`} />
                            <input className={ic + " pl-9 w-48"} placeholder="Rechercher..."
                                value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                        </div>
                        <select aria-label="Filtrer par catégorie" className={ic + " w-40"} value={filterCat} onChange={e => { setFilterCat(e.target.value); }}>
                            <option value="">Toutes catégories</option>
                            {FILE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                    </div>
                }>
                {isLoading ? (
                    <div className={`flex items-center justify-center py-12 ${dk ? "text-white/40" : "text-slate-400"}`}>
                        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Chargement...
                    </div>
                ) : filteredFiles.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun fichier archivé</p>
                ) : (
                    <div className="space-y-2">
                        {filteredFiles.map(f => (
                            <div key={f.id} className={`flex items-center gap-4 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3 ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition`}>
                                {/* Icon */}
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                    {isFileMimeImage(f.mimeType) ? <Image className="w-5 h-5 text-purple-400" /> : <FileText className="w-5 h-5 text-blue-400" />}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`} title={f.originalName}>{f.originalName}</p>
                                    <div className={`flex items-center gap-3 text-xs ${dk ? "text-white/40" : "text-slate-400"} mt-0.5`}>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.category === "achats" ? "bg-teal-500/20 text-teal-400" : f.category === "banque" ? "bg-blue-500/20 text-blue-400" : f.category === "rh" ? "bg-emerald-500/20 text-emerald-400" : "bg-purple-500/20 text-purple-400"}`}>
                                            {catLabel(f.category)}
                                        </span>
                                        {f.supplier && <span>📦 {f.supplier}</span>}
                                        {f.fileDate && <span>📅 {fmtDate(f.fileDate)}</span>}
                                        <span>{fmtSize(f.fileSize)}</span>
                                    </div>
                                    {f.description && <p className={`text-xs ${dk ? "text-white/30" : "text-slate-300"} mt-1 truncate`}>{f.description}</p>}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1 flex-shrink-0">
                                    <a href={`/api/v2/sugumaillane-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                        className={btnPrimary + " !px-2 !py-1.5"} title="Télécharger">
                                        <Download className="w-3.5 h-3.5" />
                                    </a>
                                    <button onClick={() => { if (confirm(`Mettre "${f.originalName}" dans la corbeille ?\n\nVous aurez 7 jours pour le restaurer.`)) deleteMut.mutate(f.id); }} className={btnDanger} title="Déplacer dans la corbeille" data-testid={`button-delete-archive-${f.id}`}>
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* ===== CORBEILLE CARD ===== */}
            <Card
                title={`Corbeille${trashItems.length > 0 ? ` (${trashItems.length})` : ""}`}
                icon={Trash2}
                action={
                    trashItems.length > 0 ? (
                        <span className={`text-xs px-2 py-1 rounded-full ${dk ? "bg-red-500/20 text-red-400" : "bg-red-50 text-red-500"}`}>
                            Suppression auto dans 7 j
                        </span>
                    ) : undefined
                }>
                {trashLoading ? (
                    <div className={`flex items-center justify-center py-8 ${dk ? "text-white/40" : "text-slate-400"}`}>
                        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement...
                    </div>
                ) : trashItems.length === 0 ? (
                    <div className={`text-center py-8 ${dk ? "text-white/30" : "text-slate-400"}`}>
                        <Trash2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">La corbeille est vide</p>
                        <p className="text-xs mt-1">Les fichiers supprimés apparaissent ici pendant 7 jours</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {trashItems.map(item => {
                            const daysLeft = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86400000));
                            const isExpiringSoon = daysLeft <= 2;
                            return (
                                <div key={item.id} data-testid={`trash-item-${item.id}`} className={`flex items-center gap-3 p-3 rounded-xl border transition ${dk ? "bg-white/5 border-white/10" : "bg-white border-slate-200"}`}>
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${dk ? "bg-red-500/10" : "bg-red-50"}`}>
                                        {isExpiringSoon ? <AlertTriangle className="w-5 h-5 text-red-400" /> : <FileText className="w-5 h-5 text-red-300" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-medium truncate ${dk ? "text-white/70" : "text-slate-600"}`}>{item.originalName}</p>
                                        <div className={`flex flex-wrap items-center gap-3 text-xs mt-0.5 ${dk ? "text-white/40" : "text-slate-400"}`}>
                                            <span className={`px-2 py-0.5 rounded-full text-xs ${item.category === "achats" ? "bg-orange-500/20 text-orange-400" : "bg-purple-500/20 text-purple-400"}`}>
                                                {FILE_CATEGORIES.find(c => c.value === item.category)?.label || item.category}
                                            </span>
                                            {item.supplier && <span>📦 {item.supplier}</span>}
                                            <span>{fmtSize(item.fileSize)}</span>
                                            <span className={`font-medium ${isExpiringSoon ? "text-red-400" : dk ? "text-white/50" : "text-slate-500"}`}>
                                                {daysLeft === 0 ? "Expire aujourd'hui" : `${daysLeft}j restant${daysLeft > 1 ? "s" : ""}`}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 flex-shrink-0">
                                        <button
                                            data-testid={`button-restore-trash-${item.id}`}
                                            onClick={() => restoreTrashMut.mutate(item.id)}
                                            disabled={restoreTrashMut.isPending}
                                            className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}
                                            title="Restaurer le fichier">
                                            <RotateCcw className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            data-testid={`button-delete-trash-${item.id}`}
                                            onClick={() => { if (confirm(`Supprimer définitivement "${item.originalName}" ?\n\nCette action est irréversible.`)) deleteTrashMut.mutate(item.id); }}
                                            disabled={deleteTrashMut.isPending}
                                            className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-500 hover:bg-red-100"}`}
                                            title="Supprimer définitivement">
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </div>
    );
}
