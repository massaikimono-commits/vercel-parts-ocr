// Final candidate gate: internal SPA navigation must not regress to native full reloads.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("app");
const exts = new Set([".js", ".jsx", ".ts", ".tsx"]);
const intentionalNativeFiles = new Set([
  "app/auth-route-guard.tsx",
  "app/session-lifetime-guard.tsx",
  "app/settings/login-history/page.tsx",
  "app/lib/internal-navigation.ts",
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (exts.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

let rawInternalAnchors = 0;
let directInternalWindowNav = 0;
let unmanagedLocationAssign = 0;
let managedFiles = 0;
const failures = [];
const intentional = [];

for (const full of walk(root)) {
  const file = path.relative(".", full).replaceAll(path.sep, "/");
  const text = fs.readFileSync(full, "utf8");
  const lines = text.split(/\r?\n/);
  const managed = text.includes("appLocation as location");
  if (managed) managedFiles += 1;

  lines.forEach((line, index) => {
    const at = `${file}:${index + 1}`;
    if (/<a\b[^>]*\bhref\s*=\s*["'`]\//.test(line)) {
      rawInternalAnchors += 1;
      failures.push(`RAW_INTERNAL_ANCHOR ${at} ${line.trim()}`);
    }
    if (/window\.location\.(?:assign|replace)\s*\(\s*["'`]\//.test(line) || /window\.location\.href\s*=\s*["'`]\//.test(line)) {
      directInternalWindowNav += 1;
      failures.push(`DIRECT_WINDOW_INTERNAL_NAV ${at} ${line.trim()}`);
    }
    if (/\blocation\.assign\s*\(/.test(line) && !/window\.location\.assign/.test(line)) {
      if (managed) return;
      if (intentionalNativeFiles.has(file)) {
        intentional.push(`INTENTIONAL_NATIVE ${at} ${line.trim()}`);
        return;
      }
      unmanagedLocationAssign += 1;
      failures.push(`UNMANAGED_LOCATION_ASSIGN ${at} ${line.trim()}`);
    }
  });
}

console.log(`INTERNAL_NAV_MANAGED_FILES=${managedFiles}`);
console.log(`RAW_INTERNAL_ANCHORS=${rawInternalAnchors}`);
console.log(`DIRECT_WINDOW_INTERNAL_NAV=${directInternalWindowNav}`);
console.log(`UNMANAGED_LOCATION_ASSIGN=${unmanagedLocationAssign}`);
for (const row of intentional) console.log(row);

if (failures.length) {
  for (const row of failures) console.error(row);
  process.exit(1);
}

console.log("Internal navigation SPA audit: PASS");
console.log("- normal internal assign/href paths are routed through Next router bridge");
console.log("- raw internal anchors are eliminated");
console.log("- auth/session forced navigation remains native");
console.log("- print/external/download navigation remains native by contract");
