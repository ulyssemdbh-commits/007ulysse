import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Eye, Mail, Download, ExternalLink, X, ZoomIn, ZoomOut, Loader2, SendHorizonal, FileText, FolderOpen, Image, CheckCircle2, AlertCircle } from "lucide-react";
import { useSuguDark } from "./context";
import { SuguFile } from "./types";
import { Card, btnPrimary, btnDanger } from "./shared";

export const ACCOUNTANT_EMAIL = "x.markassuza@eyssautier.com";
export const fmtSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo` : `${(bytes / 1024).toFixed(0)} Ko`;
export const isFileMimeImage = (mime: string) => mime.startsWith("image/");
export const isFilePreviewable = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");

export function FilePreviewModal({ file, onClose }: { file: SuguFile; onClose: () => void }) {
    const dk = useSuguDark();
    const [showSendEmail, setShowSendEmail] = useState(false);
    const [zoom, setZoom] = useState(1);
    const isImage = isFileMimeImage(file.mimeType);
    const zoomIn = () => setZoom(z => Math.min(4, parseFloat((z + 0.25).toFixed(2))));
    const zoomOut = () => setZoom(z => Math.max(0.25, parseFloat((z - 0.25).toFixed(2))));
    const zoomReset = () => setZoom(1);
    return createPortal(
        <>
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className={`relative w-[95vw] max-w-5xl h-[90vh] ${dk ? "bg-slate-900" : "bg-white"} rounded-2xl shadow-2xl border ${dk ? "border-white/10" : "border-slate-200"} flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-3 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                        <Eye className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <span className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`}>{file.originalName}</span>
                        <span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{fmtSize(file.fileSize)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <div className={`flex items-center gap-0.5 border ${dk ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"} rounded-lg px-1 py-0.5`}>
                            <button onClick={zoomOut} disabled={zoom <= 0.25} className={`p-1.5 rounded ${dk ? "hover:bg-white/10 text-white/60 disabled:text-white/20" : "hover:bg-slate-200 text-slate-500 disabled:text-slate-300"} transition disabled:cursor-not-allowed`} title="Zoom arrière" data-testid="btn-zoom-out">
                                <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={zoomReset} className={`text-xs font-mono w-11 text-center ${dk ? "text-white/60 hover:text-white" : "text-slate-600 hover:text-slate-900"} transition`} title="Réinitialiser le zoom" data-testid="btn-zoom-reset">
                                {Math.round(zoom * 100)}%
                            </button>
                            <button onClick={zoomIn} disabled={zoom >= 4} className={`p-1.5 rounded ${dk ? "hover:bg-white/10 text-white/60 disabled:text-white/20" : "hover:bg-slate-200 text-slate-500 disabled:text-slate-300"} transition disabled:cursor-not-allowed`} title="Zoom avant" data-testid="btn-zoom-in">
                                <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <button onClick={() => setShowSendEmail(true)} className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition" title="Envoyer par email" data-testid="btn-email-from-preview">
                            <Mail className="w-4 h-4" />
                        </button>
                        <a href={`/api/v2/sugu-management/files/${file.id}/download`} target="_blank" rel="noreferrer"
                            className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition" title="Ouvrir dans un nouvel onglet">
                            <ExternalLink className="w-4 h-4" />
                        </a>
                        <a href={`/api/v2/sugu-management/files/${file.id}/download`} download={file.originalName}
                            className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition" title="Télécharger">
                            <Download className="w-4 h-4" />
                        </a>
                        <button onClick={onClose} className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition" title="Fermer" data-testid="btn-close-preview">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto">
                    {isImage ? (
                        <div className="flex items-start justify-center p-4" style={{ minHeight: "100%", zoom }}>
                            <img src={`/api/v2/sugu-management/files/${file.id}/download`} alt={file.originalName} className="max-w-full object-contain rounded-lg" style={{ display: "block" }} />
                        </div>
                    ) : (
                        <div className="w-full h-full" style={{ zoom }}>
                            <iframe src={`/api/v2/sugu-management/files/${file.id}/download`} className="w-full h-full border-0" title={file.originalName} />
                        </div>
                    )}
                </div>
            </div>
        </div>
        {showSendEmail && <SendEmailModal file={file} onClose={() => setShowSendEmail(false)} />}
        </>,
        document.body
    );
}

