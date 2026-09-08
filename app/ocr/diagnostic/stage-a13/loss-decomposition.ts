export type PhaseLossReason =
  | "NO_ALT_CANDIDATE"
  | "NOT_ROW_LIKE"
  | "PITCH_HYPOTHESIS_MISS"
  | "PHASE_RESIDUAL_REJECT"
  | "ASSIGNMENT_LOSS"
  | "DEDUPE_CONFLICT"
  | "OTHER_GEOMETRY";

type GtRow = {
  rowIndex: number;
  y1Norm: number;
  y2Norm: number;
};

type MappedCandidate = {
  candidateIndex: number;
  centerYNorm: number;
  matchedGtRowIndex: number | null;
};

type TopologyCandidate = {
  candidateIndex: number;
  center: number;
  rowLike: boolean;
  rowLikeScore: number;
  heightSimilarity: number;
  horizontalConsistency: number;
  columnCoverage: number;
};

type PhasePosition = {
  k: number;
  phaseCenter: number;
  centerYNorm: number;
  matched: boolean;
  candidateIndex?: number | null;
  candidateCenter?: number | null;
  distance?: number | null;
  score?: number | null;
};

function countReasons(rows: Array<{ reason: PhaseLossReason }>) {
  const out: Record<PhaseLossReason, number> = {
    NO_ALT_CANDIDATE: 0,
    NOT_ROW_LIKE: 0,
    PITCH_HYPOTHESIS_MISS: 0,
    PHASE_RESIDUAL_REJECT: 0,
    ASSIGNMENT_LOSS: 0,
    DEDUPE_CONFLICT: 0,
    OTHER_GEOMETRY: 0,
  };

  for (const row of rows) out[row.reason] += 1;
  return out;
}

