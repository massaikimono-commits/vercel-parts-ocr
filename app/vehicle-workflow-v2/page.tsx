"use client";

import VehicleWorkflowFast from "../vehicle-workflow-fast/page";

export default function VehicleWorkflowV2() {
  return (
    <>
      <div style={{ maxWidth: 980, margin: "12px auto 0", padding: "0 14px" }}>
        <a
          href="/guided-capture?mode=certificate"
          style={{
            display: "block",
            textAlign: "center",
            textDecoration: "none",
            border: "1px solid #b9cdef",
            borderRadius: 14,
            padding: "12px 10px",
            background: "#eef5ff",
            color: "#245fae",
            fontWeight: 900,
          }}
        >
          📷 QRをその場で読み取る（Guided Live Scan PoC）
        </a>
      </div>
      <VehicleWorkflowFast />
    </>
  );
}
