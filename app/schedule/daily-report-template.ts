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
    // Measured from the supplied A3 portrait PDF.
    date: { x: 0.044, y: 0.024, width: 0.34, height: 0.042 },
    delivery: { x: 0.044, y: 0.105, width: 0.455, height: 0.621 },
    inbound: { x: 0.529, y: 0.105, width: 0.442, height: 0.621 },
    messages: { x: 0.044, y: 0.726, width: 0.637, height: 0.054 },
    stayingVehicles: { x: 0.044, y: 0.807, width: 0.334, height: 0.161 },
    bodyShopVehicles: { x: 0.378, y: 0.807, width: 0.303, height: 0.161 },
    plannedDeliveries: { x: 0.681, y: 0.753, width: 0.290, height: 0.215 },
  } satisfies Record<string, DailyReportRegion>,
  rows: {
    count: 23,
    top: 0.105,
    bottom: 0.699,
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
