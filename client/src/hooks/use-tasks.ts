import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertTask, type Task, type Subtask, type TaskLabel } from "@shared/schema";

export function useTasks(projectId?: number) {
  return useQuery({
    queryKey: [api.tasks.list.path, projectId],
    queryFn: async () => {
      const url = projectId
        ? `${api.tasks.list.path}?projectId=${projectId}`
        : api.tasks.list.path;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return api.tasks.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<InsertTask, "userId">) => {
      const res = await fetch(api.tasks.create.path, {
        method: api.tasks.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create task");
      return api.tasks.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertTask>) => {
      const url = buildUrl(api.tasks.update.path, { id });
      const res = await fetch(url, {
        method: api.tasks.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update task");
      return api.tasks.update.responses[200].parse(await res.json());
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: [api.tasks.list.path] });
      const previous = queryClient.getQueryData<Task[]>([api.tasks.list.path]);
      if (previous) {
        queryClient.setQueryData<Task[]>([api.tasks.list.path], (old) =>
          (old || []).map((t) =>
            t.id === variables.id ? { ...t, ...variables } : t
          )
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData([api.tasks.list.path], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.tasks.delete.path, { id });
      const res = await fetch(url, { method: api.tasks.delete.method });
      if (!res.ok) throw new Error("Failed to delete task");
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [api.tasks.list.path] });
      const previous = queryClient.getQueryData<Task[]>([api.tasks.list.path]);
      if (previous) {
        queryClient.setQueryData<Task[]>([api.tasks.list.path], (old) =>
          (old || []).filter((t) => t.id !== id)
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData([api.tasks.list.path], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
    },
  });
}

// ========== SUBTASKS ==========

export function useSubtasks(taskId: number) {
  return useQuery({
    queryKey: ["/api/tasks", taskId, "subtasks"],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}/subtasks`);
      if (!res.ok) throw new Error("Failed to fetch subtasks");
      return res.json() as Promise<Subtask[]>;
    },
    enabled: !!taskId,
  });
}

export function useCreateSubtask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, title }: { taskId: number; title: string }) => {
      const res = await fetch(`/api/tasks/${taskId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Failed to create subtask");
      return res.json() as Promise<Subtask>;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "subtasks"] });
    },
  });
}

export function useUpdateSubtask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, taskId, ...updates }: { id: number; taskId: number; completed?: boolean; title?: string }) => {
      const res = await fetch(`/api/subtasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update subtask");
      return res.json() as Promise<Subtask>;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "subtasks"] });
    },
  });
}

export function useDeleteSubtask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, taskId }: { id: number; taskId: number }) => {
      const res = await fetch(`/api/subtasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete subtask");
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "subtasks"] });
    },
  });
}

// ========== TASK LABELS ==========

export function useTaskLabels() {
  return useQuery({
    queryKey: ["/api/labels"],
    queryFn: async () => {
      const res = await fetch("/api/labels");
      if (!res.ok) throw new Error("Failed to fetch labels");
      return res.json() as Promise<TaskLabel[]>;
    },
  });
}

export function useCreateTaskLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create label");
      return res.json() as Promise<TaskLabel>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
    },
  });
}

export function useDeleteTaskLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete label");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
    },
  });
}

export function useTaskLabelAssignments(taskId: number) {
  return useQuery({
    queryKey: ["/api/tasks", taskId, "labels"],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}/labels`);
      if (!res.ok) throw new Error("Failed to fetch task labels");
      return res.json() as Promise<TaskLabel[]>;
    },
    enabled: !!taskId,
  });
}

export function useAssignLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, labelId }: { taskId: number; labelId: number }) => {
      const res = await fetch(`/api/tasks/${taskId}/labels/${labelId}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to assign label");
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "labels"] });
    },
  });
}

export function useUnassignLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, labelId }: { taskId: number; labelId: number }) => {
      const res = await fetch(`/api/tasks/${taskId}/labels/${labelId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unassign label");
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "labels"] });
    },
  });
}
