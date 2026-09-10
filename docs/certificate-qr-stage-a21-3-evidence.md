# Stage A21.3 Evidence Capture

Diagnostic-only evidence capture for one fixed-eight real-device run.

- Formal parser/decoder unchanged.
- Ground truth is scoring-only; expected QR count is not used at runtime.
- Candidate A records privacy-safe attribution for every structural-pass result.
- Candidate C records privacy-safe SHA-256 fingerprint prefix, payload shape/length, parser step, structural reject reason, CURRENT canonical match, physical-position relation, decoder, variant, malformed/partial class, and attribution category for every raw success.
- Raw payload and canonical payload are not included in the management summary or detail JSON.
- Management summary remains hard-limited to 6000 characters.
- Frozen, Production, Candidate-Lock and Physical Slot remain HOLD.
- Formal adopted HEAD remains none.
