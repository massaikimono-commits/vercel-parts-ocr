import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "../test/fixtures/parts-slips");

const OCR_HEADERS = [
  "納品書","品番","品名","受注数","出庫数","標準価格","単価","金額","合計金額",
  "伝票","コード","年月日","区分","車台番号","型式","備考","倉庫","棚番","受注残",
];

function normalizeOCR(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[￥¥]/g, "¥")
    .replace(/[，、]/g, ",")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[｜¦]/g, "|")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "");
}

function money(s) {
  return String(s || "").replace(/[^\d.-]/g, "");
}

function amountValues(line) {
  const matches = String(line || "").match(/\d{1,3}(?:[, ]\d{3})+|\d{4,7}/g) || [];
  return matches
    .map((raw) => ({ raw, value: Number(raw.replace(/[, ]/g, "")) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 100 && x.value <= 2000000);
}

function candidateQty(line, firstAmountRaw) {
  const source = String(line || "");
  const before = firstAmountRaw ? source.slice(0, source.indexOf(firstAmountRaw)) : source;
  const matches = before.match(/(?:^|\s)(\d{1,3})(?=\s|$)/g) || [];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const n = Number(matches[i].trim());
    if (n >= 1 && n <= 999) return String(n);
  }
  return "1";
}

function cleanName(line) {
  return String(line || "")
    .replace(/¥\s*\d[\d, ]*/g, " ")
    .replace(/\b\d{4,7}\b/g, " ")
    .replace(/^[\s:;|・.\-]+|[\s:;|・.\-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function nameScore(line) {
  if (!line) return -100;
  if (OCR_HEADERS.some((h) => line.includes(h))) return -100;
  const cleaned = cleanName(line);
  if (cleaned.length < 2) return -100;

  let score = 0;
  if (/[ぁ-んァ-ヶ一-龠]/.test(cleaned)) score += 5;
  if (/[A-Za-z]/.test(cleaned)) score += 1;
  if (/ASSY|KIT|SET|COMP|クラッチ|ブレーキ|パッド|フィルタ|オイル/i.test(cleaned)) score += 3;
  if (/[\/／]/.test(cleaned)) score += 1;
  if (/^[A-Z0-9_.\/-]+$/i.test(cleaned)) score -= 3;

  const digits = (cleaned.match(/\d/g) || []).length;
  if (digits > cleaned.length * 0.45) score -= 4;
  if (cleaned.length > 45) score -= 2;
  return score;
}

function findNearbyName(lines, rowIndex) {
  let best = "";
  let bestScore = -100;
  for (let i = Math.max(0, rowIndex - 5); i <= Math.min(lines.length - 1, rowIndex + 1); i += 1) {
    if (i === rowIndex) continue;
    const score = nameScore(lines[i]);
    if (score > bestScore) {
      bestScore = score;
      best = cleanName(lines[i]);
    }
  }
  return bestScore >= 1 ? best : "";
}

function parseOCR(text) {
  const lines = normalizeOCR(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const amounts = amountValues(line);
    if (amounts.length < 2) continue;
    const name = findNearbyName(lines, i);
    if (!name) continue;
    out.push({
      name,
      qty: candidateQty(line, amounts[0]?.raw),
      retail: String(amounts[0].value),
      cost: String(amounts[1].value),
    });
  }

  if (!out.length) {
    for (let i = 0; i < lines.length - 1; i += 1) {
      const joined = `${lines[i]} ${lines[i + 1]}`;
      const amounts = amountValues(joined);
      if (amounts.length < 2) continue;
      const name = findNearbyName(lines, i);
      if (!name) continue;
      out.push({
        name,
        qty: candidateQty(joined, amounts[0]?.raw),
        retail: String(amounts[0].value),
        cost: String(amounts[1].value),
      });
      i += 1;
    }
  }

  if (!out.length) {
    for (const line of lines) {
      const cells = line.split(/[,\t|]+/).map((x) => x.trim()).filter(Boolean);
      if (cells.length < 4) continue;
      const nums = cells.slice(1).filter((x) => /\d/.test(x));
      if (nums.length < 3) continue;
      out.push({
        name: cells[0],
        qty: nums[0].replace(/[^\d.-]/g, ""),
        retail: money(nums[1]),
        cost: money(nums[2]),
      });
    }
  }

  const seen = new Set();
  return out.filter((part) => {
    const key = `${part.name.replace(/\s/g, "").toLowerCase()}|${part.qty}|${part.retail}|${part.cost}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareParts(actual, expected) {
  const failures = [];
  if (actual.length !== expected.length) {
    failures.push({ key: "length", expected: expected.length, actual: actual.length });
  }
  const count = Math.max(actual.length, expected.length);
  for (let i = 0; i < count; i += 1) {
    for (const key of ["name","qty","retail","cost"]) {
      const a = actual[i]?.[key] ?? "";
      const e = expected[i]?.[key] ?? "";
      if (String(a) !== String(e)) failures.push({ key: `parts[${i}].${key}`, expected: e, actual: a });
    }
  }
  return failures;
}

const files = fs.existsSync(FIXTURE_DIR)
  ? fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()
  : [];

if (!files.length) {
  console.error("No parts-slip fixtures found.");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
  const actual = parseOCR(fixture.ocrText || "");
  const failures = compareParts(actual, fixture.expected || []);
  if (failures.length) {
    failed += 1;
    console.error(`FAIL ${fixture.id || file}: ${failures.length} mismatch(es)`);
    for (const item of failures) {
      console.error(`  ${item.key}: expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}`);
    }
  } else {
    console.log(`PASS ${fixture.id || file}: ${actual.length} part(s)`);
  }
}

if (failed) {
  console.error(`\n${failed}/${files.length} fixture(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} parts-slip fixture(s) passed.`);
