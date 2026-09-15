"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import VehicleWorkflowFast from "../vehicle-workflow-fast/page";

function VehicleWorkflowV2Inner() {
  const searchParams = useSearchParams();
  return <VehicleWorkflowFast newRegistrationMode={searchParams.get("mode") === "new"} />;
}

export default function VehicleWorkflowV2() {
  return (
    <Suspense fallback={<main className="page"><section className="card"><h1>新規車両登録</h1><div className="notice">画面を準備しています…</div></section></main>}>
      <VehicleWorkflowV2Inner />
    </Suspense>
  );
}
