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
  relativeRegionFromAnchor,
} from "./lib/document-layout-recognition";
import { inferValueRegionsFromTokens } from "./lib/document-field-regions";

const AUTH_EVENT = "vehicle-certificate-authoritative";

const LABELS = {
  recordDate: ["記録年月日"],
  registrationNumber: ["自動車登録番号又は車両番号", "自動車登録番号", "車両番号"],
  chassisNumber: ["車台番号"],
  registrationDate: ["登録年月日／交付年月日", "登録年月日", "交付年月日"],
  engineModel: ["原動機の型式", "原動機型式"],
};

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー−]/g, "-")
    .replace(/[\u3000\t\r]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function fieldInput(labelText) {
  const card = [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || "");
    if (title !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function unresolved(key) {
  const qr = window.__vehicleCertificateQrPriority || {};
  if (key === "registrationNumber") return !qr.registrationNumber && !fieldInput("自動車登録番号又は車両番号")?.value;
  if (key === "chassisNumber") return !qr.chassisNumber && !fieldInput("車台番号")?.value;
  if (key === "engineModel") return !qr.engineModel && !fieldInput("原動機の型式")?.value;
  if (key === "recordDate") return !fieldInput("記録年月日")?.value;
  if (key === "registrationDate") return !fieldInput("登録年月日／交付年月日")?.value;
  return true;
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
    const area = match[1];
    const klass = numericGroup(match[2]);
    const serial = numericGroup(match[4]);
    if (!area || klass.length !== 3 || !serial || serial.length > 4) continue;
    return `${area} ${klass} ${match[3]} ${serial}`;
  }
  return "";
}

function cleanCodeText(value = "") {
  return norm(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[OQ](?=\d)|(?<=\d)[OQ]/g, "0")
    .replace(/[I|!](?=\d)|(?<=\d)[I|!]/g, "1");
}

function extractChassis(value = "") {
  const text = cleanCodeText(value);
  const domestic = text.match(/(?:^|[^A-Z0-9])([A-Z0-9]{1,8}-[A-Z0-9]{4,12})(?:$|[^A-Z0-9])/);
  if (domestic?.[1]) return domestic[1];
  for (const match of text.matchAll(/[A-HJ-NPR-Z0-9]{17}/g)) {
    if (/[A-Z]/.test(match[0]) && /\d/.test(match[0])) return match[0];
  }
  return "";
}

function currentModelCode() {
  return cleanCodeText(fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "");
}

function extractEngineModel(value = "") {
  const text = cleanCodeText(value)
    .replace(/原動機の型式/g, "")
    .replace(/原動機型式/g, "");
  const currentModel = currentModelCode();
  const candidates = [...text.matchAll(/[A-Z0-9]{2,8}-[A-Z0-9]{2,8}/g)].map(match => match[0]);
  for (const candidate of candidates) {
    if (!/[A-Z]/.test(candidate) || !/\d/.test(candidate)) continue;
    if (currentModel && (candidate === currentModel || candidate.endsWith(currentModel) || currentModel.endsWith(candidate))) continue;
    return candidate;
  }
  for (const match of text.matchAll(/(?:^|[^A-Z0-9])([A-Z]{1,4}\d[A-Z0-9]{1,5})(?:$|[^A-Z0-9])/g)) {
    const candidate = match[1];
    if (currentModel && currentModel.includes(candidate)) continue;
    return candidate;
  }
  return "";
}

function normalizeJapaneseDate(value = "") {
  let text = norm(value)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/\s+/g, "");
  text = text
    .replace(/(\d{1,2})[RＲ](?=\d{1,2}[日HＢB己昌曰])/g, "$1月")
    .replace(/(\d{1,2})[HＢB己昌曰](?![A-Za-z0-9])/g, "$1日")
    .replace(/(\d{1,2})H$/g, "$1日");
  const match = text.match(/(令和|平成|昭和)([0-9OQDGIL|SZB?]{1,2})年?([0-9OQDGIL|SZB]{1,2})月?([0-9OQDGIL|SZB]{1,2})日?/);
  if (!match) return "";
  const year = numericGroup(match[2]);
  const month = numericGroup(match[3]);
  const day = numericGroup(match[4]);
  if (!year || !month || !day) return "";
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${match[1]}${Number(year)}年${m}月${d}日`;
}

function debugHost() {
  return [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  ) || null;
}

function showDebug(state, lines = []) {
  const host = debugHost();
  if (!host) return;
  let box = document.getElementById("certificate-layout-recognition-v2-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-layout-recognition-v2-debug";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #cfd8e6";
    box.style.borderRadius = "12px";
    box.innerHTML = '<summary style="font-weight:800">共通ラベル追従OCR v2（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = [`状態: ${state}`, ...lines].join("\n");
}

async function recognizeNearAnchor(session, worker, anchor, tokenSets, profile, extract) {
  const page = session.prepared.normalized;
  const inferred = inferValueRegionsFromTokens(anchor, tokenSets, page.width, page.height);
  const fallbacks = [
    relativeRegionFromAnchor(anchor, page.width, page.height, {
      direction: "right",
      gap: 0.003,
      width: 0.28,
      height: Math.max(0.030, (anchor.bbox.y1 - anchor.bbox.y0) / page.height * 1.55),
      padY: 0.005,
    }),
    relativeRegionFromAnchor(anchor, page.width, page.height, {
      direction: "below",
      gap: 0.002,
      width: 0.34,
      height: 0.052,
    }),
  ];

  const regions = [
    ...inferred.map(item => ({ ...item, label: `geometry-${item.direction} support=${item.support}` })),
    ...fallbacks.map((region, index) => ({ region, support: 0, label: index === 0 ? "fallback-right" : "fallback-below" })),
  ];
  const results = [];
  const seen = new Set();
  for (const item of regions) {
    const key = [item.region.x, item.region.y, item.region.width, item.region.height].map(x => x.toFixed(3)).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await recognizeDocumentRegion(session, worker, item.region, {
      ...profile,
      minSupport: Math.min(profile.minSupport ?? 2, item.support >= 2 ? 1 : 2),
      validate: value => Boolean(extract(value)),
    });
    const cleaned = result?.value ? extract(result.value) : "";
    results.push({ result, cleaned, geometrySupport: item.support, regionLabel: item.label });
    if (cleaned && (result.support >= 2 || item.support >= 2) && result.confidence >= 0.62) break;
  }

  return results.sort((a, b) => {
    const score = item => (item.cleaned ? 2 : 0) + item.geometrySupport * 0.35 + (item.result?.support || 0) * 0.4 + (item.result?.confidence || 0);
    return score(b) - score(a);
  })[0];
}

export default function CertificateLayoutRecognitionV2() {
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
          maxSide: 3800,
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
          showDebug("複数画像でラベル位置を検出中", [
            `台形補正: ${session.geometry.perspectiveApplied ? `適用 confidence=${session.geometry.perspectiveConfidence.toFixed(2)}` : "不要/保留"}`,
            `傾き補正: ${session.geometry.deskewApplied ? `${session.geometry.deskewAngle.toFixed(2)}°` : "不要/保留"}`,
            ...session.qualityWarnings.map(x => `画像品質: ${x}`),
          ]);

          const layoutVariants = [
            ["original", session.prepared.variants.original],
            ["contrast", session.prepared.variants.contrast],
            ["adaptiveBinary", session.prepared.variants.adaptiveBinary],
          ];
          const tokenSets = [];
          const tokenCounts = [];
          for (const [name, canvas] of layoutVariants) {
            if (stopped || myToken !== token) return;
            const layoutResult = await worker.recognize(canvas, {}, { text: true, blocks: true, tsv: true });
            const tokens = extractOcrTokens(layoutResult?.data);
            tokenSets.push({ name, tokens });
            tokenCounts.push(`${name}=${tokens.length}`);
          }

          const page = session.prepared.normalized;
          const labelConsensus = findConsensusLabelAnchors(tokenSets, LABELS, {
            pageWidth: page.width,
            pageHeight: page.height,
            minSimilarity: 0.50,
            maxTokens: 10,
          });
          const anchors = labelConsensus.anchors;

          const lines = [`OCRトークン数: ${tokenCounts.join(" / ")}`];
          for (const [key, anchor] of Object.entries(anchors)) {
            lines.push(`${key}: ${anchor ? `${anchor.matchedText} conf=${anchor.confidence.toFixed(2)} support=${labelConsensus.support[key] || 1}` : "ラベル未検出"}`);
          }
          showDebug("ラベル検出完了。未取得項目だけ再読取", lines);

          const patch = {};
          const tasks = [
            ["registrationNumber", { ...OCR_FIELD_PRESETS.japaneseText, minSimilarity: 0.50 }, extractRegistration],
            ["chassisNumber", { ...OCR_FIELD_PRESETS.code, minSimilarity: 0.58 }, extractChassis],
            ["engineModel", { ...OCR_FIELD_PRESETS.code, minSimilarity: 0.56 }, extractEngineModel],
            ["recordDate", { ...OCR_FIELD_PRESETS.date, minSimilarity: 0.56 }, normalizeJapaneseDate],
            ["registrationDate", { ...OCR_FIELD_PRESETS.date, minSimilarity: 0.56 }, normalizeJapaneseDate],
          ];

          for (const [key, preset, extract] of tasks) {
            if (stopped || myToken !== token) return;
            if (!unresolved(key)) {
              lines.push(`${key}: QR/既存値あり → 省略`);
              continue;
            }
            const anchor = anchors[key];
            if (!anchor) {
              lines.push(`${key}: ラベルが見つからないため保留`);
              continue;
            }
            const attempt = await recognizeNearAnchor(session, worker, anchor, tokenSets, preset, extract);
            if (attempt?.cleaned) {
              patch[key] = attempt.cleaned;
              lines.push(`${key}: ${patch[key]} / ${attempt.regionLabel} / ${attempt.result.reason}`);
            } else {
              lines.push(`${key}: 保留 / ${attempt?.regionLabel || "範囲不明"} / ${attempt?.result?.reason || "候補なし"}`);
            }
            showDebug("未取得項目を順番に読取中", lines);
          }

          if (Object.keys(patch).length) {
            window.__vehicleCertificateLayoutV2Patch = patch;
            for (let i = 0; i < 5; i += 1) {
              if (stopped || myToken !== token) return;
              window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
              await new Promise(resolve => setTimeout(resolve, 450));
            }
          }
          showDebug("ラベル追従OCR v2 完了", lines);
        } finally {
          await worker.terminate().catch(() => {});
        }
      } catch (error) {
        showDebug("ラベル追従OCR v2 エラー", [String(error?.message || error)]);
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
