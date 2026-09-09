# Stage A21.1 Photo QR Diagnostic Audit

Evaluation-only. This stage does not adopt A/B/C and does not alter the formal Photo Decode algorithm. It fixes observability and semantics before any further real-device evaluation.

It records CURRENT wall-clock runtime separately from attempt count, exposes undecoded candidate/finder/geometry ownership hypotheses for Candidate A, and derives Candidate B normalized-quad eligibility/gate coverage plus Candidate C eligible-geometry coverage from the same diagnostic matrix. Existing Stage A21 recovery results remain diagnostic-only.

Formal Photo Decode remains 28/47. Ground truth and expected QR counts are scoring-only after decode. Frozen, Production, Candidate-Lock and Physical Slot remain HOLD. No adopted HEAD.
