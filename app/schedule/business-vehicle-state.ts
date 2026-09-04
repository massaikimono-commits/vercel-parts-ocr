export type BusinessEntryType = "delivery" | "pickup" | "customer_visit" | "onsite_repair";

export type BusinessScheduleEntry = {
  id: string;
  work_order_id: string | null;
  vehicle_id?: string | null;
  entry_type: BusinessEntryType;
  starts_at: string;
  print_time_mode?: string | null;
};

export type BusinessWorkOrder = {
  id: string;
  vehicle_id: string;
  reason: string;
  status: string;
};

export type BusinessVehicleState<TWork extends BusinessWorkOrder = BusinessWorkOrder> = {
  work: TWork;
  inboundEntry: BusinessScheduleEntry;
  inboundDay: string;
  deliveryEntry: BusinessScheduleEntry | null;
  deliveryDay: string | null;
};

export type BusinessVehicleStates<TWork extends BusinessWorkOrder = BusinessWorkOrder> = {
  stayingVehicles: BusinessVehicleState<TWork>[];
  bodyShopVehicles: BusinessVehicleState<TWork>[];
  plannedDeliveries: BusinessVehicleState<TWork>[];
};

export function jstBusinessDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function isBodyShopReason(reason: string | null | undefined) {
  const value = (reason || "").trim();
  return value === "板金" || value === "板金塗装" || value === "鈑金" || value === "鈑金塗装";
}

export function isInboundEntry(entry: BusinessScheduleEntry) {
  return entry.entry_type === "pickup" || entry.entry_type === "customer_visit";
}

function firstByStart(entries: BusinessScheduleEntry[]) {
  return [...entries].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  )[0] || null;
}

export function classifyVehicleBusinessStates<TWork extends BusinessWorkOrder>(
  works: TWork[],
  scheduleEntries: BusinessScheduleEntry[],
  reportDay: string,
): BusinessVehicleStates<TWork> {
  const byWork = new Map<string, BusinessScheduleEntry[]>();
  for (const entry of scheduleEntries) {
    if (!entry.work_order_id) continue;
    const rows = byWork.get(entry.work_order_id) || [];
    rows.push(entry);
    byWork.set(entry.work_order_id, rows);
  }

  const stayingVehicles: BusinessVehicleState<TWork>[] = [];
  const bodyShopVehicles: BusinessVehicleState<TWork>[] = [];
  const plannedDeliveries: BusinessVehicleState<TWork>[] = [];

  for (const work of works) {
    if (work.status === "cancelled") continue;

    const rows = byWork.get(work.id) || [];
    const inboundEntry = firstByStart(rows.filter(isInboundEntry));
    if (!inboundEntry) continue;

    const inboundDay = jstBusinessDay(inboundEntry.starts_at);
    if (inboundDay > reportDay) continue;

    const deliveryEntry = firstByStart(rows.filter((entry) => entry.entry_type === "delivery"));
    const deliveryDay = deliveryEntry ? jstBusinessDay(deliveryEntry.starts_at) : null;

    const state: BusinessVehicleState<TWork> = {
      work,
      inboundEntry,
      inboundDay,
      deliveryEntry,
      deliveryDay,
    };

    if (isBodyShopReason(work.reason)) {
      // 板金は引取/来社の予定日から、納車予定日の前日まで継続。
      // 納車当日は上部納車欄を優先するため、板金欄へは出さない。
      if (!deliveryDay || deliveryDay > reportDay) bodyShopVehicles.push(state);
    } else {
      // 滞留は「納車予定が未登録」の時だけ。
      // checked_in/out・作業完了系は業務判定へ混ぜない。
      if (!deliveryEntry) stayingVehicles.push(state);
    }

    // 納車予定車両は、入庫開始済みかつ納車日が翌日以降の車両。
    if (deliveryDay && deliveryDay > reportDay) plannedDeliveries.push(state);
  }

  return { stayingVehicles, bodyShopVehicles, plannedDeliveries };
}

export function deliveryTimeLabel(entry: BusinessScheduleEntry | null) {
  if (!entry) return "";
  if (entry.print_time_mode === "unspecified") return "中";
  if (entry.print_time_mode === "morning") return "A中";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(entry.starts_at));
}
