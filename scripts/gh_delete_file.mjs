const PAT = process.env.MAURICE_GITHUB_PAT;
const REPOS = [
  ["ulyssemdbh-commits", "ulysseproject"],
  ["ulyssemdbh-commits", "007ulysse"],
  ["ulyssemdbh-commits", "007ulysse-test"],
];
const PATH = process.argv[2];
if (!PATH) { console.error("usage: node gh_delete_file.mjs <path-in-repo>"); process.exit(1); }

async function gh(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${PAT}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) throw new Error(`${res.status}: ${await res.text()}`);
  return res.status === 404 ? null : res.json();
}

for (const [owner, repo] of REPOS) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${PATH}`;
  const file = await gh(url);
  if (!file) { console.log(`  ${owner}/${repo}: not present, skip`); continue; }
  await gh(url, "DELETE", {
    message: `chore: remove obsolete ${PATH} (replaced by directory)`,
    sha: file.sha,
    branch: "main",
  });
  console.log(`  ${owner}/${repo}: DELETED ${PATH}`);
}
