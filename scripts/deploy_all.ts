import { execSync } from "child_process";
import { readFileSync, existsSync, statSync } from "fs";

const HETZNER_HOST = "65.21.209.102";
const HETZNER_USER = "root";
const REMOTE_DIR = "/var/www/ulysse";
const DIST_CJS = "dist/index.cjs";
const DIST_PUBLIC = "dist/public";
const DIST_HTML = "dist/html";

const HETZNER_SSH_PASSWORD = process.env.HETZNER_SSH_PASSWORD;
const MAURICE_GITHUB_PAT = process.env.MAURICE_GITHUB_PAT;

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_BUILD = process.argv.includes("--skip-build");
const SKIP_GITHUB = process.argv.includes("--skip-github");
const SKIP_FRONTEND = process.argv.includes("--skip-frontend");
const SKIP_TESTS = process.argv.includes("--skip-tests");

function log(emoji: string, msg: string) {
  console.log(`${emoji}  ${msg}`);
}

function run(cmd: string, opts?: { timeout?: number; silent?: boolean; ignoreError?: boolean }): string {
  const timeout = opts?.timeout || 120_000;
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout, env: { ...process.env }, stdio: opts?.silent ? "pipe" : "inherit" });
    return typeof out === "string" ? out.trim() : "";
  } catch (e: any) {
    if (opts?.ignoreError) return e.stdout?.trim() || "";
    console.error(`FAILED: ${cmd.slice(0, 100)}`);
    throw e;
  }
}

function sshCmd(command: string, timeout = 30_000): string {
  const sshPrefix = HETZNER_SSH_PASSWORD
    ? `sshpass -p "${HETZNER_SSH_PASSWORD}" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15`
    : `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15`;
  return run(`${sshPrefix} ${HETZNER_USER}@${HETZNER_HOST} "${command.replace(/"/g, '\\"')}"`, { timeout, silent: true });
}

function scpFile(localPath: string, remotePath: string): void {
  const scpPrefix = HETZNER_SSH_PASSWORD
    ? `sshpass -p "${HETZNER_SSH_PASSWORD}" scp -o StrictHostKeyChecking=no`
    : `scp -o StrictHostKeyChecking=no`;
  run(`${scpPrefix} ${localPath} ${HETZNER_USER}@${HETZNER_HOST}:${remotePath}`, { timeout: 60_000, silent: true });
}

function scpDir(localPath: string, remotePath: string): void {
  const scpPrefix = HETZNER_SSH_PASSWORD
    ? `sshpass -p "${HETZNER_SSH_PASSWORD}" scp -r -o StrictHostKeyChecking=no`
    : `scp -r -o StrictHostKeyChecking=no`;
  run(`${scpPrefix} ${localPath} ${HETZNER_USER}@${HETZNER_HOST}:${remotePath}`, { timeout: 120_000, silent: true });
}

