# ICB Vercel Preview Path Root-Cause Report — 2026-09-11

Status: OPEN — PREVIEW PATH NOT YET RESTORED
Severity: HIGH
Owner: ICB overall management
Repo: `massaikimono-commits/vercel-parts-ocr`
Vercel project: `vercel-parts-ocr` (`prj_GUedEKT5z3vrL7NMLGhx04jgPeMK`)
Team: `team_GHd3ONZSRilQtxTq1q6NS1jT`

## 1. Executive conclusion

The current Preview blockage is not an OCR implementation failure and not a Vercel platform outage. It was introduced by management's deployment-governance change.

Management correctly eliminated unintended Vercel Deployment records from ordinary Git pushes, but did not preserve or replace the previously working one-shot Preview path before declaring normal development governance remediated.

That left the system in a half-complete state:

- ordinary Git push -> 0 Vercel Deployment records: achieved
- management-approved exact-HEAD Preview -> safe one-shot deployment: not restored

The second condition was foreseeable because OCR real-device validation depends on Preview deployments. The failure to establish this path before disabling the historical Git deployment route is a management design failure.

## 2. What worked before

Vercel deployment history proves that the repository previously produced successful Git-sourced Preview deployments from OCR evaluation branches.

Examples:

### Vehicle-certificate OCR success

Deployment: `dpl_CQb1nGLqV6WhqWANmatHpmKSnbSu`

- state: `READY`
- target: `null` (Preview / non-Production)
- source: `git`
- branch: `eval/certificate-qr-stage-a21-4-format-counterfactual`
- SHA: `26813ae6828a8a4c64134ff6f53cd48443527f9f`
- commit message: `[deploy] Stage A21.5 same-origin compact acceptance preview`
- GitHub deployment metadata present

### Parts OCR success

Deployment: `dpl_GDkbFgsoLKdfsGXFLbKjwQtseEpu`

- state: `READY`
- target: `null` (Preview / non-Production)
- source: `git`
- branch: `eval/parts-ocr-stage-a21-root-cause-isolation`
- SHA: `fd6cb923c29ba1e7d345b6b2721c63e5dec5f254`
- commit message: `[deploy] Stage A21 management summary workflow preview`
- GitHub deployment metadata present

Another successful parts Preview existed at SHA `208981b7db0adcf170b9a6eefa4717c8aafeae3a` with `[deploy] Stage A21 automatic targeted-image resolver preview`.

These records establish that yesterday's practical Preview path was the Git integration path, with repository/branch/SHA metadata supplied by Vercel from GitHub.

## 3. Historical control used by that path

At successful vehicle Preview SHA `26813ae6828a8a4c64134ff6f53cd48443527f9f`, `vercel.json` still contained both:

- branch-based `git.deploymentEnabled` control
- legacy `ignoreCommand` checking the latest commit message for `[deploy]`

The historical `ignoreCommand` was:

`git log -1 --pretty=%B | grep -q '\[deploy\]' && exit 1 || exit 0`

This allowed `[deploy]` commits to continue through the build while ordinary commits were ignored/canceled after a Deployment record had already been created.

That distinction explains both historical facts:

1. `[deploy]` commits could produce READY Preview deployments.
2. ordinary OCR pushes still generated CANCELED Deployment records and contributed to the 100 deployments / 24h problem.

Therefore the old `[deploy]` gate itself cannot simply be restored globally.

## 4. Change that created the current blockage

