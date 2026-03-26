import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";
import type { Task } from "@shared/schema";
import type { LucideIcon } from "lucide-react";

type StatusId = "todo" | "in_progress" | "done";

interface Column {
  id: StatusId;
  title: string;
  icon: LucideIcon;
  color: string;
}

interface TaskColumnProps {
  column: Column;
  tasks: Task[];
  onStatusChange: (id: number, newStatus: StatusId) => void;
  onDelete: (id: number) => void;
  isUpdating?: boolean;
  isDeleting?: boolean;
}

export function TaskColumn({
  column,
  tasks,
  onStatusChange,
  onDelete,
  isUpdating,
  isDeleting,
}: TaskColumnProps) {
  const Icon = column.icon;

  return (
    <div
      className="flex flex-col h-full min-h-[380px] bg-secondary/20 rounded-xl border border-border/50 p-4"
      data-testid={`column-${column.id}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-5 h-5", column.color)} />
          <h3 className="font-semibold text-lg">{column.title}</h3>
        </div>
        <span className="bg-secondary px-2 py-1 rounded text-xs font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <div className="space-y-3 overflow-y-auto flex-1 pr-2 scrollbar-thin scrollbar-thumb-border">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              currentStatus={column.id}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
              isUpdating={isUpdating}
              isDeleting={isDeleting}
            />
          ))}
        </AnimatePresence>

        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50 border-2 border-dashed border-border/30 rounded-lg">
            <p className="text-xs">Aucune tâche</p>
          </div>
        )}
      </div>
    </div>
  );
}
