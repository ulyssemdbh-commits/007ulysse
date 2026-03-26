import { spawn } from 'child_process';
import { db } from '../db';
import { testRuns, buildRuns, InsertTestRun, InsertBuildRun, TestRun, BuildRun } from '@shared/schema';
import { eq, desc, gte } from 'drizzle-orm';

interface TestFailure {
  testName: string;
  file: string;
  line?: number;
  message: string;
  stack?: string;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
}

interface BuildError {
  file: string;
  line: number;
  column?: number;
  message: string;
  code?: string;
  severity: 'error' | 'warning';
}

class TestBuildCollector {
  async runTests(userId: number, type: 'jest' | 'vitest' | 'playwright' = 'vitest'): Promise<TestRun> {
    const [run] = await db.insert(testRuns).values({
      userId,
      type,
      status: 'running'
    }).returning();

    try {
      const result = await this.executeTests(type);
      
      const [updated] = await db.update(testRuns)
        .set({
          status: result.failures.length > 0 ? 'failed' : 'passed',
          finishedAt: new Date(),
          summary: result,
          rawLog: result.rawLog
        })
        .where(eq(testRuns.id, run.id))
        .returning();

      console.log(`[TestCollector] ${type} finished: ${result.passed}/${result.total} passed`);
      return updated;
    } catch (err) {
      const [updated] = await db.update(testRuns)
        .set({
          status: 'error',
          finishedAt: new Date(),
          rawLog: String(err)
        })
        .where(eq(testRuns.id, run.id))
        .returning();

      console.error(`[TestCollector] ${type} error:`, err);
      return updated;
    }
  }

