# ICB Management Control Plane

Canonical management branch: `management/icb-control-plane-20260910`

This file is the required source of truth for GO/HOLD, adoption, DB change, deployment decisions, specialist handoffs, and current-state assertions. Conversation memory is secondary.

## Mandatory preflight

1. Read latest parent spec and this control plane.
2. Verify target branch/current HEAD in GitHub.
3. Verify specialist reports against source systems when possible.
4. Classify implemented / implementable-unimplemented / HOLD / review-only.
5. Re-check original reason for any HOLD before changing it.
6. GO/HOLD never propagates across lanes automatically.
7. Technical PASS is separate from UX adoption PASS.
8. Confirmed implementable requirements outrank speculative UX.
9. If branch HEAD advanced, inspect delta before issuing instructions.
10. Before incident/deployment-history statements, read the Permanent Incident Register.
11. `未反映なし` is only allowed as a scope-bound statement after full audit.
12. Small changes must not each create a Preview.
13. A UX candidate that conflicts with confirmed parent spec is NOT technical PASS even if CI/build pass.
14. Deployment Safety PASS requires measured absence of unintended Vercel Deployment records, not merely absence of an intentional Preview action.

## Governance proportionality / exception policy

- Governance rules exist to protect safety, correctness, privacy, cost, and reproducibility; they are not goals by themselves.
- Rules are classified as either **hard invariants** or **default operating rules**.
- Hard invariants must not be bypassed without an explicit new parent-spec decision. Examples include: no shared-remote destructive reset, no unauthorized Production/main/shared-DB mutation, no public PII/secret publication, no GT injection into OCR runtime/control, and no unapproved paid operation.
- Default operating rules may be changed when following them would create disproportionate delay, duplicated work, or infrastructure burden without materially improving safety or decision quality.
- Before changing a default operating rule, management must explain to the user: (1) why the exception is useful, (2) what changes, (3) the risk, and (4) the alternative. User approval is required when the change is material.
- Do not accumulate HOLDs mechanically. Re-check whether the original risk still exists and whether a cheaper/simpler control provides equivalent protection.
- If a governance step becomes self-referential busywork (for example, rebuilding infrastructure solely to re-score obsolete non-adoption experiments), management must evaluate whether the evidence can be preserved as historical diagnostic and the gate safely redefined.

## ChatGPT Work / normal chat / model-selection policy

- Overall management chooses whether a task belongs in normal chat or ChatGPT Work. Work is not a mandatory ceremony and must not be the default when the same task can be completed safely in chat.
- Normal chat owns management work: GitHub branch/HEAD/diff verification, Actions/CI review, spec matching, GO/HOLD decisions, Deployment Safety checks, lightweight code/doc fixes, handoff drafting, and result audits.
- Work is reserved for materially heavier execution: large multi-file implementation, OCR architecture PoCs, long cross-codebase research, heavy multi-candidate measurement, or substantial R&D that benefits from an isolated work environment.
- Work quota limits must not stop ICB development. Continue all chat-capable work while quota is unavailable; only the truly Work-dependent portion waits or is split into a narrower task.
- Before using Work, management must ask: (1) can normal chat finish this safely, and (2) is Work materially more efficient for the remaining task. If the answer to the first is yes and the second is no, use chat.
- Do not use Work for small checks, one-file fixes, routine management decisions, or tasks that can be verified directly through connected GitHub/Vercel/DB tools.
- Do not bundle unrelated heavy stages into one giant Work instruction when they can be split. In particular, avoid combining implementation, model download/init, large inference runs, scoring, analysis, and full reporting unless the coupling is necessary.
- Work reports should be only as detailed as needed for safety and management decisions. Report verbosity is a default operating rule and may be reduced to preserve quota when the same audit facts remain available.
- Management also chooses model/thinking strength. Use standard/default effort for fast checks and routine audits, Medium-equivalent effort for significant design/comparison decisions, and High-equivalent effort for genuinely difficult root-cause analysis, architecture decisions, or high-risk changes.
- Maximum thinking/heaviest mode is not a quality requirement. Use the minimum level that preserves decision quality.
- If model or Work limits affect progress, explain what is actually limited, what can continue in chat, what truly must wait, and the available alternative. Do not tell the user to wait when useful work can continue.

## OCR Architecture / Generalization Gate

