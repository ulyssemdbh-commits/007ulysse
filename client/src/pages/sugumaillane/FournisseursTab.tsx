import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Supplier } from "../sugu/types";
import { PAYMENT_METHODS, fmt, fmtDate, catLabel } from "../sugu/helpers";
import { useSuguDark, Card, StatCard, FormModal, Field, useInputClass, btnPrimary, btnDanger, CategoryBadge } from "./shared";
import {
  Plus,
  Loader2,
  Trash2,
  Code,
  Search,
  Edit,
  Check,
  UserCheck,
  Building2,
  ChevronUp,
  ChevronDown,
  Receipt,
  ShoppingCart,
} from "lucide-react";

const SUPPLIER_CATEGORIES = ["alimentaire", "boissons", "emballages", "entretien", "comptabilite", "assurances", "vehicules", "plateformes", "materiels", "autre"];

export function FournisseursTab() {
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
