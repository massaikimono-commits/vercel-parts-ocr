"use client";

import { useEffect } from "react";
import { parseRegistrationNumber } from "./lib/registration-number";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(v = "") {
  return String(v || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function lines(text = "") {
  return norm(text).split("\n").map((x) => x.trim()).filter(Boolean);
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function fieldValue(label) {
  const labels = Array.from(document.querySelectorAll("section.card .grid label"));
  const hit = labels.find((node) => (node.textContent || "").replace(/\s+/g, "").startsWith(label.replace(/\s+/g, "")));
  return hit?.querySelector("input,select")?.value || "";
}

function sectionText(debug, name, nextName) {
  const start = debug.indexOf(`--- ${name} ---`);
  if (start < 0) return "";
  const from = start + `--- ${name} ---`.length;
  const end = nextName ? debug.indexOf(`--- ${nextName} ---`, from) : -1;
  return debug.slice(from, end >= 0 ? end : undefined).trim();
}

function registrationCandidate(text) {
  const direct = parseRegistrationNumber(text);
  if (direct) return direct.canonical;
  const a = lines(text);
  for (let i = 0; i < a.length; i += 1) {
    const place = a[i].replace(/[^一-龠々ぁ-んァ-ヶ]/g, "");
    if (place.length < 2 || place.length > 8) continue;
    if (/情報|番号|年月|期間|基本|自動車|検査|交付|車台/.test(place)) continue;
    const windowText = a.slice(i + 1, i + 9).join(" ");
    const m = windowText.match(/^\s*((?:[0-9A-Z]\s*){1,3})\s*([ぁ-ん])\s*((?:[0-9]\s*){1,7})/i);
    if (!m) continue;
    const cls = (m[1] || "").replace(/\s/g, "").toUpperCase();
    const serialDigits = (m[3] || "").replace(/\D/g, "");
    if (!/^[0-9A-Z]{1,3}$/.test(cls) || !serialDigits) continue;
    const serial = serialDigits.slice(0, 4).replace(/^0+(?=\d)/, "") || "0";
    return `${place} ${cls} ${m[2]} ${serial}`;
  }
  return "";
}

function modelFamily(model = "") {
  const t = norm(model).toUpperCase().replace(/\s+/g, "");
  return (t.split("-").pop() || t).replace(/[^A-Z0-9]/g, "");
}

function chassisCandidate(text, model = "") {
  const fam = modelFamily(model);
  const joined = lines(text).join("").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const candidates = joined.match(/[A-Z0-9]{3,9}-[0-9O-]{4,16}/g) || [];
  const scored = [];
  for (const raw of candidates) {
    const dash = raw.indexOf("-");
    if (dash < 0) continue;
    let left = raw.slice(0, dash).replace(/O(?=\d)|(?<=\d)O/g, "0");
    const right = raw.slice(dash + 1).replace(/-/g, "").replace(/O/g, "0");
    if (!/^\d{4,10}$/.test(right)) continue;
    if (/^(DAA|DBA|ABA|CBA|5AA|6AA|7BA|8BA)$/.test(left)) continue;
    let score = 4;
    if (fam) {
      if (left === fam) score += 12;
      else if ((fam.endsWith(left) || left.endsWith(fam)) && Math.abs(fam.length - left.length) <= 1) {
        left = fam;
        score += 10;
      } else if (fam.includes(left) || left.includes(fam)) score += 6;
    }
    scored.push({ value: `${left}-${right}`, score });
  }
  return scored.sort((a, b) => b.score - a.score)[0]?.value || "";
}

function makerFromModel(model = "") {
  const fam = modelFamily(model);
  const exact = {
    MK53S: "スズキ",
    ZWE219H: "トヨタ",
    ZWE219: "トヨタ",
  };
  return exact[fam] || "";
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
    const scale = Math.min(1, 3400 / Math.max(iw, ih));
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

function detectPaper(c) {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: c.width, h: c.height };
  const w = c.width, h = c.height, d = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const ok = (x, y) => {
    const p = (y * w + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
    return (r + g + b) / 3 > 112 && Math.max(r, g, b) - Math.min(r, g, b) < 100;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > .22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2), bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > .22) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2), right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source, paper, box, target = 2600, binary = false) {
  const [x, y, w, h] = box;
  const sx = Math.round(paper.x + paper.w * x), sy = Math.round(paper.y + paper.h * y);
  const sw = Math.max(1, Math.round(paper.w * w)), sh = Math.max(1, Math.round(paper.h * h));
  const scale = Math.max(1, Math.min(7, target / Math.max(1, sw)));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const image = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  for (let p = 0; p < image.data.length; p += 4) {
    const g = Math.round(image.data[p] * .22 + image.data[p + 1] * .70 + image.data[p + 2] * .08);
    sum += g; image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
  }
  const th = Math.max(105, Math.min(210, sum / Math.max(1, image.data.length / 4) - 18));
  for (let p = 0; p < image.data.length; p += 4) {
    const g = image.data[p];
    const v = binary ? (g < th ? 0 : 255) : Math.max(0, Math.min(255, Math.round((g - 128) * 1.7 + 154)));
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v; image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return c;
}

function numericTuple(raw, kei) {
  const nums = (norm(raw).match(/\d{2,5}/g) || []).map(Number);
  let best = null;
  for (let a = 0; a < nums.length - 4; a += 1)
    for (let b = a + 1; b < nums.length - 3; b += 1)
      for (let c = b + 1; c < nums.length - 2; c += 1)
        for (let d = c + 1; d < nums.length - 1; d += 1)
          for (let e = d + 1; e < nums.length; e += 1) {
            const [weight, gross, length, width, height] = [nums[a], nums[b], nums[c], nums[d], nums[e]];
            if (weight < 300 || weight > 30000 || gross < weight || gross > 50000) continue;
            if (length < 100 || length > 3000 || width < 100 || width > 300 || height < 100 || height > 450) continue;
            if (kei && (weight > 2200 || gross > 3000 || length > 400 || width > 180 || height > 260)) continue;
            let score = 1;
            if (kei && length <= 360 && width <= 160) score += 6;
            if (gross - weight >= 100 && gross - weight <= 1500) score += 2;
            if (!best || score > best.score) best = { score, weight, gross, length, width, height };
          }
  return best;
}

function showStatus(text) {
  const host = document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-photo-rescue-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-photo-rescue-status";
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.borderRadius = "10px";
    box.style.background = "#eef4ff";
    box.style.border = "1px solid #c8d8fb";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }
  box.textContent = text;
}

function sendPatch(patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!Object.keys(clean).length) return;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: clean }));
}

