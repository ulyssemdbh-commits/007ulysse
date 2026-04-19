import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from "crypto";
import { connectorBridge } from './connectorBridge';

const githubTokenScope = new AsyncLocalStorage<string>();

export function withGitHubToken<T>(token: string, fn: () => Promise<T>): Promise<T> {
  return githubTokenScope.run(token, fn);
}

function classifyGitHubError(status: number, parsed: any, endpoint: string): { code: string; details: Record<string, any>; suggestion: string } {
  const msg = (parsed.message || "").toLowerCase();
  
  if (status === 404) {
    if (endpoint.includes("/branches/")) return { code: "branch_not_found", details: { endpoint }, suggestion: "Vérifie le nom de la branche. Utilise list_branches pour voir les branches disponibles." };
    if (endpoint.includes("/contents/")) return { code: "file_not_found", details: { endpoint }, suggestion: "Le fichier n'existe pas. Utilise browse_files pour vérifier l'arborescence." };
    if (endpoint.includes("/pages")) return { code: "pages_not_enabled", details: { endpoint }, suggestion: "GitHub Pages n'est pas activé. Utilise enable_pages pour l'activer." };
    return { code: "not_found", details: { endpoint }, suggestion: "La ressource n'existe pas. Vérifie owner/repo." };
  }
  
  if (status === 409) {
    if (msg.includes("sha")) return { code: "sha_mismatch", details: { endpoint }, suggestion: "Le fichier a été modifié entre-temps (sha mismatch). Récupère la dernière version avec get_file puis réessaie." };
    if (msg.includes("merge conflict")) return { code: "merge_conflict", details: { endpoint }, suggestion: "Conflit de merge. Options: rebase la branche ou force un nouveau commit depuis la version distante." };
    if (msg.includes("empty")) return { code: "empty_repo", details: { endpoint }, suggestion: "Le repo est vide. Crée un premier commit avec un fichier (README.md par exemple)." };
    return { code: "conflict", details: { endpoint, message: msg }, suggestion: "Conflit détecté. Essaie de récupérer la dernière version puis réessaie." };
  }
  
  if (status === 422) {
    if (msg.includes("already exists")) return { code: "already_exists", details: { endpoint }, suggestion: "Cette ressource existe déjà. Utilise update au lieu de create." };
    if (msg.includes("reference")) return { code: "invalid_reference", details: { endpoint }, suggestion: "La référence (branche/sha) est invalide. Vérifie avec list_branches." };
    return { code: "validation_error", details: { endpoint, message: msg, errors: parsed.errors }, suggestion: "Les données envoyées sont invalides. Vérifie les paramètres." };
  }
  
  if (status === 403) {
    if (msg.includes("rate limit")) return { code: "rate_limited", details: { endpoint }, suggestion: "Limite d'API atteinte. Attends quelques minutes avant de réessayer." };
    return { code: "forbidden", details: { endpoint }, suggestion: "Pas les permissions nécessaires. Vérifie les droits d'accès au repo." };
  }
  
  if (status === 413) return { code: "payload_too_large", details: { endpoint }, suggestion: "Le fichier est trop gros. Pour les gros fichiers, utilise l'API Git blobs." };
  
  return { code: "unknown_error", details: { status, endpoint, message: msg }, suggestion: "Erreur inattendue. Réessaie ou vérifie les paramètres." };
}

