import * as todoistService from "./todoistService";

type TodoistActionType = 'list_tasks' | 'list_today' | 'list_overdue' | 'create_task' | 
                         'complete_task' | 'list_projects' | 'create_project' | 'task_summary';

interface TodoistListTasksAction {
  type: 'list_tasks';
  projectId?: string;
}

interface TodoistListTodayAction {
  type: 'list_today';
}

interface TodoistListOverdueAction {
  type: 'list_overdue';
}

interface TodoistCreateTaskAction {
  type: 'create_task';
  content: string;
  description?: string;
  dueString?: string;
  priority?: number;
  projectName?: string;
}

interface TodoistCompleteTaskAction {
  type: 'complete_task';
  taskName: string;
}

interface TodoistListProjectsAction {
  type: 'list_projects';
}

interface TodoistCreateProjectAction {
  type: 'create_project';
  name: string;
  color?: string;
}

interface TodoistTaskSummaryAction {
  type: 'task_summary';
}

type TodoistAction = TodoistListTasksAction | TodoistListTodayAction | TodoistListOverdueAction |
                     TodoistCreateTaskAction | TodoistCompleteTaskAction | TodoistListProjectsAction |
                     TodoistCreateProjectAction | TodoistTaskSummaryAction;

interface TodoistActionResult {
  success: boolean;
  type: TodoistActionType;
  data?: any;
  summary: string;
  error?: string;
}

const LIST_TASKS_PATTERN = /\[TODOIST_TACHES(?:\s*:\s*projet\s*=\s*"?([^"\]]+)"?)?\]/gi;
const LIST_TODAY_PATTERN = /\[TODOIST_AUJOURD'?HUI\]/gi;
const LIST_OVERDUE_PATTERN = /\[TODOIST_RETARD\]/gi;
const CREATE_TASK_PATTERN = /\[TODOIST_CREER\s*:\s*tache\s*=\s*"?([^"\],]+)"?(?:\s*,\s*echeance\s*=\s*"?([^"\],]+)"?)?(?:\s*,\s*priorite\s*=\s*(\d))?(?:\s*,\s*description\s*=\s*"?([^"\]]+)"?)?\]/gi;
const COMPLETE_TASK_PATTERN = /\[TODOIST_FAIT\s*:\s*tache\s*=\s*"?([^"\]]+)"?\]/gi;
const LIST_PROJECTS_PATTERN = /\[TODOIST_PROJETS\]/gi;
const CREATE_PROJECT_PATTERN = /\[TODOIST_CREER_PROJET\s*:\s*nom\s*=\s*"?([^"\]]+)"?\]/gi;
const TASK_SUMMARY_PATTERN = /\[TODOIST_RESUME\]/gi;

function formatPriority(priority: number): string {
  switch (priority) {
    case 4: return '🔴 P1';
    case 3: return '🟠 P2';
    case 2: return '🟡 P3';
    default: return '⚪ P4';
  }
}

function formatDue(due: { date: string; string: string; isRecurring: boolean } | undefined): string {
  if (!due) return '';
  const recurring = due.isRecurring ? ' 🔄' : '';
  return ` - 📅 ${due.string}${recurring}`;
}

export function parseTodoistActions(response: string): TodoistAction[] {
  const actions: TodoistAction[] = [];

  let match;

  LIST_TASKS_PATTERN.lastIndex = 0;
  while ((match = LIST_TASKS_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'list_tasks',
      projectId: match[1]?.trim()
    });
  }

  LIST_TODAY_PATTERN.lastIndex = 0;
  while ((match = LIST_TODAY_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'list_today' });
  }

  LIST_OVERDUE_PATTERN.lastIndex = 0;
  while ((match = LIST_OVERDUE_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'list_overdue' });
  }

  CREATE_TASK_PATTERN.lastIndex = 0;
  while ((match = CREATE_TASK_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'create_task',
      content: match[1].trim(),
      dueString: match[2]?.trim(),
      priority: match[3] ? parseInt(match[3]) : undefined,
      description: match[4]?.trim()
    });
  }

  COMPLETE_TASK_PATTERN.lastIndex = 0;
  while ((match = COMPLETE_TASK_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'complete_task',
      taskName: match[1].trim()
    });
  }

  LIST_PROJECTS_PATTERN.lastIndex = 0;
  while ((match = LIST_PROJECTS_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'list_projects' });
  }

  CREATE_PROJECT_PATTERN.lastIndex = 0;
  while ((match = CREATE_PROJECT_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'create_project',
      name: match[1].trim()
    });
  }

  TASK_SUMMARY_PATTERN.lastIndex = 0;
  while ((match = TASK_SUMMARY_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'task_summary' });
  }

  return actions;
}

