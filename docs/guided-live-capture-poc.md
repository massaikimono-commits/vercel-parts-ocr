# Guided Live Capture PoC

Date: 2026-09-08
Base app branch: `preview/schedule-ux-20260903`
Base HEAD: `bc6cee603a18f6bd5fdedca5c916985f1f8c8384`
PoC branch: `poc/guided-live-capture-20260908`

## Purpose

Prepare the app-side camera UX for two future operational routes without changing OCR recognition accuracy logic.

### Vehicle certificate

`Guided Live QR Scanner`

Current PoC responsibility:

- iPhone Safari camera stream,
- rear-camera preference,
- QR guide frame,
- live camera/capture status,
- manual still capture,
- optional auto-capture foundation,
- captured image preview,
- temporary browser-local handoff into the existing `/vehicle-workflow-v2` file-input path.

Future OCR-side connection points:

- multi-frame QR decode,
- finder / geometry / quad,
- decode / rescue,
- completion criteria for required QR information.

Existing photo capture, photo library, Photo QR Decode, and QR-less OCR remain intact.

### Parts slip

`Guided Parts Capture`

Current PoC responsibility:

- iPhone Safari camera stream,
- rear-camera preference,
- parts-slip guide frame,
- live camera/capture status,
- manual still capture,
- optional auto-capture foundation,
- captured image preview,
- reuse of the existing `saveOCRTransferImage(...)` handoff into `/ocr`.

Future OCR-side connection points:

- document alignment / capture-quality criteria,
- blur / glare / distance / angle acceptance rules,
- row detection / threshold / field OCR / recognition.

The app-side PoC does not run continuous full-text OCR on the live video stream.

## Safety boundary

This PoC does not change:

- Supabase schema / RLS / RPC,
- `main`,
- Netlify Production,
- Vercel Production,
- vehicle-certificate OCR finder / geometry / quad / decode / rescue parameters,
- parts OCR row detection / threshold / field-recognition parameters.

No OCR specialist branch is merged into this PoC branch.

## Certificate transfer retention rule

The guided certificate image remains in `sessionStorage` while the app waits for the existing certificate file input. The transfer is cleared only after the `File` is attached and the existing `change` event is dispatched successfully. DataTransfer failure or file-input timeout keeps the captured image available and shows a visible error message instead of silently discarding it.

Auto capture remains OFF by default until OCR-side `captureAllowed` quality criteria are connected.

## Preview approval

Management approved a PoC-only Vercel Preview on 2026-09-08 after the certificate transfer retention fix. Production deployment remains prohibited. The first iPhone Safari pass evaluates camera/guide/capture/transfer behavior only, not OCR recognition accuracy or auto-capture quality.

## Integration rule

Do not merge this PoC branch wholesale into the app branch. After iPhone Safari validation and management review, take only the approved camera/flow integration diff needed by the app branch.
