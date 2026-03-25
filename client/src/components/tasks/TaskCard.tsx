import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Check, Clock, ListTodo, Trash2, CalendarIcon, AlertTriangle, ChevronDown, Plus, X, Repeat } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { format, isBefore, isToday, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";
import type { Task, Subtask, TaskLabel } from "@shared/schema";
import { useState } from "react";
import { useSubtasks, useCreateSubtask, useUpdateSubtask, useDeleteSubtask, useTaskLabelAssignments } from "@/hooks/use-tasks";
import { LabelPicker } from "./LabelManager";

type StatusId = "todo" | "in_progress" | "done";
type Priority = "low" | "medium" | "high";

const priorityLabel: Record<Priority, string> = {
  low: "Basse",
  medium: "Normale",
  high: "Haute",
};

interface TaskCardProps {
  task: Task;
  currentStatus: StatusId;
  onStatusChange: (id: number, newStatus: StatusId) => void;
  onDelete: (id: number) => void;
  isDeleting?: boolean;
  isUpdating?: boolean;
}

function DeleteTaskButton({
  id,
  onDelete,
  disabled,
}: {
  id: number;
  onDelete: (id: number) => void;
  disabled?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={disabled}
          data-testid={`button-delete-task-${id}`}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer cette tâche ?</AlertDialogTitle>
          <AlertDialogDescription>
            Cette action est définitive. La tâche sera supprimée de manière permanente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onDelete(id)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid={`button-confirm-delete-${id}`}
          >
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SubtaskList({ taskId }: { taskId: number }) {
  const { data: subtasks = [], isLoading } = useSubtasks(taskId);
  const createSubtask = useCreateSubtask();
  const updateSubtask = useUpdateSubtask();
  const deleteSubtask = useDeleteSubtask();
  const [newTitle, setNewTitle] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const completedCount = subtasks.filter((s) => s.completed).length;
  const totalCount = subtasks.length;

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    createSubtask.mutate({ taskId, title: newTitle.trim() });
    setNewTitle("");
  };

  const handleToggle = (subtask: Subtask) => {
    updateSubtask.mutate({ id: subtask.id, taskId, completed: !subtask.completed });
  };

  const handleDelete = (id: number) => {
    deleteSubtask.mutate({ id, taskId });
  };

  if (isLoading) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          data-testid={`button-toggle-subtasks-${taskId}`}
        >
          <span className="flex items-center gap-1">
            <ListTodo className="w-3 h-3" />
            Sous-tâches {totalCount > 0 && `(${completedCount}/${totalCount})`}
          </span>
          <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1">
        <AnimatePresence mode="popLayout">
          {subtasks.map((subtask) => (
            <motion.div
              key={subtask.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 group/subtask"
            >
              <Checkbox
                checked={subtask.completed}
                onCheckedChange={() => handleToggle(subtask)}
                data-testid={`checkbox-subtask-${subtask.id}`}
              />
              <span className={cn("text-xs flex-1", subtask.completed && "line-through text-muted-foreground")}>
                {subtask.title}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover/subtask:opacity-100"
                onClick={() => handleDelete(subtask.id)}
                data-testid={`button-delete-subtask-${subtask.id}`}
              >
                <X className="w-3 h-3" />
              </Button>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="flex gap-1 mt-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nouvelle sous-tâche..."
            className="h-7 text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            data-testid={`input-new-subtask-${taskId}`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleAdd}
            disabled={!newTitle.trim() || createSubtask.isPending}
            data-testid={`button-add-subtask-${taskId}`}
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TaskLabelsDisplay({ taskId }: { taskId: number }) {
  const { data: labels = [] } = useTaskLabelAssignments(taskId);
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {labels.map((label) => (
        <span
          key={label.id}
          className="px-1.5 py-0.5 text-[10px] rounded-full text-white"
          style={{ backgroundColor: label.color }}
          data-testid={`label-${label.id}`}
        >
          {label.name}
        </span>
      ))}
    </div>
  );
}

export function TaskCard({
  task,
  currentStatus,
  onStatusChange,
  onDelete,
  isDeleting,
  isUpdating,
}: TaskCardProps) {
  const today = startOfDay(new Date());
  const priority = (task.priority || "medium") as Priority;
  const hasDueDate = !!task.dueDate;
  const dueDate = hasDueDate ? new Date(task.dueDate as string) : null;
  const isOverdue = hasDueDate && task.status !== "done" && isBefore(startOfDay(dueDate!), today);
  const isTodayDue = hasDueDate && isToday(startOfDay(dueDate!));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -8 }}
      transition={{ duration: 0.15 }}
    >
      <Card
        className={cn(
          "bg-card border-border shadow-sm hover:shadow-md hover:border-primary/30 transition-all group relative",
          isOverdue && "border-destructive/60 bg-destructive/5",
          isTodayDue && task.status !== "done" && "border-amber-400/70 bg-amber-50/5"
        )}
        data-testid={`card-task-${task.id}`}
      >
        <CardHeader className="p-4 pb-2">
          <div className="flex justify-between items-start gap-2">
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <CardTitle className="text-sm font-medium leading-tight truncate">
                {task.title}
              </CardTitle>
              <div className="flex items-center gap-2">
                {hasDueDate && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {isOverdue && <AlertTriangle className="w-3 h-3 text-destructive" />}
                    <CalendarIcon className="w-3 h-3" />
                    <span className={cn(isOverdue && "text-destructive font-medium")}>
                      {format(dueDate!, "d MMM yyyy", { locale: fr })}
                    </span>
                  </div>
                )}
                {task.recurrenceType && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-0.5 text-[10px] text-primary/70">
                        <Repeat className="w-3 h-3" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      Récurrente ({task.recurrenceType === 'daily' ? 'quotidien' : task.recurrenceType === 'weekly' ? 'hebdo' : task.recurrenceType === 'monthly' ? 'mensuel' : 'annuel'})
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            <StatusBadge status={priority} />
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <TaskLabelsDisplay taskId={task.id} />
          {(task.context || (task.source && task.source !== 'manual')) && (
            <div className="flex flex-wrap gap-1 mb-2">
              {task.context && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-primary/20 text-primary-foreground/80">
                  {task.context}
                </span>
              )}
              {task.source && task.source !== 'manual' && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-secondary text-muted-foreground">
                  {task.source === 'kanban_ai' ? 'IA' : task.source}
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {task.description || "Aucune description"}
          </p>
          
          <SubtaskList taskId={task.id} />

          <div className="flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity mt-2">
            <div className="flex gap-1">
              {currentStatus !== "todo" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onStatusChange(task.id, "todo")}
                      disabled={isUpdating}
                      data-testid={`button-move-todo-${task.id}`}
                    >
                      <ListTodo className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>À faire</TooltipContent>
                </Tooltip>
              )}
              {currentStatus !== "in_progress" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onStatusChange(task.id, "in_progress")}
                      disabled={isUpdating}
                      data-testid={`button-move-progress-${task.id}`}
                    >
                      <Clock className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>En cours</TooltipContent>
                </Tooltip>
              )}
              {currentStatus !== "done" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onStatusChange(task.id, "done")}
                      disabled={isUpdating}
                      data-testid={`button-move-done-${task.id}`}
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Terminé</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex gap-1">
              <LabelPicker taskId={task.id} />
              <DeleteTaskButton id={task.id} onDelete={onDelete} disabled={isDeleting} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
