# Open items and ownership classification

This is a classification ledger, not a new feature plan. Candidate source being unmerged is not the same as an implementation defect. Counts below are unique top-level items and are restated in `CURRENT_STATE.md`.

## CODEX_READY — 0

No unimplemented, safe app-source change was proven by the audited candidate regressions, browser checks, or current source. The previous night already implemented several recoveries; rebuilding them would be duplicate work. The Vercel `.gitignore` path fix already exists at `13c32f5`; it needs adoption disposition, not reimplementation. `SECURITY_GATE_HOLD`, DB dependencies, and device acceptance are not CODEX_READY work.

## CHATGPT_READY — 0

No independent analysis-only work was found that can resolve a gate without a human decision or new evidence. The missing standalone v1.3/v1.4 parent spec cannot be reconstructed safely from assumptions; management needs the formal source if it must be audited beyond the available ledger/test contracts.

## HUMAN_REQUIRED — 5 primary candidate/adoption dispositions plus the normal release gate

1. Decide disposition of Delivery Time UX PR #86. The PR is open and checks pass; it says do not merge without separate management approval and retains DB/device gates.
2. Decide disposition of Certificate PDF PR #87 separately from Delivery UX. It is open Draft and currently behind main, with a dependency audit failure in its certificate workflow.
3. Review app-core PR #92, then stacked continuation #93. They are both open Draft; #93 depends on #92's feature baseline and must not be merged as if standalone.
4. Decide whether `fix/vercel-security-regression-gitignore-20261002` (`13c32f5`) should get a dedicated PR or be carried into an allowed infra candidate. Vercel and Workers checks pass there, but no PR/merge evidence exists.
5. Any main adoption/merge or Production release remains a separate human gate. No such action was taken; it is not counted among the five candidate records above.

## DEVICE_REQUIRED — 3

1. Authenticated live-backend acceptance of actual customer/vehicle/schedule mutations. Fixture requests were intercepted; they prove no shared DB writes.
2. iPhone/iPad/Safari acceptance, native time picker/touch behavior, back/forward and real authentication. Chromium at 390px is not a device substitute.
3. Physical A4/A3 printer and paper acceptance for existing print forms. Browser layout regressions do not prove printer output.

## DB_HOLD — 3

1. Delivery preset/custom-time persistence contract (PR #86 candidate schema/RPC/UI relationship). Do not apply candidate migration without separate DB approval and deployment compatibility plan.
2. `legal_3m` database CHECK/related schema state. `docs/pending-fix-ledger.md` #001 records it pending; candidate migrations are not proof of apply.
3. Transactional/atomic multi-RPC schedule edit and active registration. Existing source locks, stop/re-read and duplicate guards reduce current-page risk but do not provide database transactionality or persistent idempotency.

No live DB query was made; actual shared Supabase state is UNKNOWN beyond the dated repository ledger. No SQL was executed or applied by the audited runs.

## DEPENDENCY_BLOCKED — 2 branch states

1. **Current app candidate #93:** seven High audit findings through `braces <=3.0.3` via Vinext/Vite. Current registry latest checked remains affected. npm auto-fix proposes semver-major Vinext `0.0.15`. Runtime exposure was not demonstrated and is not asserted absent. Gate remains on; no suppression or threshold change.
2. **PDF candidate #87:** its current head `5ca65e7` is 6 main commits behind. The certificate regression workflow at that head failed during `npm audit` on then-locked DOMPurify/fast-uri and critical Next `<16.3.6` advisories. PR #90's fix exists on main but is absent from that candidate snapshot; do not claim its separate gate is green merely because another Full Regression job passed.

The Vercel `.gitignore` ENOENT is a separate issue: it was a Preview source-artifact environment assumption, fixed in `13c32f5`, with Vercel status SUCCESS. Its code is available but not adopted; this is tracked under ADOPTION_REVIEW rather than a current app source blocker.

## ADOPTION_REVIEW — 5 records

- PR #86 Delivery Time UX candidate.
- PR #87 Certificate PDF candidate.
- PR #92 app-core source candidate.
- PR #93 stacked app-core continuation.
- Commit/branch `13c32f5` Vercel artifact security-regression fix (no PR found).

PR #92 and #93 are a stack, so the count is four PRs plus the independent artifact branch; it does not imply that all five should be integrated.

## SECONDARY OPEN SPECIALIST DRAFTS — disposition unknown

These are visible as open Draft PRs but are not counted as principal current ICB application candidates. Their individual adoption/closure intent was not supplied, so their management disposition is UNKNOWN:

- #70 `hotfix/pdf-native-p0-20260916` (`e09d778`).
- #71 `candidate/restore-vehicle-pdf-bulk-entry-20260916` (`eae1ae8`).
- #75 `candidate/certificate-pdf-inspection-record-adapter-20260917` (`0add4ef`).
- #76 `fix/pdf-v3-weight-semantic-cells-20260918` (`5ee8682`).
- #78 `candidate/certificate-pdf-v3-layout-generalization-sidecar-20260919` (`ff6d99a`).

The remote PR inventory had 27 open PRs total at capture; the rest include deployment infrastructure, Dependabot and unrelated historical work. The five specialist PRs above must not be silently treated as merged, closed, or current app-core work.

## PRODUCTION_HOLD

- No Production deployment, Production environment change, or main merge occurred in these Codex-era checkpoint runs.
- The date-stamped private/Preview records are not proof of the current Production revision. Current live Production mapping remains UNKNOWN in this handoff.
- Any Production promotion still requires its existing explicit approval and full candidate adoption contract.

## HISTORICAL_ONLY / superseded

- Delivery `8285d9f` is a predecessor; #86 head `5870d86` is newer and contains the final known acceptance grid.
- Desktop compact `d00c1dd` is historical; the latest ICB candidate audit says compact and responsive behavior is already in candidate source. Do not cherry-pick it onto #93.
- Certificate PDF `d3b9256` is an important checkpoint but is superseded by current branch head `5ca65e7`; neither should be rewritten as the latest branch head. Older v3 generalization/sidecar/inspection adapter branches (#75/#76/#78/#79 and related refs) are separate candidates or closed history.
- OCR `eval/`, `experiment/`, `diag/`, frozen baselines, test fixtures and gate probes are not production adoption. Their existence in remote refs does not mean this ICB app run changed their algorithms.
- Old v1.2 waiting restrictions are historical: the repository records a v1.3 override on 2026-09-08, and the latest accepted work contract permits waiting for any `customer_visit` reason.

## UNKNOWN / not measured

- Exact first Mac Terminal Codex session/model activation; only first local repo clone is timestamped.
- Current live Supabase schema/revision; no live read was performed in this ledger.
- Current actual Production deployment revision; no live production deployment lookup was performed.
- Whether every open historical Draft PR outside the five adoption records is still intended for active management; remote PR inventory lists 27 open PRs, many unrelated or specialist/historical.
- Formal standalone ICB-SPEC v1.3/v1.4 source location/provenance.