async function executeListTasksAction(action: TodoistListTasksAction): Promise<TodoistActionResult> {
  try {
    const tasks = await todoistService.getTasks(action.projectId);
    const activeTasks = tasks.filter(t => !t.completed);
    
    return {
      success: true,
      type: 'list_tasks',
      data: activeTasks,
      summary: `${activeTasks.length} tâche(s) active(s)`
    };
  } catch (error) {
    return {
      success: false,
      type: 'list_tasks',
      summary: `Erreur lors de la récupération des tâches`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeListTodayAction(): Promise<TodoistActionResult> {
  try {
    const tasks = await todoistService.getTasksDueToday();
    
    return {
      success: true,
      type: 'list_today',
      data: tasks,
      summary: `${tasks.length} tâche(s) pour aujourd'hui`
    };
  } catch (error) {
    return {
      success: false,
      type: 'list_today',
      summary: `Erreur lors de la récupération des tâches du jour`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeListOverdueAction(): Promise<TodoistActionResult> {
  try {
    const tasks = await todoistService.getOverdueTasks();
    
    return {
      success: true,
      type: 'list_overdue',
      data: tasks,
      summary: `${tasks.length} tâche(s) en retard`
    };
  } catch (error) {
    return {
      success: false,
      type: 'list_overdue',
      summary: `Erreur lors de la récupération des tâches en retard`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeCreateTaskAction(action: TodoistCreateTaskAction): Promise<TodoistActionResult> {
  try {
    let projectId: string | undefined;
    
    if (action.projectName) {
      const projects = await todoistService.getProjects();
      const project = projects.find(p => 
        p.name.toLowerCase().includes(action.projectName!.toLowerCase())
      );
      if (project) projectId = project.id;
    }
    
    const task = await todoistService.createTask({
      content: action.content,
      description: action.description,
      dueString: action.dueString,
      priority: action.priority,
      projectId
    });
    
    if (!task) {
      return {
        success: false,
        type: 'create_task',
        summary: `Impossible de créer la tâche "${action.content}"`,
        error: 'Task creation returned null'
      };
    }
    
    return {
      success: true,
      type: 'create_task',
      data: task,
      summary: `Tâche "${action.content}" créée avec succès`
    };
  } catch (error) {
    return {
      success: false,
      type: 'create_task',
      summary: `Erreur lors de la création de la tâche`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeCompleteTaskAction(action: TodoistCompleteTaskAction): Promise<TodoistActionResult> {
  try {
    const tasks = await todoistService.getTasks();
    const task = tasks.find(t => 
      t.content.toLowerCase().includes(action.taskName.toLowerCase()) && !t.completed
    );
    
    if (!task) {
      return {
        success: false,
        type: 'complete_task',
        summary: `Tâche "${action.taskName}" introuvable`,
        error: 'Task not found'
      };
    }
    
    const success = await todoistService.completeTask(task.id);
    
    return {
      success,
      type: 'complete_task',
      data: task,
      summary: success ? `Tâche "${task.content}" marquée comme terminée` : `Échec de la complétion`
    };
  } catch (error) {
    return {
      success: false,
      type: 'complete_task',
      summary: `Erreur lors de la complétion de la tâche`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeListProjectsAction(): Promise<TodoistActionResult> {
  try {
    const projects = await todoistService.getProjects();
    
    return {
      success: true,
      type: 'list_projects',
      data: projects,
      summary: `${projects.length} projet(s) Todoist`
    };
  } catch (error) {
    return {
      success: false,
      type: 'list_projects',
      summary: `Erreur lors de la récupération des projets`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeCreateProjectAction(action: TodoistCreateProjectAction): Promise<TodoistActionResult> {
  try {
    const project = await todoistService.createProject(action.name, action.color);
    
    if (!project) {
      return {
        success: false,
        type: 'create_project',
        summary: `Impossible de créer le projet "${action.name}"`,
        error: 'Project creation returned null'
      };
    }
    
    return {
      success: true,
      type: 'create_project',
      data: project,
      summary: `Projet "${action.name}" créé avec succès`
    };
  } catch (error) {
    return {
      success: false,
      type: 'create_project',
      summary: `Erreur lors de la création du projet`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeTaskSummaryAction(): Promise<TodoistActionResult> {
  try {
    const summary = await todoistService.getTaskSummary();
    
    return {
      success: true,
      type: 'task_summary',
      data: summary,
      summary: `${summary.total} tâches actives, ${summary.dueToday} aujourd'hui, ${summary.overdue} en retard`
    };
  } catch (error) {
    return {
      success: false,
      type: 'task_summary',
      summary: `Erreur lors du calcul du résumé`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function executeActions(actions: TodoistAction[]): Promise<TodoistActionResult[]> {
  const results: TodoistActionResult[] = [];

  for (const action of actions) {
    let result: TodoistActionResult;

    switch (action.type) {
      case 'list_tasks':
        result = await executeListTasksAction(action);
        break;
      case 'list_today':
        result = await executeListTodayAction();
        break;
      case 'list_overdue':
        result = await executeListOverdueAction();
        break;
      case 'create_task':
        result = await executeCreateTaskAction(action);
        break;
      case 'complete_task':
        result = await executeCompleteTaskAction(action);
        break;
      case 'list_projects':
        result = await executeListProjectsAction();
        break;
      case 'create_project':
        result = await executeCreateProjectAction(action);
        break;
      case 'task_summary':
        result = await executeTaskSummaryAction();
        break;
      default:
        result = {
          success: false,
          type: 'list_tasks',
          summary: 'Action Todoist non reconnue',
          error: 'Unknown action type'
        };
    }

    results.push(result);
  }

  return results;
}

export function formatResultForUser(result: TodoistActionResult): string {
  if (!result.success) {
    return `\n\n**Todoist - Erreur**: ${result.summary}${result.error ? ` (${result.error})` : ''}\n`;
  }

  let output = '\n\n';

  switch (result.type) {
    case 'list_tasks':
    case 'list_today':
    case 'list_overdue':
      const title = result.type === 'list_today' ? "Tâches du jour" :
                    result.type === 'list_overdue' ? "Tâches en retard" : "Tâches";
      output += `**Todoist - ${title}**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data?.length > 0) {
        for (const task of result.data.slice(0, 15)) {
          const priority = formatPriority(task.priority);
          const due = formatDue(task.due);
          const project = task.projectName ? ` [${task.projectName}]` : '';
          output += `- ${priority} ${task.content}${project}${due}\n`;
        }
        if (result.data.length > 15) {
          output += `\n_...et ${result.data.length - 15} autres tâches_\n`;
        }
      } else {
        output += `_Aucune tâche_\n`;
      }
      break;

    case 'create_task':
      output += `**Todoist - Tâche créée**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data) {
        const priority = formatPriority(result.data.priority);
        const due = formatDue(result.data.due);
        output += `- ${priority} ${result.data.content}${due}\n`;
        output += `  [Ouvrir dans Todoist](${result.data.url})\n`;
      }
      break;

    case 'complete_task':
      output += `**Todoist - Tâche terminée**\n`;
      output += `✅ ${result.summary}\n`;
      break;

    case 'list_projects':
      output += `**Todoist - Projets**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data?.length > 0) {
        for (const project of result.data) {
          const star = project.isFavorite ? ' ⭐' : '';
          const inbox = project.isInboxProject ? ' (Inbox)' : '';
          output += `- 📁 **${project.name}**${star}${inbox}\n`;
          output += `  [Ouvrir](${project.url})\n`;
        }
      }
      break;

    case 'create_project':
      output += `**Todoist - Projet créé**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data) {
        output += `- 📁 **${result.data.name}**\n`;
        output += `  [Ouvrir dans Todoist](${result.data.url})\n`;
      }
      break;

    case 'task_summary':
      output += `**Todoist - Résumé**\n\n`;
      
      if (result.data) {
        output += `📊 **${result.data.total}** tâches actives\n`;
        output += `📅 **${result.data.dueToday}** pour aujourd'hui\n`;
        output += `⚠️ **${result.data.overdue}** en retard\n`;
        output += `🔴 **${result.data.highPriority}** haute priorité\n`;
      }
      break;

    default:
      output += `**Todoist**\n${result.summary}\n`;
  }

  return output;
}

export const todoistActionService = {
  parseTodoistActions,
  executeActions,
  formatResultForUser
};
