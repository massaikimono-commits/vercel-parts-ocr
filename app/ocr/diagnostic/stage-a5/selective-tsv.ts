import type { CropBox } from "../../dynamic-rows";
import type {
  GeometryRow,
  RuntimeTsvRecord,
} from "../stage-a4/runtime-tsv";

export type StageA5LineProposal = {
  top: number;
  bottom: number;
  center: number;
  source: "tsv-line";
  height: number;
  childWordCount: number;
  hierarchyKey: string;
};

export type StageA5SelectiveRow = {
  top: number;
  bottom: number;
  center: number;
  source: "rules" | "tsv-line-selective";
};

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function centerInsidePaper(
  left: number,
  top: number,
  width: number,
  height: number,
  paper: CropBox,
) {
  const cx = left + width / 2;
  const cy = top + height / 2;
  return (
    cx >= paper.x &&
    cx <= paper.x + paper.w &&
    cy >= paper.y &&
    cy <= paper.y + paper.h
  );
}

function hierarchyKey(record: RuntimeTsvRecord) {
  return [
    record.pageNum,
    record.blockNum,
    record.parNum,
    record.lineNum,
  ].join(":");
}

function overlapHeight(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
) {
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + 1);
}

function overlapRatio(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
) {
  const overlap = overlapHeight(a, b);
  const ah = Math.max(1, a.bottom - a.top + 1);
  const bh = Math.max(1, b.bottom - b.top + 1);
  return overlap / Math.min(ah, bh);
}

export function buildLevel4LineProposals(
  records: RuntimeTsvRecord[],
  paper: CropBox,
) {
  const wordsByLine = new Map<string, RuntimeTsvRecord[]>();

  for (const record of records) {
    if (
      record.level !== 5 ||
      record.width <= 0 ||
      record.height <= 0 ||
      !centerInsidePaper(
        record.left,
        record.top,
        record.width,
        record.height,
        paper,
      )
    ) {
      continue;
    }
    const key = hierarchyKey(record);
    const list = wordsByLine.get(key) || [];
    list.push(record);
    wordsByLine.set(key, list);
  }

  const lines = records
    .filter((record) => {
      return (
        record.level === 4 &&
        record.width > 0 &&
        record.height > 0 &&
        centerInsidePaper(
          record.left,
          record.top,
          record.width,
          record.height,
          paper,
        )
      );
    })
    .map((record) => {
      const top = Math.max(paper.y, record.top);
      const bottom = Math.min(
        paper.y + paper.h - 1,
        record.top + record.height - 1,
      );
      const key = hierarchyKey(record);
      return {
        top,
        bottom,
        center: Math.round((top + bottom) / 2),
        source: "tsv-line" as const,
        height: Math.max(1, bottom - top + 1),
        childWordCount: (wordsByLine.get(key) || []).length,
        hierarchyKey: key,
      };
    })
    .sort((a, b) => a.center - b.center);

  const positiveWordSupports = lines
    .map((line) => line.childWordCount)
    .filter((count) => count > 0);

  return {
    lines,
    trace: {
      level4LineCountInsidePaper: lines.length,
      level5WordCountInsidePaper: Array.from(wordsByLine.values()).reduce(
        (sum, list) => sum + list.length,
        0,
      ),
      medianLineHeight: median(lines.map((line) => line.height)),
      medianPositiveChildWordCount: median(positiveWordSupports),
      zeroChildLineCount: lines.filter((line) => line.childWordCount === 0)
        .length,
    },
  };
}

export function consolidateLineCandidates(
  lines: StageA5LineProposal[],
) {
  if (!lines.length) {
    return {
      rows: [] as StageA5LineProposal[],
      trace: {
        inputCount: 0,
        outputCount: 0,
        mergeCount: 0,
        medianLineHeight: 0,
        adaptiveCenterTolerance: 0,
      },
    };
  }

  const medianLineHeight = Math.max(
    1,
    median(lines.map((line) => line.height)),
  );
  const adaptiveCenterTolerance = Math.max(4, medianLineHeight * 0.55);

  const clusters: StageA5LineProposal[][] = [];

  for (const line of [...lines].sort((a, b) => a.center - b.center)) {
    const last = clusters[clusters.length - 1];
    if (!last) {
      clusters.push([line]);
      continue;
    }

    const representative = last[last.length - 1];
    const sameVerticalRow =
      overlapRatio(representative, line) >= 0.3 ||
      Math.abs(representative.center - line.center) <=
        adaptiveCenterTolerance;

    if (sameVerticalRow) last.push(line);
    else clusters.push([line]);
  }

  const rows = clusters
    .map((cluster) => {
      const tops = cluster.map((line) => line.top);
      const bottoms = cluster.map((line) => line.bottom);
      const top = Math.round(median(tops));
      const bottom = Math.round(median(bottoms));
      const strongest = [...cluster].sort(
        (a, b) => b.childWordCount - a.childWordCount,
      )[0];

      return {
        top,
        bottom,
        center: Math.round((top + bottom) / 2),
        source: "tsv-line" as const,
        height: Math.max(1, bottom - top + 1),
        childWordCount: strongest.childWordCount,
        hierarchyKey: strongest.hierarchyKey,
      };
    })
    .sort((a, b) => a.center - b.center);

  return {
    rows,
    trace: {
      inputCount: lines.length,
      outputCount: rows.length,
      mergeCount: lines.length - rows.length,
      medianLineHeight,
      adaptiveCenterTolerance,
    },
  };
}

