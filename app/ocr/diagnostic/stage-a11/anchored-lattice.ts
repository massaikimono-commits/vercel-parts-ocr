import type { CropBox } from "../../dynamic-rows";
import type {
  GeometryRow,
  RuntimeTsvRecord,
} from "../stage-a4/runtime-tsv";
import type {
  StageA5LineProposal,
  StageA5SelectiveRow,
} from "../stage-a5/selective-tsv";
import type { AltRowProposal } from "../stage-a9/targeted-split-alt";

export type ColumnLane = {
  laneId: string;
  centerX: number;
  memberCount: number;
  medianWidth: number;
};

export type AltTopologyCandidate = {
  candidateIndex: number;
  top: number;
  bottom: number;
  center: number;
  height: number;
  wordCount: number;
  occupiedLaneIds: string[];
  occupiedLaneCount: number;
  columnCoverage: number;
  xSpan: number;
  xSpanRatio: number;
  horizontalConsistency: number;
  compactness: number;
  heightSimilarity: number;
  autoRawLineSupport: boolean;
  autoWordGroupSupport: boolean;
  ruleSupport: boolean;
  rowLikeScore: number;
  rowLike: boolean;
};

export type LatticeSelection = {
  acceptedCandidateIndexes: number[];
  latticeCount: number;
  anchoredLatticeCount: number;
  latticeCandidateCount: number;
  traces: any[];
};

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = Math.max(
    0,
    Math.min(sorted.length - 1, p * (sorted.length - 1)),
  );
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const t = pos - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function rowHeight(row: { top: number; bottom: number }) {
  return Math.max(1, row.bottom - row.top + 1);
}

function overlapHeight(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
) {
  return Math.max(
    0,
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + 1,
  );
}

function overlapRatio(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
) {
  const overlap = overlapHeight(a, b);
  const ah = rowHeight(a);
  const bh = rowHeight(b);
  return overlap / Math.min(ah, bh);
}

function level5WordsInsidePaper(
  records: RuntimeTsvRecord[],
  paper: CropBox,
) {
  return records
    .filter((record) => {
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
    })
    .map((record, index) => ({
      wordId: `alt-word-${index + 1}`,
      left: record.left,
      right: record.left + record.width,
      top: record.top,
      bottom: record.top + record.height - 1,
      centerX: record.left + record.width / 2,
      centerY: record.top + record.height / 2,
      width: record.width,
      height: record.height,
    }));
}

export function inferHorizontalColumnLanes(args: {
  records: RuntimeTsvRecord[];
  paper: CropBox;
}) {
  const { records, paper } = args;
  const words = level5WordsInsidePaper(records, paper);

  if (!words.length) {
    return {
      lanes: [] as ColumnLane[],
      words,
      trace: {
        wordCount: 0,
        medianWordWidth: 0,
        laneTolerance: 0,
        laneCount: 0,
      },
    };
  }

  const medianWordWidth = Math.max(
    1,
    median(words.map((word) => word.width)),
  );
  const laneTolerance = Math.max(8, medianWordWidth * 0.85);

  const clusters: typeof words[] = [];

  for (const word of [...words].sort((a, b) => a.centerX - b.centerX)) {
    const last = clusters[clusters.length - 1];

    if (!last) {
      clusters.push([word]);
      continue;
    }

    const currentCenter = median(last.map((item) => item.centerX));

    if (Math.abs(word.centerX - currentCenter) <= laneTolerance) {
      last.push(word);
    } else {
      clusters.push([word]);
    }
  }

  const lanes: ColumnLane[] = clusters
    .filter((cluster) => cluster.length >= 2)
    .map((cluster, index) => ({
      laneId: `lane-${index + 1}`,
      centerX: median(cluster.map((word) => word.centerX)),
      memberCount: cluster.length,
      medianWidth: median(cluster.map((word) => word.width)),
    }));

  return {
    lanes,
    words,
    trace: {
      wordCount: words.length,
      medianWordWidth,
      laneTolerance,
      laneCount: lanes.length,
      singletonLaneRejectCount: clusters.length - lanes.length,
    },
  };
}

