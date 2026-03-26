import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Volume2, Mic, RefreshCw, CheckCircle, AlertCircle, Loader2, Play, Square } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { VoicePermissionAlert } from "./VoicePermissionAlert";

interface VoiceSettings {
  id: number;
  userId: number;
  ttsVoice: string;
  ttsSpeed: number;
  ttsPitch: string;
  ttsAutoSpeak: boolean;
  ttsMaxLength: number;
  sttMode: string;
  sttLanguage: string;
  sttWakeWordEnabled: boolean;
  preferBrowserFallback: boolean;
  voiceFeedbackEnabled: boolean;
}

interface VoiceDiagnostic {
  platform: string;
  tts: {
    openaiAvailable: boolean;
    browserFallbackAvailable: boolean;
    preferredVoice: string;
    speed: number;
  };
  stt: {
    whisperAvailable: boolean;
    browserFallbackAvailable: boolean;
    preferredMode: string;
    language: string;
  };
  user: {
    isOwner: boolean;
    persona: string;
  };
  recommendations: string[];
}

const VOICE_OPTIONS = [
  { value: "onyx", label: "Onyx", description: "Grave, masculin" },
  { value: "alloy", label: "Alloy", description: "Neutre, polyvalent" },
  { value: "echo", label: "Echo", description: "Dynamique, masculin" },
  { value: "fable", label: "Fable", description: "Chaleureux, narration" },
  { value: "nova", label: "Nova", description: "Douce, féminin" },
  { value: "shimmer", label: "Shimmer", description: "Claire, féminin" },
];

const STT_MODES = [
  { value: "auto", label: "Automatique", description: "Choisit le meilleur mode selon l'appareil" },
  { value: "push-to-talk", label: "Appuyer pour parler", description: "Maintenez le bouton pour enregistrer" },
  { value: "continuous", label: "Continu", description: "Écoute permanente avec wake word" },
];

interface VoiceSettingsPanelProps {
  trigger?: React.ReactNode;
}

