"use client";

import { useEffect, useRef, useState } from "react";
import { fileToCanvas, detectLikelyPaperBounds, cropCanvas } from "./lib/document-image-pipeline";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(s = "") {
  return String(s).normalize("NFKC").replace(/[‐‑‒–—―ー]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}
function digits(s = "") { return s.replace(/\D/g, ""); }
function jpDate(s = "") {
  const t = norm(s);
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const mm = Number(m[3]), dd = Number(m[4]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${mm}月${dd}日`;
}
function docNo(s = "") {
  return digits(norm(s)).match(/\d{10,14}/)?.[0] || "";
}
function reg(s = "") {
  const t = norm(s).replace(/\n/g, " ");
  const matches = [...t.matchAll(/([ぁ-んァ-ヶ一-龠]{1,7})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/g)];
  if (!matches.length) return "";
  const bad = /(株式会社|住所|使用者|大阪府.{0,3}市|静岡県.{0,3}市|東京都.{0,3}区)/;
  const cleaned = matches.map(m => ({
    place: m[1].replace(/^(?:東京都|北海道|大阪府|京都府|.{2,4}県)/, ""),
    cls: digits(m[2]), kana: m[3], num: digits(m[4]), raw: m[1]
  })).filter(x => !bad.test(x.raw) && x.cls.length === 3 && x.num.length === 4);
  const best = cleaned[0] || null;
  if (!best) return "";
  const place = best.place || best.raw;
  return `${place} ${best.cls} ${best.kana} ${best.num}`;
}
function chassis(s = "") {
  const t = norm(s).toUpperCase().replace(/\s+/g, "");
  const a = t.match(/[A-Z]{1,5}[0-9]{1,6}-[A-Z0-9]{4,12}/g) || [];
  return a.sort((x, y) => y.length - x.length)[0] || "";
}
function engine(s = "") {
  const t = norm(s).toUpperCase().replace(/\s+/g, "");
  const a = t.match(/[A-Z0-9]{2,8}(?:-[A-Z0-9]{2,8})?/g) || [];
  return a.filter(x => /[A-Z]/.test(x) && /\d/.test(x) && x.length >= 3).sort((x, y) => y.length - x.length)[0] || "";
}
function integer(s = "", min = 0, max = 99999) {
  const a = norm(s).replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/,/g, "").match(/\d{1,6}/g) || [];
  for (const x of a) { const n = Number(x); if (n >= min && n <= max) return String(n); }
  return "";
}
function maker(s = "") {
  const t = norm(s).replace(/\s+/g, "");
  return ["トヨタ","レクサス","日産","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","日野","UDトラックス","BMW","アウディ","ボルボ"].find(v => t.includes(v)) || "";
}
function mode(values) {
  const m = new Map();
  for (const v of values.filter(Boolean)) m.set(v, (m.get(v) || 0) + 1);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return { value: "", agree: 0 };
  return { value: sorted[0][0], agree: sorted[0][1] };
}
function makeCrop(src, box, style) {
  const [x, y, w, h] = box;
  const sx = Math.max(0, Math.round(src.width * x));
  const sy = Math.max(0, Math.round(src.height * y));
  const sw = Math.max(1, Math.round(src.width * w));
  const sh = Math.max(1, Math.round(src.height * h));
  const scale = Math.max(1, Math.min(6, 1700 / sw));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (style === "original") return c;
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const data = im.data; let sum = 0; const gray = new Uint8Array(c.width * c.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = Math.round(data[i] * .22 + data[i + 1] * .70 + data[i + 2] * .08); gray[p] = g; sum += g;
  }
  const mean = sum / gray.length;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = gray[p];
    const v = style === "binary" ? (g < Math.max(105, Math.min(205, mean - 18)) ? 0 : 255) : Math.max(0, Math.min(255, Math.round((g - 128) * 1.65 + 150)));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0); return c;
}
async function rec(worker, src, box, parser, whitelist = "") {
  const out = [];
  for (const style of ["original", "contrast", "binary"]) {
    const c = makeCrop(src, box, style);
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: "7", user_defined_dpi: "300", tessedit_char_whitelist: whitelist });
    const raw = norm((await worker.recognize(c)).data.text || "");
    out.push({ style, raw, value: parser(raw) });
  }
  const picked = mode(out.map(x => x.value));
  return { ...picked, raw: out };
}

export default function CertificateAdaptiveOcr() {
  const [debug, setDebug] = useState(null);
  const runId = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer = 0;
    const onChange = (e) => {
      if (!location.pathname.includes("vehicle-workflow")) return;
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++runId.current;
      setDebug({ status: "既存OCR終了待ち", patch: {}, bounds: "-", rows: [] });
      clearTimeout(timer);
      const started = Date.now();
      const wait = () => {
        if (id !== runId.current) return;
        const txt = document.body?.innerText || "";
        const ready = txt.includes("OCR詳細（確認用）") || txt.includes("QRから本体stateへ反映") || Date.now() - started > 45000;
        if (ready) timer = window.setTimeout(() => run(file, id), 1200);
        else timer = window.setTimeout(wait, 1000);
      };
      timer = window.setTimeout(wait, 1500);
    };

    const run = async (file, id) => {
      if (id !== runId.current) return;
      let worker = null;
      try {
        setDebug({ status: "用紙正規化中", patch: {}, bounds: "-", rows: [] });
        const source = await fileToCanvas(file, 2800);
        const b = detectLikelyPaperBounds(source);
        const normalized = b && b.confidence >= .44 ? cropCanvas(source, b) : source;
        const boundsText = b ? `x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.width)} h=${Math.round(b.height)} conf=${b.confidence.toFixed(2)}` : "検出なし（原画像）";
        const t = await import("tesseract.js");
        worker = await t.createWorker("jpn+eng", 1);
        const defs = [
          ["recordDate", [0.65,0.090,0.25,0.032], jpDate, ""],
          ["documentNumber", [0.70,0.137,0.20,0.030], docNo, "0123456789"],
          ["registrationNumber", [0.20,0.180,0.40,0.036], reg, ""],
          ["chassisNumber", [0.10,0.210,0.42,0.036], chassis, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"],
          ["registrationDate", [0.15,0.238,0.28,0.040], jpDate, ""],
          ["vehicleName", [0.08,0.410,0.24,0.034], maker, ""],
          ["engineModel", [0.45,0.438,0.23,0.038], engine, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"],
          ["vehicleWeightKg", [0.10,0.515,0.16,0.034], s => integer(s, 100, 99999), "0123456789kgKG"],
          ["grossVehicleWeightKg", [0.31,0.515,0.18,0.034], s => integer(s, 100, 99999), "0123456789kgKG"],
          ["lengthCm", [0.48,0.515,0.11,0.034], s => integer(s, 50, 3000), "0123456789cmCM"],
          ["widthCm", [0.60,0.515,0.11,0.034], s => integer(s, 50, 1000), "0123456789cmCM"],
          ["heightCm", [0.73,0.515,0.11,0.034], s => integer(s, 50, 1000), "0123456789cmCM"],
        ];
        const patch = {}; const rows = [];
        for (let i = 0; i < defs.length; i++) {
          if (id !== runId.current) return;
          const [key, box, parser, wl] = defs[i];
          setDebug({ status: `共通補正OCR ${i+1}/${defs.length}`, patch: { ...patch }, bounds: boundsText, rows: [...rows] });
          const r = await rec(worker, normalized, box, parser, wl);
          rows.push(`${key}: ${r.raw.map(x => `${x.style}=${x.value || "-"}`).join(" / ")}`);
          if (r.value && r.agree >= 2) patch[key] = r.value;
        }
        if (Object.keys(patch).length) {
          window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
          window.__vehicleAdaptiveOcrPatch = patch;
        }
        setDebug({ status: "共通画像補正OCR 完了", patch, bounds: boundsText, rows });
      } catch (e) {
        setDebug({ status: `共通画像補正OCRエラー: ${e?.message || e}`, patch: {}, bounds: "-", rows: [] });
      } finally {
        try { await worker?.terminate?.(); } catch {}
      }
    };

    document.addEventListener("change", onChange, true);
    return () => { document.removeEventListener("change", onChange, true); clearTimeout(timer); runId.current++; };
  }, []);

  if (!debug || typeof window === "undefined" || !location.pathname.includes("vehicle-workflow")) return null;
  return <details style={{margin:"12px auto",maxWidth:760,padding:12,border:"1px solid #cbd5e1",borderRadius:14,background:"#f8fafc"}}>
    <summary style={{fontWeight:800,cursor:"pointer"}}>共通画像補正OCR（確認用）</summary>
    <div style={{marginTop:10,fontSize:14,lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
      <div>状態: {debug.status}</div>
      <div>用紙: {debug.bounds}</div>
      <div>採用: {Object.entries(debug.patch || {}).map(([k,v]) => `${k}=${v}`).join(" / ") || "まだなし"}</div>
      {debug.rows?.length ? <details style={{marginTop:8}}><summary>候補詳細</summary><div>{debug.rows.join("\n")}</div></details> : null}
    </div>
  </details>;
}