- Fixed regression sets are regression evidence, not proof of generalization.
- Architecture adoption requires a declared Regression Set and an unseen Validation Set. Field failures from pilot/production are tracked separately as a Field Set.
- GT is scoring-only and must never influence OCR runtime, candidate generation, row detection, preprocessing, thresholds, fallback, stop conditions, parser, document selection, engine selection, or expected-count logic.
- Historical OCR stages with known GT-integrity defects or non-comparable composite assumptions may be preserved as **historical diagnostic only** and marked `NOT EVALUABLE` rather than resurrected solely to satisfy a bookkeeping flag.
- A historical corrected re-score is mandatory only when its result can materially affect an adoption decision. If the stage is already excluded from adoption and re-running it requires disproportionate deployment/infrastructure work, management may retire the re-score requirement after documenting the rationale.
- Architecture Bakeoff must compare currently viable candidates under one frozen evaluation contract. Candidate versions/configurations are frozen before unseen Validation evaluation; results must not be used to tune the same Validation Set.
- CI/static PASS is never OCR accuracy PASS. Formal accuracy claims require real-image evidence under the declared evaluation contract.
- Parts OCR: current A23 progression remains stopped until architecture comparison; A22 crop/table component may remain as a bakeoff candidate component, not an adopted architecture.
- Vehicle OCR: QR-first is retained; Guided Live QR, Photo QR fallback, PDF-native/QR, targeted QR-less OCR, and Hybrid routing are compared as architecture components. Pure Vision may be used as shadow/adjudication evidence but is not automatically authoritative.

## Permanent Incident Register — MUST NOT BE OMITTED

### Incident 1 — Shared Supabase data-loss
- Prior assistant used `supabase db reset` against shared remote and caused shared data loss.
- Never run shared-remote `db reset`.
- Shared DB mutations require explicit management GO and compatibility review.

### Incident 2 — Netlify unnecessary Production Deploy / credits
- GitHub integration caused unnecessary Netlify Production Deploys.
- Confirmed impact: 21 Production Deploys / 315 credits consumed.
- Separate incident from Vercel.
- Netlify Production remains HOLD unless explicitly released.

### Incident 3 — Vercel deployment flood / Preview blocking
- `vercel-parts-ocr` previously exceeded 100 deployments in 24h, blocking safe Preview/OCR real-device work.
- 2026-09-11 incident severity HIGH.
- Root configuration history:
  - `dff03bf4f2dc3abfb7c53c1b3767d845ebcb9469` introduced legacy `[deploy]`-marker `ignoreCommand`.
  - `44928ded4e1d0f8ce35bd94507b3da46fdadc0c2` added `git.deploymentEnabled=false` while retaining that old gate.
- CANCELED records count as Deployment records for management safety auditing.
- Formal incident document: `docs/ICB_DEPLOYMENT_GOVERNANCE_INCIDENT_20260911.md`.

## Deployment Governance — current formal state

Status: **automatic-deployment incident CONTAINED; normal GitHub development RESUMED; Preview re-enable validation remains HOLD**.

### Corrected control model
- Ordinary GitHub push -> Vercel Deployment records: **0**.
- `git.deploymentEnabled=false` is the single repository-level Git auto-deploy lock.
- Legacy Vercel `ignoreCommand` / `[deploy]` marker gate is retired on active lanes.
- Deployment Safety regression rejects reintroduction of `ignoreCommand`.
- GitHub Integration remains connected; Disconnect is not required because zero automatic deployments was measured with the integration retained.
- Preview needed -> management GO -> exact branch/HEAD -> exactly one explicit deployment.
- Do not use small-change Preview deployments.

### 2026-09-11 live verification
- Connected Vercel team: Hobby plan.
- Project `vercel-parts-ocr` confirmed linked to GitHub repo `massaikimono-commits/vercel-parts-ocr`.
- Initial preceding-24h audit: 4 Deployment records; 4 CANCELED, 0 READY, 0 ERROR, all tied to earlier OCR experiment/eval pushes.
- Validation window beginning 2026-09-11 18:30 JST: active-lane GitHub pushes produced **0 new Vercel Deployment records**.
- Zero-deployment push validation covered:
  - `preview/schedule-ux-20260903`
  - `management/icb-control-plane-20260910`
  - `eval/certificate-qr-stage-a21-4-format-counterfactual`
  - `experiment/parts-ocr-stage-a22-cell-crop-correction`
  - `eval/parts-ocr-stage-a22-cell-crop-correction`
- App Deployment Safety run `34585226425`: SUCCESS after safety regression was updated to the new single-lock policy.