export function VoiceSettingsPanel({ trigger }: VoiceSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [testingTTS, setTestingTTS] = useState(false);
  const [testingSTT, setTestingSTT] = useState(false);
  const [sttResult, setSttResult] = useState<string>("");
  const [showPermissionAlert, setShowPermissionAlert] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const testTTS = useCallback(async () => {
    setTestingTTS(true);
    try {
      const testPhrase = "Bonjour, je suis votre assistant vocal. Ceci est un test.";
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testPhrase }),
      });
      
      if (!response.ok) {
        // Try browser fallback
        const utterance = new SpeechSynthesisUtterance(testPhrase);
        utterance.lang = "fr-FR";
        utterance.onend = () => setTestingTTS(false);
        utterance.onerror = () => {
          setTestingTTS(false);
          toast({ title: "Test TTS", description: "Synthèse vocale navigateur utilisée", variant: "default" });
        };
        speechSynthesis.speak(utterance);
        return;
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => {
        setTestingTTS(false);
        URL.revokeObjectURL(url);
      };
      audioRef.current.onerror = () => {
        setTestingTTS(false);
        URL.revokeObjectURL(url);
      };
      await audioRef.current.play();
      toast({ title: "Test TTS", description: "Lecture en cours..." });
    } catch (err) {
      setTestingTTS(false);
      toast({ title: "Erreur TTS", description: "Impossible de tester la synthèse vocale", variant: "destructive" });
    }
  }, [toast]);

  const stopTTS = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    speechSynthesis.cancel();
    setTestingTTS(false);
  }, []);

  const testSTT = useCallback(() => {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      toast({ title: "STT non disponible", description: "Votre navigateur ne supporte pas la reconnaissance vocale", variant: "destructive" });
      return;
    }

    setTestingSTT(true);
    setSttResult("");
    
    const recognition = new SpeechRecognitionClass();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setSttResult(transcript);
    };

    recognition.onend = () => {
      setTestingSTT(false);
    };

    recognition.onerror = (event: Event & { error?: string }) => {
      setTestingSTT(false);
      const errorType = event.error || "unknown";
      if (errorType === "not-allowed") {
        setShowPermissionAlert(true);
        toast({ title: "Permission refusée", description: "Autorisez l'accès au micro dans les paramètres", variant: "destructive" });
      } else if (errorType !== "aborted") {
        toast({ title: "Erreur STT", description: `Erreur: ${errorType}`, variant: "destructive" });
      }
    };

    try {
      recognition.start();
      toast({ title: "Test STT", description: "Parlez maintenant..." });
      // Auto stop after 5 seconds
      setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, 5000);
    } catch (err) {
      setTestingSTT(false);
      toast({ title: "Erreur", description: "Impossible de démarrer la reconnaissance vocale", variant: "destructive" });
    }
  }, [toast]);

  const stopSTT = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setTestingSTT(false);
  }, []);

  const { data: settings, isLoading: settingsLoading } = useQuery<VoiceSettings>({
    queryKey: ["/api/voice-settings"],
    enabled: open,
  });

  const { data: diagnostic, isLoading: diagnosticLoading, refetch: refetchDiagnostic } = useQuery<VoiceDiagnostic>({
    queryKey: ["/api/voice-diagnostic"],
    enabled: open,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<VoiceSettings>) => {
      const response = await apiRequest("PATCH", "/api/voice-settings", updates);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voice-settings"] });
      toast({
        title: "Paramètres sauvegardés",
        description: "Vos préférences vocales ont été mises à jour.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: "Impossible de sauvegarder les paramètres.",
        variant: "destructive",
      });
    },
  });

  const handleUpdate = (key: keyof VoiceSettings, value: any) => {
    updateMutation.mutate({ [key]: value });
  };

  const isLoading = settingsLoading || updateMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" data-testid="button-voice-settings">
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Volume2 className="h-4 w-4" />
            Profil Vocal
          </SheetTitle>
          <SheetDescription className="text-xs">
            Personnalisez la voix d'{diagnostic?.user?.persona || "Ulysse"} et vos préférences de reconnaissance vocale.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-3">
          {/* TTS Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Volume2 className="h-4 w-4" />
                Synthèse Vocale (TTS)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Voice Selection */}
              <div className="space-y-2">
                <Label>Voix</Label>
                <Select
                  value={settings?.ttsVoice || "onyx"}
                  onValueChange={(value) => handleUpdate("ttsVoice", value)}
                  disabled={isLoading}
                >
                  <SelectTrigger data-testid="select-voice">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_OPTIONS.map((voice) => (
                      <SelectItem key={voice.value} value={voice.value}>
                        <div className="flex flex-col">
                          <span>{voice.label}</span>
                          <span className="text-xs text-muted-foreground">{voice.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Speed Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Vitesse</Label>
                  <span className="text-sm text-muted-foreground">{settings?.ttsSpeed || 100}%</span>
                </div>
                <Slider
                  value={[settings?.ttsSpeed || 100]}
                  onValueChange={([value]) => handleUpdate("ttsSpeed", value)}
                  min={50}
                  max={200}
                  step={10}
                  disabled={isLoading}
                  data-testid="slider-speed"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Lent</span>
                  <span>Normal</span>
                  <span>Rapide</span>
                </div>
              </div>

              {/* Auto Speak */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Réponse vocale auto</Label>
                  <p className="text-xs text-muted-foreground">Lit automatiquement les réponses</p>
                </div>
                <Switch
                  checked={settings?.ttsAutoSpeak ?? true}
                  onCheckedChange={(checked) => handleUpdate("ttsAutoSpeak", checked)}
                  disabled={isLoading}
                  data-testid="switch-auto-speak"
                />
              </div>
            </CardContent>
          </Card>

          {/* STT Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mic className="h-4 w-4" />
                Reconnaissance Vocale (STT)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode Selection */}
              <div className="space-y-2">
                <Label>Mode d'écoute</Label>
                <Select
                  value={settings?.sttMode || "auto"}
                  onValueChange={(value) => handleUpdate("sttMode", value)}
                  disabled={isLoading}
                >
                  <SelectTrigger data-testid="select-stt-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STT_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        <div className="flex flex-col">
                          <span>{mode.label}</span>
                          <span className="text-xs text-muted-foreground">{mode.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Wake Word */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Mot de réveil</Label>
                  <p className="text-xs text-muted-foreground">"Hey {diagnostic?.user?.persona || "Ulysse"}" pour activer</p>
                </div>
                <Switch
                  checked={settings?.sttWakeWordEnabled ?? true}
                  onCheckedChange={(checked) => handleUpdate("sttWakeWordEnabled", checked)}
                  disabled={isLoading}
                  data-testid="switch-wake-word"
                />
              </div>

              {/* Voice Feedback */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Retour sonore</Label>
                  <p className="text-xs text-muted-foreground">Sons de confirmation</p>
                </div>
                <Switch
                  checked={settings?.voiceFeedbackEnabled ?? true}
                  onCheckedChange={(checked) => handleUpdate("voiceFeedbackEnabled", checked)}
                  disabled={isLoading}
                  data-testid="switch-voice-feedback"
                />
              </div>
            </CardContent>
          </Card>

          {/* Diagnostic Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Diagnostic Voix</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetchDiagnostic()}
                  disabled={diagnosticLoading}
                  data-testid="button-refresh-diagnostic"
                >
                  <RefreshCw className={`h-4 w-4 ${diagnosticLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {diagnosticLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : diagnostic ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">TTS OpenAI</span>
                    {diagnostic.tts.openaiAvailable ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Disponible
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Navigateur
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">STT Whisper</span>
                    {diagnostic.stt.whisperAvailable ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Disponible
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Navigateur
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Persona</span>
                    <Badge variant="default">{diagnostic.user.persona}</Badge>
                  </div>
                  {diagnostic.recommendations.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-1">Recommandations:</p>
                      {diagnostic.recommendations.map((rec, i) => (
                        <p key={i} className="text-xs">{rec}</p>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* Test Voice Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tester la Voix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* TTS Test */}
              <div className="space-y-2">
                <Label>Synthèse Vocale</Label>
                <div className="flex gap-2">
                  {testingTTS ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={stopTTS}
                      className="flex-1"
                      data-testid="button-stop-tts-test"
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Arrêter
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testTTS}
                      className="flex-1"
                      data-testid="button-test-tts"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Tester TTS
                    </Button>
                  )}
                </div>
              </div>

              {/* STT Test */}
              <div className="space-y-2">
                <Label>Reconnaissance Vocale</Label>
                <div className="flex gap-2">
                  {testingSTT ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={stopSTT}
                      className="flex-1"
                      data-testid="button-stop-stt-test"
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Arrêter
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testSTT}
                      className="flex-1"
                      data-testid="button-test-stt"
                    >
                      <Mic className="h-4 w-4 mr-2" />
                      Tester STT
                    </Button>
                  )}
                </div>
                {sttResult && (
                  <div className="p-2 bg-muted rounded-md">
                    <p className="text-xs text-muted-foreground">Résultat:</p>
                    <p className="text-sm">{sttResult}</p>
                  </div>
                )}
                {showPermissionAlert && (
                  <VoicePermissionAlert 
                    type="mic" 
                    onRetry={() => {
                      setShowPermissionAlert(false);
                      testSTT();
                    }} 
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
