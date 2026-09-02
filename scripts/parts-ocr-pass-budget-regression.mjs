import fs from "node:fs";

const failures = [];
const auto = fs.readFileSync("app/ocr/auto/page.tsx", "utf8");
const dedicated = fs.readFileSync("app/ocr/page.tsx", "utf8");

if (!auto.includes('if (judged.mode === "unknown")')) {
  failures.push("auto OCR must run dedicated marker rescue only when classification is unknown");
}
if (auto.includes('if (judged.mode !== "dedicated")')) {
  failures.push("auto OCR must not run dedicated marker rescue for already-confident general slips");
}

if (!dedicated.includes("const needsAmountFallback = !costRead.value")) {
  failures.push("dedicated OCR must gate amount-column OCR behind an actual cost fallback need");
}
if (!dedicated.includes("const amountRead = needsAmountFallback")) {
  failures.push("dedicated OCR amount-column read must be conditional");
}

const rowReadLine = dedicated.split("\n").find((line) => line.includes("const nameRead = await readName"));
if (!rowReadLine) {
  failures.push("dedicated OCR row read sequence missing");
} else if (rowReadLine.includes("amountRead")) {
  failures.push("dedicated OCR must not read amount unconditionally with every row");
}

if (failures.length) {
  console.error("FAIL parts OCR pass-budget regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS parts OCR pass-budget regression");
console.log("- confident general slips skip dedicated-marker rescue OCR");
console.log("- dedicated amount column is read only when cost fallback can be used");
