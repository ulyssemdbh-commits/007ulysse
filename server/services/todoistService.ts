/**
 * Todoist Service - Direct API
 * Manages tasks and projects in Todoist
 */

import { TodoistApi } from '@doist/todoist-api-typescript';
import { globalOptimizerService } from "./globalOptimizerService";
import { connectorBridge } from './connectorBridge';

async function getAccessToken(): Promise<string> {
  const conn = await connectorBridge.getTodoist();
  if (conn.source === 'none') {
    throw new Error('Todoist not configured. Set TODOIST_API_KEY or TODOIST_TOKEN.');
  }
  return conn.apiKey || conn.accessToken || '';
}

async function getUncachableTodoistClient(): Promise<TodoistApi> {
  const token = await getAccessToken();
  return new TodoistApi(token);
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string;
  projectName?: string;
  priority: number;
  due?: {
    date: string;
    string: string;
    isRecurring: boolean;
  };
  labels: string[];
  completed: boolean;
  url: string;
}

export interface TodoistProject {
  id: string;
  name: string;
  color: string;
  isFavorite: boolean;
  isInboxProject: boolean;
  url: string;
}

/**
 * Check if Todoist is connected and available
 */
export async function checkTodoistConnection(): Promise<boolean> {
  try {
    const api = await getUncachableTodoistClient();
    await api.getProjects();
    return true;
  } catch (error) {
    console.error('[Todoist] Connection check failed:', error);
    return false;
  }
}

/**
 * Get all projects (cached)
 */
export async function getProjects(): Promise<TodoistProject[]> {
  return globalOptimizerService.getOrFetch(
    "projects",
    "default",
    async () => {
      const api = await getUncachableTodoistClient();
      const response = await api.getProjects() as any;
      const projects = response?.results || response || [];
      
      return projects.map((p: any) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isFavorite: p.isFavorite || false,
        isInboxProject: p.isInboxProject || p.inboxProject || false,
        url: p.url
      }));
    },
    { customTTL: 2 * 60 * 1000 } // 2 min TTL
  );
}

/**
 * Get tasks from a project (or all tasks if no projectId) - cached
 */
export async function getTasks(projectId?: string): Promise<TodoistTask[]> {
  const cacheKey = projectId ? `tasks:${projectId}` : "tasks:all";
  
  return globalOptimizerService.getOrFetch(
    cacheKey,
    "default",
    async () => {
      const api = await getUncachableTodoistClient();
      
      const taskResponse = projectId 
        ? await api.getTasks({ projectId }) as any
        : await api.getTasks() as any;
      
      const tasks = taskResponse?.results || taskResponse || [];
      const projectsResponse = await api.getProjects() as any;
      const projects = projectsResponse?.results || projectsResponse || [];
      const projectMap = new Map(projects.map((p: any) => [p.id, p.name]));
      
      return tasks.map((t: any) => ({
        id: t.id,
        content: t.content,
        description: t.description || '',
        projectId: t.projectId,
        projectName: projectMap.get(t.projectId),
        priority: t.priority,
        due: t.due ? {
          date: t.due.date,
          string: t.due.string,
          isRecurring: t.due.isRecurring
        } : undefined,
        labels: t.labels || [],
        completed: t.isCompleted || !!t.completedAt,
        url: t.url
      }));
    },
    { customTTL: 60 * 1000 } // 1 min TTL
  );
}

/**
 * Invalidate todoist cache after mutations
 */
export function invalidateTodoistCache() {
  globalOptimizerService.invalidate("default", "tasks:all");
  globalOptimizerService.invalidate("default", "projects");
}

/**
 * Get tasks due today
 */
export async function getTasksDueToday(): Promise<TodoistTask[]> {
  const allTasks = await getTasks();
  const today = new Date().toISOString().split('T')[0];
  
  return allTasks.filter(t => 
    t.due?.date && t.due.date <= today && !t.completed
  );
}

/**
 * Get overdue tasks
 */
export async function getOverdueTasks(): Promise<TodoistTask[]> {
  const allTasks = await getTasks();
  const today = new Date().toISOString().split('T')[0];
  
  return allTasks.filter(t => 
    t.due?.date && t.due.date < today && !t.completed
  );
}

/**
 * Create a new task
 */
