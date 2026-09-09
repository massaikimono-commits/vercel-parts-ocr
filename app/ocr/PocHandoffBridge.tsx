"use client";

import { useEffect } from "react";

const MODE_KEY = "parts-poc-mode";
const START_KEY = "parts-poc-start";
const PHOTO_RESULT_KEY = "parts-poc-photo-result";
const LIVE_RESULT_KEY = "parts-poc-live-result";
const PHOTO_MS_KEY = "parts-poc-photo-ms";
const LIVE_MS_KEY = "parts-poc-live-ms";
const RETURN_PATH = "/ocr/diagnostic/guided-live-parts-poc/eval";

type Row = { name: string; qty: string; retail: string; cost: string };
function readRows(): Row[] {
  const heading = Array.from(document.querySelectorAll("h2")).find((node) => (node.textContent || "").includes("抽出データ"));
  const section = heading?.closest("section"); if (!section) return [];
  const inputs = Array.from(section.querySelectorAll("input")) as HTMLInputElement[]; const rows: Row[] = [];
  for (let i = 0; i + 3 < inputs.length; i += 4) rows.push({ name: inputs[i].value, qty: inputs[i + 1].value, retail: inputs[i + 2].value, cost: inputs[i + 3].value });
  return rows;
}
export default function PocHandoffBridge() {
  useEffect(() => {
    const mode = sessionStorage.getItem(MODE_KEY); if (location.pathname !== "/ocr" || (mode !== "photo" && mode !== "live")) return;
    let done = false; const started = Number(sessionStorage.getItem(START_KEY) || Date.now());
    const finish = () => { if (done) return; const body = document.body.textContent || ""; const success = body.includes("件を抽出しました") || body.includes("まだ部品行を抽出できませんでした") || body.includes("OCR処理でエラー"); if (!success) return; const rows = readRows(); done = true; sessionStorage.setItem(mode === "photo" ? PHOTO_RESULT_KEY : LIVE_RESULT_KEY, JSON.stringify(rows)); sessionStorage.setItem(mode === "photo" ? PHOTO_MS_KEY : LIVE_MS_KEY, String(Math.max(0, Date.now() - started))); sessionStorage.removeItem(MODE_KEY); sessionStorage.removeItem(START_KEY); location.assign(`${RETURN_PATH}?completed=${mode}`); };
    const observer = new MutationObserver(finish); observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true }); const timer = window.setInterval(finish, 500); finish(); return () => { observer.disconnect(); window.clearInterval(timer); };
  }, []); return null;
}
