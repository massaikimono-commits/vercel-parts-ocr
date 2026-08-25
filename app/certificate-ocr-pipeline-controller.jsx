"use client";

import { useEffect, useRef, useState } from "react";
import CertificateLayoutRecognitionV6 from "./certificate-layout-recognition-v6";
import CertificateLayoutConsolidationV7 from "./certificate-layout-consolidation-v7";
import CertificateEvidenceSafetyV8 from "./certificate-evidence-safety-v8";
import CertificateExistingEvidenceV9 from "./certificate-existing-evidence-v9";
import CertificateTargetedCellRecoveryV13 from "./certificate-targeted-cell-recovery-v13";

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/[\u3000\t\r]+/g, " ")
  .replace(/ {2,}/g, " ")
  .trim();

const STAGES = {
  v6: { id: "certificate-layout-recognition-v6-debug", title: "共通罫線セルOCR v6（確認用）" },
  v7: { id: "certificate-layout-consolidation-v7-debug", title: "共通OCR 最終統合 v7（確認用）" },
  v8: { id: "certificate-evidence-safety-v8-debug", title: "最終安全統合 v8（確認用）" },
  v9: { id: "certificate-existing-evidence-v9-debug", title: "既存OCR再統合 v9（確認用）" },
  v13: { id: "certificate-targeted-cell-recovery-v13-debug", title: "罫線＋ラベル追従 弱セル再読取 v13（確認用）" },
};

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

function value(label) {
  return norm(fieldInput(label)?.value || "");
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return Boolean(card?.querySelector("h2")?.textContent?.includes("車検証から読み取る"));
}

function asNumber(label) {
  const raw = value(label).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return raw ? Number(raw[0]) : NaN;
}

function validRegistrationNumber(raw) {
  return /[ぁ-んァ-ヶ一-龠]{1,8}\s*\d{3}\s*[ぁ-ん]\s*\d{1,4}/.test(norm(raw));
}

function validEraDate(raw, allowMonthOnly = false) {
  const text = norm(raw).replace(/\s+/g, "");
  if (allowMonthOnly) return /(?:令和|平成|昭和)\d{1,2}年\d{1,2}月/.test(text);
  return /(?:令和|平成|昭和)\d{1,2}年\d{1,2}月\d{1,2}日/.test(text);
}

function stableBaseSnapshot() {
  const registration = value("自動車登録番号又は車両番号");
  const registrationDate = value("登録年月日／交付年月日");
  const firstRegistration = value("初度登録年月");
  const expiry = value("有効期間の満了する日");
  const vehicleWeight = asNumber("車両重量 kg");
  const grossWeight = asNumber("車両総重量 kg");
  const length = asNumber("長さ cm");
  const width = asNumber("幅 cm");
  const height = asNumber("高さ cm");

  const checks = {
    registration: validRegistrationNumber(registration),
    registrationDate: validEraDate(registrationDate),
    firstRegistration: validEraDate(firstRegistration, true),
    expiry: validEraDate(expiry),
    vehicleWeight: Number.isFinite(vehicleWeight) && vehicleWeight >= 100 && vehicleWeight <= 50000,
    grossWeight: Number.isFinite(grossWeight) && grossWeight >= vehicleWeight && grossWeight <= 80000,
    length: Number.isFinite(length) && length >= 200 && length <= 3000,
    width: Number.isFinite(width) && width >= 100 && width <= 300 && (!Number.isFinite(length) || width < length),
    height: Number.isFinite(height) && height >= 100 && height <= 600,
  };

  return {
    checks,
    signature: JSON.stringify({ registration, registrationDate, firstRegistration, expiry, vehicleWeight, grossWeight, length, width, height }),
  };
}

function hasBaseSignal() {
  return Boolean(value("記録事項番号") || value("型式") || value("有効期間の満了する日") || value("車両重量 kg") || value("使用者の氏名又は名称"));
}

function usefulCount(text = "") {
  return (norm(text).match(/[一-龠々ぁ-んァ-ヶA-Za-z0-9]/g) || []).length;
}

