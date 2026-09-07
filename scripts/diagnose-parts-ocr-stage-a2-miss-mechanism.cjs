#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function arg(name, fallback = "") {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const gtPath = arg("gt");
const candidatesPath = arg("candidates");
const outPath = arg("out");
if (!gtPath || !candidatesPath) {
  throw new Error(
    "usage: node scripts/diagnose-parts-ocr-stage-a2-miss-mechanism.cjs --gt <gt.json> --candidates <candidate.json> [--out <result.json>]",
  );
}

const gt = JSON.parse(fs.readFileSync(gtPath, "utf8"));
const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));

const EXPECTED_FILES = Array.from({ length: 12 }, (_, i) => `IMG_${String(675 + i).padStart(4, "0")}(1)`);
const EXPECTED_HEAD = "6a31ec4b9028410e90a8dbd9c8b40d53de7742d2";

if (
  gt.schema !== "icb.parts-ocr.row-gt.v1" ||
  gt.variant !== "yellow-delivery" ||
  gt.evaluationSet !== "formal-yellow-12"
) throw new Error("unexpected GT identity");

if (
  candidates.schema !== "icb.parts-ocr.stage-a-candidates.v1" ||
  candidates.sourceHead !== EXPECTED_HEAD
) throw new Error("unexpected candidate identity");

const gtMap = new Map(gt.images.map((x) => [x.fileName, x]));
const candidateMap = new Map(candidates.images.map((x) => [x.fileName, x]));
for (const fileName of EXPECTED_FILES) {
  if (!gtMap.has(fileName) || !candidateMap.has(fileName)) throw new Error("missing image " + fileName);
}

const gtTotalRows = EXPECTED_FILES.reduce(
  (sum, fileName) => sum + Number(gtMap.get(fileName).rowCount || 0),
  0,
);
if (gtTotalRows !== 54) throw new Error("GT total must be 54");

const EPS = 1e-6;
const nearly = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

function normalizeRotation(value) {
  return ((Number(value || 0) % 360) + 360) % 360;
}

function validateDimension(fileName, g, c) {
  const rotationDeg = normalizeRotation(g.rotationDeg);
  const rawWidth = Number(c.raw.width);
  const rawHeight = Number(c.raw.height);
  const candidateRotatedWidth =
    rotationDeg === 90 || rotationDeg === 270 ? rawHeight : rawWidth;
  const candidateRotatedHeight =
    rotationDeg === 90 || rotationDeg === 270 ? rawWidth : rawHeight;
  const gtWidth = Number(g.imageWidth);
  const gtHeight = Number(g.imageHeight);
  const scaleX = gtWidth / candidateRotatedWidth;
  const scaleY = gtHeight / candidateRotatedHeight;
  const exactDimensionMatch =
    gtWidth === candidateRotatedWidth && gtHeight === candidateRotatedHeight;
  const aspectRatioMatch = nearly(
    gtWidth / gtHeight,
    candidateRotatedWidth / candidateRotatedHeight,
  );
  const uniformScale =
    scaleX > 0 && scaleY > 0 && nearly(scaleX, scaleY) && aspectRatioMatch;

  if (!exactDimensionMatch && !uniformScale) {
    throw new Error(`${fileName}: incompatible dimensions`);
  }

  return {
    gtWidth,
    gtHeight,
    candidateRawWidth: rawWidth,
    candidateRawHeight: rawHeight,
    rotationDeg,
    candidateRotatedWidth,
    candidateRotatedHeight,
    exactDimensionMatch,
    scaleX,
    scaleY,
    uniformScale,
    aspectRatioMatch,
    dimensionMappingMode: exactDimensionMatch
      ? "exact-dimension-match"
      : "uniform-scale-normalized-space",
  };
}

const dimensions = EXPECTED_FILES.map((fileName) => ({
  fileName,
  ...validateDimension(fileName, gtMap.get(fileName), candidateMap.get(fileName)),
}));

const scaleFactors = dimensions.map((d) =>
  d.exactDimensionMatch ? 1 : (d.scaleX + d.scaleY) / 2,
);
const commonScaleFactor = scaleFactors[0];
const allImagesUniformScaleCompatible =
  dimensions.every((d) => d.exactDimensionMatch || d.uniformScale) &&
  scaleFactors.every((value) => nearly(value, commonScaleFactor));

if (!allImagesUniformScaleCompatible) {
  throw new Error("formal set scale mismatch");
}

