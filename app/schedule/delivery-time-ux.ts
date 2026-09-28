export type DeliveryTimeMode = "exact" | "unspecified";

export type DeliveryTimeChoice = {
  key: string;
  label: string;
  mode: DeliveryTimeMode;
  time: string | null;
  printTimeLabelOverride: string | null;
};

export const DELIVERY_TIME_PRESETS: readonly DeliveryTimeChoice[] = [
  { key: "unspecified", label: "中", mode: "unspecified", time: null, printTimeLabelOverride: null },
  { key: "after_1500", label: "15時以降", mode: "exact", time: "15:00", printTimeLabelOverride: "15時以降" },
  { key: "after_1600", label: "16時以降", mode: "exact", time: "16:00", printTimeLabelOverride: "16時以降" },
  { key: "after_1700", label: "17時以降", mode: "exact", time: "17:00", printTimeLabelOverride: "17時以降" },
] as const;

export const DELIVERY_CUSTOM_TIME_MIN = "08:30";
export const DELIVERY_CUSTOM_TIME_MAX = "17:30";
export const DELIVERY_CUSTOM_TIME_STEP_SECONDS = 1800;

export function deliveryPresetForOverride(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  if (!normalized) return null;
  return DELIVERY_TIME_PRESETS.find((choice) => choice.printTimeLabelOverride === normalized) || null;
}

export function normalizeDeliveryCustomTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (normalized < DELIVERY_CUSTOM_TIME_MIN || normalized > DELIVERY_CUSTOM_TIME_MAX) return null;
  if (minute % 30 !== 0) return null;
  return normalized;
}

export function deliveryChoiceFromCustomTime(value: string): DeliveryTimeChoice | null {
  const time = normalizeDeliveryCustomTime(value);
  if (!time) return null;
  return {
    key: `custom_${time.replace(":", "")}`,
    label: time,
    mode: "exact",
    time,
    printTimeLabelOverride: null,
  };
}