export async function githubApi(endpoint: string, options: { method?: string; body?: any; headers?: Record<string, string>; rawResponse?: boolean; tokenOverride?: string } = {}) {
  let accessToken = options.tokenOverride || githubTokenScope.getStore();

  if (!accessToken) {
    const conn = await connectorBridge.getGitHub();
    if (conn.source !== 'direct' || !conn.accessToken) {
      throw new Error('GitHub not configured. Set GITHUB_TOKEN or GITHUB_PAT environment variable.');
    }
    accessToken = conn.accessToken;
  }

  let response: Response;

  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  // Validate token is HTTP-header safe (Latin-1 / printable ASCII).
  // Without this guard, a corrupted decrypted token (containing U+FFFD or any non-Latin1
  // char) would crash inside fetch() with the cryptic "Cannot convert argument to a
  // ByteString because the character at index N has a value of 65533" — which has
  // historically been mis-attributed to repo names or URLs by callers.
  if (typeof accessToken !== 'string' || accessToken.length < 10 || /[^\x20-\x7E]/.test(accessToken)) {
    throw new Error(
      'GitHub token is invalid or corrupted (contains non-ASCII bytes). ' +
      'This usually means the encryption key rotated and the stored token must be re-entered. ' +
      'Re-save the GitHub token in DevMax settings.'
    );
  }
  const headers: Record<string, string> = {
    'Accept': options.headers?.Accept || 'application/vnd.github+json',
    'Authorization': `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (options.body) headers['Content-Type'] = 'application/json';
  response = await fetch(url, {
    method: options.method || "GET",
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(errorText); } catch {}
    const ghError = new Error(`GitHub API error (${response.status}): ${parsed.message || errorText}`) as any;
    ghError.statusCode = response.status;
    ghError.githubMessage = parsed.message || errorText;
    ghError.documentationUrl = parsed.documentation_url;
    ghError.structured = classifyGitHubError(response.status, parsed, endpoint);
    throw ghError;
  }
  
  if (options.rawResponse) {
    return response.text();
  }
  return response.json();
}

export async function getAuthenticatedUser() {
  return githubApi("/user");
}

export async function listUserOrgs() {
  return githubApi("/user/orgs");
}

export async function listOrgRepos(org: string, options: { per_page?: number; sort?: string } = {}) {
  const params = new URLSearchParams();
  params.set("per_page", String(options.per_page || 100));
  params.set("sort", options.sort || "updated");
  return githubApi(`/orgs/${org}/repos?${params.toString()}`);
}

export async function listRepos(options: { sort?: string; per_page?: number; page?: number; type?: string } = {}) {
  const params = new URLSearchParams();
  if (options.sort) params.set("sort", options.sort);
  if (options.per_page) params.set("per_page", String(options.per_page));
  if (options.page) params.set("page", String(options.page));
  if (options.type) params.set("type", options.type);
  
  const userRepos = await githubApi(`/user/repos?${params.toString()}`);
  
  try {
    const orgs: any[] = await listUserOrgs();
    const orgRepoArrays = await Promise.all(
      orgs.map((org: any) => listOrgRepos(org.login).catch(() => []))
    );
    const orgRepos = orgRepoArrays.flat();
    
    const seen = new Set((userRepos as any[]).map((r: any) => r.full_name));
    const merged = [...userRepos as any[]];
    for (const repo of orgRepos) {
      if (!seen.has(repo.full_name)) {
        merged.push(repo);
        seen.add(repo.full_name);
      }
    }
    
    merged.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return merged;
  } catch (e) {
    return userRepos;
  }
}

export async function getRepo(owner: string, repo: string) {
  return githubApi(`/repos/${owner}/${repo}`);
}

export async function listBranches(owner: string, repo: string, per_page = 30) {
  return githubApi(`/repos/${owner}/${repo}/branches?per_page=${per_page}`);
}

export async function getBranch(owner: string, repo: string, branch: string) {
  return githubApi(`/repos/${owner}/${repo}/branches/${branch}`);
}

export async function createBranch(owner: string, repo: string, branchName: string, fromRef: string) {
  let sha = fromRef;
  if (!/^[0-9a-f]{40}$/i.test(fromRef)) {
    const branch = await getBranch(owner, repo, fromRef);
    sha = (branch as any).commit?.sha;
    if (!sha) throw new Error(`Cannot resolve SHA for branch '${fromRef}'`);
  }
  return githubApi(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branchName}`, sha }
  });
}

export async function getFileContent(owner: string, repo: string, path: string, ref?: string) {
  const params = ref ? `?ref=${ref}` : "";
  return githubApi(`/repos/${owner}/${repo}/contents/${path}${params}`);
}

