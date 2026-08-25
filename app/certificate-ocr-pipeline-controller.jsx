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
  const text = norm(raw);
  return /[ぁ-んァ-ヶ一-龠]{1,8}\s*\d{3}\s*[ぁ-ん]\s*\d{1,4}/.test(text);
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

  const coreReady = Object.values(checks).every(Boolean);
  return { coreReady, checks };
}

function hasBaseSignal() {
  return Boolean(
    value("記録事項番号") ||
    value("型式") ||
    value("有効期間の満了する日") ||
    value("車両重量 kg")
  );
}

function removeSyntheticV6Debug() {
  const box = document.getElementById("certificate-layout-recognition-v6-debug");
  if (box?.dataset?.pipelineSynthetic === "true") box.remove();
}

function showSkippedV6Debug(checks) {
  const host = section("車検証から読み取る");
  if (!host) return;
  removeSyntheticV6Debug();
  const box = document.createElement("details");
  box.id = "certificate-layout-recognition-v6-debug";
  box.dataset.pipelineSynthetic = "true";
  box.style.marginTop = "12px";
  box.style.padding = "12px";
  box.style.border = "1px solid #86b79b";
  box.style.borderRadius = "12px";
  box.style.background = "#f0fdf4";
  box.innerHTML = '<summary style="font-weight:800">共通罫線セルOCR v6（高速判定）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
  const pre = box.querySelector("pre");
  if (pre) {
    pre.textContent = [
      "状態: 共通罫線セルOCR v6 完了",
      "高速経路: 通常OCR＋QRで主要項目が整合したため、重複する全文OCR/セルOCRを省略",
      `登録番号=${checks.registration ? "OK" : "NG"} / 登録日=${checks.registrationDate ? "OK" : "NG"} / 初度=${checks.firstRegistration ? "OK" : "NG"} / 満了=${checks.expiry ? "OK" : "NG"}`,
      `重量=${checks.vehicleWeight ? "OK" : "NG"} / 総重量=${checks.grossWeight ? "OK" : "NG"} / 長さ=${checks.length ? "OK" : "NG"} / 幅=${checks.width ? "OK" : "NG"} / 高さ=${checks.height ? "OK" : "NG"}`,
      "未確定の車台番号・使用者名・原動機型式は後段の弱セル再読取へ渡します。",
    ].join("\n");
  }
  host.appendChild(box);
}

function v6Finished() {
  const pre = document.querySelector("#certificate-layout-recognition-v6-debug pre");
  const text = pre?.textContent || "";
  return /共通罫線セルOCR v6 (?:完了|エラー)/.test(text);
}

export default function CertificateOcrPipelineController() {
  const [heavyV6, setHeavyV6] = useState(false);
  const [postReady, setPostReady] = useState(false);
  const inputRef = useRef(null);
  const generationRef = useRef(0);
  const replayedRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let stopped = false;

    const waitForBaseAndDecide = async generation => {
      let stableNoProgress = 0;
      const deadline = Date.now() + 60000;
      while (!stopped && generation === generationRef.current && Date.now() < deadline) {
        const busy = Boolean(document.querySelector(".progress"));
        if (!busy && hasBaseSignal()) stableNoProgress += 1;
        else stableNoProgress = 0;
        if (stableNoProgress >= 3) break;
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      if (stopped || generation !== generationRef.current) return;

      // Give QR/state reconciliation one final short window before deciding whether the
      // expensive generic v6 OCR is actually necessary.
      await new Promise(resolve => setTimeout(resolve, 650));
      if (stopped || generation !== generationRef.current) return;

      const snapshot = stableBaseSnapshot();
      if (snapshot.coreReady) {
        showSkippedV6Debug(snapshot.checks);
        setHeavyV6(false);
        setPostReady(true);
        return;
      }

      removeSyntheticV6Debug();
      replayedRef.current = 0;
      setPostReady(false);
      setHeavyV6(true);
    };

    const onChange = event => {
      if (event.__certificatePipelineReplay) return;
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      inputRef.current = input;
      generationRef.current += 1;
      removeSyntheticV6Debug();
      setHeavyV6(false);
      setPostReady(false);
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
      setPostReady(true);
      // Unmount v6 after this generation finishes so the next real file selection cannot
      // accidentally start the expensive path before the controller makes its decision.
      setHeavyV6(false);
    }, 350);
    return () => window.clearInterval(timer);
  }, [heavyV6]);

  return (
    <>
      <CertificateTargetedCellRecoveryV13 />
      {heavyV6 ? <CertificateLayoutRecognitionV6 /> : null}
      {postReady ? (
        <>
          <CertificateLayoutConsolidationV7 />
          <CertificateEvidenceSafetyV8 />
          <CertificateExistingEvidenceV9 />
        </>
      ) : null}
    </>
  );
}
