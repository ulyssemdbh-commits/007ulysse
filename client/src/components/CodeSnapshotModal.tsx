import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, Code, Clock, FileCode, Lock, AlertTriangle, Check, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface CodeSnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SnapshotSummary {
  hasSnapshot: boolean;
  version?: string;
  filesCount?: number;
  totalSize?: number;
  keyComponents?: string[];
  createdAt?: string;
}

interface RateLimitStatus {
  canCreate: boolean;
  waitMinutes: number;
}

interface SnapshotInfo {
  id: number;
  version: string;
  summary: string | null;
  filesCount: number;
  createdAt: string | null;
}

export function CodeSnapshotModal({ isOpen, onClose }: CodeSnapshotModalProps) {
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"verify" | "main">("verify");
  const [isVerified, setIsVerified] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: summary, isLoading: summaryLoading } = useQuery<SnapshotSummary>({
    queryKey: ["/api/owner/code-snapshot/summary", pin],
    enabled: isOpen && isVerified && pin.length >= 4,
    queryFn: async () => {
      const res = await fetch("/api/owner/code-snapshot/summary", {
        headers: { "X-Owner-Pin": pin },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: rateLimit } = useQuery<RateLimitStatus>({
    queryKey: ["/api/owner/code-snapshot/rate-limit", pin],
    enabled: isOpen && isVerified && pin.length >= 4,
    refetchInterval: 60000,
    queryFn: async () => {
      const res = await fetch("/api/owner/code-snapshot/rate-limit", {
        headers: { "X-Owner-Pin": pin },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch rate limit");
      return res.json();
    },
  });

  const { data: snapshots } = useQuery<SnapshotInfo[]>({
    queryKey: ["/api/owner/code-snapshots", pin],
    enabled: isOpen && isVerified && pin.length >= 4,
    queryFn: async () => {
      const res = await fetch("/api/owner/code-snapshots", {
        headers: { "X-Owner-Pin": pin },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch snapshots");
      return res.json();
    },
  });

  const createSnapshotMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/owner/code-snapshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Pin": pin,
        },
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create snapshot");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Snapshot capturé",
        description: `Version ${data.snapshot.version} - ${data.snapshot.filesCount} fichiers`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/code-snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/code-snapshots"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleVerify = async () => {
    if (pin.length < 4) {
      toast({
        title: "PIN invalide",
        description: "Le PIN doit contenir au moins 4 chiffres",
        variant: "destructive",
      });
      return;
    }

    try {
      const res = await fetch("/api/owner/code-snapshot/rate-limit", {
        headers: {
          "X-Owner-Pin": pin,
        },
        credentials: "include",
      });

      if (res.ok) {
        setIsVerified(true);
        setStep("main");
      } else {
        toast({
          title: "PIN incorrect",
          description: "Vérification échouée",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Erreur de vérification",
        description: "Impossible de vérifier le PIN",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    setPin("");
    setStep("verify");
    setIsVerified(false);
    onClose();
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Ulysse Code Copy
          </DialogTitle>
          <DialogDescription>
            {step === "verify" 
              ? "Zone sécurisée - Vérification requise"
              : "Capture et analyse du code source"
            }
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === "verify" ? (
            <motion.div
              key="verify"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4 py-4"
            >
              <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                <p className="text-sm text-destructive">
                  Cette fonctionnalité est réservée au propriétaire.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pin" className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Code PIN de sécurité
                </Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Code PIN"
                  className="text-center text-2xl tracking-widest"
                  data-testid="input-owner-pin"
                />
              </div>

              <Button
                onClick={handleVerify}
                disabled={pin.length < 4}
                className="w-full"
                data-testid="button-verify-pin"
              >
                <Shield className="w-4 h-4 mr-2" />
                Vérifier
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="main"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4 py-4"
            >
              {summaryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : summary?.hasSnapshot ? (
                <div className="space-y-3">
                  <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant="outline">
                        <Code className="w-3 h-3 mr-1" />
                        {summary.version}
                      </Badge>
                      <Badge variant="secondary">
                        <FileCode className="w-3 h-3 mr-1" />
                        {summary.filesCount} fichiers
                      </Badge>
                      <Badge variant="secondary">
                        {formatBytes(summary.totalSize || 0)}
                      </Badge>
                    </div>
                    {summary.createdAt && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Capturé {formatDistanceToNow(new Date(summary.createdAt), { addSuffix: true, locale: fr })}
                      </p>
                    )}
                  </div>

                  {summary.keyComponents && summary.keyComponents.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Composants clés:</p>
                      <ScrollArea className="h-20">
                        <div className="space-y-1">
                          {summary.keyComponents.map((comp, idx) => (
                            <p key={idx} className="text-xs font-mono text-foreground/70">
                              {comp}
                            </p>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-secondary/30 rounded-lg text-center">
                  <Code className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Aucun snapshot disponible
                  </p>
                </div>
              )}

              {rateLimit && !rateLimit.canCreate && (
                <div className="flex items-center gap-2 p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Prochain snapshot dans {rateLimit.waitMinutes} min
                  </p>
                </div>
              )}

              <Button
                onClick={() => createSnapshotMutation.mutate()}
                disabled={createSnapshotMutation.isPending || (rateLimit && !rateLimit.canCreate)}
                className="w-full"
                data-testid="button-create-snapshot"
              >
                {createSnapshotMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Capture en cours...
                  </>
                ) : (
                  <>
                    <Code className="w-4 h-4 mr-2" />
                    Capturer le code source
                  </>
                )}
              </Button>

              {createSnapshotMutation.isSuccess && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-2 p-2 bg-green-500/10 rounded-lg border border-green-500/20"
                >
                  <Check className="w-4 h-4 text-green-500" />
                  <p className="text-xs text-green-600 dark:text-green-400">
                    Snapshot capturé avec succès
                  </p>
                </motion.div>
              )}

              {snapshots && snapshots.length > 1 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs text-muted-foreground">Historique:</p>
                  <ScrollArea className="h-24">
                    <div className="space-y-1">
                      {snapshots.slice(1).map((snap) => (
                        <div key={snap.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-secondary/30">
                          <span className="font-mono">{snap.version}</span>
                          <span className="text-muted-foreground">{snap.filesCount} fichiers</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