export default function CertificatePhotoRescue() {
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
        // Wait for the main fast OCR to finish; reuse its text before doing any extra OCR.
        for (let i = 0; i < 80 && !dead && id === token; i += 1) {
          const summary = Array.from(document.querySelectorAll("details summary")).find((x) => (x.textContent || "").includes("高速読み取り詳細"));
          if (!document.querySelector(".progress") && summary) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (dead || id !== token) return;

        const summary = Array.from(document.querySelectorAll("details summary")).find((x) => (x.textContent || "").includes("高速読み取り詳細"));
        const debug = summary?.parentElement?.querySelector("pre")?.textContent || "";
        const top = sectionText(debug, "上段", "使用者");
        const model = fieldValue("型式") || (window.__vehicleCertificateQrPriority?.model || "");
        const patch = {};
        if (!fieldValue("自動車登録番号又は車両番号")) {
          const registration = registrationCandidate(top);
          if (registration) patch.registrationNumber = registration;
        }
        if (!fieldValue("車台番号")) {
          const chassis = chassisCandidate(top, model);
          if (chassis) patch.chassisNumber = chassis;
        }
        if (!fieldValue("車名")) {
          const name = makerFromModel(model);
          if (name) patch.vehicleName = name;
        }
        sendPatch(patch);

        const missingNumeric = ["車両重量kg", "車両総重量kg", "長さcm", "幅cm", "高さcm"].some((label) => !fieldValue(label));
        if (!missingNumeric) {
          showStatus(`写真補完: 文字分断補正${Object.keys(patch).length ? ` ${Object.keys(patch).length}項目` : "不要"} / 数値行は取得済み`);
          return;
        }

        showStatus("不足している重量・寸法だけを1行OCRで補完中…");
        const source = await sourceCanvas(file);
        const paper = detectPaper(source);
        const t = await import("tesseract.js");
        const worker = await t.createWorker("eng", 1);
        const P = t.PSM, psm = P?.SINGLE_BLOCK ?? "6";
        let raw = "";
        let passes = 0;
        try {
          for (const binary of [false, true]) {
            passes += 1;
            const c = crop(source, paper, [.10, .510, .80, .060], 2800, binary);
            try {
              await worker.setParameters({
                tessedit_pageseg_mode: String(psm),
                preserve_interword_spaces: "1",
                user_defined_dpi: "300",
                tessedit_char_whitelist: "0123456789 -kgKGMcmCM",
              });
              raw += `\n${norm((await worker.recognize(c)).data.text || "")}`;
            } finally {
              c.width = 1; c.height = 1;
            }
            const kei = (Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : []).some((item) => String(item?.data || "").startsWith("K/"));
            if (numericTuple(raw, kei)) break;
          }
        } finally {
          source.width = 1; source.height = 1;
          await worker.terminate().catch(() => {});
        }
        if (dead || id !== token) return;
        const kei = (Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : []).some((item) => String(item?.data || "").startsWith("K/"));
        const tuple = numericTuple(raw, kei);
        const numericPatch = {};
        if (tuple) {
          if (!fieldValue("車両重量kg")) numericPatch.vehicleWeightKg = String(tuple.weight);
          if (!fieldValue("車両総重量kg")) numericPatch.grossVehicleWeightKg = String(tuple.gross);
          if (!fieldValue("長さcm")) numericPatch.lengthCm = String(tuple.length);
          if (!fieldValue("幅cm")) numericPatch.widthCm = String(tuple.width);
          if (!fieldValue("高さcm")) numericPatch.heightCm = String(tuple.height);
        }
        sendPatch(numericPatch);
        showStatus(`写真補完: 分断補正 ${Object.keys(patch).length}項目 / 数値OCR ${passes}pass / ${tuple ? "重量・寸法取得" : "数値候補なし"}`);
      })().catch((e) => {
        if (!dead && id === token) showStatus(`写真補完エラー: ${e?.message || e}`);
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
