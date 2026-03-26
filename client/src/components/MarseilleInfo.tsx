import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, Calendar, MapPin, Droplets, Wind, Cloud, Sun, CloudRain, CloudSun, CloudFog, CloudDrizzle, CloudLightning, Snowflake, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { memo, useEffect, useState } from "react";

interface MarseilleData {
  time: string;
  date: string;
  dateShort: string;
  weather: {
    temperature: string;
    condition: string;
    humidity: string;
    wind: string;
    icon: string;
  };
  location: string;
  lastUpdated: string;
}

const weatherIcons: Record<string, typeof Sun> = {
  sun: Sun,
  cloud: Cloud,
  "cloud-sun": CloudSun,
  "cloud-rain": CloudRain,
  "cloud-drizzle": CloudDrizzle,
  "cloud-fog": CloudFog,
  "cloud-lightning": CloudLightning,
  snowflake: Snowflake,
};

export const MarseilleInfo = memo(function MarseilleInfo({ className }: { className?: string }) {
  const [liveTime, setLiveTime] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  
  const { data, isLoading, error, refetch, isFetching } = useQuery<MarseilleData>({
    queryKey: ["/api/marseille-info"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date().toLocaleTimeString("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
      });
      setLiveTime(now);
    };
    
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  if (isLoading) {
    return (
      <Card className={cn("p-2 animate-pulse", className)}>
        <div className="h-8 bg-muted rounded" />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={cn("p-2", className)}>
        <div className="text-center text-muted-foreground text-sm">
          Donnees indisponibles
        </div>
      </Card>
    );
  }

  const WeatherIcon = weatherIcons[data.weather.icon] || Cloud;

  return (
    <>
      <div 
        className="w-full px-3 py-2 cursor-pointer transition-all duration-300 bg-gradient-to-r from-white/10 to-white/5 dark:from-white/8 dark:to-white/3 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-2xl shadow-lg shadow-black/5 hover:from-white/15 hover:to-white/10 hover:border-white/30 hover:scale-[1.02]"
        onClick={() => setIsOpen(true)}
        data-testid="card-marseille-info"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-primary" />
            <span className="text-base font-bold tabular-nums" data-testid="text-time">{liveTime || data.time}</span>
          </div>
          <div className="h-4 w-px bg-white/20" />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            <span className="text-xs font-medium" data-testid="text-date">{data.dateShort}</span>
          </div>
          <div className="h-4 w-px bg-white/20" />
          <div className="flex items-center gap-1.5">
            <WeatherIcon className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold" data-testid="text-temperature">{data.weather.temperature}</span>
          </div>
        </div>
      </div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              {data.location}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-primary" />
                <span className="text-3xl font-bold tabular-nums">{liveTime || data.time}</span>
              </div>
              <div 
                className="cursor-pointer opacity-50 hover:opacity-100 transition-opacity p-2"
                onClick={(e) => { e.stopPropagation(); refetch(); }}
                data-testid="button-refresh-weather"
              >
                <RefreshCw className={cn("w-5 h-5", isFetching && "animate-spin")} />
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-5 h-5" />
              <span className="text-lg">{data.date}</span>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <WeatherIcon className="w-12 h-12 text-amber-500" />
                  <span className="text-4xl font-bold">{data.weather.temperature}</span>
                </div>
                <Badge variant="secondary" className="text-sm">
                  {data.weather.condition}
                </Badge>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Droplets className="w-5 h-5 text-blue-400" />
                  <span>Humidite: {data.weather.humidity}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Wind className="w-5 h-5 text-slate-400" />
                  <span>Vent: {data.weather.wind}</span>
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground text-right pt-2 border-t">
              Derniere mise a jour: {data.lastUpdated}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
