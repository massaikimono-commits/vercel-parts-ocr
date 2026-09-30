// Generic row-semantic helpers for vehicle-certificate PDF text layers.
// This module deliberately contains no registration-number, chassis-number,
// vehicle-specific coordinate, or GT-driven special cases.

export function normalizePdfText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function compactPdfText(value) {
  return normalizePdfText(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
}

export function clusterPhysicalRows(tokens, tolerance = 0.012) {
  const rows = [];
  for (const token of [...(tokens || [])].filter((v) => v && normalizePdfText(v.text)).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const dynamic = Math.max(tolerance, Number(token.h || 0) * 0.72);
    let row = rows.find((candidate) => Math.abs(candidate.y - token.y) <= dynamic);
    if (!row) {
      row = { y: token.y, tokens: [] };
      rows.push(row);
    }
    row.tokens.push(token);
    row.y = row.tokens.reduce((sum, value) => sum + Number(value.y || 0), 0) / row.tokens.length;
  }
  for (const row of rows) {
    row.tokens.sort((a, b) => a.x - b.x);
    row.text = row.tokens.map((token) => normalizePdfText(token.text)).filter(Boolean).join(" ");
  }
  return rows.sort((a, b) => a.y - b.y);
}

export function rowHasLabels(row, labels) {
  const dense = compactPdfText(row?.text || "");
  return labels.every((label) => dense.includes(compactPdfText(label)));
}

export function findSemanticRow(rows, requiredLabels) {
  return (rows || []).find((row) => rowHasLabels(row, requiredLabels)) || null;
}

function valuesInNextRow(rows, header, maxDy = 0.045) {
  if (!header) return null;
  return (rows || [])
    .filter((row) => row.y > header.y + 0.001 && row.y - header.y <= maxDy)
    .sort((a, b) => a.y - b.y)[0] || null;
}

function numericValues(text, unit) {
  const normalized = normalizePdfText(text).replace(/,/g, "");
  const suffix = unit === "kg" ? "kg" : unit === "cm" ? "cm" : "(?:L|kW|KW)";
  return [...normalized.matchAll(new RegExp(`(-|\\d+(?:\\.\\d+)?)\\s*${suffix}`, "gi"))].map((m) => m[1]);
}

export function parseTwoAxleVehicleRows(rows) {
  const patch = {};
  const weightHeader = findSemanticRow(rows, ["車両重量", "車両総重量", "長さ", "幅", "高さ"]);
  const weightValues = valuesInNextRow(rows, weightHeader);
  if (weightValues) {
    const kg = numericValues(weightValues.text, "kg");
    const cm = numericValues(weightValues.text, "cm");
    if (kg.length >= 2) {
      patch.vehicleWeightKg = kg[0] === "-" ? "-" : String(Number(kg[0]));
      patch.grossVehicleWeightKg = kg[1] === "-" ? "-" : String(Number(kg[1]));
    }
    if (cm.length >= 3) {
      patch.lengthCm = String(Number(cm[0]));
      patch.widthCm = String(Number(cm[1]));
      patch.heightCm = String(Number(cm[2]));
    }
  }

  const axleHeader = findSemanticRow(rows, ["前軸重", "後軸重", "総排気量又は定格出力"]);
  const axleValues = valuesInNextRow(rows, axleHeader);
  if (axleValues) {
    const kg = numericValues(axleValues.text, "kg");
    const output = normalizePdfText(axleValues.text).match(/(\d+(?:\.\d+)?)\s*(L|kW|KW)\b/i);
    if (kg.length >= 2) {
      patch.frontFrontAxleWeightKg = String(Number(kg[0]));
      patch.rearRearAxleWeightKg = String(Number(kg[1]));
    }
    if (output) patch.displacementOrRatedOutput = `${output[1]} ${output[2].toUpperCase()}`;
  }

  const fuelHeader = findSemanticRow(rows, ["燃料の種類", "型式指定番号", "類別区分番号"]);
  const fuelValues = valuesInNextRow(rows, fuelHeader);
  if (fuelValues) {
    const text = normalizePdfText(fuelValues.text);
    const fuel = ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"].find((v) => text.includes(v));
    if (fuel) patch.fuel = fuel;
    const codes = text.match(/\b\d{4,6}\b/g) || [];
    if (codes.length >= 2) {
      patch.modelDesignationNumber = codes[0];
      patch.classificationNumber = codes[1];
    }
  }
  return patch;
}

export function detectAxleLayout(rows) {
  if (findSemanticRow(rows, ["前前軸重", "後後軸重"])) return "four-axis";
  if (findSemanticRow(rows, ["前軸重", "後軸重"])) return "two-axis";
  return "unknown";
}
