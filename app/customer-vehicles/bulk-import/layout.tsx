"use client";

import type { ReactNode } from "react";
import { appLocation as location } from "../../lib/internal-navigation";

export default function BulkImportRegistrationLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bulkRegistrationFlow">
      <div className="bulkRegistrationBack">
        <button type="button" onClick={() => location.assign("/vehicle-workflow?mode=new")}>← 車両登録へ戻る</button>
      </div>
      {children}
      <style jsx global>{`
        .bulkRegistrationFlow .page>.top button:first-child{display:none!important}
        .bulkRegistrationBack{max-width:1100px;margin:0 auto;padding:18px 14px 0}
        .bulkRegistrationBack button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:11px 14px;font-weight:800}
        @media(max-width:650px){.bulkRegistrationBack{padding:8px 10px 0}.bulkRegistrationBack button{padding:8px 10px}}
        @media print{.bulkRegistrationBack{display:none!important}}
      `}</style>
    </div>
  );
}
