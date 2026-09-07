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
  throw new Error("usage: node scripts/score-parts-ocr-stage-a-row-coverage.cjs --gt <accepted-row-gt.json> --candidates <candidate-geometry.json> [--out <result.json>]");
}

const gt = JSON.parse(fs.readFileSync(gtPath, "utf8"));
const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));

const EXPECTED_FILES = Array.from({ length: 12 }, (_, i) => `IMG_${String(675 + i).padStart(4, "0")}(1)`);
const EXPECTED_SOURCE_HEAD = "6a31ec4b9028410e90a8dbd9c8b40d53de7742d2";

if (gt.schema !== "icb.parts-ocr.row-gt.v1") throw new Error("unexpected GT schema: " + gt.schema);
if (gt.variant !== "yellow-delivery") throw new Error("unexpected GT variant: " + gt.variant);
if (gt.evaluationSet !== "formal-yellow-12") throw new Error("unexpected GT evaluationSet: " + gt.evaluationSet);
if (!Array.isArray(gt.images)) throw new Error("GT images[] is required");
if (candidates.schema !== "icb.parts-ocr.stage-a-candidates.v1") throw new Error("unexpected candidate schema: " + candidates.schema);
if (candidates.sourceHead !== EXPECTED_SOURCE_HEAD) throw new Error("candidate source HEAD mismatch: " + candidates.sourceHead);
if (!Array.isArray(candidates.images)) throw new Error("candidate images[] is required");

const gtMap = new Map(gt.images.map((x) => [x.fileName, x]));
const candidateMap = new Map(candidates.images.map((x) => [x.fileName, x]));

for (const fileName of EXPECTED_FILES) {
  if (!gtMap.has(fileName)) throw new Error("missing GT image: " + fileName);
  if (!candidateMap.has(fileName)) throw new Error("missing candidate image: " + fileName);
}

const gtTotalRows = EXPECTED_FILES.reduce((sum, fileName) => sum + Number(gtMap.get(fileName).rowCount || 0), 0);
if (gtTotalRows !== 54) throw new Error("accepted GT total must be 54 rows, got " + gtTotalRows);

function normalizeRotation(value) {
  const n = Number(value || 0);
  return ((n % 360) + 360) % 360;
}

function rawToGtPoint(rawX, rawY, rawWidth, rawHeight, rotationDeg) {
  const r = normalizeRotation(rotationDeg);
  if (r === 0) return { x: rawX, y: rawY, width: rawWidth, height: rawHeight };
  if (r === 90) return { x: rawHeight - rawY, y: rawX, width: rawHeight, height: rawWidth };
  if (r === 180) return { x: rawWidth - rawX, y: rawHeight - rawY, width: rawWidth, height: rawHeight };
  if (r === 270) return { x: rawY, y: rawWidth - rawX, width: rawHeight, height: rawWidth };
  throw new Error("rotationDeg must be 0/90/180/270, got " + rotationDeg);
}

function candidateToRawPoint(x, y, image) {
  const rawWidth = Number(image.raw.width);
  const rawHeight = Number(image.raw.height);
  const geometryWidth = Number(image.candidateGeometry.width);
  const geometryHeight = Number(image.candidateGeometry.height);
  const autoRotate = Boolean(image.autoRotate90CCW);
  const sourceWidth = autoRotate ? rawHeight : rawWidth;
  const sourceHeight = autoRotate ? rawWidth : rawHeight;
  const sx = geometryWidth / sourceWidth;
  const sy = geometryHeight / sourceHeight;

  if (!autoRotate) {
    return { x: x / sx, y: y / sy };
  }

  // transfer.ts: translate(0, canvas.height) + rotate(-90deg)
  // raw -> candidate: x'=rawY*sx, y'=canvasHeight-rawX*sy
  return {
    x: (geometryHeight - y) / sy,
    y: x / sx,
  };
}

