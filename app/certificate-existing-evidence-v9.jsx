"use client";

import { useEffect } from "react";

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/\r/g, "")
  .replace(/[\t\u3000]+/g, " ")
  .replace(/ {2,}/g, " ")
  .trim();

const compact = (value = "") => norm(value).toUpperCase().replace(/\s+/g, "");

function canonical(value = "") {
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

function setInput(input, value) {
  if (!(input instanceof HTMLInputElement) || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function diagnosticBlocks() {
  return [...document.querySelectorAll("details pre")]
    .filter(node => node.closest("#certificate-existing-evidence-v9-debug") == null)
    .map(node => node.textContent || "")
    .filter(Boolean);
}

function normalizeChassis(raw = "", model = "") {
  const text = compact(raw).replace(/[‐‑‒–—―ー−]/g, "-");
  const match = text.match(/([A-Z0-9]{2,11})-([0-9OQDI|!]{4,10})/);
  if (!match) return "";

  let prefix = match[1];
  const suffix = match[2]
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1");
  if (!/[A-Z]/.test(prefix) || !/\d/.test(prefix) || !/^\d{4,10}$/.test(suffix)) return "";

  const modelCore = compact(model).split("-").pop() || "";
  if (!modelCore) return "";
  const same = candidate => candidate.length === modelCore.length && canonical(candidate) === canonical(modelCore);

  if (same(prefix)) prefix = modelCore;
  else if (prefix.length === modelCore.length + 1 && same(prefix.slice(1))) prefix = modelCore;
  else if (prefix.length === modelCore.length + 1 && same(prefix.slice(0, -1))) prefix = modelCore;
  else return "";

  return `${prefix}-${suffix}`;
}

function findChassis(blocks, model) {
  const counts = new Map();
  for (const block of blocks) {
    const views = [norm(block).toUpperCase(), compact(block)];
    const seenInBlock = new Set();
    for (const view of views) {
      const matches = view.match(/[A-Z0-9]{2,11}\s*[-‐‑‒–—―ー−]\s*(?:[0-9OQDI|!]\s*){4,10}/g) || [];
      for (const raw of matches) {
        const value = normalizeChassis(raw, model);
        if (value) seenInBlock.add(value);
      }
    }
    for (const value of seenInBlock) counts.set(value, (counts.get(value) || 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { value: "", support: 0 };
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1] && ranked[0][0] !== ranked[1][0]) {
    return { value: "", support: ranked[0][1] };
  }
  return { value: ranked[0][0], support: ranked[0][1] };
}

const LEGAL_ONLY = /^(株式会社|有限会社|合同会社)$/;

function cleanCompanyCandidate(value = "") {
  let text = norm(value)
    .replace(/^[|｜:：・\-_=\s]+/, "")
    .replace(/[|｜]+$/g, "")
    .trim();
  const start = text.search(/株式会社|有限会社|合同会社/);
  if (start < 0) return "";
  text = text.slice(start).trim();
  if (LEGAL_ONLY.test(text)) return "";
  if (text.length < 6 || text.length > 70) return "";
  if (!/(株式会社|有限会社|合同会社).{2,}/.test(text)) return "";
  return text;
}

function findUserCompany(blocks) {
  const candidates = [];
  for (const block of blocks) {
    const text = norm(block);
    const labelMatch = text.match(/使用者.{0,5}(氏名|名称).{0,5}(名称)?/);
    if (!labelMatch || typeof labelMatch.index !== "number") continue;
    const start = labelMatch.index + labelMatch[0].length;
    let windowText = text.slice(start, start + 260);
    const stop = windowText.search(/使用者.{0,4}住所|所有者|使用の本拠/);
    if (stop >= 0) windowText = windowText.slice(0, stop);

    for (const line of windowText.split("\n")) {
      const value = cleanCompanyCandidate(line);
      if (!value) continue;
      const useful = (value.match(/[一-龠々ぁ-んァ-ヶA-Za-z0-9]/g) || []).length;
      const noise = (value.match(/[^一-龠々ぁ-んァ-ヶA-Za-z0-9株式会社有限合同会社 \-・]/g) || []).length;
      candidates.push({ value, score: useful - noise * 2 + Math.min(12, value.length / 3) });
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
  if (!candidates.length) return "";
  const best = candidates[0];
  const second = candidates[1];
  if (second && Math.abs(best.score - second.score) < 1 && compact(best.value) !== compact(second.value)) return "";
  return best.value;
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById("certificate-existing-evidence-v9-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-existing-evidence-v9-debug";
    box.open = true;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #cfd8e6";
    box.style.borderRadius = "12px";
    box.innerHTML = '<summary style="font-weight:800">既存OCR再統合 v9（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

export default function CertificateExistingEvidenceV9() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let stopped = false;
    let lastKey = "";

    const run = () => {
      if (stopped) return;
      const blocks = diagnosticBlocks();
      if (!blocks.length) return;

      const model = fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "";
      const chassis = findChassis(blocks, model);
      const userCompany = findUserCompany(blocks);
      const key = `${model}|${chassis.value}|${chassis.support}|${userCompany}`;

      const chassisInput = fieldInput("車台番号");
      if (chassis.value && chassisInput) setInput(chassisInput, chassis.value);

      const userInput = fieldInput("使用者の氏名又は名称");
      if (userInput) {
        if (userCompany) setInput(userInput, userCompany);
        else if (LEGAL_ONLY.test(norm(userInput.value))) setInput(userInput, "");
      }

      if (key !== lastKey) {
        lastKey = key;
        showDebug([
          `車台番号: ${chassis.value ? `${chassis.value} / 既存OCR支持=${chassis.support}` : "型式車系と整合する候補なし → 空欄維持"}`,
          `使用者名: ${userCompany || "使用者ラベル近傍に安全な完全候補なし → 法人格だけなら空欄"}`,
          "追加OCR: なし（既存診断文字列のみ再利用）",
        ]);
      }
    };

    const observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = setInterval(run, 650);
    run();

    return () => {
      stopped = true;
      observer.disconnect();
      clearInterval(timer);
    };
  }, []);

  return null;
}
