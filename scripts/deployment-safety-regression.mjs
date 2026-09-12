import fs from "node:fs";

const errors = [];
const fail = (message) => errors.push(message);

const vercelPath = "vercel.json";
const netlifyPath = "netlify.toml";

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
    if (vercel?.git?.deploymentEnabled !== false) {
      fail("Vercel Git auto-deploy must stay disabled (git.deploymentEnabled=false).");
    }
    if (Object.prototype.hasOwnProperty.call(vercel, "ignoreCommand")) {
      fail("Legacy Vercel ignoreCommand/[deploy] gate must stay retired.");
    }
  }
}

// This Live QR eval lane is not authorized to alter Netlify governance.
// Keep the pre-existing Netlify configuration byte-for-byte stable while
// independently enforcing the Vercel single-lock policy above.
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
console.log("- Vercel Git auto-deploy disabled by git.deploymentEnabled=false.");
console.log("- Legacy Vercel ignoreCommand/[deploy] gate absent.");
console.log("- Netlify configuration unchanged on this eval lane.");
console.log("- No direct Netlify/Vercel deploy command exists in GitHub Actions.");
