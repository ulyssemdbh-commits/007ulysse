import { VoiceState, VoiceError, ERROR_MESSAGES } from "./types";

type VoiceAction = 
  | { type: "UNLOCK" }
  | { type: "UNLOCK_SUCCESS" }
  | { type: "UNLOCK_FAIL"; error: string }
  | { type: "START_LISTENING" }
  | { type: "LISTENING_STARTED" }
  | { type: "STOP_LISTENING" }
  | { type: "PROCESS_AUDIO" }
  | { type: "PROCESS_COMPLETE" }
  | { type: "START_SPEAKING" }
  | { type: "STOP_SPEAKING" }
  | { type: "SPEAKING_COMPLETE" }
  | { type: "ERROR"; error: string }
  | { type: "RECOVER" }
  | { type: "RESET" }
  | { type: "TIMEOUT"; fromState: VoiceState };

interface FSMContext {
  state: VoiceState;
  error: VoiceError | null;
  degradedMode: boolean;
  failureCount: number;
  stateEnteredAt: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

const STATE_TIMEOUTS: Record<VoiceState, number> = {
  idle: 0,
  unlocking: 10000,
  listening: 60000,
  processing: 30000,
  speaking: 120000,
  error: 30000,
};

const VALID_TRANSITIONS: Record<VoiceState, VoiceAction["type"][]> = {
  idle: ["UNLOCK", "START_LISTENING", "START_SPEAKING", "ERROR", "RESET"],
  unlocking: ["UNLOCK_SUCCESS", "UNLOCK_FAIL", "ERROR", "RESET", "TIMEOUT"],
  listening: ["STOP_LISTENING", "PROCESS_AUDIO", "START_SPEAKING", "ERROR", "RESET", "TIMEOUT"],
  processing: ["PROCESS_COMPLETE", "ERROR", "RESET", "TIMEOUT"],
  speaking: ["STOP_SPEAKING", "SPEAKING_COMPLETE", "ERROR", "RESET", "TIMEOUT"],
  error: ["RECOVER", "RESET", "START_LISTENING", "START_SPEAKING", "TIMEOUT"],
};

const MAX_FAILURES_BEFORE_DEGRADED = 3;

export function createVoiceFSM() {
  let context: FSMContext = {
    state: "idle",
    error: null,
    degradedMode: false,
    failureCount: 0,
    stateEnteredAt: Date.now(),
    timeoutId: null,
  };

  const listeners = new Set<(ctx: FSMContext) => void>();
  const transitionLog: Array<{ from: VoiceState; to: VoiceState; action: string; timestamp: number }> = [];

  function notify() {
    listeners.forEach(listener => listener(context));
  }

  function clearStateTimeout() {
    if (context.timeoutId) {
      clearTimeout(context.timeoutId);
      context.timeoutId = null;
    }
  }

  function setStateTimeout(state: VoiceState) {
    clearStateTimeout();
    const timeout = STATE_TIMEOUTS[state];
    if (timeout > 0) {
      context.timeoutId = setTimeout(() => {
        console.warn(`[VoiceFSM] State "${state}" timed out after ${timeout}ms - auto-resetting`);
        transition({ type: "TIMEOUT", fromState: state });
      }, timeout);
    }
  }

  function logTransition(from: VoiceState, to: VoiceState, action: string) {
    transitionLog.push({ from, to, action, timestamp: Date.now() });
    if (transitionLog.length > 50) {
      transitionLog.shift();
    }
  }

  function canTransition(action: VoiceAction["type"]): boolean {
    return VALID_TRANSITIONS[context.state].includes(action);
  }

  function transition(action: VoiceAction): FSMContext {
    if (!canTransition(action.type)) {
      console.warn(`[VoiceFSM] Invalid transition: ${context.state} -> ${action.type}`);
      return context;
    }

    const prevState = context.state;

    switch (action.type) {
      case "UNLOCK":
        context = { ...context, state: "unlocking", error: null };
        break;

      case "UNLOCK_SUCCESS":
        context = { ...context, state: "idle", failureCount: 0 };
        break;

      case "UNLOCK_FAIL":
        context = {
          ...context,
          state: "error",
          error: ERROR_MESSAGES[action.error] || {
            code: action.error,
            message: action.error,
            userMessage: "Erreur d'initialisation audio.",
            recoverable: true,
          },
          failureCount: context.failureCount + 1,
        };
        break;

      case "START_LISTENING":
        context = { ...context, state: "listening", error: null };
        break;

      case "LISTENING_STARTED":
        break;

      case "STOP_LISTENING":
        context = { ...context, state: "idle" };
        break;

      case "PROCESS_AUDIO":
        context = { ...context, state: "processing" };
        break;

      case "PROCESS_COMPLETE":
        context = { ...context, state: "idle" };
        break;

      case "START_SPEAKING":
        context = { ...context, state: "speaking", error: null };
        break;

      case "STOP_SPEAKING":
      case "SPEAKING_COMPLETE":
        context = { ...context, state: "idle" };
        break;

      case "ERROR":
        const errorInfo = ERROR_MESSAGES[action.error] || {
          code: action.error,
          message: action.error,
          userMessage: "Une erreur s'est produite.",
          recoverable: true,
        };
        const newFailureCount = context.failureCount + 1;
        context = {
          ...context,
          state: "error",
          error: errorInfo,
          failureCount: newFailureCount,
          degradedMode: newFailureCount >= MAX_FAILURES_BEFORE_DEGRADED,
        };
        break;

      case "RECOVER":
        if (context.error?.recoverable) {
          context = { ...context, state: "idle", error: null };
        }
        break;

      case "RESET":
        context = {
          ...context,
          state: "idle",
          error: null,
          failureCount: 0,
          stateEnteredAt: Date.now(),
        };
        break;

      case "TIMEOUT":
        const timeoutError: VoiceError = {
          code: "timeout",
          message: `State ${action.fromState} timed out`,
          userMessage: "Délai dépassé. Réessayez.",
          recoverable: true,
        };
        context = {
          ...context,
          state: "idle",
          error: timeoutError,
          stateEnteredAt: Date.now(),
        };
        break;
    }

    if (prevState !== context.state) {
      console.log(`[VoiceFSM] ${prevState} -> ${context.state}`, action.type);
      logTransition(prevState, context.state, action.type);
      context.stateEnteredAt = Date.now();
      setStateTimeout(context.state);
    }

    notify();
    return context;
  }

  function getState(): VoiceState {
    return context.state;
  }

  function getContext(): FSMContext {
    return { ...context };
  }

  function subscribe(listener: (ctx: FSMContext) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function isDegraded(): boolean {
    return context.degradedMode;
  }

  function resetDegradedMode() {
    context = { ...context, degradedMode: false, failureCount: 0 };
    notify();
  }

  function getTransitionLog() {
    return [...transitionLog];
  }

  function getStateDuration(): number {
    return Date.now() - context.stateEnteredAt;
  }

  function forceReset() {
    console.warn("[VoiceFSM] Force reset triggered");
    clearStateTimeout();
    context = {
      state: "idle",
      error: null,
      degradedMode: context.degradedMode,
      failureCount: 0,
      stateEnteredAt: Date.now(),
      timeoutId: null,
    };
    notify();
  }

  function destroy() {
    clearStateTimeout();
    listeners.clear();
  }

  return {
    transition,
    getState,
    getContext,
    subscribe,
    canTransition,
    isDegraded,
    resetDegradedMode,
    getTransitionLog,
    getStateDuration,
    forceReset,
    destroy,
  };
}

export type VoiceFSM = ReturnType<typeof createVoiceFSM>;
