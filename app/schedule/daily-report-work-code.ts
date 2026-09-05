export type InspectionScheduleType = "schedule" | "legal_6m" | "legal_12m" | null | undefined;

/**
 * 日報印刷専用の入庫要因コード。
 * DBの正式値・他画面の表示値は変更しない。
 */
export function dailyReportWorkCode(
  reason: string | null | undefined,
  inspectionScheduleType: InspectionScheduleType,
) {
  const normalized = (reason || "").trim();

  if (normalized === "車検") return "S";
  if (normalized === "一般整備") return "Q";
  if (normalized === "板金" || normalized === "板金塗装" || normalized === "鈑金" || normalized === "鈑金塗装") return "B/P";

  if (normalized !== "点検") return "";
  if (inspectionScheduleType === "schedule") return "スケ";
  if (inspectionScheduleType === "legal_6m") return "6";
  if (inspectionScheduleType === "legal_12m") return "12";

  // 未指定/null は推測しない。
  return "";
}
