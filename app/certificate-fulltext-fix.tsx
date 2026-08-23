"use client";

import { useEffect } from "react";

type Parsed = Record<string, string>;

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
  return norm(value).replace(/\s+/g, "");
}

function numericText(value: string) {
  return norm(value)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");
}

function globalText(debug: string) {
  const marker = "【車検証 全体OCR】";
  const i = debug.indexOf(marker);
  return i >= 0 ? debug.slice(i + marker.length).trim() : "";
}

function rawField(debug: string, label: string) {
  const a = `【${label} 生OCR】`;
  const b = `【${label} 採用】`;
  const i = debug.indexOf(a);
  if (i < 0) return "";
  const j = debug.indexOf(b, i + a.length);
  return debug.slice(i + a.length, j >= 0 ? j : undefined).trim();
}

function docNumber(text: string) {
  const t = numericText(text);
  const found = t.match(/(?:\d[\s\n]*){12,13}/g) || [];
  for (const raw of found) {
    const d = raw.replace(/\D/g, "");
    if (d.length === 12 && new Set(d).size >= 4) return d;
  }
  return "";
}

function model(text: string) {
  const t = norm(text)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[＿_]/g, "-")
    .replace(/-NKRS(?=\d)/g, "-NKR");
  const prefixes = "DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG";
  return t.match(new RegExp(`(?:${prefixes})-[A-Z0-9]{3,12}`))?.[0] || "";
}

function engine(text: string) {
  let t = norm(text).toUpperCase();
  t = t
    .replace(/[Oo]/g, "0")
    .replace(/[リり]/g, "J")
    .replace(/\s+/g, "");
  const strict = t.match(/\d[A-Z]{2}\d/g) || [];
  if (strict.length) return strict[0];
  const loose = t.match(/[A-Z0-9]{3,8}/g) || [];
  return loose.find((x) => /[A-Z]/.test(x) && /\d/.test(x) && !/^(TKG|QKG|PKG|SKG|DAA|DBA|ABA)/.test(x)) || "";
}

function known(text: string, choices: string[]) {
  const t = compact(text);
  return choices.find((x) => t.includes(compact(x))) || "";
}

function vehicleName(text: string) {
  const exact = known(text, ["いすゞ", "トヨタ", "日産", "ホンダ", "マツダ", "スズキ", "三菱", "ダイハツ", "スバル", "日野", "UDトラックス", "レクサス"]);
  if (exact) return exact;
  const t = norm(text);
  if (/い[^\n]{0,6}ゞ/.test(t) || /い\s*[キす][^\n]{0,4}ゞ/.test(t)) return "いすゞ";
  return "";
}

function companyName(text: string) {
  for (const line0 of norm(text).split("\n")) {
    const line = line0.replace(/\s{2,}/g, " ").trim();
    if (!/(株式会社|有限会社|合同会社)/.test(line)) continue;
    const i = Math.max(line.indexOf("株式会社"), line.indexOf("有限会社"), line.indexOf("合同会社"));
    const v = (i >= 0 ? line.slice(i) : line).replace(/[|｜]+$/g, "").trim();
    if (v.length >= 4 && v.length <= 70) return v;
  }
  return "";
}

function baseLocation(text: string) {
  const t = norm(text);
  const i = t.indexOf("使用の本拠の位置");
  if (i < 0) return "";
  const c = t.slice(i, i + 180);
  if (/[*＊kK]{3,}/.test(c)) return "***";
  return "";
}

function fuzzyRecordDate(raw: string) {
  let t = norm(raw)
    .replace(/作\s*和/g, "令和")
    .replace(/三\s*和/g, "令和")
    .replace(/今\s*和/g, "令和");
  const em = t.match(/令和|平成|昭和/);
  if (!em) return "";
  t = t.slice((em.index || 0) + em[0].length);
  const tokens = t.match(/\d{1,3}/g) || [];
  const vals = (token: string) => {
    const n = Number(token);
    const a: number[] = [];
    if (n >= 0 && n <= 99) a.push(n);
    if (token.length === 3) {
      a.push(Number(token.slice(0, 2)), Number(token.slice(1)), Number(token[0]), Number(token[2]));
    }
    return [...new Set(a)];
  };
  for (let i = 0; i < tokens.length; i++) {
    for (const y of vals(tokens[i])) {
      if (y < 1 || y > (em[0] === "令和" ? 30 : em[0] === "平成" ? 31 : 64)) continue;
      for (let j = i + 1; j < Math.min(tokens.length, i + 4); j++) {
        for (const m of vals(tokens[j])) {
          if (m < 1 || m > 12) continue;
          for (let k = j + 1; k < Math.min(tokens.length, j + 4); k++) {
            for (const d of vals(tokens[k])) {
              if (d < 1 || d > 31) continue;
              return `${em[0]}${y}年${m}月${d}日`;
            }
          }
        }
      }
    }
  }
  return "";
}

