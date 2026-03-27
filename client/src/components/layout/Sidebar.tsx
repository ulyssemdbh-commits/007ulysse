import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  FolderKanban, 
  CheckSquare, 
  StickyNote, 
  Bot,
  Users,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Projets", href: "/projects", icon: FolderKanban },
  { name: "Tâches", href: "/tasks", icon: CheckSquare },
  { name: "Notes", href: "/notes", icon: StickyNote },
  { name: "Ulysse", href: "/assistant", icon: Bot },
  { name: "SuperChat", href: "/superchat", icon: Users },
  { name: "Paramètres", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="flex flex-col w-64 border-r border-border bg-card/50 backdrop-blur-xl h-screen fixed left-0 top-0 z-30">
      <div className="p-6 flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary to-purple-400 flex items-center justify-center shadow-lg shadow-primary/20">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold font-display tracking-tight text-white">DevFlow</span>
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <div
                className={cn(
                  "flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group",
                  isActive
                    ? "bg-primary/10 text-primary shadow-sm border border-primary/20"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground hover:translate-x-1"
                )}
              >
                <item.icon
                  className={cn(
                    "mr-3 h-5 w-5 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                {item.name}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(124,58,237,0.8)]" />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

    </div>
  );
}
