import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, Receipt, Users, Plus, Trash2, Edit, Check, TrendingUp, TrendingDown, DollarSign, UserCheck, Clock, AlertTriangle, Building2, Upload, FileText, Loader2, Search, ChevronUp, ChevronDown, Eye, FolderOpen, Download, X, RefreshCw, ArrowUpRight, ArrowDownRight, Minus, Briefcase, Calculator } from "lucide-react";
import { useSuguDark } from "./context";
import { Employee, Payroll, Absence, Supplier, SuguFile, CONTRACT_TYPES, ABSENCE_TYPES, PAYMENT_METHODS, fmt, fmtDate, safeFloat, catLabel } from "./types";
import { Card, StatCard, FormModal, Field, useInputClass, FormSelect, btnPrimary, btnDanger, CategoryBadge, PeriodFilter, usePeriodFilter } from "./shared";
import { CategoryFiles, FilePreviewModal, isFilePreviewable, isFileMimeImage, fmtSize } from "./fileModals";
import { uploadFileAsBase64 } from "@/lib/uploadBase64";

function EmployeeFilesSection({ employeeId, employeeName, restricted, payrollFileIds }: { employeeId: number; employeeName: string; restricted?: boolean; payrollFileIds?: Set<string> }) {
    const dk = useSuguDark();
    const qc = useQueryClient();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);

    const { data: allFiles = [], isLoading } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugu-management/files", "employee", employeeId],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugu-management/files?employeeId=${employeeId}`, { credentials: "include" });
            return res.json();
        }
    });

    const files = useMemo(() => {
        if (!payrollFileIds || payrollFileIds.size === 0) return allFiles;
        return allFiles.filter(f => !payrollFileIds.has(String(f.id)));
    }, [allFiles, payrollFileIds]);

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
            toast({ title: "Fichier supprimé" });
        },
    });

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const res = await uploadFileAsBase64("/api/v2/sugu-management/files", file, {
                category: "rh",
                employeeId: String(employeeId),
                description: `Document ${employeeName}`,
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Erreur upload"); }
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
            toast({ title: "Document ajouté", description: file.name });
        } catch (err: any) {
            toast({ title: "Erreur", description: err?.message || "Impossible d'uploader le fichier", variant: "destructive" });
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                    <FolderOpen className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <span className={`text-xs font-medium ${dk ? "text-white/50" : "text-slate-500"}`}>
                        Documents ({files.length})
                    </span>
                </div>
                {!restricted && (
                    <>
                        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={handleUpload} className="hidden" data-testid={`input-emp-file-${employeeId}`} />
                        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${dk ? "bg-white/5 hover:bg-white/10 text-white/60" : "bg-slate-100 hover:bg-slate-200 text-slate-600"} transition`} data-testid={`btn-upload-emp-file-${employeeId}`}>
                            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            {uploading ? "Upload..." : "Ajouter"}
                        </button>
                    </>
                )}
            </div>
            {isLoading ? (
                <div className="flex items-center justify-center py-2"><Loader2 className={`w-4 h-4 animate-spin ${dk ? "text-white/30" : "text-slate-300"}`} /></div>
            ) : files.length === 0 ? (
                <p className={`text-xs text-center py-2 ${dk ? "text-white/30" : "text-slate-400"}`}>Aucun document</p>
            ) : (
                <div className="space-y-1">
                    {files.map(f => (
                        <div key={f.id} className={`flex items-center gap-2 ${dk ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-slate-50 border-slate-200 hover:bg-slate-100"} border rounded-lg px-2 py-1.5 transition`} data-testid={`emp-file-row-${f.id}`}>
                            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                {isFileMimeImage(f.mimeType) ? <Eye className="w-2.5 h-2.5 text-purple-400" /> : <FileText className="w-2.5 h-2.5 text-blue-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium truncate ${dk ? "text-white/80" : "text-slate-700"}`} title={f.originalName}>{f.originalName}</p>
                                <p className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>{new Date(f.createdAt).toLocaleDateString("fr-FR")} • {fmtSize(f.fileSize)}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugu-management/files/${f.id}/download`, "_blank")}
                                    className={`p-1 rounded ${dk ? "hover:bg-white/10 text-purple-400" : "hover:bg-slate-200 text-purple-500"} transition`} title="Aperçu" data-testid={`btn-preview-emp-file-${f.id}`}>
                                    <Eye className="w-3 h-3" />
                                </button>
                                <a href={`/api/v2/sugu-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                    className={`p-1 rounded ${dk ? "hover:bg-white/10 text-blue-400" : "hover:bg-slate-200 text-blue-500"} transition`} title="Télécharger" data-testid={`btn-download-emp-file-${f.id}`}>
                                    <Download className="w-3 h-3" />
                                </a>
                                {!restricted && (
                                    <button onClick={() => { if (confirm(`Supprimer "${f.originalName}" ?`)) deleteMut.mutate(f.id); }}
                                        className={`p-1 rounded ${dk ? "hover:bg-red-500/20 text-red-400" : "hover:bg-red-100 text-red-500"} transition`} title="Supprimer" data-testid={`btn-delete-emp-file-${f.id}`}>
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        </div>
    );
}

const contractColor: Record<string, string> = { CDI: "text-green-400", CDD: "text-blue-400", Extra: "text-orange-400", Stage: "text-purple-400" };

function EmployeeCostSection({ employeeId, payrolls, dk }: { employeeId: number; payrolls: Payroll[]; dk: boolean }) {
    const empPayrolls = useMemo(() =>
        payrolls.filter(p => p.employeeId === employeeId).sort((a, b) => b.period.localeCompare(a.period)),
        [payrolls, employeeId]
    );

    if (empPayrolls.length === 0) return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center gap-1.5 mb-2">
                <Calculator className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                <span className={`text-xs font-medium ${dk ? "text-white/50" : "text-slate-500"}`}>Analyse des coûts</span>
            </div>
            <p className={`text-xs text-center py-2 ${dk ? "text-white/30" : "text-slate-400"}`}>Aucune fiche de paie</p>
        </div>
    );

    const totalGross = empPayrolls.reduce((s, p) => s + p.grossSalary, 0);
    const totalNet = empPayrolls.reduce((s, p) => s + p.netSalary, 0);
    const totalChargesSalariales = empPayrolls.reduce((s, p) => s + (p.socialCharges || 0), 0);
    const totalChargesPatronales = empPayrolls.reduce((s, p) => {
        if (p.employerCharges && Number(p.employerCharges) > 0) return s + Number(p.employerCharges);
        return s + Math.round(p.grossSalary * 0.13 * 100) / 100;
    }, 0);
    const totalBonus = empPayrolls.reduce((s, p) => s + (p.bonus || 0), 0);
    const totalOvertime = empPayrolls.reduce((s, p) => s + (p.overtime || 0), 0);
    const avgGross = totalGross / empPayrolls.length;
    const avgNet = totalNet / empPayrolls.length;
    const chargeRate = totalGross > 0 ? (totalChargesSalariales / totalGross) * 100 : 0;
    const coutEmployeur = totalGross + totalChargesPatronales;
    const hasEstimatedPatronal = empPayrolls.some(p => !(p.employerCharges && Number(p.employerCharges) > 0));

    const trendData = useMemo(() => {
        if (empPayrolls.length < 2) return null;
        const latest = empPayrolls[0];
        const previous = empPayrolls[1];
        const grossDiff = latest.grossSalary - previous.grossSalary;
        const grossPct = previous.grossSalary > 0 ? (grossDiff / previous.grossSalary) * 100 : 0;
        const netDiff = latest.netSalary - previous.netSalary;
        const netPct = previous.netSalary > 0 ? (netDiff / previous.netSalary) * 100 : 0;
        return { grossDiff, grossPct, netDiff, netPct };
    }, [empPayrolls]);

    const periodLabel = (period: string) => {
        const [y, m] = period.split("-");
        const months = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
        return `${months[parseInt(m) - 1]} ${y}`;
    };

    const TrendBadge = ({ value, pct }: { value: number; pct: number }) => {
        if (Math.abs(pct) < 0.5) return <span className={`inline-flex items-center gap-0.5 text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}><Minus className="w-2.5 h-2.5" /> stable</span>;
        const up = value > 0;
        return (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${up ? "text-red-400" : "text-green-400"}`}>
                {up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                {up ? "+" : ""}{pct.toFixed(1)}%
            </span>
        );
    };

    return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                    <Calculator className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <span className={`text-xs font-semibold ${dk ? "text-white/60" : "text-slate-600"}`}>
                        Analyse des coûts
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${dk ? "bg-white/10 text-white/40" : "bg-slate-100 text-slate-500"}`}>
                        {empPayrolls.length} fiche{empPayrolls.length > 1 ? "s" : ""}
                    </span>
                </div>
                {trendData && (
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>Évolution brut:</span>
                        <TrendBadge value={trendData.grossDiff} pct={trendData.grossPct} />
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2.5`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"} mb-0.5`}>Coût employeur total</p>
                    <p className="text-sm font-mono font-bold text-orange-400">{fmt(coutEmployeur)}</p>
                    <p className={`text-[9px] ${dk ? "text-white/25" : "text-slate-300"} mt-0.5`}>brut + charges pat.{hasEstimatedPatronal ? " ~" : ""}</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2.5`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"} mb-0.5`}>Total net versé</p>
                    <p className="text-sm font-mono font-bold text-green-400">{fmt(totalNet)}</p>
                    <p className={`text-[9px] ${dk ? "text-white/25" : "text-slate-300"} mt-0.5`}>sur {empPayrolls.length} mois</p>
                </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 mb-3">
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[9px] ${dk ? "text-white/35" : "text-slate-400"}`}>Moy. brut</p>
                    <p className="text-[11px] font-mono font-semibold text-orange-400">{fmt(avgGross)}</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[9px] ${dk ? "text-white/35" : "text-slate-400"}`}>Moy. net</p>
                    <p className="text-[11px] font-mono font-semibold text-green-400">{fmt(avgNet)}</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[9px] ${dk ? "text-white/35" : "text-slate-400"}`}>Taux charges</p>
                    <p className="text-[11px] font-mono font-semibold text-red-400">{chargeRate.toFixed(1)}%</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[9px] ${dk ? "text-white/35" : "text-slate-400"}`}>Charges sal.</p>
                    <p className="text-[11px] font-mono font-semibold text-red-400">{fmt(totalChargesSalariales)}</p>
                </div>
            </div>

            {(totalBonus > 0 || totalOvertime > 0) && (
                <div className={`flex gap-3 mb-3 px-2 py-1.5 rounded-lg ${dk ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}`}>
                    {totalBonus > 0 && (
                        <span className="text-[10px] flex items-center gap-1">
                            <span className={dk ? "text-white/40" : "text-slate-500"}>Primes:</span>
                            <span className="font-mono font-semibold text-amber-400">{fmt(totalBonus)}</span>
                        </span>
                    )}
                    {totalOvertime > 0 && (
                        <span className="text-[10px] flex items-center gap-1">
                            <span className={dk ? "text-white/40" : "text-slate-500"}>Heures sup:</span>
                            <span className="font-mono font-semibold text-purple-400">{fmt(totalOvertime)}</span>
                        </span>
                    )}
                </div>
            )}

            <div className="space-y-1">
                {empPayrolls.map((p, i) => {
                    const prev = empPayrolls[i + 1];
                    const grossChange = prev ? p.grossSalary - prev.grossSalary : 0;
                    const grossChangePct = prev && prev.grossSalary > 0 ? (grossChange / prev.grossSalary) * 100 : 0;
                    return (
                        <div key={p.id} className={`${dk ? "bg-white/5 hover:bg-white/10" : "bg-slate-50 hover:bg-slate-100"} rounded-lg px-2.5 py-2 transition`} data-testid={`emp-cost-row-${p.id}`}>
                            <div className="flex items-center justify-between mb-0.5">
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-semibold ${dk ? "text-white/70" : "text-slate-700"}`}>{periodLabel(p.period)}</span>
                                    {prev && Math.abs(grossChangePct) >= 0.5 && (
                                        <TrendBadge value={grossChange} pct={grossChangePct} />
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {p.isPaid && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">Payé</span>}
                                    {p.pdfPath && (
                                        <>
                                            <button onClick={() => window.open(`/api/v2/sugu-management/files/${p.pdfPath}/download`, "_blank")}
                                                className={`p-1 rounded ${dk ? "hover:bg-white/10 text-purple-400" : "hover:bg-slate-200 text-purple-500"} transition`} title="Voir le bulletin" data-testid={`btn-view-bs-${p.id}`}>
                                                <Eye className="w-3 h-3" />
                                            </button>
                                            <a href={`/api/v2/sugu-management/files/${p.pdfPath}/download`} target="_blank" rel="noreferrer"
                                                className={`p-1 rounded ${dk ? "hover:bg-white/10 text-blue-400" : "hover:bg-slate-200 text-blue-500"} transition`} title="Télécharger le bulletin" data-testid={`btn-dl-bs-${p.id}`}>
                                                <Download className="w-3 h-3" />
                                            </a>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] font-mono">
                                <span className={dk ? "text-white/35" : "text-slate-400"}>Brut <span className="text-orange-400 font-medium">{fmt(p.grossSalary)}</span></span>
                                <span className={dk ? "text-white/35" : "text-slate-400"}>Net <span className="text-green-400 font-medium">{fmt(p.netSalary)}</span></span>
                                {(p.socialCharges || 0) > 0 && <span className={dk ? "text-white/35" : "text-slate-400"}>Ch. <span className="text-red-400 font-medium">{fmt(p.socialCharges || 0)}</span></span>}
                                {(p.bonus || 0) > 0 && <span className={dk ? "text-white/35" : "text-slate-400"}>Prime <span className="text-amber-400 font-medium">{fmt(p.bonus || 0)}</span></span>}
                                {(p.overtime || 0) > 0 && <span className={dk ? "text-white/35" : "text-slate-400"}>HS <span className="text-purple-400 font-medium">{fmt(p.overtime || 0)}</span></span>}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className={`mt-2 pt-2 border-t ${dk ? "border-white/5" : "border-slate-100"} grid grid-cols-3 gap-2 text-[10px]`}>
                <div className={dk ? "text-white/30" : "text-slate-400"}>
                    Total brut: <span className="font-mono text-orange-400">{fmt(totalGross)}</span>
                </div>
                <div className={`text-center ${dk ? "text-white/30" : "text-slate-400"}`}>
                    Total net: <span className="font-mono text-green-400">{fmt(totalNet)}</span>
                </div>
                <div className={`text-right ${dk ? "text-white/30" : "text-slate-400"}`}>
                    Écart brut-net: <span className="font-mono text-blue-400">{fmt(totalGross - totalNet)}</span> ({totalGross > 0 ? ((totalGross - totalNet) / totalGross * 100).toFixed(1) : "0"}%)
                </div>
            </div>
        </div>
    );
}

function EmployeeCard({ employee: e, dk, restricted, onEdit, onDelete, payrolls }: { employee: Employee; dk: boolean; restricted?: boolean; onEdit: () => void; onDelete: () => void; payrolls: Payroll[] }) {
    const [showDetails, setShowDetails] = useState(false);
    const empPayrolls = payrolls.filter(p => p.employeeId === e.id);
    const empPayrollCount = empPayrolls.length;
    const payrollFileIds = useMemo(() => {
        const ids = new Set<string>();
        empPayrolls.forEach(p => { if (p.pdfPath) ids.add(String(p.pdfPath)); });
        return ids;
    }, [empPayrolls]);
    return (
        <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl ${!e.isActive ? "opacity-50" : ""}`} data-testid={`emp-card-${e.id}`}>
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center font-bold text-sm">
                        {e.firstName[0]}{e.lastName[0]}
                    </div>
                    <div>
                        <p className="font-medium">{e.firstName} {e.lastName}</p>
                        <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{e.role} • <span className={contractColor[e.contractType] || (dk ? "text-white/60" : "text-slate-600")}>{e.contractType}</span> • Depuis {fmtDate(e.startDate)}{e.contractType === "CDD" && e.endDate ? ` → ${fmtDate(e.endDate)}` : ""}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="font-mono font-bold">{fmt(e.monthlySalary ?? 0)}<span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>/mois</span></p>
                        {e.weeklyHours && <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{e.weeklyHours}h/sem</p>}
                    </div>
                    <button onClick={() => setShowDetails(v => !v)} className={`p-1.5 rounded-lg transition-colors relative ${showDetails ? "bg-orange-500/20 text-orange-400" : dk ? "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60" : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"}`} title="Détails & Documents" data-testid={`btn-toggle-files-${e.id}`}>
                        <FolderOpen className="w-3.5 h-3.5" />
                        {empPayrollCount > 0 && !showDetails && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-orange-500 text-[8px] text-white flex items-center justify-center font-bold">{empPayrollCount}</span>
                        )}
                    </button>
                    {!restricted && <button onClick={onEdit} className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>}
                    {!restricted && <button onClick={onDelete} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>}
                </div>
            </div>
            {showDetails && (
                <div className="px-4 pb-4">
                    <EmployeeCostSection employeeId={e.id} payrolls={payrolls} dk={dk} />
                    <EmployeeFilesSection employeeId={e.id} employeeName={`${e.firstName} ${e.lastName}`} restricted={restricted} payrollFileIds={payrollFileIds} />
                </div>
            )}
        </div>
    );
}

export function RHTab({ restricted }: { restricted?: boolean } = {}) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [showEmpForm, setShowEmpForm] = useState(false);
    const [showPayrollForm, setShowPayrollForm] = useState(false);
    const [showAbsenceForm, setShowAbsenceForm] = useState(false);
    const [empForm, setEmpForm] = useState<Partial<Employee>>({ contractType: "CDI", isActive: true, startDate: new Date().toISOString().substring(0, 10) });
    const [payForm, setPayForm] = useState<Partial<Payroll>>({ period: new Date().toISOString().substring(0, 7) });
    const [absForm, setAbsForm] = useState<Partial<Absence>>({ type: "conge", isApproved: false, startDate: new Date().toISOString().substring(0, 10) });
    const [rhSearch, setRhSearch] = useState("");
    const [contractFilter, setContractFilter] = useState<string>("all");
    const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");
    const pf = usePeriodFilter("month");

    const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/v2/sugu-management/employees"] });
    const { data: payrolls = [] } = useQuery<Payroll[]>({ queryKey: ["/api/v2/sugu-management/payroll"] });
    const { data: absences = [] } = useQuery<Absence[]>({ queryKey: ["/api/v2/sugu-management/absences"] });

    const createEmpMut = useMutation({
        mutationFn: (data: any) => {
            // Normalize undefined → null for nullable fields (Zod requires null, not undefined)
            const normalized = {
                ...data,
                monthlySalary: data.monthlySalary ?? null,
                hourlyRate: data.hourlyRate ?? null,
                weeklyHours: data.weeklyHours ?? null,
                phone: data.phone ?? null,
                email: data.email ?? null,
                notes: data.notes ?? null,
                endDate: data.endDate ?? null,
            };
            return apiRequest("POST", "/api/v2/sugu-management/employees", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] }); setShowEmpForm(false); setEmpForm({ contractType: "CDI", isActive: true, startDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Employé ajouté" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'ajouter l'employé", variant: "destructive" }); }
    });
    const deleteEmpMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/employees/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] }); toast({ title: "Employé supprimé" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer l'employé", variant: "destructive" }); }
    });
    const updateEmpMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<Employee> }) => apiRequest("PUT", `/api/v2/sugu-management/employees/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] }); setEditingEmpId(null); toast({ title: "Employé mis à jour" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de mettre à jour", variant: "destructive" }); }
    });
    const [editingEmpId, setEditingEmpId] = useState<number | null>(null);
    const [editEmpData, setEditEmpData] = useState<Partial<Employee>>({});
    const deletePayMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/payroll/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/payroll"] }); toast({ title: "Fiche de paie supprimée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer la fiche de paie", variant: "destructive" }); }
    });
    const [viewingPayroll, setViewingPayroll] = useState<Payroll | null>(null);
    const createPayMut = useMutation({
        mutationFn: (data: any) => {
            const normalized = {
                ...data,
                socialCharges: data.socialCharges ?? null,
                bonus: data.bonus ?? null,
                overtime: data.overtime ?? null,
                paidDate: data.paidDate ?? null,
                notes: data.notes ?? null,
            };
            return apiRequest("POST", "/api/v2/sugu-management/payroll", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/payroll"] }); setShowPayrollForm(false); setPayForm({ period: new Date().toISOString().substring(0, 7) }); toast({ title: "Fiche de paie ajoutée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'ajouter la fiche de paie", variant: "destructive" }); }
    });
    const createAbsMut = useMutation({
        mutationFn: (data: any) => {
            const normalized = {
                ...data,
                endDate: data.endDate ?? null,
                duration: data.duration ?? null,
                reason: data.reason ?? null,
                notes: data.notes ?? null,
            };
            return apiRequest("POST", "/api/v2/sugu-management/absences", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/absences"] }); setShowAbsenceForm(false); setAbsForm({ type: "conge", isApproved: false, startDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Absence enregistrée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'enregistrer l'absence", variant: "destructive" }); }
    });
    const deleteAbsMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/absences/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/absences"] }); toast({ title: "Absence supprimée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer l'absence", variant: "destructive" }); }
    });

    const activeEmps = employees.filter(e => e.isActive);
    const totalMonthlySalary = activeEmps.reduce((s, e) => s + (e.monthlySalary ?? 0), 0);

    const filteredPayrolls = useMemo(() => {
        const fromYM = pf.period.from.slice(0, 7);
        const toYM = pf.period.to.slice(0, 7);
        return payrolls.filter(p => p.period >= fromYM && p.period <= toYM);
    }, [payrolls, pf.period.from, pf.period.to]);

    const filteredAbsences = useMemo(() => {
        return absences.filter(a => a.startDate >= pf.period.from && a.startDate <= pf.period.to);
    }, [absences, pf.period.from, pf.period.to]);

    const pendingAbsences = filteredAbsences.filter(a => !a.isApproved).length;
    const employeeIds = new Set(employees.map(e => e.id));
    const activePayrolls = filteredPayrolls.filter(p => employeeIds.has(p.employeeId));
    const totalPayrollGross = activePayrolls.reduce((s, p) => s + p.grossSalary, 0);
    const totalPayrollNet = activePayrolls.reduce((s, p) => s + p.netSalary, 0);
    const totalPayrollChargesSal = activePayrolls.reduce((s, p) => s + (p.socialCharges || 0), 0);
    const totalPayrollChargesPat = activePayrolls.reduce((s, p) => {
        if (p.employerCharges && Number(p.employerCharges) > 0) return s + Number(p.employerCharges);
        return s + Math.round(p.grossSalary * 0.13 * 100) / 100;
    }, 0);
    const totalCoutEmployeur = totalPayrollGross + totalPayrollChargesPat;
    const globalChargeRate = totalPayrollGross > 0 ? (totalPayrollChargesSal / totalPayrollGross * 100).toFixed(1) : "0";
    const hasGlobalEstimate = activePayrolls.some(p => !(p.employerCharges && Number(p.employerCharges) > 0));
    const avgGrossPerEmp = activeEmps.length > 0 && activePayrolls.length > 0 ? totalPayrollGross / activePayrolls.length : 0;

    const filteredEmps = useMemo(() => {
        let list = [...employees];
        if (rhSearch.trim()) {
            const q = rhSearch.toLowerCase();
            list = list.filter(e => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || (e.role || "").toLowerCase().includes(q) || (e.email || "").toLowerCase().includes(q));
        }
        if (contractFilter !== "all") list = list.filter(e => e.contractType === contractFilter);
        if (activeFilter === "active") list = list.filter(e => e.isActive);
        if (activeFilter === "inactive") list = list.filter(e => !e.isActive);
        return list;
    }, [employees, rhSearch, contractFilter, activeFilter]);

    const exportRhCSV = () => {
        if (filteredEmps.length === 0) return toast({ title: "Aucune donnée à exporter" });
        const header = ["Prénom", "Nom", "Poste", "Contrat", "Salaire Mensuel", "Heures/sem", "Actif", "Date Entrée", "Téléphone", "Email"];
        const rows = filteredEmps.map(e => [e.firstName, e.lastName, e.role, e.contractType, String(e.monthlySalary ?? ""), String(e.weeklyHours ?? ""), e.isActive ? "oui" : "non", e.startDate, e.phone || "", e.email || ""]);
        const csv = [header, ...rows].map(r => r.map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "employes.csv"; a.click();
        URL.revokeObjectURL(url);
    };

    const payrollPdfRef = useRef<HTMLInputElement>(null);
    const [importingPayroll, setImportingPayroll] = useState(false);
    const [payrollImportResult, setPayrollImportResult] = useState<any>(null);
    const [reparsing, setReparsing] = useState(false);

    const handleReparseAll = async () => {
        if (!confirm("Re-parser tous les bulletins de paie PDF ? Cela mettra à jour les montants.")) return;
        setReparsing(true);
        try {
            const resp = await fetch("/api/v2/sugu-management/payroll/reparse-all", { method: "POST", credentials: "include" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || "Erreur");
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/payroll"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] });
            toast({ title: "Re-parsing terminé", description: `${data.updated || 0} mis à jour, ${data.created || 0} créés, ${data.failed || 0} échoués sur ${data.total || 0} fichiers` });
        } catch (err: any) {
            toast({ title: "Erreur", description: err?.message || "Impossible de re-parser", variant: "destructive" });
        } finally {
            setReparsing(false);
        }
    };

    const [importProgress, setImportProgress] = useState<string | null>(null);

    const handlePayrollPdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            toast({ title: "Format invalide", description: "Seuls les fichiers PDF sont acceptés", variant: "destructive" });
            return;
        }
        setImportingPayroll(true);
        setImportProgress("Envoi du fichier...");
        setPayrollImportResult(null);
        try {
            const resp = await uploadFileAsBase64("/api/v2/sugu-management/payroll/import-pdf", file, { autoCreate: "true" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || "Erreur d'import");

            if (data.async) {
                setImportProgress("Analyse du bulletin en cours...");
                toast({ title: "Bulletin reçu", description: "Analyse en cours, un instant..." });

                const startTime = Date.now();
                const maxWait = 120000;
                const pollInterval = 3000;

                const pollForCompletion = async (): Promise<void> => {
                    if (Date.now() - startTime > maxWait) {
                        setImportProgress(null);
                        setImportingPayroll(false);
                        toast({ title: "Import en cours", description: "Le traitement prend plus de temps que prévu. Les données seront mises à jour automatiquement." });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/payroll"] });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
                        return;
                    }

                    await new Promise(r => setTimeout(r, pollInterval));

                    try {
                        const statusResp = await fetch(`/api/v2/sugu-management/payroll/import-status/${data.importId}`, { credentials: "include" });
                        if (statusResp.ok) {
                            const statusData = await statusResp.json();
                            if (statusData.status === "complete") {
                                setPayrollImportResult(statusData.result);
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] });
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/payroll"] });
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
                                const msgs: string[] = [];
                                const r = statusData.result;
                                if (r?.actions?.employeeCreated) msgs.push(`Employé créé: ${r.parsed?.employee?.firstName} ${r.parsed?.employee?.lastName}`);
                                if (r?.actions?.payrollCreated) msgs.push(`Fiche de paie ${r.parsed?.period} ajoutée`);
                                if (!r?.actions?.employeeCreated && r?.actions?.employeeId) msgs.push(`Employé existant mis à jour`);
                                if (r?.warnings?.length) msgs.push(`⚠️ ${r.warnings.join(", ")}`);
                                toast({ title: "Bulletin importé avec succès", description: msgs.join(" • ") || `Confiance: ${r?.confidence || "N/A"}` });
                                setImportProgress(null);
                                setImportingPayroll(false);
                                return;
                            } else if (statusData.status === "error") {
                                throw new Error(statusData.error || "Erreur de traitement");
                            } else if (statusData.step) {
                                setImportProgress(statusData.step);
                            }
                        }
                    } catch (pollErr: any) {
                        if (pollErr?.message?.includes("Erreur")) {
                            setImportProgress(null);
                            setImportingPayroll(false);
                            toast({ title: "Erreur d'import", description: pollErr.message, variant: "destructive" });
                            return;
                        }
                    }

                    return pollForCompletion();
                };

                pollForCompletion().catch(() => {
                    setImportProgress(null);
                    setImportingPayroll(false);
                });
            } else {
                setPayrollImportResult(data);
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/payroll"] });
                const msgs: string[] = [];
                if (data.actions?.employeeCreated) msgs.push(`Employé créé: ${data.parsed?.employee?.firstName} ${data.parsed?.employee?.lastName}`);
                if (data.actions?.payrollCreated) msgs.push(`Fiche de paie ${data.parsed?.period} ajoutée`);
                if (!data.actions?.employeeCreated && data.actions?.employeeId) msgs.push(`Employé existant mis à jour`);
                if (data.warnings?.length) msgs.push(`⚠️ ${data.warnings.join(", ")}`);
                toast({ title: "Bulletin importé avec succès", description: msgs.join(" • ") || `Confiance: ${data.confidence || "N/A"}` });
                setImportingPayroll(false);
            }
        } catch (err: any) {
            toast({ title: "Erreur d'import", description: err?.message || "Impossible de lire le bulletin de paie", variant: "destructive" });
            setImportProgress(null);
            setImportingPayroll(false);
        } finally {
            if (payrollPdfRef.current) payrollPdfRef.current.value = "";
        }
    };

    const empName = (id: number) => {
        const emp = employees.find(emp => emp.id === id);
        return emp ? `${emp.firstName} ${emp.lastName}` : `#${id}`;
    };

    const typeLabel: Record<string, string> = { conge: "Congé", maladie: "Maladie", retard: "Retard", absence: "Absence", formation: "Formation" };

    return (
        <div className="space-y-6">
            <PeriodFilter periodKey={pf.periodKey} setPeriod={pf.setPeriod} customFrom={pf.customFrom} setCustomFrom={pf.setCustomFrom} customTo={pf.customTo} setCustomTo={pf.setCustomTo} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Effectif actif" value={String(activeEmps.length)} icon={Users} color="blue"
                    warning={activeEmps.length === 0 ? "Aucun employé créé — cliquez + Ajouter un employé" : undefined} />
                <StatCard label="Fiches de paie" value={String(filteredPayrolls.length)} icon={Receipt} color="purple"
                    warning={filteredPayrolls.length === 0 && employees.length === 0 ? "Créez des employés puis ajoutez des fiches" : undefined} />
                <StatCard label="Absences en attente" value={String(pendingAbsences)} icon={AlertTriangle} color="red" />
                <StatCard label="Masse salariale/mois" value={totalMonthlySalary > 0 ? fmt(totalMonthlySalary) : "N/D"} icon={Briefcase} color="orange"
                    warning={activeEmps.length === 0 ? "Renseignez les employés pour calculer" : undefined} />
            </div>
            {filteredPayrolls.length > 0 && (
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} mb-3 flex items-center gap-2`}>
                        <Calculator className="w-5 h-5 text-blue-400" /> Synthèse financière
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3 text-center`}>
                            <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"} mb-1`}>Coût employeur</p>
                            <p className="text-base font-mono font-bold text-orange-400">{fmt(totalCoutEmployeur)}</p>
                            <p className={`text-[9px] mt-0.5 ${dk ? "text-white/25" : "text-slate-300"}`}>brut + charges pat.{hasGlobalEstimate ? " ~" : ""}</p>
                        </div>
                        <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3 text-center`}>
                            <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"} mb-1`}>Total brut</p>
                            <p className="text-base font-mono font-bold text-orange-400">{fmt(totalPayrollGross)}</p>
                            <p className={`text-[9px] mt-0.5 ${dk ? "text-white/25" : "text-slate-300"}`}>moy/fiche: {fmt(avgGrossPerEmp)}</p>
                        </div>
                        <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3 text-center`}>
                            <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"} mb-1`}>Total net versé</p>
                            <p className="text-base font-mono font-bold text-green-400">{fmt(totalPayrollNet)}</p>
                            <p className={`text-[9px] mt-0.5 ${dk ? "text-white/25" : "text-slate-300"}`}>écart: {fmt(totalPayrollGross - totalPayrollNet)}</p>
                        </div>
                        <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3 text-center`}>
                            <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"} mb-1`}>Charges salariales</p>
                            <p className="text-base font-mono font-bold text-red-400">{fmt(totalPayrollChargesSal)}</p>
                            <p className={`text-[9px] mt-0.5 ${dk ? "text-white/25" : "text-slate-300"}`}>taux: {globalChargeRate}% du brut</p>
                        </div>
                        <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-xl p-3 text-center`}>
                            <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"} mb-1`}>Rétention nette</p>
                            <p className="text-base font-mono font-bold text-blue-400">{totalPayrollGross > 0 ? (totalPayrollNet / totalPayrollGross * 100).toFixed(1) : "0"}%</p>
                            <p className={`text-[9px] mt-0.5 ${dk ? "text-white/25" : "text-slate-300"}`}>net / brut</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Contract mix */}
            {activeEmps.length > 0 && (
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} mb-3 flex items-center gap-2`}><Users className="w-5 h-5 text-orange-400" /> Répartition des contrats</h3>
                    <div className="flex gap-1 h-6 rounded-full overflow-hidden">
                        {CONTRACT_TYPES.map(ct => {
                            const count = activeEmps.filter(e => e.contractType === ct).length;
                            if (count === 0) return null;
                            const pct = (count / activeEmps.length) * 100;
                            const colors: Record<string, string> = { CDI: "bg-green-500", CDD: "bg-blue-500", Extra: "bg-orange-500", Stage: "bg-purple-500" };
                            return <div key={ct} className={`${colors[ct] || (dk ? "bg-white/20" : "bg-slate-200")} h-full transition-all`} style={{ width: `${pct}%` }} title={`${ct}: ${count}`} />;
                        })}
                    </div>
                    <div className={`flex gap-4 mt-2 text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>
                        {CONTRACT_TYPES.map(ct => {
                            const count = activeEmps.filter(e => e.contractType === ct).length;
                            if (count === 0) return null;
                            const colors: Record<string, string> = { CDI: "bg-green-500", CDD: "bg-blue-500", Extra: "bg-orange-500", Stage: "bg-purple-500" };
                            return <span key={ct} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${colors[ct]}`} /> {ct} ({count})</span>;
                        })}
                    </div>
                </div>
            )}

            {/* Search + Filters */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-2 items-center">
                <div className={`flex items-center gap-2 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-lg px-3 py-2 lg:col-span-2`}>
                    <Search className={`w-4 h-4 ${dk ? "text-white/40" : "text-slate-400"}`} />
                    <input value={rhSearch} onChange={e => setRhSearch(e.target.value)} placeholder="Rechercher nom, poste, email..." className="bg-transparent w-full text-sm focus:outline-none" />
                </div>
                <FormSelect title="Filtrer par type de contrat" className={ic} value={contractFilter} onChange={e => setContractFilter(e.target.value)}>
                    <option value="all">Tous les contrats</option>
                    {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </FormSelect>
                <FormSelect title="Filtrer par statut" className={ic} value={activeFilter} onChange={e => setActiveFilter(e.target.value as any)}>
                    <option value="all">Tous</option>
                    <option value="active">Actifs</option>
                    <option value="inactive">Inactifs</option>
                </FormSelect>
                <button onClick={exportRhCSV} className={`px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap`}>Export CSV</button>
            </div>

            {/* Employees */}
            <Card title={`Employés (${filteredEmps.length})`} icon={Users}
                action={!restricted ? <button onClick={() => setShowEmpForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouvel Employé</button> : undefined}>
                {filteredEmps.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun employé trouvé</p>
                ) : (
                    <div className="grid gap-3">
                        {filteredEmps.map(e => (
                            <EmployeeCard key={e.id} employee={e} dk={dk} restricted={restricted} payrolls={payrolls}
                                onEdit={() => { setEditingEmpId(e.id); setEditEmpData({ firstName: e.firstName, lastName: e.lastName, role: e.role, contractType: e.contractType, startDate: e.startDate, endDate: e.endDate, monthlySalary: e.monthlySalary, hourlyRate: e.hourlyRate, weeklyHours: e.weeklyHours, isActive: e.isActive, phone: e.phone, email: e.email, notes: e.notes }); }}
                                onDelete={() => { if (confirm("Supprimer cet employé ?")) deleteEmpMut.mutate(e.id); }}
                            />
                        ))}
                    </div>
                )}
            </Card>

            {/* Absences */}
            <Card title={`Absences & Congés (${filteredAbsences.length})`} icon={Clock}
                action={!restricted ? <button onClick={() => setShowAbsenceForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Déclarer Absence</button> : undefined}>
                {filteredAbsences.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-4`}>Aucune absence sur cette période</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <th className="text-left py-2 px-2">Employé</th>
                                    <th className="text-left py-2 px-2">Type</th>
                                    <th className="text-left py-2 px-2">Début</th>
                                    <th className="text-left py-2 px-2">Fin</th>
                                    <th className="text-center py-2 px-2">Durée</th>
                                    <th className="text-center py-2 px-2">Statut</th>
                                    <th className="text-right py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredAbsences.map(a => (
                                    <tr key={a.id} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                        <td className="py-2 px-2">{empName(a.employeeId)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{typeLabel[a.type] || a.type}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{fmtDate(a.startDate)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{a.endDate ? fmtDate(a.endDate) : "-"}</td>
                                        <td className="py-2 px-2 text-center">{a.duration ? `${a.duration}j` : "-"}</td>
                                        <td className="py-2 px-2 text-center">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${a.isApproved ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                                                {a.isApproved ? "Approuvé" : "En attente"}
                                            </span>
                                        </td>
                                        {!restricted && <td className="py-2 px-2 text-right">
                                            <button onClick={() => { if (confirm("Supprimer cette absence ?")) deleteAbsMut.mutate(a.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                        </td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Payroll quick-add */}
            <Card title={`Fiches de Paie (${filteredPayrolls.length})`} icon={DollarSign}
                action={!restricted ? <div className="flex gap-2">
                    <input ref={payrollPdfRef} type="file" accept=".pdf" onChange={handlePayrollPdfImport} className="hidden" data-testid="input-payroll-pdf" />
                    <button onClick={() => payrollPdfRef.current?.click()} className={btnPrimary} disabled={importingPayroll} data-testid="button-import-payroll-pdf" title="Importer un bulletin de paie PDF">
                        {importingPayroll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {importingPayroll ? (importProgress || "Traitement...") : "Import..."}
                    </button>
                    <button onClick={handleReparseAll} className={`px-3 py-2 text-xs rounded-lg ${dk ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" : "bg-amber-100 text-amber-700 hover:bg-amber-200"} transition flex items-center gap-1`} disabled={reparsing} data-testid="button-reparse-payroll" title="Re-parser tous les bulletins PDF existants">
                        {reparsing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        {reparsing ? "Re-parse..." : "Re-parser"}
                    </button>
                    <button onClick={() => setShowPayrollForm(true)} className={btnPrimary} data-testid="button-add-payroll"><Plus className="w-4 h-4" /> Ajouter Fiche</button>
                </div> : undefined}>
                {filteredPayrolls.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-4`}>Aucune fiche de paie sur cette période</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className={`${dk ? "text-white/40" : "text-slate-400"} border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                    <th className="text-left py-2 px-2">Employé</th>
                                    <th className="text-left py-2 px-2">Période</th>
                                    <th className="text-right py-2 px-2">Brut</th>
                                    <th className="text-right py-2 px-2">Net</th>
                                    <th className="text-right py-2 px-2">Charges</th>
                                    <th className="text-right py-2 px-2">Primes</th>
                                    <th className="text-center py-2 px-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPayrolls.map(p => (
                                    <tr key={p.id} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                        <td className="py-2 px-2">{empName(p.employeeId)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{p.period}</td>
                                        <td className="py-2 px-2 text-right font-mono">{fmt(p.grossSalary)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-green-400">{fmt(p.netSalary)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-red-400">{p.socialCharges ? fmt(p.socialCharges) : "-"}</td>
                                        <td className="py-2 px-2 text-right font-mono text-orange-400">{p.bonus ? fmt(p.bonus) : "-"}</td>
                                        <td className="py-2 px-2 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => setViewingPayroll(p)} className={`p-1.5 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} text-blue-400 hover:text-blue-300 transition`} title="Voir détails" data-testid={`button-view-payroll-${p.id}`}>
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                                {!restricted && <button onClick={() => { if (confirm("Supprimer cette fiche de paie ?")) deletePayMut.mutate(p.id); }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition" title="Supprimer" data-testid={`button-delete-payroll-${p.id}`}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {payrollImportResult && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2" data-testid="payroll-import-result">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-emerald-400">Résultat Import Bulletin de Paie</h4>
                        <button onClick={() => setPayrollImportResult(null)} className={`${dk ? "text-white/40" : "text-slate-400"} ${dk ? "hover:text-white/60" : "hover:text-slate-600"} text-xs`}>✕ Fermer</button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Employé:</span> <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{payrollImportResult.parsed?.employee?.firstName} {payrollImportResult.parsed?.employee?.lastName}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Période:</span> <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{payrollImportResult.parsed?.period || "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Brut:</span> <span className={`${dk ? "text-white" : "text-slate-800"} font-mono`}>{payrollImportResult.parsed?.grossSalary ? fmt(payrollImportResult.parsed.grossSalary) : "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Net:</span> <span className="text-green-400 font-mono">{payrollImportResult.parsed?.netSalary ? fmt(payrollImportResult.parsed.netSalary) : "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Charges:</span> <span className="text-red-400 font-mono">{payrollImportResult.parsed?.socialCharges ? fmt(payrollImportResult.parsed.socialCharges) : "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Poste:</span> <span className={`${dk ? "text-white" : "text-slate-800"}`}>{payrollImportResult.parsed?.employee?.role || "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Confiance:</span> <span className="text-yellow-400">{payrollImportResult.confidence || "N/A"}</span></div>
                        <div><span className={`${dk ? "text-white/40" : "text-slate-400"}`}>Source:</span> <span className={`${dk ? "text-white/60" : "text-slate-600"}`}>{payrollImportResult.source || "N/A"}</span></div>
                    </div>
                    {payrollImportResult.parsed?.congesRestants != null && (
                        <div className={`text-xs ${dk ? "text-white/60" : "text-slate-600"}`}>Congés restants: <span className={`${dk ? "text-white" : "text-slate-800"}`}>{payrollImportResult.parsed.congesRestants}j</span></div>
                    )}
                    {payrollImportResult.warnings?.length > 0 && (
                        <div className="text-xs text-yellow-400/80">{payrollImportResult.warnings.join(" • ")}</div>
                    )}
                </div>
            )}

            <FormModal title="Détail Fiche de Paie" open={!!viewingPayroll} onClose={() => setViewingPayroll(null)}>
                {viewingPayroll && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Employé</span>
                                <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{empName(viewingPayroll.employeeId)}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Période</span>
                                <span className={`${dk ? "text-white" : "text-slate-800"} font-medium`}>{viewingPayroll.period}</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Salaire Brut</span>
                                <span className={`${dk ? "text-white" : "text-slate-800"} font-mono text-lg`}>{fmt(viewingPayroll.grossSalary)}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Salaire Net</span>
                                <span className="text-green-400 font-mono text-lg">{fmt(viewingPayroll.netSalary)}</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Charges Sociales</span>
                                <span className="text-red-400 font-mono">{viewingPayroll.socialCharges ? fmt(viewingPayroll.socialCharges) : "-"}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Primes</span>
                                <span className="text-orange-400 font-mono">{viewingPayroll.bonus ? fmt(viewingPayroll.bonus) : "-"}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Heures Sup.</span>
                                <span className="text-orange-400 font-mono">{viewingPayroll.overtime ? fmt(viewingPayroll.overtime) : "-"}</span>
                            </div>
                        </div>
                        <div className={`flex gap-2 pt-2 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                            {viewingPayroll.pdfPath && (
                                <a href={`/api/v2/sugu-management/files/${viewingPayroll.pdfPath}/download`} target="_blank" rel="noreferrer"
                                    className={btnPrimary + " flex items-center gap-2"} data-testid="button-view-pdf-payroll">
                                    <FileText className="w-3.5 h-3.5" /> Voir PDF Original
                                </a>
                            )}
                            {!restricted && <button onClick={() => { if (confirm("Supprimer cette fiche de paie ?")) { deletePayMut.mutate(viewingPayroll.id); setViewingPayroll(null); } }} className={btnDanger + " flex items-center gap-2"} data-testid="button-delete-payroll-modal">
                                <Trash2 className="w-3.5 h-3.5" /> Supprimer
                            </button>}
                        </div>
                    </div>
                )}
            </FormModal>

            <CategoryFiles category="rh" label="Ressources Humaines" restricted={restricted} />

            {/* Forms */}
            <FormModal title="Nouvel Employé" open={showEmpForm} onClose={() => setShowEmpForm(false)}>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Prénom"><input aria-label="Prénom" className={ic} value={empForm.firstName || ""} onChange={e => setEmpForm({ ...empForm, firstName: e.target.value })} /></Field>
                    <Field label="Nom"><input aria-label="Nom" className={ic} value={empForm.lastName || ""} onChange={e => setEmpForm({ ...empForm, lastName: e.target.value })} /></Field>
                </div>
                <Field label="Poste"><input className={ic} value={empForm.role || ""} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} placeholder="Ex: Serveur, Cuisinier..." /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Type de contrat">
                        <FormSelect aria-label="Type de contrat" className={ic} value={empForm.contractType} onChange={e => setEmpForm({ ...empForm, contractType: e.target.value })}>
                            {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                        </FormSelect>
                    </Field>
                    <Field label="Date d'entrée"><input aria-label="Date d'entrée" type="date" className={ic} value={empForm.startDate || ""} onChange={e => setEmpForm({ ...empForm, startDate: e.target.value })} /></Field>
                </div>
                {empForm.contractType === "CDD" && (
                    <Field label="Date de fin de contrat"><input aria-label="Date de fin de contrat" type="date" className={ic} value={empForm.endDate || ""} onChange={e => setEmpForm({ ...empForm, endDate: e.target.value || undefined })} /></Field>
                )}
                <div className="grid grid-cols-3 gap-4">
                    <Field label="Salaire mensuel (€)"><input aria-label="Salaire mensuel (€)" type="number" step="0.01" className={ic} value={empForm.monthlySalary ?? ""} onChange={e => setEmpForm({ ...empForm, monthlySalary: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Taux horaire (€)"><input aria-label="Taux horaire (€)" type="number" step="0.01" className={ic} value={empForm.hourlyRate ?? ""} onChange={e => setEmpForm({ ...empForm, hourlyRate: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Heures/sem"><input aria-label="Heures/sem" type="number" className={ic} value={empForm.weeklyHours ?? ""} onChange={e => setEmpForm({ ...empForm, weeklyHours: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Téléphone"><input className={ic} value={empForm.phone || ""} onChange={e => setEmpForm({ ...empForm, phone: e.target.value || undefined })} placeholder="06 ..." /></Field>
                    <Field label="Email"><input type="email" className={ic} value={empForm.email || ""} onChange={e => setEmpForm({ ...empForm, email: e.target.value || undefined })} placeholder="email@..." /></Field>
                </div>
                <Field label="Notes"><input className={ic} value={empForm.notes || ""} onChange={e => setEmpForm({ ...empForm, notes: e.target.value || undefined })} placeholder="Notes..." /></Field>
                <button onClick={() => createEmpMut.mutate(empForm)} className={btnPrimary + " w-full justify-center"} disabled={!empForm.firstName || !empForm.lastName || !empForm.role || createEmpMut.isPending}>
                    {createEmpMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                </button>
            </FormModal>

            <FormModal title="Nouvelle Fiche de Paie" open={showPayrollForm} onClose={() => setShowPayrollForm(false)}>
                <Field label="Employé">
                    <FormSelect aria-label="Employé" className={ic} value={payForm.employeeId ?? ""} onChange={e => setPayForm({ ...payForm, employeeId: parseInt(e.target.value) })}>
                        <option value="">-- Sélectionner --</option>
                        {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                    </FormSelect>
                </Field>
                <Field label="Période (YYYY-MM)"><input aria-label="Période (YYYY-MM)" type="text" pattern="\d{4}-\d{2}" className={ic} value={payForm.period || ""} onChange={e => setPayForm({ ...payForm, period: e.target.value })} placeholder="2026-01" /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Salaire brut (€)"><input aria-label="Salaire brut (€)" type="number" step="0.01" className={ic} value={payForm.grossSalary ?? ""} onChange={e => setPayForm({ ...payForm, grossSalary: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Salaire net (€)"><input aria-label="Salaire net (€)" type="number" step="0.01" className={ic} value={payForm.netSalary ?? ""} onChange={e => setPayForm({ ...payForm, netSalary: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Field label="Charges sociales (€)"><input aria-label="Charges sociales (€)" type="number" step="0.01" className={ic} value={payForm.socialCharges ?? ""} onChange={e => setPayForm({ ...payForm, socialCharges: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Primes (€)"><input aria-label="Primes (€)" type="number" step="0.01" className={ic} value={payForm.bonus ?? ""} onChange={e => setPayForm({ ...payForm, bonus: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                    <Field label="Heures sup. (€)"><input aria-label="Heures sup. (€)" type="number" step="0.01" className={ic} value={payForm.overtime ?? ""} onChange={e => setPayForm({ ...payForm, overtime: e.target.value === "" ? undefined : safeFloat(e.target.value) })} /></Field>
                </div>
                <button onClick={() => createPayMut.mutate(payForm)} className={btnPrimary + " w-full justify-center"} disabled={!payForm.employeeId || !payForm.grossSalary || createPayMut.isPending}>
                    {createPayMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                </button>
            </FormModal>

            <FormModal title="Déclarer Absence" open={showAbsenceForm} onClose={() => setShowAbsenceForm(false)}>
                <Field label="Employé">
                    <FormSelect aria-label="Employé" className={ic} value={absForm.employeeId ?? ""} onChange={e => setAbsForm({ ...absForm, employeeId: parseInt(e.target.value) })}>
                        <option value="">-- Sélectionner --</option>
                        {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                    </FormSelect>
                </Field>
                <Field label="Type">
                    <FormSelect aria-label="Type" className={ic} value={absForm.type} onChange={e => setAbsForm({ ...absForm, type: e.target.value })}>
                        {ABSENCE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </FormSelect>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Date début"><input aria-label="Date début" type="date" className={ic} value={absForm.startDate || ""} onChange={e => setAbsForm({ ...absForm, startDate: e.target.value })} /></Field>
                    <Field label="Date fin"><input aria-label="Date fin" type="date" className={ic} value={absForm.endDate || ""} onChange={e => setAbsForm({ ...absForm, endDate: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Durée (jours)"><input aria-label="Durée (jours)" type="number" className={ic} value={absForm.duration ?? ""} onChange={e => setAbsForm({ ...absForm, duration: parseInt(e.target.value) })} /></Field>
                    <Field label="Raison"><input aria-label="Raison" className={ic} value={absForm.reason || ""} onChange={e => setAbsForm({ ...absForm, reason: e.target.value })} /></Field>
                </div>
                <button onClick={() => createAbsMut.mutate(absForm)} className={btnPrimary + " w-full justify-center"} disabled={!absForm.employeeId || createAbsMut.isPending}>
                    {createAbsMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
                </button>
            </FormModal>

            {/* Edit Employee Modal */}
            <FormModal title="Modifier Employé" open={editingEmpId !== null} onClose={() => setEditingEmpId(null)}>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Prénom"><input aria-label="Prénom" className={ic} value={editEmpData.firstName || ""} onChange={e => setEditEmpData({ ...editEmpData, firstName: e.target.value })} /></Field>
                    <Field label="Nom"><input aria-label="Nom" className={ic} value={editEmpData.lastName || ""} onChange={e => setEditEmpData({ ...editEmpData, lastName: e.target.value })} /></Field>
                </div>
                <Field label="Poste"><input aria-label="Poste" className={ic} value={editEmpData.role || ""} onChange={e => setEditEmpData({ ...editEmpData, role: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Type de contrat">
                        <FormSelect aria-label="Type de contrat" className={ic} value={editEmpData.contractType || "CDI"} onChange={e => setEditEmpData({ ...editEmpData, contractType: e.target.value })}>
                            {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                        </FormSelect>
                    </Field>
                    <Field label="Actif">
                        <FormSelect aria-label="Actif" className={ic} value={editEmpData.isActive ? "true" : "false"} onChange={e => setEditEmpData({ ...editEmpData, isActive: e.target.value === "true" })}>
                            <option value="true">Oui</option>
                            <option value="false">Non</option>
                        </FormSelect>
                    </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Date d'entrée"><input aria-label="Date d'entrée" type="date" className={ic} value={editEmpData.startDate || ""} onChange={e => setEditEmpData({ ...editEmpData, startDate: e.target.value })} /></Field>
                    {editEmpData.contractType === "CDD" && (
                        <Field label="Fin de contrat"><input aria-label="Fin de contrat" type="date" className={ic} value={editEmpData.endDate || ""} onChange={e => setEditEmpData({ ...editEmpData, endDate: e.target.value || null })} /></Field>
                    )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Field label="Salaire mensuel (€)"><input aria-label="Salaire mensuel (€)" type="number" step="0.01" className={ic} value={editEmpData.monthlySalary ?? ""} onChange={e => setEditEmpData({ ...editEmpData, monthlySalary: e.target.value === "" ? null : safeFloat(e.target.value) })} /></Field>
                    <Field label="Taux horaire (€)"><input aria-label="Taux horaire (€)" type="number" step="0.01" className={ic} value={editEmpData.hourlyRate ?? ""} onChange={e => setEditEmpData({ ...editEmpData, hourlyRate: e.target.value === "" ? null : safeFloat(e.target.value) })} /></Field>
                    <Field label="Heures/sem"><input aria-label="Heures/sem" type="number" className={ic} value={editEmpData.weeklyHours ?? ""} onChange={e => setEditEmpData({ ...editEmpData, weeklyHours: e.target.value === "" ? null : safeFloat(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Téléphone"><input aria-label="Téléphone" className={ic} value={editEmpData.phone || ""} onChange={e => setEditEmpData({ ...editEmpData, phone: e.target.value || null })} /></Field>
                    <Field label="Email"><input aria-label="Email" type="email" className={ic} value={editEmpData.email || ""} onChange={e => setEditEmpData({ ...editEmpData, email: e.target.value || null })} /></Field>
                </div>
                <Field label="Notes"><input aria-label="Notes" className={ic} value={editEmpData.notes || ""} onChange={e => setEditEmpData({ ...editEmpData, notes: e.target.value || null })} /></Field>
                <button onClick={() => editingEmpId && updateEmpMut.mutate({ id: editingEmpId, data: editEmpData })} className={btnPrimary + " w-full justify-center"} disabled={!editEmpData.firstName || !editEmpData.lastName || updateEmpMut.isPending}>
                    {updateEmpMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Mettre à jour
                </button>
            </FormModal>
        </div>
    );
}

const SUPPLIER_CATEGORIES = ["alimentaire", "assurances", "boissons", "comptabilite", "eau", "emballages", "energie", "entretien", "materiels", "plateformes", "telecom", "travaux", "vehicules", "autre"];

export function FournisseursTab({ restricted }: { restricted?: boolean } = {}) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const pf = usePeriodFilter("month");
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

    const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/v2/sugu-management/suppliers"] });

    const defaultForm: Partial<Supplier> = { category: "alimentaire", isActive: true };

    const createMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugu-management/suppliers", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/suppliers"] }); setShowForm(false); setForm(defaultForm); toast({ title: "Fournisseur créé" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible de créer le fournisseur: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const quickCreateMut = useMutation({
        mutationFn: (data: any) => apiRequest("POST", "/api/v2/sugu-management/suppliers", data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/suppliers"] }); setQuickName(""); setQuickSiret(""); toast({ title: "Fournisseur ajouté (rapide)" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/v2/sugu-management/suppliers/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/suppliers"] }); setEditingSupplier(null); toast({ title: "Fournisseur modifié" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: `Impossible de modifier le fournisseur: ${err?.message || "Erreur inconnue"}`, variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/suppliers/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/suppliers"] }); toast({ title: "Fournisseur supprimé" }); },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le fournisseur", variant: "destructive" }); }
    });

    const toggleActive = useMutation({
        mutationFn: (s: Supplier) => apiRequest("PUT", `/api/v2/sugu-management/suppliers/${s.id}`, { isActive: !s.isActive }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/suppliers"] }); },
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

    const { filtered, pageData, totalPages, totalSuppliers, activeSuppliers, totalAchats, totalFactures } = useMemo(() => {
        let list = [...suppliers];
        list = list.filter(s => {
            if (!s.lastInvoiceDate) return true;
            return s.lastInvoiceDate >= pf.period.from && s.lastInvoiceDate <= pf.period.to;
        });
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
        const totalSuppliers = list.length;
        const activeSuppliers = list.filter(s => s.isActive).length;
        const totalAchats = list.reduce((s, sup) => s + (sup.totalPurchases || 0), 0);
        const totalFactures = list.reduce((s, sup) => s + (sup.invoiceCount || 0), 0);
        return { filtered: list, pageData: pageSlice, totalPages: tp, totalSuppliers, activeSuppliers, totalAchats, totalFactures };
    }, [suppliers, searchTerm, categoryFilter, sort, page, pageSize, pf.period.from, pf.period.to]);

    useEffect(() => { setPage(1); }, [searchTerm, categoryFilter]);

    const supplierFormFields = (f: Partial<Supplier>, setF: (v: Partial<Supplier>) => void) => (
        <>
            <Field label="Nom"><input data-testid="input-supplier-name" className={ic} value={f.name || ""} onChange={e => setF({ ...f, name: e.target.value })} placeholder="METRO, POMONA..." /></Field>
            <div className="grid grid-cols-2 gap-4">
                <Field label="Nom court"><input data-testid="input-supplier-shortname" className={ic} value={f.shortName || ""} onChange={e => setF({ ...f, shortName: e.target.value })} /></Field>
                <Field label="Catégorie">
                    <FormSelect data-testid="select-supplier-category" aria-label="Catégorie" className={ic} value={f.category || "alimentaire"} onChange={e => setF({ ...f, category: e.target.value })}>
                        {SUPPLIER_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </FormSelect>
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
                    <FormSelect data-testid="select-supplier-payment-method" aria-label="Mode de paiement" className={ic} value={f.defaultPaymentMethod || ""} onChange={e => setF({ ...f, defaultPaymentMethod: e.target.value })}>
                        <option value="">—</option>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{catLabel(m)}</option>)}
                    </FormSelect>
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
            <PeriodFilter periodKey={pf.periodKey} setPeriod={pf.setPeriod} customFrom={pf.customFrom} setCustomFrom={pf.setCustomFrom} customTo={pf.customTo} setCustomTo={pf.setCustomTo} />
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
                <FormSelect data-testid="select-filter-category" title="Filtrer par catégorie" className={ic} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                    <option value="all">Tous</option>
                    {SUPPLIER_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                </FormSelect>
                {!restricted && <div className="flex gap-2 justify-end">
                    <button data-testid="button-new-supplier" onClick={() => setShowForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouveau fournisseur</button>
                </div>}
            </div>

            <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3 flex flex-col gap-2 lg:flex-row lg:items-end`}>
                <div className="flex-1 min-w-[160px]">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Nom</label>
                    <input data-testid="input-quick-supplier-name" value={quickName} onChange={e => setQuickName(e.target.value)} className={ic} placeholder="METRO, POMONA..." />
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>Catégorie</label>
                    <FormSelect data-testid="select-quick-supplier-category" title="Catégorie" className={ic} value={quickCategory} onChange={e => setQuickCategory(e.target.value)}>
                        {SUPPLIER_CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
                    </FormSelect>
                </div>
                <div className="w-full lg:w-40">
                    <label className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>SIRET</label>
                    <input data-testid="input-quick-supplier-siret" value={quickSiret} onChange={e => setQuickSiret(e.target.value)} className={ic} placeholder="123 456 789 00012" />
                </div>
                <button data-testid="button-quick-add-supplier" onClick={() => {
                    if (!quickName.trim()) return toast({ title: "Nom requis", variant: "destructive" });
                    quickCreateMut.mutate({ name: quickName.trim(), category: quickCategory, siret: quickSiret.trim() || undefined, isActive: true });
                }} className={`px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 ${dk ? "text-white" : "text-slate-800"} text-sm font-semibold whitespace-nowrap`}>
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
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-lg">
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
                        {!restricted && <div className="flex gap-2 pt-2">
                            <button data-testid="button-detail-edit" onClick={() => { openEdit(detailSupplier); setDetailSupplier(null); }} className={btnPrimary + " flex-1 justify-center"}>
                                <Edit className="w-4 h-4" /> Modifier
                            </button>
                        </div>}
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

