const cases = [
  { name: "trailer", input: { isTrailer: true }, expected: "APPENDIX_4_TRAILER" },
  { name: "rental motorcycle", input: { isMotorcycle: true, rentalUse: true }, expected: "APPENDIX_5_2_RENTAL_MOTORCYCLE" },
  { name: "motorcycle", input: { vehicleType: "二輪" }, expected: "APPENDIX_7_MOTORCYCLE" },
  { name: "business vehicle", input: { usage: "事業用" }, expected: "APPENDIX_3_BUSINESS", review: true },
  { name: "private truck", input: { purpose: "貨物" }, expected: "APPENDIX_5_PRIVATE_TRUCK", review: true },
  { name: "private passenger", input: { purpose: "乗用" }, expected: "APPENDIX_6_PRIVATE_PASSENGER" },
  { name: "light cargo business exception", input: { isLightCargoBusiness: true }, expected: "APPENDIX_6_PRIVATE_PASSENGER", review: true },
  { name: "ambiguous remains manual", input: {}, expected: "UNDETERMINED", review: true },
];

function classify(input) {
  const haystack = [input.usage, input.vehicleType, input.purpose].filter(Boolean).join(" ").toLowerCase();
  const motorcycle = input.isMotorcycle === true || /二輪|motorcycle|bike/.test(haystack);
  const trailer = input.isTrailer === true || /被牽引|トレーラ|trailer/.test(haystack);
  const rental = input.rentalUse === true || /貸渡|レンタ/.test(haystack);
  const business = input.businessUse === true || /事業用|営業用/.test(haystack);
  const cargo = /貨物|トラック|truck|cargo/.test(haystack);
  const passenger = /乗用|乗車|passenger/.test(haystack);

  if (trailer) return { key: "APPENDIX_4_TRAILER", needsReview: false };
  if (motorcycle && rental) return { key: "APPENDIX_5_2_RENTAL_MOTORCYCLE", needsReview: false };
  if (motorcycle) return { key: "APPENDIX_7_MOTORCYCLE", needsReview: false };
  if (input.isLightCargoBusiness === true) return { key: "APPENDIX_6_PRIVATE_PASSENGER", needsReview: true };
  if (business) return { key: "APPENDIX_3_BUSINESS", needsReview: true };
  if (cargo) return { key: "APPENDIX_5_PRIVATE_TRUCK", needsReview: true };
  if (passenger) return { key: "APPENDIX_6_PRIVATE_PASSENGER", needsReview: false };
  return { key: "UNDETERMINED", needsReview: true };
}

let failed = 0;
for (const test of cases) {
  const actual = classify(test.input);
  const ok = actual.key === test.expected && (test.review === undefined || actual.needsReview === test.review);
  if (!ok) {
    failed += 1;
    console.error("FAIL", test.name, { expected: test.expected, actual });
  } else {
    console.log("PASS", test.name);
  }
}

if (failed) process.exit(1);
console.log(`All ${cases.length} record-type cases passed.`);
