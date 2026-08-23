"use client";

import { useEffect } from "react";

function norm(value: string) {
  return (value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
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
    const input = label.querySelector("input");
    if (input) return input as HTMLInputElement;
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
  if (!input || input.value === value) return;
  nativeSetInput(input, value);
}

function debugText() {
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
  const i = compact(debug).indexOf(compact(label));
  if (i < 0) return "";

  // Use the original text as well. The compact lookup is only a fallback signal;
  // raw-field text is preferred whenever it exists.
  const direct = debug.indexOf(label);
  return direct >= 0 ? debug.slice(direct, direct + span) : "";
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

function bestModel(debug: string, current: string) {
  const text = norm(`${rawField(debug, "型式")}\n${nearLabel(debug, "型式")}\n${debug}`)
    .toUpperCase()
    .replace(/[＿_]/g, "-")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/[ \t]+/g, "");

  const prefixes = "DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG";
  const matches = text.match(new RegExp(`(?:${prefixes})-[A-Z0-9]{3,12}`, "g")) || [];
  const family = chassisFamily();

  const normalized = matches
    .map(fixNkrFalseS)
    .filter((x, i, a) => a.indexOf(x) === i)
    .filter((x) => !family || (x.split("-")[1] || "").startsWith(family));

  if (normalized.length) {
    normalized.sort((a, b) => {
      const ab = a.split("-")[1] || "";
      const bb = b.split("-")[1] || "";
      const aScore = (family && ab.startsWith(family) ? 100 : 0) + a.length;
      const bScore = (family && bb.startsWith(family) ? 100 : 0) + b.length;
      return bScore - aScore;
    });
    return normalized[0];
  }

  return fixNkrFalseS(current);
}

function engineCandidates(value: string) {
  const text = norm(value)
    .toUpperCase()
    .replace(/[＿_]/g, "-")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/[ \t]+/g, " ");

  const found = new Set<string>();
  const patterns = [
    /\b\d[A-Z]{2}\d(?:-[A-Z0-9]{2,8})?\b/g,          // 4JJ1, 1KD-FTV family
    /\b\d[A-Z]{1,3}[0-9A-Z]{1,3}(?:-[A-Z0-9]{2,8})?\b/g,
    /\b[A-Z]\d[A-Z0-9]{1,4}(?:-[A-Z0-9]{2,8})?\b/g, // R06A-WA05A, K6A
  ];
  for (const pattern of patterns) {
    for (const match of text.match(pattern) || []) found.add(match.replace(/O(?=\d)/g, "0"));
  }
  return [...found];
}

function bestEngine(debug: string, current: string) {
  const raw = rawField(debug, "原動機の型式");
  const near = nearLabel(debug, "原動機の型式", 180);
  const candidates = [...engineCandidates(raw), ...engineCandidates(near), ...engineCandidates(debug)]
    .filter((x, i, a) => a.indexOf(x) === i)
    .filter((x) => !/^(TKG|QKG|PKG|SKG|DAA|DBA|ABA|NKR|NPR|NLR|NMR)/.test(x));

  if (!candidates.length) return current;

  candidates.sort((a, b) => {
    const score = (x: string) => {
      let s = 0;
      if (/^\d[A-Z]{2}\d$/.test(x)) s += 120;
      if (/^[A-Z]\d{1,2}[A-Z][A-Z0-9]{0,3}(?:-[A-Z0-9]{2,8})?$/.test(x)) s += 80;
      if (raw && compact(raw).includes(compact(x))) s += 100;
      if (near && compact(near).includes(compact(x))) s += 50;
      s -= Math.abs(x.length - 4) * 2;
      return s;
    };
    return score(b) - score(a);
  });

  return candidates[0];
}

type ParsedDate = { era: string; year: number; month: number; day: number; serial: number };

