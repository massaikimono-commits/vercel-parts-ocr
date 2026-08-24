"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function eraDate(year, month, day = 0) {
  if (!year || !month) return "";
  const suffix = day ? `${day}日` : "";
  if (year >= 2019) return `令和${year - 2018}年${month}月${suffix}`;
  if (year >= 1989) return `平成${year - 1988}年${month}月${suffix}`;
  if (year >= 1926) return `昭和${year - 1925}年${month}月${suffix}`;
  return "";
}

function yyToYear(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n <= 50 ? 2000 + n : 1900 + n;
}

function date6(v) {
  const s = String(v || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(s) || s === "999999") return "";
  const y = yyToYear(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return eraDate(y, m, d);
}

function month4(v) {
  const s = String(v || "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(s) || s === "9999") return "";
  const y = yyToYear(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (!y || m < 1 || m > 12) return "";
  return eraDate(y, m);
}

function axle(v) {
  const s = compact(v).replace(/\s/g, "");
  if (!/^\d{4}$/.test(s)) return "";
  return String(Number(s) * 10);
}

function qrByPosition(items, n) {
  return items.find((item) => new RegExp(`(?:^|/)QR${n}(?:/|$)`).test(String(item?.label || "")));
}

function parseQr3(items) {
  const q1 = qrByPosition(items, 1);
  const q2 = qrByPosition(items, 2);
  const q3 = qrByPosition(items, 3);
  if (!q1 || !q2 || !q3) return null;

  const joined = [q1, q2, q3]
    .map((x) => String(x?.data || "").normalize("NFKC").replace(/\u3000/g, " "))
    .join("");
  const f = joined.split("/").map(compact);
  if (f.length < 19 || f[0] !== "2") return null;

  const fuelCode = String(f[18] || "").replace(/\D/g, "");
  const fuelMap = {
    "01": "ガソリン",
    "02": "軽油",
    "03": "LPG",
    "05": "電気",
    "09": "CNG",
    "13": "圧縮水素",
    "14": "ガソリン・電気",
    "16": "軽油・電気",
    "99": "その他",
  };

  return {
    inspectionExpiry: date6(f[3]),
    firstRegistration: month4(f[4]),
    model: compact(f[5]).replace(/\s/g, "").toUpperCase(),
    frontFrontAxleWeightKg: axle(f[6]),
    frontRearAxleWeightKg: axle(f[7]),
    rearFrontAxleWeightKg: axle(f[8]),
    rearRearAxleWeightKg: axle(f[9]),
    fuel: fuelMap[fuelCode] || "",
  };
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function showStatus(v, state = "") {
  const host = document.getElementById("certificate-qr-debug");
  if (!host) return;

  let box = document.getElementById("certificate-qr-applied-fixed");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-applied-fixed";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.borderRadius = "12px";
    box.style.background = "#e9f7ef";
    box.style.border = "1px solid #bfe6ce";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }

  if (!v) {
    box.textContent = state || "QR1〜3の連結データを待っています。";
    return;
  }

  box.textContent = `QR優先値確定: 有効期限 ${v.inspectionExpiry || "未取得"} / 初度登録 ${v.firstRegistration || "未取得"} / 型式 ${v.model || "未取得"} / 前前軸重 ${v.frontFrontAxleWeightKg || "-"}kg / 後後軸重 ${v.rearRearAxleWeightKg || "-"}kg / 燃料 ${v.fuel || "未取得"}${state ? ` / ${state}` : ""}`;
}

export default function CertificateQrApplyFixed() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let stopped = false;
    let lastFileKey = "";
    let syncBudget = 0;
    let syncedSignature = "";

    const onFileChange = (event) => {
      const input = event.target;
      if (!isCertificateFileInput(input)) return;
      const file = input.files?.[0];
      if (!file) return;

      const key = `${file.name}|${file.size}|${file.lastModified}`;
      const sameFile = Boolean(lastFileKey && key === lastFileKey);
      if (!sameFile) {
        window.__vehicleCertificateQr = [];
        window.__vehicleCertificateQrPriority = null;
      }
      lastFileKey = key;
      syncBudget = 0;
      syncedSignature = "";
      showStatus(null, sameFile ? "同じ画像を再解析中。" : "QR解析待ちです。");
    };

    document.addEventListener("change", onFileChange, true);

    const tick = () => {
      if (stopped) return;

      const items = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
      if (!items.length) return;

      const values = parseQr3(items);
      if (!values) {
        showStatus(null, "QR1〜3の連結データを待っています。");
        return;
      }

      window.__vehicleCertificateQrPriority = values;
      const signature = JSON.stringify(values);

      if (document.querySelector(".progress")) {
        // OCR完了後にも必ず再同期できるよう、処理中は送信枠を補充する。
        syncBudget = 3;
        syncedSignature = "";
        showStatus(values, "v3本体OCRへ渡して処理中");
        return;
      }

      if (!syncBudget && syncedSignature !== signature) syncBudget = 3;

      if (syncBudget > 0) {
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: values }));
        syncBudget -= 1;
        const done = 3 - syncBudget;
        if (syncBudget === 0) syncedSignature = signature;
        showStatus(values, `v3本体state最終同期 ${done}/3`);
      } else {
        showStatus(values, "v3本体state同期済み");
      }
    };

    const timer = window.setInterval(tick, 300);
    tick();

    return () => {
      stopped = true;
      document.removeEventListener("change", onFileChange, true);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
