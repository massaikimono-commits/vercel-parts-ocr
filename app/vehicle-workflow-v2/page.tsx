"use client";

import { useEffect } from "react";

export default function VehicleWorkflowV2Redirect() {
  useEffect(() => {
    location.replace("/vehicle-workflow-v3");
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" }}>
      車検証読み取り画面を開いています…
    </main>
  );
}
