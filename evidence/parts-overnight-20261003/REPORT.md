# ICB 部品伝票OCR — Morning Report

FINAL_VERDICT: NO_ADOPTION / ARCHITECTURE_CHANGE_REQUIRED

実写真への有効な精度改善なし。全7候補の完全正解行は0。runtime凍結後に既存の同一scorerで採点し、採点後のruntime変更は行わない。合成成功は未知実写真へのgeneralizationを証明しない。

START_BRANCH: candidate/parts-ocr-generalization-overnight-20261003
START_HEAD: a6e84cda32677c1d5a1f120b1ab48c21531e42eb
END_BRANCH: 同上（END_HEAD・COMMITS・PUSH_RESULTは final-state.json）
RUNTIME_FREEZE_COMMIT: 4ab51badb77842ee36637dca9c25639fc0bc93d7

## Dataset / baseline

DATASET_INVENTORY: 前回inventory100画像の原本hash100/100一致。今回実行は黄色HEIC12・白HEIC3。filenameだけでは正式GT対応を認定しない。
YELLOW_FORMAL_SET: HOLD（正式54行と診断GT60行が不一致。0677・0686を含む対応未確定）
WHITE_FORMAL_SET: HOLD（正式JPEG3枚/9行と今回HEIC3枚/15行の対応未確定）
WHITE_REFERENCE_SET: IMG_0622(4)/0623(4)は未発見、NOT_RUN
ADDITIONAL_REAL_PHOTOS: 0 confirmed; unknown-real GENERALIZATION_RESULTS: NOT_VERIFIED
UNMAPPED_REAL_PHOTOS: 15 formal identities unresolved; diagnostic scoring only
BASELINE: 保存済みFrozen dedicated/generalの実run・同一scorerを使用。a6e84cd evidence/real-photo-recovery-20261003参照。再実行はREGRESSION_ONLY、baseline実装変更なし。

## Architecture comparison / fixed regression

T=Tesseract、V=Mac Vision、G=header/token spatial graph、R=measured ruled-cell segmentation。PAGE、CARDINAL、RECTIFIEDを独立比較。

| Set | Candidate | NAME | QUANTITY | LIST_PRICE | PURCHASE_PRICE | Correct rows | False rows | Missed rows | Blank | Incremental ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| YELLOW_DIAGNOSTIC_60 | FROZEN_ACTUAL_DEDICATED | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 2 | 60 | 0/0 | 63994 |
| WHITE_SESSION_15 | FROZEN_ACTUAL_DEDICATED | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 15 | 0/15 | 10602 |
| YELLOW_DIAGNOSTIC_60 | FROZEN_ACTUAL_GENERAL | 0/60 | 3/60 | 2/60 | 1/60 | 0 | 62 | 57 | 0/0 | 66976 |
| WHITE_SESSION_15 | FROZEN_ACTUAL_GENERAL | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 27 | 15 | 0/15 | 11069 |
| YELLOW_DIAGNOSTIC_60 | T_PAGE_G | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 60 | 0/0 | 33617 |
| YELLOW_DIAGNOSTIC_60 | T_CARDINAL_G | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 60 | 0/0 | 50184 |
| YELLOW_DIAGNOSTIC_60 | V_PAGE_G | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 60 | 0/0 | 12650 |
| YELLOW_DIAGNOSTIC_60 | V_CARDINAL_G | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 60 | 0/0 | 48929 |
| YELLOW_DIAGNOSTIC_60 | V_RECTIFIED_G | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 60 | 0/0 | 3835 |
| YELLOW_DIAGNOSTIC_60 | R_V_PAGE | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 60 | 0/0 | 683 |
| YELLOW_DIAGNOSTIC_60 | R_V_CARDINAL | 0/60 | 0/60 | 0/60 | 0/60 | 0 | 0 | 60 | 0/0 | 70 |
| WHITE_SESSION_15 | T_PAGE_G | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 15 | 0/15 | 8414 |
| WHITE_SESSION_15 | T_CARDINAL_G | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 15 | 0/15 | 27170 |
| WHITE_SESSION_15 | V_PAGE_G | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 2 | 15 | 0/15 | 2752 |
| WHITE_SESSION_15 | V_CARDINAL_G | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 15 | 0/15 | 10891 |
| WHITE_SESSION_15 | V_RECTIFIED_G | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 15 | 0/15 | 247 |
| WHITE_SESSION_15 | R_V_PAGE | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 15 | 0/15 | 162 |
| WHITE_SESSION_15 | R_V_CARDINAL | 0/15 | 0/15 | 0/15 | 0/15 | 0 | 0 | 15 | 0/15 | 0 |
| SYNTHETIC_DEVELOPMENT | T_PAGE_G | 0/30 | 27/30 | 28/30 | 28/30 | 0 | 2 | 2 | 13/13 | 5425 |
| SYNTHETIC_DEVELOPMENT | T_CARDINAL_G | 0/30 | 17/30 | 17/30 | 17/30 | 0 | 2 | 13 | 7/13 | 19133 |
| SYNTHETIC_DEVELOPMENT | V_PAGE_G | 13/30 | 13/30 | 13/30 | 13/30 | 13 | 17 | 17 | 13/13 | 2178 |
| SYNTHETIC_DEVELOPMENT | V_CARDINAL_G | 13/30 | 13/30 | 13/30 | 13/30 | 13 | 6 | 17 | 13/13 | 10907 |
| SYNTHETIC_DEVELOPMENT | V_RECTIFIED_G | 0/30 | 0/30 | 0/30 | 0/30 | 0 | 5 | 30 | 0/13 | 602 |
| SYNTHETIC_DEVELOPMENT | R_V_PAGE | 7/30 | 6/30 | 7/30 | 7/30 | 6 | 0 | 23 | 7/13 | 1057 |
| SYNTHETIC_DEVELOPMENT | R_V_CARDINAL | 7/30 | 6/30 | 7/30 | 7/30 | 6 | 0 | 23 | 7/13 | 893 |

