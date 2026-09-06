"use client";

export type StagedPart = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
};

type StageMeta = {
  recognitionRoute: "dedicated" | "general";
  rawOcrText?: string;
};

const PARTS_KEY = "parts-data";
const BEFORE_KEY = "parts-before-ocr-ids";
export const REVIEW_META_KEY = "parts-review-meta";

function makeBatchId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function stagePartsForReview(parts: StagedPart[], meta: StageMeta) {
  if (!parts.length) return;

  let current: StagedPart[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PARTS_KEY) || "[]");
    if (Array.isArray(parsed)) current = parsed;
  } catch {}

  sessionStorage.setItem(
    BEFORE_KEY,
    JSON.stringify(current.map((part) => part?.id).filter(Boolean))
  );

  const batchId = makeBatchId();
  sessionStorage.setItem(REVIEW_META_KEY, JSON.stringify({
    batchId,
    localIds: parts.map((part) => part.id),
    recognitionRoute: meta.recognitionRoute,
    rawOcrText: meta.rawOcrText || "",
    stagedAt: new Date().toISOString(),
  }));

  localStorage.setItem(PARTS_KEY, JSON.stringify([...parts, ...current]));
  location.assign("/parts-review");
}
