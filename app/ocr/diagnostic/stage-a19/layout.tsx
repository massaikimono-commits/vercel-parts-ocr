import type { ReactNode } from "react";
import GtBuilderEnhancer from "./GtBuilderEnhancer";
import GtMigrationBridge from "./GtMigrationBridge";

export default function StageA19Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <GtMigrationBridge />
      <GtBuilderEnhancer />
      {children}
    </>
  );
}