function hasQrSignal() {
  const q = window.__vehicleCertificateQrPriority;
  return Boolean(q && typeof q === "object" && Object.values(q).some(Boolean));
}

function ensureStageDebug(stageKey, text, options = {}) {
  const config = STAGES[stageKey];
  const host = section("車検証から読み取る");
  if (!config || !host) return null;
  let box = document.getElementById(config.id);
  if (!box) {
    box = document.createElement("details");
    box.id = config.id;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = options.green ? "1px solid #69a985" : "1px solid #cfd8e6";
    box.style.borderRadius = "12px";
    if (options.green) box.style.background = "#ecfdf5";
    box.innerHTML = `<summary style="font-weight:800">${config.title}</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>`;
    host.appendChild(box);
  }
  if (options.open) box.open = true;
  const pre = box.querySelector("pre");
  if (pre && typeof text === "string") pre.textContent = text;
  if (options.complete === true) box.dataset.pipelineComplete = "true";
  if (options.complete === false) delete box.dataset.pipelineComplete;
  return box;
}

function resetPipelineDebug() {
  ensureStageDebug("v6", "状態: 軽量ベースOCR＋QRを確認して、v6が本当に必要か判定中", { complete: false });
  ensureStageDebug("v7", "状態: v6判定完了待ち", { complete: false });
  ensureStageDebug("v8", "状態: v7起動待ち", { complete: false });
  ensureStageDebug("v9", "状態: v8起動待ち", { complete: false });
  ensureStageDebug("v13", "状態: 軽量統合後、未確定セルだけ再読取します", { complete: false, green: true, open: true });
}

function showSkippedV6Debug(checks, reason) {
  ensureStageDebug("v6", [
    "状態: 共通罫線セルOCR v6 完了",
    `高速経路: ${reason} → 重いv6は省略`,
    `登録番号=${checks.registration ? "OK" : "未確定"} / 登録日=${checks.registrationDate ? "OK" : "未確定"} / 初度=${checks.firstRegistration ? "OK" : "未確定"} / 満了=${checks.expiry ? "OK" : "未確定"}`,
    `重量=${checks.vehicleWeight ? "OK" : "未確定"} / 総重量=${checks.grossWeight ? "OK" : "未確定"} / 長さ=${checks.length ? "OK" : "未確定"} / 幅=${checks.width ? "OK" : "未確定"} / 高さ=${checks.height ? "OK" : "未確定"}`,
    "空欄・弱セルは重い全体再OCRをせずv13へ渡します。",
  ].join("\n"), { complete: true });
}

function v6Finished() {
  const pre = document.querySelector(`#${STAGES.v6.id} pre`);
  return /共通罫線セルOCR v6 (?:完了|エラー)/.test(pre?.textContent || "");
}

