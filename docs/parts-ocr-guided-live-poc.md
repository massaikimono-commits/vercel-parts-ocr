# Guided Live Parts Scan PoC

Purpose: compare the existing Photo acquisition against Guided Live acquisition using the same downstream OCR pipeline. This is an acquisition-layer experiment only.

## Frozen invariants
- OCR engine unchanged
- PSM unchanged
- part-name / qty / retail / cost extraction unchanged
- A17 runtime gate unchanged
- Frozen branch unchanged
- Production unchanged

## Guided Live acquisition
The PoC uses camera preview, a yellow-slip guide, paper-like quadrilateral detection, coverage, top-edge tilt, perspective distortion, Laplacian-style sharpness, brightness, glare ratio, inter-frame corner stability and best-frame scoring. The best frame is perspective-corrected before it is passed through the existing `saveOCRTransferImage` path.

## Formal comparison
Use the same physical yellow slip for both acquisition modes. Ground truth is the printed content of the slip and must be created independently of OCR output. Row geometry GT is not part of the formal quality judgment.

Primary metrics: part-name accuracy, quantity accuracy, retail accuracy, cost accuracy, four-field complete-row rate, all-field accuracy, misread field count, blank field count, false row count, processing time.

Geometry and acquisition metrics are diagnostic only and cannot decide adoption by themselves.
