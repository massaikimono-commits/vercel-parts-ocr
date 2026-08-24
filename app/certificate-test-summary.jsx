"use client";

import { useEffect, useState } from "react";

function norm(value = "") {
  return String(value).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

function detailValue(labelText) {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
    node.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!card) return "";
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (title !== norm(labelText)) continue;
    const input = label.querySelector("input");
    return input instanceof HTMLInputElement ? input.value || "" : "";
  }
  return "";
}

function qrVersion(item) {
  const f = String(item?.data || "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .split("/")
    .map((x) => x.trim());
  return f[0] === "K" ? f[1] || "" : "";
}

function sourceFor(field, qr, identityOcr, engineOcr) {
  if (qr?.[field]) return field === "engineModel" ? "QR K2" : "QR K0/K2";
  if (identityOcr?.[field]) return "2行OCR(複数一致)";
  if (engineOcr?.[field]) return "1セルOCR(複数一致)";
  return "本体OCR/補正 または未取得";
}

export default function CertificateTestSummary() {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let last = "";
    const sync = () => {
      const qr = window.__vehicleCertificateQrPriority || {};
      const identityOcr = window.__vehicleCertificateIdentityOcrPatch || {};
      const engineOcr = window.__vehicleCertificateEngineOcrPatch || {};
      const qrItems = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
      const versions = [...new Set(qrItems.map(qrVersion).filter(Boolean))].sort();
      const next = {
        busy: Boolean(document.querySelector(".progress")),
        versions,
        recordDate: detailValue("記録年月日"),
        registrationNumber: detailValue("自動車登録番号又は車両番号"),
        chassisNumber: detailValue("車台番号"),
        engineModel: detailValue("原動機の型式"),
        registrationSource: sourceFor("registrationNumber", qr, identityOcr, engineOcr),
        chassisSource: sourceFor("chassisNumber", qr, identityOcr, engineOcr),
        engineSource: sourceFor("engineModel", qr, identityOcr, engineOcr),
      };
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      setState(next);
    };

    sync();
    const timer = window.setInterval(sync, 500);
    return () => window.clearInterval(timer);
  }, []);

  if (!state) return null;

  const identityReady = /^(?:0|2)\d$/.test(state.versions.find((x) => /^(?:0|2)\d$/.test(x)) || "");
  const k2Ready = state.versions.some((x) => /^2\d$/.test(x));

  return (
    <details open style={{ margin: "12px auto", maxWidth: 760, padding: 12, border: "1px solid #94a3b8", borderRadius: 14, background: "#fff" }}>
      <summary style={{ fontWeight: 900, cursor: "pointer" }}>残り4項目 最終判定（確認用）</summary>
      <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        <div>処理状態: {state.busy ? "本体OCR中" : "本体OCR完了"}</div>
        <div>軽QR: {state.versions.join(", ") || "未取得"}</div>
        <div>身元QR(K0/K2): {identityReady ? "あり" : "なし"} / K2: {k2Ready ? "あり" : "なし"}</div>
        <hr style={{ margin: "10px 0" }} />
        <div><b>記録年月日:</b> {state.recordDate || "空欄（保留）"}</div>
        <div><b>登録番号:</b> {state.registrationNumber || "空欄（保留）"}<br />取得元: {state.registrationSource}</div>
        <div><b>車台番号:</b> {state.chassisNumber || "空欄（保留）"}<br />取得元: {state.chassisSource}</div>
        <div><b>原動機型式:</b> {state.engineModel || "空欄（保留）"}<br />取得元: {state.engineSource}</div>
      </div>
    </details>
  );
}
