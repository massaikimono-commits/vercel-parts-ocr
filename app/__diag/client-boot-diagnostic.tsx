"use client";

import { useEffect } from "react";

const ENDPOINT = "/__diag/client-boot";
const ALLOWED = new Set([
  "BOOT_1_EFFECT",
  "BOOT_2_MICROTASK",
  "BOOT_3_RAF",
  "BOOT_4_1S",
  "BOOT_5_3S",
  "BOOT_DOM_LOADING",
  "BOOT_DOM_LOGIN",
  "BOOT_DOM_HOME",
  "BOOT_JS_ERROR",
  "BOOT_UNHANDLED_REJECTION",
  "BOOT_RESOURCE_ERROR",
  "BOOT_PAGESHOW",
  "BOOT_PAGEHIDE",
  "BOOT_VIS_HIDDEN",
  "BOOT_VIS_VISIBLE",
]);

function emit(step: string) {
  if (!ALLOWED.has(step)) return;
  try {
    const blob = new Blob([step], { type: "text/plain;charset=UTF-8" });
    navigator.sendBeacon(ENDPOINT, blob);
  } catch {
    // Diagnostic-only. Never interfere with app runtime.
  }
}

function classifyDom() {
  const text = document.body?.innerText || "";
  if (text.includes("読み込み中")) return "BOOT_DOM_LOADING";
  if (text.includes("ログイン")) return "BOOT_DOM_LOGIN";
  if (text.includes("今日") || text.includes("1日の予定")) return "BOOT_DOM_HOME";
  return "";
}

export default function ClientBootDiagnostic() {
  useEffect(() => {
    emit("BOOT_1_EFFECT");

    let lastDom = "";
    const emitDom = () => {
      const next = classifyDom();
      if (next && next !== lastDom) {
        lastDom = next;
        emit(next);
      }
    };

    queueMicrotask(() => emit("BOOT_2_MICROTASK"));
    const raf = requestAnimationFrame(() => emit("BOOT_3_RAF"));
    const oneSecond = window.setTimeout(() => emit("BOOT_4_1S"), 1000);
    const threeSeconds = window.setTimeout(() => emit("BOOT_5_3S"), 3000);

    const onError = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK" || target.tagName === "IMG")) {
        emit("BOOT_RESOURCE_ERROR");
      } else {
        emit("BOOT_JS_ERROR");
      }
    };
    const onUnhandled = () => emit("BOOT_UNHANDLED_REJECTION");
    const onPageShow = () => emit("BOOT_PAGESHOW");
    const onPageHide = () => emit("BOOT_PAGEHIDE");
    const onVisibility = () => emit(document.visibilityState === "hidden" ? "BOOT_VIS_HIDDEN" : "BOOT_VIS_VISIBLE");

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    const observer = new MutationObserver(emitDom);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    emitDom();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(oneSecond);
      window.clearTimeout(threeSeconds);
      observer.disconnect();
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
