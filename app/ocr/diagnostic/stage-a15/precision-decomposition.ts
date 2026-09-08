import type { AltTopologyCandidate } from "../stage-a11/anchored-lattice";
import type { PhaseLatticeResult } from "../stage-a12/phase-lattice";
import type { LatePhaseSelection } from "../stage-a14/late-reconsideration";

export type LateCandidatePostHocClass =
  | "NEW_GT_RECOVERY"
  | "ALREADY_COVERED_GT_DUPLICATE"
  | "OTHER";

export type LateCandidateOutcome =
  | "CORRECT_ACCEPTED"
  | "FALSE_ACCEPTED"
  | "CORRECT_REJECTED"
  | "FALSE_REJECTED";

export type LateCandidateMapped = {
  candidateIndex: number;
  matchedGtRowIndex: number | null;
};

export type LateCandidatePrecisionRow = {
  candidateIndex: number;
  accepted: boolean;
  outcome: LateCandidateOutcome;
  postHocClass: LateCandidatePostHocClass;
  matchedGtRowIndex: number | null;
  phasePositionK: number | null;
  phaseCenter: number | null;
  phaseResidual: number | null;
  nearestPhasePositionDistance: number | null;
  selectedPitch: number;
  phaseConsensusSupport: number;
  rowLike: boolean;
  rowLikeScore: number;
  rowLikeComponents: {
    heightSimilarity: number;
    horizontalConsistency: number;
    columnCoverage: number;
    compactness: number;
    autoRawLineSupport: boolean;
    autoWordGroupSupport: boolean;
    ruleSupport: boolean;
  };
  candidateGeometry: {
    top: number;
    bottom: number;
    center: number;
    height: number;
    widthProxy: number;
    xSpan: number;
    xSpanRatio: number;
    occupiedLaneCount: number;
    wordCount: number;
  };
  verticalGap: {
    aboveAcceptedCenterGap: number | null;
    belowAcceptedCenterGap: number | null;
    normalizedAboveGap: number | null;
    normalizedBelowGap: number | null;
  };
  neighborSupport: {
    aboveAcceptedExists: boolean;
    belowAcceptedExists: boolean;
    bothAcceptedNeighbors: boolean;
  };
  horizontalAlignment: {
    occupiedLaneIds: string[];
    sameColumnProxy: number;
    horizontalConsistency: number;
    columnCoverage: number;
  };
  existingPCandidateDistance: number | null;
  reconsiderationReason: "NOT_ROW_LIKE_UNMATCHED_PHASE";
};

function nearestDistance(value: number, values: number[]) {
  if (!values.length) return null;
  return Math.min(...values.map((item) => Math.abs(value - item)));
}

