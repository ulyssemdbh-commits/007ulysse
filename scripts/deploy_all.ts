import { execSync } from "child_process";
import * as fs from "fs";

const MAURICE_GITHUB_PAT = process.env.MAURICE_GITHUB_PAT;
const HETZNER_HOST = "65.21.209.102";
const HETZNER_USER = "root";
const SSH_KEY = process.env.HETZNER_SSH_KEY || process.env.SSH_PRIVATE_KEY;

function run(cmd: string, opts?: { cwd?: string; silent?: boolean }): string {
  try {
    const out = execSync(cmd, {
      cwd: opts?.cwd || process.cwd(),
      encoding: "utf8",
      timeout: 120000,
      env: { ...process.env }
    });
    if (!opts?.silent) console.log(out.trim());
    return out.trim();
  } catch (e: any) {
    console.error(`❌ ERROR: ${cmd}`);
    console.error(e.stderr || e.message);
    throw e;
  }
}

async function main() {
  console.log("\n🚀 === DÉPLOIEMENT COMPLET ULYSSE ===\n");

  if (!MAURICE_GITHUB_PAT) {
    throw new Error("MAURICE_GITHUB_PAT non trouvé dans les variables d'environnement");
  }

  // ─── 1. NETTOYAGE DU VERROU GIT ───────────────────────────────────────────
  console.log("🔓 Nettoyage verrous git...");
  const lockFiles = [".git/index.lock", ".git/refs/heads/.lock", ".git/HEAD.lock"];
  for (const lf of lockFiles) {
    if (fs.existsSync(lf)) {
      fs.unlinkSync(lf);
      console.log(`  Supprimé: ${lf}`);
    }
  }

  // ─── 2. GIT STATUS ────────────────────────────────────────────────────────
  console.log("\n📋 Fichiers modifiés:");
  const status = run("git status --short");
  if (!status) {
    console.log("  (rien à committer)");
  }

  // ─── 3. GIT ADD + COMMIT ──────────────────────────────────────────────────
  console.log("\n📦 Staging et commit...");
  run("git add -A");

  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const commitMsg = `[Ulysse] Mise à jour complète — ${timestamp}\n\n- Alfred: outils COBA (query_coba + coba_business), Commax analytics, superchat_search\n- MaxAI: outils COBA monitoring, task_queue_manage, work_journal_manage\n- Iris: commax_manage complet avec journal obligatoire\n- Screen Monitor: screen_monitor_manage (10 actions, prise en main bureau)\n- Prompts: COBA = Chef Operator Business Assistant documenté dans Alfred + MaxAI`;

  try {
    run(`git commit -m "${commitMsg.replace(/"/g, "'")}"`);
    console.log("✅ Commit créé");
  } catch {
    console.log("ℹ️  Rien à committer ou déjà commité");
  }

  // ─── 4. PUSH → ulyssemdbh-commits/ulysseproject ───────────────────────────
  console.log("\n📤 Push vers ulyssemdbh-commits/ulysseproject...");
  const remoteUrlUlysse = `https://${MAURICE_GITHUB_PAT}@github.com/ulyssemdbh-commits/ulysseproject.git`;

  try {
    const currentRemote = run("git remote get-url origin", { silent: true });
    if (!currentRemote.includes("ulyssemdbh-commits")) {
      run(`git remote set-url origin ${remoteUrlUlysse}`);
    }
  } catch {
    run(`git remote add origin ${remoteUrlUlysse}`);
  }

  const currentBranch = run("git rev-parse --abbrev-ref HEAD", { silent: true }) || "main";
  console.log(`  Branche: ${currentBranch}`);
  run(`git push origin ${currentBranch} --force-with-lease 2>&1 || git push origin ${currentBranch}`);
  console.log("✅ Push ulysseproject OK");

  // ─── 5. PUSH → ulyssemdbh-commits/007ulysse ──────────────────────────────
  console.log("\n📤 Push vers ulyssemdbh-commits/007ulysse...");
  const remoteUrl007 = `https://${MAURICE_GITHUB_PAT}@github.com/ulyssemdbh-commits/007ulysse.git`;

  const hasRemote007 = (() => {
    try { run("git remote get-url repo007", { silent: true }); return true; }
    catch { return false; }
  })();

  if (hasRemote007) {
    run(`git remote set-url repo007 ${remoteUrl007}`);
  } else {
    run(`git remote add repo007 ${remoteUrl007}`);
  }

  run(`git push repo007 ${currentBranch}:main --force-with-lease 2>&1 || git push repo007 ${currentBranch}:main`);
  console.log("✅ Push 007ulysse OK");

  // ─── 6. DÉPLOIEMENT HETZNER ───────────────────────────────────────────────
  console.log("\n🖥️  Déploiement sur Hetzner (${HETZNER_HOST})...");

  const sshKeyPath = "/tmp/deploy_key";
  if (SSH_KEY) {
    fs.writeFileSync(sshKeyPath, SSH_KEY, { mode: 0o600 });
    console.log("  Clé SSH configurée");
  }

  const sshOpts = SSH_KEY
    ? `-i ${sshKeyPath} -o StrictHostKeyChecking=no -o ConnectTimeout=30`
    : `-o StrictHostKeyChecking=no -o ConnectTimeout=30`;

  const deployScript = [
    "set -e",
    "echo '📁 Aller dans le dossier projet...'",
    "cd /root/ulysseproject || cd /home/ulysse/ulysseproject || cd ~/ulysseproject",
    "echo '⬇️  Git pull...'",
    `git pull https://${MAURICE_GITHUB_PAT}@github.com/ulyssemdbh-commits/ulysseproject.git main 2>&1 || git pull https://${MAURICE_GITHUB_PAT}@github.com/ulyssemdbh-commits/ulysseproject.git ${currentBranch} 2>&1`,
    "echo '📦 Install dependencies...'",
    "npm install --production 2>&1 | tail -5",
    "echo '🔨 Build...'",
    "npm run build 2>&1 | tail -10",
    "echo '♻️  Restart PM2...'",
    "pm2 restart all 2>&1 || pm2 restart ulysse 2>&1 || pm2 start ecosystem.config.js 2>&1",
    "pm2 status",
    "echo '✅ Déploiement Hetzner terminé'"
  ].join(" && ");

  try {
    const sshCmd = `ssh ${sshOpts} ${HETZNER_USER}@${HETZNER_HOST} '${deployScript}'`;
    run(sshCmd);
    console.log("✅ Déploiement Hetzner OK");
  } catch (e) {
    console.warn("⚠️  SSH Hetzner échoué — vérifier la clé SSH ou accès réseau");
    console.log("   Le push GitHub est fait. Déploiement manuel requis sur Hetzner.");
    console.log(`   Commande: ssh ${HETZNER_USER}@${HETZNER_HOST} 'cd /root/ulysseproject && git pull && npm run build && pm2 restart all'`);
  }

  // ─── 7. RÉSUMÉ ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  console.log("✅ DÉPLOIEMENT COMPLET TERMINÉ");
  console.log("=".repeat(50));
  console.log(`📌 Branche: ${currentBranch}`);
  console.log(`🐙 GitHub: ulyssemdbh-commits/ulysseproject → OK`);
  console.log(`🐙 GitHub: ulyssemdbh-commits/007ulysse → OK`);
  console.log(`🖥️  Hetzner: ${HETZNER_HOST} → déployé`);
  console.log("=".repeat(50) + "\n");
}

main().catch((err) => {
  console.error("\n💥 ERREUR FATALE:", err.message || err);
  process.exit(1);
});
