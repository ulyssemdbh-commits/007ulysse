import { useState, useMemo } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Home, 
  Lightbulb, 
  Plus, 
  Trash2, 
  Edit2, 
  Power, 
  Sun, 
  Thermometer,
  Smartphone,
  Bot,
  RefreshCw,
  Check,
  X,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  LucideIcon,
  Settings,
  Activity
} from "lucide-react";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SmartDevice {
  id: number;
  name: string;
  type: string;
  room?: string;
  vendor?: string;
  capabilities: string[];
  state: Record<string, any>;
  isActive: boolean;
  lastStateAt?: string;
}

interface SmartScene {
  id: number;
  name: string;
  description?: string;
  icon: string;
  color: string;
  actions: Array<{ deviceId: number; action: string; params: Record<string, any> }>;
  trigger: string;
  isActive: boolean;
  lastActivatedAt?: string;
}

interface SiriWebhook {
  id: number;
  name: string;
  phrase: string;
  action: string;
  actionTarget: string;
  webhookToken: string;
  isActive: boolean;
  lastTriggeredAt?: string;
  triggerCount: number;
}

interface ProactiveSuggestion {
  id: number;
  type: string;
  title: string;
  description: string;
  confidence: number;
  status: string;
  suggestedAction: Record<string, any>;
  createdAt: string;
}

interface BehaviorPattern {
  pattern: string;
  occurrences: number;
  confidence: number;
  type: string;
  lastSeen?: string;
}

const DEVICE_TYPES = [
  { value: "light", label: "Lumière", icon: Lightbulb },
  { value: "switch", label: "Interrupteur", icon: Power },
  { value: "thermostat", label: "Thermostat", icon: Thermometer },
  { value: "blind", label: "Store", icon: Sun },
  { value: "plug", label: "Prise", icon: Power },
  { value: "sensor", label: "Capteur", icon: Activity },
  { value: "lock", label: "Serrure", icon: Home },
];

const VENDORS = [
  { value: "philips_hue", label: "Philips Hue" },
  { value: "homekit", label: "HomeKit" },
  { value: "netatmo", label: "Netatmo" },
  { value: "tuya", label: "Tuya" },
  { value: "custom", label: "Personnalisé" },
];

const WEBHOOK_ACTIONS = [
  { value: "toggle_device", label: "Allumer/Éteindre appareil" },
  { value: "activate_scene", label: "Activer scène" },
  { value: "set_brightness", label: "Régler luminosité" },
  { value: "set_temperature", label: "Régler température" },
];

interface SmartHomeSettingsProps {
  trigger?: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SmartHomeSettings({ trigger, isOpen, onOpenChange }: SmartHomeSettingsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;
  const [activeTab, setActiveTab] = useState<"devices" | "scenes" | "siri" | "suggestions">("devices");
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [showSceneForm, setShowSceneForm] = useState(false);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState<SmartDevice | null>(null);
  const [editingScene, setEditingScene] = useState<SmartScene | null>(null);
  const [editingWebhook, setEditingWebhook] = useState<SiriWebhook | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: devices = [], isLoading: devicesLoading } = useQuery<SmartDevice[]>({
    queryKey: ["/api/v2/smart-home/devices"],
    enabled: open,
  });

  const { data: scenes = [], isLoading: scenesLoading } = useQuery<SmartScene[]>({
    queryKey: ["/api/v2/smart-home/scenes"],
    enabled: open,
  });

  const { data: webhooks = [], isLoading: webhooksLoading } = useQuery<SiriWebhook[]>({
    queryKey: ["/api/v2/siri/webhooks"],
    enabled: open,
  });

  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery<ProactiveSuggestion[]>({
    queryKey: ["/api/v2/behavior/suggestions"],
    enabled: open,
  });

  const { data: patterns = [], isLoading: patternsLoading } = useQuery<BehaviorPattern[]>({
    queryKey: ["/api/v2/behavior/patterns"],
    enabled: open && activeTab === "suggestions",
  });