export async function createOrUpdateFile(
  owner: string, repo: string, filePath: string,
  content: string, message: string, branch: string, sha?: string
) {
  const path = filePath;
  if (path.startsWith('.github/workflows/') && (path.endsWith('.yml') || path.endsWith('.yaml'))) {
    content = sanitizeWorkflowContent(content);
  }
  const base64Content = Buffer.from(content).toString("base64");
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existing = await getFileContent(owner, repo, path, branch);
      if ((existing as any)?.sha) {
        fileSha = (existing as any).sha;
      }
    } catch (e: any) {
    }
  }
  return githubApi(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: { message, content: base64Content, branch, ...(fileSha ? { sha: fileSha } : {}) }
  });
}

export async function createOrUpdateFileRaw(
  owner: string, repo: string, path: string,
  base64Content: string, message: string, branch: string, sha?: string
) {
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existing = await getFileContent(owner, repo, path, branch);
      if ((existing as any)?.sha) {
        fileSha = (existing as any).sha;
      }
    } catch (e: any) {
    }
  }
  return githubApi(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: { message, content: base64Content, branch, ...(fileSha ? { sha: fileSha } : {}) }
  });
}

export async function createPullRequest(
  owner: string, repo: string,
  title: string, body: string,
  head: string, base: string
) {
  return githubApi(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: { title, body, head, base }
  });
}

export async function listPullRequests(owner: string, repo: string, state = "open") {
  return githubApi(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=20`);
}

export async function getPullRequest(owner: string, repo: string, pullNumber: number) {
  return githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
}

export async function mergePullRequest(owner: string, repo: string, pullNumber: number, mergeMethod = "squash") {
  return githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, {
    method: "PUT",
    body: { merge_method: mergeMethod }
  });
}

export async function closePullRequest(owner: string, repo: string, pullNumber: number) {
  return githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`, {
    method: "PATCH",
    body: { state: "closed" }
  });
}

export async function createIssueComment(owner: string, repo: string, issueNumber: number, body: string) {
  return githubApi(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: { body }
  });
}

export async function listAllPullRequests(owner: string, repo: string, opts: { state?: "open" | "closed" | "all"; per_page?: number; page?: number } = {}) {
  const params = new URLSearchParams({
    state: opts.state || "open",
    per_page: String(opts.per_page || 100),
    page: String(opts.page || 1),
  });
  return githubApi(`/repos/${owner}/${repo}/pulls?${params.toString()}`);
}

export async function listCommits(owner: string, repo: string, branch?: string, per_page = 20, options?: { author?: string; since?: string; until?: string; path?: string }) {
  const params = new URLSearchParams({ per_page: String(per_page) });
  if (branch) params.set("sha", branch);
  if (options?.author) params.set("author", options.author);
  if (options?.since) params.set("since", options.since);
  if (options?.until) params.set("until", options.until);
  if (options?.path) params.set("path", options.path);
  return githubApi(`/repos/${owner}/${repo}/commits?${params.toString()}`);
}

export async function getTree(owner: string, repo: string, sha: string, recursive = true) {
  return githubApi(`/repos/${owner}/${repo}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`);
}

export async function listWorkflowRuns(owner: string, repo: string, per_page = 10) {
  return githubApi(`/repos/${owner}/${repo}/actions/runs?per_page=${per_page}`);
}

export async function listWorkflows(owner: string, repo: string) {
  return githubApi(`/repos/${owner}/${repo}/actions/workflows`);
}

export async function triggerWorkflow(owner: string, repo: string, workflowId: string | number, ref: string, inputs?: Record<string, string>) {
  return githubApi(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
    method: "POST",
    body: { ref, ...(inputs ? { inputs } : {}) }
  });
}

export async function getWorkflowRun(owner: string, repo: string, runId: number) {
  return githubApi(`/repos/${owner}/${repo}/actions/runs/${runId}`);
}

export async function rerunWorkflow(owner: string, repo: string, runId: number) {
  return githubApi(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, { method: "POST" });
}

