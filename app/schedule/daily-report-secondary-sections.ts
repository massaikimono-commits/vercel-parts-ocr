export type DailyReportSecondaryEntry = {
  notes?: string | null;
};

export type DailyReportSecondaryWork = {
  id: string;
  vehicle_id: string;
  reason: string;
  status: string;
  work_completed: boolean;
  scheduled_at?: string | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  planned_delivery_at?: string | null;
  expected_completion_date?: string | null;
};

function dayBoundsJst(day: string) {
  const start = new Date(`${day}T00:00:00+09:00`);
  return {
    start: start.getTime(),
    end: start.getTime() + 24 * 60 * 60 * 1000,
  };
}

function isActiveWorkshopWork(work: DailyReportSecondaryWork, endOfDay: number) {
  if (work.status === "cancelled") return false;

  const activeFrom = work.checked_in_at || work.scheduled_at;
  const active = Boolean(work.checked_in_at) || work.status === "in_progress";
  if (!active || (activeFrom && new Date(activeFrom).getTime() >= endOfDay)) return false;

  // Historical daily reports must be evaluated as of the selected day's end,
  // not from the work order's current state. A vehicle checked out on a later
  // day was still a staying vehicle on the earlier report.
  if (work.checked_out_at) {
    return new Date(work.checked_out_at).getTime() >= endOfDay;
  }

  if (work.work_completed || work.status === "completed") return false;
  return true;
}

function isBodyShopReason(reason: string) {
  const normalized = reason.trim();
  return normalized.includes("板金") || normalized.includes("鈑金");
}

function uniqueByVehicle<T extends DailyReportSecondaryWork>(works: T[]) {
  const seen = new Set<string>();
  return works.filter((work) => {
    if (seen.has(work.vehicle_id)) return false;
    seen.add(work.vehicle_id);
    return true;
  });
}

export function collectDailyReportMessages(entries: DailyReportSecondaryEntry[]) {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const entry of entries) {
    const note = entry.notes?.trim();
    if (!note || seen.has(note)) continue;
    seen.add(note);
    messages.push(note);
  }
  return messages;
}

export function selectDailyReportSecondaryWorks<T extends DailyReportSecondaryWork>(works: T[], day: string) {
  const { start, end } = dayBoundsJst(day);
  const active = works.filter((work) => isActiveWorkshopWork(work, end));
  const bodyShopVehicleIds = new Set(active.filter((work) => isBodyShopReason(work.reason)).map((work) => work.vehicle_id));

  const bodyShopVehicles = uniqueByVehicle(
    active
      .filter((work) => bodyShopVehicleIds.has(work.vehicle_id))
      .sort((a, b) => (a.expected_completion_date || "9999-12-31").localeCompare(b.expected_completion_date || "9999-12-31")),
  );

  const stayingVehicles = uniqueByVehicle(
    active
      .filter((work) => !bodyShopVehicleIds.has(work.vehicle_id))
      .sort((a, b) => (a.expected_completion_date || "9999-12-31").localeCompare(b.expected_completion_date || "9999-12-31")),
  );

  const plannedDeliveries = uniqueByVehicle(
    works
      .filter((work) => {
        if (!work.planned_delivery_at || work.status === "cancelled") return false;
        const checkedOutAt = work.checked_out_at ? new Date(work.checked_out_at).getTime() : null;
        if (checkedOutAt !== null && checkedOutAt < end) return false;
        const value = new Date(work.planned_delivery_at).getTime();
        return value >= start && value < end;
      })
      .sort((a, b) => new Date(a.planned_delivery_at || 0).getTime() - new Date(b.planned_delivery_at || 0).getTime()),
  );

  return { stayingVehicles, bodyShopVehicles, plannedDeliveries };
}
