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
    if (title !== labelText) continue;
    return label.querySelector("input") || null;
  }
  return null;
}

function detailValue(labelText) {
  return detailInput(labelText)?.value || "";
}

function reactProps(node) {
  if (!node) return null;
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
  return key ? node[key] : null;
}

function applyThroughReact(labelText, value) {
  const input = detailInput(labelText);
  if (!input || !value) return false;
  const props = reactProps(input);
  if (typeof props?.onChange !== "function") return false;
  try {
    props.onChange({
      target: { value },
      currentTarget: { value },
      type: "change",
      bubbles: true,
      nativeEvent: new Event("change", { bubbles: true }),
      preventDefault() {},
      stopPropagation() {},
    });
    return true;
  } catch (error) {
    console.warn("certificate authoritative React apply failed", labelText, error);
    return false;
  }
}

function showStatus(buffered, state, mismatches = [], direct = []) {
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
  if (direct.length) lines.push(`React直接反映: ${direct.join(", ")}`);
  pre.textContent = lines.join("\n");
}

export default function CertificatePostOcrAuthoritativeReplay() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let scan = 0;
    let sawMainOcr = false;
    let buffered = {};
    let stabilizeUntil = 0;
    let lastSendAt = 0;
    let stableHits = 0;
    let directApplied = [];

    const reset = () => {
      scan += 1;
      sawMainOcr = false;
      buffered = {};
      stabilizeUntil = 0;
      lastSendAt = 0;
      stableHits = 0;
      directApplied = [];
      showStatus(buffered, "新しい読み取り待ち");
    };

    const onFileChange = (event) => {
      if (!isCertificateFileInput(event.target)) return;
      reset();
    };

    const onAuthoritative = (event) => {
      const detail = event?.detail;
      if (!detail || typeof detail !== "object" || detail.__postOcrReplay === true) return;
      for (const [key, value] of Object.entries(detail)) {
        if (typeof value === "string" && value.trim()) buffered[key] = value.trim();
      }
    };

    const send = () => {
      if (!Object.keys(buffered).length) return;
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, {
        detail: { ...buffered, __postOcrReplay: true },
      }));
      lastSendAt = Date.now();
    };

    const checkMismatches = () => {
      const mismatches = [];
      for (const key of WATCH_KEYS) {
        const target = buffered[key];
        if (!target) continue;
        if (detailValue(LABELS[key]) !== target) mismatches.push(key);
      }
      return mismatches;
    };

    const directApply = (mismatches) => {
      const applied = [];
      for (const key of mismatches) {
        const target = buffered[key];
        if (!target) continue;
        if (applyThroughReact(LABELS[key], target)) applied.push(key);
      }
      if (applied.length) directApplied = [...new Set([...directApplied, ...applied])];
      return applied;
    };

    const poll = () => {
      const running = !!document.querySelector(".progress");
      if (running) {
        sawMainOcr = true;
        stabilizeUntil = 0;
        stableHits = 0;
        showStatus(buffered, "本体OCR中", [], directApplied);
        return;
      }

      if (sawMainOcr && !stabilizeUntil) {
        stabilizeUntil = Date.now() + 20000;
        send();
      }

      if (!stabilizeUntil) return;

      const mismatches = checkMismatches();
      if (mismatches.length) {
        stableHits = 0;
        if (Date.now() - lastSendAt >= 350) send();
        directApply(mismatches);
        showStatus(buffered, "React本体へ直接再同期中", mismatches, directApplied);
      } else {
        stableHits += 1;
        if (Date.now() - lastSendAt >= 2000) send();
        showStatus(buffered, "実表示一致・監視中", [], directApplied);
      }

      if (Date.now() >= stabilizeUntil) {
        const finalMismatch = checkMismatches();
        if (finalMismatch.length) directApply(finalMismatch);
        const afterDirect = checkMismatches();
        showStatus(buffered, afterDirect.length ? "20秒監視後も不一致" : "実表示まで確定", afterDirect, directApplied);
        stabilizeUntil = 0;
        sawMainOcr = false;
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
