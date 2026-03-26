import { emitTaskProgress, type TaskProgress } from "./realtimeSync";

export interface TaskStep {
  name: string;
  weight: number;
}

export interface TaskTracker {
  taskId: string;
  userId: number;
  steps: TaskStep[];
  currentStepIndex: number;
  startTime: number;
  stepStartTime: number;
  stepTimes: number[];
}

const activeTasks = new Map<string, TaskTracker>();

export const AI_CHAT_STEPS: TaskStep[] = [
  { name: "Analyse du message", weight: 5 },
  { name: "Chargement du contexte mémoire", weight: 10 },
  { name: "Recherche web", weight: 25 },
  { name: "Analyse des emails", weight: 15 },
  { name: "Vérification du calendrier", weight: 10 },
  { name: "Génération de la réponse IA", weight: 30 },
  { name: "Traitement des actions", weight: 5 },
];

// Dynamic step builder based on what's actually needed for the request
export function buildDynamicChatSteps(options: {
  needsEmail?: boolean;
  needsCalendar?: boolean;
  needsWebSearch?: boolean;
  needsSportsData?: boolean;
}): TaskStep[] {
  const steps: TaskStep[] = [
    { name: "Analyse du message", weight: 5 },
    { name: "Chargement du contexte", weight: 10 },
  ];
  
  if (options.needsWebSearch !== false) {
    steps.push({ name: "Recherche d'informations", weight: 20 });
  }
  
  if (options.needsEmail) {
    steps.push({ name: "Analyse des emails", weight: 15 });
  }
  
  if (options.needsCalendar !== false) {
    steps.push({ name: "Vérification du calendrier", weight: 8 });
  }
  
  if (options.needsSportsData) {
    steps.push({ name: "Données sportives", weight: 12 });
  }
  
  steps.push({ name: "Génération de la réponse IA", weight: 35 });
  steps.push({ name: "Traitement des actions", weight: 5 });
  
  return steps;
}

export const HOMEWORK_STEPS: TaskStep[] = [
  { name: "Préparation de la tâche", weight: 10 },
  { name: "Exécution du homework", weight: 70 },
  { name: "Sauvegarde des résultats", weight: 20 },
];

export const FILE_GENERATION_STEPS: TaskStep[] = [
  { name: "Préparation du contenu", weight: 20 },
  { name: "Génération du fichier", weight: 60 },
  { name: "Upload et sauvegarde", weight: 20 },
];

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function startTask(userId: number, steps: TaskStep[], existingTaskId?: string): string {
  const taskId = existingTaskId || generateTaskId();
  
  const tracker: TaskTracker = {
    taskId,
    userId,
    steps,
    currentStepIndex: 0,
    startTime: Date.now(),
    stepStartTime: Date.now(),
    stepTimes: [],
  };
  
  activeTasks.set(taskId, tracker);
  
  emitProgress(tracker);
  
  console.log(`[ProgressTracker] Started task ${taskId} for user ${userId} with ${steps.length} steps`);
  return taskId;
}

export function advanceStep(taskId: string): void {
  const tracker = activeTasks.get(taskId);
  if (!tracker) return;
  
  const stepTime = Date.now() - tracker.stepStartTime;
  tracker.stepTimes.push(stepTime);
  
  tracker.currentStepIndex++;
  tracker.stepStartTime = Date.now();
  
  if (tracker.currentStepIndex < tracker.steps.length) {
    emitProgress(tracker);
  }
}

export function updateStep(taskId: string, stepIndex: number): void {
  const tracker = activeTasks.get(taskId);
  if (!tracker) return;
  
  if (stepIndex !== tracker.currentStepIndex) {
    const stepTime = Date.now() - tracker.stepStartTime;
    tracker.stepTimes.push(stepTime);
    tracker.currentStepIndex = stepIndex;
    tracker.stepStartTime = Date.now();
  }
  
  emitProgress(tracker);
}

export function completeTask(taskId: string): void {
  const tracker = activeTasks.get(taskId);
  if (!tracker) return;
  
  const progress: TaskProgress = {
    taskId,
    stage: "complete",
    percentage: 100,
    currentStep: "Terminé",
    totalSteps: tracker.steps.length,
    currentStepIndex: tracker.steps.length,
  };
  
  emitTaskProgress(tracker.userId, progress);
  activeTasks.delete(taskId);
  
  console.log(`[ProgressTracker] Completed task ${taskId}`);
}

export function failTask(taskId: string, error?: string): void {
  const tracker = activeTasks.get(taskId);
  if (!tracker) return;
  
  const progress: TaskProgress = {
    taskId,
    stage: "error",
    percentage: tracker.currentStepIndex / tracker.steps.length * 100,
    currentStep: error || "Erreur",
    totalSteps: tracker.steps.length,
    currentStepIndex: tracker.currentStepIndex,
  };
  
  emitTaskProgress(tracker.userId, progress);
  activeTasks.delete(taskId);
  
  console.log(`[ProgressTracker] Failed task ${taskId}: ${error}`);
}

function emitProgress(tracker: TaskTracker): void {
  const { steps, currentStepIndex, stepTimes, startTime, userId, taskId } = tracker;
  
  let completedWeight = 0;
  for (let i = 0; i < currentStepIndex; i++) {
    completedWeight += steps[i].weight;
  }
  
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
  const percentage = Math.round((completedWeight / totalWeight) * 100);
  
  let estimatedTimeRemaining: number | undefined;
  if (stepTimes.length > 0) {
    const avgStepTime = stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length;
    const remainingSteps = steps.length - currentStepIndex;
    estimatedTimeRemaining = Math.round(avgStepTime * remainingSteps / 1000);
  } else if (currentStepIndex === 0) {
    estimatedTimeRemaining = Math.round(steps.length * 2);
  }
  
  const currentStep = steps[currentStepIndex]?.name || "En cours...";
  
  const progress: TaskProgress = {
    taskId,
    stage: "processing",
    percentage,
    estimatedTimeRemaining,
    currentStep,
    totalSteps: steps.length,
    currentStepIndex: currentStepIndex + 1,
  };
  
  emitTaskProgress(userId, progress);
}

export function getActiveTask(taskId: string): TaskTracker | undefined {
  return activeTasks.get(taskId);
}

export function getActiveTasksForUser(userId: number): TaskTracker[] {
  return Array.from(activeTasks.values()).filter(t => t.userId === userId);
}
