import { dailyReportPeriodSlotIndexes } from "./daily-report-template";
import {
  DailyReportEntryLike,
  DailyReportPeriod,
  prepareDailyReportSection,
} from "./print-rules";

export type DailyReportPlacedEntry<T extends DailyReportEntryLike> = {
  entry: T;
  slotIndex: number;
};

export type DailyReportAllocation<T extends DailyReportEntryLike> = {
  deliveries: DailyReportPlacedEntry<T>[];
  inbound: DailyReportPlacedEntry<T>[];
  overflow: {
    deliveries: T[];
    inbound: T[];
  };
};

function placeIntoPeriodSlots<T extends DailyReportEntryLike>(rows: T[], period: DailyReportPeriod) {
  const slots = dailyReportPeriodSlotIndexes(period);
  return {
    placed: rows.slice(0, slots.length).map((entry, index) => ({ entry, slotIndex: slots[index] })),
    overflow: rows.slice(slots.length),
  };
}

// Maps one period's schedule to the existing daily-report form rows.
// Morning occupies the upper slots from top to bottom. Afternoon occupies the
// lower slots from bottom upward while preserving the configured chronological
// order from print-rules.ts. Delivery and inbound columns use the same row
// indexes independently because they are separate columns on the existing form.
export function allocateDailyReportPeriod<T extends DailyReportEntryLike>(
  rows: T[],
  period: DailyReportPeriod,
): DailyReportAllocation<T> {
  const prepared = prepareDailyReportSection(rows, period);
  const delivery = placeIntoPeriodSlots(prepared.deliveries, period);
  const inbound = placeIntoPeriodSlots(prepared.inbound, period);

  return {
    deliveries: delivery.placed,
    inbound: inbound.placed,
    overflow: {
      deliveries: delivery.overflow,
      inbound: inbound.overflow,
    },
  };
}
