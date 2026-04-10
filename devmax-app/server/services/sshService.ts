/**
 * SSH Deployment Service — Stub for standalone DevMax.
 * Replace with your actual SSH deployment implementation.
 *
 * In production, configure SSH_HOST, SSH_USER, SSH_KEY_PATH env vars
 * and implement the deployment logic for your infrastructure.
 */

class SshServiceStub {
  async executeCommand(cmd: string, _timeout?: number): Promise<string> {
    console.warn(`[SSH] Command not executed (no SSH configured): ${cmd.slice(0, 80)}...`);
    return "";
  }

  async writeRemoteFile(path: string, _content: string): Promise<void> {
    console.warn(`[SSH] Write not executed (no SSH configured): ${path}`);
  }

  async resolveGitHubToken(): Promise<string> {
    return process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || "";
  }

  async reserveProjectPorts(_projectId: string, _caller: string): Promise<{ stagingPort: number; productionPort: number }> {
    return { stagingPort: 3001, productionPort: 3002 };
  }

  async deployStagingApp(opts: Record<string, unknown>): Promise<{ success: boolean; stagingUrl: string }> {
    console.warn("[SSH] deployStagingApp stub called", opts);
    return { success: false, stagingUrl: "" };
  }

  async promoteToProduction(opts: Record<string, unknown>): Promise<{ success: boolean; productionUrl: string }> {
    console.warn("[SSH] promoteToProduction stub called", opts);
    return { success: false, productionUrl: "" };
  }

  async rollbackProduction(opts: Record<string, unknown>): Promise<{ success: boolean; productionUrl: string }> {
    console.warn("[SSH] rollbackProduction stub called", opts);
    return { success: false, productionUrl: "" };
  }

  async listProductionSnapshots(_slug: string): Promise<string[]> {
    return [];
  }

  async deployPlaceholderPages(_slug: string, _name: string): Promise<{ success: boolean }> {
    return { success: false };
  }

  async removePlaceholderPages(_slug: string): Promise<void> {}

  async verifyRepoAccess(_owner: string, _repo: string): Promise<{ hasAccess: boolean }> {
    return { hasAccess: false };
  }

  async setupVpsDeployKey(_owner: string, _repo: string): Promise<{ success: boolean }> {
    return { success: false };
  }

  async checkSslStatus(_domain: string): Promise<{ valid: boolean; expiresAt?: string }> {
    return { valid: false };
  }

  async setupSslAutoRenew(): Promise<{ success: boolean }> {
    return { success: false };
  }

  async diagnoseAndFixUrl(opts: Record<string, unknown>): Promise<{ success: boolean }> {
    console.warn("[SSH] diagnoseAndFixUrl stub called", opts);
    return { success: false };
  }

  apps = {
    deleteApp: async (_slug: string): Promise<{ success: boolean }> => {
      return { success: false };
    },
  };
}

export const sshService = new SshServiceStub();
