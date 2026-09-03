"use client";

import { useEffect } from "react";
import { prepareDocumentImage } from "./lib/document-image-pipeline";
import { TOP_HEADER_CROPS, parseTopHeaderText } from "./lib/certificate-fast-top-header.mjs";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function normalize(value = "") {
  return String(value || "").normalize("NFKC").replace(/\u3000/g, " ").replace(/\r/g, "").trim();
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function fieldValue(labelText) {
  for (const label of document.querySelectorAll("section.card label")) {
    const title = normalize(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (!title.includes(labelText)) continue;
    const input = label.querySelector("input,select");
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) return input.value || "";
  }
  return "";
}

function crop(source, box, binary = false) {
  const [x, y, w, h] = box;
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h)));
  const scale = Math.max(1, Math.min(7, 2600 / Math.max(1, sw)));
  const pad = 32;
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
    let sum = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      sum += g;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    }
    const mean = sum / Math.max(1, image.data.length / 4);
    const threshold = Math.max(120, Math.min(210, mean - 12));
    for (let p = 0; p < image.data.length; p += 4) {
      const v = image.data[p] < threshold ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

function dispatchPatch(patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => typeof value === "string" && value.trim()));
  if (!Object.keys(clean).length) return false;
  window.__vehicleCertificatePhotoPriority = { ...(window.__vehicleCertificatePhotoPriority || {}), ...clean };
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: clean }));
  return true;
}

export default function CertificateFastTopHeaderRecovery() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-fast") return;
    let pending = null;
    let scanId = 0;
    let timer = 0;
    let running = false;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      pending = file;
      running = false;
      scanId += 1;
      if (timer) window.clearTimeout(timer);
      const id = scanId;
      timer = window.setTimeout(() => void recover(id), 1200);
    };

    const recover = async (id) => {
      if (!pending || running || id !== scanId) return;
      if (document.querySelector(".progress")) {
        timer = window.setTimeout(() => void recover(id), 500);
        return;
      }
      const haveRecordDate = fieldValue("記録年月日");
      const haveDocumentNumber = fieldValue("記録事項番号");
      if (haveRecordDate && haveDocumentNumber) {
        pending = null;
        return;
      }

      const file = pending;
      pending = null;
      running = true;
      let worker = null;
      try {
        const prepared = await prepareDocumentImage(file, { maxSide: 3200, cropPaper: true, minPaperConfidence: 0.42 });
        const source = prepared.normalized;
        const t = await import("tesseract.js");
        worker = await t.createWorker("jpn+eng", 1);
        const patch = {};
        const psm = String(t.PSM?.SPARSE_TEXT ?? "11");

        for (let i = 0; i < TOP_HEADER_CROPS.length; i += 1) {
          const variants = i === 0 ? [false] : [true];
          for (const binary of variants) {
            const canvas = crop(source, TOP_HEADER_CROPS[i], binary);
            try {
              await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: psm, user_defined_dpi: "300" });
              const raw = normalize((await worker.recognize(canvas)).data.text || "");
              const parsed = parseTopHeaderText(raw);
              if (!haveRecordDate && !patch.recordDate && parsed.recordDate) patch.recordDate = parsed.recordDate;
              if (!haveDocumentNumber && !patch.documentNumber && parsed.documentNumber) patch.documentNumber = parsed.documentNumber;
            } finally {
              canvas.width = 1;
              canvas.height = 1;
            }
          }
          if ((haveRecordDate || patch.recordDate) && (haveDocumentNumber || patch.documentNumber)) break;
        }

        source.width = 1;
        source.height = 1;
        if (id === scanId) dispatchPatch(patch);
      } catch (error) {
        console.warn("fast top-header recovery skipped", error);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        running = false;
      }
    };

    document.addEventListener("change", onChange, true);
    return () => {
      scanId += 1;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
