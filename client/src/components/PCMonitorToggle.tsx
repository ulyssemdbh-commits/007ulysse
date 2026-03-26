import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToastAction } from "@/components/ui/toast";
import { Monitor, MonitorOff, Loader2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PCMonitorToggleProps {
  className?: string;
}

interface MonitorStatus {
  preferences: {
    enabled: boolean;
  };
  activeSession: {
    status: string;
  } | null;
}

export function PCMonitorToggle({ className }: PCMonitorToggleProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: status, isLoading } = useQuery<MonitorStatus>({
    queryKey: ["/api/v2/screen-monitor/status"],
    refetchInterval: 30000,
    staleTime: 25000,
  });

  const toggleMutation = useMutation({
    mutationFn: async (action: "start" | "stop") => {
      return apiRequest("POST", "/api/v2/screen-monitor/toggle", { action });
    },
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/screen-monitor/status"] });
      if (action === "start") {
        toast({
          title: "Surveillance PC activée",
          description: "Téléchargez et lancez l'installeur sur votre PC",
          action: (
            <ToastAction 
              altText="Télécharger l'agent"
              onClick={() => {
                const link = document.createElement('a');
                link.href = "/downloads/install_ulysse_agent.bat";
                link.download = "install_ulysse_agent.bat";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              <Download className="h-4 w-4 mr-1" />
              Installer
            </ToastAction>
          ),
          duration: 10000
        });
      } else {
        toast({
          title: "Surveillance PC désactivée",
          description: "La surveillance de l'écran est arrêtée"
        });
      }
    },
    onError: (err: any) => {
      if (err.message?.includes("Owner access required")) {
        toast({
          title: "Accès refusé",
          description: "Seul le propriétaire peut activer cette fonction",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Erreur",
          description: err.message || "Une erreur est survenue",
          variant: "destructive"
        });
      }
    }
  });

  const isEnabled = status?.preferences?.enabled ?? false;
  const isActive = status?.activeSession?.status === "active";
  const isPending = toggleMutation.isPending;

  const handleClick = () => {
    if (isPending) return;
    toggleMutation.mutate(isEnabled ? "stop" : "start");
  };

  const label = isEnabled 
    ? (isActive ? "Surveillance PC active" : "Surveillance PC activée") 
    : "Surveillance PC désactivée";
  
  const tooltipText = isEnabled
    ? (isActive 
        ? "Ulysse analyse votre écran en temps réel. Cliquez pour désactiver." 
        : "En attente de connexion de l'agent PC. Cliquez pour désactiver.")
    : "Activer la surveillance écran pour une assistance contextuelle";

  if (isLoading) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        className={cn("text-muted-foreground", className)}
        data-testid="button-pc-monitor-toggle"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClick}
          disabled={isPending}
          className={cn(
            isEnabled 
              ? (isActive ? "text-green-500" : "text-yellow-500") 
              : "text-muted-foreground",
            className
          )}
          data-testid="button-pc-monitor-toggle"
          aria-label={label}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isEnabled ? (
            <Monitor className="h-4 w-4" />
          ) : (
            <MonitorOff className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
}
