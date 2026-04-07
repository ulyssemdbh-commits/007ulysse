import { storage } from "../storage";
import type { Task, InsertTask } from "@shared/schema";

type KanbanActionType = 
  | 'list_tasks' 
  | 'list_project_tasks'
  | 'list_context_tasks'
  | 'create_task' 
  | 'update_task'
  | 'complete_task'
  | 'delete_task'
  | 'list_projects'
  | 'task_summary';

// Valid context values for task categorization
type TaskContext = 'sugu' | 'suguval' | 'foot' | 'perso' | 'dev' | 'travail' | 'famille';

interface KanbanListTasksAction {
  type: 'list_tasks';
}

interface KanbanListProjectTasksAction {
  type: 'list_project_tasks';
  projectName: string;
}

interface KanbanListContextTasksAction {
  type: 'list_context_tasks';
  context: TaskContext;
}

// Types aligned with DB schema: status = todo|in_progress|done, priority = low|medium|high
type TaskStatus = 'todo' | 'in_progress' | 'done';
type TaskPriority = 'low' | 'medium' | 'high';

interface KanbanCreateTaskAction {
  type: 'create_task';
  title: string;
  description?: string;
  projectName?: string;
  priority?: TaskPriority;
  dueDate?: string;
  status?: TaskStatus;
  context?: TaskContext;
}

interface KanbanUpdateTaskAction {
  type: 'update_task';
  taskTitle?: string;
  taskId?: number;
  title?: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  status?: TaskStatus;
}

interface KanbanCompleteTaskAction {
  type: 'complete_task';
  taskTitle?: string;
  taskId?: number;
}

interface KanbanDeleteTaskAction {
  type: 'delete_task';
  taskTitle?: string;
  taskId?: number;
}

interface KanbanListProjectsAction {
  type: 'list_projects';
}

interface KanbanTaskSummaryAction {
  type: 'task_summary';
}

type KanbanAction = 
  | KanbanListTasksAction 
  | KanbanListProjectTasksAction
  | KanbanListContextTasksAction
  | KanbanCreateTaskAction 
  | KanbanUpdateTaskAction
  | KanbanCompleteTaskAction
  | KanbanDeleteTaskAction
  | KanbanListProjectsAction
  | KanbanTaskSummaryAction;

interface KanbanActionResult {
  success: boolean;
  type: KanbanActionType;
  data?: any;
  summary: string;
  error?: string;
}

const LIST_TASKS_PATTERN = /\[KANBAN_TACHES\](?!\s*:)/gi;
const LIST_PROJECT_TASKS_PATTERN = /\[KANBAN_TACHES\s*:\s*projet\s*=\s*"?([^"\]]+)"?\]/gi;
const LIST_CONTEXT_TASKS_PATTERN = /\[KANBAN_TACHES\s*:\s*context\s*=\s*"?(sugu|suguval|foot|perso|dev|travail|famille)"?\]/gi;
const CREATE_TASK_PATTERN = /\[KANBAN_CREER\s*:\s*titre\s*=\s*"?([^"\],]+)"?(?:\s*,\s*description\s*=\s*"?([^"\],]+)"?)?(?:\s*,\s*projet\s*=\s*"?([^"\],]+)"?)?(?:\s*,\s*priorite\s*=\s*(low|medium|high|urgent|basse|moyenne|haute|urgente))?(?:\s*,\s*echeance\s*=\s*"?([^"\],]+)"?)?(?:\s*,\s*statut\s*=\s*(backlog|todo|in_progress|review|done|afaire|encours|revision|termine))?(?:\s*,\s*context\s*=\s*"?(sugu|suguval|foot|perso|dev|travail|famille)"?)?\]/gi;
// Updated patterns to support both tache= (title) and id= (numeric ID)
const UPDATE_TASK_PATTERN = /\[KANBAN_MODIFIER\s*:\s*(?:tache\s*=\s*"?([^"\],]+)"?|id\s*=\s*(\d+))(?:\s*,\s*titre\s*=\s*"?([^"\],]+)"?)?(?:\s*,\s*description\s*=\s*"?([^"\],]+)"?)?(?:\s*,\s*priorite\s*=\s*(low|medium|high|urgent|basse|moyenne|haute|urgente))?(?:\s*,\s*echeance\s*=\s*"?([^"\],]+)"?)?(?:\s*,\s*statut\s*=\s*(backlog|todo|in_progress|review|done|afaire|encours|revision|termine))?\]/gi;
const COMPLETE_TASK_PATTERN = /\[KANBAN_FAIT\s*:\s*(?:tache\s*=\s*"?([^"\]]+)"?|id\s*=\s*(\d+))\]/gi;
const DELETE_TASK_PATTERN = /\[KANBAN_SUPPRIMER\s*:\s*(?:tache\s*=\s*"?([^"\]]+)"?|id\s*=\s*(\d+))\]/gi;
const LIST_PROJECTS_PATTERN = /\[KANBAN_PROJETS\]/gi;
const TASK_SUMMARY_PATTERN = /\[KANBAN_RESUME\]/gi;

