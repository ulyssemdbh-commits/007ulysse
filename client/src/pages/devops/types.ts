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

export interface Job {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  steps?: JobStep[];
}

export interface JobStep {
  name: string;
  conclusion: string | null;
  status: string;
}

export interface RunLogsState {
  runId: number;
  jobs: Job[];
  expandedJob: number | null;
  logs: Record<number, string>;
  logsLoading: Record<number, boolean>;
}

export interface FileData {
  content: string;
  sha?: string;
  isImage?: boolean;
  rawBase64?: string;
}

export interface CommitDiffData {
  sha: string;
  message: string;
  files: DiffFile[];
}

export interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface DgmTask {
  id: string;
  title: string;
  status: string;
}

export interface GhUser {
  login: string;
  avatar_url: string;
}

export function getErrMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
