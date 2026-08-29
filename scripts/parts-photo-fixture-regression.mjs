import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "../test/fixtures/parts-photo");

const files = fs.existsSync(FIXTURE_DIR)
  ? fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()
  : [];

if (!files.length) {
  console.error("No parts-photo fixtures found.");
  process.exit(1);
}

const fixtures = files.map((file) => ({
  file,
  data: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")),
}));

const failures = [];
const fail = (id, message) => failures.push(`${id}: ${message}`);

for (const { file, data } of fixtures) {
  const id = data.id || file;
  if (!Array.isArray(data.expected) || !data.expected.length) fail(id, "expected rows are missing");
  if (!data.columnMapping || typeof data.columnMapping !== "object") fail(id, "columnMapping is missing");
  if (!Number.isInteger(data.captureVariants) || data.captureVariants < 1) fail(id, "captureVariants must be >= 1");

  // Ground-truth files must remain anonymous. Do not add actual customer or vehicle identifiers.
  const forbiddenKeys = ["customerName", "customer_name", "phone", "address", "chassisNumber", "registrationNumber", "slipNumber"];
  const serialized = JSON.stringify(data);
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) fail(id, `forbidden top-level personal-data key: ${key}`);
  }
  if (/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/.test(serialized)) fail(id, "phone-like value found in fixture");
}

const yellow = fixtures.find(({ data }) => String(data.id || "").includes("yellow"))?.data;
if (!yellow) {
  fail("yellow", "yellow delivery fixture is missing");
} else {
  if (yellow.columnMapping?.qty !== "出庫数") fail(yellow.id, "qty must map to 出庫数");
  if (yellow.columnMapping?.retail !== "標準価格") fail(yellow.id, "retail must map to 標準価格");
  if (yellow.columnMapping?.cost !== "単価") fail(yellow.id, "cost must map to 単価");
  for (const [index, row] of (yellow.expected || []).entries()) {
    for (const key of ["name", "qty", "retail", "cost"]) {
      if (String(row?.[key] ?? "").trim() === "") fail(yellow.id, `expected[${index}].${key} must be populated`);
    }
  }
}

const white = fixtures.find(({ data }) => String(data.id || "").includes("white"))?.data;
if (!white) {
  fail("white", "white parts-list fixture is missing");
} else {
  if (white.columnMapping?.qty !== "数量") fail(white.id, "qty must map to 数量");
  if (white.columnMapping?.retail !== "単価") fail(white.id, "retail must map to 単価");
  if (white.columnMapping?.cost !== "") fail(white.id, "cost must stay blank when the document has no purchase-price column");

  const sourceRows = white.expectedSourceRows || [];
  const expected = white.expected || [];
  if (sourceRows.length !== expected.length) fail(white.id, "expectedSourceRows and expected length differ");

  for (let i = 0; i < Math.max(sourceRows.length, expected.length); i += 1) {
    const source = sourceRows[i] || {};
    const mapped = expected[i] || {};
    const computedTotal = Number(source.qty || 0) * Number(source.unitPrice || 0);
    if (String(computedTotal) !== String(source.lineTotal || "")) {
      fail(white.id, `expectedSourceRows[${i}] lineTotal does not equal qty * unitPrice`);
    }
    if (mapped.name !== source.name) fail(white.id, `expected[${i}].name differs from source row`);
    if (mapped.qty !== source.qty) fail(white.id, `expected[${i}].qty differs from source row`);
    if (mapped.retail !== source.unitPrice) fail(white.id, `expected[${i}].retail must equal source unitPrice`);
    if (mapped.cost !== "") fail(white.id, `expected[${i}].cost must remain blank`);
  }
}

if (failures.length) {
  console.error(`FAIL parts-photo fixture regression: ${failures.length} issue(s)`);
  for (const item of failures) console.error(`  ${item}`);
  process.exit(1);
}

console.log(`PASS parts-photo fixture regression: ${fixtures.length} fixture(s)`);
console.log(`  yellow: ${yellow?.expected?.length || 0} ground-truth row(s), 標準価格→定価 / 単価→仕入れ`);
console.log(`  white: ${white?.expected?.length || 0} ground-truth row(s), 単価→定価 / 仕入れ→空欄`);
