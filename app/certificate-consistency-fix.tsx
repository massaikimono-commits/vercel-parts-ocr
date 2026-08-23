"use client";

import { useEffect } from "react";

type Box = { x: number; y: number; w: number; h: number };
type FinalValues = {
  recordDate?: string;
  registrationDate?: string;
  firstRegistration?: string;
  expiry?: string;
  userName?: string;
  userAddress?: string;
  base?: string;
  model?: string;
  engine?: string;
};

function norm(value: string) {
  return (value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function compact(value: string) {
  return norm(value).replace(/[\s:：|｜/\\・,，.。()（）\[\]【】]/g, "");
}

function sectionByHeading(text: string) {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes(text)
  ) || null;
}

function inputByLabel(sectionTitle: string, labelText: string) {
  const section = sectionByHeading(sectionTitle);
  if (!section) return null;
  for (const label of Array.from(section.querySelectorAll("label"))) {
    const title = (label.querySelector("span")?.textContent || label.textContent || "").trim();
    if (compact(title) !== compact(labelText)) continue;
    return label.querySelector("input") as HTMLInputElement | null;
  }
  return null;
}

function detailInput(label: string) {
  return inputByLabel("車検証読み取り情報", label);
}

function basicInput(label: string) {
  return inputByLabel("基本情報", label);
}

function nativeSetInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setIfDifferent(input: HTMLInputElement | null, value: string) {
  if (!input || !value || input.value === value) return;
  nativeSetInput(input, value);
}

function setAllowEmpty(input: HTMLInputElement | null, value: string) {
  if (!input || input.value === value) return;
  nativeSetInput(input, value);
}

function getDebugText() {
  return Array.from(document.querySelectorAll("details pre"))
    .map((node) => node.textContent || "")
    .join("\n");
}

function rawField(debug: string, label: string) {
  const marker = `【${label} 生OCR】`;
  const i = debug.indexOf(marker);
  if (i < 0) return "";
  return debug.slice(i + marker.length).split("\n")[0]?.trim() || "";
}

function nearLabel(debug: string, label: string, span = 260) {
  const i = debug.indexOf(label);
  if (i < 0) return "";
  return debug.slice(i, i + span);
}

function fixNumericGlyphs(value: string) {
  return norm(value)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");
}

type ParsedDate = { era: "令和" | "平成" | "昭和"; eraYear: number; month: number; day: number; serial: number };

function dateToSerial(era: ParsedDate["era"], eraYear: number, month: number, day: number) {
  const base = era === "令和" ? 2018 : era === "平成" ? 1988 : 1925;
  const year = base + eraYear;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return 0;
  return year * 10000 + month * 100 + day;
}

function parseDate(value: string): ParsedDate | null {
  const t = fixNumericGlyphs(value);
  const re = /(令和|平成|昭和)\s*(元|\d{1,2})\s*(?:年|[.．・/／-])?\s*(\d{1,2})\s*(?:月|[.．・/／-])?\s*(\d{1,2})\s*日?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const era = m[1] as ParsedDate["era"];
    const eraYear = m[2] === "元" ? 1 : Number(m[2]);
    const month = Number(m[3]);
    const day = Number(m[4]);
    if (eraYear < 1 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (era === "令和" && eraYear > 20) continue;
    if (era === "平成" && eraYear > 31) continue;
    if (era === "昭和" && eraYear > 64) continue;
    const serial = dateToSerial(era, eraYear, month, day);
    if (!serial) continue;
    return { era, eraYear, month, day, serial };
  }
  return null;
}

function formatDate(d: ParsedDate) {
  return `${d.era}${d.eraYear === 1 ? "元" : d.eraYear}年${d.month}月${d.day}日`;
}

function parseMonth(value: string) {
  const t = fixNumericGlyphs(value);
  const re = /(令和|平成|昭和)\s*(元|\d{1,2})\s*(?:年|[.．・/／-])?\s*(\d{1,2})\s*月?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const era = m[1];
    const year = m[2] === "元" ? 1 : Number(m[2]);
    const month = Number(m[3]);
    if (year < 1 || month < 1 || month > 12) continue;
    if (era === "令和" && year > 20) continue;
    if (era === "平成" && year > 31) continue;
    if (era === "昭和" && year > 64) continue;
    return `${era}${year === 1 ? "元" : year}年${month}月`;
  }
  return "";
}

function cleanLine(value: string) {
  return norm(value)
    .split("\n")
    .map((x) => x.replace(/^[|｜:：・.\-\s]+|[|｜:：・.\-\s]+$/g, "").trim())
    .filter(Boolean);
}

