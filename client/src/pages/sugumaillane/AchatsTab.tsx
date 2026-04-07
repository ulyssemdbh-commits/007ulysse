import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Purchase, SuguFile, Supplier } from "../sugu/types";
import { PURCHASE_CATEGORIES, PAYMENT_METHODS, fmt, safeFloat, t, fmtDate, catLabel } from "../sugu/helpers";
import { useSuguDark, Card, StatCard, FormModal, Field, useInputClass, btnPrimary, btnDanger, CardSizeToggle, isFilePreviewable, FilePreviewModal, normalizeCatKey, CategoryBadge } from "./shared";
import {
  Plus,
  Clock,
  Trash2,
  Search,
  Eye,
  AlertTriangle,
  Edit,
  Check,
  Building2,
  ChevronUp,
  ChevronDown,
  Receipt,
  ShoppingCart,
} from "lucide-react";

export function AchatsTab({ compactCards, setCompactCards }: { compactCards: boolean; setCompactCards: (v: boolean) => void }) {
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
                <select title="Filtrer par statut de paiement" className={ic} value={paidFilter} onChange={e => setPaidFilter(e.target.value as "all" | "paid" | "unpaid")}>
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
