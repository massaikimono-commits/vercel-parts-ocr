"use client";

import { useEffect } from "react";

type Box = { x: number; y: number; w: number; h: number };

const DETAIL_LABELS = [
  "記録年月日","記録事項番号","自動車登録番号又は車両番号","車台番号","登録年月日／交付年月日","初度登録年月",
  "有効期間の満了する日","使用者の氏名又は名称","使用者の住所","使用の本拠の位置","車名","型式","原動機の型式",
  "自動車の種別","用途","自家用・事業用の別","車体の形状"
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

function rawField(debug: string, label: string) {
  const marker = `【${label} 生OCR】`;
  const i = debug.indexOf(marker);
  if (i < 0) return "";
  return debug.slice(i + marker.length).split("\n")[0]?.trim() || "";
}

function adoptedField(debug: string, label: string) {
  const marker = `【${label} 採用】`;
  const i = debug.indexOf(marker);
  if (i < 0) return "";
  const v = debug.slice(i + marker.length).split("\n")[0]?.trim() || "";
  return /^(未読|\(空\)|空)$/.test(v) ? "" : v;
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

function parseChassis(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "").replace(/[＿_]/g, "-");
  const all = t.match(/[A-Z0-9]{3,10}-[0-9O]{4,10}/g) || [];
  const found = all
    .filter((x) => /[A-Z]/.test(x.split("-")[0]) && /\d/.test(x.split("-")[0]))
    .filter((x) => !/^(DAA|DBA|ABA|TKG|QKG|PKG|SKG|2RG|3DA)-/.test(x));
  const picked = found.sort((a, b) => b.length - a.length)[0];
  if (!picked) return "";
  const [left, right] = picked.split("-");
  return `${left.replace(/O(?=\d)/g, "0")}-${right.replace(/O/g, "0")}`;
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

function parseJapaneseDate(value: string) {
  const t = dateText(value);
  const m = t.match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function parseJapaneseMonth(value: string) {
  const t = dateText(value);
  const m = t.match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
}

function near(text: string, labels: string[], span = 220) {
  const t = norm(text);
  for (const label of labels) {
    const variants = [label, label.replace(/\s+/g, "")];
    for (const v of variants) {
      const i = t.indexOf(v);
      if (i >= 0) return t.slice(i, i + span);
    }
  }
  return "";
}

function documentNumber(value: string) {
  return (norm(value).match(/\b\d{10,14}\b/g) || [""])[0] || "";
}

function maker(value: string) {
  const t = compact(value);
  const list = ["日野","トヨタ","レクサス","日産","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","メルセデス・ベンツ","BMW","アウディ","フォルクスワーゲン","ボルボ"];
  return list.find((x) => t.includes(compact(x))) || "";
}

function pick(value: string, list: string[]) {
  const t = compact(value);
  return list.find((x) => t.includes(compact(x))) || "";
}

function modelFrom(value: string, chassis: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "").replace(/[＿_]/g, "-");
  const family = chassis.split("-")[0] || "";
  if (family) {
    const pref = t.match(/(?:DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|GE6|ZAA)-?/g)?.[0]?.replace(/-$/, "") || "";
    if (pref && t.includes(family)) return `${pref}-${family}`;
  }
  const all = t.match(/(?:DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA)-[A-Z0-9]{3,10}/g) || [];
  return all.sort((a, b) => a.length - b.length)[0] || "";
}

function engineFrom(value: string, model: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "").replace(/[＿_]/g, "-");
  const candidates = t.match(/[A-Z][0-9O][0-9A-Z]{1,5}(?:-[A-Z0-9]{2,8})?/g) || [];
  const picked = candidates
    .map((x) => x.replace(/O(?=\d)/g, "0"))
    .filter((x) => !model.includes(x))
    .filter((x) => !/^(DAA|DBA|ABA|TKG|QKG|PKG|SKG)/.test(x))
    .find((x) => /\d/.test(x) && /[A-Z]/.test(x));
  return picked || "";
}

function candidateLineAfter(text: string, labels: string[], kind: "name" | "address" | "base") {
  const lines = norm(text).split("\n").map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (!labels.some((l) => compact(lines[i]).includes(compact(l)))) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const line = lines[j].replace(/^[|｜:：・.\-\s]+|[|｜:：・.\-\s]+$/g, "").trim();
      if (!line || DETAIL_LABELS.some((label) => compact(line).includes(compact(label)))) continue;
      if (/OCR|生OCR|採用|未読/.test(line)) continue;
      const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
      if (kind === "name") {
        if (jp >= 3 && !/住所|本拠|車両詳細|基本情報/.test(line)) return line.slice(0, 70);
      } else if (kind === "address") {
        if (jp >= 3 && /[都道府県市区町村郡町丁目番号]/.test(line)) return line.slice(0, 80);
      } else {
        if (/使用者.*住所.*同じ|住所に同じ/.test(line)) return "使用者住所に同じ";
        if (jp >= 3 && !/車名|型式|原動機/.test(line)) return line.slice(0, 80);
      }
    }
  }
  return "";
}

