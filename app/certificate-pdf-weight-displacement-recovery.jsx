"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";

function norm(v) {
  return String(v ?? "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}
function compact(v) { return norm(v).replace(/[\s:：・,，.。()（）\[\]［］]/g, ""); }
function makeToken(item, width, height) {
  const text = norm(item?.str);
  if (!text) return null;
  const tr = item?.transform || [1, 0, 0, 1, 0, 0];
  const x = Number(tr[4] || 0) / Math.max(1, width);
  const y = 1 - Number(tr[5] || 0) / Math.max(1, height);
  const w = Math.max(Number(item?.width || 0), 1) / Math.max(1, width);
  const h = Math.max(Math.abs(Number(tr[3] || 0)), Number(item?.height || 0), 1) / Math.max(1, height);
  return { text, x, y, w, h, cx: x + w / 2 };
}
function linesFrom(tokens) {
  const lines = [];
  for (const t of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.find((x) => Math.abs(x.y - t.y) <= Math.max(.0045, t.h * .72));
    if (!line) { line = { y: t.y, tokens: [] }; lines.push(line); }
    line.tokens.push(t);
    line.y = line.tokens.reduce((s, x) => s + x.y, 0) / line.tokens.length;
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    line.text = line.tokens.map((x) => x.text).join(" ");
  }
  return lines.sort((a, b) => a.y - b.y);
}
function anchor(lines, label) {
  const wanted = compact(label);
  for (const line of lines) {
    for (let s = 0; s < line.tokens.length; s++) {
      let joined = "";
      for (let e = s; e < line.tokens.length && e < s + 16; e++) {
        joined += compact(line.tokens[e].text);
        if (joined.includes(wanted)) {
          const first = line.tokens[s], last = line.tokens[e];
          return { line, y: line.y, left: first.x, right: last.x + last.w, cx: (first.x + last.x + last.w) / 2 };
        }
        if (joined.length > wanted.length + 24) break;
      }
    }
  }
  return null;
}
function parseWeightTokens(tokens) {
  const text = norm(tokens.map((t) => t.text).join(" ")).replace(/kg/ig, " ");
  const m = text.match(/(\d{2,5})(?:\s*[\[［]\s*(\d{2,5})\s*[\]］])?/);
  if (!m) return null;
  const primary = Number(m[1]), alternate = m[2] ? Number(m[2]) : null;
  return { raw: alternate == null ? String(primary) : `${primary} [${alternate}]`, primary, alternate, source: text };
}
function recoverWeights(tokens, lines) {
  const defs = [
    ["最大積載量", "maxPayloadKg", "maxPayload"],
    ["車両重量", "vehicleWeightKg", "vehicleWeight"],
    ["車両総重量", "grossVehicleWeightKg", "grossVehicleWeight"],
  ];
  const items = defs.map(([label, key, base]) => ({ label, key, base, a: anchor(lines, label) }));
  if (items.some((x) => !x.a)) return {};
  const sorted = [...items].sort((a, b) => a.a.cx - b.a.cx);
  const headerY = Math.max(...items.map((x) => x.a.y));
  const nextAnchors = ["長さ", "前前軸重", "車台番号", "総排気量又は定格出力"]
    .map((x) => anchor(lines, x)).filter(Boolean).filter((x) => x.y > headerY + .004);
  const bottom = nextAnchors.length ? Math.min(...nextAnchors.map((x) => x.y)) - .002 : Math.min(1, headerY + .11);
  const out = {}, evidence = {};
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1], next = sorted[i + 1];
    const left = prev ? (prev.a.cx + item.a.cx) / 2 : Math.max(0, item.a.left - .04);
    const right = next ? (item.a.cx + next.a.cx) / 2 : 1;
    const candidates = tokens.filter((t) => t.y > headerY + .001 && t.y < bottom && t.cx >= left && t.cx < right)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const parsed = parseWeightTokens(candidates);
    evidence[item.base] = { label: item.label, sourceTokens: candidates.map((t) => t.text).join(" "), parsed };
    if (!parsed) return;
    out[item.key] = parsed.raw;
    out[`${item.base}Raw`] = parsed.raw;
    out[`${item.base}PrimaryKg`] = parsed.primary;
    out[`${item.base}AlternateKg`] = parsed.alternate;
  });
  out.__weightEvidenceV2 = evidence;
  return out;
}
function recoverDisplacement(tokens, lines) {
  const a = anchor(lines, "総排気量又は定格出力");
  if (!a) return {};
  const stops = ["燃料の種類", "型式指定番号", "類別区分番号"].map((x) => anchor(lines, x)).filter(Boolean).filter((x) => x.y > a.y + .004);
  const bottom = stops.length ? Math.min(...stops.map((x) => x.y)) - .002 : Math.min(1, a.y + .085);
  const region = tokens.filter((t) => t.y > a.y + .001 && t.y < bottom && t.x >= Math.max(0, a.left - .02));
  const numbers = region.filter((t) => /^\d+(?:\.\d+)?$/.test(compact(t.text)));
  const units = region.filter((t) => /^(?:L|l|ℓ|kW|KW|kw)$/.test(compact(t.text)));
  let best = null;
  for (const n of numbers) {
    for (const u of units) {
      const dy = Math.abs(n.y - u.y), dx = Math.abs((n.x + n.w) - u.x);
      const score = dy * 8 + dx;
      if (!best || score < best.score) best = { n, u, score, dy, dx };
    }
  }
  const sourceTokens = region.sort((p, q) => p.y - q.y || p.x - q.x).map((t) => t.text).join(" ");
  if (!best || best.dy > .018) return { __displacementEvidenceV2: { sourceTokens, parsed: null } };
  const value = compact(best.n.text), unit = /^(?:L|l|ℓ)$/.test(compact(best.u.text)) ? "L" : "kW";
  return {
    displacementOrRatedOutput: `${value} ${unit}`,
    displacementOrRatedOutputRaw: `${value} ${norm(best.u.text)}`,
    displacementOrRatedOutputValue: value,
    displacementOrRatedOutputUnit: unit,
    __displacementEvidenceV2: { sourceTokens, parsed: { value, unit, dy: best.dy, dx: best.dx } },
  };
}
async function extract(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    let best = null;
    for (let n = 1; n <= Math.min(pdf.numPages || 1, 8); n++) {
      const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 }), content = await page.getTextContent();
      const tokens = (content.items || []).map((x) => makeToken(x, vp.width, vp.height)).filter(Boolean), lines = linesFrom(tokens);
      const text = compact(lines.map((l) => l.text).join(" "));
      const score = (text.includes("最大積載量") ? 3 : 0) + (text.includes("車両重量") ? 2 : 0) + (text.includes("総排気量又は定格出力") ? 3 : 0);
      if (!best || score > best.score) best = { tokens, lines, score };
    }
    return { ...recoverWeights(best?.tokens || [], best?.lines || []), ...recoverDisplacement(best?.tokens || [], best?.lines || []) };
  } finally { await pdf.destroy?.().catch?.(() => {}); }
}
export default function CertificatePdfWeightDisplacementRecovery() {
  useLayoutEffect(() => {
    let dead = false, pending = null, latest = null, dispatching = false;
    const onChange = (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !(file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""))) return;
      const copy = file.slice(0, file.size, file.type);
      pending = extract(copy).then((r) => { if (!dead) latest = r; return r; }).catch((err) => { console.warn("certificate weight/displacement recovery", err); return null; });
    };
    const onAuth = async (e) => {
      if (dispatching) return;
      const detail = e?.detail;
      if (!detail || typeof detail !== "object") return;
      const recovered = latest || (pending ? await pending : null) || {};
      if (dead) return;
      const merged = { ...detail };
      const keys = ["maxPayloadKg", "vehicleWeightKg", "grossVehicleWeightKg", "maxPayloadRaw", "maxPayloadPrimaryKg", "maxPayloadAlternateKg", "vehicleWeightRaw", "vehicleWeightPrimaryKg", "vehicleWeightAlternateKg", "grossVehicleWeightRaw", "grossVehicleWeightPrimaryKg", "grossVehicleWeightAlternateKg", "displacementOrRatedOutput", "displacementOrRatedOutputRaw", "displacementOrRatedOutputValue", "displacementOrRatedOutputUnit", "__weightEvidenceV2", "__displacementEvidenceV2"];
      for (const key of keys) if (recovered[key] !== undefined && recovered[key] !== "") merged[key] = recovered[key];
      if (JSON.stringify(merged) === JSON.stringify(detail)) return;
      dispatching = true;
      try {
        window[PDF_PRIORITY_KEY] = merged;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: merged }));
      } finally { dispatching = false; }
    };
    window.addEventListener("change", onChange, true);
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => { dead = true; window.removeEventListener("change", onChange, true); window.removeEventListener(AUTH_EVENT, onAuth); };
  }, []);
  return null;
}
