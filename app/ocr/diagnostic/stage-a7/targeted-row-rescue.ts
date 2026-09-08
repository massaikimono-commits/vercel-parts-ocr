import type { CropBox } from "../../dynamic-rows";
import type {
  GeometryRow,
  RuntimeTsvRecord,
} from "../stage-a4/runtime-tsv";
import type {
  StageA5LineProposal,
  StageA5SelectiveRow,
} from "../stage-a5/selective-tsv";

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function overlapHeight(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
) {
  return Math.max(
    0,
    Math.min(a.bottom, b.bottom) -
      Math.max(a.top, b.top) +
      1,
  );
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

function rowHeight(row: {
  top: number;
  bottom: number;
}) {
  return Math.max(1, row.bottom - row.top + 1);
}

function positiveAdjacentGaps(
  centers: number[],
) {
  const sorted = [...centers].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}

function nearestDistance(
  center: number,
  rows: Array<{ center: number }>,
) {
  if (!rows.length) return Infinity;
  return Math.min(
    ...rows.map((row) =>
      Math.abs(row.center - center),
    ),
  );
}

export function preserveDistinctRowsWithinConsolidation(args: {
  rawLines: StageA5LineProposal[];
  consolidated: StageA5LineProposal[];
  wordGroups: GeometryRow[];
}) {
  const { rawLines, consolidated, wordGroups } = args;

  if (!rawLines.length) {
    return {
      rows: [] as StageA5LineProposal[],
      trace: {
        rawLineCount: 0,
        consolidatedCount: consolidated.length,
        preservedRawCount: 0,
        outputCount: 0,
        medianLineHeight: 0,
        medianRawCenterGap: 0,
        distinctCenterSeparation: 0,
        supportCenterTolerance: 0,
      },
    };
  }

  const medianLineHeight = Math.max(
    1,
    median(rawLines.map(rowHeight)),
  );
  const gapValues = positiveAdjacentGaps(
    rawLines.map((row) => row.center),
  );
  const medianRawCenterGap = Math.max(
    1,
    median(gapValues),
  );

  const distinctCenterSeparation = Math.max(
    medianLineHeight * 0.42,
    medianRawCenterGap * 0.45,
  );
  const supportCenterTolerance = Math.max(
    medianLineHeight * 0.8,
    medianRawCenterGap * 0.7,
  );

  const output: StageA5LineProposal[] = [
    ...consolidated,
  ];

  let preservedRawCount = 0;

  for (const raw of rawLines) {
    const nearestConsolidated = nearestDistance(
      raw.center,
      consolidated,
    );

    const wordSupported = wordGroups.some(
      (group) =>
        overlapRatio(raw, group) >= 0.2 ||
        Math.abs(raw.center - group.center) <=
          supportCenterTolerance,
    );

    if (!wordSupported) continue;

    const alreadyRepresented = output.some(
      (row) =>
        overlapRatio(raw, row) >= 0.45 ||
        Math.abs(raw.center - row.center) <
          distinctCenterSeparation,
    );

    if (alreadyRepresented) continue;

    const mergeLossEvidence =
      nearestConsolidated <=
        Math.max(
          medianLineHeight * 1.2,
          medianRawCenterGap,
        );

    if (!mergeLossEvidence) continue;

    output.push(raw);
    preservedRawCount += 1;
  }

  output.sort((a, b) => a.center - b.center);

  return {
    rows: output,
    trace: {
      rawLineCount: rawLines.length,
      consolidatedCount: consolidated.length,
      preservedRawCount,
      outputCount: output.length,
      medianLineHeight,
      medianRawCenterGap,
      distinctCenterSeparation,
      supportCenterTolerance,
    },
  };
}

export function localizeRowsFromMutualGeometry(args: {
  rows: StageA5LineProposal[];
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
}) {
  const { rows, rawLines, wordGroups } = args;

  const referenceHeights = [
    ...rows.map(rowHeight),
    ...rawLines.map(rowHeight),
    ...wordGroups.map(rowHeight),
  ].filter((value) => value > 0);

  const medianReferenceHeight = Math.max(
    1,
    median(referenceHeights),
  );

  const localWindow = Math.max(
    medianReferenceHeight * 1.25,
    6,
  );

  let adjustedCount = 0;

  const corrected = rows.map((row) => {
    const support = [
      ...rawLines
        .filter(
          (candidate) =>
            overlapRatio(row, candidate) >= 0.15 ||
            Math.abs(row.center - candidate.center) <=
              localWindow,
        )
        .map((candidate) => ({
          top: candidate.top,
          bottom: candidate.bottom,
          center: candidate.center,
        })),
      ...wordGroups
        .filter(
          (candidate) =>
            overlapRatio(row, candidate) >= 0.15 ||
            Math.abs(row.center - candidate.center) <=
              localWindow,
        )
        .map((candidate) => ({
          top: candidate.top,
          bottom: candidate.bottom,
          center: candidate.center,
        })),
    ];

    if (!support.length) return row;

    const centers = [
      row.center,
      ...support.map((item) => item.center),
    ];
    const tops = [
      row.top,
      ...support.map((item) => item.top),
    ];
    const bottoms = [
      row.bottom,
      ...support.map((item) => item.bottom),
    ];

    const center = Math.round(median(centers));
    const top = Math.round(median(tops));
    const bottom = Math.round(median(bottoms));

    const correctedTop = Math.min(top, center);
    const correctedBottom = Math.max(
      bottom,
      center,
    );

    if (
      correctedTop !== row.top ||
      correctedBottom !== row.bottom ||
      center !== row.center
    ) {
      adjustedCount += 1;
    }

    return {
      ...row,
      top: correctedTop,
      bottom: correctedBottom,
      center,
      height: Math.max(
        1,
        correctedBottom - correctedTop + 1,
      ),
    };
  });

  return {
    rows: corrected,
    trace: {
      inputCount: rows.length,
      outputCount: corrected.length,
      adjustedCount,
      medianReferenceHeight,
      localWindow,
    },
  };
}

function level5WordsInsidePaper(
  records: RuntimeTsvRecord[],
  paper: CropBox,
) {
  return records.filter((record) => {
    if (
      record.level !== 5 ||
      record.width <= 0 ||
      record.height <= 0
    ) {
      return false;
    }

    const cx = record.left + record.width / 2;
    const cy = record.top + record.height / 2;

    return (
      cx >= paper.x &&
      cx <= paper.x + paper.w &&
      cy >= paper.y &&
      cy <= paper.y + paper.h
    );
  });
}

export function buildWordGeometryFallback(args: {
  records: RuntimeTsvRecord[];
  paper: CropBox;
  level4LineCount: number;
  pathological: boolean;
}) {
  const {
    records,
    paper,
    level4LineCount,
    pathological,
  } = args;

  const words = level5WordsInsidePaper(
    records,
    paper,
  );

  if (!words.length) {
    return {
      eligible: pathological,
      rows: [] as StageA5LineProposal[],
      trace: {
        level5WordCount: 0,
        level4LineCount,
        rowClusterCount: 0,
        medianWordHeight: 0,
        adaptiveCenterTolerance: 0,
        structuralHierarchyDeficit: false,
        pathological,
      },
    };
  }

  const medianWordHeight = Math.max(
    1,
    median(words.map((word) => word.height)),
  );
  const adaptiveCenterTolerance = Math.max(
    4,
    medianWordHeight * 0.85,
  );

  const clusters: RuntimeTsvRecord[][] = [];

  for (const word of [...words].sort(
    (a, b) =>
      a.top + a.height / 2 -
      (b.top + b.height / 2),
  )) {
    const center = word.top + word.height / 2;
    const last = clusters[clusters.length - 1];

    if (!last) {
      clusters.push([word]);
      continue;
    }

    const lastCenter = median(
      last.map(
        (item) =>
          item.top + item.height / 2,
      ),
    );

    if (
      Math.abs(center - lastCenter) <=
      adaptiveCenterTolerance
    ) {
      last.push(word);
    } else {
      clusters.push([word]);
    }
  }

  const rows = clusters
    .filter((cluster) => cluster.length >= 2)
    .map((cluster, index) => {
      const top = Math.max(
        paper.y,
        Math.min(
          ...cluster.map((word) => word.top),
        ),
      );
      const bottom = Math.min(
        paper.y + paper.h - 1,
        Math.max(
          ...cluster.map(
            (word) =>
              word.top + word.height - 1,
          ),
        ),
      );
      const center = Math.round(
        median(
          cluster.map(
            (word) =>
              word.top + word.height / 2,
          ),
        ),
      );

      return {
        top,
        bottom,
        center,
        source: "tsv-line" as const,
        height: Math.max(
          1,
          bottom - top + 1,
        ),
        childWordCount: cluster.length,
        hierarchyKey: `fallback:${index + 1}`,
      };
    })
    .sort((a, b) => a.center - b.center);

  const structuralHierarchyDeficit =
    words.length >= 6 &&
    rows.length >
      Math.max(
        1,
        level4LineCount + 1,
      );

  const eligible =
    pathological ||
    structuralHierarchyDeficit;

  return {
    eligible,
    rows: eligible ? rows : [],
    trace: {
      level5WordCount: words.length,
      level4LineCount,
      rowClusterCount: rows.length,
      medianWordHeight,
      adaptiveCenterTolerance,
      structuralHierarchyDeficit,
      pathological,
    },
  };
}

export function filterNovelFallbackAgainstExisting(args: {
  existing: StageA5SelectiveRow[];
  fallback: StageA5LineProposal[];
}) {
  const { existing, fallback } = args;

  const referenceHeights = [
    ...existing.map(rowHeight),
    ...fallback.map(rowHeight),
  ].filter((value) => value > 0);

  const medianReferenceHeight = Math.max(
    1,
    median(referenceHeights),
  );

  const adaptiveMargin = Math.max(
    4,
    medianReferenceHeight * 0.55,
  );

  const rows = fallback.filter((row) => {
    return !existing.some(
      (existingRow) =>
        overlapRatio(row, existingRow) >= 0.25 ||
        Math.abs(
          row.center - existingRow.center,
        ) <= adaptiveMargin,
    );
  });

  return {
    rows,
    trace: {
      inputFallbackCount: fallback.length,
      existingCount: existing.length,
      outputCount: rows.length,
      rejectedNearExisting:
        fallback.length - rows.length,
      medianReferenceHeight,
      adaptiveMargin,
    },
  };
}
