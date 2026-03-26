import { useState, useCallback, type MouseEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UlysseAvatar } from "@/components/visualizer/UlysseAvatar";
import { IrisAvatar } from "@/components/visualizer/IrisAvatar";
import { AlfredAvatar } from "@/components/visualizer/AlfredAvatar";

export interface GridImage {
  url: string;
  thumbnailUrl?: string;
  title: string;
  link?: string;
  width?: number;
  height?: number;
}

interface ImageGridDisplayProps {
  images: GridImage[];
  onImageClick?: (image: GridImage, index: number) => void;
  onDownload?: (image: GridImage) => void;
  className?: string;
  persona?: "ulysse" | "iris" | "alfred";
}

export function ImageGridDisplay({ images, onDownload, className, persona = "ulysse" }: ImageGridDisplayProps) {
  const Avatar = persona === "alfred" ? AlfredAvatar : persona === "iris" ? IrisAvatar : UlysseAvatar;
  const avatarName = persona === "alfred" ? "MAX" : persona === "iris" ? "IRIS" : "ULYSSE";
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());
  const [isOpen, setIsOpen] = useState(true);

  const displayImages = images.slice(0, 4);
  
  const handleImageError = (index: number) => {
    setImageErrors(prev => new Set(prev).add(index));
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleReopen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleDownload = (image: GridImage, e: MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload(image);
    } else {
      const link = document.createElement("a");
      link.href = image.url;
      link.download = image.title || "image";
      link.target = "_blank";
      link.click();
    }
  };

  const handleOpenExternal = (image: GridImage, e: MouseEvent) => {
    e.stopPropagation();
    if (image.link) {
      window.open(image.link, "_blank");
    } else {
      window.open(image.url, "_blank");
    }
  };

  if (displayImages.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full text-muted-foreground", className)}>
        Aucune image à afficher
      </div>
    );
  }

  return (
    <>
      {!isOpen && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn("inline-flex", className)}
        >
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-muted/50"
            onClick={handleReopen}
            data-testid="button-reopen-images"
          >
            <div className="flex -space-x-2">
              {displayImages.slice(0, 3).map((img, i) => (
                <div 
                  key={i}
                  className="w-6 h-6 rounded-full border-2 border-background overflow-hidden bg-muted"
                >
                  <img 
                    src={img.thumbnailUrl || img.url} 
                    alt="" 
                    className="w-full h-full object-cover"
                    onError={(e) => e.currentTarget.style.display = 'none'}
                  />
                </div>
              ))}
            </div>
            <span className="text-xs">
              {displayImages.length} image{displayImages.length > 1 ? 's' : ''}
            </span>
          </Button>
        </motion.div>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black backdrop-blur-md"
            onClick={handleClose}
            data-testid="lightbox-overlay"
          >
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3 md:p-4 safe-area-inset-top z-20">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-primary/30 to-accent/30 border border-white/20">
                  <Avatar isActive={true} isSearching={true} className="w-full h-full" />
                </div>
                <span className="text-white/70 text-xs font-medium">{avatarName}</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="bg-white/10 text-white"
                onClick={handleClose}
                aria-label="Fermer"
                data-testid="button-lightbox-close"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="relative w-full max-w-[95vw] md:max-w-[80vw] lg:max-w-[70vw] px-4 pt-16 pb-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={cn(
                "grid gap-2 md:gap-3",
                displayImages.length === 1 && "grid-cols-1",
                displayImages.length === 2 && "grid-cols-2",
                displayImages.length === 3 && "grid-cols-3",
                displayImages.length >= 4 && "grid-cols-2 grid-rows-2"
              )}>
                {displayImages.map((image, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2, delay: index * 0.05 }}
                    className="relative aspect-square bg-black/40 rounded-lg overflow-hidden border border-white/10 group"
                  >
                    {!imageErrors.has(index) ? (
                      <img
                        src={image.url}
                        alt={image.title}
                        className="w-full h-full object-cover"
                        onError={() => handleImageError(index)}
                        draggable={false}
                        data-testid={`lightbox-image-${index}`}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/50 text-sm">
                        Image non disponible
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute bottom-0 left-0 right-0 p-2 md:p-3">
                        <p className="text-white text-xs md:text-sm font-medium line-clamp-2 mb-2">
                          {image.title}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 gap-1 touch-manipulation text-xs"
                            onClick={(e) => handleDownload(image, e)}
                            data-testid={`button-download-${index}`}
                          >
                            <Download className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 gap-1 touch-manipulation text-xs"
                            onClick={(e) => handleOpenExternal(image, e)}
                            data-testid={`button-open-${index}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              
              <p className="text-white/60 text-xs text-center mt-3">
                Appuyez sur une image pour télécharger ou ouvrir
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
