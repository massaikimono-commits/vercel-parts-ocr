"use client";

import { useEffect } from "react";

const FAST_READY_EVENT = "vehicle-certificate-fast-base-ready";

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/\r/g, "")
  .replace(/[\u3000\t]+/g, " ")
  .replace(/ {2,}/g, " ")
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
    box.innerHTML = '<summary style="font-weight:800">読み取り詳細（確認用）・QR先行ベース</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
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

function keiVersion(item) {
  const fields = String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map(value => value.trim());
  return fields[0] === "K" ? (fields[1] || "") : "";
}

function qrSummary() {
  const items = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
  const versions = [...new Set(items.map(keiVersion).filter(Boolean))].sort();
  const priority = window.__vehicleCertificateQrPriority;
  const fields = priority && typeof priority === "object"
    ? Object.entries(priority).filter(([, value]) => typeof value === "string" && norm(value)).map(([key]) => key)
    : [];
  return { count: items.length, versions, fields };
}

export default function CertificateFastBaseReader() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let generation = 0;
    let stopped = false;
    const previewState = { url: "" };

    const run = async currentGeneration => {
      const started = performance.now();
      try {
        showDebug([
          "状態: QR先行解析中",
          "全体OCR: 0pass",
          "方針: QRを先に確定し、不足項目だけ小さいセルOCRへ渡します。",
        ].join("\n"));

        const deadline = performance.now() + 7000;
        while (!stopped && currentGeneration === generation && performance.now() < deadline) {
          if (window.__vehicleCertificateLowerSixDone) break;
          await new Promise(resolve => window.setTimeout(resolve, 80));
        }
        if (stopped || currentGeneration !== generation) return;

        // Lower-six completion wakes the optional K7 helper. Give it a short bounded window,
        // but never hold the pipeline for many seconds.
        const settleDeadline = performance.now() + 1400;
        while (!stopped && currentGeneration === generation && performance.now() < settleDeadline) {
          const summary = qrSummary();
          if (summary.versions.some(version => /^7\d$/.test(version))) break;
          await new Promise(resolve => window.setTimeout(resolve, 100));
        }
        if (stopped || currentGeneration !== generation) return;

        const elapsed = Math.round(performance.now() - started);
        const summary = qrSummary();
        window.__vehicleCertificateFastBaseText = "";
        window.__vehicleCertificateFastBaseOcrData = null;
        window.__vehicleCertificateFastBaseGeometry = null;
        window.__vehicleCertificateFastBaseDone = true;
        window.__vehicleCertificateFastBaseActive = true;

        showDebug([
          "状態: QR先行ベース 完了",
          "OCR回数: 0pass",
          `所要: ${elapsed}ms（QR待ちを含む）`,
          `QR合計: ${summary.count}件${summary.versions.length ? ` / 軽QR ${summary.versions.join(",")}` : ""}`,
          `QR反映項目: ${summary.fields.length ? summary.fields.join(" / ") : "まだなし"}`,
          "次段: QRで埋まらなかったセルだけ固定位置の軽量OCRで補完します。",
        ].join("\n"));

        window.dispatchEvent(new CustomEvent(FAST_READY_EVENT, {
          detail: { passes: 0, elapsed, qrCount: summary.count, qrVersions: summary.versions },
        }));
      } catch (error) {
        window.__vehicleCertificateFastBaseDone = true;
        showDebug(`状態: QR先行ベース エラー\n${String(error?.message || error)}\n全体OCRには戻さず、不足セル補完へ進みます。`);
        window.dispatchEvent(new CustomEvent(FAST_READY_EVENT, { detail: { passes: 0, error: String(error?.message || error) } }));
      }
    };

    const onChange = event => {
      if (event.__certificatePipelineReplay || event.__certificateV13Replay) return;
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;

      window.__vehicleCertificateSourceFile = file;
      window.__vehicleCertificateFastPipelineRequested = true;

      // Prevent the legacy React handler from starting its old dozens-of-OCR-calls path.
      // Other document-level QR listeners on this same event still receive the event.
      event.stopPropagation();

      generation += 1;
      window.__vehicleCertificateFastBaseActive = true;
      window.__vehicleCertificateFastBaseDone = false;
      window.__vehicleCertificateFastBaseText = "";
      window.__vehicleCertificateFastBaseOcrData = null;
      window.__vehicleCertificateFastBaseGeometry = null;
      window.__vehicleCertificateLowerSixDone = false;
      window.__vehicleCertificateQrPriority = null;
      window.__vehicleCertificateQr = [];
      window.__vehicleCertificateRegistrationDateCandidates = [];

      clearCertificateFields();
      ensurePreview(file, previewState);
      void run(generation);
    };

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      generation += 1;
      document.removeEventListener("change", onChange, true);
      if (previewState.url) URL.revokeObjectURL(previewState.url);
      window.__vehicleCertificateFastPipelineRequested = false;
    };
  }, []);

  return null;
}
