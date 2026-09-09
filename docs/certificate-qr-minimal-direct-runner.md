# Photo QR Minimal Diagnostic — direct runner

Evaluation-only implementation. The iPhone picker UX remains 8-image selection with 0942/0944 skipped from execution. The six-image Minimal batch now calls the generated shared `runPhotoQrDiagnostic(file)` directly; it does not use iframe DOM discovery, `input.files` injection, button clicks, or React-state recovery.

At build time `scripts/prepare-photo-qr-diagnostic-core.mjs` extracts the existing `runMatrix(file)` implementation and its pre-component dependencies from the existing Photo Decode diagnostic page into a generated shared module, then rewires the legacy diagnostic page to call that same generated runner. The script records and verifies a SHA-256 identity hash of the original and generated runner bodies. No recognition/decode/control thresholds are changed.

`scripts/photo-qr-minimal-contract-test.mjs` verifies the shared-runner identity contract, legacy-page shared-runner wiring, exact six-image input order, one result record per image even when one runner call errors, QR-count zero not being treated as batch failure, and summary rejection for five records or wrong image order.

Formal Photo Decode 28/47 remains an immutable reference. GT/expected counts are applied only in post-decode summary scoring and are not available to decode control.
