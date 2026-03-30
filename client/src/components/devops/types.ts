export const API = "/api/devmax/ops";
export const REPO_URL = "https://github.com/ulyssemdbh-commits/devmax";

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
