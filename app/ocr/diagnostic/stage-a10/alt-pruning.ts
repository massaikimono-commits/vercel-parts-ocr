import type { CropBox } from "../../dynamic-rows";
import type { GeometryRow, RuntimeTsvRecord } from "../stage-a4/runtime-tsv";
import type { StageA5LineProposal, StageA5SelectiveRow } from "../stage-a5/selective-tsv";
import type { AltRowProposal } from "../stage-a9/targeted-split-alt";

export type AltCandidateFeature = {
  candidateIndex: number;
  centerY: number;
  top: number;
  bottom: number;
  height: number;
  wordCount: number;
  clusterYSpread: number;
  xSpan: number;
  xSpanRatio: number;
  rowHeightRatio: number;
  nearestDCenterDistance: number;
  nearestDBandOverlap: number;
  gapAboveD: number | null;
  gapBelowD: number | null;
  localMedianRowPitch: number;
  nearestMissingSlotDistance: number | null;
  nearestMissingSlotDistanceRatio: number | null;
  autoRawLineSupport: boolean;
  autoWordGroupSupport: boolean;
  ruleGeometrySupport: boolean;
  insideTableEnvelope: boolean;
  nearbyAltProposalCount: number;
  altWordCountRelative: number;
  xSpanRelative: number;
  compactnessScore: number;
  heightSimilarityScore: number;
};

export type MissingSlot = {
  slotId: string;
  center: number;
  source: "interior-gap" | "leading-edge" | "trailing-edge";
  pitch: number;
  gapStart: number | null;
  gapEnd: number | null;
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
  const pos = Math.max(0, Math.min(sorted.length - 1, p * (sorted.length - 1)));
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

function robustPitch(centers: number[], medianHeight: number) {
  const sorted = [...centers].sort((a, b) => a - b);
  const gaps = sorted
    .slice(1)
    .map((center, index) => center - sorted[index])
    .filter((gap) => gap > Math.max(2, medianHeight * 0.35));

  if (!gaps.length) {
    return {
      pitch: Math.max(8, medianHeight * 1.8),
      gaps: [] as number[],
      retainedGaps: [] as number[],
    };
  }

  const seed = Math.max(1, percentile(gaps, 0.45));
  const retained = gaps.filter(
    (gap) =>
      gap >= Math.max(medianHeight * 0.65, seed * 0.55) &&
      gap <= seed * 1.8,
  );

  const pitch = Math.max(
    medianHeight * 1.2,
    median(retained.length ? retained : gaps),
  );

  return {
    pitch,
    gaps,
    retainedGaps: retained,
  };
}

function estimateEnvelope(args: {
  paper: CropBox;
  dRows: StageA5SelectiveRow[];
  ruleRows: StageA5SelectiveRow[];
  rawLines: StageA5LineProposal[];
  pitch: number;
}) {
  const { paper, dRows, ruleRows, rawLines, pitch } = args;

  const centers = [
    ...dRows.map((row) => row.center),
    ...ruleRows.map((row) => row.center),
    ...rawLines.map((row) => row.center),
  ].filter(
    (center) => center >= paper.y && center <= paper.y + paper.h,
  );

  if (!centers.length) {
    return {
      top: paper.y,
      bottom: paper.y + paper.h,
    };
  }

  const q10 = percentile(centers, 0.1);
  const q90 = percentile(centers, 0.9);

  return {
    top: Math.max(paper.y, q10 - pitch * 1.2),
    bottom: Math.min(
      paper.y + paper.h,
      q90 + pitch * 1.2,
    ),
  };
}

function makeMissingSlots(args: {
  dRows: StageA5SelectiveRow[];
  pitch: number;
  envelope: { top: number; bottom: number };
}) {
  const { dRows, pitch, envelope } = args;

  const centers = [...dRows]
    .map((row) => row.center)
    .sort((a, b) => a - b);

  const slots: MissingSlot[] = [];

  for (let i = 1; i < centers.length; i += 1) {
    const prev = centers[i - 1];
    const next = centers[i];
    const gap = next - prev;

    if (gap <= pitch * 1.55) continue;

    const missingCount = Math.max(
      1,
      Math.round(gap / pitch) - 1,
    );

    const step = gap / (missingCount + 1);

    for (let j = 1; j <= missingCount; j += 1) {
      const center = prev + step * j;
      if (
        center < envelope.top ||
        center > envelope.bottom
      ) {
        continue;
      }

      slots.push({
        slotId: `gap-${i}-slot-${j}`,
        center,
        source: "interior-gap",
        pitch,
        gapStart: prev,
        gapEnd: next,
      });
    }
  }

  if (centers.length) {
    const leading = centers[0] - pitch;
    const trailing = centers[centers.length - 1] + pitch;

    if (leading >= envelope.top) {
      slots.push({
        slotId: "leading-edge-slot",
        center: leading,
        source: "leading-edge",
        pitch,
        gapStart: null,
        gapEnd: centers[0],
      });
    }

    if (trailing <= envelope.bottom) {
      slots.push({
        slotId: "trailing-edge-slot",
        center: trailing,
        source: "trailing-edge",
        pitch,
        gapStart: centers[centers.length - 1],
        gapEnd: null,
      });
    }
  }

  return slots;
}

function wordsInsideCandidate(
  records: RuntimeTsvRecord[],
  candidate: AltRowProposal,
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

    const centerX = record.left + record.width / 2;
    const centerY = record.top + record.height / 2;

    return (
      centerX >= paper.x &&
      centerX <= paper.x + paper.w &&
      centerY >= candidate.top &&
      centerY <= candidate.bottom
    );
  });
}

