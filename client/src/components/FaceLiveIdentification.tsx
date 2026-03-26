import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Camera, 
  CameraOff, 
  Scan,
  User,
  Users,
  Loader2,
  X,
  Volume2,
  VolumeX
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import * as faceRecognition from "@/lib/faceRecognition";
import { apiRequest } from "@/lib/queryClient";

interface IdentifiedPerson {
  personId: number;
  personName: string;
  confidence: number;
  matchType: "exact" | "high" | "medium" | "low";
  box: { x: number; y: number; width: number; height: number };
  lastSeen: number;
}

interface FaceLiveIdentificationProps {
  onClose?: () => void;
  onPersonIdentified?: (person: { id: number; name: string; confidence: number }) => void;
}

export function FaceLiveIdentification({ onClose, onPersonIdentified }: FaceLiveIdentificationProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  
  const [isActive, setIsActive] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [identifiedPersons, setIdentifiedPersons] = useState<IdentifiedPerson[]>([]);
  const [processingFps, setProcessingFps] = useState(0);
  const [announceNames, setAnnounceNames] = useState(false);
  const [showUnknown, setShowUnknown] = useState(true);
  const [unknownCount, setUnknownCount] = useState(0);
  
  const announcedRef = useRef<Set<string>>(new Set());
  const lastProcessTimeRef = useRef(0);
  const fpsCounterRef = useRef<number[]>([]);
  
  const { data: persons = [] } = useQuery<faceRecognition.Person[]>({
    queryKey: ["/api/v2/faces/all-with-descriptors"],
  });
  
  useEffect(() => {
    const load = async () => {
      try {
        await faceRecognition.loadModels();
        setModelsLoaded(true);
      } catch (error) {
        console.error("Failed to load models:", error);
        toast({ title: "Erreur", description: "Impossible de charger les modèles", variant: "destructive" });
      }
    };
    load();
    
    return () => {
      stopCamera();
    };
  }, []);
  
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsActive(true);
        announcedRef.current.clear();
      }
    } catch (error) {
      console.error("Failed to start camera:", error);
      toast({ title: "Erreur", description: "Impossible d'accéder à la caméra", variant: "destructive" });
    }
  };
  
  const stopCamera = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    setIdentifiedPersons([]);
    setUnknownCount(0);
  };
  
  const announceIdentification = useCallback((name: string) => {
    if (!announceNames) return;
    
    const key = `${name}-${Math.floor(Date.now() / 10000)}`;
    if (announcedRef.current.has(key)) return;
    
    announcedRef.current.add(key);
    
    const utterance = new SpeechSynthesisUtterance(`${name} identifié`);
    utterance.lang = "fr-FR";
    utterance.rate = 1.1;
    speechSynthesis.speak(utterance);
  }, [announceNames]);
  
  const processFrame = useCallback(async () => {
    if (!videoRef.current || !isActive || !modelsLoaded) return;
    
    const now = Date.now();
    if (now - lastProcessTimeRef.current < 150) {
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    const startTime = performance.now();
    
    try {
      const detectedFaces = await faceRecognition.detectFaces(videoRef.current);
      
      if (detectedFaces.length > 0 && persons.length > 0) {
        const matcher = faceRecognition.createFaceMatcher(persons);
        
        const newIdentified: IdentifiedPerson[] = [];
        let unknowns = 0;
        
        for (const face of detectedFaces) {
          if (!face.descriptor) continue;
          
          let match: faceRecognition.FaceMatch | null = null;
          if (matcher) {
            match = faceRecognition.matchFaceWithMatcher(face.descriptor, matcher);
          } else {
            match = faceRecognition.findBestMatch(face.descriptor, persons);
          }
          
          if (match && match.confidence > 0.5) {
            newIdentified.push({
              personId: match.personId,
              personName: match.personName,
              confidence: match.confidence,
              matchType: match.confidence > 0.7 ? "exact" : match.confidence > 0.6 ? "high" : "medium",
              box: face.box,
              lastSeen: now,
            });
            
            announceIdentification(match.personName);
            onPersonIdentified?.({ id: match.personId, name: match.personName, confidence: match.confidence });
          } else {
            unknowns++;
          }
        }
        
        setIdentifiedPersons(prev => {
          const merged = [...newIdentified];
          for (const old of prev) {
            if (now - old.lastSeen < 2000 && !merged.find(n => n.personId === old.personId)) {
              merged.push({ ...old, confidence: old.confidence * 0.95 });
            }
          }
          return merged.filter(p => p.confidence > 0.3);
        });
        
        setUnknownCount(unknowns);
      } else if (detectedFaces.length > 0) {
        setUnknownCount(detectedFaces.length);
        setIdentifiedPersons([]);
      } else {
        setIdentifiedPersons(prev => 
          prev.map(p => ({ ...p, confidence: p.confidence * 0.9 }))
              .filter(p => p.confidence > 0.3)
        );
        setUnknownCount(0);
      }
      
      if (canvasRef.current && videoRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          const scaleX = canvasRef.current.width / videoRef.current.videoWidth;
          const scaleY = canvasRef.current.height / videoRef.current.videoHeight;
          
          for (const face of detectedFaces) {
            const identified = identifiedPersons.find(p => 
              Math.abs(p.box.x - face.box.x) < 50 && Math.abs(p.box.y - face.box.y) < 50
            );
            
            if (identified) {
              ctx.strokeStyle = identified.matchType === "exact" ? "#22c55e" : 
                               identified.matchType === "high" ? "#3b82f6" : "#eab308";
              ctx.lineWidth = 3;
            } else if (showUnknown) {
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 2;
            } else {
              continue;
            }
            
            ctx.strokeRect(
              face.box.x * scaleX,
              face.box.y * scaleY,
              face.box.width * scaleX,
              face.box.height * scaleY
            );
            
            if (identified) {
              ctx.fillStyle = ctx.strokeStyle;
              ctx.font = "14px sans-serif";
              ctx.fillText(
                `${identified.personName} (${Math.round(identified.confidence * 100)}%)`,
                face.box.x * scaleX,
                face.box.y * scaleY - 5
              );
            }
          }
        }
      }
      
      const processingTime = performance.now() - startTime;
      fpsCounterRef.current.push(1000 / processingTime);
      if (fpsCounterRef.current.length > 10) fpsCounterRef.current.shift();
      setProcessingFps(Math.round(fpsCounterRef.current.reduce((a, b) => a + b, 0) / fpsCounterRef.current.length));
      
    } catch (error) {
      console.error("Frame processing error:", error);
    }
    
    lastProcessTimeRef.current = now;
    animationRef.current = requestAnimationFrame(processFrame);
  }, [isActive, modelsLoaded, persons, identifiedPersons, showUnknown, announceIdentification, onPersonIdentified]);
  
  useEffect(() => {
    if (isActive && modelsLoaded) {
      animationRef.current = requestAnimationFrame(processFrame);
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, modelsLoaded, processFrame]);
  
  const getMatchColor = (type: string) => {
    switch (type) {
      case "exact": return "bg-green-500";
      case "high": return "bg-blue-500";
      case "medium": return "bg-yellow-500";
      default: return "bg-gray-500";
    }
  };
  
  return (
    <Card className="w-full max-w-2xl mx-auto" data-testid="card-live-identification">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Scan className="w-5 h-5" />
            Identification en temps réel
          </CardTitle>
          <div className="flex items-center gap-2">
            {isActive && (
              <Badge variant="outline" className="text-xs">
                {processingFps} FPS
              </Badge>
            )}
            {onClose && (
              <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-live-id">
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {!modelsLoaded ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span>Chargement des modèles...</span>
          </div>
        ) : (
          <>
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
              {!isActive ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Users className="w-12 h-12 mb-2" />
                  <p>Mode identification désactivé</p>
                  <p className="text-xs mt-1">{persons.length} personnes enregistrées</p>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    onLoadedMetadata={() => {
                      if (canvasRef.current && videoRef.current) {
                        canvasRef.current.width = videoRef.current.clientWidth;
                        canvasRef.current.height = videoRef.current.clientHeight;
                      }
                    }}
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 pointer-events-none"
                  />
                </>
              )}
            </div>
            
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch 
                    id="announce" 
                    checked={announceNames} 
                    onCheckedChange={setAnnounceNames}
                    data-testid="switch-announce"
                  />
                  <Label htmlFor="announce" className="flex items-center gap-1 text-sm cursor-pointer">
                    {announceNames ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    Annoncer
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    id="unknown" 
                    checked={showUnknown} 
                    onCheckedChange={setShowUnknown}
                    data-testid="switch-unknown"
                  />
                  <Label htmlFor="unknown" className="text-sm cursor-pointer">
                    Inconnus
                  </Label>
                </div>
              </div>
              
              <Button
                onClick={isActive ? stopCamera : startCamera}
                variant={isActive ? "destructive" : "default"}
                data-testid="button-toggle-live-id"
              >
                {isActive ? (
                  <>
                    <CameraOff className="w-4 h-4 mr-2" />
                    Arrêter
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 mr-2" />
                    Démarrer
                  </>
                )}
              </Button>
            </div>
            
            {isActive && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Personnes détectées
                  </span>
                  <div className="flex gap-2">
                    {identifiedPersons.length > 0 && (
                      <Badge variant="default" className="bg-green-600">
                        {identifiedPersons.length} identifiée(s)
                      </Badge>
                    )}
                    {showUnknown && unknownCount > 0 && (
                      <Badge variant="secondary">
                        {unknownCount} inconnue(s)
                      </Badge>
                    )}
                  </div>
                </div>
                
                {identifiedPersons.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {identifiedPersons.map((person) => (
                      <div
                        key={person.personId}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg border",
                          person.matchType === "exact" ? "border-green-500/50 bg-green-500/10" :
                          person.matchType === "high" ? "border-blue-500/50 bg-blue-500/10" :
                          "border-yellow-500/50 bg-yellow-500/10"
                        )}
                        data-testid={`identified-person-${person.personId}`}
                      >
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className={getMatchColor(person.matchType)}>
                            {person.personName.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{person.personName}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {Math.round(person.confidence * 100)}% confiance
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {!isActive && persons.length === 0 && (
              <div className="text-center py-2 text-sm text-muted-foreground">
                Aucune personne enregistrée. Utilisez l'enregistrement facial pour ajouter des personnes.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
