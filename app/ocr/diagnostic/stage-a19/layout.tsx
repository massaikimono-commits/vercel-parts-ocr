import type { ReactNode } from "react";
import GtBuilderEnhancer from "./GtBuilderEnhancer";

// Evaluation-only route wrapper: mounts the scoring-only GT builder without changing OCR runtime logic.
export default function StageA19Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <GtBuilderEnhancer />
      {children}
    </>
  );
}
