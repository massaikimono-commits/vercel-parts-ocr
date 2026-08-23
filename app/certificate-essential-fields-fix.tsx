"use client";

import { useEffect } from "react";

type Box = { x: number; y: number; w: number; h: number };

type Target = {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  target?: number;
};

const TARGETS: Target[] = [
  { label: "車台番号", x: 0.08, y: 0.105, w: 0.62, h: 0.055, target: 2500 },
  { label: "登録年月日／交付年月日", x: 0.08, y: 0.145, w: 0.42, h: 0.062, target: 2600 },
  { label: "有効期間の満了する日", x: 0.65, y: 0.145, w: 0.35, h: 0.062, target: 2400 },
  { label: "使用者の氏名又は名称", x: 0.08, y: 0.190, w: 0.90, h: 0.060, target: 2800 },
  { label: "使用者の住所", x: 0.08, y: 0.235, w: 0.90, h: 0.060, target: 2800 },
];

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

function fieldSection() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  ) || null;
}

function fieldInput(label: string) {
  const section = fieldSection();
  if (!section) return null;
  for (const node of Array.from(section.querySelectorAll("label"))) {
    const text = (node.querySelector("span")?.textContent || node.textContent || "").trim();
    if (compact(text) === compact(label)) return node.querySelector("input") as HTMLInputElement | null;
  }
  return null;
}

function basicSection() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    (section.querySelector("h2")?.textContent || "").trim() === "基本情報"
  ) || null;
}

function basicInput(label: string) {
  const section = basicSection();
  if (!section) return null;
  for (const node of Array.from(section.querySelectorAll("label"))) {
    const text = (node.querySelector("span")?.textContent || node.textContent || "").trim();
    if (compact(text) === compact(label)) return node.querySelector("input") as HTMLInputElement | null;
  }
  return null;
}

