import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const contract = read("app/ocr/bakeoff/contract.ts");
const route = read("app/eval/parts-ocr-architecture-bakeoff/page.tsx");
const p0 = read("app/ocr/bakeoff/p0-adapter.ts");
const browser = read("app/ocr/bakeoff/browser-candidates.ts");
const p2 = read("app/ocr/bakeoff/p2-client.ts");
const hybrid = read("app/ocr/bakeoff/hybrid.ts");
const server = read("services/parts-ocr-paddle/app.py");
const scorer = read("scripts/score-parts-ocr-bakeoff-v1.mjs");

for (const field of ["runId", "candidateId", "candidateVersion", "configHash", "imageId", "captureId", "documentFamilyPrediction", "documentRegions", "qualityMetrics", "rowPredictions", "fieldPredictions", "confidence", "abstainReason", "manualReviewRequired", "processingTimeMs", "error", "gtIncluded"]) {
  assert.match(contract, new RegExp(`\\b${field}\\b`), `contract missing ${field}`);
}
assert.match(p0, /candidateId:\s*"P0"/);
assert.match(browser, /candidateId:\s*"P1"/);
assert.match(server, /"candidateId": "P2"/);
assert.match(hybrid, /candidateId:\s*"P4-L"/);
assert.match(route, /buildLocalHybrid/);
assert.match(route, /gtIncluded:\s*false/);
assert.match(server, /await image\.read\(MAX_BYTES \+ 1\)/);
assert.match(server, /del raw/);
assert.doesNotMatch(server, /open\([^)]*["']w|write_bytes|imwrite|NamedTemporaryFile|mkstemp/);
assert.doesNotMatch(server, /allow_origins=\[?["']\*["']/);
assert.doesNotMatch([contract, route, p0, browser, p2, hybrid].join("\n"), /yellow-documents\.corrected|yellow-regression-manifest|FORMAL_A19_GT|physicalRowCount|captureVisibleRowCount/);
assert.match(scorer, /yellow-documents\.corrected\.v2\.json/);
assert.match(scorer, /scoringOnly:\s*true/);
assert.doesNotMatch(route, /supabase|fetch\([^)]*(openai|googleapis|documentai)/i);

const python = spawnSync("python3", ["-m", "unittest", "test_core.py"], { cwd: new URL("../services/parts-ocr-paddle", import.meta.url), encoding: "utf8" });
assert.equal(python.status, 0, `P2 dependency-free core tests failed:\n${python.stdout}\n${python.stderr}`);

console.log(JSON.stringify({ contract: "PASS", candidates: ["P0", "P1", "P2", "P4-L"], gtRuntimeIsolation: "PASS", p2MemoryOnly: "PASS", corsFailClosed: "PASS", p2CoreTests: "PASS", managedApiReference: false }));
