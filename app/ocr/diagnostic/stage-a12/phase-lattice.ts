import type {
  GeometryRow,
} from "../stage-a4/runtime-tsv";
import type {
  StageA5LineProposal,
  StageA5SelectiveRow,
} from "../stage-a5/selective-tsv";
import type {
  AltTopologyCandidate,
} from "../stage-a11/anchored-lattice";

export type PhasePitchHypothesis = {
  pitch: number;
  sourceGapCount: number;
  supportScore: number;
};

export type PhaseLatticeResult = {
  acceptedCandidateIndexes: number[];
  pitchHypothesisCount: number;
  selectedPitch: number;
  phaseOrigin: number | null;
  phaseConsensusSupport: number;
  selfSeededLatticeCount: number;
  DAnchoredLatticeCount: number;
  phasePositionCount: number;
  phaseMatchedPositionCount: number;
  phaseUnmatchedPositionCount: number;
  dAnchorCount: number;
  rowLikeCandidateCount: number;
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
  return overlap / Math.min(rowHeight(a), rowHeight(b));
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

function buildDAnchors(args: {
  dRows: StageA5SelectiveRow[];
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
  ruleRows: StageA5SelectiveRow[];
}) {
  const { dRows, rawLines, wordGroups, ruleRows } = args;
  const medianDHeight = Math.max(
    1,
    median(dRows.map(rowHeight)),
  );

  return dRows
    .map((candidate, index) => {
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
    })
    .filter((anchor) => anchor.supportCount >= 1);
}

function inferEnvelope(args: {
  dRows: StageA5SelectiveRow[];
  altRows: AltTopologyCandidate[];
  medianHeight: number;
}) {
  const { dRows, altRows, medianHeight } = args;

  const centers = [
    ...dRows.map((row) => row.center),
    ...altRows
      .filter((row) => row.rowLike)
      .map((row) => row.center),
  ].sort((a, b) => a - b);

  if (!centers.length) {
    return { top: 0, bottom: 0 };
  }

  const q05 = percentile(centers, 0.05);
  const q95 = percentile(centers, 0.95);

  return {
    top: Math.max(
      Math.min(...centers),
      q05 - medianHeight * 2.5,
    ),
    bottom: Math.min(
      Math.max(...centers),
      q95 + medianHeight * 2.5,
    ),
  };
}

function collectGapEvidence(
  centers: number[],
  medianHeight: number,
) {
  const sorted = [...centers].sort((a, b) => a - b);
  const gaps = sorted
    .slice(1)
    .map((center, index) => center - sorted[index])
    .filter((gap) => gap > medianHeight * 0.5);

  if (!gaps.length) return [];

  const q75 = percentile(gaps, 0.75);
  const upper = Math.max(
    medianHeight * 2.2,
    q75 * 1.35,
  );

  return gaps.filter(
    (gap) =>
      gap >= medianHeight * 0.7 &&
      gap <= upper,
  );
}

export function derivePitchHypotheses(args: {
  dRows: StageA5SelectiveRow[];
  altRows: AltTopologyCandidate[];
}) {
  const { dRows, altRows } = args;

  const rowLikeAlt = altRows.filter((row) => row.rowLike);
  const medianHeight = Math.max(
    1,
    median([
      ...dRows.map(rowHeight),
      ...rowLikeAlt.map((row) => row.height),
    ]),
  );

  const centers = [
    ...dRows.map((row) => row.center),
    ...rowLikeAlt.map((row) => row.center),
  ];

  const gaps = collectGapEvidence(centers, medianHeight);

  if (!gaps.length) {
    return {
      hypotheses: [] as PhasePitchHypothesis[],
      medianHeight,
      gapEvidence: [] as number[],
    };
  }

  const gapTolerance = Math.max(
    3,
    medianHeight * 0.35,
  );

  const clusters: number[][] = [];

  for (const gap of [...gaps].sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1];

    if (!last) {
      clusters.push([gap]);
      continue;
    }

    const clusterCenter = median(last);

    if (Math.abs(gap - clusterCenter) <= gapTolerance) {
      last.push(gap);
    } else {
      clusters.push([gap]);
    }
  }

  const hypotheses = clusters
    .map((cluster) => ({
      pitch: median(cluster),
      sourceGapCount: cluster.length,
      supportScore:
        cluster.length /
        Math.max(1, gaps.length),
    }))
    .filter(
      (hypothesis) =>
        hypothesis.pitch >= medianHeight * 0.9,
    )
    .sort((a, b) => {
      if (b.sourceGapCount !== a.sourceGapCount) {
        return b.sourceGapCount - a.sourceGapCount;
      }
      return a.pitch - b.pitch;
    })
    .slice(0, 3);

  return {
    hypotheses,
    medianHeight,
    gapEvidence: gaps,
  };
}

