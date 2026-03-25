import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Download, X, Crop, Sparkles, Sun, Contrast, Image as ImageIcon, CircleDot } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ImageEditorProps {
  imageDataUrl: string;
  onClose: () => void;
  onSave?: (editedDataUrl: string) => void;
}

interface Preset {
  id: string;
  description: string;
}

const PRESET_ICONS: Record<string, typeof Crop> = {
  profile_square: Crop,
  profile_circle: CircleDot,
  blur_background: Sparkles,
  enhance_brightness: Sun,
  enhance_contrast: Contrast,
  grayscale: ImageIcon,
  resize_small: ImageIcon,
  resize_medium: ImageIcon,
};

export function ImageEditor({ imageDataUrl, onClose, onSave }: ImageEditorProps) {
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const { data: presetsData } = useQuery<{ presets: Preset[] }>({
    queryKey: ["/api/image/edit/presets"],
  });

  const editMutation = useMutation({
    mutationFn: async (preset: string) => {
      const response = await apiRequest("POST", "/api/image/edit/basic", {
        imageBase64: imageDataUrl,
        preset,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to edit image");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.dataUrl) {
        setEditedImage(data.dataUrl);
      }
    },
  });

  const handleApplyPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    editMutation.mutate(presetId);
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = editedImage || imageDataUrl;
    link.download = `edited_image_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSave = () => {
    if (editedImage && onSave) {
      onSave(editedImage);
    }
    onClose();
  };

  const displayImage = editedImage || imageDataUrl;
  const presets = presetsData?.presets || [];

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-lg">Éditer l'image</CardTitle>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onClose}
          data-testid="button-close-editor"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
          {editMutation.isPending && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          <img
            src={displayImage}
            alt="Image à éditer"
            className="max-h-full max-w-full object-contain"
            data-testid="img-editor-preview"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Choisir un effet :</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {presets.map((preset) => {
              const Icon = PRESET_ICONS[preset.id] || ImageIcon;
              const isSelected = selectedPreset === preset.id;
              return (
                <Button
                  key={preset.id}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-2 gap-1"
                  onClick={() => handleApplyPreset(preset.id)}
                  disabled={editMutation.isPending}
                  data-testid={`button-preset-${preset.id}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-xs text-center leading-tight">
                    {preset.description.split(" ").slice(0, 3).join(" ")}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>

        {editMutation.isError && (
          <p className="text-sm text-destructive" data-testid="text-edit-error">
            Erreur lors de l'édition. Réessayez.
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button 
            variant="outline" 
            onClick={handleDownload}
            data-testid="button-download-image"
          >
            <Download className="h-4 w-4 mr-2" />
            Télécharger
          </Button>
          {onSave && editedImage && (
            <Button 
              onClick={handleSave}
              data-testid="button-save-edited"
            >
              Utiliser cette image
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
