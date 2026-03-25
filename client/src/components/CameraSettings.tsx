import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Camera, Plus, Trash2, Settings, Wifi, WifiOff, Video, Eye, Bell, RefreshCw } from "lucide-react";

interface SurveillanceCamera {
  id: number;
  name: string;
  location?: string;
  cameraType: string;
  streamUrl?: string;
  snapshotUrl?: string;
  ipAddress?: string;
  port?: number;
  protocol: string;
  resolution?: string;
  hasMotionDetection: boolean;
  hasFaceRecognition: boolean;
  isOnline: boolean;
  notifyOnMotion: boolean;
  notifyOnPerson: boolean;
  isActive: boolean;
  serialNumber?: string;
  channelNumber?: number;
  nvrIpAddress?: string;
}

interface AddCameraForm {
  name: string;
  location: string;
  cameraType: string;
  ipAddress: string;
  port: string;
  protocol: string;
  streamUrl: string;
  snapshotUrl: string;
  username: string;
  password: string;
  hasMotionDetection: boolean;
  hasFaceRecognition: boolean;
  notifyOnMotion: boolean;
  notifyOnPerson: boolean;
  serialNumber: string;
  channelNumber: string;
  nvrIpAddress: string;
}

const defaultFormValues: AddCameraForm = {
  name: "",
  location: "",
  cameraType: "ip",
  ipAddress: "",
  port: "554",
  protocol: "rtsp",
  streamUrl: "",
  snapshotUrl: "",
  username: "",
  password: "",
  hasMotionDetection: false,
  hasFaceRecognition: false,
  notifyOnMotion: true,
  notifyOnPerson: true,
  serialNumber: "",
  channelNumber: "1",
  nvrIpAddress: "",
};

