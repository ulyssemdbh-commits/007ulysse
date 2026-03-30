/**
 * FULL PROJECT PUSH to GitHub via Git Trees API
 * Chunked with progress tracking — resumes from last checkpoint
 * DevOpsMax 100% autonome
 */

import * as fs from "fs";
import * as path from "path";

const PAT = process.env.MAURICE_GITHUB_PAT!;
const ROOT = process.cwd();
const PROGRESS_FILE = "/tmp/github_push_progress.json";
const CHUNK_SIZE = 200;

const TARGET_REPO = process.env.TARGET_REPO || "007ulysse";
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

interface Progress {
  repo: string;
  blobs: Record<string, string>;
  done: boolean;
}

function loadProgress(repo: string): Progress {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
    if (data.repo === repo && !data.done) return data;
  } catch {}
  return { repo, blobs: {}, done: false };
}

function saveProgress(p: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function pushRepo(owner: string, repo: string, branch: string, allFiles: string[]) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const progress = loadProgress(repo);
  const alreadyDone = Object.keys(progress.blobs).length;

  console.log(`\nPUSH -> ${owner}/${repo}`);
  console.log(`  Total files: ${allFiles.length}, already uploaded: ${alreadyDone}`);

  const remaining = allFiles.filter(f => !progress.blobs[f]);
  const chunk = remaining.slice(0, CHUNK_SIZE);

  if (chunk.length === 0 && alreadyDone > 0) {
    console.log("  All blobs uploaded — creating commit...");
  } else {
    console.log(`  Uploading ${chunk.length} blobs this run...`);

    for (let i = 0; i < chunk.length; i++) {
      const relPath = chunk[i];
      const absPath = path.join(ROOT, relPath);
      try {
        const content = fs.readFileSync(absPath);
        const blob = await ghFetch(`${repoUrl}/git/blobs`, "POST", {
          content: content.toString("base64"),
          encoding: "base64",
        });
        progress.blobs[relPath] = blob.sha;
        if ((i + 1) % 25 === 0) {
          console.log(`    ${Object.keys(progress.blobs).length}/${allFiles.length} blobs...`);
          saveProgress(progress);
        }
      } catch (e: any) {
        console.error(`    FAIL ${relPath}: ${e.message.slice(0, 80)}`);
        saveProgress(progress);
      }
      if (i < chunk.length - 1) await sleep(250);
    }
    saveProgress(progress);
  }

  const totalBlobs = Object.keys(progress.blobs).length;
  const remainingAfter = allFiles.filter(f => !progress.blobs[f]).length;

  if (remainingAfter > 0) {
    console.log(`\n  PROGRESS: ${totalBlobs}/${allFiles.length} blobs uploaded`);
    console.log(`  ${remainingAfter} remaining — run again to continue`);
    return;
  }

  console.log(`  All ${totalBlobs} blobs ready — creating tree + commit...`);

  const refData = await ghFetch(`${repoUrl}/git/ref/heads/${branch}`);
  const latestCommitSha = refData.object.sha;
  const commitData = await ghFetch(`${repoUrl}/git/commits/${latestCommitSha}`);
  const baseTreeSha = commitData.tree.sha;

  const treeEntries = allFiles
    .filter(f => progress.blobs[f])
    .map(f => ({ path: f, mode: "100644" as const, type: "blob" as const, sha: progress.blobs[f] }));

  const tree = await ghFetch(`${repoUrl}/git/trees`, "POST", {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const commit = await ghFetch(`${repoUrl}/git/commits`, "POST", {
    message: `[DevOpsMax] Full project sync — ${totalBlobs} files — ${ts}`,
    tree: tree.sha,
    parents: [latestCommitSha],
  });

  await ghFetch(`${repoUrl}/git/refs/heads/${branch}`, "PATCH", { sha: commit.sha });

  console.log(`  COMMIT: ${commit.sha.slice(0, 8)} — ${totalBlobs} files`);
  progress.done = true;
  saveProgress(progress);
  console.log(`  ${owner}/${repo} DONE`);
}

async function main() {
  if (!PAT) throw new Error("MAURICE_GITHUB_PAT missing");
  const files = collectFiles();
  console.log(`DevOpsMax Full Sync — ${files.length} files`);

  const repos = TARGET_REPO === "both" ? ALL_REPOS : ALL_REPOS.filter(r => r.repo === TARGET_REPO);
  for (const { owner, repo, branch } of repos) {
    await pushRepo(owner, repo, branch, files);
  }
}

main().catch(err => { console.error("ERROR:", err.message); process.exit(1); });
