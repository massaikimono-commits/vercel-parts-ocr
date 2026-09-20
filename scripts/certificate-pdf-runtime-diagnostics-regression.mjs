import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveCertificatePdfMissingFields } from "../app/certificate-pdf-canonical-missing-field-resolver.js";
import { createCertificatePdfRuntimeDiagnostics, formatCertificatePdfDiagnosticSnapshot } from "../app/certificate-pdf-runtime-diagnostics.js";

let clock = 1000;
const diagnostics = createCertificatePdfRuntimeDiagnostics({ now: () => (clock += 10) });
const observed = [];
diagnostics.subscribe((snapshot) => observed.push(snapshot));

const first = diagnostics.beginRun(1);
const firstDiagnosticId = first.diagnosticId;
assert.equal(first.sequence, 1);
assert.equal(first.checkpoint, "RUN_STARTED");
diagnostics.checkpoint(firstDiagnosticId, "PDFJS_LOAD_STARTED");
diagnostics.checkpoint(firstDiagnosticId, "PDFJS_LOADED");
const firstSnapshot = diagnostics.getSnapshot(firstDiagnosticId);
assert.deepEqual(firstSnapshot.checkpoints.map((item) => item.checkpoint), ["RUN_STARTED", "PDFJS_LOAD_STARTED", "PDFJS_LOADED"]);
assert.deepEqual(firstSnapshot.checkpoints.map((item) => item.sequence), [1, 2, 3]);
assert.deepEqual(firstSnapshot.checkpoints.map((item) => item.elapsedMs), [0, 10, 20]);

const second = diagnostics.beginRun(2);
const secondDiagnosticId = second.diagnosticId;
const observedAtSecondRun = observed.length;
diagnostics.checkpoint(firstDiagnosticId, "STALE_CHECKPOINT");
assert.equal(observed.length, observedAtSecondRun, "stale run must not overwrite the current observed snapshot");
diagnostics.checkpoint(secondDiagnosticId, "DOCUMENT_LOAD_STARTED", { pageCount: 1, ignored: { private: true } });
const secondSnapshot = diagnostics.getSnapshot(secondDiagnosticId);
assert.equal(secondSnapshot.runId, 2);
assert.equal(secondSnapshot.checkpoint, "DOCUMENT_LOAD_STARTED");
assert.deepEqual(secondSnapshot.metadata, { pageCount: 1 });
assert.equal(diagnostics.getSnapshot(firstDiagnosticId).checkpoint, "STALE_CHECKPOINT");

const terminal = diagnostics.terminal(secondDiagnosticId, "completed", { found: 19 });
assert.equal(terminal.terminalState, "completed");
assert.equal(terminal.checkpoint, "COMPLETED");
assert.match(formatCertificatePdfDiagnosticSnapshot(terminal), /Run: 2[\s\S]*Checkpoint: COMPLETED[\s\S]*Terminal: completed/);

const remounted = diagnostics.beginRun(2);
const observedAtRemount = observed.length;
diagnostics.checkpoint(secondDiagnosticId, "LATE_SAME_RUN_ID_CHECKPOINT");
assert.equal(observed.length, observedAtRemount, "an older diagnostic generation must not overwrite a remounted run with the same runId");
assert.equal(diagnostics.getSnapshot(remounted.diagnosticId).checkpoint, "RUN_STARTED");

const authoritativeState = { owner: "structured-v3", commits: 1, registrationNumber: "unchanged" };
diagnostics.checkpoint(secondDiagnosticId, "AFTER_TERMINAL_OBSERVATION", { commits: 99 });
assert.deepEqual(authoritativeState, { owner: "structured-v3", commits: 1, registrationNumber: "unchanged" });

const failingDiagnostics = createCertificatePdfRuntimeDiagnostics({ now: () => { throw new Error("diagnostic clock failure"); } });
assert.doesNotThrow(() => failingDiagnostics.beginRun(3));
assert.doesNotThrow(() => failingDiagnostics.checkpoint(3, "NEVER_RECORDED"));
const listenerFailure = createCertificatePdfRuntimeDiagnostics({ now: () => 1 });
listenerFailure.subscribe(() => { throw new Error("diagnostic UI failure"); });
assert.doesNotThrow(() => listenerFailure.beginRun(4));

const lines = [{ y: 0.1, text: "自動車登録番号又は車両番号 なにわ 301 ひ 5561", tokens: [] }];
const withoutDiagnostics = resolveCertificatePdfMissingFields(lines, {}).patch;
const semanticObserver = createCertificatePdfRuntimeDiagnostics({ now: () => 1 });
const semanticDiagnosticId = semanticObserver.beginRun(5).diagnosticId;
semanticObserver.checkpoint(semanticDiagnosticId, "STRUCTURED_PARSE_STARTED");
const withDiagnostics = resolveCertificatePdfMissingFields(lines, {}).patch;
semanticObserver.checkpoint(semanticDiagnosticId, "STRUCTURED_PARSED");
assert.deepEqual(withDiagnostics, withoutDiagnostics, "diagnostics must not change parser/final-result semantics");

const moduleSource = fs.readFileSync(new URL("../app/certificate-pdf-runtime-diagnostics.js", import.meta.url), "utf8");
const structuredSource = fs.readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");
for (const forbidden of ["AUTH_EVENT", "PDF_PRIORITY", "dispatchEvent", "addEventListener", "localStorage", "supabase", "fetch(", "setTimeout", "Promise", "async ", "await "]) {
  assert.equal(moduleSource.includes(forbidden), false, `diagnostic module must not contain runtime dependency: ${forbidden}`);
}
for (const checkpoint of [
  "PDFJS_LOAD_STARTED", "PDFJS_LOADED", "FILE_BUFFER_STARTED", "FILE_BUFFER_READY",
  "DOCUMENT_LOAD_STARTED", "DOCUMENT_LOADED", "PAGE_CHOOSE_STARTED", "PAGE_CHOSEN", "TOKENS_LOAD_STARTED",
  "TOKENS_READY", "STRUCTURED_PARSE_STARTED", "STRUCTURED_PARSED", "PAGE_RENDER_STARTED", "PAGE_RENDERED",
  "QR_CHECK_STARTED", "QR_CHECK_DONE", "RUN_ACTIVE_CONFIRMED", "FORM_RESET", "FINAL_COMMIT_STARTED",
  "FINAL_COMMITTED", "completed",
]) {
  assert.match(structuredSource, new RegExp(`(?:checkpointCertificatePdfDiagnostic|terminalCertificatePdfDiagnostic)\\(diagnosticId,?[^)]*${checkpoint}`));
}
assert.match(structuredSource, /beginCertificatePdfDiagnosticRun\(runId\)\?\.diagnosticId/);
assert.match(moduleSource, /recordCheckpoint\(diagnosticId, "RUN_STARTED"/);
assert.match(structuredSource, /data-pdf-structured-v3-diagnostic/);
assert.match(moduleSource, /hostname\.endsWith\("\.vercel\.app"\)/);

console.log("certificate PDF runtime diagnostics regression: PASS");