// Maps input priority to DB-compatible values (low, medium, high)
// 'urgent' is mapped to 'high' since DB doesn't support 'urgent'
function normalizePriority(priority: string): TaskPriority {
  const normalized = priority.toLowerCase();
  switch (normalized) {
    case 'basse':
    case 'low':
      return 'low';
    case 'moyenne':
    case 'medium':
      return 'medium';
    case 'haute':
    case 'high':
    case 'urgente':
    case 'urgent': // Maps to 'high' - DB only supports low/medium/high
      return 'high';
    default:
      return 'medium';
  }
}

// Maps input status to DB-compatible values (todo, in_progress, done)
// 'backlog' and 'review' are mapped since DB doesn't support them
function normalizeStatus(status: string): TaskStatus {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case 'backlog': // Maps to 'todo' - DB only supports todo/in_progress/done
    case 'afaire':
    case 'todo':
      return 'todo';
    case 'revision':
    case 'review': // Maps to 'in_progress' - DB only supports todo/in_progress/done
    case 'encours':
    case 'in_progress':
      return 'in_progress';
    case 'termine':
    case 'done':
      return 'done';
    default:
      return 'todo';
  }
}

function normalizeToMidnight(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function parseDateString(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const lower = dateStr.toLowerCase().trim();
  const now = new Date();
  
  if (lower === "aujourd'hui" || lower === "today") {
    return normalizeToMidnight(now);
  }
  if (lower === "demain" || lower === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return normalizeToMidnight(tomorrow);
  }
  if (lower === "apres-demain" || lower === "après-demain") {
    const afterTomorrow = new Date(now);
    afterTomorrow.setDate(afterTomorrow.getDate() + 2);
    return normalizeToMidnight(afterTomorrow);
  }
  if (lower.includes("semaine prochaine") || lower.includes("next week")) {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return normalizeToMidnight(nextWeek);
  }
  
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return normalizeToMidnight(parsed);
  }
  
  return null;
}

