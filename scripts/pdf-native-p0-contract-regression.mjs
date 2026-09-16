import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const v3 = read("app/certificate-pdf-structured-reader-v3.jsx");
const v2 = read("app/certificate-pdf-native-reader-v2.jsx");
const workerLocalizer = read("app/certificate-pdf-worker-localizer.jsx");
const fastLayout = read("app/vehicle-workflow-fast/layout.tsx");
const v2Layout = read("app/vehicle-workflow-v2/layout.tsx");
const v2Reader = read("app/certificate-pdf-native-reader-v2.jsx");

const localWorker = /new URL\(\s*["']pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs["']\s*,\s*import\.meta\.url\s*\)\.toString\(\)/;
const externalWorker = /cdn\.jsdelivr\.net/i;

assert(localWorker.test(workerLocalizer), "P0: canonical PDF route must initialize the bundled local pdfjs worker before PDF readers run");
assert(localWorker.test(v3), "P0: structured PDF v3 must set the bundled local pdfjs worker at load time");
assert(!externalWorker.test(v3), "P0: structured PDF v3 must not depend on an external CDN worker");
assert(!/location\\.pathname\\.startsWith\\(\\s*["']\\/vehicle-workflow/.test(v3), "P0: mounted structured PDF v3 must not be disabled by stale SPA pathname state");
assert(/document\.addEventListener\(\s*["']change["']\s*,\s*onChange\s*\)/.test(v2Reader), "P0: v2 PDF reader must remain bubble-phase so structured v3 owns the first PDF change");
assert(localWorker.test(v2), "P0: PDF native v2 must keep the bundled local pdfjs worker");
assert(/CertificatePdfWorkerLocalizer/.test(v2Layout), "P0: canonical vehicle-workflow-v2 route must mount the local PDF worker initializer");
assert(v2Layout.indexOf("<CertificatePdfWorkerLocalizer />") < v2Layout.indexOf("<CertificatePdfStructuredReaderV3 />"), "P0: local PDF worker initializer must be mounted before structured PDF v3");

assert(/function passToExisting\(input\)/.test(v3), "P0: v3 fallback handoff helper must exist");
assert(/catch\s*\([^)]*\)\s*\{[\s\S]*?passToExisting\(input\)/.test(v3), "P0: v3 errors must hand off to the next PDF reader");
assert(/!parsed\.confident[\s\S]*?passToExisting\(input\)/.test(v3), "P0: weak v3 parses must hand off to the next PDF reader");
assert(/function passToExisting\(input\)/.test(v2), "P0: v2 fallback handoff helper must exist");
assert(/catch\s*\([^)]*\)\s*\{[\s\S]*?passToExisting\(input\)/.test(v2), "P0: v2 errors must hand off to legacy processing");

assert(/CertificatePdfStructuredReaderV3/.test(v2Layout), "P0: canonical vehicle-workflow-v2 route must mount structured PDF v3");
assert(/CertificatePdfNativeReaderV2/.test(v2Layout), "P0: canonical vehicle-workflow-v2 route must mount native PDF v2 fallback");

assert(/CertificatePdfWorkerLocalizer/.test(fastLayout), "P0: fast vehicle workflow must mount the local PDF worker initializer");
assert(/CertificatePdfStructuredReaderV3/.test(fastLayout), "P0: fast vehicle workflow must mount structured PDF v3");
assert(/CertificatePdfNativeReaderV2/.test(fastLayout), "P0: fast vehicle workflow must mount native PDF v2 fallback");

console.log("pdf-native-p0-contract-regression: PASS");