export default function CertificateOcrPipelineController() {
  const [heavyV6, setHeavyV6] = useState(false);
  const [postStage, setPostStage] = useState(0);
  const inputRef = useRef(null);
  const generationRef = useRef(0);
  const replayedRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let stopped = false;

    const waitForBaseAndDecide = async generation => {
      const started = Date.now();
      const deadline = started + 6500;

      // Wait mainly for the one-pass base reader, not for every field to become populated.
      while (!stopped && generation === generationRef.current && Date.now() < deadline) {
        if (window.__vehicleCertificateFastBaseDone) break;
        await new Promise(resolve => setTimeout(resolve, 160));
      }
      if (stopped || generation !== generationRef.current) return;

      // Give QR/full-text state bridges a short moment to apply their already-computed evidence.
      const settleUntil = Date.now() + 1100;
      while (!stopped && generation === generationRef.current && Date.now() < settleUntil) {
        await new Promise(resolve => setTimeout(resolve, 140));
      }
      if (stopped || generation !== generationRef.current) return;

      const snapshot = stableBaseSnapshot();
      const text = norm(window.__vehicleCertificateFastBaseText || "");
      const useful = usefulCount(text);
      const baseSignal = hasBaseSignal();
      const qrSignal = hasQrSignal();

      // Heavy v6 is now an emergency fallback only. Missing registration/chassis/date/dimension
      // fields are intentionally passed to the targeted stage instead of re-reading the whole page.
      if (useful >= 150 || baseSignal || qrSignal) {
        showSkippedV6Debug(snapshot.checks, `ベース証拠あり useful=${useful}${qrSignal ? " / QRあり" : ""}`);
        setHeavyV6(false);
        setPostStage(7);
        return;
      }

      ensureStageDebug("v6", "状態: ベースOCRがほぼ空でQRも未取得 → 緊急fallbackとしてv6実行中", { complete: false });
      replayedRef.current = 0;
      setPostStage(0);
      setHeavyV6(true);
    };

    const onChange = event => {
      if (event.__certificatePipelineReplay || event.__certificateV13Replay) return;
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      inputRef.current = input;
      generationRef.current += 1;
      setHeavyV6(false);
      setPostStage(0);
      resetPipelineDebug();
      void waitForBaseAndDecide(generationRef.current);
    };

    document.addEventListener("change", onChange, true);
    return () => {
      stopped = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  useEffect(() => {
    if (!heavyV6 || !inputRef.current) return;
    const generation = generationRef.current;
    const timer = window.setTimeout(() => {
      if (!heavyV6 || generation !== generationRef.current || replayedRef.current === generation) return;
      replayedRef.current = generation;
      const event = new Event("change", { bubbles: true });
      event.__certificatePipelineReplay = true;
      inputRef.current?.dispatchEvent(event);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [heavyV6]);

  useEffect(() => {
    if (!heavyV6) return;
    const timer = window.setInterval(() => {
      if (!v6Finished()) return;
      window.clearInterval(timer);
      const box = document.getElementById(STAGES.v6.id);
      if (box) box.dataset.pipelineComplete = "true";
      setHeavyV6(false);
      setPostStage(7);
    }, 250);
    return () => window.clearInterval(timer);
  }, [heavyV6]);

  // v7/v8/v9 do not run OCR. They only reconcile already available evidence, so keep them fast.
  useEffect(() => {
    if (postStage === 7) {
      ensureStageDebug("v7", "状態: v6判定完了 → v7軽量統合", { complete: false, open: true });
      const timer = window.setTimeout(() => {
        const box = document.getElementById(STAGES.v7.id);
        if (box) box.dataset.pipelineComplete = "true";
        setPostStage(8);
      }, 120);
      return () => window.clearTimeout(timer);
    }
    if (postStage === 8) {
      ensureStageDebug("v8", "状態: v7完了 → v8安全統合", { complete: false, open: true });
      const timer = window.setTimeout(() => {
        const box = document.getElementById(STAGES.v8.id);
        if (box) box.dataset.pipelineComplete = "true";
        setPostStage(9);
      }, 120);
      return () => window.clearTimeout(timer);
    }
    if (postStage === 9) {
      ensureStageDebug("v9", "状態: v8完了 → v9既存証拠再統合", { complete: false, open: true });
      const timer = window.setTimeout(() => {
        const box = document.getElementById(STAGES.v9.id);
        if (box) box.dataset.pipelineComplete = "true";
        ensureStageDebug("v13", "状態: 軽量統合完了 → 未確定セルだけv13へ", { complete: false, green: true, open: true });
        setPostStage(13);
      }, 180);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [postStage]);

  useEffect(() => {
    if (postStage !== 13 || !inputRef.current) return;
    const timer = window.setTimeout(() => {
      const event = new Event("change", { bubbles: true });
      event.__certificateV13Replay = true;
      inputRef.current?.dispatchEvent(event);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [postStage]);

  return (
    <>
      {heavyV6 ? <CertificateLayoutRecognitionV6 /> : null}
      {postStage >= 7 ? <CertificateLayoutConsolidationV7 /> : null}
      {postStage >= 8 ? <CertificateEvidenceSafetyV8 /> : null}
      {postStage >= 9 ? <CertificateExistingEvidenceV9 /> : null}
      {postStage >= 13 ? <CertificateTargetedCellRecoveryV13 /> : null}
    </>
  );
}
