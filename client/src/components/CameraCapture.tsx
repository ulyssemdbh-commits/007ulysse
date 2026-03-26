import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Video, X, RotateCcw, Check, Loader2, Image, Film, Heart, Trash2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface MediaItem {
  id: number;
  type: "photo" | "video";
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  description?: string;
  tags: string[];
  isFavorite: boolean;
  capturedAt: string;
}

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture?: (file: File) => void;
}

export function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const [mode, setMode] = useState<"camera" | "library">("camera");
  const [captureMode, setCaptureMode] = useState<"photo" | "video">("photo");
  const [isRecording, setIsRecording] = useState(false);
  const [capturedMedia, setCapturedMedia] = useState<Blob | null>(null);
  const [capturedType, setCapturedType] = useState<"photo" | "video">("photo");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [isUploading, setIsUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: mediaData, isLoading: isLoadingMedia } = useQuery<{ media: MediaItem[] }>({
    queryKey: ["/api/media"],
    enabled: mode === "library",
  });

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: captureMode === "video",
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      toast({ title: "Erreur caméra", description: "Impossible d'accéder à la caméra", variant: "destructive" });
    }
  }, [facingMode, captureMode, toast]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (open && mode === "camera") {
      startCamera();
    } else if (!open || mode === "library") {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, mode, startCamera, stopCamera]);

  const handleClose = useCallback(() => {
    stopCamera();
    setCapturedMedia(null);
    setIsRecording(false);
    onClose();
  }, [stopCamera, onClose]);

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedMedia(blob);
        setCapturedType("photo");
      }
    }, "image/jpeg", 0.9);
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    
    chunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
    mediaRecorderRef.current = mediaRecorder;
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setCapturedMedia(blob);
      setCapturedType("video");
    };
    
    mediaRecorder.start();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const retake = useCallback(() => {
    setCapturedMedia(null);
    startCamera();
  }, [startCamera]);

  const uploadMedia = useCallback(async () => {
    if (!capturedMedia) return;
    
    // If onCapture callback is provided, use it instead of uploading to library
    if (onCapture) {
      const ext = capturedType === "photo" ? "jpg" : "webm";
      const filename = `capture_${Date.now()}.${ext}`;
      const mimeType = capturedType === "photo" ? "image/jpeg" : "video/webm";
      const file = new File([capturedMedia], filename, { type: mimeType });
      onCapture(file);
      setCapturedMedia(null);
      handleClose();
      return;
    }
    
    setIsUploading(true);
    try {
      const formData = new FormData();
      const ext = capturedType === "photo" ? "jpg" : "webm";
      const filename = `capture_${Date.now()}.${ext}`;
      formData.append("media", capturedMedia, filename);
      
      const response = await fetch("/api/media/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Session expirée - reconnecte-toi");
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Upload failed");
      }
      
      toast({ title: "Média sauvegardé", description: `${capturedType === "photo" ? "Photo" : "Vidéo"} ajoutée à la bibliothèque` });
      setCapturedMedia(null);
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      setMode("library");
    } catch (err: any) {
      console.error("Upload error:", err);
      toast({ title: "Erreur", description: err.message || "Impossible de sauvegarder le média", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [capturedMedia, capturedType, toast, queryClient, onCapture, handleClose]);

  const toggleFavorite = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/media/${id}/favorite`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    },
  });

  const deleteMedia = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/media/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({ title: "Supprimé", description: "Média supprimé de la bibliothèque" });
    },
  });

  const flipCamera = useCallback(() => {
    setFacingMode(prev => prev === "user" ? "environment" : "user");
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" data-testid="camera-modal" aria-describedby={undefined}>
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant={mode === "camera" ? "default" : "ghost"}
                size="sm"
                onClick={() => setMode("camera")}
                data-testid="button-camera-tab"
              >
                <Camera className="w-4 h-4 mr-1" /> Caméra
              </Button>
              <Button
                variant={mode === "library" ? "default" : "ghost"}
                size="sm"
                onClick={() => setMode("library")}
                data-testid="button-library-tab"
              >
                <Image className="w-4 h-4 mr-1" /> Bibliothèque
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {mode === "camera" ? (
          <div className="relative bg-black">
            <canvas ref={canvasRef} className="hidden" />
            
            {capturedMedia ? (
              <div className="relative">
                {capturedType === "photo" ? (
                  <img
                    src={URL.createObjectURL(capturedMedia)}
                    alt="Captured"
                    className="w-full h-[400px] object-contain"
                  />
                ) : (
                  <video
                    src={URL.createObjectURL(capturedMedia)}
                    controls
                    className="w-full h-[400px] object-contain"
                  />
                )}
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
                  <Button variant="outline" onClick={retake} data-testid="button-retake">
                    <RotateCcw className="w-4 h-4 mr-1" /> Reprendre
                  </Button>
                  <Button onClick={uploadMedia} disabled={isUploading} data-testid="button-save-capture">
                    {isUploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                    Sauvegarder
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-[400px] object-cover"
                />
                
                <div className="absolute top-4 right-4">
                  <Button variant="ghost" size="icon" onClick={flipCamera} className="bg-black/50 text-white" data-testid="button-flip-camera">
                    <RotateCcw className="w-5 h-5" />
                  </Button>
                </div>

                <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-4">
                  <div className="flex gap-2">
                    <Button
                      variant={captureMode === "photo" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setCaptureMode("photo")}
                      className="bg-black/50"
                      data-testid="button-photo-mode"
                    >
                      <Camera className="w-4 h-4 mr-1" /> Photo
                    </Button>
                    <Button
                      variant={captureMode === "video" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setCaptureMode("video")}
                      className="bg-black/50"
                      data-testid="button-video-mode"
                    >
                      <Video className="w-4 h-4 mr-1" /> Vidéo
                    </Button>
                  </div>

                  {captureMode === "photo" ? (
                    <Button
                      size="lg"
                      className="rounded-full w-16 h-16"
                      onClick={takePhoto}
                      data-testid="button-take-photo"
                    >
                      <Camera className="w-8 h-8" />
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      className={`rounded-full w-16 h-16 ${isRecording ? "bg-red-500 hover:bg-red-600" : ""}`}
                      onClick={isRecording ? stopRecording : startRecording}
                      data-testid="button-record-video"
                    >
                      {isRecording ? (
                        <div className="w-6 h-6 bg-white rounded-sm" />
                      ) : (
                        <Video className="w-8 h-8" />
                      )}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-4 h-[450px] overflow-y-auto">
            {isLoadingMedia ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : mediaData?.media?.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Image className="w-12 h-12 mb-2" />
                <p>Aucun média dans la bibliothèque</p>
                <Button variant="ghost" className="mt-2" onClick={() => setMode("camera")}>
                  Prendre une photo
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {mediaData?.media?.map((item) => (
                  <Card key={item.id} className="relative overflow-hidden group" data-testid={`media-item-${item.id}`}>
                    {item.type === "photo" ? (
                      <img
                        src={`/api/media/file/${item.filename}`}
                        alt={item.originalName}
                        className="w-full h-32 object-cover"
                      />
                    ) : (
                      <div className="relative w-full h-32 bg-muted flex items-center justify-center">
                        <Film className="w-8 h-8 text-muted-foreground" />
                        <video
                          src={`/api/media/file/${item.filename}`}
                          className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity"
                          muted
                          preload="metadata"
                        />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-white"
                        onClick={() => toggleFavorite.mutate(item.id)}
                        data-testid={`button-favorite-${item.id}`}
                      >
                        <Heart className={`w-5 h-5 ${item.isFavorite ? "fill-red-500 text-red-500" : ""}`} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-white"
                        onClick={() => window.open(`/api/media/file/${item.filename}`, "_blank")}
                        data-testid={`button-download-${item.id}`}
                      >
                        <Download className="w-5 h-5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-white"
                        onClick={() => deleteMedia.mutate(item.id)}
                        data-testid={`button-delete-${item.id}`}
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </div>
                    {item.isFavorite && (
                      <div className="absolute top-1 right-1">
                        <Heart className="w-4 h-4 fill-red-500 text-red-500" />
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
