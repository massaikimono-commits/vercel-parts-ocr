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
  findAllLabelAnchors,
  relativeRegionFromAnchor,
} from "./lib/document-layout-recognition";

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
    .replace(/[‐‑‒–—―ー]/g, "-")
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

function cleanSingleLine(value = "") {
  return norm(value).split("\n").map(x => x.trim()).filter(Boolean).join(" ");
}

function cleanCode(value = "") {
  return norm(value).toUpperCase().replace(/\s+/g, "");
}

function cleanDate(value = "") {
  return norm(value).replace(/\s+/g, "");
}

function plausibleDate(value = "") {
  return /(令和|平成|昭和).{0,3}\d{1,2}.{0,2}\d{1,2}/.test(value);
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

async function recognizeNearAnchor(session, worker, anchor, profile, validate) {
  const page = session.prepared.normalized;
  const regions = [
    relativeRegionFromAnchor(anchor, page.width, page.height, {
      direction: "right",
      gap: 0.004,
      width: 0.46,
      height: Math.max(0.034, (anchor.bbox.y1 - anchor.bbox.y0) / page.height * 1.8),
      padY: 0.006,
    }),
    relativeRegionFromAnchor(anchor, page.width, page.height, {
      direction: "below",
      gap: 0.002,
      width: 0.52,
      height: 0.065,
    }),
  ];

  const results = [];
  for (const region of regions) {
    const result = await recognizeDocumentRegion(session, worker, region, {
      ...profile,
      validate,
    });
    results.push(result);
    if (result.value && result.confidence >= 0.72) break;
  }
  return results.sort((a, b) => b.confidence - a.confidence)[0];
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
          // Main OCR is allowed to finish first. This pass is used for geometry, not for
          // blindly writing its full text into state.
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
          showDebug("ラベル位置を検出中", session.qualityWarnings.map(x => `画像品質: ${x}`));
          const layoutResult = await worker.recognize(session.prepared.variants.contrast);
          if (stopped || myToken !== token) return;
          const tokens = extractOcrTokens(layoutResult?.data);
          const anchors = findAllLabelAnchors(tokens, LABELS, { minSimilarity: 0.54, maxTokens: 10 });

          const lines = [`OCRトークン数: ${tokens.length}`];
          for (const [key, anchor] of Object.entries(anchors)) {
            lines.push(`${key}: ${anchor ? `${anchor.matchedText} conf=${anchor.confidence.toFixed(2)}` : "ラベル未検出"}`);
          }
          showDebug("ラベル検出完了。未取得項目だけ再読取", lines);

          const patch = {};
          const tasks = [
            ["registrationNumber", OCR_FIELD_PRESETS.japaneseText, value => /\d/.test(value) && /[ぁ-ん]/.test(value), cleanSingleLine],
            ["chassisNumber", OCR_FIELD_PRESETS.code, value => /[A-Z]/.test(value) && /\d/.test(value), cleanCode],
            ["engineModel", OCR_FIELD_PRESETS.code, value => /[A-Z]/.test(value) && /\d/.test(value), cleanCode],
            ["recordDate", OCR_FIELD_PRESETS.date, plausibleDate, cleanDate],
            ["registrationDate", OCR_FIELD_PRESETS.date, plausibleDate, cleanDate],
          ];

          for (const [key, preset, validate, cleaner] of tasks) {
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
            const result = await recognizeNearAnchor(session, worker, anchor, preset, validate);
            if (result?.value) {
              patch[key] = cleaner(result.value);
              lines.push(`${key}: ${patch[key]} / ${result.reason}`);
            } else {
              lines.push(`${key}: 保留 / ${result?.reason || "候補なし"}`);
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
