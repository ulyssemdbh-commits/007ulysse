import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, XCircle, SkipForward, ListTodo } from "lucide-react";

type StepStatus = "pending" | "in_progress" | "done" | "skipped" | "failed";

interface TodoStep {
  id: number;
  title: string;
  status: StepStatus;
  notes?: string;
}

interface TodoState {
  active: boolean;
  objective?: string;
  totalSteps?: number;
  doneSteps?: number;
  inProgressStepId?: number | null;
  steps?: TodoStep[];
}

const STATUS_ICON: Record<StepStatus, JSX.Element> = {
  done: <CheckCircle2 className="w-3 h-3 text-emerald-500" />,
  in_progress: <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />,
  pending: <Circle className="w-3 h-3 text-slate-400/60" />,
  skipped: <SkipForward className="w-3 h-3 text-amber-500" />,
  failed: <XCircle className="w-3 h-3 text-rose-500" />,
};

export function UlysseTodoPanel() {
  const { data, isLoading } = useQuery<TodoState>({
    queryKey: ["/api/v2/todo/state"],
    refetchInterval: 3000,
  });

  if (isLoading || !data) {
    return null;
  }

  if (!data.active) {
    return (
      <div
        data-testid="todo-panel-empty"
        className="border border-blue-200 dark:border-cyan-500/30 backdrop-blur-md rounded-xl p-3 bg-white dark:bg-[#00000000] shadow-sm dark:shadow-none"
      >
        <h3 className="text-[10px] font-mono text-blue-500 dark:text-cyan-500/70 tracking-widest uppercase mb-2 flex items-center gap-2 pb-2 border-b border-blue-100 dark:border-cyan-900/40">
          <ListTodo className="w-3 h-3" /> Plan d'action
        </h3>
        <p className="text-xs text-slate-500 dark:text-cyan-500/40 italic">
          Aucun plan actif. Demande à Ulysse une tâche multi-étapes pour en lancer un.
        </p>
      </div>
    );
  }

  const progress = data.totalSteps ? (data.doneSteps! / data.totalSteps) * 100 : 0;

  return (
    <div
      data-testid="todo-panel-active"
      className="border border-cyan-300 dark:border-cyan-500/50 backdrop-blur-md rounded-xl p-3 bg-white dark:bg-[#00000000] shadow-sm dark:shadow-[0_0_12px_rgba(6,182,212,0.15)]"
    >
      <h3 className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 tracking-widest uppercase mb-2 flex items-center gap-2 pb-2 border-b border-cyan-200 dark:border-cyan-900/40">
        <ListTodo className="w-3 h-3" /> Plan d'action
        <span className="ml-auto text-cyan-700 dark:text-cyan-300" data-testid="text-todo-progress">
          {data.doneSteps}/{data.totalSteps}
        </span>
      </h3>

      <p className="text-xs font-medium text-slate-700 dark:text-cyan-200 mb-2 line-clamp-2" data-testid="text-todo-objective">
        🎯 {data.objective}
      </p>

      <div className="h-1 bg-slate-200 dark:bg-cyan-950/40 rounded overflow-hidden mb-2">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {data.steps?.map((step) => (
          <div
            key={step.id}
            data-testid={`row-todo-step-${step.id}`}
            className={`flex items-start gap-1.5 p-1.5 rounded text-[11px] leading-tight ${
              step.status === "in_progress"
                ? "bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-700/50"
                : "bg-slate-50 dark:bg-slate-900/30 border border-transparent"
            }`}
          >
            <div className="mt-0.5 shrink-0">{STATUS_ICON[step.status]}</div>
            <div className="flex-1 min-w-0">
              <div className={`${step.status === "done" ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-cyan-100"}`}>
                <span className="font-mono text-[10px] text-slate-400 mr-1">{step.id}.</span>
                {step.title}
              </div>
              {step.notes && (
                <div className="text-[10px] text-slate-500 dark:text-cyan-500/60 italic mt-0.5">
                  {step.notes}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
