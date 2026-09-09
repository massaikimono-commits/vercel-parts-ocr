import fs from "node:fs";
import assert from "node:assert/strict";
import {
  MINIMAL_RUN_IDS,
  runMinimalDiagnosticBatch,
  buildMinimalDiagnosticSummary,
} from "../app/eval/certificate-qr-minimal-diagnostic/minimal-contract.mjs";

const manifest = JSON.parse(fs.readFileSync(".photo-qr-core-manifest.json", "utf8"));
assert.equal(manifest.identical, true, "generated direct runner must be byte-identical to source runMatrix body");
assert.equal(manifest.pageUsesSharedRunner, true, "legacy diagnostic UI must call the shared runner");
assert.equal(manifest.sourceRunMatrixSha256, manifest.generatedRunnerSha256, "runner identity hash mismatch");
assert.equal(manifest.recognitionLogicChanged, false);
assert.equal(manifest.formalAlgorithmChanged, false);

const page = fs.readFileSync("app/eval/certificate-qr-decode-experiment/page.jsx", "utf8");
assert.match(page, /import \{ runPhotoQrDiagnostic \} from "\.\/photo-qr-diagnostic-core\.generated";/);
assert.match(page, /const runMatrix = runPhotoQrDiagnostic;/);
assert.doesNotMatch(page, /async function runMatrix\(file\)/);

const rows = MINIMAL_RUN_IDS.map((id, index) => ({ id, file: { fixture: index } }));
let calls = 0;
const records = await runMinimalDiagnosticBatch(rows, async (file) => {
  calls += 1;
  if (file.fixture === 2) throw new Error("fixture diagnostic error");
  return { geometryStage: { finalUnionCanonicalCount: file.fixture === 4 ? 0 : file.fixture + 1 } };
});
assert.equal(calls, 6, "runner must receive exactly six inputs");
assert.equal(records.length, 6, "one result record per input is mandatory");
assert.equal(records.filter((record) => record.success).length, 5);
assert.equal(records.filter((record) => !record.success).length, 1);
assert.equal(records[2].imageId, "IMG_0943.jpeg", "result key/order must remain stable despite one diagnostic error");
assert.equal(records[4].success, true, "zero decoded QR count is not a batch error");
assert.equal(records[4].matrix.geometryStage.finalUnionCanonicalCount, 0);

const summarize = (record) => ({ imageId: record.imageId, success: record.success });
const summary = buildMinimalDiagnosticSummary({
  evaluationHead: "0123456789abcdef0123456789abcdef01234567",
  records,
  summarize,
});
assert.equal(summary.schema, "icb-certificate-qr-minimal-diagnostic-summary-v1");
assert.equal(summary.selectedImageCount, 6);
assert.deepEqual(summary.selectedImageIds, ["0940", "0941", "0943", "0945", "0946", "0947"]);
assert.equal(summary.perImageDiagnostics.length, 6);
assert.equal(summary.decodedImageCount, 5);
assert.equal(summary.diagnosticErrorImageCount, 1);
assert.equal(summary.formalReference.finalSafeUnion, 28);
assert.equal(summary.isolation.iframeDomBridgeUsed, false);

await assert.rejects(
  () => runMinimalDiagnosticBatch(rows.slice(0, 5), async () => ({})),
  /MINIMAL_BATCH_INPUT_INVARIANT_FAIL/
);
assert.throws(
  () => buildMinimalDiagnosticSummary({ evaluationHead: null, records: records.slice(0, 5), summarize }),
  /MINIMAL_SUMMARY_REQUIRES_SIX_RECORDS/
);
const wrongOrder = [...records];
[wrongOrder[0], wrongOrder[1]] = [wrongOrder[1], wrongOrder[0]];
assert.throws(
  () => buildMinimalDiagnosticSummary({ evaluationHead: null, records: wrongOrder, summarize }),
  /MINIMAL_SUMMARY_IMAGE_ID_INVARIANT_FAIL/
);

console.log("PASS Photo QR direct-runner identity + six-image batch + summary invariants");
