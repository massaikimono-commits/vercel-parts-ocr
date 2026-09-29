import fs from "node:fs";

const path = ".github/workflows/vercel-one-shot-preview.yml";
if (!fs.existsSync(path)) throw new Error(`${path} is missing`);
const body = fs.readFileSync(path, "utf8");

const required = [
  "workflow_dispatch:", "workflow_run:", "workflows:", "- Full regression", "types:", "- completed",
  "branch:", "expected_sha:", "full_regression_run_id:",
  "github.event.workflow_run.head_branch", "github.event.workflow_run.head_sha", "github.event.workflow_run.id",
  "github.event.workflow_run.conclusion == 'success'", "startsWith(github.event.workflow_run.head_branch, 'candidate/')",
  "VERCEL_ORG_ID: team_GHd3ONZSRilQtxTq1q6NS1jT",
  "VERCEL_PROJECT_ID: prj_GUedEKT5z3vrL7NMLGhx04jgPeMK",
  "VERCEL_PROJECT_NAME: vercel-parts-ocr",
  "EXPECTED_REPOSITORY: massaikimono-commits/vercel-parts-ocr",
  "EXPECTED_GITHUB_ORG: massaikimono-commits",
  "EXPECTED_GITHUB_REPO: vercel-parts-ocr",
  "test \"$INPUT_BRANCH\" != \"main\"",
  "case \"$INPUT_BRANCH\" in candidate/*)",
  "branch_sha=\"$(gh api",
  "test \"$branch_sha\" = \"$EXPECTED_SHA\"",
  "Full regression",
  "test \"$(jq -r '.head_branch' <<<\"$run_json\")\" = \"$INPUT_BRANCH\"",
  "test \"$(jq -r '.head_sha' <<<\"$run_json\")\" = \"$EXPECTED_SHA\"",
  "test \"$(jq -r '.conclusion' <<<\"$run_json\")\" = \"success\"",
  "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
  "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_ORG_ID",
  "https://api.vercel.com/v13/deployments?teamId=$VERCEL_ORG_ID",
  "gitSource:{type:\"github\",org:$org,repo:$repo,ref:$ref}",
  "--arg ref \"$EXPECTED_SHA\"",
  "test \"$(jq -r '.gitSource.ref' <<<\"$payload\")\" = \"$EXPECTED_SHA\"",
  "test \"$(jq -r 'has(\"target\")' <<<\"$payload\")\" = \"false\"",
  "githubCommitSha",
  "test \"$actual_sha\" = \"$EXPECTED_SHA\"",
  "test \"$target\" != \"production\"",
  "Existing non-failed Preview deployment for exact SHA",
  "Deployment ended in $state",
  "test \"$state\" = \"READY\"",
  "Preview HTTP check failed",
];
for (const token of required) if (!body.includes(token)) throw new Error(`one-shot preview workflow missing required guard: ${token}`);

const forbidden = [
  /\bon:\s*\n\s*push:/m,
  /\bon:\s*\n\s*pull_request:/m,
  /\bon:\s*\n\s*schedule:/m,
  /\bvercel\s+deploy\b/,
  /\bvercel\s+pull\b/,
  /npm\s+install\s+--global\s+vercel/,
  /\.vercel\/project\.json/,
  /--prod\b/,
  /--target[= ]production\b/,
  /\bvercel\s+promote\b/,
  /\bvercel\s+link\b/,
  /--scope\b/,
  /"target"\s*:\s*"production"/,
  /target:\s*"production"/,
  /cancel-in-progress:\s*true/,
];
for (const pattern of forbidden) if (pattern.test(body)) throw new Error(`one-shot preview workflow contains forbidden pattern: ${pattern}`);

console.log("Vercel chained Preview REST gitSource structural guard: PASS");
