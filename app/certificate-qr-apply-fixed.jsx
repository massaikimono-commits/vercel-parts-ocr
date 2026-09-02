"use client";

import { useEffect } from "react";
import { parseRegistrationNumber } from "./lib/registration-number";

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

function axleOrDash(v) {
  const s = compact(v).replace(/\s/g, "");
  if (s === "-") return "-";
  return axle(s);
}

function meaningful(v) {
  const s = compact(v);
  if (!s || /^(?:-|－|\*|＊)+$/.test(s)) return "";
  return s;
}

function cleanAscii(v) {
  return meaningful(v).replace(/\s/g, "").toUpperCase();
}

function cleanNumber(v) {
  const s = compact(v).replace(/[^0-9]/g, "");
  return s ? String(Number(s)) : "";
}

const fuelMap = {
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
  "17": "ガソリン・LPG",
  "18": "ガソリン・灯油",
  "99": "その他",
};

function splitDesignation(value, out) {
  const s = String(value || "").replace(/\D/g, "");
  if (!/^\d{9}$/.test(s)) return;
  out.modelDesignationNumber = s.slice(0, 5);
  out.classificationNumber = s.slice(5);
}

function qrFields(item) {
  return String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map(compact);
}

function qrByPosition(items, n) {
  return items.find((item) => new RegExp(`(?:^|/)QR${n}(?:/|$)`).test(String(item?.label || "")));
}

function registrationFromQr2(value) {
  const raw = String(value || "").normalize("NFKC").replace(/\u3000/g, " ");
  const chars = Array.from(raw);
  if (chars.length >= 12) {
    const region = chars.slice(0, 4).join("").trim();
    const cls = chars.slice(4, 7).join("").trim();
    const kana = chars.slice(7, 8).join("").trim();
    const serial = chars.slice(8, 12).join("").trim();
    const parsed = parseRegistrationNumber([region, cls, kana, serial].filter(Boolean).join(" "));
    if (parsed) return parsed.canonical;
  }
  const parsed = parseRegistrationNumber(raw);
  return parsed?.canonical || "";
}

function registeredItemText(item) {
  return String(item?.data || "").normalize("NFKC").replace(/\u3000/g, " ");
}

function validChassis(value) {
  const s = cleanAscii(value);
  return /^[A-Z0-9]{2,10}-[A-Z0-9]{4,12}$/.test(s) ? s : "";
}

function validEngine(value) {
  const s = cleanAscii(value);
  if (!/^[A-Z0-9]{2,8}(?:-[A-Z0-9]{1,10})?$/.test(s)) return "";
  if (/^\*(?:FUMEI|SHISAKU|KUMITATE)/.test(s)) return "";
  return s;
}

function validModel(value) {
  const s = cleanAscii(value);
  if (!/^(?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14}$/.test(s)) return "";
  if (/^\*(?:SHISAKU|KUMITATE|FUMEI)/.test(s)) return "";
  return s;
}

function parseRegisteredIdentityText(text) {
  const f = String(text || "").split("/").map((x) => String(x || "").trim());
  if (f[0] !== "2" || f.length < 2) return {};
  const out = {};
  const registration = registrationFromQr2(f[1]);
  if (registration) out.registrationNumber = registration;

  // 登録番号を持つ右側QRは、後半QRが未取得でも読めた値だけ即採用する。
  if (registration) {
    for (let i = 2; i < f.length; i += 1) {
      const chassis = validChassis(f[i]);
      if (!chassis) continue;
      out.chassisNumber = chassis;
      const engine = validEngine(f[i + 1]);
      if (engine) out.engineModel = engine;
      break;
    }
  }
  return out;
}

