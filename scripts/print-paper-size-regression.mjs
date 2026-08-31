import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

function expect(text, needle, label) {
  if (!text.includes(needle)) {
    console.error("FAIL:", label, "missing", needle);
    process.exit(1);
  }
}

const registry = read("app/inspection/template-registry.ts");
const workshop = read("app/inspection/workshop-record-types.ts");
const dailyTemplate = read("app/schedule/daily-report-template.ts");
const dailyPrint = read("app/schedule/print/page.tsx");
const partsPrint = read("app/parts-print/page.tsx");
const inspectionPrint = read("app/inspection/print/page.tsx");

for (const key of [
  "APPENDIX_3_BUSINESS",
  "APPENDIX_5_PRIVATE_TRUCK",
  "APPENDIX_6_PRIVATE_PASSENGER",
  "SCHEDULE_CHECK",
]) {
  expect(registry, `key: "${key}"`, key);
}

const a4Count = (registry.match(/paperSize: "A4"/g) || []).length;
if (a4Count !== 4) {
  console.error("FAIL: expected exactly four A4 non-designated record templates, got", a4Count);
  process.exit(1);
}

expect(registry, 'key: "DESIGNATED_MAINTENANCE_RECORD"', "designated registry");
expect(registry, 'paperSize: "A3"', "designated A3");
expect(registry, 'sourceReference: "WAITING_FOR_PDF"', "designated PDF waiting");
expect(workshop, 'paperSize: "A4"', "workshop A4");
expect(workshop, 'sourceFormat: "PDF"', "workshop PDF source");
expect(dailyTemplate, 'paperSize: "A3"', "daily report A3");
expect(dailyTemplate, 'orientation: "portrait"', "daily report portrait");
expect(dailyPrint, '@page{size:A3 portrait;margin:0}', "daily report print A3");
expect(partsPrint, 'format: "a4"', "parts form A4 PDF");
expect(partsPrint, 'canvas.width = 210 * pxPerMm', "parts A4 width");
expect(partsPrint, 'canvas.height = 297 * pxPerMm', "parts A4 height");
expect(inspectionPrint, '@page{size:A4 portrait;margin:0}', "non-designated record A4");
expect(inspectionPrint, 'mode !== "designated"', "designated generic print blocked");

console.log("PASS print paper size regression");