function candidateWords(
  candidate: AltRowProposal,
  words: ReturnType<typeof level5WordsInsidePaper>,
) {
  return words.filter(
    (word) =>
      word.centerY >= candidate.top &&
      word.centerY <= candidate.bottom,
  );
}

function supportFlag(
  candidate: { top: number; bottom: number; center: number },
  rows: Array<{ top: number; bottom: number; center: number }>,
  centerTolerance: number,
) {
  return rows.some(
    (row) =>
      overlapRatio(candidate, row) >= 0.2 ||
      Math.abs(candidate.center - row.center) <= centerTolerance,
  );
}

export function decorateAltTopology(args: {
  altRows: AltRowProposal[];
  altRecords: RuntimeTsvRecord[];
  paper: CropBox;
  lanes: ColumnLane[];
  laneTolerance: number;
  dRows: StageA5SelectiveRow[];
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
  ruleRows: StageA5SelectiveRow[];
}) {
  const {
    altRows,
    altRecords,
    paper,
    lanes,
    laneTolerance,
    dRows,
    rawLines,
    wordGroups,
    ruleRows,
  } = args;

  const words = level5WordsInsidePaper(altRecords, paper);
  const medianDHeight = Math.max(1, median(dRows.map(rowHeight)));
  const supportCenterTolerance = Math.max(4, medianDHeight * 0.55);

  const raw: Omit<AltTopologyCandidate, "rowLikeScore" | "rowLike">[] =
    altRows.map((candidate, index) => {
      const members = candidateWords(candidate, words);

      const occupied = new Set<string>();
      const laneDistances: number[] = [];

      for (const word of members) {
        if (!lanes.length) break;
        const nearest = [...lanes].sort(
          (a, b) =>
            Math.abs(a.centerX - word.centerX) -
            Math.abs(b.centerX - word.centerX),
        )[0];

        const distance = Math.abs(nearest.centerX - word.centerX);

        if (distance <= laneTolerance * 1.25) {
          occupied.add(nearest.laneId);
          laneDistances.push(distance / Math.max(1, laneTolerance));
        }
      }

      const xSpan = members.length
        ? Math.max(...members.map((word) => word.right)) -
          Math.min(...members.map((word) => word.left))
        : 0;

      const centerYs = members.map((word) => word.centerY);
      const ySpread = centerYs.length
        ? Math.max(...centerYs) - Math.min(...centerYs)
        : 0;

      const compactness =
        1 / (1 + ySpread / Math.max(1, medianDHeight));

      const heightRatio =
        rowHeight(candidate) / Math.max(1, medianDHeight);

      const heightSimilarity =
        1 /
        (1 +
          Math.abs(
            Math.log(Math.max(1e-6, heightRatio)),
          ));

      const horizontalConsistency = laneDistances.length
        ? Math.max(
            0,
            1 - median(laneDistances),
          )
        : 0;

      return {
        candidateIndex: index + 1,
        top: candidate.top,
        bottom: candidate.bottom,
        center: candidate.center,
        height: rowHeight(candidate),
        wordCount: members.length,
        occupiedLaneIds: Array.from(occupied),
        occupiedLaneCount: occupied.size,
        columnCoverage: lanes.length
          ? occupied.size / lanes.length
          : 0,
        xSpan,
        xSpanRatio: xSpan / Math.max(1, paper.w),
        horizontalConsistency,
        compactness,
        heightSimilarity,
        autoRawLineSupport: supportFlag(
          candidate,
          rawLines,
          supportCenterTolerance,
        ),
        autoWordGroupSupport: supportFlag(
          candidate,
          wordGroups,
          supportCenterTolerance,
        ),
        ruleSupport: supportFlag(
          candidate,
          ruleRows,
          Math.max(4, medianDHeight * 0.65),
        ),
      };
    });

  const medianWordCount = Math.max(
    1,
    median(raw.map((item) => item.wordCount).filter((value) => value > 0)),
  );
  const medianLaneCount = Math.max(
    1,
    median(
      raw
        .map((item) => item.occupiedLaneCount)
        .filter((value) => value > 0),
    ),
  );
  const medianSpanRatio = Math.max(
    1e-6,
    median(
      raw
        .map((item) => item.xSpanRatio)
        .filter((value) => value > 0),
    ),
  );

  const decorated: AltTopologyCandidate[] = raw.map((item) => {
    const wordScore = Math.min(
      1,
      item.wordCount / medianWordCount,
    );
    const laneScore = Math.min(
      1,
      item.occupiedLaneCount / medianLaneCount,
    );
    const spanScore = Math.min(
      1,
      item.xSpanRatio / medianSpanRatio,
    );
    const supportScore =
      Number(item.autoRawLineSupport) * 0.12 +
      Number(item.autoWordGroupSupport) * 0.12 +
      Number(item.ruleSupport) * 0.08;

    const rowLikeScore =
      item.horizontalConsistency * 0.18 +
      item.compactness * 0.16 +
      item.heightSimilarity * 0.16 +
      wordScore * 0.14 +
      laneScore * 0.14 +
      spanScore * 0.1 +
      supportScore;

    return {
      ...item,
      rowLikeScore,
      rowLike: true,
    };
  });

  const scoreValues = decorated.map((item) => item.rowLikeScore);
  const acceptanceFloor = scoreValues.length
    ? percentile(scoreValues, 0.35)
    : 0;

  const finalRows = decorated.map((item) => ({
    ...item,
    rowLike: item.rowLikeScore >= acceptanceFloor,
  }));

  return {
    rows: finalRows,
    trace: {
      altCandidateCount: altRows.length,
      rowLikeCandidateCount: finalRows.filter((row) => row.rowLike).length,
      medianWordCount,
      medianLaneCount,
      medianSpanRatio,
      acceptanceFloor,
    },
  };
}