  private executeTests(type: 'jest' | 'vitest' | 'playwright'): Promise<TestSummary & { rawLog: string }> {
    return new Promise((resolve, reject) => {
      const commands: Record<string, { cmd: string; args: string[] }> = {
        jest: { cmd: 'npx', args: ['jest', '--json'] },
        vitest: { cmd: 'npx', args: ['vitest', 'run', '--reporter=json'] },
        playwright: { cmd: 'npx', args: ['playwright', 'test', '--reporter=json'] }
      };

      const { cmd, args } = commands[type];
      let output = '';
      let errorOutput = '';

      const proc = spawn(cmd, args, { 
        cwd: process.cwd(),
        timeout: 300000
      });

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        const summary = this.parseTestOutput(type, output, errorOutput);
        resolve({
          ...summary,
          rawLog: output + '\n' + errorOutput
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  private parseTestOutput(type: string, stdout: string, stderr: string): TestSummary {
    const summary: TestSummary = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      failures: []
    };

    try {
      if (type === 'vitest' || type === 'jest') {
        const jsonMatch = stdout.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          summary.total = data.numTotalTests || 0;
          summary.passed = data.numPassedTests || 0;
          summary.failed = data.numFailedTests || 0;
          summary.skipped = data.numPendingTests || 0;
          summary.duration = data.testResults?.reduce((sum: number, r: any) => sum + (r.endTime - r.startTime), 0) || 0;

          if (data.testResults) {
            for (const result of data.testResults) {
              if (result.status === 'failed') {
                for (const assertion of result.assertionResults || []) {
                  if (assertion.status === 'failed') {
                    summary.failures.push({
                      testName: assertion.fullName || assertion.title,
                      file: result.name,
                      message: assertion.failureMessages?.join('\n') || 'Unknown failure',
                      stack: assertion.failureDetails?.[0]?.stack
                    });
                  }
                }
              }
            }
          }
        }
      }

      const passedMatch = stdout.match(/(\d+)\s+pass(?:ed|ing)?/i);
      const failedMatch = stdout.match(/(\d+)\s+fail(?:ed|ing)?/i);
      const totalMatch = stdout.match(/(\d+)\s+tests?/i);

      if (passedMatch) summary.passed = parseInt(passedMatch[1]);
      if (failedMatch) summary.failed = parseInt(failedMatch[1]);
      if (totalMatch) summary.total = parseInt(totalMatch[1]);
    } catch (err) {
      console.error('[TestCollector] Error parsing output:', err);
    }

    return summary;
  }

  async runBuild(userId: number, type: 'typescript' | 'vite' = 'typescript'): Promise<BuildRun> {
    const [run] = await db.insert(buildRuns).values({
      userId,
      type,
      status: 'running'
    }).returning();

    try {
      const result = await this.executeBuild(type);
      
      const [updated] = await db.update(buildRuns)
        .set({
          status: result.errors.length > 0 ? 'error' : 'success',
          finishedAt: new Date(),
          errors: result.errors,
          rawLog: result.rawLog
        })
        .where(eq(buildRuns.id, run.id))
        .returning();

      console.log(`[BuildCollector] ${type} finished: ${result.errors.length} errors`);
      return updated;
    } catch (err) {
      const [updated] = await db.update(buildRuns)
        .set({
          status: 'error',
          finishedAt: new Date(),
          rawLog: String(err)
        })
        .where(eq(buildRuns.id, run.id))
        .returning();

      console.error(`[BuildCollector] ${type} error:`, err);
      return updated;
    }
  }

  private executeBuild(type: 'typescript' | 'vite'): Promise<{ errors: BuildError[]; rawLog: string }> {
    return new Promise((resolve, reject) => {
      const commands: Record<string, { cmd: string; args: string[] }> = {
        typescript: { cmd: 'npx', args: ['tsc', '--noEmit'] },
        vite: { cmd: 'npx', args: ['vite', 'build', '--outDir', '/tmp/vite-build'] }
      };

      const { cmd, args } = commands[type];
      let output = '';
      let errorOutput = '';

      const proc = spawn(cmd, args, { 
        cwd: process.cwd(),
        timeout: 300000
      });

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        const errors = this.parseBuildOutput(type, output + errorOutput);
        resolve({
          errors,
          rawLog: output + '\n' + errorOutput
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  private parseBuildOutput(type: string, output: string): BuildError[] {
    const errors: BuildError[] = [];
    
    const tsErrorRegex = /(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)/g;
    let match;
    while ((match = tsErrorRegex.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        code: match[5],
        message: match[6]
      });
    }

    const viteErrorRegex = /Error:\s+(.+)\n\s+at\s+(.+):(\d+):(\d+)/g;
    while ((match = viteErrorRegex.exec(output)) !== null) {
      errors.push({
        file: match[2],
        line: parseInt(match[3]),
        column: parseInt(match[4]),
        severity: 'error',
        message: match[1]
      });
    }

    return errors;
  }

  async getRecentTestRuns(userId: number, limit: number = 10): Promise<TestRun[]> {
    return db.select()
      .from(testRuns)
      .where(eq(testRuns.userId, userId))
      .orderBy(desc(testRuns.startedAt))
      .limit(limit);
  }

  async getRecentBuildRuns(userId: number, limit: number = 10): Promise<BuildRun[]> {
    return db.select()
      .from(buildRuns)
      .where(eq(buildRuns.userId, userId))
      .orderBy(desc(buildRuns.startedAt))
      .limit(limit);
  }

  getTestSummaryForPrompt(runs: TestRun[]): string {
    if (runs.length === 0) return 'Aucun test récent.';
    
    const latest = runs[0];
    const summary = latest.summary as TestSummary | null;
    
    if (!summary) return `Dernier test: ${latest.status}`;
    
    let text = `Tests (${latest.type}): ${summary.passed}/${summary.total} passés`;
    
    if (summary.failures.length > 0) {
      text += `\nÉchecs:\n`;
      for (const f of summary.failures.slice(0, 5)) {
        text += `- ${f.testName} (${f.file}): ${f.message.slice(0, 100)}\n`;
      }
    }
    
    return text;
  }

  async getTestsSummary(hours: number = 24): Promise<TestSummary> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const runs = await db.select()
      .from(testRuns)
      .where(gte(testRuns.startedAt, since))
      .orderBy(desc(testRuns.startedAt))
      .limit(50);

    const summary: TestSummary = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      failures: [],
    };

    for (const run of runs) {
      const s = run.summary as TestSummary | null;
      if (s) {
        summary.total += s.total;
        summary.passed += s.passed;
        summary.failed += s.failed;
        summary.skipped += s.skipped;
        summary.duration += s.duration;
        if (s.failures) {
          summary.failures.push(...s.failures);
        }
      }
    }

    return summary;
  }

  getBuildSummaryForPrompt(runs: BuildRun[]): string {
    if (runs.length === 0) return 'Aucun build récent.';
    
    const latest = runs[0];
    const errors = latest.errors as BuildError[] | null;
    
    if (!errors || errors.length === 0) {
      return `Build (${latest.type}): ${latest.status}`;
    }
    
    let text = `Build (${latest.type}): ${errors.length} erreurs\n`;
    for (const e of errors.slice(0, 10)) {
      text += `- ${e.file}:${e.line} [${e.code || e.severity}]: ${e.message}\n`;
    }
    
    return text;
  }
}

export const testBuildCollector = new TestBuildCollector();