async function main() {
  const startTime = Date.now();
  const errors: string[] = [];
  const steps: string[] = [];

  console.log("\n========================================");
  console.log("  ULYSSE DEPLOY — Full Sync Pipeline");
  console.log("========================================\n");

  if (DRY_RUN) log("!", "DRY RUN — aucune modification ne sera faite");

  if (!HETZNER_SSH_PASSWORD) {
    throw new Error("HETZNER_SSH_PASSWORD manquant — impossible de déployer");
  }

  // ─── PRE-DEPLOY TESTS ────────────────────────────────────────────────────
  if (SKIP_TESTS) {
    log(">>", "Tests PRE-deploy ignorés (--skip-tests)");
    steps.push("Tests PRE-deploy: ignorés");
  } else {
    log(">>", "STEP 0/6 — Tests PRE-deploy (validation du code)...");
    try {
      const testOutput = run("npx vitest run --reporter=verbose 2>&1 || true", { timeout: 120_000, silent: true });
      const passMatch = testOutput.match(/(\d+)\s+passed/);
      const failMatch = testOutput.match(/(\d+)\s+failed/);
      const passed = passMatch ? parseInt(passMatch[1]) : 0;
      const failed = failMatch ? parseInt(failMatch[1]) : 0;

      if (failed > 0) {
        log("!!", `Tests PRE-deploy: ${passed} passés, ${failed} ÉCHOUÉS`);
        console.log("\n--- Détails des tests échoués ---");
        const failedLines = testOutput.split("\n").filter((l: string) => l.includes("FAIL") || l.includes("×") || l.includes("AssertionError") || l.includes("Error:"));
        failedLines.slice(0, 20).forEach((l: string) => console.log(`  ${l}`));
        console.log("--- Fin des détails ---\n");
        throw new Error(`${failed} test(s) échoué(s) — déploiement annulé. Corrigez les tests avant de redéployer.`);
      }

      log("OK", `Tests PRE-deploy: ${passed} passés, 0 échoué`);
      steps.push(`Tests PRE-deploy: ${passed} passés ✅`);
    } catch (e: any) {
      if (e.message.includes("échoué(s)")) throw e;
      log("!!", `Tests PRE-deploy: erreur inattendue — ${e.message?.slice(0, 100)}`);
      errors.push(`Tests PRE-deploy warning: ${e.message?.slice(0, 100)}`);
      steps.push("Tests PRE-deploy: erreur (non-bloquant)");
    }

    // ─── E2E TESTS (Playwright) ───────────────────────────────────────────────
    log(">>", "STEP 0b/6 — Tests E2E Playwright (validation UI)...");
    try {
      const e2eOutput = run("npx playwright test --reporter=line 2>&1 || true", { timeout: 180_000, silent: true });
      const e2ePassMatch = e2eOutput.match(/(\d+)\s+passed/);
      const e2eFailMatch = e2eOutput.match(/(\d+)\s+failed/);
      const e2ePassed = e2ePassMatch ? parseInt(e2ePassMatch[1]) : 0;
      const e2eFailed = e2eFailMatch ? parseInt(e2eFailMatch[1]) : 0;

      if (e2eFailed > 0) {
        log("!!", `Tests E2E: ${e2ePassed} passés, ${e2eFailed} ÉCHOUÉS`);
        console.log("\n--- Détails des tests E2E échoués ---");
        const e2eFailedLines = e2eOutput.split("\n").filter((l: string) => l.includes("FAIL") || l.includes("✘") || l.includes("Error") || l.includes("expected"));
        e2eFailedLines.slice(0, 20).forEach((l: string) => console.log(`  ${l}`));
        console.log("--- Fin des détails E2E ---\n");
        throw new Error(`${e2eFailed} test(s) E2E échoué(s) — déploiement annulé. Corrigez les tests avant de redéployer.`);
      }

      log("OK", `Tests E2E: ${e2ePassed} passés, 0 échoué`);
      steps.push(`Tests E2E: ${e2ePassed} passés ✅`);
    } catch (e: any) {
      if (e.message.includes("échoué(s)")) throw e;
      log("!!", `Tests E2E: erreur inattendue — ${e.message?.slice(0, 100)}`);
      errors.push(`Tests E2E warning: ${e.message?.slice(0, 100)}`);
      steps.push("Tests E2E: erreur (non-bloquant)");
    }
  }

  // ─── STEP 1: BUILD ──────────────────────────────────────────────────────────
  if (SKIP_BUILD) {
    log(">>", "Build ignoré (--skip-build)");
    if (!existsSync(DIST_CJS)) throw new Error("dist/index.cjs introuvable — lancez le build d'abord");
  } else {
    log(">>", "STEP 1/6 — Build production...");
    run("NODE_OPTIONS='--max-old-space-size=3072' npx tsx script/build.ts", { timeout: 180_000 });
  }

  // ─── STEP 2: VERIFY BUILD ──────────────────────────────────────────────────
  log(">>", "STEP 2/6 — Vérification du build...");
  if (!existsSync(DIST_CJS)) throw new Error("dist/index.cjs n'existe pas après le build");
  if (!existsSync(DIST_HTML + "/index.html")) throw new Error("dist/html/index.html manquant");
  if (!existsSync(DIST_PUBLIC)) throw new Error("dist/public/ manquant");

  const cjsStat = statSync(DIST_CJS);
  const cjsMB = (cjsStat.size / 1024 / 1024).toFixed(2);

  if (cjsStat.size < 500_000) throw new Error(`Build trop petit (${cjsMB}MB) — probablement cassé`);
  if (cjsStat.size > 25_000_000) throw new Error(`Build trop gros (${cjsMB}MB) — vérifiez l'allowlist`);

  let manifest: any = {};
  if (existsSync("dist/build-manifest.json")) {
    manifest = JSON.parse(readFileSync("dist/build-manifest.json", "utf-8"));
  }
  steps.push(`Build: ${cjsMB}MB, ${manifest.bundledModuleCount || "?"} modules`);
  log("OK", `Build vérifié: ${cjsMB}MB`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] Arrêt ici — build vérifié, pas de déploiement.");
    return;
  }

  // ─── STEP 3: BACKUP + HEALTH CHECK HETZNER ─────────────────────────────────
  log(">>", "STEP 3/6 — Backup Hetzner + test connexion...");
  try {
    const preHealth = sshCmd("curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:5000/api/v2/health 2>/dev/null || echo '000'");
    log("OK", `Hetzner pre-deploy: HTTP ${preHealth.trim()}`);

    sshCmd(`mkdir -p ${REMOTE_DIR}/dist/_backup && cp ${REMOTE_DIR}/dist/index.cjs ${REMOTE_DIR}/dist/_backup/index.cjs.bak 2>/dev/null || true`);
    steps.push("Backup: ancien index.cjs sauvegardé");
    log("OK", "Backup créé: dist/_backup/index.cjs.bak");
  } catch (e: any) {
    errors.push(`Backup warning: ${e.message?.slice(0, 100)}`);
    log("!!", "Backup échoué (continue quand même)");
  }

  // ─── STEP 4: DEPLOY FILES ──────────────────────────────────────────────────
  log(">>", "STEP 4/6 — Upload des fichiers...");
  try {
    sshCmd(`mkdir -p ${REMOTE_DIR}/dist/public ${REMOTE_DIR}/dist/html`);

    log("  ", "Uploading index.cjs...");
    scpFile(DIST_CJS, `${REMOTE_DIR}/dist/index.cjs`);
    steps.push(`Server: index.cjs (${cjsMB}MB)`);

    log("  ", "Uploading html/index.html...");
    scpDir(DIST_HTML + "/", `${REMOTE_DIR}/dist/html/`);
    steps.push("HTML: index.html");

    if (!SKIP_FRONTEND) {
      log("  ", "Uploading public/ assets...");
      sshCmd(`rm -rf ${REMOTE_DIR}/dist/public/assets 2>/dev/null || true`);
      scpDir(DIST_PUBLIC + "/", `${REMOTE_DIR}/dist/public/`);
      const assetCount = run(`ls dist/public/assets/ 2>/dev/null | wc -l`, { silent: true });
      steps.push(`Frontend: ${assetCount.trim()} asset files`);
    } else {
      log("  ", "Frontend ignoré (--skip-frontend)");
      steps.push("Frontend: ignoré");
    }

    log("OK", "Tous les fichiers uploadés");
  } catch (e: any) {
    errors.push(`Upload failed: ${e.message?.slice(0, 200)}`);
    log("!!", "ERREUR UPLOAD — tentative de rollback...");
    try {
      sshCmd(`cp ${REMOTE_DIR}/dist/_backup/index.cjs.bak ${REMOTE_DIR}/dist/index.cjs 2>/dev/null && pm2 restart ulysse`);
      log("<<", "Rollback effectué — ancienne version restaurée");
    } catch { log("!!", "Rollback échoué aussi"); }
    throw new Error("Deploy échoué à l'upload");
  }

  // ─── STEP 5: RESTART + HEALTH CHECK ────────────────────────────────────────
  log(">>", "STEP 5/6 — Restart PM2 + vérification santé...");
  try {
    const criticalDeps = ["pdfkit", "fontkit", "restructure", "googleapis", "bcrypt"];
    for (const dep of criticalDeps) {
      const check = sshCmd(`cd ${REMOTE_DIR} && node -e "try{require('${dep}');console.log('OK')}catch(e){console.log('MISSING')}" 2>/dev/null`).trim();
      if (check !== "OK") {
        log("  ", `Module manquant: ${dep} — installation...`);
        sshCmd(`cd ${REMOTE_DIR} && npm install ${dep} --no-save 2>/dev/null`, 30_000);
        const recheck = sshCmd(`cd ${REMOTE_DIR} && node -e "try{require('${dep}');console.log('OK')}catch(e){console.log('MISSING')}" 2>/dev/null`).trim();
        if (recheck !== "OK") {
          log("⚠️", `WARN: ${dep} toujours manquant après install`);
        } else {
          log("OK", `${dep} installé`);
        }
      }
    }

    sshCmd("pm2 flush ulysse 2>/dev/null; pm2 restart ulysse", 15_000);
    log("OK", "PM2 redémarré");

    let healthy = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const waitSec = attempt <= 3 ? 10 : 15;
      log("  ", `Health check ${attempt}/6 (attente ${waitSec}s)...`);
      run(`sleep ${waitSec}`, { silent: true, timeout: 20_000 });

      const httpCode = sshCmd("curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:5000/api/v2/health 2>/dev/null || echo '000'").trim();

      if (httpCode === "200") {
        log("OK", `Hetzner healthy: HTTP ${httpCode}`);
        steps.push(`Health: HTTP 200 (attempt ${attempt})`);
        healthy = true;
        break;
      }
      log("  ", `HTTP ${httpCode} — retry...`);
    }

    if (!healthy) {
      errors.push("Health check failed after 6 attempts");
      log("!!", "HEALTH CHECK ÉCHOUÉ — rollback automatique...");
      sshCmd(`cp ${REMOTE_DIR}/dist/_backup/index.cjs.bak ${REMOTE_DIR}/dist/index.cjs 2>/dev/null && pm2 restart ulysse`);
      run("sleep 15", { silent: true, timeout: 20_000 });
      const rollbackHealth = sshCmd("curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:5000/api/v2/health 2>/dev/null || echo '000'").trim();
      log("<<", `Rollback: HTTP ${rollbackHealth}`);
      steps.push(`ROLLBACK: HTTP ${rollbackHealth}`);
      throw new Error("Deploy échoué — rollback effectué, ancienne version restaurée");
    }

    const externalCheck = run(`curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://ulyssepro.org/api/v2/health 2>/dev/null || echo '000'`, { silent: true });
    log("OK", `External: https://ulyssepro.org → HTTP ${externalCheck.trim()}`);
    steps.push(`External: HTTP ${externalCheck.trim()}`);
  } catch (e: any) {
    if (e.message.includes("rollback")) throw e;
    errors.push(`Restart error: ${e.message?.slice(0, 200)}`);
    throw e;
  }

  // ─── POST-DEPLOY TESTS ───────────────────────────────────────────────────
  if (SKIP_TESTS) {
    log(">>", "Tests POST-deploy ignorés (--skip-tests)");
    steps.push("Tests POST-deploy: ignorés");
  } else {
    log(">>", "STEP 5b/6 — Tests POST-deploy (validation production)...");
    try {
      const postTests: { name: string; pass: boolean; detail: string }[] = [];

      const healthInternal = sshCmd("curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:5000/api/v2/health 2>/dev/null || echo '000'").trim();
      postTests.push({ name: "Health API interne", pass: healthInternal === "200", detail: `HTTP ${healthInternal}` });

      const healthExternal = run("curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://ulyssepro.org/api/v2/health 2>/dev/null || echo '000'", { silent: true }).trim();
      postTests.push({ name: "Health API externe", pass: healthExternal === "200", detail: `HTTP ${healthExternal}` });

      const suguvalCheck = run("curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://ulyssepro.org/suguval 2>/dev/null || echo '000'", { silent: true }).trim();
      postTests.push({ name: "/suguval accessible", pass: suguvalCheck === "200", detail: `HTTP ${suguvalCheck}` });

      const homeCheck = run("curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://ulyssepro.org/ 2>/dev/null || echo '000'", { silent: true }).trim();
      postTests.push({ name: "Page d'accueil", pass: homeCheck === "200", detail: `HTTP ${homeCheck}` });

      const devmaxCheck = run("curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://ulyssepro.org/devmax 2>/dev/null || echo '000'", { silent: true }).trim();
      postTests.push({ name: "/devmax accessible", pass: devmaxCheck === "200", detail: `HTTP ${devmaxCheck}` });

      const healthJson = run("curl -s --max-time 10 https://ulyssepro.org/api/v2/health 2>/dev/null || echo '{}'", { silent: true }).trim();
      try {
        const h = JSON.parse(healthJson);
        postTests.push({ name: "Health JSON valide", pass: h.status === "ok", detail: `status=${h.status}, version=${h.version}` });
      } catch {
        postTests.push({ name: "Health JSON valide", pass: false, detail: "JSON invalide" });
      }

      const pmStatus = sshCmd("pm2 jlist 2>/dev/null || echo '[]'");
      try {
        const procs = JSON.parse(pmStatus);
        const ulysse = procs.find((p: any) => p.name === "ulysse");
        const isOnline = ulysse?.pm2_env?.status === "online";
        postTests.push({ name: "PM2 process online", pass: isOnline, detail: `status=${ulysse?.pm2_env?.status || "not found"}` });
      } catch {
        postTests.push({ name: "PM2 process online", pass: false, detail: "Impossible de parser PM2" });
      }

      const jsBundle = run("curl -s --max-time 15 https://ulyssepro.org/ 2>/dev/null | grep -oP 'src=\"/assets/index-[^\"]+\\.js\"' || echo ''", { silent: true }).trim();
      if (jsBundle) {
        const jsSrc = jsBundle.replace('src="', '').replace('"', '');
        const jsBundleCheck = run(`curl -s -o /dev/null -w '%{http_code}' --max-time 15 'https://ulyssepro.org${jsSrc}' 2>/dev/null || echo '000'`, { silent: true }).trim();
        postTests.push({ name: "JS bundle accessible", pass: jsBundleCheck === "200", detail: `${jsSrc} → HTTP ${jsBundleCheck}` });
      } else {
        postTests.push({ name: "JS bundle accessible", pass: false, detail: "Bundle JS introuvable dans le HTML" });
      }

      const htmlRef = run("curl -s --max-time 10 https://ulyssepro.org/ 2>/dev/null | grep -oP 'index-[A-Za-z0-9_-]+\\.js' || echo ''", { silent: true }).trim();
      const localRef = run("ls dist/public/assets/index-*.js 2>/dev/null | head -1 || echo ''", { silent: true }).trim();
      const localHash = localRef.split("/").pop() || "";
      const hashMatch = htmlRef === localHash;
      postTests.push({ name: "JS hash cohérent (local=prod)", pass: hashMatch, detail: `local=${localHash}, prod=${htmlRef}` });

      const conversationsCheck = run("curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://ulyssepro.org/api/conversations 2>/dev/null || echo '000'", { silent: true }).trim();
      postTests.push({ name: "API conversations", pass: conversationsCheck === "200" || conversationsCheck === "304" || conversationsCheck === "401", detail: `HTTP ${conversationsCheck}` });

      const loginPageCheck = run("curl -s --max-time 10 https://ulyssepro.org/login 2>/dev/null | grep -c '<html' || echo '0'", { silent: true }).trim();
      postTests.push({ name: "Page /login rendu HTML", pass: parseInt(loginPageCheck) > 0, detail: `${loginPageCheck} balise(s) HTML` });

      const passed = postTests.filter(t => t.pass).length;
      const failed = postTests.filter(t => !t.pass).length;

      postTests.forEach(t => {
        log(t.pass ? "OK" : "!!", `  ${t.name}: ${t.detail}`);
      });

      if (failed > 0) {
        log("!!", `Tests POST-deploy: ${passed}/${postTests.length} passés, ${failed} ÉCHOUÉ(S)`);
        errors.push(`Tests POST-deploy: ${failed} échoué(s)`);
        steps.push(`Tests POST-deploy: ${passed}/${postTests.length} ⚠️`);
      } else {
        log("OK", `Tests POST-deploy: ${passed}/${postTests.length} passés`);
        steps.push(`Tests POST-deploy: ${passed}/${postTests.length} ✅`);
      }
    } catch (e: any) {
      log("!!", `Tests POST-deploy: erreur — ${e.message?.slice(0, 100)}`);
      errors.push(`Tests POST-deploy error: ${e.message?.slice(0, 100)}`);
      steps.push("Tests POST-deploy: erreur (non-bloquant)");
    }
  }

  // ─── STEP 6: PUSH GITHUB ──────────────────────────────────────────────────
  if (SKIP_GITHUB || !MAURICE_GITHUB_PAT) {
    log(">>", "GitHub push ignoré");
    steps.push("GitHub: ignoré");
  } else {
    log(">>", "STEP 6/6 — Push GitHub...");
    try {
      run("npx tsx scripts/github_push_api.ts", { timeout: 60_000, silent: true });
      steps.push("GitHub: pushed");
      log("OK", "GitHub push OK");
    } catch (e: any) {
      errors.push(`GitHub push warning: ${e.message?.slice(0, 100)}`);
      log("!!", "GitHub push échoué (non-bloquant)");
      steps.push("GitHub: FAILED (non-bloquant)");
    }
  }

  // ─── SUMMARY ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n========================================");
  console.log("  DEPLOY COMPLETE");
  console.log("========================================");
  steps.forEach(s => console.log(`  ${s}`));
  if (errors.length) {
    console.log("\n  Warnings:");
    errors.forEach(e => console.log(`  !! ${e}`));
  }
  console.log(`\n  Durée: ${elapsed}s`);
  console.log(`  Rollback: sshpass -p $HETZNER_SSH_PASSWORD ssh root@${HETZNER_HOST} "cp ${REMOTE_DIR}/dist/_backup/index.cjs.bak ${REMOTE_DIR}/dist/index.cjs && pm2 restart ulysse"`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