function detailSection() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  ) || null;
}

function basicSection() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    (section.querySelector("h2")?.textContent || "").trim() === "基本情報"
  ) || null;
}

function sectionInput(section: Element | null, label: string) {
  if (!section) return null;
  for (const node of Array.from(section.querySelectorAll("label"))) {
    const text = (node.querySelector("span")?.textContent || node.textContent || "").trim();
    if (compact(text) === compact(label)) return node.querySelector("input") as HTMLInputElement | null;
  }
  return null;
}

function fieldInput(label: string) {
  return sectionInput(detailSection(), label);
}

function basicInput(label: string) {
  return sectionInput(basicSection(), label);
}

function nativeSet(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setIfDifferent(input: HTMLInputElement | null, value: string, allowEmpty = false) {
  if (!input) return;
  if (!value && !allowEmpty) return;
  if (input.value === value) return;
  nativeSet(input, value);
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
    return bright > 125 && Math.max(r, g, b) - Math.min(r, g, b) < 95;
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

function cropRegion(source: HTMLCanvasElement, paper: Box, x: number, y: number, w: number, h: number, target = 2800) {
  const box = {
    x: Math.round(paper.x + paper.w * x),
    y: Math.round(paper.y + paper.h * y),
    w: Math.round(paper.w * w),
    h: Math.round(paper.h * h),
  };
  const scale = Math.max(1, Math.min(5, target / Math.max(1, box.w)));
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
    const v = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.65 + 160)));
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
  const scale = Math.min(1, 3800 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function recognize(worker: any, t: any, canvas: HTMLCanvasElement, psm: any) {
  await worker.setParameters({
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_pageseg_mode: String(psm),
  });
  return norm((await worker.recognize(canvas)).data.text || "");
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
        const debugText = debug.textContent || "";
        const wholeFromDebug = debugText.includes("【車検証 全体OCR】") ? debugText.split("【車検証 全体OCR】").slice(1).join("\n") : debugText;

        // まず既存OCR結果だけで上段の重要項目を即時救済する。
        let registration = parseRegistration(rawField(debugText, "自動車登録番号又は車両番号")) || parseRegistration(wholeFromDebug) || parseRegistration(debugText);
        let chassis = parseChassis(rawField(debugText, "車台番号")) || parseChassis(adoptedField(debugText, "車台番号")) || parseChassis(wholeFromDebug);
        let registrationDate = parseJapaneseDate(rawField(debugText, "登録年月日／交付年月日")) || parseJapaneseDate(near(wholeFromDebug, ["登録年月日", "交付年月日"]));
        let firstRegistration = parseJapaneseMonth(rawField(debugText, "初度登録年月")) || parseJapaneseMonth(near(wholeFromDebug, ["初度登録年月", "初度登録"]));
        let expiry = parseJapaneseDate(rawField(debugText, "有効期間の満了する日")) || parseJapaneseDate(near(wholeFromDebug, ["有効期間の満了する日"]));
        let recordDate = parseJapaneseDate(rawField(debugText, "記録年月日")) || parseJapaneseDate(near(wholeFromDebug, ["記録年月日"]));
        let recordNumber = documentNumber(rawField(debugText, "記録事項番号")) || documentNumber(near(wholeFromDebug, ["記録事項"]));

        const quickReg = registration;
        if (quickReg) {
          setIfDifferent(fieldInput("自動車登録番号又は車両番号"), quickReg);
          setIfDifferent(basicInput("登録番号"), quickReg);
          setIfDifferent(basicInput("ナンバー下4桁"), quickReg.match(/(\d{4})$/)?.[1] || "");
        }
        if (chassis) {
          setIfDifferent(fieldInput("車台番号"), chassis);
          setIfDifferent(basicInput("車台番号"), chassis);
        }

        const src = await imageCanvas(img);
        const paper = paperBox(src);
        const top = cropRegion(src, paper, 0.00, 0.035, 1.00, 0.30, 3000);
        const dateRow = cropRegion(src, paper, 0.00, 0.135, 1.00, 0.095, 3200);
        const detail = cropRegion(src, paper, 0.00, 0.305, 1.00, 0.23, 3000);

        const t: any = await import("tesseract.js");
        worker = await t.createWorker("jpn+eng", 1);
        const P = t.PSM;
        const topText = await recognize(worker, t, top, P?.SPARSE_TEXT ?? "11");
        const dateTextOCR = await recognize(worker, t, dateRow, P?.SINGLE_BLOCK ?? "6");
        const detailText = await recognize(worker, t, detail, P?.SPARSE_TEXT ?? "11");
        const combined = `${debugText}\n${topText}\n${dateTextOCR}\n${detailText}`;

        registration = registration || parseRegistration(topText) || parseRegistration(combined);
        chassis = chassis || parseChassis(near(topText, ["車台番号"], 180)) || parseChassis(topText);
        registrationDate = registrationDate || parseJapaneseDate(near(`${dateTextOCR}\n${topText}`, ["登録年月日", "交付年月日"], 220));
        firstRegistration = firstRegistration || parseJapaneseMonth(near(`${dateTextOCR}\n${topText}`, ["初度登録年月", "初度登録"], 190));
        expiry = expiry || parseJapaneseDate(near(`${dateTextOCR}\n${topText}`, ["有効期間の満了する日", "有効期間"], 220));
        recordDate = recordDate || parseJapaneseDate(near(topText, ["記録年月日"], 150));
        recordNumber = recordNumber || documentNumber(near(topText, ["記録事項"], 170)) || documentNumber(topText);

        const userNameRaw = rawField(debugText, "使用者の氏名又は名称");
        const userName = candidateLineAfter(`${topText}\n${wholeFromDebug}`, ["使用者の氏名又は名称"], "name") || candidateLineAfter(userNameRaw, ["使用者の氏名又は名称"], "name");
        const userAddress = candidateLineAfter(`${topText}\n${wholeFromDebug}`, ["使用者の住所"], "address");
        const baseLocation = candidateLineAfter(`${topText}\n${wholeFromDebug}`, ["使用の本拠の位置"], "base") || (/(使用者.*住所.*同じ|住所に同じ)/.test(combined) ? "使用者住所に同じ" : "");

        const vehicleName = maker(`${detailText}\n${rawField(debugText, "車名")}\n${combined}`);
        const model = modelFrom(`${rawField(debugText, "型式")}\n${detailText}\n${combined}`, chassis);
        const engineModel = engineFrom(`${rawField(debugText, "原動機の型式")}\n${detailText}`, model);
        const vehicleClass = pick(`${rawField(debugText, "自動車の種別")}\n${detailText}`, ["普通","小型","軽自動車","大型特殊"]);
        const purpose = pick(`${rawField(debugText, "用途")}\n${detailText}`, ["貨物","乗用","乗合","特種"]);
        const privateBusiness = pick(`${rawField(debugText, "自家用・事業用の別")}\n${detailText}`, ["自家用","事業用"]);
        const bodyShape = pick(`${rawField(debugText, "車体の形状")}\n${detailText}`, ["箱型","バン","ステーションワゴン","セダン","キャブオーバ","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]);

        const values = new Map<string, string>([
          ["自動車登録番号又は車両番号", registration],
          ["車台番号", chassis],
          ["登録年月日／交付年月日", registrationDate],
          ["初度登録年月", firstRegistration],
          ["有効期間の満了する日", expiry],
          ["記録年月日", recordDate],
          ["記録事項番号", recordNumber],
          ["使用者の氏名又は名称", userName],
          ["使用者の住所", userAddress],
          ["使用の本拠の位置", baseLocation],
          ["車名", vehicleName],
          ["型式", model],
          ["原動機の型式", engineModel],
          ["自動車の種別", vehicleClass],
          ["用途", purpose],
          ["自家用・事業用の別", privateBusiness],
          ["車体の形状", bodyShape],
        ]);

        for (const [label, value] of values) setIfDifferent(fieldInput(label), value);

        if (registration) {
          setIfDifferent(basicInput("登録番号"), registration);
          setIfDifferent(basicInput("ナンバー下4桁"), registration.match(/(\d{4})$/)?.[1] || "");
        }
        if (chassis) setIfDifferent(basicInput("車台番号"), chassis);
        if (model) setIfDifferent(basicInput("型式"), model);
        if (firstRegistration) setIfDifferent(basicInput("初度登録（和暦）"), firstRegistration);

        // 明らかなラベル誤読だけは残さない。
        const badName = fieldInput("使用者の氏名又は名称");
        if (badName && /^(用者の住所|使用者の住所|住所|本拠の位置)$/.test(badName.value.trim())) setIfDifferent(badName, "", true);
        const badEngine = fieldInput("原動機の型式");
        if (badEngine && model && badEngine.value && model.includes(badEngine.value)) setIfDifferent(badEngine, "", true);
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
