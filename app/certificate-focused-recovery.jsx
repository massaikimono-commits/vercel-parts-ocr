"use client";

import { useEffect, useRef, useState } from "react";
import { prepareDocumentImage } from "./lib/document-image-pipeline";
import { decideRecognitionField, deskewDocument } from "./lib/document-recognition-engine";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(value = "") {
  return norm(value).replace(/\s+/g, "");
}

function eraYear(era, year) {
  const y = year === "元" ? 1 : Number(year);
  return era === "令和" ? 2018 + y : era === "平成" ? 1988 + y : era === "昭和" ? 1925 + y : 0;
}

function monthOrdinal(value = "") {
  const m = compact(value).match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?/);
  if (!m) return null;
  const year = eraYear(m[1], m[2]);
  const month = Number(m[3]);
  return year && month >= 1 && month <= 12 ? year * 12 + month : null;
}

function dateOrdinal(value = "") {
  const m = compact(value).match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);
  if (!m) return null;
  const year = eraYear(m[1], m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year * 10000 + month * 100 + day;
}

function canonicalDate(era, year, month, day) {
  return `${era}${year === "元" ? "元" : Number(year)}年${Number(month)}月${Number(day)}日`;
}

function datesInText(value = "") {
  const text = norm(value);
  const out = [];
  const re = /(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/g;
  for (const m of text.matchAll(re)) {
    const month = Number(m[3]);
    const day = Number(m[4]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push(canonicalDate(m[1], m[2], month, day));
  }
  return out;
}

function plausibleDate(value, first, expiry) {
  const date = dateOrdinal(value);
  if (!date) return false;
  const firstMonth = monthOrdinal(first);
  const expiryDate = dateOrdinal(expiry);
  if (firstMonth) {
    const year = Math.floor(date / 10000);
    const month = Math.floor((date % 10000) / 100);
    if (year * 12 + month < firstMonth) return false;
  }
  if (expiryDate && date > expiryDate) return false;
  return true;
}

function modelFamily(model = "") {
  const text = compact(model).toUpperCase();
  return (text.split("-").pop() || text).replace(/[^A-Z0-9]/g, "");
}

function similarity(a = "", b = "") {
  const x = String(a).toUpperCase();
  const y = String(b).toUpperCase();
  if (!x || !y) return 0;
  let same = 0;
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] === y[i]) same++;
  return same / Math.max(x.length, y.length);
}

function repairNumericSlots(value = "") {
  return String(value)
    .replace(/[Ｏｏ]/g, "O")
    .replace(/[Ｉｌ|]/g, "I")
    .toUpperCase();
}

function normalizeEngine(value = "") {
  const raw = repairNumericSlots(value).replace(/\s+/g, "").replace(/-+/g, "-");
  const parts = raw.split("-");
  if (parts.length !== 2) return raw;
  let [left, right] = parts;

  if (/^[A-Z][O0Q][0-9OQ][A-Z]$/.test(left)) {
    left = `${left[0]}${/[OQ]/.test(left[1]) ? "0" : left[1]}${/[OQ]/.test(left[2]) ? "0" : left[2]}${left[3]}`;
  }
  left = left.replace(/O(?=\d)|(?<=\d)O/g, "0").replace(/I(?=\d)|(?<=\d)I/g, "1");

  if (/^[A-Z]{2}[0OQ][S5][A-Z]$/.test(right)) {
    right = `${right.slice(0, 2)}0${right[3] === "S" ? "5" : right[3]}${right[4]}`;
  } else if (/^[A-Z]{2}\dS[A-Z]$/.test(right)) {
    right = `${right.slice(0, 3)}5${right.slice(4)}`;
  }
  right = right.replace(/O(?=\d)|(?<=\d)O/g, "0").replace(/I(?=\d)|(?<=\d)I/g, "1");
  return `${left}-${right}`;
}

function lines(value = "") {
  return norm(value).split("\n").map(x => x.trim()).filter(Boolean);
}

function neighborhood(all, index, before = 1, after = 2) {
  return all.slice(Math.max(0, index - before), Math.min(all.length, index + after + 1)).join(" ");
}