export function parseKanbanActions(response: string): KanbanAction[] {
  const actions: KanbanAction[] = [];
  let match;

  LIST_PROJECT_TASKS_PATTERN.lastIndex = 0;
  while ((match = LIST_PROJECT_TASKS_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'list_project_tasks',
      projectName: match[1]?.trim()
    });
  }

  LIST_CONTEXT_TASKS_PATTERN.lastIndex = 0;
  while ((match = LIST_CONTEXT_TASKS_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'list_context_tasks',
      context: match[1]?.trim() as TaskContext
    });
  }

  LIST_TASKS_PATTERN.lastIndex = 0;
  while ((match = LIST_TASKS_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'list_tasks' });
  }

  CREATE_TASK_PATTERN.lastIndex = 0;
  while ((match = CREATE_TASK_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'create_task',
      title: match[1]?.trim(),
      description: match[2]?.trim(),
      projectName: match[3]?.trim(),
      priority: match[4] ? normalizePriority(match[4]) : undefined,
      dueDate: match[5]?.trim(),
      status: match[6] ? normalizeStatus(match[6]) : undefined,
      context: match[7]?.trim() as TaskContext | undefined
    });
  }

  // UPDATE pattern: match[1]=taskTitle, match[2]=taskId, match[3]=newTitle, match[4]=desc, match[5]=priority, match[6]=dueDate, match[7]=status
  UPDATE_TASK_PATTERN.lastIndex = 0;
  while ((match = UPDATE_TASK_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'update_task',
      taskTitle: match[1]?.trim(),
      taskId: match[2] ? parseInt(match[2], 10) : undefined,
      title: match[3]?.trim(),
      description: match[4]?.trim(),
      priority: match[5] ? normalizePriority(match[5]) : undefined,
      dueDate: match[6]?.trim(),
      status: match[7] ? normalizeStatus(match[7]) : undefined
    });
  }

  // COMPLETE pattern: match[1]=taskTitle, match[2]=taskId
  COMPLETE_TASK_PATTERN.lastIndex = 0;
  while ((match = COMPLETE_TASK_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'complete_task',
      taskTitle: match[1]?.trim(),
      taskId: match[2] ? parseInt(match[2], 10) : undefined
    });
  }

  // DELETE pattern: match[1]=taskTitle, match[2]=taskId
  DELETE_TASK_PATTERN.lastIndex = 0;
  while ((match = DELETE_TASK_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'delete_task',
      taskTitle: match[1]?.trim(),
      taskId: match[2] ? parseInt(match[2], 10) : undefined
    });
  }

  LIST_PROJECTS_PATTERN.lastIndex = 0;
  while ((match = LIST_PROJECTS_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'list_projects' });
  }

  TASK_SUMMARY_PATTERN.lastIndex = 0;
  while ((match = TASK_SUMMARY_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'task_summary' });
  }

  return actions;
}

interface TaskSearchResult {
  task?: Task;
  multiple?: Task[];
  error?: string;
}

async function findTaskByTitle(userId: number, title: string): Promise<TaskSearchResult> {
  const allTasks = await storage.getTasks(userId);
  const lowerTitle = title.toLowerCase().trim();
  
  if (!lowerTitle) {
    return { error: "Titre de tâche vide" };
  }
  
  const exactMatch = allTasks.find(t => t.title.toLowerCase() === lowerTitle);
  if (exactMatch) {
    return { task: exactMatch };
  }
  
  const partialMatches = allTasks.filter(t => t.title.toLowerCase().includes(lowerTitle));
  
  if (partialMatches.length === 0) {
    return { error: "Aucune tâche trouvée" };
  }
  
  if (partialMatches.length === 1) {
    return { task: partialMatches[0] };
  }
  
  return { multiple: partialMatches };
}

async function findProjectByName(userId: number, name: string): Promise<number | undefined> {
  const projects = await storage.getProjects(userId);
  const lowerName = name.toLowerCase();
  const project = projects.find(p => p.name.toLowerCase().includes(lowerName));
  return project?.id;
}

