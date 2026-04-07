import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trash2, X, AlertTriangle, FileText, Loader2, Archive, FolderOpen, Image, Download, Search, Save, Database, RotateCcw, Shield, Eye, Mail, Building2, PackageOpen } from "lucide-react";
import { useSuguDark } from "./context";
import { SuguFile, SuguBackup, SuguTrashItem, Supplier, FILE_CATEGORIES, catLabel, fmtDate } from "./types";
import { Card, StatCard, useInputClass, FormSelect, btnPrimary, btnDanger, PeriodFilter, usePeriodFilter } from "./shared";
import { fmtSize, isFileMimeImage, FilePreviewModal, SendEmailModal } from "./fileModals";

export function ArchivesTab({ restricted }: { restricted?: boolean } = {}) {
    const dk = useSuguDark();
    const ic = useInputClass();
    const qc = useQueryClient();
    const { toast } = useToast();
    const [filterCat, setFilterCat] = useState<string>("");
    const [searchTerm, setSearchTerm] = useState("");
    const [backupLabel, setBackupLabel] = useState("");
    const [showBackupCreate, setShowBackupCreate] = useState(false);
    const [restoringId, setRestoringId] = useState<number | null>(null);
    const pf = usePeriodFilter("month");

    const { data: files = [], isLoading } = useQuery<SuguFile[]>({
        queryKey: ["/api/v2/sugu-management/files", filterCat],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (filterCat) params.set("category", filterCat);
            const res = await fetch(`/api/v2/sugu-management/files?${params}`, { credentials: "include" });
            return res.json();
        }
    });

    const { data: backups = [], isLoading: backupsLoading } = useQuery<SuguBackup[]>({
        queryKey: ["/api/v2/sugu-management/backups"],
        queryFn: async () => {
            const res = await fetch("/api/v2/sugu-management/backups", { credentials: "include" });
            if (!res.ok) throw new Error("Erreur chargement sauvegardes");
            return res.json();
        }
    });

    const createBackupMut = useMutation({
        mutationFn: async (label: string) => {
            const res = await apiRequest("POST", "/api/v2/sugu-management/backup", { label: label || undefined });
            return res.json();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/backups"] });
            toast({ title: "Sauvegarde créée", description: "Toutes les données ont été sauvegardées avec succès." });
            setBackupLabel("");
            setShowBackupCreate(false);
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de créer la sauvegarde", variant: "destructive" })
    });

    const deleteBackupMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/backups/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/backups"] }); toast({ title: "Sauvegarde supprimée" }); },
        onError: () => toast({ title: "Erreur", description: "Impossible de supprimer la sauvegarde", variant: "destructive" })
    });

    const restoreBackupMut = useMutation({
        mutationFn: async (id: number) => {
            setRestoringId(id);
            const res = await apiRequest("POST", `/api/v2/sugu-management/backups/${id}/restore`);
            return res.json();
        },
        onSuccess: (_data, id) => {
            setRestoringId(null);
            const b = backups.find(x => x.id === id);
            toast({ title: "Restauration réussie", description: `Les données ont été restaurées depuis "${b?.label || "la sauvegarde"}". Rechargement...` });
            qc.clear();
            setTimeout(() => window.location.reload(), 800);
        },
        onError: () => { setRestoringId(null); toast({ title: "Erreur", description: "Impossible de restaurer la sauvegarde", variant: "destructive" }); }
    });

    const deleteMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/files/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/trash"] });
            toast({ title: "Fichier déplacé dans la corbeille", description: "Vous avez 7 jours pour le restaurer." });
        },
        onError: () => { toast({ title: "Erreur", description: "Impossible de supprimer le fichier", variant: "destructive" }); }
    });

    const { data: trashItems = [], isLoading: trashLoading } = useQuery<SuguTrashItem[]>({
        queryKey: ["/api/v2/sugu-management/trash"],
        queryFn: async () => {
            const res = await fetch("/api/v2/sugu-management/trash", { credentials: "include" });
            if (!res.ok) throw new Error("Erreur chargement corbeille");
            return res.json();
        },
        refetchInterval: 30000,
    });

    const restoreTrashMut = useMutation({
        mutationFn: (id: number) => apiRequest("POST", `/api/v2/sugu-management/trash/${id}/restore`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/trash"] });
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/files"] });
            toast({ title: "Fichier restauré", description: "Le fichier a été remis dans les archives." });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de restaurer le fichier", variant: "destructive" })
    });

    const deleteTrashMut = useMutation({
        mutationFn: (id: number) => apiRequest("DELETE", `/api/v2/sugu-management/trash/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/trash"] });
            toast({ title: "Suppression définitive effectuée" });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de supprimer définitivement", variant: "destructive" })
    });

    const periodFiles = files.filter(f => {
        const d = (f.fileDate || f.createdAt || "").slice(0, 10);
        if (!d) return true;
        return d >= pf.period.from && d <= pf.period.to;
    });

    const filteredFiles = searchTerm
        ? periodFiles.filter(f =>
            f.originalName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (f.supplier || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
            (f.description || "").toLowerCase().includes(searchTerm.toLowerCase())
        )
        : periodFiles;

    const catLabel = (cat: string) => FILE_CATEGORIES.find(c => c.value === cat)?.label || cat;

    const totalFiles = periodFiles.length;
    const totalSize = periodFiles.reduce((s, f) => s + f.fileSize, 0);
    const byCat = FILE_CATEGORIES.map(c => ({
        ...c,
        count: periodFiles.filter(f => f.category === c.value).length
    }));

    const parseTableCounts = (tc: string | null) => {
        if (!tc) return null;
        try { return JSON.parse(tc) as Record<string, number>; } catch { return null; }
    };

    const fmtBackupDate = (d: string) => {
        try {
            return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        } catch { return d; }
    };

    return (
        <div className="space-y-6">
            <PeriodFilter {...pf} />

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total fichiers" value={String(totalFiles)} icon={Archive} color="blue" />
                <StatCard label="Taille totale" value={fmtSize(totalSize)} icon={FolderOpen} color="purple" />
                {byCat.filter(c => c.count > 0).slice(0, 2).map(c => (
                    <StatCard key={c.value} label={c.label} value={String(c.count)} icon={FileText} color="orange" />
                ))}
            </div>

            {/* ===== SAUVEGARDE CARD ===== */}
            {!restricted && <Card title="Sauvegardes" icon={Shield}
                action={
                    <button
                        data-testid="button-create-backup"
                        onClick={() => setShowBackupCreate(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${dk ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                        <Save className="w-3.5 h-3.5" />
                        Nouvelle sauvegarde
                    </button>
                }>

                {/* Create form */}
                {showBackupCreate && (
                    <div className={`mb-4 p-4 rounded-xl border ${dk ? "bg-white/5 border-white/10" : "bg-slate-50 border-slate-200"}`}>
                        <p className={`text-sm font-medium mb-3 ${dk ? "text-white/80" : "text-slate-700"}`}>
                            Créer une sauvegarde complète de toutes les données SUGU Valentine
                        </p>
                        <div className="flex gap-2">
                            <input
                                data-testid="input-backup-label"
                                className={ic + " flex-1"}
                                placeholder="Nom de la sauvegarde (optionnel)"
                                value={backupLabel}
                                onChange={e => setBackupLabel(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") createBackupMut.mutate(backupLabel); }}
                            />
                            <button
                                data-testid="button-confirm-backup"
                                onClick={() => createBackupMut.mutate(backupLabel)}
                                disabled={createBackupMut.isPending}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition ${dk ? "bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50" : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"}`}>
                                {createBackupMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Sauvegarder
                            </button>
                            <button onClick={() => setShowBackupCreate(false)} className={`px-3 py-2 rounded-lg text-sm transition ${dk ? "text-white/50 hover:text-white/80" : "text-slate-400 hover:text-slate-600"}`}>
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <p className={`text-xs mt-2 ${dk ? "text-white/30" : "text-slate-400"}`}>
                            Inclut : fournisseurs, achats, dépenses, banque, prêts, caisse, employés, paie, absences, fichiers, commandes HubRise
                        </p>
                    </div>
                )}

                {/* Backups list */}
                {backupsLoading ? (
                    <div className={`flex items-center justify-center py-8 ${dk ? "text-white/40" : "text-slate-400"}`}>
                        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement...
                    </div>
                ) : backups.length === 0 ? (
                    <div className={`text-center py-8 ${dk ? "text-white/30" : "text-slate-400"}`}>
                        <Database className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Aucune sauvegarde disponible</p>
                        <p className="text-xs mt-1">Créez une première sauvegarde pour protéger vos données</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {backups.map(b => {
                            const counts = parseTableCounts(b.tableCounts);
                            const totalRecords = counts ? Object.values(counts).reduce((a, c) => a + c, 0) : 0;
                            const isRestoring = restoringId === b.id;
                            return (
                                <div key={b.id} data-testid={`backup-row-${b.id}`} className={`flex items-center gap-3 p-3 rounded-xl border transition ${dk ? "bg-white/5 border-white/10 hover:bg-white/8" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                                    {/* Icon */}
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${dk ? "bg-emerald-500/20" : "bg-emerald-50"}`}>
                                        <Database className="w-5 h-5 text-emerald-500" />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-medium truncate ${dk ? "text-white" : "text-slate-800"}`}>{b.label}</p>
                                        <div className={`flex flex-wrap items-center gap-3 text-xs mt-0.5 ${dk ? "text-white/40" : "text-slate-400"}`}>
                                            <span>📅 {fmtBackupDate(b.createdAt)}</span>
                                            {totalRecords > 0 && <span>🗂 {totalRecords} enregistrements</span>}
                                            {b.sizeBytes && b.sizeBytes > 0 && <span>💾 {fmtSize(b.sizeBytes)}</span>}
                                        </div>
                                        {counts && (
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => (
                                                    <span key={k} className={`px-1.5 py-0.5 rounded text-xs ${dk ? "bg-white/10 text-white/50" : "bg-slate-100 text-slate-500"}`}>
                                                        {k}: {v}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-1 flex-shrink-0">
                                        <a
                                            href={`/api/v2/sugu-management/backups/${b.id}/download-zip`}
                                            target="_blank" rel="noreferrer"
                                            data-testid={`button-download-zip-${b.id}`}
                                            className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}
                                            title="Télécharger ZIP complet (données + fichiers)">
                                            <PackageOpen className="w-3.5 h-3.5" />
                                        </a>
                                        <a
                                            href={`/api/v2/sugu-management/backups/${b.id}/download`}
                                            target="_blank" rel="noreferrer"
                                            data-testid={`button-download-backup-${b.id}`}
                                            className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}
                                            title="Télécharger les données JSON">
                                            <Download className="w-3.5 h-3.5" />
                                        </a>
                                        <button
                                            data-testid={`button-restore-backup-${b.id}`}
                                            onClick={() => {
                                                if (confirm(`Restaurer "${b.label}" ?\n\nATTENTION : Toutes les données actuelles seront remplacées par celles de cette sauvegarde. Cette action est irréversible.`))
                                                    restoreBackupMut.mutate(b.id);
                                            }}
                                            disabled={isRestoring || restoreBackupMut.isPending}
                                            className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50" : "bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-50"}`}
                                            title="Restaurer cette sauvegarde">
                                            {isRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                        </button>
                                        <button
                                            data-testid={`button-delete-backup-${b.id}`}
                                            onClick={() => { if (confirm(`Supprimer la sauvegarde "${b.label}" ?`)) deleteBackupMut.mutate(b.id); }}
                                            className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-500 hover:bg-red-100"}`}
                                            title="Supprimer">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>}

            {/* ===== CORBEILLE CARD ===== */}
            {!restricted && (
                <Card
                    title={`Corbeille${trashItems.length > 0 ? ` (${trashItems.length})` : ""}`}
                    icon={Trash2}
                    action={
                        trashItems.length > 0 ? (
                            <span className={`text-xs px-2 py-1 rounded-full ${dk ? "bg-red-500/20 text-red-400" : "bg-red-50 text-red-500"}`}>
                                Suppression auto dans 7 j
                            </span>
                        ) : undefined
                    }>
                    {trashLoading ? (
                        <div className={`flex items-center justify-center py-8 ${dk ? "text-white/40" : "text-slate-400"}`}>
                            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement...
                        </div>
                    ) : trashItems.length === 0 ? (
                        <div className={`text-center py-8 ${dk ? "text-white/30" : "text-slate-400"}`}>
                            <Trash2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">La corbeille est vide</p>
                            <p className="text-xs mt-1">Les fichiers supprimés apparaissent ici pendant 7 jours</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {trashItems.map(item => {
                                const daysLeft = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86400000));
                                const isExpiringSoon = daysLeft <= 2;
                                return (
                                    <div key={item.id} data-testid={`trash-item-${item.id}`} className={`flex items-center gap-3 p-3 rounded-xl border transition ${dk ? "bg-white/5 border-white/10" : "bg-white border-slate-200"}`}>
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${dk ? "bg-red-500/10" : "bg-red-50"}`}>
                                            {isExpiringSoon ? <AlertTriangle className="w-5 h-5 text-red-400" /> : <FileText className="w-5 h-5 text-red-300" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm font-medium truncate ${dk ? "text-white/70" : "text-slate-600"}`}>{item.originalName}</p>
                                            <div className={`flex flex-wrap items-center gap-3 text-xs mt-0.5 ${dk ? "text-white/40" : "text-slate-400"}`}>
                                                <span className={`px-2 py-0.5 rounded-full text-xs ${item.category === "achats" ? "bg-orange-500/20 text-orange-400" : "bg-purple-500/20 text-purple-400"}`}>
                                                    {FILE_CATEGORIES.find(c => c.value === item.category)?.label || item.category}
                                                </span>
                                                {item.supplier && <span>📦 {item.supplier}</span>}
                                                <span>{fmtSize(item.fileSize)}</span>
                                                <span className={`font-medium ${isExpiringSoon ? "text-red-400" : dk ? "text-white/50" : "text-slate-500"}`}>
                                                    {daysLeft === 0 ? "Expire aujourd'hui" : `${daysLeft}j restant${daysLeft > 1 ? "s" : ""}`}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 flex-shrink-0">
                                            <button
                                                data-testid={`button-restore-trash-${item.id}`}
                                                onClick={() => restoreTrashMut.mutate(item.id)}
                                                disabled={restoreTrashMut.isPending}
                                                className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}
                                                title="Restaurer le fichier">
                                                <RotateCcw className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                data-testid={`button-delete-trash-${item.id}`}
                                                onClick={() => { if (confirm(`Supprimer définitivement "${item.originalName}" ?\n\nCette action est irréversible.`)) deleteTrashMut.mutate(item.id); }}
                                                disabled={deleteTrashMut.isPending}
                                                className={`flex items-center justify-center w-8 h-8 rounded-lg transition ${dk ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-500 hover:bg-red-100"}`}
                                                title="Supprimer définitivement">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>
            )}

            {/* Filters */}
            <Card title="Archives" icon={Archive}
                action={
                    <div className="flex gap-2 items-center">
                        <div className="relative">
                            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${dk ? "text-white/30" : "text-slate-300"}`} />
                            <input className={ic + " pl-9 w-48"} placeholder="Rechercher..."
                                value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                        </div>
                        <FormSelect aria-label="Filtrer par catégorie" className={ic + " w-40"} value={filterCat} onChange={e => { setFilterCat(e.target.value); }}>
                            <option value="">Toutes catégories</option>
                            {FILE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </FormSelect>
                    </div>
                }>
                {isLoading ? (
                    <div className={`flex items-center justify-center py-12 ${dk ? "text-white/40" : "text-slate-400"}`}>
                        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Chargement...
                    </div>
                ) : filteredFiles.length === 0 ? (
                    <p className={`${dk ? "text-white/40" : "text-slate-400"} text-center py-8`}>Aucun fichier archivé</p>
                ) : (
                    <div className="space-y-2">
                        {filteredFiles.map(f => (
                            <div key={f.id} className={`flex items-center gap-4 ${dk ? "bg-white/5" : "bg-white"} border ${dk ? "border-white/10" : "border-slate-200"} rounded-xl p-3 ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"} transition`}>
                                {/* Icon */}
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isFileMimeImage(f.mimeType) ? "bg-purple-500/20" : "bg-blue-500/20"}`}>
                                    {isFileMimeImage(f.mimeType) ? <Image className="w-5 h-5 text-purple-400" /> : <FileText className="w-5 h-5 text-blue-400" />}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"} truncate`} title={f.originalName}>{f.originalName}</p>
                                    <div className={`flex items-center gap-3 text-xs ${dk ? "text-white/40" : "text-slate-400"} mt-0.5`}>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.category === "achats" ? "bg-orange-500/20 text-orange-400" : f.category === "banque" ? "bg-blue-500/20 text-blue-400" : f.category === "rh" ? "bg-emerald-500/20 text-emerald-400" : "bg-purple-500/20 text-purple-400"}`}>
                                            {catLabel(f.category)}
                                        </span>
                                        {f.supplier && <span>📦 {f.supplier}</span>}
                                        {f.fileDate && <span>📅 {fmtDate(f.fileDate)}</span>}
                                        <span>{fmtSize(f.fileSize)}</span>
                                    </div>
                                    {f.description && <p className={`text-xs ${dk ? "text-white/30" : "text-slate-300"} mt-1 truncate`}>{f.description}</p>}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1 flex-shrink-0">
                                    <a href={`/api/v2/sugu-management/files/${f.id}/download`} target="_blank" rel="noreferrer"
                                        className={btnPrimary + " !px-2 !py-1.5"} title="Télécharger">
                                        <Download className="w-3.5 h-3.5" />
                                    </a>
                                    {!restricted && <button onClick={() => { if (confirm(`Mettre "${f.originalName}" dans la corbeille ?\n\nVous aurez 7 jours pour le restaurer.`)) deleteMut.mutate(f.id); }} className={btnDanger} title="Déplacer dans la corbeille" data-testid={`button-delete-archive-${f.id}`}>
                                        <Trash2 className="w-3 h-3" />
                                    </button>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
