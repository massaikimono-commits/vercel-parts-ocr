# Parts OCR Stage A16 Evaluation UI

Diagnostic-only UI route: `/ocr/diagnostic/stage-a16`.

It replays the fixed formal yellow 12-image pipeline under unchanged A14 runtime acceptance, then evaluates Stage A16 G1/G2/G3 counterfactual sweeps post-hoc.

Outputs include required gate metrics, protection checks, margin summary, and leave-one-image-out stability for the highlighted G3 phaseResidual>=15 and existingPCandidateDistance>=80 candidate only. This highlighted pair remains diagnostic and is not adopted as a runtime threshold.

GT is scoring-only and is never used for OCR, candidate proposal, runtime gate, pitch/phase, assignment, dedupe, or control.
