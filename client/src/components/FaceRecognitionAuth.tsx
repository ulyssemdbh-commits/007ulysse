import { useState, useEffect, useCallback } from "react";
import { useFaceRecognition, deserializeFaceDescriptor, type FaceDescriptor } from "@/hooks/useFaceRecognition";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Camera, User, Shield, CheckCircle, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface FaceRecognitionAuthProps {
  userId: number;
  userName: string;
  onAuthenticated?: (success: boolean, confidence: number) => void;
  autoStart?: boolean;
  showPreview?: boolean;
}

export function FaceRecognitionAuth({ 
  userId, 
  userName, 
  onAuthenticated,
  autoStart = false,
  showPreview = true
}: FaceRecognitionAuthProps) {
  const [authStatus, setAuthStatus] = useState<"idle" | "scanning" | "success" | "failed">("idle");
  const [authConfidence, setAuthConfidence] = useState(0);
  const [scanAttempts, setScanAttempts] = useState(0);
  const maxAttempts = 5;

  const handleFaceDetected = useCallback((name: string | null, confidence: number) => {
    if (name === userName && confidence > 0.5) {
      setAuthStatus("success");
      setAuthConfidence(confidence);
      onAuthenticated?.(true, confidence);
    } else if (scanAttempts >= maxAttempts) {
      setAuthStatus("failed");
      onAuthenticated?.(false, 0);
    }
    setScanAttempts(prev => prev + 1);
  }, [userName, onAuthenticated, scanAttempts]);

  const {
    isLoading,
    isReady,
    isDetecting,
    error,
    detectedFace,
    confidence,
    videoRef,
    canvasRef,
    startCamera,
    stopCamera,
    startDetection,
    stopDetection,
    loadEnrolledFaces
  } = useFaceRecognition({
    onFaceDetected: handleFaceDetected,
    detectionInterval: 300,
    matchThreshold: 0.5
  });

  const { data: existingFaces, isLoading: loadingFaces } = useQuery<{ id: number; descriptor: number[] }[]>({
    queryKey: ["/api/face-descriptors", userId],
    enabled: !!userId
  });

  useEffect(() => {
    if (existingFaces && existingFaces.length > 0) {
      const faces: FaceDescriptor[] = existingFaces.map((f, idx) => ({
        id: `${userId}_${idx}`,
        name: userName,
        descriptor: deserializeFaceDescriptor(f.descriptor)
      }));
      loadEnrolledFaces(faces);
    }
  }, [existingFaces, userId, userName, loadEnrolledFaces]);

  useEffect(() => {
    if (autoStart && isReady && existingFaces && existingFaces.length > 0) {
      handleStartAuth();
    }
  }, [autoStart, isReady, existingFaces]);

  useEffect(() => {
    if (authStatus === "success" || authStatus === "failed") {
      stopDetection();
      stopCamera();
    }
  }, [authStatus, stopDetection, stopCamera]);

  const handleStartAuth = async () => {
    setAuthStatus("scanning");
    setScanAttempts(0);
    await startCamera();
    startDetection();
  };

  const handleCancel = () => {
    stopDetection();
    stopCamera();
    setAuthStatus("idle");
    setScanAttempts(0);
  };

  const handleRetry = () => {
    setAuthStatus("idle");
    setScanAttempts(0);
    setAuthConfidence(0);
  };

  if (isLoading || loadingFaces) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">Chargement...</span>
      </div>
    );
  }

  if (!existingFaces || existingFaces.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-muted-foreground">
        <User className="h-5 w-5 mr-2" />
        <span className="text-sm">Aucun visage enregistré</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-4 text-destructive">
        <XCircle className="h-5 w-5 mr-2" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {authStatus === "idle" && (
        <div className="flex flex-col items-center gap-4 p-4">
          <Shield className="h-12 w-12 text-primary" />
          <p className="text-sm text-muted-foreground text-center">
            Authentification par reconnaissance faciale
          </p>
          <Button onClick={handleStartAuth} size="lg">
            <Camera className="h-4 w-4 mr-2" />
            Commencer
          </Button>
        </div>
      )}

      {authStatus === "scanning" && (
        <div className="space-y-4">
          {showPreview && (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
              />
              <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                <Badge variant="secondary">
                  Scan {scanAttempts}/{maxAttempts}
                </Badge>
                {detectedFace && (
                  <Badge variant="default" className="bg-green-600">
                    {detectedFace} ({(confidence * 100).toFixed(0)}%)
                  </Badge>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Recherche du visage...</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleCancel}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {authStatus === "success" && (
        <div className="flex flex-col items-center gap-4 p-6 bg-green-50 dark:bg-green-950 rounded-lg">
          <CheckCircle className="h-12 w-12 text-green-600" />
          <div className="text-center">
            <p className="font-medium text-green-700 dark:text-green-300">
              Authentification réussie
            </p>
            <p className="text-sm text-green-600 dark:text-green-400">
              Confiance: {(authConfidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      {authStatus === "failed" && (
        <div className="flex flex-col items-center gap-4 p-6 bg-red-50 dark:bg-red-950 rounded-lg">
          <XCircle className="h-12 w-12 text-red-600" />
          <div className="text-center">
            <p className="font-medium text-red-700 dark:text-red-300">
              Authentification échouée
            </p>
            <p className="text-sm text-red-600 dark:text-red-400">
              Visage non reconnu
            </p>
          </div>
          <Button variant="outline" onClick={handleRetry}>
            Réessayer
          </Button>
        </div>
      )}
    </div>
  );
}