### Active-lane infrastructure HEADs after containment
- App branch infrastructure HEAD: `8a5796834ac0dd43ef56e94a2a75557a57ef5d2a`.
- Management branch deployment-policy commits include `9cc665dcef4d3bf33f1c9fa69196f77a8d6cc48e`, `e5fa617fb4b52a70ec034d59d11329238967fb8b`, addendum commit `a88707b3410c213ae24d1fefc4199ccebdd01c0a`, incident-status commit `b840dbbf5077a610c996b33b99f490a493acf57f`.
- Vehicle OCR eval infrastructure HEAD: `6481e6216502589f5620240a0b004430d16eb366`; formal OCR logic/adoption status is unchanged.
- Parts OCR source infrastructure HEAD: `3d83f2f0b11938bdb1184422beeec3dbb9083f2c`; formal OCR logic/adoption status is unchanged.
- Parts OCR eval infrastructure HEAD: `3dbde887de67b568d716451542a9ac62647311f2`; formal OCR logic/adoption status is unchanged.

### Mandatory management audit
At management start and before Preview GO, inspect where tooling permits:
- Vercel project state
- preceding-24h Deployment count
- READY / CANCELED / ERROR / other counts
- source branch / commit SHA
- Production target change
- current `vercel.json`
- relevant Git Integration / project settings
- whether ordinary pushes generated any Deployment record

If an unintended Deployment record appears, stop pushes in the affected lane and reopen this incident as OPEN/HIGH.

### Preview re-enable condition
Vercel Preview remains HOLD until the exact explicit deployment path and exact target HEAD are confirmed, the current 24h state is checked, and one required Preview is created once and verified without Production changes. This Preview-specific HOLD **does not block normal GitHub development**.

### Parent-spec next revision
Required text is staged at `docs/ICB_SPEC_NEXT_DEPLOYMENT_GOVERNANCE_ADDENDUM.md`. It must be integrated into the next formal ICB-SPEC revision.

## Production/shared-resource rules

- Netlify is intended operational Production.
- `main`, Netlify Production, Vercel Production, and shared Supabase are not changed without explicit applicable approval.
- Vercel Preview must not drive shared DB schema changes while Netlify Production is behind.
- Shared DB mutation requires explicit management GO.

## Current lane ledger — verified/updated 2026-09-12 JST

### App main
- Repo: `massaikimono-commits/vercel-parts-ocr`.
- Branch: `preview/schedule-ux-20260903`.
- Current branch/infrastructure HEAD: `8a5796834ac0dd43ef56e94a2a75557a57ef5d2a`.
- Last accepted app runtime baseline: `63e15de0ae9137b6c473b42a085600605abf855c`.
- Difference after that runtime baseline is deployment-governance infrastructure only (`vercel.json` + deployment-safety regression); no app runtime feature change from the containment batch.
- PR #62: Draft / Open / unmerged; base `main`.
- main SHA remains `20a715bf46156282b686a617d6744a040bc17fb3` unless independently reverified otherwise.
- Full ICB-SPEC v1.3 section-by-section app-core audit: COMPLETE under current safe conditions.
- Scope-bound result at runtime baseline: excluding shared DB mutation, OCR tuning, review-only items, final physical print alignment, and Production reflection, immediately implementable confirmed-spec + explicit-request gaps = 0.
- Parent-spec day-navigation repair remains accepted: `← 前日 / 今日 / 明日 →`.
- Normal app/UX GitHub development: RESUMED.
- Vercel Preview/iPhone formal UX adoption: HOLD until Preview re-enable validation.

### Retained technical-PASS UX Preview candidates
- schedule detail -> next schedule registration
- schedule detail -> customer/vehicle info
- one-tap phone action when phone exists
- schedule detail work-state direct update
- schedule detail -> one-day schedule
- schedule detail/history/photo selected-vehicle context preservation
- customer/vehicle -> next schedule registration
- schedule detail -> lease maintenance contract
- customer/vehicle same-tab search-state memory
- integrated history source filter
- history/photo -> same vehicle next schedule / inspection
- week navigation anchor sync
- month mobile visible-row count consistency
- lease maintenance -> same vehicle next schedule / inspection
- All remain technical PASS only; UX adoption awaits one meaningful Vercel Preview + iPhone acceptance.

### Performance guard — ICB-SPEC v1.3 Section 20
- New functions must not make ordinary operation heavy at several-thousand-vehicle scale.
- Top/one-day schedule must not preload all customers/vehicles.
- No resident OCR observer/listener/storage patch on ordinary screens.
- Keep bounded search/page sizes.
- Vehicle photos: selected vehicle only, `PHOTO_PAGE_SIZE=24`, original signed URL only on explicit open.
- Integrated history: selected vehicle only, `SOURCE_PAGE_SIZE=25`, bounded display paging.
- Final perceived-performance confirmation remains part of iPhone Preview review.

