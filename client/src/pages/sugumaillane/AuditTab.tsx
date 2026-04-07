import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { uploadFileAsBase64 } from "@/lib/uploadBase64";
import type { AuditOverview, Supplier } from "../sugu/types";
import { FILE_CATEGORIES, fmt, t, catLabel } from "../sugu/helpers";
import { useSuguDark, Card, StatCard, Field, useInputClass, btnPrimary } from "./shared";
import {
  Loader2,
  File,
  X,
  Upload,
  Key,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  TrendingDown,
  Calendar,
  UserCheck,
  Building2,
  FileText,
  Image,
  Download,
  Receipt,
  Landmark,
  Users,
} from "lucide-react";

export function AuditTab() {
    const dk = useSuguDark();
    const ic = useInputClass();
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear.toString());
    const [yearSynced, setYearSynced] = useState(false);
    const { toast } = useToast();
    const { data: audit, isLoading } = useQuery<AuditOverview>({ queryKey: [`/api/v2/sugumaillane-management/audit/overview?year=${selectedYear}`] });

    useEffect(() => {
        if (audit && !yearSynced && audit.year !== selectedYear) {
            setSelectedYear(audit.year);
            setYearSynced(true);
        }
    }, [audit, yearSynced, selectedYear]);

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
            ["Ticket moyen", String(audit.avgTicket)],
            ["CA moyen/jour", String(audit.avgDailyRevenue)],
            ["Couverts", String(audit.totalCovers)],
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
            {/* Year selector + export */}
            <div className="flex items-center gap-3">
                <select title="Sélectionner l'année" className={ic + " w-32"} value={selectedYear} onChange={e => { setSelectedYear(e.target.value); setYearSynced(true); }}>
                    {(audit.availableYears && audit.availableYears.length > 0
                        ? [...new Set([...audit.availableYears, currentYear.toString()])].sort((a, b) => Number(b) - Number(a))
                        : Array.from({ length: 5 }, (_, i) => (currentYear - i).toString())
                    ).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <h2 className={`text-lg font-bold ${dk ? "text-white" : "text-slate-800"}`}>Bilan comptable — {audit.year}</h2>
                <button onClick={exportAuditCSV} className={`ml-auto px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap flex items-center gap-1`}><Download className="w-3 h-3" /> Export CSV</button>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label={`CA ${selectedYear}`} value={fmt(audit.totalRevenue)} icon={DollarSign} color="green" />
                <StatCard label="Coûts totaux" value={fmt(audit.totalCosts)} icon={TrendingDown} color="red" />
                <StatCard label="Résultat d'exploitation" value={fmt(audit.operatingProfit)} icon={TrendingUp} color={audit.operatingProfit >= 0 ? "green" : "red"} />
                <StatCard label="Marge" value={`${audit.profitMargin}%`} icon={BarChart3} color={(parseFloat(audit.profitMargin) || 0) >= 0 ? "green" : "red"} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Ticket moyen" value={fmt(audit.avgTicket)} icon={Receipt} color="orange" />
                <StatCard label="CA moyen/jour" value={fmt(audit.avgDailyRevenue)} icon={Calendar} color="blue" />
                <StatCard label="Couverts total" value={String(audit.totalCovers)} icon={Users} color="purple" />
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
                                    <div className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full rounded-full flex items-center justify-end pr-2 transition-all min-w-[40px]" style={{ width: `${Math.round((revenue / maxRev) * 100)}%` }}>
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
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[
                        { label: "Achats", value: audit.costBreakdown.achats, color: "from-teal-500/20 to-teal-600/10 border-teal-500/20" },
                        { label: "Frais Généraux", value: audit.costBreakdown.fraisGeneraux, color: "from-blue-500/20 to-blue-600/10 border-blue-500/20" },
                        { label: "Salaires", value: audit.costBreakdown.salaires, color: "from-purple-500/20 to-purple-600/10 border-purple-500/20" },
                        { label: "Charges Sociales", value: audit.costBreakdown.chargesSociales, color: "from-red-500/20 to-red-600/10 border-red-500/20" },
                        { label: "Emprunts", value: audit.costBreakdown.emprunts, color: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/20" },
                    ].map(item => (
                        <div key={item.label} className={`bg-gradient-to-br ${item.color} border rounded-xl p-4`}>
                            <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{item.label}</p>
                            <p className="text-xl font-bold font-mono">{fmt(item.value ?? 0)}</p>
                            <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{audit.totalCosts > 0 ? (((item.value ?? 0) / audit.totalCosts) * 100).toFixed(1) : 0}%</p>
                        </div>
                    ))}
                </div>
                {/* Visual bar */}
                {audit.totalCosts > 0 && (
                    <div className="mt-4">
                        <div className="flex gap-0.5 h-4 rounded-full overflow-hidden">
                            {[
                                { value: audit.costBreakdown.achats, color: "bg-teal-500" },
                                { value: audit.costBreakdown.fraisGeneraux, color: "bg-blue-500" },
                                { value: audit.costBreakdown.salaires, color: "bg-purple-500" },
                                { value: audit.costBreakdown.chargesSociales, color: "bg-red-500" },
                                { value: audit.costBreakdown.emprunts, color: "bg-yellow-500" },
                            ].map((item, i) => {
                                const pct = (item.value / audit.totalCosts) * 100;
                                if (pct < 0.5) return null;
                                return <div key={i} className={`${item.color} h-full transition-all`} style={{ width: `${pct}%` }} />;
                            })}
                        </div>
                    </div>
                )}
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
                        <div className="flex items-center gap-3 bg-teal-500/10 border border-teal-500/20 rounded-xl p-3">
                            <TrendingDown className="w-5 h-5 text-teal-400" />
                            <div>
                                <p className="text-sm font-medium text-teal-400">Marge faible</p>
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

// ====== FILE UPLOAD MODAL ======
export function FileUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [fileType, setFileType] = useState<"photo" | "file">("file");
    const [category, setCategory] = useState("achats");
    const [supplier, setSupplier] = useState("");
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [fileDate, setFileDate] = useState(new Date().toISOString().substring(0, 10));
    const [parsePreviewLoading, setParsePreviewLoading] = useState(false);
    const [parsePreviewData, setParsePreviewData] = useState<{ parsed: any; confidence: number; matchedSupplier: any | null } | null>(null);
    const [parsePreviewError, setParsePreviewError] = useState<string | null>(null);

    if (!open) return null;

    const triggerParsePreview = async (file: File) => {
        if (!["achats", "frais_generaux"].includes(category)) return;
        setParsePreviewData(null);
        setParsePreviewError(null);
        setParsePreviewLoading(true);
        try {
            const res = await uploadFileAsBase64("/api/v2/sugumaillane-management/files/parse-preview", file, { category });
            const data = await res.json();
            if (data.success && data.parsed) {
                setParsePreviewData(data);
                if (data.parsed.supplier && !supplier) setSupplier(data.parsed.supplier);
                if (data.parsed.amount && !amount) setAmount(String(data.parsed.amount));
                if (data.parsed.date) {
                    const parsedMs = new Date(data.parsed.date).getTime();
                    const eighteenMonthsAgo = Date.now() - 18 * 30 * 24 * 60 * 60 * 1000;
                    const sixMonthsAhead = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
                    if (!isNaN(parsedMs) && parsedMs >= eighteenMonthsAgo && parsedMs <= sixMonthsAhead) {
                        setFileDate(data.parsed.date);
                    } else {
                        console.warn(`[FileUpload-M] AI date "${data.parsed.date}" out of range, keeping form date`);
                    }
                }
            } else {
                setParsePreviewError("Parsing automatique non disponible pour ce fichier — vérifiez les champs manuellement.");
            }
        } catch {
            setParsePreviewError("Erreur lors du parsing automatique.");
        } finally {
            setParsePreviewLoading(false);
        }
    };

    const handleUpload = async () => {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
            toast({ title: "Aucun fichier sélectionné", variant: "destructive" });
            return;
        }
        setUploading(true);
        try {
            const extra: Record<string, string> = { category, fileType };
            if (supplier) extra.supplier = supplier;
            if (amount) extra.amount = amount;
            if (description) extra.description = description;
            extra.fileDate = fileDate;
            if (parsePreviewData?.parsed) {
                extra.parsedJson = JSON.stringify(parsePreviewData.parsed);
            }

            const res = await uploadFileAsBase64("/api/v2/sugumaillane-management/files", file, extra);
            const data = await res.json();
            if (!res.ok) {
                toast({ title: "Erreur", description: data.error, variant: "destructive" });
            } else {
                const catLabel = FILE_CATEGORIES.find(c => c.value === category)?.label;
                if (data.autoCreateError) {
                    toast({ title: "Fichier transféré (frais non créé)", description: `${file.name} → ${catLabel}. Erreur: ${data.autoCreateError}`, variant: "destructive" });
                } else if (data.linkedExpenseId) {
                    toast({ title: "Fichier transféré + frais créé", description: `${file.name} → ${catLabel} (frais #${data.linkedExpenseId})` });
                } else if (data.multiInvoice && data.invoiceCount > 1) {
                    toast({ title: `${data.invoiceCount} factures détectées et créées`, description: `${file.name} → ${catLabel} (achats #${data.linkedPurchaseIds?.join(", #")})` });
                } else if (data.linkedPurchaseId) {
                    toast({ title: "Fichier transféré + achat créé", description: `${file.name} → ${catLabel} (achat #${data.linkedPurchaseId})` });
                } else if (data.autoDetected && data.employeeCreated) {
                    toast({ title: "Bulletin importé + employé créé", description: `${file.name} → Employé et fiche de paie créés automatiquement` });
                } else if (data.autoDetected) {
                    toast({ title: "Bulletin importé + paie ajoutée", description: `${file.name} → Fiche de paie ajoutée à l'employé existant` });
                } else {
                    toast({ title: "Fichier transféré", description: `${file.name} → ${catLabel}` });
                }
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/expenses"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/purchases"] });
                if (data.autoDetected) {
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
                }
                onClose();
                setSupplier(""); setAmount(""); setDescription(""); setFileType("file");
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        } catch {
            toast({ title: "Erreur", description: "Impossible de transférer le fichier", variant: "destructive" });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className={`${dk ? "bg-slate-900" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl w-full max-w-lg`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} flex items-center gap-2`}>
                        <Upload className="w-5 h-5 text-emerald-400" />
                        Transférer un Fichier
                    </h3>
                    <button onClick={onClose} className={`p-1 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`} title="Fermer"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">
                    {/* File Type Choice */}
                    <div>
                        <label className={`block text-sm ${dk ? "text-white/60" : "text-slate-600"} mb-2`}>Type de transfert</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => setFileType("photo")}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition ${fileType === "photo" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"} ${dk ? "text-white/50" : "text-slate-500"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}`}>
                                <Image className="w-5 h-5" /> Photo
                            </button>
                            <button onClick={() => setFileType("file")}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition ${fileType === "file" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"} ${dk ? "text-white/50" : "text-slate-500"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}`}>
                                <FileText className="w-5 h-5" /> Fichier
                            </button>
                        </div>
                    </div>

                    {/* Category */}
                    <Field label="Catégorie">
                        <select aria-label="Catégorie" className={ic} value={category} onChange={e => setCategory(e.target.value)}>
                            {FILE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                    </Field>

                    {/* File Input */}
                    <Field label={fileType === "photo" ? "Sélectionner une photo" : "Sélectionner un fichier"}>
                        <input ref={fileInputRef} type="file"
                            aria-label={fileType === "photo" ? "Sélectionner une photo" : "Sélectionner un fichier"}
                            accept={fileType === "photo" ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"}
                            className={ic + " file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-emerald-500/20 file:text-emerald-400"}
                            onChange={e => { const f = e.target.files?.[0]; if (f) triggerParsePreview(f); }} />
                    </Field>

                    {/* ── Parse Preview Panel ── */}
                    {parsePreviewLoading && (
                        <div className={`flex items-center gap-2 p-3 rounded-xl border ${dk ? "border-blue-500/30 bg-blue-500/10" : "border-blue-200 bg-blue-50"}`}>
                            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                            <span className={`text-sm ${dk ? "text-blue-300" : "text-blue-700"}`}>Analyse IA en cours...</span>
                        </div>
                    )}
                    {parsePreviewError && (
                        <div className={`p-3 rounded-xl border text-sm ${dk ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                            ⚠️ {parsePreviewError}
                        </div>
                    )}
                    {parsePreviewData && !parsePreviewLoading && (() => {
                        const { parsed, confidence, matchedSupplier } = parsePreviewData;
                        const confColor = confidence >= 80 ? "emerald" : confidence >= 60 ? "amber" : "red";
                        const confLabel = confidence >= 80 ? "Haute confiance" : confidence >= 60 ? "Confiance moyenne" : "Vérifiez les données";
                        return (
                            <div className={`rounded-xl border ${dk ? "border-emerald-500/20 bg-emerald-500/5" : "border-emerald-200 bg-emerald-50"} p-3 space-y-2`} data-testid="parse-preview-panel">
                                <div className="flex items-center justify-between">
                                    <span className={`text-xs font-semibold ${dk ? "text-white/60" : "text-slate-500"}`}>Résultat de l'analyse IA</span>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${confColor === "emerald" ? "bg-emerald-500/20 text-emerald-400" : confColor === "amber" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                                        {confidence}% — {confLabel}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    {parsed.supplier && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">Fournisseur:</span> <strong>{parsed.supplier}</strong></div>}
                                    {parsed.amount && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">Montant:</span> <strong>{parsed.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong></div>}
                                    {parsed.date && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">Date:</span> <strong>{parsed.date}</strong></div>}
                                    {parsed.invoiceNumber && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">N° facture:</span> <strong>{parsed.invoiceNumber}</strong></div>}
                                    {parsed.taxAmount && <div className={`${dk ? "text-white/70" : "text-slate-600"}`}><span className="opacity-50">TVA:</span> <strong>{parsed.taxAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong></div>}
                                </div>
                                {matchedSupplier && (
                                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${dk ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700"}`}>
                                        🔗 <span>Fournisseur lié : <strong>{matchedSupplier.name}</strong></span>
                                    </div>
                                )}
                                {!matchedSupplier && parsed.supplier && (
                                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${dk ? "bg-slate-700/60 text-white/50" : "bg-slate-100 text-slate-500"}`}>
                                        ➕ Nouveau fournisseur détecté — sera créé automatiquement si besoin
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Supplier */}
                    <Field label="Fournisseur / Expéditeur (optionnel)">
                        <input className={ic} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Ex: Métro, SCP Seguin, Elly..." data-testid="input-upload-supplier" />
                    </Field>

                    {/* Amount */}
                    {(category === "achats" || category === "frais_generaux") && (
                        <Field label="Montant TTC (€) — extrait du PDF sinon renseignez-le">
                            <input type="number" step="0.01" className={ic} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ex: 484.38" data-testid="input-upload-amount" />
                        </Field>
                    )}

                    {/* Description */}
                    <Field label="Description (optionnel)">
                        <input className={ic} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Facture décembre 2024" />
                    </Field>

                    {/* Date */}
                    <Field label="Date du document">
                        <input aria-label="Date du document" type="date" className={ic} value={fileDate} onChange={e => setFileDate(e.target.value)} />
                    </Field>

                    <button onClick={handleUpload} className={btnPrimary + " w-full justify-center"} disabled={uploading}>
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? "Transfert en cours..." : "Transférer"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ====== ARCHIVES TAB ======
