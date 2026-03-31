interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

interface TestSuiteResult {
  phase: "pre-deploy" | "post-deploy" | "on-demand";
  passed: number;
  failed: number;
  total: number;
  tests: TestResult[];
  duration: number;
  blocking: boolean;
}

export async function runPreDeployTests(appName: string, sshService: any): Promise<TestSuiteResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const appDir = `/var/www/apps/${appName}`;
  const devAppDir = `/var/www/apps/${appName}-dev`;

  const targetDir = await sshService.executeCommand(`test -d ${devAppDir} && echo "dev" || (test -d ${appDir} && echo "prod" || echo "none")`, 5000);
  const resolvedDir = targetDir.output?.trim() === "dev" ? devAppDir : targetDir.output?.trim() === "prod" ? appDir : null;

  if (!resolvedDir) {
    tests.push({ name: "App directory exists", pass: false, detail: `Neither ${appDir} nor ${devAppDir} found` });
    return { phase: "pre-deploy", passed: 0, failed: 1, total: 1, tests, duration: Date.now() - start, blocking: true };
  }
  tests.push({ name: "App directory exists", pass: true, detail: resolvedDir });

  const pkgCheck = await sshService.executeCommand(`test -f ${resolvedDir}/package.json && echo "yes" || echo "no"`, 5000);
  tests.push({ name: "package.json exists", pass: pkgCheck.output?.trim() === "yes", detail: pkgCheck.output?.trim() === "yes" ? "OK" : "Missing" });

  const scriptCheck = await sshService.executeCommand(
    `cd ${resolvedDir} && node -e "const p=require('./package.json'); const s=p.scripts||{}; console.log(JSON.stringify({test:!!s.test,vitest:!!s.vitest,lint:!!s.lint,typecheck:!!s.typecheck||!!s['type-check'],build:!!s.build}))" 2>/dev/null || echo '{}'`,
    5000
  );
  let scripts: any = {};
  try { scripts = JSON.parse(scriptCheck.output || "{}"); } catch {}

  if (scripts.lint) {
    const lintResult = await sshService.executeCommand(`cd ${resolvedDir} && npm run lint 2>&1 | tail -20`, 60000);
    tests.push({ name: "Lint check", pass: lintResult.success, detail: lintResult.success ? "No errors" : (lintResult.output || lintResult.error || "").slice(-200) });
  }

  if (scripts.typecheck || scripts["type-check"]) {
    const cmd = scripts.typecheck ? "typecheck" : "type-check";
    const tcResult = await sshService.executeCommand(`cd ${resolvedDir} && npm run ${cmd} 2>&1 | tail -20`, 60000);
    tests.push({ name: "TypeScript check", pass: tcResult.success, detail: tcResult.success ? "No errors" : (tcResult.output || tcResult.error || "").slice(-200) });
  }

  if (scripts.test || scripts.vitest) {
    const testCmd = scripts.vitest ? "vitest" : "test";
    const testResult = await sshService.executeCommand(`cd ${resolvedDir} && npm run ${testCmd} -- --run 2>&1 | tail -30`, 120000);
    const output = testResult.output || "";
    const passMatch = output.match(/(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);
    const unitPassed = passMatch ? parseInt(passMatch[1]) : 0;
    const unitFailed = failMatch ? parseInt(failMatch[1]) : 0;
    tests.push({
      name: "Unit/integration tests",
      pass: unitFailed === 0 && testResult.success,
      detail: `${unitPassed} passed, ${unitFailed} failed${unitFailed > 0 ? ": " + output.split("\n").filter((l: string) => l.includes("FAIL") || l.includes("×")).slice(0, 5).join("; ") : ""}`,
    });
  }

  if (scripts.build) {
    tests.push({ name: "Build script available", pass: true, detail: "build script present" });
  }

  const envCheck = await sshService.executeCommand(`test -f ${resolvedDir}/.env && echo "yes" || echo "no"`, 5000);
  tests.push({ name: "Environment file (.env)", pass: envCheck.output?.trim() === "yes", detail: envCheck.output?.trim() === "yes" ? "Present" : "Missing (may use PM2 config)" });

  const passed = tests.filter(t => t.pass).length;
  const failed = tests.filter(t => !t.pass).length;
  return { phase: "pre-deploy", passed, failed, total: tests.length, tests, duration: Date.now() - start, blocking: failed > 0 && tests.some(t => !t.pass && (t.name.includes("Unit") || t.name.includes("Lint"))) };
}