function highConfidenceAnchors(args: {
  dRows: StageA5SelectiveRow[];
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
  ruleRows: StageA5SelectiveRow[];
}) {
  const { dRows, rawLines, wordGroups, ruleRows } = args;

  const medianDHeight = Math.max(1, median(dRows.map(rowHeight)));

  const scored = dRows.map((candidate, index) => {
    const rawSupport = supportFlag(
      candidate,
      rawLines,
      Math.max(4, medianDHeight * 0.55),
    );
    const wordGroupSupport = supportFlag(
      candidate,
      wordGroups,
      Math.max(4, medianDHeight * 0.55),
    );
    const ruleSupport = supportFlag(
      candidate,
      ruleRows,
      Math.max(4, medianDHeight * 0.65),
    );

    const supportCount =
      Number(rawSupport) +
      Number(wordGroupSupport) +
      Number(ruleSupport);

    return {
      anchorIndex: index + 1,
      center: candidate.center,
      supportCount,
      rawSupport,
      wordGroupSupport,
      ruleSupport,
    };
  });

  const strong = scored.filter((item) => item.supportCount >= 2);

  if (strong.length) {
    return {
      anchors: strong,
      all: scored,
      fallbackWeakAnchorUsed: false,
    };
  }

  const best = [...scored].sort(
    (a, b) => b.supportCount - a.supportCount,
  )[0];

  return {
    anchors: best && best.supportCount > 0 ? [best] : [],
    all: scored,
    fallbackWeakAnchorUsed: Boolean(best && best.supportCount > 0),
  };
}