function residualToPhase(
  center: number,
  phase: number,
  pitch: number,
) {
  const k = Math.round((center - phase) / pitch);
  const expected = phase + k * pitch;
  return {
    k,
    expected,
    residual: Math.abs(center - expected),
  };
}

function evidenceWeight(candidate: AltTopologyCandidate) {
  const supportBoost =
    Number(candidate.autoRawLineSupport) * 0.08 +
    Number(candidate.autoWordGroupSupport) * 0.08 +
    Number(candidate.ruleSupport) * 0.05;

  return (
    candidate.rowLikeScore * 0.45 +
    candidate.heightSimilarity * 0.15 +
    candidate.horizontalConsistency * 0.12 +
    candidate.columnCoverage * 0.1 +
    candidate.compactness * 0.1 +
    supportBoost
  );
}

function scorePhase(args: {
  phase: number;
  pitch: number;
  altRows: AltTopologyCandidate[];
  anchors: Array<{ center: number; supportCount: number }>;
}) {
  const { phase, pitch, altRows, anchors } = args;
  const tolerance = pitch * 0.3;

  let support = 0;
  let alignedAlt = 0;
  let alignedAnchors = 0;

  for (const candidate of altRows) {
    if (!candidate.rowLike) continue;

    const residual = residualToPhase(
      candidate.center,
      phase,
      pitch,
    ).residual;

    if (residual <= tolerance) {
      const phaseCloseness = Math.max(
        0,
        1 - residual / Math.max(1, tolerance),
      );
      support +=
        evidenceWeight(candidate) *
        phaseCloseness;
      alignedAlt += 1;
    }
  }

  for (const anchor of anchors) {
    const residual = residualToPhase(
      anchor.center,
      phase,
      pitch,
    ).residual;

    if (residual <= tolerance) {
      const phaseCloseness = Math.max(
        0,
        1 - residual / Math.max(1, tolerance),
      );
      support +=
        Math.min(1, anchor.supportCount / 3) *
        0.4 *
        phaseCloseness;
      alignedAnchors += 1;
    }
  }

  return {
    support,
    alignedAlt,
    alignedAnchors,
    tolerance,
  };
}

function selectPhaseHypothesis(args: {
  hypotheses: PhasePitchHypothesis[];
  altRows: AltTopologyCandidate[];
  anchors: Array<{ center: number; supportCount: number }>;
  selfSeeded: boolean;
}) {
  const { hypotheses, altRows, anchors, selfSeeded } = args;

  const origins = selfSeeded
    ? [
        ...anchors.map((anchor) => ({
          origin: anchor.center,
          source: "D-anchor" as const,
        })),
        ...altRows
          .filter((row) => row.rowLike)
          .map((row) => ({
            origin: row.center,
            source: "ALT-self" as const,
          })),
      ]
    : anchors.map((anchor) => ({
        origin: anchor.center,
        source: "D-anchor" as const,
      }));

  const scored: any[] = [];

  for (const hypothesis of hypotheses) {
    for (const origin of origins) {
      const phaseScore = scorePhase({
        phase: origin.origin,
        pitch: hypothesis.pitch,
        altRows,
        anchors,
      });

      const periodicScore =
        phaseScore.support *
        (0.85 + hypothesis.supportScore * 0.15);

      scored.push({
        pitch: hypothesis.pitch,
        phase: origin.origin,
        phaseSource: origin.source,
        sourceGapCount: hypothesis.sourceGapCount,
        periodicScore,
        ...phaseScore,
      });
    }
  }

  const best = scored.sort(
    (a, b) => b.periodicScore - a.periodicScore,
  )[0];

  return {
    best: best || null,
    scored,
  };
}

function generatePhasePositions(args: {
  phase: number;
  pitch: number;
  envelope: { top: number; bottom: number };
}) {
  const { phase, pitch, envelope } = args;

  if (
    !Number.isFinite(phase) ||
    !Number.isFinite(pitch) ||
    pitch <= 0 ||
    envelope.bottom < envelope.top
  ) {
    return [] as Array<{ k: number; center: number }>;
  }

  const minK = Math.floor(
    (envelope.top - phase) / pitch,
  );
  const maxK = Math.ceil(
    (envelope.bottom - phase) / pitch,
  );

  const positions: Array<{ k: number; center: number }> = [];

  for (let k = minK; k <= maxK; k += 1) {
    const center = phase + k * pitch;
    if (
      center >= envelope.top &&
      center <= envelope.bottom
    ) {
      positions.push({ k, center });
    }
  }

  return positions;
}

