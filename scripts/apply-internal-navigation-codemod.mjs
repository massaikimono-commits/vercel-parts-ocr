import fs from "node:fs";
import path from "node:path";

const targets = [
  "app/customer-vehicles/bulk-import/page.tsx",
  "app/customer-vehicles/history/page.tsx",
  "app/customer-vehicles/layout.tsx",
  "app/customer-vehicles/lease-maintenance/page.tsx",
  "app/customer-vehicles/page.tsx",
  "app/customer-vehicles/photos/page.tsx",
  "app/error.tsx",
  "app/home-dashboard.tsx",
  "app/inspection/page.tsx",
  "app/inspection/print/page.tsx",
  "app/inspection/select/page.tsx",
  "app/loaners/page.tsx",
  "app/loaners/week/page.tsx",
  "app/ocr/auto/page.tsx",
  "app/ocr/page.tsx",
  "app/ocr/stage-parts-review.ts",
  "app/operational-recovery-guard.tsx",
  "app/parts-data/page.tsx",
  "app/parts-print/page.tsx",
  "app/parts-review/page.tsx",
  "app/schedule/active/page.tsx",
  "app/schedule/detail/page.tsx",
  "app/schedule/edit/page.tsx",
  "app/schedule/loaners/page.tsx",
  "app/schedule/month/page.tsx",
  "app/schedule/new/page.tsx",
  "app/schedule/page.tsx",
  "app/schedule/print/page.tsx",
  "app/schedule/search/page.tsx",
  "app/schedule/week/page.tsx",
  "app/schedule/workload/page.tsx",
  "app/settings/business-calendar/edit/page.tsx",
  "app/settings/business-calendar/page.tsx",
  "app/settings/staff/page.tsx",
  "app/vehicle-workflow-fast/page.tsx",
  "app/vehicle-workflow-v3/page.tsx",
];

function importPathFor(file) {
  const from = path.dirname(path.resolve(file));
  const to = path.resolve("app/lib/internal-navigation");
  let rel = path.relative(from, to).replaceAll(path.sep, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function placeImport(text, statement) {
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => !line.startsWith("import { appLocation as location } from "));
  const directiveIndex = filtered.findIndex((line) => /^\s*["']use client["'];?\s*$/.test(line));
  if (directiveIndex >= 0) filtered.splice(directiveIndex + 1, 0, statement);
  else filtered.unshift(statement);
  return filtered.join("\n");
}

let changed = 0;
for (const file of targets) {
  let text = fs.readFileSync(file, "utf8");
  const before = text;

  if (file === "app/schedule/month/page.tsx" || file === "app/schedule/week/page.tsx") {
    text = text.replace(/window\.location\.href\s*=\s*([^;\n]+);/g, "location.assign($1);");
  }

  const hasUnqualifiedLocation = /(?<!window\.)\blocation\.(?:assign|href|reload|replace|pathname|search)\b/.test(text);
  if (hasUnqualifiedLocation) {
    const statement = `import { appLocation as location } from "${importPathFor(file)}";`;
    text = placeImport(text, statement);
  }

  if (text !== before) {
    fs.writeFileSync(file, text);
    changed += 1;
    console.log(`updated ${file}`);
  }
}

console.log(`INTERNAL_NAV_CODEMOD_CHANGED=${changed}`);
