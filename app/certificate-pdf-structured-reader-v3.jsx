"use client";

import { useLayoutEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const PDF_PRIORITY_KEY = "__vehicleCertificatePdfPriority";
const QR_PRIORITY_KEY = "__vehicleCertificateQrPriority";
const PASS_KEY = "pdfStructuredV3PassThrough";

const MAKERS = ["トヨタ", "レクサス", "日産", "ニッサン", "ホンダ", "三菱", "マツダ", "スバル", "スズキ", "ダイハツ", "いすゞ", "日野", "UDトラックス", "メルセデス・ベンツ", "フォルクスワーゲン", "アウディ", "BMW", "ボルボ"];
const BODY_TYPES = ["キャブオーバ", "ステーションワゴン", "ボンネット", "ピックアップ", "トラック", "ダンプ", "セダン", "箱型", "バン", "バス", "幌型"];

function makerFromText(text) {
  const raw = norm(text);
  const dense = compact(raw);
  return MAKERS.find((value) => raw.includes(value) || dense.includes(compact(value))) || "";
}

function bodyTypeFromText(text) {
  const dense = compact(text);
  return BODY_TYPES.find((value) => dense.includes(compact(value))) || "";
}

function norm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compact(value) {
  return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
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

function buildLines(tokens) {
  const lines = [];
  for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - token.y) <= Math.max(0.0045, token.h * 0.72));
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

function findLineIndex(lines, matcher) {
  return lines.findIndex((line) => matcher(compact(line.text)));
}

function nextNonEmptyLine(lines, index, maxAhead = 4) {
  if (index < 0) return null;
  for (let i = index + 1; i < Math.min(lines.length, index + 1 + maxAhead); i += 1) {
    if (norm(lines[i]?.text)) return { line: lines[i], index: i };
  }
  return null;
}

function valueAfterLabel(line, label) {
  if (!line?.tokens?.length) return "";
  const wanted = compact(label);
  let joined = "";
  for (let i = 0; i < line.tokens.length; i += 1) {
    joined += compact(line.tokens[i].text);
    if (joined.includes(wanted)) {
      return norm(line.tokens.slice(i + 1).map((token) => token.text).join(" "));
    }
    if (joined.length > wanted.length + 40) break;
  }
  const whole = norm(line.text);
  const dense = compact(whole);
  const at = dense.indexOf(wanted);
  if (at < 0) return "";
  return "";
}

function parseStructured(lines) {
  const patch = {};
  const allText = lines.map((line) => line.text).join("\n");
  const put = (key, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      patch[key] = String(value).trim();
    }
  };
  const rowText = (index) => norm(lines[index]?.text || "");
  const joinedAfter = (index, count = 3) =>
    lines
      .slice(Math.max(0, index + 1), Math.min(lines.length, index + 1 + count))
      .map((line) => norm(line.text))
      .filter(Boolean)
      .join(" ");

  // 作成日付（記録年月日）
  const firstLine = lines.find((line) => compact(line.text).includes("作成日付"));
  if (firstLine) {
    const m = norm(firstLine.text).match(
      /作成日付\s*[:：]?\s*((?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年?\s*\d{1,2}\s*月?\s*\d{1,2}\s*日?)/
    );
    if (m) put("recordDate", jpDate(m[1]));
  }

  // 普通車/軽自動車の双方に対応。
  // 軽自動車の記録事項PDFでは「車両番号」「交付年月日」「初度検査年月」と表記される。
  const topHeader = findLineIndex(
    lines,
    (t) =>
      (t.includes("自動車登録番号又は車両番号") || t.includes("車両番号")) &&
      (t.includes("初度登録年月") || t.includes("初度検査年月")) &&
      t.includes("車体の形状")
  );
  const topValue = nextNonEmptyLine(lines, topHeader, 3)?.line;
  if (topValue) {
    const text = norm(topValue.text);
    put("registrationNumber", registration(text));
    const dates = [
      ...text.matchAll(
        /(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?(?:\s*(\d{1,2})\s*日?)?/g
      ),
    ];
    if (dates[0]) put("registrationDate", jpDate(dates[0][0]));
    if (dates[1]) put("firstRegistration", jpMonth(dates[1][0]));
    put("vehicleClass", ["普通", "小型", "軽自動車", "大型特殊"].find((v) => text.includes(v)) || "");
    put("purpose", ["乗用", "貨物", "乗合", "特種"].find((v) => text.includes(v)) || "");
    put("privateBusiness", ["自家用", "事業用"].find((v) => text.includes(v)) || "");
    put("bodyShape", bodyTypeFromText(text));
  }

  // 普通車の車名/重量行。
  const weightHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("車名") &&
      t.includes("乗車定員") &&
      t.includes("最大積載量") &&
      t.includes("車両重量") &&
      t.includes("車両総重量")
  );
  const weightValue = nextNonEmptyLine(lines, weightHeader, 3)?.line;
  if (weightValue) {
    const text = norm(weightValue.text);
    put("vehicleName", makerFromText(text));
    const seat = text.match(/(?:\[[^\]]+\]\s*)?(\d{1,2})\s*人/);
    if (seat) put("seatingCapacity", String(Number(seat[1])));
    const kg = [...text.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kg.length >= 3) {
      put("maxPayloadKg", kg[0] === "-" ? "-" : String(Number(kg[0])));
      put("vehicleWeightKg", kg[1] === "-" ? "-" : String(Number(kg[1])));
      put("grossVehicleWeightKg", kg[2] === "-" ? "-" : String(Number(kg[2])));
    }
  }

  // 軽自動車の記録事項PDFは、車台番号・定員・重量・寸法を同じ見出しにし、
  // 値を2行に分けることがある。ブラケット内の管理値は無視し、単位付き値を採用する。
  const keiChassisHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("車台番号") &&
      t.includes("乗車定員") &&
      t.includes("最大積載量") &&
      t.includes("車両重量") &&
      t.includes("長さ") &&
      t.includes("幅") &&
      t.includes("高さ")
  );
  if (keiChassisHeader >= 0) {
    const text = joinedAfter(keiChassisHeader, 3).toUpperCase();
    const chassis = text.match(/\b([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\b/i);
    if (chassis) put("chassisNumber", chassis[1].replace(/O/g, "0"));

    const seat = text.match(/(\d{1,2})\s*人/);
    if (seat) put("seatingCapacity", String(Number(seat[1])));

    const kg = [...text.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kg.length >= 3) {
      put("maxPayloadKg", kg[0] === "-" ? "-" : String(Number(kg[0])));
      put("vehicleWeightKg", kg[1] === "-" ? "-" : String(Number(kg[1])));
      put("grossVehicleWeightKg", kg[2] === "-" ? "-" : String(Number(kg[2])));
    }

    const cm = [...text.matchAll(/(\d{2,4})\s*cm/gi)].map((m) => m[1]);
    if (cm.length >= 3) {
      put("lengthCm", String(Number(cm[0])));
      put("widthCm", String(Number(cm[1])));
      put("heightCm", String(Number(cm[2])));
    }
  }

  // 普通車の車台番号・寸法・4軸重。
  const dimensionHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("車台番号") &&
      t.includes("長さ") &&
      t.includes("幅") &&
      t.includes("高さ") &&
      t.includes("前前軸重") &&
      t.includes("後後軸重")
  );
  const dimensionValue = nextNonEmptyLine(lines, dimensionHeader, 3)?.line;
  if (dimensionValue) {
    const text = norm(dimensionValue.text).toUpperCase();
    const m = text.match(
      /([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg/i
    );
    if (m) {
      put("chassisNumber", m[1].replace(/O/g, "0"));
      put("lengthCm", String(Number(m[2])));
      put("widthCm", String(Number(m[3])));
      put("heightCm", String(Number(m[4])));
      put("frontFrontAxleWeightKg", m[5] === "-" ? "-" : String(Number(m[5])));
      put("frontRearAxleWeightKg", m[6] === "-" ? "-" : String(Number(m[6])));
      put("rearFrontAxleWeightKg", m[7] === "-" ? "-" : String(Number(m[7])));
      put("rearRearAxleWeightKg", m[8] === "-" ? "-" : String(Number(m[8])));
    }
  }

  // 型式・原動機・排気量・燃料・指定番号・類別番号。
  // 値の並びは普通車と軽自動車で異なるため、1本の厳しい正規表現に依存しない。
  const modelHeader = findLineIndex(
    lines,
    (t) =>
      t.includes("型式") &&
      t.includes("原動機の型式") &&
      t.includes("総排気量又は定格出力") &&
      t.includes("燃料の種類") &&
      t.includes("型式指定番号") &&
      t.includes("類別区分番号")
  );
  if (modelHeader >= 0) {
    let next = nextNonEmptyLine(lines, modelHeader, 4);
    if (next && /^KW$/i.test(norm(next.line.text))) next = nextNonEmptyLine(lines, next.index, 2);
    if (next) {
      const raw = norm(next.line.text);
      const text = raw.toUpperCase();

      put("vehicleName", makerFromText(raw) || patch.vehicleName || "");

      const modelMatch = text.match(/\b((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{2,14})\b/i);
      if (modelMatch) {
        put("model", modelMatch[1]);
        const rest = text.slice((modelMatch.index || 0) + modelMatch[0].length).trim();
        const engine = rest.match(/^([A-Z0-9]{2,10}(?:-[A-Z0-9]{2,10})?)(?:\s|$)/i);
        if (engine && !["L", "KW"].includes(engine[1].toUpperCase())) put("engineModel", engine[1]);
      }

      const fuel = ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"].find((v) =>
        raw.includes(v)
      );
      if (fuel) put("fuel", fuel);

      let displacement = null;
      if (fuel) {
        displacement =
          raw.match(new RegExp("(\\d+(?:\\.\\d+)?)\\s*(L|kW|KW)\\s+" + fuel, "i")) ||
          raw.match(new RegExp(fuel + "\\s+(\\d+(?:\\.\\d+)?)\\s*(L|kW|KW)", "i"));
      }
      if (!displacement) displacement = raw.match(/(\d+(?:\.\d+)?)\s*(L|kW|KW)\b/i);
      if (displacement) {
        put(
          "displacementOrRatedOutput",
          String(displacement[1]) + " " + String(displacement[2]).toUpperCase()
        );
      }

      const tail = text.match(/(?:^|\s)(\d{4,6})\s+(\d{4})\s*$/);
      if (tail) {
        put("modelDesignationNumber", tail[1]);
        put("classificationNumber", tail[2]);
      }

      // 軽自動車では「前軸重」「後軸重」の2値。4軸形式の互換フィールドに安全に割り当てる。
      const headerDense = compact(rowText(modelHeader));
      const axleKg = [...raw.matchAll(/(\d{1,5})\s*kg/gi)].map((m) => m[1]);
      if (headerDense.includes("前軸重") && headerDense.includes("後軸重") && axleKg.length >= 2) {
        put("frontFrontAxleWeightKg", String(Number(axleKg[0])));
        put("rearRearAxleWeightKg", String(Number(axleKg[1])));
      }
    }
  }

  // 使用者情報。通常レイアウトを優先。
  const userNameLine = lines.find((line) => compact(line.text).includes("使用者の氏名又は名称"));
  if (userNameLine) {
    put(
      "userName",
      valueAfterLabel(userNameLine, "使用者の氏名又は名称")
        .replace(/\s*\[[0-9\s]+\]\s*$/, "")
        .trim()
    );
  }
  const userAddressLine = lines.find(
    (line) => compact(line.text).includes("使用者の住所") && !compact(line.text).includes("所有者の住所")
  );
  if (userAddressLine) {
    put(
      "userAddress",
      valueAfterLabel(userAddressLine, "使用者の住所")
        .replace(/\s*\[[0-9\s]+\]\s*$/, "")
        .trim()
    );
  }

  // 軽自動車PDFでは「使 / 用 / 者」が縦方向に分割される場合がある。
  if (!patch.userName) {
    const sectionStart = Math.max(0, modelHeader + 1);
    const baseIndex = findLineIndex(lines, (t) => t.includes("使用の本拠の位置"));
    const sectionEnd = Math.min(lines.length, baseIndex >= 0 ? baseIndex : sectionStart + 12);
    for (let i = sectionStart; i < sectionEnd; i += 1) {
      const text = norm(lines[i].text);
      const dense = compact(text);
      if (!dense.includes("氏名又は名称")) continue;
      const value = text.replace(/^.*?氏名又は名称\s*/, "").trim();
      if (value && value !== "使用者に同じ" && !value.includes("所有者")) {
        put("userName", value.replace(/\s*\[[0-9\s]+\]\s*$/, "").trim());
        for (let j = i + 1; j < Math.min(sectionEnd, i + 5); j += 1) {
          const addressText = norm(lines[j].text);
          if (!compact(addressText).includes("住所")) continue;
          const address = addressText
            .replace(/^.*?住\s*所\s*/, "")
            .replace(/\s*\[[0-9\s]+\]\s*$/, "")
            .trim();
          if (address && address !== "使用者に同じ") put("userAddress", address);
          break;
        }
        break;
      }
    }
  }

  // 使用の本拠は値が無いPDFでは空欄のまま。
  const baseLine = lines.find((line) => compact(line.text).includes("使用の本拠の位置"));
  if (baseLine) {
    const base = valueAfterLabel(baseLine, "使用の本拠の位置").trim();
    if (base && base.length <= 100) put("baseLocation", base);
  }

  // 有効期限。軽自動車PDFでは追加情報行を挟むことがあるので数行先まで探す。
  const expiryHeader = findLineIndex(lines, (t) => t.includes("有効期間の満了する日"));
  if (expiryHeader >= 0) {
    for (let i = expiryHeader; i < Math.min(lines.length, expiryHeader + 7); i += 1) {
      const value = jpDate(lines[i].text);
      if (value) {
        put("inspectionExpiry", value);
        break;
      }
    }
  }

  // 全体からの安全な補完（構造行に無かった時のみ）。
  if (!patch.registrationNumber) put("registrationNumber", registration(allText));
  if (!patch.vehicleName) put("vehicleName", makerFromText(allText));

  const required = [
    "registrationNumber",
    "chassisNumber",
    "model",
    "vehicleName",
    "registrationDate",
    "firstRegistration",
    "vehicleClass",
    "purpose",
    "privateBusiness",
    "bodyShape",
    "seatingCapacity",
    "maxPayloadKg",
    "vehicleWeightKg",
    "grossVehicleWeightKg",
    "lengthCm",
    "widthCm",
    "heightCm",
    "frontFrontAxleWeightKg",
    "frontRearAxleWeightKg",
    "rearFrontAxleWeightKg",
    "rearRearAxleWeightKg",
    "engineModel",
    "displacementOrRatedOutput",
    "fuel",
    "modelDesignationNumber",
    "classificationNumber",
    "userName",
    "userAddress",
    "inspectionExpiry",
  ];
  const found = required.filter(
    (key) => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== ""
  ).length;
  const strong = Boolean(
    patch.registrationNumber &&
      patch.chassisNumber &&
      patch.model &&
      patch.vehicleName &&
      patch.vehicleWeightKg &&
      patch.grossVehicleWeightKg &&
      patch.lengthCm &&
      patch.widthCm &&
      patch.heightCm &&
      patch.engineModel &&
      patch.fuel &&
      found >= 22
  );
  return { patch, found, strong, lines, allText };
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

async function pageTokens(page) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return (content.items || []).map((item) => tokenFromItem(item, viewport.width, viewport.height)).filter(Boolean);
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

async function renderPage(pdf, pageNumber, targetWidth = 1800) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(4, targetWidth / Math.max(1, base.width)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function cropLower(source) {
  const y = Math.round(source.height * 0.48);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height - y;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, y, source.width, source.height - y, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function hasQr(canvas) {
  try {
    const browser = await import("@zxing/browser");
    const lib = await import("@zxing/library");
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    const reader = new browser.BrowserQRCodeReader(hints);
    for (const source of [canvas, cropLower(canvas)]) {
      try {
        const result = await reader.decodeFromCanvas(source);
        if (result?.getText?.() || result?.text || result?.getRawBytes?.()?.length) return true;
      } catch {}
    }
  } catch {}
  return false;
}

function vehicleCard() {
  return Array.from(document.querySelectorAll("section.card")).find((section) => section.querySelector("h2")?.textContent?.includes("車検証から読み取る")) || null;
}

function showStatus(message, error = false) {
  const card = vehicleCard();
  if (!card) return;
  let box = card.querySelector("[data-pdf-structured-v3-status]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.pdfStructuredV3Status = "1";
    box.style.marginTop = "12px";
    box.style.padding = "14px";
    box.style.borderRadius = "14px";
    box.style.border = "1px solid #a8ddbf";
    box.style.fontWeight = "800";
    card.querySelector(".actions")?.insertAdjacentElement("afterend", box);
  }
  box.textContent = message;
  box.style.background = error ? "#fff1f1" : "#effaf4";
  box.style.borderColor = error ? "#efb7b7" : "#a8ddbf";
  box.style.color = error ? "#922" : "#174c2e";
}

function showDebug(result, tokenCount) {
  const card = vehicleCard();
  if (!card) return;
  let details = card.querySelector("[data-pdf-structured-v3-debug]");
  if (!details) {
    details = document.createElement("details");
    details.dataset.pdfStructuredV3Debug = "1";
    details.style.marginTop = "12px";
    details.innerHTML = "<summary style='font-weight:800;cursor:pointer'>PDF構造読み取り v3 詳細（確認用）</summary><pre style='white-space:pre-wrap;word-break:break-word;max-height:520px;overflow:auto;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px'></pre>";
    card.appendChild(details);
  }
  const pre = details.querySelector("pre");
  if (!pre) return;
  const rows = Object.entries(result.patch).map(([key, value]) => `${key}: ${value}`);
  pre.textContent = [
    `文字トークン: ${tokenCount}`,
    `構造取得: ${result.found}項目 / strong=${result.strong ? "YES" : "NO"}`,
    "",
    ...rows,
    "",
    "--- PDF構造行 ---",
    ...result.lines.map((line) => line.text),
  ].join("\n");
}

function showPreview(canvas) {
  const card = vehicleCard();
  if (!card) return;
  let img = card.querySelector("img[data-pdf-structured-v3-preview]");
  if (!img) {
    img = document.createElement("img");
    img.dataset.pdfStructuredV3Preview = "1";
    img.alt = "PDF車検証プレビュー";
    img.style.display = "block";
    img.style.width = "100%";
    img.style.maxHeight = "560px";
    img.style.objectFit = "contain";
    img.style.borderRadius = "14px";
    img.style.marginTop = "14px";
    img.style.background = "#f4f6fa";
    card.appendChild(img);
  }
  img.src = canvas.toDataURL("image/jpeg", 0.88);
}

function resetForm() {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) => (candidate.textContent || "").includes("＋新規車両"));
  button?.click();
}

function applyPatch(patch) {
  window[PDF_PRIORITY_KEY] = patch;
  window[QR_PRIORITY_KEY] = null;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
}

function passToExisting(input) {
  input.dataset[PASS_KEY] = "1";
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function CertificatePdfStructuredReaderV3() {
  useLayoutEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;

    const onChange = async (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;

      if (input.dataset[PASS_KEY] === "1") {
        delete input.dataset[PASS_KEY];
        return;
      }
      // v2/v1 がフォールバック用に再送したイベントは横取りしない。
      if (input.dataset.pdfNativeV2PassThrough === "1" || input.dataset.pdfNativePassThrough === "1") return;

      const file = input.files?.[0];
      if (!file) return;
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      if (!isPdf) return;

      // PDFはまずこのv3が判断する。十分に構造化できた時だけOCRを完全に止める。
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      showStatus("PDF構造読み取り v3: 文字レイヤーと表の行構造を解析中…");

      try {
        const pdfjs = await loadPdfJs();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        try {
          const chosen = await choosePage(pdf);
          const tokens = chosen.tokens.length ? chosen.tokens : await pageTokens(await pdf.getPage(chosen.pageNumber));
          const parsed = parseStructured(buildLines(tokens));
          const canvas = await renderPage(pdf, chosen.pageNumber, 1800);
          const qrFound = await hasQr(canvas);
          if (dead) return;

          showPreview(canvas);
          showDebug(parsed, tokens.length);

          if (qrFound) {
            showStatus(`PDF ${chosen.pageNumber}ページ目: QRを検出。QR優先ルートへ引き継ぎます。`);
            passToExisting(input);
            return;
          }

          if (!parsed.strong) {
            showStatus(`PDF構造読み取り v3: ${parsed.found}項目。構造確信度不足のため既存OCRへフォールバックします。`);
            passToExisting(input);
            return;
          }

          resetForm();
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (dead) return;
          applyPatch(parsed.patch);
          showStatus(`PDF構造読み取り v3 完了: OCR 0pass / ${parsed.found}項目をPDF文字から直接確定。既存OCRは実行していません。`);
          input.value = "";
        } finally {
          await pdf.destroy?.().catch?.(() => {});
        }
      } catch (error) {
        console.error("PDF structured v3", error);
        showStatus(`PDF構造読み取り v3 エラー: ${error?.message || error}。既存OCRへ切り替えます。`, true);
        passToExisting(input);
      }
    };

    window.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      window.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
