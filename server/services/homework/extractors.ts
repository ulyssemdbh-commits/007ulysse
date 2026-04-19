/**
 * Homework extractors — one per target type.
 *
 * Each extractor returns a normalized result {summary, artifacts, confidence}
 * that the homework executor can hand back without going through the
 * sport-only legacy pipeline.
 */

import OpenAI from "openai";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { Client as NotionClient } from "@notionhq/client";
import { canMakeCall, withRateLimit } from "../rateLimiter";
import { crawlAndScrape } from "../scraper/core";
import { parseGithubRepoUrl } from "./targetClassifier";
import { assertSafeFetchUrl } from "./urlSafety";
import { safeFetch } from "./safeFetch";
import * as github from "../githubService";
import { connectorBridge } from "../connectorBridge";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface ExtractorResult {
  ok: boolean;
  summary: string;
  artifacts: Record<string, unknown>;
  confidence: number; // 0..1
  error?: string;
}

// ────────────────────────────────────────────────────────────────────
// Minimal typed shapes for the GitHub REST responses we consume.
// Everything is optional because the API can omit fields and we don't
// want to crash on missing data.
// ────────────────────────────────────────────────────────────────────
interface GithubRepoMeta {
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  language?: string | null;
  license?: { name?: string } | null;
  updated_at?: string;
  html_url?: string;
}
interface GithubCommit {
  sha?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
}
interface GithubFileContent {
  content?: string;
  encoding?: string;
}
type GithubLanguages = Record<string, number>;

