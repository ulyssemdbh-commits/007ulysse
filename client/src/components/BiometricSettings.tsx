import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FaceEnrollment } from "./FaceEnrollment";
import { FaceRecognitionAuth } from "./FaceRecognitionAuth";
import { Shield, Camera, TestTube, Mic, Fingerprint } from "lucide-react";

interface BiometricSettingsProps {
  userId: number;
  userName: string;
}

export function BiometricSettings({ userId, userName }: BiometricSettingsProps) {
  const [testResult, setTestResult] = useState<{ success: boolean; confidence: number } | null>(null);

  const handleAuthTest = (success: boolean, confidence: number) => {
    setTestResult({ success, confidence });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Fingerprint className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">Authentification Biométrique</h2>
          <p className="text-sm text-muted-foreground">
            Gérez la reconnaissance faciale et vocale pour Ulysse
          </p>
        </div>
      </div>

      <Tabs defaultValue="enroll" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="enroll" className="gap-2">
            <Camera className="h-4 w-4" />
            Enregistrement
          </TabsTrigger>
          <TabsTrigger value="test" className="gap-2">
            <TestTube className="h-4 w-4" />
            Test
          </TabsTrigger>
          <TabsTrigger value="voice" className="gap-2">
            <Mic className="h-4 w-4" />
            Voix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="enroll" className="mt-4">
          <FaceEnrollment
            userId={userId}
            userName={userName}
            onEnrollmentComplete={() => {
              console.log("Enrollment complete");
            }}
          />
        </TabsContent>

        <TabsContent value="test" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Test d'Authentification
              </CardTitle>
              <CardDescription>
                Vérifiez que la reconnaissance faciale fonctionne correctement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FaceRecognitionAuth
                userId={userId}
                userName={userName}
                onAuthenticated={handleAuthTest}
                showPreview={true}
              />
              {testResult && (
                <div className={`mt-4 p-3 rounded-lg ${testResult.success ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950'}`}>
                  <p className={`text-sm ${testResult.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                    {testResult.success 
                      ? `Test réussi avec ${(testResult.confidence * 100).toFixed(0)}% de confiance`
                      : "Test échoué - visage non reconnu"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voice" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Reconnaissance Vocale
              </CardTitle>
              <CardDescription>
                La reconnaissance vocale est déjà active via Web Speech API
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-2">Fonctionnalités actives</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Speech-to-Text: Web Speech API (français)</li>
                  <li>• Text-to-Speech: OpenAI TTS</li>
                  <li>• Détection de silence automatique</li>
                  <li>• Support iOS et Android</li>
                </ul>
              </div>
              <div className="p-4 bg-primary/10 rounded-lg">
                <h4 className="font-medium mb-2 text-primary">Comment utiliser</h4>
                <p className="text-sm text-muted-foreground">
                  Cliquez sur le bouton microphone dans l'interface Ulysse pour activer 
                  la reconnaissance vocale. Parlez naturellement et Ulysse transcrira 
                  automatiquement votre message.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
