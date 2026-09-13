import { allocateDailyReportDay } from "./daily-report-allocation";
import { DAILY_REPORT_TEMPLATE } from "./daily-report-template";
import type { DailyReportEntryLike } from "./print-rules";

export type DailyReportPreviewRow<T extends DailyReportEntryLike> = {
  slotIndex: number;
  delivery: T | null;
  inbound: T | null;
};

export type DailyReportPreviewModel<T extends DailyReportEntryLike> = {
  rows: DailyReportPreviewRow<T>[];
  overflow: {
    deliveries: T[];
    inbound: T[];
  };
};

export function buildDailyReportPreviewModel<T extends DailyReportEntryLike>(
  morningRows: T[],
  afternoonRows: T[],
): DailyReportPreviewModel<T> {
  const day = allocateDailyReportDay(morningRows, afternoonRows);

  const deliveryBySlot = new Map<number, T>();
  const inboundBySlot = new Map<number, T>();

  for (const placed of day.deliveries) {
    deliveryBySlot.set(placed.slotIndex, placed.entry);
  }
  for (const placed of day.inbound) {
    inboundBySlot.set(placed.slotIndex, placed.entry);
  }

  return {
    rows: Array.from({ length: DAILY_REPORT_TEMPLATE.rows.count }, (_, slotIndex) => ({
      slotIndex,
      delivery: deliveryBySlot.get(slotIndex) || null,
      inbound: inboundBySlot.get(slotIndex) || null,
    })),
    overflow: day.overflow,
  };
}