export async function cancelWorkflowRun(owner: string, repo: string, runId: number) {
  return githubApi(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, { method: "POST" });
}

export async function getRepoLanguages(owner: string, repo: string) {
  return githubApi(`/repos/${owner}/${repo}/languages`);
}

function sanitizeWorkflowContent(content: string): string {
  if (!content.includes('npm ci') && !/uses:\s*actions\//.test(content)) return content;
  
  console.log(`[GitHubService] Sanitizing workflow: replacing npm ci / external actions`);
  return `name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        run: |
          git clone --depth 1 https://x-access-token:\${{ github.token }}@github.com/\${{ github.repository }}.git .
          if [ "\${{ github.event_name }}" = "pull_request" ]; then
            git fetch origin \${{ github.event.pull_request.head.sha }}
            git checkout \${{ github.event.pull_request.head.sha }}
          fi
      - name: Install
        run: npm install --legacy-peer-deps
      - name: Build
        run: npm run build --if-present
`;
}

export async function applyPatch(
  owner: string, repo: string, branch: string,
  files: Array<{ path: string; content: string }>,
  commitMessage: string
) {
  files = files.map(f => {
    if (f.path.startsWith('.github/workflows/') && (f.path.endsWith('.yml') || f.path.endsWith('.yaml'))) {
      return { ...f, content: sanitizeWorkflowContent(f.content) };
    }
    return f;
  });
  console.log(`[GitHubService] applyPatch: ${owner}/${repo}@${branch} — ${files.length} file(s)`);
  
  let branchData: any;
  try {
    branchData = await getBranch(owner, repo, branch);
  } catch (e: any) {
    throw new Error(`applyPatch step 1/5 FAILED (get branch '${branch}'): ${e.message}`);
  }
  const commitSha = branchData.commit.sha;
  const treeSha = branchData.commit.commit?.tree?.sha || commitSha;
  
  let blobs: any[];
  try {
    blobs = await Promise.all(
      files.map(async (file) => {
        const blob = await githubApi(`/repos/${owner}/${repo}/git/blobs`, {
          method: "POST",
          body: { content: file.content, encoding: "utf-8" }
        });
        return { path: file.path, sha: blob.sha, mode: "100644", type: "blob" };
      })
    );
  } catch (e: any) {
    throw new Error(`applyPatch step 2/5 FAILED (create blobs): ${e.message}`);
  }
  console.log(`[GitHubService] applyPatch: ${blobs.length} blob(s) created`);
  
  let tree: any;
  try {
    tree = await githubApi(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: { base_tree: treeSha, tree: blobs }
    });
  } catch (e: any) {
    throw new Error(`applyPatch step 3/5 FAILED (create tree): ${e.message}`);
  }
  
  let commit: any;
  try {
    commit = await githubApi(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: { message: commitMessage, tree: tree.sha, parents: [commitSha] }
    });
  } catch (e: any) {
    throw new Error(`applyPatch step 4/5 FAILED (create commit): ${e.message}`);
  }
  
  try {
    await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: { sha: commit.sha }
    });
  } catch (e: any) {
    throw new Error(`applyPatch step 5/5 FAILED (update ref to ${commit.sha?.slice(0, 7)}): ${e.message}`);
  }
  
  console.log(`[GitHubService] applyPatch SUCCESS: ${commit.sha?.slice(0, 7)} on ${branch}`);
  return { commit: commit.sha, message: commitMessage, filesChanged: files.length };
}

function computeGitBlobSha(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  const store = Buffer.concat([Buffer.from(header), content]);
  return crypto.createHash("sha1").update(store).digest("hex");
}

export interface SmartSyncResult {
  success: boolean;
  commitSha?: string;
  filesChanged: number;
  filesTotal: number;
  skipped: number;
  error?: string;
}

