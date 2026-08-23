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
  const chars = [...label.replace(/\s+/g, "")].map((c) => escapeRegExp(c));
  return new RegExp(chars.join("\\s*"));
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
  const rest = debug.slice(i + marker.length);
  return rest.split("\n")[0]?.trim() || "";
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

function parseDashOrInteger(value: string, min: number, max: number) {
  const t = norm(value);
  if (/(^|\s)-($|\s)/.test(t) || /^[－ー―-]$/.test(t)) return "-";
  return parseInteger(t, min, max);
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
  const candidates = all.filter((x) => !/^[A-Z]{1,4}[0-9]{2,6}-[0-9O]{4,10}$/.test(x));
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}

function parseChassis(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "");
  const all = t.match(/[A-Z]{1,4}[0-9]{2,6}-[0-9O]{4,10}/g) || [];
  const picked = all.sort((a, b) => b.length - a.length)[0];
  if (!picked) return "";
  const [left, right] = picked.split("-");
  return `${left}-${right.replace(/O/g, "0")}`;
}

function parseEngine(value: string) {
  const t = norm(value).toUpperCase().replace(/\s+/g, "").replace(/O/g, "0");
  const all = t.match(/[A-Z0-9]{3,10}/g) || [];
  return all.find((x) => /[A-Z]/.test(x) && /\d/.test(x) && !x.startsWith("TKG") && !x.startsWith("QKG") && !x.startsWith("2RG")) || "";
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

function cleanJapaneseText(value: string, allowStars = false) {
  const t = norm(value).replace(/\s+/g, " ").trim();
  if (allowStars && /^[*＊]{2,4}$/.test(t)) return "***";
  if (!t || t.length > 80) return "";
  if (/原動機|型式|車台|手細情報|OCR|<|>|\{|\}/.test(t)) return "";
  const jp = (t.match(/[一-龠々ぁ-んァ-ヶ]/g) || []).length;
  const bad = (t.match(/[\[\]{}<>「」『』※☆★]/g) || []).length;
  if (jp < 2 || bad >= 2) return "";
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

function bestSource(globalText: string, debug: string, label: string, aliases: string[] = []) {
  return nearValue(globalText, aliases.length ? aliases : [label]) || rawField(debug, label);
}

function buildCorrections(globalText: string, debug: string) {
  const out = new Map<string, string>();
  const put = (label: string, parsed: string, sanitize?: (value: string) => string) => {
    const now = currentValue(label);
    const cleanNow = sanitize ? sanitize(now) : now;
    const finalValue = parsed || cleanNow;
    if (finalValue !== now) out.set(label, finalValue);
  };

  put("記録年月日", parseJapaneseDate(bestSource(globalText, debug, "記録年月日")));
  put("記録事項番号", (digitsOnly(bestSource(globalText, debug, "記録事項番号", ["記録事項番号", "記録事項"])).match(/\d{10,14}/) || [""])[0]);
  put("自動車登録番号又は車両番号", parseRegistration(bestSource(globalText, debug, "自動車登録番号又は車両番号")));
  put("車台番号", parseChassis(bestSource(globalText, debug, "車台番号") || globalText));
  put("登録年月日／交付年月日", parseJapaneseDate(bestSource(globalText, debug, "登録年月日／交付年月日", ["登録年月日", "交付年月日"])));
  put("初度登録年月", parseJapaneseMonth(bestSource(globalText, debug, "初度登録年月", ["初度登録年月", "初度登録"])));
  put("有効期間の満了する日", parseJapaneseDate(bestSource(globalText, debug, "有効期間の満了する日")));

  put("使用者の氏名又は名称", cleanJapaneseText(bestSource(globalText, debug, "使用者の氏名又は名称")), (v) => cleanJapaneseText(v));
  put("使用者の住所", cleanJapaneseText(bestSource(globalText, debug, "使用者の住所")), (v) => cleanJapaneseText(v));
  put("使用の本拠の位置", cleanJapaneseText(bestSource(globalText, debug, "使用の本拠の位置"), true), (v) => cleanJapaneseText(v, true));

  const vehicleNameSource = bestSource(globalText, debug, "車名");
  put("車名", pickKnown(vehicleNameSource || globalText, ["日野","トヨタ","レクサス","日産","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","メルセデス・ベンツ","BMW","アウディ","フォルクスワーゲン","ボルボ"]), (v) => pickKnown(v, ["日野","トヨタ","レクサス","日産","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","UDトラックス","メルセデス・ベンツ","BMW","アウディ","フォルクスワーゲン","ボルボ"]));
  put("型式", parseModel(bestSource(globalText, debug, "型式") || globalText), (v) => parseModel(v));
  put("原動機の型式", parseEngine(bestSource(globalText, debug, "原動機の型式")), (v) => parseEngine(v));
  put("自動車の種別", pickKnown(bestSource(globalText, debug, "自動車の種別"), ["普通","小型","軽自動車","大型特殊"]), (v) => pickKnown(v, ["普通","小型","軽自動車","大型特殊"]));
  put("用途", pickKnown(bestSource(globalText, debug, "用途"), ["貨物","乗用","乗合","特種"]), (v) => pickKnown(v, ["貨物","乗用","乗合","特種"]));
  put("自家用・事業用の別", pickKnown(bestSource(globalText, debug, "自家用・事業用の別", ["自家用・事業用の別", "自家用・事業用"]), ["自家用","事業用"]), (v) => pickKnown(v, ["自家用","事業用"]));
  put("車体の形状", pickKnown(bestSource(globalText, debug, "車体の形状"), ["キャブオーバ","バン","箱型","ステーションワゴン","セダン","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]), (v) => pickKnown(v, ["キャブオーバ","バン","箱型","ステーションワゴン","セダン","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]));

  put("乗車定員", parseInteger(bestSource(globalText, debug, "乗車定員"), 1, 99), (v) => parseInteger(v, 1, 99));
  put("最大積載量 kg", parseRound50(bestSource(globalText, debug, "最大積載量 kg", ["最大積載量"]), 100, 99999) || (/-/.test(bestSource(globalText, debug, "最大積載量 kg", ["最大積載量"])) ? "-" : ""), (v) => v === "-" ? "-" : parseRound50(v, 100, 99999));
  put("車両重量 kg", parseInteger(bestSource(globalText, debug, "車両重量 kg", ["車両重量"]), 100, 99999), (v) => parseInteger(v, 100, 99999));
  put("車両総重量 kg", parseInteger(bestSource(globalText, debug, "車両総重量 kg", ["車両総重量"]), 100, 99999), (v) => parseInteger(v, 100, 99999));
  put("長さ cm", parseInteger(bestSource(globalText, debug, "長さ cm", ["長さ"]), 50, 3000), (v) => parseInteger(v, 50, 3000));
  put("幅 cm", parseInteger(bestSource(globalText, debug, "幅 cm", ["幅"]), 50, 1000), (v) => parseInteger(v, 50, 1000));
  put("高さ cm", parseInteger(bestSource(globalText, debug, "高さ cm", ["高さ"]), 50, 1000), (v) => parseInteger(v, 50, 1000));

  const axle = (label: string, aliases: string[]) => {
    const source = bestSource(globalText, debug, label, aliases);
    const parsed = /^\s*[-－ー―]\s*$/.test(source) ? "-" : parseRound10(source, 100, 30000);
    put(label, parsed, (v) => v === "-" ? "-" : parseRound10(v, 100, 30000));
  };
  axle("前前軸重 kg", ["前前軸重"]);
  axle("前後軸重 kg", ["前後軸重"]);
  axle("後前軸重 kg", ["後前軸重"]);
  axle("後後軸重 kg", ["後後軸重"]);

  put("総排気量又は定格出力", parseOutput(bestSource(globalText, debug, "総排気量又は定格出力", ["総排気量又は定格出力", "総排気量", "定格出力"])), (v) => parseOutput(v));
  put("燃料の種類", pickKnown(bestSource(globalText, debug, "燃料の種類", ["燃料の種類", "燃料"]), ["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]), (v) => pickKnown(v, ["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]));
  put("型式指定番号", (bestSource(globalText, debug, "型式指定番号").match(/\b\d{4,6}\b/) || [""])[0], (v) => (/^\d{4,6}$/.test(v) ? v : ""));
  put("類別区分番号", (bestSource(globalText, debug, "類別区分番号").match(/\b\d{4,6}\b/) || [""])[0], (v) => (/^\d{4,6}$/.test(v) ? v : ""));

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
          await new Promise((resolve) => setTimeout(resolve, 45));
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
