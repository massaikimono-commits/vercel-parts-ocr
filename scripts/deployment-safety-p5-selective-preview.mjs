import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const exactBranch = "eval/parts-ocr-architecture-p5-token-grid-poc";
const expected = {
  "**": false,
  "main": false,
  "work/**": false,
  "eval/**": false,
  "experiment/**": false,
  "poc/**": false,
  "management/**": false,
  "docs/**": false,
  "dependabot/**": false,
  [exactBranch]: true,
};

function assert(condition, message) {
  if (!condition) throw new Error(`deployment safety failed: ${message}`);
}

const vercelPath = path.join(root, "vercel.json");
const config = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
const rules = config?.git?.deploymentEnabled;
assert(rules && typeof rules === "object" && !Array.isArray(rules), "git.deploymentEnabled must be an object");

for (const [key, value] of Object.entries(expected)) {
  assert(rules[key] === value, `${key} must be ${value}`);
}

const trueRules = Object.entries(rules).filter(([, value]) => value === true).map(([key]) => key);
assert(trueRules.length === 1 && trueRules[0] === exactBranch, "exactly one true rule is allowed and it must be the P5 branch");
assert(rules["**"] === false, "catch-all must remain false");
assert(rules.main === false, "main must remain false");
assert(rules["eval/**"] === false, "eval/** must remain false");
assert(!Object.prototype.hasOwnProperty.call(config, "ignoreCommand"), "legacy root ignoreCommand is forbidden");
assert(!Object.prototype.hasOwnProperty.call(config?.git ?? {}, "ignoreCommand"), "legacy git.ignoreCommand is forbidden");

const workflowDir = path.join(root, ".github", "workflows");
for (const name of fs.readdirSync(workflowDir)) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  const text = fs.readFileSync(path.join(workflowDir, name), "utf8");
  assert(!/(^|\s)(npx\s+)?vercel\s+(deploy|--prod)\b/im.test(text), `${name} contains a direct Vercel deploy command`);
  assert(!/(^|\s)(npx\s+)?netlify\s+deploy\b/im.test(text), `${name} contains a direct Netlify deploy command`);
}

const netlify = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
assert(netlify.length > 0, "netlify.toml must remain present");

console.log(JSON.stringify({
  deploymentSafety: "PASS",
  mode: "selective-preview-exact-branch",
  exactBranch,
  catchAll: rules["**"],
  main: rules.main,
  evalWildcard: rules["eval/**"],
  trueRules,
  legacyIgnoreCommand: false,
  directDeployCommands: false,
  netlifyConfigPresent: true,
}, null, 2));
