export type InspectionTemplateKey =
  | "APPENDIX_3_BUSINESS"
  | "APPENDIX_4_TRAILER"
  | "APPENDIX_5_PRIVATE_TRUCK"
  | "APPENDIX_5_2_RENTAL_MOTORCYCLE"
  | "APPENDIX_6_PRIVATE_PASSENGER"
  | "APPENDIX_7_MOTORCYCLE"
  | "UNDETERMINED";

export type RecordFamily =
  | "INSPECTION_RECORD"
  | "SPECIFIC_MAINTENANCE_RECORD"
  | "DESIGNATED_MAINTENANCE_RECORD";

export type VehicleClassificationInput = {
  usage?: string | null;
  vehicleType?: string | null;
  purpose?: string | null;
  businessUse?: boolean | null;
  rentalUse?: boolean | null;
  isTrailer?: boolean | null;
  isMotorcycle?: boolean | null;
  isLightCargoBusiness?: boolean | null;
};

export type InspectionTemplateDecision = {
  key: InspectionTemplateKey;
  label: string;
  needsReview: boolean;
  reason: string;
};

const text = (input: VehicleClassificationInput) =>
  [input.usage, input.vehicleType, input.purpose].filter(Boolean).join(" ").toLowerCase();

/**
 * Conservative first-pass selector for the periodic inspection form family.
 * Ambiguous vehicles intentionally remain UNDETERMINED so the operator can confirm.
 * Legal/form revisions must be handled in the template layer rather than hard-coded
 * into inspection item storage.
 */
export function decideInspectionTemplate(input: VehicleClassificationInput): InspectionTemplateDecision {
  const haystack = text(input);
  const motorcycle = input.isMotorcycle === true || /二輪|motorcycle|bike/.test(haystack);
  const trailer = input.isTrailer === true || /被牽引|トレーラ|trailer/.test(haystack);
  const rental = input.rentalUse === true || /貸渡|レンタ/.test(haystack);
  const business = input.businessUse === true || /事業用|営業用/.test(haystack);
  const cargo = /貨物|トラック|truck|cargo/.test(haystack);
  const passenger = /乗用|乗車|passenger/.test(haystack);

  if (trailer) {
    return { key: "APPENDIX_4_TRAILER", label: "別表4（被牽引自動車系）", needsReview: false, reason: "被牽引自動車として判定" };
  }

  if (motorcycle && rental) {
    return { key: "APPENDIX_5_2_RENTAL_MOTORCYCLE", label: "別表5の2（貸渡用二輪系）", needsReview: false, reason: "貸渡用二輪として判定" };
  }

  if (motorcycle) {
    return { key: "APPENDIX_7_MOTORCYCLE", label: "別表7（二輪自動車系）", needsReview: false, reason: "二輪自動車として判定" };
  }

  // Light cargo business vehicles have special treatment in current MLIT guidance.
  // Keep the result reviewable until certificate fields needed for the legal exception
  // are fully mapped into the app.
  if (input.isLightCargoBusiness === true) {
    return { key: "APPENDIX_6_PRIVATE_PASSENGER", label: "別表6系（軽貨物事業用・要確認）", needsReview: true, reason: "軽貨物事業用の例外候補。初回は必ず確認" };
  }

  if (business) {
    return { key: "APPENDIX_3_BUSINESS", label: "別表3（事業用自動車等）", needsReview: true, reason: "事業用として判定。用途・車種の例外確認が必要" };
  }

  if (cargo) {
    return { key: "APPENDIX_5_PRIVATE_TRUCK", label: "別表5（自家用貨物自動車等）", needsReview: true, reason: "貨物用途として判定。初回は車検証情報で確認" };
  }

  if (passenger) {
    return { key: "APPENDIX_6_PRIVATE_PASSENGER", label: "別表6（自家用乗用自動車等）", needsReview: false, reason: "乗用用途として判定" };
  }

  return { key: "UNDETERMINED", label: "記録簿種類を確認", needsReview: true, reason: "判定に必要な用途・車種情報が不足" };
}

export function requiredRecordFamilies(options: {
  periodicInspection?: boolean;
  specificMaintenance?: boolean;
  designatedInspection?: boolean;
}): RecordFamily[] {
  const result: RecordFamily[] = [];
  if (options.periodicInspection) result.push("INSPECTION_RECORD");
  if (options.specificMaintenance) result.push("SPECIFIC_MAINTENANCE_RECORD");
  if (options.designatedInspection) result.push("DESIGNATED_MAINTENANCE_RECORD");
  return result;
}
