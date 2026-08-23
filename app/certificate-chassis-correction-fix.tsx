"use client";

import { useEffect } from "react";

type ParsedDate = {
  era: "令和" | "平成" | "昭和";
  year: number;
  month: number;
  day: number;
  serial: number;
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

function detail(label: string) {
  return inputByLabel("車検証読み取り情報", label);
}

function basic(label: string) {
  return inputByLabel("基本情報", label);
}

function nativeSetInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setValue(input: HTMLInputElement | null, value: string, allowEmpty = false) {
  if (!input) return;
  if (!value && !allowEmpty) return;
  if (input.value === value) return;
  nativeSetInput(input, value);
}

function getDebugText() {
  return Array.from(document.querySelectorAll("details pre"))
    .map((node) => node.textContent || "")
    .join("\n");
}

function globalOCR(debug: string) {
  return debug.split("【車検証 全体OCR】").pop() || "";
}

function rawField(debug: string, label: string) {
  const marker = `【${label} 生OCR】`;
  const i = debug.indexOf(marker);
  if (i < 0) return "";
  return debug.slice(i + marker.length).split("\n")[0]?.trim() || "";
}

function near(text: string, labels: string[], span = 220) {
  const t = norm(text);
  for (const label of labels) {
    const i = compact(t).indexOf(compact(label));
    if (i < 0) continue;
    // compact index cannot be mapped exactly to original text, so also try a direct label lookup.
    const direct = t.indexOf(label);
    if (direct >= 0) return t.slice(direct, direct + span);
  }
  return "";
}

function fixNumericGlyphs(value: string) {
  return norm(value)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");
}

function correctNkr(value: string) {
  return norm(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[＿_]/g, "-")
    .replace(/^NKRS(?=\d)/, "NKR")
    .replace(/-NKRS(?=\d)/, "-NKR");
}

function modelFamily() {
  const value = (detail("型式")?.value || basic("型式")?.value || "").toUpperCase();
  const body = value.split("-").pop()?.replace(/[^A-Z0-9]/g, "") || "";
  const nkr = body.match(/^(NKR\d{1,4})/);
  if (nkr) return nkr[1];
  return "";
}

function chassisCandidates(value: string) {
  const text = correctNkr(value);
  const found = text.match(/[A-Z]{1,5}\d{1,5}-[0-9OQDIL|ZSB]{5,10}/g) || [];
  return found.map((raw) => {
    const [leftRaw, rightRaw] = raw.split("-");
    const left = correctNkr(leftRaw);
    const right = fixNumericGlyphs(rightRaw).replace(/\D/g, "");
    return `${left}-${right}`;
  }).filter((x) => {
    const [left, right] = x.split("-");
    return /[A-Z]/.test(left) && /\d/.test(left) && right.length >= 6 && right.length <= 9;
  });
}

function chassisScore(value: string, source: "near" | "raw" | "global") {
  const family = modelFamily();
  const [left, serial = ""] = value.split("-");
  let score = source === "near" ? 60 : source === "raw" ? 35 : 12;
  if (family && left === family) score += 45;
  else if (family && left.startsWith(family.slice(0, 3))) score += 15;
  const unique = new Set(serial.split("")).size;
  score += Math.min(12, unique * 2);
  if (/(\d)\1{4,}/.test(serial)) score -= 28;
  if (/^10{5,}$/.test(serial)) score -= 35;
  return score;
}

function bestChassis(debug: string) {
  const whole = globalOCR(debug);
  const sources: Array<["near" | "raw" | "global", string]> = [
    ["near", near(whole, ["車台番号"], 180)],
    ["raw", rawField(debug, "車台番号")],
    ["global", whole],
  ];
  const scored: Array<{ value: string; score: number }> = [];
  for (const [kind, text] of sources) {
    for (const value of chassisCandidates(text)) scored.push({ value, score: chassisScore(value, kind) });
  }
  const current = correctNkr(detail("車台番号")?.value || basic("車台番号")?.value || "");
  if (current) scored.push({ value: current, score: chassisScore(current, "raw") - 6 });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.value || current;
}

function parseDates(value: string) {
  const t = fixNumericGlyphs(value);
  const re = /(令和|平成|昭和)\s*(元|\d{1,2})\s*(?:年|[.．・/／-])?\s*(\d{1,2})\s*(?:月|[.．・/／-])?\s*(\d{1,2})\s*日?/g;
  const out: ParsedDate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const era = m[1] as ParsedDate["era"];
    const year = m[2] === "元" ? 1 : Number(m[2]);
    const month = Number(m[3]);
    const day = Number(m[4]);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (era === "令和" && year > 20) continue;
    if (era === "平成" && year > 31) continue;
    if (era === "昭和" && year > 64) continue;
    const base = era === "令和" ? 2018 : era === "平成" ? 1988 : 1925;
    const d = new Date(base + year, month - 1, day);
    if (d.getFullYear() !== base + year || d.getMonth() !== month - 1 || d.getDate() !== day) continue;
    out.push({ era, year, month, day, serial: (base + year) * 10000 + month * 100 + day });
  }
  return out;
}

