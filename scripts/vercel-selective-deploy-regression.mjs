import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const rules = config?.git?.deploymentEnabled;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!Object.prototype.hasOwnProperty.call(config, "ignoreCommand"), "legacy ignoreCommand gate must remain removed");
assert(rules && typeof rules === "object" && !Array.isArray(rules), "git.deploymentEnabled must use branch-rule object form");

const allowedBranch = "preview/schedule-ux-20260903";
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
assert(rules[allowedBranch] === true, "the current app preview branch must be explicitly allowed");
for (const pattern of forbiddenPatterns) {
  assert(rules[pattern] === false, `${pattern} must be explicitly blocked`);
}

const trueRules = Object.entries(rules).filter(([, enabled]) => enabled === true).map(([pattern]) => pattern);
assert(trueRules.length === 1 && trueRules[0] === allowedBranch, "only the explicitly approved app preview branch may enable Git deployments");

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
  if (!matching.length) return true; // Vercel's documented default for unspecified branches.
  return matching.some(([, enabled]) => enabled === true);
}

assert(deploymentEnabled(allowedBranch) === true, "approved app preview branch must deploy");
assert(deploymentEnabled("main") === false, "main must not trigger Vercel Production deployment");
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
