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
function numberOrNull(v) {
  if (v == null || v === "" || v === "-") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
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

function modelFamily(model = "") {
  const t = compact(model).toUpperCase();
  if (!t) return "";
  const p = t.split("-").pop() || t;
  return p.replace(/[^A-Z0-9]/g, "");
}

function cleanRegistration(text = "") {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  const out = [];
  const re = /([一-龠ぁ-んァ-ヶ]{1,8})\s*(\d\s*\d\s*\d)\s*([ぁ-ん])\s*(\d\s*\d\s*\d\s*\d)/g;
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(re)) {
      const cls = digits(m[2]), num = digits(m[4]);
      if (cls.length !== 3 || num.length !== 4) continue;
      const place = m[1];
      const around = `${lines[i - 1] || ""} ${lines[i]} ${lines[i + 1] || ""}`;
      let score = 2;
      if (/自動車登録番号|車両番号/.test(around)) score += 12;
      if (/住所|使用者|所有者|株式会社/.test(around)) score -= 8;
      if (place.length <= 4) score += 2;
      out.push({ value: `${place} ${cls} ${m[3]} ${num}`, score, line: lines[i] });
    }
  }
  return out.sort((a, b) => b.score - a.score)[0] || null;
}

function chassisCandidate(text = "", model = "") {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  const fam = modelFamily(model);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const u = lines[i].toUpperCase().replace(/[‐‑‒–—―ー]/g, "-");
    const found = u.match(/[A-Z0-9]{3,8}\s*-\s*[A-Z0-9]{4,12}/g) || [];
    for (const raw of found) {
      const v = raw.replace(/\s+/g, "");
      const [leftRaw, rightRaw] = v.split("-");
      if (!leftRaw || !rightRaw) continue;
      const left = leftRaw.replace(/O(?=\d)|(?<=\d)O/g, "0");
      const right = rightRaw.replace(/O/g, "0");
      const rightDigits = (right.match(/\d/g) || []).length;
      if (left.length > 8 || right.length < 4 || right.length > 10 || rightDigits < 4) continue;
      if (/^(?:DAA|DBA|ABA|CBA|EBD|HBD|LDA|TDA|TKG|TPG|QKG|QPG|2RG|2PG|3BA|4BA|5BA|5AA|6AA|7BA|8BA)$/.test(left)) continue;
      const around = `${lines[i - 1] || ""} ${lines[i]} ${lines[i + 1] || ""}`;
      let score = 2;
      if (/車台番号/.test(around)) score += 12;
      if (rightDigits === right.length) score += 3;
      if (fam && (fam.startsWith(left) || left.startsWith(fam) || (fam.length > 4 && fam.slice(0, -1) === left))) score += 5;
      if (/原動機|エンジン/.test(around) && !/車台番号/.test(around)) score -= 8;
      out.push({ value: `${left}-${right}`, score, line: lines[i] });
    }
  }
  return out.sort((a, b) => b.score - a.score)[0] || null;
}

function engineCandidate(text = "", model = "") {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  const regulatory = /^(?:DAA|DBA|ABA|CBA|EBD|HBD|LDA|TDA|TKG|TPG|QKG|QPG|2RG|2PG|3BA|4BA|5BA|5AA|6AA|7BA|8BA)-/;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const u = lines[i].toUpperCase().replace(/\s+/g, "").replace(/O(?=\d)|(?<=\d)O/g, "0");
    const values = u.match(/[A-Z0-9]{2,8}-[A-Z0-9]{2,8}/g) || [];
    for (const v of values) {
      if (v === compact(model).toUpperCase() || regulatory.test(v)) continue;
      if (!/[A-Z]/.test(v) || !/\d/.test(v)) continue;
      const around = `${lines[i - 1] || ""} ${lines[i]} ${lines[i + 1] || ""}`;
      let score = 1;
      if (/原動機|エンジン/.test(around)) score += 12;
      if (/車台番号/.test(around) && !/原動機|エンジン/.test(around)) score -= 8;
      if (v.length >= 7 && v.length <= 13) score += 2;
      out.push({ value: v, score, line: lines[i] });
    }
  }
  return out.sort((a, b) => b.score - a.score)[0] || null;
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
      const around = `${lines[i - 1] || ""} ${lines[i]} ${lines[i + 1] || ""}`;
      if (/走行距離|備考|点検|整備|燃費|騒音|改定|検査実施|オドメータ/.test(around)) {
        out.push({ value, score: -20, line: lines[i] });
        continue;
      }
      let score = 1;
      if (/登録年月日|交付年月日/.test(around)) score += 14;
      if (/初度登録/.test(around)) score += 4;
      if (/有効期間/.test(around)) score += 2;
      if (firstMonth) {
        const d = dateOrdinal(value);
        if (d) {
          const y = Math.floor(d / 10000), mo = Math.floor((d % 10000) / 100);
          if (y * 12 + mo === firstMonth) score += 4;
        }
      }
      out.push({ value, score, line: lines[i] });
    }
  }
  return out.sort((a, b) => b.score - a.score)[0] || null;
}

