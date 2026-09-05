export type DailyReportEntryType = "delivery" | "pickup" | "customer_visit" | "onsite_repair";
export type DailyReportPeriod = "morning" | "afternoon";

export type DailyReportEntryLike = {
  id: string;
  entry_type: DailyReportEntryType;
  starts_at: string;
  print_time_mode: "exact" | "morning" | "unspecified";
  print_time_label_override: string | null;
};

const INBOUND_TYPE_ORDER: Record<Exclude<DailyReportEntryType, "delivery">, number> = {
  customer_visit: 0,
  pickup: 1,
  onsite_repair: 2,
};

function timeValue(row: Pick<DailyReportEntryLike, "starts_at">) {
  return new Date(row.starts_at).getTime();
}

function isMorningJst(value: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(value)));
  return Number.isFinite(hour) && hour < 12;
}

export function dailyReportTimeLabel(row: DailyReportEntryLike) {
  if (row.print_time_label_override) return row.print_time_label_override;
  if (row.print_time_mode === "exact") {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(row.starts_at));
    const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
    if (row.entry_type === "pickup" || row.entry_type === "delivery") {
      return minute === 0 ? `${hour}時まで` : `${hour}時${minute}分まで`;
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (
    (row.entry_type === "pickup" || row.entry_type === "customer_visit")
    && (row.print_time_mode === "morning" || (row.print_time_mode === "unspecified" && isMorningJst(row.starts_at)))
  ) return "A中";
  if ((row.entry_type === "pickup" || row.entry_type === "customer_visit") && row.print_time_mode === "unspecified") return "午後";
  if (row.entry_type === "onsite_repair" && row.print_time_mode === "morning") return "午前中";
  if (row.entry_type === "onsite_repair" && row.print_time_mode === "unspecified") return "午後中";
  if (row.entry_type === "delivery" && row.print_time_mode === "unspecified") return "中";
  return row.print_time_mode === "morning" ? "午前" : "時間未定";
}

export function sortDailyReportInbound<T extends DailyReportEntryLike>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aOrder = a.entry_type === "delivery" ? 99 : INBOUND_TYPE_ORDER[a.entry_type];
    const bOrder = b.entry_type === "delivery" ? 99 : INBOUND_TYPE_ORDER[b.entry_type];
    const typeDiff = aOrder - bOrder;
    if (typeDiff) return typeDiff;

    const modeOrder = (row: DailyReportEntryLike) =>
      row.print_time_mode === "exact" ? 0 : row.print_time_mode === "morning" ? 1 : 2;
    const modeDiff = modeOrder(a) - modeOrder(b);
    if (modeDiff) return modeDiff;

    return timeValue(a) - timeValue(b);
  });
}

export function sortDailyReportDeliveries<T extends DailyReportEntryLike>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const modeOrder = (row: DailyReportEntryLike) =>
      row.print_time_mode === "exact" ? 0 : row.print_time_mode === "morning" ? 1 : 2;
    const modeDiff = modeOrder(a) - modeOrder(b);
    if (modeDiff) return modeDiff;
    return timeValue(a) - timeValue(b);
  });
}

export function stackDailyReportRows<T>(rows: T[], period: DailyReportPeriod) {
  // Slot allocation owns the physical direction. Afternoon slot indexes are
  // already bottom-up, so keep rows in chronological/type order here instead
  // of reversing them a second time.
  return [...rows];
}

export function prepareDailyReportSection<T extends DailyReportEntryLike>(rows: T[], period: DailyReportPeriod) {
  const deliveries = stackDailyReportRows(
    sortDailyReportDeliveries(rows.filter((row) => row.entry_type === "delivery")),
    period,
  );
  const inbound = stackDailyReportRows(
    sortDailyReportInbound(rows.filter((row) => row.entry_type !== "delivery")),
    period,
  );
  return { deliveries, inbound };
}
