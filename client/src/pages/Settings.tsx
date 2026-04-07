import { PageContainer } from "@/components/layout/PageContainer";
import { BiometricSettings } from "@/components/BiometricSettings";
import { CameraSettings } from "@/components/CameraSettings";
import { VoiceEnrollment } from "@/components/VoiceEnrollment";
import { UserManagement } from "@/components/UserManagement";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { User, Shield, Palette, Calendar, RefreshCw } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();

  if (!user) {
    return (
      <PageContainer title="Paramètres">
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Paramètres">
      <div className="max-w-4xl mx-auto space-y-8 pb-8">
        <div>
          <h1 className="text-3xl font-bold">Paramètres</h1>
          <p className="text-muted-foreground mt-2">
            Gérez vos préférences et la sécurité de votre compte
          </p>
        </div>

        <Separator />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profil
            </CardTitle>
            <CardDescription>Informations de votre compte</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Nom d'utilisateur</p>
                <p className="font-medium">{user.username}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nom affiché</p>
                <p className="font-medium">{user.displayName || user.username}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Rôle</p>
                <p className="font-medium capitalize">{user.role}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Assistant IA</p>
                <p className="font-medium">{user.isOwner ? "Ulysse" : "Iris"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {user.isOwner && <UserManagement />}

        {user.isOwner && (
          <BiometricSettings userId={user.id} userName={user.displayName || user.username} />
        )}

        {/* Voice enrollment available for owner and approved users (daughters) */}
        <VoiceEnrollment />

        {user.isOwner && (
          <CameraSettings userId={user.id} />
        )}


      </div>
    </PageContainer>
  );
}
