import assert from "node:assert/strict";
import fs from "node:fs";
import { formatCertificateResult, EXTRA_CERTIFICATE_COPY_FIELDS, copyCertificateResultText } from "../app/lib/certificate-result-copy.mjs";
import { beginCertificatePdfDocumentVehicle } from "../app/lib/certificate-pdf-document-state.mjs";

const page = fs.readFileSync("app/vehicle-workflow-fast/page.tsx", "utf8");
const fields = Function(`return ${page.match(/const FIELDS = (\[[\s\S]*?\]) as const;/)[1]}`)();
const format = state => formatCertificateResult(state, fields);
const allFields = [...fields, ...EXTRA_CERTIFICATE_COPY_FIELDS];
const full = Object.fromEntries(allFields.map(([key], i) => [key, `value-${i}`]));
for (const [key, label] of allFields) assert.ok(format(full).includes(`${label}：${full[key]}`));
const missing = { registrationNumber: "current", heightCm: "" };
assert.ok(format(missing).includes("高さ cm：\n"));
format({ registrationNumber: "previous-only", heightCm: "old-height" });
assert.ok(!format(missing).includes("previous-only") && !format(missing).includes("old-height"));
const nextVehicle = beginCertificatePdfDocumentVehicle(
  { customerId: "synthetic-context", certificate: { heightCm: "old-height" } },
  { certificate: Object.fromEntries(fields.map(([key]) => [key, ""])) },
);
nextVehicle.certificate.registrationNumber = "current";
assert.ok(!format(nextVehicle.certificate).includes("old-height"));
for (const state of [
  { userName: "Synthetic User", ownerName: "使用者に同じ" },
  { userName: "Synthetic User", ownerName: "Synthetic Owner" },
]) {
  assert.ok(format(state).includes(state.userName));
  assert.ok(format(state).includes(state.ownerName));
}
for (const value of ["1.23 L", "25 kW"]) assert.ok(format({ displacementOrRatedOutput: value }).includes(value));
for (const key of ["frontFrontAxleWeightKg", "frontRearAxleWeightKg", "rearFrontAxleWeightKg", "rearRearAxleWeightKg", "frontAxleWeightKg", "rearAxleWeightKg"]) {
  const label = allFields.find(([field]) => field === key)[1];
  assert.ok(format({ [key]: "123" }).includes(`${label}：123`));
}
for (const value of [null, undefined, "", NaN, {}, "undefined", "null", "NaN", "[object Object]"]) {
  assert.ok(format({ heightCm: value }).includes("高さ cm：\n"));
}
const untouched = structuredClone(full);
format(full);
assert.deepEqual(full, untouched);
const helper = fs.readFileSync("app/lib/certificate-result-copy.mjs", "utf8");
assert.ok(!/parseStructured|resolveCertificate|AUTH_EVENT|PDF_PRIORITY|QR_PRIORITY|fetch\(|supabase|console\./.test(helper));
assert.ok(page.includes("formatCertificateResult(cert,FIELDS)"));
assert.ok(page.includes("onClick={copyReadResult}>読取結果をコピー"));
const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const oldDocument = globalThis.document;
let copied = "";
let removed = false;
const area = { style: {}, focus() {}, select() {}, setSelectionRange() {}, remove() { removed = true; } };
try {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async text => { copied = text; } } } });
  assert.equal(await copyCertificateResultText(format(missing)), true);
  assert.equal(copied, format(missing));
  globalThis.document = { createElement: () => area, body: { appendChild() {} }, execCommand: () => true };
  navigator.clipboard.writeText = async () => { throw new Error("permission denied"); };
  assert.equal(await copyCertificateResultText(format(missing)), true);
  assert.equal(area.value, format(missing));
  assert.equal(removed, true);
  document.execCommand = () => false;
  assert.equal(await copyCertificateResultText(format(missing)), false);
} finally {
  if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator;
  if (oldDocument) globalThis.document = oldDocument; else delete globalThis.document;
}
console.log("PASS copy contract CASE A-J + Clipboard API / Safari fallback / failure feedback source binding");
