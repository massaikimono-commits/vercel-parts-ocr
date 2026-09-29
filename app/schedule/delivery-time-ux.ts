export type ScheduleTimeMode = "exact" | "unspecified";

export type ScheduleTimeChoice = {
  key: string;
  label: string;
  mode: ScheduleTimeMode;
  time: string | null;
  endTime?: string | null;
  printTimeLabelOverride: string | null;
};

export const SCHEDULE_TIME_PRESETS: readonly ScheduleTimeChoice[] = [
  { key: "until_1400", label: "14時まで", mode: "exact", time: "14:00", printTimeLabelOverride: "14時まで" },
  { key: "until_1500", label: "15時まで", mode: "exact", time: "15:00", printTimeLabelOverride: "15時まで" },
  { key: "until_1600", label: "16時まで", mode: "exact", time: "16:00", printTimeLabelOverride: "16時まで" },
  { key: "until_1700", label: "17時まで", mode: "exact", time: "17:00", printTimeLabelOverride: "17時まで" },
  { key: "after_1500", label: "15時以降", mode: "exact", time: "15:00", printTimeLabelOverride: "15時以降" },
  { key: "after_1600", label: "16時以降", mode: "exact", time: "16:00", printTimeLabelOverride: "16時以降" },
  { key: "after_1700", label: "17時以降", mode: "exact", time: "17:00", printTimeLabelOverride: "17時以降" },
  { key: "unspecified", label: "中", mode: "unspecified", time: null, printTimeLabelOverride: null },
] as const;

// Backward-compatible export while existing consumers migrate to the shared contract.
export const DELIVERY_TIME_PRESETS = SCHEDULE_TIME_PRESETS;

export const SCHEDULE_CUSTOM_TIME_MIN = "08:30";
export const SCHEDULE_CUSTOM_TIME_MAX = "17:30";
export const SCHEDULE_CUSTOM_TIME_STEP_SECONDS = 1800;

// Backward-compatible names for the current delivery consumer.
export const DELIVERY_CUSTOM_TIME_MIN = SCHEDULE_CUSTOM_TIME_MIN;
export const DELIVERY_CUSTOM_TIME_MAX = SCHEDULE_CUSTOM_TIME_MAX;
export const DELIVERY_CUSTOM_TIME_STEP_SECONDS = SCHEDULE_CUSTOM_TIME_STEP_SECONDS;

export function schedulePresetForOverride(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  if (!normalized) return null;
  return SCHEDULE_TIME_PRESETS.find((choice) => choice.printTimeLabelOverride === normalized) || null;
}

export const deliveryPresetForOverride = schedulePresetForOverride;

export function normalizeScheduleCustomTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (normalized < SCHEDULE_CUSTOM_TIME_MIN || normalized > SCHEDULE_CUSTOM_TIME_MAX) return null;
  if (minute % 30 !== 0) return null;
  return normalized;
}

export const normalizeDeliveryCustomTime = normalizeScheduleCustomTime;

export function scheduleChoiceFromCustomRange(startValue: string, endValue: string): ScheduleTimeChoice | null {
  const start = normalizeScheduleCustomTime(startValue);
  const end = normalizeScheduleCustomTime(endValue);
  if (!start || !end || start >= end) return null;
  return {
    key: `custom_${start.replace(":", "")}_${end.replace(":", "")}`,
    label: `${start}～${end}`,
    mode: "exact",
    time: start,
    endTime: end,
    printTimeLabelOverride: `${start}～${end}`,
  };
}

// Kept only so the previous candidate remains source-compatible while page consumers migrate.
export function deliveryChoiceFromCustomTime(value: string): ScheduleTimeChoice | null {
  const time = normalizeScheduleCustomTime(value);
  if (!time) return null;
  return {
    key: `custom_${time.replace(":", "")}`,
    label: time,
    mode: "exact",
    time,
    printTimeLabelOverride: null,
  };
}

export function isSupportedScheduleTimeLabel(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  if (!normalized) return true;
  if (schedulePresetForOverride(normalized)) return true;
  const range = /^(\d{2}:\d{2})～(\d{2}:\d{2})$/.exec(normalized);
  return Boolean(range && scheduleChoiceFromCustomRange(range[1], range[2]));
}
