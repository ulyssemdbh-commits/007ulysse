import { execSync } from "child_process";
import * as fs from "fs";
import { SSH_HOST, SSH_PORT, SSH_USER, SSH_PASSWORD, isLocalServer, MAX_RETRIES, RETRY_DELAY, sleep } from "./helpers";

function sshExecOnce(command: string, timeoutMs: number): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise(async (resolve) => {
    let resolved = false;
    const safeResolve = (val: { success: boolean; output: string; error?: string }) => {
      if (!resolved) { resolved = true; resolve(val); }
    };
    try {
      const { Client } = await import("ssh2");
      const conn = new Client();
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        try { conn.end(); } catch {}
        safeResolve({ success: false, output: stdout, error: "SSH command timeout" });
      }, timeoutMs);

      conn.on("ready", () => {
        conn.exec(command, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            try { conn.end(); } catch {}
            safeResolve({ success: false, output: "", error: err.message });
            return;
          }
          stream.on("close", (code: number) => {
            clearTimeout(timer);
            try { conn.end(); } catch {}
            safeResolve({ success: code === 0, output: stdout.trim(), error: stderr.trim() || undefined });
          });
          stream.on("data", (data: Buffer) => { stdout += data.toString(); });
          stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        });
      });

      conn.on("error", (err: any) => {
        clearTimeout(timer);
        safeResolve({ success: false, output: "", error: `SSH connection error: ${err.message}` });
      });

      conn.on("close", () => {
        clearTimeout(timer);
        safeResolve({ success: false, output: stdout, error: stderr || "SSH connection closed unexpectedly" });
      });

      conn.connect({
        host: SSH_HOST,
        port: SSH_PORT,
        username: SSH_USER,
        password: SSH_PASSWORD,
        readyTimeout: 10000,
        keepaliveInterval: 5000,
      });
    } catch (err: any) {
      safeResolve({ success: false, output: "", error: `SSH init error: ${err.message}` });
    }
  });
}

async function sshExec(command: string, timeoutMs: number): Promise<{ success: boolean; output: string; error?: string }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await sshExecOnce(command, timeoutMs);
    if (result.success) return result;
    const isConnectionError = result.error?.includes("connection") || result.error?.includes("timeout") || result.error?.includes("ECONNREFUSED");
    if (!isConnectionError || attempt === MAX_RETRIES) return result;
    console.log(`[SSH] Retry ${attempt + 1}/${MAX_RETRIES} after connection error: ${result.error}`);
    await sleep(RETRY_DELAY * (attempt + 1));
  }
  return { success: false, output: "", error: "SSH max retries exceeded" };
}

function sshWriteFile(remotePath: string, content: string, timeoutMs: number): Promise<{ success: boolean; error?: string }> {
  return new Promise(async (resolve) => {
    let resolved = false;
    const safeResolve = (val: { success: boolean; error?: string }) => {
      if (!resolved) { resolved = true; resolve(val); }
    };
    try {
      const { Client } = await import("ssh2");
      const conn = new Client();
      const timer = setTimeout(() => {
        try { conn.end(); } catch {}
        safeResolve({ success: false, error: "SSH write timeout" });
      }, timeoutMs);

      conn.on("ready", () => {
        conn.sftp((err: any, sftp: any) => {
          if (err) {
            clearTimeout(timer);
            try { conn.end(); } catch {}
            safeResolve({ success: false, error: err.message });
            return;
          }
          sftp.writeFile(remotePath, content, (writeErr: any) => {
            clearTimeout(timer);
            try { conn.end(); } catch {}
            if (writeErr) {
              safeResolve({ success: false, error: writeErr.message });
            } else {
              safeResolve({ success: true });
            }
          });
        });
      });

      conn.on("error", (err: any) => {
        clearTimeout(timer);
        safeResolve({ success: false, error: `SSH connection error: ${err.message}` });
      });

      conn.on("close", () => {
        clearTimeout(timer);
        safeResolve({ success: false, error: "SSH connection closed during write" });
      });

      conn.connect({
        host: SSH_HOST,
        port: SSH_PORT,
        username: SSH_USER,
        password: SSH_PASSWORD,
        readyTimeout: 10000,
      });
    } catch (err: any) {
      safeResolve({ success: false, error: `SSH init error: ${err.message}` });
    }
  });
}

export type SSHService = {
  executeCommand(command: string, timeout?: number): Promise<{ success: boolean; output: string; error?: string }>;
  writeRemoteFile(remotePath: string, content: string, timeout?: number): Promise<{ success: boolean; error?: string }>;
  [key: string]: any;
};

export function createCoreMethods() {
  return {
    async writeRemoteFile(remotePath: string, content: string, timeout = 15000): Promise<{ success: boolean; error?: string }> {
      if (isLocalServer) {
        try {
          fs.writeFileSync(remotePath, content);
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
      return sshWriteFile(remotePath, content, timeout);
    },

    async executeCommand(command: string, timeout = 30000): Promise<{ success: boolean; output: string; error?: string }> {
      if (isLocalServer) {
        try {
          const output = execSync(command, { encoding: "utf8", timeout, maxBuffer: 5 * 1024 * 1024 }).trim();
          return { success: true, output };
        } catch (err: any) {
          return { success: false, output: err.stdout?.toString().trim() || "", error: err.stderr?.toString().trim() || err.message };
        }
      }
      return sshExec(command, timeout);
    },
  };
}
