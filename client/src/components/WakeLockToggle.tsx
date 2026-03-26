import { useWakeLock } from '@/hooks/useWakeLock';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WakeLockToggleProps {
  className?: string;
  showLabel?: boolean;
}

export function WakeLockToggle({ className, showLabel = false }: WakeLockToggleProps) {
  const { isSupported, isActive, error, toggleWakeLock } = useWakeLock(true);

  if (!isSupported) {
    return null;
  }

  const handleClick = async () => {
    await toggleWakeLock();
  };

  const label = isActive ? "Écran actif" : "Mode veille auto";
  const tooltipText = isActive 
    ? "L'écran restera allumé tant que l'app est ouverte" 
    : "Cliquez pour empêcher la mise en veille de l'écran";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClick}
          className={cn(
            "gap-1.5 px-2",
            isActive ? "text-yellow-500" : "text-muted-foreground",
            className
          )}
          data-testid="button-wake-lock-toggle"
          aria-label={label}
        >
          {isActive ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{tooltipText}</p>
        {error && <p className="text-destructive text-xs mt-1">{error}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
