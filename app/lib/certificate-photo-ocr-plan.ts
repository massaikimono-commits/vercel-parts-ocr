export type CertificateFieldKey =
  | "recordDate"
  | "documentNumber"
  | "registrationNumber"
  | "chassisNumber"
  | "registrationDate"
  | "firstRegistration"
  | "inspectionExpiry"
  | "userName"
  | "userAddress"
  | "baseLocation"
  | "vehicleName"
  | "model"
  | "engineModel"
  | "vehicleClass"
  | "purpose"
  | "privateBusiness"
  | "bodyShape"
  | "seatingCapacity"
  | "maxPayloadKg"
  | "vehicleWeightKg"
  | "grossVehicleWeightKg"
  | "lengthCm"
  | "widthCm"
  | "heightCm"
  | "frontFrontAxleWeightKg"
  | "frontRearAxleWeightKg"
  | "rearFrontAxleWeightKg"
  | "rearRearAxleWeightKg"
  | "displacementOrRatedOutput"
  | "fuel"
  | "modelDesignationNumber"
  | "classificationNumber";

export type PhotoOcrPlan = {
  mode: "qr-only" | "targeted" | "full-fallback";
  qrWaitMs: number;
  fields: CertificateFieldKey[];
  runGlobalOcr: boolean;
  reason: string;
};

const CORE: CertificateFieldKey[] = [
  "registrationNumber",
  "chassisNumber",
  "registrationDate",
  "firstRegistration",
  "inspectionExpiry",
  "model",
  "vehicleWeightKg",
  "grossVehicleWeightKg",
];

const ALL: CertificateFieldKey[] = [
  "recordDate","documentNumber","registrationNumber","chassisNumber","registrationDate","firstRegistration","inspectionExpiry",
  "userName","userAddress","baseLocation","vehicleName","model","engineModel","vehicleClass","purpose","privateBusiness","bodyShape",
  "seatingCapacity","maxPayloadKg","vehicleWeightKg","grossVehicleWeightKg","lengthCm","widthCm","heightCm","frontFrontAxleWeightKg",
  "frontRearAxleWeightKg","rearFrontAxleWeightKg","rearRearAxleWeightKg","displacementOrRatedOutput","fuel","modelDesignationNumber","classificationNumber",
];

function hasValue(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

/**
 * QR-first planner for vehicle-certificate photos.
 *
 * Performance rule:
 * - do not OCR 30+ cells before checking QR
 * - wait only a short bounded period for QR
 * - if QR supplies most fields, OCR only missing/low-confidence cells
 * - reserve whole-page OCR for poor QR coverage or failed targeted OCR
 */
export function planCertificatePhotoOcr(qr: Record<string, unknown> | null | undefined): PhotoOcrPlan {
  const source = qr || {};
  const present = ALL.filter((key) => hasValue(source[key]));
  const missing = ALL.filter((key) => !hasValue(source[key]));
  const missingCore = CORE.filter((key) => !hasValue(source[key]));

  // Strong QR coverage: no expensive whole-page OCR. We still target fields that
  // are normally not encoded in the available QR set (e.g. user/registration/chassis
  // depending on which QR symbol failed).
  if (present.length >= 10 && missingCore.length <= 3) {
    return {
      mode: missing.length ? "targeted" : "qr-only",
      qrWaitMs: 1200,
      fields: missing,
      runGlobalOcr: false,
      reason: `QR coverage strong (${present.length} fields); OCR only ${missing.length} missing fields.`,
    };
  }

  // Partial QR: targeted OCR for all missing fields first. A caller may escalate
  // only when those targeted reads fail validation.
  if (present.length >= 4) {
    return {
      mode: "targeted",
      qrWaitMs: 1500,
      fields: missing,
      runGlobalOcr: false,
      reason: `QR coverage partial (${present.length} fields); targeted OCR before any global fallback.`,
    };
  }

  // Very weak/no QR: full fallback is justified, but still after a bounded QR wait.
  return {
    mode: "full-fallback",
    qrWaitMs: 800,
    fields: ALL,
    runGlobalOcr: true,
    reason: `QR coverage weak (${present.length} fields); full OCR fallback allowed.`,
  };
}

export const CERTIFICATE_PHOTO_PERFORMANCE_BUDGET = {
  qrOnlyMs: 2500,
  targetedMs: 8000,
  fullFallbackMs: 15000,
  maxQrWaitMs: 1500,
} as const;