function formatDate(d: ParsedDate) {
  return `${d.era}${d.year === 1 ? "元" : d.year}年${d.month}月${d.day}日`;
}

function parseMonthSerial(value: string) {
  const t = fixNumericGlyphs(value);
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!m) return 0;
  const year = m[2] === "元" ? 1 : Number(m[2]);
  const month = Number(m[3]);
  if (month < 1 || month > 12) return 0;
  const base = m[1] === "令和" ? 2018 : m[1] === "平成" ? 1988 : 1925;
  return (base + year) * 100 + month;
}

function bestDate(debug: string, label: string, aliases: string[], mode: "earliest" | "latest" = "earliest") {
  const whole = globalOCR(debug);
  const candidates = [
    ...parseDates(near(whole, aliases, 220)),
    ...parseDates(rawField(debug, label)),
  ];
  const uniq = candidates.filter((d, i, a) => a.findIndex((x) => x.serial === d.serial) === i);
  uniq.sort((a, b) => mode === "latest" ? b.serial - a.serial : a.serial - b.serial);
  return uniq[0] || null;
}

function cleanLines(value: string) {
  return norm(value).split("\n").map((x) => x.trim()).filter(Boolean);
}

function bestName(value: string) {
  const banned = /使用者の氏名|使用者の住所|使用の本拠|車両詳細|原動機|型式|OCR|生OCR|採用/;
  const scored = cleanLines(value).filter((x) => !banned.test(x)).map((line) => {
    const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
    const company = /(株式会社|有限会社|合同会社|支店|営業所|本社|センター)/.test(line) ? 40 : 0;
    const tooShort = /^(株式会社|有限会社|合同会社)$/.test(line) ? -100 : 0;
    const noise = (line.match(/[<>{}=]/g) || []).length * -20;
    return { line, score: jp * 3 + company + tooShort + noise };
  }).filter((x) => x.score >= 22).sort((a, b) => b.score - a.score);
  return scored[0]?.line.slice(0, 90) || "";
}

