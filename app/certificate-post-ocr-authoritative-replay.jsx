"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function isCertificateFileInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

export default function CertificatePostOcrAuthoritativeReplay() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let scan = 0;
    let sawMainOcr = false;
    let replayed = false;
    let buffered = {};
    let replayTimers = [];

    const clearReplayTimers = () => {
      for (const timer of replayTimers) window.clearTimeout(timer);
      replayTimers = [];
    };

    const reset = () => {
      scan += 1;
      sawMainOcr = false;
      replayed = false;
      buffered = {};
      clearReplayTimers();
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

    const replay = () => {
      if (replayed || !Object.keys(buffered).length) return;
      replayed = true;
      const token = scan;
      const send = () => {
        if (token !== scan || !Object.keys(buffered).length) return;
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, {
          detail: { ...buffered, __postOcrReplay: true },
        }));
      };

      // Reactの最終描画やSupabase初期読込が遅れても、最後に正解値が勝つよう短時間だけ再送する。
      send();
      replayTimers.push(window.setTimeout(send, 500));
      replayTimers.push(window.setTimeout(send, 1300));
      replayTimers.push(window.setTimeout(send, 2500));
    };

    const poll = () => {
      const running = !!document.querySelector(".progress");
      if (running) {
        sawMainOcr = true;
        replayed = false;
        return;
      }
      if (sawMainOcr) replay();
    };

    document.addEventListener("change", onFileChange, true);
    window.addEventListener(AUTH_EVENT, onAuthoritative);
    const timer = window.setInterval(poll, 120);
    poll();

    return () => {
      document.removeEventListener("change", onFileChange, true);
      window.removeEventListener(AUTH_EVENT, onAuthoritative);
      window.clearInterval(timer);
      clearReplayTimers();
    };
  }, []);

  return null;
}
