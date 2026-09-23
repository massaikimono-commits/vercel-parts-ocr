// Event identity owns a single V3 entry, independent of mutable input state.
const fallbackEvents = new WeakSet();
const claimedEvents = new WeakSet();

export function markCertificatePdfV3FallbackEvent(event) {
  fallbackEvents.add(event);
  return event;
}

export function isCertificatePdfV3FallbackEvent(event) {
  return fallbackEvents.has(event);
}

export function claimCertificatePdfV3Event(event) {
  if (claimedEvents.has(event)) return false;
  claimedEvents.add(event);
  return true;
}