function parseRegisteredSpecText(text) {
  const f = String(text || "").split("/").map((x) => String(x || "").trim());
  if (f[0] !== "2") return {};
  const out = {};

  // 登録車QRの版差を固定indexで決め打ちせず、
  // 「有効期限6桁 → 初度年月4桁 → 型式」の並びを基準に探す。
  let modelIndex = -1;
  for (let i = 1; i + 2 < f.length; i += 1) {
    const expiry = date6(f[i]);
    const first = month4(f[i + 1]);
    const model = validModel(f[i + 2]);
    if (!expiry || !first || !model) continue;
    out.inspectionExpiry = expiry;
    out.firstRegistration = first;
    out.model = model;
    modelIndex = i + 2;
    break;
  }
  if (modelIndex < 0) return out;

  // 型式より前にある9桁の型式指定/類別連結値が読めていれば採用。
  for (let i = modelIndex - 1; i >= 1; i -= 1) {
    const s = String(f[i] || "").replace(/\D/g, "");
    if (/^\d{9}$/.test(s)) {
      splitDesignation(s, out);
      break;
    }
  }

  const ff = axleOrDash(f[modelIndex + 1]);
  const fr = axleOrDash(f[modelIndex + 2]);
  const rf = axleOrDash(f[modelIndex + 3]);
  const rr = axleOrDash(f[modelIndex + 4]);
  if (ff) out.frontFrontAxleWeightKg = ff;
  if (fr) out.frontRearAxleWeightKg = fr;
  if (rf) out.rearFrontAxleWeightKg = rf;
  if (rr) out.rearRearAxleWeightKg = rr;

  // 現行登録車QRでは燃料コードは型式から13フィールド後。
  const fuelCode = String(f[modelIndex + 13] || "").replace(/\D/g, "");
  if (fuelMap[fuelCode]) out.fuel = fuelMap[fuelCode];
  return out;
}

function registeredCandidateTexts(items) {
  const ordered = [...(items || [])].sort((a, b) => Number(a?.xCenter ?? a?.slot ?? 99) - Number(b?.xCenter ?? b?.slot ?? 99));
  const texts = ordered.map(registeredItemText).filter(Boolean);
  const out = [...texts];
  // Structured Appendの途中片しか読めていない時でも、取得済みの連続片だけ連結して解析する。
  for (let width = 2; width <= Math.min(5, texts.length); width += 1) {
    for (let i = 0; i + width <= texts.length; i += 1) out.push(texts.slice(i, i + width).join(""));
  }
  return [...new Set(out)];
}

function parseRegistered(items) {
  const values = {};
  const versions = new Set();
  for (const text of registeredCandidateTexts(items)) {
    const identity = parseRegisteredIdentityText(text);
    const spec = parseRegisteredSpecText(text);
    for (const [key, value] of Object.entries({ ...spec, ...identity })) {
      if (typeof value === "string" && value.trim() && !values[key]) values[key] = value.trim();
    }
    if (Object.keys(identity).length) versions.add("登録車QR-identity");
    if (Object.keys(spec).length) versions.add("登録車QR-spec");
  }

  // 既存の位置ラベルが正しく揃ったケースも最後に補助利用する。
  const q4 = qrByPosition(items, 4);
  const q5 = qrByPosition(items, 5);
  if (q4 && q5) {
    const identity = parseRegisteredIdentityText(registeredItemText(q4) + registeredItemText(q5));
    for (const [key, value] of Object.entries(identity)) if (value && !values[key]) values[key] = value;
  }
  const q1 = qrByPosition(items, 1), q2 = qrByPosition(items, 2), q3 = qrByPosition(items, 3);
  if (q1 && q2 && q3) {
    const spec = parseRegisteredSpecText(registeredItemText(q1) + registeredItemText(q2) + registeredItemText(q3));
    for (const [key, value] of Object.entries(spec)) if (value && !values[key]) values[key] = value;
  }

  return Object.keys(values).length
    ? { kind: "registered", values, versions: [...versions] }
    : null;
}
function keiCode(items, codeNumber) {
  return items.find((item) => {
    const f = qrFields(item);
    return f[0] === "K" && new RegExp(`^${codeNumber}\\d$`).test(f[1] || "");
  });
}

