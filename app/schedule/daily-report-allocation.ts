import { dailyReportPeriodSlotIndexes, dailyReportRowSlots } from "./daily-report-template";
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

function capacities(morningCount: number, afternoonCount: number, totalSlots: number) {
  const baseMorning = Math.ceil(totalSlots / 2);
  const baseAfternoon = totalSlots - baseMorning;

  const morningBaseUsed = Math.min(morningCount, baseMorning);
  const afternoonBaseUsed = Math.min(afternoonCount, baseAfternoon);

  const spareMorning = baseMorning - morningBaseUsed;
  const spareAfternoon = baseAfternoon - afternoonBaseUsed;

  const morningExtra = Math.min(Math.max(0, morningCount - morningBaseUsed), spareAfternoon);
  const afternoonExtra = Math.min(Math.max(0, afternoonCount - afternoonBaseUsed), spareMorning);

  return {
    morningCapacity: morningBaseUsed + morningExtra,
    afternoonCapacity: afternoonBaseUsed + afternoonExtra,
  };
}

function placeDayColumn<T extends DailyReportEntryLike>(morningRows: T[], afternoonRows: T[]) {
  const slots = dailyReportRowSlots().map((slot) => slot.index);
  const { morningCapacity, afternoonCapacity } = capacities(
    morningRows.length,
    afternoonRows.length,
    slots.length,
  );

  const morningPlaced = morningRows
    .slice(0, morningCapacity)
    .map((entry, index) => ({ entry, slotIndex: slots[index] }));

  // 午後は「下詰め」だが、占有した下側ブロックの中では
  // 上から下へ表示順を維持する。
  // これにより「時間指定が上、A中/中などの幅指定が下」になる。
  const afternoonSlots = slots.slice(slots.length - afternoonCapacity);
  const afternoonPlaced = afternoonRows
    .slice(0, afternoonCapacity)
    .map((entry, index) => ({ entry, slotIndex: afternoonSlots[index] }));

  return {
    placed: [...morningPlaced, ...afternoonPlaced],
    overflow: [
      ...morningRows.slice(morningCapacity),
      ...afternoonRows.slice(afternoonCapacity),
    ],
  };
}

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

export function allocateDailyReportDay<T extends DailyReportEntryLike>(
  morningRows: T[],
  afternoonRows: T[],
): DailyReportAllocation<T> {
  const morning = prepareDailyReportSection(morningRows, "morning");
  const afternoon = prepareDailyReportSection(afternoonRows, "afternoon");

  const delivery = placeDayColumn(morning.deliveries, afternoon.deliveries);
  const inbound = placeDayColumn(morning.inbound, afternoon.inbound);

  return {
    deliveries: delivery.placed,
    inbound: inbound.placed,
    overflow: {
      deliveries: delivery.overflow,
      inbound: inbound.overflow,
    },
  };
}
