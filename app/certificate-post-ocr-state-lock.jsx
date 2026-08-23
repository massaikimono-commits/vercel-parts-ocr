"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function section(title) {
  return Array.from(document.querySelectorAll("section.card")).find((s) =>
    s.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function detailInput(labelText) {
  const s = section("車検証読み取り情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const title = compact(label.querySelector("span")?.textContent || "");
    if (title === compact(labelText)) return label.querySelector("input");
  }
  return null;
}

function basicFirstInput() {
  const s = section("基本情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    if (compact(label.textContent || "").startsWith("初度登録")) return label.querySelector("input");
  }
  return null;
}

function targetedResult() {
  const pre = document.querySelector("#certificate-authoritative-v2-status pre");
  const text = pre?.textContent || "";
  const date = text.match(/登録年月日:\s*([^\n]+)/)?.[1]?.trim() || "";
  const body = text.match(/車体形状:\s*([^\n]+)/)?.[1]?.trim() || "";
  return {
    ready: /本体stateへ反映完了|候補なし/.test(text),
    registrationDate: date === "未取得" ? "" : date,
    bodyShape: body === "未取得" ? "" : body,
  };
}

function liveValues() {
  return {
    registrationDate: detailInput("登録年月日／交付年月日")?.value || "",
    firstRegistration: detailInput("初度登録年月")?.value || "",
    basicFirstRegistration: basicFirstInput()?.value || "",
    inspectionExpiry: detailInput("有効期間の満了する日")?.value || "",
    bodyShape: detailInput("車体の形状")?.value || "",
  };
}

function showStatus(target, live, state) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-post-ocr-lock-status");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-post-ocr-lock-status";
    box.open = true;
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">最終stateロック（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (!pre) return;
  pre.textContent = [
    `状態: ${state}`,
    `登録年月日 target=${target.registrationDate || "-"} live=${live.registrationDate}`,
    `初度登録 target=${target.firstRegistration || "-"} live=${live.firstRegistration}`,
    `基本初度 target=${target.firstRegistration || "-"} live=${live.basicFirstRegistration}`,
    `有効期限 target=${target.inspectionExpiry || "-"} live=${live.inspectionExpiry}`,
    `車体形状 target=${target.bodyShape || "-"} live=${live.bodyShape}`,
  ].join("\n");
}

function matches(target, live) {
  const checks = [];
  if (target.registrationDate) checks.push(live.registrationDate === target.registrationDate);
  if (target.firstRegistration) {
    checks.push(live.firstRegistration === target.firstRegistration);
    checks.push(live.basicFirstRegistration === target.firstRegistration);
  }
  if (target.inspectionExpiry) checks.push(live.inspectionExpiry === target.inspectionExpiry);
  if (target.bodyShape) checks.push(live.bodyShape === target.bodyShape);
  return checks.length > 0 && checks.every(Boolean);
}

export default function CertificatePostOcrStateLock() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let scan = 0;

    const onChange = (event) => {
      if (!isCertificateInput(event.target)) return;
      const id = ++scan;

      void (async () => {
        // captureイベントはReactのread()より先に来るので、まずOCR開始を待つ。
        await sleep(250);
        let sawBusy = false;
        for (let i = 0; i < 260 && !dead && id === scan; i += 1) {
          const busy = Boolean(document.querySelector(".progress"));
          if (busy) sawBusy = true;
          if (sawBusy && !busy) break;
          if (!sawBusy && i > 24) break;
          await sleep(250);
        }
        if (dead || id !== scan) return;

        // 専用OCRとQRの結果を待つ。両方そろったら一度にstateへ入れる。
        let targeted = targetedResult();
        let qr = window.__vehicleCertificateQrPriority || null;
        for (let i = 0; i < 100 && !dead && id === scan; i += 1) {
          targeted = targetedResult();
          qr = window.__vehicleCertificateQrPriority || null;
          if (targeted.ready && qr?.firstRegistration && qr?.inspectionExpiry) break;
          await sleep(250);
        }
        if (dead || id !== scan) return;

        const target = {
          registrationDate: targeted.registrationDate || "",
          bodyShape: targeted.bodyShape || "",
          firstRegistration: qr?.firstRegistration || "",
          inspectionExpiry: qr?.inspectionExpiry || "",
          model: qr?.model || "",
          frontFrontAxleWeightKg: qr?.frontFrontAxleWeightKg || "",
          frontRearAxleWeightKg: qr?.frontRearAxleWeightKg || "",
          rearFrontAxleWeightKg: qr?.rearFrontAxleWeightKg || "",
          rearRearAxleWeightKg: qr?.rearRearAxleWeightKg || "",
          fuel: qr?.fuel || "",
        };

        let stable = 0;
        for (let i = 0; i < 20 && !dead && id === scan; i += 1) {
          window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: target }));
          await sleep(450);
          const live = liveValues();
          if (matches(target, live)) stable += 1;
          else stable = 0;
          showStatus(target, live, stable ? `一致確認 ${stable}/3` : "再反映中");
          if (stable >= 3) {
            showStatus(target, live, "反映完了");
            return;
          }
        }
        showStatus(target, liveValues(), "反映失敗");
      })().catch((error) => {
        showStatus({}, liveValues(), `エラー: ${error?.message || error}`);
      });
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