function bestName(value: string) {
  const banned = /使用者の氏名|使用者の住所|使用の本拠|車台番号|登録年月日|車両詳細情報|OCR|生OCR|採用/;
  const lines = cleanLine(value).filter((x) => !banned.test(x));
  const scored = lines.map((line) => {
    const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
    const company = /(株式会社|有限会社|合同会社|支店|営業所|本社|センター)/.test(line) ? 30 : 0;
    const tooShort = /^(株式会社|有限会社|合同会社)$/.test(line) ? -80 : 0;
    const noise = (line.match(/[<>{}=]/g) || []).length * -15;
    return { line, score: jp * 3 + company + tooShort + noise };
  }).filter((x) => x.score >= 18);
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.line?.slice(0, 80) || "";
}

function bestAddress(value: string) {
  const banned = /使用者の住所|使用の本拠|車両詳細情報|OCR|生OCR|採用/;
  const lines = cleanLine(value).filter((x) => !banned.test(x));
  const scored = lines.map((line) => {
    const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
    const address = /[都道府県市区町村郡町丁目番]/.test(line) ? 35 : 0;
    const digit = /\d/.test(fixNumericGlyphs(line)) ? 8 : 0;
    const noise = (line.match(/[<>{}=]/g) || []).length * -15;
    return { line, score: jp * 2 + address + digit + noise };
  }).filter((x) => x.score >= 25);
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.line?.slice(0, 100) || "";
}

function bestBase(value: string) {
  if (/[*＊]{2,}/.test(value)) return "***";
  if (/使用者.*住所.*同じ|住所に同じ/.test(value)) return "使用者住所に同じ";
  return bestAddress(value) || bestName(value);
}

function fixNkrFalseS(value: string) {
  return norm(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[＿_]/g, "-")
    .replace(/^NKRS(?=\d)/, "NKR")
    .replace(/-NKRS(?=\d)/, "-NKR");
}

function chassisFamily() {
  const value = basicInput("車台番号")?.value || detailInput("車台番号")?.value || "";
  return fixNkrFalseS(value).split("-")[0] || "";
}

function bestModel(value: string) {
  const text = fixNkrFalseS(value).replace(/[ \t\n]+/g, "");
  const prefixes = "DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG";
  const found = text.match(new RegExp(`(?:${prefixes})-[A-Z0-9]{3,12}`, "g")) || [];
  const family = chassisFamily();
  const candidates = found.map(fixNkrFalseS).filter((x, i, a) => a.indexOf(x) === i);
  const matching = family ? candidates.filter((x) => (x.split("-")[1] || "").startsWith(family)) : candidates;
  const pool = matching.length ? matching : candidates;
  pool.sort((a, b) => b.length - a.length);
  return pool[0] || "";
}

function bestEngine(value: string) {
  const text = norm(value).toUpperCase().replace(/[Oo]/g, "0");
  const all = [
    ...(text.match(/\b\d[A-Z]{2}\d(?:-[A-Z0-9]{2,8})?\b/g) || []),
    ...(text.match(/\b\d[A-Z]{1,3}[0-9A-Z]{1,3}(?:-[A-Z0-9]{2,8})?\b/g) || []),
    ...(text.match(/\b[A-Z]\d[A-Z0-9]{1,5}(?:-[A-Z0-9]{2,8})?\b/g) || []),
  ].filter((x, i, a) => a.indexOf(x) === i)
   .filter((x) => !/^(TKG|QKG|PKG|SKG|DAA|DBA|ABA|NKR|NPR|NLR|NMR)/.test(x));
  all.sort((a, b) => {
    const score = (x: string) => (/^\d[A-Z]{2}\d$/.test(x) ? 100 : 0) + (x.length <= 7 ? 20 : 0) - x.length;
    return score(b) - score(a);
  });
  return all[0] || "";
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
    return bright > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 105;
  };

  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hits = 0, total = 0;
    for (let x = 0; x < w; x += step) { if (isPaper(x, y)) hits++; total++; }
    if (hits / Math.max(1, total) > 0.22) ys.push(y);
  }
  if (ys.length < 8) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);

  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hits = 0, total = 0;
    for (let y = top; y <= bottom; y += step) { if (isPaper(x, y)) hits++; total++; }
    if (hits / Math.max(1, total) > 0.22) xs.push(x);
  }
  if (xs.length < 8) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

