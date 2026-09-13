"use client";

import { useEffect } from "react";

const PARTS_KEY = "parts-data";
const ACTIVE_KEY = "parts-active-vehicle";
const BEFORE_KEY = "parts-before-ocr-ids";

type StoredPart = {
  id?: string;
  vehicleId?: string;
  vehicleNumber?: string;
  [key: string]: unknown;
};

type ActiveVehicle = {
  id?: string;
  number?: string;
  registration?: string;
  chassis?: string;
};

function parse<T>(value: string | null, fallback: T): T {
  try {
    return JSON.parse(value || "") as T;
  } catch {
    return fallback;
  }
}

function enrichPart(part: StoredPart, vehicle: ActiveVehicle): StoredPart {
  return {
    ...part,
    vehicleId: vehicle.id || "",
    vehicleNumber: vehicle.number || "",
    registration: vehicle.registration || "",
    chassis: vehicle.chassis || "",
    linkedAt: new Date().toISOString(),
  };
}

export default function PartsOcrBatchLinker() {
  useEffect(() => {
    const originalSetItem = Storage.prototype.setItem;

    function patchedSetItem(this: Storage, key: string, value: string) {
      if (this === localStorage && key === PARTS_KEY) {
        const vehicle = parse<ActiveVehicle | null>(sessionStorage.getItem(ACTIVE_KEY), null);
        const previous = parse<StoredPart[]>(localStorage.getItem(PARTS_KEY), []);
        const incoming = parse<StoredPart[] | null>(value, null);
        if (vehicle && Array.isArray(previous) && Array.isArray(incoming)) {
          const oldIds = new Set(previous.map((part) => part?.id).filter(Boolean));
          const linked = incoming.map((part) => {
            if (!part?.id || oldIds.has(part.id) || part.vehicleId || part.vehicleNumber) return part;
            return enrichPart(part, vehicle);
          });
          value = JSON.stringify(linked);
        }
      }
      return originalSetItem.call(this, key, value);
    }

    Storage.prototype.setItem = patchedSetItem;

    const vehicle = parse<ActiveVehicle | null>(sessionStorage.getItem(ACTIVE_KEY), null);
    const before = parse<string[] | null>(sessionStorage.getItem(BEFORE_KEY), null);
    const parts = parse<StoredPart[]>(localStorage.getItem(PARTS_KEY), []);
    if (vehicle && Array.isArray(before) && Array.isArray(parts)) {
      const beforeIds = new Set(before);
      let changed = false;
      const next = parts.map((part) => {
        if (!part?.id || beforeIds.has(part.id) || part.vehicleId || part.vehicleNumber) return part;
        changed = true;
        return enrichPart(part, vehicle);
      });

      if (changed) originalSetItem.call(localStorage, PARTS_KEY, JSON.stringify(next));
      if (changed || parts.some((part) => part?.id && !beforeIds.has(part.id))) {
        sessionStorage.removeItem(BEFORE_KEY);
      }
    }

    return () => {
      if (Storage.prototype.setItem === patchedSetItem) {
        Storage.prototype.setItem = originalSetItem;
      }
    };
  }, []);

  return null;
}
