# Stage A19 - Four-field OCR Runtime Reconnection

Diagnostic/evaluation only. No Frozen, Production, main, Netlify, Supabase, or Vercel Production changes.

Purpose: reconnect the A13-A17 dynamic row geometry to real four-field OCR and compare positioning only before changing the recognition engine.

Methods:
- CONTROL: current fixed row positions + fixed columns.
- A19_ROW: A17 dynamic row detection + fixed columns.
- A19_TABLE: A17 dynamic row detection + image-local table-column localization from vertical rule evidence.

Recognition engine remains Tesseract for all methods. Guided Live and new OCR engines are excluded.

Formal scoring uses part name, quantity, retail, and cost ground truth from the printed slip. Ground truth is post-hoc scoring only and must never influence row generation, columns, OCR parameters, candidate acceptance, routing, or stop/control.

Primary metrics: per-field accuracy, four-field-complete row rate, total field accuracy, false rows, misread fields, blank fields, and processing time. Row geometry is diagnostic only.

The evaluator also reports attribution signals for row missing, OCR blank, OCR misread, column-localization gain, and extraction failure so a non-improving result can redirect work to recognition/extraction rather than further geometry tuning.
