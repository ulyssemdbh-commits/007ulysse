import { Trophy, Brain, Store, DollarSign, FolderOpen, ListTodo, Pencil, Mail, BarChart3, GitBranch, Sparkles, Users, Stethoscope, Settings } from "lucide-react";

interface DashboardShortcutsProps {
  navigate: (path: string) => void;
}

const URL_SHORTCUTS = [
  { label: "Pronos", icon: Trophy, path: "/sports/predictions", color: "text-yellow-400" },
  { label: "Brain", icon: Brain, path: "/brain", color: "text-purple-400" },
  { label: "Val", icon: Store, path: "/suguval", color: "text-emerald-400" },
  { label: "Maillane", icon: Store, path: "/sugumaillane", color: "text-teal-400" },
  { label: "Finances", icon: DollarSign, path: "/finances", color: "text-blue-400" },
  { label: "Projets", icon: FolderOpen, path: "/projects", color: "text-orange-400" },
  { label: "Tâches", icon: ListTodo, path: "/tasks", color: "text-green-400" },
  { label: "Notes", icon: Pencil, path: "/notes", color: "text-pink-400" },
  { label: "Emails", icon: Mail, path: "/emails", color: "text-red-400" },
  { label: "Insights", icon: BarChart3, path: "/ulysse-insights", color: "text-cyan-400" },
  { label: "DevOps", icon: GitBranch, path: "/devops", color: "text-indigo-400" },
  { label: "Iris DevOps", icon: Sparkles, path: "/devops-iris", color: "text-amber-400" },
  { label: "SuperChat", icon: Users, path: "/superchat", color: "text-violet-400" },
  { label: "Diag", icon: Stethoscope, path: "/diagnostics", color: "text-slate-400" },
  { label: "Réglages", icon: Settings, path: "/settings", color: "text-slate-300" },
];

export function DashboardShortcuts({ navigate }: DashboardShortcutsProps) {
  return (
    <div className="w-full mb-3 z-10">
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {URL_SHORTCUTS.map(s => (
          <button key={s.label} onClick={() => navigate(s.path)} data-testid={`shortcut-${s.label.toLowerCase()}`}
            className="flex flex-col items-center gap-1 flex-shrink-0 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20 transition-all min-w-[52px]">
            <s.icon className={`w-4 h-4 ${s.color}`} />
            <span className="text-[9px] text-slate-600 dark:text-white/60 font-medium leading-none whitespace-nowrap">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
