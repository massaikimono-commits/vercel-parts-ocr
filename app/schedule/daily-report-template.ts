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

// User-supplied official daily report form: 日報(2).pdf.
// Actual paper: A3 portrait, PDF page size 842 x 1191 pt.
// Coordinates below are normalized against that exact source so preview and print
// stay aligned without changing the original ruled layout.
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
    date: { x: 0.0436, y: 0.0239, width: 0.34, height: 0.042 },
    delivery: { x: 0.0436, y: 0.1049, width: 0.4558, height: 0.6213 },
    inbound: { x: 0.5297, y: 0.1049, width: 0.4417, height: 0.6213 },
    messages: { x: 0.0436, y: 0.7259, width: 0.6375, height: 0.0541 },
    // Bottom sections start after the vertical 滞留車両 / 鈑金車両 labels.
    stayingVehicles: { x: 0.0748, y: 0.8208, width: 0.3027, height: 0.1484 },
    bodyShopVehicles: { x: 0.4087, y: 0.8208, width: 0.2723, height: 0.1484 },
    // Right-bottom planned-delivery data starts below its header and to the
    // right of the vertical 納車予定車両 label.
    plannedDeliveries: { x: 0.7101, y: 0.7395, width: 0.2613, height: 0.2298 },
  } satisfies Record<string, DailyReportRegion>,
  rows: {
    count: 23,
    top: 0.1049,
    bottom: 0.6990,
    height: 0.0270,
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