export async function smartSync(
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string | Buffer }>,
  commitMessage?: string
): Promise<SmartSyncResult> {
  files = files.map(f => {
    if (f.path.startsWith('.github/workflows/') && (f.path.endsWith('.yml') || f.path.endsWith('.yaml')) && typeof f.content === 'string') {
      return { ...f, content: sanitizeWorkflowContent(f.content) };
    }
    return f;
  });
  const total = files.length;
  console.log(`[GitHubService] smartSync: ${owner}/${repo}@${branch} — ${total} file(s) to compare`);

  try {
    const branchData = await getBranch(owner, repo, branch);
    const commitSha = branchData.commit.sha;
    const commitData = await githubApi(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
    const baseTreeSha = commitData.tree.sha;

    const treeData = await githubApi(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
    const remoteTree = new Map<string, string>();
    for (const item of (treeData.tree || [])) {
      if (item.type === "blob") remoteTree.set(item.path, item.sha);
    }
    console.log(`[GitHubService] smartSync: remote tree has ${remoteTree.size} files`);

    const modified: Array<{ path: string; content: string | Buffer }> = [];
    const unchanged: Array<{ path: string; sha: string }> = [];

    for (const file of files) {
      const buf = typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : file.content;
      const localSha = computeGitBlobSha(buf);
      const remoteSha = remoteTree.get(file.path);
      if (localSha === remoteSha) {
        unchanged.push({ path: file.path, sha: remoteSha });
      } else {
        modified.push(file);
      }
    }

    if (modified.length === 0) {
      console.log(`[GitHubService] smartSync: no changes detected — skipping`);
      return { success: true, filesChanged: 0, filesTotal: total, skipped: total };
    }

    console.log(`[GitHubService] smartSync: ${modified.length} changed, ${unchanged.length} unchanged — uploading blobs...`);

    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];

    for (const u of unchanged) {
      treeEntries.push({ path: u.path, mode: "100644", type: "blob", sha: u.sha });
    }

    for (const file of modified) {
      const isBuffer = Buffer.isBuffer(file.content);
      const blob = await githubApi(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: isBuffer
          ? { content: (file.content as Buffer).toString("base64"), encoding: "base64" }
          : { content: file.content, encoding: "utf-8" },
      });
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }

    const tree = await githubApi(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: { base_tree: baseTreeSha, tree: treeEntries },
    });

    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
    const msg = commitMessage || `[MaxAI] Smart sync — ${modified.length} files changed — ${ts}`;
    const commit = await githubApi(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: { message: msg, tree: tree.sha, parents: [commitSha] },
    });

    await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: { sha: commit.sha },
    });

    console.log(`[GitHubService] smartSync SUCCESS: ${commit.sha?.slice(0, 7)} — ${modified.length} changed, ${unchanged.length} unchanged`);
    return {
      success: true,
      commitSha: commit.sha,
      filesChanged: modified.length,
      filesTotal: total,
      skipped: unchanged.length,
    };
  } catch (e: any) {
    console.error(`[GitHubService] smartSync FAILED: ${e.message}`);
    return { success: false, error: e.message, filesChanged: 0, filesTotal: total, skipped: 0 };
  }
}

export async function smartSyncFromDisk(
  owner: string,
  repo: string,
  branch: string,
  rootDir: string,
  filePaths: string[],
  commitMessage?: string
): Promise<SmartSyncResult> {
  const fs = await import("fs");
  const path = await import("path");

  const files: Array<{ path: string; content: Buffer }> = [];
  for (const relPath of filePaths) {
    const absPath = path.join(rootDir, relPath);
    try {
      const content = fs.readFileSync(absPath);
      files.push({ path: relPath, content });
    } catch {
      console.warn(`[GitHubService] smartSyncFromDisk: skipping ${relPath} (read error)`);
    }
  }

  return smartSync(owner, repo, branch, files, commitMessage);
}

export async function getPagesStatus(owner: string, repo: string) {
  return githubApi(`/repos/${owner}/${repo}/pages`);
}

export async function enablePages(owner: string, repo: string, branch = "main", path = "/") {
  return githubApi(`/repos/${owner}/${repo}/pages`, {
    method: "POST",
    body: { source: { branch, path } }
  });
}

