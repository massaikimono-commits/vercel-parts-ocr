import { allocateDailyReportPeriod } from "./daily-report-allocation";
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

// Builds the row model consumed by the existing daily-report print preview.
// The original daily-report PDF stays outside the public repository; this model
// only determines which schedule entry belongs in each existing form row/cell.
export function buildDailyReportPreviewModel<T extends DailyReportEntryLike>(
  morningRows: T[],
  afternoonRows: T[],
): DailyReportPreviewModel<T> {
  const morning = allocateDailyReportPeriod(morningRows, "morning");
  const afternoon = allocateDailyReportPeriod(afternoonRows, "afternoon");

  const deliveryBySlot = new Map<number, T>();
  const inboundBySlot = new Map<number, T>();

  for (const placed of [...morning.deliveries, ...afternoon.deliveries]) {
    deliveryBySlot.set(placed.slotIndex, placed.entry);
  }
  for (const placed of [...morning.inbound, ...afternoon.inbound]) {
    inboundBySlot.set(placed.slotIndex, placed.entry);
  }

  return {
    rows: Array.from({ length: DAILY_REPORT_TEMPLATE.rows.count }, (_, slotIndex) => ({
      slotIndex,
      delivery: deliveryBySlot.get(slotIndex) || null,
      inbound: inboundBySlot.get(slotIndex) || null,
    })),
    overflow: {
      deliveries: [...morning.overflow.deliveries, ...afternoon.overflow.deliveries],
      inbound: [...morning.overflow.inbound, ...afternoon.overflow.inbound],
    },
  };
}
