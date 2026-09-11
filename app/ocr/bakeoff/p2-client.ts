"use client";

import { BAKEOFF_CONTRACT_VERSION, type BakeoffPrediction } from "./contract";

const MAX_BYTES = 16 * 1024 * 1024;

export async function runP2Local(input: { endpoint: string; file: File; runId: string; imageId: string; captureId: string; timeoutMs?: number }): Promise<BakeoffPrediction> {
  if (input.file.size > MAX_BYTES) throw new Error("P2 upload exceeds 16 MiB PoC limit");
  const endpoint = new URL(input.endpoint);
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("P2 endpoint must use http or https");
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 120000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new FormData();
    body.append("image", input.file, "capture.jpg");
    body.append("runId", input.runId);
    body.append("imageId", input.imageId);
    body.append("captureId", input.captureId);
    const response = await fetch(new URL("/v1/predict", endpoint), { method: "POST", body, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`P2 HTTP ${response.status}`);
    const prediction = await response.json() as BakeoffPrediction;
    if (prediction.schema !== BAKEOFF_CONTRACT_VERSION || prediction.candidateId !== "P2" || prediction.gtIncluded !== false) throw new Error("P2 response contract rejected");
    return prediction;
  } finally {
    window.clearTimeout(timer);
  }
}
