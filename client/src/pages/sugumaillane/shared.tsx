import { useState, useMemo, useContext, createContext, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SuguFile } from "../sugu/types";
import { FILE_CATEGORIES, fmt, fmtEur, catLabel } from "../sugu/helpers";
import { uploadFileAsBase64 } from "@/lib/uploadBase64";
import {
  ExternalLink,
  Loader2,
  Trash2,
  Eye,
  Minimize2,
  Maximize2,
  X,
  TrendingUp,
  TrendingDown,
  FileText,
  FolderOpen,
  Image,
  Download,
  ChevronUp,
  ChevronDown,
  Mail,
} from "lucide-react";

// ====== SUGU THEME CONTEXT ======
export const SuguThemeCtx = createContext(true);
export function useSuguDark() { return useContext(SuguThemeCtx); }

export function Card({ title, icon: Icon, children, action, extra, cardId, defaultCollapsed }: { title: string; icon: any; children: React.ReactNode; action?: React.ReactNode; extra?: React.ReactNode; cardId?: string; defaultCollapsed?: boolean }) {
    const dk = useSuguDark();
    const storageKey = useMemo(() => {
        const raw = cardId || title;
        return raw ? `sugum-card-${raw.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
    }, [cardId, title]);

    const [collapsed, setCollapsed] = useState(() => {
        if (!storageKey || typeof window === "undefined") return defaultCollapsed ?? false;
        const saved = localStorage.getItem(storageKey);
        if (saved === "collapsed") return true;
        if (saved === "expanded") return false;
        return defaultCollapsed ?? false;
    });

    useEffect(() => {
        if (!storageKey || typeof window === "undefined") return;
        localStorage.setItem(storageKey, collapsed ? "collapsed" : "expanded");
    }, [collapsed, storageKey]);

    return (
        <div className={dk ? "bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm" : "bg-white border border-slate-200 rounded-2xl shadow-sm"}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 text-teal-500" />
                    <h2 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{title}</h2>
                </div>
                <div className="flex items-center gap-2">
                    {extra}
                    {action}
                    <button
                        onClick={() => setCollapsed(v => !v)}
                        className={`p-2 rounded-lg transition ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}
                        title={collapsed ? "Agrandir la carte" : "Réduire la carte"}
                        aria-label={collapsed ? "Agrandir la carte" : "Réduire la carte"}
                    >
                        {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                </div>
            </div>
            {!collapsed && <div className="p-5">{children}</div>}
        </div>
    );
}

// ====== STAT CARD ======
export function StatCard({ label, value, icon: Icon, trend, color = "orange", compact, warning }: { label: string; value: string; icon: any; trend?: "up" | "down"; color?: string; compact?: boolean; warning?: string }) {
    const dk = useSuguDark();
    const darkMap: Record<string, string> = {
        orange: "from-teal-500/20 to-teal-600/10 border-teal-500/20",
        green: "from-green-500/20 to-green-600/10 border-green-500/20",
        red: "from-red-500/20 to-red-600/10 border-red-500/20",
        blue: "from-blue-500/20 to-blue-600/10 border-blue-500/20",
        purple: "from-purple-500/20 to-purple-600/10 border-purple-500/20",
    };
    const lightMap: Record<string, string> = {
        orange: "from-teal-50 to-teal-100/60 border-teal-200",
        green: "from-green-50 to-green-100/60 border-green-200",
        red: "from-red-50 to-red-100/60 border-red-200",
        blue: "from-blue-50 to-blue-100/60 border-blue-200",
        purple: "from-purple-50 to-purple-100/60 border-purple-200",
    };
    const iconDkMap: Record<string, string> = { orange: "text-teal-400", green: "text-green-400", red: "text-red-400", blue: "text-blue-400", purple: "text-purple-400" };
    const iconLtMap: Record<string, string> = { orange: "text-teal-500", green: "text-green-600", red: "text-red-500", blue: "text-blue-500", purple: "text-purple-500" };

    if (compact) {
        return (
            <div className={`bg-gradient-to-br ${dk ? darkMap[color] : lightMap[color]} border rounded-lg px-3 py-2 flex items-center gap-2`} title={warning || undefined}>
                <Icon className={`w-4 h-4 flex-shrink-0 ${dk ? (iconDkMap[color] || "text-white/60") : (iconLtMap[color] || "text-slate-500")}`} />
                <p className={`text-sm font-bold ${dk ? "text-white" : "text-slate-800"} truncate`}>{value}</p>
                <p className={`text-[10px] ${dk ? "text-white/50" : "text-slate-500"} truncate hidden sm:block`}>{label}</p>
                {warning && <span className="ml-auto text-amber-400 text-xs flex-shrink-0" title={warning}>⚠</span>}
                {!warning && trend === "up" && <TrendingUp className="w-3 h-3 text-green-500 flex-shrink-0 ml-auto" />}
                {!warning && trend === "down" && <TrendingDown className="w-3 h-3 text-red-500 flex-shrink-0 ml-auto" />}
            </div>
        );
    }

    return (
        <div className={`bg-gradient-to-br ${dk ? darkMap[color] : lightMap[color]} border rounded-xl p-4`}>
            <div className="flex items-center justify-between mb-2">
                <Icon className={`w-5 h-5 ${dk ? (iconDkMap[color] || "text-white/60") : (iconLtMap[color] || "text-slate-500")}`} />
                <div className="flex items-center gap-1">
                    {warning && <span className="text-amber-400 text-xs" title={warning}>⚠</span>}
                    {trend === "up" && <TrendingUp className="w-4 h-4 text-green-500" />}
                    {trend === "down" && <TrendingDown className="w-4 h-4 text-red-500" />}
                </div>
            </div>
            <p className={`text-2xl font-bold ${dk ? "text-white" : "text-slate-800"}`}>{value}</p>
            <p className={`text-xs mt-1 ${dk ? "text-white/50" : "text-slate-500"}`}>{label}</p>
            {warning && <p className="text-[10px] text-amber-400 mt-1 leading-tight">{warning}</p>}
        </div>
    );
}

// ====== FORM MODAL ======
export function FormModal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
    const dk = useSuguDark();
    if (!open) return null;
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className={`${dk ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"} border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{title}</h3>
                    <button onClick={onClose} className={`p-1 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`} title="Fermer"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">{children}</div>
            </div>
        </div>
    );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
    const dk = useSuguDark();
    return (
        <label className="block">
            <span className={`block text-sm mb-1 ${dk ? "text-white/60" : "text-slate-600"}`}>{label}</span>
            {children}
        </label>
    );
}

export function useInputClass() {
    const dk = useSuguDark();
    return dk
        ? "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50 [color-scheme:dark]"
        : "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30";
}

export const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500/50";
export const selectClass = inputClass;
export const btnPrimary = "bg-gradient-to-r from-teal-500 to-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center gap-2";
export const btnDanger = "bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg text-xs hover:bg-red-500/30 transition";

export function CardSizeToggle({ compact, setCompact }: { compact: boolean; setCompact: (v: boolean) => void }) {
    const dk = useSuguDark();
    return (
        <button
            onClick={() => setCompact(!compact)}
            className={`p-1.5 rounded-lg transition ${dk ? "hover:bg-white/10 text-white/50 hover:text-white/80" : "hover:bg-slate-200 text-slate-400 hover:text-slate-600"}`}
            title={compact ? "Agrandir les cartes" : "Réduire les cartes"}
            data-testid="button-toggle-card-size"
        >
            {compact ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
        </button>
    );
}

export const fmtSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo` : `${(bytes / 1024).toFixed(0)} Ko`;
export const isFileMimeImage = (mime: string) => mime.startsWith("image/");
export const isFilePreviewable = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");

export function FilePreviewModal({ file, onClose }: { file: SuguFile; onClose: () => void }) {
    const dk = useSuguDark();
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className={`relative w-[95vw] max-w-5xl h-[90vh] ${dk ? "bg-slate-900" : "bg-white"} rounded-2xl shadow-2xl border ${dk ? "border-white/10" : "border-slate-200"} flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-3 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                        <Eye className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <span className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`}>{file.originalName}</span>
                        <span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{fmtSize(file.fileSize)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <a href={`/api/v2/sugumaillane-management/files/${file.id}/download`} target="_blank" rel="noreferrer"
                            className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition" title="Ouvrir dans un nouvel onglet">
                            <ExternalLink className="w-4 h-4" />
                        </a>
                        <a href={`/api/v2/sugumaillane-management/files/${file.id}/download`} download={file.originalName}
                            className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition" title="Télécharger">
                            <Download className="w-4 h-4" />
                        </a>
                        <button onClick={onClose} className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition" title="Fermer" data-testid="btn-close-preview">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    {isFileMimeImage(file.mimeType) ? (
                        <div className="flex items-center justify-center h-full p-4">
                            <img src={`/api/v2/sugumaillane-management/files/${file.id}/download`} alt={file.originalName} className="max-w-full max-h-full object-contain rounded-lg" />
                        </div>
                    ) : (
                        <iframe src={`/api/v2/sugumaillane-management/files/${file.id}/download`} className="w-full h-full border-0" title={file.originalName} />
                    )}
                </div>
            </div>
        </div>
    );
}