function bestAddress(value: string) {
  const banned = /使用者の住所|使用の本拠|車両詳細|OCR|生OCR|採用/;
  const scored = cleanLines(value).filter((x) => !banned.test(x)).map((line0) => {
    let line = line0.replace(/(?<=\d)\s+(?=\d)/g, "").replace(/\s*[-ー]\s*/g, "-");
    const pref = line.match(/(?:北海道|東京都|大阪府|京都府|[一-龠]{2,3}県)/);
    if (pref?.index != null) line = line.slice(pref.index);
    const jp = (line.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
    const address = /[都道府県]/.test(line) && /[市区町村郡]/.test(line) ? 50 : /[市区町村郡]/.test(line) ? 25 : 0;
    const digit = /\d/.test(line) ? 8 : 0;
    const noise = (line.match(/[<>{}=]/g) || []).length * -20;
    return { line, score: jp * 2 + address + digit + noise };
  }).filter((x) => x.score >= 35).sort((a, b) => b.score - a.score);
  return scored[0]?.line.slice(0, 110) || "";
}

function bestEngine(value: string) {
  const t = norm(value).toUpperCase().replace(/[Oo]/g, "0");
  const all = [
    ...(t.match(/\b\d[A-Z]{2}\d\b/g) || []),
    ...(t.match(/\b\d[A-Z]{1,3}[0-9A-Z]{1,3}\b/g) || []),
    ...(t.match(/\b[A-Z]\d[A-Z0-9]{2,5}\b/g) || []),
  ].filter((x, i, a) => a.indexOf(x) === i)
    .filter((x) => !/^(0CR|OCR|TKG|QKG|PKG|SKG|DAA|DBA|ABA|NKR|NPR|NLR|NMR)$/.test(x));
  all.sort((a, b) => {
    const score = (x: string) => (/^\d[A-Z]{2}\d$/.test(x) ? 100 : 0) + (x.length <= 6 ? 15 : 0) - x.length;
    return score(b) - score(a);
  });
  return all[0] || "";
}

function numericCandidates(value: string) {
  return (fixNumericGlyphs(value).match(/\d{2,5}/g) || []).map(Number);
}

function dimensionRow(value: string) {
  const nums = numericCandidates(value);
  for (let i = 0; i + 4 < nums.length; i++) {
    const [vw, gw, len, wid, hei] = nums.slice(i, i + 5);
    if (vw >= 500 && vw <= 50000 && gw >= vw && gw <= 80000 && len >= 200 && len <= 2000 && wid >= 100 && wid <= 350 && hei >= 100 && hei <= 500) {
      return [vw, gw, len, wid, hei].map(String);
    }
  }
  return [];
}

function axleRow(value: string) {
  const nums = numericCandidates(value).filter((n) => n >= 200 && n <= 30000);
  if (nums.length >= 4) return nums.slice(0, 4).map(String);
  if (nums.length === 2) return [String(nums[0]), "", "", String(nums[1])];
  return [];
}

function runCorrection(debug: string) {
  const whole = globalOCR(debug);

  const chassis = bestChassis(debug);
  if (chassis) {
    setValue(detail("車台番号"), chassis);
    setValue(basic("車台番号"), chassis);
  }

  const registration = bestDate(debug, "登録年月日／交付年月日", ["登録年月日／交付年月日", "登録年月日", "交付年月日"], "earliest");
  if (registration) setValue(detail("登録年月日／交付年月日"), formatDate(registration));

  const firstSerial = parseMonthSerial(detail("初度登録年月")?.value || basic("初度登録（和暦）")?.value || "");
  const regSerial = registration?.serial || parseDates(detail("登録年月日／交付年月日")?.value || "")[0]?.serial || 0;
  const expiryCandidates = [
    ...parseDates(near(whole, ["有効期間の満了する日"], 240)),
    ...parseDates(rawField(debug, "有効期間の満了する日")),
  ].filter((d, i, a) => a.findIndex((x) => x.serial === d.serial) === i)
    .filter((d) => (!regSerial || d.serial >= regSerial) && (!firstSerial || Math.floor(d.serial / 100) >= firstSerial))
    .sort((a, b) => b.serial - a.serial);
  const expiryInput = detail("有効期間の満了する日");
  const currentExpiry = parseDates(expiryInput?.value || "")[0];
  const currentInvalid = currentExpiry && ((regSerial && currentExpiry.serial < regSerial) || (firstSerial && Math.floor(currentExpiry.serial / 100) < firstSerial));
  if (expiryCandidates[0]) setValue(expiryInput, formatDate(expiryCandidates[0]));
  else if (currentInvalid) setValue(expiryInput, "", true);

  const nameSource = `${near(whole, ["使用者の氏名又は名称"], 260)}\n${rawField(debug, "使用者の氏名又は名称")}`;
  const addressSource = `${near(whole, ["使用者の住所"], 300)}\n${rawField(debug, "使用者の住所")}`;
  const baseSource = `${near(whole, ["使用の本拠の位置"], 220)}\n${rawField(debug, "使用の本拠の位置")}`;
  const name = bestName(nameSource);
  const address = bestAddress(addressSource);
  if (name) setValue(detail("使用者の氏名又は名称"), name);
  if (address) setValue(detail("使用者の住所"), address);
  if (/[*＊]{2,}/.test(baseSource)) setValue(detail("使用の本拠の位置"), "***");
  else if (/使用者.*住所.*同じ|住所に同じ/.test(baseSource)) setValue(detail("使用の本拠の位置"), "使用者住所に同じ");

  const engineSource = `${near(whole, ["原動機の型式"], 180)}\n${rawField(debug, "原動機の型式")}`;
  const engine = bestEngine(engineSource);
  const currentEngine = detail("原動機の型式")?.value || "";
  if (engine) setValue(detail("原動機の型式"), engine);
  else if (/^(OCR|0CR)$/i.test(currentEngine.trim())) setValue(detail("原動機の型式"), "", true);

  const dimensionSource = near(whole, ["車両重量"], 420);
  const dims = dimensionRow(dimensionSource);
  if (dims.length === 5) {
    const [vw, gw, len, wid, hei] = dims;
    setValue(detail("車両重量 kg"), vw);
    setValue(basic("車両重量 kg"), vw);
    setValue(detail("車両総重量 kg"), gw);
    setValue(detail("長さ cm"), len);
    setValue(detail("幅 cm"), wid);
    setValue(detail("高さ cm"), hei);
  }

  const axleSource = `${near(whole, ["前前軸重"], 360)}\n${rawField(debug, "前前軸重 kg")} ${rawField(debug, "前後軸重 kg")} ${rawField(debug, "後前軸重 kg")} ${rawField(debug, "後後軸重 kg")}`;
  const axles = axleRow(axleSource);
  if (axles.length === 4) {
    const [ff, fr, rf, rr] = axles;
    if (ff) setValue(detail("前前軸重 kg"), ff);
    if (fr) setValue(detail("前後軸重 kg"), fr);
    if (rf) setValue(detail("後前軸重 kg"), rf);
    if (rr) setValue(detail("後後軸重 kg"), rr);
  }
}

export default function CertificateChassisCorrectionFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;

    let running = false;
    let lastDebug = "";

    const run = () => {
      if (running) return;
      const debug = getDebugText();
      if (!debug.includes("【車検証 全体OCR】")) return;
      running = true;
      try {
        runCorrection(debug);
        lastDebug = debug;
      } finally {
        running = false;
      }
    };

    const observer = new MutationObserver(() => {
      const debug = getDebugText();
      if (debug && (debug !== lastDebug || debug.includes("【車検証 全体OCR】"))) run();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    // Other OCR correction layers can finish later. Keep this consistency pass alive so
    // a weaker late result cannot permanently overwrite a stronger value.
    const timer = window.setInterval(run, 700);
    run();

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
