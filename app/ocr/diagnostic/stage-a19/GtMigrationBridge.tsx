"use client";

import { useMemo, useState } from "react";
import { EXPECTED_FILES } from "../stage-a4/gt";

const STORAGE_KEY = "icb.parts-ocr.stage-a19.four-field-gt.v1";
const DEFAULT_A20 = "https://vercel-parts-ocr-git-eval-p-d2f6e7-massa-ikimono-8427s-projects.vercel.app/ocr/diagnostic/stage-a20";

type GtRow = { name?: unknown; qty?: unknown; retail?: unknown; cost?: unknown };

function hasRows(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some((row) => {
    const r = (row && typeof row === "object" ? row : {}) as GtRow;
    return [r.name, r.qty, r.retail, r.cost].some((v) => String(v ?? "").trim());
  });
}

function isCompleteGt(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return EXPECTED_FILES.every((file) => hasRows(parsed[file]));
  } catch {
    return false;
  }
}

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export default function GtMigrationBridge() {
  const [message, setMessage] = useState("");
  const target = useMemo(() => {
    if (typeof window === "undefined") return DEFAULT_A20;
    const requested = new URLSearchParams(window.location.search).get("to");
    if (!requested) return DEFAULT_A20;
    try {
      const url = new URL(requested);
      return url.protocol === "https:" ? url.toString() : DEFAULT_A20;
    } catch {
      return DEFAULT_A20;
    }
  }, []);

  function migrate() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !isCompleteGt(raw)) {
      setMessage("このA19 originには正式12枚GTがありません。別originのGTはここからは読めません。");
      return;
    }
    const url = new URL(target);
    url.hash = `a19gt=${toBase64Url(raw)}`;
    window.location.assign(url.toString());
  }

  return (
    <section style={{ maxWidth: 1040, margin: "12px auto 0", padding: "0 12px" }}>
      <div style={{ border: "1px solid #b7d5c0", background: "#f2fbf5", borderRadius: 14, padding: 12 }}>
        <strong>A19保存済みGTのA20移行</strong>
        <p style={{ margin: "6px 0 10px", fontSize: 13, lineHeight: 1.5 }}>
          このA19 originに保存された正式12枚GTを、URL fragmentだけでA20へ移します。GTはサーバへ送信されません。
        </p>
        <button type="button" onClick={migrate} style={{ width: "100%", border: 0, borderRadius: 11, padding: 12, background: "#147a42", color: "#fff", fontWeight: 800 }}>
          A20へGTを移行
        </button>
        {message && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>{message}</div>}
      </div>
    </section>
  );
}