function findChassisCandidates(text = "", model = "") {
  const all = lines(text);
  const family = modelFamily(model);
  const out = [];

  for (let i = 0; i < all.length; i++) {
    const around = neighborhood(all, i, 1, 2);
    const upper = repairNumericSlots(around).replace(/[‐‑‒–—―ー]/g, "-");
    const direct = upper.match(/[A-Z0-9]{3,8}\s*[- ]\s*[0-9OQ]{5,9}/g) || [];
    for (const raw of direct) {
      const joined = raw.replace(/\s+/g, "-").replace(/-+/g, "-");
      const [leftRaw, rightRaw] = joined.split("-");
      const left = leftRaw.replace(/O(?=\d)|(?<=\d)O/g, "0");
      const right = rightRaw.replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
      if (!/^\d{5,9}$/.test(right)) continue;
      let confidence = /車台番号/.test(around) ? 0.94 : 0.70;
      if (family && similarity(left, family) >= 0.72) confidence = Math.max(confidence, 0.96);
      out.push({ value: `${left}-${right}`, source: "cell", confidence, region: "focused-upper", raw: around });
    }

    if (family) {
      const compactUpper = upper.replace(/\s+/g, "");
      const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = compactUpper.match(new RegExp(`${escaped}[-]?([0-9OQI|]{5,9})`));
      if (m) {
        const right = m[1].replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
        out.push({ value: `${family}-${right}`, source: "derived", confidence: /車台番号/.test(around) ? 0.98 : 0.88, region: "model-family", raw: around });
      } else if (/車台番号/.test(around)) {
        const suffix = compactUpper.match(/(?:車台番号)?[^0-9]{0,12}([0-9OQI|]{5,9})/);
        if (suffix) {
          const right = suffix[1].replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
          out.push({ value: `${family}-${right}`, source: "derived", confidence: 0.90, region: "label+model-family", raw: around });
        }
      }
    }
  }
  return out;
}

function findRegistrationDateCandidates(text = "", first = "", expiry = "") {
  const all = lines(text);
  const out = [];
  for (let i = 0; i < all.length; i++) {
    if (!/交付年月日|登録年月日/.test(all[i])) continue;
    if (/記録年月日/.test(all[i])) continue;
    const around = neighborhood(all, i, 0, 3);
    for (const value of datesInText(around)) {
      if (!plausibleDate(value, first, expiry)) continue;
      if (compact(value) === compact(expiry)) continue;
      const sameMonth = first && monthOrdinal(value) === monthOrdinal(first);
      out.push({ value, source: "cell", confidence: sameMonth ? 0.98 : 0.93, region: "date-label", raw: around });
    }
  }
  return out;
}

function findEngineCandidates(text = "", model = "") {
  const all = lines(text);
  const out = [];
  const modelKey = compact(model).toUpperCase();
  for (let i = 0; i < all.length; i++) {
    const around = neighborhood(all, i, 1, 2);
    if (!/原動機|エンジン/.test(around)) continue;
    const upper = repairNumericSlots(around).replace(/\s+/g, "");
    const found = upper.match(/[A-Z0-9]{2,8}-[A-Z0-9]{2,8}/g) || [];
    for (const raw of found) {
      const value = normalizeEngine(raw);
      if (!value || value === modelKey) continue;
      if (/^(?:DAA|DBA|ABA|CBA|EBD|HBD|LDA|TDA|TKG|TPG|QKG|QPG|2RG|2PG|3BA|4BA|5BA|5AA|6AA|7BA|8BA)-/.test(value)) continue;
      if (!/[A-Z]/.test(value) || !/\d/.test(value)) continue;
      out.push({ value, source: "cell", confidence: 0.96, region: "engine-label", raw: around });
    }
  }
  return out;
}

function crop(source, yRatio, heightRatio, targetWidth = 3400) {
  const sy = Math.max(0, Math.floor(source.height * yRatio));
  const sh = Math.min(source.height - sy, Math.floor(source.height * heightRatio));
  const scale = Math.max(1, Math.min(3.2, targetWidth / Math.max(1, source.width)));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, sy, source.width, sh, 0, 0, out.width, out.height);
  return out;
}

function findMainOcrDebug() {
  for (const details of document.querySelectorAll("details")) {
    const summary = details.querySelector(":scope > summary");
    if (!summary?.textContent?.includes("OCR詳細（確認用）")) continue;
    const pre = details.querySelector("pre");
    const text = pre?.textContent || "";
    if (text.includes("【車検証 全体OCR】")) return text;
  }
  return "";
}

