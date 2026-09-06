import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = read(".github", "workflows", "app-core-build.yml");
const ocr = read(".github", "workflows", "vehicle-certificate-regression.yml");
const full = read(".github", "workflows", "full-regression.yml");
const deploy = read(".github", "workflows", "deployment-safety.yml");

function assert(condition, message) {
  if (!condition) {
    console.error(`ci routing regression failed: ${message}`);
    process.exit(1);
  }
}

assert(app.includes("pull_request:") && app.includes("- main"), "normal app workflow must run for PRs to main");
assert(app.includes("Detect normal app change scope"), "normal app workflow must route by changed files");
assert(app.includes("github.event.action") && app.includes("synchronize") && app.includes("github.event.before") && app.includes("github.event.after"), "long-lived PR app routing must use only the latest synchronization diff when available");
assert(app.includes("needs.scope.outputs.app_changed == 'true'"), "heavy app regression must run only for normal app changes");
assert(app.includes("npm run test:security"), "normal app workflow must run security regression");
assert(app.includes("npm run test:schedule-workflow-ux"), "normal app workflow must run schedule workflow regression");
assert(app.includes("npm run test:customer-migration-workflow"), "normal app workflow must run customer migration regression");
assert(app.includes("npm run test:app-core-safety"), "normal app workflow must run app-core safety");
assert(app.includes("run: npx next build"), "normal app workflow must run a Next.js production build");
assert(!app.includes("run: npm run test:certificate"), "normal app workflow must not run vehicle certificate OCR regression");
assert(!app.includes("run: npm run test:parts"), "normal app workflow must not run parts OCR regression");
assert(!app.includes("run: npm run test:qr-speed"), "normal app workflow must not run QR OCR regression");

assert(ocr.includes("name: OCR regression"), "OCR compatibility workflow name must remain");
assert(!ocr.includes("pull_request:"), "OCR workflow must not start merely because a long-lived PR is synchronized");
assert(ocr.includes("branches-ignore:") && ocr.includes("- main"), "OCR path-scoped workflow must avoid duplicating the main full regression");
assert(ocr.includes("paths:") && ocr.includes('"app/certificate-*"') && ocr.includes('"app/ocr/**"'), "OCR workflow must be triggered only by OCR-related paths");
assert(ocr.includes("Detect OCR change scope"), "OCR workflow must route vehicle and parts checks inside an OCR-relevant push");
assert(ocr.includes("github.event.before") && ocr.includes("github.sha"), "OCR routing must use the incremental push diff");
assert(ocr.includes("vehicle-certificate-regression:"), "vehicle certificate OCR job must remain");
assert(ocr.includes("parts-ocr-regression:"), "parts OCR job must remain");
assert(ocr.includes("needs.regression.outputs.vehicle_ocr == 'true'"), "vehicle OCR job must be change-scoped");
assert(ocr.includes("needs.regression.outputs.parts_ocr == 'true'"), "parts OCR job must be change-scoped");
assert(!ocr.includes("npm run test:security"), "OCR workflow must not run app security regression");
assert(!ocr.includes("npm run test:schedule-workflow-ux"), "OCR workflow must not run schedule regression");
assert(!ocr.includes("npm run test:customer-migration-workflow"), "OCR workflow must not run customer regression");
assert(!ocr.includes("npm run build"), "OCR workflow must not run the full application regression");

assert(full.includes("name: Full regression"), "explicit full regression workflow must exist");
assert(full.includes("workflow_dispatch:"), "full regression must be manually dispatchable");
assert(full.includes("full-regression") && full.includes("ready_for_review"), "draft PRs must have an explicit full-regression route before preview/merge");
assert(full.includes("push:") && full.includes("- main"), "full regression must run after changes reach main");
assert(full.includes("run: npm run build"), "full regression must run the complete application regression/build");
assert(full.includes("qr-photo-contrast-regression.mjs"), "full regression must include extended vehicle OCR fixtures");
assert(full.includes("parts-photo-fixture-regression.mjs"), "full regression must include extended parts OCR fixtures");

assert(deploy.includes("name: Deployment safety guard"), "deployment safety workflow must remain");
assert(deploy.includes("pull_request:"), "deployment safety must continue running for pull requests");
assert(deploy.includes("branches:") && deploy.includes("- main"), "deployment safety must continue running on main");
assert(deploy.includes("scripts/deployment-safety-regression.mjs"), "deployment lock regression must remain");

console.log("ci routing regression passed");
