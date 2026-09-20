# Certificate PDF Canonical Integration — Protected Diff Failure

Date: 2026-09-20

An integration attempt on `candidate/certificate-pdf-canonical-integration-20260920` produced commit `ea9fef4362dec00754500d62a6a4d2a5e1041f01`.

The intended semantic change was only:

1. import `resolveCertificatePdfMissingFields`
2. call it after strict extraction and before existing `required/found/strong` evaluation

However, the file replacement path reserialized/condensed unrelated parts of `app/certificate-pdf-structured-reader-v3.jsx`. This violates the protected-diff requirement even if runtime semantics may be equivalent.

Therefore `ea9fef4362dec00754500d62a6a4d2a5e1041f01` is **NOT ADOPTABLE** and must not be merged/cherry-picked.

Validated source remains `a508fc7d0fb0a0025c67fb5a2c93ae68b192c3b8` on the canonical-generalization line. A clean integration branch must be created from that validated HEAD and receive a byte-preserving/local minimal patch.
