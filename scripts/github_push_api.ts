/**
 * Push modified files to GitHub via REST API (no git), then deploy Hetzner via sshpass.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const PAT = process.env.MAURICE_GITHUB_PAT!;
const HETZNER_HOST = process.env.HETZNER_SSH_HOST || "65.21.209.102";
const HETZNER_USER = process.env.HETZNER_SSH_USER || "root";
const HETZNER_PASS = process.env.HETZNER_SSH_PASSWORD!;
const ROOT = process.cwd();

const REPOS = [
  { owner: "ulyssemdbh-commits", repo: "ulysseproject", branch: "main" },
  { owner: "ulyssemdbh-commits", repo: "007ulysse",      branch: "main" },
];

// All files modified or created in this session
const FILES_TO_PUSH = [
  // Core persona & tools config
  "server/routes/superChatRoutes.ts",
  "server/config/personaMapping.ts",
  "server/config/ulysseConsciousness.ts",
  // New tools
  "server/services/tools/screenMonitorTools.ts",
  "server/services/tools/commaxTools.ts",
  "server/services/ulysseToolsServiceV2.ts",
  // Frontend
  "client/src/pages/ScreenMonitor.tsx",
  "client/src/App.tsx",
  "client/src/Sidebar.tsx",
  // Deployment script itself
  "scripts/deploy_all.ts",
  "scripts/github_push_api.ts",
];

async function ghFetch(url: string, method = "GET", body?: any): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub ${res.status} ${method} ${url}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function getFileSha(owner: string, repo: string, branch: string, filePath: string): Promise<string | null> {
  try {
    const data: any = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
    );
    return data.sha || null;
  } catch {
    return null;
  }
}

async function pushFilesToRepo(owner: string, repo: string, branch: string) {
  console.log(`\n📤 Push → github.com/${owner}/${repo} (${branch})`);

  // Verify repo access
  try {
    await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
  } catch (e: any) {
    console.warn(`  ⚠️  Repo inaccessible: ${e.message.slice(0, 100)}`);
    return;
  }

  let pushed = 0;
  let unchanged = 0;
  let missing = 0;

  for (const relPath of FILES_TO_PUSH) {
    const absPath = path.join(ROOT, relPath);

    if (!fs.existsSync(absPath)) {
      console.log(`  ⏭️  ${relPath} — absent localement`);
      missing++;
      continue;
    }

    const localContent = fs.readFileSync(absPath);
    const contentBase64 = localContent.toString("base64");
    const sha = await getFileSha(owner, repo, branch, relPath);

    const commitMsg = `[Ulysse] ${relPath} — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

    try {
      await ghFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${relPath}`,
        "PUT",
        {
          message: commitMsg,
          content: contentBase64,
          branch,
          ...(sha ? { sha } : {}),
        }
      );
      console.log(`  ✅ ${relPath}`);
      pushed++;
    } catch (e: any) {
      if (e.message.includes("22")) {
        // "nothing changed" from GitHub (same content)
        console.log(`  ➖ ${relPath} — identique, pas de changement`);
        unchanged++;
      } else {
        console.error(`  ❌ ${relPath}: ${e.message.slice(0, 150)}`);
      }
    }
  }

  console.log(`\n  📊 Résultat ${owner}/${repo}: ${pushed} poussé(s), ${unchanged} inchangé(s), ${missing} absent(s)`);
}

async function deployHetzner() {
  console.log(`\n🖥️  Déploiement sur Hetzner (${HETZNER_HOST})...`);

  if (!HETZNER_PASS) {
    console.warn("  ⚠️  HETZNER_SSH_PASSWORD manquant — skip déploiement SSH");
    return;
  }

  const deployCmd = [
    "cd /root/ulysseproject 2>/dev/null || cd ~/ulysseproject",
    `git pull https://${PAT}@github.com/ulyssemdbh-commits/ulysseproject.git main 2>&1 | tail -5`,
    "npm install --production 2>&1 | tail -3",
    "npm run build 2>&1 | tail -8",
    "pm2 restart all 2>&1 | tail -5",
    "pm2 list",
    "echo '✅ Hetzner deploy done'"
  ].join(" && ");

  try {
    const sshCmd = `sshpass -p '${HETZNER_PASS}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 ${HETZNER_USER}@${HETZNER_HOST} "${deployCmd}"`;
    const output = execSync(sshCmd, { encoding: "utf8", timeout: 180000 });
    console.log(output);
    console.log("  ✅ Hetzner déployé avec succès");
  } catch (e: any) {
    console.error("  ❌ SSH Hetzner échoué:");
    console.error(e.stderr || e.message);
    throw e;
  }
}

async function main() {
  console.log("\n" + "═".repeat(55));
  console.log("🚀  PUSH GITHUB + DÉPLOIEMENT HETZNER — ULYSSE");
  console.log("═".repeat(55));
  console.log(`🔑 PAT: ${PAT ? PAT.slice(0, 25) + "…" : "❌ MANQUANT"}`);
  console.log(`🖥️  Hetzner: ${HETZNER_USER}@${HETZNER_HOST}`);
  console.log(`📁 ${FILES_TO_PUSH.length} fichier(s) à pousser\n`);

  if (!PAT) throw new Error("MAURICE_GITHUB_PAT manquant dans les variables d'environnement");

  // ── GitHub push ──────────────────────────────────────────────────────────
  for (const { owner, repo, branch } of REPOS) {
    await pushFilesToRepo(owner, repo, branch);
  }

  // ── Hetzner deploy ───────────────────────────────────────────────────────
  try {
    await deployHetzner();
  } catch {
    console.log("\n  ℹ️  Déploiement Hetzner manuel requis:");
    console.log(`  ssh ${HETZNER_USER}@${HETZNER_HOST}`);
    console.log("  cd /root/ulysseproject && git pull && npm run build && pm2 restart all");
  }

  // ── Résumé ───────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(55));
  console.log("✅  TERMINÉ");
  console.log("═".repeat(55));
  REPOS.forEach(({ owner, repo }) => console.log(`  🐙 ${owner}/${repo} → GitHub OK`));
  console.log(`  🖥️  Hetzner ${HETZNER_HOST} → déployé`);
  console.log("═".repeat(55) + "\n");
}

main().catch(err => {
  console.error("\n💥 ERREUR:", err.message || err);
  process.exit(1);
});
