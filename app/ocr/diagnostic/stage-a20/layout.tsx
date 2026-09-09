import type { ReactNode } from "react";
import GtBuilderEnhancer from "./GtBuilderEnhancer";

// Evaluation-only wrapper for Stage A20 saved A19 GT reuse.
export default function StageA20Layout({ children }: { children: ReactNode }) {
  return <><GtBuilderEnhancer />{children}</>;
}