function robustLatticePitch(args: {
  anchors: Array<{ center: number }>;
  altRows: AltTopologyCandidate[];
  medianRowHeight: number;
}) {
  const { anchors, altRows, medianRowHeight } = args;

  const evidenceCenters = [
    ...anchors.map((anchor) => anchor.center),
    ...altRows.filter((row) => row.rowLike).map((row) => row.center),
  ].sort((a, b) => a - b);

  const gaps = evidenceCenters
    .slice(1)
    .map((center, index) => center - evidenceCenters[index])
    .filter((gap) => gap > Math.max(3, medianRowHeight * 0.45));

  if (!gaps.length) {
    return {
      pitch: Math.max(8, medianRowHeight * 1.8),
      evidenceGapCount: 0,
      retainedGapCount: 0,
      gaps: [] as number[],
      retainedGaps: [] as number[],
    };
  }

  const q60 = percentile(gaps, 0.6);
  const lower = Math.max(medianRowHeight * 0.6, percentile(gaps, 0.15));
  const retained = gaps.filter(
    (gap) => gap >= lower && gap <= q60 * 1.2,
  );

  const pitch = Math.max(
    medianRowHeight * 1.15,
    median(retained.length ? retained : gaps),
  );

  return {
    pitch,
    evidenceGapCount: gaps.length,
    retainedGapCount: retained.length,
    gaps,
    retainedGaps: retained,
  };
}

function inferEnvelope(args: {
  paper: CropBox;
  dRows: StageA5SelectiveRow[];
  rawLines: StageA5LineProposal[];
  ruleRows: StageA5SelectiveRow[];
  pitch: number;
}) {
  const { paper, dRows, rawLines, ruleRows, pitch } = args;

  const centers = [
    ...dRows.map((row) => row.center),
    ...rawLines.map((row) => row.center),
    ...ruleRows.map((row) => row.center),
  ].filter(
    (center) => center >= paper.y && center <= paper.y + paper.h,
  );

  if (!centers.length) {
    return {
      top: paper.y,
      bottom: paper.y + paper.h,
    };
  }

  return {
    top: Math.max(paper.y, percentile(centers, 0.08) - pitch * 1.15),
    bottom: Math.min(
      paper.y + paper.h,
      percentile(centers, 0.92) + pitch * 1.15,
    ),
  };
}

function candidateRank(
  candidate: AltTopologyCandidate,
  expectedCenter: number,
  pitch: number,
) {
  const latticeDistanceScore = Math.max(
    0,
    1 - Math.abs(candidate.center - expectedCenter) / Math.max(1, pitch),
  );

  const supportScore =
    Number(candidate.autoRawLineSupport) * 0.12 +
    Number(candidate.autoWordGroupSupport) * 0.12 +
    Number(candidate.ruleSupport) * 0.08;

  return (
    latticeDistanceScore * 0.3 +
    candidate.columnCoverage * 0.15 +
    candidate.horizontalConsistency * 0.12 +
    candidate.compactness * 0.1 +
    candidate.heightSimilarity * 0.1 +
    Math.min(1, candidate.wordCount / 4) * 0.08 +
    supportScore
  );
}