export function CameraSettings({ userId }: { userId: number }) {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<SurveillanceCamera | null>(null);
  const [form, setForm] = useState<AddCameraForm>(defaultFormValues);

  const { data: cameras, isLoading } = useQuery<SurveillanceCamera[]>({
    queryKey: ["/api/v2/cameras"],
  });

  const addCamera = useMutation({
    mutationFn: async (data: Partial<AddCameraForm>) => {
      return apiRequest("POST", "/api/v2/cameras", {
        ...data,
        port: data.port ? parseInt(data.port) : 554,
        // Password sent as plaintext, encrypted server-side
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/cameras"] });
      setIsAddOpen(false);
      setForm(defaultFormValues);
      toast({ title: "Caméra ajoutée", description: "La caméra a été configurée avec succès" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'ajouter la caméra", variant: "destructive" });
    },
  });

  const updateCamera = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<AddCameraForm> }) => {
      // Only include password if user provided a new one
      const payload = {
        ...data,
        port: data.port ? parseInt(data.port) : undefined,
      };
      // Remove empty password to avoid overwriting with empty string
      if (!payload.password) {
        delete payload.password;
      }
      return apiRequest("PATCH", `/api/v2/cameras/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/cameras"] });
      setEditingCamera(null);
      toast({ title: "Caméra mise à jour" });
    },
  });

  const deleteCamera = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/v2/cameras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/cameras"] });
      toast({ title: "Caméra supprimée" });
    },
  });

  const checkStatus = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/v2/cameras/${id}/check`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/cameras"] });
    },
  });

  const handleSubmit = () => {
    if (!form.name) {
      toast({ title: "Nom requis", variant: "destructive" });
      return;
    }
    addCamera.mutate(form);
  };

  const openEditDialog = (camera: SurveillanceCamera) => {
    setEditingCamera(camera);
    setForm({
      name: camera.name,
      location: camera.location || "",
      cameraType: camera.cameraType,
      ipAddress: camera.ipAddress || "",
      port: String(camera.port || 554),
      protocol: camera.protocol,
      streamUrl: camera.streamUrl || "",
      snapshotUrl: camera.snapshotUrl || "",
      username: "",
      password: "",
      hasMotionDetection: camera.hasMotionDetection,
      hasFaceRecognition: camera.hasFaceRecognition,
      notifyOnMotion: camera.notifyOnMotion,
      notifyOnPerson: camera.notifyOnPerson,
      serialNumber: camera.serialNumber || "",
      channelNumber: String(camera.channelNumber || 1),
      nvrIpAddress: camera.nvrIpAddress || "",
    });
  };

  return (
    <Card data-testid="card-camera-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          Caméras de Surveillance
        </CardTitle>
        <CardDescription>
          Configure tes caméras pour qu'Ulysse puisse les surveiller
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : cameras && cameras.length > 0 ? (
          <div className="space-y-3">
            {cameras.map((camera) => (
              <div
                key={camera.id}
                data-testid={`camera-item-${camera.id}`}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-muted">
                    <Video className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{camera.name}</span>
                      {camera.isOnline ? (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          <Wifi className="h-3 w-3 mr-1" />
                          En ligne
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-red-600 border-red-600">
                          <WifiOff className="h-3 w-3 mr-1" />
                          Hors ligne
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {camera.location || camera.ipAddress || "Non configuré"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {camera.hasFaceRecognition && (
                    <span title="Reconnaissance faciale">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                  {camera.notifyOnMotion && (
                    <span title="Notifications mouvement">
                      <Bell className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => checkStatus.mutate(camera.id)}
                    disabled={checkStatus.isPending}
                    data-testid={`button-check-camera-${camera.id}`}
                  >
                    <RefreshCw className={`h-4 w-4 ${checkStatus.isPending ? "animate-spin" : ""}`} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEditDialog(camera)}
                    data-testid={`button-edit-camera-${camera.id}`}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteCamera.mutate(camera.id)}
                    data-testid={`button-delete-camera-${camera.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune caméra configurée. Ajoute ta première caméra pour commencer.
          </p>
        )}

        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="w-full" data-testid="button-add-camera">
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une caméra
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Nouvelle caméra</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nom de la caméra *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: Entrée principale"
                    data-testid="input-camera-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="location">Emplacement</Label>
                  <Input
                    id="location"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="Ex: Porte d'entrée"
                    data-testid="input-camera-location"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Type</Label>
                    <Select value={form.cameraType} onValueChange={(v) => setForm({ ...form, cameraType: v })}>
                      <SelectTrigger data-testid="select-camera-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ip">Caméra IP</SelectItem>
                        <SelectItem value="rtsp">RTSP</SelectItem>
                        <SelectItem value="onvif">ONVIF</SelectItem>
                        <SelectItem value="homekit">HomeKit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Protocole</Label>
                    <Select value={form.protocol} onValueChange={(v) => setForm({ ...form, protocol: v })}>
                      <SelectTrigger data-testid="select-camera-protocol">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rtsp">RTSP</SelectItem>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="https">HTTPS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="ipAddress">Adresse IP</Label>
                    <Input
                      id="ipAddress"
                      value={form.ipAddress}
                      onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
                      placeholder="192.168.1.100"
                      data-testid="input-camera-ip"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="port">Port</Label>
                    <Input
                      id="port"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: e.target.value })}
                      placeholder="554"
                      data-testid="input-camera-port"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="streamUrl">URL du flux (optionnel)</Label>
                  <Input
                    id="streamUrl"
                    value={form.streamUrl}
                    onChange={(e) => setForm({ ...form, streamUrl: e.target.value })}
                    placeholder="rtsp://192.168.1.100:554/stream"
                    data-testid="input-camera-stream"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="username">Utilisateur</Label>
                    <Input
                      id="username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="admin"
                      data-testid="input-camera-username"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password">Mot de passe</Label>
                    <Input
                      id="password"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      data-testid="input-camera-password"
                    />
                  </div>
                </div>
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="motionDetection">Détection de mouvement</Label>
                    <Switch
                      id="motionDetection"
                      checked={form.hasMotionDetection}
                      onCheckedChange={(v) => setForm({ ...form, hasMotionDetection: v })}
                      data-testid="switch-motion-detection"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="faceRecognition">Reconnaissance faciale</Label>
                    <Switch
                      id="faceRecognition"
                      checked={form.hasFaceRecognition}
                      onCheckedChange={(v) => setForm({ ...form, hasFaceRecognition: v })}
                      data-testid="switch-face-recognition"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="notifyMotion">Notifier sur mouvement</Label>
                    <Switch
                      id="notifyMotion"
                      checked={form.notifyOnMotion}
                      onCheckedChange={(v) => setForm({ ...form, notifyOnMotion: v })}
                      data-testid="switch-notify-motion"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="notifyPerson">Notifier si personne détectée</Label>
                    <Switch
                      id="notifyPerson"
                      checked={form.notifyOnPerson}
                      onCheckedChange={(v) => setForm({ ...form, notifyOnPerson: v })}
                      data-testid="switch-notify-person"
                    />
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Annuler</Button>
              </DialogClose>
              <Button onClick={handleSubmit} disabled={addCamera.isPending} data-testid="button-save-camera">
                {addCamera.isPending ? "Ajout..." : "Ajouter"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {editingCamera && (
          <Dialog open={!!editingCamera} onOpenChange={() => setEditingCamera(null)}>
            <DialogContent className="max-w-lg" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>Modifier {editingCamera.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Nom</Label>
                  <Input
                    id="edit-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-location">Emplacement</Label>
                  <Input
                    id="edit-location"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Reconnaissance faciale</Label>
                    <Switch
                      checked={form.hasFaceRecognition}
                      onCheckedChange={(v) => setForm({ ...form, hasFaceRecognition: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Notifier sur mouvement</Label>
                    <Switch
                      checked={form.notifyOnMotion}
                      onCheckedChange={(v) => setForm({ ...form, notifyOnMotion: v })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingCamera(null)}>Annuler</Button>
                <Button
                  onClick={() => updateCamera.mutate({ id: editingCamera.id, data: form })}
                  disabled={updateCamera.isPending}
                >
                  Enregistrer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
