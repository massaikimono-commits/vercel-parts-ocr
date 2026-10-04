# Branch, PR and worktree map

Ahead/behind is relative to the captured `origin/main` `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4`; notation is `main-only / branch-only` from `git rev-list --left-right --count origin/main...branch`. For branch refs not in current scope the status is marked historical or secondary rather than inferred as adoptable.

The supplied earlier checkpoint described Delivery #86 as 11 commits ahead. Current exact remote refs show 29 branch-only commits since its merge base `f00bd12` (`git rev-list --left-right --count` = `0 29`). The prior 11-count's definition/base was not present in current repo evidence, so it is retained as an earlier reported metric but is not substituted for the current reproducible count.

## Principal current workstreams

| Branch / PR | Head | Merge base | main-only / branch-only | State and purpose | Relationship / adoption |
|---|---|---|---:|---|---|
| `main` | `f00bd122e89dc7f375ff0bf4c024ae1c765f5ae4` | self | 0 / 0 | Current remote/local main; clean in original workspace. PR #90 security recovery is merged here. | Only adopted Source of Truth. |
| `candidate/delivery-time-ux-acceptance-revision-20260929` / #86 | `5870d86846a961ae2f9dccae993740b728df59d9` | `f00bd12` | 0 / 29 | Open, non-draft acceptance PR. Delivery presets/custom range, persisted labels, three-column compaction. | Separate from app #92/#93 and PDF #87. No merge. Candidate DB contract and iPhone acceptance remain. |
| `candidate/icb-app-overnight-20261003` / #92 | `8b38adba491020cc58a5f8b0af1e8349c145d396` | `f00bd12` | 0 / 1 | Open Draft PR. 46-file app-core UX batch. | Parent/base of #93; not merged. |
| `candidate/icb-continuation-20261003` / #93 | `74ac541a061890f73553a2e8887cb1f72a8eb9ad` | `f00bd12` | 0 / 6 | Open Draft PR. Continues #92 with schedule/customer/settings/loaner/workload recovery and substantial evidence. Current branch has one docs/evidence-only `74ac541` after app source commits. | Stacked on #92; neither PR is adopted. Latest non-production Workers preview is on this branch. |
| `candidate/certificate-pdf-current-main-integration-20260929` / #87 | `5ca65e71312b1b352d1b042e8bc95715acb9c8e1` | `776fc6288e8169466463729308dfe2cf41ab9113` | 6 / 12 | Open Draft PR; PDF async ownership, state reset, structural recovery, acceptance copy. | Not Delivery UX. Behind current main; its #90 dependency fixes need reconciliation before adoption. Specialist boundary. |
| `fix/vercel-security-regression-gitignore-20261002` | `13c32f5862a464a389926b5539ac5bf4aee96b09` | `f00bd12` | 0 / 30 | Remote branch with Vercel source-artifact security-test fallback; Vercel and Workers checks succeeded. | Descends from Delivery UX candidate; no PR/merge record. Do not mistake it for #86 or #93 head. |

The branch counts for #92/#93 come from verified remote refs. #93 has six commits beyond #92 (`e99d523`, `4578802`, `20cb095`, `4020b54`, `3cfbcd9`, `74ac541`). Its full diff against main includes screenshot/log evidence; it is not six application-source commits only.

## Important predecessor and specialist branches

| Branch / PR | Head | Merge base | main-only / branch-only | Classification |
|---|---|---|---:|---|
| `candidate/delivery-time-ux-20260928` | `8285d9f` | `75e6a13` | 58 / 14 | Superseded predecessor to #86; do not treat as current head. |
| `candidate/desktop-compact-2step-20260915` | `d00c1dd` | `03f763c` | 73 / 13 | Historical compact experiment; relevant compaction is already in current source/candidate evidence. No cherry-pick. |
| `candidate/legal-3m-parent-spec-resume-20260917` | `c78d3a1` | `75e6a13` | 58 / 4 | DB apply/preparation candidate; `DB_HOLD`, no live application proven. |
| `candidate/certificate-pdf-canonical-generalization-20260919` / closed #79 | current remote `aa919ea`; PR #79 recorded head `baecbef` | `0704dfd` | current remote 20 / 8; PR head 20 / 6 | Closed PR #79, no merge; branch later recorded a minimal-integration freeze commit. PR-closed SHA and current remote SHA differ; do not conflate them. |
| `candidate/certificate-pdf-v3-layout-generalization-20260919` | `78e51c6` | `09e1a46` | 23 / 6 | Separate predecessor branch used as base of sidecar PR #78; not PR #79's head name. |
| `candidate/certificate-pdf-v3-layout-generalization-sidecar-20260919` / #78 | `ff6d99a` | `09e1a46` | 23 / 11 | Open Draft PoC nested on prior generalization candidate; separate from #87. |
| `candidate/certificate-pdf-inspection-record-adapter-20260917` / #75 | `0add4ef` | `09e1a46` | 23 / 5 | Open Draft adapter candidate; separate review/adoption status. |
| `fix/pdf-v3-weight-semantic-cells-20260918` / #76 | `5ee8682` | `23b6c72` | 29 / 1 | Open Draft semantic-cell fix based on inspection-adapter candidate; specialist branch. |
| `candidate/restore-vehicle-pdf-bulk-entry-20260916` / #71 | `eae1ae8` | `03f763c` | 73 / 3 | Open Draft bulk-entry validation candidate; not the current application #93. |
| `hotfix/pdf-native-p0-20260916` / #70 | `e09d778` | `03f763c` | 73 / 18 | Open Draft historical P0 PDF worker candidate; later Native v3 primary was adopted by #77. |
| `candidate/certificate-pdf-native-v3-canonical-minimal-integration-20260920` | `18409f4` | `0704dfd` | 20 / 8 | Historical specialist integration candidate; not #87's current head. |

Additional remote branches include OCR `eval/`, `experiment/`, diagnostics, temporary sync and deploy refs. They are numerous, not a single current candidate, and are not included in current app adoption counts. Frozen/scoring-only policy governs those experiments. Their branch existence alone is not adoption evidence.

## Worktrees at snapshot

| Worktree | State at snapshot | Ownership / note |
|---|---|---|
| `/Users/massa_ikimono/Developer/vercel-parts-ocr` | clean `main` `f00bd12` | Original workspace; left untouched. |
| `/private/tmp/icb-overnight-20261005` | `candidate/icb-continuation-20261003` `74ac541` | Isolated current app candidate and current evidence location. |
| `/Users/massa_ikimono/Developer/vercel-parts-ocr-delivery-gate` | detached `5870d86` | Existing Delivery Time UX acceptance worktree; read-only audited. |
| `/Users/massa_ikimono/Developer/vercel-parts-ocr-preview-final` | detached `13c32f5` | Existing Vercel artifact/security-fix worktree; read-only audited. |
| `/Users/massa_ikimono/Developer/worktrees/vercel-parts-ocr-certificate-current` | tracking candidate `5ca65e7` | Existing Certificate PDF current candidate worktree; read-only audited. |

At capture all listed worktrees were clean. A larger set of remote refs exists; no bulk pruning or deletion was performed.
