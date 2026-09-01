"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const ROW_PRIORITY_KEY = "__vehicleCertificatePdfRowPriority";

function norm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compact(value) {
  return norm(value).replace(/\s+/g, "");
}

function jpMonth(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
}

function jpDate(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function registration(text) {
  const m = norm(text).match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  return m ? `${m[1]} ${m[2].replace(/\D/g, "")} ${m[3]} ${m[4].replace(/\D/g, "")}` : "";
}

function cleanCompanyOrAddress(text) {
  return norm(text)
    .replace(/^.*?(?:使用者の氏名又は名称|使用者の住所)\s*/, "")
    .replace(/\s*\[[0-9\s]+\]\s*$/, "")
    .trim();
}

function lineAfter(lines, matcher) {
  const index = lines.findIndex((line) => matcher(compact(line.text)));
  if (index < 0) return null;
  for (let i = index + 1; i < Math.min(lines.length, index + 4); i += 1) {
    const text = norm(lines[i].text);
    if (text) return lines[i];
  }
  return null;
}

function findLine(lines, matcher) {
  return lines.find((line) => matcher(compact(line.text))) || null;
}

function buildLines(tokens) {
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const token of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - token.y) <= Math.max(0.0045, token.h * 0.7));
    if (!line) {
      line = { y: token.y, tokens: [] };
      lines.push(line);
    }
    line.tokens.push(token);
    line.y = line.tokens.reduce((sum, value) => sum + value.y, 0) / line.tokens.length;
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    line.text = line.tokens.map((token) => token.text).join(" ");
  }
  return lines.sort((a, b) => a.y - b.y);
}

function tokenFromItem(item, pageWidth, pageHeight) {
  const text = norm(item?.str || "");
  if (!text) return null;
  const tr = item?.transform || [1, 0, 0, 1, 0, 0];
  const x = Number(tr[4] || 0) / Math.max(1, pageWidth);
  const baseline = Number(tr[5] || 0) / Math.max(1, pageHeight);
  const h = Math.max(Math.abs(Number(tr[3] || 0)), Number(item?.height || 0), 1) / Math.max(1, pageHeight);
  const w = Math.max(Number(item?.width || 0), 1) / Math.max(1, pageWidth);
  return { text, x, y: 1 - baseline, w, h };
}

async function pageTokens(page) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return (content.items || [])
    .map((item) => tokenFromItem(item, viewport.width, viewport.height))
    .filter(Boolean);
}

async function choosePage(pdf) {
  let best = { pageNumber: 1, tokens: [], score: -1 };
  const max = Math.min(pdf.numPages || 1, 8);
  for (let n = 1; n <= max; n += 1) {
    const page = await pdf.getPage(n);
    const tokens = await pageTokens(page).catch(() => []);
    const text = compact(tokens.map((token) => token.text).join(" "));
    let score = 0;
    if (text.includes("車両情報")) score += 4;
    if (text.includes("自動車登録番号") || text.includes("車両番号")) score += 3;
    if (text.includes("車台番号")) score += 3;
    if (text.includes("車両重量")) score += 2;
    if (text.includes("原動機の型式")) score += 2;
    if (score > best.score) best = { pageNumber: n, tokens, score };
  }
  return best;
}

