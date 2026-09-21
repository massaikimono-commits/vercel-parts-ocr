import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const structuredSource = fs.readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");

function extractFunction(name) {
  const start = structuredSource.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = structuredSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < structuredSource.length; index += 1) {
    if (structuredSource[index] === "{") depth += 1;
    if (structuredSource[index] === "}") depth -= 1;
    if (depth === 0) return structuredSource.slice(start, index + 1);
  }
  throw new Error(`${name} must have a complete body`);
}

const gateSource = extractFunction("isCertificatePdfCfAcPreflightEnabled");
const preflightSource = extractFunction("runCertificatePdfCfAcPreflight");
const renderPageSource = structuredSource.slice(structuredSource.indexOf("async function renderPage"), structuredSource.indexOf("function safeRenderDiagnosticError"));
const diagnosticHostGate = (locationLike) => {
  const hostname = String(locationLike?.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
};
const cfGate = new Function("isCertificatePdfDiagnosticUiEnabled", `${gateSource}; return isCertificatePdfCfAcPreflightEnabled;`)(diagnosticHostGate);

assert.equal(cfGate({ hostname: "preview.example.vercel.app", search: "" }), false, "CF must default OFF on Preview");
assert.equal(cfGate({ hostname: "preview.example.vercel.app", search: "?certificatePdfCfAc=0" }), false, "CF must remain OFF without an explicit 1");
assert.equal(cfGate({ hostname: "production.example.com", search: "?certificatePdfCfAc=1" }), false, "CF must remain OFF outside diagnostic hosts");
assert.equal(cfGate({ hostname: "preview.example.vercel.app", search: "?certificatePdfCfAc=1" }), true, "CF must be explicitly available on Preview");
assert.equal(cfGate({ hostname: "localhost", search: "?certificatePdfCfAc=1" }), true, "CF must be explicitly available in local diagnostics");

function createRuntime() {
  const checkpoints = [];
  const buffers = [];
  const documents = [];
  const checkpoint = (_diagnosticId, name) => checkpoints.push(name);
  const file = {
    async arrayBuffer() {
      const buffer = new ArrayBuffer(8 + buffers.length);
      buffers.push(buffer);
      return buffer;
    },
  };
  const pdfjs = {
    getDocument() {
      const document = {
        id: documents.length + 1,
        numPages: 1,
        async getPage(pageNumber) {
          assert.equal(pageNumber, 1);
          return { async getTextContent() { return { items: [] }; } };
        },
        async destroy() {},
      };
      documents.push(document);
      return { promise: Promise.resolve(document) };
    },
  };
  const preflight = new Function("checkpointCertificatePdfDiagnostic", `${preflightSource}; return runCertificatePdfCfAcPreflight;`)(checkpoint);
  return { buffers, checkpoints, documents, file, pdfjs, preflight };
}

async function simulateCurrentPath(enabled) {
  const runtime = createRuntime();
  let preflightResult;
  if (enabled) preflightResult = await runtime.preflight(runtime.file, runtime.pdfjs, 1);
  runtime.checkpoints.push("FILE_BUFFER_STARTED");
  const mainBuffer = await runtime.file.arrayBuffer();
  runtime.checkpoints.push("FILE_BUFFER_READY");
  if (enabled) runtime.checkpoints.push("CF_MAIN_DOCUMENT_STARTED");
  runtime.checkpoints.push("DOCUMENT_LOAD_STARTED");
  const mainPdf = await runtime.pdfjs.getDocument({ data: new Uint8Array(mainBuffer) }).promise;
  runtime.checkpoints.push("DOCUMENT_LOADED");
  return { ...runtime, mainBuffer, mainPdf, preflightResult };
}

const off = await simulateCurrentPath(false);
assert.equal(off.buffers.length, 1, "CF OFF must preserve the single current file read");
assert.equal(off.documents.length, 1, "CF OFF must preserve the single current document load");
assert.equal(off.checkpoints.some((name) => name.startsWith("CF_PREFLIGHT_")), false, "CF OFF must emit no preflight checkpoints");
assert.deepEqual(off.checkpoints, ["FILE_BUFFER_STARTED", "FILE_BUFFER_READY", "DOCUMENT_LOAD_STARTED", "DOCUMENT_LOADED"]);

const on = await simulateCurrentPath(true);
const lifecycle = [
  "CF_PREFLIGHT_STARTED", "CF_PREFLIGHT_BUFFER_READY", "CF_PREFLIGHT_DOCUMENT_STARTED", "CF_PREFLIGHT_DOCUMENT_READY",
  "CF_PREFLIGHT_PAGE_READY", "CF_PREFLIGHT_TEXT_READY", "CF_PREFLIGHT_DESTROY_STARTED", "CF_PREFLIGHT_DESTROY_DONE",
];
for (const checkpoint of lifecycle) {
  assert.equal(on.checkpoints.filter((name) => name === checkpoint).length, 1, `${checkpoint} must run exactly once`);
}
assert.equal(on.buffers.length, 2, "preflight and main must read the File separately");
assert.notEqual(on.buffers[0], on.buffers[1], "preflight and main ArrayBuffers must be isolated");
assert.equal(on.documents.length, 2, "preflight and main must create separate PDFDocument instances");
assert.notEqual(on.documents[0], on.mainPdf, "main must not reuse the preflight PDFDocument");
assert.equal(on.preflightResult, undefined, "preflight must return no business data");
assert.ok(on.checkpoints.indexOf("CF_PREFLIGHT_DESTROY_DONE") < on.checkpoints.indexOf("CF_MAIN_DOCUMENT_STARTED"), "main must not start before preflight destroy completes");
assert.ok(on.checkpoints.indexOf("CF_MAIN_DOCUMENT_STARTED") < on.checkpoints.indexOf("DOCUMENT_LOAD_STARTED"), "main marker must precede the existing main document load");

for (const forbidden of ["AUTH_EVENT", "PDF_PRIORITY", "QR_PRIORITY", "dispatchEvent", "new Event", "CustomEvent", "renderPage", "parseStructured", "resolveCertificate"] ) {
  assert.equal(preflightSource.includes(forbidden), false, `preflight must not use business/runtime authority: ${forbidden}`);
}
assert.doesNotMatch(preflightSource, /\breturn\b/);
assert.match(structuredSource, /const cfAcPreflightEnabled = isCertificatePdfCfAcPreflightEnabled\(\);\s*if \(cfAcPreflightEnabled\) await runCertificatePdfCfAcPreflight\(file, pdfjs, diagnosticId\);/);
assert.match(structuredSource, /PDFJS_LOADED[\s\S]*runCertificatePdfCfAcPreflight[\s\S]*FILE_BUFFER_STARTED/);
assert.match(structuredSource, /FILE_BUFFER_READY[\s\S]*CF_MAIN_DOCUMENT_STARTED[\s\S]*DOCUMENT_LOAD_STARTED/);
assert.equal(crypto.createHash("sha256").update(renderPageSource).digest("hex"), "e107794924207c01e2ebda49289ef97128eda0e0078cd9611f0e9733cd8b975b", "renderPage must remain byte-identical");
assert.match(renderPageSource, /page\.render\(\{ canvasContext: ctx, viewport \}\)/);
assert.doesNotMatch(structuredSource.slice(structuredSource.indexOf("const cfAcPreflightEnabled"), structuredSource.indexOf("const pdf = await pdfjs.getDocument", structuredSource.indexOf("const cfAcPreflightEnabled"))), /dispatchEvent|PDF_PRIORITY|QR_PRIORITY|Promise\.race|setTimeout/);

console.log("certificate PDF CF-A/C preflight regression: PASS");
