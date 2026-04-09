import { useQuery } from "@tanstack/react-query";
import { Calendar, Mail, CheckSquare, CreditCard, Trophy, Activity, ChevronRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface MarseilleData {
  time: string;
  date: string;
  weather: {
    temperature: string;
    condition: string;
  };
}

export function DashboardRightPanel() {
  const { data: marseilleInfo } = useQuery<MarseilleData>({
    queryKey: ["/api/marseille-info"],
    refetchInterval: 60000,
  });

  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString("fr-FR", { hour12: false })
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString("fr-FR", { hour12: false }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const agendaItems = [
    { time: "10:00", label: "Standup DevMax", color: "bg-blue-500" },
    { time: "12:30", label: "Dejeuner", color: "bg-pink-500" },
    { time: "14:00", label: "Review finances", color: "bg-amber-500" },
    { time: "17:00", label: "Livraison colis", color: "bg-emerald-500" },
    { time: "21:00", label: "OM Match", color: "bg-cyan-500" },
  ];

  const systems = [
    { name: "Ulysse", status: "ok" },
    { name: "DevMax", status: "ok" },
    { name: "AppToOrder", status: "warn" },
    { name: "Suguval", status: "ok" },
    { name: "Maillane", status: "ok" },
    { name: "Discord", status: "ok" },
  ];

  return (
    <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      <div className="border border-cyan-500/30 bg-black/40 backdrop-blur-md rounded-xl p-3 flex flex-col">
        <h3 className="text-[10px] font-mono text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center gap-2 pb-2 border-b border-cyan-900/40">
          <Calendar className="w-3 h-3" /> Agenda du jour
        </h3>
        <div className="flex flex-col gap-1.5">
          {agendaItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2 p-1.5 rounded-lg bg-cyan-950/20 border border-cyan-900/20 group hover:border-cyan-500/30 transition-all cursor-pointer">
              <div className={cn("w-1 h-8 rounded-full shrink-0", item.color)} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-cyan-200 truncate">{item.label}</div>
                <div className="text-[9px] font-mono text-cyan-600">{item.time}</div>
              </div>
              <ChevronRight className="w-3 h-3 text-cyan-800 group-hover:text-cyan-400 transition-colors shrink-0" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 border border-cyan-500/30 bg-black/40 backdrop-blur-md rounded-xl p-3">
          <h3 className="text-[10px] font-mono text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center gap-1">
            <CreditCard className="w-3 h-3" /> Solde
          </h3>
          <div className="text-lg font-bold text-cyan-200 tracking-wide">--,-- EUR</div>
          <div className="flex items-center gap-1 mt-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] font-mono text-emerald-400">ce mois</span>
          </div>
        </div>
        <div className="flex-1 border border-cyan-500/30 bg-black/40 backdrop-blur-md rounded-xl p-3">
          <h3 className="text-[10px] font-mono text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center gap-1">
            <Trophy className="w-3 h-3" /> Pronos
          </h3>
          <div className="text-[11px] text-cyan-200 font-medium">Match du jour</div>
          <div className="text-[10px] text-cyan-500 font-mono">--</div>
          <div className="flex items-center gap-1 mt-1">
            <div className="flex-1 h-1 bg-cyan-900/50 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-400 rounded-full" style={{ width: "0%" }} />
            </div>
            <span className="text-[9px] font-mono text-cyan-500">--%</span>
          </div>
        </div>
      </div>

      <div className="border border-cyan-500/30 bg-black/40 backdrop-blur-md rounded-xl p-3 flex flex-col">
        <h3 className="text-[10px] font-mono text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center justify-between pb-2 border-b border-cyan-900/40">
          <span className="flex items-center gap-2"><Activity className="w-3 h-3" /> Systemes</span>
          <span className="text-emerald-400 text-[9px]">{systems.filter(s => s.status === "ok").length}/{systems.length} OK</span>
        </h3>
        <div className="grid grid-cols-3 gap-1.5">
          {systems.map((sys, i) => (
            <div key={i} className="flex items-center gap-1 p-1 rounded bg-cyan-950/20">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                sys.status === "ok" && "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]",
                sys.status === "warn" && "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)] animate-pulse",
                sys.status === "down" && "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)] animate-pulse",
              )} />
              <span className={cn(
                "text-[9px] font-mono truncate",
                sys.status === "ok" && "text-cyan-500",
                sys.status === "warn" && "text-amber-400",
                sys.status === "down" && "text-red-400",
              )}>{sys.name}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
