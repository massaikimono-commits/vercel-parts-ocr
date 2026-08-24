"use client";

import { useEffect } from "react";
import { prepareDocumentImage } from "./lib/document-image-pipeline";

const AUTH_EVENT = "vehicle-certificate-authoritative";

const PLATE_AREAS = [
  "札幌","函館","旭川","室蘭","釧路","帯広","北見","青森","弘前","八戸","岩手","盛岡","平泉","宮城","仙台","秋田","山形","庄内","福島","会津","郡山",
  "水戸","土浦","つくば","宇都宮","那須","とちぎ","群馬","前橋","高崎","大宮","所沢","熊谷","春日部","川越","越谷","川口",
  "千葉","習志野","袖ヶ浦","野田","成田","柏","松戸","市川","船橋","市原","品川","練馬","足立","八王子","多摩","世田谷","杉並","板橋","江東","葛飾",
  "横浜","川崎","湘南","相模","山梨","新潟","長岡","上越","富山","石川","金沢","福井","長野","松本","諏訪","岐阜","飛騨","静岡","浜松","沼津","伊豆","富士山",
  "名古屋","尾張小牧","三河","豊橋","岡崎","豊田","春日井","三重","鈴鹿","伊勢志摩","四日市","滋賀","京都","大阪","なにわ","和泉","堺","神戸","姫路","奈良","飛鳥","和歌山",
  "鳥取","島根","岡山","倉敷","広島","福山","山口","下関","徳島","香川","高松","愛媛","高知","福岡","北九州","久留米","筑豊","佐賀","長崎","佐世保","熊本","大分","宮崎","鹿児島","奄美","沖縄",
].sort((a, b) => b.length - a.length);

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\u3000/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function digitText(value = "") {
  return String(value)
    .replace(/[OoQqＤＤ]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[^0-9]/g, "");
}

function bestArea(value = "") {
  const text = norm(value).replace(/\s+/g, "");
  for (const area of PLATE_AREAS) if (text.includes(area)) return area;
  return "";
}

function parseRegistration(raw = "") {
  const text = norm(raw);
  const patterns = [
    /([一-龠ぁ-んァ-ヶ]{1,16})\s*([0-9OoQqIl|!]{2,3})\s*([ぁ-ん])\s*[・･.\- ]*([0-9OoQqIl|!]{1,4})/g,
    /([一-龠ぁ-んァ-ヶ]{1,16})\s*([0-9OoQqIl|!](?:\s*[0-9OoQqIl|!]){1,2})\s*([ぁ-ん])\s*([0-9OoQqIl|!](?:\s*[0-9OoQqIl|!]){0,3})/g,
  ];
  const out = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const area = bestArea(m[1] || "");
      const cls = digitText(m[2] || "");
      const kana = m[3] || "";
      const serial = digitText(m[4] || "");
      if (!area || cls.length !== 3 || !kana || serial.length < 1 || serial.length > 4) continue;
      out.push(`${area} ${cls} ${kana} ${serial}`);
    }
  }
  return out[out.length - 1] || "";
}

function modelFamily(value = "") {
  const text = norm(value).toUpperCase().replace(/\s+/g, "");
  const tail = text.includes("-") ? text.split("-").pop() || "" : text;
  return /^[A-Z0-9]{3,8}$/.test(tail) && /[A-Z]/.test(tail) && /\d/.test(tail) ? tail : "";
}

function detailInput(labelText) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (title !== norm(labelText)) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function currentModelFamily() {
  return modelFamily(detailInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "");
}

function chassisCandidates(raw = "", family = "") {
  const text = norm(raw).toUpperCase().replace(/[‐‑‒–—―ー]/g, "-");
  const compact = text.replace(/\s+/g, "");
  const out = [];

  const vin = compact.match(/(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?:$|[^A-Z0-9])/)?.[1] ||
    (/^[A-HJ-NPR-Z0-9]{17}$/.test(compact) ? compact : "");
  if (vin) out.push(vin);

  for (const m of compact.matchAll(/([A-Z0-9]{3,8})-?([0-9OQI|]{5,9})/g)) {
    const prefix = (m[1] || "").replace(/O(?=\d)|(?<=\d)O/g, "0");
    const suffix = (m[2] || "").replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
    if (!/[A-Z]/.test(prefix) || !/\d/.test(prefix) || !/^\d{5,9}$/.test(suffix)) continue;
    if (family && prefix !== family) continue;
    out.push(`${prefix}-${suffix}`);
  }

  if (family) {
    for (const m of compact.matchAll(/(?:^|[^0-9OQI|])([0-9OQI|]{5,9})(?:$|[^0-9OQI|])/g)) {
      const suffix = (m[1] || "").replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
      if (/^\d{5,9}$/.test(suffix)) out.push(`${family}-${suffix}`);
    }
  }

  return [...new Set(out)];
}

function chooseAgreement(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return "";
  if (ranked[0][1] >= 2) return ranked[0][0];
  return ranked.length === 1 ? ranked[0][0] : "";
}

