import {
  decideInspectionTemplate,
  type InspectionTemplateDecision,
  type InspectionTemplateKey,
  type VehicleClassificationInput,
} from "./record-types";

export type WorkshopRecordTemplateKey =
  | "APPENDIX_3_BUSINESS"
  | "APPENDIX_5_PRIVATE_TRUCK"
  | "APPENDIX_6_PRIVATE_PASSENGER"
  | "SCHEDULE_CHECK";

export type WorkshopRecordTemplate = {
  key: WorkshopRecordTemplateKey;
  label: string;
  family: "STATUTORY" | "WORKSHOP_SCHEDULE";
  supportsPreviousPrintBaseline: boolean;
  currentPartsAreOneTimeOnly: boolean;
  paperSize: "A4";
  sourceFormat: "PDF";
};

export type WorkshopTemplateDecision = {
  key: WorkshopRecordTemplateKey | null;
  label: string;
  needsReview: boolean;
  reason: string;
  legalDecision?: InspectionTemplateDecision;
};

/**
 * The four non-designated record sheets currently used by the workshop.
 * The user-provided PDFs/images stay outside the public repository; only template
 * identities and behavior are kept here.
 */
export const WORKSHOP_RECORD_TEMPLATES: Record<WorkshopRecordTemplateKey, WorkshopRecordTemplate> = {
  APPENDIX_3_BUSINESS: {
    key: "APPENDIX_3_BUSINESS",
    label: "点検整備記録簿・特定整備記録簿（別表3系）",
    family: "STATUTORY",
    supportsPreviousPrintBaseline: true,
    currentPartsAreOneTimeOnly: true,
    paperSize: "A4",
    sourceFormat: "PDF",
  },
  APPENDIX_5_PRIVATE_TRUCK: {
    key: "APPENDIX_5_PRIVATE_TRUCK",
    label: "点検整備記録簿・特定整備記録簿（別表5系）",
    family: "STATUTORY",
    supportsPreviousPrintBaseline: true,
    currentPartsAreOneTimeOnly: true,
    paperSize: "A4",
    sourceFormat: "PDF",
  },
  APPENDIX_6_PRIVATE_PASSENGER: {
    key: "APPENDIX_6_PRIVATE_PASSENGER",
    label: "点検整備記録簿・特定整備記録簿（別表6系）",
    family: "STATUTORY",
    supportsPreviousPrintBaseline: true,
    currentPartsAreOneTimeOnly: true,
    paperSize: "A4",
    sourceFormat: "PDF",
  },
  SCHEDULE_CHECK: {
    key: "SCHEDULE_CHECK",
    label: "スケジュール点検 チェックシート",
    family: "WORKSHOP_SCHEDULE",
    supportsPreviousPrintBaseline: true,
    currentPartsAreOneTimeOnly: true,
    paperSize: "A4",
    sourceFormat: "PDF",
  },
};

const SUPPORTED_STATUTORY_KEYS = new Set<InspectionTemplateKey>([
  "APPENDIX_3_BUSINESS",
  "APPENDIX_5_PRIVATE_TRUCK",
  "APPENDIX_6_PRIVATE_PASSENGER",
]);

function isScheduleReason(reason?: string | null) {
  return /スケジュール\s*点検|schedule\s*check/i.test(reason || "");
}

/**
 * Select only among the four forms actually used in the workshop.
 * Unsupported legal form families are never silently mapped onto a different sheet.
 */
export function decideWorkshopRecordTemplate(input: {
  vehicle: VehicleClassificationInput;
  workReason?: string | null;
  forceScheduleCheck?: boolean;
}): WorkshopTemplateDecision {
  if (input.forceScheduleCheck === true || isScheduleReason(input.workReason)) {
    const template = WORKSHOP_RECORD_TEMPLATES.SCHEDULE_CHECK;
    return {
      key: template.key,
      label: template.label,
      needsReview: false,
      reason: "スケジュール点検として登録された作業",
    };
  }

  const legalDecision = decideInspectionTemplate(input.vehicle);
  if (SUPPORTED_STATUTORY_KEYS.has(legalDecision.key)) {
    const key = legalDecision.key as WorkshopRecordTemplateKey;
    return {
      key,
      label: WORKSHOP_RECORD_TEMPLATES[key].label,
      needsReview: legalDecision.needsReview,
      reason: legalDecision.reason,
      legalDecision,
    };
  }

  return {
    key: null,
    label: "使用記録簿を確認",
    needsReview: true,
    reason:
      legalDecision.key === "UNDETERMINED"
        ? legalDecision.reason
        : `${legalDecision.label} は現在の工場内4様式に自動割当しません。担当者確認が必要です。`,
    legalDecision,
  };
}
