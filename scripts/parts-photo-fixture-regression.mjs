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

const forbiddenPersonalDataKeys = new Set([
  "customerName",
  "customer_name",
  "phone",
  "address",
  "chassisNumber",
  "registrationNumber",
  "slipNumber",
]);

function scanForbiddenKeys(value, id, location = "fixture") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, id, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPersonalDataKeys.has(key)) fail(id, `forbidden personal-data key at ${location}.${key}`);
    scanForbiddenKeys(child, id, `${location}.${key}`);
  }
}

for (const { file, data } of fixtures) {
  const id = data.id || file;
  if (!Array.isArray(data.expected) || !data.expected.length) fail(id, "expected rows are missing");
  if (!data.columnMapping || typeof data.columnMapping !== "object") fail(id, "columnMapping is missing");
  if (!Number.isInteger(data.captureVariants) || data.captureVariants < 1) fail(id, "captureVariants must be >= 1");

  const kind = String(data.id || "").includes("yellow")
    ? "yellow"
    : String(data.id || "").includes("white")
      ? "white"
      : "unknown";
  if (kind === "unknown") fail(id, "fixture id must identify yellow or white document type");
  if (kind !== "unknown" && !file.includes(kind)) fail(id, `filename must match ${kind} document type`);

  // Ground-truth files must remain anonymous. Do not add actual customer or vehicle identifiers.
  scanForbiddenKeys(data, id);
  const serialized = JSON.stringify(data);
  if (/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/.test(serialized)) fail(id, "phone-like value found in fixture");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialized)) fail(id, "email-like value found in fixture");
}

const yellowFixtures = fixtures.filter(({ data }) => String(data.id || "").includes("yellow"));
if (!yellowFixtures.length) {
  fail("yellow", "yellow delivery fixture is missing");
} else {
  for (const { file, data: yellow } of yellowFixtures) {
    const id = yellow.id || file;
    if (yellow.columnMapping?.qty !== "出庫数") fail(id, "qty must map to 出庫数");
    if (yellow.columnMapping?.retail !== "標準価格") fail(id, "retail must map to 標準価格");
    if (yellow.columnMapping?.cost !== "単価") fail(id, "cost must map to 単価");
    for (const [index, row] of (yellow.expected || []).entries()) {
      for (const key of ["name", "qty", "retail", "cost"]) {
        if (String(row?.[key] ?? "").trim() === "") fail(id, `expected[${index}].${key} must be populated`);
      }
    }
  }
}

const whiteFixtures = fixtures.filter(({ data }) => String(data.id || "").includes("white"));
if (!whiteFixtures.length) {
  fail("white", "white parts-list fixture is missing");
} else {
  for (const { file, data: white } of whiteFixtures) {
    const id = white.id || file;
    if (white.columnMapping?.qty !== "数量") fail(id, "qty must map to 数量");
    if (white.columnMapping?.retail !== "単価") fail(id, "retail must map to 単価");
    if (white.columnMapping?.cost !== "") fail(id, "cost must stay blank when the document has no purchase-price column");

    const sourceRows = white.expectedSourceRows || [];
    const expected = white.expected || [];
    if (sourceRows.length !== expected.length) fail(id, "expectedSourceRows and expected length differ");

    for (let i = 0; i < Math.max(sourceRows.length, expected.length); i += 1) {
      const source = sourceRows[i] || {};
      const mapped = expected[i] || {};
      const computedTotal = Number(source.qty || 0) * Number(source.unitPrice || 0);
      if (String(computedTotal) !== String(source.lineTotal || "")) {
        fail(id, `expectedSourceRows[${i}] lineTotal does not equal qty * unitPrice`);
      }
      if (mapped.name !== source.name) fail(id, `expected[${i}].name differs from source row`);
      if (mapped.qty !== source.qty) fail(id, `expected[${i}].qty differs from source row`);
      if (mapped.retail !== source.unitPrice) fail(id, `expected[${i}].retail must equal source unitPrice`);
      if (mapped.cost !== "") fail(id, `expected[${i}].cost must remain blank`);
    }
  }
}

if (failures.length) {
  console.error(`FAIL parts-photo fixture regression: ${failures.length} issue(s)`);
  for (const item of failures) console.error(`  ${item}`);
  process.exit(1);
}

const yellowRows = yellowFixtures.reduce((sum, { data }) => sum + (data.expected?.length || 0), 0);
const whiteRows = whiteFixtures.reduce((sum, { data }) => sum + (data.expected?.length || 0), 0);
console.log(`PASS parts-photo fixture regression: ${fixtures.length} fixture(s)`);
console.log(`  yellow: ${yellowFixtures.length} fixture(s), ${yellowRows} ground-truth row(s), 標準価格→定価 / 単価→仕入れ`);
console.log(`  white: ${whiteFixtures.length} fixture(s), ${whiteRows} ground-truth row(s), 単価→定価 / 仕入れ→空欄`);
