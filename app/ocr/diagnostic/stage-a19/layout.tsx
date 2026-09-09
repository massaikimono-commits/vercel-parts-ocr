import type { ReactNode } from "react";
import GtBuilderEnhancer from "./GtBuilderEnhancer";
import GtMigrationBridge from "./GtMigrationBridge";

// Evaluation-only route wrapper: mounts scoring-only GT UI and browser-only migration helper.
export default function StageA19Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <GtMigrationBridge />
      <GtBuilderEnhancer />
      {children}
    </>
  );
}