export function decomposeLateCandidatePrecision(args: {
  topologyRows: AltTopologyCandidate[];
  phaseResult: PhaseLatticeResult;
  lateSelection: LatePhaseSelection;
  mappedCandidates: LateCandidateMapped[];
  pCoveredGtRows: number[];
}): LateCandidatePrecisionRow[] {
  const {
    topologyRows,
    phaseResult,
    lateSelection,
    mappedCandidates,
    pCoveredGtRows,
  } = args;

  const considered = new Set(lateSelection.consideredCandidateIndexes);
  const accepted = new Set(lateSelection.acceptedCandidateIndexes);
  const mapped = new Map(
    mappedCandidates.map((item) => [item.candidateIndex, item.matchedGtRowIndex]),
  );
  const pCovered = new Set(pCoveredGtRows);
  const pAcceptedCenters = phaseResult.acceptedCandidateIndexes
    .map((index) => topologyRows[index - 1]?.center)
    .filter((value): value is number => Number.isFinite(value));

  const assignment = phaseResult.traces?.[0]?.assignment || [];
  const phaseCenters = assignment
    .map((position: any) => Number(position.phaseCenter))
    .filter((value: number) => Number.isFinite(value));

  return topologyRows
    .filter((candidate) => considered.has(candidate.candidateIndex))
    .map((candidate) => {
      const trace = lateSelection.traces.find((item) =>
        item.consideredCandidateIndexes.includes(candidate.candidateIndex),
      );
      const isAccepted = accepted.has(candidate.candidateIndex);
      const gtRow = mapped.get(candidate.candidateIndex) ?? null;
      const isCorrect = gtRow != null;

      const postHocClass: LateCandidatePostHocClass = !isCorrect
        ? "OTHER"
        : pCovered.has(gtRow)
          ? "ALREADY_COVERED_GT_DUPLICATE"
          : "NEW_GT_RECOVERY";

      const outcome: LateCandidateOutcome = isAccepted
        ? isCorrect
          ? "CORRECT_ACCEPTED"
          : "FALSE_ACCEPTED"
        : isCorrect
          ? "CORRECT_REJECTED"
          : "FALSE_REJECTED";

      const sortedAcceptedCenters = [...pAcceptedCenters].sort((a, b) => a - b);
      const above = [...sortedAcceptedCenters]
        .filter((center) => center < candidate.center)
        .sort((a, b) => b - a)[0];
      const below = [...sortedAcceptedCenters]
        .filter((center) => center > candidate.center)
        .sort((a, b) => a - b)[0];
      const pitch = phaseResult.selectedPitch || 0;
      const aboveGap = Number.isFinite(above) ? candidate.center - above : null;
      const belowGap = Number.isFinite(below) ? below - candidate.center : null;

      return {
        candidateIndex: candidate.candidateIndex,
        accepted: isAccepted,
        outcome,
        postHocClass,
        matchedGtRowIndex: gtRow,
        phasePositionK: trace?.k ?? null,
        phaseCenter: trace?.phaseCenter ?? null,
        phaseResidual:
          trace?.phaseCenter != null
            ? Math.abs(candidate.center - trace.phaseCenter)
            : null,
        nearestPhasePositionDistance: nearestDistance(candidate.center, phaseCenters),
        selectedPitch: pitch,
        phaseConsensusSupport: phaseResult.phaseConsensusSupport || 0,
        rowLike: candidate.rowLike,
        rowLikeScore: candidate.rowLikeScore,
        rowLikeComponents: {
          heightSimilarity: candidate.heightSimilarity,
          horizontalConsistency: candidate.horizontalConsistency,
          columnCoverage: candidate.columnCoverage,
          compactness: candidate.compactness,
          autoRawLineSupport: candidate.autoRawLineSupport,
          autoWordGroupSupport: candidate.autoWordGroupSupport,
          ruleSupport: candidate.ruleSupport,
        },
        candidateGeometry: {
          top: candidate.top,
          bottom: candidate.bottom,
          center: candidate.center,
          height: candidate.height,
          widthProxy: candidate.xSpan,
          xSpan: candidate.xSpan,
          xSpanRatio: candidate.xSpanRatio,
          occupiedLaneCount: candidate.occupiedLaneCount,
          wordCount: candidate.wordCount,
        },
        verticalGap: {
          aboveAcceptedCenterGap: aboveGap,
          belowAcceptedCenterGap: belowGap,
          normalizedAboveGap: aboveGap != null && pitch > 0 ? aboveGap / pitch : null,
          normalizedBelowGap: belowGap != null && pitch > 0 ? belowGap / pitch : null,
        },
        neighborSupport: {
          aboveAcceptedExists: aboveGap != null,
          belowAcceptedExists: belowGap != null,
          bothAcceptedNeighbors: aboveGap != null && belowGap != null,
        },
        horizontalAlignment: {
          occupiedLaneIds: candidate.occupiedLaneIds,
          sameColumnProxy: candidate.columnCoverage,
          horizontalConsistency: candidate.horizontalConsistency,
          columnCoverage: candidate.columnCoverage,
        },
        existingPCandidateDistance: nearestDistance(
          candidate.center,
          pAcceptedCenters,
        ),
        reconsiderationReason: "NOT_ROW_LIKE_UNMATCHED_PHASE",
      };
    });
}

export function summarizeLateCandidatePrecision(rows: LateCandidatePrecisionRow[]) {
  const counts = {
    considered: rows.length,
    accepted: rows.filter((row) => row.accepted).length,
    correctAccepted: rows.filter((row) => row.outcome === "CORRECT_ACCEPTED").length,
    falseAccepted: rows.filter((row) => row.outcome === "FALSE_ACCEPTED").length,
    correctRejected: rows.filter((row) => row.outcome === "CORRECT_REJECTED").length,
    falseRejected: rows.filter((row) => row.outcome === "FALSE_REJECTED").length,
    newGtRecovery: rows.filter((row) => row.postHocClass === "NEW_GT_RECOVERY").length,
    alreadyCoveredGtDuplicate: rows.filter(
      (row) => row.postHocClass === "ALREADY_COVERED_GT_DUPLICATE",
    ).length,
    other: rows.filter((row) => row.postHocClass === "OTHER").length,
  };

  return { counts, rows };
}
