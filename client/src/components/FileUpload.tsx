import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Upload, FileText, File, X, Loader2, CheckCircle, AlertCircle, ImageIcon, Camera, Image, Plus, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { CameraCapture } from "./CameraCapture";

interface FileAnalysis {
  fileName: string;
  fileType: string;
  content: string;
  metadata: Record<string, unknown>;
  summary?: string;
}

interface FileUploadProps {
  onFileAnalyzed: (analysis: FileAnalysis, fileName: string) => void;
  compact?: boolean;
}

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".zip", ".txt", ".csv", ".json", ".xml", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".mp4", ".webm", ".mov", ".avi", ".mkv"];

const getFileIcon = (fileName: string) => {
  const ext = fileName.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return <FileText className="w-5 h-5 text-red-500" />;
    case "docx":
    case "doc":
      return <FileText className="w-5 h-5 text-blue-500" />;
    case "xlsx":
    case "xls":
      return <FileText className="w-5 h-5 text-green-500" />;
    case "zip":
      return <File className="w-5 h-5 text-yellow-500" />;
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "webp":
    case "heic":
    case "heif":
      return <ImageIcon className="w-5 h-5 text-purple-500" />;
    case "mp4":
    case "webm":
    case "mov":
    case "avi":
    case "mkv":
      return <Video className="w-5 h-5 text-pink-500" />;
    default:
      return <File className="w-5 h-5 text-muted-foreground" />;
  }
};

