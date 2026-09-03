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

// Measured directly from the user-supplied A3 daily report PDF.
// PDF page size: 842 x 1191 pt (A3 portrait).
// Coordinates are normalized to 0..1 so browser preview and A3 printing
// use the same geometry.
export const DAILY_REPORT_TEMPLATE = {
  id: "existing-daily-report-v2-pdf-measured",
  page: {
    width: 1,
    height: 1,
    paperSize: "A3" as const,
    orientation: "portrait" as const,
    widthMm: 297,
    heightMm: 420,
    sourceWidthPt: 842,
    sourceHeightPt: 1191,
  },
  background: {
    source: "user-supplied-existing-form" as const,
    publicAssetPath: null as string | null,
    commitToPublicRepo: false,
  },
  regions: {
    // Header band containing the printed date.
    date: { x: 0.044323, y: 0.023778, width: 0.333919, height: 0.041310 },

    // Main schedule fields only.
    // Delivery intentionally stops at the "作業経過" column.
    delivery: { x: 0.044323, y: 0.105189, width: 0.333919, height: 0.621058 },
    // Inbound begins after the No. column and includes 納期.
    inbound: { x: 0.530024, y: 0.105189, width: 0.441378, height: 0.621058 },

    // Blank area to the right of the printed "伝達事項" label.
    messages: { x: 0.136532, y: 0.726650, width: 0.514917, height: 0.026599 },

    // Lower tables exclude their vertical title cells and header rows.
    stayingVehicles: { x: 0.074679, y: 0.820756, width: 0.303563, height: 0.148917 },
    bodyShopVehicles: { x: 0.408599, y: 0.820756, width: 0.242850, height: 0.148917 },
    plannedDeliveries: { x: 0.681805, y: 0.739748, width: 0.289596, height: 0.229924 },
  } satisfies Record<string, DailyReportRegion>,

  // Column ratios measured from the PDF grid lines.
  columns: {
    delivery: {
      customer: 0.454546,
      vehicle: 0.272727,
      time: 0.272727,
    },
    inbound: {
      customer: 0.343881,
      vehicle: 0.206329,
      time: 0.211818,
      due: 0.237972,
    },
  },

  rows: {
    count: 23,
    // Row 1 starts at 125.28 pt. Row 23 starts at 832.80 pt.
    top: 0.105189,
    bottom: 0.699244,
    height: 0.027003,
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