  const deviceStats = useMemo(() => {
    const active = devices.filter(d => d.isActive).length;
    const byRoom = devices.reduce((acc, d) => {
      const room = d.room || "Non assigné";
      acc[room] = (acc[room] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return { total: devices.length, active, byRoom };
  }, [devices]);

  const defaultTrigger = (
    <Button variant="ghost" size="sm" data-testid="button-smart-home-settings">
      <Home className="h-4 w-4 mr-2" />
      <span>Domotique</span>
    </Button>
  );

  const isControlled = isOpen !== undefined;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <SheetTrigger asChild>
          {trigger || defaultTrigger}
        </SheetTrigger>
      )}
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Home className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Maison Connectée
          </SheetTitle>
          <SheetDescription>
            Gérez vos appareils, scènes, raccourcis Siri et suggestions
          </SheetDescription>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col overflow-hidden mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="devices" className="text-xs" data-testid="tab-devices">
              <Lightbulb className="h-3.5 w-3.5 mr-1" />
              Appareils
            </TabsTrigger>
            <TabsTrigger value="scenes" className="text-xs" data-testid="tab-scenes">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Scènes
            </TabsTrigger>
            <TabsTrigger value="siri" className="text-xs" data-testid="tab-siri">
              <Smartphone className="h-3.5 w-3.5 mr-1" />
              Siri
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="text-xs" data-testid="tab-suggestions">
              <Bot className="h-3.5 w-3.5 mr-1" />
              IA
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <TabsContent value="devices" className="mt-0 space-y-4">
              <DevicesTab 
                devices={devices} 
                loading={devicesLoading}
                stats={deviceStats}
                onEdit={(d) => { setEditingDevice(d); setShowDeviceForm(true); }}
                onAdd={() => { setEditingDevice(null); setShowDeviceForm(true); }}
              />
            </TabsContent>

            <TabsContent value="scenes" className="mt-0 space-y-4">
              <ScenesTab 
                scenes={scenes}
                devices={devices}
                loading={scenesLoading}
                onEdit={(s) => { setEditingScene(s); setShowSceneForm(true); }}
                onAdd={() => { setEditingScene(null); setShowSceneForm(true); }}
              />
            </TabsContent>

            <TabsContent value="siri" className="mt-0 space-y-4">
              <SiriTab 
                webhooks={webhooks}
                devices={devices}
                scenes={scenes}
                loading={webhooksLoading}
                revealedSecrets={revealedSecrets}
                onRevealSecret={(id) => setRevealedSecrets(prev => new Set(prev).add(id))}
                onEdit={(w) => { setEditingWebhook(w); setShowWebhookForm(true); }}
                onAdd={() => { setEditingWebhook(null); setShowWebhookForm(true); }}
              />
            </TabsContent>

            <TabsContent value="suggestions" className="mt-0 space-y-4">
              <SuggestionsTab 
                suggestions={suggestions}
                patterns={patterns}
                loading={suggestionsLoading || patternsLoading}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DeviceFormDialog 
          open={showDeviceForm} 
          onOpenChange={setShowDeviceForm}
          device={editingDevice}
        />
        
        <SceneFormDialog 
          open={showSceneForm} 
          onOpenChange={setShowSceneForm}
          scene={editingScene}
          devices={devices}
        />
        
        <WebhookFormDialog 
          open={showWebhookForm} 
          onOpenChange={setShowWebhookForm}
          webhook={editingWebhook}
          devices={devices}
          scenes={scenes}
        />
      </SheetContent>
    </Sheet>
  );
}

