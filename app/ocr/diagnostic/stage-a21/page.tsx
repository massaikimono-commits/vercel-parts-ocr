import Client from "./Client";

export default function StageA21Page() {
  const deployedHead =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_EVAL_HEAD ||
    process.env.GITHUB_SHA ||
    "local-or-unavailable";
  return <Client deployedHead={deployedHead} />;
}