// ────────────────────────────────────────────────────────────────────
// GitHub repo extractor (uses the integrated GitHub API)
// ────────────────────────────────────────────────────────────────────
export async function extractGithubRepo(url: string): Promise<ExtractorResult> {
  const parsed = parseGithubRepoUrl(url);
  if (!parsed) {
    return {
      ok: false,
      summary: `URL GitHub invalide: ${url}`,
      artifacts: { url, targetType: "github_repo" },
      confidence: 0,
      error: "invalid_github_url",
    };
  }

  const { owner, repo } = parsed;

  try {
    type RepoOrError = GithubRepoMeta & { __error?: string };
    const [metaRaw, languagesRaw, commitsRaw, readmeRaw] = await Promise.all([
      (github.getRepo(owner, repo) as Promise<GithubRepoMeta>).catch(
        (e: unknown): RepoOrError => ({
          __error: e instanceof Error ? e.message : String(e),
        }),
      ),
      (github.getRepoLanguages(owner, repo) as Promise<GithubLanguages>).catch(
        () => ({} as GithubLanguages),
      ),
      (github.listCommits(owner, repo, undefined, 5) as Promise<GithubCommit[]>).catch(
        () => [] as GithubCommit[],
      ),
      (github.getFileContent(owner, repo, "README.md") as Promise<GithubFileContent>).catch(() =>
        (github.getFileContent(owner, repo, "readme.md") as Promise<GithubFileContent>).catch(
          () => null,
        ),
      ),
    ]);

    const metaWithError = metaRaw as RepoOrError;
    if (metaWithError.__error) {
      return {
        ok: false,
        summary: `Impossible d'accéder au repo ${owner}/${repo}: ${metaWithError.__error}`,
        artifacts: { url, owner, repo, targetType: "github_repo" },
        confidence: 0.1,
        error: metaWithError.__error,
      };
    }
    const meta: GithubRepoMeta = metaWithError;
    const languages: GithubLanguages = languagesRaw;
    const commits: GithubCommit[] = Array.isArray(commitsRaw) ? commitsRaw : [];
    const langKeys = Object.keys(languages).slice(0, 5);

    let readmeText = "";
    if (readmeRaw?.content) {
      try {
        readmeText = Buffer.from(readmeRaw.content, "base64").toString("utf8");
      } catch {
        readmeText = "";
      }
    }
    const readmeExcerpt = readmeText.slice(0, 4000);

    const lines: string[] = [];
    lines.push(`# 📦 ${owner}/${repo}`);
    if (meta.description) lines.push(`> ${meta.description}`);
    lines.push("");
    lines.push(`- ⭐ Étoiles: **${meta.stargazers_count ?? "?"}**`);
    lines.push(`- 🍴 Forks: ${meta.forks_count ?? "?"}`);
    lines.push(`- 🐛 Issues ouvertes: ${meta.open_issues_count ?? "?"}`);
    lines.push(`- 🌐 Langage principal: ${meta.language ?? "?"}`);
    if (langKeys.length > 0) lines.push(`- 🧪 Langages: ${langKeys.join(", ")}`);
    if (meta.license?.name) lines.push(`- 📜 Licence: ${meta.license.name}`);
    lines.push(`- 📅 Mis à jour: ${meta.updated_at ?? "?"}`);
    lines.push("");

    if (commits.length > 0) {
      lines.push("## 🕒 Derniers commits");
      for (const c of commits) {
        const sha = (c.sha ?? "").slice(0, 7);
        const msg = (c.commit?.message ?? "").split("\n")[0].slice(0, 120);
        const author = c.commit?.author?.name ?? c.author?.login ?? "?";
        const date = c.commit?.author?.date ?? "";
        lines.push(`- \`${sha}\` ${msg} _(${author}, ${date})_`);
      }
      lines.push("");
    }

    let aiSummary = "";
    if (readmeExcerpt && canMakeCall("combined")) {
      try {
        const resp = await withRateLimit("combined", () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Tu résumes des README de repos GitHub en français. Reste FACTUEL: extrais uniquement ce qui est dans le README. Si une section manque, ne l'invente pas. Maximum 200 mots.",
              },
              {
                role: "user",
                content: `Résume ce README du repo ${owner}/${repo} (objectif, fonctionnalités principales, comment l'utiliser):\n\n${readmeExcerpt}`,
              },
            ],
            temperature: 0.2,
            max_tokens: 400,
          })
        , 0);
        aiSummary = resp.choices[0].message.content || "";
      } catch {
        aiSummary = "";
      }
    }

    if (aiSummary) {
      lines.push("## 📖 Résumé du README");
      lines.push(aiSummary);
    } else if (readmeExcerpt) {
      lines.push("## 📖 Extrait du README");
      lines.push(readmeExcerpt.slice(0, 1500));
    } else {
      lines.push("_Pas de README accessible._");
    }

    lines.push("");
    lines.push(`🔗 ${meta.html_url ?? url}`);

    return {
      ok: true,
      summary: lines.join("\n"),
      artifacts: {
        url,
        targetType: "github_repo",
        owner,
        repo,
        stars: meta.stargazers_count,
        language: meta.language,
        languages: langKeys,
        commitCount: commits.length,
        readmeLength: readmeText.length,
      },
      confidence: 0.9,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: `Erreur GitHub pour ${owner}/${repo}: ${msg}`,
      artifacts: { url, owner, repo, targetType: "github_repo" },
      confidence: 0,
      error: msg,
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Web article extractor (generic readable web page)
// ────────────────────────────────────────────────────────────────────
export async function extractWebArticle(url: string, taskHint?: string): Promise<ExtractorResult> {
  try {
    // SSRF guard: refuse loopback / private / link-local / non-http URLs
    // before delegating to the scraper (defense in depth).
    const safety = await assertSafeFetchUrl(url);
    if (!safety.ok) {
      return {
        ok: false,
        summary: `URL refusée pour raison de sécurité (${safety.reason}): ${url}`,
        artifacts: { url, targetType: "web_article", blockedReason: safety.reason },
        confidence: 0,
        error: `unsafe_url:${safety.reason}`,
      };
    }

    const scrapeResult = await crawlAndScrape({
      url,
      mode: "auto",
      depth: 0,
      maxPages: 1,
      maxConcurrency: 1,
      linkScope: "none",
      extract: { text: true, links: false, metadata: true },
    });

    const page = scrapeResult.pages[0];
    const text = page?.text || "";
    if (!page || page.status !== 200 || text.length < 100) {
      return {
        ok: false,
        summary: `Impossible de lire l'article ${url}. ${page?.error || "contenu trop court"}`,
        artifacts: { url, targetType: "web_article", error: page?.error },
        confidence: 0,
        error: page?.error || "empty_content",
      };
    }

    const title = page.metadata?.title || url;
    const excerpt = text.slice(0, 12000);

    let summary = `# 📰 ${title}\n\n🔗 ${url}\n\n`;
    if (canMakeCall("combined")) {
      try {
        const resp = await withRateLimit("combined", () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Tu résumes des articles web en français. Reste FACTUEL: n'extrait QUE ce qui est explicitement présent dans le contenu fourni. Si une info n'y est pas, écris 'NON DISPONIBLE'. Maximum 350 mots, structuré (intro, points clés, conclusion).",
              },
              {
                role: "user",
                content: `${taskHint ? `Objectif: ${taskHint}\n\n` : ""}Article:\n${excerpt}`,
              },
            ],
            temperature: 0.2,
            max_tokens: 700,
          })
        , 0);
        summary += resp.choices[0].message.content || excerpt.slice(0, 1500);
      } catch (e) {
        summary += excerpt.slice(0, 1500);
      }
    } else {
      summary += excerpt.slice(0, 1500);
    }

    return {
      ok: true,
      summary,
      artifacts: {
        url,
        targetType: "web_article",
        title,
        contentLength: text.length,
      },
      confidence: 0.75,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: `Erreur lors de la lecture de ${url}: ${msg}`,
      artifacts: { url, targetType: "web_article" },
      confidence: 0,
      error: msg,
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// PDF extractor (URL → fetch → pdf-parse → AI summary)
// ────────────────────────────────────────────────────────────────────
export async function extractPdf(url: string, taskHint?: string): Promise<ExtractorResult> {
  try {
    // SSRF-safe fetch: every redirect hop is re-validated, so a public
    // URL cannot 302 → loopback / private IP to bypass the guard.
    const fetched = await safeFetch(url, { timeoutMs: 30000, maxRedirects: 5 });
    if (!fetched.ok || !fetched.buffer) {
      return {
        ok: false,
        summary: `Impossible de télécharger le PDF ${url} (${fetched.reason ?? "erreur inconnue"})`,
        artifacts: {
          url,
          targetType: "pdf",
          finalUrl: fetched.finalUrl,
          blockedReason: fetched.reason,
        },
        confidence: 0,
        error: fetched.reason ?? "fetch_failed",
      };
    }
    const buffer = fetched.buffer;

    let text = "";
    let source: "pdf-parse" | "ocr" = "pdf-parse";
    let ocrPages = 0;
    let parseError: string | undefined;
    try {
      const parsed = await pdfParse(buffer);
      text = (parsed.text || "").trim();
    } catch (e: unknown) {
      // pdf-parse can throw on malformed / image-only PDFs — keep the
      // error message but still try OCR before giving up.
      parseError = e instanceof Error ? e.message : String(e);
      text = "";
    }

    // Treat as "no extractible text" if the parser returned nothing
    // useful or if it threw outright. We use a low char threshold here;
    // for the OCR result we only require at least 1 non-whitespace
    // token so very short scanned docs are still accepted.
    if (text.length < 50 || parseError) {
      const ocr = await ocrPdfBuffer(buffer);
      const ocrText = ocr.text.trim();
      const hasOcrContent = ocrText.length > 0 && /\S/.test(ocrText);
      if (hasOcrContent) {
        text = ocrText;
        source = "ocr";
        ocrPages = ocr.pages;
      } else {
        const reason = ocr.error || parseError || "no_text_after_ocr";
        return {
          ok: false,
          summary:
            `Le PDF ${url} semble scanné et l'OCR n'a pas réussi à en extraire de texte` +
            ` (${reason}).`,
          artifacts: {
            url,
            targetType: "pdf",
            textLength: text.length,
            ocrAttempted: true,
            ocrPages: ocr.pages,
            ocrError: ocr.error,
            ...(parseError ? { parseError } : {}),
          },
          confidence: 0.1,
          error: reason,
        };
      }
    }

    const excerpt = text.slice(0, 12000);
    let summary = `# 📄 PDF: ${url}${source === "ocr" ? " _(texte récupéré par OCR)_" : ""}\n\n`;
    if (canMakeCall("combined")) {
      try {
        const resp = await withRateLimit("combined", () =>
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "Tu résumes des PDF en français. Reste strictement FACTUEL — n'invente rien. Maximum 400 mots, structuré.",
              },
              {
                role: "user",
                content: `${taskHint ? `Objectif: ${taskHint}\n\n` : ""}PDF:\n${excerpt}`,
              },
            ],
            temperature: 0.2,
            max_tokens: 800,
          })
        , 0);
        summary += resp.choices[0].message.content || excerpt.slice(0, 1500);
      } catch (e) {
        summary += excerpt.slice(0, 1500);
      }
    } else {
      summary += excerpt.slice(0, 1500);
    }

    return {
      ok: true,
      summary,
      artifacts: {
        url,
        targetType: "pdf",
        textLength: text.length,
        source,
        ...(source === "ocr" ? { ocrPages } : {}),
      },
      confidence: source === "ocr" ? 0.6 : 0.8,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: `Erreur de récupération PDF ${url}: ${msg}`,
      artifacts: { url, targetType: "pdf" },
      confidence: 0,
      error: msg,
    };
  }
}

