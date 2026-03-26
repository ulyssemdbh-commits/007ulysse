import { useTaskProgress, type TaskProgress } from "@/hooks/useTaskProgress";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ProgressTrackerProps {
  userId?: number;
  className?: string;
  compact?: boolean;
}

function formatTimeRemaining(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `~${minutes}min`;
  return `~${minutes}min ${remainingSeconds}s`;
}

function TaskProgressItem({ task, compact }: { task: TaskProgress; compact?: boolean }) {
  const isComplete = task.stage === "complete";
  const isError = task.stage === "error";
  const isProcessing = task.stage === "processing";

  const getStatusIcon = () => {
    if (isComplete) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (isError) return <XCircle className="h-4 w-4 text-destructive" />;
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  };

  const getStatusBadge = () => {
    if (isComplete) {
      return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">Terminé</Badge>;
    }
    if (isError) {
      return <Badge variant="destructive">Erreur</Badge>;
    }
    return (
      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
        {task.percentage}%
      </Badge>
    );
  };

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md"
        data-testid={`progress-item-compact-${task.taskId}`}
      >
        {getStatusIcon()}
        <span className="text-sm truncate flex-1">{task.currentStep}</span>
        {getStatusBadge()}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      data-testid={`progress-item-${task.taskId}`}
    >
      <Card className={cn(
        "p-4 transition-all",
        isComplete && "border-green-500/30 bg-green-500/5",
        isError && "border-destructive/30 bg-destructive/5"
      )}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {getStatusIcon()}
            <span className="font-medium truncate">{task.currentStep}</span>
          </div>
          {getStatusBadge()}
        </div>

        <Progress value={task.percentage} className="h-2 mb-2" />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            <span>
              Étape {task.currentStepIndex}/{task.totalSteps}
            </span>
          </div>
          {task.estimatedTimeRemaining && task.estimatedTimeRemaining > 0 && isProcessing && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatTimeRemaining(task.estimatedTimeRemaining)}</span>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export function ProgressTracker({ userId, className, compact = false }: ProgressTrackerProps) {
  const { activeTasks, hasActiveTasks } = useTaskProgress({ userId });

  if (!hasActiveTasks) {
    return null;
  }

  return (
    <div 
      className={cn("space-y-2", className)}
      data-testid="progress-tracker"
    >
      <AnimatePresence mode="popLayout">
        {activeTasks.map(task => (
          <TaskProgressItem 
            key={task.taskId} 
            task={task} 
            compact={compact}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

export function ProgressTrackerInline({ userId }: { userId?: number }) {
  const { activeTasks, hasActiveTasks } = useTaskProgress({ userId });

  if (!hasActiveTasks) {
    return null;
  }

  const currentTask = activeTasks[0];
  if (!currentTask) return null;

  const isComplete = currentTask.stage === "complete";
  const isError = currentTask.stage === "error";

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b"
      data-testid="progress-tracker-inline"
    >
      {isComplete ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
      ) : isError ? (
        <XCircle className="h-4 w-4 text-destructive shrink-0" />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
      )}
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{currentTask.currentStep}</span>
          <span className="text-xs text-muted-foreground">
            ({currentTask.currentStepIndex}/{currentTask.totalSteps})
          </span>
        </div>
        <Progress value={currentTask.percentage} className="h-1 mt-1" />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="secondary" className="text-xs">
          {currentTask.percentage}%
        </Badge>
        {currentTask.estimatedTimeRemaining && currentTask.estimatedTimeRemaining > 0 && !isComplete && !isError && (
          <span className="text-xs text-muted-foreground">
            {formatTimeRemaining(currentTask.estimatedTimeRemaining)}
          </span>
        )}
      </div>
    </motion.div>
  );
}
