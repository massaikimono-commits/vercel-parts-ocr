import fs from "node:fs";
import crypto from "node:crypto";

const pagePath = "app/eval/certificate-qr-decode-experiment/page.jsx";
const corePath = "app/eval/certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated.js";
const manifestPath = ".photo-qr-core-manifest.json";

const source = fs.readFileSync(pagePath, "utf8");
const marker = "async function runMatrix(file)";
const componentMarker = "export default function CertificateQrDecodeExperimentPage()";

function functionBlock(text, startToken) {
  const start = text.indexOf(startToken);
  if (start < 0) throw new Error(`missing token: ${startToken}`);
  const brace = text.indexOf("{", start);
  if (brace < 0) throw new Error(`missing opening brace: ${startToken}`);
  let depth = 0;
  let quote = null;
  let templateDepth = 0;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (quote === "`" && ch === "$" && next === "{") { templateDepth += 1; i += 1; depth += 1; continue; }
      if (quote === "`" && ch === "}" && templateDepth > 0) { templateDepth -= 1; depth -= 1; continue; }
      if (ch === quote && templateDepth === 0) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1, text: text.slice(start, i + 1) };
    }
  }
  throw new Error(`unterminated function: ${startToken}`);
}

const componentIndex = source.indexOf(componentMarker);
if (componentIndex < 0) throw new Error("diagnostic page component marker missing");
const constantsIndex = source.indexOf("const REQUIRED_NAMES");
if (constantsIndex < 0) throw new Error("diagnostic core start missing");
const run = functionBlock(source, marker);
const coreBody = source.slice(constantsIndex, componentIndex);
const exportedBody = coreBody.replace(marker, "export async function runPhotoQrDiagnostic(file)");
if (exportedBody === coreBody) throw new Error("runMatrix export rewrite failed");

const core = `\"use client\";\n\nimport { normalizeCertificateCanvas, expectedCertificateQrCount } from \"../../lib/certificate-photo-normalize\";\nimport { detectCertificateQrDensityCandidates2D, clusterCertificateQrCandidates2D } from \"../../lib/certificate-qr-density-2d.mjs\";\n\n// GENERATED at build from the frozen diagnostic implementation in page.jsx.\n// Do not hand-edit. Recognition/decode/control logic is byte-derived from runMatrix.\n${exportedBody}`;
fs.writeFileSync(corePath, core);

const densityImport = 'import { detectCertificateQrDensityCandidates2D, clusterCertificateQrCandidates2D } from "../../lib/certificate-qr-density-2d.mjs";';
if (!source.includes(densityImport)) throw new Error("density import marker missing");
const sharedImport = 'import { runPhotoQrDiagnostic } from "./photo-qr-diagnostic-core.generated";';
let rewritten = source.replace(densityImport, `${densityImport}\n${sharedImport}`);
const runAfterImport = functionBlock(rewritten, marker);
rewritten = rewritten.slice(0, runAfterImport.start)
  + "const runMatrix = runPhotoQrDiagnostic;"
  + rewritten.slice(runAfterImport.end);
fs.writeFileSync(pagePath, rewritten);

const normalize = (value) => value
  .replace("async function runMatrix(file)", "async function CORE(file)")
  .replace("export async function runPhotoQrDiagnostic(file)", "async function CORE(file)")
  .replace(/\r\n/g, "\n")
  .trim();
const generatedRun = functionBlock(core, "export async function runPhotoQrDiagnostic(file)").text;
const sourceHash = crypto.createHash("sha256").update(normalize(run.text)).digest("hex");
const generatedHash = crypto.createHash("sha256").update(normalize(generatedRun)).digest("hex");
if (sourceHash !== generatedHash) throw new Error("shared diagnostic core identity mismatch");

fs.writeFileSync(manifestPath, JSON.stringify({
  sourcePage: pagePath,
  generatedCore: corePath,
  sourceRunMatrixSha256: sourceHash,
  generatedRunnerSha256: generatedHash,
  identical: true,
  pageUsesSharedRunner: rewritten.includes(sharedImport) && rewritten.includes("const runMatrix = runPhotoQrDiagnostic;"),
  recognitionLogicChanged: false,
  formalAlgorithmChanged: false,
}, null, 2));
console.log(`Photo QR shared core prepared: ${sourceHash}`);
