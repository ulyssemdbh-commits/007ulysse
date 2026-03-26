export interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  homepage: string | null;
  owner?: { login: string };
  default_branch: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
  pushed_at: string;
  has_pages: boolean;
  languages?: Record<string, number>;
}

export interface Branch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface Commit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
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
  updated_at: string;
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

export interface DeployedApp {
  name: string;
  domain: string | null;
  port: number | null;
  ssl: boolean;
  status: string;
  cpu: number;
  memory: string;
  uptime: string | null;
  restarts: number;
  appDir: string;
  type: "node" | "static";
}
