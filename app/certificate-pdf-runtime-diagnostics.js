function defaultNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function cloneMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value)));
}

export function createCertificatePdfRuntimeDiagnostics({ now = defaultNow } = {}) {
  const runs = new Map();
  const listeners = new Set();
  let currentDiagnosticId = null;
  let nextDiagnosticId = 0;

  const snapshot = (record) => record ? {
    runId: record.runId,
    diagnosticId: record.diagnosticId,
    sequence: record.sequence,
    checkpoint: record.checkpoint,
    timestamp: record.timestamp,
    elapsedMs: record.elapsedMs,
    terminalState: record.terminalState,
    metadata: { ...record.metadata },
    checkpoints: record.checkpoints.map((item) => ({ ...item, metadata: { ...item.metadata } })),
  } : null;

  const notify = (record) => {
    if (!record || record.diagnosticId !== currentDiagnosticId) return;
    const value = snapshot(record);
    for (const listener of listeners) {
      try { listener(value); } catch {}
    }
  };

  const recordCheckpoint = (diagnosticId, checkpoint, metadata = {}, terminalState = null, timestampOverride = null) => {
    try {
      const record = runs.get(diagnosticId);
      if (!record || !checkpoint) return null;
      const timestamp = timestampOverride === null ? Number(now()) : timestampOverride;
      const item = {
        sequence: record.sequence + 1,
        checkpoint: String(checkpoint),
        timestamp,
        elapsedMs: Math.max(0, Math.round(timestamp - record.startedAt)),
        metadata: cloneMetadata(metadata),
      };
      record.sequence = item.sequence;
      record.checkpoint = item.checkpoint;
      record.timestamp = item.timestamp;
      record.elapsedMs = item.elapsedMs;
      record.metadata = item.metadata;
      if (terminalState) record.terminalState = terminalState;
      record.checkpoints.push(item);
      notify(record);
      return snapshot(record);
    } catch {
      return null;
    }
  };

  return {
    beginRun(runId, metadata = {}) {
      try {
        const startedAt = Number(now());
        const diagnosticId = ++nextDiagnosticId;
        currentDiagnosticId = diagnosticId;
        runs.set(diagnosticId, {
          runId,
          diagnosticId,
          startedAt,
          sequence: 0,
          checkpoint: "",
          timestamp: startedAt,
          elapsedMs: 0,
          terminalState: "processing",
          metadata: {},
          checkpoints: [],
        });
        return recordCheckpoint(diagnosticId, "RUN_STARTED", metadata, null, startedAt);
      } catch {
        return null;
      }
    },
    checkpoint(diagnosticId, name, metadata = {}) {
      return recordCheckpoint(diagnosticId, name, metadata);
    },
    terminal(diagnosticId, state, metadata = {}) {
      const terminalState = String(state || "error").toLowerCase();
      return recordCheckpoint(diagnosticId, terminalState.toUpperCase(), metadata, terminalState);
    },
    getSnapshot(diagnosticId = currentDiagnosticId) {
      try { return snapshot(runs.get(diagnosticId)); } catch { return null; }
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const runtimeDiagnostics = createCertificatePdfRuntimeDiagnostics();

export const beginCertificatePdfDiagnosticRun = (runId, metadata) => runtimeDiagnostics.beginRun(runId, metadata);
export const checkpointCertificatePdfDiagnostic = (diagnosticId, name, metadata) => runtimeDiagnostics.checkpoint(diagnosticId, name, metadata);
export const terminalCertificatePdfDiagnostic = (diagnosticId, state, metadata) => runtimeDiagnostics.terminal(diagnosticId, state, metadata);
export const getCertificatePdfDiagnosticSnapshot = (diagnosticId) => runtimeDiagnostics.getSnapshot(diagnosticId);
export const subscribeCertificatePdfDiagnostics = (listener) => runtimeDiagnostics.subscribe(listener);

export function formatCertificatePdfDiagnosticSnapshot(snapshot) {
  if (!snapshot) return "PDF v3 Diagnostic\nNo active run";
  return [
    "PDF v3 Diagnostic",
    `Run: ${snapshot.runId}`,
    `Seq: ${snapshot.sequence}`,
    `Checkpoint: ${snapshot.checkpoint}`,
    `Elapsed: ${snapshot.elapsedMs} ms`,
    `Terminal: ${snapshot.terminalState}`,
  ].join("\n");
}

export function isCertificatePdfDiagnosticUiEnabled(locationLike = globalThis.location) {
  const hostname = String(locationLike?.hostname || "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
}