export function SendEmailModal({ file, onClose }: { file: SuguFile; onClose: () => void }) {
    const dk = useSuguDark();
    const { toast } = useToast();
    const qc = useQueryClient();
    const [email, setEmail] = useState(ACCOUNTANT_EMAIL);
    const [sending, setSending] = useState(false);

    const alreadySent = (file.emailedTo || []).includes(email);

    async function handleSend() {
        if (!email.includes("@")) {
            toast({ title: "Email invalide", description: "Veuillez saisir une adresse email valide", variant: "destructive" });
            return;
        }
        setSending(true);
        try {
            const res = await fetch(`/api/v2/sugu-management/files/${file.id}/send-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ to: email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Échec de l'envoi");
            toast({ title: "Email envoyé !", description: `${file.originalName} envoyé à ${email}` });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
            onClose();
        } catch (err: any) {
            toast({ title: "Erreur", description: err.message, variant: "destructive" });
        } finally {
            setSending(false);
        }
    }

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className={`w-full max-w-md mx-4 ${dk ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"} border rounded-2xl shadow-2xl p-6`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Envoyer par email</h3>
                        <p className={`text-xs mt-0.5 ${dk ? "text-white/50" : "text-slate-400"} truncate max-w-[280px]`} title={file.originalName}>{file.originalName}</p>
                    </div>
                    <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition" data-testid="btn-close-send-email">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className={`text-xs font-medium ${dk ? "text-white/60" : "text-slate-600"} block mb-1.5`}>Adresse email du destinataire</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleSend()}
                            placeholder="exemple@domaine.com"
                            autoFocus
                            data-testid="input-send-email-recipient"
                            className={`w-full px-3 py-2.5 rounded-xl border text-sm ${dk ? "bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-blue-500/50" : "bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-blue-400"} outline-none transition focus:ring-2 focus:ring-blue-500/20`}
                        />
                    </div>
                    <p className={`text-xs ${dk ? "text-white/30" : "text-slate-400"}`}>
                        L'email sera envoyé depuis <span className={`font-mono ${dk ? "text-white/50" : "text-slate-500"}`}>ulyssemdbh@gmail.com</span>
                    </p>
                </div>
                {alreadySent && (
                    <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-xs">
                        <X className="w-3.5 h-3.5 flex-shrink-0" />
                        Déjà envoyé à <span className="font-mono">{email}</span>
                    </div>
                )}
                <div className="flex gap-2 mt-4">
                    <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${dk ? "bg-white/5 hover:bg-white/10 text-white/60" : "bg-slate-100 hover:bg-slate-200 text-slate-600"} transition`} data-testid="btn-cancel-send-email">
                        Annuler
                    </button>
                    <button
                        onClick={handleSend}
                        disabled={sending || !email.includes("@")}
                        data-testid="btn-confirm-send-email"
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition flex items-center justify-center gap-2"
                    >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
                        {sending ? "Envoi..." : alreadySent ? "Renvoyer" : "Envoyer"}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

export function BulkSendEmailModal({ files, onClose }: { files: SuguFile[]; onClose: () => void }) {
    const dk = useSuguDark();
    const { toast } = useToast();
    const qc = useQueryClient();
    const [email, setEmail] = useState(ACCOUNTANT_EMAIL);
    const [sending, setSending] = useState(false);

    async function handleSend() {
        if (!email.includes("@")) {
            toast({ title: "Email invalide", variant: "destructive" });
            return;
        }
        setSending(true);
        try {
            const res = await fetch(`/api/v2/sugu-management/files/send-email-bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ to: email, fileIds: files.map(f => f.id) }),
            });
            const data = await res.json();
            if (res.ok) {
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
                toast({ title: `${files.length} fichier${files.length > 1 ? "s" : ""} envoyé${files.length > 1 ? "s" : ""} dans 1 email`, description: `Destinataire : ${email}` });
            } else {
                toast({ title: "Échec de l'envoi", description: data.error || "Erreur inconnue", variant: "destructive" });
            }
        } catch {
            toast({ title: "Erreur réseau", variant: "destructive" });
        }
        setSending(false);
        onClose();
    }

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className={`w-full max-w-md mx-4 ${dk ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"} border rounded-2xl shadow-2xl p-6`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Envoyer {files.length} fichier{files.length > 1 ? "s" : ""} par email</h3>
                        <p className={`text-xs mt-0.5 ${dk ? "text-white/50" : "text-slate-400"}`}>{files.length > 1 ? "Tous les fichiers seront joints dans un seul email" : "Le fichier sera envoyé en pièce jointe"}</p>
                    </div>
                    <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"><X className="w-4 h-4" /></button>
                </div>
                <div className={`mb-4 max-h-32 overflow-y-auto rounded-lg border ${dk ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"} px-3 py-2 space-y-1`}>
                    {files.map(f => (
                        <div key={f.id} className="flex items-center gap-2">
                            <FileText className={`w-3 h-3 flex-shrink-0 ${dk ? "text-white/40" : "text-slate-400"}`} />
                            <span className={`text-xs truncate ${dk ? "text-white/70" : "text-slate-700"}`}>{f.originalName}</span>
                        </div>
                    ))}
                </div>
                <div className="space-y-3">
                    <div>
                        <label className={`text-xs font-medium ${dk ? "text-white/60" : "text-slate-600"} block mb-1.5`}>Destinataire</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="exemple@domaine.com" autoFocus
                            className={`w-full px-3 py-2.5 rounded-xl border text-sm ${dk ? "bg-white/5 border-white/10 text-white placeholder-white/30 focus:border-blue-500/50" : "bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-blue-400"} outline-none transition focus:ring-2 focus:ring-blue-500/20`}
                        />
                    </div>
                    <p className={`text-xs ${dk ? "text-white/30" : "text-slate-400"}`}>Envoyé depuis <span className="font-mono">ulyssemdbh@gmail.com</span></p>
                </div>
                <div className="flex gap-2 mt-4">
                    <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${dk ? "bg-white/5 hover:bg-white/10 text-white/60" : "bg-slate-100 hover:bg-slate-200 text-slate-600"} transition`}>Annuler</button>
                    <button onClick={handleSend} disabled={sending || !email.includes("@")}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition flex items-center justify-center gap-2"
                        data-testid="btn-bulk-send-email">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
                        {sending ? "Envoi en cours…" : `Envoyer ${files.length} fichier${files.length > 1 ? "s" : ""}`}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

export function CategoryFiles({ category, label, restricted }: { category: string; label: string; restricted?: boolean }) {
    const dk = useSuguDark();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [previewFile, setPreviewFile] = useState<SuguFile | null>(null);
    const [sendEmailFile, setSendEmailFile] = useState<SuguFile | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [showBulkEmail, setShowBulkEmail] = useState(false);

    const { data: files = [] } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugu-management/files", category],
        queryFn: async () => {
            const res = await fetch(`/api/v2/sugu-management/files?category=${category}`, { credentials: "include" });
            return res.json();
        }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/trash"] });
            toast({ title: "Fichier déplacé dans la corbeille", description: "Vous avez 7 jours pour le restaurer depuis l'onglet Archives." });
        },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le fichier", variant: "destructive" }); }
    });

    const allSelected = files.length > 0 && files.every(f => selectedIds.has(f.id));
    const selectedFiles = files.filter(f => selectedIds.has(f.id));
    const toggleSelect = (id: number) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedIds(next);
    };
    const toggleAll = () => {
        if (allSelected) setSelectedIds(new Set());
        else setSelectedIds(new Set(files.map(f => f.id)));
    };

    const sentCount = files.filter(f => (f.emailedTo || []).includes(ACCOUNTANT_EMAIL)).length;
    const totalCount = files.length;
    const allSent = totalCount > 0 && sentCount === totalCount;
    const noneSent = sentCount === 0;

    const emailStatusBadge = totalCount > 0 ? (
        <div
            data-testid={`badge-email-status-${category}`}
            title={allSent ? `Tous envoyés au comptable (${sentCount}/${totalCount})` : `${sentCount}/${totalCount} envoyé(s) au comptable`}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border ${
                allSent
                    ? dk ? "bg-green-500/15 border-green-500/30 text-green-400" : "bg-green-50 border-green-200 text-green-600"
                    : noneSent
                        ? dk ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-red-50 border-red-200 text-red-500"
                        : dk ? "bg-orange-500/15 border-orange-500/30 text-orange-400" : "bg-orange-50 border-orange-200 text-orange-600"
            }`}
        >
            {allSent ? <CheckCircle2 className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
            {sentCount}/{totalCount} envoyé{sentCount > 1 ? "s" : ""}
        </div>
    ) : null;

    if (files.length === 0) {
        return (
            <Card title={`Documents ${label}`} icon={FolderOpen}>
                <div className={`flex flex-col items-center justify-center py-6 ${dk ? "text-white/30" : "text-slate-400"}`}>
                    <FolderOpen className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm">Aucun document pour le moment</p>
                    <p className="text-xs mt-1 opacity-70">Les fichiers uploadés apparaîtront ici</p>
                </div>
            </Card>
        );
    }

    return (
        <Card title={`Documents ${label}`} icon={FolderOpen} action={emailStatusBadge}>
            <div className={`flex items-center gap-2 mb-2 pb-2 border-b ${dk ? "border-white/10" : "border-slate-100"}`}>
                <button onClick={toggleAll} title={allSelected ? "Tout désélectionner" : "Tout sélectionner"}
                    className={`flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 transition cursor-pointer ${allSelected ? "bg-blue-500/15 border-blue-500/60" : dk ? "border-slate-500 hover:border-slate-300 bg-transparent" : "border-slate-700 hover:border-slate-900 bg-transparent"}`}>
                    {allSelected && <X className="w-3 h-3 text-blue-400 stroke-[3]" />}
                </button>
                <span className={`text-[11px] ${dk ? "text-white/40" : "text-slate-400"}`}>
                    {selectedIds.size > 0 ? `${selectedIds.size} sélectionné(s)` : "Tout sélectionner"}
                </span>
                {selectedIds.size > 0 && (
                    <button onClick={() => setShowBulkEmail(true)}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs hover:bg-blue-500/30 transition font-medium">
                        <Mail className="w-3 h-3" /> Envoyer {selectedIds.size} fichier{selectedIds.size > 1 ? "s" : ""}
                    </button>
                )}
            </div>
            <div className="space-y-1.5">
                {files.map(f => (
                    <div key={f.id} className={`flex items-center gap-2 ${selectedIds.has(f.id) ? dk ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-200" : dk ? "bg-white/5 border-white/10" : "bg-white border-slate-200"} border rounded-lg px-2 py-1 ${dk ? "hover:bg-white/10" : "hover:bg-slate-50"} transition`}>
                        <button onClick={() => toggleSelect(f.id)} title={selectedIds.has(f.id) ? "Désélectionner" : "Sélectionner"}
                            className="flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 transition cursor-pointer border-slate-700 hover:border-slate-900 bg-transparent text-[#6b6b6b]">
                            {selectedIds.has(f.id) && <X className="w-3 h-3 text-blue-400 stroke-[3]" />}
                        </button>
                        <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                            {isFileMimeImage(f.mimeType) ? <Image className="w-3 h-3 text-purple-400" /> : <FileText className="w-3 h-3 text-blue-400" />}
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
                            <p className={`text-xs font-medium ${dk ? "text-white" : "text-slate-800"} truncate min-w-0`} title={f.originalName}>{f.originalName}</p>
                            <span className={`text-[11px] flex-shrink-0 ${dk ? "text-white/40" : "text-slate-400"}`}>{new Date(f.createdAt).toLocaleDateString("fr-FR")}</span>
                            <span className={`text-[11px] flex-shrink-0 ${dk ? "text-white/40" : "text-slate-400"}`}>{fmtSize(f.fileSize)}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {(() => {
                                const sent = (f.emailedTo || []).includes(ACCOUNTANT_EMAIL);
                                return (
                                    <div
                                        title={sent ? `✓ Envoyé au comptable (${ACCOUNTANT_EMAIL})` : `À envoyer au comptable (${ACCOUNTANT_EMAIL})`}
                                        data-testid={`checkbox-emailed-accountant-${f.id}`}
                                        className={`flex items-center justify-center w-4 h-4 rounded border-2 flex-shrink-0 ${sent ? "bg-green-500/15 border-green-500/50" : dk ? "border-slate-500 bg-transparent" : "border-slate-700 bg-transparent"}`}>
                                        {sent && <X className="w-2.5 h-2.5 text-green-400 stroke-[3]" />}
                                    </div>
                                );
                            })()}
                            <button onClick={() => isFilePreviewable(f.mimeType) ? setPreviewFile(f) : window.open(`/api/v2/sugu-management/files/${f.id}/download`, "_blank")}
                                className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-1.5 rounded-lg text-xs hover:bg-purple-500/30 transition flex items-center gap-1"
                                title="Aperçu" data-testid={`btn-preview-file-${f.id}`}>
                                <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setSendEmailFile(f)}
                                className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-1.5 rounded-lg text-xs hover:bg-blue-500/30 transition flex items-center gap-1"
                                title="Envoyer par email" data-testid={`btn-email-file-${f.id}`}>
                                <Mail className="w-3.5 h-3.5" />
                            </button>
                            <a href={`/api/v2/sugu-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                className={btnPrimary + " !px-2 !py-1.5"} title="Télécharger">
                                <Download className="w-3.5 h-3.5" />
                            </a>
                            {!restricted && (
                                <button onClick={() => { if (confirm(`Mettre "${f.originalName}" dans la corbeille ?\n\nVous aurez 7 jours pour le restaurer.`)) deleteMut.mutate(f.id); }} className={btnDanger} title="Déplacer dans la corbeille" data-testid={`button-delete-file-${f.id}`}>
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
            {sendEmailFile && <SendEmailModal file={sendEmailFile} onClose={() => setSendEmailFile(null)} />}
            {showBulkEmail && selectedFiles.length > 0 && <BulkSendEmailModal files={selectedFiles} onClose={() => { setShowBulkEmail(false); setSelectedIds(new Set()); }} />}
        </Card>
    );
}