To stop deployment-record flooding, active lanes were changed to the simplified lock:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": false
  }
}
```

The legacy `ignoreCommand` was removed.

Measured result:

- ordinary Git pushes -> 0 new Vercel Deployment records

This successfully contained the quota/flood incident.

However, this also removed the Git-based Preview trigger path that had supplied the complete Git repository checkout and exact Git metadata to Vercel.

Management did not establish a replacement explicit exact-HEAD deployment method before the next OCR Preview was required.

## 5. Failed attempts after the change

Two Stage A22 Preview deployments were attempted after the Git path had been disabled.

### Attempt 1

Deployment: `dpl_HKiHugtA8V5tyowpGzxz6dmu6AXs`

- state: `ERROR`
- target: `null`
- error: `missing_pages_app`
- cause: standalone evaluator content was sent into the existing Next.js project, so Vercel ran the project Next.js build against a source that did not contain the repository `app/` tree.

### Attempt 2

Deployment: `dpl_DQfxVewRXTDoc6be9A8MecpEWgJ4`

- state: `ERROR`
- target: `null`
- error: `module_not_found`
- missing module: `/vercel/path1/scripts/vehicle-certificate-regression.mjs`
- cause: partial `files`-style deployment source omitted repository files required by `package.json` build scripts.

Neither failure is evidence against A22 OCR runtime or crop logic.

The second attempt also violated the management requirement that the repository root be used as the deployment source. That attempt should not have been authorized without confirming the actual write schema first.

## 6. Why the current ChatGPT deployment tool is insufficient

The connected Vercel action currently exposed to ChatGPT is `deploy_to_vercel()` with no caller-supplied arguments.

It does not expose fields for:

- `gitSource`
- repository
- branch/ref
- commit SHA
- explicit Preview target

Vercel's official Deployment API supports Git-sourced deployments, but that API write schema is not exposed through the currently connected action.

Therefore management cannot safely use `deploy_to_vercel()` for these fixed-SHA OCR Preview deployments.

`deploy_to_vercel()` is now prohibited for OCR formal Preview work until its target/source semantics become explicitly controllable and verified.

## 7. Management failure classification

This is a management failure, not a specialist OCR failure.

Specific failures:

1. The deployment-flood fix was treated as sufficiently complete after proving ordinary push -> 0, without first proving the required inverse path: approved exact-HEAD Preview -> 1.
2. OCR's known dependency on iPhone/Vercel Preview validation was not included as an exit criterion for deployment-governance remediation.
3. Two deployment attempts were authorized before the exact source mechanism of `deploy_to_vercel()` had been verified.
4. Management repeatedly returned GO/STOP instructions to specialist chats instead of owning the shared deployment-path problem centrally.

## 8. Correct recovery criteria

Preview governance is not considered resolved until all of the following are demonstrated in one controlled validation:

1. Ordinary Git push creates 0 Vercel Deployment records.
2. Management can select an exact repository branch and exact commit SHA.
3. One explicit action creates exactly one new Vercel Deployment record.
4. Deployment source is the full Git repository checkout, not `files` upload.
5. Vercel metadata confirms expected repository, branch and commit SHA.
6. `target` is non-Production / Preview.
7. Deployment reaches `READY`.
8. Expected evaluation route opens successfully.
9. Vercel Production remains unchanged.
10. No extra CANCELED/ERROR/READY deployment records are created.

Until all ten pass, Preview-path status remains OPEN.

## 9. Recovery options, in order

### Option A — preferred

Use an authenticated Vercel Git-source deployment call that exposes `gitSource` and lets management specify repository/ref/SHA and non-Production target directly.

This preserves:

- ordinary pushes -> 0
- exact-head Preview -> one explicit deployment

No repository deployment config changes are required.

### Option B — controlled GitHub/Vercel release mechanism

If Option A cannot be exposed through the connected tool, create a dedicated management-controlled release mechanism using credentials stored as secrets, never pasted into chat, that calls Vercel's official Deployment API with fixed Git-source parameters.

Required controls:

- manual dispatch only
- exact SHA required input
- repository hard-coded to this repo
- Vercel project/team hard-coded
- Production target rejected
- preflight verifies branch contains the SHA
- post-deploy audit verifies metadata and record count
- no automatic trigger on push

This requires explicit secret provisioning and therefore cannot be silently introduced.

### Option C — temporary historical Git path

Not preferred. Reintroducing the old `[deploy]` / Git-auto path risks recreating Deployment records from ordinary pushes. It must not be restored globally merely to recover Preview functionality.

## 10. Current lane state

### Parts OCR Stage A22

- fixed eval HEAD: `8463a296fbc2bb1c60777414ad832d6e36846263`
- implementation/static/CI status: PASS retained
- formal real-photo: NOT YET EVALUATED
- `IMG_0684`: not run
- formal adopted HEAD: none
- additional Preview: HOLD pending safe deployment path

### Vehicle-certificate OCR A21.8

- fixed eval HEAD: `6481e6216502589f5620240a0b004430d16eb366`
- Preview authorization remains logically pending but must not be executed through uncontrolled tooling
- fixed8 one-shot: not run
- formal 28/47 baseline remains protected

## 11. Protected resources

Remain HOLD unless separately authorized:

- `main`
- Vercel Production
- Netlify Production
- shared Supabase
- Parts OCR Frozen branch
- Vehicle OCR Frozen branch
- Parts OCR Stage B

## 12. Mandatory process correction

No further GO is to be sent to an OCR specialist for Preview until management itself has verified the deployment mechanism end-to-end.

The next specialist instruction must contain a READY Preview URL or a single verified user action required to provision the missing authorization/secret. It must not contain another speculative deployment method.
