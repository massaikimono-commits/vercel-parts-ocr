export type DailyReportRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DailyReportRowSlot = {
  index: number;
  y: number;
};

// Existing user-supplied daily report form. Coordinates are normalized (0..1)
// so the same placement model can be reused for PDF preview and printed output.
// The source PDF itself is intentionally not committed to the public repository.
export const DAILY_REPORT_TEMPLATE = {
  id: "existing-daily-report-v1",
  page: {
    width: 1,
    height: 1,
    paperSize: "A3" as const,
    orientation: "portrait" as const,
    widthMm: 297,
    heightMm: 420,
  },
  background: {
    source: "user-supplied-existing-form" as const,
    publicAssetPath: null as string | null,
    commitToPublicRepo: false,
  },
  regions: {
    date: { x: 0.015, y: 0.012, width: 0.31, height: 0.042 },
    delivery: { x: 0.012, y: 0.085, width: 0.47, height: 0.655 },
    inbound: { x: 0.515, y: 0.085, width: 0.472, height: 0.655 },
    messages: { x: 0.012, y: 0.75, width: 0.63, height: 0.09 },
    stayingVehicles: { x: 0.012, y: 0.855, width: 0.35, height: 0.135 },
    bodyShopVehicles: { x: 0.385, y: 0.855, width: 0.25, height: 0.135 },
    plannedDeliveries: { x: 0.66, y: 0.75, width: 0.327, height: 0.24 },
  } satisfies Record<string, DailyReportRegion>,
  rows: {
    count: 23,
    top: 0.11,
    bottom: 0.735,
  },
} as const;

export function dailyReportRowSlots(): DailyReportRowSlot[] {
  const { count, top, bottom } = DAILY_REPORT_TEMPLATE.rows;
  if (count <= 1) return [{ index: 0, y: top }];
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, index) => ({
    index,
    y: top + step * index,
  }));
}

export function dailyReportPeriodSlotIndexes(period: "morning" | "afternoon") {
  const slots = dailyReportRowSlots();
  const midpoint = Math.ceil(slots.length / 2);
  if (period === "morning") return slots.slice(0, midpoint).map((slot) => slot.index);
  return slots.slice(midpoint).map((slot) => slot.index).reverse();
}
