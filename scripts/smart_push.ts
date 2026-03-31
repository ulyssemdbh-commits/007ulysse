/**
 * SMART PUSH — Only modified files since last GitHub commit
 * Pushes to both 007ulysse and ulysseproject
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const PAT = process.env.MAURICE_GITHUB_PAT!;
const ROOT = process.cwd();

const ALL_REPOS = [
  { owner: "ulyssemdbh-commits", repo: "007ulysse", branch: "main" },
  { owner: "ulyssemdbh-commits", repo: "ulysseproject", branch: "main" },
];

const SOURCE_DIRS = ["server", "client/src", "client/public", "shared", "script", "scripts", "tools", "speaker_recognition"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".css", ".html", ".py", ".sh", ".json", ".sql"]);
const ROOT_CONFIG = ["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "tailwind.config.ts", "postcss.config.js", "drizzle.config.ts", "components.json", "vitest.config.ts", "playwright.config.ts", "client/index.html", ".gitignore", "replit.md", "scripts/hetzner_deploy.sh"];
const EXCLUDE = [/node_modules/, /\/dist\//, /\/__tests__\//, /\.test\.(ts|tsx|js)$/, /\.spec\.(ts|tsx|js)$/, /\.map$/, /\.generated/, /\.cache/, /\.replit/];

function shouldInclude(p: string): boolean {
  if (EXCLUDE.some(r => r.test(p))) return false;
  return SOURCE_EXTENSIONS.has(path.extname(p));
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const f of ROOT_CONFIG) { if (fs.existsSync(path.join(ROOT, f))) files.push(f); }
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walkDir(abs, dir, files);
  }
  return [...new Set(files)];
}

function walkDir(absDir: string, relDir: string, files: string[]) {
  for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${relDir}/${e.name}`, abs = path.join(absDir, e.name);
    if (e.isDirectory()) {
      if (!["node_modules", "dist", ".git", "__tests__"].includes(e.name)) walkDir(abs, rel, files);
    } else if (e.isFile() && shouldInclude(rel)) {
      files.push(rel);
    }
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function computeGitBlobSha(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  const store = Buffer.concat([Buffer.from(header), content]);
  return crypto.createHash("sha1").update(store).digest("hex");
}

async function ghFetch(url: string, method = "GET", body?: any): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${PAT}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    if ((res.status === 403 || res.status === 429) && attempt < 3) {
      const wait = Math.min(5000 * Math.pow(2, attempt), 30000);
      console.log(`    Retry ${attempt+1} in ${Math.round(wait/1000)}s...`);
      await sleep(wait);
      continue;
    }
    const err = await res.text();
    throw new Error(`GitHub ${res.status}: ${err.slice(0, 200)}`);
  }
}

async function getRemoteTree(repoUrl: string, branch: string): Promise<Map<string, string>> {
  const refData = await ghFetch(`${repoUrl}/git/ref/heads/${branch}`);
  const commitData = await ghFetch(`${repoUrl}/git/commits/${refData.object.sha}`);
  const treeData = await ghFetch(`${repoUrl}/git/trees/${commitData.tree.sha}?recursive=1`);
  const map = new Map<string, string>();
  for (const item of treeData.tree) {
    if (item.type === "blob") map.set(item.path, item.sha);
  }
  return map;
}

async function pushRepo(owner: string, repo: string, branch: string, allFiles: string[]) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  
  console.log(`\n========== PUSH -> ${owner}/${repo} ==========`);
  console.log(`  Local files: ${allFiles.length}`);
  
  // Get remote tree to compare
  console.log("  Fetching remote tree...");
  const remoteTree = await getRemoteTree(repoUrl, branch);
  console.log(`  Remote files: ${remoteTree.size}`);
  
  // Compare and find modified/new files
  const modified: string[] = [];
  for (const f of allFiles) {
    const absPath = path.join(ROOT, f);
    try {
      const content = fs.readFileSync(absPath);
      const localSha = computeGitBlobSha(content);
      const remoteSha = remoteTree.get(f);
      if (localSha !== remoteSha) {
        modified.push(f);
      }
    } catch {
      // file read error, skip
    }
  }
  
  if (modified.length === 0) {
    console.log("  No changes detected — skipping push");
    return;
  }
  
  console.log(`  ${modified.length} files modified/new — uploading blobs...`);
  
  // Upload blobs for modified files only
  const blobs: Record<string, string> = {};
  
  // Reuse existing SHAs for unchanged files
  for (const f of allFiles) {
    if (!modified.includes(f) && remoteTree.has(f)) {
      blobs[f] = remoteTree.get(f)!;
    }
  }
  
  for (let i = 0; i < modified.length; i++) {
    const relPath = modified[i];
    const absPath = path.join(ROOT, relPath);
    try {
      const content = fs.readFileSync(absPath);
      const blob = await ghFetch(`${repoUrl}/git/blobs`, "POST", {
        content: content.toString("base64"),
        encoding: "base64",
      });
      blobs[relPath] = blob.sha;
      if ((i + 1) % 25 === 0 || i === modified.length - 1) {
        console.log(`    ${i + 1}/${modified.length} blobs uploaded`);
      }
    } catch (e: any) {
      console.error(`    FAIL ${relPath}: ${e.message.slice(0, 80)}`);
    }
    if (i < modified.length - 1 && i % 10 === 9) await sleep(200);
  }
  
  // Create tree + commit
  console.log("  Creating tree + commit...");
  const refData = await ghFetch(`${repoUrl}/git/ref/heads/${branch}`);
  const latestCommitSha = refData.object.sha;
  const commitData = await ghFetch(`${repoUrl}/git/commits/${latestCommitSha}`);
  const baseTreeSha = commitData.tree.sha;
  
  const treeEntries = allFiles
    .filter(f => blobs[f])
    .map(f => ({ path: f, mode: "100644" as const, type: "blob" as const, sha: blobs[f] }));
  
  const tree = await ghFetch(`${repoUrl}/git/trees`, "POST", {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });
  
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const commit = await ghFetch(`${repoUrl}/git/commits`, "POST", {
    message: `[DevOpsMax] Smart sync — ${modified.length} files changed — ${ts}`,
    tree: tree.sha,
    parents: [latestCommitSha],
  });
  
  await ghFetch(`${repoUrl}/git/refs/heads/${branch}`, "PATCH", { sha: commit.sha });
  
  console.log(`  COMMIT: ${commit.sha.slice(0, 8)} — ${modified.length} modified, ${allFiles.length} total`);
  console.log(`  ${owner}/${repo} DONE ✅`);
}

async function main() {
  if (!PAT) throw new Error("MAURICE_GITHUB_PAT missing");
  const files = collectFiles();
  console.log(`DevOpsMax Smart Sync — ${files.length} local files`);
  
  for (const { owner, repo, branch } of ALL_REPOS) {
    await pushRepo(owner, repo, branch, files);
  }
  
  console.log("\n========== ALL REPOS SYNCED ==========");
}

main().catch(err => { console.error("ERROR:", err.message); process.exit(1); });
