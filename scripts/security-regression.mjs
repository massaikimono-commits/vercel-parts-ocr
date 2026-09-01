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
const loginHistory = read("app/settings/login-history/page.tsx");
const homeDashboard = read("app/home-dashboard.tsx");
const page = read("app/page.tsx");
const sessionLifetime = read("app/session-lifetime-guard.tsx");
const sessionLifetimeGuard = read("app/session-lifetime-guard.tsx");
const tesseractLocal = read("app/lib/tesseract-local.ts");
const tesseractAssetVersions = read("public/tesseract/ASSET_VERSIONS.txt");

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
pass(
  "Tesseract vendored versions match lockfile",
  lock.packages?.["node_modules/tesseract.js"]?.version === "5.1.1" &&
    lock.packages?.["node_modules/tesseract.js-core"]?.version === "5.1.1" &&
    tesseractAssetVersions.includes("tesseract.js=5.1.1") &&
    tesseractAssetVersions.includes("tesseract.js-core=5.1.1") &&
    tesseractAssetVersions.includes("@tesseract.js-data/jpn=1.0.0") &&
    tesseractAssetVersions.includes("@tesseract.js-data/eng=1.0.0")
);
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
pass("login history linked from dashboard", homeDashboard.includes('/settings/login-history'));
pass("automatic login anomaly alerts wired", homeDashboard.includes("my_login_security_alerts") && loginHistory.includes("my_login_security_alerts"));
pass("auto logout reason is shown", page.includes("icb-auto-logout-reason") && page.includes("30分間操作がなかったため自動ログアウトしました。"));
pass("inactive logout is audited", sessionLifetime.includes('rpc("record_logout")'));
pass("inactive sessions use local signout", sessionLifetime.includes('signOut({ scope: "local" })'));
pass("12 hour absolute session cap remains", sessionLifetime.includes("const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;"));
pass("30 minute inactivity timeout", sessionLifetime.includes("const IDLE_TIMEOUT_MS = 30 * 60 * 1000;"));
pass("login button blocks repeated submits", page.includes("loginBusy") && page.includes("disabled={loginBusy}"));
pass("progressive login throttle wired", page.includes("check_login_throttle") && page.includes("record_login_failure"));
pass("login history screen exists", loginHistory.includes("my_login_security_history") && loginHistory.includes("ログイン履歴"));
pass("login attempts are recorded", page.includes("record_login_failure") && page.includes("record_login_success") && page.includes("record_logout"));
pass("root dashboard disables caching", netlify.includes('for = "/"') && netlify.includes('Cache-Control = "no-store, max-age=0"'));
pass("session revalidated on history restore", sessionLifetimeGuard.includes('window.addEventListener("pageshow"'));
pass("absolute session timeout enforced", sessionLifetimeGuard.includes("12 * 60 * 60 * 1000"));
pass("idle session timeout enforced", sessionLifetimeGuard.includes("30 * 60 * 1000") && sessionLifetimeGuard.includes("sessionExpired()"));
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
  /\bservice_role\b/i,
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
  .filter((p) => /\.(?:js|jsx|ts|tsx|mjs|json)$/i.test(p));

let secretHit = "";
for (const file of candidateFiles) {
  const body = fs.readFileSync(file, "utf8");
  if (forbiddenSecretPatterns.some((re) => re.test(body))) {
    secretHit = path.relative(root, file);
    break;
  }
}
pass("no privileged secret patterns in app", !secretHit, secretHit);

let dynamicSinkHit = "";
let dangerousHtmlFiles = [];
for (const file of candidateFiles) {
  const body = fs.readFileSync(file, "utf8");
  if (!dynamicSinkHit && /(\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(|javascript\s*:)/i.test(body)) {
    dynamicSinkHit = path.relative(root, file);
  }
  if (body.includes("dangerouslySetInnerHTML")) {
    dangerousHtmlFiles.push(path.relative(root, file));
  }
}
let directTesseractImportFiles = [];
for (const file of candidateFiles) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  if (rel === "app/lib/tesseract-local.ts") continue;
  const body = fs.readFileSync(file, "utf8");
  if (
    /(?:from\s+["']tesseract\.js["']|import\(["']tesseract\.js["']\))/.test(body) ||
    /cdn\.jsdelivr\.net\/npm\/tesseract/i.test(body) ||
    /tessdata\.projectnaptha\.com/i.test(body)
  ) {
    directTesseractImportFiles.push(rel);
  }
}
pass("one-time Tesseract vendor workflow removed", !fs.existsSync(path.join(root, ".github/workflows/vendor-tesseract-assets.yml")));
pass(
  "Tesseract runtime is same-origin only",
  directTesseractImportFiles.length === 0 &&
    tesseractLocal.includes('workerPath: "/tesseract/worker.min.js"') &&
    tesseractLocal.includes('corePath: "/tesseract/core"') &&
    tesseractLocal.includes('langPath: "/tesseract/lang"') &&
    fs.existsSync(path.join(root, "public/tesseract/worker.min.js")) &&
    fs.existsSync(path.join(root, "public/tesseract/core/tesseract-core.wasm.js")) &&
    fs.existsSync(path.join(root, "public/tesseract/core/tesseract-core-simd.wasm.js")) &&
    fs.existsSync(path.join(root, "public/tesseract/core/tesseract-core-lstm.wasm.js")) &&
    fs.existsSync(path.join(root, "public/tesseract/core/tesseract-core-simd-lstm.wasm.js")) &&
    fs.existsSync(path.join(root, "public/tesseract/lang/jpn.traineddata.gz")) &&
    fs.existsSync(path.join(root, "public/tesseract/lang/eng.traineddata.gz")),
  directTesseractImportFiles.join(", ")
);

pass("no dynamic code execution sinks", !dynamicSinkHit, dynamicSinkHit);
const normalizedDangerousHtmlFiles = dangerousHtmlFiles.map((file) => file.replaceAll("\\", "/"));
const unexpectedDangerousHtmlFiles = normalizedDangerousHtmlFiles.filter((file) => file !== "app/layout.tsx");
pass(
  "dangerouslySetInnerHTML limited to static layout enhancer",
  unexpectedDangerousHtmlFiles.length === 0 &&
    normalizedDangerousHtmlFiles.includes("app/layout.tsx") &&
    layout.includes("dangerouslySetInnerHTML={{ __html: photoPickerEnhancer }}"),
  normalizedDangerousHtmlFiles.join(", ")
);


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
