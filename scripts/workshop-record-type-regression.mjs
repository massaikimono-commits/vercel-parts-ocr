const supported = new Set([
  "APPENDIX_3_BUSINESS",
  "APPENDIX_5_PRIVATE_TRUCK",
  "APPENDIX_6_PRIVATE_PASSENGER",
]);

function decideInspectionTemplate(input) {
  const haystack = [input.usage, input.vehicleType, input.purpose].filter(Boolean).join(" ").toLowerCase();
  const motorcycle = input.isMotorcycle === true || /二輪|motorcycle|bike/.test(haystack);
  const trailer = input.isTrailer === true || /被牽引|トレーラ|trailer/.test(haystack);
  const rental = input.rentalUse === true || /貸渡|レンタ/.test(haystack);
  const business = input.businessUse === true || /事業用|営業用/.test(haystack);
  const cargo = /貨物|トラック|truck|cargo/.test(haystack);
  const passenger = /乗用|乗車|passenger/.test(haystack);

  if (trailer) return { key: "APPENDIX_4_TRAILER", label: "別表4" };
  if (motorcycle && rental) return { key: "APPENDIX_5_2_RENTAL_MOTORCYCLE", label: "別表5の2" };
  if (motorcycle) return { key: "APPENDIX_7_MOTORCYCLE", label: "別表7" };
  if (input.isLightCargoBusiness === true) return { key: "APPENDIX_6_PRIVATE_PASSENGER", label: "別表6", needsReview: true };
  if (business) return { key: "APPENDIX_3_BUSINESS", label: "別表3", needsReview: true };
  if (cargo) return { key: "APPENDIX_5_PRIVATE_TRUCK", label: "別表5", needsReview: true };
  if (passenger) return { key: "APPENDIX_6_PRIVATE_PASSENGER", label: "別表6", needsReview: false };
  return { key: "UNDETERMINED", label: "未判定", needsReview: true };
}

function decideWorkshop(input) {
  if (input.forceScheduleCheck || /スケジュール\s*点検|schedule\s*check/i.test(input.workReason || "")) {
    return { key: "SCHEDULE_CHECK", needsReview: false };
  }
  const legal = decideInspectionTemplate(input.vehicle || {});
  if (supported.has(legal.key)) return { key: legal.key, needsReview: Boolean(legal.needsReview) };
  return { key: null, needsReview: true, legalKey: legal.key };
}

const cases = [
  ["schedule check wins over vehicle type", { workReason: "スケジュール点検", vehicle: { purpose: "乗用" } }, "SCHEDULE_CHECK", false],
  ["business uses appendix 3", { vehicle: { businessUse: true } }, "APPENDIX_3_BUSINESS", true],
  ["private cargo uses appendix 5", { vehicle: { purpose: "自家用貨物" } }, "APPENDIX_5_PRIVATE_TRUCK", true],
  ["private passenger uses appendix 6", { vehicle: { purpose: "自家用乗用" } }, "APPENDIX_6_PRIVATE_PASSENGER", false],
  ["light cargo exception remains appendix 6 and reviewable", { vehicle: { isLightCargoBusiness: true } }, "APPENDIX_6_PRIVATE_PASSENGER", true],
  ["trailer is not silently mapped", { vehicle: { isTrailer: true } }, null, true],
  ["motorcycle is not silently mapped", { vehicle: { isMotorcycle: true } }, null, true],
  ["unknown vehicle requires review", { vehicle: {} }, null, true],
];

let failed = 0;
for (const [name, input, expectedKey, expectedReview] of cases) {
  const actual = decideWorkshop(input);
  if (actual.key !== expectedKey || actual.needsReview !== expectedReview) {
    failed += 1;
    console.error("FAIL", name, { expectedKey, expectedReview, actual });
  } else {
    console.log("PASS", name);
  }
}

if (failed) {
  console.error(`\n${failed}/${cases.length} workshop record-type case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} workshop record-type case(s) passed.`);
