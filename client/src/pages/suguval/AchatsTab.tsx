import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, Receipt, Plus, Trash2, Edit, Check, Clock, AlertTriangle, Building2, Search, Filter, ChevronUp, ChevronDown, Eye } from "lucide-react";
import { useSuguDark } from "./context";
import { Purchase, Supplier, SuguFile, PURCHASE_CATEGORIES, PAYMENT_METHODS, fmt, fmtDate, safeFloat, catLabel, normalizeCatKey } from "./types";
import { Card, StatCard, FormModal, Field, useInputClass, FormSelect, CardSizeToggle, btnPrimary, btnDanger, CategoryBadge, PeriodFilter, usePeriodFilter } from "./shared";
import { FilePreviewModal, CategoryFiles, isFilePreviewable, ACCOUNTANT_EMAIL } from "./fileModals";
import { FileUploadModal } from "./FileUploadModal";

export function AchatsTab({ compactCards, setCompactCards, restricted }: { compactCards: boolean; setCompactCards: (v: boolean) => void; restricted?: boolean }) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const pf = usePeriodFilter("year");
    const [showForm, setShowForm] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
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
    const [supplierFilter, setSupplierFilter] = useState("all");
    const [amountMin, setAmountMin] = useState("");
    const [amountMax, setAmountMax] = useState("");
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);
    const { data: purchases = [] } = useQuery<Purchase[]>({ queryKey: ["/api/v2/sugu-management/purchases"] });
    const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/v2/sugu-management/suppliers"] });
    const { data: achatsFiles = [] } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugu-management/files", "achats"],
        queryFn: async () => { const r = await fetch("/api/v2/sugu-management/files?category=achats", { credentials: "include" }); return r.json(); }
    });

    const defaultForm = { category: "alimentaire", isPaid: false, paymentMethod: "virement" };

    const createMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugu-management/purchases", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] }); setShowForm(false); setForm(defaultForm); toast({ title: "Achat enregistré" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible d'enregistrer l'achat: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const quickCreateMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugu-management/purchases", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] }); setQuickSupplier(""); setQuickAmount(""); toast({ title: "Achat ajouté (rapide)" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugu-management/purchases/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] }); setEditingPurchase(null); toast({ title: "Achat modifié" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible de modifier l'achat: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/purchases/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] }); toast({ title: "Achat supprimé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer l'achat", variant: "destructive" }); }
    });

    const togglePaid = useMutation({
        mutationFn: (p: Purchase) => apiRequest("PUT", `/api/v2/sugu-management/purchases/${p.id}`, { isPaid: !p.isPaid }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier le statut", variant: "destructive" }); }
    });

    const bulkMarkPaidMut = useMutation({
        mutationFn: async (ids: number[]) => { await Promise.all(ids.map(id => apiRequest("PUT", `/api/v2/sugu-management/purchases/${id}`, { isPaid: true }))); },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] }); setSelectedIds(new Set()); toast({ title: `${selectedIds.size} achat(s) marqués payés` }); },
        onError: () => { toast({ title: "Erreur bulk", variant: "destructive" }); }
    });

    const bulkDeleteMut = useMutation({
        mutationFn: async (ids: number[]) => { await Promise.all(ids.map(id => apiRequest("DELETE", `/api/v2/sugu-management/purchases/${id}`))); },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] }); setSelectedIds(new Set()); toast({ title: "Achats supprimés" }); },
        onError: () => { toast({ title: "Erreur suppression", variant: "destructive" }); }
    });

    const openEdit = (p: Purchase) => {
        setEditingPurchase(p);
        setEditForm({ supplier: p.supplier, category: p.category, description: p.description, amount: p.amount, taxAmount: p.taxAmount, invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate, dueDate: p.dueDate, isPaid: p.isPaid, paymentMethod: p.paymentMethod });
    };

    

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
        if (supplierFilter !== "all") list = list.filter(p => p.supplier === supplierFilter);
        list = list.filter(p => (p.invoiceDate || "") >= pf.period.from && (p.invoiceDate || "") <= pf.period.to);
        if (amountMin) list = list.filter(p => p.amount >= parseFloat(amountMin));
        if (amountMax) list = list.filter(p => p.amount <= parseFloat(amountMax));

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
    }, [purchases, searchTerm, categoryFilter, paidFilter, supplierFilter, pf.period.from, pf.period.to, amountMin, amountMax, sort, page, pageSize, today]);

    useEffect(() => { setPage(1); }, [searchTerm, categoryFilter, paidFilter, supplierFilter, pf.period.from, pf.period.to, amountMin, amountMax, sort]);

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
            <PeriodFilter {...pf} />
            <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-slate-400 text-[16px]">Chiffres clés</span>
                <CardSizeToggle compact={compactCards} setCompact={setCompactCards} />
            </div>
            <div className={`grid ${compactCards ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-6"} gap-2 sm:gap-3`}>
                <StatCard label="Total TTC" value={fmt(filteredTotalTTC)} icon={ShoppingCart} color="orange" compact={compactCards} />
                <StatCard label="Total TVA" value={fmt(filteredTotalTVA)} icon={Receipt} color="blue" compact={compactCards} />
                <StatCard label="Impayés" value={fmt(filtered.filter(p => !p.isPaid).reduce((s, p) => s + p.amount, 0))} icon={AlertTriangle} color="red" compact={compactCards} />
                <StatCard label="Fournisseurs" value={String(new Set(filtered.map(p => p.supplier)).size)} icon={Building2} color="blue" compact={compactCards} />
                <StatCard label="Échéances < 30j" value={String(stats.dueSoonCount)} icon={Clock} color="orange" compact={compactCards} />
                <StatCard label="En retard" value={String(stats.overdueCount)} icon={AlertTriangle} color="red" compact={compactCards} />
            </div>
            {/* Search + Filters */}
            <div className="space-y-2">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 items-center">
                    <div className={`col-span-2 flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2`}>
                        <Search className={`w-4 h-4 flex-shrink-0 ${dk ? "text-white/40" : "text-slate-400"}`} />
                        <input data-testid="input-search-achats" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Rechercher fournisseur, n° facture..." className="bg-transparent w-full text-sm focus:outline-none" />
                    </div>
                    <FormSelect data-testid="select-category-achats" title="Filtrer par catégorie" className={ic} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                        <option value="all">Toutes catégories</option>
                        {PURCHASE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </FormSelect>
                    <FormSelect data-testid="select-paid-achats" title="Filtrer par statut de paiement" className={ic} value={paidFilter} onChange={e => setPaidFilter(e.target.value as any)}>
                        <option value="all">Payé + Impayé</option>
                        <option value="unpaid">Impayés</option>
                        <option value="paid">Payés</option>
                    </FormSelect>
                    <div className="col-span-2 sm:col-span-1 flex gap-2">
                        <button data-testid="button-toggle-advanced-filters" onClick={() => setShowAdvancedFilters(v => !v)} className={`flex-1 sm:flex-none px-3 py-2 text-sm rounded-lg border ${showAdvancedFilters ? "bg-orange-500/20 border-orange-500/40 text-orange-400" : dk ? "bg-white/5 border-white/10" : "bg-white border-slate-200"} flex items-center justify-center gap-1.5 whitespace-nowrap`}>
                            <Filter className="w-3.5 h-3.5" /> Filtres {(supplierFilter !== "all" || amountMin || amountMax) ? <span className="w-2 h-2 rounded-full bg-orange-400" /> : null}
                        </button>
                        <button onClick={exportCSV} className={`flex-1 sm:flex-none px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white whitespace-nowrap text-center`}>Export CSV</button>
                    </div>
                </div>
                {showAdvancedFilters && (
                    <div className={`${dk ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"} border rounded-xl p-3 grid grid-cols-2 md:grid-cols-3 gap-3 items-end`}>
                        <div>
                            <label className={`block text-xs mb-1 ${dk ? "text-white/50" : "text-slate-500"}`}>Fournisseur</label>
                            <FormSelect data-testid="select-supplier-filter" className={ic} value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                                <option value="all">Tous les fournisseurs</option>
                                {Array.from(new Set(purchases.map(p => p.supplier))).sort().map(s => <option key={s} value={s}>{s}</option>)}
                            </FormSelect>
                        </div>
                        <div>
                            <label className={`block text-xs mb-1 ${dk ? "text-white/50" : "text-slate-500"}`}>Montant min (€)</label>
                            <input data-testid="input-amount-min" type="number" step="0.01" className={ic} value={amountMin} onChange={e => setAmountMin(e.target.value)} placeholder="0" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Montant max (€)</label>
                            <div className="flex gap-2">
                                <input data-testid="input-amount-max" type="number" step="0.01" className={ic + " flex-1"} value={amountMax} onChange={e => setAmountMax(e.target.value)} placeholder="∞" />
                                <button onClick={() => { setSupplierFilter("all"); setAmountMin(""); setAmountMax(""); }} className={`px-2 py-1.5 text-xs rounded-lg ${dk ? "bg-white/10 text-white/60 hover:bg-white/20" : "bg-slate-200 text-slate-600 hover:bg-slate-300"} whitespace-nowrap`} title="Réinitialiser filtres avancés">✕ Reset</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {/* Breakdown by category */}
            {Object.keys(stats.byCategory).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, total]) => (
                        <div key={cat} className="bg-white/5 border border-white/10 rounded-xl p-3 text-[14px] pt-[0px] pb-[0px]">
                            <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{catLabel(cat)}</p>
                            <p className="font-bold font-mono text-[14px]">{fmt(total)}</p>
                        </div>
                    ))}
                </div>
            )}
            {!restricted && selectedIds.size > 0 && (
                <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl ${dk ? "bg-orange-500/10 border border-orange-500/30" : "bg-orange-50 border border-orange-200"}`}>
                    <span className={`text-sm font-medium ${dk ? "text-orange-300" : "text-orange-700"}`}>{selectedIds.size} sélectionné(s)</span>
                    <button data-testid="button-bulk-mark-paid" onClick={() => { if (confirm(`Marquer ${selectedIds.size} achat(s) comme payé(s) ?`)) bulkMarkPaidMut.mutate(Array.from(selectedIds)); }} className="px-3 py-1 text-xs rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 font-medium">✓ Marquer payé</button>
                    {!restricted && <button data-testid="button-bulk-delete" onClick={() => { if (confirm(`Supprimer définitivement ${selectedIds.size} achat(s) ?`)) bulkDeleteMut.mutate(Array.from(selectedIds)); }} className="px-3 py-1 text-xs rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 font-medium">✕ Supprimer</button>}
                    <button onClick={() => setSelectedIds(new Set())} className={`ml-auto text-xs ${dk ? "text-white/40 hover:text-white/60" : "text-slate-400 hover:text-slate-600"}`}>Désélectionner tout</button>
                </div>
            )}
            <Card title="Liste des Achats" icon={ShoppingCart}
                action={!restricted ? <button onClick={() => setShowUploadModal(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Transférer un fichier</button> : undefined}>
                {purchases.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun achat enregistré</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    {!restricted && <th className="py-2 px-2 w-8">
                                        <input data-testid="checkbox-select-all" type="checkbox" className="rounded" checked={pageData.length > 0 && pageData.every(p => selectedIds.has(p.id))} onChange={e => { const next = new Set(selectedIds); if (e.target.checked) pageData.forEach(p => next.add(p.id)); else pageData.forEach(p => next.delete(p.id)); setSelectedIds(next); }} />
                                    </th>}
                                    {([
                                        { id: "date", label: "Date" },
                                        { id: "supplier", label: "Fournisseur" },
                                        { id: "category", label: "Catégorie" },
                                        { id: "amount", label: "Montant TTC" }
                                    ] as const).map(col => (
                                        <th key={col.id} className={`${col.id === "amount" ? "text-right" : "text-left"} py-2 px-2`}>
                                            <button onClick={() => setSort(s => s.field === col.id ? { field: col.id, dir: s.dir === "asc" ? "desc" : "asc" } : { field: col.id, dir: col.id === "supplier" ? "asc" : "desc" })} className={`flex items-center gap-1 ${col.id === "amount" ? "w-full justify-end" : ""} ${dk ? "text-white/70" : "text-slate-700"} ${dk ? "hover:text-white" : "hover:text-slate-900"}`}>
                                                <span>{col.label}</span>
                                                {sort.field === col.id ? (sort.dir === "asc" ? <ChevronUp className="w-3 h-3 text-orange-400" /> : <ChevronDown className="w-3 h-3 text-orange-400" />) : <span className="w-3 h-3 opacity-20">↕</span>}
                                            </button>
                                        </th>
                                    ))}
                                    <th className="text-right py-2 px-2">TVA</th>
                                    <th className="text-left py-2 px-2">N° Facture</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                    <th className="text-center py-2 px-2">Payé</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageData.map(p => {
                                    const rowClass = selectedIds.has(p.id) ? (dk ? "bg-orange-500/10" : "bg-orange-50") : p.isOverdue ? "bg-red-500/5" : p.isDueSoon ? "bg-amber-500/5" : "";
                                    return (
                                        <tr key={p.id} className={`${rowClass} border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                            {!restricted && <td className="py-2 px-2 w-8">
                                                <input data-testid={`checkbox-purchase-${p.id}`} type="checkbox" className="rounded" checked={selectedIds.has(p.id)} onChange={e => { const next = new Set(selectedIds); if (e.target.checked) next.add(p.id); else next.delete(p.id); setSelectedIds(next); }} />
                                            </td>}
                                            <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"} whitespace-nowrap`}>
                                                {fmtDate(p.invoiceDate)}
                                                {p.isOverdue && <span className="ml-1 text-[11px] text-red-300">Retard</span>}
                                                {!p.isOverdue && p.isDueSoon && <span className="ml-1 text-[11px] text-amber-300">Éch. 30j</span>}
                                            </td>
                                            <td className="py-2 px-2 font-medium">{p.supplier}</td>
                                            <td className="py-2 px-2"><CategoryBadge cat={p.category} /></td>
                                            <td className="py-2 px-2 text-right font-mono font-semibold">{fmt(p.amount)}</td>
                                            <td className={`py-2 px-2 text-right font-mono ${dk ? "text-white/50" : "text-slate-500"}`}>{p.taxAmount ? fmt(p.taxAmount) : "—"}</td>
                                            <td className={`py-2 px-2 ${dk ? "text-white/40" : "text-slate-400"} text-xs`}>{p.invoiceNumber || "—"}</td>
                                            <td className="py-2 px-2 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {(() => { const f = achatsFiles.find(f => p.notes?.includes(f.originalName)); if (!f) return null; const sent = (f.emailedTo || []).includes(ACCOUNTANT_EMAIL); return (<>
                                                        <div title={sent ? `✓ Envoyé au comptable` : `À envoyer au comptable`} className={`flex items-center justify-center w-4 h-4 rounded border-2 flex-shrink-0 ${sent ? "bg-green-500/15 border-green-500/50" : dk ? "border-slate-500 bg-transparent" : "border-slate-300 bg-transparent"}`}>{sent && <Check className="w-2.5 h-2.5 text-green-400 stroke-[3]" />}</div>
                                                        <button onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugu-management/files/${f.id}/download`, "_blank")} className="p-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 transition-colors" title={`Voir facture: ${f.originalName}`}><Eye className="w-3 h-3" /></button>
                                                    </>); })()}
                                                    {!restricted && <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>}
                                                    {!restricted && <button onClick={() => { if (confirm("Supprimer cet achat ?")) deleteMut.mutate(p.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>}
                                                </div>
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                                {!restricted && <button onClick={() => togglePaid.mutate(p)}
                                                    className={`w-6 h-6 rounded-full border flex items-center justify-center ${p.isPaid ? "bg-green-500/20 border-green-500/50 text-green-400" : `${dk ? "border-white/20" : "border-slate-300"} ${dk ? "text-white/30" : "text-slate-300"}`}`}>
                                                    {p.isPaid && <Check className="w-3 h-3" />}
                                                </button>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-orange-500/30 bg-orange-500/5">
                                    <td className={`py-3 px-2 font-bold ${dk ? "text-white/80" : "text-slate-800"}`} colSpan={3}>TOTAL TTC</td>
                                    <td className="py-3 px-2 text-right font-mono font-bold text-orange-400 text-base">{fmt(filteredTotalTTC)}</td>
                                    <td className="py-3 px-2 text-right font-mono text-orange-300">{fmt(filteredTotalTVA)}</td>
                                    <td colSpan={3}></td>
                                </tr>
                            </tfoot>
                        </table>
                        <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 py-3 text-xs sm:text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2 flex-wrap">{filtered.length} lignes • Page {page}/{totalPages}<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>/page</span>
                            <div className="flex gap-1.5 sm:gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(1)} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
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
                    <FormSelect aria-label="Catégorie" className={ic} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                        {PURCHASE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </FormSelect>
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
                        <FormSelect aria-label="Mode de paiement" className={ic} value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
                            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{catLabel(m)}</option>)}
                        </FormSelect>
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
                    <FormSelect aria-label="Catégorie" className={ic} value={editForm.category || "alimentaire"} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                        {PURCHASE_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </FormSelect>
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
                        <FormSelect aria-label="Mode de paiement" className={ic} value={editForm.paymentMethod || ""} onChange={e => setEditForm({ ...editForm, paymentMethod: e.target.value })}>
                            <option value="">—</option>
                            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{catLabel(m)}</option>)}
                        </FormSelect>
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
            <CategoryFiles category="achats" label="Achats" restricted={restricted} />
            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
            <FileUploadModal open={showUploadModal} onClose={() => setShowUploadModal(false)} />
        </div>
    );
}