function rawToGtPoint(x, y, rawWidth, rawHeight, rotationDeg) {
  const r = normalizeRotation(rotationDeg);
  if (r === 0) return { x, y, width: rawWidth, height: rawHeight };
  if (r === 90) return { x: rawHeight - y, y: x, width: rawHeight, height: rawWidth };
  if (r === 180) {
    return {
      x: rawWidth - x,
      y: rawHeight - y,
      width: rawWidth,
      height: rawHeight,
    };
  }
  if (r === 270) return { x: y, y: rawWidth - x, width: rawHeight, height: rawWidth };
  throw new Error("bad rotation");
}

function candidateToRawPoint(x, y, image) {
  const rawWidth = Number(image.raw.width);
  const rawHeight = Number(image.raw.height);
  const geometryWidth = Number(image.candidateGeometry.width);
  const geometryHeight = Number(image.candidateGeometry.height);
  const autoRotate90CCW = Boolean(image.autoRotate90CCW);

  const sourceWidth = autoRotate90CCW ? rawHeight : rawWidth;
  const sourceHeight = autoRotate90CCW ? rawWidth : rawHeight;
  const scaleX = geometryWidth / sourceWidth;
  const scaleY = geometryHeight / sourceHeight;

  return autoRotate90CCW
    ? { x: (geometryHeight - y) / scaleY, y: x / scaleX }
    : { x: x / scaleX, y: y / scaleY };
}

function mapRow(row, paper, image, rotationDeg) {
  const x1 = Number(paper.x);
  const x2 = x1 + Number(paper.w);
  const y1 = Number(row.top);
  const y2 = Number(row.bottom) + 1;

  const corners = [
    [x1, y1],
    [x2, y1],
    [x1, y2],
    [x2, y2],
  ].map(([x, y]) => {
    const raw = candidateToRawPoint(x, y, image);
    return rawToGtPoint(
      raw.x,
      raw.y,
      Number(image.raw.width),
      Number(image.raw.height),
      rotationDeg,
    );
  });

  const centerRaw = candidateToRawPoint(
    x1 + Number(paper.w) / 2,
    (y1 + y2) / 2,
    image,
  );
  const center = rawToGtPoint(
    centerRaw.x,
    centerRaw.y,
    Number(image.raw.width),
    Number(image.raw.height),
    rotationDeg,
  );

  const displayHeight = center.height;
  const mappedY1 = Math.min(...corners.map((p) => p.y)) / displayHeight;
  const mappedY2 = Math.max(...corners.map((p) => p.y)) / displayHeight;

  return {
    candidateIndex: Number(row.index),
    source: row.source || "",
    y1Norm: mappedY1,
    y2Norm: mappedY2,
    centerYNorm: center.y / displayHeight,
    rowHeightNorm: mappedY2 - mappedY1,
  };
}

function assign(rows, paper, image, g, variant) {
  const gtRows = (g.rows || []).map((r, i) => ({
    rowIndex: Number(r.rowIndex || i + 1),
    y1Norm: Number(r.y1Norm),
    y2Norm: Number(r.y2Norm),
    centerYNorm: (Number(r.y1Norm) + Number(r.y2Norm)) / 2,
  }));
  const perGt = new Map(gtRows.map((r) => [r.rowIndex, []]));

  const mapped = (rows || []).map((row) => {
    const m = mapRow(row, paper, image, g.rotationDeg);
    const containing = gtRows.filter(
      (gtRow) => m.centerYNorm >= gtRow.y1Norm && m.centerYNorm <= gtRow.y2Norm,
    );
    let match = null;
    if (containing.length) {
      match = containing
        .map((gtRow) => ({
          gtRow,
          distance: Math.abs(m.centerYNorm - gtRow.centerYNorm),
        }))
        .sort((a, b) => a.distance - b.distance)[0].gtRow;
    }
    if (match) perGt.get(match.rowIndex).push(m);

    return {
      ...m,
      matchedGtRowIndex: match ? match.rowIndex : null,
      gtCentersInsideInterval: gtRows
        .filter(
          (gtRow) =>
            m.y1Norm <= gtRow.centerYNorm && gtRow.centerYNorm <= m.y2Norm,
        )
        .map((gtRow) => gtRow.rowIndex),
    };
  });

  const covered = gtRows
    .filter((gtRow) => perGt.get(gtRow.rowIndex).length)
    .map((gtRow) => gtRow.rowIndex);
  const uncovered = gtRows
    .filter((gtRow) => !perGt.get(gtRow.rowIndex).length)
    .map((gtRow) => gtRow.rowIndex);

  return {
    variant,
    gtRows,
    perGt,
    mapped,
    candidateCount: mapped.length,
    coverage: covered.length,
    covered,
    uncovered,
    falseCount: mapped.filter((row) => row.matchedGtRowIndex == null).length,
    duplicateCount: gtRows.reduce(
      (sum, gtRow) => sum + Math.max(0, perGt.get(gtRow.rowIndex).length - 1),
      0,
    ),
    mergeSuspicions: mapped
      .filter((row) => row.gtCentersInsideInterval.length >= 2)
      .map((row) => ({
        candidateIndex: row.candidateIndex,
        gtCentersInside: row.gtCentersInsideInterval,
        y1Norm: row.y1Norm,
        y2Norm: row.y2Norm,
        centerYNorm: row.centerYNorm,
      })),
  };
}