export async function createTask(params: {
  content: string;
  description?: string;
  projectId?: string;
  priority?: number;
  dueString?: string;
  labels?: string[];
}): Promise<TodoistTask | null> {
  try {
    const api = await getUncachableTodoistClient();
    
    const addParams: any = {
      content: params.content,
      priority: params.priority || 1
    };
    
    if (params.description) addParams.description = params.description;
    if (params.projectId) addParams.projectId = params.projectId;
    if (params.dueString) addParams.dueString = params.dueString;
    if (params.labels) addParams.labels = params.labels;
    
    const task = await api.addTask(addParams) as any;

    console.log(`[Todoist] Created task: ${params.content}`);
    
    return {
      id: task.id,
      content: task.content,
      description: task.description || '',
      projectId: task.projectId,
      priority: task.priority,
      due: task.due ? {
        date: task.due.date,
        string: task.due.string,
        isRecurring: task.due.isRecurring
      } : undefined,
      labels: task.labels || [],
      completed: task.isCompleted || !!task.completedAt,
      url: task.url
    };
  } catch (error) {
    console.error('[Todoist] Create task failed:', error);
    return null;
  }
}

/**
 * Complete a task
 */
export async function completeTask(taskId: string): Promise<boolean> {
  try {
    const api = await getUncachableTodoistClient();
    await api.closeTask(taskId);
    console.log(`[Todoist] Completed task: ${taskId}`);
    return true;
  } catch (error) {
    console.error('[Todoist] Complete task failed:', error);
    return false;
  }
}

/**
 * Reopen a completed task
 */
export async function reopenTask(taskId: string): Promise<boolean> {
  try {
    const api = await getUncachableTodoistClient();
    await api.reopenTask(taskId);
    console.log(`[Todoist] Reopened task: ${taskId}`);
    return true;
  } catch (error) {
    console.error('[Todoist] Reopen task failed:', error);
    return false;
  }
}

/**
 * Update a task
 */
export async function updateTask(
  taskId: string,
  updates: {
    content?: string;
    description?: string;
    priority?: number;
    dueString?: string;
    labels?: string[];
  }
): Promise<boolean> {
  try {
    const api = await getUncachableTodoistClient();
    const updateParams: any = {};
    if (updates.content) updateParams.content = updates.content;
    if (updates.description) updateParams.description = updates.description;
    if (updates.priority) updateParams.priority = updates.priority;
    if (updates.dueString) updateParams.dueString = updates.dueString;
    if (updates.labels) updateParams.labels = updates.labels;
    
    await api.updateTask(taskId, updateParams);
    console.log(`[Todoist] Updated task: ${taskId}`);
    return true;
  } catch (error) {
    console.error('[Todoist] Update task failed:', error);
    return false;
  }
}

/**
 * Delete a task
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  try {
    const api = await getUncachableTodoistClient();
    await api.deleteTask(taskId);
    console.log(`[Todoist] Deleted task: ${taskId}`);
    return true;
  } catch (error) {
    console.error('[Todoist] Delete task failed:', error);
    return false;
  }
}

/**
 * Create a new project
 */
export async function createProject(name: string, color?: string): Promise<TodoistProject | null> {
  try {
    const api = await getUncachableTodoistClient();
    const project = await api.addProject({ name, color }) as any;
    
    console.log(`[Todoist] Created project: ${name}`);
    
    return {
      id: project.id,
      name: project.name,
      color: project.color,
      isFavorite: project.isFavorite || false,
      isInboxProject: project.isInboxProject || project.inboxProject || false,
      url: project.url
    };
  } catch (error) {
    console.error('[Todoist] Create project failed:', error);
    return null;
  }
}

/**
 * Get all labels
 */
export async function getLabels(): Promise<{ id: string; name: string; color: string }[]> {
  const api = await getUncachableTodoistClient();
  const response = await api.getLabels() as any;
  const labels = response?.results || response || [];
  
  return labels.map((l: any) => ({
    id: l.id,
    name: l.name,
    color: l.color
  }));
}

/**
 * Get task count summary
 */
export async function getTaskSummary(): Promise<{
  total: number;
  dueToday: number;
  overdue: number;
  highPriority: number;
}> {
  const allTasks = await getTasks();
  const today = new Date().toISOString().split('T')[0];
  
  const activeTasks = allTasks.filter(t => !t.completed);
  
  return {
    total: activeTasks.length,
    dueToday: activeTasks.filter(t => t.due?.date === today).length,
    overdue: activeTasks.filter(t => t.due?.date && t.due.date < today).length,
    highPriority: activeTasks.filter(t => t.priority >= 3).length
  };
}

export default {
  checkTodoistConnection,
  getProjects,
  getTasks,
  getTasksDueToday,
  getOverdueTasks,
  createTask,
  completeTask,
  reopenTask,
  updateTask,
  deleteTask,
  createProject,
  getLabels,
  getTaskSummary
};
