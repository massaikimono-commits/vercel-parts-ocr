import fs from "node:fs";

const failures = [];

function requireText(path, text, label) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(text)) {
    failures.push(`${label}: expected guard missing in ${path}`);
  }
}

requireText(
  "app/certificate-fuel-classification-fix.tsx",
  'location.pathname === "/vehicle-workflow-v2" || location.pathname === "/vehicle-workflow-fast"',
  "legacy fuel override must be disabled on v2/fast"
);

requireText(
  "app/certificate-consistency-fix.tsx",
  'location.pathname === "/vehicle-workflow-v2" || location.pathname === "/vehicle-workflow-fast"',
  "legacy consistency repush must be disabled on v2/fast"
);

requireText(
  "app/certificate-qr-apply-fixed.jsx",
  'const fastWorkflow =',
  "QR apply must detect the v2/fast workflow"
);

requireText(
  "app/certificate-qr-apply-fixed.jsx",
  'showStatus(parsed, "QR優先値を本体高速OCRへ共有済み");',
  "v2/fast QR apply must share priority without repeated authoritative dispatch"
);

const qrApply = fs.readFileSync("app/certificate-qr-apply-fixed.jsx", "utf8");
const fastIndex = qrApply.indexOf("if (fastWorkflow)");
const dispatchIndex = qrApply.indexOf("window.dispatchEvent(new CustomEvent(AUTH_EVENT", fastIndex);
if (fastIndex < 0 || dispatchIndex < 0 || dispatchIndex < fastIndex) {
  failures.push("QR apply fast-workflow guard must occur before legacy authoritative dispatch.");
}

const fastPage = fs.readFileSync("app/vehicle-workflow-fast/page.tsx", "utf8");
for (const expected of [
  'qr=readQr();const finalPatch={...safePhotoPatch(patch),...qr};',
  'mergePatch(finalPatch);window.dispatchEvent(new CustomEvent(AUTH_EVENT,{detail:finalPatch}));',
]) {
  if (!fastPage.includes(expected)) {
    failures.push("vehicle-workflow-fast must retain its own single final QR-preferred merge.");
  }
}

if (failures.length) {
  console.error("FAIL certificate v2 legacy-override regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS certificate v2 legacy-override regression");
console.log("- legacy fuel DOM heuristic disabled on v2/fast");
console.log("- legacy consistency repush disabled on v2/fast");
console.log("- QR priority remains available without 14 post-OCR redispatches");
console.log("- fast workflow keeps the single final QR-preferred merge");
