import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const rules = config?.git?.deploymentEnabled;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!Object.prototype.hasOwnProperty.call(config, "ignoreCommand"), "legacy ignoreCommand gate must remain removed");
assert(rules && typeof rules === "object" && !Array.isArray(rules), "git.deploymentEnabled must use branch-rule object form");

const allowedBranches = [
  "preview/schedule-ux-20260903",
  "candidate/certificate-pdf-v3-single-authoritative-owner-20260920",
  "candidate/certificate-pdf-generic-structural-resolver-20260924",
];
const forbiddenPatterns = [
  "main",
  "work/**",
  "eval/**",
  "experiment/**",
  "poc/**",
  "management/**",
  "docs/**",
  "dependabot/**",
];

assert(rules["**"] === false, "unknown branches must be fail-closed by a catch-all false rule");
for (const allowedBranch of allowedBranches) {
  assert(rules[allowedBranch] === true, `${allowedBranch} must be explicitly allowed`);
}
for (const pattern of forbiddenPatterns) {
  assert(rules[pattern] === false, `${pattern} must be explicitly blocked`);
}
assert(!Object.prototype.hasOwnProperty.call(rules, "candidate/**"), "candidate/** must not be broadly allowlisted");
assert(!Object.prototype.hasOwnProperty.call(rules, "hotfix/**"), "hotfix/** must not be broadly allowlisted");

const trueRules = Object.entries(rules).filter(([, enabled]) => enabled === true).map(([pattern]) => pattern).sort();
const expectedTrueRules = [...allowedBranches].sort();
assert(
  trueRules.length === expectedTrueRules.length && trueRules.every((rule, index) => rule === expectedTrueRules[index]),
  "only explicitly approved preview branches may enable Git deployments"
);

function matches(pattern, branch) {
  if (pattern === "**") return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return branch === prefix || branch.startsWith(`${prefix}/`);
  }
  return branch === pattern;
}

function deploymentEnabled(branch) {
  const matching = Object.entries(rules).filter(([pattern]) => matches(pattern, branch));
  if (!matching.length) return true;
  return matching.some(([, enabled]) => enabled === true);
}

for (const allowedBranch of allowedBranches) {
  assert(deploymentEnabled(allowedBranch) === true, `${allowedBranch} must deploy`);
}
assert(deploymentEnabled("main") === false, "main must not trigger Vercel Production deployment");
assert(deploymentEnabled("candidate/other-preview") === false, "unapproved candidate/* must stay blocked by catch-all");
assert(deploymentEnabled("hotfix/unapproved") === false, "unapproved hotfix/* must stay blocked by catch-all");
assert(deploymentEnabled("work/parts-ocr-regression") === false, "work/* must stay blocked");
assert(deploymentEnabled("eval/certificate-qr-stage-a21") === false, "eval/* must stay blocked");
assert(deploymentEnabled("experiment/parts-ocr-stage-a23") === false, "experiment/* must stay blocked");
assert(deploymentEnabled("poc/guided-live-capture-20260908") === false, "poc/* must stay blocked");
assert(deploymentEnabled("management/icb-control-plane-20260910") === false, "management/* must stay blocked");
assert(deploymentEnabled("docs/spec-refresh") === false, "docs/* must stay blocked");
assert(deploymentEnabled("dependabot/npm_and_yarn/next-17") === false, "dependabot/* must stay blocked");
assert(deploymentEnabled("feature/unapproved-branch") === false, "unknown branch must fail closed");
assert(deploymentEnabled("hotfix-unapproved") === false, "unknown top-level branch must fail closed");

console.log("Vercel selective Git deployment regression: PASS");
