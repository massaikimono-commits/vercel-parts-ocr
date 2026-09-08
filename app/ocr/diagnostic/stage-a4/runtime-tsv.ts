export type CropBox = { x: number; y: number; w: number; h: number };

export type RuntimeTsvRecord = {
  level: number;
  pageNum: number;
  blockNum: number;
  parNum: number;
  lineNum: number;
  wordNum: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
};

export type RuntimeTsvContract = {
  kind: "tesseract-gettsvtext-headerless-12-column";
  headerPresent: boolean;
  expectedColumnCount: 12;
  firstNonEmptyColumnCount: number;
  recordCount: number;
  validRecordCount: number;
  invalidRecordCount: number;
  levelCounts: Record<string, number>;
};

export type GeometryRow = {
  top: number;
  bottom: number;
  center: number;
  source: "tsv-word-group" | "tsv-line";
};

function finitePositive(v: number) {
  return Number.isFinite(v) && v > 0;
}

/**
 * Actual runtime contract for Tesseract.js 5.1.1:
 * data.tsv is the direct TessBaseAPI.GetTSVText() payload.
 * It has no header row and each record is:
 * level,page_num,block_num,par_num,line_num,word_num,left,top,width,height,conf,text
 *
 * Stage A3 observed that treating row 1 as a named header rejects the entire runtime payload.
 * This parser does not inspect OCR text content; it reads only the first 11 geometry/meta fields.
 */
export function parseHeaderlessRuntimeTsv(tsv: string) {
  const lines = String(tsv || "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  const firstCols = lines[0]?.split("\t") || [];
  const headerPresent =
    firstCols.includes("left") &&
    firstCols.includes("top") &&
    firstCols.includes("width") &&
    firstCols.includes("height");

  const records: RuntimeTsvRecord[] = [];
  let invalidRecordCount = 0;
  const levelCounts: Record<string, number> = {};

  for (const line of lines) {
    const c = line.split("\t");
    if (c.length < 11) {
      invalidRecordCount += 1;
      continue;
    }

    const nums = c.slice(0, 11).map(Number);
    const [level, pageNum, blockNum, parNum, lineNum, wordNum, left, top, width, height, conf] = nums;

    if (
      !nums.every(Number.isFinite) ||
      level < 1 ||
      level > 5 ||
      width < 0 ||
      height < 0
    ) {
      invalidRecordCount += 1;
      continue;
    }

    records.push({
      level,
      pageNum,
      blockNum,
      parNum,
      lineNum,
      wordNum,
      left,
      top,
      width,
      height,
      conf,
    });
    levelCounts[String(level)] = (levelCounts[String(level)] || 0) + 1;
  }

  const contract: RuntimeTsvContract = {
    kind: "tesseract-gettsvtext-headerless-12-column",
    headerPresent,
    expectedColumnCount: 12,
    firstNonEmptyColumnCount: firstCols.length,
    recordCount: lines.length,
    validRecordCount: records.length,
    invalidRecordCount,
    levelCounts,
  };

  return { contract, records };
}

export function tsvLineRows(records: RuntimeTsvRecord[], paper: CropBox): GeometryRow[] {
  return records
    .filter((r) => {
      if (r.level !== 4 || !finitePositive(r.width) || !finitePositive(r.height)) return false;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return (
        cx >= paper.x &&
        cx <= paper.x + paper.w &&
        cy >= paper.y &&
        cy <= paper.y + paper.h
      );
    })
    .map((r) => ({
      top: Math.max(paper.y, r.top),
      bottom: Math.min(paper.y + paper.h - 1, r.top + r.height - 1),
      center: Math.round(r.top + r.height / 2),
      source: "tsv-line" as const,
    }))
    .sort((a, b) => a.center - b.center);
}

/**
 * Experimental repair of the existing TSV word-group path.
 * Only the parser contract changes: geometry grouping constants match the
 * existing rowBandsFromTSV implementation. OCR text content is never used.
 */
export function tsvWordGroupRows(records: RuntimeTsvRecord[], paper: CropBox) {
  const words = records.filter((r) => {
    if (r.level !== 5 || !finitePositive(r.width) || !finitePositive(r.height)) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return (
      cx >= paper.x &&
      cx <= paper.x + paper.w &&
      cy >= paper.y &&
      cy <= paper.y + paper.h
    );
  });

  if (!words.length) {
    return {
      rows: [] as GeometryRow[],
      trace: {
        wordCountInsidePaper: 0,
        medianHeight: null as number | null,
        tolerance: null as number | null,
        rawGroupCount: 0,
        acceptedGroupCount: 0,
        rejectedTooFewWords: 0,
      },
    };
  }

  const heights = words.map((w) => w.height).sort((a, b) => a - b);
  const medianHeight = Math.max(4, heights[Math.floor(heights.length / 2)] || 4);
  const tolerance = Math.max(5, medianHeight * 0.75);

  const groups: Array<{ words: RuntimeTsvRecord[]; center: number }> = [];
  for (const word of [...words].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const center = word.top + word.height / 2;
    let best = groups.find((g) => Math.abs(g.center - center) <= tolerance);
    if (!best) {
      best = { words: [], center };
      groups.push(best);
    }
    best.words.push(word);
    best.center =
      best.words.reduce((sum, w) => sum + w.top + w.height / 2, 0) /
      best.words.length;
  }

  const minWords = 2;
  const accepted = groups.filter((g) => g.words.length >= minWords);
  const rows = accepted
    .map((g) => {
      const top = Math.max(
        paper.y,
        Math.min(...g.words.map((w) => w.top)) - Math.round(medianHeight * 0.45),
      );
      const bottom = Math.min(
        paper.y + paper.h - 1,
        Math.max(...g.words.map((w) => w.top + w.height)) +
          Math.round(medianHeight * 0.45),
      );
      return {
        top,
        bottom,
        center: Math.round((top + bottom) / 2),
        source: "tsv-word-group" as const,
      };
    })
    .sort((a, b) => a.center - b.center);

  return {
    rows,
    trace: {
      wordCountInsidePaper: words.length,
      medianHeight,
      tolerance,
      rawGroupCount: groups.length,
      acceptedGroupCount: accepted.length,
      rejectedTooFewWords: groups.length - accepted.length,
    },
  };
}
