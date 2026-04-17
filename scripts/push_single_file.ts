import * as fs from "fs";
import * as path from "path";

const PAT = process.env.MAURICE_GITHUB_PAT!;
const ROOT = process.cwd();
const file = process.argv[2] || "server/config/personaMapping.ts";
const repo = process.argv[3] || "ulysseproject";
const repoUrl = `https://api.github.com/repos/ulyssemdbh-commits/${repo}`;
const msg = process.argv[4] || `[DevOpsMax] Update ${file}`;

async function ghFetch(url: string, method = "GET", body?: any): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${PAT}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`GH ${res.status}: ${e.slice(0,200)}`); }
  return res.json();
}

async function main() {
  const content = fs.readFileSync(path.join(ROOT, file));
  const blob = await ghFetch(`${repoUrl}/git/blobs`, "POST", { content: content.toString("base64"), encoding: "base64" });
  const ref = await ghFetch(`${repoUrl}/git/ref/heads/main`);
  const commit = await ghFetch(`${repoUrl}/git/commits/${ref.object.sha}`);
  const tree = await ghFetch(`${repoUrl}/git/trees`, "POST", {
    base_tree: commit.tree.sha,
    tree: [{ path: file, mode: "100644", type: "blob", sha: blob.sha }]
  });
  const newCommit = await ghFetch(`${repoUrl}/git/commits`, "POST", {
    message: msg, tree: tree.sha, parents: [ref.object.sha]
  });
  await ghFetch(`${repoUrl}/git/refs/heads/main`, "PATCH", { sha: newCommit.sha });
  console.log(`PUSHED to ${repo}: ${newCommit.sha.slice(0,8)} — ${file}`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
