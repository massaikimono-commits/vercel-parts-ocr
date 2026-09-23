const eventOrigins = new WeakMap();
const passConsumers = new WeakMap();
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

export function observeCertificatePdfPassConsumer(event, identity) {
  try {
    const previous = passConsumers.get(event);
    const consumer = {
      passConsumerCount: (previous?.passConsumerCount || 0) + 1,
      passConsumerComponentInstanceId: identity.componentInstanceId,
      passConsumerListenerInstanceId: identity.listenerInstanceId,
      passConsumerMountGeneration: identity.mountGeneration,
    };
    passConsumers.set(event, consumer);
    return { ...consumer };
  } catch {
    return null;
  }
}

export function getCertificatePdfPassConsumer(event) {
  try {
    const consumer = passConsumers.get(event);
    return consumer ? { ...consumer } : null;
  } catch {
    return null;
  }
}