function nativeSet(input: HTMLInputElement | null, value: string) {
  if (!input || !value || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function parseChassis(value: string) {
  const t = norm(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[＿_]/g, "-")
    .replace(/[—–―]/g, "-");
  const matches = t.match(/[A-Z]{1,4}[0-9OQDSB]{1,5}-[0-9OQDSB]{4,10}/g) || [];
  const fixed = matches
    .map((x) => {
      const [leftRaw, rightRaw] = x.split("-");
      const left = leftRaw
        .replace(/O(?=\d)/g, "0")
        .replace(/Q(?=\d)/g, "0")
        .replace(/D(?=\d)/g, "0");
      const right = rightRaw
        .replace(/[OQD]/g, "0")
        .replace(/S/g, "5")
        .replace(/B/g, "8");
      return `${left}-${right}`;
    })
    .filter((x) => /[A-Z]/.test(x.split("-")[0]) && /\d/.test(x.split("-")[0]))
    .filter((x) => !/^(DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|ZAA)-/.test(x));
  return fixed.sort((a, b) => b.length - a.length)[0] || "";
}

function dateText(value: string) {
  return norm(value)
    .replace(/\s+/g, "")
    .replace(/[OoQq]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[.,/\\_\-]/g, "");
}

function parseJapaneseDate(value: string) {
  const t = dateText(value);
  const m = t.match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function stripLabel(value: string, labels: string[]) {
  let t = norm(value).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  for (const label of labels) {
    const chars = [...label.replace(/\s+/g, "")].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(chars.join("\\s*"), "g");
    t = t.replace(re, " ");
  }
  return t
    .replace(/^[\s:：|｜・.\-]+|[\s:：|｜・.\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUserName(value: string) {
  const t = stripLabel(value, ["使用者の氏名又は名称", "使用者氏名又は名称", "氏名又は名称"]);
  if (!t || t.length > 70) return "";
  if (/住所|本拠|登録番号|車台番号|車両詳細/.test(t)) return "";
  const jp = (t.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
  const bad = (t.match(/[<>{}\[\]]/g) || []).length;
  if (jp < 3 || bad > 0) return "";
  return t;
}

function parseAddress(value: string) {
  const t = stripLabel(value, ["使用者の住所", "使用者住所", "住所"]);
  if (!t || t.length > 90) return "";
  if (/氏名|名称|本拠|車名|型式|車両詳細/.test(t)) return "";
  const jp = (t.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
  if (jp < 4) return "";
  if (!/[都道府県市区町村郡町丁目番地号]/.test(t)) return "";
  return t;
}

async function imageCanvas(img: HTMLImageElement) {
  if (!img.complete || !img.naturalWidth) {
    await new Promise<void>((resolve, reject) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => reject(new Error("画像を開けませんでした")), { once: true });
    });
  }
  const scale = Math.min(1, 4200 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function detectPaper(c: HTMLCanvasElement): Box {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: c.width, h: c.height };
  const { width: w, height: h } = c;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 700));
  const isPaper = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const bright = (r + g + b) / 3;
    return bright > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 105;
  };
  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (isPaper(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 8) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (isPaper(x, y)) hit++; n++; }
    if (hit / Math.max(1, n) > 0.22) xs.push(x);
  }
  if (xs.length < 8) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source: HTMLCanvasElement, paper: Box, target: Target) {
  const box = {
    x: Math.round(paper.x + paper.w * target.x),
    y: Math.round(paper.y + paper.h * target.y),
    w: Math.round(paper.w * target.w),
    h: Math.round(paper.h * target.h),
  };
  const desired = target.target || 2600;
  const scale = Math.max(1, Math.min(6, desired / Math.max(1, box.w)));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(box.w * scale));
  out.height = Math.max(1, Math.round(box.h * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  for (let p = 0; p < image.data.length; p += 4) {
    const gray = image.data[p] * 0.22 + image.data[p + 1] * 0.70 + image.data[p + 2] * 0.08;
    const v = Math.max(0, Math.min(255, Math.round((gray - 125) * 1.9 + 165)));
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

async function recognize(worker: any, canvas: HTMLCanvasElement, psm: string, whitelist = "") {
  const params: Record<string, string> = {
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_pageseg_mode: psm,
  };
  if (whitelist) params.tessedit_char_whitelist = whitelist;
  else params.tessedit_char_whitelist = "";
  await worker.setParameters(params);
  return norm((await worker.recognize(canvas)).data.text || "");
}

function needsRun() {
  const important = [
    "車台番号",
    "登録年月日／交付年月日",
    "有効期間の満了する日",
    "使用者の氏名又は名称",
    "使用者の住所",
  ];
  return important.some((label) => !fieldInput(label)?.value?.trim());
}

export default function CertificateEssentialFieldsFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let busy = false;
    let lastSrc = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (busy) return;
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = document.querySelector("details pre") as HTMLElement | null;
      if (!img || !debug || !debug.textContent?.includes("【車検証 全体OCR】")) return;
      if (!img.src || img.src === lastSrc) return;
      if (!needsRun()) return;

      busy = true;
      lastSrc = img.src;
      let worker: any = null;
      try {
        const source = await imageCanvas(img);
        const paper = detectPaper(source);
        const t: any = await import("tesseract.js");
        worker = await t.createWorker("jpn+eng", 1);
        const P = t.PSM;

        const chassisCrop = crop(source, paper, TARGETS[0]);
        const chassisText = await recognize(worker, chassisCrop, String(P?.SINGLE_LINE ?? "7"), "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ ");
        const chassis = parseChassis(chassisText);
        if (chassis) {
          nativeSet(fieldInput("車台番号"), chassis);
          nativeSet(basicInput("車台番号"), chassis);
        }

        const registrationCrop = crop(source, paper, TARGETS[1]);
        const registrationText = await recognize(worker, registrationCrop, String(P?.SINGLE_LINE ?? "7"));
        const registrationDate = parseJapaneseDate(registrationText);
        if (registrationDate) nativeSet(fieldInput("登録年月日／交付年月日"), registrationDate);

        const expiryCrop = crop(source, paper, TARGETS[2]);
        const expiryText = await recognize(worker, expiryCrop, String(P?.SINGLE_LINE ?? "7"));
        const expiry = parseJapaneseDate(expiryText);
        if (expiry) nativeSet(fieldInput("有効期間の満了する日"), expiry);

        const nameCrop = crop(source, paper, TARGETS[3]);
        const nameText = await recognize(worker, nameCrop, String(P?.SINGLE_LINE ?? "7"));
        const userName = parseUserName(nameText);
        if (userName) nativeSet(fieldInput("使用者の氏名又は名称"), userName);

        const addressCrop = crop(source, paper, TARGETS[4]);
        const addressText = await recognize(worker, addressCrop, String(P?.SINGLE_LINE ?? "7"));
        const userAddress = parseAddress(addressText);
        if (userAddress) nativeSet(fieldInput("使用者の住所"), userAddress);
      } catch (error) {
        console.warn("essential certificate OCR failed", error);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        busy = false;
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void run(); }, 1600);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