### Vehicle certificate QR/OCR
- Frozen body: `work/certificate-photo-ocr` HEAD `7b421eea35154baa5b19e61e56151a8d73363bbf`; HOLD.
- Formal A21.8 logic source remains `b7230adf4acf3288c5fc3811d32309247361dcf1`; current eval branch infrastructure HEAD `6481e6216502589f5620240a0b004430d16eb366` only adds deployment-governance infrastructure after the formal logic state.
- Formal Photo QR Decode remains 28/47; 31/47 candidate only; adopted HEAD none.
- Fixed8 authorization remains unconsumed.
- GitHub experiment/eval development may resume when lane-specific GO exists; Frozen body stays HOLD.
- Real-device A21.8 run still requires the Preview-specific HOLD to be released.

### Parts OCR
- Frozen body: `work/parts-ocr-regression` HEAD `6a31ec4b9028410e90a8dbd9c8b40d53de7742d2`; HOLD.
- Formal source logic HEAD remains `391ffcdb31050df2afa028ca00ec0d41c55a6f8a`; source branch infrastructure HEAD is `3d83f2f0b11938bdb1184422beeec3dbb9083f2c`.
- Formal eval baseline remains `fa8df79c3eff7cc9c100d48b357d09c930168cdf`; eval branch infrastructure HEAD is `3dbde887de67b568d716451542a9ac62647311f2`.
- Stage A22 static/CI PASS; real-photo Formal NOT YET EVALUATED.
- Architecture Bakeoff branch: `eval/parts-ocr-architecture-bakeoff-poc-v1`; current verified HEAD `869b1d44e6bedf084d51467fbe6b5b67597239b2`.
- Bakeoff candidates remain fixed: P0 `frozen-control-adapter.v1`, P1 `guided-known-template-a22.v1`, P2 `ppstructurev3-ppocrv5-server.v1`, P4-L `p4-local-deterministic.v1`.
- Bakeoff scoring is fixed at `order-preserving-weighted-v1`; scorer self-test, integrity, regression, layout semantics, A22 invariants, dependency install, and Full Next build all PASS in Actions run `34664122198`.
- GT runtime isolation remains PASS; corrected Manifest v2 / fixture remain scoring-only.
- P2 real-image inference is still BLOCKED only by model-weight acquisition/initialization in a local/private environment; candidate logic is not to be tuned from Regression.
- Next heavy step: official PaddleOCR/PaddlePaddle model acquisition locally/private, P2 init, then one fixed Regression run of 12 captures across P0/P1/P2/P4-L. No Validation/tuning/Formal adoption in that Work.
- One formal yellow12 iPhone run, auto-map IMG_0684, still requires Preview-specific HOLD release.
- Do not advance to A23 without evidence.

## Global HOLD matrix

- main: HOLD
- Netlify Production: HOLD
- Vercel Production: HOLD
- Vercel Preview: HOLD until exact one-time Preview path is validated
- shared Supabase: HOLD unless explicit DB GO
- `legal_3m`: HOLD
- Shared-DB/RLS role separation: HOLD pending review
- Parent-spec review-only items: HOLD
- Final physical print coordinates/printer offsets: HOLD
- Vehicle certificate OCR Frozen: HOLD
- Parts OCR Frozen: HOLD
- Parts OCR Stage B: HOLD
- PR merge/Production reflection: no implicit GO
- Normal GitHub app/UX development: RESUMED
- Normal GitHub OCR experiment/eval development: RESUMED subject to lane-specific GO

## Absolute prohibitions

- No `supabase db reset` against shared remote.
- No implicit shared DB mutation.
- No implicit main merge.
- No implicit Netlify Production deploy.
- No implicit Vercel Production deploy.
- No small-change Preview spam.
- No declaring Deployment Safety PASS merely because no intentional Preview was created.
- No reintroducing Vercel `ignoreCommand` / `[deploy]` marker gate on active lanes.
- No changing `vercel.json`, Git Integration, `deploymentEnabled`, Deploy Hooks, Git auto deployment, Production Branch, project settings, or CLI/API deployment method without management approval and measured verification.
- No GT use in OCR runtime/control/candidate/stop/fallback/expected-count logic; GT scoring-only.
- No declaring OCR accuracy improvement from CI/static PASS without formal real-photo evidence.
- No accepting a UX candidate that contradicts explicit confirmed parent spec.

## Handoff requirement

Every handoff must include target branch/current HEAD, accepted runtime/technical baseline, GO/HOLD, last instruction, implemented vs missing vs HOLD/review, blockers/reasons, exact next action, production/DB/OCR state, technical PASS vs UX acceptance, full audit status, complete incident history (Supabase/Netlify/Vercel), Deployment Governance status, HOLD matrix, and absolute prohibitions.

## Paste-ready/display rule

For ICB text intended to be copied to another project chat:
- Use normal fenced Markdown code block.
- Do not use Writing Blocks / Plain text cards.
- Avoid large rendered headings on iPhone.
- Preserve this rule in every fresh-chat handoff.
