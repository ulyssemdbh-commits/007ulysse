import { createContext, useContext } from "react";
import { QueryClient } from "@tanstack/react-query";

export const API = "/api/devmax/ops";
export const AUTH_API = "/api/devmax";
export const DEVMAX_TOKEN_KEY = "devmax_session_token";

export const devmaxQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

export function getDevmaxToken(): string | null {
  return localStorage.getItem(DEVMAX_TOKEN_KEY);
}

export function devmaxFetch(url: string, options?: RequestInit, projectId?: string): Promise<Response> {
  const token = getDevmaxToken();
  const headers: Record<string, string> = {
    ...options?.headers as Record<string, string>,
    "x-devmax-token": token || "",
  };
  if (projectId) {
    headers["x-devmax-project"] = projectId;
  }
  return fetch(url, {
    ...options,
    headers,
  });
}

export async function devmaxApiRequest(method: string, url: string, body?: any, projectId?: string): Promise<any> {
  const res = await devmaxFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }, projectId);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

export function generateFingerprint(): string {
  let fp = localStorage.getItem("devmax_fp");
  if (!fp) {
    try {
      fp = crypto.randomUUID();
    } catch {
      fp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }
    localStorage.setItem("devmax_fp", fp);
  }
  return fp;
}

export interface DevmaxProject {
  id: string;
  name: string;
  description?: string;
  repo_owner?: string;
  repo_name?: string;
  repo_url?: string;
  staging_repo_owner?: string;
  staging_repo_name?: string;
  staging_repo_url?: string;
  storage_mode?: "github" | "db" | "hybrid";
  deploy_slug?: string;
  created_at?: string;
  updated_at?: string;
  staging_url?: string;
  production_url?: string;
  staging_port?: number;
  production_port?: number;
  environment?: string;
  last_deployed_at?: string;
  last_promoted_at?: string;
  cicd_enabled?: boolean;
  cicd_branch?: string;
  webhook_id?: string;
  status?: string;
  _triggerAudit?: boolean;
}

export interface DevmaxUser {
  id: string;
  username: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  avatarUrl?: string;
  githubUsername?: string;
  phone?: string;
  bio?: string;
  timezone?: string;
  preferredLanguage?: string;
  tenantSlug?: string;
}

export const DevmaxAuthContext = createContext<{
  isAuthenticated: boolean;
  sessionId: string | null;
  currentUser: DevmaxUser | null;
  logout: () => void;
  activeProject: DevmaxProject | null;
  setActiveProject: (p: DevmaxProject | null) => void;
}>({ isAuthenticated: false, sessionId: null, currentUser: null, logout: () => {}, activeProject: null, setActiveProject: () => {} });

export function useDevmaxAuth() {
  return useContext(DevmaxAuthContext);
}

export interface Branch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface Commit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
  html_url: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  head: { ref: string };
  base: { ref: string };
  merged_at: string | null;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  event: string;
  created_at: string;
  html_url: string;
  run_number: number;
}

export interface TreeItem {
  path: string;
  type: string;
  size?: number;
  sha: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolActivity?: ToolActivity[];
  attachments?: { name: string; type: string; preview?: string }[];
}

export interface ToolActivity {
  tool: string;
  label: string;
  status: "executing" | "done" | "error";
  durationMs?: number;
}

export function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}j`;
  return `${Math.floor(days / 30)}mo`;
}
