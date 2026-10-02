import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { beginCertificatePdfDocumentVehicle } from "../app/lib/certificate-pdf-document-state.mjs";
import { beginPdfRun, isCurrentPdfRun, markPdfRunContinuation } from "../app/certificate-pdf-run-identity.js";
import { clusterPhysicalRows, detectAxleLayout, parseFourAxleVehicleRows, parseTwoAxleVehicleRows } from "../app/lib/certificate-pdf-row-semantics.mjs";

const page = fs.readFileSync(new URL("../app/vehicle-workflow-fast/page.tsx", import.meta.url), "utf8");
const ownerUi = fs.readFileSync(new URL("../app/certificate-owner-fields-ui.jsx", import.meta.url), "utf8");
const generalization = fs.readFileSync(new URL("../app/certificate-pdf-generalization-recovery.jsx", import.meta.url), "utf8");
let cases = 0;
const check = (name, fn) => { fn(); cases += 1; console.log(`PASS ${name}`); };
const empty = { id: undefined, registration: "", chassis: "", model: "", weight: "", type: "その他", customerId: "", certificate: { heightCm: "", ownerName: "", frontFrontAxleWeightKg: "" } };
const previous = { ...empty, id: "old-record", registration: "OLD", chassis: "OLD-12345", weight: "194", customerId: "customer-context", certificate: { heightCm: "194", ownerName: "old-owner", frontFrontAxleWeightKg: "560" } };

check("A previous document fields clear, customer context retained", () => {
  const next = beginCertificatePdfDocumentVehicle(previous, empty);
  assert.equal(next.certificate.heightCm, ""); assert.equal(next.certificate.frontFrontAxleWeightKg, "");
  assert.equal(next.registration, ""); assert.equal(next.chassis, ""); assert.equal(next.id, undefined);
  assert.equal(next.customerId, "customer-context");
  assert.match(page, /addEventListener\(DOCUMENT_START_EVENT,start\)/);
  assert.match(ownerUi, /certificate-pdf-document-started/);
});

const listeners = new Map();
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
globalThis.window = {
  addEventListener(type, listener) { listeners.set(type, listener); },
  dispatchEvent(event) { listeners.get(event.type)?.(event); return true; },
};
let resets = 0;
window.addEventListener("certificate-pdf-document-started", () => { resets += 1; });
check("B old async completion rejected after B begins", () => {
  const a = beginPdfRun({}); const b = beginPdfRun({});
  assert.equal(isCurrentPdfRun(a, "test"), false);
  assert.equal(isCurrentPdfRun(b, "test"), true);
  assert.equal(resets, 2);
});
check("C same-document continuation does not reset", () => {
  markPdfRunContinuation({}, 2);
  assert.equal(resets, 2);
  const merged = { ...beginCertificatePdfDocumentVehicle(previous, empty).certificate, vehicleWeightKg: "2000" };
  Object.assign(merged, { heightCm: "150" });
  assert.equal(merged.vehicleWeightKg, "2000");
});

