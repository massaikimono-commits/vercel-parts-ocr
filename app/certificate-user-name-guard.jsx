"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[\u3000\t\r]+/g, " ")
  .replace(/[_＿]+/g, " ")
  .replace(/ {2,}/g, " ")
  .trim();

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

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return Boolean(card?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
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

function cleanCandidate(value = "") {
  let text = norm(value)
    .replace(/[|｜]\s*\[[0-9][^\]]*\].*$/g, "")
    .replace(/\[[0-9][^\]]*\].*$/g, "")
    .replace(/[|｜]+$/g, "")
    .trim();

  text = text
    .replace(/^(株式会社|有限会社|合同会社)\s*[-=:：|｜]+\s*/g, "$1 ")
    .replace(/ {2,}/g, " ")
    .trim();
  return text;
}

function candidateScore(value = "") {
  const text = cleanCandidate(value);
  if (!text || text.length > 64) return -1;
  if (/^(株式会社|有限会社|合同会社)$/.test(text)) return -1;
  if (/(?:使用者|住所|本拠|車台番号|車両番号|登録年月|交付年月|初度|有効期間|原動機|型式指定|類別区分|燃料|車両重量)/.test(text)) return -1;

  const useful = (text.match(/[一-龠々ぁ-んァ-ヶA-Za-z]/g) || []).length;
  if (useful < 2) return -1;

  let score = Math.min(24, useful);
  if (/^(株式会社|有限会社|合同会社)\s*\S.{1,}/.test(text)) score += 22;
  if (/[一-龠々ぁ-んァ-ヶ]{2,}/.test(text)) score += 6;
  if (/\d{4,}/.test(text)) score -= 8;
  if (/[\[\]{}<>]/.test(text)) score -= 8;
  return score;
}

function showDebug(text) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById("certificate-user-name-guard-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-user-name-guard-debug";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #b9c8dc";
    box.style.borderRadius = "12px";
    box.innerHTML = '<summary style="font-weight:800">使用者名保持ガード（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = text;
}

export default function CertificateUserNameGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let best = "";
    let bestScore = -1;
    let generation = 0;
    let restoring = false;
    let lastSeen = "";

    const remember = (raw, source) => {
      const value = cleanCandidate(raw);
      const score = candidateScore(value);
      if (score < 0) return false;
      if (score > bestScore || (score === bestScore && value.length > best.length)) {
        best = value;
        bestScore = score;
        window.__vehicleCertificateBestUserName = value;
        showDebug(`保持中: ${value}\nscore=${score} / source=${source}\n同じ読取中は、後段の空欄・法人格だけでは消しません。`);
      }
      return true;
    };

    const restoreIfNeeded = () => {
      if (restoring || !best) return;
      const input = fieldInput("使用者の氏名又は名称");
      if (!input) return;
      const current = cleanCandidate(input.value || "");
      const currentScore = candidateScore(current);
      if (currentScore >= bestScore - 2) {
        remember(current, "field");
        return;
      }
      if (current && !/^(株式会社|有限会社|合同会社)$/.test(current) && currentScore >= 0) return;

      restoring = true;
      try {
        setReactInputValue(input, best);
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { userName: best } }));
        showDebug(`復元: ${best}\n理由: 後段処理で「${current || "空欄"}」へ下がったため、同一読取内の高信頼値を維持`);
      } finally {
        restoring = false;
      }
    };

    const onAuthoritative = event => {
      const value = event?.detail?.userName;
      if (typeof value === "string" && value.trim()) remember(value, "authoritative-event");
      window.setTimeout(restoreIfNeeded, 40);
    };

    const onChange = event => {
      if (event.__certificatePipelineReplay || event.__certificateV13Replay) return;
      const target = event.target;
      if (isCertificateInput(target)) {
        generation += 1;
        best = "";
        bestScore = -1;
        lastSeen = "";
        window.__vehicleCertificateBestUserName = "";
        showDebug(`新しい車検証: generation=${generation}\n使用者名の安全な完全候補を監視中`);
        return;
      }
      if (target === fieldInput("使用者の氏名又は名称")) {
        const current = cleanCandidate(target.value || "");
        if (current !== lastSeen) {
          lastSeen = current;
          remember(current, "input-change");
        }
        window.setTimeout(restoreIfNeeded, 30);
      }
    };

    const observer = new MutationObserver(() => {
      const current = cleanCandidate(fieldInput("使用者の氏名又は名称")?.value || "");
      if (current !== lastSeen) {
        lastSeen = current;
        remember(current, "dom-observer");
      }
      restoreIfNeeded();
    });

    window.addEventListener(AUTH_EVENT, onAuthoritative);
    document.addEventListener("change", onChange, true);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["value"] });
    const timer = window.setInterval(restoreIfNeeded, 350);

    return () => {
      window.removeEventListener(AUTH_EVENT, onAuthoritative);
      document.removeEventListener("change", onChange, true);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
