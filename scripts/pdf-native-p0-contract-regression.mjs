import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const v3 = read("app/certificate-pdf-structured-reader-v3.jsx");
const v2 = read("app/certificate-pdf-native-reader-v2.jsx");
const fastLayout = read("app/vehicle-workflow-fast/layout.tsx");
const v2Layout = read("app/vehicle-workflow-v2/layout.tsx");

const cdnWorker = /GlobalWorkerOptions\.workerSrc\s*=\s*[`'"][^`'"]*cdn\.jsdelivr\.net/i;
const localWorker = /new URL\(\s*["']pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs["']\s*,\s*import\.meta\.url\s*\)\.toString\(\)/;

assert(!cdnWorker.test(v3), "P0: structured PDF v3 must not depend on jsDelivr for its PDF worker");
assert(localWorker.test(v3), "P0: structured PDF v3 must use the bundled local pdfjs worker");
assert(localWorker.test(v2), "P0: PDF native v2 must keep the bundled local pdfjs worker");

assert(/function passToExisting\(input\)/.test(v3), "P0: v3 fallback handoff helper must exist");
assert(/catch\s*\([^)]*\)\s*\{[\s\S]*?passToExisting\(input\)/.test(v3), "P0: v3 errors must hand off to the next PDF reader");
assert(/!parsed\.confident[\s\S]*?passToExisting\(input\)/.test(v3), "P0: weak v3 parses must hand off to the next PDF reader");
assert(/function passToExisting\(input\)/.test(v2), "P0: v2 fallback handoff helper must exist");
assert(/catch\s*\([^)]*\)\s*\{[\s\S]*?passToExisting\(input\)/.test(v2), "P0: v2 errors must hand off to legacy processing");

assert(/CertificatePdfStructuredReaderV3/.test(v2Layout), "P0: canonical vehicle-workflow-v2 route must mount structured PDF v3");
assert(/CertificatePdfNativeReaderV2/.test(v2Layout), "P0: canonical vehicle-workflow-v2 route must mount native PDF v2 fallback");

const fastHasV3 = /CertificatePdfStructuredReaderV3/.test(fastLayout);
const fastHasV2 = /CertificatePdfNativeReaderV2/.test(fastLayout);
if (!fastHasV3 || !fastHasV2) {
  console.warn("P0 diagnostic: direct /vehicle-workflow-fast does not mount the complete native PDF chain; canonical /vehicle-workflow-v2 remains the required route.");
}

console.log("pdf-native-p0-contract-regression: PASS");
