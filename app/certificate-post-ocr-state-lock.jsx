"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function visible(node) {
  if (!(node instanceof HTMLElement)) return false;
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function sections(title) {
  return Array.from(document.querySelectorAll("section.card")).filter((s) =>
    s.querySelector("h2")?.textContent?.includes(title)
  );
}

function bestSection(title) {
  const all = sections(title);
  return all.find((s) => visible(s)) || all[all.length - 1] || null;
}

function detailInput(labelText) {
  const s = bestSection("車検証読み取り情報");
  if (!s) return null;
  const candidates = [];
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const title = compact(label.querySelector("span")?.textContent || "");
    if (title !== compact(labelText)) continue;
    const input = label.querySelector("input");
    if (input) candidates.push(input);
  }
  return candidates.find((x) => visible(x)) || candidates[candidates.length - 1] || null;
}

function basicFirstInput() {
  const s = bestSection("基本情報");
  if (!s) return null;
  const candidates = [];
  for (const label of Array.from(s.querySelectorAll("label"))) {
    if (!compact(label.textContent || "").startsWith("初度登録")) continue;
    const input = label.querySelector("input");
    if (input) candidates.push(input);
  }
  return candidates.find((x) => visible(x)) || candidates[candidates.length - 1] || null;
}

function reactProps(el) {
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? el[key] : null;
}

function forceVisibleReactInput(el, value) {
  if (!(el instanceof HTMLInputElement) || !value) return false;

  const props = reactProps(el);
  if (typeof props?.onChange === "function") {
    props.onChange({
      target: { value },
      currentTarget: { value },
      preventDefault() {},
      stopPropagation() {},
      nativeEvent: new Event("input", { bubbles: true }),
    });
    return true;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const before = el.value;
  if (setter) setter.call(el, value);
  else el.value = value;
  if (el._valueTracker) el._valueTracker.setValue(before);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function targetedResult() {
  const all = Array.from(document.querySelectorAll("#certificate-authoritative-v2-status pre"));
  const pre = all.find((x) => visible(x.closest("details"))) || all[all.length - 1];
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

async function applyVisibleTarget(target) {
  // 同じvehicle stateを使う項目は依存関係順に入れる。
  if (target.firstRegistration) {
    forceVisibleReactInput(detailInput("初度登録年月"), target.firstRegistration);
    await sleep(80);
  }
  if (target.inspectionExpiry) {
    forceVisibleReactInput(detailInput("有効期間の満了する日"), target.inspectionExpiry);
    await sleep(80);
  }
  if (target.registrationDate) {
    forceVisibleReactInput(detailInput("登録年月日／交付年月日"), target.registrationDate);
    await sleep(80);
  }
  if (target.bodyShape) {
    forceVisibleReactInput(detailInput("車体の形状"), target.bodyShape);
  }
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
        showStatus({}, liveValues(), "メインOCR開始待ち");

        // captureイベントはReact onChangeより先なので、必ずprogressが一度出るまで待つ。
        let sawBusy = false;
        for (let i = 0; i < 360 && !dead && id === scan; i += 1) {
          const busy = Boolean(document.querySelector(".progress"));
          if (busy) sawBusy = true;
          if (sawBusy && !busy) break;
          await sleep(250);
        }
        if (dead || id !== scan || !sawBusy) return;

        // Reactの最終setVehicleと描画が完全に落ち着くまで追加で待つ。
        await sleep(1200);
        if (dead || id !== scan) return;
        while (document.querySelector(".progress") && !dead && id === scan) await sleep(250);

        // 専用OCRとQRの正解値を待つ。
        let targeted = targetedResult();
        let qr = window.__vehicleCertificateQrPriority || null;
        for (let i = 0; i < 160 && !dead && id === scan; i += 1) {
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
        let corrections = 0;

        // 一致してもすぐ終了せず、最低10秒は実際の表示欄を監視する。
        for (let i = 0; i < 40 && !dead && id === scan; i += 1) {
          let live = liveValues();
          if (!matches(target, live)) {
            stable = 0;
            corrections += 1;
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: target }));
            await applyVisibleTarget(target);
            await sleep(350);
            live = liveValues();
            showStatus(target, live, `実表示を再確定中 (${corrections})`);
          } else {
            stable += 1;
            showStatus(target, live, `実表示一致を監視中 ${stable}/20`);
          }
          await sleep(500);
        }

        const finalLive = liveValues();
        if (!matches(target, finalLive)) {
          window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: target }));
          await applyVisibleTarget(target);
          await sleep(500);
        }
        const verified = liveValues();
        showStatus(target, verified, matches(target, verified) ? "実表示まで反映完了" : "実表示反映失敗");
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
