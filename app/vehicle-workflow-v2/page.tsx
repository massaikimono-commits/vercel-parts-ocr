"use client";

import { useEffect } from "react";
import VehicleWorkflowV3 from "../vehicle-workflow-v3/page";

const FIELD_LABELS = [
  "記録年月日","記録事項番号","自動車登録番号又は車両番号","車台番号","登録年月日／交付年月日","初度登録年月",
  "有効期間の満了する日","使用者の氏名又は名称","使用者の住所","使用の本拠の位置","車名","型式","原動機の型式",
  "自動車の種別","用途","自家用・事業用の別","車体の形状","乗車定員","最大積載量 kg","車両重量 kg",
  "車両総重量 kg","長さ cm","幅 cm","高さ cm","前前軸重 kg","前後軸重 kg","後前軸重 kg","後後軸重 kg",
  "総排気量又は定格出力","燃料の種類","型式指定番号","類別区分番号"
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looseLabelRegex(label: string) {
  return new RegExp([...label.replace(/\s+/g, "")].map(escapeRegExp).join("\\s*"));
}

function isFieldLine(line: string) {
  const c = compact(line);
  return FIELD_LABELS.some((label) => c.includes(compact(label)));
}

function nearValue(text: string, aliases: string[], maxNext = 4) {
  const lines = norm(text).split("\n").map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const lineCompact = compact(lines[i]);
    for (const alias of aliases) {
      if (!lineCompact.includes(compact(alias))) continue;
      const candidates: string[] = [];
      const same = lines[i].replace(looseLabelRegex(alias), " ").trim();
      if (same) candidates.push(same);
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + maxNext); j++) {
        if (isFieldLine(lines[j])) break;
        candidates.push(lines[j]);
      }
      const joined = candidates.join(" ").trim();
      if (joined) return joined;
    }
  }
  return "";
}

function rawField(debug: string, label: string) {
  const marker = `【${label} 生OCR】`;
  const i = debug.indexOf(marker);
  if (i < 0) return "";
  return debug.slice(i + marker.length).split("\n")[0]?.trim() || "";
}

function digitsOnly(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function parseInteger(value: string, min: number, max: number) {
  const matches = norm(value).replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/,/g, "").match(/\d{1,6}/g) || [];
  for (const m of matches) {
    const n = Number(m);
    if (n >= min && n <= max) return String(n);
  }
  return "";
}

function parseRound10(value: string, min: number, max: number) {
  const n = parseInteger(value, min, max);
  return n && Number(n) % 10 === 0 ? n : "";
}

function parseRound50(value: string, min: number, max: number) {
  const n = parseInteger(value, min, max);
  return n && Number(n) % 50 === 0 ? n : "";
}

function parseModel(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "");
  const all = t.match(/[0-9A-Z]{2,5}-[A-Z0-9]{3,12}/g) || [];
  return all
    .filter((x) => !/^[A-Z]{1,4}[0-9]{2,6}-[0-9O]{4,10}$/.test(x))
    .sort((a, b) => b.length - a.length)[0] || "";
}

function parseChassis(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "");
  const all = t.match(/[A-Z]{1,4}[0-9]{2,6}-[0-9O]{4,10}/g) || [];
  const picked = all.sort((a, b) => b.length - a.length)[0];
  if (!picked) return "";
  const [left, right] = picked.split("-");
  return `${left}-${right.replace(/O/g, "0")}`;
}

function parseRegistration(value: string) {
  const t = norm(value);
  const m = t.match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  if (!m) return "";
  return `${m[1]} ${digitsOnly(m[2])} ${m[3]} ${digitsOnly(m[4])}`;
}

function parseJapaneseMonth(value: string) {
  const t = norm(value).replace(/[年月日.,/\-]/g, " ").replace(/\s+/g, " ");
  const m = t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*(?:年\s*)?(\d{1,2})/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
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

function pickKnown(value: string, choices: string[]) {
  const t = compact(value);
  return choices.find((x) => t.includes(compact(x))) || "";
}

function parseOutput(value: string) {
  const t = norm(value);
  const withUnit = t.match(/\d+(?:\.\d+)?\s*(?:L|l|kW|KW|kw)/);
  if (withUnit) return withUnit[0].replace(/\s+/g, "");
  const decimal = t.match(/\d+\.\d+/);
  return decimal?.[0] || "";
}

function parseEngine(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "").replace(/O/g, "0");
  const all = t.match(/[A-Z0-9]{3,8}/g) || [];
  return all.find((x) => /[A-Z]/.test(x) && /\d/.test(x) && !/^(TKG|QKG|PKG|SKG|2RG|3DA|DBA|DAA|ABA)/.test(x)) || "";
}

