const eventOrigins = new WeakMap();
let nextOriginSequence = 0;

const EMPTY_ORIGIN = Object.freeze({
  programmaticChangeOrigin: null,
  originSequence: null,
});

export function observeCertificatePdfProgrammaticChange(event, programmaticChangeOrigin) {
  try {
    eventOrigins.set(event, {
      programmaticChangeOrigin: String(programmaticChangeOrigin || "UNKNOWN"),
      originSequence: ++nextOriginSequence,
    });
  } catch {
    // Diagnostics must never affect the event producer.
  }
  return event;
}

export function getCertificatePdfProgrammaticChangeOrigin(event) {
  try {
    return eventOrigins.get(event) || EMPTY_ORIGIN;
  } catch {
    return EMPTY_ORIGIN;
  }
}