function DevicesTab({ 
  devices, 
  loading, 
  stats,
  onEdit, 
  onAdd 
}: { 
  devices: SmartDevice[]; 
  loading: boolean;
  stats: { total: number; active: number; byRoom: Record<string, number> };
  onEdit: (d: SmartDevice) => void;
  onAdd: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const toggleDevice = useMutation({
    mutationFn: async ({ deviceId, on }: { deviceId: number; on: boolean }) => {
      await apiRequest("POST", "/api/v2/smart-home/actions", {
        deviceId,
        action: { type: "toggle", on },
        source: "ui",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/smart-home/devices"] });
      toast({ title: "Appareil mis à jour" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de contrôler l'appareil", variant: "destructive" });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v2/smart-home/devices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/smart-home/devices"] });
      toast({ title: "Appareil supprimé" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Badge variant="secondary">{stats.total} appareils</Badge>
          <Badge variant="outline" className="text-green-600 dark:text-green-400">{stats.active} actifs</Badge>
        </div>
        <Button size="sm" onClick={onAdd} data-testid="button-add-device">
          <Plus className="h-4 w-4 mr-1" />
          Ajouter
        </Button>
      </div>

      {devices.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Home className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Aucun appareil configuré</p>
            <p className="text-sm mt-1">Ajoutez votre premier appareil connecté</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {devices.map((device) => {
            const TypeIcon = DEVICE_TYPES.find(t => t.value === device.type)?.icon || Lightbulb;
            const isOn = device.state?.on === true;
            
            return (
              <Card key={device.id} className={cn(
                "transition-colors",
                !device.isActive && "opacity-60"
              )}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      isOn ? "bg-amber-500/20 text-amber-400 dark:text-amber-300" : "bg-muted text-muted-foreground"
                    )}>
                      <TypeIcon className="h-5 w-5" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{device.name}</span>
                        {device.room && (
                          <Badge variant="outline" className="text-xs">{device.room}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {DEVICE_TYPES.find(t => t.value === device.type)?.label}
                        {device.vendor && ` • ${VENDORS.find(v => v.value === device.vendor)?.label}`}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Switch
                        checked={isOn}
                        onCheckedChange={(checked) => toggleDevice.mutate({ deviceId: device.id, on: checked })}
                        disabled={toggleDevice.isPending}
                        data-testid={`switch-device-${device.id}`}
                      />
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => onEdit(device)}
                        data-testid={`button-edit-device-${device.id}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive"
                        onClick={() => deleteDevice.mutate(device.id)}
                        disabled={deleteDevice.isPending}
                        data-testid={`button-delete-device-${device.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScenesTab({ 
  scenes, 
  devices,
  loading, 
  onEdit, 
  onAdd 
}: { 
  scenes: SmartScene[]; 
  devices: SmartDevice[];
  loading: boolean;
  onEdit: (s: SmartScene) => void;
  onAdd: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const activateScene = useMutation({
    mutationFn: async (sceneId: number) => {
      await apiRequest("POST", "/api/v2/smart-home/scenes/activate", {
        sceneId,
        source: "ui",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/smart-home/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v2/smart-home/scenes"] });
      toast({ title: "Scène activée" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'activer la scène", variant: "destructive" });
    },
  });

  const deleteScene = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v2/smart-home/scenes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/smart-home/scenes"] });
      toast({ title: "Scène supprimée" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{scenes.length} scènes</Badge>
        <Button size="sm" onClick={onAdd} data-testid="button-add-scene">
          <Plus className="h-4 w-4 mr-1" />
          Créer
        </Button>
      </div>

      {scenes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Aucune scène créée</p>
            <p className="text-sm mt-1">Créez des ambiances pour vos appareils</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {scenes.map((scene) => (
            <Card key={scene.id} className={cn(!scene.isActive && "opacity-60")}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div 
                    className="p-2 rounded-lg" 
                    style={{ backgroundColor: `${scene.color}20`, color: scene.color }}
                  >
                    <Sparkles className="h-5 w-5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{scene.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {scene.actions.length} actions • {scene.trigger}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button 
                      variant="secondary" 
                      size="sm"
                      onClick={() => activateScene.mutate(scene.id)}
                      disabled={activateScene.isPending || !scene.isActive}
                      data-testid={`button-activate-scene-${scene.id}`}
                    >
                      {activateScene.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => onEdit(scene)}
                      data-testid={`button-edit-scene-${scene.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteScene.mutate(scene.id)}
                      disabled={deleteScene.isPending}
                      data-testid={`button-delete-scene-${scene.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SiriTab({ 
  webhooks, 
  devices,
  scenes,
  loading,
  revealedSecrets,
  onRevealSecret,
  onEdit, 
  onAdd 
}: { 
  webhooks: SiriWebhook[];
  devices: SmartDevice[];
  scenes: SmartScene[];
  loading: boolean;
  revealedSecrets: Set<number>;
  onRevealSecret: (id: number) => void;
  onEdit: (w: SiriWebhook) => void;
  onAdd: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [fetchingSecret, setFetchingSecret] = useState<number | null>(null);
  const [secrets, setSecrets] = useState<Record<number, string>>({});

  const fetchSecret = async (webhookId: number) => {
    setFetchingSecret(webhookId);
    try {
      const response = await fetch(`/api/v2/siri/webhooks/${webhookId}/secret`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch secret");
      const data = await response.json();
      setSecrets(prev => ({ ...prev, [webhookId]: data.webhookSecret }));
      onRevealSecret(webhookId);
    } catch {
      toast({ title: "Erreur", description: "Impossible de récupérer le secret", variant: "destructive" });
    } finally {
      setFetchingSecret(null);
    }
  };

  const copyToClipboard = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copié" });
  };

  const deleteWebhook = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/v2/siri/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/siri/webhooks"] });
      toast({ title: "Webhook supprimé" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="bg-blue-500/10 dark:bg-blue-400/10 border-blue-500/20 dark:border-blue-400/20">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <Smartphone className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-600 dark:text-blue-400">Raccourcis Siri</p>
              <p className="text-muted-foreground text-xs mt-1">
                Créez des webhooks sécurisés pour contrôler votre maison via Siri. 
                Chaque requête nécessite une signature HMAC-SHA256.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Badge variant="secondary">{webhooks.length} webhooks</Badge>
        <Button size="sm" onClick={onAdd} data-testid="button-add-webhook">
          <Plus className="h-4 w-4 mr-1" />
          Créer
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Smartphone className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Aucun webhook Siri</p>
            <p className="text-sm mt-1">Créez des raccourcis pour vos appareils</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {webhooks.map((webhook) => (
            <Card key={webhook.id} className={cn(!webhook.isActive && "opacity-60")}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{webhook.name}</div>
                    <div className="text-xs text-muted-foreground">
                      "{webhook.phrase}" • {webhook.triggerCount} déclenchements
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => onEdit(webhook)}
                      data-testid={`button-edit-webhook-${webhook.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteWebhook.mutate(webhook.id)}
                      disabled={deleteWebhook.isPending}
                      data-testid={`button-delete-webhook-${webhook.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                      /api/v2/siri/trigger/{webhook.webhookToken}
                    </code>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(`/api/v2/siri/trigger/${webhook.webhookToken}`, webhook.id)}
                      data-testid={`button-copy-url-${webhook.id}`}
                    >
                      {copiedId === webhook.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {revealedSecrets.has(webhook.id) && secrets[webhook.id] ? (
                      <>
                        <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate font-mono">
                          {secrets[webhook.id]}
                        </code>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(secrets[webhook.id], webhook.id + 1000)}
                          data-testid={`button-copy-secret-${webhook.id}`}
                        >
                          {copiedId === webhook.id + 1000 ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </>
                    ) : (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-xs"
                        onClick={() => fetchSecret(webhook.id)}
                        disabled={fetchingSecret === webhook.id}
                        data-testid={`button-reveal-secret-${webhook.id}`}
                      >
                        {fetchingSecret === webhook.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Eye className="h-3 w-3 mr-1" />
                        )}
                        Afficher le secret HMAC
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionsTab({ 
  suggestions, 
  patterns,
  loading 
}: { 
  suggestions: ProactiveSuggestion[];
  patterns: BehaviorPattern[];
  loading: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const respondToSuggestion = useMutation({
    mutationFn: async ({ id, response }: { id: number; response: "accepted" | "rejected" }) => {
      await apiRequest("POST", `/api/v2/behavior/suggestions/${id}/respond`, { response });
    },
    onSuccess: (_, { response }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/behavior/suggestions"] });
      toast({ title: response === "accepted" ? "Suggestion acceptée" : "Suggestion ignorée" });
    },
    onError: () => {
      toast({ title: "Erreur", variant: "destructive" });
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pendingSuggestions = suggestions.filter(s => s.status === "pending");
  const detectedPatterns = patterns.filter(p => p.confidence >= 50);

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Suggestions IA
        </h4>
        
        {pendingSuggestions.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Aucune suggestion pour le moment</p>
              <p className="text-xs mt-1">L'IA analyse vos habitudes</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pendingSuggestions.map((suggestion) => (
              <Card key={suggestion.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-indigo-500/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{suggestion.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {suggestion.description}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">
                          {Math.round(suggestion.confidence)}% confiance
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7 text-green-600 dark:text-green-400"
                        onClick={() => respondToSuggestion.mutate({ id: suggestion.id, response: "accepted" })}
                        disabled={respondToSuggestion.isPending}
                        data-testid={`button-accept-suggestion-${suggestion.id}`}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7 text-destructive"
                        onClick={() => respondToSuggestion.mutate({ id: suggestion.id, response: "rejected" })}
                        disabled={respondToSuggestion.isPending}
                        data-testid={`button-reject-suggestion-${suggestion.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Habitudes détectées
        </h4>
        
        {detectedPatterns.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Pas encore de patterns détectés</p>
              <p className="text-xs mt-1">Utilisez vos appareils pour créer des routines</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {detectedPatterns.map((pattern, idx) => (
              <Card key={idx}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{pattern.pattern}</div>
                      <div className="text-xs text-muted-foreground">
                        {pattern.occurrences}x • {pattern.type}
                      </div>
                    </div>
                    <Badge variant={pattern.confidence >= 70 ? "default" : "secondary"}>
                      {Math.round(pattern.confidence)}%
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceFormDialog({ 
  open, 
  onOpenChange, 
  device 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
  device: SmartDevice | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("light");
  const [room, setRoom] = useState("");
  const [vendor, setVendor] = useState<string | undefined>();
  const [isActive, setIsActive] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isEditing = !!device;

  const resetForm = () => {
    if (device) {
      setName(device.name);
      setType(device.type);
      setRoom(device.room || "");
      setVendor(device.vendor);
      setIsActive(device.isActive);
    } else {
      setName("");
      setType("light");
      setRoom("");
      setVendor(undefined);
      setIsActive(true);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name, type, room: room || undefined, vendor, isActive };
      if (isEditing) {
        await apiRequest("PATCH", `/api/v2/smart-home/devices/${device.id}`, payload);
      } else {
        await apiRequest("POST", "/api/v2/smart-home/devices", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/smart-home/devices"] });
      toast({ title: isEditing ? "Appareil modifié" : "Appareil ajouté" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de sauvegarder", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) resetForm(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Modifier l'appareil" : "Nouvel appareil"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Modifiez les paramètres de l'appareil" : "Ajoutez un nouvel appareil connecté"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Lampe salon"
              data-testid="input-device-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-device-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEVICE_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Pièce (optionnel)</Label>
            <Input 
              value={room} 
              onChange={(e) => setRoom(e.target.value)} 
              placeholder="Salon"
              data-testid="input-device-room"
            />
          </div>

          <div className="space-y-2">
            <Label>Marque (optionnel)</Label>
            <Select value={vendor || ""} onValueChange={(v) => setVendor(v || undefined)}>
              <SelectTrigger data-testid="select-device-vendor">
                <SelectValue placeholder="Sélectionner..." />
              </SelectTrigger>
              <SelectContent>
                {VENDORS.map(v => (
                  <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label>Actif</Label>
            <Switch 
              checked={isActive} 
              onCheckedChange={setIsActive}
              data-testid="switch-device-active"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-device">Annuler</Button>
          <Button 
            onClick={() => saveMutation.mutate()} 
            disabled={!name || saveMutation.isPending}
            data-testid="button-save-device"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? "Modifier" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SceneFormDialog({ 
  open, 
  onOpenChange, 
  scene,
  devices 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
  scene: SmartScene | null;
  devices: SmartDevice[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [trigger, setTrigger] = useState("manual");
  const [isActive, setIsActive] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isEditing = !!scene;

  const resetForm = () => {
    if (scene) {
      setName(scene.name);
      setDescription(scene.description || "");
      setColor(scene.color);
      setTrigger(scene.trigger);
      setIsActive(scene.isActive);
    } else {
      setName("");
      setDescription("");
      setColor("#3B82F6");
      setTrigger("manual");
      setIsActive(true);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name, description: description || undefined, color, trigger, isActive, actions: scene?.actions || [] };
      if (isEditing) {
        await apiRequest("PATCH", `/api/v2/smart-home/scenes/${scene.id}`, payload);
      } else {
        await apiRequest("POST", "/api/v2/smart-home/scenes", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/smart-home/scenes"] });
      toast({ title: isEditing ? "Scène modifiée" : "Scène créée" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de sauvegarder", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) resetForm(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Modifier la scène" : "Nouvelle scène"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Modifiez les paramètres de la scène" : "Créez une nouvelle ambiance"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Nom</Label>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Mode cinéma"
              data-testid="input-scene-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Description (optionnel)</Label>
            <Input 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              placeholder="Ambiance tamisée pour les films"
              data-testid="input-scene-description"
            />
          </div>

          <div className="space-y-2">
            <Label>Couleur</Label>
            <div className="flex gap-2">
              <Input 
                type="color" 
                value={color} 
                onChange={(e) => setColor(e.target.value)}
                className="w-12 h-9 p-1 cursor-pointer"
                data-testid="input-scene-color"
              />
              <Input 
                value={color} 
                onChange={(e) => setColor(e.target.value)}
                className="flex-1 font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Déclencheur</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger data-testid="select-scene-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manuel</SelectItem>
                <SelectItem value="schedule">Programmé</SelectItem>
                <SelectItem value="geofence">Géolocalisation</SelectItem>
                <SelectItem value="siri">Siri</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label>Active</Label>
            <Switch 
              checked={isActive} 
              onCheckedChange={setIsActive}
              data-testid="switch-scene-active"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-scene">Annuler</Button>
          <Button 
            onClick={() => saveMutation.mutate()} 
            disabled={!name || saveMutation.isPending}
            data-testid="button-save-scene"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? "Modifier" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebhookFormDialog({ 
  open, 
  onOpenChange, 
  webhook,
  devices,
  scenes
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
  webhook: SiriWebhook | null;
  devices: SmartDevice[];
  scenes: SmartScene[];
}) {
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [action, setAction] = useState("toggle_device");
  const [actionTarget, setActionTarget] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isEditing = !!webhook;

  const resetForm = () => {
    setCreatedSecret(null);
    if (webhook) {
      setName(webhook.name);
      setPhrase(webhook.phrase);
      setAction(webhook.action);
      setActionTarget(webhook.actionTarget);
      setIsActive(webhook.isActive);
    } else {
      setName("");
      setPhrase("");
      setAction("toggle_device");
      setActionTarget("");
      setIsActive(true);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (): Promise<{ webhookSecret?: string } | null> => {
      const payload = { name, phrase, action, actionTarget, isActive };
      if (isEditing) {
        await apiRequest("PATCH", `/api/v2/siri/webhooks/${webhook.id}`, payload);
        return null;
      } else {
        const response = await apiRequest("POST", "/api/v2/siri/webhooks", payload);
        return await response.json();
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/siri/webhooks"] });
      if (!isEditing && data?.webhookSecret) {
        setCreatedSecret(data.webhookSecret);
        toast({ title: "Webhook créé", description: "Sauvegardez le secret maintenant!" });
      } else {
        toast({ title: isEditing ? "Webhook modifié" : "Webhook créé" });
        onOpenChange(false);
      }
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de sauvegarder", variant: "destructive" });
    },
  });

  const targetOptions = action.includes("scene") 
    ? scenes.map(s => ({ value: String(s.id), label: s.name }))
    : devices.map(d => ({ value: String(d.id), label: d.name }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) resetForm(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Modifier le webhook" : "Nouveau webhook Siri"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Modifiez les paramètres du webhook" : "Créez un raccourci Siri sécurisé"}
          </DialogDescription>
        </DialogHeader>

        {createdSecret ? (
          <div className="space-y-4 py-4">
            <Card className="bg-amber-500/10 border-amber-500/30 dark:bg-amber-400/10 dark:border-amber-400/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Smartphone className="h-5 w-5 text-amber-500 dark:text-amber-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-600 dark:text-amber-400">Secret créé</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Copiez ce secret maintenant. Il ne sera plus affiché automatiquement.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <div className="space-y-2">
              <Label>Secret HMAC (à utiliser dans Raccourcis iOS)</Label>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-muted p-2 rounded font-mono break-all">
                  {createdSecret}
                </code>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(createdSecret);
                    toast({ title: "Secret copié" });
                  }}
                  data-testid="button-copy-new-secret"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <DialogFooter>
              <Button onClick={() => { onOpenChange(false); setCreatedSecret(null); }}>
                Terminé
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="Allumer salon"
                  data-testid="input-webhook-name"
                />
              </div>

              <div className="space-y-2">
                <Label>Phrase Siri</Label>
                <Input 
                  value={phrase} 
                  onChange={(e) => setPhrase(e.target.value)} 
                  placeholder="Allume le salon"
                  data-testid="input-webhook-phrase"
                />
              </div>

              <div className="space-y-2">
                <Label>Action</Label>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger data-testid="select-webhook-action">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEBHOOK_ACTIONS.map(a => (
                      <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Cible</Label>
                <Select value={actionTarget} onValueChange={setActionTarget}>
                  <SelectTrigger data-testid="select-webhook-target">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {targetOptions.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <Label>Actif</Label>
                <Switch 
                  checked={isActive} 
                  onCheckedChange={setIsActive}
                  data-testid="switch-webhook-active"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-webhook">Annuler</Button>
              <Button 
                onClick={() => saveMutation.mutate()} 
                disabled={!name || !phrase || !actionTarget || saveMutation.isPending}
                data-testid="button-save-webhook"
              >
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEditing ? "Modifier" : "Créer"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
