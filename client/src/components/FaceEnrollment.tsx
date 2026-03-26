import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Camera, 
  UserPlus, 
  Trash2, 
  RefreshCw, 
  Check, 
  X,
  Users,
  Scan,
  Loader2
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import * as faceRecognition from "@/lib/faceRecognition";
import type { KnownPerson } from "@shared/schema";

interface FaceEnrollmentProps {
  onClose?: () => void;
}

export function FaceEnrollment({ onClose }: FaceEnrollmentProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [detectedFace, setDetectedFace] = useState<faceRecognition.DetectedFace | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [newPersonName, setNewPersonName] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [enrollmentStep, setEnrollmentStep] = useState<"idle" | "detecting" | "captured" | "enrolling">("idle");
  
  const { data: persons = [], isLoading: loadingPersons } = useQuery<KnownPerson[]>({
    queryKey: ["/api/v2/faces/persons"],
  });
  
  const createPerson = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/v2/faces/persons", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/faces/persons"] });
    },
  });
  
  const addDescriptor = useMutation({
    mutationFn: async (data: { personId: number; descriptor: number[] }) => {
      const res = await apiRequest("POST", "/api/v2/faces/descriptors", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/faces/persons"] });
      toast({ title: "Visage enregistré", description: "Le visage a été ajouté avec succès" });
    },
  });
  
  const deletePerson = useMutation({
    mutationFn: async (personId: number) => {
      await apiRequest("DELETE", `/api/v2/faces/persons/${personId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/faces/persons"] });
      toast({ title: "Personne supprimée" });
    },
  });
  
  useEffect(() => {
    const loadModels = async () => {
      try {
        await faceRecognition.loadModels();
        setModelsLoaded(true);
      } catch (error) {
        console.error("Failed to load face models:", error);
        toast({ title: "Erreur", description: "Impossible de charger les modèles", variant: "destructive" });
      }
    };
    loadModels();
    
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
        setIsCameraActive(true);
        setEnrollmentStep("detecting");
      }
    } catch (error) {
      console.error("Failed to start camera:", error);
      toast({ title: "Erreur", description: "Impossible d'accéder à la caméra", variant: "destructive" });
    }
  };
  
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setDetectedFace(null);
    setEnrollmentStep("idle");
  };
  
  const detectFaceLoop = useCallback(async () => {
    if (!videoRef.current || !isCameraActive || enrollmentStep !== "detecting") return;
    
    try {
      const face = await faceRecognition.detectSingleFace(videoRef.current);
      setDetectedFace(face);
      
      if (canvasRef.current && videoRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          if (face) {
            const scaleX = canvasRef.current.width / videoRef.current.videoWidth;
            const scaleY = canvasRef.current.height / videoRef.current.videoHeight;
            
            ctx.strokeStyle = face.confidence > 0.8 ? "#22c55e" : "#eab308";
            ctx.lineWidth = 3;
            ctx.strokeRect(
              face.box.x * scaleX,
              face.box.y * scaleY,
              face.box.width * scaleX,
              face.box.height * scaleY
            );
          }
        }
      }
    } catch (error) {
      console.error("Face detection error:", error);
    }
    
    if (enrollmentStep === "detecting") {
      requestAnimationFrame(detectFaceLoop);
    }
  }, [isCameraActive, enrollmentStep]);
  
  useEffect(() => {
    if (isCameraActive && modelsLoaded && enrollmentStep === "detecting") {
      const timeout = setTimeout(detectFaceLoop, 100);
      return () => clearTimeout(timeout);
    }
  }, [isCameraActive, modelsLoaded, enrollmentStep, detectFaceLoop]);
  
  const captureFace = async () => {
    if (!videoRef.current || !detectedFace) return;
    
    setIsLoading(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(videoRef.current, 0, 0);
      
      const fullImage = canvas.toDataURL("image/jpeg", 0.9);
      setCapturedImage(fullImage);
      setEnrollmentStep("captured");
      stopCamera();
    } catch (error) {
      console.error("Capture error:", error);
      toast({ title: "Erreur", description: "Échec de la capture", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };
  
  const enrollFace = async () => {
    if (!capturedImage || !detectedFace?.descriptor) return;
    
    setEnrollmentStep("enrolling");
    setIsLoading(true);
    
    try {
      let personId = selectedPersonId;
      
      if (!personId && newPersonName.trim()) {
        const person = await createPerson.mutateAsync(newPersonName.trim());
        personId = person.id;
      }
      
      if (!personId) {
        toast({ title: "Erreur", description: "Veuillez sélectionner ou créer une personne", variant: "destructive" });
        setEnrollmentStep("captured");
        setIsLoading(false);
        return;
      }
      
      await addDescriptor.mutateAsync({
        personId,
        descriptor: faceRecognition.descriptorToArray(detectedFace.descriptor),
      });
      
      setCapturedImage(null);
      setDetectedFace(null);
      setNewPersonName("");
      setSelectedPersonId(null);
      setEnrollmentStep("idle");
    } catch (error) {
      console.error("Enrollment error:", error);
      toast({ title: "Erreur", description: "Échec de l'enregistrement", variant: "destructive" });
      setEnrollmentStep("captured");
    } finally {
      setIsLoading(false);
    }
  };
  
  const cancelCapture = () => {
    setCapturedImage(null);
    setDetectedFace(null);
    setNewPersonName("");
    setSelectedPersonId(null);
    setEnrollmentStep("idle");
  };
  
  return (
    <Card className="w-full max-w-2xl mx-auto" data-testid="card-face-enrollment">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Scan className="w-5 h-5" />
            Reconnaissance faciale
          </CardTitle>
          {onClose && (
            <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-enrollment">
              <X className="w-4 h-4" />
            </Button>
          )}
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
              {enrollmentStep === "idle" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Camera className="w-12 h-12 mb-2" />
                  <p>Cliquez sur "Démarrer" pour capturer un visage</p>
                </div>
              )}
              
              {(enrollmentStep === "detecting") && (
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
                  {detectedFace && (
                    <Badge 
                      className="absolute top-2 right-2" 
                      variant={detectedFace.confidence > 0.8 ? "default" : "secondary"}
                    >
                      {Math.round(detectedFace.confidence * 100)}% confiance
                    </Badge>
                  )}
                </>
              )}
              
              {capturedImage && (
                <img src={capturedImage} alt="Captured face" className="w-full h-full object-cover" />
              )}
            </div>
            
            <div className="flex gap-2">
              {enrollmentStep === "idle" && (
                <Button onClick={startCamera} className="flex-1" data-testid="button-start-camera">
                  <Camera className="w-4 h-4 mr-2" />
                  Démarrer la caméra
                </Button>
              )}
              
              {enrollmentStep === "detecting" && (
                <>
                  <Button onClick={stopCamera} variant="outline" data-testid="button-stop-camera">
                    <X className="w-4 h-4 mr-2" />
                    Annuler
                  </Button>
                  <Button 
                    onClick={captureFace} 
                    disabled={!detectedFace || detectedFace.confidence < 0.6 || isLoading}
                    className="flex-1"
                    data-testid="button-capture-face"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    Capturer
                  </Button>
                </>
              )}
              
              {enrollmentStep === "captured" && (
                <>
                  <Button onClick={cancelCapture} variant="outline" data-testid="button-cancel-capture">
                    <X className="w-4 h-4 mr-2" />
                    Annuler
                  </Button>
                  <Button onClick={startCamera} variant="outline" data-testid="button-retake">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reprendre
                  </Button>
                </>
              )}
            </div>
            
            {enrollmentStep === "captured" && (
              <div className="space-y-3 p-4 border rounded-lg">
                <Label>Associer à une personne</Label>
                
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Nouvelle personne</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Nom..."
                        value={newPersonName}
                        onChange={(e) => {
                          setNewPersonName(e.target.value);
                          setSelectedPersonId(null);
                        }}
                        data-testid="input-new-person-name"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Personne existante</Label>
                    <ScrollArea className="h-[100px] border rounded-md p-2">
                      {persons.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">Aucune personne</p>
                      ) : (
                        <div className="space-y-1">
                          {persons.map((person) => (
                            <button
                              key={person.id}
                              onClick={() => {
                                setSelectedPersonId(person.id);
                                setNewPersonName("");
                              }}
                              className={cn(
                                "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm",
                                selectedPersonId === person.id ? "bg-primary/10" : "hover-elevate"
                              )}
                              data-testid={`button-select-person-${person.id}`}
                            >
                              <Avatar className="w-6 h-6">
                                <AvatarFallback>{person.name.charAt(0)}</AvatarFallback>
                              </Avatar>
                              <span className="truncate">{person.name}</span>
                              <Badge variant="secondary" className="ml-auto text-[10px]">
                                {person.photoCount}
                              </Badge>
                            </button>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>
                
                <Button 
                  onClick={enrollFace} 
                  disabled={isLoading || (!newPersonName.trim() && !selectedPersonId)}
                  className="w-full"
                  data-testid="button-enroll-face"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  Enregistrer le visage
                </Button>
              </div>
            )}
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Personnes enregistrées ({persons.length})
                </Label>
              </div>
              
              {loadingPersons ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : persons.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  Aucune personne enregistrée
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {persons.map((person) => (
                    <div
                      key={person.id}
                      className="flex items-center gap-2 p-2 rounded-lg border bg-card"
                      data-testid={`card-person-${person.id}`}
                    >
                      <Avatar className="w-10 h-10">
                        {person.thumbnailPath && <AvatarImage src={person.thumbnailPath} />}
                        <AvatarFallback className={person.isOwner ? "bg-primary text-primary-foreground" : ""}>
                          {person.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{person.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {person.photoCount} photo{person.photoCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => deletePerson.mutate(person.id)}
                        data-testid={`button-delete-person-${person.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
