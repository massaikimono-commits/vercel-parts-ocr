import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import { beginPdfRun, hasPdfRunMark, isCurrentPdfRun, isPdfRunContinuation, markPdfRunContinuation, pdfRunForEvent } from "../app/certificate-pdf-run-identity.js";
import * as rowSemantics from "../app/lib/certificate-pdf-row-semantics.mjs";
import * as fieldSemantics from "../app/lib/certificate-pdf-field-semantics.mjs";

const require = createRequire(import.meta.url);
const read = (path) => fs.readFileSync(new URL(`../app/${path}`, import.meta.url), "utf8");
const v2Layout = read("vehicle-workflow-v2/layout.tsx");
const fastLayout = read("vehicle-workflow-fast/layout.tsx");
const fastPage = read("vehicle-workflow-fast/page.tsx");
for (const [route, layout, page] of [["v2", v2Layout, ""], ["fast", fastLayout, fastPage]]) {
  for (const component of ["CertificatePdfRunOwner", "CertificatePdfStructuredReaderV3", "CertificatePdfNativeReaderV2", "CertificatePdfWorkerLocalizer"]) {
    const count = ((layout + page).match(new RegExp(`<${component}\\s*/>`, "g")) || []).length;
    assert.equal(count, 1, `${route}: ${component} mount count`);
  }
  assert(layout.indexOf("<CertificatePdfRunOwner />") < layout.indexOf("<CertificatePdfStructuredReaderV3 />"));
  assert(layout.indexOf("<CertificatePdfStructuredReaderV3 />") < layout.indexOf("<CertificatePdfNativeReaderV2 />"));
}
assert(v2Layout.indexOf("<CertificatePdfV3CompletionGuard />") < v2Layout.indexOf("<CertificatePdfRunOwner />"));
assert(v2Layout.indexOf("<CertificatePdfRowCorrector />") < v2Layout.indexOf("<CertificatePdfStructuredReaderV3 />"));
assert(!read("customer-vehicles/bulk-import/page.tsx").includes("certificate-pdf-run-identity"));
assert(read("certificate-pdf-native-reader-v2.jsx").includes('document.removeEventListener("change", onChange);'));

// Replace only external PDF parsing in the test VM. The mounted event handlers,
// completion paths and authoritative writers execute from the actual source.
function loadComponent(path, replacements = {}) {
  let source = read(path).replaceAll("import.meta.url", '"file:///test.jsx"');
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && replacements[node.name?.text]);
  assert.equal(functions.length, Object.keys(replacements).length, `${path}: test seams`);
  for (const node of functions.sort((a, b) => b.pos - a.pos)) {
    source = source.slice(0, node.getStart(parsed)) + replacements[node.name.text] + source.slice(node.end);
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const module = { exports: {} };
  const mockRequire = (name) => name === "react" ? { useLayoutEffect: (callback) => { cleanups.push(callback()); } }
    : name === "./certificate-pdf-run-identity" ? { beginPdfRun, hasPdfRunMark, isCurrentPdfRun, isPdfRunContinuation, markPdfRunContinuation, pdfRunForEvent }
      : name === "./lib/certificate-pdf-row-semantics.mjs" ? rowSemantics
      : name === "./lib/certificate-pdf-field-semantics.mjs" ? fieldSemantics
      : require(name);
  new Function("require", "module", "exports", output)(mockRequire, module, module.exports);
  module.exports.default();
}

