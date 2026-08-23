"use client";

import { useEffect } from "react";

const PDF_ACCEPT = "image/*,application/pdf,.pdf";

function vehicleCard() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  ) || null;
}

function showPdfStatus(message, error = false) {
  const card = vehicleCard();
  if (!card) return;
  let box = card.querySelector("[data-certificate-pdf-status]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.certificatePdfStatus = "1";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.borderRadius = "12px";
    box.style.fontWeight = "800";
    card.querySelector(".actions")?.insertAdjacentElement("afterend", box);
  }
  const bg = error ? "#fff1f1" : "#eef6ff";
  const border = error ? "1px solid #efb7b7" : "1px solid #bfd6ff";
  const color = error ? "#9f2525" : "#244f91";
  if (box.style.background !== bg) box.style.background = bg;
  if (box.style.border !== border) box.style.border = border;
  if (box.style.color !== color) box.style.color = color;
  if (box.textContent !== message) box.textContent = message;
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

async function renderPage(pdf, pageNumber, targetWidth = 1600) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(5, targetWidth / Math.max(1, base.width)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, page };
}

async function pageText(page) {
  try {
    const content = await page.getTextContent();
    return (content.items || []).map((item) => item?.str || "").join(" ");
  } catch {
    return "";
  }
}

function lowerCanvas(source) {
  const y = Math.round(source.height * 0.55);
  const h = Math.max(1, source.height - y);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, y, source.width, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function hasVehicleQr(canvas) {
  try {
    const browser = await import("@zxing/browser");
    const lib = await import("@zxing/library");
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.QR_CODE]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    const reader = new browser.BrowserQRCodeReader(hints);
    const result = await reader.decodeFromCanvas(lowerCanvas(canvas));
    return Boolean(result?.getText?.() || result?.text || result?.getRawBytes?.()?.length);
  } catch {
    return false;
  }
}

async function choosePage(pdf) {
  const max = Math.min(pdf.numPages || 1, 8);
  const textCandidates = [];

  for (let n = 1; n <= max; n += 1) {
    const page = await pdf.getPage(n);
    const text = (await pageText(page)).replace(/\s+/g, "");
    if (/自動車検査証|自動車登録番号|車両番号|車台番号|有効期間の満了/.test(text)) {
      textCandidates.push(n);
    }
  }
  if (textCandidates.length) return textCandidates[0];

  for (let n = 1; n <= max; n += 1) {
    const { canvas } = await renderPage(pdf, n, 1250);
    if (await hasVehicleQr(canvas)) return n;
  }
  return 1;
}

async function canvasToImageFile(canvas, originalName, pageNumber) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDFページの画像化に失敗しました")), "image/png");
  });
  const base = String(originalName || "vehicle-certificate")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠._-]+/g, "_")
    .slice(0, 80) || "vehicle-certificate";
  return new File([blob], `${base}-page${pageNumber}.png`, {
    type: "image/png",
    lastModified: Date.now(),
  });
}

async function pdfToImageFile(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const pageNumber = await choosePage(pdf);
    showPdfStatus(`PDF ${pdf.numPages}ページ中 ${pageNumber}ページ目を車検証として高解像度変換中…`);
    const { canvas } = await renderPage(pdf, pageNumber, 3600);
    const imageFile = await canvasToImageFile(canvas, file.name, pageNumber);
    return { imageFile, pageNumber, pages: pdf.numPages || 1 };
  } finally {
    await pdf.destroy?.().catch?.(() => {});
  }
}

function enhanceUi() {
  if (!location.pathname.startsWith("/vehicle-workflow")) return false;
  const card = vehicleCard();
  if (!card) return false;

  const inputs = Array.from(card.querySelectorAll('input[type="file"]'));
  inputs.forEach((input) => {
    if (!input.hasAttribute("capture") && input.getAttribute("accept") !== PDF_ACCEPT) {
      input.setAttribute("accept", PDF_ACCEPT);
    }
  });

  const buttons = Array.from(card.querySelectorAll(".actions button"));
  if (buttons[1]) {
    const wanted = "📄 PDF / 写真から読み取る";
    if (buttons[1].textContent !== wanted) buttons[1].textContent = wanted;
    if (!buttons[1].classList.contains("primary")) buttons[1].classList.add("primary");
  }
  if (buttons[0]?.classList.contains("primary")) buttons[0].classList.remove("primary");

  if (!card.querySelector("[data-pdf-main-note]")) {
    const note = document.createElement("p");
    note.dataset.pdfMainNote = "1";
    note.style.margin = "10px 0 0";
    note.style.fontWeight = "700";
    note.style.color = "#40536f";
    note.textContent = "PDFをメイン入力として利用できます。複数ページPDFは車検証ページを自動判定し、QRを優先してOCRで補完します。";
    card.querySelector(".actions")?.insertAdjacentElement("afterend", note);
  }
  return true;
}

export default function CertificatePdfBridge() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let dead = false;
    const onChange = async (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file) return;
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      if (!isPdf || input.dataset.pdfConverting === "1") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      input.dataset.pdfConverting = "1";
      showPdfStatus("PDFを解析中です。車検証ページを自動で探しています…");

      try {
        const { imageFile, pageNumber, pages } = await pdfToImageFile(file);
        if (dead) return;
        const transfer = new DataTransfer();
        transfer.items.add(imageFile);
        input.files = transfer.files;
        delete input.dataset.pdfConverting;
        showPdfStatus(`PDF ${pages}ページ中 ${pageNumber}ページ目を車検証として選択しました。QR・OCRを開始します。`);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        delete input.dataset.pdfConverting;
        input.value = "";
        showPdfStatus(`PDF読み取りエラー: ${error?.message || error}`, true);
      }
    };

    document.addEventListener("change", onChange, true);

    // MutationObserverは使わない。画面を書き換えて自分自身を再発火させるループを防ぐ。
    let tries = 0;
    const setup = () => {
      tries += 1;
      if (enhanceUi() || tries >= 20) window.clearInterval(setupTimer);
    };
    const setupTimer = window.setInterval(setup, 250);
    setup();

    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
      window.clearInterval(setupTimer);
    };
  }, []);

  return null;
}
