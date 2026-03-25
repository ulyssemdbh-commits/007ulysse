import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Receipt, Landmark, CreditCard, Users, BarChart3, TrendingUp, Calendar, DollarSign, Clock, AlertTriangle, FileText, Loader2, Download, Activity, Utensils, Banknote, RefreshCw, Eye, Mail, Paperclip, X } from "lucide-react";
import { useSuguDark } from "./context";
import { Loan, SuguFile, fmtEur, fmtEurSigned } from "./types";
import { Card, StatCard, FormSelect, PeriodFilter, usePeriodFilter } from "./shared";
import { FilePreviewModal, SendEmailModal, CategoryFiles, fmtSize, isFilePreviewable } from "./fileModals";
import { ExpertReport } from "./ExpertReport";

export function ComptabiliteTab() {
    const dk = useSuguDark();
    const pf = usePeriodFilter("month");
    const year = pf.period.year;
    const isRange = pf.periodKey === "all" || pf.periodKey === "quarter" || pf.periodKey === "last_month" || pf.periodKey === "month" || pf.periodKey === "custom";
    const qs = isRange ? `from=${pf.period.from}&to=${pf.period.to}` : `year=${year}`;
    const [view, setView] = useState<"tva" | "pl" | "ratios" | "treso">("tva");

    const { data: tvaData, isLoading: tvaLoading } = useQuery({
        queryKey: [`/api/v2/sugu-management/analytics/tva?${qs}`],
        enabled: view === "tva"
    });

    const { data: plData, isLoading: plLoading } = useQuery({
        queryKey: [`/api/v2/sugu-management/analytics/bilan-mensuel?${qs}`],
        enabled: view === "pl"
    });

    const { data: ratiosData, isLoading: ratiosLoading } = useQuery({
        queryKey: [`/api/v2/sugu-management/analytics/ratios?${qs}`],
        enabled: view === "ratios"
    });

    const { data: tresoData, isLoading: tresoLoading } = useQuery({
        queryKey: [`/api/v2/sugu-management/analytics/tresorerie?${qs}`],
        enabled: view === "treso"
    });

    const handleExport = () => {
        window.location.href = `/api/v2/sugu-management/analytics/export-comptable?year=${year}`;
    };

    const subTabBtn = (id: typeof view, label: string) => (
        <button
            onClick={() => setView(id)}
            data-testid={`btn-compta-view-${id}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === id
                ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                : dk ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
        >
            {label}
        </button>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                    {subTabBtn("tva", "TVA")}
                    {subTabBtn("pl", "P&L")}
                    {subTabBtn("ratios", "Ratios")}
                    {subTabBtn("treso", "Trésorerie")}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold hover:opacity-90 transition shadow-lg shadow-emerald-500/20"
                        data-testid="btn-compta-export"
                    >
                        <Download className="w-4 h-4" />
                        Exporter CSV
                    </button>
                </div>
            </div>
            <PeriodFilter periodKey={pf.periodKey} setPeriod={pf.setPeriod} customFrom={pf.customFrom} setCustomFrom={pf.setCustomFrom} customTo={pf.customTo} setCustomTo={pf.setCustomTo} />

            {view === "tva" && <TVAView data={tvaData} loading={tvaLoading} year={year} periodLabel={pf.period.label} isAll={pf.periodKey !== "year"} />}
            {view === "pl" && <PLView data={plData} loading={plLoading} year={year} periodLabel={pf.period.label} isAll={pf.periodKey !== "year"} />}
            {view === "ratios" && <RatiosView data={ratiosData} loading={ratiosLoading} year={year} periodLabel={pf.period.label} isAll={pf.periodKey !== "year"} />}
            {view === "treso" && <TresoView data={tresoData} loading={tresoLoading} year={year} periodLabel={pf.period.label} isAll={pf.periodKey !== "year"} />}

            <ExpertReport defaultYear={year} defaultTab="comptabilite" />
        </div>
    );
}

function TVAView({ data, loading, year, periodLabel, isAll }: { data: any; loading: boolean; year: string; periodLabel: string; isAll: boolean }) {
    const dk = useSuguDark();
    if (loading) return <LoaderState />;
    if (!data) return <EmptyState />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard label="TVA Collectée (Est.)" value={fmtEur(data.annual.collectee)} icon={Banknote} color="blue" />
                <StatCard label="TVA Déductible" value={fmtEur(data.annual.deductible)} icon={Receipt} color="green" />
                <StatCard label="Solde TVA" value={fmtEur(data.annual.solde)} icon={CreditCard} color={data.annual.solde > 0 ? "orange" : "green"} />
            </div>
            <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"} flex items-center gap-1.5`}>
                <AlertTriangle className="w-3 h-3" />
                Note: TVA collectée estimée au taux de 10% (restauration standard FR).
            </p>
            <Card title={`Détail mensuel TVA - ${isAll ? periodLabel : year}`} icon={Calendar}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className={`text-left border-b ${dk ? "border-white/10 text-white/40" : "border-slate-200 text-slate-500"}`}>
                                <th className="py-2">Mois</th>
                                <th className="py-2 text-right">Collectée (Est.)</th>
                                <th className="py-2 text-right">Déductible</th>
                                <th className="py-2 text-right">Solde</th>
                                <th className="py-2 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(isAll ? data.monthly.filter((m: any) => m.collectee !== 0 || m.deductible !== 0) : data.monthly).map((m: any) => (
                                <tr key={m.month} className={`border-b ${dk ? "border-white/5" : "border-slate-50"}`}>
                                    <td className="py-3 font-medium capitalize">{m.month}</td>
                                    <td className="py-3 text-right text-blue-400">{fmtEur(m.collectee)}</td>
                                    <td className="py-3 text-right text-emerald-400">{fmtEur(m.deductible)}</td>
                                    <td className={`py-3 text-right font-semibold ${m.solde > 0 ? "text-orange-400" : "text-emerald-400"}`}>
                                        {fmtEurSigned(m.solde)}
                                    </td>
                                    <td className="py-3 text-center">
                                        {m.solde <= 0 ? (
                                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">✅ CRÉDIT</span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-bold">🔴 À PAYER</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}

function PLView({ data, loading, year, periodLabel, isAll }: { data: any; loading: boolean; year: string; periodLabel: string; isAll: boolean }) {
    const dk = useSuguDark();
    if (loading) return <LoaderState />;
    if (!data) return <EmptyState />;

    const grossMargin = (data.annual.ca || 0) - (data.annual.achats?.total || 0);
    const grossMarginPct = data.annual.ca > 0 ? ((grossMargin / data.annual.ca) * 100).toFixed(1) : "0.0";

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Chiffre d'Affaires" value={fmtEur(data.annual.ca)} icon={DollarSign} color="blue" />
                <StatCard label="Marge Brute" value={fmtEur(grossMargin)} icon={TrendingUp} color="green" />
                <StatCard label="Résultat Exploitation" value={fmtEur(data.annual.resultat)} icon={Activity} color={data.annual.resultat > 0 ? "green" : "red"} />
                <StatCard label="Marge Nette %" value={`${typeof data.annual.margePct === "number" ? data.annual.margePct.toFixed(1) : data.annual.margePct}%`} icon={BarChart3} color="purple" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: "Achats matières", val: data.annual.achats?.total || 0, pct: data.annual.ca > 0 ? ((data.annual.achats?.total || 0) / data.annual.ca * 100).toFixed(1) : "0", color: "orange" },
                    { label: "Frais généraux", val: data.annual.fraisGeneraux || 0, pct: data.annual.ca > 0 ? ((data.annual.fraisGeneraux || 0) / data.annual.ca * 100).toFixed(1) : "0", color: "orange" },
                    { label: "Masse salariale", val: (data.annual.masseSalariale || 0), pct: data.annual.ca > 0 ? ((data.annual.masseSalariale || 0) / data.annual.ca * 100).toFixed(1) : "0", color: "orange" },
                    { label: "Charges sociales", val: data.annual.chargesSociales || 0, pct: data.annual.ca > 0 ? ((data.annual.chargesSociales || 0) / data.annual.ca * 100).toFixed(1) : "0", color: "orange" },
                ].map(item => (
                    <div key={item.label} className={`p-3 rounded-xl border ${dk ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
                        <p className={`text-[10px] font-medium uppercase tracking-wider ${dk ? "text-white/40" : "text-slate-400"}`}>{item.label}</p>
                        <p className="text-base font-bold font-mono text-orange-400">{fmtEur(item.val)}</p>
                        <p className={`text-xs ${dk ? "text-white/30" : "text-slate-400"}`}>{item.pct}% du CA</p>
                    </div>
                ))}
            </div>

            <Card title={`Compte de Résultat - ${isAll ? periodLabel : year}`} icon={FileText}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className={`text-left border-b ${dk ? "border-white/10 text-white/40" : "border-slate-200 text-slate-500"}`}>
                                <th className="py-2">Mois</th>
                                <th className="py-2 text-right">CA</th>
                                <th className="py-2 text-right">Achats</th>
                                <th className="py-2 text-right">Frais</th>
                                <th className="py-2 text-right">Salaires+Ch.</th>
                                <th className="py-2 text-right">Résultat</th>
                                <th className="py-2 text-right">Marge %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(isAll ? data.monthly.filter((m: any) => m.ca !== 0 || (m.achats?.total || 0) !== 0 || m.fraisGeneraux !== 0 || m.masseSalariale !== 0) : data.monthly).map((m: any) => (
                                <tr key={m.month} className={`border-b ${dk ? "border-white/5" : "border-slate-50"}`}>
                                    <td className="py-3 font-medium capitalize">{m.month}</td>
                                    <td className="py-3 text-right font-mono">{fmtEur(m.ca)}</td>
                                    <td className="py-3 text-right text-orange-400 font-mono">-{fmtEur(m.achats?.total ?? m.achats ?? 0)}</td>
                                    <td className="py-3 text-right text-orange-300 font-mono">-{fmtEur(m.fraisGeneraux ?? m.frais ?? 0)}</td>
                                    <td className="py-3 text-right text-orange-200 font-mono">-{fmtEur((m.masseSalariale ?? m.salaires ?? 0) + (m.chargesSociales ?? m.charges ?? 0))}</td>
                                    <td className={`py-3 text-right font-bold font-mono ${m.resultat > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                        {fmtEurSigned(m.resultat)}
                                    </td>
                                    <td className="py-3 text-right">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.margePct > 65 ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400"}`}>
                                            {typeof m.margePct === "number" ? m.margePct.toFixed(1) : m.margePct}%
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}

function RatiosView({ data, loading, year, periodLabel, isAll }: { data: any; loading: boolean; year: string; periodLabel: string; isAll: boolean }) {
    const dk = useSuguDark();
    if (loading) return <LoaderState />;
    if (!data) return <EmptyState />;

    const getRatioColor = (type: "food" | "payroll" | "overhead" | "margin", val: number) => {
        if (type === "food") {
            if (val < 30) return "green";
            if (val <= 35) return "orange";
            return "red";
        }
        if (type === "payroll") {
            if (val < 35) return "green";
            if (val <= 40) return "orange";
            return "red";
        }
        if (type === "overhead") {
            if (val < 20) return "green";
            if (val <= 25) return "orange";
            return "red";
        }
        if (type === "margin") {
            if (val > 70) return "green";
            if (val >= 65) return "orange";
            return "red";
        }
        return "blue";
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                    <StatCard label="Food Cost %" value={`${data.annual.foodCostPct}%`} icon={Utensils} color={getRatioColor("food", data.annual.foodCostPct)} />
                    <p className={`text-[10px] px-1 ${dk ? "text-white/30" : "text-slate-400"}`}>Cible: 28-32% (Achats mat. première / CA)</p>
                </div>
                <div className="space-y-2">
                    <StatCard label="Personnel %" value={`${data.annual.payrollCostPct}%`} icon={Users} color={getRatioColor("payroll", data.annual.payrollCostPct)} />
                    <p className={`text-[10px] px-1 ${dk ? "text-white/30" : "text-slate-400"}`}>Cible: 30-35% (Salaires + Charges / CA)</p>
                </div>
                <div className="space-y-2">
                    <StatCard label="Frais Généraux %" value={`${data.annual.overheadPct}%`} icon={Receipt} color={getRatioColor("overhead", data.annual.overheadPct)} />
                    <p className={`text-[10px] px-1 ${dk ? "text-white/30" : "text-slate-400"}`}>Cible: 15-20% (Loyer, EDF, Assurances / CA)</p>
                </div>
                <div className="space-y-2">
                    <StatCard label="Marge Brute %" value={`${data.annual.grossMarginPct}%`} icon={BarChart3} color={getRatioColor("margin", data.annual.grossMarginPct)} />
                    <p className={`text-[10px] px-1 ${dk ? "text-white/30" : "text-slate-400"}`}>Cible: 68-72% (CA - Achats / CA)</p>
                </div>
            </div>

            <Card title={`Evolution des Ratios - ${isAll ? periodLabel : year}`} icon={Activity}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className={`text-left border-b ${dk ? "border-white/10 text-white/40" : "border-slate-200 text-slate-500"}`}>
                                <th className="py-2">Mois</th>
                                <th className="py-2 text-right">CA</th>
                                <th className="py-2 text-right">Food Cost %</th>
                                <th className="py-2 text-right">Personnel %</th>
                                <th className="py-2 text-right">Frais %</th>
                                <th className="py-2 text-right">Marge %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(isAll ? data.monthly.filter((m: any) => m.ca !== 0 || m.foodCost !== 0 || m.payrollCost !== 0) : data.monthly).map((m: any) => (
                                <tr key={m.month} className={`border-b ${dk ? "border-white/5" : "border-slate-50"}`}>
                                    <td className="py-3 font-medium capitalize">{m.month}</td>
                                    <td className="py-3 text-right font-mono text-xs">{fmtEur(m.ca)}</td>
                                    <td className={`py-3 text-right font-bold ${m.foodCostPct > 35 ? "text-red-400" : m.foodCostPct > 32 ? "text-orange-400" : "text-emerald-400"}`}>{m.foodCostPct}%</td>
                                    <td className={`py-3 text-right font-bold ${m.payrollCostPct > 40 ? "text-red-400" : m.payrollCostPct > 35 ? "text-orange-400" : "text-emerald-400"}`}>{m.payrollCostPct}%</td>
                                    <td className={`py-3 text-right font-bold ${m.overheadPct > 25 ? "text-red-400" : m.overheadPct > 20 ? "text-orange-400" : "text-emerald-400"}`}>{m.overheadPct}%</td>
                                    <td className={`py-3 text-right font-bold ${m.grossMarginPct < 65 ? "text-red-400" : m.grossMarginPct < 70 ? "text-orange-400" : "text-emerald-400"}`}>{m.grossMarginPct}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}

function TresoView({ data, loading, year, periodLabel, isAll }: { data: any; loading: boolean; year: string; periodLabel: string; isAll: boolean }) {
    const dk = useSuguDark();
    if (loading) return <LoaderState />;
    if (!data) return <EmptyState />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Solde en Banque" value={fmtEur(data.currentBalance)} icon={Landmark} color="blue" />
                <StatCard label="Impayés Fournisseurs" value={fmtEur(data.unpaidPayables)} icon={Clock} color="orange" />
                <StatCard label="Flux Net Moyen (3m)" value={fmtEurSigned(data.projection.avg3m)} icon={RefreshCw} color={data.projection.avg3m > 0 ? "green" : "red"} />
                <StatCard label="Projection J+30" value={fmtEur(data.projection.projected1m)} icon={TrendingUp} color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <Card title={`Journal de Trésorerie - ${isAll ? periodLabel : year}`} icon={CreditCard}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className={`text-left border-b ${dk ? "border-white/10 text-white/40" : "border-slate-200 text-slate-500"}`}>
                                        <th className="py-2">Mois</th>
                                        <th className="py-2 text-right">Encaissements</th>
                                        <th className="py-2 text-right">Décaissements</th>
                                        <th className="py-2 text-right">Flux Net</th>
                                        <th className="py-2 text-right">Solde Cumulé</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(isAll ? data.monthly.filter((m: any) => m.cashIn !== 0 || m.cashOut !== 0) : data.monthly).map((m: any) => (
                                        <tr key={m.month} className={`border-b ${dk ? "border-white/5" : "border-slate-50"}`}>
                                            <td className="py-3 font-medium capitalize">{m.month}</td>
                                            <td className="py-3 text-right text-emerald-400 font-mono">+{fmtEur(m.cashIn)}</td>
                                            <td className="py-3 text-right text-red-400 font-mono">-{fmtEur(m.cashOut)}</td>
                                            <td className={`py-3 text-right font-bold font-mono ${m.netFlow > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                {fmtEurSigned(m.netFlow)}
                                            </td>
                                            <td className="py-3 text-right font-bold font-mono text-white/80">{fmtEur(m.cumulativeBalance)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
                <div>
                    <Card title="Projection Trésorerie" icon={TrendingUp}>
                        <div className="space-y-4">
                            <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>
                                Projection basée sur les flux moyens des 3 derniers mois ({fmtEurSigned(data.projection.avg3m)}/mois).
                            </p>
                            <div className="space-y-3 pt-2">
                                {[
                                    { label: "Projection à 30 jours", val: data.projection.projected1m },
                                    { label: "Projection à 60 jours", val: data.projection.projected2m },
                                    { label: "Projection à 90 jours", val: data.projection.projected3m },
                                ].map(p => (
                                    <div key={p.label} className={`p-3 rounded-xl border ${dk ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
                                        <p className={`text-[10px] font-medium ${dk ? "text-white/40" : "text-slate-400"} uppercase tracking-wider`}>{p.label}</p>
                                        <p className={`text-lg font-bold font-mono ${p.val > 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtEur(p.val)}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
            <CategoryFiles category="comptabilite" label="Comptabilité" />
        </div>
    );
}

function LoaderState() {
    const dk = useSuguDark();
    return <div className={`flex items-center justify-center py-20 gap-3 ${dk ? "text-white/40" : "text-slate-400"}`}><Loader2 className="w-6 h-6 animate-spin" /> Analyse des données en cours...</div>;
}

function EmptyState() {
    const dk = useSuguDark();
    return <div className={`text-center py-20 ${dk ? "text-white/40" : "text-slate-400"}`}>Aucune donnée disponible pour cette période</div>;
}