function parseEngineFromWhole(value: string) {
  const t = norm(value).toUpperCase().replace(/O/g, "0");
  const all = t.match(/\b[0-9][A-Z0-9]{2,6}\b/g) || [];
  const scored = all.filter((x) => /[A-Z]/.test(x) && /\d/.test(x) && x.length >= 3 && x.length <= 7);
  return scored.find((x) => /^\d[A-Z]{1,3}\d[A-Z0-9]{0,2}$/.test(x)) || "";
}

function cleanJapaneseText(value: string, allowStars = false) {
  const t = norm(value).replace(/\s+/g, " ").trim();
  if (allowStars && /[*＊]{2,4}/.test(t)) return "***";
  if (!t || t.length > 80) return "";
  if (/原動機|型式|車台|車両詳細情報|基本情報|手細情報|OCR|<|>|\{|\}|※/.test(t)) return "";
  const jp = (t.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const bad = (t.match(/[\[\]{}<>「」『』☆★]/g) || []).length;
  if (jp < 2 || bad >= 2 || latin > jp + 4) return "";
  return t;
}

function hashText(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(h >>> 0);
}

function detailSection() {
  return Array.from(document.querySelectorAll("section.card")).find((section) =>
    section.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  ) || null;
}

function fieldInput(label: string) {
  const section = detailSection();
  if (!section) return null;
  const labels = Array.from(section.querySelectorAll("label"));
  for (const node of labels) {
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

function currentValue(label: string) {
  return fieldInput(label)?.value?.trim() || "";
}

function sourceFor(globalText: string, debug: string, label: string, aliases: string[] = []) {
  const near = nearValue(globalText, aliases.length ? aliases : [label]);
  const raw = rawField(debug, label);
  return { near, raw };
}

function firstMatchingDocumentNumber(globalText: string) {
  return (norm(globalText).match(/\b\d{10,14}\b/g) || [""])[0] || "";
}

function buildCorrections(globalText: string, debug: string) {
  const out = new Map<string, string>();
  const put = (label: string, value: string, strict = false, sanitize?: (value: string) => string) => {
    const now = currentValue(label);
    const cleanNow = sanitize ? sanitize(now) : now;
    const finalValue = value || (strict ? "" : cleanNow);
    if (finalValue !== now) out.set(label, finalValue);
  };

  const source = (label: string, aliases: string[] = []) => {
    const s = sourceFor(globalText, debug, label, aliases);
    return s.near || s.raw;
  };

  put("記録年月日", parseJapaneseDate(source("記録年月日")), true);
  put("記録事項番号", firstMatchingDocumentNumber(source("記録事項番号", ["記録事項番号", "記録事項"])) || firstMatchingDocumentNumber(globalText), true);
  put("自動車登録番号又は車両番号", parseRegistration(source("自動車登録番号又は車両番号")) || parseRegistration(globalText), true);
  put("車台番号", parseChassis(source("車台番号")) || parseChassis(globalText), true);
  put("登録年月日／交付年月日", parseJapaneseDate(source("登録年月日／交付年月日", ["登録年月日", "交付年月日"])), true);
  put("初度登録年月", parseJapaneseMonth(source("初度登録年月", ["初度登録年月", "初度登録"])), true);
  put("有効期間の満了する日", parseJapaneseDate(source("有効期間の満了する日")), true);

  put("使用者の氏名又は名称", cleanJapaneseText(source("使用者の氏名又は名称")), true);
  put("使用者の住所", cleanJapaneseText(source("使用者の住所")), true);
  const baseSource = source("使用の本拠の位置");
  put("使用の本拠の位置", /[*＊]{2,4}/.test(baseSource) ? "***" : cleanJapaneseText(baseSource, true), true);

  const makers = ["日野","トヨタ","レクサス","日産","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","メルセデス・ベンツ","BMW","アウディ","フォルクスワーゲン","ボルボ"];
  const vehicleName = pickKnown(source("車名"), makers) || pickKnown(globalText, makers);
  put("車名", vehicleName, true);

  put("型式", parseModel(source("型式")) || parseModel(globalText), false, parseModel);

  const engineSource = sourceFor(globalText, debug, "原動機の型式");
  let engine = parseEngine(engineSource.near);
  if (!engine && engineSource.raw && globalText.toUpperCase().replace(/\s+/g, "").includes(parseEngine(engineSource.raw))) engine = parseEngine(engineSource.raw);
  if (!engine) engine = parseEngineFromWhole(globalText);
  put("原動機の型式", engine, true);

  put("自動車の種別", pickKnown(source("自動車の種別"), ["普通","小型","軽自動車","大型特殊"]), true);
  put("用途", pickKnown(source("用途"), ["貨物","乗用","乗合","特種"]) || pickKnown(globalText, ["貨物","乗用","乗合","特種"]), true);
  put("自家用・事業用の別", pickKnown(source("自家用・事業用の別", ["自家用・事業用の別", "自家用・事業用"]), ["自家用","事業用"]), true);
  put("車体の形状", pickKnown(source("車体の形状"), ["キャブオーバ","バン","箱型","ステーションワゴン","セダン","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]), true);

  put("乗車定員", parseInteger(source("乗車定員"), 1, 99), true);
  put("最大積載量 kg", parseRound50(source("最大積載量 kg", ["最大積載量"]), 100, 99999), true);
  put("車両重量 kg", parseRound10(source("車両重量 kg", ["車両重量"]), 100, 99999), true);
  put("車両総重量 kg", parseInteger(source("車両総重量 kg", ["車両総重量"]), 100, 99999), true);
  put("長さ cm", parseInteger(source("長さ cm", ["長さ"]), 100, 3000), true);
  put("幅 cm", parseInteger(source("幅 cm", ["幅"]), 100, 1000), true);
  put("高さ cm", parseInteger(source("高さ cm", ["高さ"]), 100, 1000), true);

  const axleValue = (label: string, aliases: string[]) => {
    const s = sourceFor(globalText, debug, label, aliases);
    const near = /^\s*[-－ー―]\s*$/.test(s.near) ? "-" : parseRound10(s.near, 100, 30000);
    const raw = /^\s*[-－ー―]\s*$/.test(s.raw) ? "-" : parseRound10(s.raw, 100, 30000);
    if (near && raw && near !== raw) return "";
    return near || raw || "";
  };

  let ff = axleValue("前前軸重 kg", ["前前軸重"]);
  let fr = axleValue("前後軸重 kg", ["前後軸重"]);
  let rf = axleValue("後前軸重 kg", ["後前軸重"]);
  let rr = axleValue("後後軸重 kg", ["後後軸重"]);

  if (rf && rr && rf !== "-" && rf === rr) rf = "";
  if (ff && fr && ff !== "-" && ff === fr) fr = "";

  put("前前軸重 kg", ff, true);
  put("前後軸重 kg", fr, true);
  put("後前軸重 kg", rf, true);
  put("後後軸重 kg", rr, true);

  put("総排気量又は定格出力", parseOutput(source("総排気量又は定格出力", ["総排気量又は定格出力", "総排気量", "定格出力"])), true);

  const fuels = ["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"];
  put("燃料の種類", pickKnown(source("燃料の種類", ["燃料の種類", "燃料"]), fuels) || pickKnown(globalText, fuels), true);

  const designationSource = source("型式指定番号");
  const classSource = source("類別区分番号");
  put("型式指定番号", (designationSource.match(/\b\d{5}\b/) || [""])[0], true);
  put("類別区分番号", (classSource.match(/\b\d{4}\b/) || [""])[0], true);

  return out;
}

export default function VehicleWorkflowV2() {
  useEffect(() => {
    let lastHash = "";
    let processing = false;

    const run = async () => {
      const pre = document.querySelector("details pre") as HTMLElement | null;
      if (!pre) {
        lastHash = "";
        return;
      }
      const debug = pre.textContent || "";
      if (!debug.includes("【車検証 全体OCR】")) return;
      const hash = hashText(debug);
      if (processing || hash === lastHash) return;
      processing = true;
      lastHash = hash;
      try {
        const globalText = debug.split("【車検証 全体OCR】").pop() || "";
        const corrections = buildCorrections(globalText, debug);
        for (const [label, value] of corrections) {
          const input = fieldInput(label);
          if (!input || input.value === value) continue;
          nativeSet(input, value);
          await new Promise((resolve) => setTimeout(resolve, 35));
        }
      } finally {
        processing = false;
      }
    };

    const observer = new MutationObserver(() => { void run(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    void run();
    return () => observer.disconnect();
  }, []);

  return <VehicleWorkflowV3 />;
}
