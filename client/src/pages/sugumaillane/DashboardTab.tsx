import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CashEntry, Employee, AuditOverview, AnomaliesResponse } from "../sugu/types";
import { fmt, fmtEur, t, fmtDateShort } from "../sugu/helpers";
import { useSuguDark, StatCard, CardSizeToggle } from "./shared";
import {
  ExternalLink,
  Loader2,
  Key,
  BarChart3,
  CreditCard,
  Gauge,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Check,
  UserCheck,
  Utensils,
  ShieldAlert,
  Receipt,
  Landmark,
  Users,
  Archive,
  ShoppingCart,
} from "lucide-react";

export function DashboardTab({ onNavigate, restricted, compactCards, setCompactCards }: { onNavigate: (tab: string) => void; restricted?: boolean; compactCards: boolean; setCompactCards: (v: boolean) => void }) {
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