function numbers(text: string) {
  return (numericText(text).replace(/,/g, "").match(/\d{1,5}/g) || []).map(Number);
}

function vehicleRowValues(text: string) {
  const t = norm(text);
  let start = t.indexOf("車両総重量");
  if (start < 0) start = t.indexOf("車両重量");
  const end0 = t.indexOf("総排気量", Math.max(0, start));
  const end = end0 > start ? end0 : Math.min(t.length, Math.max(0, start) + 700);
  if (start < 0) return null;
  const nums = numbers(t.slice(start, end));
  for (let i = 0; i + 4 < nums.length; i++) {
    const a = nums[i], b = nums[i + 1], c = nums[i + 2], d = nums[i + 3], e = nums[i + 4];
    if (a >= 500 && a <= 50000 && b >= a && b <= 80000 && c >= 200 && c <= 2000 && d >= 100 && d <= 350 && e >= 100 && e <= 500) {
      const rest = nums.slice(i + 5).filter((n) => n >= 200 && n <= 30000);
      return { vehicleWeight: a, grossWeight: b, length: c, width: d, height: e, rest };
    }
  }
  return null;
}

function seatingFromText(text: string) {
  const t = norm(text);
  let start = t.indexOf("車体の形状");
  if (start < 0) start = t.indexOf("乗車定員");
  let end = t.indexOf("車両総重量", Math.max(0, start));
  if (end < 0) end = Math.min(t.length, Math.max(0, start) + 450);
  if (start < 0) return "";
  const vals = numbers(t.slice(start, end)).filter((n) => n >= 1 && n <= 20 && n !== 2 && n !== 21);
  return vals.length ? String(vals[0]) : "";
}

function displacement(text: string) {
  const t = norm(text);
  const i = t.indexOf("総排気量");
  const c = i >= 0 ? t.slice(i, i + 180) : t;
  return c.match(/\b\d{1,2}\.\d{1,2}\b/)?.[0] || "";
}

