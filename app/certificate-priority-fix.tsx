"use client";

import { useEffect } from "react";

type Box = { x: number; y: number; w: number; h: number };

const IMPORTANT_FIELDS = [
  "自動車登録番号又は車両番号",
  "車台番号",
  "登録年月日／交付年月日",
  "初度登録年月",
  "有効期間の満了する日",
  "記録年月日",
  "記録事項番号",
] as const;

function norm(value: string) {
  return (value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(value: string) {
  return norm(value).replace(/[\s:：|｜/\\・,，.。()（）\[\]【】]/g, "");
}

function numericChar(char: string) {
  const c = char.toUpperCase();
  if (/[0-9]/.test(c)) return c;
  if (/[OQD]/.test(c)) return "0";
  if (/[IL|]/.test(c)) return "1";
  if (c === "Z") return "2";
  if (c === "S") return "5";
  if (c === "B") return "8";
  return "";
}

function numericToken(value: string) {
  return [...value].map(numericChar).join("");
}

function parseRegistration(value: string) {
  const t = norm(value).replace(/\n/g, " ");
  const digitish = "0-9OoQqDdIiLl|ZzSsBb";
  const re = new RegExp(`([ぁ-んァ-ヶ一-龠々]{1,10})\\s*([${digitish}]\\s*[${digitish}]\\s*[${digitish}])\\s*([ぁ-ん])\\s*([${digitish}]\\s*[${digitish}]\\s*[${digitish}]\\s*[${digitish}])`);
  const m = t.match(re);
  if (!m) return "";
  const cls = numericToken(m[2]);
  const serial = numericToken(m[4]);
  if (cls.length !== 3 || serial.length !== 4) return "";
  return `${m[1]} ${cls} ${m[3]} ${serial}`;
}

function parseChassis(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "");
  const found = t.match(/[A-Z]{1,4}[0-9]{2,6}-[0-9O]{4,10}/g) || [];
  const picked = found.sort((a, b) => b.length - a.length)[0];
  if (!picked) return "";
  const [left, right] = picked.split("-");
  return `${left}-${right.replace(/O/g, "0")}`;
}

function parseJapaneseDate(value: string) {
  const t = norm(value).replace(/[年月日.,/\-]/g, " ").replace(/\s+/g, " ");
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*(\d{1,2})\s*(\d{1,2})/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function parseJapaneseMonth(value: string) {
  const t = norm(value).replace(/[年月日.,/\-]/g, " ").replace(/\s+/g, " ");
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*(\d{1,2})/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
}

function near(text: string, labels: string[], span = 180) {
  const t = norm(text);
  for (const label of labels) {
    const i = t.indexOf(label);
    if (i >= 0) return t.slice(i, i + span);
  }
  return "";
}

function documentNumber(value: string) {
  return (norm(value).match(/\b\d{10,14}\b/g) || [""])[0] || "";
}

function detailSection() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  ) || null;
}

function fieldInput(label: string) {
  const section = detailSection();
  if (!section) return null;
  for (const node of Array.from(section.querySelectorAll("label"))) {
    const text = (node.querySelector("span")?.textContent || node.textContent || "").trim();
    if (compact(text) === compact(label)) return node.querySelector("input") as HTMLInputElement | null;
  }
  return null;
}

function nativeSet(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function paperBox(canvas: HTMLCanvasElement): Box {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const isPaper = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const bright = (r + g + b) / 3;
    return bright > 130 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };
  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hits = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (isPaper(x, y)) hits++; n++; }
    if (hits / Math.max(1, n) > 0.24) ys.push(y);
  }
  if (ys.length < 8) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hits = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (isPaper(x, y)) hits++; n++; }
    if (hits / Math.max(1, n) > 0.24) xs.push(x);
  }
  if (xs.length < 8) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function cropTop(source: HTMLCanvasElement, paper: Box, y: number, h: number, target = 2600) {
  const box = {
    x: paper.x,
    y: Math.round(paper.y + paper.h * y),
    w: paper.w,
    h: Math.round(paper.h * h),
  };
  const scale = Math.max(1, Math.min(4, target / Math.max(1, box.w)));
  const out = document.createElement("canvas");
  out.width = Math.round(box.w * scale);
  out.height = Math.round(box.h * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  for (let p = 0; p < image.data.length; p += 4) {
    const gray = image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08;
    const v = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.6 + 156)));
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

async function imageCanvas(img: HTMLImageElement) {
  if (!img.complete || !img.naturalWidth) {
    await new Promise<void>((resolve, reject) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => reject(new Error("画像を開けませんでした")), { once: true });
    });
  }
  const scale = Math.min(1, 3600 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export default function CertificatePriorityFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let running = false;
    let lastSrc = "";

    const run = async () => {
      if (running) return;
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = document.querySelector("details pre") as HTMLElement | null;
      if (!img || !debug || !debug.textContent?.includes("【車検証 全体OCR】")) return;
      if (!img.src || img.src === lastSrc) return;
      running = true;
      lastSrc = img.src;
      let worker: any = null;
      try {
        const src = await imageCanvas(img);
        const paper = paperBox(src);
        const broad = cropTop(src, paper, 0.035, 0.31, 2800);
        const tight = cropTop(src, paper, 0.10, 0.18, 3000);
        const t: any = await import("tesseract.js");
        worker = await t.createWorker("jpn+eng", 1);
        const P = t.PSM;
        await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_pageseg_mode: String(P?.SPARSE_TEXT ?? "11") });
        const a = norm((await worker.recognize(broad)).data.text || "");
        await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_pageseg_mode: String(P?.SINGLE_BLOCK ?? "6") });
        const b = norm((await worker.recognize(tight)).data.text || "");
        const text = `${a}\n${b}`;

        const values = new Map<string, string>();
        values.set("自動車登録番号又は車両番号", parseRegistration(text));
        values.set("車台番号", parseChassis(near(text, ["車台番号"], 150)) || parseChassis(text));
        values.set("登録年月日／交付年月日", parseJapaneseDate(near(text, ["登録年月日", "交付年月日"], 170)));
        values.set("初度登録年月", parseJapaneseMonth(near(text, ["初度登録年月", "初度登録"], 150)));
        values.set("有効期間の満了する日", parseJapaneseDate(near(text, ["有効期間の満了する日"], 180)));
        values.set("記録年月日", parseJapaneseDate(near(text, ["記録年月日"], 130)));
        values.set("記録事項番号", documentNumber(near(text, ["記録事項"], 150)) || documentNumber(text));

        for (const label of IMPORTANT_FIELDS) {
          const value = values.get(label) || "";
          if (!value) continue;
          const input = fieldInput(label);
          if (!input || input.value === value) continue;
          nativeSet(input, value);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      } catch (error) {
        console.warn("upper certificate priority OCR failed", error);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        running = false;
      }
    };

    const observer = new MutationObserver(() => { void run(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    void run();
    return () => observer.disconnect();
  }, []);

  return null;
}
