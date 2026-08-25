"use client";

import { useEffect } from "react";
import {
  createDocumentRecognitionSession,
  createSharedTesseractWorker,
  recognizeDocumentRegion,
  OCR_FIELD_PRESETS,
} from "./lib/document-recognition-v2";
import { extractOcrTokens, relativeRegionFromAnchor } from "./lib/document-layout-recognition";
import { findSemanticConsensusLabelAnchors } from "./lib/document-semantic-anchors";
import { inferGridValueRegions } from "./lib/document-grid-cells";
import { createRuledGridDetector } from "./lib/document-ruled-grid";
import { normalizeJapanesePlateRegion } from "./lib/japanese-plate-regions";

const AUTH_EVENT = "vehicle-certificate-authoritative";

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

// Form vocabulary only. No sample values or address-derived identity rules.
const LABEL_RULES = {
  recordDate: { all: ["記録"] },
  registrationNumber: { all: ["番号"], any: ["車両", "登録"] },
  // 番号 is often split/partially lost by OCR, so 台 + 番 is enough for candidacy;
  // visual similarity to 車台番号 still decides the final anchor.
  chassisNumber: { all: ["台"], any: ["番", "番号"] },
  registrationDate: { any: ["交付", "登録"] },
  firstRegistration: { all: ["初度"] },
  inspectionExpiry: { all: ["満了"] },
  engineModel: { all: ["原動機"] },
  vehicleWeightKg: { all: ["車両", "重量"], none: ["総"] },
  grossVehicleWeightKg: { all: ["車両", "総", "重量"] },
  lengthCm: { all: ["長"] },
  widthCm: { all: ["幅"] },
  heightCm: { all: ["高"] },
  frontAxleKg: { all: ["前", "軸"] },
  rearAxleKg: { all: ["後", "軸"] },
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
  let box = document.getElementById("certificate-layout-recognition-v6-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-layout-recognition-v6-debug";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #cfd8e6";
    box.style.borderRadius = "12px";
    box.innerHTML = '<summary style="font-weight:800">共通罫線セルOCR v6（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
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
    const region = normalizeJapanesePlateRegion(match[1]);
    const klass = numericGroup(match[2]);
    const serial = numericGroup(match[4]);
    if (region && klass.length === 3 && serial.length >= 1 && serial.length <= 4) {
      return `${region} ${klass} ${match[3]} ${serial}`;
    }
  }
  return "";
}

function cleanCode(value = "") {
  return compact(value)
    .replace(/[OQ](?=\d)|(?<=\d)[OQ]/g, "0")
    .replace(/[I|!](?=\d)|(?<=\d)[I|!]/g, "1");
}

function canonicalCode(value = "") {
  return compact(value)
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function extractChassis(value = "") {
  const text = cleanCode(value).replace(/車台番号/g, "");
  for (const match of text.matchAll(/[A-Z0-9]{1,10}-[0-9]{4,10}/g)) {
    if (/[A-Z]/.test(match[0])) return match[0];
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
  for (const match of text.matchAll(/[A-Z0-9]{2,7}-[A-Z0-9]{2,7}/g)) {
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
  const text = norm(value)
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
      const number = Number(digits);
      if (number >= min && number <= max) return String(number);
    }
    return "";
  };
}

function editDistance(a = "", b = "") {
  const x = String(a);
  const y = String(b);
  const row = Array.from({ length: y.length + 1 }, (_, index) => index);
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

function codeSimilarity(a, b) {
  const x = canonicalCode(a);
  const y = canonicalCode(b);
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
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
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
      const count = Math.max(1, [...String(token.text).replace(/\s/g, "")].length);
      weighted += token.confidence * count;
      chars += count;
    }
    const confidence = chars ? weighted / chars / 100 : 0.5;
    evidence.push({ value, weight: 0.78 + confidence, source: `${set.name}:layout`, confidence });
  }
  return evidence;
}

function fuseEvidence(evidence, fuzzy = false) {
  if (!evidence.length) return null;
  const groups = [];
  for (const item of evidence) {
    let group = null;
    for (const candidate of groups) {
      const equal = fuzzy
        ? codeSimilarity(candidate[0].value, item.value) >= 0.66
        : compact(candidate[0].value) === compact(item.value);
      if (equal) {
        group = candidate;
        break;
      }
    }
    if (group) group.push(item);
    else groups.push([item]);
  }

  const groupWeight = group => group.reduce((sum, item) => sum + item.weight, 0);
  groups.sort((a, b) => groupWeight(b) - groupWeight(a));
  const winner = groups[0];
  const representative = [...winner].sort((a, b) => {
    const distanceScore = item => winner.reduce(
      (sum, other) => sum + (1 - codeSimilarity(item.value, other.value)) * other.weight,
      0,
    ) - item.weight * 0.15;
    return distanceScore(a) - distanceScore(b);
  })[0];

  const exact = new Map();
  for (const item of winner) {
    const key = compact(item.value);
    const current = exact.get(key) || { weight: 0, support: 0, value: item.value };
    current.weight += item.weight;
    current.support += 1;
    exact.set(key, current);
  }
  const exactGroups = [...exact.values()].sort((a, b) => b.weight - a.weight);
  const variantFamilies = new Set(
    winner
      .map(item => String(item.source || "").split(":")[0])
      .filter(name => name && name !== "ensemble"),
  );

  return {
    value: representative.value,
    score: groupWeight(winner),
    support: winner.length,
    variantSupport: variantFamilies.size,
    sources: winner.map(item => item.source),
    members: winner,
    exactGroups,
  };
}

