"use client";

import type { ReactNode } from "react";

export default function CustomerVehiclesLayout({ children }: { children: ReactNode }) {
  function openActiveVehicleRoute(path: string) {
    try {
      const active = JSON.parse(localStorage.getItem("parts-active-vehicle") || "null");
      if (!active?.id) {
        alert("先に一覧から作業車両を選択してください。");
        return;
      }
    } catch {
      alert("先に一覧から作業車両を選択してください。");
      return;
    }
    location.assign(path);
  }

  function startPartsOcr() {
    try {
      const active = JSON.parse(localStorage.getItem("parts-active-vehicle") || "null");
      if (!active?.id) {
        alert("先に一覧から作業車両を選択してください。");
        return;
      }
      const parts = JSON.parse(localStorage.getItem("parts-data") || "[]");
      const beforeIds = Array.isArray(parts) ? parts.map((part: { id?: string }) => part?.id).filter(Boolean) : [];
      localStorage.setItem("parts-before-ocr-ids", JSON.stringify(beforeIds));
    } catch {
      alert("作業車両の情報を確認できませんでした。");
      return;
    }
    location.assign("/ocr/auto");
  }

  return (
    <>
      {children}
      <nav className="activeVehicleDock" aria-label="選択車両の作業メニュー">
        <button onClick={() => openActiveVehicleRoute("/schedule/active")}>📅 予定登録</button>
        <button onClick={() => openActiveVehicleRoute("/inspection/select")}>📝 記録簿</button>
        <button onClick={startPartsOcr}>📷 部品OCR</button>
        <button onClick={() => openActiveVehicleRoute("/parts-data")}>📦 部品履歴</button>
      </nav>
      <style jsx global>{`
        .activeVehicleDock{position:fixed;right:16px;bottom:18px;z-index:50;display:flex;gap:7px;padding:8px;background:rgba(255,255,255,.96);border:1px solid #d7e0ec;border-radius:18px;box-shadow:0 10px 28px rgba(31,65,120,.18);backdrop-filter:blur(8px)}
        .activeVehicleDock button{border:1px solid #c9d7eb;background:#fff;color:#245ec2;border-radius:12px;padding:11px 13px;font-weight:900;white-space:nowrap}
        .activeVehicleDock button:first-child{background:#2f6fe4;border-color:#245ec2;color:#fff}
        @media(max-width:720px){.activeVehicleDock{left:8px;right:8px;bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px}.activeVehicleDock button{width:100%;padding:10px 8px}.page{padding-bottom:155px!important}}
        @media print{.activeVehicleDock{display:none!important}}
      `}</style>
    </>
  );
}
