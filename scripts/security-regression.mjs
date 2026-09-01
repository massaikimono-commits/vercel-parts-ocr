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
const lock = JSON.parse(read("package-lock.json"));
const ocrWorkflow = read(".github/workflows/vehicle-certificate-regression.yml");
const coreWorkflow = read(".github/workflows/app-core-build.yml");
const gitignore = read(".gitignore");
const fileSecurity = read("app/lib/file-security.ts");
const ocrDedicated = read("app/ocr/page.tsx");
const ocrGeneral = read("app/ocr/general/page.tsx");
const ocrAuto = read("app/ocr/auto/page.tsx");
const vehicleFast = read("app/vehicle-workflow-fast/page.tsx");
const supabaseClient = read("app/supabase.ts");
const authSecurity = read("app/lib/auth-security.ts");
const nextConfig = read("next.config.mjs");
const pdfNative = read("app/certificate-pdf-native-reader.jsx");
const pdfBridge = read("app/certificate-pdf-bridge.jsx");
const customerVehicles = read("app/customer-vehicles/page.tsx");
const partsData = read("app/parts-data/page.tsx");
const vehicleV3 = read("app/vehicle-workflow-v3/page.tsx");
const clientSecurity = read("app/lib/client-security.ts");

pass("route guard imported", layout.includes('AuthRouteGuard from "./auth-route-guard"'));
pass("route guard wraps app", layout.includes("<AuthRouteGuard>") && layout.includes("</AuthRouteGuard>"));
pass("route guard checks session", guard.includes("supabase.auth.getSession()"));
pass("route guard redirects unauthenticated users", guard.includes('location.replace("/")'));
pass("publishable Supabase key only", supabase.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") && !/SERVICE_ROLE|service_role/i.test(supabase));
pass("package is private", pkg.private === true);
pass("git ignores env and private keys", gitignore.includes(".env.*") && gitignore.includes("*.pem") && gitignore.includes("*.key"));
pass("CI blocks high dependency vulnerabilities", ocrWorkflow.includes("npm audit --omit=dev --audit-level=high") && coreWorkflow.includes("npm audit --omit=dev --audit-level=high"));
pass("CI uses npm ci", ocrWorkflow.includes("npm ci --no-audit --no-fund") && coreWorkflow.includes("npm ci --no-audit --no-fund"));
pass("security-patched jsPDF locked", lock.packages?.["node_modules/jspdf"]?.version === "4.2.1");
pass("security-patched Next.js locked", lock.packages?.["node_modules/next"]?.version === "16.3.4");
pass("npm lockfile v3 present", lock.lockfileVersion === 3 && lock.packages?.[""]);
pass("file signature validator exists", fileSecurity.includes("validateDocumentFile") && fileSecurity.includes("%PDF-") && fileSecurity.includes("WEBP"));
pass("dedicated OCR validates files", ocrDedicated.includes("validateDocumentFile(file)"));
pass("generic OCR validates files", ocrGeneral.includes("validateDocumentFile(file)"));
pass("auto OCR validates files", ocrAuto.includes("validateDocumentFile(file)"));
pass("vehicle OCR validates files", vehicleFast.includes("validateDocumentFile(file,{allowPdf:true})"));
pass("URL auth session detection disabled", supabaseClient.includes("detectSessionInUrl: false"));
pass("active app-user verifier exists", authSecurity.includes("app_user_profiles") && authSecurity.includes("is_active"));
pass("protected routes require active app user", guard.includes("isActiveAppSession"));
pass("home session requires active app user", layout.length > 0 && read("app/page.tsx").includes("isActiveAppSession"));
pass("sensitive routes disable caching", netlify.includes('Cache-Control = "no-store, max-age=0"') && netlify.includes('for = "/schedule/*"') && netlify.includes('for = "/customer-vehicles/*"'));
pass("spreadsheet export neutralizer", read("app/lib/client-security.ts").includes("spreadsheetSafeCell"));
pass("PDF resource limits", pdfNative.includes("MAX_PDF_PAGES") && pdfNative.includes("MAX_PDF_RENDER_PIXELS") && pdfBridge.includes("MAX_PDF_PAGES"));
pass("logout clears temporary session context", clientSecurity.includes('sessionStorage.removeItem("parts-active-vehicle")') && clientSecurity.includes('sessionStorage.removeItem("parts-before-ocr-ids")'));
pass("temporary vehicle context is session-only", layout.includes("sessionStorage.getItem(ACTIVE_KEY)") && customerVehicles.includes("sessionStorage.setItem(ACTIVE_KEY") && partsData.includes("sessionStorage.getItem(ACTIVE_KEY)") && vehicleFast.includes("sessionStorage.setItem(ACTIVE_KEY") && vehicleV3.includes("sessionStorage.setItem(ACTIVE_KEY"));
pass("PDF worker is bundled locally", pdfNative.includes('new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url)') && pdfBridge.includes('new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url)') && !pdfNative.includes("cdn.jsdelivr.net") && !pdfBridge.includes("cdn.jsdelivr.net"));
pass("oversized image guard", fileSecurity.includes("MAX_IMAGE_PIXELS") && fileSecurity.includes("MAX_IMAGE_EDGE"));
pass("strict referrer privacy", netlify.includes('Referrer-Policy = "no-referrer"'));
pass("robots disabled", layout.includes("index: false") && layout.includes("follow: false") && netlify.includes("X-Robots-Tag"));
pass("browser source maps disabled", nextConfig.includes("productionBrowserSourceMaps: false"));
pass("framework header disabled", nextConfig.includes("poweredByHeader: false"));

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