function combinations5(values) {
  const out = [];
  const n = Math.min(values.length, 14);
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) out.push([values[a], values[b], values[c], values[d], values[e]]);
  return out;
}

function axleSumFromQr(qr = {}) {
  const ff = numberOrNull(qr.frontFrontAxleWeightKg);
  const fr = numberOrNull(qr.frontRearAxleWeightKg);
  const rf = numberOrNull(qr.rearFrontAxleWeightKg);
  const rr = numberOrNull(qr.rearRearAxleWeightKg);
  const vals = [ff, fr, rf, rr].filter(v => v != null && v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}

function numericRowCandidate(text = "", qr = {}) {
  const lines = norm(text).split("\n").map(x => x.trim()).filter(Boolean);
  const axleSum = axleSumFromQr(qr);
  const kei = /軽自動車/.test(String(qr.vehicleClass || ""));
  let best = null;

  for (let i = 0; i < lines.length; i++) {
    for (let take = 1; take <= 7; take++) {
      const chunk = lines.slice(i, i + take).join(" ")
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/,/g, "");
      const hasLabels = /車両重量|車両総重量|長さ|幅|高さ/.test(chunk);
      const nums = (chunk.match(/\d{2,5}/g) || []).map(Number);
      if (nums.length < 5) continue;
      for (const combo of combinations5(nums)) {
        const [weight, gross, length, width, height] = combo;
        if (weight < 300 || weight > 30000) continue;
        if (gross < weight || gross > 50000) continue;
        if (length < 100 || length > 3000) continue;
        if (width < 100 || width > 300) continue;
        if (height < 100 || height > 450) continue;
        if (kei && (weight > 2200 || gross > 3000 || length > 340 || width > 148 || height > 220)) continue;
        if (axleSum != null && Math.abs(weight - axleSum) > Math.max(60, axleSum * 0.06)) continue;

        let score = 3;
        if (hasLabels) score += 7;
        if (/車両重量/.test(chunk) && /車両総重量/.test(chunk)) score += 4;
        if (/長さ/.test(chunk) && /幅/.test(chunk) && /高さ/.test(chunk)) score += 5;
        if (axleSum != null && Math.abs(weight - axleSum) <= 20) score += 10;
        if (kei && length <= 340 && width <= 148) score += 4;
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
      if (registration?.value && registration.score >= 12 && !qr.registrationNumber) patch.registrationNumber = registration.value;
      rows.push(`登録番号: ${registration?.value || "未取得"} score=${registration?.score ?? 0}${registration?.line ? ` / ${registration.line}` : ""}`);

      const ch = chassisCandidate(global, model);
      if (ch?.value && ch.score >= 8 && !qr.chassisNumber) patch.chassisNumber = ch.value;
      rows.push(`車台番号: ${ch?.value || "未取得"} score=${ch?.score ?? 0}${ch?.line ? ` / ${ch.line}` : ""}`);

      const regDate = registrationDateCandidate(global, first, expiry);
      if (regDate?.value && regDate.score >= 12 && !qr.registrationDate) patch.registrationDate = regDate.value;
      rows.push(`登録年月日: ${regDate?.value || "未取得"} score=${regDate?.score ?? 0}${regDate?.line ? ` / ${regDate.line}` : ""}`);

      const eng = engineCandidate(global, model);
      if (eng?.value && eng.score >= 14 && !qr.engineModel) patch.engineModel = eng.value;
      rows.push(`原動機型式: ${eng?.value || "未取得"} score=${eng?.score ?? 0}${eng?.line ? ` / ${eng.line}` : ""}`);

      const numeric = numericRowCandidate(global, qr);
      if (numeric?.value && numeric.score >= 16) Object.assign(patch, numeric.value);
      rows.push(`重量寸法行: ${numeric ? Object.values(numeric.value).join(" / ") : "未取得"} score=${numeric?.score ?? 0}${numeric?.line ? ` / ${numeric.line}` : ""}`);

      const axleSum = axleSumFromQr(qr);
      if (axleSum != null && axleSum >= 300 && axleSum <= 30000 && !patch.vehicleWeightKg) {
        patch.vehicleWeightKg = String(axleSum);
        rows.push(`軸重整合: QR軸重合計 ${axleSum}kg → 車両重量候補`);
      }

      if (Object.keys(patch).length) {
        window.__vehicleAdaptiveOcrPatch = patch;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
      }
      setDebug({ status: "安全フィルタ付き全体OCR解析 完了", patch, rows });
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
