"use client";

import { useEffect } from "react";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function show(input, text) {
  const card = input?.closest?.("section.card");
  if (!card) return;
  let box = card.querySelector("[data-certificate-single-read-lock]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.certificateSingleReadLock = "1";
    box.style.marginTop = "8px";
    box.style.fontSize = "12px";
    box.style.fontWeight = "700";
    box.style.color = "#49627c";
    card.appendChild(box);
  }
  box.textContent = text;
}

export default function CertificateSingleReadLock() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let locked = false;
    let generation = 0;
    let blocked = 0;

    const onChange = (event) => {
      if (!isCertificateInput(event.target)) return;
      const input = event.target;
      const file = input.files?.[0];
      if (!file || !file.type?.startsWith("image/")) return;

      // CertificateConsistencyFix が元のchangeを止め、QR確定後に合成changeを
      // 1回だけ流す。その下流で最初の1回だけReact本体へ通す。
      if (locked) {
        blocked += 1;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        show(input, `重複OCRを遮断しました (${blocked}回)`);
        return;
      }

      locked = true;
      blocked = 0;
      const id = ++generation;
      show(input, "OCR一重化ロック: 1回だけ実行中");

      void (async () => {
        let sawBusy = false;

        // ReactのsetDocBusyが描画されるまで少し待つ。
        for (let i = 0; i < 80 && id === generation; i += 1) {
          if (document.querySelector(".progress")) {
            sawBusy = true;
            break;
          }
          await sleep(100);
        }

        if (sawBusy) {
          // OCRが終わるまで待つ。途中で一瞬progressが消えても即解除しない。
          let quiet = 0;
          for (let i = 0; i < 1800 && id === generation; i += 1) {
            if (document.querySelector(".progress")) quiet = 0;
            else quiet += 1;
            if (quiet >= 12) break; // 3秒連続で非busy
            await sleep(250);
          }
        } else {
          // OCR開始自体が無かった場合の安全解除。
          await sleep(3000);
        }

        if (id !== generation) return;
        locked = false;
        show(input, blocked ? `OCR完了・重複${blocked}回を遮断` : "OCR完了・重複なし");
      })();
    };

    // ConsistencyFixより後に登録されるため、QR確定後の再送changeだけを見る。
    document.addEventListener("change", onChange, true);
    return () => {
      generation += 1;
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