export function FileUpload({ onFileAnalyzed, compact = false }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoLibraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      
      try {
        console.log(`[FileUpload] Starting upload: ${file.name} (${(file.size/1024).toFixed(1)}KB)`);
        const response = await fetch("/api/files/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || error.error || `Erreur serveur ${response.status}`);
        }
        
        return response.json();
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") {
          throw new Error("Upload timeout (60s) — extraction locale en cours...");
        }
        throw err;
      }
    },
    onSuccess: async (data) => {
      setUploadStatus("success");
      const analysis = data.analysis || {
        fileName: selectedFile?.name || "fichier",
        fileType: selectedFile?.type || "application/octet-stream",
        content: data.file?.description || "Fichier uploadé avec succès",
        metadata: {},
      };
      
      const isPdf = selectedFile && /\.pdf$/i.test(selectedFile.name);
      if (isPdf && selectedFile) {
        try {
          console.log(`[FileUpload] Server upload OK — rendering PDF pages as images for vision...`);
          const pdfjsLib = await import("pdfjs-dist");
          const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.toString();
          const arrayBuffer = await selectedFile.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
          const pageImages: string[] = [];
          const maxPages = Math.min(pdf.numPages, 5);
          for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const scale = 1.5;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport }).promise;
              pageImages.push(canvas.toDataURL("image/png", 0.85));
            }
          }
          if (pageImages.length > 0) {
            analysis.metadata = { ...analysis.metadata, pdfPageImages: pageImages };
            console.log(`[FileUpload] PDF page images rendered: ${pageImages.length} pages`);
          }
        } catch (renderErr) {
          console.warn(`[FileUpload] PDF page rendering failed (non-critical):`, renderErr);
        }
      }
      
      onFileAnalyzed(analysis, selectedFile?.name || "fichier");
      setSelectedFile(null);
      setUploadStatus("idle");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (photoLibraryInputRef.current) {
        photoLibraryInputRef.current.value = "";
      }
      if (cameraInputRef.current) {
        cameraInputRef.current.value = "";
      }
    },
    onError: async (error: Error) => {
      console.warn("[FileUpload] Server upload failed, reading file client-side:", error.message);
      if (selectedFile) {
        try {
          const file = selectedFile;
          const isImage = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file.name);
          const isText = /\.(txt|csv|json|xml)$/i.test(file.name);
          const isPdf = /\.pdf$/i.test(file.name);
          
          if (isImage) {
            const reader = new FileReader();
            reader.onload = () => {
              const imageDataUrl = reader.result as string;
              onFileAnalyzed({
                fileName: file.name,
                fileType: file.type,
                content: `[Image: ${file.name}]`,
                metadata: { imageDataUrl, clientSideRead: true },
              }, file.name);
              setSelectedFile(null);
              setUploadStatus("idle");
              resetInputs();
            };
            reader.readAsDataURL(file);
            return;
          }
          
          if (isPdf) {
            try {
              const pdfjsLib = await import("pdfjs-dist");
              const workerUrl = new URL(
                "pdfjs-dist/build/pdf.worker.min.mjs",
                import.meta.url
              );
              pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.toString();
              const arrayBuffer = await file.arrayBuffer();
              const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
              const pages: string[] = [];
              const pageImages: string[] = [];
              const maxPagesToRender = Math.min(pdf.numPages, 5);
              for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items
                  .map((item: any) => item.str)
                  .join(" ");
                pages.push(`--- Page ${i} ---\n${pageText}`);
                if (i <= maxPagesToRender) {
                  try {
                    const scale = 1.5;
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement("canvas");
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const ctx = canvas.getContext("2d");
                    if (ctx) {
                      await page.render({ canvasContext: ctx, viewport }).promise;
                      const dataUrl = canvas.toDataURL("image/png", 0.85);
                      pageImages.push(dataUrl);
                      console.log(`[FileUpload] PDF page ${i} rendered: ${(dataUrl.length/1024).toFixed(0)}KB`);
                    }
                  } catch (renderErr) {
                    console.warn(`[FileUpload] Failed to render page ${i}:`, renderErr);
                  }
                }
              }
              const fullText = pages.join("\n\n");
              console.log(`[FileUpload] PDF extracted client-side: ${pdf.numPages} pages, ${fullText.length} chars, ${pageImages.length} images`);
              onFileAnalyzed({
                fileName: file.name,
                fileType: "application/pdf",
                content: fullText.slice(0, 50000),
                metadata: { clientSideRead: true, pdfPages: pdf.numPages, pdfPageImages: pageImages },
              }, file.name);
              setSelectedFile(null);
              setUploadStatus("idle");
              resetInputs();
              return;
            } catch (pdfErr) {
              console.error("[FileUpload] PDF pdfjs extraction failed, trying without worker:", pdfErr);
              try {
                const pdfjsLib = await import("pdfjs-dist");
                pdfjsLib.GlobalWorkerOptions.workerSrc = "";
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), disableWorker: true } as any).promise;
                const pages: string[] = [];
                const pageImages: string[] = [];
                const maxPagesToRender = Math.min(pdf.numPages, 5);
                for (let i = 1; i <= pdf.numPages; i++) {
                  const page = await pdf.getPage(i);
                  const textContent = await page.getTextContent();
                  const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(" ");
                  pages.push(`--- Page ${i} ---\n${pageText}`);
                  if (i <= maxPagesToRender) {
                    try {
                      const scale = 1.5;
                      const viewport = page.getViewport({ scale });
                      const canvas = document.createElement("canvas");
                      canvas.width = viewport.width;
                      canvas.height = viewport.height;
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        await page.render({ canvasContext: ctx, viewport }).promise;
                        pageImages.push(canvas.toDataURL("image/png", 0.85));
                      }
                    } catch {}
                  }
                }
                const fullText = pages.join("\n\n");
                console.log(`[FileUpload] PDF extracted (no worker): ${pdf.numPages} pages, ${fullText.length} chars, ${pageImages.length} images`);
                onFileAnalyzed({
                  fileName: file.name,
                  fileType: "application/pdf",
                  content: fullText.slice(0, 50000),
                  metadata: { clientSideRead: true, pdfPages: pdf.numPages, noWorker: true, pdfPageImages: pageImages },
                }, file.name);
                setSelectedFile(null);
                setUploadStatus("idle");
                resetInputs();
                return;
              } catch (pdfErr2) {
                console.error("[FileUpload] PDF extraction completely failed:", pdfErr2);
              }
            }
          }
          
          if (isText) {
            const text = await file.text();
            onFileAnalyzed({
              fileName: file.name,
              fileType: file.type,
              content: text.slice(0, 50000),
              metadata: { clientSideRead: true },
            }, file.name);
            setSelectedFile(null);
            setUploadStatus("idle");
            resetInputs();
            return;
          }
          
          onFileAnalyzed({
            fileName: file.name,
            fileType: file.type,
            content: `[Fichier joint: ${file.name} (${(file.size / 1024).toFixed(1)} Ko) — upload serveur échoué, contenu non extrait]`,
            metadata: { clientSideRead: true, uploadError: error.message },
          }, file.name);
          setSelectedFile(null);
          setUploadStatus("idle");
          resetInputs();
        } catch {
          setUploadStatus("error");
          setErrorMessage(error.message);
        }
      } else {
        setUploadStatus("error");
        setErrorMessage(error.message);
      }
    },
  });
  
  const resetInputs = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (photoLibraryInputRef.current) photoLibraryInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateFile = (file: File): boolean => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setErrorMessage(`Type de fichier non supporté: ${ext}. Types acceptés: ${ALLOWED_EXTENSIONS.join(", ")}`);
      setUploadStatus("error");
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Le fichier est trop volumineux (max 10 Mo)");
      setUploadStatus("error");
      return false;
    }
    return true;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setErrorMessage("");
    setUploadStatus("idle");
    
    const file = e.dataTransfer.files[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage("");
    setUploadStatus("idle");
    
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
      // Auto-upload in compact mode
      if (compact) {
        setUploadStatus("uploading");
        uploadMutation.mutate(file);
      }
    }
  }, [compact, uploadMutation]);

  const handleUpload = useCallback(() => {
    if (selectedFile) {
      setUploadStatus("uploading");
      setErrorMessage("");
      uploadMutation.mutate(selectedFile);
    }
  }, [selectedFile, uploadMutation]);

  const handleCancel = useCallback(() => {
    setSelectedFile(null);
    setUploadStatus("idle");
    setErrorMessage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (photoLibraryInputRef.current) {
      photoLibraryInputRef.current.value = "";
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  }, []);

  const handleCameraCapture = useCallback((file: File) => {
    setErrorMessage("");
    setUploadStatus("idle");
    setSelectedFile(file);
    if (compact) {
      setUploadStatus("uploading");
      uploadMutation.mutate(file);
    }
  }, [compact, uploadMutation]);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={[...ALLOWED_EXTENSIONS].join(",")}
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-file-compact"
        />
        <input
          ref={photoLibraryInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-photo-library-compact"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
                    onChange={handleFileSelect}
          className="hidden"
          data-testid="input-camera-compact"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={uploadStatus === "uploading"}
              title="Ajouter"
              data-testid="button-add-file"
            >
              {uploadStatus === "uploading" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem 
              onSelect={(e) => {
                e.preventDefault();
                setTimeout(() => fileInputRef.current?.click(), 100);
              }} 
              data-testid="menu-upload-file"
            >
              <Upload className="w-4 h-4 mr-2" />
              Fichier
            </DropdownMenuItem>
            <DropdownMenuItem 
              onSelect={(e) => {
                e.preventDefault();
                setTimeout(() => photoLibraryInputRef.current?.click(), 100);
              }} 
              data-testid="menu-photo-library"
            >
              <Image className="w-4 h-4 mr-2" />
              Photothèque
            </DropdownMenuItem>
            <DropdownMenuItem 
              onSelect={(e) => {
                e.preventDefault();
                setTimeout(() => setCameraOpen(true), 100);
              }} 
              data-testid="menu-take-photo"
            >
              <Camera className="w-4 h-4 mr-2" />
              Prendre une photo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CameraCapture 
          open={cameraOpen} 
          onClose={() => setCameraOpen(false)} 
          onCapture={handleCameraCapture}
        />
        {selectedFile && uploadStatus !== "uploading" && (
          <div className="flex items-center gap-2 px-2 py-1 bg-muted rounded-md">
            {getFileIcon(selectedFile.name)}
            <span className="text-xs truncate max-w-[100px]">{selectedFile.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleUpload}
              data-testid="button-send-file"
            >
              <CheckCircle className="w-3 h-3 text-green-500" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleCancel}
              data-testid="button-cancel-file"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "p-4 border-2 border-dashed transition-colors",
        isDragging && "border-primary bg-primary/5",
        uploadStatus === "error" && "border-destructive",
        uploadStatus === "success" && "border-green-500"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="card-file-upload-zone"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={[...ALLOWED_EXTENSIONS, "image/*"].join(",")}
        onChange={handleFileSelect}
        className="hidden"
        data-testid="input-file"
      />
      
      {!selectedFile ? (
        <div
          className="flex flex-col items-center gap-3 cursor-pointer py-4"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="p-3 rounded-full bg-muted">
            <Upload className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Glissez un fichier ici</p>
            <p className="text-xs text-muted-foreground mt-1">
              ou cliquez pour sélectionner
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              PDF, Word, Excel, ZIP, Images, TXT (max 10 Mo)
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {getFileIcon(selectedFile.name)}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(1)} Ko
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {uploadStatus === "idle" && (
              <>
                <Button
                  size="sm"
                  onClick={handleUpload}
                  data-testid="button-analyze-file"
                >
                  Analyser
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCancel}
                  data-testid="button-cancel-upload"
                >
                  <X className="w-4 h-4" />
                </Button>
              </>
            )}
            
            {uploadStatus === "uploading" && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Analyse en cours...</span>
              </div>
            )}
            
            {uploadStatus === "success" && (
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm">Fichier analysé</span>
              </div>
            )}
            
            {uploadStatus === "error" && (
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-destructive" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCancel}
                  data-testid="button-retry-upload"
                >
                  Réessayer
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      
      {errorMessage && (
        <p className="text-xs text-destructive mt-2">{errorMessage}</p>
      )}
    </Card>
  );
}
