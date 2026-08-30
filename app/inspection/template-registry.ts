import type { WorkshopRecordTemplateKey } from "./workshop-record-types";

export type RecordTemplateSourceStatus = "RECEIVED" | "WAITING_FOR_PDF";
export type RecordTemplateCoordinateStatus =
  | "UNCONFIRMED"
  | "CONFIRMED"
  | "BLOCKED_BY_SOURCE";

export type RecordTemplateRegistryEntry = {
  key: WorkshopRecordTemplateKey | "DESIGNATED_MAINTENANCE_RECORD";
  label: string;
  sourceStatus: RecordTemplateSourceStatus;
  coordinateStatus: RecordTemplateCoordinateStatus;
  finalPrintEnabled: boolean;
  notes: string;
};

/**
 * Registry for the workshop forms that are already known to the app.
 *
 * Important safety rule:
 * - Receiving a form does not mean its print coordinates are finalized.
 * - Final print is allowed only after coordinates are explicitly confirmed.
 * - The designated maintenance record stays blocked until the actual PDF is received.
 * - No customer data, document images, or form PDFs belong in this public registry.
 */
export const RECORD_TEMPLATE_REGISTRY: readonly RecordTemplateRegistryEntry[] = [
  {
    key: "APPENDIX_3_BUSINESS",
    label: "点検整備記録簿・特定整備記録簿（別表3系）",
    sourceStatus: "RECEIVED",
    coordinateStatus: "UNCONFIRMED",
    finalPrintEnabled: false,
    notes: "受領済み帳票としてテンプレート管理。座標は帳票単位で確認して確定する。",
  },
  {
    key: "APPENDIX_5_PRIVATE_TRUCK",
    label: "点検整備記録簿・特定整備記録簿（別表5系）",
    sourceStatus: "RECEIVED",
    coordinateStatus: "UNCONFIRMED",
    finalPrintEnabled: false,
    notes: "受領済み帳票としてテンプレート管理。座標は帳票単位で確認して確定する。",
  },
  {
    key: "APPENDIX_6_PRIVATE_PASSENGER",
    label: "点検整備記録簿・特定整備記録簿（別表6系）",
    sourceStatus: "RECEIVED",
    coordinateStatus: "UNCONFIRMED",
    finalPrintEnabled: false,
    notes: "受領済み帳票としてテンプレート管理。座標は帳票単位で確認して確定する。",
  },
  {
    key: "SCHEDULE_CHECK",
    label: "スケジュール点検 チェックシート",
    sourceStatus: "RECEIVED",
    coordinateStatus: "UNCONFIRMED",
    finalPrintEnabled: false,
    notes: "受領済み帳票としてテンプレート管理。既存ルールを保持し、座標は勝手に固定しない。",
  },
  {
    key: "DESIGNATED_MAINTENANCE_RECORD",
    label: "指定整備記録簿",
    sourceStatus: "WAITING_FOR_PDF",
    coordinateStatus: "BLOCKED_BY_SOURCE",
    finalPrintEnabled: false,
    notes: "PDF受領待ち。帳票座標および最終印刷実装は未確定のまま保持する。",
  },
] as const;

export function getRecordTemplateRegistryEntry(
  key: RecordTemplateRegistryEntry["key"],
): RecordTemplateRegistryEntry | undefined {
  return RECORD_TEMPLATE_REGISTRY.find((entry) => entry.key === key);
}

export function canFinalizeRecordTemplatePrint(
  key: RecordTemplateRegistryEntry["key"],
): boolean {
  const entry = getRecordTemplateRegistryEntry(key);
  return Boolean(
    entry &&
      entry.sourceStatus === "RECEIVED" &&
      entry.coordinateStatus === "CONFIRMED" &&
      entry.finalPrintEnabled,
  );
}
