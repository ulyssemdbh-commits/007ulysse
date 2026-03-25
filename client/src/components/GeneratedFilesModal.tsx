import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { 
  FileText, 
  Download, 
  Trash2, 
  FolderOpen,
  Clock,
  FileIcon,
  RefreshCw,
  Eye,
  Upload,
  FileUp,
  File,
  FileSpreadsheet,
  FileImage,
  MessageSquare,
  Mail,
  SendHorizontal,
  Search,
  X,
  CheckSquare,
  Square,
  Sparkles,
  Paperclip,
  HardDrive,
  RotateCcw,
  Loader2,
  CloudUpload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UlysseFile } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { EmailPanel } from "@/components/EmailPanel";

interface GeneratedFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  personaName: string;
  onAddToChat?: (file: UlysseFile) => void;
}

// Allowed file types and limits
const ALLOWED_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv", ".json",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".mp3", ".wav", ".mp4", ".webm", ".mov"
];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export function GeneratedFilesModal({ isOpen, onClose, personaName, onAddToChat }: GeneratedFilesModalProps) {
  const { toast } = useToast();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"generated" | "chat" | "mail">("generated");
  const [viewingFile, setViewingFile] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: files, isLoading, refetch, isFetching } = useQuery<UlysseFile[]>({
    queryKey: ["/api/files"],
    enabled: isOpen,
  });

  // Filter files based on search query
  const filterFiles = useCallback((fileList: UlysseFile[]) => {
    if (!searchQuery.trim()) return fileList;
    const query = searchQuery.toLowerCase();
    return fileList.filter(f => 
      f.originalName.toLowerCase().includes(query) ||
      f.description?.toLowerCase().includes(query) ||
      f.mimeType.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const sortNewestFirst = (list: UlysseFile[]) => 
    [...list].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const generatedFiles = useMemo(() => 
    sortNewestFirst(filterFiles(files?.filter(f => f.category === "generated" || !f.category) || [])), 
    [files, filterFiles]
  );
  
  const receivedFiles = useMemo(() => 
    sortNewestFirst(filterFiles(files?.filter(f => f.category === "received") || [])), 
    [files, filterFiles]
  );

  // Calculate storage stats
  const storageStats = useMemo(() => {
    const allFiles = files || [];
    const totalBytes = allFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
    const generatedBytes = allFiles.filter(f => f.category === "generated" || !f.category).reduce((sum, f) => sum + f.sizeBytes, 0);
    const receivedBytes = allFiles.filter(f => f.category === "received").reduce((sum, f) => sum + f.sizeBytes, 0);
    return { totalBytes, generatedBytes, receivedBytes, fileCount: allFiles.length };
  }, [files]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/files/sync");
      return await response.json() as { synced: number; newEmails: number; attachmentsDownloaded: number; message: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      const parts: string[] = [];
      if (data.synced > 0) parts.push(`${data.synced} fichier(s) local`);
      if (data.newEmails > 0) parts.push(`${data.newEmails} email(s)`);
      if (data.attachmentsDownloaded > 0) parts.push(`${data.attachmentsDownloaded} piece(s) jointe(s)`);
      
      toast({ 
        title: "Synchronisation terminee",
        description: parts.length > 0 ? parts.join(", ") : "Tout est a jour"
      });
    },
    onError: (error: any) => {
      if (error?.message?.includes("401") || error?.message?.includes("Authentication")) {
        return;
      }
      toast({ 
        title: "Erreur", 
        description: "Impossible de synchroniser les fichiers",
        variant: "destructive" 
      });
    },
  });

  const handleRefresh = () => {
    syncMutation.mutate();
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/files/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({ title: "Fichier supprime" });
    },
    onError: () => {
      toast({ 
        title: "Erreur", 
        description: "Impossible de supprimer le fichier",
        variant: "destructive" 
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map(id => apiRequest("DELETE", `/api/files/${id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      toast({ title: "Fichiers supprimes" });
    },
    onError: () => {
      toast({ 
        title: "Erreur", 
        description: "Impossible de supprimer certains fichiers",
        variant: "destructive" 
      });
    },
  });

  const handleDownload = async (file: UlysseFile) => {
    setDownloadingId(file.id);
    try {
      const response = await fetch(`/api/files/${file.id}/download`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Download failed");
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({ title: "Telechargement lance" });
    } catch (error) {
      console.error("Download error:", error);
      toast({ 
        title: "Erreur", 
        description: "Impossible de telecharger le fichier",
        variant: "destructive" 
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleOpen = async (file: UlysseFile) => {
    try {
      const response = await fetch(`/api/files/${file.id}/download`, {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to open file");
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      setViewingFile({ url, name: file.originalName, mimeType: file.mimeType });
    } catch (error) {
      console.error("Open error:", error);
      toast({ 
        title: "Erreur", 
        description: "Impossible d'ouvrir le fichier",
        variant: "destructive" 
      });
    }
  };
  
  const closeFileViewer = () => {
    if (viewingFile) {
      URL.revokeObjectURL(viewingFile.url);
      setViewingFile(null);
    }
  };

  // File upload handler
  const handleFileUpload = async (uploadFiles: FileList | File[]) => {
    const fileArray = Array.from(uploadFiles);
    
    for (const file of fileArray) {
      // Validate file
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        toast({
          title: "Format non supporte",
          description: `${file.name} - Formats acceptes: ${ALLOWED_EXTENSIONS.join(", ")}`,
          variant: "destructive"
        });
        continue;
      }
      
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: "Fichier trop volumineux",
          description: `${file.name} - Maximum 100 MB`,
          variant: "destructive"
        });
        continue;
      }

      // Upload file
      const formData = new FormData();
      formData.append("file", file);

      try {
        setUploadProgress(0);
        
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        await new Promise<void>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              let errMsg = `HTTP ${xhr.status}`;
              try {
                const body = JSON.parse(xhr.responseText);
                errMsg = body.message || body.error || errMsg;
              } catch {}
              reject(new Error(errMsg));
            }
          };
          xhr.onerror = () => reject(new Error("Erreur réseau - vérifiez votre connexion"));
          xhr.ontimeout = () => reject(new Error("Timeout - fichier trop volumineux ou connexion lente"));
          xhr.timeout = 120000;
          xhr.open("POST", "/api/files/upload");
          xhr.withCredentials = true;
          xhr.send(formData);
        });

        toast({ title: "Fichier uploadé", description: file.name });
        queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      } catch (error: any) {
        console.error("Upload error:", error);
        toast({
          title: "Erreur d'upload",
          description: error?.message || `Impossible d'uploader ${file.name}`,
          variant: "destructive"
        });
      } finally {
        setUploadProgress(null);
      }
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // Selection handlers
  const toggleSelection = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = (fileList: UlysseFile[]) => {
    setSelectedIds(new Set(fileList.map(f => f.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    if (selectedIds.size > 0) {
      bulkDeleteMutation.mutate(Array.from(selectedIds));
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType === "application/pdf") return FileText;
    if (mimeType.includes("word") || mimeType.includes("document")) return File;
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return FileSpreadsheet;
    if (mimeType.startsWith("image/")) return FileImage;
    return FileIcon;
  };

  const getSourceBadge = (file: UlysseFile) => {
    // Normalize generatedBy value for comparison
    const source = (file.generatedBy || "").toLowerCase().trim();
    
    // AI-generated files (Ulysse or Iris)
    if (source === "ulysse" || source === "iris" || source === "ai") {
      return (
        <Badge variant="default" className="text-[9px] px-1.5 py-0 gap-0.5">
          <Sparkles className="w-2.5 h-2.5" />
          AI
        </Badge>
      );
    }
    
    // Email attachments - check source or if stored from email sync
    if (source === "email" || source === "agentmail" || source.includes("attachment")) {
      return (
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-0.5">
          <Mail className="w-2.5 h-2.5" />
          Email
        </Badge>
      );
    }
    
    // Received/uploaded files
    if (file.category === "received" || source === "upload" || source === "user") {
      return (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-0.5">
          <Upload className="w-2.5 h-2.5" />
          Upload
        </Badge>
      );
    }
    
    // Default for generated category without specific source
    if (file.category === "generated") {
      return (
        <Badge variant="default" className="text-[9px] px-1.5 py-0 gap-0.5">
          <Sparkles className="w-2.5 h-2.5" />
          AI
        </Badge>
      );
    }
    
    // Fallback
    return (
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-0.5">
        <FileIcon className="w-2.5 h-2.5" />
        Fichier
      </Badge>
    );
  };

  const renderFileList = (fileList: UlysseFile[], emptyMessage: string, emptySubMessage: string, showUploadZone = false) => {
    if (isLoading) {
      return (
        <div className="py-8 text-center text-muted-foreground">
          Chargement des fichiers...
        </div>
      );
    }

    // Upload zone for Chat tab
    if (showUploadZone) {
      return (
        <div className="space-y-4">
          {/* Upload drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              isDragOver 
                ? "border-primary bg-primary/5" 
                : "border-muted-foreground/30 hover:border-primary/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="upload-drop-zone"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={ALLOWED_EXTENSIONS.join(",")}
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
            />
            {uploadProgress !== null ? (
              <div className="space-y-2">
                <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
                <Progress value={uploadProgress} className="w-full max-w-xs mx-auto" />
                <p className="text-sm text-muted-foreground">Upload en cours... {uploadProgress}%</p>
              </div>
            ) : (
              <>
                <CloudUpload className={`w-10 h-10 mx-auto mb-2 ${isDragOver ? "text-primary" : "text-muted-foreground"}`} />
                <p className="font-medium text-sm">Glissez vos fichiers ici</p>
                <p className="text-xs text-muted-foreground mt-1">ou cliquez pour parcourir</p>
                <p className="text-[10px] text-muted-foreground/70 mt-2">
                  Max 100 MB - PDF, Word, Excel, Images, Audio, Video
                </p>
              </>
            )}
          </div>

          {/* File list */}
          {fileList.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{emptyMessage}</p>
              <p className="text-xs mt-1">{emptySubMessage}</p>
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {fileList.map((file) => renderFileCard(file))}
            </div>
          )}
        </div>
      );
    }

    if (!fileList || fileList.length === 0) {
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-12 text-center text-muted-foreground"
        >
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{emptyMessage}</p>
          <p className="text-xs mt-1">{emptySubMessage}</p>
        </motion.div>
      );
    }

    return (
      <div className="space-y-2 py-2 pb-4">
        {fileList.map((file) => renderFileCard(file))}
      </div>
    );
  };

  const renderFileCard = (file: UlysseFile) => {
    const IconComponent = getFileIcon(file.mimeType);
    const isSelected = selectedIds.has(file.id);
    
    return (
      <motion.div
        key={file.id}
        layout
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -10 }}
        className={`group flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50 transition-colors ${isSelected ? "bg-primary/10 border-primary" : "border-border"}`}
      >
        {/* Selection checkbox */}
        {isSelectionMode && (
          <button
            onClick={() => toggleSelection(file.id)}
            className="shrink-0"
            data-testid={`checkbox-file-${file.id}`}
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        )}
        
        {/* File icon */}
        <div className="p-1.5 rounded bg-primary/10 shrink-0">
          <IconComponent className="w-4 h-4 text-primary" />
        </div>
        
        {/* File info - takes remaining space */}
        <div className="flex-1 min-w-0 mr-1">
          <p className="font-medium text-xs truncate" title={file.originalName}>
            {file.originalName}
          </p>
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            {getSourceBadge(file)}
            <span>{formatFileSize(file.sizeBytes)}</span>
            <span>•</span>
            <span>{file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: false, locale: fr }) : "?"}</span>
          </div>
        </div>
        
        {/* Action buttons - always visible, compact */}
        <div className="flex items-center shrink-0">
          {onAddToChat && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                onAddToChat(file);
                toast({ title: "Fichier ajoute au chat" });
              }}
              data-testid={`button-add-to-chat-${file.id}`}
              title="Envoyer au chat"
            >
              <SendHorizontal className="w-3.5 h-3.5 text-primary" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => handleOpen(file)}
            data-testid={`button-open-file-${file.id}`}
            title="Apercu"
          >
            <Eye className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => handleDownload(file)}
            disabled={downloadingId === file.id}
            data-testid={`button-download-file-${file.id}`}
            title="Telecharger"
          >
            <Download className={`w-3.5 h-3.5 ${downloadingId === file.id ? "animate-pulse" : ""}`} />
          </Button>
          {!isSelectionMode && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => deleteMutation.mutate(file.id)}
              disabled={deleteMutation.isPending}
              data-testid={`button-delete-file-${file.id}`}
              title="Supprimer"
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] flex flex-col p-3 sm:p-6 overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-primary" />
              Documents de {personaName}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  if (isSelectionMode) setSelectedIds(new Set());
                }}
                data-testid="button-toggle-selection"
                title={isSelectionMode ? "Annuler selection" : "Selectionner"}
              >
                {isSelectionMode ? <X className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRefresh}
                disabled={syncMutation.isPending || isFetching}
                data-testid="button-refresh-files"
              >
                <RefreshCw className={`w-4 h-4 ${syncMutation.isPending || isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          <DialogDescription>
            Visualisez et gerez les documents de {personaName}
          </DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un fichier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8"
            data-testid="input-search-files"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {/* Storage stats */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
          <HardDrive className="w-3.5 h-3.5" />
          <span>{storageStats.fileCount} fichiers</span>
          <span className="text-muted-foreground/50">|</span>
          <span>{formatFileSize(storageStats.totalBytes)} utilises</span>
        </div>

        {/* Bulk actions */}
        {isSelectionMode && selectedIds.size > 0 && (
          <div className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded-md">
            <span className="text-sm">{selectedIds.size} selectionne(s)</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={deselectAll}
              >
                Deselectionner
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkDeleteMutation.isPending}
              >
                {bulkDeleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Supprimer
              </Button>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "generated" | "chat" | "mail")} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="generated" className="flex items-center gap-1 text-[10px] sm:text-xs px-1 sm:px-2" data-testid="tab-generated-files">
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="truncate">{personaName}</span>
              {generatedFiles.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 text-[9px] sm:text-[10px] h-4 px-1">{generatedFiles.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-1 text-[10px] sm:text-xs px-1 sm:px-2" data-testid="tab-chat-files">
              <Upload className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="truncate">Mes fichiers</span>
              {receivedFiles.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 text-[9px] sm:text-[10px] h-4 px-1">{receivedFiles.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="mail" className="flex items-center gap-1 text-[10px] sm:text-xs px-1 sm:px-2" data-testid="tab-mail">
              <Mail className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="truncate">Boite Mail</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generated" className="flex-1 min-h-0 mt-4 w-full max-w-full">
            <ScrollArea className="h-[calc(60vh-100px)] min-h-[300px] max-h-[450px]">
              <div className="pr-3 space-y-2 max-w-full">
                <AnimatePresence mode="popLayout">
                  {renderFileList(
                    generatedFiles,
                    "Aucun fichier genere",
                    `${personaName} peut creer des PDF, Word et Excel pour vous`
                  )}
                </AnimatePresence>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="chat" className="flex-1 min-h-0 mt-4 w-full max-w-full">
            <ScrollArea className="h-[calc(60vh-100px)] min-h-[300px] max-h-[450px]">
              <div className="pr-3 space-y-2 max-w-full">
                <AnimatePresence mode="popLayout">
                  {renderFileList(
                    receivedFiles,
                    "Aucun fichier uploade",
                    `Uploadez des fichiers pour les partager avec ${personaName}`,
                    true // Show upload zone
                  )}
                </AnimatePresence>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="mail" className="flex-1 min-h-0 mt-4 -mx-4 sm:-mx-6">
            <div className="h-[calc(50vh-100px)] min-h-[250px] max-h-[350px]">
              <EmailPanel embedded={true} />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={onClose} data-testid="button-close-files-modal">
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* In-app file viewer dialog */}
    <Dialog open={!!viewingFile} onOpenChange={(open) => !open && closeFileViewer()}>
      <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 pb-2 border-b shrink-0">
          <DialogTitle className="text-sm truncate pr-8">{viewingFile?.name}</DialogTitle>
          <DialogDescription className="sr-only">Visualisation du fichier</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden">
          {viewingFile && (
            viewingFile.mimeType.startsWith("image/") ? (
              <div className="w-full h-full flex items-center justify-center bg-black/5 dark:bg-white/5 p-4">
                <img 
                  src={viewingFile.url} 
                  alt={viewingFile.name}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : viewingFile.mimeType === "application/pdf" ? (
              <iframe 
                src={viewingFile.url} 
                className="w-full h-full border-0"
                title={viewingFile.name}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
                <FileIcon className="w-16 h-16 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Ce type de fichier ne peut pas etre previsualise
                </p>
                <Button onClick={() => {
                  const a = document.createElement("a");
                  a.href = viewingFile.url;
                  a.download = viewingFile.name;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  closeFileViewer();
                }}>
                  <Download className="w-4 h-4 mr-2" />
                  Telecharger
                </Button>
              </div>
            )
          )}
        </div>
        <div className="p-4 pt-2 border-t shrink-0 flex justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (viewingFile) {
                const a = document.createElement("a");
                a.href = viewingFile.url;
                a.download = viewingFile.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }
            }}
          >
            <Download className="w-4 h-4 mr-2" />
            Telecharger
          </Button>
          <Button onClick={closeFileViewer}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
