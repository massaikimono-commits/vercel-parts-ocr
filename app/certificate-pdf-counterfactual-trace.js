const TRACE_FIELDS = [
  "vehicleWeightKg", "grossVehicleWeightKg", "maxPayloadKg", "lengthCm", "widthCm", "heightCm",
  "frontAxleWeightKg", "rearAxleWeightKg", "frontFrontAxleWeightKg", "frontRearAxleWeightKg",
  "rearFrontAxleWeightKg", "rearRearAxleWeightKg", "displacementOrRatedOutput", "engineModel",
  "modelDesignationNumber", "classificationNumber", "ownerName", "ownerAddress", "userName", "userAddress", "baseLocation",
];
const runs = new Map();
let currentRunId = null;
let sequence = 0;
function enabled(locationLike = globalThis.location) {
  try {
    const host = String(locationLike?.hostname || "").toLowerCase();
    if (!(host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app"))) return false;
    return new URLSearchParams(locationLike?.search || "").get("certificatePdfTrace") === "1";
  } catch { return false; }
}
function safeValue(value) {
  if (value === undefined) return null;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  return String(value).slice(0, 240);
}
export function certificatePdfTraceFields(payload = {}) {
  const out = {};
  for (const field of TRACE_FIELDS) out[field] = safeValue(payload?.[field]);
  return out;
}
export function beginCertificatePdfCounterfactualTrace(runId, metadata = {}) {
  if (!enabled()) return null;
  currentRunId = String(runId ?? `trace-${Date.now()}`);
  runs.set(currentRunId, { runId: currentRunId, startedAt: Date.now(), events: [], metadata: { ...metadata } });
  return currentRunId;
}
export function observeCertificatePdfCounterfactualTrace(runId, checkpoint, payload = {}, metadata = {}) {
  if (!enabled()) return null;
  const id = String(runId ?? currentRunId ?? "unowned");
  if (!runs.has(id)) runs.set(id, { runId: id, startedAt: Date.now(), events: [], metadata: {} });
  const record = runs.get(id);
  const event = { sequence: ++sequence, checkpoint: String(checkpoint || "UNKNOWN"), timestamp: Date.now(), owner: safeValue(metadata.owner), writer: safeValue(metadata.writer), invocation: safeValue(metadata.invocation), parsedStrong: safeValue(metadata.parsedStrong), qrFound: safeValue(metadata.qrFound), detectedQrCount: safeValue(metadata.detectedQrCount), values: certificatePdfTraceFields(payload) };
  record.events.push(event);
  try { globalThis.__certificatePdfCounterfactualTrace = getCertificatePdfCounterfactualTrace(id); } catch {}
  return event;
}
export function getCertificatePdfCounterfactualTrace(runId = currentRunId) {
  const record = runs.get(String(runId));
  if (!record) return null;
  return { ...record, events: record.events.map((event) => ({ ...event, values: { ...event.values } })) };
}
export function getCertificatePdfCounterfactualTraceRunId() { return currentRunId; }
export function isCertificatePdfCounterfactualTraceEnabled() { return enabled(); }