export function growAnchoredAltLattices(args: {
  dRows: StageA5SelectiveRow[];
  altRows: AltTopologyCandidate[];
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
  ruleRows: StageA5SelectiveRow[];
  paper: CropBox;
  useTopologyAcceptance: boolean;
}) {
  const {
    dRows,
    altRows,
    rawLines,
    wordGroups,
    ruleRows,
    paper,
    useTopologyAcceptance,
  } = args;

  if (!dRows.length) {
    return {
      selection: {
        acceptedCandidateIndexes: [],
        latticeCount: 0,
        anchoredLatticeCount: 0,
        latticeCandidateCount: 0,
        traces: [],
      } as LatticeSelection,
      trace: {
        anchorCount: 0,
        rowLikeCandidateCount: altRows.filter((row) => row.rowLike).length,
        pitch: 0,
        envelope: null,
        acceptanceFloor: null,
      },
    };
  }

  const anchorInfo = highConfidenceAnchors({
    dRows,
    rawLines,
    wordGroups,
    ruleRows,
  });

  const medianDHeight = Math.max(1, median(dRows.map(rowHeight)));

  const pitchInfo = robustLatticePitch({
    anchors: anchorInfo.anchors,
    altRows,
    medianRowHeight: medianDHeight,
  });

  const envelope = inferEnvelope({
    paper,
    dRows,
    rawLines,
    ruleRows,
    pitch: pitchInfo.pitch,
  });

  const rowLikeScores = altRows
    .filter((row) => row.rowLike)
    .map((row) => row.rowLikeScore);

  const topologyAcceptanceFloor = rowLikeScores.length
    ? percentile(rowLikeScores, 0.35)
    : 0;

  const accepted = new Set<number>();
  const traces: any[] = [];

  const maxSteps = Math.max(
    1,
    Math.ceil((envelope.bottom - envelope.top) / Math.max(1, pitchInfo.pitch)) + 2,
  );

  for (const anchor of anchorInfo.anchors) {
    const latticeTrace: any = {
      anchorIndex: anchor.anchorIndex,
      anchorCenter: anchor.center,
      supportCount: anchor.supportCount,
      directions: [],
    };

    for (const direction of [-1, 1] as const) {
      let currentCenter = anchor.center;
      const directionTrace: any = {
        direction,
        steps: [],
      };

      for (let step = 1; step <= maxSteps; step += 1) {
        const expectedCenter =
          currentCenter + direction * pitchInfo.pitch;

        if (
          expectedCenter < envelope.top ||
          expectedCenter > envelope.bottom
        ) {
          break;
        }

        const candidates = altRows.filter((candidate) => {
          if (accepted.has(candidate.candidateIndex)) return false;

          const distance = Math.abs(candidate.center - expectedCenter);
          const withinPitch = distance <= pitchInfo.pitch * 0.48;

          return withinPitch;
        });

        if (!candidates.length) {
          directionTrace.steps.push({
            step,
            expectedCenter,
            matched: false,
          });
          break;
        }

        const ranked = [...candidates].sort((a, b) => {
          if (!useTopologyAcceptance) {
            return (
              Math.abs(a.center - expectedCenter) -
              Math.abs(b.center - expectedCenter)
            );
          }

          return (
            candidateRank(b, expectedCenter, pitchInfo.pitch) -
            candidateRank(a, expectedCenter, pitchInfo.pitch)
          );
        });

        const winner = ranked[0];

        const acceptedByTopology =
          !useTopologyAcceptance ||
          (winner.rowLike &&
            winner.rowLikeScore >= topologyAcceptanceFloor);

        directionTrace.steps.push({
          step,
          expectedCenter,
          matched: true,
          candidateIndex: winner.candidateIndex,
          candidateCenter: winner.center,
          distance: Math.abs(winner.center - expectedCenter),
          rowLikeScore: winner.rowLikeScore,
          topologyAcceptanceFloor,
          acceptedByTopology,
        });

        if (!acceptedByTopology) {
          break;
        }

        accepted.add(winner.candidateIndex);
        currentCenter = winner.center;
      }

      latticeTrace.directions.push(directionTrace);
    }

    traces.push(latticeTrace);
  }

  return {
    selection: {
      acceptedCandidateIndexes: Array.from(accepted),
      latticeCount: anchorInfo.anchors.length,
      anchoredLatticeCount: anchorInfo.anchors.length,
      latticeCandidateCount: accepted.size,
      traces,
    } as LatticeSelection,
    trace: {
      anchorCount: anchorInfo.anchors.length,
      allAnchorCandidates: anchorInfo.all,
      fallbackWeakAnchorUsed: anchorInfo.fallbackWeakAnchorUsed,
      rowLikeCandidateCount: altRows.filter((row) => row.rowLike).length,
      pitch: pitchInfo.pitch,
      pitchEvidenceGapCount: pitchInfo.evidenceGapCount,
      pitchRetainedGapCount: pitchInfo.retainedGapCount,
      envelope,
      topologyAcceptanceFloor,
    },
  };
}
