import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Receipt, Landmark, BarChart3, TrendingUp, TrendingDown, Calendar, DollarSign, UserCheck, AlertTriangle, Building2, Loader2, Download } from "lucide-react";
import { useSuguDark } from "./context";
import { AuditOverview, fmt } from "./types";
import { Card, StatCard, PeriodFilter, usePeriodFilter } from "./shared";
import { ExpertReport } from "./ExpertReport";

export function AuditTab({ restricted }: { restricted?: boolean } = {}) {
    const dk = useSuguDark();
    const pf = usePeriodFilter("month");
    const selectedYear = pf.period.year;
    const { toast } = useToast();
    const { data: audit, isLoading } = useQuery<AuditOverview>({ queryKey: [`/api/v2/sugu-management/audit/overview?year=${selectedYear}`] });

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
            ["TVA 10%", String(audit.totalTVA10 ?? audit.totalCovers)],
            ["TVA 20%", String(audit.totalTVA20 ?? 0)],
            ["CA moyen/jour", String(audit.avgDailyRevenue)],
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
            {/* Period filter + export */}
            <div className="flex flex-wrap items-center gap-3">
                <PeriodFilter {...pf} />
                <h2 className={`text-lg font-bold ${dk ? "text-white" : "text-slate-800"}`}>Bilan comptable — {pf.period.label}</h2>
                <button onClick={exportAuditCSV} className={`ml-auto px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap flex items-center gap-1`} data-testid="button-export-audit-csv"><Download className="w-3 h-3" /> Export CSV</button>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label={`CA ${pf.period.label}`} value={fmt(audit.totalRevenue)} icon={DollarSign} color="green" />
                <StatCard label="Coûts totaux" value={fmt(audit.totalCosts)} icon={TrendingDown} color="red" />
                <StatCard label="Résultat d'exploitation" value={fmt(audit.operatingProfit)} icon={TrendingUp} color={audit.operatingProfit >= 0 ? "green" : "red"} />
                <StatCard label="Marge" value={`${audit.profitMargin}%`} icon={BarChart3} color={(parseFloat(audit.profitMargin) || 0) >= 0 ? "green" : "red"} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="TVA 10%" value={fmt(audit.totalTVA10 ?? audit.totalCovers)} icon={Receipt} color="orange" />
                <StatCard label="TVA 20%" value={fmt(audit.totalTVA20 ?? 0)} icon={Receipt} color="purple" />
                <StatCard label="CA moyen/jour" value={fmt(audit.avgDailyRevenue)} icon={Calendar} color="blue" />
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
                                    <div className="bg-gradient-to-r from-orange-500 to-red-500 h-full rounded-full flex items-center justify-end pr-2 transition-all min-w-[40px]" style={{ width: `${Math.round((revenue / maxRev) * 100)}%` }}>
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
                {(() => {
                    const allCosts = (audit.costBreakdown.achats || 0) + (audit.costBreakdown.fraisGeneraux || 0) + (audit.costBreakdown.salaires || 0) + (audit.costBreakdown.chargesSociales || 0) + (audit.costBreakdown.emprunts || 0);
                    const denom = audit.totalRevenue > 0 ? audit.totalRevenue : allCosts;
                    const pctLabel = audit.totalRevenue > 0 ? "% du CA" : "% coûts";
                    const costItems = [
                        { label: "Achats", value: audit.costBreakdown.achats, color: "from-orange-500/20 to-orange-600/10 border-orange-500/20", bar: "bg-orange-500" },
                        { label: "Frais Généraux", value: audit.costBreakdown.fraisGeneraux, color: "from-blue-500/20 to-blue-600/10 border-blue-500/20", bar: "bg-blue-500" },
                        { label: "Salaires", value: audit.costBreakdown.salaires, color: "from-purple-500/20 to-purple-600/10 border-purple-500/20", bar: "bg-purple-500" },
                        { label: "Charges Sociales", value: audit.costBreakdown.chargesSociales, color: "from-red-500/20 to-red-600/10 border-red-500/20", bar: "bg-red-500" },
                        { label: "Emprunts", value: audit.costBreakdown.emprunts, color: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/20", bar: "bg-yellow-500" },
                    ];
                    return (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                {costItems.map(item => {
                                    const pct = denom > 0 ? ((item.value ?? 0) / denom) * 100 : 0;
                                    return (
                                        <div key={item.label} className={`bg-gradient-to-br ${item.color} border rounded-xl p-4`}>
                                            <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{item.label}</p>
                                            <p className="text-xl font-bold font-mono">{fmt(item.value ?? 0)}</p>
                                            <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`} title={pctLabel}>{pct.toFixed(1)}%</p>
                                        </div>
                                    );
                                })}
                            </div>
                            {allCosts > 0 && (
                                <div className="mt-4">
                                    <div className="flex gap-0.5 h-4 rounded-full overflow-hidden">
                                        {costItems.map((item, i) => {
                                            const pct = allCosts > 0 ? ((item.value ?? 0) / allCosts) * 100 : 0;
                                            if (pct < 0.5) return null;
                                            return <div key={i} className={`${item.bar} h-full transition-all`} style={{ width: `${pct}%` }} />;
                                        })}
                                    </div>
                                    <p className={`text-[10px] mt-1 ${dk ? "text-white/30" : "text-slate-400"}`}>Répartition relative des coûts</p>
                                </div>
                            )}
                        </>
                    );
                })()}
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
                        <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 rounded-xl p-3">
                            <TrendingDown className="w-5 h-5 text-orange-400" />
                            <div>
                                <p className="text-sm font-medium text-orange-400">Marge faible</p>
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

            <ExpertReport defaultYear={selectedYear} defaultTab="audit" />

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

