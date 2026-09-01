"use client";

import { useEffect } from "react";

type Box = { x: number; y: number; w: number; h: number };
type EraDate = { era: "令和" | "平成" | "昭和"; year: number; month: number; day?: number };

type Values = {
  recordDate?: string;
  recordNumber?: string;
  chassis?: string;
  registrationDate?: string;
  firstRegistration?: string;
  expiry?: string;
  userName?: string;
  userAddress?: string;
  base?: string;
  vehicleName?: string;
  model?: string;
  engine?: string;
  vehicleWeight?: string;
  grossWeight?: string;
  length?: string;
  width?: string;
  height?: string;
  frontFront?: string;
  frontRear?: string;
  rearFront?: string;
  rearRear?: string;
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

function nativeSet(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setValue(input: HTMLInputElement | null, value?: string) {
  if (!input || !value || input.value === value) return;
  nativeSet(input, value);
}

function digits(value: string) {
  return norm(value)
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

function formatDate(v: EraDate) {
  const y = v.year === 1 ? "元" : String(v.year);
  return v.day ? `${v.era}${y}年${v.month}月${v.day}日` : `${v.era}${y}年${v.month}月`;
}

function validEraDate(v: EraDate) {
  if (v.year < 1 || v.month < 1 || v.month > 12) return false;
  if (v.era === "令和" && v.year > 20) return false;
  if (v.era === "平成" && v.year > 31) return false;
  if (v.era === "昭和" && v.year > 64) return false;
  if (v.day == null) return true;
  if (v.day < 1 || v.day > 31) return false;
  const base = v.era === "令和" ? 2018 : v.era === "平成" ? 1988 : 1925;
  const d = new Date(base + v.year, v.month - 1, v.day);
  return d.getFullYear() === base + v.year && d.getMonth() === v.month - 1 && d.getDate() === v.day;
}

function eraSegments(value: string) {
  const t = digits(value)
    .replace(/[．・]/g, ".")
    .replace(/[年月日]/g, ".")
    .replace(/[／/]/g, ".");
  const starts = [...t.matchAll(/令和|平成|昭和/g)].map((m) => m.index || 0);
  const out: EraDate[] = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = t.slice(starts[i], starts[i + 1] ?? t.length);
    const eraMatch = seg.match(/(令和|平成|昭和)/);
    if (!eraMatch) continue;
    const era = eraMatch[1] as EraDate["era"];
    const nums = (seg.slice(eraMatch.index! + era.length).match(/\d{1,2}/g) || []).map(Number);
    if (nums.length < 2) continue;
    const candidate: EraDate = { era, year: nums[0], month: nums[1], day: nums[2] };
    if (validEraDate(candidate)) out.push(candidate);
  }
  return out;
}

function modelFamily() {
  const model = (detailInput("型式")?.value || basicInput("型式")?.value || "").toUpperCase();
  const body = model.split("-").pop()?.replace(/[^A-Z0-9]/g, "") || "";
  return body.replace(/[A-Z]$/, "");
}

function parseChassis(value: string) {
  const text = norm(value).toUpperCase().replace(/[＿_]/g, "-");
  const family = modelFamily();
  const found = text.match(/[A-Z0-9]{3,10}\s*-\s*[0-9OQDIL|ZSB\s]{5,12}/g) || [];
  for (const raw of found) {
    const [leftRaw, rightRaw] = raw.replace(/\s+/g, "").split("-");
    const suffix = digits(rightRaw).replace(/\D/g, "");
    if (suffix.length < 6 || suffix.length > 9) continue;
    let left = leftRaw.replace(/[^A-Z0-9]/g, "");
    if (family && (left.length === family.length || left.startsWith(family.slice(0, 3)))) left = family;
    if (/[A-Z]/.test(left) && /\d/.test(left)) return `${left}-${suffix}`;
  }
  return "";
}

function parseRecordNumber(value: string) {
  const candidates = (digits(value).match(/\d{10,13}/g) || []).sort((a, b) => b.length - a.length);
  return candidates[0] || "";
}

function cleanName(value: string) {
  const lines = norm(value).split("\n").map((x) => x.trim()).filter(Boolean);
  const companyWords = ["株式会社", "有限会社", "合同会社", "一般社団法人", "一般財団法人"];
  for (const line0 of lines) {
    let line = line0.replace(/^[|｜:：・.\-\s]+|[|｜:：・.\-\s]+$/g, "");
    for (const word of companyWords) {
      const i = line.indexOf(word);
      if (i >= 0) line = line.slice(i);
    }
    if (/(株式会社|有限会社|合同会社|支店|営業所|本社)/.test(line)) {
      line = line.replace(/\s{2,}/g, " ").trim();
      if ((line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length >= 5) return line.slice(0, 90);
    }
  }
  return "";
}

function cleanAddress(value: string) {
  const lines = norm(value).split("\n").map((x) => x.trim()).filter(Boolean);
  for (let line of lines) {
    const pref = line.match(/(?:北海道|東京都|大阪府|京都府|[一-龠]{2,3}県)/);
    if (pref?.index != null) line = line.slice(pref.index);
    line = line
      .replace(/(?<=\d)\s+(?=\d)/g, "")
      .replace(/\s*[-ー]\s*/g, "-")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (/[都道府県]/.test(line) && /[市区町村郡]/.test(line) && (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length >= 5) {
      return line.slice(0, 110);
    }
  }
  return "";
}

function cleanBase(value: string) {
  const t = norm(value);
  if (/[*＊※]{2,}/.test(t)) return "***";
  const stripped = t.replace(/[\s|｜:：._\-]/g, "");
  if (stripped.length >= 2 && stripped.length <= 8 && !/[一-龠々ぁ-んァ-ヶA-Za-z0-9]/.test(stripped)) return "***";
  if (/使用者.*住所.*同じ|住所に同じ/.test(t)) return "使用者住所に同じ";
  return cleanAddress(t);
}

function parseVehicleName(value: string) {
  const t = norm(value);
  const makers = ["いすゞ", "トヨタ", "日産", "ホンダ", "マツダ", "スズキ", "三菱", "ダイハツ", "スバル", "日野", "ＵＤ", "UD", "メルセデス", "BMW", "フォルクスワーゲン"];
  return makers.find((m) => t.includes(m)) || "";
}

function parseModel(value: string) {
  const t = norm(value).toUpperCase().replace(/[＿_]/g, "-").replace(/\s+/g, "");
  const prefixes = "DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG";
  const all = t.match(new RegExp(`(?:${prefixes})-[A-Z0-9]{3,12}`, "g")) || [];
  const family = modelFamily();
  const fixed = all.map((x) => x.replace(/-NKRS(?=\d)/, "-NKR"));
  const matching = family ? fixed.filter((x) => (x.split("-")[1] || "").startsWith(family.slice(0, 3))) : fixed;
  return (matching[0] || fixed[0] || "");
}

function parseEngine(value: string) {
  const t = norm(value).toUpperCase().replace(/[Oo]/g, "0");
  const all = [
    ...(t.match(/\b\d[A-Z]{2}\d\b/g) || []),
    ...(t.match(/\b\d[A-Z]{1,3}[0-9A-Z]{1,3}(?:-[A-Z0-9]{2,8})?\b/g) || []),
    ...(t.match(/\b[A-Z]\d[A-Z0-9]{1,4}(?:-[A-Z0-9]{2,8})?\b/g) || []),
  ].filter((x, i, a) => a.indexOf(x) === i)
   .filter((x) => !/^(TKG|QKG|PKG|SKG|DAA|DBA|ABA|NKR|NPR|NLR|NMR|OCR)$/.test(x));
  all.sort((a, b) => (/^\d[A-Z]{2}\d$/.test(b) ? 100 : 0) - (/^\d[A-Z]{2}\d$/.test(a) ? 100 : 0));
  return all[0] || "";
}

function numericCandidates(value: string) {
  return (digits(value).match(/\d{2,5}/g) || []).map(Number);
}

function parseDimensionRow(value: string) {
  const nums = numericCandidates(value);
  for (let i = 0; i + 4 < nums.length; i++) {
    const [vw, gw, len, wid, hei] = nums.slice(i, i + 5);
    if (vw >= 500 && vw <= 50000 && gw >= vw && gw <= 80000 && len >= 200 && len <= 2000 && wid >= 100 && wid <= 350 && hei >= 100 && hei <= 500) {
      return [vw, gw, len, wid, hei].map(String);
    }
  }
  return [];
}

function parseAxles(value: string) {
  const nums = numericCandidates(value).filter((n) => n >= 200 && n <= 30000);
  if (nums.length >= 4) return nums.slice(0, 4).map(String);
  if (nums.length === 2) return [String(nums[0]), "", "", String(nums[1])];
  return [];
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
    return bright > 118 && Math.max(r, g, b) - Math.min(r, g, b) < 105;
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

async function sourceCanvas(img: HTMLImageElement) {
  if (!img.complete || !img.naturalWidth) {
    await new Promise<void>((resolve, reject) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => reject(new Error("image load failed")), { once: true });
    });
  }
  const scale = Math.min(1, 4500 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function crop(source: HTMLCanvasElement, paper: Box, x: number, y: number, w: number, h: number, target = 3200) {
  const b = {
    x: Math.round(paper.x + paper.w * x),
    y: Math.round(paper.y + paper.h * y),
    w: Math.round(paper.w * w),
    h: Math.round(paper.h * h),
  };
  const scale = Math.max(1, Math.min(7, target / Math.max(1, b.w)));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(b.w * scale));
  out.height = Math.max(1, Math.round(b.h * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height);
  const im = ctx.getImageData(0, 0, out.width, out.height);
  for (let p = 0; p < im.data.length; p += 4) {
    const gray = im.data[p] * 0.22 + im.data[p + 1] * 0.70 + im.data[p + 2] * 0.08;
    const v = Math.max(0, Math.min(255, Math.round((gray - 120) * 1.9 + 165)));
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return out;
}

async function read(worker: any, canvas: HTMLCanvasElement, psm: any) {
  await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_pageseg_mode: String(psm) });
  return norm((await worker.recognize(canvas)).data.text || "");
}

function apply(values: Values) {
  setValue(detailInput("記録年月日"), values.recordDate);
  setValue(detailInput("記録事項番号"), values.recordNumber);
  if (values.chassis) {
    setValue(detailInput("車台番号"), values.chassis);
    setValue(basicInput("車台番号"), values.chassis);
  }
  setValue(detailInput("登録年月日／交付年月日"), values.registrationDate);
  if (values.firstRegistration) {
    setValue(detailInput("初度登録年月"), values.firstRegistration);
    setValue(basicInput("初度登録（和暦）"), values.firstRegistration);
  }
  setValue(detailInput("有効期間の満了する日"), values.expiry);
  setValue(detailInput("使用者の氏名又は名称"), values.userName);
  setValue(detailInput("使用者の住所"), values.userAddress);
  setValue(detailInput("使用の本拠の位置"), values.base);
  setValue(detailInput("車名"), values.vehicleName);
  if (values.model) {
    setValue(detailInput("型式"), values.model);
    setValue(basicInput("型式"), values.model);
  }
  setValue(detailInput("原動機の型式"), values.engine);
  setValue(detailInput("車両重量 kg"), values.vehicleWeight);
  setValue(basicInput("車両重量 kg"), values.vehicleWeight);
  setValue(detailInput("車両総重量 kg"), values.grossWeight);
  setValue(detailInput("長さ cm"), values.length);
  setValue(detailInput("幅 cm"), values.width);
  setValue(detailInput("高さ cm"), values.height);
  setValue(detailInput("前前軸重 kg"), values.frontFront);
  setValue(detailInput("前後軸重 kg"), values.frontRear);
  setValue(detailInput("後前軸重 kg"), values.rearFront);
  setValue(detailInput("後後軸重 kg"), values.rearRear);
}

export default function CertificateGeometryFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let lastSrc = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let worker: any = null;
    let disposed = false;
    const replays: ReturnType<typeof setTimeout>[] = [];

    const run = async (src: string) => {
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      if (!img?.src || img.src !== src) return;
      const values: Values = {};
      try {
        const source = await sourceCanvas(img);
        const paper = paperBox(source);
        const t: any = await import("./lib/tesseract-local");
        worker = await t.createWorker("jpn+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract/core", langPath: "/tesseract/lang" });
        const single = t.PSM?.SINGLE_LINE ?? "7";

        const record = await read(worker, crop(source, paper, 0.63, 0.043, 0.35, 0.047), single);
        const chassis = await read(worker, crop(source, paper, 0.055, 0.118, 0.58, 0.042), single);
        const dateRow = await read(worker, crop(source, paper, 0.08, 0.145, 0.90, 0.044), single);
        const name = await read(worker, crop(source, paper, 0.12, 0.174, 0.84, 0.045), single);
        const address = await read(worker, crop(source, paper, 0.12, 0.202, 0.84, 0.047), single);
        const base = await read(worker, crop(source, paper, 0.10, 0.229, 0.86, 0.040), single);
        const vehicleName = await read(worker, crop(source, paper, 0.06, 0.252, 0.58, 0.037), single);
        const modelEngine = await read(worker, crop(source, paper, 0.055, 0.273, 0.92, 0.047), single);
        const dimensions = await read(worker, crop(source, paper, 0.055, 0.326, 0.92, 0.045), single);
        const axles = await read(worker, crop(source, paper, 0.055, 0.350, 0.92, 0.045), single);

        const recordDates = eraSegments(record);
        if (recordDates[0]?.day) values.recordDate = formatDate(recordDates[0]);
        values.recordNumber = parseRecordNumber(record) || undefined;
        values.chassis = parseChassis(chassis) || undefined;

        const ds = eraSegments(dateRow);
        const withDay = ds.filter((d) => d.day != null);
        const monthOnly = ds.filter((d) => d.day == null);
        if (withDay[0]) values.registrationDate = formatDate(withDay[0]);
        const first = monthOnly[0] || ds.find((d, i) => i > 0 && i < ds.length - 1 && d.day == null);
        if (first) values.firstRegistration = formatDate({ ...first, day: undefined });
        if (withDay[1]) values.expiry = formatDate(withDay[1]);

        values.userName = cleanName(name) || undefined;
        values.userAddress = cleanAddress(address) || undefined;
        values.base = cleanBase(base) || undefined;
        values.vehicleName = parseVehicleName(vehicleName) || undefined;
        values.model = parseModel(modelEngine) || undefined;
        values.engine = parseEngine(modelEngine) || undefined;

        const row = parseDimensionRow(dimensions);
        if (row.length === 5) [values.vehicleWeight, values.grossWeight, values.length, values.width, values.height] = row;
        const aw = parseAxles(axles);
        if (aw.length === 4) [values.frontFront, values.frontRear, values.rearFront, values.rearRear] = aw;
      } catch (error) {
        console.warn("certificate geometry final OCR failed", error);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        worker = null;
      }

      if (disposed || (document.querySelector("img.preview") as HTMLImageElement | null)?.src !== src) return;
      apply(values);
      for (const delay of [2500, 6000, 11000]) {
        replays.push(setTimeout(() => {
          if (!disposed && (document.querySelector("img.preview") as HTMLImageElement | null)?.src === src) apply(values);
        }, delay));
      }
    };

    const check = () => {
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = Array.from(document.querySelectorAll("details pre")).map((n) => n.textContent || "").join("\n");
      if (!img?.src || !debug.includes("【車検証 全体OCR】") || img.src === lastSrc) return;
      lastSrc = img.src;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(img.src), 12500);
    };

    const interval = setInterval(check, 1000);
    check();
    return () => {
      disposed = true;
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      replays.forEach(clearTimeout);
      if (worker) void worker.terminate().catch(() => {});
    };
  }, []);

  return null;
}
