import { useState, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Check, X, Loader2, Trash2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

interface VoiceEnrollmentProps {
  onComplete?: () => void;
  className?: string;
}

// Dynamic phrases generator based on user and persona
function getEnrollmentPhrases(userName: string, personaName: string): string[] {
  return [
    `Bonjour ${personaName}, c'est ${userName}`,
    `Je suis ${userName} et je parle à ${personaName}`,
    `${personaName} reconnaît ma voix maintenant`,
    `C'est ${userName} qui te parle`,
    `Salut ${personaName}, tu me reconnais`,
  ];
}

const MIN_SAMPLES = 3;
const RECORDING_DURATION = 4000; // 4 seconds per sample

export function VoiceEnrollment({ onComplete, className }: VoiceEnrollmentProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [currentPhrase, setCurrentPhrase] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const progressIntervalRef = useRef<number | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Generate personalized phrases based on user
  const enrollmentPhrases = useMemo(() => {
    const userName = user?.displayName || user?.username || "Utilisateur";
    // Owner uses Ulysse, approved users use Iris
    const personaName = user?.isOwner ? "Ulysse" : "Iris";
    return getEnrollmentPhrases(userName, personaName);
  }, [user]);

  // Check service health and profile on mount
  const checkStatus = useCallback(async () => {
    setIsCheckingProfile(true);
    try {
      // Check service health
      const healthRes = await fetch("/api/speaker/health");
      setServiceAvailable(healthRes.ok);
      
      if (!healthRes.ok) {
        setIsCheckingProfile(false);
        return;
      }
      
      // Check profile
      const profileRes = await fetch("/api/speaker/profile", { credentials: "include" });
      if (profileRes.ok) {
        const data = await profileRes.json();
        setHasProfile(data.enrolled);
        setSampleCount(data.sample_count || 0);
      }
    } catch (error) {
      setServiceAvailable(false);
    }
    setIsCheckingProfile(false);
  }, []);

  // Initial check
  useState(() => {
    checkStatus();
  });

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000 
        } 
      });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4"
      });
      
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          await uploadSample(blob);
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingProgress(0);
      
      // Progress animation
      const startTime = Date.now();
      progressIntervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / RECORDING_DURATION) * 100, 100);
        setRecordingProgress(progress);
      }, 50);
      
      // Auto-stop after duration
      setTimeout(() => {
        stopRecording();
      }, RECORDING_DURATION);
      
    } catch (error: any) {
      console.error("Failed to start recording:", error);
      toast({
        title: "Erreur micro",
        description: "Impossible d'accéder au microphone",
        variant: "destructive",
      });
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingProgress(0);
  }, []);

  const uploadSample = async (blob: Blob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append("audio", blob, "voice_sample.webm");
      
      const response = await fetch("/api/speaker/enroll", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Enrollment failed");
      }
      
      const data = await response.json();
      setSampleCount(data.sample_count);
      setHasProfile(true);
      setCurrentPhrase((prev) => (prev + 1) % enrollmentPhrases.length);
      
      toast({
        title: "Échantillon enregistré",
        description: `${data.sample_count}/${MIN_SAMPLES} échantillons`,
      });
      
      if (data.sample_count >= MIN_SAMPLES) {
        toast({
          title: "Profil vocal complet",
          description: "Ulysse peut maintenant reconnaître ta voix",
        });
        onComplete?.();
      }
      
    } catch (error: any) {
      console.error("Upload failed:", error);
      toast({
        title: "Erreur",
        description: error.message || "Échec de l'enregistrement",
        variant: "destructive",
      });
    }
    setIsProcessing(false);
  };

  const deleteProfile = async () => {
    try {
      const response = await fetch("/api/speaker/profile", {
        method: "DELETE",
        credentials: "include",
      });
      
      if (response.ok) {
        setSampleCount(0);
        setHasProfile(false);
        setCurrentPhrase(0);
        toast({
          title: "Profil supprimé",
          description: "Tu devras réenregistrer ta voix",
        });
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer le profil",
        variant: "destructive",
      });
    }
  };

  if (isCheckingProfile) {
    return (
      <Card className={cn("w-full max-w-md", className)}>
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (serviceAvailable === false) {
    return (
      <Card className={cn("w-full max-w-md", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <X className="w-5 h-5" />
            Service indisponible
          </CardTitle>
          <CardDescription>
            Le service de reconnaissance vocale n'est pas démarré.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const progress = (sampleCount / MIN_SAMPLES) * 100;
  const isComplete = sampleCount >= MIN_SAMPLES;

  return (
    <Card className={cn("w-full max-w-md", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="w-5 h-5" />
          Reconnaissance vocale
        </CardTitle>
        <CardDescription>
          {isComplete
            ? `Ton profil vocal est configuré. ${user?.isOwner ? "Ulysse" : "Iris"} te reconnaît.`
            : `Enregistre ${MIN_SAMPLES} échantillons de ta voix pour qu'${user?.isOwner ? "Ulysse" : "Iris"} te reconnaisse.`}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progression</span>
            <span className={cn(
              "font-medium",
              isComplete ? "text-green-500" : "text-foreground"
            )}>
              {sampleCount}/{MIN_SAMPLES} échantillons
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Phrase to read */}
        {!isComplete && (
          <div className="p-4 bg-muted/50 rounded-lg text-center">
            <p className="text-sm text-muted-foreground mb-1">Lis cette phrase :</p>
            <p className="text-lg font-medium">"{enrollmentPhrases[currentPhrase]}"</p>
          </div>
        )}

        {/* Recording indicator */}
        <AnimatePresence>
          {isRecording && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="relative">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="w-16 h-16 rounded-full bg-red-500/20 absolute inset-0"
                />
                <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center relative">
                  <Mic className="w-8 h-8 text-white" />
                </div>
              </div>
              <Progress value={recordingProgress} className="h-1 w-32" />
              <p className="text-sm text-muted-foreground">Enregistrement...</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recording button */}
        {!isComplete && (
          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
              className={cn(
                "h-14 px-8 gap-2",
                isRecording && "bg-red-500 hover:bg-red-600"
              )}
              data-testid="button-record-voice"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Traitement...
                </>
              ) : isRecording ? (
                <>
                  <MicOff className="w-5 h-5" />
                  Arrêter
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  Enregistrer
                </>
              )}
            </Button>
          </div>
        )}

        {/* Success state */}
        {isComplete && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-center text-muted-foreground">
              Profil vocal configuré avec {sampleCount} échantillons
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-4 border-t">
          {hasProfile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteProfile}
              className="text-destructive hover:text-destructive gap-1"
              data-testid="button-delete-voice-profile"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer
            </Button>
          )}
          
          {isComplete && !isRecording && (
            <Button
              variant="outline"
              size="sm"
              onClick={startRecording}
              disabled={isProcessing}
              className="gap-1 ml-auto"
              data-testid="button-add-sample"
            >
              <Mic className="w-4 h-4" />
              Ajouter un échantillon
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
