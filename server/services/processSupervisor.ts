/**
 * Process Supervisor Module
 * Manages child process lifecycle for Piper TTS and Speaker Recognition services.
 * Extracted from index.ts for maintainability.
 */

import { spawn, ChildProcess } from "child_process";

interface SupervisedProcess {
  name: string;
  process: ChildProcess | null;
  restartAttempts: number;
  maxRestarts: number;
  restartWindowMs: number;
  firstCrashTime: number | null;
}

const supervisors: Map<string, SupervisedProcess> = new Map();

function createSupervisor(name: string, maxRestarts = 5, restartWindowMs = 10 * 60 * 1000): SupervisedProcess {
  const supervisor: SupervisedProcess = {
    name,
    process: null,
    restartAttempts: 0,
    maxRestarts,
    restartWindowMs,
    firstCrashTime: null,
  };
  supervisors.set(name, supervisor);
  return supervisor;
}

function startProcess(
  supervisor: SupervisedProcess,
  command: string,
  args: string[],
  env: Record<string, string>,
  restartDelayMs: number
): void {
  if (supervisor.process) {
    console.log(`[${supervisor.name}] Service already running`);
    return;
  }

  if (supervisor.restartAttempts >= supervisor.maxRestarts) {
    const now = Date.now();
    if (supervisor.firstCrashTime && now - supervisor.firstCrashTime < supervisor.restartWindowMs) {
      console.error(`[${supervisor.name}] Too many restart attempts (${supervisor.restartAttempts}/${supervisor.maxRestarts}) — paused`);
      return;
    } else {
      supervisor.restartAttempts = 0;
      supervisor.firstCrashTime = null;
    }
  }

  try {
    supervisor.process = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    supervisor.process.stdout?.on("data", (data) => {
      console.log(`[${supervisor.name}] ${data.toString().trim()}`);
    });

    supervisor.process.stderr?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes("WARNING")) {
        console.log(`[${supervisor.name}] ${msg}`);
      }
    });

    supervisor.process.on("close", (code) => {
      console.log(`[${supervisor.name}] Service exited with code ${code}`);
      supervisor.process = null;
      const now = Date.now();
      if (supervisor.firstCrashTime === null) supervisor.firstCrashTime = now;
      supervisor.restartAttempts++;
      if (code !== 0 && supervisor.restartAttempts <= supervisor.maxRestarts) {
        console.log(`[${supervisor.name}] Restarting in ${restartDelayMs / 1000}s (attempt ${supervisor.restartAttempts}/${supervisor.maxRestarts})...`);
        setTimeout(() => startProcess(supervisor, command, args, env, restartDelayMs), restartDelayMs);
      }
    });

    supervisor.process.on("error", (err) => {
      console.error(`[${supervisor.name}] Failed to start:`, err.message);
      supervisor.process = null;
    });

    console.log(`[${supervisor.name}] Service starting...`);
  } catch (error: any) {
    console.error(`[${supervisor.name}] Failed to start:`, error.message);
    supervisor.process = null;
  }
}

// Piper TTS
const piperSupervisor = createSupervisor("PiperTTS");

export function startPiperTTSService(): void {
  const pythonPath = process.env.PYTHON_PATH || "python3";
  startProcess(piperSupervisor, pythonPath, ["piper_tts/tts_service.py"], { PIPER_PORT: "5002", PYTHONUNBUFFERED: "1" }, 8000);
}

// Speaker Recognition
const speakerSupervisor = createSupervisor("Speaker");

export function startSpeakerService(): void {
  const pythonPath = process.env.PYTHON_PATH || "python3";
  startProcess(speakerSupervisor, pythonPath, ["speaker_recognition/speaker_service.py"], { SPEAKER_PORT: "5001" }, 5000);
}

export function shutdownAllProcesses(): void {
  for (const [name, supervisor] of supervisors) {
    if (supervisor.process) {
      try {
        supervisor.process.kill("SIGTERM");
        console.log(`[Shutdown] ${name} service terminated`);
      } catch (e) {
        console.error(`[Shutdown] Error killing ${name} service:`, (e as Error).message);
      }
    }
  }
}
