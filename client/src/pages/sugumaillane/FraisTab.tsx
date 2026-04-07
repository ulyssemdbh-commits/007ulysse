import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Expense, SuguFile, Supplier } from "../sugu/types";
import { EXPENSE_CATEGORIES, fmt, safeFloat, t, catLabel } from "../sugu/helpers";
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
  ChevronUp,
  ChevronDown,
  Receipt,
} from "lucide-react";

export function FraisTab({ compactCards, setCompactCards }: { compactCards: boolean; setCompactCards: (v: boolean) => void }) {
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
            const key = `${(e.label || "").toLowerCase()}|${e.amount}|${due ? due.toISOString().slice(0, 10) : e.period || ""}|${e.invoiceNumber || ""}`;
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
                <select title="Filtrer par statut de paiement" className={ic} value={paidFilter} onChange={e => setPaidFilter(e.target.value as "all" | "paid" | "unpaid")}>
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
                                            <td className={`py-2 px-2 text-left font-mono text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{e.invoiceNumber || "—"}</td>
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
                    <Field label="Date d'échéance"><input aria-label="Date d'échéance" type="date" className={ic} value={form.dueDate || ""} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
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
                    <Field label="Invoice N°"><input className={ic} value={editForm.invoiceNumber || ""} onChange={e => setEditForm({ ...editForm, invoiceNumber: e.target.value })} placeholder="Ex: F123456" /></Field>
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
