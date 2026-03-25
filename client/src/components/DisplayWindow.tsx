import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, ZoomIn, ZoomOut, FileText, Image as ImageIcon, Maximize2, Minimize2, Search, Grid2X2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { SearchResultsPanel, type MARSResultsData } from "./SearchResultsPanel";
import { ImageGridDisplay, type GridImage } from "./ImageGridDisplay";

export type DisplayContentType = "image" | "text" | "markdown" | "pdf" | "analysis" | "searchResults" | "imageGrid";

export interface DisplayContent {
  id: string;
  type: DisplayContentType;
  title?: string;
  content: string;
  searchData?: MARSResultsData;
  gridImages?: GridImage[];
  metadata?: {
    filename?: string;
    mimeType?: string;
    source?: string;
    timestamp?: string;
  };
}

interface DisplayWindowProps {
  content: DisplayContent | null;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  persona?: "ulysse" | "iris" | "alfred";
}

export function DisplayWindow({ content, isOpen, onClose, className, persona = "ulysse" }: DisplayWindowProps) {
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setZoom(1);
      setIsFullscreen(false);
    }
  }, [isOpen]);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleDownload = useCallback(() => {
    if (!content) return;
    
    if (content.type === "image") {
      const link = document.createElement("a");
      link.href = content.content;
      link.download = content.metadata?.filename || "image";
      link.click();
    }
  }, [content]);

  const renderContent = () => {
    if (!content) return null;

    switch (content.type) {
      case "image":
        return (
          <div className="flex items-center justify-center h-full overflow-hidden">
            <motion.img
              src={content.content}
              alt={content.title || "Display"}
              className="max-w-full max-h-full object-contain rounded-lg"
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
            <div className="p-4 text-foreground whitespace-pre-wrap font-mono text-sm">
              {content.content}
            </div>
          </ScrollArea>
        );

      case "markdown":
      case "analysis":
        return (
          <ScrollArea className="h-full">
            <div className="p-4 prose prose-sm prose-invert max-w-none [&_*]:text-white [&_a]:text-blue-400 [&_a]:underline [&_p]:text-white [&_li]:text-white">
              <ReactMarkdown>{content.content}</ReactMarkdown>
            </div>
          </ScrollArea>
        );

      case "pdf":
        return (
          <div className="flex items-center justify-center h-full">
            <iframe
              src={content.content}
              className="w-full h-full rounded-lg border-0"
              title={content.title || "PDF Preview"}
            />
          </div>
        );

      case "searchResults":
        if (!content.searchData) {
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Aucun résultat de recherche
            </div>
          );
        }
        return (
          <SearchResultsPanel 
            data={content.searchData} 
            onImageClick={(url, title) => {
              window.open(url, "_blank");
            }}
            className="h-full"
          />
        );

      case "imageGrid":
        if (!content.gridImages || content.gridImages.length === 0) {
          return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Aucune image à afficher
            </div>
          );
        }
        return (
          <ImageGridDisplay 
            images={content.gridImages}
            onImageClick={(image) => {
              window.open(image.link || image.url, "_blank");
            }}
            className="h-full"
            persona={persona}
          />
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
    switch (content?.type) {
      case "image":
        return <ImageIcon className="w-4 h-4" />;
      case "imageGrid":
        return <Grid2X2 className="w-4 h-4" />;
      case "searchResults":
        return <Search className="w-4 h-4" />;
      case "pdf":
      case "text":
      case "markdown":
      case "analysis":
        return <FileText className="w-4 h-4" />;
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && content && (
        <motion.div
          initial={{ opacity: 0, x: 20, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.95 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className={cn(
            "relative",
            isFullscreen 
              ? "fixed inset-4 z-50" 
              : "w-full h-full",
            className
          )}
        >
          {isFullscreen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
              onClick={onClose}
            />
          )}
          
          <Card className={cn(
            "flex flex-col bg-card/90 backdrop-blur-xl border-border/50 overflow-hidden",
            isFullscreen ? "h-full relative z-50" : "h-full"
          )}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground truncate">
                {getContentIcon()}
                <span className="truncate">{content.title || "Affichage"}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {content.type === "image" && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={handleZoomOut}
                      disabled={zoom <= 0.5}
                      data-testid="button-zoom-out"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground w-10 text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={handleZoomIn}
                      disabled={zoom >= 3}
                      data-testid="button-zoom-in"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={handleDownload}
                      data-testid="button-download-display"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  data-testid="button-fullscreen-display"
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-3.5 h-3.5" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={onClose}
                  data-testid="button-close-display"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            
            <div className="flex-1 min-h-0 p-2">
              {renderContent()}
            </div>
            
            {content.metadata?.source && (
              <div className="px-3 py-1.5 border-t border-border/50 text-xs text-muted-foreground truncate">
                Source: {content.metadata.source}
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function useDisplayWindow() {
  const [content, setContent] = useState<DisplayContent | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const show = useCallback((newContent: DisplayContent) => {
    setContent(newContent);
    setIsOpen(true);
  }, []);

  const showImage = useCallback((src: string, title?: string, metadata?: DisplayContent["metadata"]) => {
    show({
      id: `img-${Date.now()}`,
      type: "image",
      title: title || "Image",
      content: src,
      metadata
    });
  }, [show]);

  const showMarkdown = useCallback((markdown: string, title?: string, metadata?: DisplayContent["metadata"]) => {
    show({
      id: `md-${Date.now()}`,
      type: "markdown",
      title: title || "Analyse",
      content: markdown,
      metadata
    });
  }, [show]);

  const showText = useCallback((text: string, title?: string, metadata?: DisplayContent["metadata"]) => {
    show({
      id: `txt-${Date.now()}`,
      type: "text",
      title: title || "Texte",
      content: text,
      metadata
    });
  }, [show]);

  const showPdf = useCallback((url: string, title?: string, metadata?: DisplayContent["metadata"]) => {
    show({
      id: `pdf-${Date.now()}`,
      type: "pdf",
      title: title || "Document PDF",
      content: url,
      metadata
    });
  }, [show]);

  const showSearchResults = useCallback((data: MARSResultsData, title?: string) => {
    show({
      id: `search-${Date.now()}`,
      type: "searchResults",
      title: title || `Résultats: ${data.query}`,
      content: "",
      searchData: data
    });
  }, [show]);

  const showImageGrid = useCallback((images: GridImage[], title?: string, metadata?: DisplayContent["metadata"]) => {
    show({
      id: `grid-${Date.now()}`,
      type: "imageGrid",
      title: title || `Images (${Math.min(images.length, 4)})`,
      content: "",
      gridImages: images,
      metadata
    });
  }, [show]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const clear = useCallback(() => {
    setIsOpen(false);
    setContent(null);
  }, []);

  return {
    content,
    isOpen,
    show,
    showImage,
    showImageGrid,
    showMarkdown,
    showText,
    showPdf,
    showSearchResults,
    close,
    clear
  };
}

export type { GridImage };
