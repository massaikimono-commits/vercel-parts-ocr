"use client";

import { useEffect } from "react";
import { prepareDocumentImage } from "./lib/document-image-pipeline";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\u3000/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function fieldInput(labelText) {
  for (const label of document.querySelectorAll("label")) {
    const span = label.querySelector(":scope > span")?.textContent?.trim() || "";
    const direct = (label.childNodes?.[0]?.textContent || "").trim();
    if ((span || direct) !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function modelCore() {
  const text = norm(fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "").replace(/\s+/g, "");
  return text.includes("-") ? text.split("-").pop() || "" : text;
}

function normalizeEnginePattern(value = "") {
  let text = norm(value)
    .replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, "0")
    .replace(/[Il|](?=\d)|(?<=\d)[Il|]/g, "1")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-");
  const parts = text.split("-");
  if (parts.length !== 2) return text;
  let [left, right] = parts;
  left = left.replace(/[OQ](?=\d)|(?<=\d)[OQ]/g, "0").replace(/[I|](?=\d)|(?<=\d)[I|]/g, "1");
  // エンジン/モーター型式で数字位置に混入しやすい O/Q/S を限定補正。
  if (/^[A-Z]{2}[0OQ][S5][A-Z]$/.test(right)) {
    right = `${right.slice(0, 2)}0${right[3] === "S" ? "5" : right[3]}${right[4]}`;
  } else if (/^[A-Z]{2}\dS[A-Z]$/.test(right)) {
    right = `${right.slice(0, 3)}5${right.slice(4)}`;
  }
  right = right.replace(/[OQ](?=\d)|(?<=\d)[OQ]/g, "0").replace(/[I|](?=\d)|(?<=\d)[I|]/g, "1");
  return `${left}-${right}`;
}

function editDistance(a = "", b = "") {
  const x = String(a);
  const y = String(b);
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return row[y.length];
}

function modelContaminated(text = "") {
  const current = norm(text).replace(/\s+/g, "");
  const model = modelCore();
  if (!current || !model) return false;
  if (current === model || current.startsWith(model)) return true;
  for (const n of [model.length, model.length + 1]) {
    if (current.length <= n) continue;
    const tail = current.slice(n).replace(/-/g, "");
    if (tail.length >= 1 && tail.length <= 8 && editDistance(current.slice(0, n), model) <= 1) return true;
  }
  return false;
}

function cleanCandidate(value = "") {
  const text = normalizeEnginePattern(value);
  if (!text || text.length < 3 || text.length > 18) return "";
  if (!/^[A-Z0-9-]+$/.test(text) || !/[A-Z]/.test(text) || !/\d/.test(text)) return "";
  if (modelContaminated(text)) return "";
  if (/^(?:DAA|DBA|ABA|CBA|EBD|HBD|LDA|TDA|TKG|TPG|QKG|QPG|2RG|2PG|3BA|4BA|5BA|5AA|6AA|7BA|8BA)-/.test(text)) return "";
  return text;
}

function candidates(raw = "") {
  const text = norm(raw).replace(/\s+/g, "");
  const out = [];
  for (const m of text.matchAll(/[A-Z0-9]{2,8}-[A-Z0-9]{2,8}/g)) {
    const value = cleanCandidate(m[0]);
    if (value) out.push(value);
  }
  for (const m of text.matchAll(/(?:^|[^A-Z0-9])([A-Z0-9]{3,6})(?:$|[^A-Z0-9])/g)) {
    const value = cleanCandidate(m[1]);
    if (value && !value.includes("-")) out.push(value);
  }
  return [...new Set(out)];
}

function existingDebugCandidates() {
  const values = [];
  for (const pre of document.querySelectorAll("details pre")) {
    const text = pre.textContent || "";
    if (!/原動機|エンジン/.test(text)) continue;
    for (const value of candidates(text)) values.push(value);
  }
  return [...new Set(values)];
}

function choose(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return "";
  const [value, count] = ranked[0];
  if (value.includes("-") && count >= 2) return value;
  if (!value.includes("-") && count >= 3) return value;
  return "";
}

function crop(source, box, binary = false, targetWidth = 2500) {
  const [x, y, w, h] = box;
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h)));
  const scale = Math.max(1, Math.min(10, targetWidth / Math.max(1, sw)));
  const pad = 40;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);

  if (binary) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, count = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const gray = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
      sum += gray; count += 1;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = gray;
    }
    const threshold = Math.max(110, Math.min(220, sum / Math.max(1, count) - 15));
    for (let p = 0; p < image.data.length; p += 4) {
      const v = image.data[p] < threshold ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

async function readEngine(file) {
  const prepared = await prepareDocumentImage(file, { maxSide: 3400, cropPaper: true, minPaperConfidence: 0.46 });
  const source = prepared.normalized;
  const t = await import("tesseract.js");
  const worker = await t.createWorker("eng", 1);
  const raws = [];
  const debugValues = existingDebugCandidates();
  const values = [...debugValues];

  try {
    for (const box of [
      [0.43, 0.425, 0.25, 0.055],
      [0.46, 0.438, 0.21, 0.042],
      [0.40, 0.416, 0.30, 0.070],
    ]) {
      for (const binary of [false, true]) {
        const canvas = crop(source, box, binary);
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: "7",
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ",
          });
          const raw = norm((await worker.recognize(canvas)).data.text || "");
          if (!raw) continue;
          raws.push(raw);
          values.push(...candidates(raw));
        } finally {
          canvas.width = 1;
          canvas.height = 1;
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
    source.width = 1;
    source.height = 1;
  }

  return { value: choose(values), raws, values, debugValues, model: modelCore() };
}

function showDebug(result, state) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  );
  if (!card) return;
  let box = document.getElementById("certificate-engine-model-ocr-fallback-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-engine-model-ocr-fallback-debug";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">原動機型式 1セルOCR（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    card.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (!pre) return;
  pre.textContent = [
    `状態: ${state}`,
    `型式車系: ${result?.model || "未取得"}`,
    `採用: ${result?.value || "保留"}`,
    `既存OCR候補: ${(result?.debugValues || []).join(" / ") || "なし"}`,
    `全候補: ${(result?.values || []).join(" / ") || "なし"}`,
    ...(result?.raws || []).map((x) => `セルOCR: ${x}`),
  ].join("\n");
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

export default function CertificateEngineModelOcrFallback() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let pending = null;
    let startedAt = 0;
    let sawProgress = false;
    let running = false;
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file;
      startedAt = Date.now();
      sawProgress = false;
      running = false;
      token += 1;
    };

    const timer = window.setInterval(async () => {
      if (!pending || running) return;
      if (window.__vehicleCertificateQrPriority?.engineModel) {
        pending = null;
        showDebug({ value: window.__vehicleCertificateQrPriority.engineModel, model: modelCore() }, "K2 QRで確定済み。1セルOCR省略");
        return;
      }
      if (document.querySelector(".progress")) {
        sawProgress = true;
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (sawProgress && elapsed < 36000) return;
      if (!sawProgress && elapsed < 46000) return;

      const file = pending;
      const myToken = token;
      pending = null;
      running = true;
      showDebug({ model: modelCore(), debugValues: existingDebugCandidates() }, "K2未取得のため原動機セルだけOCR中");
      try {
        const result = await readEngine(file);
        if (myToken !== token) return;
        if (result.value) {
          window.__vehicleCertificateEngineOcrPatch = { engineModel: result.value };
          for (let i = 0; i < 5; i += 1) {
            if (window.__vehicleCertificateQrPriority?.engineModel) break;
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { engineModel: result.value } }));
            await new Promise((resolve) => window.setTimeout(resolve, 550));
          }
          showDebug(result, "既存OCR＋セルOCR一致 → 本体stateへ反映");
        } else {
          showDebug(result, "一致不足。安全のため空欄維持");
        }
      } catch (error) {
        showDebug({ model: modelCore(), raws: [String(error?.message || error)] }, "1セルOCRエラー");
      } finally {
        running = false;
      }
    }, 850);

    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