export async function updatePages(owner: string, repo: string, branch: string, path = "/") {
  return githubApi(`/repos/${owner}/${repo}/pages`, {
    method: "PUT",
    body: { source: { branch, path } }
  });
}

export async function disablePages(owner: string, repo: string) {
  return githubApi(`/repos/${owner}/${repo}/pages`, { method: "DELETE" });
}

export async function getPagesBuild(owner: string, repo: string) {
  return githubApi(`/repos/${owner}/${repo}/pages/builds/latest`);
}

export async function requestPagesBuild(owner: string, repo: string) {
  return githubApi(`/repos/${owner}/${repo}/pages/builds`, { method: "POST" });
}

export async function deleteFile(owner: string, repo: string, path: string, message: string, branch: string) {
  const file = await githubApi(`/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
  const sha = (file as any).sha;
  if (!sha) throw new Error(`File not found: ${path}`);
  return githubApi(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    body: { message, sha, branch }
  });
}

export async function deleteBranch(owner: string, repo: string, branch: string) {
  return githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: "DELETE" });
}

export async function forcePushBranch(owner: string, repo: string, branch: string, sha: string) {
  return githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: { sha, force: true }
  });
}

export async function getCommit(owner: string, repo: string, sha: string) {
  return githubApi(`/repos/${owner}/${repo}/commits/${sha}`);
}

export async function compareBranches(owner: string, repo: string, base: string, head: string) {
  return githubApi(`/repos/${owner}/${repo}/compare/${base}...${head}`);
}

export async function getCommitDiff(owner: string, repo: string, sha: string) {
  return githubApi(`/repos/${owner}/${repo}/commits/${sha}`, {
    headers: { Accept: "application/vnd.github.v3.diff" },
    rawResponse: true,
  });
}

export async function getPullRequestFiles(owner: string, repo: string, pullNumber: number) {
  return githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`);
}

export async function getPullRequestDiff(owner: string, repo: string, pullNumber: number) {
  return githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`, {
    headers: { Accept: "application/vnd.github.v3.diff" },
    rawResponse: true,
  });
}

export async function getPullRequestReviews(owner: string, repo: string, pullNumber: number) {
  return githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`);
}

export async function createPullRequestReview(owner: string, repo: string, pullNumber: number, body: string, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "COMMENT", comments?: Array<{ path: string; position: number; body: string }>) {
  return githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
    method: "POST",
    body: { body, event, comments: comments || [] },
  });
}

export async function getBlame(owner: string, repo: string, path: string, branch?: string) {
  const ref = branch || "main";
  const commits = await githubApi(`/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&sha=${ref}&per_page=20`);
  return {
    type: "file_history",
    path,
    branch: ref,
    note: "GitHub REST API ne supporte pas le blame natif. Voici l'historique des commits pour ce fichier.",
    commits: Array.isArray(commits) ? commits.map((c: any) => ({
      sha: c.sha?.slice(0, 7),
      message: c.commit?.message?.split("\n")[0],
      author: c.commit?.author?.name,
      date: c.commit?.author?.date,
    })) : commits,
  };
}

export async function searchCode(owner: string, repo: string, query: string) {
  return githubApi(`/search/code?q=${encodeURIComponent(query)}+repo:${owner}/${repo}&per_page=20`);
}

export async function createRepo(name: string, options: { description?: string; isPrivate?: boolean; autoInit?: boolean } = {}) {
  return githubApi("/user/repos", {
    method: "POST",
    body: {
      name,
      description: options.description || "",
      private: options.isPrivate ?? false,
      auto_init: options.autoInit ?? true,
    }
  });
}

async function listIssues(owner: string, repo: string, state: string = "open", labels?: string, limit: number = 30): Promise<any[]> {
  let url = `/repos/${owner}/${repo}/issues?state=${state}&per_page=${limit}`;
  if (labels) url += `&labels=${encodeURIComponent(labels)}`;
  return githubApi(url);
}