let cleanups = [];
let changeCapture = [];
let changeBubble = [];
let authListeners = [];
let authCapture = [];
let weakFallbackListeners = [];
let events = [];
let deferred = new Map();
let currentInput;
class FakeInput {
  constructor() { this.type = "file"; this.files = []; this.dataset = {}; this.value = "selected"; }
  dispatchEvent(event) { return emitChange(this, event); }
}
class FakeEvent {
  constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles; this.stopped = false; }
  preventDefault() {}
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; }
}
class FakeCustomEvent extends FakeEvent {
  constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
}
function emitChange(input, event = new FakeEvent("change", { bubbles: true })) {
  event.target = input;
  for (const callback of [...changeCapture]) { callback(event); if (event.stopped) break; }
  if (!event.stopped) for (const callback of [...changeBubble]) { callback(event); if (event.stopped) break; }
  return event;
}
function emitAuth(patch) { window.dispatchEvent(new FakeCustomEvent("vehicle-certificate-authoritative", { detail: patch })); }
function pause(id) {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  deferred.set(id, { promise, resolve });
  return promise;
}
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 5)); }
function select(id) {
  currentInput.files = [{ type: "application/pdf", name: `${id}.pdf`, size: 1, id, slice() { return this; }, arrayBuffer: async () => new TextEncoder().encode(id).buffer }];
  currentInput.value = "selected";
  const event = emitChange(currentInput);
  assert.equal(hasPdfRunMark(event), true);
  return pdfRunForEvent(event);
}
function setup() {
  cleanups.forEach((cleanup) => cleanup?.()); cleanups = [];
  changeCapture = []; changeBubble = []; authListeners = []; authCapture = []; weakFallbackListeners = []; events = []; deferred = new Map();
  globalThis.HTMLInputElement = FakeInput;
  globalThis.Event = FakeEvent;
  globalThis.CustomEvent = FakeCustomEvent;
  globalThis.location = { pathname: "/vehicle-workflow-v2" };
  globalThis.document = {
    addEventListener(name, callback) { if (name === "change") changeBubble.push(callback); },
    removeEventListener(name, callback) { if (name === "change") changeBubble = changeBubble.filter((fn) => fn !== callback); },
    querySelectorAll() { return []; },
  };
  globalThis.window = {
    __vehicleCertificatePdfPriority: null, __vehicleCertificateQrPriority: null, __vehicleCertificatePdfRowPriority: null,
    addEventListener(name, callback, capture) { if (name === "change" && capture) changeCapture.push(callback); else if (name === "vehicle-certificate-authoritative") (capture ? authCapture : authListeners).push(callback); else if (name === "certificate-pdf-weak-structured-fallback") weakFallbackListeners.push(callback); },
    removeEventListener(name, callback) { if (name === "change") changeCapture = changeCapture.filter((fn) => fn !== callback); else if (name === "vehicle-certificate-authoritative") { authListeners = authListeners.filter((fn) => fn !== callback); authCapture = authCapture.filter((fn) => fn !== callback); } else if (name === "certificate-pdf-weak-structured-fallback") weakFallbackListeners = weakFallbackListeners.filter((fn) => fn !== callback); },
    dispatchEvent(event) { if (event.type === "vehicle-certificate-authoritative") { events.push(event.detail); for (const callback of [...authCapture, ...authListeners]) callback(event); } else if (event.type === "certificate-pdf-weak-structured-fallback") { for (const callback of [...weakFallbackListeners]) callback(event); } return true; },
    setInterval() { return 1; }, clearInterval() {},
  };
  currentInput = new FakeInput();
  loadComponent("certificate-pdf-run-owner.jsx");
}

// CASE 1–4: lifecycle and shared ownership, including B before/after completion.
setup();
const first = select("first");
assert(isCurrentPdfRun(first, "test"));
const a = select("A"), b = select("B");
assert(!isCurrentPdfRun(a, "test"));
assert(isCurrentPdfRun(b, "test"));
assert.equal(window.__vehicleCertificatePdfPriority, null);
assert.equal(window.__vehicleCertificateQrPriority, null);
assert.equal(window.__vehicleCertificatePdfRowPriority, null);
const continuation = markPdfRunContinuation(new FakeEvent("change"), b);
assert(isPdfRunContinuation(continuation));
const during = pdfRunForEvent(continuation);
emitChange(currentInput, continuation);
assert.equal(pdfRunForEvent(continuation), during);
assert.equal(window.__certificatePdfRunDiagnostic.runId, b);

const fakePdf = () => ({ numPages: 1, getPage: async () => ({}), destroy: async () => {} });
const loadPdfJs = 'async function loadPdfJs() { return { getDocument: ({data}) => ({promise: globalThis.__testDocument(new TextDecoder().decode(data))}) }; }';
const choosePage = 'async function choosePage() { return {pageNumber:1,tokens:[{text:"token"}]}; }';
const renderPage = 'async function renderPage() { return {}; }';
const hasQr = 'async function hasQr() { return false; }';

// CASE 5: actual V3 handler, A document resolves after B authoritative commit.
setup();
globalThis.__testDocument = (id) => pause(id);
loadComponent("certificate-pdf-structured-reader-v3.jsx", {
  loadPdfJs, choosePage, renderPage, hasQr,
  parseStructured: 'function parseStructured() { return {strong:true,found:18,patch:{registrationNumber:globalThis.__testSelectedId}}; }',
});
select("v3-A");
await flush();
select("v3-B");
await flush();
globalThis.__testSelectedId = "v3-B";
deferred.get("v3-B").resolve(fakePdf());
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "v3-B");
const v3Events = events.length;
globalThis.__testSelectedId = "v3-A";
deferred.get("v3-A").resolve(fakePdf());
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "v3-B");
assert.equal(events.length, v3Events);
assert.equal(window.__certificatePdfStaleRunDiagnostic.producer, "StructuredReaderV3");

