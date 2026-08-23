"use client";

import { useEffect } from "react";

const compact = (v = "") =>
  String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function section(title) {
  return (
    Array.from(document.querySelectorAll("section.card")).find((s) =>
      s.querySelector("h2")?.textContent?.includes(title)
    ) || null
  );
}

function detailInput(label) {
  const s = section("車検証読み取り情報");
  if (!s) return null;
  for (const node of Array.from(s.querySelectorAll("label"))) {
    const title = compact(node.querySelector("span")?.textContent || node.textContent || "");
    if (title === compact(label)) return node.querySelector("input");
  }
  return null;
}

function basicControl(label) {
  const s = section("基本情報");
  if (!s) return null;
  for (const node of Array.from(s.querySelectorAll("label"))) {
    const text = compact(node.childNodes[0]?.textContent || node.textContent || "");
    if (text.startsWith(compact(label))) return node.querySelector("input,select");
  }
  return null;
}

function setInput(el, value) {
  if (!el || value == null || value === "" || el.value === value) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function setSelect(el, value) {
  if (!(el instanceof HTMLSelectElement) || !value || el.value === value) return false;
  let option = Array.from(el.options).find((o) => o.value === value || o.text === value);
  if (!option) {
    option = document.createElement("option");
    option.value = value;
    option.text = value;
    el.appendChild(option);
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function eraDate(year, month, day) {
  if (!year || !month) return "";
  if (year >= 2019) return `令和${year - 2018}年${month}月${day ? `${day}日` : ""}`;
  if (year >= 1989) return `平成${year - 1988}年${month}月${day ? `${day}日` : ""}`;
  if (year >= 1926) return `昭和${year - 1925}年${month}月${day ? `${day}日` : ""}`;
  return "";
}

function fullYear(yy) {
  const n = Number(yy);
  if (!Number.isFinite(n)) return 0;
  return n <= 50 ? 2000 + n : 1900 + n;
}

function qrDate6(v) {
  const s = String(v || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(s) || s === "999999") return "";
  const year = fullYear(s.slice(0, 2));
  const month = Number(s.slice(2, 4));
  const day = Number(s.slice(4, 6));
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return eraDate(year, month, day);
}

function qrMonth4(v) {
  const s = String(v || "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(s) || s === "9999") return "";
  const year = fullYear(s.slice(0, 2));
  const month = Number(s.slice(2, 4));
  if (!year || month < 1 || month > 12) return "";
  return eraDate(year, month, 0);
}

function axle(v) {
  const s = compact(v).replace(/\s/g, "");
  if (!s || /^-+$/.test(s)) return "";
  if (!/^\d{4}$/.test(s)) return "";
  return String(Number(s) * 10);
}

const fuelMap = {
  "00": "",
  "01": "ガソリン",
  "02": "軽油",
  "03": "LPG",
  "04": "灯油",
  "05": "電気",
  "06": "ガソリン・LPG",
  "07": "ガソリン・灯油",
  "08": "メタノール",
  "09": "CNG",
  "11": "LNG",
  "12": "ANG",
  "13": "圧縮水素",
  "14": "ガソリン・電気",
  "15": "LPG・電気",
  "16": "軽油・電気",
  "99": "その他",
};

function cleanData(item) {
  return String(item?.data || "").normalize("NFKC").replace(/\u3000/g, " ");
}

function detectQr3Parts(items) {
  let a = null;
  let b = null;
  let c = null;

  for (const item of items) {
    const s = cleanData(item);
    if (!a && /^2\//.test(s) && /\/\d{6}\/\d{4}\/[A-Z0-9*\-]+/i.test(s)) {
      a = item;
      continue;
    }
    if (!b && /\/0?\d{3,4}\s*\/[-\s]*\/[-\s]*\/0?\d{3,4}\s*\/\d{2}\/\d{2,3}/.test(s)) {
      b = item;
      continue;
    }
    if (!c && /999999\/\d{2}\s*$/.test(s)) {
      c = item;
    }
  }

  // 個別QRラベルが付いている場合は位置順も利用する。
  const byLabel = (n) =>
    items.find((x) => new RegExp(`(?:^|/)QR${n}(?:/|$)`).test(String(x?.label || "")));
  a ||= byLabel(1);
  b ||= byLabel(2);
  c ||= byLabel(3);

  return a && b && c ? [a, b, c] : null;
}

function parseQr3(items) {
  const parts = detectQr3Parts(items);
  if (!parts) return null;
  const joined = parts.map(cleanData).join("");
  const f = joined.split("/").map((x) => compact(x));
  if (f.length < 19 || f[0] !== "2") return null;

  const designation = f[2].replace(/\s/g, "");
  let modelDesignationNumber = "";
  let classificationNumber = "";
  if (/^\d{9,10}$/.test(designation)) {
    modelDesignationNumber = designation.slice(0, 5);
    classificationNumber = designation.slice(5);
  }

  return {
    raw: joined,
    inspectionExpiry: qrDate6(f[3]),
    firstRegistration: qrMonth4(f[4]),
    model: compact(f[5]).replace(/\s/g, "").toUpperCase(),
    frontFrontAxleWeightKg: axle(f[6]),
    frontRearAxleWeightKg: axle(f[7]),
    rearFrontAxleWeightKg: axle(f[8]),
    rearRearAxleWeightKg: axle(f[9]),
    fuel: fuelMap[String(f[18] || "").replace(/\D/g, "")] || "",
    modelDesignationNumber,
    classificationNumber,
  };
}

function registrationFromFixed(v) {
  const s = String(v || "").normalize("NFKC").replace(/\u3000/g, " ").trim();
  const m = s.match(/(\d{2,3})\s*([ぁ-ん])\s*(\d{4})\s*$/);
  if (!m) return "";
  const region = s.slice(0, m.index).trim().replace(/\s+/g, "");
  return region ? `${region} ${m[1]} ${m[2]} ${m[3]}` : "";
}

function parseQr2(items) {
  // 二次元コード2は右側2連。先頭片は「2/」の後に日本語の登録番号を含む。
  const first = items.find((item) => {
    const s = cleanData(item);
    return /^2\//.test(s) && /[一-龠ぁ-んァ-ヶ]/.test(s) && !/\/\d{6}\/\d{4}\//.test(s);
  });
  if (!first) return null;

  const used = new Set([first]);
  let second = items.find(
    (item) => !used.has(item) && /(?:^|/)QR5(?:/|$)/.test(String(item?.label || ""))
  );
  if (!second) {
    // QR3の3片を除いた未分類片が1つだけあれば、右側2連の後半として使う。
    const q3 = detectQr3Parts(items) || [];
    const excluded = new Set([first, ...q3]);
    const rest = items.filter((x) => !excluded.has(x));
    if (rest.length === 1) second = rest[0];
  }

  if (!second) return null;
  const joined = cleanData(first) + cleanData(second);
  const f = joined.split("/").map((x) => compact(x));
  if (f.length < 6 || f[0] !== "2") return null;
  return {
    raw: joined,
    registrationNumber: registrationFromFixed(f[1]),
    chassisNumber: compact(f[3]).replace(/\s/g, "").toUpperCase(),
    engineModel: compact(f[4]).replace(/\s/g, "").toUpperCase(),
  };
}

function applyValues(qr3, qr2) {
  const applied = [];
  const put = (label, value) => {
    if (value && setInput(detailInput(label), value)) applied.push(`${label}: ${value}`);
  };

  if (qr3) {
    put("有効期間の満了する日", qr3.inspectionExpiry);
    put("初度登録年月", qr3.firstRegistration);
    put("型式", qr3.model);
    put("前前軸重 kg", qr3.frontFrontAxleWeightKg);
    put("前後軸重 kg", qr3.frontRearAxleWeightKg);
    put("後前軸重 kg", qr3.rearFrontAxleWeightKg);
    put("後後軸重 kg", qr3.rearRearAxleWeightKg);
    put("燃料の種類", qr3.fuel);
    put("型式指定番号", qr3.modelDesignationNumber);
    put("類別区分番号", qr3.classificationNumber);

    setInput(basicControl("初度登録（和暦）"), qr3.firstRegistration);
    setInput(basicControl("型式"), qr3.model);
    if (qr3.fuel === "軽油") setSelect(basicControl("燃料"), "ディーゼル") || setSelect(basicControl("燃料"), "軽油");
    else if (qr3.fuel === "ガソリン") setSelect(basicControl("燃料"), "ガソリン");
    else if (/電気/.test(qr3.fuel)) setSelect(basicControl("燃料"), "EV");
  }

  if (qr2) {
    put("自動車登録番号又は車両番号", qr2.registrationNumber);
    put("車台番号", qr2.chassisNumber);
    put("原動機の型式", qr2.engineModel);
    setInput(basicControl("登録番号"), qr2.registrationNumber);
    setInput(basicControl("ナンバー下4桁"), qr2.registrationNumber.match(/(\d{4})$/)?.[1] || "");
    setInput(basicControl("車台番号"), qr2.chassisNumber);
  }

  return applied;
}

function showApplied(qr3, qr2) {
  const host = document.getElementById("certificate-qr-debug");
  if (!host) return;
  let box = document.getElementById("certificate-qr-applied");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-applied";
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.borderRadius = "10px";
    box.style.background = "#e9f7ef";
    box.style.border = "1px solid #bfe6ce";
    box.style.fontWeight = "700";
    host.appendChild(box);
  }
  const lines = [];
  if (qr3) {
    if (qr3.inspectionExpiry) lines.push(`有効期限 ${qr3.inspectionExpiry}`);
    if (qr3.firstRegistration) lines.push(`初度登録 ${qr3.firstRegistration}`);
    if (qr3.model) lines.push(`型式 ${qr3.model}`);
    if (qr3.frontFrontAxleWeightKg) lines.push(`前前軸重 ${qr3.frontFrontAxleWeightKg}kg`);
    if (qr3.rearRearAxleWeightKg) lines.push(`後後軸重 ${qr3.rearRearAxleWeightKg}kg`);
    if (qr3.fuel) lines.push(`燃料 ${qr3.fuel}`);
  }
  if (qr2?.registrationNumber) lines.push(`登録番号 ${qr2.registrationNumber}`);
  if (qr2?.chassisNumber) lines.push(`車台番号 ${qr2.chassisNumber}`);
  box.textContent = lines.length
    ? `QRから自動反映: ${lines.join(" / ")}`
    : "QRは読み取れましたが、自動反映対象の連結データがまだ揃っていません。";
}

export default function CertificateQrApply() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let lastKey = "";
    const run = () => {
      const items = Array.isArray(window.__vehicleCertificateQr)
        ? window.__vehicleCertificateQr
        : [];
      if (!items.length) return;
      const key = items.map((x) => `${x.label || ""}:${x.data || x.hex || ""}`).join("|");
      const qr3 = parseQr3(items);
      const qr2 = parseQr2(items);

      // OCRが後から誤値を上書きしても、QR項目はQRを優先するため毎回差分だけ再適用する。
      applyValues(qr3, qr2);
      showApplied(qr3, qr2);
      lastKey = key;
    };

    const timer = window.setInterval(run, 350);
    run();
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
