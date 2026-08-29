"use client";

import type { ReactNode } from "react";

export default function CustomerVehiclesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div className="activeScheduleDock">
        <button onClick={() => location.assign("/schedule/active")}>📅 選択車両の予定を登録</button>
      </div>
      <style jsx global>{`
        .activeScheduleDock{position:fixed;right:16px;bottom:18px;z-index:50}.activeScheduleDock button{border:1px solid #245ec2;background:#2f6fe4;color:#fff;border-radius:999px;padding:13px 17px;font-weight:900;box-shadow:0 8px 24px rgba(31,65,120,.2)}
        @media(max-width:650px){.activeScheduleDock{left:12px;right:12px;bottom:12px}.activeScheduleDock button{width:100%}}
        @media print{.activeScheduleDock{display:none!important}}
      `}</style>
    </>
  );
}
