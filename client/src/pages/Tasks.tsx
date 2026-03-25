import { PageContainer } from "@/components/layout/PageContainer";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { useTasks, useUpdateTask, useDeleteTask, useTaskLabels } from "@/hooks/use-tasks";
import { TaskColumn } from "@/components/tasks/TaskColumn";
import { LabelManagerDialog } from "@/components/tasks/LabelManager";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Clock, ListTodo, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { isBefore, isToday, isAfter, startOfDay } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";

const columns = [
  { id: "todo" as const, title: "À faire", icon: ListTodo, color: "text-yellow-500" },
  { id: "in_progress" as const, title: "En cours", icon: Clock, color: "text-blue-500" },
  { id: "done" as const, title: "Terminé", icon: Check, color: "text-green-500" },
];

type StatusId = (typeof columns)[number]["id"];
type Priority = "low" | "medium" | "high";
type DateFilter = "all" | "today" | "overdue" | "upcoming";
type ContextFilter = "all" | "sugu" | "suguval" | "foot" | "perso" | "dev" | "travail" | "famille";
type SourceFilter = "all" | "manual" | "kanban_ai" | "homework" | "calendar";

const priorityOrder: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const contextLabels: Record<ContextFilter, string> = {
  all: "Tous contextes",
  sugu: "SUGU Maillane",
  suguval: "Suguval",
  foot: "Football",
  perso: "Personnel",
  dev: "Developpement",
  travail: "Travail",
  famille: "Famille",
};

const sourceLabels: Record<SourceFilter, string> = {
  all: "Toutes sources",
  manual: "Manuel",
  kanban_ai: "IA",
  homework: "Devoirs",
  calendar: "Calendrier",
};

export default function Tasks() {
  const { data: tasks, isLoading } = useTasks();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusId | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [contextFilter, setContextFilter] = useState<ContextFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const today = startOfDay(new Date());

  const handleStatusChange = (id: number, newStatus: StatusId) => {
    updateTask.mutate(
      { id, status: newStatus },
      {
        onError: () => {
          toast({
            variant: "destructive",
            title: "Échec de la mise à jour",
            description: "Impossible de changer le statut de la tâche.",
          });
        },
        onSuccess: () => {
          toast({
            title: "Tâche mise à jour",
            description: "Le statut a été modifié avec succès.",
          });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteTask.mutate(id, {
      onError: () => {
        toast({
          variant: "destructive",
          title: "Échec de la suppression",
          description: "Impossible de supprimer la tâche.",
        });
      },
      onSuccess: () => {
        toast({
          title: "Tâche supprimée",
          description: "La tâche a été supprimée.",
        });
      },
    });
  };

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    return tasks
      .filter((task) => {
        if (statusFilter !== "all" && task.status !== statusFilter) return false;

        if (priorityFilter !== "all") {
          const p = (task.priority || "medium") as Priority;
          if (p !== priorityFilter) return false;
        }

        if (contextFilter !== "all") {
          if (task.context !== contextFilter) return false;
        }

        if (sourceFilter !== "all") {
          const taskSource = task.source || "manual";
          if (taskSource !== sourceFilter) return false;
        }

        if (dateFilter !== "all") {
          if (!task.dueDate) return false;

          const due = startOfDay(new Date(task.dueDate));

          if (dateFilter === "today") return isToday(due);
          if (dateFilter === "overdue") return isBefore(due, today) && task.status !== "done";
          if (dateFilter === "upcoming") return isAfter(due, today);
        }

        return true;
      })
      .sort((a, b) => {
        const priorityA = (a.priority || "medium") as Priority;
        const priorityB = (b.priority || "medium") as Priority;
        if (priorityOrder[priorityA] !== priorityOrder[priorityB]) {
          return priorityOrder[priorityA] - priorityOrder[priorityB];
        }

        if (a.dueDate && b.dueDate) {
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        }

        return 0;
      });
  }, [tasks, statusFilter, dateFilter, priorityFilter, contextFilter, sourceFilter, today]);

  const tasksByColumn = useMemo(() => {
    const map: Record<StatusId, Task[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };

    for (const t of filteredTasks) {
      if (t.status === "todo" || t.status === "in_progress" || t.status === "done") {
        map[t.status as StatusId].push(t);
      }
    }

    return map;
  }, [filteredTasks]);

  if (isLoading) {
    return (
      <PageContainer title="Tâches">
        <div className="flex items-center justify-between mb-4">
          <div className="h-8 w-40 rounded bg-muted animate-pulse" />
          <div className="h-9 w-32 rounded bg-muted animate-pulse" />
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[400px] rounded-xl" />
          ))}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Tâches" action={
      <div className="flex gap-2">
        <LabelManagerDialog />
        <CreateTaskDialog />
      </div>
    }>
      <div className="mb-4 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="w-4 h-4" />
          <span>Filtrer les tâches</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusId | "all")}
          >
            <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={dateFilter}
            onValueChange={(v) => setDateFilter(v as DateFilter)}
          >
            <SelectTrigger className="w-[160px]" data-testid="select-date-filter">
              <SelectValue placeholder="Date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les dates</SelectItem>
              <SelectItem value="today">Aujourd&apos;hui</SelectItem>
              <SelectItem value="overdue">En retard</SelectItem>
              <SelectItem value="upcoming">À venir</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={priorityFilter}
            onValueChange={(v) => setPriorityFilter(v as Priority | "all")}
          >
            <SelectTrigger className="w-[150px]" data-testid="select-priority-filter">
              <SelectValue placeholder="Priorite" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes priorites</SelectItem>
              <SelectItem value="high">Haute</SelectItem>
              <SelectItem value="medium">Normale</SelectItem>
              <SelectItem value="low">Basse</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={contextFilter}
            onValueChange={(v) => setContextFilter(v as ContextFilter)}
          >
            <SelectTrigger className="w-[150px]" data-testid="select-context-filter">
              <SelectValue placeholder="Contexte" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(contextLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sourceFilter}
            onValueChange={(v) => setSourceFilter(v as SourceFilter)}
          >
            <SelectTrigger className="w-[130px]" data-testid="select-source-filter">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(sourceLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <TooltipProvider>
        <div className="flex-1 grid md:grid-cols-3 gap-6 overflow-hidden">
          {columns.map((col) => (
            <TaskColumn
              key={col.id}
              column={col}
              tasks={tasksByColumn[col.id]}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              isUpdating={updateTask.isPending}
              isDeleting={deleteTask.isPending}
            />
          ))}
        </div>
      </TooltipProvider>
    </PageContainer>
  );
}