function parseJapaneseDate(value: string): ParsedDate | null {
  const t = norm(value)
    .replace(/\s+/g, "")
    .replace(/[OoQq]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[.,/\\_-]/g, "");
  const m = t.match(/(令和|平成|昭和)(元|\d{1,2})年?(\d{1,2})月?(\d{1,2})日?/);
  if (!m) return null;
  const eraYear = m[2] === "元" ? 1 : Number(m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const base = m[1] === "令和" ? 2018 : m[1] === "平成" ? 1988 : 1925;
  const year = base + eraYear;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return { era: m[1], year, month, day, serial: year * 10000 + month * 100 + day };
}

function formatDate(p: ParsedDate) {
  const base = p.era === "令和" ? 2018 : p.era === "平成" ? 1988 : 1925;
  const eraYear = p.year - base;
  return `${p.era}${eraYear === 1 ? "元" : eraYear}年${p.month}月${p.day}日`;
}

function dateCandidates(value: string) {
  const text = norm(value);
  const matches = text.match(/(?:令和|平成|昭和)\s*(?:元|[0-9OoQqDdIiLl|ZzSsBb]{1,2})\s*年?\s*[0-9OoQqDdIiLl|ZzSsBb]{1,2}\s*月?\s*[0-9OoQqDdIiLl|ZzSsBb]{1,2}\s*日?/g) || [];
  return matches.map(parseJapaneseDate).filter((x): x is ParsedDate => !!x);
}

function bestDateForField(debug: string, label: string, after?: ParsedDate | null) {
  const raw = rawField(debug, label);
  const near = nearLabel(debug, label, 220);
  const candidates = [...dateCandidates(raw), ...dateCandidates(near)]
    .filter((x, i, a) => a.findIndex((y) => y.serial === x.serial) === i)
    .filter((x) => !after || x.serial >= after.serial);
  if (!candidates.length) return null;
  return candidates[0];
}

function enforceDateConsistency(debug: string) {
  const registrationInput = detailInput("登録年月日／交付年月日");
  const expiryInput = detailInput("有効期間の満了する日");
  if (!registrationInput || !expiryInput) return;

  const currentRegistration = parseJapaneseDate(registrationInput.value);
  const targetedRegistration = bestDateForField(debug, "登録年月日／交付年月日");
  const registration = targetedRegistration || currentRegistration;
  if (targetedRegistration) setIfDifferent(registrationInput, formatDate(targetedRegistration));

  const currentExpiry = parseJapaneseDate(expiryInput.value);
  const targetedExpiry = bestDateForField(debug, "有効期間の満了する日", registration);

  if (targetedExpiry) {
    setIfDifferent(expiryInput, formatDate(targetedExpiry));
    return;
  }

  // Never keep an impossible expiry date. A blank field is safer than a date
  // that predates the registration/issue date.
  if (currentExpiry && registration && currentExpiry.serial < registration.serial) {
    setIfDifferent(expiryInput, "");
  }
}

function enforceNumericConsistency() {
  const vehicleWeight = detailInput("車両重量 kg");
  const grossWeight = detailInput("車両総重量 kg");
  if (vehicleWeight?.value && grossWeight?.value) {
    const a = Number(vehicleWeight.value.replace(/\D/g, ""));
    const b = Number(grossWeight.value.replace(/\D/g, ""));
    if (a > 0 && b > 0 && b < a) setIfDifferent(grossWeight, "");
  }

  const length = detailInput("長さ cm");
  const width = detailInput("幅 cm");
  if (length?.value && width?.value) {
    const l = Number(length.value.replace(/\D/g, ""));
    const w = Number(width.value.replace(/\D/g, ""));
    if (l > 0 && w > 0 && l < w) setIfDifferent(length, "");
  }
}

export default function CertificateConsistencyFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastKey = "";

    const run = () => {
      const img = document.querySelector("img.preview") as HTMLImageElement | null;
      const debug = debugText();
      if (!img?.src || !debug.includes("【車検証 全体OCR】")) return;

      const key = `${img.src}|${debug.length}`;
      if (key === lastKey) return;
      lastKey = key;

      const detailChassis = detailInput("車台番号");
      const basicChassis = basicInput("車台番号");
      const chassis = fixNkrFalseS(detailChassis?.value || basicChassis?.value || "");
      if (chassis) {
        setIfDifferent(detailChassis, chassis);
        setIfDifferent(basicChassis, chassis);
      }

      const modelInput = detailInput("型式");
      if (modelInput?.value) {
        const correctedModel = bestModel(debug, modelInput.value);
        if (correctedModel) setIfDifferent(modelInput, correctedModel);
      }

      const engineInput = detailInput("原動機の型式");
      if (engineInput) {
        const engine = bestEngine(debug, engineInput.value);
        if (engine) setIfDifferent(engineInput, engine);
      }

      enforceDateConsistency(debug);
      enforceNumericConsistency();
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      // Other OCR correction layers run first. Consistency validation is the last pass.
      timer = setTimeout(run, 3200);
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
