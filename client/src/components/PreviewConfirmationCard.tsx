import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, XCircle, ZoomIn, ZoomOut, Download, FileText, Image as ImageIcon, File, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export type PreviewContentType = "image" | "text" | "markdown" | "pdf" | "file";

export interface PreviewRequest {
  id: string;
  type: PreviewContentType;
  title: string;
  content: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  metadata?: {
    filename?: string;
    mimeType?: string;
    source?: string;
    fileSize?: number;
  };
}

interface PreviewConfirmationCardProps {
  request: PreviewRequest | null;
  isOpen: boolean;
  onConfirm: (requestId: string) => void;
  onCancel: (requestId: string) => void;
  onClose: () => void;
  className?: string;
}

export function PreviewConfirmationCard({
  request,
  isOpen,
  onConfirm,
  onCancel,
  onClose,
  className
}: PreviewConfirmationCardProps) {
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setZoom(1);
      setIsFullscreen(false);
      setIsConfirming(false);
    }
  }, [isOpen]);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleConfirm = useCallback(() => {
    if (!request) return;
    setIsConfirming(true);
    onConfirm(request.id);
    setTimeout(() => {
      onClose();
    }, 300);
  }, [request, onConfirm, onClose]);

  const handleCancel = useCallback(() => {
    if (!request) return;
    onCancel(request.id);
    onClose();
  }, [request, onCancel, onClose]);

  const handleDownload = useCallback(() => {
    if (!request) return;
    
    if (request.type === "image" || request.type === "file") {
      const link = document.createElement("a");
      link.href = request.content;
      link.download = request.metadata?.filename || "download";
      link.click();
    }
  }, [request]);

  const renderContent = () => {
    if (!request) return null;

    switch (request.type) {
      case "image":
        return (
          <div className="flex items-center justify-center h-full overflow-hidden bg-black/20 rounded-lg">
            <motion.img
              src={request.content}
              alt={request.title || "Preview"}
              className="max-w-full max-h-full object-contain"
              style={{ transform: `scale(${zoom})` }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: zoom }}
              transition={{ duration: 0.2 }}
              draggable={false}
            />
          </div>
        );

      case "text":
        return (
          <ScrollArea className="h-full">
            <div className="p-4 text-foreground whitespace-pre-wrap font-mono text-sm bg-muted/30 rounded-lg">
              {request.content}
            </div>
          </ScrollArea>
        );

      case "markdown":
        return (
          <ScrollArea className="h-full">
            <div className="p-4 prose prose-sm prose-invert max-w-none [&_*]:text-white [&_a]:text-blue-400 [&_a]:underline [&_p]:text-white [&_li]:text-white">
              <ReactMarkdown>{request.content}</ReactMarkdown>
            </div>
          </ScrollArea>
        );

      case "pdf":
        return (
          <div className="flex items-center justify-center h-full">
            <iframe
              src={request.content}
              className="w-full h-full rounded-lg border-0"
              title={request.title || "PDF Preview"}
            />
          </div>
        );

      case "file":
        return (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
              <File className="w-10 h-10 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">{request.metadata?.filename || "Fichier"}</p>
              {request.metadata?.fileSize && (
                <p className="text-sm text-muted-foreground">
                  {(request.metadata.fileSize / 1024).toFixed(1)} Ko
                </p>
              )}
              {request.metadata?.mimeType && (
                <p className="text-xs text-muted-foreground mt-1">{request.metadata.mimeType}</p>
              )}
            </div>
          </div>
        );

      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Contenu non supporté
          </div>
        );
    }
  };

  const getContentIcon = () => {
    switch (request?.type) {
      case "image":
        return <ImageIcon className="w-4 h-4" />;
      case "pdf":
      case "text":
      case "markdown":
        return <FileText className="w-4 h-4" />;
      case "file":
        return <File className="w-4 h-4" />;
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && request && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={handleCancel}
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              "fixed z-50 flex flex-col",
              isFullscreen 
                ? "inset-4" 
                : "inset-x-4 top-1/2 -translate-y-1/2 max-w-2xl mx-auto max-h-[80vh]",
              className
            )}
          >
            <Card className="flex flex-col h-full bg-card/95 backdrop-blur-xl border-primary/20 shadow-2xl shadow-primary/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-primary/5 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    {getContentIcon()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-sm">{request.title}</h3>
                    {request.description && (
                      <p className="text-xs text-muted-foreground">{request.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {request.type === "image" && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={handleZoomOut}
                        disabled={zoom <= 0.5}
                        data-testid="button-preview-zoom-out"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground w-10 text-center">
                        {Math.round(zoom * 100)}%
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={handleZoomIn}
                        disabled={zoom >= 3}
                        data-testid="button-preview-zoom-in"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  {(request.type === "image" || request.type === "file") && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={handleDownload}
                      data-testid="button-preview-download"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    data-testid="button-preview-fullscreen"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={handleCancel}
                    data-testid="button-preview-close"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="flex-1 min-h-0 p-3">
                {renderContent()}
              </div>
              
              <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-border/50 bg-muted/30 shrink-0">
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  className="gap-2"
                  data-testid="button-preview-cancel"
                >
                  <XCircle className="w-4 h-4" />
                  {request.cancelLabel || "Annuler"}
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={isConfirming}
                  className="gap-2 bg-primary hover:bg-primary/90"
                  data-testid="button-preview-confirm"
                >
                  {isConfirming ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.5, repeat: Infinity, ease: "linear" }}
                    >
                      <Check className="w-4 h-4" />
                    </motion.div>
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {request.confirmLabel || "Confirmer"}
                </Button>
              </div>
            </Card>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function usePreviewConfirmation() {
  const [request, setRequest] = useState<PreviewRequest | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const resolverRef = useRef<{ resolve: (confirmed: boolean) => void } | null>(null);

  const show = useCallback((newRequest: Omit<PreviewRequest, "id">) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = { resolve };
      setRequest({
        ...newRequest,
        id: `preview-${Date.now()}`
      });
      setIsOpen(true);
    });
  }, []);

  const showImage = useCallback((
    src: string,
    title: string,
    options?: {
      description?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }
  ) => {
    return show({
      type: "image",
      title,
      content: src,
      ...options
    });
  }, [show]);

  const showText = useCallback((
    text: string,
    title: string,
    options?: {
      description?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }
  ) => {
    return show({
      type: "text",
      title,
      content: text,
      ...options
    });
  }, [show]);

  const showMarkdown = useCallback((
    markdown: string,
    title: string,
    options?: {
      description?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }
  ) => {
    return show({
      type: "markdown",
      title,
      content: markdown,
      ...options
    });
  }, [show]);

  const showFile = useCallback((
    url: string,
    title: string,
    metadata?: PreviewRequest["metadata"],
    options?: {
      description?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }
  ) => {
    return show({
      type: "file",
      title,
      content: url,
      metadata,
      ...options
    });
  }, [show]);

  const handleConfirm = useCallback((requestId: string) => {
    if (request?.id === requestId && resolverRef.current) {
      resolverRef.current.resolve(true);
      resolverRef.current = null;
    }
  }, [request]);

  const handleCancel = useCallback((requestId: string) => {
    if (request?.id === requestId && resolverRef.current) {
      resolverRef.current.resolve(false);
      resolverRef.current = null;
    }
  }, [request]);

  const close = useCallback(() => {
    setIsOpen(false);
    setTimeout(() => setRequest(null), 300);
  }, []);

  return {
    request,
    isOpen,
    show,
    showImage,
    showText,
    showMarkdown,
    showFile,
    handleConfirm,
    handleCancel,
    close
  };
}