export async function runPostDeployTests(appName: string, environment: "staging" | "production", sshService: any): Promise<TestSuiteResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const suffix = environment === "staging" ? "-dev" : "";
  const appDir = `/var/www/apps/${appName}${suffix}`;
  const domain = environment === "staging" ? `${appName}-dev.ulyssepro.org` : `${appName}.ulyssepro.org`;

  const pm2Check = await sshService.executeCommand(`pm2 jlist 2>/dev/null || echo '[]'`, 10000);
  try {
    const procs = JSON.parse(pm2Check.output || "[]");
    const proc = procs.find((p: any) => p.name === `${appName}${suffix}` || p.name === appName);
    const isOnline = proc?.pm2_env?.status === "online";
    tests.push({ name: "PM2 process online", pass: !!isOnline, detail: `status=${proc?.pm2_env?.status || "not found"}, name=${proc?.name || "N/A"}` });
  } catch {
    tests.push({ name: "PM2 process online", pass: false, detail: "Cannot parse PM2 status" });
  }

  const portCheck = await sshService.executeCommand(
    `grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env ${appDir}/ecosystem.config.cjs 2>/dev/null | head -1 || echo "0"`,
    5000
  );
  const port = portCheck.output?.trim() || "0";
  if (port !== "0") {
    const localHealth = await sshService.executeCommand(`curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:${port}/ 2>/dev/null || echo '000'`, 15000);
    const httpCode = localHealth.output?.trim() || "000";
    tests.push({ name: "Local HTTP response", pass: parseInt(httpCode) >= 200 && parseInt(httpCode) < 500, detail: `HTTP ${httpCode} on port ${port}` });
  }

  const nginxCheck = await sshService.executeCommand(`test -f /etc/nginx/sites-enabled/${domain} && echo "yes" || (test -f /etc/nginx/sites-enabled/${appName}${suffix} && echo "yes" || echo "no")`, 5000);
  tests.push({ name: "Nginx config exists", pass: nginxCheck.output?.trim() === "yes", detail: nginxCheck.output?.trim() === "yes" ? `Config for ${domain}` : "Missing" });

  const externalUrl = `https://${domain}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const extCheck = await fetch(externalUrl, { signal: controller.signal, redirect: "follow" }).catch(() => null);
    clearTimeout(timeout);
    if (extCheck) {
      tests.push({ name: "External HTTPS accessible", pass: extCheck.status >= 200 && extCheck.status < 500, detail: `HTTP ${extCheck.status} — ${externalUrl}` });
    } else {
      tests.push({ name: "External HTTPS accessible", pass: false, detail: `Timeout/unreachable — ${externalUrl}` });
    }
  } catch {
    tests.push({ name: "External HTTPS accessible", pass: false, detail: `Error — ${externalUrl}` });
  }

  const sslCheck = await sshService.executeCommand(`echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep notAfter || echo "no-ssl"`, 10000);
  const sslOutput = sslCheck.output?.trim() || "no-ssl";
  tests.push({ name: "SSL certificate valid", pass: sslOutput !== "no-ssl", detail: sslOutput !== "no-ssl" ? sslOutput : "No valid SSL cert" });

  const logsCheck = await sshService.executeCommand(`pm2 logs ${appName}${suffix || ""} --nostream --lines 20 2>/dev/null | grep -ciE "error|exception|fatal|crash" || echo "0"`, 10000);
  const errorCount = parseInt(logsCheck.output?.trim() || "0");
  tests.push({ name: "Recent error logs", pass: errorCount < 5, detail: `${errorCount} error lines in last 20 log lines${errorCount >= 5 ? " ⚠️" : ""}` });

  const passed = tests.filter(t => t.pass).length;
  const failed = tests.filter(t => !t.pass).length;
  return { phase: "post-deploy", passed, failed, total: tests.length, tests, duration: Date.now() - start, blocking: false };
}