REGRESSIONS: Frozen generalの黄色 matched3・qty3/60・retail2/60・cost1/60が全候補0へ低下。誤抽出減少は棄却増加によるcoverage低下と併記。V_PAGE_Gは白のFrozen dedicated false0からfalse2へ悪化。CARDINALは合成PAGEより欠落増、RECTIFIEDとRはcoverage不足。
BEST_CANDIDATE: 採用候補なし。合成V_PAGE_Gの13/30 completeやRの6/30は実写真で再現しない。
FAILURE_TAXONOMY: failure-taxonomy.jsonに画像・row・field単位を保存。header証拠不足、orientation曖昧棄却、rectangle未検出、ruled topology不成立、field associationがdominant。分類はstage attributionであり画像の真の原因を断定しない。未証明のTEXT_RECOGNITION/IMAGE_QUALITY等を推測で付与しない。

## Performance / runtime boundary

LATENCY: real full-matrix total 202744ms; synthetic 40249ms. Acquisition共有・cacheあり。各候補のcold/mobile latency比較ではない。
MEMORY: real Node whole-matrix cumulative peak max 1191542784 bytes。native subprocess記録はprivate raw artifacts。GPU未測定、mobile feasibility未検証。
TIMEOUTS: real105 / synthetic56 variant outputsで0。実行error0。
photo input → preprocessing → local OCR → parser → normalized result/source-coordinate provenanceを検証。manualReviewRequired=true、autoConfirmedRows=0。UIへの採用統合は未実施。VisionはMac-host境界でWeb/mobile runtimeの代替にできない。

## Validation / governance

TEST_RESULTS: spatial graph98、geometry14、orientation8、source-coordinate contract PASS。合成development8枚/30行は正式Gateと分離。
BUILD_RESULT: PASS（歴史snapshot Next14、localhost public placeholder、実DB接続なし）。current-main統合acceptanceとは異なる。
CI_RESULT: NOT_RUN（current candidateへの既存CI triggerなし、新規deployment workflowなし）
PREVIEW_RESULT: NOT_CREATED / PREVIEW_URL: null（有効candidate不成立）
OVERFIT_CHECK: GT_LEAKAGE=0 in new runtime。GTは凍結後scoring-only。filename conditional、画像別座標、答えdictionary、GT threshold sweepなし。合成developmentへの適合リスクは残る。
FROZEN_UNCHANGED: true; MAIN_UNCHANGED: true; PRODUCTION_UNCHANGED: true; DB_CHANGED: false; CREDENTIAL_CHANGED: false; FORCE_PUSH_USED: false; EXISTING_WORKTREE_DAMAGED: false; RESET_TICKET_USED: false
分類: 既存baseline/inventory=NO_OP_VERIFIED、固定比較=REGRESSION_ONLY、GT対応=REMEDIATE/HOLD、独立graph/geometry/boundary/harness=IMPLEMENT。完成済み機能の再実装・本体UX変更なし。

REMAINING_BLOCKERS: 正式54/9対応証拠、取消行業務意味、追加未知実写真、ICB-SPEC v1.4の原文未発見（exact compliance未検証）、mobile/native memory、UI統合。
NEXT_RECOMMENDED_ARCHITECTURE: GT独立のorientation/layout evidenceを先に強化し、header認識単独依存を外した複数layout仮説と行対応の保留表現を検討。別のdevelopment photosで設計し、未知実写真で一回固定評価。threshold競争へ戻らない。

時間制約: start 2026-10-03 14:48:11 UTC、測定・報告完了2026-10-04 01:16 UTC以降。時計上5時間枠を超過した。原因・承認待ち時間の内訳は確定できないため断定しない。新規architecture loopは停止済み。

FILES_CHANGED / COMMITS / END_HEAD / PUSH_RESULT: final-state.json（自己参照を避けcommit後のlocal evidence）。詳細: scoring-summary.json、failure-taxonomy.json、runtime-freeze.json、final-safety-audit.json、decision.md。
