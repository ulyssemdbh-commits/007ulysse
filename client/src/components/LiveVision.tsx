import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Eye, EyeOff, Camera, RotateCcw, Loader2, Zap, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VisionResult {
  analysis: string;
  timestamp: number;
  tokensUsed: number;
}

interface LiveVisionProps {
  onAnalysis?: (analysis: string) => void;
  compact?: boolean;
}

export function LiveVision({ onAnalysis, compact = false }: LiveVisionProps) {
  const [isActive, setIsActive] = useState(false);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [customPrompt, setCustomPrompt] = useState("");
  const [results, setResults] = useState<VisionResult[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsActive(true);
    } catch (err: any) {
      toast({ title: "Erreur caméra", description: err.message || "Impossible d'accéder à la caméra", variant: "destructive" });
    }
  }, [facingMode, toast]);

  const stopCamera = useCallback(() => {
    if (autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current);
      autoIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    setIsAutoMode(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = Math.min(video.videoWidth, 640);
    canvas.height = Math.min(video.videoHeight, 480);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  }, []);

  const analyzeFrame = useCallback(async () => {
    if (isAnalyzing) return;
    const frameData = captureFrame();
    if (!frameData) return;

    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/hub/vision/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          imageBase64: frameData,
          prompt: customPrompt || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Analyse échouée");
      }

      const data = await response.json();
      if (data.success && data.analysis) {
        const result: VisionResult = {
          analysis: data.analysis,
          timestamp: data.timestamp || Date.now(),
          tokensUsed: data.tokensUsed || 0,
        };
        setResults(prev => [result, ...prev].slice(0, 10));
        setTotalTokens(prev => prev + result.tokensUsed);
        onAnalysis?.(data.analysis);
      }
    } catch (err: any) {
      toast({ title: "Erreur vision", description: err.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, captureFrame, customPrompt, onAnalysis, toast]);

  const toggleAutoMode = useCallback(() => {
    if (isAutoMode) {
      if (autoIntervalRef.current) {
        clearInterval(autoIntervalRef.current);
        autoIntervalRef.current = null;
      }
      setIsAutoMode(false);
    } else {
      analyzeFrame();
      autoIntervalRef.current = setInterval(() => {
        analyzeFrame();
      }, 8000);
      setIsAutoMode(true);
    }
  }, [isAutoMode, analyzeFrame]);

  const flipCamera = useCallback(() => {
    setFacingMode(prev => prev === "user" ? "environment" : "user");
    if (isActive) {
      stopCamera();
      setTimeout(() => startCamera(), 300);
    }
  }, [isActive, stopCamera, startCamera]);

  if (compact) {
    return (
      <div className="flex flex-col gap-2" data-testid="live-vision-compact">
        <canvas ref={canvasRef} className="hidden" />
        {!isActive ? (
          <Button onClick={startCamera} variant="outline" size="sm" data-testid="button-start-vision">
            <Eye className="w-4 h-4 mr-1" /> Vision Live
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative rounded-lg overflow-hidden bg-black" style={{ height: "200px" }}>
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {isAnalyzing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <Button onClick={analyzeFrame} disabled={isAnalyzing} size="sm" className="flex-1" data-testid="button-analyze-frame">
                <Eye className="w-3 h-3 mr-1" /> Analyser
              </Button>
              <Button onClick={toggleAutoMode} size="sm" variant={isAutoMode ? "destructive" : "outline"} data-testid="button-auto-vision">
                <Zap className="w-3 h-3" />
              </Button>
              <Button onClick={stopCamera} size="sm" variant="ghost" data-testid="button-stop-vision">
                <EyeOff className="w-3 h-3" />
              </Button>
            </div>
            {results.length > 0 && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-24 overflow-y-auto">
                {results[0].analysis}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="w-full" data-testid="live-vision-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Vision en temps réel
          </div>
          <div className="flex items-center gap-2">
            {isActive && (
              <>
                <Badge variant={isAutoMode ? "destructive" : "secondary"} className="text-xs">
                  {isAutoMode ? "AUTO" : "MANUEL"}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {totalTokens} tokens
                </Badge>
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <canvas ref={canvasRef} className="hidden" />

        {!isActive ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Eye className="w-12 h-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              Active la caméra pour qu'Ulysse voie en temps réel
            </p>
            <Button onClick={startCamera} data-testid="button-start-vision-full">
              <Camera className="w-4 h-4 mr-2" /> Activer la vision
            </Button>
          </div>
        ) : (
          <>
            <div className="relative rounded-lg overflow-hidden bg-black" style={{ height: "300px" }}>
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {isAnalyzing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="flex items-center gap-2 text-white bg-black/60 px-4 py-2 rounded-full">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Analyse en cours...</span>
                  </div>
                </div>
              )}
              <div className="absolute top-3 right-3 flex gap-2">
                <Button variant="ghost" size="icon" onClick={flipCamera} className="bg-black/50 text-white h-8 w-8" data-testid="button-flip-vision">
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
              {isAutoMode && (
                <div className="absolute top-3 left-3">
                  <div className="flex items-center gap-1.5 bg-red-500/80 text-white px-2 py-1 rounded-full text-xs">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    LIVE
                  </div>
                </div>
              )}
            </div>

            <Textarea
              placeholder="Question spécifique (optionnel) — ex: 'Combien de personnes vois-tu ?'"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid="input-vision-prompt"
            />

            <div className="flex gap-2">
              <Button onClick={analyzeFrame} disabled={isAnalyzing} className="flex-1" data-testid="button-analyze-full">
                <Eye className="w-4 h-4 mr-2" />
                {isAnalyzing ? "Analyse..." : "Analyser maintenant"}
              </Button>
              <Button onClick={toggleAutoMode} variant={isAutoMode ? "destructive" : "outline"} data-testid="button-auto-full">
                <Zap className="w-4 h-4 mr-1" />
                {isAutoMode ? "Stop auto" : "Mode auto"}
              </Button>
              <Button onClick={stopCamera} variant="ghost" data-testid="button-stop-full">
                <EyeOff className="w-4 h-4" />
              </Button>
            </div>

            {results.length > 0 && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                <h4 className="text-sm font-medium text-muted-foreground">Résultats ({results.length})</h4>
                {results.map((r, i) => (
                  <div
                    key={r.timestamp}
                    className={`text-sm p-3 rounded-lg border ${i === 0 ? "bg-primary/5 border-primary/20" : "bg-muted/30"}`}
                    data-testid={`vision-result-${i}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.timestamp).toLocaleTimeString("fr-FR")}
                      </span>
                      <span className="text-xs text-muted-foreground">{r.tokensUsed} tokens</span>
                    </div>
                    <p className="whitespace-pre-wrap">{r.analysis}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
