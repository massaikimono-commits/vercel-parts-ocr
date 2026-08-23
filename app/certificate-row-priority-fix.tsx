"use client";

import { useEffect } from "react";

type Box = { x: number; y: number; w: number; h: number };

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

function sectionByTitle(title: string) {
  return Array.from(document.querySelectorAll("section.card")).find((section) => {
    const h2 = (section.querySelector("h2")?.textContent || "").trim();
    return title === "基本情報" ? h2 === title : h2.includes(title);
  }) || null;
}

function inputIn(section: Element | null, label: string) {
  if (!section) return null;
  for (const node of Array.from(section.querySelectorAll("label"))) {
    const text = (node.querySelector("span")?.textContent || node.textContent || "").trim();
    if (compact(text) === compact(label)) return node.querySelector("input") as HTMLInputElement | null;
  }
  return null;
}

function detailInput(label: string) {
  return inputIn(sectionByTitle("車検証読み取り情報"), label);
}

function basicInput(label: string) {
  return inputIn(sectionByTitle("基本情報"), label);
}

function nativeSet(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setValue(input: HTMLInputElement | null, value: string, clearWhenEmpty = false) {
  if (!input) return;
  if (!value && !clearWhenEmpty) return;
  if (input.value === value) return;
  nativeSet(input, value);
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

function dateText(value: string) {
  return norm(value)
    .replace(/\s+/g, "")
    .replace(/[OoQq]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[.,/\\_-]/g, "");
}

function japaneseDate(value: string) {
  const t = dateText(value);
  const m = t.match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function japaneseMonth(value: string) {
  const t = dateText(value);
  const m = t.match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
}

function parseRegistration(value: string) {
  const text = norm(value).replace(/\n/g, " ");
  const digitish = "0-9OoQqDdIiLl|ZzSsBb";
  const sep = "[\\s_＿\\-・･:：/\\\\.]*";
  const re = new RegExp(`([ぁ-んァ-ヶ一-龠々]{1,10})${sep}([${digitish}]${sep}[${digitish}]${sep}[${digitish}])${sep}([ぁ-ん])${sep}([${digitish}]${sep}[${digitish}]${sep}[${digitish}]${sep}[${digitish}])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const cls = numericToken(m[2]);
    const serial = numericToken(m[4]);
    if (cls.length !== 3 || serial.length !== 4) continue;
    const place = m[1].replace(/^(登録番号|車両番号|番号)/, "");
    if (!place || /年月|使用|住所|車台|型式/.test(place)) continue;
    return `${place} ${cls} ${m[3]} ${serial}`;
  }
  return "";
}

function modelFamily() {
  const model = (basicInput("型式")?.value || detailInput("型式")?.value || "").toUpperCase();
  const body = model.split("-").pop()?.replace(/[^A-Z0-9]/g, "") || "";
  if (!body) return "";
  // NKR85N -> NKR85, XZU645M -> XZU645 のように車台番号側の系列へ寄せる。
  return body.replace(/[A-Z]$/, "");
}

function parseChassis(value: string) {
  const t = norm(value).toUpperCase().replace(/[＿_]/g, "-");
  const direct = (t.match(/[A-Z0-9]{3,10}\s*-\s*[0-9OQDIL|ZSB\s]{5,12}/g) || [])
    .map((x) => x.replace(/\s+/g, ""))
    .filter((x) => !/^(DAA|DBA|ABA|TKG|QKG|PKG|SKG|2RG|3DA)-/.test(x));
  for (const item of direct) {
    const [leftRaw, rightRaw] = item.split("-");
    const suffix = numericToken(rightRaw);
    if (suffix.length < 5 || suffix.length > 10) continue;
    let left = leftRaw.replace(/[^A-Z0-9]/g, "");
    const family = modelFamily();
    if (family && left.length === family.length) {
      // OCRで NKR85 が NBR8S のように崩れても、型式から系列を確定できる。
      left = family;
    }
    if (/[A-Z]/.test(left) && /\d/.test(left)) return `${left}-${suffix}`;
  }

  const family = modelFamily();
  const chunks = t.split(/[-\s]+/).map(numericToken).filter((x) => x.length >= 5 && x.length <= 10);
  const suffix = chunks.sort((a, b) => b.length - a.length)[0] || "";
  return family && suffix ? `${family}-${suffix}` : "";
}

function cleanJapaneseValue(value: string, kind: "name" | "address" | "base") {
  const lines = norm(value).split("\n").map((x) => x.trim()).filter(Boolean);
  const banned = /基本情報|車両詳細情報|記録事項|車台番号|登録年月日|有効期間|使用者の氏名|使用者の住所|本拠の位置|生OCR|採用/;
  for (const raw of lines) {
    const line = raw.replace(/^[|｜:：・.\-\s]+|[|｜:：・.\-\s]+$/g, "").trim();
    if (!line || banned.test(line)) continue;
    if (kind === "base" && /\*{3}|＊{3}/.test(line)) return "***";
    if (kind === "base" && /使用者.*住所.*同じ|住所に同じ/.test(line)) return "使用者住所に同じ";
    const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
    const noise = (line.match(/[A-Za-z_=<>]/g) || []).length;
    if (kind === "name" && jp >= 4 && noise <= Math.max(2, Math.floor(line.length * 0.18))) return line.slice(0, 70);
    if (kind === "address" && jp >= 4 && /[都道府県市区町村郡町丁目番号]/.test(line) && noise <= Math.max(2, Math.floor(line.length * 0.15))) return line.slice(0, 90);
    if (kind === "base" && jp >= 3 && noise <= Math.max(2, Math.floor(line.length * 0.15))) return line.slice(0, 80);
  }
  return "";
}

function looksBadName(value: string) {
  if (!value) return false;
  if (/住所|車両詳細情報|基本情報/.test(value)) return true;
  const jp = (value.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
  const noise = (value.match(/[A-Za-z_=<>]/g) || []).length;
  return jp < 3 || noise > Math.max(3, Math.floor(value.length * 0.25));
}

function looksBadAddress(value: string) {
  if (!value) return false;
  if (/車両詳細情報|基本情報/.test(value)) return true;
  const jp = (value.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
  return jp < 3 || !/[都道府県市区町村郡町丁目番号]/.test(value);
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
    return bright > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 100;
  };

  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hits = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (isPaper(x, y)) hits++; n++; }
    if (hits / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 8) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);

  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hits = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (isPaper(x, y)) hits++; n++; }
    if (hits / Math.max(1, n) > 0.22) xs.push(x);
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

function crop(source: HTMLCanvasElement, paper: Box, x: number, y: number, w: number, h: number, target = 3200) {
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
    const v = Math.max(0, Math.min(255, Math.round((gray - 125) * 1.85 + 158)));
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

export default function CertificateRowPriorityFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let running = false;
    let lastSrc = "";
    let worker: any = null;

    const run = async () => {
      if (running) return;
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = document.querySelector("details pre") as HTMLElement | null;
      if (!img || !img.src || !debug?.textContent?.includes("【車検証 全体OCR】")) return;
      if (img.src === lastSrc) return;

      running = true;
      lastSrc = img.src;
      try {
        const source = await imageCanvas(img);
        const paper = paperBox(source);
        const t: any = await import("tesseract.js");
        worker = await t.createWorker("jpn+eng", 1);
        const P = t.PSM;
        const single = P?.SINGLE_LINE ?? "7";
        const sparse = P?.SPARSE_TEXT ?? "11";

        // この様式では重要項目が上から順に固定行に並ぶ。
        // 全体OCRではなく、値欄だけを大きく切り出して再読する。
        const registrationText = await read(worker, crop(source, paper, 0.18, 0.165, 0.76, 0.040), single);
        const chassisText = await read(worker, crop(source, paper, 0.10, 0.195, 0.84, 0.040), single);
        const registrationDateText = await read(worker, crop(source, paper, 0.18, 0.222, 0.22, 0.040), single);
        const firstRegistrationText = await read(worker, crop(source, paper, 0.40, 0.222, 0.22, 0.040), single);
        const expiryText = await read(worker, crop(source, paper, 0.65, 0.222, 0.32, 0.040), single);
        const userNameText = await read(worker, crop(source, paper, 0.18, 0.265, 0.78, 0.050), sparse);
        const userAddressText = await read(worker, crop(source, paper, 0.18, 0.302, 0.78, 0.050), sparse);
        const baseText = await read(worker, crop(source, paper, 0.16, 0.335, 0.80, 0.045), sparse);

        const debugText = debug.textContent || "";
        const combinedRegistration = `${registrationText}\n${debugText}`;
        const registration = parseRegistration(combinedRegistration);
        const chassis = parseChassis(`${chassisText}\n${debugText}`);
        const registrationDate = japaneseDate(registrationDateText);
        const firstRegistration = japaneseMonth(firstRegistrationText);
        const expiry = japaneseDate(expiryText);
        const userName = cleanJapaneseValue(userNameText, "name");
        const userAddress = cleanJapaneseValue(userAddressText, "address");
        const base = cleanJapaneseValue(baseText, "base");

        if (registration) {
          setValue(detailInput("自動車登録番号又は車両番号"), registration);
          setValue(basicInput("登録番号"), registration);
          setValue(basicInput("ナンバー下4桁"), registration.match(/(\d{4})$/)?.[1] || "");
        }

        // 車台番号は重要項目なので、読み切れなければ古い別車両値を残さず空欄にする。
        setValue(detailInput("車台番号"), chassis, true);
        setValue(basicInput("車台番号"), chassis, true);

        setValue(detailInput("登録年月日／交付年月日"), registrationDate, true);
        setValue(detailInput("初度登録年月"), firstRegistration, true);
        setValue(detailInput("有効期間の満了する日"), expiry, true);
        setValue(basicInput("初度登録（和暦）"), firstRegistration, true);

        if (userName) setValue(detailInput("使用者の氏名又は名称"), userName);
        else {
          const current = detailInput("使用者の氏名又は名称");
          if (current && looksBadName(current.value)) setValue(current, "", true);
        }

        if (userAddress) setValue(detailInput("使用者の住所"), userAddress);
        else {
          const current = detailInput("使用者の住所");
          if (current && looksBadAddress(current.value)) setValue(current, "", true);
        }

        if (base) setValue(detailInput("使用の本拠の位置"), base);
        else {
          const current = detailInput("使用の本拠の位置");
          if (current && /車両詳細情報|基本情報|使用者の氏名|使用者の住所/.test(current.value)) setValue(current, "", true);
        }
      } catch (error) {
        console.warn("certificate row priority OCR failed", error);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        worker = null;
        running = false;
      }
    };

    const observer = new MutationObserver(() => { void run(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    void run();
    return () => {
      observer.disconnect();
      if (worker) void worker.terminate().catch(() => {});
    };
  }, []);

  return null;
}
