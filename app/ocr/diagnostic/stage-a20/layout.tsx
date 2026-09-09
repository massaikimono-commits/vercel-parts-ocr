import type { ReactNode } from "react";
import GtBuilderEnhancer from "./GtBuilderEnhancer";

export default function StageA20Layout({ children }: { children: ReactNode }) {
  return <><GtBuilderEnhancer />{children}</>;
}