export function diagnosePhaseLosses(args: {
  lostRowIndices: number[];
  gtRows: GtRow[];
  altMapped: MappedCandidate[];
  topologyRows: TopologyCandidate[];
  phasePositions: PhasePosition[];
  selectedPitch: number;
  acceptedCandidateIndexes: number[];
}) {
  const {
    lostRowIndices,
    gtRows,
    altMapped,
    topologyRows,
    phasePositions,
    selectedPitch,
    acceptedCandidateIndexes,
  } = args;

  const acceptedSet = new Set(acceptedCandidateIndexes);
  const assignmentTolerance =
    selectedPitch > 0 ? selectedPitch * 0.35 : 0;

  const rows = lostRowIndices.map((rowIndex) => {
    const gt = gtRows.find((row) => row.rowIndex === rowIndex);

    if (!gt) {
      return {
        rowIndex,
        reason: "OTHER_GEOMETRY" as PhaseLossReason,
        diagnostic: { gtRowMissing: true },
      };
    }

    const correctAlt = altMapped.filter(
      (candidate) => candidate.matchedGtRowIndex === rowIndex,
    );

    if (!correctAlt.length) {
      return {
        rowIndex,
        reason: "NO_ALT_CANDIDATE" as PhaseLossReason,
        diagnostic: {
          correctAltCandidateCount: 0,
        },
      };
    }

    const correctIndices = new Set(
      correctAlt.map((candidate) => candidate.candidateIndex),
    );

    const rowLikeCorrect = topologyRows.filter(
      (candidate) =>
        correctIndices.has(candidate.candidateIndex) &&
        candidate.rowLike,
    );

    if (!rowLikeCorrect.length) {
      return {
        rowIndex,
        reason: "NOT_ROW_LIKE" as PhaseLossReason,
        diagnostic: {
          correctAltCandidateCount: correctAlt.length,
          correctCandidateIndexes: Array.from(correctIndices),
          rowLikeCorrectCount: 0,
          candidateRowLike: topologyRows
            .filter((candidate) =>
              correctIndices.has(candidate.candidateIndex),
            )
            .map((candidate) => ({
              candidateIndex: candidate.candidateIndex,
              rowLike: candidate.rowLike,
              rowLikeScore: candidate.rowLikeScore,
              heightSimilarity: candidate.heightSimilarity,
              horizontalConsistency:
                candidate.horizontalConsistency,
              columnCoverage: candidate.columnCoverage,
            })),
        },
      };
    }

    const positionsForGt = phasePositions.filter(
      (position) =>
        position.centerYNorm >= gt.y1Norm &&
        position.centerYNorm <= gt.y2Norm,
    );

    const correctAlreadyAccepted = rowLikeCorrect.filter((candidate) =>
      acceptedSet.has(candidate.candidateIndex),
    );

    if (correctAlreadyAccepted.length) {
      return {
        rowIndex,
        reason: "DEDUPE_CONFLICT" as PhaseLossReason,
        diagnostic: {
          note:
            "A correct candidate is present in the global accepted set but the row remains post-hoc lost.",
          acceptedCorrectCandidateIndexes:
            correctAlreadyAccepted.map(
              (candidate) => candidate.candidateIndex,
            ),
          phasePositionsForGt: positionsForGt,
        },
      };
    }

    if (!positionsForGt.length) {
      return {
        rowIndex,
        reason: "PITCH_HYPOTHESIS_MISS" as PhaseLossReason,
        diagnostic: {
          selectedPitch,
          correctCandidateIndexes: rowLikeCorrect.map(
            (candidate) => candidate.candidateIndex,
          ),
          correctCandidateCenters: rowLikeCorrect.map(
            (candidate) => candidate.center,
          ),
          phasePositionCount: phasePositions.length,
          nearestPhasePosition:
            phasePositions.length && rowLikeCorrect.length
              ? null
              : null,
        },
      };
    }

    const eligiblePairs = positionsForGt.flatMap((position) =>
      rowLikeCorrect
        .map((candidate) => ({
          position,
          candidate,
          residual: Math.abs(
            candidate.center - position.phaseCenter,
          ),
        }))
        .filter(
          (pair) =>
            selectedPitch > 0 &&
            pair.residual <= assignmentTolerance,
        ),
    );

    if (!eligiblePairs.length) {
      return {
        rowIndex,
        reason: "PHASE_RESIDUAL_REJECT" as PhaseLossReason,
        diagnostic: {
          selectedPitch,
          assignmentTolerance,
          phasePositionsForGt: positionsForGt,
          correctCandidates: rowLikeCorrect.map((candidate) => ({
            candidateIndex: candidate.candidateIndex,
            center: candidate.center,
            rowLikeScore: candidate.rowLikeScore,
          })),
          minimumResidual: Math.min(
            ...positionsForGt.flatMap((position) =>
              rowLikeCorrect.map((candidate) =>
                Math.abs(candidate.center - position.phaseCenter),
              ),
            ),
          ),
        },
      };
    }

    const assignmentLossPairs = eligiblePairs.filter(
      ({ position, candidate }) =>
        position.matched &&
        position.candidateIndex != null &&
        position.candidateIndex !== candidate.candidateIndex,
    );

    if (assignmentLossPairs.length) {
      return {
        rowIndex,
        reason: "ASSIGNMENT_LOSS" as PhaseLossReason,
        diagnostic: {
          selectedPitch,
          assignmentTolerance,
          competingAssignments: assignmentLossPairs.map((pair) => ({
            k: pair.position.k,
            phaseCenter: pair.position.phaseCenter,
            correctCandidateIndex: pair.candidate.candidateIndex,
            correctCandidateCenter: pair.candidate.center,
            residual: pair.residual,
            winnerCandidateIndex: pair.position.candidateIndex,
            winnerCandidateCenter: pair.position.candidateCenter,
            winnerDistance: pair.position.distance,
            winnerScore: pair.position.score,
          })),
        },
      };
    }

    const unmatchedEligible = eligiblePairs.filter(
      ({ position }) => !position.matched,
    );

    if (unmatchedEligible.length) {
      return {
        rowIndex,
        reason: "OTHER_GEOMETRY" as PhaseLossReason,
        diagnostic: {
          note:
            "A row-like correct candidate is within assignment tolerance of an unmatched phase position, but was not selected.",
          selectedPitch,
          assignmentTolerance,
          unmatchedEligible: unmatchedEligible.map((pair) => ({
            k: pair.position.k,
            phaseCenter: pair.position.phaseCenter,
            candidateIndex: pair.candidate.candidateIndex,
            candidateCenter: pair.candidate.center,
            residual: pair.residual,
          })),
        },
      };
    }

    return {
      rowIndex,
      reason: "OTHER_GEOMETRY" as PhaseLossReason,
      diagnostic: {
        selectedPitch,
        assignmentTolerance,
        phasePositionsForGt: positionsForGt,
        correctCandidateIndexes: rowLikeCorrect.map(
          (candidate) => candidate.candidateIndex,
        ),
      },
    };
  });

  return {
    lostRowCount: rows.length,
    reasonCounts: countReasons(rows),
    rows,
  };
}

export function summarizePhaseSuccess(args: {
  rescuedRowIndices: number[];
  altMapped: MappedCandidate[];
  acceptedCandidateIndexes: number[];
  phasePositions: PhasePosition[];
}) {
  const {
    rescuedRowIndices,
    altMapped,
    acceptedCandidateIndexes,
    phasePositions,
  } = args;

  const acceptedSet = new Set(acceptedCandidateIndexes);

  return rescuedRowIndices.map((rowIndex) => {
    const acceptedCorrect = altMapped.filter(
      (candidate) =>
        candidate.matchedGtRowIndex === rowIndex &&
        acceptedSet.has(candidate.candidateIndex),
    );

    const candidateIndexes = acceptedCorrect.map(
      (candidate) => candidate.candidateIndex,
    );

    const assignments = phasePositions
      .filter(
        (position) =>
          position.candidateIndex != null &&
          candidateIndexes.includes(position.candidateIndex),
      )
      .map((position) => ({
        k: position.k,
        phaseCenter: position.phaseCenter,
        candidateIndex: position.candidateIndex,
        candidateCenter: position.candidateCenter,
        distance: position.distance,
        score: position.score,
      }));

    return {
      rowIndex,
      acceptedCandidateIndexes: candidateIndexes,
      assignments,
    };
  });
}