async function getIssue(owner: string, repo: string, issueNumber: number): Promise<any> {
  return githubApi(`/repos/${owner}/${repo}/issues/${issueNumber}`);
}

async function createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[], assignees?: string[]): Promise<any> {
  return githubApi(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: { title, body: body || "", labels: labels || [], assignees: assignees || [] },
  });
}

async function updateIssue(owner: string, repo: string, issueNumber: number, updates: { title?: string; body?: string; state?: string; labels?: string[]; assignees?: string[] }): Promise<any> {
  return githubApi(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    body: updates,
  });
}

async function addIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<any> {
  return githubApi(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: { body },
  });
}

async function listReleases(owner: string, repo: string, limit: number = 10): Promise<any[]> {
  return githubApi(`/repos/${owner}/${repo}/releases?per_page=${limit}`);
}

async function createRelease(owner: string, repo: string, tagName: string, name: string, body?: string, draft?: boolean, prerelease?: boolean): Promise<any> {
  return githubApi(`/repos/${owner}/${repo}/releases`, {
    method: "POST",
    body: { tag_name: tagName, name, body: body || "", draft: draft || false, prerelease: prerelease || false },
  });
}

async function listTags(owner: string, repo: string, limit: number = 30): Promise<any[]> {
  return githubApi(`/repos/${owner}/${repo}/tags?per_page=${limit}`);
}

async function createTag(owner: string, repo: string, tag: string, sha: string, message?: string): Promise<any> {
  const tagObj = await githubApi(`/repos/${owner}/${repo}/git/tags`, {
    method: "POST",
    body: { tag, message: message || tag, object: sha, type: "commit" },
  });
  try {
    await githubApi(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/tags/${tag}`, sha: tagObj.sha },
    });
  } catch (e: any) {
    console.error(`[GitHubService] createTag: tag object created (${tagObj.sha}) but ref creation failed: ${e.message}`);
    throw new Error(`Tag '${tag}' object created but ref failed: ${e.message}. Tag may be in inconsistent state.`);
  }
  return tagObj;
}

async function createWebhook(owner: string, repo: string, options: { url: string; secret: string; events: string[]; active?: boolean }): Promise<any> {
  return githubApi(`/repos/${owner}/${repo}/hooks`, {
    method: "POST",
    body: {
      name: "web",
      active: options.active ?? true,
      events: options.events,
      config: {
        url: options.url,
        content_type: "json",
        secret: options.secret,
        insecure_ssl: "0",
      },
    },
  });
}

async function deleteRepo(owner: string, repo: string): Promise<any> {
  return githubApi(`/repos/${owner}/${repo}`, { method: "DELETE" });
}

export const githubService = {
  githubApi,
  getAuthenticatedUser,
  listRepos,
  createRepo,
  getRepo,
  listBranches,
  getBranch,
  createBranch,
  getFileContent,
  createOrUpdateFile,
  createOrUpdateFileRaw,
  createPullRequest,
  listPullRequests,
  listAllPullRequests,
  getPullRequest,
  mergePullRequest,
  closePullRequest,
  createIssueComment,
  listCommits,
  getTree,
  listWorkflowRuns,
  listWorkflows,
  triggerWorkflow,
  getWorkflowRun,
  rerunWorkflow,
  cancelWorkflowRun,
  getRepoLanguages,
  applyPatch,
  getPagesStatus,
  enablePages,
  updatePages,
  disablePages,
  getPagesBuild,
  requestPagesBuild,
  deleteFile,
  deleteBranch,
  searchCode,
  forcePushBranch,
  getCommit,
  compareBranches,
  getCommitDiff,
  getPullRequestFiles,
  getPullRequestDiff,
  getPullRequestReviews,
  createPullRequestReview,
  getBlame,
  listIssues,
  getIssue,
  createIssue,
  updateIssue,
  addIssueComment,
  listReleases,
  createRelease,
  listTags,
  createTag,
  createWebhook,
  deleteRepo,
  listOrgRepos,
  smartSync,
  smartSyncFromDisk,
};