export function filterByWordChildSupport(
  lines: StageA5LineProposal[],
) {
  const positive = lines
    .map((line) => line.childWordCount)
    .filter((count) => count > 0);
  const medianPositiveSupport = median(positive);

  // Generic document-adaptive support floor.
  // Two child words is the absolute structural minimum for a multi-field row;
  // above that, the threshold tracks the document's own median support.
  const minChildWordSupport = Math.max(
    2,
    Math.floor(Math.max(1, medianPositiveSupport) * 0.5),
  );

  const rows = lines.filter(
    (line) => line.childWordCount >= minChildWordSupport,
  );

  return {
    rows,
    trace: {
      inputCount: lines.length,
      outputCount: rows.length,
      rejectedCount: lines.length - rows.length,
      medianPositiveSupport,
      minChildWordSupport,
    },
  };
}

export function filterByWordGroupConsensus(
  lines: StageA5LineProposal[],
  wordGroups: GeometryRow[],
) {
  if (!lines.length || !wordGroups.length) {
    return {
      rows: [] as StageA5LineProposal[],
      trace: {
        inputLineCount: lines.length,
        wordGroupCount: wordGroups.length,
        outputCount: 0,
        medianReferenceHeight: 0,
        adaptiveCenterTolerance: 0,
      },
    };
  }

  const medianReferenceHeight = Math.max(
    1,
    median([
      ...lines.map((line) => line.height),
      ...wordGroups.map((row) => row.bottom - row.top + 1),
    ]),
  );
  const adaptiveCenterTolerance = Math.max(
    4,
    medianReferenceHeight * 0.75,
  );

  const rows = lines.filter((line) =>
    wordGroups.some((group) => {
      return (
        overlapRatio(line, group) >= 0.25 ||
        Math.abs(line.center - group.center) <= adaptiveCenterTolerance
      );
    }),
  );

  return {
    rows,
    trace: {
      inputLineCount: lines.length,
      wordGroupCount: wordGroups.length,
      outputCount: rows.length,
      rejectedCount: lines.length - rows.length,
      medianReferenceHeight,
      adaptiveCenterTolerance,
    },
  };
}

export function filterToRulesUncoveredVerticalGaps(
  rules: StageA5SelectiveRow[],
  lines: StageA5LineProposal[],
) {
  const referenceHeights = [
    ...rules.map((row) => row.bottom - row.top + 1),
    ...lines.map((row) => row.height),
  ].filter((value) => value > 0);

  const medianReferenceHeight = Math.max(
    1,
    median(referenceHeights),
  );
  const adaptiveRuleMargin = Math.max(
    4,
    medianReferenceHeight * 0.55,
  );

  const rows = lines.filter((line) => {
    return !rules.some((rule) => {
      const centerInsideExpandedRule =
        line.center >= rule.top - adaptiveRuleMargin &&
        line.center <= rule.bottom + adaptiveRuleMargin;
      const materiallyOverlapping = overlapRatio(line, rule) >= 0.25;
      return centerInsideExpandedRule || materiallyOverlapping;
    });
  });

  return {
    rows,
    trace: {
      inputLineCount: lines.length,
      ruleCount: rules.length,
      outputCount: rows.length,
      rejectedNearRuleCount: lines.length - rows.length,
      medianReferenceHeight,
      adaptiveRuleMargin,
    },
  };
}

export function combineRulesAndRescue(
  rules: StageA5SelectiveRow[],
  rescue: StageA5LineProposal[],
): StageA5SelectiveRow[] {
  return [
    ...rules.map((row) => ({ ...row, source: "rules" as const })),
    ...rescue.map((row) => ({
      top: row.top,
      bottom: row.bottom,
      center: row.center,
      source: "tsv-line-selective" as const,
    })),
  ].sort((a, b) => a.center - b.center);
}