function parseRows(lines) {
  const patch = {};

  // Registration/date/classification row.
  const topValue = lineAfter(lines, (t) => t.includes("自動車登録番号又は車両番号") && t.includes("初度登録年月") && t.includes("車体の形状"));
  if (topValue) {
    const text = norm(topValue.text);
    const reg = registration(text);
    if (reg) patch.registrationNumber = reg;
    const dates = [...text.matchAll(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?(?:\s*(\d{1,2})\s*日?)?/g)];
    if (dates[0]) patch.registrationDate = jpDate(dates[0][0]);
    if (dates[1]) patch.firstRegistration = jpMonth(dates[1][0]);
    for (const value of ["普通", "小型", "軽自動車", "大型特殊"]) if (text.includes(value)) patch.vehicleClass = value;
    for (const value of ["乗用", "貨物", "乗合", "特種"]) if (text.includes(value)) patch.purpose = value;
    for (const value of ["自家用", "事業用"]) if (text.includes(value)) patch.privateBusiness = value;
    for (const value of ["キャブオーバ", "ステーションワゴン", "ボンネット", "ピックアップ", "トラック", "ダンプ", "セダン", "箱型", "バン", "バス", "幌型"]) if (text.includes(value)) patch.bodyShape = value;
  }

  // Maker / seats / payload / vehicle weight / gross weight.
  const weightValue = lineAfter(lines, (t) => t.includes("車名") && t.includes("乗車定員") && t.includes("最大積載量") && t.includes("車両重量") && t.includes("車両総重量"));
  if (weightValue) {
    const text = norm(weightValue.text);
    const maker = ["トヨタ", "レクサス", "日産", "ホンダ", "三菱", "マツダ", "スバル", "スズキ", "ダイハツ", "いすゞ", "日野", "UDトラックス", "メルセデス・ベンツ", "フォルクスワーゲン", "アウディ", "BMW", "ボルボ"].find((v) => text.includes(v));
    if (maker) patch.vehicleName = maker;
    const seat = text.match(/(?:\[[^\]]+\]\s*)?(\d{1,2})\s*人/);
    if (seat) patch.seatingCapacity = String(Number(seat[1]));
    const kgValues = [...text.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kgValues.length >= 3) {
      patch.maxPayloadKg = kgValues[0] === "-" ? "-" : String(Number(kgValues[0]));
      patch.vehicleWeightKg = String(Number(kgValues[1]));
      patch.grossVehicleWeightKg = String(Number(kgValues[2]));
    }
  }

  // Chassis / dimensions / four axle weights.
  const chassisValue = lineAfter(lines, (t) => t.includes("車台番号") && t.includes("長さ") && t.includes("幅") && t.includes("高さ") && t.includes("前前軸重") && t.includes("後後軸重"));
  if (chassisValue) {
    const text = norm(chassisValue.text).toUpperCase();
    const m = text.match(/([A-Z]{1,5}[A-Z0-9]{2,8}-[0-9O]{4,12})\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg/i);
    if (m) {
      patch.chassisNumber = m[1].replace(/O/g, "0");
      patch.lengthCm = String(Number(m[2]));
      patch.widthCm = String(Number(m[3]));
      patch.heightCm = String(Number(m[4]));
      patch.frontFrontAxleWeightKg = m[5] === "-" ? "-" : String(Number(m[5]));
      patch.frontRearAxleWeightKg = m[6] === "-" ? "-" : String(Number(m[6]));
      patch.rearFrontAxleWeightKg = m[7] === "-" ? "-" : String(Number(m[7]));
      patch.rearRearAxleWeightKg = m[8] === "-" ? "-" : String(Number(m[8]));
    }
  }

  // Model / engine / displacement / fuel / designation / classification.
  const engineValue = lineAfter(lines, (t) => t.includes("型式") && t.includes("原動機の型式") && t.includes("総排気量又は定格出力") && t.includes("燃料の種類") && t.includes("型式指定番号") && t.includes("類別区分番号"));
  if (engineValue) {
    let text = norm(engineValue.text).toUpperCase();
    // Some PDFs expose the unit (kW) as a separate text row between the label and the values.
    if (/^KW$/i.test(text)) {
      const idx = lines.indexOf(engineValue);
      if (idx >= 0 && lines[idx + 1]) text = norm(lines[idx + 1].text).toUpperCase();
    }
    const m = text.match(/((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14})\s+([A-Z0-9]{2,8}-[A-Z0-9]{2,10})\s+(\d+(?:\.\d+)?)\s*(L|KW)?\s+(軽油|ガソリン|揮発油|電気|LPG|CNG|水素)\s+(\d{1,6})\s+(\d{4})/i);
    if (m) {
      patch.model = m[1];
      patch.engineModel = m[2];
      patch.displacementOrRatedOutput = `${m[3]}${m[4] || ""}`;
      patch.fuel = m[5];
      patch.modelDesignationNumber = m[6];
      patch.classificationNumber = m[7];
    }
  }

  const userNameLine = findLine(lines, (t) => t.includes("使用者の氏名又は名称"));
  if (userNameLine) {
    const value = cleanCompanyOrAddress(userNameLine.text);
    if (value && value !== compact(userNameLine.text)) patch.userName = value;
  }
  const userAddressLine = findLine(lines, (t) => t.includes("使用者の住所"));
  if (userAddressLine) {
    const value = cleanCompanyOrAddress(userAddressLine.text);
    if (value) patch.userAddress = value;
  }

  const expiryValue = lineAfter(lines, (t) => t.includes("有効期間の満了する日") && t.includes("車検期間"));
  if (expiryValue) {
    const value = jpDate(expiryValue.text);
    if (value) patch.inspectionExpiry = value;
  }

  return patch;
}

async function readRowPatch(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const chosen = await choosePage(pdf);
    const lines = buildLines(chosen.tokens);
    return { patch: parseRows(lines), lines };
  } finally {
    await pdf.destroy?.().catch?.(() => {});
  }
}

export default function CertificatePdfRowCorrector() {
  useLayoutEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let correcting = false;

    const applyCorrection = () => {
      if (dead || correcting) return;
      const base = window[PDF_PRIORITY_KEY];
      const row = window[ROW_PRIORITY_KEY];
      if (!base || !row || typeof base !== "object" || typeof row !== "object") return;
      const merged = { ...base, ...row };
      if (JSON.stringify(base) === JSON.stringify(merged)) return;
      window[PDF_PRIORITY_KEY] = merged;
      correcting = true;
      try {
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: merged }));
      } finally {
        correcting = false;
      }
    };

    const onChange = async (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file) return;
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      window[ROW_PRIORITY_KEY] = null;
      if (!isPdf) return;
      try {
        const result = await readRowPatch(file);
        if (dead) return;
        window[ROW_PRIORITY_KEY] = result.patch;
        applyCorrection();
      } catch (error) {
        console.warn("PDF row correction skipped", error);
      }
    };

    const onAuthority = () => {
      if (!correcting) applyCorrection();
    };

    // Window capture runs before the document-capture native reader, which intentionally stops propagation.
    window.addEventListener("change", onChange, true);
    window.addEventListener(AUTH_EVENT, onAuthority);
    return () => {
      dead = true;
      window.removeEventListener("change", onChange, true);
      window.removeEventListener(AUTH_EVENT, onAuthority);
    };
  }, []);

  return null;
}