function crop(source, box, binary = false, targetWidth = 2600) {
  const [x, y, w, h] = box;
  const sx = Math.max(0, Math.round(source.width * x));
  const sy = Math.max(0, Math.round(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(source.width * w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(source.height * h)));
  const scale = Math.max(1, Math.min(10, targetWidth / Math.max(1, sw)));
  const pad = 42;
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
    let count = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      const gray = Math.round(image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08);
      sum += gray;
      count += 1;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = gray;
    }
    const threshold = Math.max(110, Math.min(220, sum / Math.max(1, count) - 16));
    for (let p = 0; p < image.data.length; p += 4) {
      const value = image.data[p] < threshold ? 0 : 255;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = value;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

async function recognize(worker, source, box, whitelist = "") {
  const raws = [];
  for (const binary of [false, true]) {
    const canvas = crop(source, box, binary);
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "7",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_char_whitelist: whitelist,
      });
      const raw = norm((await worker.recognize(canvas)).data.text || "");
      if (raw) raws.push(raw);
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
  return raws;
}

async function readIdentityRows(file, needRegistration, needChassis) {
  const prepared = await prepareDocumentImage(file, { maxSide: 3400, cropPaper: true, minPaperConfidence: 0.46 });
  const source = prepared.normalized;
  const t = await import("tesseract.js");
  const worker = await t.createWorker("jpn+eng", 1);
  const registrationRaw = [];
  const chassisRaw = [];
  const registrationValues = [];
  const chassisValues = [];
  const family = currentModelFamily();

  try {
    if (needRegistration) {
      for (const box of [
        [0.18, 0.166, 0.48, 0.050],
        [0.21, 0.178, 0.42, 0.040],
        [0.16, 0.158, 0.54, 0.065],
      ]) {
        const raws = await recognize(worker, source, box, "");
        registrationRaw.push(...raws);
        for (const raw of raws) {
          const value = parseRegistration(raw);
          if (value) registrationValues.push(value);
        }
      }
    }

    if (needChassis) {
      for (const box of [
        [0.10, 0.198, 0.48, 0.052],
        [0.13, 0.210, 0.40, 0.040],
        [0.08, 0.190, 0.54, 0.068],
      ]) {
        const raws = await recognize(worker, source, box, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
        chassisRaw.push(...raws);
        for (const raw of raws) chassisValues.push(...chassisCandidates(raw, family));
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  return {
    registrationNumber: chooseAgreement(registrationValues),
    chassisNumber: chooseAgreement(chassisValues),
    family,
    registrationRaw,
    chassisRaw,
    registrationValues,
    chassisValues,
  };
}

function showDebug(result, state) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  );
  if (!card) return;
  let box = document.getElementById("certificate-identity-ocr-fallback-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-identity-ocr-fallback-debug";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">登録番号・車台番号 2行OCR（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    card.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (!pre) return;
  pre.textContent = [
    `状態: ${state}`,
    `型式車系: ${result?.family || "未取得"}`,
    `登録番号 採用: ${result?.registrationNumber || "保留"}`,
    `車台番号 採用: ${result?.chassisNumber || "保留"}`,
    "",
    `登録番号候補: ${(result?.registrationValues || []).join(" / ") || "なし"}`,
    ...(result?.registrationRaw || []).map((x) => `登録OCR: ${x}`),
    "",
    `車台番号候補: ${(result?.chassisValues || []).join(" / ") || "なし"}`,
    ...(result?.chassisRaw || []).map((x) => `車台OCR: ${x}`),
  ].join("\n");
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

export default function CertificateIdentityOcrFallback() {
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
      if (document.querySelector(".progress")) {
        sawProgress = true;
        return;
      }

      const elapsed = Date.now() - startedAt;
      if (sawProgress && elapsed < 14000) return;
      if (!sawProgress && elapsed < 24000) return;

      const qr = window.__vehicleCertificateQrPriority || {};
      const currentRegistration = detailInput("自動車登録番号又は車両番号")?.value || "";
      const currentChassis = detailInput("車台番号")?.value || "";
      const needRegistration = !qr.registrationNumber && !parseRegistration(currentRegistration);
      const needChassis = !qr.chassisNumber && !chassisCandidates(currentChassis, currentModelFamily()).length;

      if (!needRegistration && !needChassis) {
        pending = null;
        showDebug({ family: currentModelFamily(), registrationNumber: currentRegistration, chassisNumber: currentChassis }, "QR/既存値で確定済み。2行OCR省略");
        return;
      }

      const file = pending;
      const myToken = token;
      pending = null;
      running = true;
      showDebug({ family: currentModelFamily() }, `不足行だけOCR中（登録=${needRegistration ? "yes" : "no"} / 車台=${needChassis ? "yes" : "no"}）`);
      try {
        const result = await readIdentityRows(file, needRegistration, needChassis);
        if (myToken !== token) return;
        const patch = {};
        if (needRegistration && result.registrationNumber) patch.registrationNumber = result.registrationNumber;
        if (needChassis && result.chassisNumber) patch.chassisNumber = result.chassisNumber;
        if (Object.keys(patch).length) {
          window.__vehicleCertificateIdentityOcrPatch = patch;
          for (let i = 0; i < 5; i += 1) {
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
            await new Promise((resolve) => window.setTimeout(resolve, 550));
          }
        }
        showDebug(result, Object.keys(patch).length ? "本体stateへ確定送信" : "一致候補なし。安全のため空欄維持");
      } catch (error) {
        showDebug({ family: currentModelFamily(), registrationRaw: [String(error?.message || error)] }, "2行OCRエラー");
      } finally {
        running = false;
      }
    }, 800);

    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
