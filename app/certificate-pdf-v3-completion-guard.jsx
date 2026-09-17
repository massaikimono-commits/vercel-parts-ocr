"use client";

import { useLayoutEffect } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

const PATCH_KEY = Symbol.for("icb.pdfV3DecodeFromCanvasTimeoutGuard");
const QR_DECODE_TIMEOUT_MS = 2500;
const RESTORE_AFTER_MS = 8000;

function isPdfInput(target) {
  if (!(target instanceof HTMLInputElement) || target.type !== "file") return false;
  const file = target.files?.[0];
  if (!file) return false;
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

function installTemporaryDecodeTimeout() {
  const proto = BrowserQRCodeReader?.prototype;
  if (!proto || typeof proto.decodeFromCanvas !== "function") return () => {};

  const existing = proto[PATCH_KEY];
  if (existing?.restore) return existing.restore;

  const original = proto.decodeFromCanvas;
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    if (proto.decodeFromCanvas === guardedDecodeFromCanvas) {
      proto.decodeFromCanvas = original;
    }
    delete proto[PATCH_KEY];
  };

  function guardedDecodeFromCanvas(source) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        reject(new Error("PDF_V3_QR_DECODE_TIMEOUT"));
      }, QR_DECODE_TIMEOUT_MS);
    });

    return Promise.race([Promise.resolve().then(() => original.call(this, source)), timeout]).finally(() => {
      if (timer !== null) window.clearTimeout(timer);
    });
  }

  proto.decodeFromCanvas = guardedDecodeFromCanvas;
  proto[PATCH_KEY] = { restore };
  return restore;
}

export default function CertificatePdfV3CompletionGuard() {
  useLayoutEffect(() => {
    let restoreTimer = null;

    const onChange = (event) => {
      if (!isPdfInput(event.target)) return;

      const restore = installTemporaryDecodeTimeout();
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        restore();
        restoreTimer = null;
      }, RESTORE_AFTER_MS);
    };

    // Register before the v3 reader. v3 stops immediate propagation once it owns
    // a PDF change, so this guard must be mounted/listening first.
    window.addEventListener("change", onChange, true);
    return () => {
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      BrowserQRCodeReader?.prototype?.[PATCH_KEY]?.restore?.();
      window.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