function inferFuel(text: string, eng: string) {
  const exact = known(text, ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"]);
  if (exact) return exact === "揮発油" ? "ガソリン" : exact;
  const e = eng.toUpperCase();
  if (/^(4JJ1|4JJ3|4JZ1|4HK1|4HK2|4JB1|4JG2|1KD|2KD|1GD|2GD|ZD30|4M50|4M51|4P10|J05E|J07E|J08E|N04C|S05C|S05D|GH5|GH7|GH11)$/.test(e)) return "軽油";
  return "";
}

function parse(debug: string): Parsed {
  const g = globalText(debug);
  if (!g) return {};
  const out: Parsed = {};
  out.recordDate = fuzzyRecordDate(rawField(debug, "記録年月日"));
  out.documentNumber = docNumber(g);
  out.model = model(g);
  out.engineModel = engine((() => {
    const t = norm(g), i = t.indexOf("原動機の型式");
    return i >= 0 ? t.slice(i, i + 160) : g;
  })());
  out.vehicleName = vehicleName(g);
  out.vehicleClass = known(g, ["普通", "小型", "軽自動車", "大型特殊"]);
  out.purpose = known(g, ["貨物", "乗用", "乗合", "特種"]);
  out.privateBusiness = known(g, ["自家用", "事業用"]);
  out.bodyShape = known(g, ["バン", "キャブオーバ", "箱型", "ステーションワゴン", "セダン", "ボンネット", "トラック", "ダンプ", "幌型", "ピックアップ", "バス"]);
  out.userName = companyName(g);
  out.baseLocation = baseLocation(g);
  out.seatingCapacity = seatingFromText(g);
  const row = vehicleRowValues(g);
  if (row) {
    out.vehicleWeightKg = String(row.vehicleWeight);
    out.grossVehicleWeightKg = String(row.grossWeight);
    out.lengthCm = String(row.length);
    out.widthCm = String(row.width);
    out.heightCm = String(row.height);
    if (row.rest.length >= 4) {
      out.frontFrontAxleWeightKg = String(row.rest[0]);
      out.frontRearAxleWeightKg = String(row.rest[1]);
      out.rearFrontAxleWeightKg = String(row.rest[2]);
      out.rearRearAxleWeightKg = String(row.rest[3]);
    } else if (row.rest.length >= 2) {
      out.frontFrontAxleWeightKg = String(row.rest[0]);
      out.frontRearAxleWeightKg = "";
      out.rearFrontAxleWeightKg = "";
      out.rearRearAxleWeightKg = String(row.rest[row.rest.length - 1]);
    }
    const seats = Number(out.seatingCapacity || 0);
    if (seats >= 1 && seats <= 20) {
      const payload = row.grossWeight - row.vehicleWeight - seats * 55;
      if (payload >= 0 && payload <= 50000 && payload % 5 === 0) out.maxPayloadKg = String(payload);
    }
  }
  out.displacementOrRatedOutput = displacement(g);
  out.fuel = inferFuel(g, out.engineModel || "");
  return out;
}

function sectionByHeading(text: string) {
  return Array.from(document.querySelectorAll("section.card")).find((section) => section.querySelector("h2")?.textContent?.includes(text)) || null;
}

function inputByLabel(sectionTitle: string, labelText: string) {
  const section = sectionByHeading(sectionTitle);
  if (!section) return null;
  for (const label of Array.from(section.querySelectorAll("label"))) {
    const title = (label.querySelector("span")?.textContent || label.childNodes[0]?.textContent || label.textContent || "").trim();
    if (compact(title) !== compact(labelText)) continue;
    return label.querySelector("input") as HTMLInputElement | null;
  }
  return null;
}

function nativeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInput(input: HTMLInputElement | null, value: string | undefined, allowEmpty = false) {
  if (!input || value == null || (!allowEmpty && !value) || input.value === value) return;
  nativeInput(input, value);
}

function detail(label: string) { return inputByLabel("車検証読み取り情報", label); }
function basic(label: string) { return inputByLabel("基本情報", label); }

function setFuelSelect(value: string) {
  if (!value) return;
  const section = sectionByHeading("基本情報");
  const select = Array.from(section?.querySelectorAll("label") || []).find((label) => (label.textContent || "").includes("燃料"))?.querySelector("select") as HTMLSelectElement | null;
  if (!select) return;
  const mapped = value === "軽油" ? "ディーゼル" : value === "ガソリン" ? "ガソリン" : value === "電気" ? "EV" : "その他";
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, mapped); else select.value = mapped;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function apply(v: Parsed) {
  const map: Array<[string, string, boolean?]> = [
    ["記録年月日", v.recordDate], ["記録事項番号", v.documentNumber], ["使用者の氏名又は名称", v.userName], ["使用の本拠の位置", v.baseLocation],
    ["車名", v.vehicleName], ["型式", v.model], ["原動機の型式", v.engineModel], ["自動車の種別", v.vehicleClass], ["用途", v.purpose], ["自家用・事業用の別", v.privateBusiness], ["車体の形状", v.bodyShape],
    ["乗車定員", v.seatingCapacity], ["最大積載量 kg", v.maxPayloadKg], ["車両重量 kg", v.vehicleWeightKg], ["車両総重量 kg", v.grossVehicleWeightKg],
    ["長さ cm", v.lengthCm], ["幅 cm", v.widthCm], ["高さ cm", v.heightCm], ["前前軸重 kg", v.frontFrontAxleWeightKg],
    ["前後軸重 kg", v.frontRearAxleWeightKg, true], ["後前軸重 kg", v.rearFrontAxleWeightKg, true], ["後後軸重 kg", v.rearRearAxleWeightKg],
    ["総排気量又は定格出力", v.displacementOrRatedOutput], ["燃料の種類", v.fuel],
  ];
  for (const [label, value, allowEmpty] of map) setInput(detail(label), value, Boolean(allowEmpty));
  setInput(basic("型式"), v.model);
  setInput(basic("車両重量 kg"), v.vehicleWeightKg);
  setFuelSelect(v.fuel || "");
}

export default function CertificateFulltextFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;
    let last = "";
    let disposed = false;
    const run = () => {
      if (disposed) return;
      const debug = Array.from(document.querySelectorAll("details pre")).map((x) => x.textContent || "").find((x) => x.includes("【車検証 全体OCR】")) || "";
      if (!debug || debug === last) return;
      last = debug;
      const values = parse(debug);
      apply(values);
      for (const delay of [500, 1400, 3200]) window.setTimeout(() => { if (!disposed) apply(values); }, delay);
    };
    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const interval = window.setInterval(run, 700);
    run();
    return () => { disposed = true; observer.disconnect(); window.clearInterval(interval); };
  }, []);
  return null;
}