function codeIsAmbiguous(result) {
  const groups = result?.exactGroups || [];
  if (groups.length <= 1) return false;
  const first = groups[0];
  const second = groups[1];
  return first.support < 2 || first.weight < second.weight * 1.28;
}

function refineChassisWithModel(value = "") {
  if (!value.includes("-")) return value;
  const [prefix, suffix] = value.split("-");
  const model = cleanCode(fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "");
  const core = model.includes("-") ? model.split("-").pop() : model;
  if (!core || core.length < 3) return value;
  const same = candidate => candidate.length === core.length && canonicalCode(candidate) === canonicalCode(core);
  if (same(prefix)) return `${core}-${suffix}`;
  if (prefix.length === core.length + 1 && (same(prefix.slice(1)) || same(prefix.slice(0, -1)))) {
    return `${core}-${suffix}`;
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
  registrationNumber: { profile: { ...OCR_FIELD_PRESETS.japaneseText, minSimilarity: 0.50 }, extract: extractRegistration, order: ["right", "cell", "below"], fuzzy: false, output: "registrationNumber", minVariants: 2 },
  chassisNumber: { profile: { ...OCR_FIELD_PRESETS.code, minSimilarity: 0.54 }, extract: extractChassis, order: ["right", "cell", "below"], fuzzy: true, output: "chassisNumber", allowAmbiguousCode: true, minVariants: 2 },
  registrationDate: { profile: { ...OCR_FIELD_PRESETS.date, minSimilarity: 0.50 }, extract: normalizeJapaneseDate, order: ["cell", "below", "right"], fuzzy: false, output: "registrationDate", minVariants: 2 },
  recordDate: { profile: { ...OCR_FIELD_PRESETS.date, minSimilarity: 0.50 }, extract: normalizeJapaneseDate, order: ["right", "cell", "below"], fuzzy: false, output: "recordDate", minVariants: 2 },
  engineModel: { profile: { ...OCR_FIELD_PRESETS.code, minSimilarity: 0.52 }, extract: extractEngine, order: ["right", "cell", "below"], fuzzy: true, output: "engineModel", allowAmbiguousCode: false, minVariants: 2 },
  vehicleWeightKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(100, 50000), order: ["cell", "below", "right"], fuzzy: false, output: "vehicleWeightKg", minVariants: 2 },
  grossVehicleWeightKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(100, 80000), order: ["cell", "below", "right"], fuzzy: false, output: "grossVehicleWeightKg", minVariants: 2 },
  lengthCm: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(100, 3000), order: ["cell", "below", "right"], fuzzy: false, output: "lengthCm", minVariants: 2 },
  widthCm: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(50, 500), order: ["cell", "below", "right"], fuzzy: false, output: "widthCm", minVariants: 2 },
  heightCm: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(50, 600), order: ["cell", "below", "right"], fuzzy: false, output: "heightCm", minVariants: 2 },
  frontAxleKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(0, 50000), order: ["cell", "below", "right"], fuzzy: false, output: "frontFrontAxleWeightKg", minVariants: 2 },
  rearAxleKg: { profile: OCR_FIELD_PRESETS.number, extract: numberExtractor(0, 50000), order: ["cell", "below", "right"], fuzzy: false, output: "rearRearAxleWeightKg", minVariants: 2 },
};