// CASE 6: actual V2 bubble handler rejects A after B has committed.
setup();
globalThis.__testDocument = (id) => pause(id);
loadComponent("certificate-pdf-native-reader-v2.jsx", {
  loadPdfJs, choosePage, renderPage, hasQr,
  parseNativeV2: 'function parseNativeV2() { return {confident:true,totalCount:18,patch:{registrationNumber:globalThis.__testSelectedId}}; }',
});
select("v2-A");
await flush();
select("v2-B");
await flush();
globalThis.__testSelectedId = "v2-B";
deferred.get("v2-B").resolve(fakePdf());
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "v2-B");
const v2Events = events.length;
deferred.get("v2-A").resolve(fakePdf());
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "v2-B");
assert.equal(events.length, v2Events);
assert.equal(window.__certificatePdfStaleRunDiagnostic.producer, "NativeReaderV2");

// CASE 7: actual inspection adapter handler.
setup();
globalThis.__testExtract = (file) => pause(file.id);
loadComponent("certificate-pdf-inspection-record-adapter.jsx", {
  extract: 'async function extract(file) { return globalThis.__testExtract(file); }',
});
select("adapter-A"); select("adapter-B");
deferred.get("adapter-B").resolve({ isTarget: true, strong: true, patch: { registrationNumber: "adapter-B" } });
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "adapter-B");
const adapterEvents = events.length;
deferred.get("adapter-A").resolve({ isTarget: true, strong: true, patch: { registrationNumber: "adapter-A" } });
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "adapter-B");
assert.equal(events.length, adapterEvents);

// CASES 8–9: real recovery AUTH consumers await A, then B completes.
for (const [name, producer] of [["certificate-pdf-weight-displacement-recovery.jsx", "WeightDisplacementRecovery"], ["certificate-pdf-semantic-recovery.jsx", "SemanticRecovery"]]) {
  setup();
  globalThis.__testExtract = (file) => pause(file.id);
  loadComponent(name, { extract: 'async function extract(file) { return globalThis.__testExtract(file); }' });
  select(`${producer}-A`);
  emitAuth({ registrationNumber: "A" });
  select(`${producer}-B`);
  deferred.get(`${producer}-B`).resolve({ vehicleWeightKg: "222" });
  await flush();
  emitAuth({ registrationNumber: "B" });
  await flush();
  assert.equal(window.__vehicleCertificatePdfPriority?.vehicleWeightKg, "222");
  const count = events.length;
  deferred.get(`${producer}-A`).resolve({ vehicleWeightKg: "111" });
  await flush();
  assert.equal(window.__vehicleCertificatePdfPriority?.vehicleWeightKg, "222");
  assert.equal(events.length, count);
  assert.equal(window.__certificatePdfStaleRunDiagnostic.producer, producer);
}

// CASE 10: actual RowCorrector readRowPatch completes late.
setup();
globalThis.__testRowPatch = (file) => pause(file.id);
loadComponent("certificate-pdf-row-corrector.jsx", {
  readRowPatch: 'async function readRowPatch(file) { return globalThis.__testRowPatch(file); }',
});
select("row-A"); select("row-B");
window.__vehicleCertificatePdfPriority = { registrationNumber: "row-B" };
deferred.get("row-B").resolve({ patch: { vehicleWeightKg: "222" } });
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.vehicleWeightKg, "222");
const rowEvents = events.length;
deferred.get("row-A").resolve({ patch: { vehicleWeightKg: "111" } });
await flush();
assert.equal(window.__vehicleCertificatePdfPriority?.vehicleWeightKg, "222");
assert.equal(events.length, rowEvents);
assert.equal(window.__certificatePdfStaleRunDiagnostic.producer, "RowCorrector");

// The existing adapter and V3→V2 handoffs retain the same run ID.
setup();
globalThis.__testExtract = async () => ({ isTarget: false });
globalThis.__testDocument = async () => fakePdf();
globalThis.__testSelectedId = "adapter-pass";
loadComponent("certificate-pdf-inspection-record-adapter.jsx", { extract: 'async function extract(file) { return globalThis.__testExtract(file); }' });
loadComponent("certificate-pdf-structured-reader-v3.jsx", {
  loadPdfJs, choosePage, renderPage, hasQr,
  parseStructured: 'function parseStructured() { return {strong:true,found:18,patch:{registrationNumber:globalThis.__testSelectedId}}; }',
});
const adapterPassRun = select("adapter-pass");
await flush();
assert.equal(window.__certificatePdfRunDiagnostic.runId, adapterPassRun);
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "adapter-pass");

setup();
globalThis.__testDocument = async () => fakePdf();
globalThis.__testSelectedId = "v2-pass";
loadComponent("certificate-pdf-structured-reader-v3.jsx", {
  loadPdfJs, choosePage, renderPage, hasQr,
  parseStructured: 'function parseStructured() { return {strong:false,found:2,patch:{}}; }',
});
loadComponent("certificate-pdf-native-reader-v2.jsx", {
  loadPdfJs, choosePage, renderPage, hasQr,
  parseNativeV2: 'function parseNativeV2() { return {confident:true,totalCount:18,patch:{registrationNumber:globalThis.__testSelectedId}}; }',
});
const v2PassRun = select("v2-pass");
await flush();
assert.equal(window.__certificatePdfRunDiagnostic.runId, v2PassRun);
assert.equal(window.__vehicleCertificatePdfPriority?.registrationNumber, "v2-pass");