/**
 * Render a PDF buffer to JPEG pages (via poppler/pdftoppm) and run OCR
 * on each page. Used as a fallback when `pdf-parse` returns no text
 * (typically scanned PDFs).
 */
async function ocrPdfBuffer(
  buffer: Buffer,
  maxPages = 5,
): Promise<{ text: string; pages: number; error?: string }> {
  let tmpPath: string | null = null;
  try {
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");
    const { visionService } = await import("../visionService");
    const { fileToolsAdvanced } = await import("../fileToolsAdvanced");

    tmpPath = path.join(
      os.tmpdir(),
      `homework_pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
    );
    fs.writeFileSync(tmpPath, buffer);

    const vision = await visionService.pdfToImages(tmpPath, maxPages, 200);
    if (!vision.success || vision.pages.length === 0) {
      return { text: "", pages: 0, error: vision.error || "pdf_to_images_failed" };
    }

    const parts: string[] = [];
    for (const page of vision.pages) {
      try {
        const raw = await fileToolsAdvanced.ocrExtract({
          imageBase64: page.imageBase64,
          mimeType: page.mimeType,
          language: "fr",
        });
        const parsed = JSON.parse(raw) as { success?: boolean; text?: string; error?: string };
        if (parsed.success && parsed.text) {
          const t = parsed.text.trim();
          if (t) parts.push(`--- Page ${page.pageNumber} ---\n${t}`);
        }
      } catch {
        // skip page on failure, continue with the rest
      }
    }

    const joined = parts.join("\n\n").trim();
    return { text: joined, pages: vision.pages.length };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: "", pages: 0, error: msg };
  } finally {
    if (tmpPath) {
      try {
        const fs = await import("fs");
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Notion extractor — uses the Notion API when the page lives in the
// connected workspace, falls back to the public web extractor otherwise.
// ────────────────────────────────────────────────────────────────────

/** Extract a Notion page id (UUID) from any Notion URL flavor. */
export function extractNotionPageId(url: string): string | null {
  try {
    const u = new URL(url);
    // Try query string first (e.g. ?p=<id>)
    const pParam = u.searchParams.get("p");
    const candidates: string[] = [];
    if (pParam) candidates.push(pParam);
    candidates.push(u.pathname);
    candidates.push(url);
    for (const c of candidates) {
      // 32 hex chars (no dashes) — typical at the end of a slug
      const flat = c.match(/([0-9a-fA-F]{32})/);
      if (flat) {
        const h = flat[1].toLowerCase();
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      }
      // Already-dashed UUID
      const dashed = c.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
      if (dashed) return dashed[1].toLowerCase();
    }
  } catch {
    // not a URL — fall through
  }
  return null;
}

async function getNotionClient(): Promise<NotionClient | null> {
  try {
    const conn = await connectorBridge.getNotion();
    if (conn.source === "none") return null;
    const token = conn.apiKey || conn.accessToken || "";
    if (!token) return null;
    return new NotionClient({ auth: token });
  } catch {
    return null;
  }
}

interface NotionRichText {
  plain_text?: string;
}
interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

function richTextToString(rt: NotionRichText[] | undefined): string {
  if (!rt || !Array.isArray(rt)) return "";
  return rt.map((t) => t.plain_text || "").join("");
}

function blockToMarkdown(block: NotionBlock, depth = 0): string {
  const indent = "  ".repeat(depth);
  const t = block.type;
  const c = (block as Record<string, unknown>)[t] as Record<string, unknown> | undefined;
  if (!c) return "";
  const rt = (c.rich_text as NotionRichText[] | undefined) ?? undefined;
  const text = richTextToString(rt);
  switch (t) {
    case "heading_1":
      return `\n# ${text}\n`;
    case "heading_2":
      return `\n## ${text}\n`;
    case "heading_3":
      return `\n### ${text}\n`;
    case "paragraph":
      return text ? `${text}\n` : "";
    case "bulleted_list_item":
      return `${indent}- ${text}\n`;
    case "numbered_list_item":
      return `${indent}1. ${text}\n`;
    case "to_do": {
      const checked = (c.checked as boolean) ?? false;
      return `${indent}- [${checked ? "x" : " "}] ${text}\n`;
    }
    case "toggle":
      return `${indent}> ${text}\n`;
    case "quote":
      return `> ${text}\n`;
    case "callout":
      return `> 💡 ${text}\n`;
    case "code": {
      const lang = (c.language as string) || "";
      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }
    case "divider":
      return `\n---\n`;
    case "child_page":
      return `📄 ${(c.title as string) || ""}\n`;
    case "bookmark":
    case "embed":
    case "link_preview":
      return `🔗 ${(c.url as string) || ""}\n`;
    default:
      return text ? `${text}\n` : "";
  }
}

async function fetchAllChildren(
  notion: NotionClient,
  blockId: string,
  depth: number,
  maxBlocks: number,
  collected: { count: number },
): Promise<string> {
  if (collected.count >= maxBlocks) return "";
  let cursor: string | undefined;
  let out = "";
  do {
    const resp = (await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    })) as { results: NotionBlock[]; has_more: boolean; next_cursor?: string };
    for (const block of resp.results) {
      if (collected.count >= maxBlocks) break;
      collected.count++;
      out += blockToMarkdown(block, depth);
      if (block.has_children && depth < 4) {
        out += await fetchAllChildren(notion, block.id, depth + 1, maxBlocks, collected);
      }
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor && collected.count < maxBlocks);
  return out;
}

