import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, rename, mkdir, writeFile, stat } from "fs/promises";

// ─────────────────────────────────────────────────────────────────────────────
// ALLOWLIST — packages bundled directly into dist/index.cjs
// Rules: must be CJS-compatible (or safely convertible by esbuild), no native
// bindings, no dynamic requires that break at bundle time.
// ─────────────────────────────────────────────────────────────────────────────
const allowlist = [
  "@google/generative-ai",
  "axios",
  "compression",
  "connect-pg-simple",
  "cookie-parser",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",        // ESM v3.x — esbuild converts it fine; upgrade to v4 would break
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",          // v9 is CJS despite having type:cjs, stays bundleable
  "bcryptjs",      // pure JS bcrypt — replaces native bcrypt to avoid MODULE_NOT_FOUND on deploy
  "cheerio",       // HTML parser — pure JS, used by webfetch/scraping
  "ws",
  "zod",
  "zod-validation-error",
];

// ─────────────────────────────────────────────────────────────────────────────
// ESM-ONLY — packages whose ESM internals break when bundled into CJS output.
// These use dynamic imports, top-level await, or circular ESM graphs that
// esbuild cannot safely flatten at build time.
// ─────────────────────────────────────────────────────────────────────────────
const esmOnlyPackages = [
  "p-limit",
  "p-retry",
  "mammoth",
  "pdf-parse",
  "exceljs",
];

// ─────────────────────────────────────────────────────────────────────────────
// ALWAYS EXTERNAL — packages that MUST NOT be bundled.
// Includes: native addons (.node bindings), packages > 5 MB that would bloat
// the CJS, packages with broken DefaultTransporter or CJS wrapper issues.
//
// ⚠️  HETZNER NOTE: All packages in this list + esmOnlyPackages must be
//     installed in /var/www/ulysse/node_modules on the server.
//     After `npm install`, also run manually if missing:
//       npm install pdfkit fontkit restructure
// ─────────────────────────────────────────────────────────────────────────────
const alwaysExternal = [
  // ── Chromium / browser automation ──────────────────────────────────────────
  "playwright",
  "playwright-core",
  "chromium-bidi",
  "puppeteer",
  "puppeteer-core",

  // ── PDF / font native modules ───────────────────────────────────────────────
  "pdfkit",          // Complex native font subsystem
  "fontkit",         // Binary font parser (transitive dep of pdfkit)
  "restructure",     // Binary data parser (transitive dep of fontkit)

  // ── Native node addons (.node bindings) ────────────────────────────────────
  "bcrypt",          // C++ binding — napi-v3/bcrypt_lib.node
  "sodium-native",   // libsodium C binding
  "sharp",           // libvips C binding
  "@discordjs/opus", // libopus C binding (Discord voice)
  "prism-media",     // Audio transcoding native deps

  // ── Large packages better kept external ────────────────────────────────────
  "googleapis",      // 6.4 MB — DefaultTransporter breaks when bundled into CJS
  "discord.js",      // Huge dep tree with ESM/CJS mix
  "ssh2",            // Native ssh-crypto deps
  "imapflow",        // IMAP client — ESM internals
  "ioredis",         // Redis — large dependency tree
  "helmet",          // Security headers — fine to keep external
  "@octokit/rest",   // GitHub API client — ESM internally
  "tesseract.js",    // WASM-based OCR
  "docx",            // Word document generation — ESM
  "archiver",        // ZIP streaming — native zlib deps
  "adm-zip",         // ZIP parser — fine external
  "apify-client",    // Apify web scraping client
];

// ─────────────────────────────────────────────────────────────────────────────

async function buildAll() {
  const buildStart = Date.now();
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("moving index.html out of CDN publicDir...");
  await mkdir("dist/html", { recursive: true });
  await rename("dist/public/index.html", "dist/html/index.html");
  console.log("index.html moved to dist/html/ (bypasses CDN cache)");

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];

  // All deps NOT in allowlist are external — deduplicate with Set
  const externalSet = new Set<string>([
    ...allDeps.filter((dep) => !allowlist.includes(dep)),
    ...esmOnlyPackages,
    ...alwaysExternal,
  ]);

  const result = await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    target: "node18",       // Optimize for actual Hetzner runtime
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    sourcemap: true,         // → dist/index.cjs.map — essential for production debugging
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minifyWhitespace: true,   // Remove dead space (safe)
    minifySyntax: true,       // Dead code elimination (safe)
    minifyIdentifiers: false, // ← KEEP names readable in stack traces
    external: [...externalSet],
    metafile: true,           // Bundle analysis data
    logLevel: "info",
  });

  // ── Post-build verification ────────────────────────────────────────────────
  const distStat = await stat("dist/index.cjs");
  const distMB = (distStat.size / 1024 / 1024).toFixed(2);

  if (distStat.size < 500_000) {
    throw new Error(`Build suspiciously small: ${distMB}MB — something went wrong`);
  }
  if (distStat.size > 20_000_000) {
    throw new Error(`Build suspiciously large: ${distMB}MB — check allowlist for bloated package`);
  }

  // ── Bundle analysis output ─────────────────────────────────────────────────
  if (result.metafile) {
    const inputs = result.metafile.inputs;
    const topInputs = Object.entries(inputs)
      .sort(([, a], [, b]) => b.bytes - a.bytes)
      .slice(0, 15)
      .map(([file, data]) => `  ${(data.bytes / 1024).toFixed(1).padStart(7)} KB  ${file}`);

    const manifest = {
      buildAt: new Date().toISOString(),
      durationMs: Date.now() - buildStart,
      bundleSizeMB: parseFloat(distMB),
      externalCount: externalSet.size,
      bundledModuleCount: Object.keys(inputs).length,
      top15BundledInputs: topInputs,
      nodeVersion: process.version,
      packageVersion: pkg.version,
    };

    await writeFile("dist/build-manifest.json", JSON.stringify(manifest, null, 2));
    console.log("\n── Top bundled inputs by size ──────────────────────────────");
    topInputs.forEach((l) => console.log(l));
  }

  console.log(`\n  dist/index.cjs  ${distMB}mb`);
  console.log(`  dist/index.cjs.map  (source map for production debugging)`);
  console.log(`  dist/build-manifest.json`);
}

buildAll()
  .then(() => {
    console.log("\n⚡ BUILD COMPLETE SUCCESS");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✗ BUILD FAILED:", err);
    process.exit(1);
  });
