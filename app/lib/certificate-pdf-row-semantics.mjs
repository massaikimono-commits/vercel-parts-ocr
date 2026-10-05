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
  // Explicit label-to-cell ownership also covers PDFs that place label and
  // value on the same physical row. It supersedes positional next-row guesses.
  return { ...patch, ...parsePhysicalVehicleRows(rows) };
}

export function detectAxleLayout(rows) {
  if (findSemanticRow(rows, ["前前軸重", "後後軸重"])) return "four-axis";
  if (findSemanticRow(rows, ["前軸重", "後軸重"])) return "two-axis";
  return "unknown";
}

const FOUR_AXIS_FIELDS = [
  ["seatingCapacity", "乗車定員"], ["maxPayloadKg", "最大積載量"],
  ["vehicleWeightKg", "車両重量"], ["grossVehicleWeightKg", "車両総重量"],
  ["lengthCm", "長さ"], ["widthCm", "幅"], ["heightCm", "高さ"],
  ["frontFrontAxleWeightKg", "前前軸重"], ["frontRearAxleWeightKg", "前後軸重"],
  ["rearFrontAxleWeightKg", "後前軸重"], ["rearRearAxleWeightKg", "後後軸重"],
  ["frontFrontAxleWeightKg", "前軸重"], ["rearRearAxleWeightKg", "後軸重"],
  ["displacementOrRatedOutput", "総排気量又は定格出力"],
  ["fuel", "燃料の種類"], ["modelDesignationNumber", "型式指定番号"],
  ["classificationNumber", "類別区分番号"],
];

function physicalAnchors(row) {
  const tokens = row.tokens || [];
  const anchors = [];
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = "";
    for (let end = start; end < Math.min(tokens.length, start + 12); end += 1) {
      joined += compactPdfText(tokens[end].text);
      for (const [field, label] of FOUR_AXIS_FIELDS) {
        if (joined === compactPdfText(label) && !anchors.some((item) => item.field === field)) {
          anchors.push({ field, x: tokens[start].x, end });
        }
      }
      if (joined.length > 22) break;
    }
  }
  return anchors.sort((a, b) => a.x - b.x);
}

function columnTokens(rows, header, anchors, anchor) {
  const index = anchors.indexOf(anchor);
  const left = anchor.x;
  const right = index + 1 < anchors.length ? anchors[index + 1].x : 1;
  const below = valuesInNextRow(rows, header);
  const inHeader = header.tokens.filter((token, tokenIndex) =>
    token.x >= left && token.x < right && tokenIndex > anchor.end
  );
  if (inHeader.length || !below || physicalAnchors(below).length) return inHeader;
  return below.tokens.filter((token) => token.x >= left && token.x < right);
}

function parseColumn(field, tokens) {
  const text = normalizePdfText(tokens.map((token) => token.text).join(" "));
  if (field === "fuel") return ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"].find((value) => compactPdfText(text).includes(value)) || "";
  if (field === "displacementOrRatedOutput") {
    for (const token of tokens) {
      const match = normalizePdfText(token.text).match(/^(\d+(?:\.\d+)?)\s*(kW|L|ℓ)$/i);
      if (match) return `${match[1]} ${/^kW$/i.test(match[2]) ? "kW" : "L"}`;
    }
    const values = tokens.filter((token) => /^\d+(?:\.\d+)?$/.test(normalizePdfText(token.text)));
    const units = tokens.filter((token) => /^(?:kW|L|ℓ)$/i.test(normalizePdfText(token.text)));
    const pairs = values.flatMap((value) => units.map((unit) => ({ value, unit, dy: Math.abs(value.y - unit.y), dx: unit.x - value.x })))
      .filter((pair) => pair.dy <= .020 && pair.dx >= 0 && pair.dx <= .12)
      .sort((a, b) => a.dy - b.dy || a.dx - b.dx);
    const pair = pairs[0];
    return pair ? `${normalizePdfText(pair.value.text)} ${/^kW$/i.test(pair.unit.text) ? "kW" : "L"}` : "";
  }
  if (field === "maxPayloadKg" && /^\s*[-―ー]\s*(?:kg)?\s*$/i.test(text)) return "-";
  const match = text.replace(/,/g, "").match(/\b\d{1,5}\b/);
  if (!match) return "";
  const value = Number(match[0]);
  if (field === "seatingCapacity") return value >= 1 && value <= 99 ? String(value) : "";
  if (field === "classificationNumber") return /^\d{4}$/.test(match[0]) ? match[0] : "";
  if (field === "modelDesignationNumber") return /^\d{4,6}$/.test(match[0]) ? match[0] : "";
  if (field === "lengthCm") return value >= 100 && value <= 2000 ? String(value) : "";
  if (field === "widthCm") return value >= 100 && value <= 300 ? String(value) : "";
  if (field === "heightCm") return value >= 100 && value <= 450 ? String(value) : "";
  return value >= 1 && value <= 50000 ? String(value) : "";
}

function parsePhysicalVehicleRows(rows) {
  const patch = {};
  for (const header of rows || []) {
    const anchors = physicalAnchors(header);
    if (anchors.length < 2) continue;
    for (const anchor of anchors) {
      if (patch[anchor.field]) continue;
      const value = parseColumn(anchor.field, columnTokens(rows, header, anchors, anchor));
      if (value) patch[anchor.field] = value;
    }
  }
  return patch;
}

export function parseFourAxleVehicleRows(rows) {
  return parsePhysicalVehicleRows(rows);
}