function extractPageTitleFromMeta(page: Record<string, unknown>): string {
  const props = (page.properties as Record<string, { type?: string; title?: NotionRichText[] }>) || {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const text = richTextToString(prop.title);
      if (text) return text;
    }
  }
  return "Page Notion";
}

export async function extractNotionPage(url: string, taskHint?: string): Promise<ExtractorResult> {
  const pageId = extractNotionPageId(url);
  const notion = pageId ? await getNotionClient() : null;

  if (pageId && notion) {
    try {
      const pageMeta = (await notion.pages.retrieve({ page_id: pageId })) as Record<string, unknown>;
      const title = extractPageTitleFromMeta(pageMeta);
      const collected = { count: 0 };
      const body = await fetchAllChildren(notion, pageId, 0, 400, collected);
      const trimmed = body.trim();
      if (trimmed.length >= 30) {
        const excerpt = trimmed.slice(0, 12000);
        let summary = `# 📝 ${title}\n\n🔗 ${url}\n\n`;
        let aiOut = "";
        if (canMakeCall("combined")) {
          try {
            const resp = await withRateLimit("combined", () =>
              openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content:
                      "Tu résumes des pages Notion en français. Reste FACTUEL: n'extrait QUE ce qui est explicitement présent dans le contenu fourni. Conserve la structure (titres, listes, paragraphes) quand elle est utile. Si une info manque, écris 'NON DISPONIBLE'. Maximum 400 mots.",
                  },
                  {
                    role: "user",
                    content: `${taskHint ? `Objectif: ${taskHint}\n\n` : ""}Page Notion « ${title} »:\n${excerpt}`,
                  },
                ],
                temperature: 0.2,
                max_tokens: 800,
              }),
            0);
            aiOut = resp.choices[0].message.content || "";
          } catch {
            aiOut = "";
          }
        }
        summary += aiOut || excerpt.slice(0, 4000);
        return {
          ok: true,
          summary,
          artifacts: {
            url,
            targetType: "notion",
            source: "notion_api",
            pageId,
            title,
            blockCount: collected.count,
            contentLength: trimmed.length,
          },
          confidence: 0.9,
        };
      }
      // Otherwise (empty page) — fall through to web fallback below.
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // Common case: page not shared with the integration → 404/object_not_found.
      // We log and fall back to the public web extractor.
      console.log(`[Notion] API extraction failed for ${pageId}: ${msg} — falling back to web`);
    }
  }

  const fallback = await extractWebArticle(url, taskHint);
  return {
    ...fallback,
    artifacts: {
      ...fallback.artifacts,
      targetType: "notion",
      source: "web_fallback",
      ...(pageId ? { pageId } : {}),
      ...(notion ? {} : { notionConnected: false }),
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Anti-hallucination guard for unknown targets.
// ────────────────────────────────────────────────────────────────────
export function unknownTargetResult(url: string): ExtractorResult {
  return {
    ok: false,
    summary:
      `Je n'ai pas pu identifier de source fiable à extraire pour cette tâche` +
      (url ? ` (URL: ${url})` : "") +
      `. Plutôt que d'inventer du contenu, je m'arrête ici. Précise le type de cible (article, repo GitHub, PDF, page Notion, page sportive…) et je relance.`,
    artifacts: { url, targetType: "unknown" },
    confidence: 0,
    error: "unknown_target",
  };
}