// ====== INLINE EMAIL SEND (reusable) ======
export function InlineEmailSend({ fileId, onDone }: { fileId: number; onDone: () => void }) {
    const dk = useSuguDark();
    const [email, setEmail] = useState("x.markassuza@eyssautier.com");
    const [sending, setSending] = useState(false);
    const { toast } = useToast();
    const qc = useQueryClient();
    return (
        <div className={`flex items-center gap-2 mt-1 p-2 rounded-lg ${dk ? "bg-white/5 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={`flex-1 text-xs px-2 py-1.5 rounded border ${dk ? "bg-white/10 border-white/20 text-white" : "bg-white border-slate-300 text-slate-800"}`} placeholder="email@example.com" data-testid="input-email-send" />
            <button disabled={sending || !email.includes("@")} onClick={async () => {
                setSending(true);
                try {
                    await apiRequest("POST", `/api/v2/sugumaillane-management/files/${fileId}/send-email`, { to: email });
                    toast({ title: `Envoyé à ${email}` });
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
                    onDone();
                } catch { toast({ title: "Erreur d'envoi", variant: "destructive" }); }
                setSending(false);
            }} className="px-2 py-1.5 text-xs rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition disabled:opacity-50" data-testid="btn-confirm-email-send">
                {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Envoyer"}
            </button>
            <button onClick={onDone} className="px-1.5 py-1.5 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"><X className="w-3 h-3" /></button>
        </div>
    );
}

// ====== CATEGORY FILES SECTION (reusable in Banque / RH tabs) ======
export function CategoryFiles({ category, label }: { category: string; label: string }) {
    const dk = useSuguDark();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);
    const [emailFileId, setEmailFileId] = useState<number | null>(null);

    const { data: files = [] } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugumaillane-management/files", category],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugumaillane-management/files?category=${category}`, { credentials: "include" });
            return res.json();
        }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugumaillane-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/files"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugumaillane-management/trash"] });
            toast({ title: "Fichier déplacé dans la corbeille", description: "Vous avez 7 jours pour le restaurer depuis l'onglet Archives." });
        },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le fichier", variant: "destructive" }); }
    });

    const emailCount = files.filter(f => f.emailedTo && f.emailedTo.length > 0).length;

    if (files.length === 0) return null;

    return (
        <Card title={`Documents ${label}`} icon={FolderOpen} extra={files.length > 0 && <span className={`text-xs px-2 py-0.5 rounded-full ${emailCount === files.length ? "bg-emerald-500/20 text-emerald-400" : emailCount > 0 ? "bg-orange-500/20 text-orange-400" : "bg-slate-500/20 text-slate-400"}`}>{emailCount}/{files.length} envoyé</span>}>
            <div className="space-y-2">
                {files.map(f => (
                    <div key={f.id}>
                        <div className={`flex items-center gap-3 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-2.5 ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition`}>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                {isFileMimeImage(f.mimeType) ? <Image className="w-4 h-4 text-purple-400" /> : <FileText className="w-4 h-4 text-blue-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`} title={f.originalName}>{f.originalName}</p>
                                <div className={`flex items-center gap-2 text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>
                                    {f.supplier && <span>{f.supplier}</span>}
                                    {f.fileDate && <span>{fmtDate(f.fileDate)}</span>}
                                    <span>{fmtSize(f.fileSize)}</span>
                                    {f.emailedTo && f.emailedTo.length > 0 && <span className="text-emerald-400">envoyé</span>}
                                </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <button
                                    onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugumaillane-management/files/${f.id}/download`, "_blank")}
                                    className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-1.5 rounded-lg text-xs hover:bg-purple-500/30 transition flex items-center gap-1"
                                    title="Aperçu"
                                    data-testid={`btn-preview-file-${f.id}`}
                                >
                                    <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setEmailFileId(emailFileId === f.id ? null : f.id)}
                                    className={`px-2 py-1.5 rounded-lg text-xs transition flex items-center gap-1 ${f.emailedTo?.length ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30"}`}
                                    title="Envoyer par email" data-testid={`btn-email-file-${f.id}`}>
                                    <Mail className="w-3.5 h-3.5" />
                                </button>
                                <a href={`/api/v2/sugumaillane-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                    className={btnPrimary + " !px-2 !py-1.5"} title="Télécharger">
                                    <Download className="w-3.5 h-3.5" />
                                </a>
                                <button onClick={() => { if (confirm(`Mettre "${f.originalName}" dans la corbeille ?\n\nVous aurez 7 jours pour le restaurer.`)) deleteMut.mutate(f.id); }} className={btnDanger} title="Déplacer dans la corbeille" data-testid={`button-delete-file-${f.id}`}>
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        {emailFileId === f.id && <InlineEmailSend fileId={f.id} onDone={() => setEmailFileId(null)} />}
                    </div>
                ))}
            </div>
            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
        </Card>
    );
}

// ====== ACHATS TAB ======

export function normalizeCatKey(c: string): string {
    const k = c.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["electricite", "energie", "energy", "electricite"].includes(k)) return "energie";
    if (["eau", "water", "eau potable"].includes(k)) return "eau";
    if (["telecom", "telecommunications", "telecomunications"].includes(k)) return "telecom";
    if (["fournitures", "equipement", "materiel", "materiels"].includes(k)) return "materiels";
    if (["plateforme", "plateformes"].includes(k)) return "plateformes";
    if (["assurance", "assurances"].includes(k)) return "assurances";
    if (["vehicule", "vehicules"].includes(k)) return "vehicules";
    if (["produits_entretien"].includes(k)) return "entretien";
    return k;
}
export function CategoryBadge({ cat }: { cat?: string | null }) {
    const dk = useSuguDark();
    if (!cat) return <span className={`${dk ? "text-white/30" : "text-slate-300"} text-xs`}>—</span>;
    const key = normalizeCatKey(cat);
    const info = categoryLabels[key] || { label: cat, color: `${dk ? "bg-white/10" : "bg-slate-100"} ${dk ? "text-white/60" : "text-slate-600"}` };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${info.color}`}>{info.label}</span>;
}

export function MiniCalendar({ dateFrom, dateTo, onChange, dk }: {
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
                        <button key={ds} onClick={() => handleClick(ds)}
                            onMouseEnter={() => { if (dateFrom && !dateTo) setHoverDate(ds); }}
                            onMouseLeave={() => setHoverDate("")}
                            data-testid={`cal-day-${ds}`}
                            className={[
                                "text-xs py-1.5 w-full rounded transition-colors leading-none",
                                isStart || isEnd ? "bg-teal-500 text-white font-bold" : "",
                                inRange && !isStart && !isEnd ? (dk ? "bg-teal-500/25 text-teal-200" : "bg-teal-100 text-teal-700") : "",
                                !isStart && !isEnd && !inRange && isToday ? "font-bold underline" : "",
                                !isStart && !isEnd && !inRange ? (dk ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-100 text-slate-600") : "",
                            ].filter(Boolean).join(" ")}
                        >{parseInt(ds.slice(8))}</button>
                    );
                })}
            </div>
            {(dateFrom || dateTo) && (
                <p className={`text-[11px] mt-2 text-center ${dk ? "text-white/40" : "text-slate-400"}`}>
                    <span className="font-medium text-teal-400">{dateFrom || "…"}</span> → <span className="font-medium text-teal-400">{dateTo || "…"}</span>
                </p>
            )}
        </div>
    );
}

