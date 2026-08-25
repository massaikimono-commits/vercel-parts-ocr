"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

const FAST_READY_EVENT = "vehicle-certificate-fast-base-ready";
const BASE_MAX_SIDE = 2100;
const BASE_CROP_RATIO = 0.70;

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/\r/g, "")
  .replace(/[\u3000\t]+/g, " ")
  .replace(/ {2,}/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

function section(title) {
  return [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return Boolean(card?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}

function setReactInputValue(input, value) {
  if (!(input instanceof HTMLInputElement) || input.value === value) return;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearCertificateFields() {
  const card = section("車検証読み取り情報");
  if (!card) return;
  for (const input of card.querySelectorAll("input")) {
    if (input instanceof HTMLInputElement) setReactInputValue(input, "");
  }
}

function ensureDebug() {
  const host = section("車検証から読み取る");
  if (!host) return null;
  let box = document.getElementById("certificate-fast-base-ocr-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-fast-base-ocr-debug";
    box.open = true;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #9bb8e8";
    box.style.borderRadius = "12px";
    box.style.background = "#f5f9ff";
    box.innerHTML = '<summary style="font-weight:800">OCR詳細（確認用）・高速ベース</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  return box;
}

function showDebug(text) {
  const box = ensureDebug();
  const pre = box?.querySelector("pre");
  if (pre) pre.textContent = text;
}

function ensurePreview(file, state) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let image = document.getElementById("certificate-fast-base-preview");
  if (!image) {
    image = document.createElement("img");
    image.id = "certificate-fast-base-preview";
    image.className = "preview";
    image.style.display = "block";
    image.style.width = "100%";
    image.style.height = "auto";
    image.style.marginTop = "14px";
    image.style.borderRadius = "14px";
    image.style.objectFit = "contain";
    host.appendChild(image);
  }
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  image.src = state.url;
}

function cropTop(source, ratio = BASE_CROP_RATIO) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, source.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function recognize(worker, tesseract, canvas, psm) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_char_whitelist: "",
  });
  const result = await worker.recognize(canvas, {}, { text: true, tsv: true });
  return {
    text: norm(result?.data?.text || ""),
    confidence: Number(result?.data?.confidence || 0),
    data: result?.data || null,
  };
}

function usefulCount(text = "") {
  return (norm(text).match(/[一-龠々ぁ-んァ-ヶA-Za-z0-9]/g) || []).length;
}

function releaseSession(session) {
  try {
    const seen = new Set();
    const all = [
      session?.prepared?.source,
      session?.prepared?.normalized,
      ...Object.values(session?.prepared?.variants || {}),
    ];
    for (const canvas of all) {
      if (!canvas || seen.has(canvas)) continue;
      seen.add(canvas);
      canvas.width = 1;
      canvas.height = 1;
    }
  } catch {}
}

export default function CertificateFastBaseReader() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let generation = 0;
    let stopped = false;
    const previewState = { url: "" };

    const run = async (file, currentGeneration) => {
      let worker = null;
      let session = null;
      let page = null;
      let contrast = null;
      const started = performance.now();
      try {
        showDebug("状態: 高速ベースOCR準備中\n方式: 上側70%だけ1pass。備考欄・下段QRは全体OCR対象外にします");
        session = await createDocumentRecognitionSession(file, {
          maxSide: BASE_MAX_SIDE,
          cropPaper: true,
          minPaperConfidence: 0.38,
        });
        if (stopped || currentGeneration !== generation) return;

        const shared = await createSharedTesseractWorker();
        worker = shared.worker;
        const t = shared.tesseract;
        const fullPage = session.prepared.normalized;
        page = cropTop(fullPage, BASE_CROP_RATIO);

        const first = await recognize(worker, t, page, t.PSM?.SPARSE_TEXT ?? 11);
        if (stopped || currentGeneration !== generation) return;

        let text = first.text;
        let chosenData = first.data;
        let passes = 1;
        let secondConfidence = null;

        // Only a genuinely poor first pass gets one fallback. Normal certificates remain one-pass.
        if (usefulCount(text) < 260 || text.length < 430) {
          const contrastFull = session.prepared.variants?.contrast || fullPage;
          contrast = cropTop(contrastFull, BASE_CROP_RATIO);
          const second = await recognize(worker, t, contrast, t.PSM?.SPARSE_TEXT ?? 11);
          if (stopped || currentGeneration !== generation) return;
          secondConfidence = second.confidence;
          passes = 2;
          if (usefulCount(second.text) > usefulCount(text)) {
            text = second.text;
            chosenData = second.data;
          } else if (second.text && !text.includes(second.text)) {
            text = `${text}\n${second.text}`.trim();
          }
        }

        const elapsed = Math.round(performance.now() - started);
        window.__vehicleCertificateFastBaseText = text;
        window.__vehicleCertificateFastBaseOcrData = chosenData;
        window.__vehicleCertificateFastBaseGeometry = {
          width: page.width,
          height: page.height,
          fullWidth: fullPage.width,
          fullHeight: fullPage.height,
          cropRatio: BASE_CROP_RATIO,
        };
        window.__vehicleCertificateFastBaseDone = true;
        window.__vehicleCertificateFastBaseActive = true;

        showDebug([
          "状態: 高速ベースOCR 完了",
          `OCR回数: ${passes}pass`,
          `所要: ${elapsed}ms`,
          `対象: 上側${Math.round(BASE_CROP_RATIO * 100)}% / maxSide=${BASE_MAX_SIDE}`,
          `1pass conf=${first.confidence.toFixed(1)}${secondConfidence == null ? "" : ` / 2pass conf=${Number(secondConfidence).toFixed(1)}`}`,
          "方針: QR＋この軽量OCRで取れた項目を採用し、未確定セルだけ後段へ渡します。",
          "",
          "【車検証 全体OCR（必要範囲のみ）】",
          text || "(空)",
          "",
          "【QR最終確定】 軽量QR解析と照合中",
        ].join("\n"));

        window.dispatchEvent(new CustomEvent(FAST_READY_EVENT, { detail: { passes, elapsed, textLength: text.length } }));
      } catch (error) {
        window.__vehicleCertificateFastBaseDone = true;
        showDebug(`状態: 高速ベースOCR エラー\n${String(error?.message || error)}\n全セルOCRは自動で走らせず、不足項目だけ後段へ渡します。`);
        window.dispatchEvent(new CustomEvent(FAST_READY_EVENT, { detail: { error: String(error?.message || error) } }));
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        if (page) { page.width = 1; page.height = 1; }
        if (contrast) { contrast.width = 1; contrast.height = 1; }
        if (session) releaseSession(session);
      }
    };

    const onChange = event => {
      if (event.__certificatePipelineReplay || event.__certificateV13Replay) return;
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;

      window.__vehicleCertificateSourceFile = file;
      event.stopPropagation();

      generation += 1;
      window.__vehicleCertificateFastBaseActive = true;
      window.__vehicleCertificateFastBaseDone = false;
      window.__vehicleCertificateFastBaseOcrData = null;
      window.__vehicleCertificateFastBaseGeometry = null;
      window.__vehicleCertificateLowerSixDone = false;
      window.__vehicleCertificateQrPriority = null;
      window.__vehicleCertificateQr = [];
      window.__vehicleCertificateRegistrationDateCandidates = [];

      clearCertificateFields();
      ensurePreview(file, previewState);
      showDebug("状態: 高速ベースOCR 開始\n全セル個別OCRは停止。必要情報がある上側70%だけを1passで読みます。");
      void run(file, generation);
    };

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      generation += 1;
      document.removeEventListener("change", onChange, true);
      if (previewState.url) URL.revokeObjectURL(previewState.url);
    };
  }, []);

  return null;
}
