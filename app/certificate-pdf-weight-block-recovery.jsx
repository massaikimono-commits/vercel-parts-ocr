"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";

function norm(value) {
  return String(value || "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}
function compact(value) { return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, ""); }

function tokenFromItem(item, pageWidth, pageHeight) {
  const text = norm(item?.str || "");
  if (!text) return null;
  const tr = item?.transform || [1, 0, 0, 1, 0, 0];
  const x = Number(tr[4] || 0) / Math.max(1, pageWidth);
  const baseline = Number(tr[5] || 0) / Math.max(1, pageHeight);
  const h = Math.max(Math.abs(Number(tr[3] || 0)), Number(item?.height || 0), 1) / Math.max(1, pageHeight);
  const w = Math.max(Number(item?.width || 0), 1) / Math.max(1, pageWidth);
  return { text, x, y: 1 - baseline, w, h };
}

function buildLines(tokens) {
  const lines = [];
  for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - token.y) <= Math.max(0.0045, token.h * 0.72));
    if (!line) { line = { y: token.y, tokens: [] }; lines.push(line); }
    line.tokens.push(token);
    line.y = line.tokens.reduce((sum, value) => sum + value.y, 0) / line.tokens.length;
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    line.text = line.tokens.map((token) => token.text).join(" ");
  }
  return lines.sort((a, b) => a.y - b.y);
}

function labelX(line, label) {
  const wanted = compact(label);
  for (let start = 0; start < line.tokens.length; start += 1) {
    let joined = "";
    for (let end = start; end < line.tokens.length && end < start + 8; end += 1) {
      joined += compact(line.tokens[end].text);
      if (joined.includes(wanted)) return line.tokens[start].x;
      if (joined.length > wanted.length + 10) break;
    }
  }
  return null;
}

function primaryNumber(text) {
  const raw = norm(text);
  // Bracketed secondary values are retained only as diagnostic evidence; the form schema is single-value.
  const outside = raw.replace(/[\[［].*?[\]］]/g, " ");
  const match = outside.match(/(?:^|\D)(\d{2,5})(?:\D|$)/);
  return match ? String(Number(match[1])) : "";
}

function recoverWeightBlock(tokens) {
  const lines = buildLines(tokens);
  const header = lines.find((line) => {
    const t = compact(line.text);
    return t.includes("最大積載量") && t.includes("車両重量") && t.includes("車両総重量");
  });
  if (!header) return { patch: {}, diagnostic: { stage: "A", reason: "weight-header-not-found" } };

  const labels = ["最大積載量", "車両重量", "車両総重量"];
  const xs = labels.map((label) => labelX(header, label));
  if (xs.some((x) => x === null)) return { patch: {}, diagnostic: { stage: "B", reason: "weight-label-x-unresolved", xs } };

  const ordered = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const bounds = new Map();
  for (let p = 0; p < ordered.length; p += 1) {
    const left = p === 0 ? ordered[p].x - 0.02 : (ordered[p - 1].x + ordered[p].x) / 2;
    const right = p === ordered.length - 1 ? 1 : (ordered[p].x + ordered[p + 1].x) / 2;
    bounds.set(ordered[p].i, [left, right]);
  }

  const nextHeader = lines.find((line) => line.y > header.y + 0.006 && compact(line.text).includes("車台番号") && compact(line.text).includes("前前軸重"));
  const maxY = nextHeader ? nextHeader.y - 0.002 : header.y + 0.09;
  const evidence = [];
  const values = [];
  for (let i = 0; i < labels.length; i += 1) {
    const [left, right] = bounds.get(i);
    const candidates = tokens
      .filter((token) => token.y > header.y + 0.002 && token.y < maxY && token.x >= left && token.x < right)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const joined = candidates.map((token) => token.text).join(" ");
    const value = primaryNumber(joined);
    values[i] = value;
    evidence.push({ label: labels[i], labelX: xs[i], left, right, raw: joined, value, tokens: candidates.map((t) => ({ text: t.text, x: t.x, y: t.y, w: t.w, h: t.h })) });
  }

  const patch = {};
  if (values[0]) patch.maxPayloadKg = values[0];
  if (values[1]) patch.vehicleWeightKg = values[1];
  if (values[2]) patch.grossVehicleWeightKg = values[2];
  return { patch, diagnostic: { stage: Object.keys(patch).length === 3 ? "RECOVERED" : "B", header: header.text, headerY: header.y, maxY, evidence } };
}

async function extract(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    let best = null;
    for (let n = 1; n <= Math.min(pdf.numPages || 1, 8); n += 1) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const tokens = (content.items || []).map((item) => tokenFromItem(item, viewport.width, viewport.height)).filter(Boolean);
      const text = compact(tokens.map((t) => t.text).join(" "));
      const score = (text.includes("最大積載量") ? 3 : 0) + (text.includes("車両重量") ? 3 : 0) + (text.includes("車両総重量") ? 3 : 0) + (text.includes("車台番号") ? 1 : 0);
      if (!best || score > best.score) best = { pageNumber: n, tokens, score };
    }
    const result = recoverWeightBlock(best?.tokens || []);
    return { ...result, pageNumber: best?.pageNumber || 1, tokenCount: best?.tokens?.length || 0 };
  } finally { await pdf.destroy?.().catch?.(() => {}); }
}

export default function CertificatePdfWeightBlockRecovery() {
  useLayoutEffect(() => {
    let dead = false;
    let pending = null;
    let latest = null;

    const onChange = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !(file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""))) return;
      // Capture a private File copy before v3 clears the input.
      const copy = file.slice(0, file.size, file.type);
      pending = extract(copy).then((result) => { if (!dead) latest = result; return result; }).catch((error) => ({ patch: {}, diagnostic: { stage: "ERROR", reason: String(error?.message || error) } }));
    };

    const onAuthoritative = async (event) => {
      const detail = event?.detail;
      if (!detail || typeof detail !== "object") return;
      const result = latest || (pending ? await pending : null);
      if (dead || !result) return;
      window.__certificatePdfWeightDiagnostic = result;
      const recovered = result.patch || {};
      if (!recovered.maxPayloadKg || !recovered.vehicleWeightKg || !recovered.grossVehicleWeightKg) return;
      // Never source these fields from axle values. Recovery only comes from the three semantic columns above.
      const merged = { ...detail, ...recovered };
      window[PDF_PRIORITY_KEY] = merged;
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: merged }));
    };

    window.addEventListener("change", onChange, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative);
    return () => { dead = true; window.removeEventListener("change", onChange, true); window.removeEventListener(AUTH_EVENT, onAuthoritative); };
  }, []);
  return null;
}