const source = fs.readFileSync(new URL("../app/certificate-owner-semantics.jsx", import.meta.url), "utf8");
const output = ts.transpileModule(`${source}\nexports.__normalizePatch = normalizePatch;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", output)((name) => name === "react" ? { useEffect() {} } : null, module, module.exports);
const normalizeOwner = module.exports.__normalizePatch;
check("D distinct owner and user retained", () => {
  const p = normalizeOwner({ ownerNameRaw: "Owner A", ownerAddressRaw: "Owner address", userNameRaw: "User B", userAddressRaw: "User address" });
  assert.equal(p.ownerName, "Owner A"); assert.equal(p.userName, "User B"); assert.equal(p.ownerAddress, "Owner address");
  const identity = fs.readFileSync(new URL("../app/certificate-pdf-semantic-recovery.jsx", import.meta.url), "utf8");
  assert.match(identity, /!identity\.ownerNameRaw&&issuance\.ownerAtIssuanceNameRaw/);
  assert.match(identity, /!identity\.ownerAddressRaw&&issuance\.ownerAtIssuanceAddressRaw/);
});
check("E explicit same-as-user name", () => {
  const p = normalizeOwner({ ownerNameRaw: "使用者に同じ", userNameRaw: "User B" });
  assert.equal(p.ownerName, "User B"); assert.equal(p.ownerNameStatus, "SAME_AS_USER");
});
check("F explicit same-as-user address", () => {
  const p = normalizeOwner({ ownerAddressRaw: "使用者住所に同じ", userAddressRaw: "User address" });
  assert.equal(p.ownerAddress, "User address"); assert.equal(p.ownerAddressStatus, "SAME_AS_USER");
  assert.equal(normalizeOwner({ ownerNameRaw: "使用者に同じ" }).ownerNameStatus, "UNRESOLVED_SAME_AS_USER");
});

const row = (y, values) => values.map(([text, x]) => ({ text, x, y, w: .06, h: .01 }));
const tokens = [
  ...row(.2, [["乗車定員", .02], ["最大積載量", .13], ["車両重量", .29], ["車両総重量", .42], ["長さ", .56], ["幅", .70], ["高さ", .84]]),
  ...row(.22, [["7", .04], ["-", .16], ["2020 kg", .30], ["2405 kg", .44], ["491 cm", .57], ["185 cm", .72], ["181 cm", .86]]),
  ...row(.3, [["前前軸重", .02], ["前後軸重", .18], ["後前軸重", .34], ["後後軸重", .50], ["総排気量又は定格出力", .66]]),
  ...row(.32, [["1110 kg", .03], ["-", .20], ["-", .35], ["910 kg", .52], ["3.49 L", .70]]),
  ...row(.4, [["燃料の種類", .02], ["型式指定番号", .42], ["類別区分番号", .72]]),
  ...row(.42, [["ガソリン", .03], ["16578", .44], ["0004", .74]]),
];
const rows = clusterPhysicalRows(tokens);
check("G explicit L remains L", () => assert.equal(parseFourAxleVehicleRows(rows).displacementOrRatedOutput, "3.49 L"));
check("H explicit kW remains kW", () => {
  const rated = clusterPhysicalRows(tokens.map((t) => ({ ...t, text: t.text === "3.49 L" ? "92 kW" : t.text })));
  assert.equal(parseFourAxleVehicleRows(rated).displacementOrRatedOutput, "92 kW");
});
check("I next-label boundary retained", () => {
  assert.match(source, /UNRESOLVED_SAME_AS_USER/);
  const identity = fs.readFileSync(new URL("../app/certificate-pdf-semantic-recovery.jsx", import.meta.url), "utf8");
  assert.match(identity, /"使用の本拠の位置","車名","型式"/);
  assert.match(identity, /replace\(\/\^\\\[\\s\*\(\?:\\d\\s\*\)\{6,12\}/);
});
check("J four-axis columns and codes", () => {
  assert.equal(detectAxleLayout(rows), "four-axis");
  const p = parseFourAxleVehicleRows(rows);
  assert.deepEqual([p.seatingCapacity,p.maxPayloadKg,p.vehicleWeightKg,p.grossVehicleWeightKg,p.lengthCm,p.widthCm,p.heightCm], ["7","-","2020","2405","491","185","181"]);
  assert.deepEqual([p.frontFrontAxleWeightKg,p.rearRearAxleWeightKg,p.fuel,p.modelDesignationNumber,p.classificationNumber], ["1110","910","ガソリン","16578","0004"]);
});
check("K four-axis missing fields never use previous document", () => {
  const missing = clusterPhysicalRows(tokens.filter((t) => t.text !== "181 cm"));
  assert.equal(parseFourAxleVehicleRows(missing).heightCm, undefined);
  assert.equal(beginCertificatePdfDocumentVehicle(previous, empty).certificate.heightCm, "");
  assert.match(generalization, /Object\.entries\(patch\)\.filter/);
});
check("L two-axis baseline remains unchanged", () => {
  const two = clusterPhysicalRows([
    ...row(.5, [["車両重量",.05],["車両総重量",.27],["長さ",.53],["幅",.70],["高さ",.85]]),
    ...row(.525, [["650 kg",.08],["870 kg",.30],["339 cm",.54],["147 cm",.70],["152 cm",.85]]),
  ]);
  assert.equal(parseTwoAxleVehicleRows(two).heightCm, "152");
});
check("same-row two-axis fields retain their own columns", () => {
  const sameRow = clusterPhysicalRows([
    ...row(.5, [["乗車定員",.02],["4",.10],["最大積載量",.17],["-",.29]]),
    ...row(.54, [["車両重量",.02],["650 kg",.16],["車両総重量",.31],["870 kg",.47],["長さ",.59],["339 cm",.65],["幅",.73],["147 cm",.78],["高さ",.86],["152 cm",.93]]),
    ...row(.58, [["前軸重",.02],["400 kg",.13],["後軸重",.31],["250 kg",.43],["総排気量又は定格出力",.61],["0.65",.84],["kW",.92],["L",.93]]),
  ]);
  const result = parseTwoAxleVehicleRows(sameRow);
  assert.deepEqual([result.maxPayloadKg,result.vehicleWeightKg,result.grossVehicleWeightKg,result.lengthCm,result.widthCm,result.heightCm,result.frontFrontAxleWeightKg,result.rearRearAxleWeightKg], ["-","650","870","339","147","152","400","250"]);
});
check("unit follows the nearest numeric baseline, not the first textual unit", () => {
  const mixed = clusterPhysicalRows([
    ...row(.58, [["前前軸重",.02],["後後軸重",.31],["総排気量又は定格出力",.61],["1.79",.84]]),
    { text: "kW", x: .92, y: .57, h: .01 },
    { text: "L", x: .93, y: .581, h: .01 },
  ]);
  assert.equal(parseFourAxleVehicleRows(mixed).displacementOrRatedOutput, "1.79 L");
});
check("M weak structured result retains independent generic recovery path", () => {
  assert.match(generalization, /window\.addEventListener\(AUTH_EVENT, onAuthoritative\)/);
  assert.match(generalization, /parseFourAxleVehicleRows/);
  assert.match(generalization, /certificate-pdf-weak-structured-fallback/);
  assert.match(fs.readFileSync(new URL("../app/certificate-pdf-native-reader-v2.jsx", import.meta.url), "utf8"), /!parsed\.confident[^\n]+certificate-pdf-weak-structured-fallback[^\n]+passToExisting\(input\)/);
});
console.log(`certificate-pdf-document-integrity-regression: ${cases} cases PASS`);