export async function executeKanbanActions(actions: KanbanAction[], userId: number): Promise<KanbanActionResult[]> {
  const results: KanbanActionResult[] = [];

  for (const action of actions) {
    try {
      const result = await executeKanbanAction(action, userId);
      results.push(result);
    } catch (error) {
      console.error(`[KANBAN_ACTION] Error executing ${action.type}:`, error);
      results.push({
        success: false,
        type: action.type,
        summary: `Erreur lors de l'exécution de ${action.type}: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

async function executeKanbanAction(action: KanbanAction, userId: number): Promise<KanbanActionResult> {
  switch (action.type) {
    case 'list_tasks':
      return await executeListTasks(userId);
    
    case 'list_project_tasks':
      return await executeListProjectTasks(userId, action.projectName);
    
    case 'list_context_tasks':
      return await executeListContextTasks(userId, action.context);
    
    case 'create_task':
      return await executeCreateTask(userId, action);
    
    case 'update_task':
      return await executeUpdateTask(userId, action);
    
    case 'complete_task':
      return await executeCompleteTask(userId, action);
    
    case 'delete_task':
      return await executeDeleteTask(userId, action);
    
    case 'list_projects':
      return await executeListProjects(userId);
    
    case 'task_summary':
      return await executeTaskSummary(userId);
    
    default:
      return {
        success: false,
        type: 'list_tasks',
        summary: 'Action non reconnue',
        error: 'Unknown action type'
      };
  }
}

async function executeListTasks(userId: number): Promise<KanbanActionResult> {
  const tasks = await storage.getTasks(userId);
  
  if (tasks.length === 0) {
    return {
      success: true,
      type: 'list_tasks',
      data: [],
      summary: "Aucune tâche trouvée dans le Kanban."
    };
  }

  const formatted = tasks.map(t => {
    const priority = t.priority ? ` [${t.priority.toUpperCase()}]` : '';
    const due = t.dueDate ? ` - Echeance: ${new Date(t.dueDate).toLocaleDateString('fr-FR')}` : '';
    const ctx = t.context ? ` {${t.context}}` : '';
    const src = t.source && t.source !== 'manual' ? ` (${t.source})` : '';
    return `- [ID:${t.id}] ${t.title}${priority} (${t.status})${ctx}${due}${src}`;
  }).join('\n');

  return {
    success: true,
    type: 'list_tasks',
    data: tasks,
    summary: `**${tasks.length} tache(s) dans le Kanban:**\n${formatted}`
  };
}

async function executeListProjectTasks(userId: number, projectName: string): Promise<KanbanActionResult> {
  const projectId = await findProjectByName(userId, projectName);
  
  if (!projectId) {
    return {
      success: false,
      type: 'list_project_tasks',
      summary: `Projet "${projectName}" non trouvé.`,
      error: 'Project not found'
    };
  }

  const tasks = await storage.getTasks(userId, projectId);
  
  if (tasks.length === 0) {
    return {
      success: true,
      type: 'list_project_tasks',
      data: [],
      summary: `Aucune tâche trouvée dans le projet "${projectName}".`
    };
  }

  const formatted = tasks.map(t => {
    const priority = t.priority ? ` [${t.priority.toUpperCase()}]` : '';
    const due = t.dueDate ? ` - Échéance: ${new Date(t.dueDate).toLocaleDateString('fr-FR')}` : '';
    return `- ${t.title}${priority} (${t.status})${due}`;
  }).join('\n');

  return {
    success: true,
    type: 'list_project_tasks',
    data: tasks,
    summary: `**${tasks.length} tâche(s) dans "${projectName}":**\n${formatted}`
  };
}

async function executeListContextTasks(userId: number, context: TaskContext): Promise<KanbanActionResult> {
  const allTasks = await storage.getTasks(userId);
  const tasks = allTasks.filter(t => t.context === context);
  
  if (tasks.length === 0) {
    return {
      success: true,
      type: 'list_context_tasks',
      data: [],
      summary: `Aucune tache trouvee dans le context "${context}".`
    };
  }

  const formatted = tasks.map(t => {
    const priority = t.priority ? ` [${t.priority.toUpperCase()}]` : '';
    const due = t.dueDate ? ` - Echeance: ${new Date(t.dueDate).toLocaleDateString('fr-FR')}` : '';
    const src = t.source ? ` (${t.source})` : '';
    return `- [ID:${t.id}] ${t.title}${priority} (${t.status})${due}${src}`;
  }).join('\n');

  return {
    success: true,
    type: 'list_context_tasks',
    data: tasks,
    summary: `**${tasks.length} tache(s) dans le context "${context}":**\n${formatted}`
  };
}

async function executeCreateTask(userId: number, action: KanbanCreateTaskAction): Promise<KanbanActionResult> {
  const title = action.title?.trim();
  
  if (!title) {
    return {
      success: false,
      type: 'create_task',
      summary: "Le titre de la tâche est requis.",
      error: 'Title is required'
    };
  }
  
  let projectId: number | undefined;
  
  if (action.projectName) {
    projectId = await findProjectByName(userId, action.projectName);
    if (!projectId) {
      const project = await storage.createProject({
        name: action.projectName,
        description: '',
        userId
      });
      projectId = project.id;
      console.log(`[KANBAN_ACTION] Created project "${action.projectName}" for task`);
    }
  }

  const dueDate = action.dueDate ? parseDateString(action.dueDate) : null;

  const taskData: InsertTask & { userId: number } = {
    title: title,
    description: action.description?.trim() || '',
    projectId: projectId || null,
    priority: action.priority || 'medium',
    status: action.status || 'todo',
    dueDate: dueDate,
    source: 'kanban_ai',
    context: action.context || null,
    userId
  };

  const task = await storage.createTask(taskData);
  
  console.log(`[KANBAN_ACTION] Created task "${task.title}" (ID: ${task.id}) for user ${userId}`);

  return {
    success: true,
    type: 'create_task',
    data: task,
    summary: `Tâche créée: **${task.title}** (${task.status}, priorité ${task.priority})${dueDate ? ` - Échéance: ${dueDate.toLocaleDateString('fr-FR')}` : ''}`
  };
}

async function executeUpdateTask(userId: number, action: KanbanUpdateTaskAction): Promise<KanbanActionResult> {
  let task: Task | undefined;
  
  // If taskId is provided, use it directly
  if (action.taskId) {
    const allTasks = await storage.getTasks(userId);
    task = allTasks.find(t => t.id === action.taskId);
    if (!task) {
      return {
        success: false,
        type: 'update_task',
        summary: `Tâche avec ID ${action.taskId} non trouvée.`,
        error: 'Task not found'
      };
    }
  } else if (action.taskTitle) {
    // Otherwise, search by title
    const searchResult = await findTaskByTitle(userId, action.taskTitle);
    
    if (searchResult.error) {
      return {
        success: false,
        type: 'update_task',
        summary: `Tâche "${action.taskTitle}" non trouvée: ${searchResult.error}`,
        error: searchResult.error
      };
    }
    
    if (searchResult.multiple) {
      const taskList = searchResult.multiple.map(t => `- ${t.title} (ID: ${t.id})`).join('\n');
      return {
        success: false,
        type: 'update_task',
        summary: `Plusieurs tâches correspondent à "${action.taskTitle}":\n${taskList}\nUtilise le titre exact ou l'ID (id=123).`,
        error: 'Multiple tasks found'
      };
    }
    
    task = searchResult.task!;
  } else {
    return {
      success: false,
      type: 'update_task',
      summary: 'Aucune tâche spécifiée. Utilise tache= ou id=.',
      error: 'No task specified'
    };
  }
  
  if (!action.title && !action.description && !action.priority && !action.status && !action.dueDate) {
    return {
      success: false,
      type: 'update_task',
      summary: `Aucune modification spécifiée pour "${task.title}".`,
      error: 'No updates specified'
    };
  }

  const updates: Partial<InsertTask> = {};
  
  if (action.title) updates.title = action.title;
  if (action.description) updates.description = action.description;
  if (action.priority) updates.priority = action.priority;
  if (action.status) updates.status = action.status;
  if (action.dueDate) {
    const parsed = parseDateString(action.dueDate);
    if (parsed) updates.dueDate = parsed;
  }

  const updated = await storage.updateTask(task.id, userId, updates);
  
  if (!updated) {
    return {
      success: false,
      type: 'update_task',
      summary: `Erreur lors de la mise à jour de "${action.taskTitle}".`,
      error: 'Update failed'
    };
  }

  console.log(`[KANBAN_ACTION] Updated task "${updated.title}" (ID: ${updated.id}) for user ${userId}`);

  const changes: string[] = [];
  if (action.title) changes.push(`titre: ${action.title}`);
  if (action.status) changes.push(`statut: ${action.status}`);
  if (action.priority) changes.push(`priorité: ${action.priority}`);
  if (action.dueDate) changes.push(`échéance: ${action.dueDate}`);

  return {
    success: true,
    type: 'update_task',
    data: updated,
    summary: `Tâche mise à jour: **${updated.title}** - ${changes.join(', ')}`
  };
}

async function executeCompleteTask(userId: number, action: KanbanCompleteTaskAction): Promise<KanbanActionResult> {
  let task: Task | undefined;
  
  // If taskId is provided, use it directly
  if (action.taskId) {
    const allTasks = await storage.getTasks(userId);
    task = allTasks.find(t => t.id === action.taskId);
    if (!task) {
      return {
        success: false,
        type: 'complete_task',
        summary: `Tâche avec ID ${action.taskId} non trouvée.`,
        error: 'Task not found'
      };
    }
  } else if (action.taskTitle) {
    // Otherwise, search by title
    const searchResult = await findTaskByTitle(userId, action.taskTitle);
    
    if (searchResult.error) {
      return {
        success: false,
        type: 'complete_task',
        summary: `Tâche "${action.taskTitle}" non trouvée: ${searchResult.error}`,
        error: searchResult.error
      };
    }
    
    if (searchResult.multiple) {
      const taskList = searchResult.multiple.map(t => `- ${t.title} (ID: ${t.id})`).join('\n');
      return {
        success: false,
        type: 'complete_task',
        summary: `Plusieurs tâches correspondent à "${action.taskTitle}":\n${taskList}\nUtilise le titre exact ou l'ID (id=123).`,
        error: 'Multiple tasks found'
      };
    }
    
    task = searchResult.task!;
  } else {
    return {
      success: false,
      type: 'complete_task',
      summary: 'Aucune tâche spécifiée. Utilise tache= ou id=.',
      error: 'No task specified'
    };
  }

  const updated = await storage.updateTask(task.id, userId, { status: 'done' });
  
  if (!updated) {
    return {
      success: false,
      type: 'complete_task',
      summary: `Erreur lors de la complétion de "${task.title}".`,
      error: 'Update failed'
    };
  }

  console.log(`[KANBAN_ACTION] Completed task "${updated.title}" (ID: ${updated.id}) for user ${userId}`);

  return {
    success: true,
    type: 'complete_task',
    data: updated,
    summary: `Tâche terminée: **${updated.title}**`
  };
}

async function executeDeleteTask(userId: number, action: KanbanDeleteTaskAction): Promise<KanbanActionResult> {
  let task: Task | undefined;
  
  // If taskId is provided, use it directly
  if (action.taskId) {
    const allTasks = await storage.getTasks(userId);
    task = allTasks.find(t => t.id === action.taskId);
    if (!task) {
      return {
        success: false,
        type: 'delete_task',
        summary: `Tâche avec ID ${action.taskId} non trouvée.`,
        error: 'Task not found'
      };
    }
  } else if (action.taskTitle) {
    // Otherwise, search by title
    const searchResult = await findTaskByTitle(userId, action.taskTitle);
    
    if (searchResult.error) {
      return {
        success: false,
        type: 'delete_task',
        summary: `Tâche "${action.taskTitle}" non trouvée: ${searchResult.error}`,
        error: searchResult.error
      };
    }
    
    if (searchResult.multiple) {
      const taskList = searchResult.multiple.map(t => `- ${t.title} (ID: ${t.id})`).join('\n');
      return {
        success: false,
        type: 'delete_task',
        summary: `Plusieurs tâches correspondent à "${action.taskTitle}":\n${taskList}\nUtilise le titre exact ou l'ID (id=123).`,
        error: 'Multiple tasks found'
      };
    }
    
    task = searchResult.task!;
  } else {
    return {
      success: false,
      type: 'delete_task',
      summary: 'Aucune tâche spécifiée. Utilise tache= ou id=.',
      error: 'No task specified'
    };
  }

  await storage.deleteTask(task.id, userId);
  
  console.log(`[KANBAN_ACTION] Deleted task "${task.title}" (ID: ${task.id}) for user ${userId}`);

  return {
    success: true,
    type: 'delete_task',
    data: { id: task.id, title: task.title },
    summary: `Tâche supprimée: **${task.title}**`
  };
}

async function executeListProjects(userId: number): Promise<KanbanActionResult> {
  const projects = await storage.getProjects(userId);
  
  if (projects.length === 0) {
    return {
      success: true,
      type: 'list_projects',
      data: [],
      summary: "Aucun projet trouvé."
    };
  }

  const formatted = projects.map(p => `- ${p.name}${p.description ? `: ${p.description}` : ''}`).join('\n');

  return {
    success: true,
    type: 'list_projects',
    data: projects,
    summary: `**${projects.length} projet(s):**\n${formatted}`
  };
}

async function executeTaskSummary(userId: number): Promise<KanbanActionResult> {
  const tasks = await storage.getTasks(userId);
  const projects = await storage.getProjects(userId);

  // DB only supports: todo, in_progress, done (no backlog/review)
  const byStatus = {
    todo: tasks.filter(t => t.status === 'todo').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    done: tasks.filter(t => t.status === 'done').length
  };

  // DB only supports: low, medium, high (no urgent - 'urgent' maps to 'high')
  const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done');
  
  // Use normalizeToMidnight for consistent date comparison
  const today = normalizeToMidnight(new Date());
  const overdue = tasks.filter(t => {
    if (!t.dueDate || t.status === 'done') return false;
    const due = normalizeToMidnight(new Date(t.dueDate));
    return due < today;
  });

  let summary = `**Resume Kanban:**\n`;
  summary += `- Total: ${tasks.length} taches dans ${projects.length} projets\n`;
  summary += `- A faire: ${byStatus.todo} | En cours: ${byStatus.in_progress} | Termine: ${byStatus.done}\n`;
  
  if (highPriority.length > 0) {
    summary += `- **${highPriority.length} tache(s) haute priorite:** ${highPriority.map(t => t.title).join(', ')}\n`;
  }
  if (overdue.length > 0) {
    summary += `- **${overdue.length} tache(s) en retard:** ${overdue.map(t => t.title).join(', ')}\n`;
  }

  return {
    success: true,
    type: 'task_summary',
    data: { tasks, projects, byStatus, highPriority, overdue },
    summary
  };
}

export function formatKanbanCapabilities(): string {
  return `[KANBAN INTERNE - Gestion des taches]
Tu peux gerer les taches du Kanban interne avec ces commandes:

LISTER:
- [KANBAN_TACHES] - Liste toutes les taches
- [KANBAN_TACHES: projet="nom"] - Liste les taches d'un projet
- [KANBAN_TACHES: context="sugu"] - Liste les taches d'un contexte
- [KANBAN_PROJETS] - Liste tous les projets
- [KANBAN_RESUME] - Resume du Kanban

CREER:
- [KANBAN_CREER: titre="Ma tache"] - Cree une tache simple
- [KANBAN_CREER: titre="Ma tache", description="Details", projet="Mon Projet", priorite=haute, echeance="demain", statut=todo, context=sugu]

MODIFIER (par titre ou ID):
- [KANBAN_MODIFIER: tache="titre existant", statut=in_progress]
- [KANBAN_MODIFIER: id=123, priorite=high, echeance="2025-02-15"]

COMPLETER/SUPPRIMER (par titre ou ID):
- [KANBAN_FAIT: tache="titre"] ou [KANBAN_FAIT: id=123] - Marque comme terminee
- [KANBAN_SUPPRIMER: tache="titre"] ou [KANBAN_SUPPRIMER: id=123] - Supprime la tache

IMPORTANT: Pour les taches avec titres similaires, utilise l'ID (id=123) pour eviter les ambiguites.

Valeurs possibles:
- priorite: low/basse, medium/moyenne, high/haute (urgent est converti en high)
- statut: todo/afaire, in_progress/encours, done/termine
- echeance: "aujourd'hui", "demain", "semaine prochaine", "2025-02-15"
- context: sugu, suguval, foot, perso, dev, travail, famille

NOTE: Les taches creees par l'IA ont source="kanban_ai" pour les distinguer des taches manuelles.`;
}
