import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { uploadFileAsBase64 } from "@/lib/uploadBase64";
import type { Employee, Payroll, Absence, SuguFile } from "../sugu/types";
import { CONTRACT_TYPES, ABSENCE_TYPES, fmt, safeFloat, t, fmtDate } from "../sugu/helpers";
import { useSuguDark, Card, StatCard, FormModal, Field, useInputClass, btnPrimary, btnDanger, fmtSize, isFileMimeImage, isFilePreviewable, FilePreviewModal, CategoryFiles } from "./shared";
import {
  RefreshCw,
  Plus,
  Clock,
  Loader2,
  Trash2,
  Search,
  Eye,
  X,
  Upload,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Edit,
  Check,
  FileText,
  FolderOpen,
  Download,
  Receipt,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function EmployeeFilesSection({ employeeId, employeeName, restricted }: { employeeId: number; employeeName: string; restricted?: boolean }) {
    const dk = useSuguDark();
    const qc = useQueryClient();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);

    const { data: files = [], isLoading } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugumaillane-management/files", "employee", employeeId],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugumaillane-management/files?employeeId=${employeeId}`, { credentials: "include" });
            return res.json();
        }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            toast({ title: "Fichier supprimé" });
        },
    });

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const res = await uploadFileAsBase64("/api/v2/sugumaillane-management/files", file, {
                category: "rh",
                employeeId: String(employeeId),
                description: `Document ${employeeName}`,
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Erreur upload"); }
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
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
                        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={handleUpload} className="hidden" data-testid={`input-emp-file-m-${employeeId}`} />
                        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${dk ? "bg-white/5 hover:bg-white/10 text-white/60" : "bg-slate-100 hover:bg-slate-200 text-slate-600"} transition`} data-testid={`btn-upload-emp-file-m-${employeeId}`}>
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
                        <div key={f.id} className={`flex items-center gap-2 ${dk ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-slate-50 border-slate-200 hover:bg-slate-100"} border rounded-lg px-2 py-1.5 transition`} data-testid={`emp-file-row-m-${f.id}`}>
                            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                {isFileMimeImage(f.mimeType) ? <Eye className="w-2.5 h-2.5 text-purple-400" /> : <FileText className="w-2.5 h-2.5 text-blue-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium truncate ${dk ? "text-white/80" : "text-slate-700"}`} title={f.originalName}>{f.originalName}</p>
                                <p className={`text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>{new Date(f.createdAt).toLocaleDateString("fr-FR")} • {fmtSize(f.fileSize)}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugumaillane-management/files/${f.id}/download`, "_blank")}
                                    className={`p-1 rounded ${dk ? "hover:bg-white/10 text-purple-400" : "hover:bg-slate-200 text-purple-500"} transition`} title="Aperçu" data-testid={`btn-preview-emp-file-m-${f.id}`}>
                                    <Eye className="w-3 h-3" />
                                </button>
                                <a href={`/api/v2/sugumaillane-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                    className={`p-1 rounded ${dk ? "hover:bg-white/10 text-blue-400" : "hover:bg-slate-200 text-blue-500"} transition`} title="Télécharger" data-testid={`btn-download-emp-file-m-${f.id}`}>
                                    <Download className="w-3 h-3" />
                                </a>
                                {!restricted && (
                                    <button onClick={() => { if (confirm(`Supprimer "${f.originalName}" ?`)) deleteMut.mutate(f.id); }}
                                        className={`p-1 rounded ${dk ? "hover:bg-red-500/20 text-red-400" : "hover:bg-red-100 text-red-500"} transition`} title="Supprimer" data-testid={`btn-delete-emp-file-m-${f.id}`}>
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

// ====== EMPLOYEE COST SECTION ======
export function MEmployeeCostSection({ employeeId, payrolls, dk }: { employeeId: number; payrolls: Payroll[]; dk: boolean }) {
    const empPayrolls = useMemo(() =>
        payrolls.filter(p => p.employeeId === employeeId).sort((a, b) => b.period.localeCompare(a.period)),
        [payrolls, employeeId]
    );

    if (empPayrolls.length === 0) return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                <span className={`text-xs font-medium ${dk ? "text-white/50" : "text-slate-500"}`}>Suivi des coûts</span>
            </div>
            <p className={`text-xs text-center py-2 ${dk ? "text-white/30" : "text-slate-400"}`}>Aucune fiche de paie</p>
        </div>
    );

    const totalGross = empPayrolls.reduce((s, p) => s + p.grossSalary, 0);
    const totalNet = empPayrolls.reduce((s, p) => s + p.netSalary, 0);
    const totalCharges = empPayrolls.reduce((s, p) => s + (p.socialCharges || 0), 0);
    const avgGross = totalGross / empPayrolls.length;

    return (
        <div className={`mt-3 pt-3 border-t ${dk ? "border-white/10" : "border-slate-100"}`}>
            <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className={`w-3.5 h-3.5 ${dk ? "text-white/40" : "text-slate-400"}`} />
                <span className={`text-xs font-medium ${dk ? "text-white/50" : "text-slate-500"}`}>
                    Suivi des coûts ({empPayrolls.length} fiche{empPayrolls.length > 1 ? "s" : ""})
                </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"}`}>Total brut</p>
                    <p className="text-xs font-mono font-bold text-orange-400">{fmt(totalGross)}</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"}`}>Total net versé</p>
                    <p className="text-xs font-mono font-bold text-green-400">{fmt(totalNet)}</p>
                </div>
                <div className={`${dk ? "bg-white/5" : "bg-slate-50"} rounded-lg p-2 text-center`}>
                    <p className={`text-[10px] ${dk ? "text-white/40" : "text-slate-400"}`}>Moy. brut/mois</p>
                    <p className="text-xs font-mono font-bold text-blue-400">{fmt(avgGross)}</p>
                </div>
            </div>
            <div className="space-y-1">
                {empPayrolls.map(p => (
                    <div key={p.id} className={`flex items-center justify-between ${dk ? "bg-white/5 hover:bg-white/10" : "bg-slate-50 hover:bg-slate-100"} rounded-lg px-2.5 py-1.5 transition`} data-testid={`emp-cost-row-m-${p.id}`}>
                        <span className={`text-xs font-medium ${dk ? "text-white/60" : "text-slate-600"}`}>{p.period}</span>
                        <div className="flex items-center gap-3 text-xs font-mono">
                            <span className={dk ? "text-white/40" : "text-slate-400"}>Brut <span className="text-orange-400 font-medium">{fmt(p.grossSalary)}</span></span>
                            <span className={dk ? "text-white/40" : "text-slate-400"}>Net <span className="text-green-400 font-medium">{fmt(p.netSalary)}</span></span>
                            {(p.socialCharges || 0) > 0 && <span className={dk ? "text-white/40" : "text-slate-400"}>Ch. <span className="text-red-400 font-medium">{fmt(p.socialCharges || 0)}</span></span>}
                        </div>
                    </div>
                ))}
            </div>
            {totalCharges > 0 && (
                <div className={`mt-2 text-right text-[10px] ${dk ? "text-white/30" : "text-slate-400"}`}>
                    Total charges salariales: <span className="text-red-400 font-mono">{fmt(totalCharges)}</span>
                </div>
            )}
        </div>
    );
}

// ====== EMPLOYEE CARD (MAILLANE) ======
export function MEmployeeCard({ employee: e, dk, onEdit, onDelete, payrolls }: { employee: Employee; dk: boolean; onEdit: () => void; onDelete: () => void; payrolls: Payroll[] }) {
    const [showDetails, setShowDetails] = useState(false);
    const empPayrollCount = payrolls.filter(p => p.employeeId === e.id).length;
    const contractColor: Record<string, string> = { CDI: "text-green-400", CDD: "text-blue-400", Extra: "text-teal-400", Stage: "text-purple-400" };
    return (
        <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl ${!e.isActive ? "opacity-50" : ""}`} data-testid={`emp-card-m-${e.id}`}>
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center font-bold text-sm">
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
                    <button onClick={() => setShowDetails(v => !v)} className={`p-1.5 rounded-lg transition-colors relative ${showDetails ? "bg-teal-500/20 text-teal-400" : dk ? "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60" : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"}`} title="Détails & Documents" data-testid={`btn-toggle-files-m-${e.id}`}>
                        <FolderOpen className="w-3.5 h-3.5" />
                        {empPayrollCount > 0 && !showDetails && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-teal-500 text-[8px] text-white flex items-center justify-center font-bold">{empPayrollCount}</span>
                        )}
                    </button>
                    <button onClick={onEdit} className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors" title="Modifier"><Edit className="w-3 h-3" /></button>
                    <button onClick={onDelete} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                </div>
            </div>
            {showDetails && (
                <div className="px-4 pb-4">
                    <MEmployeeCostSection employeeId={e.id} payrolls={payrolls} dk={dk} />
                    <EmployeeFilesSection employeeId={e.id} employeeName={`${e.firstName} ${e.lastName}`} />
                </div>
            )}
        </div>
    );
}

// ====== GESTION RH TAB ======
export function RHTab() {
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

    const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
    const { data: payrolls = [] } = useQuery<Payroll[]>({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
    const { data: absences = [] } = useQuery<Absence[]>({ queryKey: ["/api/v2/sugumaillane-management/absences"] });

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
            return apiRequest("POST", "/api/v2/sugumaillane-management/employees", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] }); setShowEmpForm(false); setEmpForm({ contractType: "CDI", isActive: true, startDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Employé ajouté" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'ajouter l'employé", variant: "destructive" }); }
    });
    const deleteEmpMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/employees/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] }); toast({ title: "Employé supprimé" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer l'employé", variant: "destructive" }); }
    });
    const updateEmpMut = useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<Employee> }) => apiRequest("PUT", `/api/v2/sugumaillane-management/employees/${id}`, data),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] }); setEditingEmpId(null); toast({ title: "Employé mis à jour" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de mettre à jour", variant: "destructive" }); }
    });
    const [editingEmpId, setEditingEmpId] = useState<number | null>(null);
    const [editEmpData, setEditEmpData] = useState<Partial<Employee>>({});
    const deletePayMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/payroll/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] }); toast({ title: "Fiche de paie supprimée" }); },
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
            return apiRequest("POST", "/api/v2/sugumaillane-management/payroll", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] }); setShowPayrollForm(false); setPayForm({ period: new Date().toISOString().substring(0, 7) }); toast({ title: "Fiche de paie ajoutée" }); },
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
            return apiRequest("POST", "/api/v2/sugumaillane-management/absences", normalized);
        },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/absences"] }); setShowAbsenceForm(false); setAbsForm({ type: "conge", isApproved: false, startDate: new Date().toISOString().substring(0, 10) }); toast({ title: "Absence enregistrée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible d'enregistrer l'absence", variant: "destructive" }); }
    });
    const deleteAbsMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/absences/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/absences"] }); toast({ title: "Absence supprimée" }); },
        onError: (err: any) => { toast({ title: "Erreur", description: err?.message || "Impossible de supprimer l'absence", variant: "destructive" }); }
    });

    const activeEmps = employees.filter(e => e.isActive);
    const totalMonthlySalary = activeEmps.reduce((s, e) => s + (e.monthlySalary ?? 0), 0);
    const pendingAbsences = absences.filter(a => !a.isApproved).length;
    const totalPayrollGross = payrolls.reduce((s, p) => s + p.grossSalary, 0);
    const totalPayrollNet = payrolls.reduce((s, p) => s + p.netSalary, 0);

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
            const resp = await fetch("/api/v2/sugumaillane-management/payroll/reparse-all", { method: "POST", credentials: "include" });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || "Erreur");
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
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
            const resp = await uploadFileAsBase64("/api/v2/sugumaillane-management/payroll/import-pdf", file, { autoCreate: "true" });
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
                        toast({ title: "Import en cours", description: "Le traitement prend plus de temps que prévu." });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
                        qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
                        return;
                    }

                    await new Promise(r => setTimeout(r, pollInterval));

                    try {
                        const statusResp = await fetch(`/api/v2/sugumaillane-management/payroll/import-status/${data.importId}`, { credentials: "include" });
                        if (statusResp.ok) {
                            const statusData = await statusResp.json();
                            if (statusData.status === "complete") {
                                setPayrollImportResult(statusData.result);
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
                                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
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
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/employees"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/payroll"] });
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
    const contractColor: Record<string, string> = { CDI: "text-green-400", CDD: "text-blue-400", Extra: "text-teal-400", Stage: "text-purple-400" };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <StatCard label="Effectif actif" value={String(activeEmps.length)} icon={Users} color="blue" />
                <StatCard label="Masse salariale/mois" value={fmt(totalMonthlySalary)} icon={DollarSign} color="orange" />
                <StatCard label="Absences en attente" value={String(pendingAbsences)} icon={AlertTriangle} color="red" />
                <StatCard label="Fiches de paie" value={String(payrolls.length)} icon={Receipt} color="purple" />
                <StatCard label="Total brut versé" value={fmt(totalPayrollGross)} icon={TrendingUp} color="green" />
                <StatCard label="Total net versé" value={fmt(totalPayrollNet)} icon={DollarSign} color="green" />
            </div>

            {/* Contract mix */}
            {activeEmps.length > 0 && (
                <div className={`${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-2xl p-5`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} mb-3 flex items-center gap-2`}><Users className="w-5 h-5 text-teal-400" /> Répartition des contrats</h3>
                    <div className="flex gap-1 h-6 rounded-full overflow-hidden">
                        {CONTRACT_TYPES.map(ct => {
                            const count = activeEmps.filter(e => e.contractType === ct).length;
                            if (count === 0) return null;
                            const pct = (count / activeEmps.length) * 100;
                            const colors: Record<string, string> = { CDI: "bg-green-500", CDD: "bg-blue-500", Extra: "bg-teal-500", Stage: "bg-purple-500" };
                            return <div key={ct} className={`${colors[ct] || (dk ? "bg-white/20" : "bg-slate-200")} h-full transition-all`} style={{ width: `${pct}%` }} title={`${ct}: ${count}`} />;
                        })}
                    </div>
                    <div className={`flex gap-4 mt-2 text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>
                        {CONTRACT_TYPES.map(ct => {
                            const count = activeEmps.filter(e => e.contractType === ct).length;
                            if (count === 0) return null;
                            const colors: Record<string, string> = { CDI: "bg-green-500", CDD: "bg-blue-500", Extra: "bg-teal-500", Stage: "bg-purple-500" };
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
                <select title="Filtrer par type de contrat" className={ic} value={contractFilter} onChange={e => setContractFilter(e.target.value)}>
                    <option value="all">Tous les contrats</option>
                    {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select title="Filtrer par statut" className={ic} value={activeFilter} onChange={e => setActiveFilter(e.target.value as "all" | "active" | "inactive")}>
                    <option value="all">Tous</option>
                    <option value="active">Actifs</option>
                    <option value="inactive">Inactifs</option>
                </select>
                <button onClick={exportRhCSV} className={`px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 ${dk ? "text-white" : "text-slate-800"} whitespace-nowrap`}>Export CSV</button>
            </div>

            {/* Employees */}
            <Card title={`Employés (${filteredEmps.length})`} icon={Users}
                action={<button onClick={() => setShowEmpForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Nouvel Employé</button>}>
                {filteredEmps.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun employé trouvé</p>
                ) : (
                    <div className="grid gap-3">
                        {filteredEmps.map(e => (
                            <MEmployeeCard
                                key={e.id}
                                employee={e}
                                dk={dk}
                                payrolls={payrolls}
                                onEdit={() => { setEditingEmpId(e.id); setEditEmpData({ firstName: e.firstName, lastName: e.lastName, role: e.role, contractType: e.contractType, monthlySalary: e.monthlySalary, hourlyRate: e.hourlyRate, weeklyHours: e.weeklyHours, isActive: e.isActive, phone: e.phone, email: e.email, notes: e.notes }); }}
                                onDelete={() => { if (confirm("Supprimer cet employé ?")) deleteEmpMut.mutate(e.id); }}
                            />
                        ))}
                    </div>
                )}
            </Card>

            {/* Absences */}
            <Card title="Absences & Congés" icon={Clock}
                action={<button onClick={() => setShowAbsenceForm(true)} className={btnPrimary}><Plus className="w-4 h-4" /> Déclarer Absence</button>}>
                {absences.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-4`}>Aucune absence</p>
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
                                {absences.map(a => (
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
                                        <td className="py-2 px-2 text-right">
                                            <button onClick={() => { if (confirm("Supprimer cette absence ?")) deleteAbsMut.mutate(a.id); }} className={btnDanger} title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Payroll quick-add */}
            <Card title="Fiches de Paie" icon={DollarSign}
                action={<div className="flex gap-2">
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
                </div>}>
                {payrolls.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-4`}>Aucune fiche de paie</p>
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
                                {payrolls.map(p => (
                                    <tr key={p.id} className={`border-b ${dk ? "border-white/5" : "border-slate-100"} ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                                        <td className="py-2 px-2">{empName(p.employeeId)}</td>
                                        <td className={`py-2 px-2 ${dk ? "text-white/60" : "text-slate-600"}`}>{p.period}</td>
                                        <td className="py-2 px-2 text-right font-mono">{fmt(p.grossSalary)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-green-400">{fmt(p.netSalary)}</td>
                                        <td className="py-2 px-2 text-right font-mono text-red-400">{p.socialCharges ? fmt(p.socialCharges) : "-"}</td>
                                        <td className="py-2 px-2 text-right font-mono text-teal-400">{p.bonus ? fmt(p.bonus) : "-"}</td>
                                        <td className="py-2 px-2 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button onClick={() => setViewingPayroll(p)} className={`p-1.5 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} text-blue-400 hover:text-blue-300 transition`} title="Voir détails" data-testid={`button-view-payroll-${p.id}`}>
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => { if (confirm("Supprimer cette fiche de paie ?")) deletePayMut.mutate(p.id); }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition" title="Supprimer" data-testid={`button-delete-payroll-${p.id}`}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
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
                                <span className="text-teal-400 font-mono">{viewingPayroll.bonus ? fmt(viewingPayroll.bonus) : "-"}</span>
                            </div>
                            <div>
                                <span className={`block text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Heures Sup.</span>
                                <span className="text-teal-400 font-mono">{viewingPayroll.overtime ? fmt(viewingPayroll.overtime) : "-"}</span>
                            </div>
                        </div>
                        <div className={`flex gap-2 pt-2 border-t ${dk ? "border-white/10" : "border-slate-200"}`}>
                            {viewingPayroll.pdfPath && (
                                <a href={`/api/v2/sugumaillane-management/files/${viewingPayroll.pdfPath}/download`} target="_blank" rel="noreferrer"
                                    className={btnPrimary + " flex items-center gap-2"} data-testid="button-view-pdf-payroll">
                                    <FileText className="w-3.5 h-3.5" /> Voir PDF Original
                                </a>
                            )}
                            <button onClick={() => { if (confirm("Supprimer cette fiche de paie ?")) { deletePayMut.mutate(viewingPayroll.id); setViewingPayroll(null); } }} className={btnDanger + " flex items-center gap-2"} data-testid="button-delete-payroll-modal">
                                <Trash2 className="w-3.5 h-3.5" /> Supprimer
                            </button>
                        </div>
                    </div>
                )}
            </FormModal>

            <CategoryFiles category="rh" label="Ressources Humaines" />

            {/* Forms */}
            <FormModal title="Nouvel Employé" open={showEmpForm} onClose={() => setShowEmpForm(false)}>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Prénom"><input aria-label="Prénom" className={ic} value={empForm.firstName || ""} onChange={e => setEmpForm({ ...empForm, firstName: e.target.value })} /></Field>
                    <Field label="Nom"><input aria-label="Nom" className={ic} value={empForm.lastName || ""} onChange={e => setEmpForm({ ...empForm, lastName: e.target.value })} /></Field>
                </div>
                <Field label="Poste"><input className={ic} value={empForm.role || ""} onChange={e => setEmpForm({ ...empForm, role: e.target.value })} placeholder="Ex: Serveur, Cuisinier..." /></Field>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Type de contrat">
                        <select aria-label="Type de contrat" className={ic} value={empForm.contractType} onChange={e => setEmpForm({ ...empForm, contractType: e.target.value })}>
                            {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </Field>
                    <Field label="Date d'entrée"><input aria-label="Date d'entrée" type="date" className={ic} value={empForm.startDate || ""} onChange={e => setEmpForm({ ...empForm, startDate: e.target.value })} /></Field>
                </div>
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
                    <select aria-label="Employé" className={ic} value={payForm.employeeId ?? ""} onChange={e => setPayForm({ ...payForm, employeeId: parseInt(e.target.value) })}>
                        <option value="">-- Sélectionner --</option>
                        {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                    </select>
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
                    <select aria-label="Employé" className={ic} value={absForm.employeeId ?? ""} onChange={e => setAbsForm({ ...absForm, employeeId: parseInt(e.target.value) })}>
                        <option value="">-- Sélectionner --</option>
                        {activeEmps.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                    </select>
                </Field>
                <Field label="Type">
                    <select aria-label="Type" className={ic} value={absForm.type} onChange={e => setAbsForm({ ...absForm, type: e.target.value })}>
                        {ABSENCE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
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
                        <select aria-label="Type de contrat" className={ic} value={editEmpData.contractType || "CDI"} onChange={e => setEditEmpData({ ...editEmpData, contractType: e.target.value })}>
                            {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </Field>
                    <Field label="Actif">
                        <select aria-label="Actif" className={ic} value={editEmpData.isActive ? "true" : "false"} onChange={e => setEditEmpData({ ...editEmpData, isActive: e.target.value === "true" })}>
                            <option value="true">Oui</option>
                            <option value="false">Non</option>
                        </select>
                    </Field>
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

