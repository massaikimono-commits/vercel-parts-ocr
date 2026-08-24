"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const WATCH_KEYS = ["registrationDate", "firstRegistration", "inspectionExpiry", "bodyShape"];
const LABELS = {
  registrationDate: "登録年月日／交付年月日",
  firstRegistration: "初度登録年月",
  inspectionExpiry: "有効期間の満了する日",
  bodyShape: "車体の形状",
};

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function detailInput(labelText) {
  const section = Array.from(document.querySelectorAll("section.card")).find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!section) return null;
  for (const label of section.querySelectorAll("label")) {
    const title = (label.querySelector("span")?.textContent || "").trim();
    if (title === labelText) return label.querySelector("input") || null;
  }
  return null;
}

function detailValue(labelText) {
  return detailInput(labelText)?.value || "";
}

function reactFiber(node) {
  if (!node) return null;
  const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
  return key ? node[key] : null;
}

function looksLikeVehicleState(value) {
  return !!value && typeof value === "object" &&
    typeof value.registration === "string" &&
    typeof value.firstRegistration === "string" &&
    value.certificate && typeof value.certificate === "object";
}

function inspectHooks(fiber) {
  for (const candidate of [fiber, fiber?.alternate]) {
    if (!candidate) continue;
    let hook = candidate.memoizedState;
    for (let i = 0; hook && i < 60; i += 1, hook = hook.next) {
      if (looksLikeVehicleState(hook.memoizedState) && typeof hook.queue?.dispatch === "function") {
        return { hook, fiber: candidate };
      }
    }
  }
  return null;
}

function findVehicleStateHook() {
  const anchor = detailInput(LABELS.firstRegistration) || detailInput(LABELS.inspectionExpiry) || detailInput(LABELS.registrationDate);
  let fiber = reactFiber(anchor);
  for (let depth = 0; fiber && depth < 80; depth += 1, fiber = fiber.return) {
    const hit = inspectHooks(fiber);
    if (hit) return hit;
  }
  return null;
}

function mergeVehicle(prev, patch) {
  if (!looksLikeVehicleState(prev)) return prev;
  const certificate = { ...prev.certificate };
  for (const [key, value] of Object.entries(patch || {})) {
    if (typeof value === "string" && value.trim()) certificate[key] = value.trim();
  }
  const firstRegistration = certificate.firstRegistration || prev.firstRegistration;
  return {
    ...prev,
    certificate,
    firstRegistration,
    model: certificate.model || prev.model,
    weight: certificate.vehicleWeightKg || prev.weight,
  };
}

function dispatchToOwningState(patch) {
  const found = findVehicleStateHook();
  if (!found) return { ok: false, reason: "vehicle state hook未検出" };
  try {
    found.hook.queue.dispatch((prev) => mergeVehicle(prev, patch));
    return { ok: true, reason: "vehicle useStateへ直接dispatch" };
  } catch (error) {
    console.warn("certificate direct state dispatch failed", error);
    return { ok: false, reason: String(error?.message || error) };
  }
}

function showStatus(buffered, state, mismatches = [], dispatchCount = 0, hookState = "") {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-post-ocr-replay-status");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-post-ocr-replay-status";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">OCR後state安定化（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (!pre) return;
  const lines = [`状態: ${state}`];
  for (const key of WATCH_KEYS) {
    const target = buffered[key] || "未取得";
    const live = detailValue(LABELS[key]);
    lines.push(`${LABELS[key]} target=${target} live=${live || "空欄"}`);
  }
  if (mismatches.length) lines.push(`再同期対象: ${mismatches.join(", ")}`);
  lines.push(`v3 state直接dispatch: ${dispatchCount}回`);
  if (hookState) lines.push(`state hook: ${hookState}`);
  pre.textContent = lines.join("\n");
}

export default function CertificatePostOcrAuthoritativeReplay() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let buffered = {};
    let activeUntil = 0;
    let dispatchCount = 0;
    let lastDispatchAt = 0;
    let lastHookState = "";

    const reset = () => {
      buffered = {};
      activeUntil = Date.now() + 90000;
      dispatchCount = 0;
      lastDispatchAt = 0;
      lastHookState = "";
      showStatus(buffered, "新しい読み取り待ち", [], dispatchCount, lastHookState);
    };

    const onFileChange = (event) => {
      if (isCertificateFileInput(event.target)) reset();
    };

    const onAuthoritative = (event) => {
      const detail = event?.detail;
      if (!detail || typeof detail !== "object") return;
      for (const [key, value] of Object.entries(detail)) {
        if (typeof value === "string" && value.trim()) buffered[key] = value.trim();
      }
      activeUntil = Math.max(activeUntil, Date.now() + 45000);
    };

    const mismatches = () => WATCH_KEYS.filter((key) => {
      const target = buffered[key];
      return target && detailValue(LABELS[key]) !== target;
    });

    const poll = () => {
      const qr = window.__vehicleCertificateQrPriority;
      if (qr && typeof qr === "object") {
        for (const key of ["firstRegistration", "inspectionExpiry"]) {
          if (typeof qr[key] === "string" && qr[key].trim()) buffered[key] = qr[key].trim();
        }
      }

      if (!Object.keys(buffered).length) return;
      if (!activeUntil) activeUntil = Date.now() + 45000;

      const running = !!document.querySelector(".progress");
      const bad = mismatches();
      if (running) {
        showStatus(buffered, "本体OCR中・確定値保持", bad, dispatchCount, lastHookState);
        return;
      }

      if (bad.length && Date.now() < activeUntil && Date.now() - lastDispatchAt >= 300) {
        const patch = {};
        for (const key of bad) patch[key] = buffered[key];
        const result = dispatchToOwningState(patch);
        lastHookState = result.reason;
        if (result.ok) dispatchCount += 1;
        lastDispatchAt = Date.now();
      }

      const after = mismatches();
      if (!after.length) {
        showStatus(buffered, "実表示まで一致", [], dispatchCount, lastHookState);
      } else if (Date.now() >= activeUntil) {
        showStatus(buffered, "直接state更新後も不一致", after, dispatchCount, lastHookState);
      } else {
        showStatus(buffered, "v3本体stateを直接再同期中", after, dispatchCount, lastHookState);
      }
    };

    document.addEventListener("change", onFileChange, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative);
    const timer = window.setInterval(poll, 180);
    poll();

    return () => {
      document.removeEventListener("change", onFileChange, true);
      window.removeEventListener(AUTH_EVENT, onAuthoritative);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
