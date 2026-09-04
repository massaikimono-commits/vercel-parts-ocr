import fs from "node:fs";

const src = fs.readFileSync("app/certificate-photo-critical-ocr-v2.jsx", "utf8");

function mustInclude(label, needle) {
  if (!src.includes(needle)) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

// 車台番号のOCR補完は、QRの存在だけで止めず、QRから値まで取得できた時だけ止める。
mustInclude(
  "chassis OCR stays gated when parsed QR chassis exists",
  "const needChassis = !qrPriority.chassisNumber && (!currentChassis || (fam && currentPrefix && currentPrefix !== fam));"
);

// 型式由来の既知ファミリーと一致する候補を最優先する。
mustInclude(
  "exact model family is strongly preferred for chassis prefix",
  "if (left === fam) s += 15;"
);

// OCRで車台番号の末尾数字が O/Q/I/| に化けても、数字として正規化する。
mustInclude(
  "numeric chassis serial fixes O/Q and I/pipe confusions",
  ".replace(/[OQ]/g, \"0\").replace(/[I|]/g, \"1\")"
);

// 型式ファミリーがOCRで末尾欠けした場合は、既知の型式側へ戻す。
mustInclude(
  "short chassis prefix can be reconciled to model family",
  "fam.endsWith(left) && fam.length - left.length <= 2"
);

console.log("photo chassis precision regression passed");
