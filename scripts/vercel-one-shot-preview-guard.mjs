import fs from "node:fs";

const path = ".github/workflows/vercel-one-shot-preview.yml";
if (!fs.existsSync(path)) throw new Error(`${path} is missing`);
const body = fs.readFileSync(path, "utf8");

const required = [
  "workflow_dispatch:", "branch:", "expected_sha:", "full_regression_run_id:",
  "VERCEL_ORG_ID: team_GHd3ONZSRilQtxTq1q6NS1jT",
  "VERCEL_PROJECT_ID: prj_GUedEKT5z3vrL7NMLGhx04jgPeMK",
  "test \"$INPUT_BRANCH\" != \"main\"", "git rev-parse HEAD", "Full regression",
  "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}", "vercel pull --yes --environment=preview",
  "vercel deploy --yes", "target\" != \"production\"", "githubCommitSha", "automatic retry is forbidden",
];
for (const token of required) if (!body.includes(token)) throw new Error(`one-shot preview workflow missing required guard: ${token}`);

const forbidden = [/\bon:\s*\n\s*push:/m, /\bon:\s*\n\s*pull_request:/m, /\bon:\s*\n\s*schedule:/m, /--prod\b/, /--target[= ]production\b/, /\bvercel\s+promote\b/, /cancel-in-progress:\s*true/];
for (const pattern of forbidden) if (pattern.test(body)) throw new Error(`one-shot preview workflow contains forbidden pattern: ${pattern}`);

console.log("Vercel one-shot Preview structural guard: PASS");
