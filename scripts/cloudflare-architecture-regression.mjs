import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const notes = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel.replaceAll(path.sep, "/"));
  }
  return out;
}

const packageJson = JSON.parse(read("package.json"));
const allDeps = {
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
};

const nextVersion = String(allDeps.next || "");
if (!/^16\./.test(nextVersion)) {
  fail(`Next.js major changed from the Cloudflare-audited 16.x baseline: ${nextVersion || "missing"}`);
} else {
  note(`Next.js baseline: ${nextVersion}`);
}

for (const dependency of Object.keys(allDeps)) {
  if (/netlify/i.test(dependency)) {
    fail(`Netlify-specific dependency is not allowed in the Cloudflare-first app lane: ${dependency}`);
  }
}

const nextConfig = exists("next.config.mjs") ? read("next.config.mjs") : "";
if (/netlify/i.test(nextConfig)) {
  fail("next.config.mjs contains a Netlify-specific dependency/configuration");
}

const appFiles = walk("app");
const routeHandlers = appFiles.filter((file) => /\/route\.(?:js|jsx|ts|tsx)$/.test(file));
if (routeHandlers.length > 0) {
  fail(`New App Router route handler(s) require explicit Worker CPU/runtime review: ${routeHandlers.join(", ")}`);
} else {
  note("App Router route handlers: 0");
}

const heavyBrowserEntrypoints = [
  "app/ocr/page.tsx",
  "app/ocr/auto/page.tsx",
  "app/ocr/general/page.tsx",
  "app/parts-print/page.tsx",
  "app/inspection/print/page.tsx",
];

for (const rel of heavyBrowserEntrypoints) {
  if (!exists(rel)) {
    fail(`Expected browser-side heavy-processing entrypoint is missing: ${rel}`);
    continue;
  }
  const source = read(rel);
  if (!/^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["'];/m.test(source)) {
    fail(`Heavy image/PDF/print entrypoint must stay browser-side (missing use client): ${rel}`);
  }
}

const supabaseFile = "app/supabase.ts";
if (!exists(supabaseFile)) {
  fail("Supabase client module is missing: app/supabase.ts");
} else {
  const supabaseSource = read(supabaseFile);
  if (!supabaseSource.includes("NEXT_PUBLIC_SUPABASE_URL")) {
    fail("Supabase client must continue to use NEXT_PUBLIC_SUPABASE_URL for browser-direct communication");
  }
  if (!supabaseSource.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
    fail("Supabase client must continue to use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (/service[_-]?role/i.test(supabaseSource)) {
    fail("Service-role credentials must never be embedded in the browser Supabase client");
  }
}

const entrypointPattern = /\/(?:page|layout|loading|error|not-found)\.(?:js|jsx|ts|tsx)$/;
const nodeHeavyPattern = /(?:from\s+["'](?:node:)?(?:fs|child_process|worker_threads|cluster)["']|require\(["'](?:node:)?(?:fs|child_process|worker_threads|cluster)["']\)|\bPaddleOCR\b|\bpaddleocr\b)/;
const serverEntrypointRisks = [];
for (const rel of appFiles.filter((file) => entrypointPattern.test(file))) {
  const source = read(rel);
  const isClient = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["'];/m.test(source);
  if (!isClient && nodeHeavyPattern.test(source)) serverEntrypointRisks.push(rel);
}
if (serverEntrypointRisks.length > 0) {
  fail(`Server entrypoint(s) contain Node/heavy-processing primitives and require Worker CPU review: ${serverEntrypointRisks.join(", ")}`);
} else {
  note("Server entrypoints with Node/heavy-processing primitives: 0");
}

if (failures.length > 0) {
  console.error("Cloudflare architecture regression: FAIL");
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log("Cloudflare architecture regression: PASS");
for (const message of notes) console.log(`- ${message}`);
console.log("- Heavy OCR/image/PDF/print entrypoints remain browser-side");
console.log("- Supabase remains browser-direct with public credentials only");
console.log("- Netlify-specific runtime dependency/configuration not detected");
