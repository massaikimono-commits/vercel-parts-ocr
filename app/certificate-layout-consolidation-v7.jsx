"use client";

import { useEffect } from "react";
import { normalizeJapanesePlateRegion } from "./lib/japanese-plate-regions";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー−]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compact(value = "") {
  return norm(value).toUpperCase().replace(/\s+/g, "");
}

function numericGroup(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8")
    .replace(/[^0-9]/g, "");
}

function canonicalCode(value = "") {
  return compact(value)
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function section(title) {
  return [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function detailInput(labelText) {
  const card = section("車検証読み取り情報");
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (title !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function setReactInputValue(input, value) {
  if (!(input instanceof HTMLInputElement) || input.value === value) return;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function debugSources() {
  return [...document.querySelectorAll("details pre")]
    .map((node, index) => ({ id: `pre${index}`, text: node.textContent || "" }))
    .filter(source => source.text.trim());
}

function globalOcrText(source = "") {
  const marker = "【車検証 全体OCR】";
  const index = source.indexOf(marker);
  return index >= 0 ? source.slice(index + marker.length) : "";
}

function numbers(text = "") {
  return (norm(text)
    .replace(/,/g, "")
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .match(/\d{1,5}/g) || []).map(Number);
}

// Generic five-column vehicle-dimension row validation. The values are accepted only
// when all five positions form a physically plausible sequence together; no sample
// vehicle values are embedded here.
function dimensionRow(text = "") {
  const t = norm(text);
  let start = t.indexOf("車両総重量");
  if (start < 0) start = t.indexOf("車両重量");
  if (start < 0) return null;
  const end0 = t.indexOf("総排気量", start);
  const end = end0 > start ? end0 : Math.min(t.length, start + 760);
  const values = numbers(t.slice(start, end));

  for (let i = 0; i + 4 < values.length; i += 1) {
    const [vehicleWeight, grossWeight, length, width, height] = values.slice(i, i + 5);
    if (
      vehicleWeight >= 300 && vehicleWeight <= 50000 &&
      grossWeight >= vehicleWeight && grossWeight <= 80000 &&
      length >= 200 && length <= 3000 &&
      width >= 100 && width <= 350 &&
      height >= 100 && height <= 600
    ) {
      return {
        vehicleWeightKg: String(vehicleWeight),
        grossVehicleWeightKg: String(grossWeight),
        lengthCm: String(length),
        widthCm: String(width),
        heightCm: String(height),
      };
    }
  }
  return null;
}

function modelFamily() {
  const raw = detailInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "";
  const value = compact(raw);
  const tail = value.includes("-") ? value.split("-").pop() : value;
  return /^[A-Z0-9]{3,8}$/.test(tail || "") ? tail : "";
}

function normalizeChassisCandidate(raw = "") {
  const match = compact(raw).match(/([A-Z0-9]{3,9})-([0-9OQI|]{5,9})/);
  if (!match) return "";
  const prefix = match[1];
  const suffix = match[2].replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
  if (!/[A-Z]/.test(prefix) || !/\d/.test(prefix) || !/^\d{5,9}$/.test(suffix)) return "";
  return `${prefix}-${suffix}`;
}

function chassisFromSources(sources) {
  const family = modelFamily();
  if (!family) return null;
  const canonicalFamily = canonicalCode(family);
  const candidates = new Map();

  for (const source of sources) {
    const text = globalOcrText(source.text) || source.text;
    for (const match of text.toUpperCase().matchAll(/[A-Z0-9]{3,9}\s*[-‐‑‒–—―ー−]\s*[0-9OQI|]{5,9}/g)) {
      const value = normalizeChassisCandidate(match[0]);
      if (!value) continue;
      const [prefix] = value.split("-");
      const cp = canonicalCode(prefix);
      let familyScore = 0;
      if (cp === canonicalFamily) familyScore = 3;
      else if (prefix.length === family.length + 1 && (
        canonicalCode(prefix.slice(1)) === canonicalFamily ||
        canonicalCode(prefix.slice(0, -1)) === canonicalFamily
      )) familyScore = 2;
      if (!familyScore) continue;

      const refined = familyScore === 3 ? `${family}-${value.split("-")[1]}` :
        `${family}-${value.split("-")[1]}`;
      const item = candidates.get(refined) || { value: refined, sources: new Set(), score: 0 };
      item.sources.add(source.id);
      item.score += familyScore;
      candidates.set(refined, item);
    }
  }

  const ranked = [...candidates.values()].sort((a, b) =>
    (b.sources.size * 4 + b.score) - (a.sources.size * 4 + a.score)
  );
  const best = ranked[0];
  if (!best) return null;
  // A direct model-family match is strong enough to rescue one OCR source; if the
  // prefix needed trimming, require support from at least two diagnostic sources.
  if (best.sources.size < 2 && best.score < 3) return null;
  return { value: best.value, support: best.sources.size, score: best.score };
}

function parseRegistration(text = "") {
  const cleaned = norm(text);
  const pattern = /([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9OQDGIL|SZB]{3})\s*([ぁ-ん])\s*([0-9OQDGIL|SZB]{1,4})/g;
  const out = [];
  for (const match of cleaned.matchAll(pattern)) {
    const region = normalizeJapanesePlateRegion(match[1]);
    const klass = numericGroup(match[2]);
    const serial = numericGroup(match[4]);
    if (!region || klass.length !== 3 || serial.length < 1 || serial.length > 4) continue;
    out.push(`${region} ${klass} ${match[3]} ${serial}`);
  }
  return out;
}

function registrationFromSources(sources) {
  const groups = new Map();
  for (const source of sources) {
    const text = globalOcrText(source.text) || source.text;
    for (const value of parseRegistration(text)) {
      const item = groups.get(value) || { value, sources: new Set() };
      item.sources.add(source.id);
      groups.set(value, item);
    }
  }
  const ranked = [...groups.values()].sort((a, b) => b.sources.size - a.sources.size);
  return ranked[0]?.sources.size >= 2 ? ranked[0] : null;
}

function engineCandidates(sourceText = "") {
  const text = norm(sourceText).toUpperCase();
  const model = compact(detailInput("型式")?.value || "");
  const out = [];
  for (const marker of ["原動機の型式", "原動機型式"]) {
    let from = 0;
    while (true) {
      const index = text.indexOf(marker, from);
      if (index < 0) break;
      const context = text.slice(index, index + 240).replace(/\s+/g, "");
      for (const match of context.matchAll(/[A-Z0-9]{2,7}-[A-Z0-9]{2,7}/g)) {
        const value = match[0];
        if (!/[A-Z]/.test(value) || !/\d/.test(value)) continue;
        if (model && (value === model || model.endsWith(value))) continue;
        out.push(value);
      }
      from = index + marker.length;
    }
  }
  return out;
}

function engineFromSources(sources) {
  const exact = new Map();
  for (const source of sources) {
    for (const value of engineCandidates(source.text)) {
      const item = exact.get(value) || { value, sources: new Set(), canonical: canonicalCode(value) };
      item.sources.add(source.id);
      exact.set(value, item);
    }
  }
  const ranked = [...exact.values()].sort((a, b) => b.sources.size - a.sources.size);
  if (!ranked.length || ranked[0].sources.size < 2) return null;
  if (ranked[1] && ranked[1].sources.size === ranked[0].sources.size && ranked[1].canonical === ranked[0].canonical) {
    return null;
  }
  return ranked[0];
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let details = document.getElementById("certificate-layout-consolidation-v7-debug");
  if (!details) {
    details = document.createElement("details");
    details.id = "certificate-layout-consolidation-v7-debug";
    details.style.marginTop = "12px";
    details.style.padding = "12px";
    details.style.border = "1px solid #cfd8e6";
    details.style.borderRadius = "12px";
    details.innerHTML = '<summary style="font-weight:800">共通OCR 最終統合 v7（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(details);
  }
  const pre = details.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

export default function CertificateLayoutConsolidationV7() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let stopped = false;
    let lastKey = "";

    const run = () => {
      if (stopped) return;
      const sources = debugSources();
      if (!sources.length) return;

      const globalTexts = sources.map(source => globalOcrText(source.text)).filter(Boolean);
      const dimensionCandidates = globalTexts.map(dimensionRow).filter(Boolean);
      const dimensions = dimensionCandidates[0] || null;
      const chassis = chassisFromSources(sources);
      const registration = registrationFromSources(sources);
      const engine = engineFromSources(sources);

      const key = JSON.stringify({ dimensions, chassis: chassis?.value || "", registration: registration?.value || "", engine: engine?.value || "" });
      if (key === lastKey) return;
      lastKey = key;

      const patch = {};
      const lines = [];

      if (dimensions) {
        Object.assign(patch, dimensions);
        lines.push(`重量寸法5値: ${dimensions.vehicleWeightKg} / ${dimensions.grossVehicleWeightKg} / ${dimensions.lengthCm} / ${dimensions.widthCm} / ${dimensions.heightCm} → 一括整合`);
      } else {
        lines.push("重量寸法5値: 全体OCRから安全な5値セットを確定できず");
      }

      if (registration) {
        patch.registrationNumber = registration.value;
        lines.push(`登録番号: ${registration.value} / 独立診断ソース support=${registration.sources.size}`);
      } else {
        lines.push("登録番号: 複数診断ソースの一致なし → 既存判定を維持");
      }

      if (chassis) {
        patch.chassisNumber = chassis.value;
        lines.push(`車台番号: ${chassis.value} / 型式車系整合 support=${chassis.support}`);
      } else {
        lines.push("車台番号: 型式車系と整合する候補を確定できず → 保留");
      }

      if (engine) {
        patch.engineModel = engine.value;
        lines.push(`原動機型式: ${engine.value} / 完全コード複数ソース一致 support=${engine.sources.size}`);
      } else {
        lines.push("原動機型式: 完全コードの複数ソース一致なし → 既存判定を維持");
      }

      if (Object.keys(patch).length) {
        window.__vehicleCertificateLayoutV7Patch = patch;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
        const map = {
          vehicleWeightKg: "車両重量 kg",
          grossVehicleWeightKg: "車両総重量 kg",
          lengthCm: "長さ cm",
          widthCm: "幅 cm",
          heightCm: "高さ cm",
          registrationNumber: "自動車登録番号又は車両番号",
          chassisNumber: "車台番号",
          engineModel: "原動機の型式",
        };
        for (const [keyName, label] of Object.entries(map)) {
          if (patch[keyName] == null) continue;
          setReactInputValue(detailInput(label), String(patch[keyName]));
        }
      }
      showDebug(lines);
    };

    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(run, 600);
    run();
    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
