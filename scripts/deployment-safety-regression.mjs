import fs from "node:fs";

const errors = [];

function fail(message) {
  errors.push(message);
}

const netlifyPath = "netlify.toml";
const vercelPath = "vercel.json";

if (!fs.existsSync(netlifyPath)) {
  fail("netlify.toml is missing.");
} else {
  const netlify = fs.readFileSync(netlifyPath, "utf8");

  const requiredNetlifyLines = [
    'ignore = "exit 0"',
    '[context.production]',
    "ignore = \"git log -1 --pretty=%B | grep -Fq '[deploy netlify production]' && exit 1 || exit 0\"",
    '[context.deploy-preview]',
    "ignore = \"git log -1 --pretty=%B | grep -Fq '[deploy netlify preview]' && exit 1 || exit 0\"",
    '[context.branch-deploy]',
  ];

  for (const requiredLine of requiredNetlifyLines) {
    if (!netlify.includes(requiredLine)) {
      fail(`Netlify deployment lock is missing or changed: ${requiredLine}`);
    }
  }

  if (netlify.includes("[deploy netlify]'")) {
    fail(
      "Bare [deploy netlify] marker must not be used. Preview and production must have separate explicit markers."
    );
  }
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
    if (vercel?.git?.deploymentEnabled !== false) {
      fail(
        "Vercel Git auto-deploy must stay disabled (git.deploymentEnabled=false)."
      );
    }

    const normalizedIgnoreCommand =
      typeof vercel.ignoreCommand === "string"
        ? vercel.ignoreCommand.replace(/\\/g, "")
        : "";

    if (!normalizedIgnoreCommand.includes("[deploy]")) {
      fail(
        "Vercel ignored-build guard is missing. Manual release commits must remain explicit."
      );
    }
  }
}

const workflowDir = ".github/workflows";
if (fs.existsSync(workflowDir)) {
  const riskyPatterns = [
    /\bnetlify\s+deploy\b/i,
    /\bvercel\s+deploy\b/i,
    /\bvercel\s+--prod\b/i,
    /\bnpx\s+vercel\b/i,
  ];

  for (const file of fs.readdirSync(workflowDir)) {
    const fullPath = `${workflowDir}/${file}`;
    if (!fs.statSync(fullPath).isFile()) continue;

    const body = fs.readFileSync(fullPath, "utf8");
    for (const pattern of riskyPatterns) {
      if (pattern.test(body)) {
        fail(
          `Potential direct deployment command found in ${fullPath}: ${pattern}`
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Deployment safety check FAILED:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Deployment safety check passed.");
console.log("- Netlify production requires [deploy netlify production].");
console.log("- Netlify preview requires [deploy netlify preview].");
console.log("- Netlify branch deploys remain skipped.");
console.log("- Vercel Git auto-deploy is disabled.");
console.log("- No direct Netlify/Vercel deploy command exists in GitHub Actions.");
