import type { ReactNode } from "react";
import GtBuilderEnhancer from "./GtBuilderEnhancer";

export default function StageA19Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <GtBuilderEnhancer />
      {children}
    </>
  );
}