async function imageCanvas(img: HTMLImageElement) {
  if (!img.complete || !img.naturalWidth) {
    await new Promise<void>((resolve, reject) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => reject(new Error("画像を開けませんでした")), { once: true });
    });
  }
  const scale = Math.min(1, 4300 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function crop(source: HTMLCanvasElement, paper: Box, x: number, y: number, w: number, h: number, target = 3000) {
  const box = {
    x: Math.round(paper.x + paper.w * x),
    y: Math.round(paper.y + paper.h * y),
    w: Math.round(paper.w * w),
    h: Math.round(paper.h * h),
  };
  const scale = Math.max(1, Math.min(6, target / Math.max(1, box.w)));
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
    const v = Math.max(0, Math.min(255, Math.round((gray - 125) * 1.75 + 160)));
    image.data[p] = image.data[p + 1] = image.data[p + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

async function read(worker: any, canvas: HTMLCanvasElement, psm: any) {
  await worker.setParameters({
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_pageseg_mode: String(psm),
  });
  return norm((await worker.recognize(canvas)).data.text || "");
}

function buildFallbackFromDebug(debug: string, values: FinalValues) {
  const combined = (label: string) => `${rawField(debug, label)}\n${nearLabel(debug, label, 260)}`;
  values.recordDate ||= parseDate(combined("記録年月日")) ? formatDate(parseDate(combined("記録年月日"))!) : "";
  values.registrationDate ||= parseDate(combined("登録年月日／交付年月日")) ? formatDate(parseDate(combined("登録年月日／交付年月日"))!) : "";
  values.firstRegistration ||= parseMonth(combined("初度登録年月"));
  values.expiry ||= parseDate(combined("有効期間の満了する日")) ? formatDate(parseDate(combined("有効期間の満了する日"))!) : "";
  values.userName ||= bestName(combined("使用者の氏名又は名称"));
  values.userAddress ||= bestAddress(combined("使用者の住所"));
  values.base ||= bestBase(combined("使用の本拠の位置"));
  values.model ||= bestModel(`${rawField(debug, "型式")}\n${nearLabel(debug, "型式", 180)}\n${debug}`);
  values.engine ||= bestEngine(`${rawField(debug, "原動機の型式")}\n${nearLabel(debug, "原動機の型式", 180)}\n${debug}`);
}

function applyFinal(values: FinalValues) {
  const detailChassis = detailInput("車台番号");
  const basicChassis = basicInput("車台番号");
  const chassis = fixNkrFalseS(detailChassis?.value || basicChassis?.value || "");
  if (chassis) {
    setIfDifferent(detailChassis, chassis);
    setIfDifferent(basicChassis, chassis);
  }

  if (values.recordDate) setIfDifferent(detailInput("記録年月日"), values.recordDate);
  if (values.registrationDate) setIfDifferent(detailInput("登録年月日／交付年月日"), values.registrationDate);
  if (values.firstRegistration) {
    setIfDifferent(detailInput("初度登録年月"), values.firstRegistration);
    setIfDifferent(basicInput("初度登録（和暦）"), values.firstRegistration);
  }
  if (values.expiry) setIfDifferent(detailInput("有効期間の満了する日"), values.expiry);
  if (values.userName) setIfDifferent(detailInput("使用者の氏名又は名称"), values.userName);
  if (values.userAddress) setIfDifferent(detailInput("使用者の住所"), values.userAddress);
  if (values.base) setIfDifferent(detailInput("使用の本拠の位置"), values.base);
  if (values.model) {
    setIfDifferent(detailInput("型式"), values.model);
    setIfDifferent(basicInput("型式"), values.model);
  }
  if (values.engine) setIfDifferent(detailInput("原動機の型式"), values.engine);

  const reg = parseDate(detailInput("登録年月日／交付年月日")?.value || "");
  const expiryInput = detailInput("有効期間の満了する日");
  const exp = parseDate(expiryInput?.value || "");
  if (reg && exp && exp.serial < reg.serial) setAllowEmpty(expiryInput, "");

  const modelInput = detailInput("型式");
  if (modelInput?.value) {
    const fixed = fixNkrFalseS(modelInput.value);
    if (fixed !== modelInput.value) {
      setIfDifferent(modelInput, fixed);
      setIfDifferent(basicInput("型式"), fixed);
    }
  }
}

export default function CertificateConsistencyFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;

    let lastSrc = "";
    let pending: ReturnType<typeof setTimeout> | null = null;
    let activeWorker: any = null;
    let disposed = false;
    const replayTimers: ReturnType<typeof setTimeout>[] = [];

    const run = async (srcKey: string) => {
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = getDebugText();
      if (!img?.src || img.src !== srcKey || !debug.includes("【車検証 全体OCR】")) return;

      const values: FinalValues = {};
      try {
        const source = await imageCanvas(img);
        if (disposed || img.src !== srcKey) return;
        const paper = paperBox(source);
        const t: any = await import("tesseract.js");
        activeWorker = await t.createWorker("jpn+eng", 1);
        const P = t.PSM;
        const single = P?.SINGLE_LINE ?? "7";
        const sparse = P?.SPARSE_TEXT ?? "11";

        // 車検証は上段の固定行を項目ごとに再読する。
        // 既存の全体OCRより、この最終パスを優先する。
        const recordText = await read(activeWorker, crop(source, paper, 0.62, 0.055, 0.34, 0.055), single);
        const regDateText = await read(activeWorker, crop(source, paper, 0.16, 0.205, 0.25, 0.055), single);
        const firstText = await read(activeWorker, crop(source, paper, 0.40, 0.205, 0.25, 0.055), single);
        const expiryText = await read(activeWorker, crop(source, paper, 0.64, 0.205, 0.34, 0.055), single);
        const nameText = await read(activeWorker, crop(source, paper, 0.16, 0.250, 0.82, 0.055), sparse);
        const addressText = await read(activeWorker, crop(source, paper, 0.16, 0.282, 0.82, 0.058), sparse);
        const baseText = await read(activeWorker, crop(source, paper, 0.16, 0.315, 0.82, 0.050), sparse);
        const modelText = await read(activeWorker, crop(source, paper, 0.05, 0.370, 0.47, 0.055), single);
        const engineText = await read(activeWorker, crop(source, paper, 0.47, 0.370, 0.50, 0.055), single);

        const rd = parseDate(recordText);
        const rg = parseDate(regDateText);
        const ex = parseDate(expiryText);
        if (rd) values.recordDate = formatDate(rd);
        if (rg) values.registrationDate = formatDate(rg);
        values.firstRegistration = parseMonth(firstText) || undefined;
        if (ex) values.expiry = formatDate(ex);
        values.userName = bestName(`${nameText}\n${rawField(debug, "使用者の氏名又は名称")}\n${nearLabel(debug, "使用者の氏名又は名称", 220)}`) || undefined;
        values.userAddress = bestAddress(`${addressText}\n${rawField(debug, "使用者の住所")}\n${nearLabel(debug, "使用者の住所", 220)}`) || undefined;
        values.base = bestBase(`${baseText}\n${rawField(debug, "使用の本拠の位置")}\n${nearLabel(debug, "使用の本拠の位置", 180)}`) || undefined;
        values.model = bestModel(`${modelText}\n${rawField(debug, "型式")}\n${nearLabel(debug, "型式", 160)}`) || undefined;
        values.engine = bestEngine(`${engineText}\n${rawField(debug, "原動機の型式")}\n${nearLabel(debug, "原動機の型式", 160)}`) || undefined;
      } catch (error) {
        console.warn("final structured certificate OCR failed", error);
      } finally {
        if (activeWorker) await activeWorker.terminate().catch(() => {});
        activeWorker = null;
      }

      buildFallbackFromDebug(debug, values);
      if (disposed || (document.querySelector("img.preview") as HTMLImageElement | null)?.src !== srcKey) return;

      applyFinal(values);
      // 古い補正レイヤーが後から書き戻しても、最後に同じ確定値を再適用する。
      for (const delay of [1800, 4200, 8000]) {
        replayTimers.push(setTimeout(() => {
          if (!disposed && (document.querySelector("img.preview") as HTMLImageElement | null)?.src === srcKey) applyFinal(values);
        }, delay));
      }
    };

    const check = () => {
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = getDebugText();
      if (!img?.src || !debug.includes("【車検証 全体OCR】")) return;
      if (img.src === lastSrc) return;
      lastSrc = img.src;
      if (pending) clearTimeout(pending);
      // 他のOCRを先に終わらせてから最終確定パスを実行する。
      pending = setTimeout(() => { void run(img.src); }, 4800);
    };

    const interval = setInterval(check, 900);
    check();

    return () => {
      disposed = true;
      clearInterval(interval);
      if (pending) clearTimeout(pending);
      for (const timer of replayTimers) clearTimeout(timer);
      if (activeWorker) void activeWorker.terminate().catch(() => {});
    };
  }, []);

  return null;
}
