import fs from "node:fs";

const errors = [];
const fail = (message) => errors.push(message);

const vercelPath = "vercel.json";
const netlifyPath = "netlify.toml";
const exactPreviewBranch = "eval/certificate-qr-live-unknown-safe-contract";

function branchDeploymentAllowed(rules, branch) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return false;
  if (rules[branch] === true) return true;
  if (rules[branch] === false) return false;
  const namespaceRules = [
    ["work/", "work/**"],
    ["eval/", "eval/**"],
    ["experiment/", "experiment/**"],
    ["poc/", "poc/**"],
    ["management/", "management/**"],
    ["docs/", "docs/**"],
    ["dependabot/", "dependabot/**"],
  ];
  for (const [prefix, rule] of namespaceRules) {
    if (branch.startsWith(prefix) && rules[rule] === false) return false;
  }
  return rules["**"] === true;
}

if (!fs.existsSync(vercelPath)) {
  fail("vercel.json is missing.");
} else {
  let vercel;
  try {
    vercel = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
  } catch (error) {
    fail(`vercel.json is not valid JSON: ${error.message}`);
  }
  if (vercel) {
    const rules = vercel?.git?.deploymentEnabled;
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
      fail("Vercel git.deploymentEnabled must be a selective allowlist object on this Live QR preview lane.");
    } else {
      const requiredFalseRules = [
        "**",
        "main",
        "work/**",
        "eval/**",
        "experiment/**",
        "poc/**",
        "management/**",
        "docs/**",
        "dependabot/**",
      ];
      for (const rule of requiredFalseRules) {
        if (rules[rule] !== false) fail(`Vercel deployment rule must remain false: ${rule}`);
      }
      if (rules[exactPreviewBranch] !== true) {
        fail(`Exact Live QR preview branch must be the only true Vercel rule: ${exactPreviewBranch}`);
      }
      const trueRules = Object.entries(rules)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .sort();
      if (trueRules.length !== 1 || trueRules[0] !== exactPreviewBranch) {
        fail(`Vercel true-rule allowlist must contain only ${exactPreviewBranch}; got ${JSON.stringify(trueRules)}`);
      }
      if (!branchDeploymentAllowed(rules, exactPreviewBranch)) {
        fail("Exact Live QR preview branch is not deployment-enabled by the selective policy.");
      }
      for (const deniedBranch of ["feature/unapproved", "eval/other-diagnostic", "hotfix/foo"]) {
        if (branchDeploymentAllowed(rules, deniedBranch)) {
          fail(`Unapproved branch must fail closed under catch-all false: ${deniedBranch}`);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(vercel, "ignoreCommand")) {
      fail("Legacy Vercel ignoreCommand/[deploy] gate must stay retired.");
    }
  }
}

// This Live QR eval lane is not authorized to alter Netlify governance.
// Keep the pre-existing Netlify configuration byte-for-byte stable.
const expectedNetlify = `[build]\n  command = "npm run build"\n  publish = ".next"\n  ignore = "git log -1 --pretty=%B | grep -Fq \\'[deploy netlify]\\' && exit 1 || exit 0"\n`;
if (!fs.existsSync(netlifyPath)) {
  fail("netlify.toml is missing.");
} else if (fs.readFileSync(netlifyPath, "utf8") !== expectedNetlify) {
  fail("Netlify configuration changed on the Live QR eval lane; this lane must leave Netlify unchanged.");
}

const workflowDir = ".github/workflows";
if (fs.existsSync(workflowDir)) {
  const riskyPatterns = [/\bnetlify\s+deploy\b/i, /\bvercel\s+deploy\b/i, /\bvercel\s+--prod\b/i, /\bnpx\s+vercel\b/i];
  for (const file of fs.readdirSync(workflowDir)) {
    const fullPath = `${workflowDir}/${file}`;
    if (!fs.statSync(fullPath).isFile()) continue;
    const body = fs.readFileSync(fullPath, "utf8");
    for (const pattern of riskyPatterns) {
      if (pattern.test(body)) fail(`Potential direct deployment command found in ${fullPath}: ${pattern}`);
    }
  }
}

if (errors.length) {
  console.error("Deployment safety check FAILED:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Deployment safety check passed.");
console.log(`- Vercel Preview allowlist true rule: ${exactPreviewBranch}.`);
console.log("- Catch-all, main, and all named branch namespaces remain false.");
console.log("- Representative unapproved branches fail closed.");
console.log("- Legacy Vercel ignoreCommand/[deploy] gate absent.");
console.log("- Netlify configuration unchanged on this eval lane.");
console.log("- No direct Netlify/Vercel deploy command exists in GitHub Actions.");