function nearestRows(
  center: number,
  rows: Array<{ top: number; bottom: number; center: number }>,
) {
  const sorted = [...rows].sort((a, b) => a.center - b.center);
  const below = [...sorted]
    .filter((row) => row.center < center)
    .sort((a, b) => b.center - a.center)[0];
  const above = sorted.find((row) => row.center > center);

  return {
    below: below || null,
    above: above || null,
  };
}

function structuralScore(feature: AltCandidateFeature) {
  const slotScore =
    feature.nearestMissingSlotDistanceRatio == null
      ? 0
      : Math.max(
          0,
          1 - feature.nearestMissingSlotDistanceRatio,
        );

  const supportScore =
    Number(feature.autoRawLineSupport) * 0.15 +
    Number(feature.autoWordGroupSupport) * 0.15 +
    Number(feature.ruleGeometrySupport) * 0.1;

  const wordScore = Math.min(
    1,
    Math.max(0, feature.altWordCountRelative),
  );

  const spanScore = Math.min(
    1,
    Math.max(0, feature.xSpanRelative),
  );

  return (
    slotScore * 0.35 +
    feature.compactnessScore * 0.15 +
    feature.heightSimilarityScore * 0.15 +
    wordScore * 0.1 +
    spanScore * 0.1 +
    supportScore
  );
}

export function buildAltPruningContext(args: {
  dRows: StageA5SelectiveRow[];
  altRows: AltRowProposal[];
  altRecords: RuntimeTsvRecord[];
  paper: CropBox;
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
  ruleRows: StageA5SelectiveRow[];
}) {
  const {
    dRows,
    altRows,
    altRecords,
    paper,
    rawLines,
    wordGroups,
    ruleRows,
  } = args;

  const medianDHeight = Math.max(
    1,
    median(dRows.map(rowHeight)),
  );

  const pitchInfo = robustPitch(
    dRows.map((row) => row.center),
    medianDHeight,
  );

  const envelope = estimateEnvelope({
    paper,
    dRows,
    ruleRows,
    rawLines,
    pitch: pitchInfo.pitch,
  });

  const slots = makeMissingSlots({
    dRows,
    pitch: pitchInfo.pitch,
    envelope,
  });

  const wordCounts = altRows.map(
    (candidate) =>
      wordsInsideCandidate(
        altRecords,
        candidate,
        paper,
      ).length,
  );

  const medianWordCount = Math.max(
    1,
    median(wordCounts.filter((count) => count > 0)),
  );

  const xSpans = altRows.map((candidate) => {
    const words = wordsInsideCandidate(
      altRecords,
      candidate,
      paper,
    );

    if (!words.length) return 0;

    return (
      Math.max(
        ...words.map(
          (word) => word.left + word.width,
        ),
      ) -
      Math.min(...words.map((word) => word.left))
    );
  });

  const medianXSpan = Math.max(
    1,
    median(xSpans.filter((span) => span > 0)),
  );

  const features: AltCandidateFeature[] = altRows.map(
    (candidate, index) => {
      const words = wordsInsideCandidate(
        altRecords,
        candidate,
        paper,
      );

      const wordCenters = words.map(
        (word) => word.top + word.height / 2,
      );

      const clusterYSpread = wordCenters.length
        ? Math.max(...wordCenters) -
          Math.min(...wordCenters)
        : 0;

      const xSpan = words.length
        ? Math.max(
            ...words.map(
              (word) => word.left + word.width,
            ),
          ) -
          Math.min(
            ...words.map((word) => word.left),
          )
        : 0;

      const nearestD = dRows.length
        ? [...dRows].sort(
            (a, b) =>
              Math.abs(a.center - candidate.center) -
              Math.abs(b.center - candidate.center),
          )[0]
        : null;

      const dNeighbors = nearestRows(
        candidate.center,
        dRows,
      );

      const nearestSlot = slots.length
        ? [...slots].sort(
            (a, b) =>
              Math.abs(a.center - candidate.center) -
              Math.abs(b.center - candidate.center),
          )[0]
        : null;

      const autoRawLineSupport = rawLines.some(
        (row) =>
          overlapRatio(candidate, row) >= 0.2 ||
          Math.abs(
            row.center - candidate.center,
          ) <= medianDHeight * 0.55,
      );

      const autoWordGroupSupport = wordGroups.some(
        (row) =>
          overlapRatio(candidate, row) >= 0.2 ||
          Math.abs(
            row.center - candidate.center,
          ) <= medianDHeight * 0.55,
      );

      const ruleGeometrySupport = ruleRows.some(
        (row) =>
          overlapRatio(candidate, row) >= 0.15 ||
          Math.abs(
            row.center - candidate.center,
          ) <= medianDHeight * 0.65,
      );

      const nearbyAltProposalCount = altRows.filter(
        (other, otherIndex) =>
          otherIndex !== index &&
          Math.abs(
            other.center - candidate.center,
          ) <= pitchInfo.pitch * 0.65,
      ).length;

      const height = rowHeight(candidate);
      const rowHeightRatio =
        height / medianDHeight;

      const compactnessScore =
        1 /
        (1 +
          clusterYSpread /
            Math.max(1, medianDHeight));

      const heightSimilarityScore =
        1 /
        (1 +
          Math.abs(
            Math.log(
              Math.max(
                1e-6,
                rowHeightRatio,
              ),
            ),
          ));

      return {
        candidateIndex: index + 1,
        centerY: candidate.center,
        top: candidate.top,
        bottom: candidate.bottom,
        height,
        wordCount: words.length,
        clusterYSpread,
        xSpan,
        xSpanRatio: xSpan / Math.max(1, paper.w),
        rowHeightRatio,
        nearestDCenterDistance: nearestD
          ? Math.abs(nearestD.center - candidate.center)
          : Infinity,
        nearestDBandOverlap: nearestD
          ? overlapRatio(candidate, nearestD)
          : 0,
        gapAboveD: dNeighbors.above
          ? dNeighbors.above.center - candidate.center
          : null,
        gapBelowD: dNeighbors.below
          ? candidate.center - dNeighbors.below.center
          : null,
        localMedianRowPitch: pitchInfo.pitch,
        nearestMissingSlotDistance: nearestSlot
          ? Math.abs(
              nearestSlot.center - candidate.center,
            )
          : null,
        nearestMissingSlotDistanceRatio:
          nearestSlot
            ? Math.abs(
                nearestSlot.center - candidate.center,
              ) / Math.max(1, pitchInfo.pitch)
            : null,
        autoRawLineSupport,
        autoWordGroupSupport,
        ruleGeometrySupport,
        insideTableEnvelope:
          candidate.center >= envelope.top &&
          candidate.center <= envelope.bottom,
        nearbyAltProposalCount,
        altWordCountRelative:
          words.length / medianWordCount,
        xSpanRelative: xSpan / medianXSpan,
        compactnessScore,
        heightSimilarityScore,
      };
    },
  );

  return {
    features,
    pitchInfo,
    envelope,
    slots,
    medians: {
      medianDHeight,
      medianAltWordCount: medianWordCount,
      medianAltXSpan: medianXSpan,
    },
  };
}

