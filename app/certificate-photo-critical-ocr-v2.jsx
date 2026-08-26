"use client";

import { useEffect } from "react";
import { parseRegistrationNumber } from "./lib/registration-number";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(v = "") {
  return String(v || "").normalize("NFKC").replace(/[‐‑‒–—―ー]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function compact(v = "") {
  return norm(v).replace(/\s+/g, "");
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function fieldValue(label) {
  const wanted = compact(label);
  for (const node of document.querySelectorAll("section.card .grid label")) {
    const text = compact(node.querySelector("span")?.textContent || node.childNodes?.[0]?.textContent || node.textContent || "");
    if (!text.startsWith(wanted)) continue;
    return node.querySelector("input,select")?.value || "";
  }
  return "";
}

function qrVersion(item) {
  const f = String(item?.data || "").normalize("NFKC").replace(/\u3000/g, " ").split("/").map((x) => x.trim());
  return f[0] === "K" ? (f[1] || "") : "";
}

function hasQr(codeDigit) {
  const items = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
  return items.some((item) => new RegExp(`^${codeDigit}\\d$`).test(qrVersion(item)));
}

function jpDate(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const mo = Number(m[3]), d = Number(m[4]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mo}月${d}日`;
}

function docNumber(text) {
  const digits = norm(text).replace(/[^0-9\n ]/g, " ");
  const direct = digits.match(/(?:^|\D)(\d{13})(?:\D|$)/)?.[1];
  if (direct) return direct;
  for (const line of digits.split("\n")) {
    const s = line.replace(/\D/g, "");
    if (s.length === 13) return s;
  }
  return "";
}

function engineCandidate(text, model, chassis) {
  const fam = compact(model).toUpperCase().split("-").pop() || "";
  const cf = compact(chassis).toUpperCase().split("-")[0] || "";
  const t = norm(text).toUpperCase().replace(/\s*[-‐‑‒–—―ー]\s*/g, "-");
  const candidates = t.match(/[A-Z0-9]{2,8}-[A-Z0-9]{2,10}/g) || [];
  const scored = [];
  for (const raw of candidates) {
    const v = raw.replace(/O(?=\d)|(?<=\d)O/g, "0");
    if (!/[A-Z]/.test(v) || !/\d/.test(v)) continue;
    if (fam && v.includes(fam)) continue;
    if (cf && v.includes(cf)) continue;
    if (/^(DAA|DBA|ABA|CBA|5AA|6AA|7BA|8BA)-/.test(v)) continue;
    let score = 1;
    if (/^[A-Z]\d{2}[A-Z]-[A-Z0-9]{3,8}$/.test(v)) score += 5;
    if (v.length >= 7 && v.length <= 13) score += 3;
    scored.push({ value: v, score });
  }
  return scored.sort((a, b) => b.score - a.score)[0]?.value || "";
}

function send(patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!Object.keys(clean).length) return;
  window.__vehicleCertificateQrPriority = { ...(window.__vehicleCertificateQrPriority || {}), ...clean };
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: clean }));
}

async function sourceCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const n = new Image();
      n.onload = () => resolve(n);
      n.onerror = reject;
      n.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 3800 / Math.max(iw, ih));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function crop(source, x0, y0, w0, h0, binary = false, target = 2600) {
  const sx = Math.round(source.width * x0), sy = Math.round(source.height * y0);
  const sw = Math.max(1, Math.round(source.width * w0)), sh = Math.max(1, Math.round(source.height * h0));
  const scale = Math.max(1, Math.min(7, target / Math.max(1, sw)));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const im = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  for (let p = 0; p < im.data.length; p += 4) {
    const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08);
    sum += g;
    im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
  }
  const th = Math.max(100, Math.min(215, sum / Math.max(1, im.data.length / 4) - 16));
  for (let p = 0; p < im.data.length; p += 4) {
    const g = im.data[p];
    const v = binary ? (g < th ? 0 : 255) : Math.max(0, Math.min(255, Math.round((g - 128) * 1.75 + 154)));
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
    im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

async function recognize(worker, canvas, psm, whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_char_whitelist: whitelist,
  });
  return norm((await worker.recognize(canvas)).data.text || "");
}

function showStatus(text) {
  const host = document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-photo-critical-v2-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-photo-critical-v2-status";
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.borderRadius = "10px";
    box.style.background = "#f7f3ff";
    box.style.border = "1px solid #d9cdf8";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }
  box.textContent = text;
}

export default function CertificatePhotoCriticalOcrV2() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2" && location.pathname !== "/vehicle-workflow-fast") return;
    let dead = false;
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++token;

      void (async () => {
        for (let i = 0; i < 70 && !dead && id === token; i += 1) {
          if (!document.querySelector(".progress")) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (dead || id !== token) return;
        await new Promise((resolve) => setTimeout(resolve, 700));

        const needTopRight = !fieldValue("記録年月日") || !fieldValue("記録事項番号");
        const needEngine = !fieldValue("原動機の型式") && !window.__vehicleCertificateQrPriority?.engineModel;
        const needReg = !hasQr("0") && !hasQr("2");
        if (!needTopRight && !needEngine && !needReg) {
          showStatus("重要欄補完v2: QR/OCRで取得済みのため追加OCRなし");
          return;
        }

        const source = await sourceCanvas(file);
        const t = await import("tesseract.js");
        const worker = await t.createWorker("jpn+eng", 1);
        const patch = {};
        const logs = [];
        let passes = 0;
        try {
          const P = t.PSM;
          const sparse = P?.SPARSE_TEXT ?? "11";
          const line = P?.SINGLE_LINE ?? "7";

          if (needTopRight) {
            passes += 1;
            const c = crop(source, .53, .085, .44, .13, false, 3000);
            try {
              const raw = await recognize(worker, c, sparse);
              logs.push(`右上=${raw}`);
              if (!fieldValue("記録年月日")) {
                const d = jpDate(raw);
                if (d) patch.recordDate = d;
              }
              if (!fieldValue("記録事項番号")) {
                const n = docNumber(raw);
                if (n) patch.documentNumber = n;
              }
            } finally { c.width = 1; c.height = 1; }
          }

          if (needEngine) {
            passes += 1;
            const c = crop(source, .43, .385, .53, .13, false, 3000);
            try {
              const raw = await recognize(worker, c, sparse, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
              logs.push(`原動機帯=${raw}`);
              const engine = engineCandidate(raw, fieldValue("型式"), fieldValue("車台番号"));
              if (engine) patch.engineModel = engine;
            } finally { c.width = 1; c.height = 1; }
          }

          if (needReg) {
            const candidates = [];
            for (const binary of [false, true]) {
              passes += 1;
              const c = crop(source, .075, .135, .70, .13, binary, 3200);
              try {
                const raw = await recognize(worker, c, line);
                logs.push(`登録帯${binary ? "白黒" : "灰"}=${raw}`);
                const parsed = parseRegistrationNumber(raw);
                if (parsed?.canonical) candidates.push(parsed.canonical);
              } finally { c.width = 1; c.height = 1; }
            }
            if (candidates.length >= 2 && candidates.every((x) => x === candidates[0])) {
              patch.registrationNumber = candidates[0];
            } else if (!fieldValue("自動車登録番号又は車両番号") && candidates.length === 1) {
              patch.registrationNumber = candidates[0];
            }
          }
        } finally {
          source.width = 1;
          source.height = 1;
          await worker.terminate().catch(() => {});
        }

        if (dead || id !== token) return;
        send(patch);
        showStatus(`重要欄補完v2: ${Object.keys(patch).length}項目 / ${passes}pass${logs.length ? ` / ${logs.join(" | ").slice(0, 220)}` : ""}`);
      })().catch((e) => {
        if (!dead && id === token) showStatus(`重要欄補完v2エラー: ${e?.message || e}`);
      });
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
