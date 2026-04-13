import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Receipt, CreditCard, BarChart3, Plus, Trash2, Edit, Check, Calendar, DollarSign, Loader2, Download, ChevronUp, ChevronDown, Camera } from "lucide-react";
import { useSuguDark } from "./context";
import { CashEntry, fmt, fmtDate, safeFloat } from "./types";
import { Card, StatCard, FormModal, Field, useInputClass, CardSizeToggle, btnPrimary, btnDanger, PeriodFilter, usePeriodFilter } from "./shared";
import { CategoryFiles } from "./fileModals";

export function CaisseTab({ compactCards, setCompactCards, restricted, autoOpenForm, onAutoOpenDone }: { compactCards: boolean; setCompactCards: (v: boolean) => void; restricted?: boolean; autoOpenForm?: boolean; onAutoOpenDone?: () => void }) {
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showForm, setShowForm] = useState(false);
    useEffect(() => { if (autoOpenForm) { setShowForm(true); onAutoOpenDone?.(); } }, [autoOpenForm]);
    const [editingCash, setEditingCash] = useState<CashEntry | null>(null);
    const [form, setForm] = useState<Partial<CashEntry>>({ entryDate: new Date().toISOString().substring(0, 10) });
    const dk = useSuguDark();
    const ic = useInputClass();
    const [editForm, setEditForm] = useState<Partial<CashEntry>>({});
    const [caisseSortCol, setCaisseSortCol] = useState<"date" | "ca" | "covers" | "ticket">("date");
    const [caisseSortDir, setCaisseSortDir] = useState<"asc" | "desc">("desc");
    const [caissePage, setCaissePage] = useState(1);
    const [caissePageSize, setCaissePageSize] = useState(25);
    const pf = usePeriodFilter("month");
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const [parsingTicket, setParsingTicket] = useState(false);

    const handleCameraTicket = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";
        setParsingTicket(true);
        try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error("Impossible de lire la photo"));
                reader.readAsDataURL(file);
            });
            const res = await fetch("/api/v2/sugu-management/cash/parse-ticket-base64", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: base64, mimeType: file.type || "image/jpeg" }),
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                throw new Error(errText || `Erreur serveur (${res.status})`);
            }
            const parsed = await res.json();
            setForm({
                entryDate: parsed.entryDate || new Date().toISOString().substring(0, 10),
                totalRevenue: parsed.totalRevenue ?? undefined,
                cashAmount: parsed.cashAmount ?? undefined,
                cbAmount: parsed.cbAmount ?? undefined,
                cbzenAmount: parsed.cbzenAmount ?? undefined,
                trAmount: parsed.trAmount ?? undefined,
                ubereatsAmount: parsed.ubereatsAmount ?? undefined,
                deliverooAmount: parsed.deliverooAmount ?? undefined,
                chequeAmount: parsed.chequeAmount ?? undefined,
                virementAmount: parsed.virementAmount ?? undefined,
                coversCount: parsed.coversCount ?? undefined,
                notes: parsed.notes ?? undefined,
            });
            setShowForm(true);
            toast({ title: "Ticket Z analysé", description: "Vérifiez et corrigez les valeurs si nécessaire." });
        } catch (err: any) {
            toast({ title: "Erreur analyse", description: err.message || "Impossible d'analyser le ticket", variant: "destructive" });
        } finally {
            setParsingTicket(false);
        }
    };
    const { data: entries = [] } = useQuery<CashEntry[]>({ queryKey: ["/api/v2/sugu-management/cash"] });
    const { data: summary } = useQuery<any>({ queryKey: ["/api/v2/sugu-management/cash/summary"] });

    const createMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugu-management/cash", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/cash"] }); qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/cash/summary"] }); setShowForm(false); setForm({ entryDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Journée enregistrée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible d'enregistrer la journée", variant: "destructive" }); }
    });

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugu-management/cash/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/cash"] }); qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/cash/summary"] }); setEditingCash(null); toast({ title: "Journée modifiée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier la journée", variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/cash/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/cash"] }); qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/cash/summary"] }); toast({ title: "Entrée supprimée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer l'entrée", variant: "destructive" }); }
    });

    const filteredEntries = useMemo(() => {
        return entries.filter(e => {
            if (pf.period.from && e.entryDate < pf.period.from) return false;
            if (pf.period.to && e.entryDate > pf.period.to) return false;
            return true;
        });
    }, [entries, pf.period.from, pf.period.to]);

    const totalRevenue = filteredEntries.reduce((s, e) => s + e.totalRevenue, 0);
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
    }, [filteredEntries, caisseSortCol, caisseSortDir]);

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
            <PeriodFilter periodKey={pf.periodKey} setPeriod={pf.setPeriod} customFrom={pf.customFrom} setCustomFrom={pf.setCustomFrom} customTo={pf.customTo} setCustomTo={pf.setCustomTo} />
            <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${dk ? "text-white/40" : "text-slate-400"}`}>Indicateurs clés</span>
                <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
            </div>
            <div className={`grid grid-cols-2 md:grid-cols-4 gap-3`}>
                <StatCard label="CA Total" value={fmt(totalRevenue)} icon={DollarSign} color="green" compact={compactCards} />
                <StatCard label="TVA 10%" value={fmt(totalTVA10)} icon={Receipt} color="blue" compact={compactCards} />
                <StatCard label="TVA 20%" value={fmt(totalTVA20)} icon={Receipt} color="orange" compact={compactCards} />
                <StatCard label="Jours" value={String(filteredEntries.length)} icon={Calendar} color="purple" compact={compactCards} />
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
                    { label: "Chèque", amount: totalCheque, color: "bg-amber-500" },
                    { label: "Virement", amount: totalVirement, color: "bg-indigo-500" },
                ];
                const active = paymentTypes.filter(p => p.amount > 0);
                const accountedFor = active.reduce((s, p) => s + p.amount, 0);
                const other = totalRevenue - accountedFor;
                return (
                    <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-3 sm:p-5`}>
                        <h3 className={`font-semibold text-sm sm:text-base ${dk ? "text-white" : "text-slate-800"} mb-2 sm:mb-3 flex items-center gap-2`}><BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" /> Répartition encaissements</h3>
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
                                {data.covers > 0 && <p className="text-xs text-orange-400 font-mono">{fmt(data.revenue / data.covers)}/couvert</p>}
                            </div>
                        ))}
                    </div>
                </Card>
            )}
            <Card title="Journal de Caisse" icon={CreditCard}
                action={
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <button onClick={exportCaisseCSV} className={`px-2 sm:px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap flex items-center gap-1`}><Download className="w-3 h-3" /> CSV</button>
                        {!restricted && (
                            <>
                                <input
                                    ref={cameraInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleCameraTicket}
                                    data-testid="input-camera-ticket"
                                />
                                <button
                                    onClick={() => cameraInputRef.current?.click()}
                                    disabled={parsingTicket}
                                    className={`px-3 py-2 text-sm rounded-lg flex items-center gap-1.5 transition ${dk ? "bg-white/10 text-white/70 hover:bg-white/20" : "bg-slate-100 text-slate-600 hover:bg-slate-200"} disabled:opacity-50`}
                                    title="Scanner un ticket Z (photo)"
                                    data-testid="button-scan-ticket"
                                >
                                    {parsingTicket ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                                    <span className="hidden sm:inline">{parsingTicket ? "Analyse..." : "Ticket Z"}</span>
                                </button>
                                <button onClick={() => setShowForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nouvelle Journée</span><span className="sm:hidden">+</span></button>
                            </>
                        )}
                    </div>
                }>
                {entries.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucune journée enregistrée</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
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
                                    <th className={`text-right py-2 px-2 cursor-pointer ${dk ? "hover:text-white/70" : "hover:text-slate-700"}`} onClick={() => toggleCaisseSort("covers")}>TVA 10%{caisseSortCol === "covers" && (caisseSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}</th>
                                    <th className={`text-right py-2 px-2 cursor-pointer ${dk ? "hover:text-white/70" : "hover:text-slate-700"}`} onClick={() => toggleCaisseSort("ticket")}>TVA 20%{caisseSortCol === "ticket" && (caisseSortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)}</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {caissePageData.map(e => (
                                    <tr key={e.id} className={`border-b text-[12px] ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                        <td className="py-2 px-2 font-medium whitespace-nowrap text-[12px]">{fmtDate(e.entryDate)}</td>
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
                                        <td className="py-2 px-2 text-right font-mono text-orange-400">{e.averageTicket ? fmt(e.averageTicket) : "-"}</td>
                                        {!restricted && <td className="py-2 px-2 text-right flex gap-1 justify-end">
                                            <button onClick={() => openEditCash(e)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>
                                            <button onClick={() => { if (confirm("Supprimer cette journée ?")) deleteMut.mutate(e.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                        </td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 py-3 text-xs sm:text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2 flex-wrap">{sortedEntries.length} jours • Page {caisseCurrentPage}/{caisseTotalPages}<select value={caissePageSize} onChange={e => { setCaissePageSize(Number(e.target.value)); setCaissePage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>/page</span>
                            <div className="flex gap-1.5 sm:gap-2">
                                <button disabled={caissePage <= 1} onClick={() => setCaissePage(1)} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button disabled={caissePage <= 1} onClick={() => setCaissePage(p => Math.max(1, p - 1))} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button disabled={caissePage >= caisseTotalPages} onClick={() => setCaissePage(p => Math.min(caisseTotalPages, p + 1))} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={caissePage >= caisseTotalPages} onClick={() => setCaissePage(caisseTotalPages)} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
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
                    <Field label="dont TVA 10% (€)">
                        <input aria-label="TVA 10%" type="number" step="0.01" className={ic} value={form.coversCount ?? ""} onChange={e => setForm({ ...form, coversCount: e.target.value === "" ? undefined : safeFloat(e.target.value) as any })} />
                    </Field>
                    <Field label="dont TVA 20% (€)">
                        <input aria-label="TVA 20%" type="number" step="0.01" className={ic} value={form.averageTicket ?? ""} onChange={e => setForm({ ...form, averageTicket: e.target.value === "" ? undefined : safeFloat(e.target.value) })} />
                    </Field>
                </div>
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
                    <Field label="dont TVA 10% (€)">
                        <input aria-label="TVA 10%" type="number" step="0.01" className={ic} value={editForm.coversCount ?? ""} onChange={e => setEditForm({ ...editForm, coversCount: e.target.value === "" ? undefined : safeFloat(e.target.value) as any })} />
                    </Field>
                    <Field label="dont TVA 20% (€)">
                        <input aria-label="TVA 20%" type="number" step="0.01" className={ic} value={editForm.averageTicket ?? ""} onChange={e => setEditForm({ ...editForm, averageTicket: e.target.value === "" ? undefined : safeFloat(e.target.value) })} />
                    </Field>
                </div>
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
                <Field label="Notes"><input aria-label="Notes" className={ic} value={editForm.notes || ""} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></Field>
                <button onClick={() => editingCash && updateMut.mutate({ id: editingCash.id, data: editForm })} className={btnPrimary + " w-full justify-center"} disabled={!editForm.totalRevenue}>
                    <Check className="w-4 h-4" /> Sauvegarder
                </button>
            </FormModal>
            <CategoryFiles category="caisse" label="Journal de Caisse" restricted={restricted} />
        </div>
    );
}

