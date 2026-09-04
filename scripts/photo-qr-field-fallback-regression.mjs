import fs from "node:fs";

const source = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

function expect(name, ok) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

expect(
  "registration OCR fallback depends on parsed QR value, not QR presence",
  /const needReg = !fieldValue\("自動車登録番号又は車両番号"\) && !qrPriority\.registrationNumber;/.test(source),
);

expect(
  "chassis OCR fallback depends on parsed QR value, not QR presence",
  /const needChassis = !qrPriority\.chassisNumber && \(!currentChassis \|\| \(fam && currentPrefix && currentPrefix !== fam\)\);/.test(source),
);

expect(
  "raw QR detection alone does not suppress registration/chassis fallback",
  !/const need(?:Reg|Chassis)[^\n]*haveCriticalQr/.test(source),
);

expect(
  "missing fuel is included in profile OCR fallback trigger",
  /const profileLabels = \[[\s\S]{0,220}"燃料の種類"[\s\S]{0,80}\];\s*const needProfile = profileLabels\.some/.test(source),
);

expect(
  "fuel OCR result maps back to the fuel field",
  /fuel:\s*"燃料の種類"/.test(source),
);

console.log("photo QR field fallback regression: ok");