// Weak V2 retains the legacy handoff, while a pending generic text-layer result
// can still supply current-document fields without adopting a stale run.
setup();
globalThis.__testDocument = async () => fakePdf();
globalThis.__testExtract = (file) => pause(file.id);
loadComponent("certificate-pdf-generalization-recovery.jsx", {
  extractGenericPatch: 'async function extractGenericPatch(file) { return globalThis.__testExtract(file); }',
});
loadComponent("certificate-pdf-native-reader-v2.jsx", {
  loadPdfJs, choosePage, renderPage, hasQr,
  parseNativeV2: 'function parseNativeV2() { return {confident:false,totalCount:1,patch:{}}; }',
});
const weakRun = select("weak");
await flush();
window.__vehicleCertificatePdfPriority = { fuel: "ガソリン", vehicleWeightKg: "2020" };
emitAuth(window.__vehicleCertificatePdfPriority);
deferred.get("weak").resolve({layout:"four-axis",pageNumber:1,patch:{heightCm:"181",frontFrontAxleWeightKg:"1110"}});
await flush();
assert.equal(window.__certificatePdfRunDiagnostic.runId, weakRun);
assert.equal(window.__vehicleCertificatePdfPriority?.heightCm, "181");
assert.equal(window.__vehicleCertificatePdfPriority?.frontFrontAxleWeightKg, "1110");
assert.equal(window.__vehicleCertificatePdfPriority?.vehicleWeightKg, "2020");
assert.equal(window.__vehicleCertificatePdfPriority?.fuel, "ガソリン");
assert.equal(events.length, 2);

// CASES 11–12: B remained current; all six A completions left its fields and AUTH unchanged.
assert.equal(window.__certificatePdfRunDiagnostic.staleRunRejected, false);
console.log("certificate-pdf-run-isolation-regression: 13 cases PASS, six actual writer completion paths PASS, weak fallback recovery PASS, mount topology PASS");

setup();
globalThis.__testExtract = async () => ({layout:"four-axis",semantic:true,patch:{vehicleWeightKg:"888",userAddress:"",__pdfGeneralizationEvidence:{validatedFields:["vehicleWeightKg","userAddress"],clearedFields:["userAddress"]}}});
loadComponent("certificate-pdf-generalization-recovery.jsx", {extractGenericPatch:'async function extractGenericPatch(file) { return globalThis.__testExtract(file); }'});
select("current");await flush();
let nested=false;const consumed=[];
window.addEventListener("vehicle-certificate-authoritative",()=>{if(nested)return;nested=true;emitAuth({vehicleWeightKg:"777",userAddress:"住所ラベル"});nested=false;});
window.addEventListener("vehicle-certificate-authoritative",e=>consumed.push({...e.detail}));
emitAuth({vehicleWeightKg:"999",userAddress:"住所ラベル"});
assert.equal(consumed.length,2);assert.ok(consumed.every(p=>p.vehicleWeightKg==="888"&&p.userAddress===""));
currentInput.files=[{type:"image/png",name:"photo.png"}];emitChange(currentInput);
emitAuth({vehicleWeightKg:"123"});assert.equal(consumed.at(-1).vehicleWeightKg,"123");
console.log("PASS capture reconciliation protects outer and nested form packets; PDF-to-photo transition clears recovery state");
setup();
globalThis.__testExtract = (file) => pause(file.id);
loadComponent('certificate-pdf-generalization-recovery.jsx',{extractGenericPatch:'async function extractGenericPatch(file) { return globalThis.__testExtract(file); }'});
select('pending-photo');emitAuth({vehicleWeightKg:'111'});
currentInput.files=[{type:'image/png',name:'photo.png'}];emitChange(currentInput);
const beforePhoto=events.length;
deferred.get('pending-photo').resolve({layout:'four-axis',semantic:true,patch:{vehicleWeightKg:'222'}});await flush();
assert.equal(events.length,beforePhoto);
const readyRun=select('ready-weak');deferred.get('ready-weak').resolve({layout:'four-axis',patch:{heightCm:'177'}});await flush();
window.dispatchEvent(new FakeCustomEvent('certificate-pdf-weak-structured-fallback',{detail:{runId:readyRun}}));
assert.equal(events.at(-1).heightCm,'177');
console.log('PASS pending PDF-to-photo completion rejected; already-ready weak fallback reaches form');
