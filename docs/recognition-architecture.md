# Recognition architecture

This document is the current product decision record for vehicle-certificate and parts-slip recognition.

## Vehicle certificate photo: production order

1. Image quality / paper-area check.
2. Fast QR scan first.
   - QR is used because it is normally the fastest and most deterministic source.
   - Do not restore brute-force repeated scanning of every QR.
3. Apply trusted QR fields immediately.
4. OCR only fields/groups still missing.
   - Use field-specific or band-specific crops.
   - Use small numbers of preprocessing variants.
   - Validate candidates by label, format, unit and plausible range.
   - Stop as soon as a valid candidate is obtained.
5. Run targeted rescue OCR only for unresolved important fields.
6. If QR is absent/unreadable, fall back to photo OCR.
7. Surface only unresolved/low-confidence fields for human review.

Target direction:
- fast QR stage: about 3 seconds or less when practical
- normal certificate recognition: about 8 seconds or less
- difficult fallback: about 15 seconds or less

QR, OCR, derived values and manual values must remain separate recognition sources. OCR output must never be promoted to QR authority.

## Parts slips

Parts slips generally have no usable QR source, so reuse the OCR primitives developed above:
- detect document/row structure
- crop only relevant regions
- recognize part name / quantity / list price / cost
- use multiple preprocessing passes only when needed
- validate by field type and cross-field consistency
- stop early when stable
- reduce or remove OCR work when a more reliable recognition source becomes available

## Anti-drift rules

- Do not change the QR-first certificate-photo premise merely because OCR needs improvement.
- Improve the missing-field OCR itself before changing the top-level order.
- Before a large recognition-flow change, review this document and recent regression results.
- Prefer one isolated fix over broad rewrites when a previously stable path exists.
- Keep regression fixtures for every layout class already proven in production tests.
- Batch meaningful changes and deploy once; do not use no-op or tiny pushes for Vercel testing.
- If a proposed change conflicts with this document, treat it as an architecture change and explicitly revisit the decision before implementation.

## QR regression guard

The six-code kei certificate row has a known stable scan baseline from 2026-08-24:
- scan all six slots at y=0.80 color
- retry only missing slots at y=0.80 contrast
- retry only missing slots at y=0.835 color
- retry only missing slots at y=0.835 contrast
- stop immediately when six codes are present

Do not replace this with contrast-only or identity-only scanning unless the same real-device fixture proves equal or better six-code recovery and speed.

Targeted QR rescue must never start while the fast six-slot scan is still running. Rescue begins only after fast scan completion and only for codes still missing. Rescue has a strict time budget.
