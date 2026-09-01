"use client";

import { useEffect } from "react";

type Box = { x: number; y: number; w: number; h: number };
type EraValue = { era: "令和" | "平成" | "昭和"; year: number; month: number; day?: number };
type Values = {
  recordDate?: string;
  recordNumber?: string;
  registration?: string;
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
  vehicleClass?: string;
  purpose?: string;
  privateBusiness?: string;
  bodyShape?: string;
  seating?: string;
  maxPayload?: string;
  vehicleWeight?: string;
  grossWeight?: string;
  length?: string;
  width?: string;
  height?: string;
  frontFront?: string;
  frontRear?: string;
  rearFront?: string;
  rearRear?: string;
  output?: string;
  fuel?: string;
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

function numericText(value: string) {
  return norm(value)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");
}

function formatEra(v: EraValue) {
  const y = v.year === 1 ? "元" : String(v.year);
  return v.day ? `${v.era}${y}年${v.month}月${v.day}日` : `${v.era}${y}年${v.month}月`;
}

function validEra(v: EraValue) {
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

function eraValues(value: string) {
  const t = numericText(value)
    .replace(/[年月日．・]/g, ".")
    .replace(/[／/]/g, ".");
  const matches = [...t.matchAll(/令和|平成|昭和/g)];
  const out: EraValue[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index || 0;
    const end = matches[i + 1]?.index ?? t.length;
    const segment = t.slice(start, end);
    const em = segment.match(/(令和|平成|昭和)/);
    if (!em) continue;
    const nums = (segment.slice((em.index || 0) + em[1].length).match(/\d{1,2}/g) || []).map(Number);
    if (nums.length < 2) continue;
    const v: EraValue = {
      era: em[1] as EraValue["era"],
      year: nums[0],
      month: nums[1],
      day: nums[2],
    };
    if (validEra(v)) out.push(v);
  }
  return out;
}

function documentNumber(value: string) {
  const text = numericText(value).replace(/[^0-9\n ]/g, " ");
  const exact = text.match(/\b\d{12}\b/g) || [];
  if (exact.length) return exact[0];
  const other = text.match(/\b\d{11,13}\b/g) || [];
  return other.find((x) => new Set(x).size >= 4) || "";
}

function registration(value: string) {
  const t = norm(value);
  const m = t.match(/([一-龠ぁ-んァ-ヶ]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  if (!m) return "";
  const a = m[2].replace(/\D/g, "");
  const b = m[4].replace(/\D/g, "");
  return a.length === 3 && b.length === 4 ? `${m[1]} ${a} ${m[3]} ${b}` : "";
}

function chassis(value: string) {
  const t = numericText(value).toUpperCase().replace(/[＿_]/g, "-");
  const found = t.match(/[A-Z]{2,5}\d{1,5}\s*-\s*[0-9\s]{6,10}/g) || [];
  const candidates = found.map((raw) => {
    const [left0, right0] = raw.replace(/\s+/g, "").split("-");
    const left = left0.replace(/^NKRS(?=\d)/, "NKR");
    const right = right0.replace(/\D/g, "");
    return `${left}-${right}`;
  }).filter((x) => {
    const [left, right] = x.split("-");
    if (!/[A-Z]/.test(left) || !/\d/.test(left)) return false;
    if (right.length < 6 || right.length > 9) return false;
    if (/^(\d)\1{5,}$/.test(right)) return false;
    if (/^10{5,}$/.test(right)) return false;
    return new Set(right).size >= 3;
  });
  candidates.sort((a, b) => {
    const score = (x: string) => {
      const [left, right] = x.split("-");
      return (left.startsWith("NKR") ? 40 : 0) + new Set(right).size * 3 + right.length;
    };
    return score(b) - score(a);
  });
  return candidates[0] || "";
}

function lines(value: string) {
  return norm(value).split("\n").map((x) => x.trim()).filter(Boolean);
}

function cleanName(value: string) {
  const companyWords = ["株式会社", "有限会社", "合同会社", "一般社団法人", "一般財団法人"];
  for (const line0 of lines(value)) {
    let line = line0.replace(/^[|｜:：・.\-\s]+|[|｜:：・.\-\s]+$/g, "");
    for (const word of companyWords) {
      const i = line.indexOf(word);
      if (i >= 0) line = line.slice(i);
    }
    if (/(株式会社|有限会社|合同会社|支店|営業所|本社)/.test(line)) {
      line = line.replace(/\s{2,}/g, " ").trim();
      const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
      if (jp >= 5 && line.length <= 80) return line;
    }
  }
  return "";
}

function cleanAddress(value: string) {
  for (const line0 of lines(value)) {
    let line = line0;
    const pref = line.match(/(?:北海道|東京都|大阪府|京都府|[一-龠]{2,3}県)/);
    if (pref?.index != null) line = line.slice(pref.index);
    line = numericText(line)
      .replace(/(?<=\d)\s+(?=\d)/g, "")
      .replace(/\s*[-ー]\s*/g, "-")
      .replace(/\s{2,}/g, " ")
      .trim();
    const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
    if (/[都道府県]/.test(line) && /[市区町村郡]/.test(line) && jp >= 5) return line.slice(0, 100);
  }
  return "";
}

function cleanBase(value: string) {
  const t = norm(value);
  if (/[*＊※]{2,}/.test(t)) return "***";
  if (/使用者.*住所.*同じ|住所に同じ/.test(t)) return "使用者住所に同じ";
  return cleanAddress(t);
}

function known(value: string, choices: string[]) {
  const t = compact(value);
  return choices.find((x) => t.includes(compact(x))) || "";
}

function maker(value: string) {
  return known(value, ["いすゞ","トヨタ","日産","ホンダ","マツダ","スズキ","三菱","ダイハツ","スバル","日野","UDトラックス","レクサス","BMW","アウディ","フォルクスワーゲン"]);
}

function model(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "").replace(/[＿_]/g, "-").replace(/-NKRS(?=\d)/, "-NKR");
  const prefixes = "DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG";
  return t.match(new RegExp(`(?:${prefixes})-[A-Z0-9]{3,12}`))?.[0] || "";
}

function engine(value: string) {
  const t = norm(value).toUpperCase().replace(/[Oo]/g, "0");
  const strict = t.match(/\b\d[A-Z]{2}\d\b/g) || [];
  if (strict.length) return strict[0];
  const all = t.match(/\b\d[A-Z]{1,3}[0-9A-Z]{1,3}\b/g) || [];
  return all.find((x) => !/^(TKG|QKG|PKG|SKG|DAA|DBA|ABA)$/.test(x)) || "";
}

function seating(value: string) {
  const m = numericText(value).match(/\b(\d{1,2})\s*人/);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 99 ? String(Number(m[1])) : "";
}

function payload(value: string) {
  const nums = (numericText(value).replace(/,/g, "").match(/\d{3,5}/g) || []).map(Number).filter((n) => n >= 100 && n <= 99999);
  return nums.length ? String(Math.max(...nums)) : "";
}

function numericCandidates(value: string) {
  return (numericText(value).replace(/,/g, "").match(/\d{2,5}/g) || []).map(Number);
}

function dimensions(value: string) {
  const nums = numericCandidates(value);
  for (let i = 0; i + 4 < nums.length; i++) {
    const [vw, gw, len, wid, hei] = nums.slice(i, i + 5);
    if (vw >= 500 && vw <= 50000 && gw >= vw && gw <= 80000 && len >= 200 && len <= 2000 && wid >= 100 && wid <= 350 && hei >= 100 && hei <= 500) {
      return [vw, gw, len, wid, hei].map(String);
    }
  }
  return [];
}

function axles(value: string) {
  const nums = numericCandidates(value).filter((n) => n >= 200 && n <= 30000);
  const unique = nums.filter((n, i, a) => a.indexOf(n) === i);
  if (unique.length >= 4) return unique.slice(0, 4).map(String);
  if (unique.length === 2) return [String(unique[0]), "", "", String(unique[1])];
  return [];
}

function ratedOutput(value: string) {
  const t = numericText(value);
  return t.match(/\b\d+\.\d+\b/)?.[0] || "";
}

function sectionByHeading(text: string) {
  return Array.from(document.querySelectorAll("section.card")).find((section) => section.querySelector("h2")?.textContent?.includes(text)) || null;
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

function detail(label: string) { return inputByLabel("車検証読み取り情報", label); }
function basic(label: string) { return inputByLabel("基本情報", label); }

function nativeSet(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setValue(input: HTMLInputElement | null, value?: string) {
  if (!input || !value || input.value === value) return;
  nativeSet(input, value);
}

function setDetail(label: string, value?: string) { setValue(detail(label), value); }

function apply(v: Values) {
  setDetail("記録年月日", v.recordDate);
  setDetail("記録事項番号", v.recordNumber);
  if (v.registration) {
    setDetail("自動車登録番号又は車両番号", v.registration);
    setValue(basic("登録番号"), v.registration);
  }
  if (v.chassis) {
    setDetail("車台番号", v.chassis);
    setValue(basic("車台番号"), v.chassis);
  }
  setDetail("登録年月日／交付年月日", v.registrationDate);
  if (v.firstRegistration) {
    setDetail("初度登録年月", v.firstRegistration);
    setValue(basic("初度登録（和暦）"), v.firstRegistration);
  }
  setDetail("有効期間の満了する日", v.expiry);
  setDetail("使用者の氏名又は名称", v.userName);
  setDetail("使用者の住所", v.userAddress);
  setDetail("使用の本拠の位置", v.base);
  setDetail("車名", v.vehicleName);
  if (v.model) {
    setDetail("型式", v.model);
    setValue(basic("型式"), v.model);
  }
  setDetail("原動機の型式", v.engine);
  setDetail("自動車の種別", v.vehicleClass);
  setDetail("用途", v.purpose);
  setDetail("自家用・事業用の別", v.privateBusiness);
  setDetail("車体の形状", v.bodyShape);
  setDetail("乗車定員", v.seating);
  setDetail("最大積載量 kg", v.maxPayload);
  if (v.vehicleWeight) {
    setDetail("車両重量 kg", v.vehicleWeight);
    setValue(basic("車両重量 kg"), v.vehicleWeight);
  }
  setDetail("車両総重量 kg", v.grossWeight);
  setDetail("長さ cm", v.length);
  setDetail("幅 cm", v.width);
  setDetail("高さ cm", v.height);
  setDetail("前前軸重 kg", v.frontFront);
  setDetail("前後軸重 kg", v.frontRear);
  setDetail("後前軸重 kg", v.rearFront);
  setDetail("後後軸重 kg", v.rearRear);
  setDetail("総排気量又は定格出力", v.output);
  setDetail("燃料の種類", v.fuel);
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
    return bright > 118 && Math.max(r, g, b) - Math.min(r, g, b) < 110;
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

function crop(source: HTMLCanvasElement, paper: Box, x: number, y: number, w: number, h: number, target = 3000) {
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
    const v = Math.max(0, Math.min(255, Math.round((gray - 120) * 1.85 + 165)));
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return out;
}

async function read(worker: any, canvas: HTMLCanvasElement, psm: any) {
  await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_pageseg_mode: String(psm) });
  return norm((await worker.recognize(canvas)).data.text || "");
}

export default function CertificateCalibratedFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let lastSrc = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let worker: any = null;
    let disposed = false;

    const run = async (srcKey: string) => {
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      if (!img?.src || img.src !== srcKey) return;
      const v: Values = {};
      try {
        const source = await sourceCanvas(img);
        const paper = paperBox(source);
        const t: any = await import("./lib/tesseract-local");
        worker = await t.createWorker("jpn+eng", 1);
        const sparse = t.PSM?.SPARSE_TEXT ?? "11";
        const block = t.PSM?.SINGLE_BLOCK ?? "6";

        const recordDoc = await read(worker, crop(source, paper, 0.60, 0.055, 0.38, 0.085), sparse);
        const regChassis = await read(worker, crop(source, paper, 0.07, 0.120, 0.91, 0.075), sparse);
        const dateRow = await read(worker, crop(source, paper, 0.07, 0.180, 0.91, 0.055), sparse);
        const nameRow = await read(worker, crop(source, paper, 0.10, 0.225, 0.87, 0.045), block);
        const addressRow = await read(worker, crop(source, paper, 0.10, 0.255, 0.87, 0.045), block);
        const baseRow = await read(worker, crop(source, paper, 0.10, 0.285, 0.87, 0.045), block);
        const vehicleRow = await read(worker, crop(source, paper, 0.05, 0.320, 0.93, 0.075), sparse);
        const classBodyRow = await read(worker, crop(source, paper, 0.05, 0.385, 0.93, 0.060), sparse);
        const dimensionRow = await read(worker, crop(source, paper, 0.05, 0.425, 0.93, 0.050), sparse);
        const axleRow = await read(worker, crop(source, paper, 0.05, 0.455, 0.93, 0.045), sparse);
        const fuelRow = await read(worker, crop(source, paper, 0.05, 0.485, 0.50, 0.035), sparse);

        const rd = eraValues(recordDoc).find((x) => x.day != null);
        if (rd) v.recordDate = formatEra(rd);
        v.recordNumber = documentNumber(recordDoc) || undefined;
        v.registration = registration(regChassis) || undefined;
        v.chassis = chassis(regChassis) || undefined;

        const ds = eraValues(dateRow);
        const dated = ds.filter((x) => x.day != null);
        const monthOnly = ds.find((x) => x.day == null);
        if (dated[0]) v.registrationDate = formatEra(dated[0]);
        if (monthOnly) v.firstRegistration = formatEra(monthOnly);
        if (dated[1]) v.expiry = formatEra(dated[1]);

        v.userName = cleanName(nameRow) || undefined;
        v.userAddress = cleanAddress(addressRow) || undefined;
        v.base = cleanBase(baseRow) || undefined;
        v.vehicleName = maker(vehicleRow) || undefined;
        v.model = model(vehicleRow) || undefined;
        v.engine = engine(vehicleRow) || undefined;
        v.vehicleClass = known(classBodyRow, ["普通","小型","軽自動車","大型特殊"]) || undefined;
        v.purpose = known(classBodyRow, ["貨物","乗用","乗合","特種"]) || undefined;
        v.privateBusiness = known(classBodyRow, ["自家用","事業用"]) || undefined;
        v.bodyShape = known(classBodyRow, ["バン","キャブオーバ","箱型","ステーションワゴン","セダン","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]) || undefined;
        v.seating = seating(classBodyRow) || undefined;
        v.maxPayload = payload(classBodyRow) || undefined;

        const dim = dimensions(dimensionRow);
        if (dim.length === 5) [v.vehicleWeight, v.grossWeight, v.length, v.width, v.height] = dim;
        const aw = axles(axleRow);
        if (aw.length === 4) [v.frontFront, v.frontRear, v.rearFront, v.rearRear] = aw;
        v.output = ratedOutput(axleRow) || undefined;
        v.fuel = known(fuelRow, ["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]) || undefined;
      } catch (error) {
        console.warn("calibrated certificate OCR failed", error);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        worker = null;
      }
      if (disposed || (document.querySelector("img.preview") as HTMLImageElement | null)?.src !== srcKey) return;
      apply(v);
      for (const delay of [1800, 4200]) {
        window.setTimeout(() => {
          if (!disposed && (document.querySelector("img.preview") as HTMLImageElement | null)?.src === srcKey) apply(v);
        }, delay);
      }
    };

    const check = () => {
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = Array.from(document.querySelectorAll("details pre")).map((x) => x.textContent || "").join("\n");
      if (!img?.src || !debug.includes("【車検証 全体OCR】") || img.src === lastSrc) return;
      lastSrc = img.src;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(img.src), 1200);
    };

    const interval = window.setInterval(check, 700);
    check();
    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (timer) clearTimeout(timer);
      if (worker) void worker.terminate().catch(() => {});
    };
  }, []);

  return null;
}
