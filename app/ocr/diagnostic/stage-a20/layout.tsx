import type { ReactNode } from "react";
import GtBuilderEnhancer from "./GtBuilderEnhancer";

// Evaluation-only wrapper for Stage A20 restored formal GT scoring and invariant gate.
export default function StageA20Layout({ children }: { children: ReactNode }) {
  return <><GtBuilderEnhancer />{children}</>;
}