function relationForNearest(nearest, gtRow) {
  if (!nearest) return "dynamic-zero";
  if (
    nearest.matchedGtRowIndex != null &&
    nearest.matchedGtRowIndex !== gtRow.rowIndex
  ) {
    return `assigned-to-GT-${nearest.matchedGtRowIndex}`;
  }

  const overlap = Math.max(
    0,
    Math.min(nearest.y2Norm, gtRow.y2Norm) -
      Math.max(nearest.y1Norm, gtRow.y1Norm),
  );

  if (nearest.matchedGtRowIndex == null && overlap > 0) {
    return "candidate-band-overlaps-but-center-outside";
  }
  if (nearest.matchedGtRowIndex == null) return "candidate-band-outside";
  return "same-GT";
}

function regionMissing(covered, gtCount) {
  if (!covered.length || covered.length === gtCount) return [];
  const result = [];
  const min = Math.min(...covered);
  const max = Math.max(...covered);
  if (min > 1) result.push(`upper-rows-1-${min - 1}`);
  if (max < gtCount) result.push(`lower-rows-${max + 1}-${gtCount}`);
  return result;
}

const perImage = [];
const aggregate = { A: 0, B: 0, C: 0, D: 0 };

for (const fileName of EXPECTED_FILES) {
  const g = gtMap.get(fileName);
  const c = candidateMap.get(fileName);
  const dimension = dimensions.find((d) => d.fileName === fileName);

  if (Number(g.rowCount) !== (g.rows || []).length) {
    throw new Error(fileName + ": rowCount mismatch");
  }

  const fixed = assign(c.fixedRows, c.fixedPaper, c, g, "fixed");
  const dynamic = assign(c.dynamicRows, c.dynamicPaper, c, g, "dynamic");

  const rows = [];
  const bRows = [];
  const counts = { A: 0, B: 0, C: 0, D: 0 };

  for (const gtRow of fixed.gtRows) {
    const fixedCandidates = fixed.perGt.get(gtRow.rowIndex) || [];
    const dynamicCandidates = dynamic.perGt.get(gtRow.rowIndex) || [];
    const classification =
      fixedCandidates.length && dynamicCandidates.length
        ? "A"
        : fixedCandidates.length
          ? "B"
          : dynamicCandidates.length
            ? "C"
            : "D";

    counts[classification] += 1;
    aggregate[classification] += 1;

    rows.push({
      rowIndex: gtRow.rowIndex,
      classification,
      fixedCandidateIndices: fixedCandidates.map((x) => x.candidateIndex),
      dynamicCandidateIndices: dynamicCandidates.map((x) => x.candidateIndex),
    });

    if (classification === "B") {
      const nearestDynamic = dynamic.mapped.length
        ? [...dynamic.mapped].sort(
            (a, b) =>
              Math.abs(a.centerYNorm - gtRow.centerYNorm) -
              Math.abs(b.centerYNorm - gtRow.centerYNorm),
          )[0]
        : null;

      bRows.push({
        gtRowIndex: gtRow.rowIndex,
        gtY1Norm: gtRow.y1Norm,
        gtY2Norm: gtRow.y2Norm,
        gtCenterYNorm: gtRow.centerYNorm,
        fixedCandidates: fixedCandidates.map((x) => ({
          candidateIndex: x.candidateIndex,
          centerYNorm: x.centerYNorm,
          rowHeightNorm: x.rowHeightNorm,
        })),
        nearestDynamic: nearestDynamic
          ? {
              candidateIndex: nearestDynamic.candidateIndex,
              centerYNorm: nearestDynamic.centerYNorm,
              rowHeightNorm: nearestDynamic.rowHeightNorm,
              distanceNorm: Math.abs(
                nearestDynamic.centerYNorm - gtRow.centerYNorm,
              ),
              matchedGtRowIndex: nearestDynamic.matchedGtRowIndex,
              relation: relationForNearest(nearestDynamic, gtRow),
            }
          : null,
        dynamicCandidateZero: dynamic.candidateCount === 0,
      });
    }
  }

  const mechanisms = [];
  if (dynamic.candidateCount < Number(g.rowCount)) {
    mechanisms.push({
      code: 1,
      label: "dynamic candidate itself insufficient",
    });
  }
  if (dynamic.falseCount > 0 && dynamic.coverage < Number(g.rowCount)) {
    mechanisms.push({
      code: 2,
      label: "candidates exist but some centers fall outside GT rows",
    });
  }
  if (dynamic.mergeSuspicions.length) {
    mechanisms.push({
      code: 3,
      label: "one dynamic band contains multiple GT row centers (merge suspicion)",
    });
  }

  const missingRegions = regionMissing(dynamic.covered, Number(g.rowCount));
  if (missingRegions.length) {
    mechanisms.push({
      code: 4,
      label: "specific upper/lower row region missing",
      regions: missingRegions,
    });
  }

  if (counts.D > 0) {
    mechanisms.push({
      code: 5,
      label: "rows missed by both fixed and dynamic",
    });
  }

  if (dynamic.coverage > fixed.coverage) {
    mechanisms.push({
      code: 6,
      label: "dynamic improves over fixed",
    });
  }

  perImage.push({
    fileName,
    gtRowCount: Number(g.rowCount),
    dimension,
    abcd: counts,
    fixed: {
      candidateCount: fixed.candidateCount,
      coverage: fixed.coverage,
      falseCount: fixed.falseCount,
      duplicateCount: fixed.duplicateCount,
      covered: fixed.covered,
      uncovered: fixed.uncovered,
    },
    dynamic: {
      candidateCount: dynamic.candidateCount,
      coverage: dynamic.coverage,
      falseCount: dynamic.falseCount,
      duplicateCount: dynamic.duplicateCount,
      covered: dynamic.covered,
      uncovered: dynamic.uncovered,
      mergeSuspicions: dynamic.mergeSuspicions,
    },
    rows,
    bRows,
    missMechanismClassification: mechanisms,
  });
}

