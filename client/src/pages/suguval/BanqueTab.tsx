import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Landmark, CreditCard, Plus, Trash2, Edit, Edit2, Check, X, TrendingUp, TrendingDown, AlertTriangle, Upload, FileText, Loader2, Image, Download, Search, ChevronUp, ChevronDown, Eye, Paperclip, Mail, ArrowLeftRight } from "lucide-react";
import { useSuguDark } from "./context";
import { useAuth } from "@/hooks/use-auth";
import { BankEntry, SuguFile, Loan, fmt, fmtEur, fmtEurSigned, fmtDate, fmtDateShort, safeFloat, bankOpType, normalizeCatKey } from "./types";
import { Card, StatCard, FormModal, Field, useInputClass, FormSelect, CardSizeToggle, btnPrimary, btnDanger, CategoryBadge, categoryLabels, PeriodFilter, usePeriodFilter } from "./shared";
import { FilePreviewModal, SendEmailModal, CategoryFiles, fmtSize } from "./fileModals";
import { uploadFileAsBase64 } from "@/lib/uploadBase64";

// ====== BANQUE TAB ======
export function BanqueTab({ compactCards, setCompactCards, restricted }: { compactCards: boolean; setCompactCards: (v: boolean) => void; restricted?: boolean }) {
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
    const [loanSendEmailFile, setLoanSendEmailFile] = useState<SuguFile | null>(null);
    const [importingLoanDoc, setImportingLoanDoc] = useState(false);
    const [loanDocConfidence, setLoanDocConfidence] = useState<"high" | "medium" | "low" | null>(null);
    const [pendingLoanFile, setPendingLoanFile] = useState<File | null>(null);
    const { user: authUser } = useAuth();
    const pf = usePeriodFilter("year");
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
    const [showRapprochement, setShowRapprochement] = useState(false);
    const { data: unreconciledData, isLoading: unreconciledLoading, refetch: refetchUnreconciled } = useQuery<{ count: number; totalAmount: number; entries: any[] }>({
        queryKey: ["/api/v2/sugu-management/bank/unreconciled"],
        enabled: showRapprochement,
    });
    const [linkingEntryId, setLinkingEntryId] = useState<number | null>(null);
    const handleLinkReconcile = async (bankId: number, type: "purchase" | "expense", targetId: number) => {
        await fetch(`/api/v2/sugu-management/bank/${bankId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ isReconciled: true }) });
        if (type === "purchase") await fetch(`/api/v2/sugu-management/purchases/${targetId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ isPaid: true }) });
        else await fetch(`/api/v2/sugu-management/expenses/${targetId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ isPaid: true }) });
        setLinkingEntryId(null);
        toast({ title: "Rapprochement effectué", description: "L'écriture a été liée et marquée comme réglée." });
        refetchUnreconciled();
        qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] });
        qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] });
        qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/expenses"] });
    };
    const [resettingBank, setResettingBank] = useState(false);
    const handleBankReset = async () => {
        if (!confirm("⚠️ ATTENTION : Supprimer TOUTES les écritures bancaires et fichiers banque de Valentine ? Cette action est irréversible.")) return;
        setResettingBank(true);
        try {
            const r = await fetch("/api/v2/sugu-management/bank-reset-all", { method: "DELETE", credentials: "include" });
            const data = await r.json();
            if (data.success) {
                toast({ title: "Reset effectué", description: "Toutes les écritures bancaires ont été supprimées." });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
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
            const baseEndpoint = ext === "csv" ? "/api/v2/sugu-management/bank/import-csv" : "/api/v2/sugu-management/bank/import-pdf";
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
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] });
                try {
                    await uploadFileAsBase64("/api/v2/sugu-management/files", file, {
                        category: "banque",
                        description: `Relevé bancaire importé — ${data.message || file.name}`,
                    });
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
                } catch {}
            }
        } catch (err) {
            toast({ title: "Erreur", description: "Impossible d'importer le fichier", variant: "destructive" });
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const { data: bankEntries = [] } = useQuery<BankEntry[]>({ queryKey: ["/api/v2/sugu-management/bank"] });
    const { data: loans = [] } = useQuery<Loan[]>({ queryKey: ["/api/v2/sugu-management/loans"] });

    const createBankMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugu-management/bank", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] }); setShowBankForm(false); setBankForm({ bankName: "", isReconciled: false, entryDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Écriture ajoutée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible d'ajouter l'écriture", variant: "destructive" }); }
    });
    const updateBankMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugu-management/bank/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] }); setShowBankForm(false); setEditingBankId(null); setBankForm({ bankName: "", isReconciled: false, entryDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Écriture modifiée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier l'écriture", variant: "destructive" }); }
    });
    const toggleReconcileMut = useMutation({
        mutationFn: ({ id, isReconciled }: { id: number; isReconciled: boolean }) => apiRequest("PUT", `/api/v2/sugu-management/bank/${id}`, { isReconciled }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de modifier le rapprochement", variant: "destructive" }); }
    });
    const deleteBankMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/bank/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] }); toast({ title: "Écriture supprimée" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer l'écriture", variant: "destructive" }); }
    });
    const flipBankSignMut = useMutation({
        mutationFn: (entry: BankEntry) => apiRequest("PUT", `/api/v2/sugu-management/bank/${entry.id}`, { ...entry, amount: -entry.amount }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] }); toast({ title: "Signe inversé", description: "Débit ↔ Crédit corrigé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible d'inverser le signe", variant: "destructive" }); }
    });
    const createLoanMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugu-management/loans", data),
        onSuccess: async (newLoan: any) => {
            if (pendingLoanFile && newLoan?.id) {
                try {
                    const uploadRes = await uploadFileAsBase64("/api/v2/sugu-management/files", pendingLoanFile, {
                        category: "emprunt",
                        fileType: "file",
                        description: `Contrat emprunt — ${pendingLoanFile.name}`,
                    });
                    if (uploadRes.ok) {
                        const uploadData = await uploadRes.json();
                        await fetch(`/api/v2/sugu-management/loans/${newLoan.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalFileId: uploadData.id }) });
                        await qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/loans"] });
                    } else {
                        toast({ title: "Fichier non joint", description: "Le contrat a été créé mais le PDF n'a pas pu être joint — utilisez le trombone pour le joindre manuellement.", variant: "destructive" });
                    }
                } catch (e) {
                    toast({ title: "Fichier non joint", description: "Le contrat a été créé mais le PDF n'a pas pu être joint — utilisez le trombone pour le joindre manuellement.", variant: "destructive" });
                }
                setPendingLoanFile(null);
            }
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/loans"] });
            setShowLoanForm(false); setEditingLoan(null); setLoanForm({ bankName: "", loanType: "emprunt" }); setLoanDocConfidence(null);
            toast({ title: "Financement ajouté" });
        },
        onError: () => { toast({ title: "Erreur", description: "Impossible d'ajouter le financement", variant: "destructive" }); }
    });
    const updateLoanMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugu-management/loans/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/loans"] }); setShowLoanForm(false); setEditingLoan(null); setLoanForm({ bankName: "", loanType: "emprunt" }); toast({ title: "Financement mis à jour" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de mettre à jour le financement", variant: "destructive" }); }
    });
    const deleteLoanMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/loans/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/loans"] }); toast({ title: "Financement supprimé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le financement", variant: "destructive" }); }
    });

    const periodEntries = useMemo(() => bankEntries.filter(e => e.entryDate >= pf.period.from && e.entryDate <= pf.period.to), [bankEntries, pf.period.from, pf.period.to]);
    const totalCredit = periodEntries.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const totalDebit = periodEntries.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);

    // Compute running balance: sort chronologically, derive opening balance from first known balance, then cumulate
    const balanceMap = new Map<number, number>();
    const chronoEntries = [...periodEntries].sort((a, b) => {
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
    const reconciledCount = periodEntries.filter(e => e.isReconciled).length;
    const unreconciledCount = periodEntries.length - reconciledCount;

    useEffect(() => { setBankPage(1); }, [bankSearch, reconciledFilter, bankFlowFilter, pf.period.from, pf.period.to]);

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
            <PeriodFilter periodKey={pf.periodKey} setPeriod={pf.setPeriod} customFrom={pf.customFrom} setCustomFrom={pf.setCustomFrom} customTo={pf.customTo} setCustomTo={pf.setCustomTo} />
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
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 items-center">
                <div className={`col-span-2 flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2`}>
                    <Search className={`w-4 h-4 flex-shrink-0 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <input value={bankSearch} onChange={e => setBankSearch(e.target.value)} placeholder="Rechercher libellé, banque..." className="bg-transparent w-full text-sm focus:outline-none" />
                </div>
                <FormSelect title="Filtrer par rapprochement" className={ic} value={reconciledFilter} onChange={e => setReconciledFilter(e.target.value as any)}>
                    <option value="all">Toutes écritures</option>
                    <option value="yes">Rapprochées</option>
                    <option value="no">Non rapprochées</option>
                </FormSelect>
                <FormSelect title="Filtrer par flux" className={ic} value={bankFlowFilter} onChange={e => setBankFlowFilter(e.target.value as any)}>
                    <option value="all">Crédits + Débits</option>
                    <option value="credit">Crédits</option>
                    <option value="debit">Débits</option>
                </FormSelect>
                <button onClick={exportBankCSV} className={`col-span-2 sm:col-span-1 px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap`}>Export CSV</button>
                <button onClick={() => setShowRapprochement(v => !v)} data-testid="button-toggle-rapprochement" className={`px-3 py-2 text-sm rounded-lg border font-medium transition whitespace-nowrap ${showRapprochement ? "bg-orange-500/20 border-orange-500/40 text-orange-400" : dk ? "border-white/20 text-white/60 hover:bg-white/5" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    🔗 Rapprochement {unreconciledCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-orange-500/30 text-orange-300 text-xs">{unreconciledCount}</span>}
                </button>
            </div>
            {/* ── Rapprochement Panel ── */}
            {showRapprochement && (
                <div className={`rounded-xl border ${dk ? "border-orange-500/20 bg-orange-500/5" : "border-orange-200 bg-orange-50"} p-4 space-y-4`} data-testid="rapprochement-panel">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className={`font-semibold text-sm ${dk ? "text-white" : "text-slate-800"}`}>Rapprochement bancaire</h3>
                            <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Liez les débits bancaires aux factures fournisseurs correspondantes (±10%)</p>
                        </div>
                        {unreconciledData && (
                            <div className="text-right text-xs">
                                <div className={`font-bold ${dk ? "text-orange-300" : "text-orange-700"}`}>{unreconciledData.entries.length} entrée{unreconciledData.entries.length !== 1 ? "s" : ""} à rapprocher</div>
                                <div className={`${dk ? "text-white/50" : "text-slate-500"}`}>{Number(unreconciledData.totalAmount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} non réconciliés</div>
                            </div>
                        )}
                    </div>
                    {unreconciledLoading && <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Chargement...</div>}
                    {unreconciledData && unreconciledData.entries.length === 0 && (
                        <div className={`text-center py-6 text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>✅ Tout est rapproché — aucune écriture en attente</div>
                    )}
                    {unreconciledData && unreconciledData.entries.map((entry: any) => (
                        <div key={entry.id} className={`rounded-lg border ${dk ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"} p-3 space-y-2`} data-testid={`reconcile-entry-${entry.id}`}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className={`font-medium text-sm ${dk ? "text-white" : "text-slate-800"}`}>{entry.label}</div>
                                    <div className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{entry.entryDate} — {entry.bankName}</div>
                                </div>
                                <div className="text-red-400 font-bold">{Math.abs(entry.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
                            </div>
                            {(entry.matchingPurchases.length > 0 || entry.matchingExpenses.length > 0) ? (
                                <div className="space-y-1">
                                    <div className={`text-xs font-medium ${dk ? "text-white/60" : "text-slate-500"}`}>Factures correspondantes (montant ±10%) :</div>
                                    {entry.matchingPurchases.map((p: any) => (
                                        <div key={`p-${p.id}`} className="flex items-center justify-between gap-2">
                                            <span className={`text-xs ${dk ? "text-white/70" : "text-slate-600"}`}>🛒 {p.supplier} — {Number(p.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} ({p.invoiceDate})</span>
                                            <button
                                                onClick={() => handleLinkReconcile(entry.id, "purchase", p.id)}
                                                disabled={linkingEntryId === entry.id}
                                                data-testid={`button-link-purchase-${p.id}`}
                                                className="flex-shrink-0 px-2 py-0.5 text-xs rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition disabled:opacity-50">
                                                Lier
                                            </button>
                                        </div>
                                    ))}
                                    {entry.matchingExpenses.map((x: any) => (
                                        <div key={`x-${x.id}`} className="flex items-center justify-between gap-2">
                                            <span className={`text-xs ${dk ? "text-white/70" : "text-slate-600"}`}>💳 {x.description} — {Number(x.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} ({x.expenseDate})</span>
                                            <button
                                                onClick={() => handleLinkReconcile(entry.id, "expense", x.id)}
                                                disabled={linkingEntryId === entry.id}
                                                data-testid={`button-link-expense-${x.id}`}
                                                className="flex-shrink-0 px-2 py-0.5 text-xs rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition disabled:opacity-50">
                                                Lier
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>Aucune facture correspondante trouvée</div>
                            )}
                            <button
                                onClick={async () => {
                                    await fetch(`/api/v2/sugu-management/bank/${entry.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ isReconciled: true }) });
                                    toast({ title: "Écriture rapprochée manuellement" });
                                    refetchUnreconciled();
                                    qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/bank"] });
                                }}
                                data-testid={`button-reconcile-manual-${entry.id}`}
                                className={`text-xs px-2 py-1 rounded-lg border ${dk ? "border-white/15 text-white/40 hover:text-white/60" : "border-slate-200 text-slate-400 hover:text-slate-600"} transition`}>
                                Marquer rapproché (sans lier)
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {/* Hidden loan import input (parse + prefill) */}
            <input ref={loanImportInputRef} type="file" accept=".pdf" className="hidden"
                onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImportingLoanDoc(true);
                    try {
                        const res = await uploadFileAsBase64("/api/v2/sugu-management/loans/parse-document", file);
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
                        const uploadRes = await uploadFileAsBase64("/api/v2/sugu-management/files", file, {
                            category: "emprunt",
                            fileType: "file",
                            description: `Contrat emprunt — ${file.name}`,
                        });
                        if (!uploadRes.ok) { toast({ title: "Erreur upload", variant: "destructive" }); return; }
                        const uploadData = await uploadRes.json();
                        await fetch(`/api/v2/sugu-management/loans/${attachingLoanId}`, {
                            method: "PUT", credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ originalFileId: uploadData.id })
                        });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/loans"] });
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
                                {!restricted && <button onClick={() => { setEditingLoan(null); setLoanForm({ bankName: "", loanType: "emprunt" }); setLoanDocConfidence(null); setPendingLoanFile(null); setShowLoanForm(true); }} className={btnPrimary}><Plus className="w-4 h-4" /> Nouveau</button>}
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
                                    <p className="text-lg font-bold font-mono text-orange-400">{fmtEur(totalMonthly)}<span className={`text-xs ${dk ? "text-white/30" : "text-slate-400"}`}>/mois</span></p>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"}`}>{fmtEur(totalMonthly * 12)}/an</p>
                                </div>
                                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3`}>
                                    <p className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"} mb-0.5`}>Capital restant dû</p>
                                    <p className="text-lg font-bold font-mono text-red-400">{fmtEur(totalRemaining)}</p>
                                    <div className={`mt-1.5 ${dk ? "bg-white/10" : "bg-slate-200"} rounded-full h-1.5 overflow-hidden`}>
                                        <div className="bg-gradient-to-r from-orange-500 to-red-500 h-1.5 rounded-full transition-all" style={{ width: `${totalOriginal > 0 ? Math.round(((totalOriginal - totalRemaining) / totalOriginal) * 100) : 0}%` }} />
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
                                                </div>
                                                {/* Action buttons */}
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    {l.originalFile ? (
                                                        <>
                                                            <button
                                                                onClick={() => setLoanPreviewFile(l.originalFile!)}
                                                                className="p-1.5 rounded-lg transition bg-purple-500/10 hover:bg-purple-500/20 text-purple-400"
                                                                title={`Prévisualiser : ${l.originalFile.originalName}`}
                                                                data-testid={`btn-eye-loan-${l.id}`}
                                                            >
                                                                <Eye className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button onClick={() => { setAttachingLoanId(l.id); loanFileInputRef.current?.click(); }}
                                                                className="p-1.5 rounded-lg transition bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400"
                                                                title="Remplacer le document">
                                                                <Paperclip className="w-3.5 h-3.5" />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <button onClick={() => { setAttachingLoanId(l.id); loanFileInputRef.current?.click(); }}
                                                            className="p-1.5 rounded-lg transition bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400"
                                                            title="Joindre un document"
                                                            data-testid={`btn-attach-loan-${l.id}`}
                                                        >
                                                            <Paperclip className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    {!restricted && <button onClick={() => { setEditingLoan(l); setLoanForm({ ...l }); setShowLoanForm(true); }} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition" title="Modifier">
                                                        <Edit2 className="w-3.5 h-3.5 text-orange-400" />
                                                    </button>}
                                                    {!restricted && <button onClick={() => { if (confirm("Supprimer ce financement ?")) deleteLoanMut.mutate(l.id); }} className={btnDanger + " !p-1.5"} title="Supprimer">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>}
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
                                                        className={`h-2 rounded-full transition-all ${pct >= 75 ? "bg-gradient-to-r from-green-500 to-emerald-400" : pct >= 40 ? "bg-gradient-to-r from-orange-500 to-amber-400" : "bg-gradient-to-r from-red-500 to-orange-500"}`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between mt-0.5">
                                                    <span className={`text-[9px] ${dk ? "text-white/20" : "text-slate-300"}`}>{fmtEur(l.totalAmount - l.remainingAmount)} remboursé</span>
                                                    <span className={`text-[9px] ${dk ? "text-white/20" : "text-slate-300"}`}>{fmtEur(l.totalAmount)} initial</span>
                                                </div>
                                            </div>

                                            {/* Documents section */}
                                            {l.originalFile && (
                                                <div className={`mt-3 pt-3 border-t ${dk ? "border-white/5" : "border-slate-100"}`}>
                                                    <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${dk ? "text-white/30" : "text-slate-400"}`}>Documents</p>
                                                    <div className={`flex items-center gap-2 ${dk ? "bg-white/5 border-white/10 hover:bg-white/8" : "bg-white border-slate-200 hover:bg-slate-50"} border rounded-lg px-2 py-1.5 transition`}>
                                                        <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${l.originalFile.mimeType?.startsWith("image/") ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                                            {l.originalFile.mimeType?.startsWith("image/")
                                                                ? <Image className="w-3 h-3 text-purple-400" />
                                                                : <FileText className="w-3 h-3 text-blue-400" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                                                            <p className={`text-xs font-medium truncate min-w-0 ${dk ? "text-white" : "text-slate-800"}`} title={l.originalFile.originalName}>{l.originalFile.originalName}</p>
                                                            <span className={`text-[11px] flex-shrink-0 ${dk ? "text-white/35" : "text-slate-400"}`}>{fmtDate(l.originalFile.createdAt)}</span>
                                                            <span className={`text-[11px] flex-shrink-0 ${dk ? "text-white/35" : "text-slate-400"}`}>{fmtSize(l.originalFile.fileSize)}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            <button onClick={() => setLoanPreviewFile(l.originalFile!)}
                                                                className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-1 rounded-lg text-xs hover:bg-purple-500/30 transition"
                                                                title="Aperçu" data-testid={`btn-preview-loan-doc-${l.id}`}>
                                                                <Eye className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button onClick={() => setLoanSendEmailFile(l.originalFile!)}
                                                                className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-1 rounded-lg text-xs hover:bg-blue-500/30 transition"
                                                                title="Envoyer par email" data-testid={`btn-email-loan-doc-${l.id}`}>
                                                                <Mail className="w-3.5 h-3.5" />
                                                            </button>
                                                            <a href={`/api/v2/sugu-management/files/${l.originalFile.id}/download`} download={l.originalFile.originalName}
                                                                className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-1 rounded-lg text-xs hover:bg-orange-500/30 transition flex items-center"
                                                                title="Télécharger" data-testid={`btn-download-loan-doc-${l.id}`}>
                                                                <Download className="w-3.5 h-3.5" />
                                                            </a>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                );
            })()}
            {loanPreviewFile && <FilePreviewModal file={loanPreviewFile} onClose={() => setLoanPreviewFile(null)} />}
            {loanSendEmailFile && <SendEmailModal file={loanSendEmailFile} onClose={() => setLoanSendEmailFile(null)} />}
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
                                    }} className="mt-2 px-3 py-1.5 bg-orange-500/20 border border-orange-500/40 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/30 transition">
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
                    !restricted ? <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        <input ref={fileInputRef} type="file" accept=".pdf,.csv" onChange={handleFileImport} className="hidden" aria-label="Importer fichier PDF ou CSV" />
                        <button onClick={() => fileInputRef.current?.click()} className={btnPrimary} disabled={importing} title="Importer un relevé PDF ou CSV">
                            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            <span className="hidden sm:inline">{importing ? "Import..." : "Importer PDF/CSV"}</span>
                            <span className="sm:hidden">{importing ? "..." : "Import"}</span>
                        </button>
                        <button onClick={() => setShowBankForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nouvelle Écriture</span><span className="sm:hidden">+</span></button>
                    </div> : undefined
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
                                        <td className="py-2 px-3 text-slate-600 whitespace-nowrap text-[12px]">{fmtDateShort(e.entryDate)}</td>
                                        <td className="py-2 px-3 max-w-[400px] truncate text-[12px]" title={e.label}>{e.label}</td>
                                        <td className="py-2 px-3"><CategoryBadge cat={e.category} /></td>
                                        <td className="py-2 px-3 text-right font-mono text-red-400 text-[12px]">{e.amount < 0 ? `-${fmtEur(e.amount)}` : ""}</td>
                                        <td className="py-2 px-3 text-right font-mono text-green-400 text-[12px]">{e.amount > 0 ? `+${fmtEur(e.amount)}` : ""}</td>
                                        <td className="py-2 px-3 text-right font-mono text-green-400 text-[12px]">{fmtEurSigned(balanceMap.get(e.id) ?? 0)}</td>
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
                                        {!restricted && <td className="py-2 px-2 text-right flex gap-1 justify-end">
                                            <button
                                                onClick={() => flipBankSignMut.mutate(e)}
                                                disabled={flipBankSignMut.isPending}
                                                title={e.amount > 0 ? "Inverser : passer en débit (−)" : "Inverser : passer en crédit (+)"}
                                                data-testid={`button-flip-sign-${e.id}`}
                                                className={`inline-flex items-center justify-center w-6 h-6 rounded-lg border text-xs transition ${e.amount > 0 ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-green-500/40 text-green-400 hover:bg-green-500/10"} ${dk ? "bg-white/5" : "bg-white"} disabled:opacity-40`}
                                            >
                                                <ArrowLeftRight className="w-3 h-3" />
                                            </button>
                                            <button onClick={() => { setEditingBankId(e.id); setBankForm({ bankName: e.bankName, entryDate: e.entryDate, label: e.label, amount: e.amount, balance: e.balance, category: e.category, isReconciled: e.isReconciled, notes: e.notes }); setShowBankForm(true); }} className={btnPrimary} title="Modifier"><Edit className="w-3 h-3" /></button>
                                            <button onClick={() => { if (confirm("Supprimer cette écriture ?")) deleteBankMut.mutate(e.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                        </td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 py-3 text-xs sm:text-sm ${dk ? "text-white/70" : "text-slate-700"}`}>
                            <span className="flex items-center gap-2 flex-wrap">{displayEntries.length} écritures • Page {bankCurrentPage}/{bankTotalPages}
                                <select value={bankPageSize} onChange={e => { setBankPageSize(Number(e.target.value)); setBankPage(1); }} className={`px-2 py-0.5 rounded-lg border text-xs ${dk ? "bg-[#1e1e2e] border-white/10 text-white/70" : "bg-white border-slate-200 text-slate-700"}`} style={dk ? { colorScheme: "dark" } : undefined}>
                                    <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                                </select>/page
                            </span>
                            <div className="flex gap-1.5 sm:gap-2">
                                <button disabled={bankPage <= 1} onClick={() => setBankPage(1)} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E4;</button>
                                <button disabled={bankPage <= 1} onClick={() => setBankPage(p => Math.max(1, p - 1))} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Préc.</button>
                                <button disabled={bankPage >= bankTotalPages} onClick={() => setBankPage(p => Math.min(bankTotalPages, p + 1))} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>Suiv.</button>
                                <button disabled={bankPage >= bankTotalPages} onClick={() => setBankPage(bankTotalPages)} className={`px-2 sm:px-3 py-1 rounded-lg ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} disabled:opacity-40`}>&#x21E5;</button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>
            <CategoryFiles category="banque" label="Banque" restricted={restricted} />
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
                    <FormSelect aria-label="Catégorie" className={ic} value={bankForm.category || ""} onChange={e => setBankForm({ ...bankForm, category: e.target.value || undefined })}>
                        <option value="">— Aucune —</option>
                        {Object.entries(categoryLabels).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
                    </FormSelect>
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
                    <FormSelect className={ic} value={loanForm.loanType || "emprunt"} onChange={e => setLoanForm({ ...loanForm, loanType: e.target.value })}>
                        <option value="emprunt">🏦 Emprunt bancaire</option>
                        <option value="loa">🚗 LOA — Location avec Option d'Achat</option>
                        <option value="lld">📋 LLD — Location Longue Durée</option>
                    </FormSelect>
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
        </div>
    );
}


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
                        <button
                            key={ds}
                            onClick={() => handleClick(ds)}
                            onMouseEnter={() => { if (dateFrom && !dateTo) setHoverDate(ds); }}
                            onMouseLeave={() => setHoverDate("")}
                            data-testid={`cal-day-${ds}`}
                            className={[
                                "text-xs py-1.5 w-full rounded transition-colors leading-none",
                                isStart || isEnd ? "bg-orange-500 text-white font-bold" : "",
                                inRange && !isStart && !isEnd ? (dk ? "bg-orange-500/25 text-orange-200" : "bg-orange-100 text-orange-700") : "",
                                !isStart && !isEnd && !inRange ? (dk ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-100 text-slate-700") : "",
                                isToday && !isStart && !isEnd ? "ring-1 ring-orange-400 ring-inset" : "",
                            ].join(" ")}
                        >{parseInt(ds.slice(8))}</button>
                    );
                })}
            </div>
            {(dateFrom || dateTo) && (
                <div className={`mt-3 pt-2 border-t text-xs ${dk ? "border-white/10 text-white/40" : "border-slate-100 text-slate-400"}`}>
                    <span className="font-medium text-orange-400">{dateFrom || "…"}</span> → <span className="font-medium text-orange-400">{dateTo || "…"}</span>
                </div>
            )}
        </div>
    );
}

