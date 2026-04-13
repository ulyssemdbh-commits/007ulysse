import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, Landmark, CreditCard, Users, BarChart3, Plus, Check, TrendingUp, UserCheck, AlertTriangle, Building2, Loader2, Download, Activity, Gauge, ExternalLink, Utensils, Banknote, ShieldAlert, Minimize2, Maximize2 } from "lucide-react";
import { useSuguDark } from "./context";
import { AuditOverview, AnomaliesResponse, Employee, CashEntry, fmt, fmtEur, fmtDateShort } from "./types";
import { StatCard, CardSizeToggle, PeriodFilter, usePeriodFilter } from "./shared";

export function DashboardTab({ onNavigate, onOpenUpload, onOpenNewCaisse, restricted, compactCards, setCompactCards }: { onNavigate: (tab: string) => void; onOpenUpload: () => void; onOpenNewCaisse: () => void; restricted?: boolean; compactCards: boolean; setCompactCards: (v: boolean) => void }) {
    const dk = useSuguDark();
    const pf = usePeriodFilter("year");
    const year = pf.period.year;

    const { data: audit, isLoading: auditLoading } = useQuery<AuditOverview | null>({
        queryKey: ["/api/v2/sugu-management/audit/overview", year],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugu-management/audit/overview?year=${year}`, { credentials: "include" });
            if (!res.ok) return null;
            return res.json();
        },
    });

    const { data: ratiosData } = useQuery<{
        year: string;
        annual: any;
        monthly: any[];
    }>({
        queryKey: ["/api/v2/sugu-management/analytics/ratios", year],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugu-management/analytics/ratios?year=${year}`, { credentials: "include" });
            if (!res.ok) return null;
            return res.json();
        },
    });

    const { data: anomaliesData, isLoading: anomLoading } = useQuery<AnomaliesResponse | null>({
        queryKey: ["/api/v2/sugu-management/anomalies"],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugu-management/anomalies?days=30`, { credentials: "include" });
            if (!res.ok) return null;
            return res.json();
        },
    });

    const { data: employees = [] } = useQuery<Employee[]>({
        queryKey: ["/api/v2/sugu-management/employees"],
    });

    const { data: cashEntries = [] } = useQuery<CashEntry[]>({
        queryKey: ["/api/v2/sugu-management/cash"],
    });

    const loading = auditLoading || anomLoading;
    const activeEmps = employees.filter(e => e.isActive);
    const anomalies = anomaliesData?.anomalies || [];
    const highSeverity = anomalies.filter(a => a.severity === "haute").length;
    const medSeverity = anomalies.filter(a => a.severity === "moyenne").length;

    const filteredCashEntries = cashEntries.filter(e => e.entryDate >= pf.period.from && e.entryDate <= pf.period.to);

    const periodCA = filteredCashEntries.reduce((s, e) => s + (e.totalRevenue || 0), 0);

    // Last 7 cash entries for mini sparkline
    const last7Cash = [...filteredCashEntries].sort((a, b) => b.entryDate.localeCompare(a.entryDate)).slice(0, 7).reverse();
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

    // Trend computations from cashEntries
    const now = new Date();
    const curM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevMDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevM = `${prevMDate.getFullYear()}-${String(prevMDate.getMonth() + 1).padStart(2, "0")}`;
    const curMCA = filteredCashEntries.filter(e => e.entryDate.startsWith(curM)).reduce((s, e) => s + e.totalRevenue, 0);
    const prevMCA = filteredCashEntries.filter(e => e.entryDate.startsWith(prevM)).reduce((s, e) => s + e.totalRevenue, 0);
    const caTrend = prevMCA > 0 ? { pct: ((curMCA - prevMCA) / prevMCA * 100).toFixed(1), favorable: curMCA >= prevMCA, dir: curMCA >= prevMCA ? "up" : "down" } : null;
    const currentMonthRatios: { foodCostPct: string; overheadPct: string } | null = null;
    const foodCostTrend = null;
    const overheadTrend = null;

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
            <div className={`bg-gradient-to-r from-orange-500/10 via-red-500/5 to-slate-900/50 border border-orange-500/20 rounded-2xl transition-all ${compactCards ? "p-2 sm:p-3" : "p-4 sm:p-6"}`}>
                <div className="flex flex-row items-center gap-2 sm:gap-4 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div className="min-w-0">
                            <h2 className={`font-bold text-[#525050] leading-tight truncate transition-all ${compactCards ? "text-sm sm:text-base" : "text-lg sm:text-2xl"}`}>SUGU Valentine Synthèse</h2>
                            {!compactCards && (
                                <p className={`text-xs sm:text-sm ${dk ? "text-white/50" : "text-slate-500"}`}>Vue d'ensemble {pf.period.label} • Mise à jour en temps réel</p>
                            )}
                        </div>
                    </div>
                    {!restricted && (
                        <div className={`flex flex-wrap gap-1.5 ml-auto flex-shrink-0 transition-all ${compactCards ? "gap-1" : "gap-2"}`}>
                            <a href="/courses/suguval" className={`flex items-center gap-1 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg text-xs ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition ${compactCards ? "px-2 py-1" : "px-2.5 sm:px-3 py-1.5 sm:py-2"}`}>
                                <ShoppingCart className={`flex-shrink-0 ${compactCards ? "w-3 h-3" : "w-3.5 h-3.5 sm:w-4 sm:h-4"}`} />
                                {!compactCards && <span>Courses du jour</span>}
                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            </a>
                            <a href="/finances" className={`flex items-center gap-1 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg text-xs ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition ${compactCards ? "px-2 py-1" : "px-2.5 sm:px-3 py-1.5 sm:py-2"}`}>
                                <Banknote className={`flex-shrink-0 ${compactCards ? "w-3 h-3" : "w-3.5 h-3.5 sm:w-4 sm:h-4"}`} />
                                {!compactCards && <span>Finances & Trading</span>}
                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            </a>
                            <a href="/sports/predictions" className={`flex items-center gap-1 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg text-xs ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition ${compactCards ? "px-2 py-1" : "px-2.5 sm:px-3 py-1.5 sm:py-2"}`}>
                                <Activity className={`flex-shrink-0 ${compactCards ? "w-3 h-3" : "w-3.5 h-3.5 sm:w-4 sm:h-4"}`} />
                                {!compactCards && <span>Djedou Pronos</span>}
                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            </a>
                        </div>
                    )}
                </div>
            </div>
            <PeriodFilter periodKey={pf.periodKey} setPeriod={pf.setPeriod} customFrom={pf.customFrom} setCustomFrom={pf.setCustomFrom} customTo={pf.customTo} setCustomTo={pf.setCustomTo} />
            {/* KPI Row */}
            <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${dk ? "text-white/40" : "text-slate-400"}`}>Indicateurs clés</span>
                <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
            </div>
            <div className={`grid ${compactCards ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"} gap-2 sm:gap-3`}>
                {/* Health Score */}
                {compactCards ? (
                    <div className={`bg-gradient-to-br ${healthBg} border rounded-lg px-3 py-2 flex items-center gap-2 cursor-pointer hover:opacity-90 transition`} onClick={() => onNavigate("audit")}>
                        <Gauge className={`w-4 h-4 flex-shrink-0 ${dk ? "text-white/60" : "text-slate-600"}`} />
                        <div className="flex flex-col min-w-0">
                            <p className={`text-sm font-bold ${healthColor} truncate`}>{healthScore}</p>
                            <p className={`text-[9px] ${dk ? "text-white/50" : "text-slate-500"} truncate`}>Score Santé</p>
                        </div>
                        <span className={`text-[9px] font-bold ${healthColor} ml-auto flex-shrink-0`}>
                            {healthScore >= 70 ? "BON" : healthScore >= 40 ? "MOYEN" : "ALERTE"}
                        </span>
                    </div>
                ) : (
                    <div className={`bg-gradient-to-br ${healthBg} border rounded-lg px-3 py-2 cursor-pointer hover:opacity-90 transition`} onClick={() => onNavigate("audit")}>
                        <div className="flex items-center gap-2">
                            <Gauge className={`w-4 h-4 flex-shrink-0 ${dk ? "text-white/60" : "text-slate-600"}`} />
                            <p className={`text-sm font-bold ${healthColor} flex-1 truncate`}>{healthScore}</p>
                            <span className={`text-[10px] font-bold ${healthColor} flex-shrink-0`}>
                                {healthScore >= 70 ? "BON" : healthScore >= 40 ? "MOYEN" : "ALERTE"}
                            </span>
                        </div>
                        <p className={`text-[10px] ${dk ? "text-white/50" : "text-slate-500"} mt-0.5 truncate`}>Score Santé</p>
                    </div>
                )}

                <StatCard label={`CA ${pf.period.label}`} value={fmtEur(periodCA)} icon={TrendingUp} color="green" trendData={caTrend} compact={compactCards} />
                <StatCard label="Marge opérat." value={audit ? `${audit.profitMargin}%` : "-"} icon={BarChart3}
                    color={audit && parseFloat(audit.profitMargin) > 0 ? "green" : "red"}
                    trendData={audit && parseFloat(audit.profitMargin) > 0 ? { pct: audit.profitMargin, favorable: true, dir: "up" } : null}
                    warning={audit && audit.totalRevenue > 0 && audit.totalCosts < audit.totalRevenue * 0.1 ? "Données de coûts incomplètes — achats/frais/salaires à saisir" : undefined}
                    compact={compactCards} />
                <StatCard label="Food Cost %" value={currentMonthRatios ? `${currentMonthRatios.foodCostPct}%` : "-"} icon={Utensils} color="orange" trendData={foodCostTrend} compact={compactCards} />
                <StatCard label="Overhead %" value={currentMonthRatios ? `${currentMonthRatios.overheadPct}%` : "-"} icon={Building2} color="blue" trendData={overheadTrend} compact={compactCards} />
                <StatCard label="Employés actifs" value={String(activeEmps.length)} icon={UserCheck} color="purple"
                    warning={activeEmps.length === 0 ? "Aucun employé créé dans le module RH" : undefined}
                    compact={compactCards} />
            </div>
            {/* Quick Actions Panel */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                <button onClick={onOpenUpload} className={`flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border ${dk ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-slate-200 hover:bg-slate-50"} transition shadow-sm`} data-testid="action-add-purchase">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-orange-500/20 flex items-center justify-center text-orange-500 flex-shrink-0"><Plus className="w-4 h-4 sm:w-5 sm:h-5" /></div>
                    <div className="text-left min-w-0">
                        <p className={`text-xs sm:text-sm font-semibold ${dk ? "text-white" : "text-slate-800"} truncate`}>Ajout Achat / Frais</p>
                        <p className={`text-[9px] sm:text-[10px] ${dk ? "text-white/40" : "text-slate-500"} truncate`}>Documents & archives</p>
                    </div>
                </button>
                <button onClick={onOpenNewCaisse} className={`flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border ${dk ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-slate-200 hover:bg-slate-50"} transition shadow-sm`} data-testid="action-add-caisse">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/20 flex items-center justify-center text-green-500 flex-shrink-0"><CreditCard className="w-4 h-4 sm:w-5 sm:h-5" /></div>
                    <div className="text-left min-w-0">
                        <p className={`text-xs sm:text-sm font-semibold ${dk ? "text-white" : "text-slate-800"} truncate`}>Saisir caisse</p>
                        <p className={`text-[9px] sm:text-[10px] ${dk ? "text-white/40" : "text-slate-500"} truncate`}>CA quotidien</p>
                    </div>
                </button>
                <button onClick={() => onNavigate("banque")} className={`flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border ${dk ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-slate-200 hover:bg-slate-50"} transition shadow-sm`} data-testid="action-import-bank">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-500 flex-shrink-0"><Download className="w-4 h-4 sm:w-5 sm:h-5" /></div>
                    <div className="text-left min-w-0">
                        <p className={`text-xs sm:text-sm font-semibold ${dk ? "text-white" : "text-slate-800"} truncate`}>Importer relevé</p>
                        <p className={`text-[9px] sm:text-[10px] ${dk ? "text-white/40" : "text-slate-500"} truncate`}>Banque / PDF / CSV</p>
                    </div>
                </button>
                <button onClick={() => onNavigate("audit")} className={`flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border ${dk ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-white border-slate-200 hover:bg-slate-50"} transition shadow-sm`} data-testid="action-view-audit">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-500 flex-shrink-0"><BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" /></div>
                    <div className="text-left min-w-0">
                        <p className={`text-xs sm:text-sm font-semibold ${dk ? "text-white" : "text-slate-800"} truncate`}>Rapport complet</p>
                        <p className={`text-[9px] sm:text-[10px] ${dk ? "text-white/40" : "text-slate-500"} truncate`}>Audits & P&L</p>
                    </div>
                </button>
            </div>
            {/* Second row: financial state + alerts */}
            <div className="space-y-4">
                {/* Financial Snapshot */}
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-3 sm:p-5 overflow-hidden`}>
                    <div className="flex items-center gap-2 mb-3 sm:mb-4 min-w-0">
                        <Landmark className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400 flex-shrink-0" />
                        <h3 className={`font-semibold text-sm sm:text-base ${dk ? "text-white" : "text-slate-800"} truncate`}>Synthèse Financière</h3>
                        <button onClick={() => onNavigate("audit")} className="ml-auto text-xs text-orange-400 hover:underline flex items-center gap-1">
                            Voir audit complet <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                    {audit ? (
                        <div className="space-y-4">
                            {/* Cost breakdown bar */}
                            <div className="space-y-2">
                                {(() => {
                                    const allCosts = (audit.costBreakdown.achats || 0) + (audit.costBreakdown.fraisGeneraux || 0) + (audit.costBreakdown.salaires || 0) + (audit.costBreakdown.chargesSociales || 0) + (audit.costBreakdown.emprunts || 0);
                                    const denominator = audit.totalRevenue > 0 ? audit.totalRevenue : allCosts;
                                    const pctLabel = audit.totalRevenue > 0 ? "% CA" : "% coûts";
                                    return [
                                        { label: "Achats", value: audit.costBreakdown.achats, color: "bg-orange-500" },
                                        { label: "Frais Généraux", value: audit.costBreakdown.fraisGeneraux, color: "bg-blue-500" },
                                        { label: "Salaires", value: audit.costBreakdown.salaires, color: "bg-purple-500" },
                                        { label: "Charges Sociales", value: audit.costBreakdown.chargesSociales, color: "bg-pink-500" },
                                        { label: "Emprunts", value: audit.costBreakdown.emprunts, color: "bg-red-500" },
                                    ].map(item => {
                                        const pct = denominator > 0 ? (item.value / denominator) * 100 : 0;
                                        return (
                                            <div key={item.label} className="flex items-center gap-2 min-w-0">
                                                <span className={`text-xs ${dk ? "text-white/50" : "text-slate-500"} w-24 sm:w-28 flex-shrink-0 truncate`}>{item.label}</span>
                                                <div className={`flex-1 min-w-0 ${dk ? "bg-white/5" : "bg-slate-100"} rounded-full h-2`}>
                                                    <div className={`${item.color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(100, pct).toFixed(1)}%` }} />
                                                </div>
                                                <span className={`text-xs ${dk ? "text-white/70" : "text-slate-700"} w-20 sm:w-24 text-right flex-shrink-0 tabular-nums`}>{fmtEur(item.value)}</span>
                                                <span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} w-12 text-right flex-shrink-0 tabular-nums`} title={pctLabel}>{pct.toFixed(1)}%</span>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                            {/* Key metrics row */}
                            <div className={`grid grid-cols-3 gap-3 pt-2 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                                <div>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Impayés fourn.</p>
                                    <p className="font-bold text-slate-800 text-[14px]">
                                        {fmtEur(audit.unpaidPurchases)}
                                    </p>
                                </div>
                                <div>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Impayés frais</p>
                                    <p className="font-bold text-slate-800 text-[14px]">
                                        {fmtEur(audit.unpaidExpenses)}
                                    </p>
                                </div>
                                <div>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Capital emprunts</p>
                                    <p className="font-bold text-slate-800 text-[14px]">{fmtEur(audit.totalRemainingLoans)}</p>
                                </div>
                            </div>
                            {/* Top Suppliers */}
                            {audit.topSuppliers && audit.topSuppliers.length > 0 && (
                                <div className={`pt-3 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} mb-2`}>Top 5 Fournisseurs (Année)</p>
                                    <div className="space-y-1.5">
                                        {audit.topSuppliers.slice(0, 5).map((s, i) => (
                                            <div key={i} className="flex items-center justify-between text-xs">
                                                <span className={`${dk ? "text-white/70" : "text-slate-700"} truncate max-w-[150px]`}>{s.name}</span>
                                                <span className={`font-mono ${dk ? "text-white/50" : "text-slate-500"}`}>{fmtEur(s.total)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Mini revenue chart for last 7 days caisse */}
                            {last7Cash.length > 0 && (
                                <div className={`pt-3 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} mb-2`}>CA 7 derniers jours (caisse)</p>
                                    <div className="flex items-end gap-1 h-16">
                                        {last7Cash.map((c, i) => (
                                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                                <div className="w-full bg-gradient-to-t from-orange-500 to-orange-400 rounded-t min-h-[4px]" style={{ height: `${Math.round(c.totalRevenue / maxCash * 100)}%` }} />
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
            {/* Monthly revenue trend */}
            {audit?.monthlyRevenue && Object.keys(audit.monthlyRevenue).length > 0 && (
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-5 h-5 text-orange-400" />
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Évolution CA Mensuel {year}</h3>
                        <button onClick={() => onNavigate("audit")} className="ml-auto text-xs text-orange-400 hover:underline flex items-center gap-1">Détails <ExternalLink className="w-3 h-3" /></button>
                    </div>
                    <div className="flex items-end gap-2 h-24">
                        {Object.entries(audit.monthlyRevenue).sort().map(([month, revenue]) => {
                            const maxMonthRev = Math.max(...Object.values(audit.monthlyRevenue), 1);
                            const pct = (revenue / maxMonthRev) * 100;
                            return (
                                <div key={month} className="flex-1 flex flex-col items-center gap-1">
                                    <span className={`text-[9px] ${dk ? "text-white/50" : "text-slate-500"} font-mono`}>{fmt(revenue)}</span>
                                    <div className="w-full bg-gradient-to-t from-orange-500 to-red-500 rounded-t min-h-[4px]" style={{ height: `${Math.max(5, pct)}%` }} />
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
                        <Users className="w-5 h-5 text-orange-400" />
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Équipe Active</h3>
                        <button onClick={() => onNavigate("rh")} className="ml-auto text-xs text-orange-400 hover:underline flex items-center gap-1">
                            Gérer RH <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                        {activeEmps.slice(0, 10).map(emp => (
                            <div key={emp.id} className={`flex items-center gap-3 ${dk ? "bg-white/5" : "bg-white"} rounded-lg p-3`}>
                                <div className={`w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-xs font-bold ${dk ? "text-white" : "text-slate-800"}`}>
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

