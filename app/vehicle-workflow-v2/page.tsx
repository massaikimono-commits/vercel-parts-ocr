"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { appLocation as location } from "../lib/internal-navigation";
import VehicleWorkflowFast from "../vehicle-workflow-fast/page";

function VehicleWorkflowV2Inner() {
  const searchParams = useSearchParams();
  const newRegistrationMode = searchParams.get("mode") === "new";

  return (
    <>
      {newRegistrationMode && (
        <section className="vehicleRegistrationModeChooser" aria-label="車両登録方法">
          <div>
            <strong>車両登録方法</strong>
            <span>1台ずつ登録するか、複数の車検証PDFをまとめて登録できます。</span>
          </div>
          <button type="button" onClick={() => location.assign("/customer-vehicles/bulk-import")}>
            複数台を一括登録
          </button>
          <style jsx>{`
            .vehicleRegistrationModeChooser {
              max-width: 872px;
              margin: 18px auto -2px;
              padding: 12px 14px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              border: 1px solid #cbd8eb;
              border-radius: 14px;
              background: #eef4ff;
              color: #172033;
            }
            .vehicleRegistrationModeChooser div {
              display: grid;
              gap: 2px;
            }
            .vehicleRegistrationModeChooser strong {
              font-size: 15px;
            }
            .vehicleRegistrationModeChooser span {
              font-size: 13px;
              color: #526174;
            }
            .vehicleRegistrationModeChooser button {
              flex: 0 0 auto;
              min-height: 40px;
              padding: 8px 14px;
              border: 1px solid #2f6fe4;
              border-radius: 10px;
              background: #fff;
              color: #245fc8;
              font-weight: 800;
              cursor: pointer;
            }
            @media (max-width: 650px) {
              .vehicleRegistrationModeChooser {
                margin: 10px 10px -4px;
                align-items: stretch;
                flex-direction: column;
              }
              .vehicleRegistrationModeChooser button {
                width: 100%;
              }
            }
          `}</style>
        </section>
      )}
      <VehicleWorkflowFast newRegistrationMode={newRegistrationMode} />
    </>
  );
}

export default function VehicleWorkflowV2() {
  return (
    <Suspense fallback={<main className="page"><section className="card"><h1>新規車両登録</h1><div className="notice">画面を準備しています…</div></section></main>}>
      <VehicleWorkflowV2Inner />
    </Suspense>
  );
}