async function evaluateRegion(session, worker, item, tokenSets, spec) {
  const page = session.prepared.normalized;
  const evidence = seedEvidence(tokenSets, item.region, page.width, page.height, spec.extract);
  const result = await recognizeDocumentRegion(session, worker, item.region, {
    ...spec.profile,
    minSupport: 2,
    strongSupport: 2,
    strongConfidence: 0.82,
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
    if (value) evidence.push({ value, weight: 0.40 + result.confidence, source: "ensemble", confidence: result.confidence });
  }

  const fused = fuseEvidence(evidence, spec.fuzzy);
  if (!fused) return null;
  return {
    ...fused,
    score: fused.score + Number(item.geometryScore || 0) + Math.min(0.45, fused.support * 0.08),
    direction: item.direction,
    geometryScore: item.geometryScore,
  };
}

function accepted(result, spec) {
  if (!result?.value) return false;
  if ((result.variantSupport || 0) < (spec.minVariants || 1)) return false;
  if (spec.fuzzy && !spec.allowAmbiguousCode && codeIsAmbiguous(result)) return false;
  return true;
}

async function readField(session, worker, anchor, anchors, tokenSets, detector, spec) {
  const page = session.prepared.normalized;
  const ruled = detector.detect(anchor, page.width, page.height);
  const grid = inferGridValueRegions(anchor, anchors, page.width, page.height);
  const fallbackRight = relativeRegionFromAnchor(anchor, page.width, page.height, {
    direction: "right",
    gap: 0.003,
    width: 0.26,
    height: Math.max(0.03, (anchor.bbox.y1 - anchor.bbox.y0) / page.height * 1.5),
    padY: 0.004,
  });

  const pools = [
    ruled,
    grid,
    [{ region: fallbackRight, direction: "right", geometryScore: 0.30 }],
  ];

  for (const pool of pools) {
    for (const direction of spec.order) {
      const candidates = pool.filter(item => item.direction === direction);
      for (const item of candidates) {
        const result = await evaluateRegion(session, worker, item, tokenSets, spec);
        if (accepted(result, spec)) return { ...result, ruled: pool === ruled };
      }
    }
  }
  return null;
}

export default function CertificateLayoutRecognitionV6() {
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
          const consensus = findSemanticConsensusLabelAnchors(tokenSets, LABELS, LABEL_RULES, {
            pageWidth: page.width,
            pageHeight: page.height,
            minSimilarity: 0.50,
            maxTokens: 12,
            maxCandidatesPerVariant: 10,
          });
          const anchors = { ...consensus.anchors };

          // Rescue only genuinely missing labels with a lower visual threshold while
          // keeping the same semantic requirements. This prevents 車両番号 from being
          // used as 車台番号 while allowing partially damaged 車台番... OCR to survive.
          for (const key of ["chassisNumber", "recordDate"]) {
            if (anchors[key]) continue;
            const rescue = findSemanticConsensusLabelAnchors(
              tokenSets,
              { [key]: LABELS[key] },
              { [key]: LABEL_RULES[key] },
              {
                pageWidth: page.width,
                pageHeight: page.height,
                minSimilarity: 0.40,
                maxTokens: 14,
                maxCandidatesPerVariant: 14,
              },
            );
            if (rescue.anchors[key]) anchors[key] = rescue.anchors[key];
          }

          const ruledSource = session.prepared.variants.binaryDark || session.prepared.variants.contrast;
          const detector = createRuledGridDetector(ruledSource);
          const lines = [
            `OCRトークン数: ${counts.join(" / ")}`,
            `台形補正: ${session.geometry.perspectiveApplied ? `適用 conf=${session.geometry.perspectiveConfidence.toFixed(2)}` : "不要/保留"}`,
            `傾き補正: ${session.geometry.deskewApplied ? `${session.geometry.deskewAngle.toFixed(2)}°` : "不要/保留"}`,
          ];

          for (const [key, labels] of Object.entries(LABELS)) {
            const anchor = anchors[key];
            lines.push(`${key}: ${anchor ? `${anchor.matchedText} conf=${anchor.confidence.toFixed(2)} support=${consensus.support[key] || 1}` : `未検出 (${labels[0]})`}`);
          }
          showDebug("意味ラベル＋罫線セル検出完了", lines);

          const patch = {};
          for (const [key, spec] of Object.entries(SPECS)) {
            if (stopped || myToken !== token) return;
            if (qrHas(key)) {
              lines.push(`${key}: QRあり → OCR省略`);
              continue;
            }
            const anchor = anchors[key];
            if (!anchor) {
              lines.push(`${key}: 意味一致ラベルなし → 保留`);
              continue;
            }

            const result = await readField(session, worker, anchor, anchors, tokenSets, detector, spec);
            if (!result?.value) {
              lines.push(`${key}: 複数variant支持またはセル確定不足 → 保留`);
              continue;
            }

            let value = result.value;
            if (key === "chassisNumber") value = refineChassisWithModel(value);
            patch[spec.output] = value;
            lines.push(`${key}: ${value} / ${result.direction}${result.ruled ? " ruled" : " fallback"} / variants=${result.variantSupport} / evidence=${result.support} / score=${result.score.toFixed(2)}`);
            showDebug("罫線セルOCR進行中", lines);
          }

          if (patch.vehicleWeightKg && patch.grossVehicleWeightKg && Number(patch.grossVehicleWeightKg) < Number(patch.vehicleWeightKg)) {
            delete patch.vehicleWeightKg;
            delete patch.grossVehicleWeightKg;
            lines.push("重量: 車両総重量 < 車両重量 のため両方保留");
          }

          if (Object.keys(patch).length) {
            window.__vehicleCertificateLayoutV6Patch = patch;
            for (let i = 0; i < 8; i += 1) {
              if (stopped || myToken !== token) return;
              window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
              await new Promise(resolve => setTimeout(resolve, 420));
            }
          }
          showDebug("共通罫線セルOCR v6 完了", lines);
        } finally {
          await worker.terminate().catch(() => {});
        }
      } catch (error) {
        showDebug("共通罫線セルOCR v6 エラー", [String(error?.message || error)]);
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
