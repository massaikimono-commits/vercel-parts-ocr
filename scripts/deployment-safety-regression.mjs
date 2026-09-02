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
  const requiredNetlifyGate =
    "ignore = \"git log -1 --pretty=%B | grep -Fq \\\'[deploy netlify]\\\' && exit 1 || exit 0\"";

  if (!netlify.includes(requiredNetlifyGate)) {
    fail(
      "Netlify explicit-release gate is missing or changed. Normal commits must remain skipped unless [deploy netlify] is explicitly present."
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
console.log("- Netlify requires explicit [deploy netlify] release marker.");
console.log("- Vercel Git auto-deploy is disabled.");
console.log("- No direct Netlify/Vercel deploy command exists in GitHub Actions.");
