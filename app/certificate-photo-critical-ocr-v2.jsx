"use client";

import { useEffect } from "react";
import { parseRegistrationNumber } from "./lib/registration-number";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(v = "") {
  return String(v || "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
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
  const t = norm(text)
    .replace(/今和|合和|令乱|信和|伶和/g, "令和")
    .replace(/平[或戊陰]/g, "平成");
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
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

const MAKERS = ["日野","トヨタ","レクサス","日産","ニッサン","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","BMW","アウディ","ボルボ"];
const BODY_TYPES = ["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","トラック","ダンプ","セダン","箱型","バン","バス","幌型"];

function pickKnown(text, values) {
  const t = compact(text);
  return values.find((v) => t.includes(compact(v))) || "";
}

function seatingCandidate(text) {
  const t = norm(text);
  const near = t.match(/乗車定員[\s\S]{0,45}?(\d{1,2})\s*人/);
  if (near) return String(Number(near[1]));
  const vals = [...t.matchAll(/(?:^|\s)(\d{1,2})\s*人(?:\s|$)/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 80);
  const unique = [...new Set(vals)];
  return unique.length === 1 ? String(unique[0]) : "";
}

function payloadCandidate(text, purposeValue = "") {
  if (compact(purposeValue) === "乗用") return "-";
  const t = norm(text);
  const near = t.match(/最大積載量[\s\S]{0,55}?(-|\d{1,5})\s*(?:kg)?/i);
  if (!near) return "";
  if (near[1] === "-") return "-";
  const n = Number(near[1]);
  return n >= 0 && n <= 30000 ? String(n) : "";
}

function outputCandidate(text) {
  const t = norm(text);
  const near = t.match(/(?:総排気量又は定格出力|総排気量|定格出力)[\s\S]{0,65}?(\d+(?:[.,]\d+)?)\s*(L|l|kW|KW|kw)/);
  const hit = near || t.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(L|l|kW|KW|kw)(?:\s|$)/);
  if (!hit) return "";
  const n = Number(String(hit[1]).replace(",", "."));
  const unit = String(hit[2]).toLowerCase() === "l" ? "L" : "kW";
  if (!Number.isFinite(n) || n <= 0) return "";
  if (unit === "L" && n > 20) return "";
  if (unit === "kW" && n > 1500) return "";
  return `${String(n)} ${unit}`;
}

function profilePatch(text) {
  const purposeValue = pickKnown(text, ["貨物","乗用","乗合","特種"]);
  const patch = {};
  const put = (key, value) => { if (value) patch[key] = value; };
  put("vehicleName", pickKnown(text, MAKERS));
  put("vehicleClass", pickKnown(text, ["普通","小型","軽自動車","大型特殊"]));
  put("purpose", purposeValue);
  put("privateBusiness", pickKnown(text, ["自家用","事業用"]));
  put("bodyShape", pickKnown(text, BODY_TYPES));
  put("seatingCapacity", seatingCandidate(text));
  put("maxPayloadKg", payloadCandidate(text, purposeValue));
  put("fuel", pickKnown(text, ["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]));
  put("displacementOrRatedOutput", outputCandidate(text));
  return patch;
}

function modelFamily(model = "") {
  const t = compact(model).toUpperCase();
  return (t.split("-").pop() || t).replace(/[^A-Z0-9]/g, "");
}

function engineCandidate(text, model, chassis) {
  const fam = modelFamily(model);
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

function chassisCandidate(text, model) {
  const fam = modelFamily(model);
  const t = compact(text).toUpperCase().replace(/[‐‑‒–—―]/g, "-");
  const candidates = t.match(/[A-Z0-9]{3,9}-[0-9OQI|]{5,9}/g) || [];
  let best = "";
  let score = -1;
  for (const raw of candidates) {
    const [left0, right0] = raw.split("-");
    let left = left0;
    const right = String(right0 || "").replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
    if (!/^\d{5,9}$/.test(right)) continue;
    let s = 1;
    if (fam) {
      if (left === fam) s += 15;
      else if (fam.endsWith(left) && fam.length - left.length <= 2) { left = fam; s += 12; }
      else if (fam.startsWith(left) && fam.length - left.length <= 2) s += 7;
    }
    if (s > score) { score = s; best = `${left}-${right}`; }
  }
  return best;
}

function send(patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!Object.keys(clean).length) return;
  window.__vehicleCertificatePhotoPriority = { ...(window.__vehicleCertificatePhotoPriority || {}), ...clean };
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
    const scale = Math.min(1, 4000 / Math.max(iw, ih));
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

function crop(source, x0, y0, w0, h0, binary = false, target = 2800) {
  const sx = Math.round(source.width * x0), sy = Math.round(source.height * y0);
  const sw = Math.max(1, Math.round(source.width * w0)), sh = Math.max(1, Math.round(source.height * h0));
  const scale = Math.max(1, Math.min(8, target / Math.max(1, sw)));
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
    const v = binary ? (g < th ? 0 : 255) : Math.max(0, Math.min(255, Math.round((g - 128) * 1.85 + 154)));
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
        // QR重点補完の反映も少し待つ。
        await new Promise((resolve) => setTimeout(resolve, 900));

        const qrPriority = window.__vehicleCertificateQrPriority || {};
        const needTopRight = !fieldValue("記録年月日") || !fieldValue("記録事項番号");
        const needEngine = !fieldValue("原動機の型式") && !window.__vehicleCertificatePhotoPriority?.engineModel && !qrPriority.engineModel;
        // QRを検出しただけでは不足OCRを止めない。実際に解析できた値がある時だけQRを優先する。
        const needReg = !fieldValue("自動車登録番号又は車両番号") && !qrPriority.registrationNumber;
        const currentChassis = fieldValue("車台番号");
        const model = fieldValue("型式") || window.__vehicleCertificatePhotoPriority?.model || qrPriority.model || "";
        const fam = modelFamily(model);
        const currentPrefix = compact(currentChassis).toUpperCase().split("-")[0] || "";
        const needChassis = !qrPriority.chassisNumber && (!currentChassis || (fam && currentPrefix && currentPrefix !== fam));
        const profileLabels = [
          "車名","自動車の種別","用途","自家用・事業用の別","車体の形状","乗車定員","最大積載量 kg","燃料の種類"
        ];
        const needProfile = profileLabels.some((label) => !fieldValue(label));
        const needOutput = !fieldValue("総排気量又は定格出力");

        if (!needTopRight && !needEngine && !needReg && !needChassis && !needProfile && !needOutput) {
          showStatus("重要欄補完v3: QR/OCRで取得済みのため追加OCRなし");
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
            for (const binary of [false, true]) {
              passes += 1;
              const c = crop(source, .55, .085, .42, .13, binary, 3000);
              try {
                const raw = await recognize(worker, c, sparse);
                logs.push(`右上${binary ? "白黒" : "灰"}=${raw}`);
                if (!patch.recordDate && !fieldValue("記録年月日")) {
                  const d = jpDate(raw);
                  if (d) patch.recordDate = d;
                }
                if (!patch.documentNumber && !fieldValue("記録事項番号")) {
                  const n = docNumber(raw);
                  if (n) patch.documentNumber = n;
                }
                if ((!needTopRight || patch.recordDate) && (fieldValue("記録事項番号") || patch.documentNumber)) break;
              } finally { c.width = 1; c.height = 1; }
            }
          }

          if (needEngine) {
            for (const binary of [false, true]) {
              passes += 1;
              const c = crop(source, .40, .405, .57, .115, binary, 3200);
              try {
                const raw = await recognize(worker, c, sparse, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
                logs.push(`原動機${binary ? "白黒" : "灰"}=${raw}`);
                const engine = engineCandidate(raw, model, fieldValue("車台番号"));
                if (engine) { patch.engineModel = engine; break; }
              } finally { c.width = 1; c.height = 1; }
            }
          }

          // QRで埋まらなかった車両プロフィールだけを、重なりを変えた2パスで狙い撃ち。
          // 固定辞書・単位・範囲で検証し、自由文字の推測値は採用しない。
          if (needProfile || needOutput) {
            const foundByKey = {};
            for (const [y, h, binary] of [[.345, .225, false], [.315, .285, true]]) {
              passes += 1;
              const c = crop(source, .045, y, .91, h, binary, 3400);
              try {
                const raw = await recognize(worker, c, sparse);
                logs.push(`不足プロフィール${binary ? "白黒" : "灰"}@${y}=${raw}`);
                const candidate = profilePatch(raw);
                for (const [key, value] of Object.entries(candidate)) {
                  if (!value) continue;
                  if (!foundByKey[key]) foundByKey[key] = [];
                  foundByKey[key].push(value);
                }
              } finally { c.width = 1; c.height = 1; }
            }

            const labelByKey = {
              vehicleName:"車名",
              vehicleClass:"自動車の種別",
              purpose:"用途",
              privateBusiness:"自家用・事業用の別",
              bodyShape:"車体の形状",
              seatingCapacity:"乗車定員",
              maxPayloadKg:"最大積載量 kg",
              fuel:"燃料の種類",
              displacementOrRatedOutput:"総排気量又は定格出力",
            };
            for (const [key, values] of Object.entries(foundByKey)) {
              const unique = [...new Set(values)];
              const label = labelByKey[key];
              if (!label || fieldValue(label)) continue;
              // 2パス一致を最優先。固定カテゴリは1パスでも安全に採用、
              // 数値は2パス一致した時だけ採用する。
              const categorical = ["vehicleName","vehicleClass","purpose","privateBusiness","bodyShape","fuel"].includes(key);
              if (unique.length === 1 && (categorical || values.length >= 2)) patch[key] = unique[0];
            }
          }

          if (needReg) {
            const candidates = [];
            for (const [y, binary] of [[.165, false], [.180, true]]) {
              passes += 1;
              const c = crop(source, .075, y, .77, .075, binary, 3300);
              try {
                const raw = await recognize(worker, c, line);
                logs.push(`登録${binary ? "白黒" : "灰"}@${y}=${raw}`);
                const parsed = parseRegistrationNumber(raw);
                if (parsed?.canonical) candidates.push(parsed.canonical);
              } finally { c.width = 1; c.height = 1; }
            }
            const unique = [...new Set(candidates)];
            if (unique.length === 1) patch.registrationNumber = unique[0];
          }

          if (needChassis) {
            const candidates = [];
            for (const [y, binary] of [[.215, false], [.230, true]]) {
              passes += 1;
              const c = crop(source, .075, y, .78, .075, binary, 3300);
              try {
                const raw = await recognize(worker, c, line, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
                logs.push(`車台${binary ? "白黒" : "灰"}@${y}=${raw}`);
                const value = chassisCandidate(raw, model);
                if (value) candidates.push(value);
              } finally { c.width = 1; c.height = 1; }
            }
            const unique = [...new Set(candidates)];
            if (unique.length === 1) patch.chassisNumber = unique[0];
          }
        } finally {
          source.width = 1;
          source.height = 1;
          await worker.terminate().catch(() => {});
        }

        if (dead || id !== token) return;
        send(patch);
        showStatus(`重要欄補完v3: ${Object.keys(patch).length}項目 / ${passes}pass${logs.length ? ` / ${logs.join(" | ").slice(0, 260)}` : ""}`);
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