function assignmentRank(
  candidate: AltTopologyCandidate,
  positionCenter: number,
  pitch: number,
) {
  const phaseDistanceScore = Math.max(
    0,
    1 -
      Math.abs(candidate.center - positionCenter) /
        Math.max(1, pitch * 0.35),
  );

  const supportBoost =
    Number(candidate.autoRawLineSupport) * 0.08 +
    Number(candidate.autoWordGroupSupport) * 0.08 +
    Number(candidate.ruleSupport) * 0.05;

  return (
    phaseDistanceScore * 0.34 +
    candidate.rowLikeScore * 0.24 +
    candidate.heightSimilarity * 0.11 +
    candidate.horizontalConsistency * 0.1 +
    candidate.columnCoverage * 0.08 +
    candidate.compactness * 0.08 +
    supportBoost
  );
}

function assignCandidates(args: {
  positions: Array<{ k: number; center: number }>;
  altRows: AltTopologyCandidate[];
  pitch: number;
}) {
  const { positions, altRows, pitch } = args;
  const accepted = new Set<number>();
  const traces: any[] = [];
  const tolerance = pitch * 0.35;

  for (const position of positions) {
    const candidates = altRows.filter(
      (candidate) =>
        candidate.rowLike &&
        !accepted.has(candidate.candidateIndex) &&
        Math.abs(candidate.center - position.center) <= tolerance,
    );

    if (!candidates.length) {
      traces.push({
        k: position.k,
        phaseCenter: position.center,
        matched: false,
      });
      continue;
    }

    const ranked = [...candidates].sort(
      (a, b) =>
        assignmentRank(b, position.center, pitch) -
        assignmentRank(a, position.center, pitch),
    );

    const winner = ranked[0];
    accepted.add(winner.candidateIndex);

    traces.push({
      k: position.k,
      phaseCenter: position.center,
      matched: true,
      candidateIndex: winner.candidateIndex,
      candidateCenter: winner.center,
      distance: Math.abs(
        winner.center - position.center,
      ),
      score: assignmentRank(
        winner,
        position.center,
        pitch,
      ),
    });
  }

  return {
    acceptedCandidateIndexes: Array.from(accepted),
    traces,
    matchedCount: traces.filter((trace) => trace.matched).length,
    unmatchedCount: traces.filter((trace) => !trace.matched).length,
  };
}

export function runPhaseLockedLattice(args: {
  dRows: StageA5SelectiveRow[];
  altRows: AltTopologyCandidate[];
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
  ruleRows: StageA5SelectiveRow[];
  selfSeeded: boolean;
}) : PhaseLatticeResult {
  const {
    dRows,
    altRows,
    rawLines,
    wordGroups,
    ruleRows,
    selfSeeded,
  } = args;

  const anchors = buildDAnchors({
    dRows,
    rawLines,
    wordGroups,
    ruleRows,
  });

  const pitchInfo = derivePitchHypotheses({
    dRows,
    altRows,
  });

  const envelope = inferEnvelope({
    dRows,
    altRows,
    medianHeight: pitchInfo.medianHeight,
  });

  const phase = selectPhaseHypothesis({
    hypotheses: pitchInfo.hypotheses,
    altRows,
    anchors,
    selfSeeded,
  });

  if (!phase.best) {
    return {
      acceptedCandidateIndexes: [],
      pitchHypothesisCount: pitchInfo.hypotheses.length,
      selectedPitch: 0,
      phaseOrigin: null,
      phaseConsensusSupport: 0,
      selfSeededLatticeCount: 0,
      DAnchoredLatticeCount: 0,
      phasePositionCount: 0,
      phaseMatchedPositionCount: 0,
      phaseUnmatchedPositionCount: 0,
      dAnchorCount: anchors.length,
      rowLikeCandidateCount: altRows.filter((row) => row.rowLike).length,
      traces: [],
    };
  }

  const positions = generatePhasePositions({
    phase: phase.best.phase,
    pitch: phase.best.pitch,
    envelope,
  });

  const assignment = assignCandidates({
    positions,
    altRows,
    pitch: phase.best.pitch,
  });

  const selfSeededUsed =
    phase.best.phaseSource === "ALT-self";

  return {
    acceptedCandidateIndexes:
      assignment.acceptedCandidateIndexes,
    pitchHypothesisCount:
      pitchInfo.hypotheses.length,
    selectedPitch:
      phase.best.pitch,
    phaseOrigin:
      phase.best.phase,
    phaseConsensusSupport:
      phase.best.periodicScore,
    selfSeededLatticeCount:
      selfSeededUsed ? 1 : 0,
    DAnchoredLatticeCount:
      selfSeededUsed ? 0 : 1,
    phasePositionCount:
      positions.length,
    phaseMatchedPositionCount:
      assignment.matchedCount,
    phaseUnmatchedPositionCount:
      assignment.unmatchedCount,
    dAnchorCount:
      anchors.length,
    rowLikeCandidateCount:
      altRows.filter((row) => row.rowLike).length,
    traces: [
      {
        selectedPhase: phase.best,
        envelope,
        pitchHypotheses: pitchInfo.hypotheses,
        assignment: assignment.traces,
      },
    ],
  };
}
