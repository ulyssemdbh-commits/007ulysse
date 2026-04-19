/**
 * E2E real-conditions test for the homework multi-target pipeline
 * (GitHub repo / web article / PDF).
 *
 * For each target:
 *   1. Create the homework via the storage layer (same path used by the API).
 *   2. Run it through homeworkExecutionService.executeHomework("manual").
 *   3. Assert the classifier picked the right targetType.
 *   4. Assert source-specific facts appear in the summary (fidelity check,
 *      not just length).
 *   5. Assert NO sport vocabulary leaked into the summary.
 *   6. Assert a deterministic ulysse_memory row was written for THIS run
 *      (queried by exact source key, not by a "last 20" window).
 *
 * The 3 created homework rows are deleted at the end. Execution rows and
 * memory rows are kept on purpose as audit trail.
 *
 * Exit codes:
 *   0 = all assertions passed
 *   1 = unexpected crash
 *   2 = at least one assertion failed
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import { homeworkExecutionService } from "../server/services/homeworkExecution";
import {
  ulysseMemory,
  users,
  type HomeworkExecution,
  type UlysseMemory,
} from "../shared/schema";
import { and, desc, eq } from "drizzle-orm";

// Anything matching this regex in a non-sport summary is treated as a
// hallucination and fails the test.
const SPORT_HALLUCINATION_RX =
  /\b(footballeur|footballeurs|but(?:eur)?s?|championnat|coupe du monde|ligue 1|premier league|paris sportifs?|cote\b|odds\b|bookmaker|pari[s]? sportif|score final|équipe de france|equipe de france|matchs? (?:de|du) (?:foot|football|tennis|basket|rugby))\b/i;

interface TestCase {
  title: string;
  description: string;
  expectedType: "github_repo" | "web_article" | "pdf";
  /** Each fact MUST appear (case-insensitive) in the summary. */
  requiredFacts: RegExp[];
}

const TEST_CASES: TestCase[] = [
  {
    title: "[TEST-E2E] Lire le repo GitHub sindresorhus/ky",
    description:
      "Résume ce que fait ce repo: https://github.com/sindresorhus/ky",
    expectedType: "github_repo",
    // sindresorhus/ky is a well-known JS HTTP client; its name, owner,
    // primary language and the word "fetch" should always show up in a
    // faithful summary.
    requiredFacts: [/sindresorhus\/ky|\bky\b/i, /typescript/i, /fetch/i],
  },
  {
    title: "[TEST-E2E] Lire l'article Wikipedia Markdown",
    description: "Résume cet article: https://en.wikipedia.org/wiki/Markdown",
    expectedType: "web_article",
    // The Markdown Wikipedia page is dominated by Gruber, the year 2004
    // and the term "markup".
    requiredFacts: [/markdown/i, /gruber/i, /2004/, /(markup|balisage)/i],
  },
  {
    title: "[TEST-E2E] Lire un PDF de démo",
    description:
      "Résume ce PDF: https://pdfobject.com/pdf/sample.pdf",
    expectedType: "pdf",
    // The pdfobject sample PDF contains the literal title "Sample PDF"
    // and the word "PDF" in its body.
    requiredFacts: [/sample/i, /pdf/i],
  },
];

interface PerSourceArtifact {
  url?: string;
  targetType?: string;
  ok?: boolean;
  confidence?: number;
}

interface MultiTargetArtifacts {
  urls?: string[];
  targetTypes?: string[];
  successCount?: number;
  totalUrls?: number;
  sources?: PerSourceArtifact[];
  processed?: boolean;
  confidence?: number;
}

interface CaseReport {
  homeworkId: number;
  title: string;
  expectedType: string;
  detectedTypes: string[];
  typeMatch: boolean;
  summaryLen: number;
  summaryHead: string;
  factsMatched: string[];
  factsMissing: string[];
  sportHallucination: string | null;
  memoryRecorded: boolean;
  memoryKey?: string;
  memoryValueHead?: string;
  passed: boolean;
}

async function getOwnerId(): Promise<number> {
  const [owner] = await db.select().from(users).where(eq(users.isOwner, true));
  if (!owner) throw new Error("No owner user found");
  return owner.id;
}