const result = {
  schema: "icb.parts-ocr.stage-a2-miss-mechanism.v1",
  sourceHead: candidates.sourceHead,
  gtSchema: gt.schema,
  evaluationSet: gt.evaluationSet,
  scoringRule:
    "geometry-only Stage A assignments; A/B/C/D from fixed/dynamic centerYNorm coverage; B nearest dynamic by absolute centerYNorm distance; no OCR text",
  allImagesUniformScaleCompatible,
  commonScaleFactor,
  dimensionMappingMode: dimensions.every((d) => d.exactDimensionMatch)
    ? "exact-dimension-match"
    : "uniform-scale-normalized-space",
  aggregate: {
    gtTotalRows,
    A: aggregate.A,
    B: aggregate.B,
    C: aggregate.C,
    D: aggregate.D,
  },
  perImage,
};

const f6 = (n) => Number(n).toFixed(6);
const lines = [];
lines.push(
  `Stage A2 GT classification: A=${aggregate.A} B=${aggregate.B} C=${aggregate.C} D=${aggregate.D} total=${gtTotalRows}`,
);

for (const image of perImage) {
  lines.push(
    `${image.fileName} GT=${image.gtRowCount} A/B/C/D=${image.abcd.A}/${image.abcd.B}/${image.abcd.C}/${image.abcd.D} dynamicCandidates=${image.dynamic.candidateCount} mechanisms=[${image.missMechanismClassification.map((m) => m.code).join(",") || "none"}]`,
  );

  for (const bRow of image.bRows) {
    lines.push(
      `  B row${bRow.gtRowIndex}: GTcenter=${f6(bRow.gtCenterYNorm)} fixed=[${bRow.fixedCandidates.map((x) => `${x.candidateIndex}@${f6(x.centerYNorm)} h=${f6(x.rowHeightNorm)}`).join(";")}] nearestDynamic=${bRow.nearestDynamic ? `${bRow.nearestDynamic.candidateIndex}@${f6(bRow.nearestDynamic.centerYNorm)} d=${f6(bRow.nearestDynamic.distanceNorm)} ${bRow.nearestDynamic.relation}` : "none(dynamic=0)"}`,
    );
  }
}

result.summary = lines.join("\n");

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
}

console.log(result.summary);
