import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  FolderKanban, 
  CheckSquare, 
  StickyNote, 
  Bot,
  Users,
  Settings,
  Globe,
  Monitor,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Projets", href: "/projects", icon: FolderKanban },
  { name: "Tâches", href: "/tasks", icon: CheckSquare },
  { name: "Notes", href: "/notes", icon: StickyNote },
  { name: "Ulysse", href: "/assistant", icon: Bot },
  { name: "Commax", href: "/commax", icon: Globe },
  { name: "SuperChat", href: "/superchat", icon: Users },
  { name: "Vision", href: "/screen-monitor", icon: Monitor },
  { name: "Paramètres", href: "/settings", icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [location] = useLocation();

  return (
    <div
      className={cn(
        "flex flex-col border-r border-border bg-card/50 backdrop-blur-xl h-screen fixed left-0 top-0 z-30 transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className={cn("p-4 flex items-center h-[72px]", collapsed ? "justify-center" : "space-x-3 px-6")}>
        <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-gradient-to-tr from-primary to-purple-400 flex items-center justify-center shadow-lg shadow-primary/20">
          <Bot className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <span className="text-xl font-bold font-display tracking-tight text-white whitespace-nowrap overflow-hidden">
            DevFlow
          </span>
        )}
      </div>

      <nav className="flex-1 px-2 space-y-1 mt-2">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <div
                title={collapsed ? item.name : undefined}
                className={cn(
                  "flex items-center rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group",
                  collapsed ? "justify-center px-0 py-3" : "px-4 py-3",
                  isActive
                    ? "bg-primary/10 text-primary shadow-sm border border-primary/20"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                  !collapsed && !isActive && "hover:translate-x-1"
                )}
              >
                <item.icon
                  className={cn(
                    "h-5 w-5 flex-shrink-0 transition-colors",
                    collapsed ? "" : "mr-3",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.name}</span>
                    {isActive && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(124,58,237,0.8)]" />
                    )}
                  </>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className={cn("p-2 border-t border-border", collapsed ? "flex justify-center" : "flex justify-end px-4")}>
        <button
          onClick={onToggle}
          data-testid="button-sidebar-toggle"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all duration-200"
          title={collapsed ? "Agrandir la barre" : "Réduire la barre"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