function onePerSlot(args: {
  features: AltCandidateFeature[];
  slots: MissingSlot[];
  mode: "gap" | "score";
}) {
  const { features, slots, mode } = args;

  const accepted: number[] = [];
  const slotAssignments: any[] = [];

  for (const slot of slots) {
    const candidates = features.filter(
      (feature) =>
        feature.insideTableEnvelope &&
        feature.nearestDBandOverlap < 0.25 &&
        feature.nearestMissingSlotDistanceRatio != null &&
        feature.nearestMissingSlotDistanceRatio <=
          (mode === "gap" ? 0.5 : 0.65) &&
        Math.abs(feature.centerY - slot.center) <=
          slot.pitch * (mode === "gap" ? 0.5 : 0.65),
    );

    if (!candidates.length) {
      slotAssignments.push({
        slotId: slot.slotId,
        acceptedCandidateIndex: null,
        candidateCount: 0,
      });
      continue;
    }

    const ranked = [...candidates].sort((a, b) => {
      if (mode === "gap") {
        return (
          Math.abs(a.centerY - slot.center) -
          Math.abs(b.centerY - slot.center)
        );
      }

      return structuralScore(b) - structuralScore(a);
    });

    const winner = ranked[0];

    if (!accepted.includes(winner.candidateIndex)) {
      accepted.push(winner.candidateIndex);
    }

    slotAssignments.push({
      slotId: slot.slotId,
      acceptedCandidateIndex:
        winner.candidateIndex,
      candidateCount: candidates.length,
      acceptedScore:
        mode === "score"
          ? structuralScore(winner)
          : null,
    });
  }

  return {
    acceptedCandidateIndexes: accepted,
    slotAssignments,
  };
}

export function selectGapOnly(
  context: ReturnType<
    typeof buildAltPruningContext
  >,
) {
  return onePerSlot({
    features: context.features,
    slots: context.slots,
    mode: "gap",
  });
}

export function selectGapPlusScore(
  context: ReturnType<
    typeof buildAltPruningContext
  >,
) {
  return onePerSlot({
    features: context.features,
    slots: context.slots,
    mode: "score",
  });
}
