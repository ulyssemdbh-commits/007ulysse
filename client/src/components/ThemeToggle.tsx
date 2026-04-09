import { Moon, Sun, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const cycleTheme = () => {
    if (theme === "auto") setTheme("light");
    else if (theme === "light") setTheme("dark");
    else setTheme("auto");
  };

  const label = theme === "auto" ? "Auto" : theme === "light" ? "Jour" : "Nuit";
  const tooltip = theme === "auto"
    ? "Mode auto (jour/nuit selon l'heure)"
    : theme === "light"
    ? "Mode jour — cliquer pour nuit"
    : "Mode nuit — cliquer pour auto";

  const Icon = theme === "auto" ? SunMoon : resolvedTheme === "dark" ? Moon : Sun;
  const iconColor = theme === "auto"
    ? "text-violet-400"
    : resolvedTheme === "dark"
    ? "text-indigo-400"
    : "text-amber-500";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleTheme}
          className={cn("gap-1.5 px-2", iconColor, className)}
          data-testid="button-theme-toggle"
          aria-label={tooltip}
        >
          <Icon className="h-4 w-4" />
          <span className="text-xs font-medium">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