function parseKei(items) {
  const candidates = items.filter((item) => qrFields(item)[0] === "K");
  if (!candidates.length) return null;

  const out = {};
  const versions = candidates.map((item) => qrFields(item)[1]).filter(Boolean);
  const q1 = keiCode(items, 0);
  const q2 = keiCode(items, 2);
  const q3 = keiCode(items, 3);
  const q4 = keiCode(items, 5);
  const q5 = keiCode(items, 6);
  const q6 = keiCode(items, 7);

  if (q1) {
    const f = qrFields(q1);
    const registration = meaningful(f[3]);
    const chassis = cleanAscii(f[4]);
    if (registration) out.registrationNumber = registration;
    if (chassis) out.chassisNumber = chassis;
    splitDesignation(f[5], out);
  }

  if (q2) {
    const f = qrFields(q2);
    const registration = meaningful(f[2]);
    const chassis = cleanAscii(f[4]);
    const engine = cleanAscii(f[5]);
    if (registration) out.registrationNumber = registration;
    if (chassis) out.chassisNumber = chassis;
    if (engine && !/^\*FUMEI$/.test(engine)) out.engineModel = engine;
  }

  if (q3) {
    const f = qrFields(q3);
    splitDesignation(f[3], out);
    const expiry = date6(f[4]);
    const first = month4(f[5]);
    const model = cleanAscii(f[6]);
    const ff = axle(f[7]);
    const fr = axleOrDash(f[8]);
    const rf = axleOrDash(f[9]);
    const rr = axle(f[10]);
    const fuelCode = String(f[18] || "").replace(/\D/g, "");
    if (expiry) out.inspectionExpiry = expiry;
    if (first) out.firstRegistration = first;
    if (model && !/^\*(?:SHISAKU|KUMITATE|FUMEI)/.test(model)) out.model = model;
    if (ff) out.frontFrontAxleWeightKg = ff;
    if (fr) out.frontRearAxleWeightKg = fr;
    if (rf) out.rearFrontAxleWeightKg = rf;
    if (rr) out.rearRearAxleWeightKg = rr;
    if (fuelMap[fuelCode]) out.fuel = fuelMap[fuelCode];
  }

  if (q4) {
    const f = qrFields(q4);
    const name = meaningful(f[2]);
    if (name) out.userName = name;
  }

  if (q5) {
    const f = qrFields(q5);
    const address = meaningful(f[2]);
    if (address) out.userAddress = address;
  }

  if (q6) {
    const f = qrFields(q6);
    const vehicleClass = meaningful(f[2]);
    const purpose = meaningful(f[3]);
    const privateBusiness = meaningful(f[4]);
    const bodyCode = String(f[5] || "").replace(/\D/g, "");
    const bodyMap = { "001": "箱型" };
    const seat = cleanNumber(f[6]);
    const payload = cleanNumber(f[8]);
    const gross1 = cleanNumber(f[10]);
    const gross2 = cleanNumber(f[11]);
    const makerCode = String(f[12] || "").replace(/\D/g, "");
    const makerMap = { "131": "スズキ" };
    if (vehicleClass) out.vehicleClass = vehicleClass;
    if (purpose) out.purpose = purpose;
    if (privateBusiness) out.privateBusiness = privateBusiness;
    if (bodyMap[bodyCode]) out.bodyShape = bodyMap[bodyCode];
    if (seat) out.seatingCapacity = seat;
    if (payload) out.maxPayloadKg = payload;
    if (gross1 || gross2) out.grossVehicleWeightKg = gross1 || gross2;
    if (makerMap[makerCode]) out.vehicleName = makerMap[makerCode];
  }

  const cleaned = Object.fromEntries(Object.entries(out).filter(([, v]) => typeof v === "string" && v.trim()));
  return { kind: "kei", values: cleaned, versions: [...new Set(versions)].sort() };
}