function candidateRectInGt(row, paper, image, rotationDeg) {
  const x1 = Number(paper.x);
  const x2 = Number(paper.x) + Number(paper.w);
  const y1 = Number(row.top);
  const y2 = Number(row.bottom) + 1;
  const corners = [
    [x1, y1],
    [x2, y1],
    [x1, y2],
    [x2, y2],
  ].map(([x, y]) => {
    const raw = candidateToRawPoint(x, y, image);
    return rawToGtPoint(raw.x, raw.y, Number(image.raw.width), Number(image.raw.height), rotationDeg);
  });

  const centerRaw = candidateToRawPoint(
    Number(paper.x) + Number(paper.w) / 2,
    (Number(row.top) + Number(row.bottom) + 1) / 2,
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
  const yMin = Math.min(...corners.map((p) => p.y));
  const yMax = Math.max(...corners.map((p) => p.y));

  return {
    y1Norm: Math.max(0, Math.min(1, yMin / displayHeight)),
    y2Norm: Math.max(0, Math.min(1, yMax / displayHeight)),
    centerYNorm: Math.max(0, Math.min(1, center.y / displayHeight)),
    displayHeight,
  };
}

/*
Stage A assignment rule (geometry-only, no OCR text, no tunable threshold):
- Transform every candidate center into the exact user-annotated rotated display image space.
- A candidate matches a GT row iff the transformed candidate center Y lies inside that GT row's [y1Norm,y2Norm].
- If malformed/overlapping GT bands contain the same center, assign to the nearest GT center.
- covered GT row = at least one assigned candidate.
- false candidate = no GT band contains candidate center.
- duplicate candidate = every assigned candidate beyond the first for the same GT row.
The transformed candidate rectangle Y projection is also recorded for audit, but is not used to tune/choose candidates.
*/
function scoreVariant(rows, paper, image, gtImage, variant) {
  const gtRows = (gtImage.rows || []).map((r, i) => ({
    rowIndex: Number(r.rowIndex || i + 1),
    y1Norm: Number(r.y1Norm),
    y2Norm: Number(r.y2Norm),
  }));
  const assigned = new Map(gtRows.map((r) => [r.rowIndex, []]));
  const falseCandidates = [];
  const mappedCandidates = [];

  for (const row of rows) {
    const mapped = candidateRectInGt(row, paper, image, gtImage.rotationDeg);
    const containing = gtRows.filter((g) => mapped.centerYNorm >= g.y1Norm && mapped.centerYNorm <= g.y2Norm);
    let match = null;
    if (containing.length) {
      match = containing
        .map((g) => ({ g, d: Math.abs(mapped.centerYNorm - (g.y1Norm + g.y2Norm) / 2) }))
        .sort((a, b) => a.d - b.d)[0].g;
      assigned.get(match.rowIndex).push(row.index);
    } else {
      falseCandidates.push(row.index);
    }
    mappedCandidates.push({
      candidateIndex: row.index,
      source: row.source || variant,
      mappedY1Norm: +mapped.y1Norm.toFixed(6),
      mappedY2Norm: +mapped.y2Norm.toFixed(6),
      mappedCenterYNorm: +mapped.centerYNorm.toFixed(6),
      matchedGtRowIndex: match ? match.rowIndex : null,
    });
  }

  const covered = gtRows.filter((g) => assigned.get(g.rowIndex).length > 0).map((g) => g.rowIndex);
  const uncovered = gtRows.filter((g) => assigned.get(g.rowIndex).length === 0).map((g) => g.rowIndex);
  const duplicateCount = gtRows.reduce((sum, g) => sum + Math.max(0, assigned.get(g.rowIndex).length - 1), 0);

  return {
    candidateCount: rows.length,
    gtCoverageCount: covered.length,
    gtRowRecall: gtRows.length ? covered.length / gtRows.length : 0,
    falseCandidateCount: falseCandidates.length,
    duplicateCandidateCount: duplicateCount,
    coveredGtRowIndices: covered,
    uncoveredGtRowIndices: uncovered,
    falseCandidateIndices: falseCandidates,
    candidateAudit: mappedCandidates,
  };
}

const perImage = [];
for (const fileName of EXPECTED_FILES) {
  const g = gtMap.get(fileName);
  const c = candidateMap.get(fileName);

  const expectedRotation = normalizeRotation(g.rotationDeg);
  const expectedWidth = expectedRotation === 90 || expectedRotation === 270 ? Number(c.raw.height) : Number(c.raw.width);
  const expectedHeight = expectedRotation === 90 || expectedRotation === 270 ? Number(c.raw.width) : Number(c.raw.height);
  if (Number(g.imageWidth) !== expectedWidth || Number(g.imageHeight) !== expectedHeight) {
    throw new Error(`${fileName}: GT dimensions ${g.imageWidth}x${g.imageHeight} do not match raw+rotation expected ${expectedWidth}x${expectedHeight}`);
  }
  if (Number(g.rowCount) !== (g.rows || []).length) {
    throw new Error(`${fileName}: rowCount mismatch`);
  }

  const fixed = scoreVariant(c.fixedRows || [], c.fixedPaper, c, g, "fixed");
  const dynamic = scoreVariant(c.dynamicRows || [], c.dynamicPaper, c, g, "dynamic");

  perImage.push({
    fileName,
    rotationDeg: expectedRotation,
    gtRowCount: Number(g.rowCount),
    fixed,
    dynamic,
  });
}

function aggregate(key) {
  const totalCandidates = perImage.reduce((s, x) => s + x[key].candidateCount, 0);
  const totalCoverage = perImage.reduce((s, x) => s + x[key].gtCoverageCount, 0);
  const falseCandidates = perImage.reduce((s, x) => s + x[key].falseCandidateCount, 0);
  const duplicates = perImage.reduce((s, x) => s + x[key].duplicateCandidateCount, 0);
  return {
    totalCandidateCount: totalCandidates,
    gtCoverageCount: totalCoverage,
    rowRecall: gtTotalRows ? totalCoverage / gtTotalRows : 0,
    falseCandidateCount: falseCandidates,
    duplicateCandidateCount: duplicates,
  };
}

const result = {
  schema: "icb.parts-ocr.stage-a-row-coverage.v1",
  gtSchema: gt.schema,
  variant: gt.variant,
  evaluationSet: gt.evaluationSet,
  candidateSourceHead: candidates.sourceHead,
  scoringRule: "candidate-center-y-inside-manual-gt-row-band; geometry-only; nearest-GT-center tie-break; no OCR text and no tunable threshold",
  gtTotalRows,
  fixed: aggregate("fixed"),
  dynamic: aggregate("dynamic"),
  perImage,
};

const lines = [];
lines.push("Parts OCR Stage A row coverage");
lines.push("GT total rows: " + gtTotalRows);
for (const item of perImage) {
  const pct = (v) => (v * 100).toFixed(1) + "%";
  lines.push(
    `${item.fileName} GT=${item.gtRowCount} | fixed c=${item.fixed.candidateCount} cover=${item.fixed.gtCoverageCount} recall=${pct(item.fixed.gtRowRecall)} false=${item.fixed.falseCandidateCount} dup=${item.fixed.duplicateCandidateCount} covered=[${item.fixed.coveredGtRowIndices.join(",")}] uncovered=[${item.fixed.uncoveredGtRowIndices.join(",")}] | dynamic c=${item.dynamic.candidateCount} cover=${item.dynamic.gtCoverageCount} recall=${pct(item.dynamic.gtRowRecall)} false=${item.dynamic.falseCandidateCount} dup=${item.dynamic.duplicateCandidateCount} covered=[${item.dynamic.coveredGtRowIndices.join(",")}] uncovered=[${item.dynamic.uncoveredGtRowIndices.join(",")}]`
  );
}
const pct = (v) => (v * 100).toFixed(1) + "%";
lines.push(`AGG fixed candidates=${result.fixed.totalCandidateCount} coverage=${result.fixed.gtCoverageCount}/${gtTotalRows} recall=${pct(result.fixed.rowRecall)} false=${result.fixed.falseCandidateCount} duplicate=${result.fixed.duplicateCandidateCount}`);
lines.push(`AGG dynamic candidates=${result.dynamic.totalCandidateCount} coverage=${result.dynamic.gtCoverageCount}/${gtTotalRows} recall=${pct(result.dynamic.rowRecall)} false=${result.dynamic.falseCandidateCount} duplicate=${result.dynamic.duplicateCandidateCount}`);

result.summary = lines.join("\n");

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
}
console.log(result.summary);
