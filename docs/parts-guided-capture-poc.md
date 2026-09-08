# Guided Parts Capture PoC

Source branch: experiment/parts-guided-capture\nPreview branch: eval/parts-guided-capture

Route: /ocr/guided-capture

Purpose: improve capture quality before existing Photo OCR. This PoC does not change OCR recognition logic.

Live checks:
- paper-like bbox / guide containment
- axis tilt estimate
- Laplacian-variance sharpness
- brightness / contrast
- highlight clipping ratio
- paper occupancy
- estimated paper pixel resolution
- stable-ready auto capture

Capture stays in the browser. No server image upload, Supabase write, artifact write, or PII log write is added.

Handoff uses the existing saveOCRTransferImage() path and then opens /ocr/auto. OCR result still requires the existing user confirmation/save flow.
