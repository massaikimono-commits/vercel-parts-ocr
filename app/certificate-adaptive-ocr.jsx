"use client";

import { useEffect, useRef, useState } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(s = "") {
  return String(s)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}
function compact(s = "") { return norm(s).replace(/\s+/g, ""); }
function digits(s = "") { return String(s).replace(/\D/g, ""); }
function eraYear(era, year) {
  const y = year === "元" ? 1 : Number(year);
  return era === "令和" ? 2018 + y : era === "平成" ? 1988 + y : era === "昭和" ? 1925 + y : 0;
}
function dateOrdinal(s = "") {
  const m = compact(s).match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);
  if (!m) return null;
  const y = eraYear(m[1], m[2]), mo = Number(m[3]), d = Number(m[4]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y * 10000 + mo * 100 + d;
}
function monthOrdinal(s = "") {
  const m = compact(s).match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?/);
  if (!m) return null;
  const y = eraYear(m[1], m[2]), mo = Number(m[3]);
  return y && mo >= 1 && mo <= 12 ? y * 12 + mo : null;
}
function canonicalDate(era, year, month, day) {
  return `${era}${year === "元" ? "元" : Number(year)}年${Number(month)}月${Number(day)}日`;
}
function datesInLine(line = "") {
  const t = norm(line);
  const re = /(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/g;
  const out = [];
  for (const m of t.matchAll(re)) {
    const mo = Number(m[3]), d = Number(m[4]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(canonicalDate(m[1], m[2], mo, d));
  }
  return out;
}
function plausibleDate(value, first, expiry) {
  const r = dateOrdinal(value), f = monthOrdinal(first), e = dateOrdinal(expiry);
  if (!r) return false;
  if (f) {
    const y = Math.floor(r / 10000), m = Math.floor((r % 10000) / 100);
    if (y * 12 + m < f) return false;
  }
  if (e && r > e) return false;
  return true;
}

function cleanRegistration(text = "") {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  const candidates = [];
  const re = /([一-龠ぁ-んァ-ヶ]{1,9})\s*(\d\s*\d\s*\d)\s*([ぁ-ん])\s*(\d\s*\d\s*\d\s*\d)/g;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    for (const m of line.matchAll(re)) {
      let place = m[1]
        .replace(/^(?:東京都|北海道|大阪府|京都府|.{2,4}県)/, "")
        .replace(/(?:市|区|町|村).*$/, "");
      const cls = digits(m[2]), num = digits(m[4]);
      if (!place || place.length > 4 || cls.length !== 3 || num.length !== 4) continue;
      if (/株式会社|住所|使用者|所有者/.test(line)) continue;
      let score = 4;
      if (lineIndex < Math.max(8, Math.ceil(lines.length * 0.28))) score += 3;
      if (/登録番号|車両番号/.test(line)) score += 8;
      candidates.push({ value: `${place} ${cls} ${m[3]} ${num}`, score, line });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function cleanChassis(text = "") {
  const t = norm(text).toUpperCase().replace(/\s+/g, "").replace(/[‐‑‒–—―ー]/g, "-");
  const found = t.match(/[A-Z]{1,5}[0-9][A-Z0-9]{1,7}-[A-Z0-9]{4,12}/g) || [];
  const fixed = found.map(v => {
    const [a, b] = v.split("-");
    return `${a.replace(/O(?=\d)|(?<=\d)O/g, "0")}-${b.replace(/O/g, "0")}`;
  });
  return fixed.sort((a, b) => b.length - a.length)[0] || "";
}

function engineCandidate(text = "", model = "") {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  const regulatory = /^(?:DAA|DBA|ABA|CBA|EBD|HBD|LDA|TDA|TKG|TPG|QKG|QPG|2RG|2PG|3BA|4BA|5BA|5AA|6AA|7BA|8BA)-/;
  const all = [];
  for (let i = 0; i < lines.length; i++) {
    const u = lines[i].toUpperCase().replace(/\s+/g, "").replace(/O(?=\d)|(?<=\d)O/g, "0");
    const values = u.match(/[A-Z0-9]{2,8}-[A-Z0-9]{2,8}/g) || [];
    for (const v of values) {
      if (v === compact(model).toUpperCase() || regulatory.test(v)) continue;
      if (!/[A-Z]/.test(v) || !/\d/.test(v)) continue;
      let score = 2;
      const around = `${lines[i - 1] || ""} ${lines[i]} ${lines[i + 1] || ""}`;
      if (/原動機|エンジン/.test(around)) score += 10;
      if (v.length >= 7 && v.length <= 13) score += 2;
      all.push({ value: v, score, line: lines[i] });
    }
  }
  return all.sort((a, b) => b.score - a.score)[0] || null;
}

function registrationDateCandidate(text = "", first = "", expiry = "") {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  const expiryCompact = compact(expiry);
  const firstMonth = monthOrdinal(first);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    for (const value of datesInLine(lines[i])) {
      if (expiryCompact && compact(value) === expiryCompact) continue;
      if (!plausibleDate(value, first, expiry)) continue;
      let score = 1;
      const around = `${lines[i - 1] || ""} ${lines[i]} ${lines[i + 1] || ""}`;
      if (/登録年月日|交付年月日/.test(around)) score += 12;
      if (/初度登録/.test(around)) score += 5;
      if (/有効期間/.test(around)) score += 3;
      if (firstMonth) {
        const d = dateOrdinal(value);
        if (d) {
          const y = Math.floor(d / 10000), mo = Math.floor((d % 10000) / 100);
          if (y * 12 + mo === firstMonth) score += 6;
        }
      }
      if (/備考|点検|整備|燃費|騒音|改定|検査/.test(around)) score -= 5;
      out.push({ value, score, line: lines[i] });
    }
  }
  return out.sort((a, b) => b.score - a.score)[0] || null;
}

function numericRowCandidate(text = "") {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    for (let take = 1; take <= 5; take++) {
      const chunk = lines.slice(i, i + take).join(" ")
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/,/g, "");
      const nums = (chunk.match(/\d{2,5}/g) || []).map(Number);
      for (let j = 0; j + 4 < nums.length; j++) {
        const [weight, gross, length, width, height] = nums.slice(j, j + 5);
        if (weight < 100 || weight > 30000) continue;
        if (gross < weight || gross > 50000) continue;
        if (length < 100 || length > 3000) continue;
        if (width < 100 || width > 300) continue;
        if (height < 100 || height > 450) continue;
        let score = 5;
        if (/車両重量|車両総重量/.test(chunk)) score += 6;
        if (/長さ|幅|高さ/.test(chunk)) score += 6;
        const value = {
          vehicleWeightKg: String(weight),
          grossVehicleWeightKg: String(gross),
          lengthCm: String(length),
          widthCm: String(width),
          heightCm: String(height),
        };
        if (!best || score > best.score) best = { value, score, line: chunk };
      }
    }
  }
  return best;
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
function extractGlobal(text = "") {
  const marker = "【車検証 全体OCR】";
  const i = text.indexOf(marker);
  if (i < 0) return "";
  const rest = text.slice(i + marker.length);
  const j = rest.indexOf("【QR最終確定】");
  return (j >= 0 ? rest.slice(0, j) : rest).trim();
}

export default function CertificateAdaptiveOcr() {
  const [debug, setDebug] = useState(null);
  const runId = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer = 0;

    const onChange = (event) => {
      if (!location.pathname.includes("vehicle-workflow")) return;
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++runId.current;
      setDebug({ status: "本体の全体OCR待ち", patch: {}, rows: [] });
      const started = Date.now();
      clearTimeout(timer);

      const wait = () => {
        if (id !== runId.current) return;
        const source = findMainOcrDebug();
        if (source) {
          timer = window.setTimeout(() => run(source, id), 250);
          return;
        }
        const elapsed = Date.now() - started;
        if (elapsed > 180000) {
          setDebug({ status: "本体OCR完了後も全体OCR結果を取得できませんでした", patch: {}, rows: [`待機 ${Math.round(elapsed / 1000)}秒`] });
          return;
        }
        setDebug({ status: `本体の全体OCR待ち ${Math.floor(elapsed / 1000)}秒`, patch: {}, rows: [] });
        timer = window.setTimeout(wait, 500);
      };
      timer = window.setTimeout(wait, 700);
    };

    const run = (debugText, id) => {
      if (id !== runId.current) return;
      const global = extractGlobal(debugText);
      if (!global) {
        setDebug({ status: "全体OCR文字列が空でした", patch: {}, rows: [] });
        return;
      }
      const qr = window.__vehicleCertificateQrPriority || {};
      const model = qr.model || "";
      const first = qr.firstRegistration || "";
      const expiry = qr.inspectionExpiry || "";
      const patch = {};
      const rows = [`全体OCR文字数: ${global.length}`];

      const registration = cleanRegistration(global);
      if (registration?.value && registration.score >= 6) patch.registrationNumber = registration.value;
      rows.push(`登録番号: ${registration?.value || "未取得"} score=${registration?.score ?? 0}${registration?.line ? ` / ${registration.line}` : ""}`);

      const ch = cleanChassis(global);
      if (ch) patch.chassisNumber = ch;
      rows.push(`車台番号: ${ch || "未取得"}`);

      const regDate = registrationDateCandidate(global, first, expiry);
      if (regDate?.value && regDate.score >= 6) patch.registrationDate = regDate.value;
      rows.push(`登録年月日: ${regDate?.value || "未取得"} score=${regDate?.score ?? 0}${regDate?.line ? ` / ${regDate.line}` : ""}`);

      const eng = engineCandidate(global, model);
      if (eng?.value && eng.score >= 6) patch.engineModel = eng.value;
      rows.push(`原動機型式: ${eng?.value || "未取得"} score=${eng?.score ?? 0}${eng?.line ? ` / ${eng.line}` : ""}`);

      const numeric = numericRowCandidate(global);
      if (numeric?.value && numeric.score >= 7) Object.assign(patch, numeric.value);
      rows.push(`重量寸法行: ${numeric ? Object.values(numeric.value).join(" / ") : "未取得"} score=${numeric?.score ?? 0}${numeric?.line ? ` / ${numeric.line}` : ""}`);

      if (Object.keys(patch).length) {
        window.__vehicleAdaptiveOcrPatch = patch;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
      }
      setDebug({ status: "全体OCR構造解析 完了", patch, rows });
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
    <details open style={{ margin: "12px auto", maxWidth: 760, padding: 12, border: "1px solid #cbd5e1", borderRadius: 14, background: "#f8fafc" }}>
      <summary style={{ fontWeight: 800, cursor: "pointer" }}>共通画像補正OCR（確認用）</summary>
      <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        <div>状態: {debug.status}</div>
        <div>採用: {Object.entries(debug.patch || {}).map(([k, v]) => `${k}=${v}`).join(" / ") || "まだなし"}</div>
        {debug.rows?.length ? <details open style={{ marginTop: 8 }}><summary>構造解析詳細</summary><div>{debug.rows.join("\n")}</div></details> : null}
      </div>
    </details>
  );
}
