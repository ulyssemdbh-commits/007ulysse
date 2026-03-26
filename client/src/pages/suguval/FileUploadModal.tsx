import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { X, Upload, FileText, Loader2, Image } from "lucide-react";
import { useSuguDark } from "./context";
import { SuguFile, FILE_CATEGORIES, catLabel } from "./types";
import { Field, useInputClass, FormSelect, btnPrimary } from "./shared";
import { uploadFileAsBase64 } from "@/lib/uploadBase64";

export function FileUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [fileType, setFileType] = useState<"photo" | "file">("file");
    const [category, setCategory] = useState("achats");
    const [supplier, setSupplier] = useState("");
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [fileDate, setFileDate] = useState(new Date().toISOString().substring(0, 10));
    const [capturedPhoto, setCapturedPhoto] = useState<File | null>(null);
    const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
    const [parsePreviewLoading, setParsePreviewLoading] = useState(false);
    const [parsePreviewData, setParsePreviewData] = useState<{ parsed: any; confidence: number; possibleDuplicates: any[]; matchedSupplier: any | null } | null>(null);
    const [parsePreviewError, setParsePreviewError] = useState<string | null>(null);

    if (!open) return null;

    const triggerParsePreview = async (file: File) => {
        if (!["achats", "frais_generaux"].includes(category)) return;
        setParsePreviewData(null);
        setParsePreviewError(null);
        setParsePreviewLoading(true);
        try {
            const res = await uploadFileAsBase64("/api/v2/sugu-management/files/parse-preview", file, { category });
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
                        console.warn(`[FileUpload] AI date "${data.parsed.date}" out of range, keeping form date`);
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

    const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setCapturedPhoto(file);
        setCapturedPreview(URL.createObjectURL(file));
        setFileType("photo");
        triggerParsePreview(file);
    };

    const handleOpenCamera = () => {
        setFileType("photo");
        cameraInputRef.current?.click();
    };

    const handleUpload = async () => {
        const file = capturedPhoto || fileInputRef.current?.files?.[0];
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

            const res = await uploadFileAsBase64("/api/v2/sugu-management/files", file, extra);
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
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/expenses"] });
                qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/purchases"] });
                if (data.autoDetected) {
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/employees"] });
                    qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/payroll"] });
                }
                onClose();
                setSupplier(""); setAmount(""); setDescription(""); setFileType("file");
                setCapturedPhoto(null); setCapturedPreview(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
                if (cameraInputRef.current) cameraInputRef.current.value = "";
            }
        } catch {
            toast({ title: "Erreur", description: "Impossible de transférer le fichier", variant: "destructive" });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
            <div className={`${dk ? "bg-slate-900" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-t-2xl sm:rounded-2xl w-full max-w-lg flex flex-col max-h-[92dvh]`} onClick={e => e.stopPropagation()}>
                {/* Sticky header */}
                <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"} flex-shrink-0`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"} flex items-center gap-2`}>
                        <Upload className="w-5 h-5 text-emerald-400" />
                        Transférer un Fichier
                    </h3>
                    <button onClick={onClose} className={`p-1 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`} title="Fermer"><X className="w-5 h-5" /></button>
                </div>
                {/* Scrollable content */}
                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                    {/* File Type Choice */}
                    <div>
                        <label className={`block text-sm ${dk ? "text-white/60" : "text-slate-600"} mb-2`}>Type de transfert</label>
                        {/* Hidden camera input — triggers native camera on mobile */}
                        <input
                            ref={cameraInputRef}
                            type="file"
                            accept="image/*"
                                                        className="hidden"
                            onChange={handlePhotoCapture}
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={handleOpenCamera}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition ${fileType === "photo" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"} ${dk ? "text-white/50" : "text-slate-500"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}`}
                                data-testid="button-open-camera">
                                <Image className="w-5 h-5" /> Photo
                            </button>
                            <button onClick={() => { setFileType("file"); setCapturedPhoto(null); setCapturedPreview(null); }}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition ${fileType === "file" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : `${dk ? "bg-white/5" : "bg-white"} ${dk ? "border-white/10" : "border-slate-200"} ${dk ? "text-white/50" : "text-slate-500"} ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}`}>
                                <FileText className="w-5 h-5" /> Fichier
                            </button>
                        </div>
                    </div>

                    {/* Category */}
                    <Field label="Catégorie">
                        <FormSelect aria-label="Catégorie" className={ic} value={category} onChange={e => setCategory(e.target.value)}>
                            {FILE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </FormSelect>
                    </Field>

                    {/* Photo preview or File input */}
                    {fileType === "photo" ? (
                        <div>
                            {capturedPreview ? (
                                <div className="relative">
                                    <img src={capturedPreview} alt="Aperçu" className="w-full max-h-48 object-contain rounded-xl border border-emerald-500/30 bg-black/20" />
                                    <button
                                        onClick={handleOpenCamera}
                                        className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${dk ? "bg-slate-900/80 text-emerald-400 hover:bg-slate-800" : "bg-white/90 text-emerald-600 hover:bg-white"} border border-emerald-500/30 transition`}
                                        data-testid="button-retake-photo">
                                        <Image className="w-3 h-3" /> Reprendre
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={handleOpenCamera}
                                    className={`w-full flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed text-sm transition ${dk ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" : "border-emerald-400 text-emerald-600 hover:bg-emerald-50"}`}
                                    data-testid="button-take-photo">
                                    <Image className="w-8 h-8 opacity-60" />
                                    <span>Appuyer pour prendre une photo</span>
                                    <span className={`text-xs ${dk ? "text-white/30" : "text-slate-400"}`}>Ticket de caisse, facture, reçu...</span>
                                </button>
                            )}
                        </div>
                    ) : (
                        <Field label="Sélectionner un fichier">
                            <input ref={fileInputRef} type="file"
                                aria-label="Sélectionner un fichier"
                                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
                                className={ic + " file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-emerald-500/20 file:text-emerald-400"}
                                onChange={e => { const f = e.target.files?.[0]; if (f) triggerParsePreview(f); }} />
                        </Field>
                    )}

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
                        const { parsed, confidence, possibleDuplicates, matchedSupplier } = parsePreviewData;
                        const confColor = confidence >= 80 ? "emerald" : confidence >= 60 ? "amber" : "red";
                        const confLabel = confidence >= 80 ? "Haute confiance" : confidence >= 60 ? "Confiance moyenne" : "Vérifiez les données";
                        return (
                            <div className={`rounded-xl border ${dk ? "border-emerald-500/20 bg-emerald-500/5" : "border-emerald-200 bg-emerald-50"} p-3 space-y-2`} data-testid="parse-preview-panel">
                                <div className="flex items-center justify-between">
                                    <span className={`text-xs font-semibold ${dk ? "text-white/60" : "text-slate-500"}`}>Résultat de l'analyse IA</span>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${confColor === "emerald" ? "bg-emerald-500/20 text-emerald-400" : confColor === "amber" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`} data-testid="confidence-badge">
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
                                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${dk ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700"}`} data-testid="supplier-link-badge">
                                        🔗 <span>Fournisseur lié : <strong>{matchedSupplier.name}</strong></span>
                                    </div>
                                )}
                                {!matchedSupplier && parsed.supplier && (
                                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${dk ? "bg-slate-700/60 text-white/50" : "bg-slate-100 text-slate-500"}`}>
                                        ➕ Nouveau fournisseur détecté — sera créé automatiquement si besoin
                                    </div>
                                )}
                                {possibleDuplicates.length > 0 && (
                                    <div className={`flex items-start gap-2 px-2 py-2 rounded-lg border ${dk ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-700"} text-xs`} data-testid="duplicate-warning">
                                        <span className="text-base">⚠️</span>
                                        <div>
                                            <strong>Doublon potentiel détecté</strong>
                                            {possibleDuplicates.map((d: any) => (
                                                <div key={d.id} className="opacity-80">→ {d.supplier} — {Number(d.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} ({d.invoiceDate})</div>
                                            ))}
                                            <div className="mt-1 font-medium">Continuez seulement si c'est une nouvelle facture.</div>
                                        </div>
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

                </div>
                {/* Sticky footer — always visible */}
                <div className={`px-5 py-4 border-t ${dk ? "border-white/10" : "border-slate-200"} flex-shrink-0`}>
                    <button onClick={handleUpload} className={btnPrimary + " w-full justify-center"} disabled={uploading} data-testid="button-upload-submit">
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? "Transfert en cours..." : "Transférer"}
                    </button>
                </div>
            </div>
        </div>
    );
}

