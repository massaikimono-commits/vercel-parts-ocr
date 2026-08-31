import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const checks = [];
const pass = (name, ok, detail = "") => checks.push({ name, ok, detail });

const layout = read("app/layout.tsx");
const guard = read("app/auth-route-guard.tsx");
const supabase = read("app/supabase.ts");
const netlify = read("netlify.toml");
const pkg = JSON.parse(read("package.json"));
const fileSecurity = read("app/lib/file-security.ts");
const ocrDedicated = read("app/ocr/page.tsx");
const ocrGeneral = read("app/ocr/general/page.tsx");
const ocrAuto = read("app/ocr/auto/page.tsx");
const vehicleFast = read("app/vehicle-workflow-fast/page.tsx");
const supabaseClient = read("app/supabase.ts");

pass("route guard imported", layout.includes('AuthRouteGuard from "./auth-route-guard"'));
pass("route guard wraps app", layout.includes("<AuthRouteGuard>") && layout.includes("</AuthRouteGuard>"));
pass("route guard checks session", guard.includes("supabase.auth.getSession()"));
pass("route guard redirects unauthenticated users", guard.includes('location.replace("/")'));
pass("publishable Supabase key only", supabase.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") && !/SERVICE_ROLE|service_role/i.test(supabase));
pass("package is private", pkg.private === true);
pass("file signature validator exists", fileSecurity.includes("validateDocumentFile") && fileSecurity.includes("%PDF-") && fileSecurity.includes("WEBP"));
pass("dedicated OCR validates files", ocrDedicated.includes("validateDocumentFile(file)"));
pass("generic OCR validates files", ocrGeneral.includes("validateDocumentFile(file)"));
pass("auto OCR validates files", ocrAuto.includes("validateDocumentFile(file)"));
pass("vehicle OCR validates files", vehicleFast.includes("validateDocumentFile(file,{allowPdf:true})"));
pass("URL auth session detection disabled", supabaseClient.includes("detectSessionInUrl: false"));
pass("sensitive routes disable caching", netlify.includes('Cache-Control = "no-store, max-age=0"') && netlify.includes('for = "/schedule/*"') && netlify.includes('for = "/customer-vehicles/*"'));

for (const [name, needle] of [
  ["X-Frame-Options", 'X-Frame-Options = "DENY"'],
  ["X-Content-Type-Options", 'X-Content-Type-Options = "nosniff"'],
  ["HSTS", "Strict-Transport-Security"],
  ["Referrer-Policy", "Referrer-Policy"],
  ["Permissions-Policy", "Permissions-Policy"],
  ["CSP", "Content-Security-Policy"],
  ["Cross-Origin-Opener-Policy", "Cross-Origin-Opener-Policy"],
]) {
  pass("security header: " + name, netlify.includes(needle));
}

const forbiddenSecretPatterns = [
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /\\bservice_role\\b/i,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const candidateFiles = walk(path.join(root, "app"))
  .filter((p) => /\\.(?:js|jsx|ts|tsx|mjs|json)$/i.test(p));

let secretHit = "";
for (const file of candidateFiles) {
  const body = fs.readFileSync(file, "utf8");
  if (forbiddenSecretPatterns.some((re) => re.test(body))) {
    secretHit = path.relative(root, file);
    break;
  }
}
pass("no privileged secret patterns in app", !secretHit, secretHit);

let trackedEnvFiles = [];
try {
  trackedEnvFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => /(^|\/)\.env(?:\.|$)/.test(name));
} catch {
  // Git metadataが無いビルド環境ではこの項目だけスキップ。
}
pass("no tracked .env files", trackedEnvFiles.length === 0, trackedEnvFiles.join(", "));

for (const c of checks) {
  console.log((c.ok ? "PASS" : "FAIL") + " " + c.name + (c.detail ? " — " + c.detail : ""));
}

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error("Security regression failed: " + failed.length + " check(s)");
  process.exit(1);
}
console.log("All " + checks.length + " security regression checks passed.");
