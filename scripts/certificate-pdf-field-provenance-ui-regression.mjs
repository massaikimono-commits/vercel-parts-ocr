import assert from "node:assert/strict";
import fs from "node:fs";
import { beginCertificatePdfFieldProvenance, getCertificatePdfFieldProvenance, isCertificatePdfFieldProvenanceEnabled } from "../app/certificate-pdf-field-provenance.js";

const uiSource = fs.readFileSync(new URL("../app/certificate-pdf-field-provenance-ui.js", import.meta.url), "utf8");
const readerSource = fs.readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");
const { showCertificatePdfFieldProvenanceUi, removeCertificatePdfFieldProvenanceUi } = new Function(
  "getCertificatePdfFieldProvenance", "isCertificatePdfFieldProvenanceEnabled",
  `${uiSource.replace(/^import .*;\n/m, "").replaceAll("export function ", "function ")}; return { showCertificatePdfFieldProvenanceUi, removeCertificatePdfFieldProvenanceUi };`
)(getCertificatePdfFieldProvenance, isCertificatePdfFieldProvenanceEnabled);

class Element {
  constructor(tag) { this.tag = tag; this.dataset = {}; this.children = []; this.style = {}; this.value = ""; this.disabled = false; this.textContent = ""; this.listeners = {}; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { this.children.push(...children); for (const child of children) child.parent = this; }
  appendChild(child) { this.append(child); }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  querySelector(selector) {
    const matches = (element) => selector === element.tag ||
      (selector.startsWith("[data-") && Object.keys(element.dataset).some((key) =>
        `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}` === selector.slice(1, -1)));
    const visit = (node) => { for (const child of node.children) { if (matches(child)) return child; const nested = visit(child); if (nested) return nested; } return null; };
    return visit(this);
  }
}
const body = new Element("body");
globalThis.document = { body, createElement: (tag) => new Element(tag), querySelector: (selector) => body.querySelector(selector) };
globalThis.location = { hostname: "preview.vercel.app", search: "" };
let copied = "";
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value) => { copied = value; } } } });

showCertificatePdfFieldProvenanceUi(null);
assert.equal(body.children.length, 0, "observer OFF adds no UI");
location.search = "?certificatePdfProvenance=1";
showCertificatePdfFieldProvenanceUi(null);
const panel = document.querySelector("[data-pdf-structured-v3-field-provenance]");
assert.ok(panel && panel.tag === "section", "diagnostic UI is visible without an upload card or open details element");
assert.match(panel.style.cssText, /position:fixed/);
assert.match(panel.style.cssText, /safe-area-inset-bottom/);
const button = panel.querySelector("button"), output = panel.querySelector("textarea");
assert.equal(button.textContent, "Traceをコピー");
assert.equal(button.disabled, true);
assert.equal(output.readOnly, true);
assert.equal(panel.querySelector("[data-pdf-field-provenance-state]").textContent, "Trace状態: PDF選択待ち");

beginCertificatePdfFieldProvenance(11, 1);
const ready1 = { runId: 1, diagnosticId: 11, checkpoints: [{ checkpoint: "FIELD_PROVENANCE_READY" }] };
showCertificatePdfFieldProvenanceUi(ready1);
assert.equal(button.disabled, false);
assert.equal(JSON.parse(output.value).run, 1);
await button.listeners.click();
assert.equal(copied, output.value, "copy uses the JSON visible for the active run");
assert.equal(panel.querySelector("[data-pdf-field-provenance-copy-feedback]").textContent, "コピーしました");

beginCertificatePdfFieldProvenance(12, 2);
showCertificatePdfFieldProvenanceUi({ runId: 2, diagnosticId: 12, checkpoints: [] });
assert.equal(button.disabled, true, "new run cannot copy the prior run");
showCertificatePdfFieldProvenanceUi({ runId: 2, diagnosticId: 12, checkpoints: [{ checkpoint: "FIELD_PROVENANCE_READY" }] });
await button.listeners.click();
assert.equal(JSON.parse(copied).run, 2, "same button copies the current run");
assert.equal(panel.querySelector("[data-pdf-field-provenance-run]").textContent, "Run: 2 / Diagnostic: 12");

navigator.clipboard.writeText = async () => { throw Error("Safari clipboard denied"); };
await button.listeners.click();
assert.match(panel.querySelector("[data-pdf-field-provenance-copy-feedback]").textContent, /長押ししてコピー/);
assert.equal(output.selected, true, "failed automatic copy preserves selectable JSON");
assert.equal(JSON.parse(output.value).run, 2);
removeCertificatePdfFieldProvenanceUi();
assert.equal(body.children.length, 0);

assert.match(readerSource, /showCertificatePdfFieldProvenanceUi\(snapshot\);[\s\S]*?if \(!isCertificatePdfDiagnosticUiEnabled\(\)\) return;/);
assert.match(readerSource, /subscribeCertificatePdfDiagnostics\(showDiagnostic\);\s*showCertificatePdfFieldProvenanceUi\(getCertificatePdfDiagnosticSnapshot\(\)\);/);
assert.match(readerSource, /FIELD_PROVENANCE_READY/);
assert.doesNotMatch(uiSource, /dispatchEvent|AUTH_EVENT|PDF_PRIORITY|QR_PRIORITY|fetch\(|localStorage|supabase|setTimeout|Promise\.race/);
console.log("certificate PDF field provenance visible UI and copy regression: PASS");