function parseAnyQr(items) {
  const kei = parseKei(items);
  if (kei) return kei;
  return parseRegistered(items);
}

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function showStatus(parsed, state = "") {
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
  if (!parsed) {
    box.textContent = state || "QRデータを待っています。";
    return;
  }
  const v = parsed.values || {};
  const label = parsed.kind === "kei" ? `軽自動車QR(${parsed.versions.join(",") || "K"})` : "登録車QR";
  const parts = [
    v.registrationNumber && `車両番号 ${v.registrationNumber}`,
    v.chassisNumber && `車台 ${v.chassisNumber}`,
    v.firstRegistration && `初度 ${v.firstRegistration}`,
    v.inspectionExpiry && `有効期限 ${v.inspectionExpiry}`,
    v.model && `型式 ${v.model}`,
    v.engineModel && `原動機 ${v.engineModel}`,
    v.frontFrontAxleWeightKg && `前軸 ${v.frontFrontAxleWeightKg}kg`,
    v.rearRearAxleWeightKg && `後軸 ${v.rearRearAxleWeightKg}kg`,
    v.fuel && `燃料 ${v.fuel}`,
    v.vehicleClass && `種別 ${v.vehicleClass}`,
    v.purpose && `用途 ${v.purpose}`,
    v.bodyShape && `形状 ${v.bodyShape}`,
    v.modelDesignationNumber && `型式指定 ${v.modelDesignationNumber}`,
    v.classificationNumber && `類別 ${v.classificationNumber}`,
  ].filter(Boolean);
  box.textContent = `${label}から本体stateへ反映: ${parts.length ? parts.join(" / ") : "解析済み"}${state ? ` / ${state}` : ""}`;
}

export default function CertificateQrApplyFixed() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    const fastWorkflow =
      location.pathname === "/vehicle-workflow-v2" ||
      location.pathname === "/vehicle-workflow-fast";
    let stopped = false;
    let sendBudget = 0;
    let sentCount = 0;
    let lastFileKey = "";

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
      sendBudget = 14;
      sentCount = 0;
      showStatus(null, sameFile ? "同じ画像を再テスト中。前回QR値を再利用して本体stateを再確定します。" : "新しい画像のQR解析待ちです。");
    };

    document.addEventListener("change", onFileChange, true);

    const tick = () => {
      if (stopped) return;
      const items = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
      if (!items.length) return;
      const parsed = parseAnyQr(items);
      if (!parsed || !Object.keys(parsed.values || {}).length) {
        const keiVersions = items.map(qrFields).filter((f) => f[0] === "K").map((f) => f[1]).filter(Boolean);
        showStatus(null, keiVersions.length ? `軽自動車QR ${[...new Set(keiVersions)].join(",")} を検出。追加コード待ちです。` : "登録車QRの連結データを待っています。");
        return;
      }
      const values = parsed.values;
      window.__vehicleCertificateQrPriority = {
        ...(window.__vehicleCertificateQrPriority || {}),
        ...values,
      };
      if (document.querySelector(".progress")) {
        showStatus(parsed, "OCR完了待ち");
        return;
      }
      if (fastWorkflow) {
        // vehicle-workflow-v2/fast reads __vehicleCertificateQrPriority during
        // OCR and performs its own single final authoritative merge.
        showStatus(parsed, "QR優先値を本体高速OCRへ共有済み");
        return;
      }
      if (sendBudget > 0) {
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: values }));
        sendBudget -= 1;
        sentCount += 1;
        showStatus(parsed, `本体stateへ確定送信 ${sentCount}/14`);
      } else {
        showStatus(parsed, "本体state反映安定");
      }
    };

    const timer = window.setInterval(tick, 420);
    tick();
    return () => {
      stopped = true;
      document.removeEventListener("change", onFileChange, true);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
