"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー−]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(value = "") {
  return norm(value).toUpperCase().replace(/\s+/g, "");
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

function section(title) {
  return [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function fieldInput(labelText) {
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

function evidenceBlocks() {
  const blocks = [];
  for (const node of document.querySelectorAll("details")) {
    const text = node.textContent || "";
    if (text.trim()) blocks.push(text);
  }
  for (const node of document.querySelectorAll("textarea")) {
    const text = node.value || node.textContent || "";
    if (text.trim()) blocks.push(text);
  }
  return blocks;
}

function modelCore() {
  const raw = fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "";
  const value = compact(raw);
  return value.includes("-") ? value.split("-").pop() : value;
}

function chassisFromEvidence(blocks) {
  const core = modelCore();
  if (!core || core.length < 3) return null;
  const canonicalCore = canonicalCode(core);
  const counts = new Map();

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const text = norm(blocks[blockIndex]).toUpperCase();
    const seenInBlock = new Set();
    for (const match of text.matchAll(/([A-Z0-9]{2,10})\s*[-‐‑‒–—―ー−]\s*([0-9OQI|]{4,10})/g)) {
      const prefix = match[1];
      const suffix = numericGroup(match[2]);
      if (!suffix || suffix.length < 4 || suffix.length > 10) continue;
      if (canonicalCode(prefix) !== canonicalCore) continue;
      const value = `${core}-${suffix}`;
      if (seenInBlock.has(value)) continue;
      seenInBlock.add(value);
      const item = counts.get(value) || { value, blocks: new Set() };
      item.blocks.add(blockIndex);
      counts.set(value, item);
    }
  }

  const ranked = [...counts.values()].sort((a, b) => b.blocks.size - a.blocks.size);
  const best = ranked[0];
  if (!best) return null;
  // 型式の車系と完全整合し、数字連番まで成立するため1診断ソースでも候補にできる。
  // 複数ソースで一致した場合はより強い証拠として表示する。
  return { value: best.value, support: best.blocks.size };
}

function normalizeEraText(value = "") {
  return norm(value)
    .replace(/作\s*和|三\s*和|今\s*和|信\s*和|令\s*[禾口]/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和");
}

function fullDates(text = "") {
  const t = normalizeEraText(text).replace(/\s+/g, "");
  const found = [];
  const re = /(令和|平成|昭和)([0-9OQDGIL|SZB]{1,2})年?([0-9OQDGIL|SZB]{1,2})月?([0-9OQDGIL|SZB]{1,2})[日HＢB己昌曰]?/g;
  for (const match of t.matchAll(re)) {
    const y = Number(numericGroup(match[2]));
    const m = Number(numericGroup(match[3]));
    const d = Number(numericGroup(match[4]));
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) continue;
    found.push({ era: match[1], y, m, d, value: `${match[1]}${y}年${m}月${d}日` });
  }
  return found;
}

function dateSignatureNearRecordLabel(text = "") {
  const t = norm(text);
  const label = t.match(/記録.{0,5}年月[日5]?/);
  if (!label || typeof label.index !== "number") return null;
  const start = label.index + label[0].length;
  const near = t.slice(start, start + 180);

  const unitMatch = near.match(/([0-9OQDGIL|SZB]{1,2})\s*年\s*([0-9OQDGIL|SZB]{1,2})\s*月\s*([0-9OQDGIL|SZB]{1,2})\s*[日HＢB己昌曰]/);
  if (unitMatch) {
    const y = Number(numericGroup(unitMatch[1]));
    const m = Number(numericGroup(unitMatch[2]));
    const d = Number(numericGroup(unitMatch[3]));
    if (y >= 1 && y <= 99 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return [y, m, d];
  }

  // 単位の一部が欠けても、ラベル文字列の後だけを対象にするので
  // 「年月5」の5を年として誤採用しない。
  const groups = (near.match(/[0-9OQDGIL|SZB]{1,3}/g) || [])
    .map(numericGroup)
    .filter(Boolean)
    .map(Number);
  for (let i = 0; i + 2 < groups.length; i += 1) {
    const [y, m, d] = groups.slice(i, i + 3);
    if (y >= 1 && y <= 99 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return [y, m, d];
  }
  return null;
}

function recordDateFromEvidence(blocks) {
  const signatures = [];
  for (const block of blocks) {
    const signature = dateSignatureNearRecordLabel(block);
    if (signature) signatures.push(signature);
  }
  if (!signatures.length) return null;

  const counts = new Map();
  for (const sig of signatures) {
    const key = sig.join("-");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner) return null;
  const [y, m, d] = winner[0].split("-").map(Number);

  const matchingDates = [];
  for (const block of blocks) {
    for (const date of fullDates(block)) {
      if (date.y === y && date.m === m && date.d === d) matchingDates.push(date.value);
    }
  }
  const unique = [...new Set(matchingDates)];
  if (unique.length !== 1) return null;
  return { value: unique[0], support: winner[1] };
}

function validCompanyCandidate(value = "") {
  const t = norm(value).replace(/[|｜]+$/g, "").trim();
  const match = t.match(/^(株式会社|有限会社|合同会社)\s*(.*)$/);
  if (!match) return "";
  const body = match[2].replace(/[ _＿|｜]/g, "").trim();
  if (body.length < 2 || t.length > 70) return "";
  return t;
}

function companyFromEvidence(blocks) {
  for (const block of blocks) {
    const text = norm(block);
    const label = text.match(/使用者.{0,8}(氏名|名称).{0,8}/);
    if (!label || typeof label.index !== "number") continue;
    const after = text.slice(label.index + label[0].length, label.index + label[0].length + 260);
    const lines = after.split("\n").map(line => line.trim()).filter(Boolean);
    for (let i = 0; i < Math.min(lines.length, 5); i += 1) {
      let candidate = validCompanyCandidate(lines[i]);
      if (candidate) return candidate;
      if (/^(株式会社|有限会社|合同会社)$/.test(lines[i]) && lines[i + 1]) {
        candidate = validCompanyCandidate(`${lines[i]} ${lines[i + 1]}`);
        if (candidate) return candidate;
      }
    }
  }
  return "";
}

function engineNeedsSafetyBlank(blocks, current) {
  if (!current) return false;
  if (window.__vehicleCertificateQrPriority?.engineModel) return false;
  const joined = blocks.join("\n");
  if (/原動機型式:\s*完全コードの複数ソース一致なし/.test(joined)) return true;
  const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fallback = new RegExp(`engineModel:\\s*${escaped}\\s*\\/[^\\n]*fallback`, "i");
  return fallback.test(joined);
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let details = document.getElementById("certificate-evidence-safety-v8-debug");
  if (!details) {
    details = document.createElement("details");
    details.id = "certificate-evidence-safety-v8-debug";
    details.style.marginTop = "12px";
    details.style.padding = "12px";
    details.style.border = "1px solid #cfd8e6";
    details.style.borderRadius = "12px";
    details.innerHTML = '<summary style="font-weight:800">最終安全統合 v8（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(details);
  }
  const pre = details.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

export default function CertificateEvidenceSafetyV8() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let lastKey = "";

    const run = () => {
      const blocks = evidenceBlocks();
      if (!blocks.length) return;

      const chassis = chassisFromEvidence(blocks);
      const recordDate = recordDateFromEvidence(blocks);
      const company = companyFromEvidence(blocks);
      const engineInput = fieldInput("原動機の型式");
      const currentEngine = compact(engineInput?.value || "");
      const blankEngine = engineNeedsSafetyBlank(blocks, currentEngine);

      const key = JSON.stringify({
        chassis: chassis?.value || "",
        recordDate: recordDate?.value || "",
        company,
        currentEngine,
        blankEngine,
      });
      if (key === lastKey) return;
      lastKey = key;

      const patch = {};
      const lines = [];

      if (recordDate) {
        patch.recordDate = recordDate.value;
        setReactInputValue(fieldInput("記録年月日"), recordDate.value);
        lines.push(`記録年月日: ${recordDate.value} / 記録ラベル近傍＋完全和暦照合 support=${recordDate.support}`);
      } else {
        lines.push("記録年月日: 安全な照合成立せず → 空欄維持");
      }

      if (chassis) {
        patch.chassisNumber = chassis.value;
        setReactInputValue(fieldInput("車台番号"), chassis.value);
        lines.push(`車台番号: ${chassis.value} / 型式車系＋連番形式 support=${chassis.support}`);
      } else {
        lines.push("車台番号: 型式車系と整合するコード候補なし → 空欄維持");
      }

      const userInput = fieldInput("使用者の氏名又は名称");
      const currentUser = norm(userInput?.value || "");
      if (/^(株式会社|有限会社|合同会社)$/.test(currentUser)) {
        if (company) {
          patch.userName = company;
          setReactInputValue(userInput, company);
          lines.push(`使用者名: 途中切れを破棄し再構成 → ${company}`);
        } else {
          patch.userName = "";
          setReactInputValue(userInput, "");
          lines.push("使用者名: 法人格だけの途中切れを破棄 → 空欄");
        }
      } else {
        lines.push(`使用者名: ${currentUser || "空欄"} / 途中切れなし`);
      }

      if (blankEngine && engineInput) {
        patch.engineModel = "";
        setReactInputValue(engineInput, "");
        lines.push(`原動機型式: ${currentEngine} は独立一致不足のため破棄 → 空欄`);
      } else {
        lines.push(`原動機型式: ${currentEngine || "空欄"} / ${window.__vehicleCertificateQrPriority?.engineModel ? "QR優先" : "既存判定維持"}`);
      }

      if (Object.keys(patch).length) {
        window.__vehicleCertificateEvidenceSafetyV8Patch = patch;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
      }
      showDebug(lines);
    };

    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(run, 700);
    run();
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
