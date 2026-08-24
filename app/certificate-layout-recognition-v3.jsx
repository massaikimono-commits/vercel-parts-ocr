"use client";

import { useEffect } from "react";
import {
  createDocumentRecognitionSession,
  createSharedTesseractWorker,
  recognizeDocumentRegion,
  OCR_FIELD_PRESETS,
} from "./lib/document-recognition-v2";
import {
  extractOcrTokens,
  findConsensusLabelAnchors,
} from "./lib/document-layout-recognition";
import { inferGridValueRegions } from "./lib/document-grid-cells";

const AUTH_EVENT = "vehicle-certificate-authoritative";

// Labels define document semantics, never sample values. Extra labels are deliberately
// included even when we do not extract them: they act as neighboring cell boundaries.
const LABELS = {
  recordDate: ["記録年月日"],
  registrationNumber: ["自動車登録番号又は車両番号", "自動車登録番号", "車両番号"],
  chassisNumber: ["車台番号"],
  registrationDate: ["登録年月日／交付年月日", "登録年月日", "交付年月日"],
  firstRegistration: ["初度検査年月", "初度登録年月"],
  inspectionExpiry: ["有効期間の満了する日"],
  engineModel: ["原動機の型式", "原動機型式"],
  vehicleWeightKg: ["車両重量"],
  grossVehicleWeightKg: ["車両総重量"],
  lengthCm: ["長さ"],
  widthCm: ["幅"],
  heightCm: ["高さ"],
  frontAxleKg: ["前軸重"],
  rearAxleKg: ["後軸重"],
};

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー−]/g, "-")
    .replace(/[\u3000\t\r]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function compact(value = "") {
  return norm(value).toUpperCase().replace(/\s+/g, "");
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function section(title) {
  return [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function fieldInput(labelText) {
  const card = section("車検証読み取り情報");
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (title !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function debugHost() {
  return section("車検証から読み取る");
}

function showDebug(state, lines = []) {
  const host = debugHost();
  if (!host) return;
  let box = document.getElementById("certificate-layout-recognition-v3-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-layout-recognition-v3-debug";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #cfd8e6";
    box.style.borderRadius = "12px";
    box.innerHTML = '<summary style="font-weight:800">共通セル境界OCR v3（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = [`状態: ${state}`, ...lines].join("\n");
}

function numericGroup(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8")
    .replace(/[^0-9]/g, "");
}

function extractRegistration(value = "") {
  const text = norm(value)
    .replace(/自動車登録番号又は車両番号/g, " ")
    .replace(/自動車登録番号/g, " ")
    .replace(/車両番号/g, " ");
  const pattern = /([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9OQDGIL|SZB]{3})\s*([ぁ-ん])\s*([0-9OQDGIL|SZB]{1,4})/g;
  for (const match of text.matchAll(pattern)) {
    const klass = numericGroup(match[2]);
    const serial = numericGroup(match[4]);
    if (klass.length === 3 && serial.length >= 1 && serial.length <= 4) {
      return `${match[1]} ${klass} ${match[3]} ${serial}`;
    }
  }
  return "";
}

function cleanCode(value = "") {
  return compact(value)
    .replace(/[OQ](?=\d)|(?<=\d)[OQ]/g, "0")
    .replace(/[I|!](?=\d)|(?<=\d)[I|!]/g, "1");
}

function extractChassis(value = "") {
  const text = cleanCode(value).replace(/車台番号/g, "");
  for (const match of text.matchAll(/[A-Z0-9]{1,10}-[A-Z0-9]{4,12}/g)) {
    if (/[A-Z]/.test(match[0]) && /\d/.test(match[0])) return match[0];
  }
  for (const match of text.matchAll(/[A-HJ-NPR-Z0-9]{17}/g)) {
    if (/[A-Z]/.test(match[0]) && /\d/.test(match[0])) return match[0];
  }
  return "";
}

function extractEngine(value = "") {
  const text = cleanCode(value)
    .replace(/原動機の型式/g, "")
    .replace(/原動機型式/g, "");
  const model = cleanCode(fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "");
  for (const match of text.matchAll(/[A-Z0-9]{2,9}-[A-Z0-9]{2,9}/g)) {
    const candidate = match[0];
    if (!/[A-Z]/.test(candidate) || !/\d/.test(candidate)) continue;
    if (model && (candidate === model || model.endsWith(candidate))) continue;
    return candidate;
  }
  for (const match of text.matchAll(/(?:^|[^A-Z0-9])([A-Z]{1,4}\d[A-Z0-9]{1,6})(?:$|[^A-Z0-9])/g)) {
    const candidate = match[1];
    if (model && model.includes(candidate)) continue;
    return candidate;
  }
  return "";
}

function normalizeJapaneseDate(value = "") {
  let text = norm(value)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/\s+/g, "")
    .replace(/(\d{1,2})[RＲ](?=\d{1,2}[日HＢB己昌曰])/g, "$1月")
    .replace(/(\d{1,2})[HＢB己昌曰](?![A-Za-z0-9])/g, "$1日")
    .replace(/(\d{1,2})H$/g, "$1日");
  const match = text.match(/(令和|平成|昭和)([0-9OQDGIL|SZB]{1,2})年?([0-9OQDGIL|SZB]{1,2})月?([0-9OQDGIL|SZB]{1,2})日?/);
  if (!match) return "";
  const year = Number(numericGroup(match[2]));
  const month = Number(numericGroup(match[3]));
  const day = Number(numericGroup(match[4]));
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${match[1]}${year}年${month}月${day}日`;
}

function numberExtractor(min, max) {
  return value => {
    const groups = norm(value).match(/[0-9OQDGIL|SZB]{1,6}/g) || [];
    for (const group of groups) {
      const digits = numericGroup(group);
      if (!digits) continue;
      const n = Number(digits);
      if (n >= min && n <= max) return String(n);
    }
    return "";
  };
}

function editDistance(a = "", b = "") {
  const x = String(a);
  const y = String(b);
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (x[i - 1] === y[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[y.length];
}

function similarity(a, b) {
  const x = compact(a);
  const y = compact(b);
  if (!x || !y) return 0;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length, 1);
}

function tokensInsideRegion(tokens, region, pageWidth, pageHeight) {
  const x0 = region.x * pageWidth;
  const y0 = region.y * pageHeight;
  const x1 = (region.x + region.width) * pageWidth;
  const y1 = (region.y + region.height) * pageHeight;
  return tokens
    .filter(token => {
      const cx = (token.bbox.x0 + token.bbox.x1) / 2;
      const cy = (token.bbox.y0 + token.bbox.y1) / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    })
    .sort((a, b) => {
      const ay = (a.bbox.y0 + a.bbox.y1) / 2;
      const by = (b.bbox.y0 + b.bbox.y1) / 2;
      const h = Math.max(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0);
      if (Math.abs(ay - by) <= h * 0.8) return a.bbox.x0 - b.bbox.x0;
      return ay - by;
    });
}

function seedEvidence(tokenSets, region, pageWidth, pageHeight, extract) {
  const evidence = [];
  for (const set of tokenSets) {
    const tokens = tokensInsideRegion(set.tokens, region, pageWidth, pageHeight);
    if (!tokens.length) continue;
    const raw = tokens.map(token => token.text).join(" ");
    const value = extract(raw);
    if (!value) continue;
    let weighted = 0;
    let chars = 0;
    for (const token of tokens) {
      const n = Math.max(1, [...String(token.text).replace(/\s/g, "")].length);
      weighted += token.confidence * n;
      chars += n;
    }
    const confidence = chars ? weighted / chars / 100 : 0.5;
    evidence.push({ value, weight: 0.75 + confidence, source: `${set.name}:layout`, confidence });
  }
  return evidence;
}

function fuseEvidence(evidence, fuzzy = false) {
  if (!evidence.length) return null;
  const groups = [];
  for (const item of evidence) {
    let group = null;
    for (const candidate of groups) {
      if (fuzzy ? similarity(candidate[0].value, item.value) >= 0.66 : compact(candidate[0].value) === compact(item.value)) {
        group = candidate;
        break;
      }
    }
    if (group) group.push(item);
    else groups.push([item]);
  }
  groups.sort((a, b) => b.reduce((s, x) => s + x.weight, 0) - a.reduce((s, x) => s + x.weight, 0));
  const winner = groups[0];
  // The representative is the strongest individual observation, not an invented string.
  // Whole-page TSV geometry gets a slight preference because it sees the cell in context.
  const representative = [...winner].sort((a, b) => {
    const score = item => item.weight + (String(item.source).includes(":layout") ? 0.22 : 0);
    return score(b) - score(a);
  })[0];
  return {
    value: representative.value,
    score: winner.reduce((sum, item) => sum + item.weight, 0),
    support: winner.length,
    sources: winner.map(item => item.source),
    members: winner,
  };
}

function canonicalCode(value = "") {
  return compact(value)
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function refineChassisWithModel(value = "") {
  if (!value.includes("-")) return value;
  const [prefix, ...rest] = value.split("-");
  const suffix = rest.join("-");
  const model = cleanCode(fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "");
  const core = model.includes("-") ? model.split("-").pop() : model;
  if (!core || core.length < 3) return value;

  const sameByConfusions = candidate => candidate.length === core.length && canonicalCode(candidate) === canonicalCode(core);
  if (sameByConfusions(prefix)) return `${core}-${suffix}`;
  if (prefix.length === core.length + 1) {
    if (sameByConfusions(prefix.slice(1))) return `${core}-${suffix}`;
    if (sameByConfusions(prefix.slice(0, -1))) return `${core}-${suffix}`;
  }
  return value;
}

function qrHas(key) {
  const qr = window.__vehicleCertificateQrPriority || {};
  if (key === "frontAxleKg") return Boolean(qr.frontFrontAxleWeightKg || qr.frontRearAxleWeightKg);
  if (key === "rearAxleKg") return Boolean(qr.rearRearAxleWeightKg || qr.rearFrontAxleWeightKg);
  return Boolean(qr[key]);
}

const SPECS = {
  registrationNumber: { profile: { ...OCR_FIELD_PRESETS.japaneseText, minSimilarity: 0.50 }, extract: extractRegistration, prefer: "right", fuzzy: false, output: "registrationNumber" },
  chassisNumber: { profile: { ...OCR_FIELD_PRESETS.code, minSimilarity: 0.54 }, extract: extractChassis, prefer: "right", fuzzy: true, output: "chassisNumber" },
  registrationDate: { profile: { ...OCR_FIELD_PRESETS.date, minSimilarity: 0.50 }, extract: normalizeJapaneseDate, prefer: "below", fuzzy: false, output: "registrationDate" },
  recordDate: { profile: { ...OCR_FIELD_PRESETS.date, minSimilarity: 0.50 }, extract: normalizeJapaneseDate, prefer: "below", fuzzy: false, output: "recordDate" },
  engineModel: { profile: { ...OCR_FIELD_PRESETS.code, minSimilarity: 0.52 }, extract: extractEngine, prefer: "right", fuzzy: true, output: "engineModel" },
  vehicleWeightKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(100, 50000), prefer: "below", fuzzy: false, output: "vehicleWeightKg" },
  grossVehicleWeightKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(100, 80000), prefer: "below", fuzzy: false, output: "grossVehicleWeightKg" },
  lengthCm: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(100, 3000), prefer: "below", fuzzy: false, output: "lengthCm" },
  widthCm: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(50, 500), prefer: "below", fuzzy: false, output: "widthCm" },
  heightCm: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(50, 600), prefer: "below", fuzzy: false, output: "heightCm" },
  frontAxleKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(0, 50000), prefer: "below", fuzzy: false, output: "frontFrontAxleWeightKg" },
  rearAxleKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(0, 50000), prefer: "below", fuzzy: false, output: "rearRearAxleWeightKg" },
};

async function readField(session, worker, anchor, anchors, tokenSets, spec) {
  const page = session.prepared.normalized;
  const regions = inferGridValueRegions(anchor, anchors, page.width, page.height);
  const ordered = [...regions].sort((a, b) => {
    const ap = a.direction === spec.prefer ? 0.28 : 0;
    const bp = b.direction === spec.prefer ? 0.28 : 0;
    return (b.geometryScore + bp) - (a.geometryScore + ap);
  });
  const attempts = [];

  for (const item of ordered) {
    const evidence = seedEvidence(tokenSets, item.region, page.width, page.height, spec.extract);
    const result = await recognizeDocumentRegion(session, worker, item.region, {
      ...spec.profile,
      minSupport: 2,
      strongSupport: 2,
      strongConfidence: 0.80,
      validate: value => Boolean(spec.extract(value)),
    });
    for (const observation of result.observations || []) {
      const value = spec.extract(observation.text);
      if (!value) continue;
      evidence.push({
        value,
        weight: 0.45 + Math.max(0, Math.min(1, Number(observation.confidence || 0) / 100)),
        source: `${observation.variant || "ocr"}:PSM${observation.psm ?? "?"}`,
        confidence: Number(observation.confidence || 0) / 100,
      });
    }
    if (result.value) {
      const value = spec.extract(result.value);
      if (value) evidence.push({ value, weight: 0.42 + result.confidence, source: "ensemble", confidence: result.confidence });
    }

    const fused = fuseEvidence(evidence, spec.fuzzy);
    if (!fused) continue;
    const directionBonus = item.direction === spec.prefer ? 0.32 : 0;
    const score = fused.score + item.geometryScore + directionBonus + Math.min(0.45, fused.support * 0.08);
    attempts.push({ ...fused, score, direction: item.direction, geometryScore: item.geometryScore });
  }

  attempts.sort((a, b) => b.score - a.score);
  return attempts[0] || null;
}

export default function CertificateLayoutRecognitionV3() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let token = 0;
    let stopped = false;

    const onChange = async event => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const myToken = ++token;

      try {
        showDebug("画像前処理中");
        const session = await createDocumentRecognitionSession(file, {
          maxSide: 3900,
          cropPaper: true,
          minPaperConfidence: 0.45,
        });
        if (stopped || myToken !== token) return;

        const { worker, tesseract } = await createSharedTesseractWorker();
        try {
          const waitedUntil = Date.now() + 18000;
          while (!stopped && myToken === token && document.querySelector(".progress") && Date.now() < waitedUntil) {
            await new Promise(resolve => setTimeout(resolve, 350));
          }

          await worker.setParameters({
            tessedit_pageseg_mode: String(tesseract.PSM?.SPARSE_TEXT ?? "11"),
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
            tessedit_char_whitelist: "",
          });

          const layoutVariants = [
            ["original", session.prepared.variants.original],
            ["contrast", session.prepared.variants.contrast],
            ["adaptiveBinary", session.prepared.variants.adaptiveBinary],
          ];
          const tokenSets = [];
          const counts = [];
          for (const [name, canvas] of layoutVariants) {
            if (stopped || myToken !== token) return;
            const layout = await worker.recognize(canvas, {}, { text: true, blocks: true, tsv: true });
            const tokens = extractOcrTokens(layout?.data);
            tokenSets.push({ name, tokens });
            counts.push(`${name}=${tokens.length}`);
          }

          const page = session.prepared.normalized;
          const consensus = findConsensusLabelAnchors(tokenSets, LABELS, {
            pageWidth: page.width,
            pageHeight: page.height,
            minSimilarity: 0.58,
            maxTokens: 10,
          });
          const anchors = consensus.anchors;
          const lines = [
            `OCRトークン数: ${counts.join(" / ")}`,
            `台形補正: ${session.geometry.perspectiveApplied ? `適用 conf=${session.geometry.perspectiveConfidence.toFixed(2)}` : "不要/保留"}`,
            `傾き補正: ${session.geometry.deskewApplied ? `${session.geometry.deskewAngle.toFixed(2)}°` : "不要/保留"}`,
          ];

          for (const [key, labels] of Object.entries(LABELS)) {
            const anchor = anchors[key];
            lines.push(`${key}: ${anchor ? `${anchor.matchedText} conf=${anchor.confidence.toFixed(2)} support=${consensus.support[key] || 1}` : `未検出 (${labels[0]})`}`);
          }
          showDebug("ラベルとセル境界を検出完了", lines);

          const patch = {};
          for (const [key, spec] of Object.entries(SPECS)) {
            if (stopped || myToken !== token) return;
            if (qrHas(key)) {
              lines.push(`${key}: QRあり → OCR省略`);
              continue;
            }
            const anchor = anchors[key];
            if (!anchor) {
              lines.push(`${key}: ラベル未検出 → 保留`);
              continue;
            }
            const result = await readField(session, worker, anchor, anchors, tokenSets, spec);
            if (!result?.value) {
              lines.push(`${key}: 保留`);
              continue;
            }
            let value = result.value;
            if (key === "chassisNumber") value = refineChassisWithModel(value);
            patch[spec.output] = value;
            lines.push(`${key}: ${value} / ${result.direction} / evidence=${result.support} / score=${result.score.toFixed(2)}`);
            showDebug("セル単位OCR進行中", lines);
          }

          // Cross-field validation is generic and only rejects impossible combinations.
          if (patch.vehicleWeightKg && patch.grossVehicleWeightKg) {
            if (Number(patch.grossVehicleWeightKg) < Number(patch.vehicleWeightKg)) {
              delete patch.vehicleWeightKg;
              delete patch.grossVehicleWeightKg;
              lines.push("重量: 車両総重量 < 車両重量 のため両方保留");
            }
          }

          if (Object.keys(patch).length) {
            window.__vehicleCertificateLayoutV3Patch = patch;
            for (let i = 0; i < 9; i += 1) {
              if (stopped || myToken !== token) return;
              window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
              await new Promise(resolve => setTimeout(resolve, 420));
            }
          }
          showDebug("セル境界OCR v3 完了", lines);
        } finally {
          await worker.terminate().catch(() => {});
        }
      } catch (error) {
        showDebug("セル境界OCR v3 エラー", [String(error?.message || error)]);
      }
    };

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      token += 1;
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