function extractDetectedTypes(exec: HomeworkExecution | null): string[] {
  const artifacts = (exec?.artifacts ?? {}) as MultiTargetArtifacts;
  return Array.isArray(artifacts.targetTypes) ? artifacts.targetTypes : [];
}

async function findMemoryRowForRun(
  userId: number,
  homeworkId: number,
): Promise<UlysseMemory | undefined> {
  // Deterministic lookup: the executor writes source = `homework:<id>:manual`
  // when triggeredBy is "manual". We query that exact source for this user.
  const rows = await db
    .select()
    .from(ulysseMemory)
    .where(
      and(
        eq(ulysseMemory.userId, userId),
        eq(ulysseMemory.category, "homework_result"),
        eq(ulysseMemory.source, `homework:${homeworkId}:manual`),
      ),
    )
    .orderBy(desc(ulysseMemory.id))
    .limit(1);
  return rows[0];
}

async function runOneCase(
  userId: number,
  tc: TestCase,
): Promise<{ id: number; report: CaseReport }> {
  console.log(`\n--- Creating: ${tc.title} ---`);
  const hw = await storage.createHomework({
    userId,
    title: tc.title,
    description: tc.description,
    priority: "medium",
    recurrence: "none",
    dueDate: null,
    status: "pending",
    notes: null,
  });

  console.log(`Executing homework #${hw.id} ...`);
  const t0 = Date.now();
  const exec = await homeworkExecutionService.executeHomework(
    userId,
    hw,
    "manual",
  );
  const dt = Date.now() - t0;
  console.log(`Done in ${dt}ms. status=${exec?.status ?? "null"}`);

  const summary = exec?.resultSummary ?? "";
  const detectedTypes = extractDetectedTypes(exec);
  const typeMatch = detectedTypes.includes(tc.expectedType);

  const factsMatched: string[] = [];
  const factsMissing: string[] = [];
  for (const rx of tc.requiredFacts) {
    if (rx.test(summary)) factsMatched.push(rx.source);
    else factsMissing.push(rx.source);
  }
  const sportMatch = summary.match(SPORT_HALLUCINATION_RX);

  const memRow = await findMemoryRowForRun(userId, hw.id);

  const report: CaseReport = {
    homeworkId: hw.id,
    title: tc.title,
    expectedType: tc.expectedType,
    detectedTypes,
    typeMatch,
    summaryLen: summary.length,
    summaryHead: summary.slice(0, 220).replace(/\s+/g, " "),
    factsMatched,
    factsMissing,
    sportHallucination: sportMatch ? sportMatch[0] : null,
    memoryRecorded: !!memRow,
    memoryKey: memRow?.key,
    memoryValueHead: memRow?.value?.slice(0, 160),
    passed:
      typeMatch &&
      factsMissing.length === 0 &&
      sportMatch === null &&
      !!memRow,
  };

  return { id: hw.id, report };
}

async function cleanup(userId: number, ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      await storage.deleteHomework(id, userId);
    } catch (err) {
      console.warn(`Cleanup: failed to delete homework ${id}:`, err);
    }
  }
}

async function run(): Promise<void> {
  const userId = await getOwnerId();
  console.log(`\n=== Homework E2E test (user ${userId}) ===\n`);

  const createdIds: number[] = [];
  const reports: CaseReport[] = [];

  try {
    for (const tc of TEST_CASES) {
      const { id, report } = await runOneCase(userId, tc);
      createdIds.push(id);
      reports.push(report);
    }
  } finally {
    await cleanup(userId, createdIds);
    console.log(`\nCleaned ${createdIds.length} test homework rows.`);
  }

  console.log(`\n========= REPORT =========`);
  for (const r of reports) {
    console.log(JSON.stringify(r, null, 2));
  }
  console.log(`==========================\n`);

  const allOk = reports.every((r) => r.passed);
  console.log(allOk ? "RESULT: PASS ✅" : "RESULT: FAIL ❌");
  process.exit(allOk ? 0 : 2);
}

run().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
