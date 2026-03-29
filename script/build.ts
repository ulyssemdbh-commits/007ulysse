import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, rename, mkdir } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
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
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "zod",
  "zod-validation-error",
];

// ESM-only packages that must be externalized (cannot be bundled into CJS)
const esmOnlyPackages = [
  "p-limit",
  "p-retry",
  "mammoth",
  "pdf-parse",
  "exceljs",
];

// Packages that must always be externalized (native deps, complex bundling issues)
const alwaysExternal = [
  "playwright-core",
  "chromium-bidi",
  "playwright",
  "puppeteer",
  "puppeteer-core",
  "pdfkit",
  "fontkit",
];

async function buildAll() {
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
  const externals = [
    ...allDeps.filter((dep) => !allowlist.includes(dep)),
    ...esmOnlyPackages, // ESM-only packages must always be external
    ...alwaysExternal, // Native deps and complex bundling packages
  ];

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().then(() => {
  console.log("BUILD COMPLETE SUCCESS");
  process.exit(0);
}).catch((err) => {
  console.error("BUILD FAILED:", err);
  process.exit(1);
});
