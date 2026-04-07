import { useRoute, Link } from "wouter";
import { PageContainer } from "@/components/layout/PageContainer";
import { useProject } from "@/hooks/use-projects";
import { useTasks, useUpdateTask, useDeleteTask } from "@/hooks/use-tasks";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { TaskColumn } from "@/components/tasks/TaskColumn";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ArrowLeft, Check, Clock, ListTodo } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useMemo } from "react";
import type { Task } from "@shared/schema";

type StatusId = "todo" | "in_progress" | "done";

const columns = [
  { id: "todo" as const, title: "À faire", icon: ListTodo, color: "text-yellow-500" },
  { id: "in_progress" as const, title: "En cours", icon: Clock, color: "text-blue-500" },
  { id: "done" as const, title: "Terminé", icon: Check, color: "text-green-500" },
];

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = Number(params?.id);
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: tasks, isLoading: tasksLoading } = useTasks(projectId);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();

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

  const tasksByColumn = useMemo(() => {
    const map: Record<StatusId, Task[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };
    if (!tasks) return map;
    for (const t of tasks) {
      if (t.status === "todo" || t.status === "in_progress" || t.status === "done") {
        map[t.status as StatusId].push(t);
      }
    }
    return map;
  }, [tasks]);

  const isLoading = projectLoading || tasksLoading;

  if (isLoading) {
    return (
      <PageContainer title="Chargement...">
        <div className="grid md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[400px] rounded-xl" />
          ))}
        </div>
      </PageContainer>
    );
  }

  if (!project) {
    return (
      <PageContainer title="Projet introuvable">
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-lg font-medium mb-4">Ce projet n'existe pas ou a été supprimé.</p>
          <Link href="/projects">
            <Button variant="outline" data-testid="link-back-projects">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Retour aux projets
            </Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  const totalTasks = tasks?.length || 0;
  const doneTasks = tasksByColumn.done.length;

  return (
    <PageContainer
      title={project.name}
      action={<CreateTaskDialog projectId={projectId} />}
    >
      <div className="flex items-center gap-4 mb-6">
        <Link href="/projects">
          <Button variant="ghost" size="sm" data-testid="link-back-projects">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Projets
          </Button>
        </Link>
        <StatusBadge status={project.status} />
        {project.description && (
          <p className="text-sm text-muted-foreground">{project.description}</p>
        )}
        <div className="ml-auto text-sm text-muted-foreground" data-testid="text-task-count">
          {doneTasks}/{totalTasks} tâches terminées
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