export default function CertificateFocusedRecovery() {
  const [debug, setDebug] = useState(null);
  const runId = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer = 0;

    const recover = async (file, id) => {
      if (id !== runId.current) return;
      let worker = null;
      try {
        setDebug({ status: "重点再読取を準備中", patch: {}, detail: [] });
        const prepared = await prepareDocumentImage(file, { maxSide: 3000, cropPaper: true, minPaperConfidence: 0.46 });
        if (id !== runId.current) return;
        const deskewed = deskewDocument(prepared.normalized);
        const upper = crop(deskewed.canvas, 0.02, 0.62, 3400);

        const t = await import("tesseract.js");
        worker = await t.createWorker("jpn+eng", 1);
        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: String(t.PSM?.SPARSE_TEXT ?? "11"),
          user_defined_dpi: "300",
        });
        const result = await worker.recognize(upper);
        const text = norm(result?.data?.text || "");
        if (!text) {
          setDebug({ status: "重点再読取: 文字を取得できませんでした", patch: {}, detail: [] });
          return;
        }

        const qr = window.__vehicleCertificateQrPriority || {};
        const model = qr.model || "";
        const first = qr.firstRegistration || "";
        const expiry = qr.inspectionExpiry || "";
        const patch = {};
        const detail = [`重点OCR文字数: ${text.length}`, `傾き: ${deskewed.angle.toFixed(2)}° / 適用=${deskewed.applied ? "yes" : "no"}`];

        const chassisDecision = decideRecognitionField(findChassisCandidates(text, model), {
          pattern: /^[A-Z0-9]{3,8}-\d{5,9}$/,
          minScore: 56,
          requireAgreement: false,
          score: (value) => modelFamily(model) && similarity(value.split("-")[0], modelFamily(model)) >= 0.72 ? 22 : 0,
        });
        if (chassisDecision.value && !qr.chassisNumber) patch.chassisNumber = chassisDecision.value;
        detail.push(`車台番号: ${chassisDecision.value || "保留"} conf=${chassisDecision.confidence.toFixed(2)} ${chassisDecision.reason}`);

        const dateDecision = decideRecognitionField(findRegistrationDateCandidates(text, first, expiry), {
          minScore: 56,
          requireAgreement: false,
          validate: value => plausibleDate(value, first, expiry),
          score: value => first && monthOrdinal(value) === monthOrdinal(first) ? 18 : 0,
        });
        if (dateDecision.value && !qr.registrationDate) patch.registrationDate = dateDecision.value;
        detail.push(`登録/交付年月日: ${dateDecision.value || "保留"} conf=${dateDecision.confidence.toFixed(2)} ${dateDecision.reason}`);

        const engineDecision = decideRecognitionField(findEngineCandidates(text, model), {
          pattern: /^[A-Z0-9]{2,8}-[A-Z0-9]{2,8}$/,
          minScore: 56,
          requireAgreement: false,
        });
        if (engineDecision.value && !qr.engineModel) patch.engineModel = engineDecision.value;
        detail.push(`原動機型式: ${engineDecision.value || "保留"} conf=${engineDecision.confidence.toFixed(2)} ${engineDecision.reason}`);

        if (Object.keys(patch).length) {
          window.__vehicleFocusedRecoveryPatch = patch;
          window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
        }
        setDebug({ status: "重点再読取 完了", patch, detail });
      } catch (error) {
        console.error("focused certificate recovery", error);
        setDebug({ status: `重点再読取エラー: ${error?.message || error}`, patch: {}, detail: [] });
      } finally {
        if (worker) await worker.terminate().catch(() => {});
      }
    };

    const onChange = (event) => {
      if (!location.pathname.includes("vehicle-workflow")) return;
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++runId.current;
      const previous = findMainOcrDebug();
      const started = Date.now();
      clearTimeout(timer);
      setDebug({ status: "本体OCR完了後に重点再読取します", patch: {}, detail: [] });

      const wait = () => {
        if (id !== runId.current) return;
        const current = findMainOcrDebug();
        if (current && (current !== previous || Date.now() - started > 4000)) {
          void recover(file, id);
          return;
        }
        if (Date.now() - started > 180000) {
          setDebug({ status: "本体OCR待機タイムアウト", patch: {}, detail: [] });
          return;
        }
        timer = window.setTimeout(wait, 700);
      };
      timer = window.setTimeout(wait, 1800);
    };

    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      clearTimeout(timer);
      runId.current += 1;
    };
  }, []);

  if (!debug || typeof window === "undefined" || !location.pathname.includes("vehicle-workflow")) return null;
  return (
    <details open style={{ margin: "12px auto", maxWidth: 760, padding: 12, border: "1px solid #b7d5c5", borderRadius: 14, background: "#f0fdf4" }}>
      <summary style={{ fontWeight: 800, cursor: "pointer" }}>重点再読取エンジン（確認用）</summary>
      <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        <div>状態: {debug.status}</div>
        <div>採用: {Object.entries(debug.patch || {}).map(([k, v]) => `${k}=${v}`).join(" / ") || "まだなし"}</div>
        {debug.detail?.length ? <details open style={{ marginTop: 8 }}><summary>重点照合詳細</summary><div>{debug.detail.join("\n")}</div></details> : null}
      </div>
    </details>
  );
}
