"use client";

import { useEffect } from "react";
import { expectedCertificateQrCount } from "./lib/certificate-photo-normalize";

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}
function compact(v) { return String(v || "").normalize("NFKC").replace(/\s+/g, ""); }
function fieldValue(label) {
  const wanted = compact(label);
  for (const node of document.querySelectorAll("section.card .grid label")) {
    const text = compact(node.querySelector("span")?.textContent || node.childNodes?.[0]?.textContent || node.textContent || "");
    if (!text.startsWith(wanted)) continue;
    return node.querySelector("input,select")?.value || "";
  }
  return "";
}
function showStatus(text) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-qr-rescue-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-rescue-status";
    box.style.marginTop = "10px"; box.style.padding = "10px"; box.style.borderRadius = "10px";
    box.style.background = "#fff8e8"; box.style.border = "1px solid #f1d89b"; box.style.fontWeight = "800";
    host.appendChild(box);
  }
  box.textContent = text;
}
export default function CertificateQrRescueV2() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2" && location.pathname !== "/vehicle-workflow-fast") return;
    let dead = false;
    let token = 0;
    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++token;
      void (async () => {
        const started = performance.now();
        while (!dead && id === token) {
          const state = window.__vehicleCertificateQrFastState;
          if (state && state.running === false) break;
          if (performance.now() - started > 4800) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (dead || id !== token) return;
        await new Promise((resolve) => setTimeout(resolve, 600));
        const items = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
        const expected = expectedCertificateQrCount(items, fieldValue("記録年月日"));
        if (items.length >= expected.count) {
          showStatus("QR完了: " + items.length + "/" + expected.count + "件 / " + expected.label + "。追加QR再走査は省略。");
        } else {
          showStatus("QR: " + items.length + "/" + expected.count + "件 / " + expected.label + "。効果の薄い帯域再走査は省略し、不足項目だけOCRへ。");
        }
      })();
    };
    document.addEventListener("change", onChange, true);
    return () => { dead = true; document.removeEventListener("change", onChange, true); };
  }, []);
  return null;
}
