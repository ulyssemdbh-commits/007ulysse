import { Trophy, Brain, Store, DollarSign, FolderOpen, ListTodo, Pencil, Mail, BarChart3, GitBranch, Sparkles, Users, Stethoscope, Settings, CreditCard, CheckSquare, Briefcase, Activity, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface DashboardShortcutsProps {
  navigate: (path: string) => void;
}

const URL_SHORTCUTS = [
  { label: "Pronos", icon: Trophy, path: "/sports/predictions", color: "text-yellow-500 dark:text-yellow-400" },
  { label: "Brain", icon: Brain, path: "/brain", color: "text-purple-500 dark:text-purple-400" },
  { label: "Val", icon: Store, path: "/suguval", color: "text-emerald-500 dark:text-emerald-400" },
  { label: "Maillane", icon: Store, path: "/sugumaillane", color: "text-teal-500 dark:text-teal-400" },
  { label: "Finances", icon: CreditCard, path: "/finances", color: "text-blue-500 dark:text-blue-400" },
  { label: "Projets", icon: Briefcase, path: "/projects", color: "text-orange-500 dark:text-orange-400" },
  { label: "Taches", icon: CheckSquare, path: "/tasks", color: "text-green-500 dark:text-green-400" },
  { label: "Notes", icon: Pencil, path: "/notes", color: "text-pink-500 dark:text-pink-400" },
  { label: "Emails", icon: Mail, path: "/emails", color: "text-red-500 dark:text-red-400" },
  { label: "Insights", icon: BarChart3, path: "/ulysse-insights", color: "text-cyan-600 dark:text-cyan-400" },
  { label: "DevOps", icon: GitBranch, path: "/devops", color: "text-indigo-500 dark:text-indigo-400" },
  { label: "Iris", icon: Sparkles, path: "/devops-iris", color: "text-amber-500 dark:text-amber-400" },
  { label: "SuperChat", icon: Users, path: "/superchat", color: "text-violet-500 dark:text-violet-400" },
  { label: "Traces", icon: Activity, path: "/traces", color: "text-cyan-600 dark:text-cyan-400" },
  { label: "Skills", icon: Zap, path: "/skills", color: "text-yellow-500 dark:text-yellow-400" },
  { label: "Diag", icon: Stethoscope, path: "/diagnostics", color: "text-slate-500 dark:text-slate-400" },
  { label: "Reglages", icon: Settings, path: "/settings", color: "text-slate-500 dark:text-slate-300" },
];

export function DashboardShortcuts({ navigate }: DashboardShortcutsProps) {
  const [activeModule, setActiveModule] = useState<string | null>(null);

  return (
    <aside className="w-[130px] shrink-0 grid grid-cols-2 gap-1.5 overflow-y-auto pb-2 content-start" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
      {URL_SHORTCUTS.map((mod) => {
        const Icon = mod.icon;
        const isActive = activeModule === mod.label;
        return (
          <button
            key={mod.label}
            onClick={() => {
              setActiveModule(isActive ? null : mod.label);
              navigate(mod.path);
            }}
            data-testid={`module-${mod.label.toLowerCase()}`}
            className={cn(
              "relative group flex flex-col items-center justify-center gap-0.5 p-2 rounded-xl border transition-all duration-300",
              isActive
                ? "border-blue-400/50 dark:border-cyan-500/50 bg-blue-50 dark:bg-cyan-950/30 text-blue-600 dark:text-cyan-300 shadow-md dark:shadow-[0_0_15px_rgba(0,212,255,0.15)]"
                : "border-gray-200 dark:border-cyan-900/20 bg-white dark:bg-black/30 text-gray-500 dark:text-cyan-700 hover:border-blue-300 dark:hover:border-cyan-700/50 hover:text-blue-500 dark:hover:text-cyan-400 shadow-sm dark:shadow-none"
            )}
          >
            <Icon className={cn("w-5 h-5", isActive ? "text-blue-500 dark:text-cyan-300" : mod.color)} />
            <span className="text-[8px] uppercase tracking-wider font-mono opacity-80 group-hover:opacity-100 leading-tight text-gray-600 dark:text-[#d8edf0]">{mod.label}</span>
            <div className="absolute inset-0 border border-blue-400/0 dark:border-cyan-400/0 group-hover:border-blue-300/20 dark:group-hover:border-cyan-400/20 rounded-xl transition-all duration-300" />
          </button>
        );
      })}
    </aside>
  );
}
