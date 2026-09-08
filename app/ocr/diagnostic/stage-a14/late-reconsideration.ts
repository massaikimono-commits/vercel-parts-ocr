import type { AltTopologyCandidate } from "../stage-a11/anchored-lattice";
import type { PhaseLatticeResult } from "../stage-a12/phase-lattice";

export type LatePhaseSelection = {
  acceptedCandidateIndexes: number[];
  consideredCandidateIndexes: number[];
  lateCandidateConsidered: number;
  lateCandidateAccepted: number;
  unmatchedPhasePositionCount: number;
  traces: Array<{
    k: number;
    phaseCenter: number;
    tolerance: number;
    consideredCandidateIndexes: number[];
    winnerCandidateIndex: number | null;
    winnerCenter: number | null;
    winnerDistance: number | null;
    winnerScore: number | null;
  }>;
};

function lateRank(
  candidate: AltTopologyCandidate,
  phaseCenter: number,
  pitch: number,
) {
  const tolerance = Math.max(1, pitch * 0.35);
  const phaseDistanceScore = Math.max(
    0,
    1 - Math.abs(candidate.center - phaseCenter) / tolerance,
  );

  const supportBoost =
    Number(candidate.autoRawLineSupport) * 0.08 +
    Number(candidate.autoWordGroupSupport) * 0.08 +
    Number(candidate.ruleSupport) * 0.05;

  return (
    phaseDistanceScore * 0.48 +
    candidate.heightSimilarity * 0.14 +
    candidate.horizontalConsistency * 0.1 +
    candidate.columnCoverage * 0.08 +
    candidate.compactness * 0.08 +
    candidate.rowLikeScore * 0.07 +
    supportBoost
  );
}

export function selectLatePhaseReconsideration(args: {
  topologyRows: AltTopologyCandidate[];
  phaseResult: PhaseLatticeResult;
}): LatePhaseSelection {
  const { topologyRows, phaseResult } = args;

  const selectedPitch = phaseResult.selectedPitch;
  const tolerance =
    selectedPitch > 0 ? selectedPitch * 0.35 : 0;

  const baseAccepted = new Set(
    phaseResult.acceptedCandidateIndexes,
  );
  const lateAccepted = new Set<number>();
  const considered = new Set<number>();

  const assignment =
    phaseResult.traces?.[0]?.assignment || [];

  const unmatched = assignment.filter(
    (position: any) => !position.matched,
  );

  const traces: LatePhaseSelection["traces"] = [];

  for (const position of unmatched) {
    const candidates = topologyRows.filter((candidate) => {
      if (candidate.rowLike) return false;
      if (baseAccepted.has(candidate.candidateIndex)) return false;
      if (lateAccepted.has(candidate.candidateIndex)) return false;

      return (
        selectedPitch > 0 &&
        Math.abs(candidate.center - position.phaseCenter) <= tolerance
      );
    });

    for (const candidate of candidates) {
      considered.add(candidate.candidateIndex);
    }

    if (!candidates.length) {
      traces.push({
        k: position.k,
        phaseCenter: position.phaseCenter,
        tolerance,
        consideredCandidateIndexes: [],
        winnerCandidateIndex: null,
        winnerCenter: null,
        winnerDistance: null,
        winnerScore: null,
      });
      continue;
    }

    const ranked = [...candidates].sort(
      (a, b) =>
        lateRank(b, position.phaseCenter, selectedPitch) -
        lateRank(a, position.phaseCenter, selectedPitch),
    );

    const winner = ranked[0];
    lateAccepted.add(winner.candidateIndex);

    traces.push({
      k: position.k,
      phaseCenter: position.phaseCenter,
      tolerance,
      consideredCandidateIndexes: candidates.map(
        (candidate) => candidate.candidateIndex,
      ),
      winnerCandidateIndex: winner.candidateIndex,
      winnerCenter: winner.center,
      winnerDistance: Math.abs(
        winner.center - position.phaseCenter,
      ),
      winnerScore: lateRank(
        winner,
        position.phaseCenter,
        selectedPitch,
      ),
    });
  }

  return {
    acceptedCandidateIndexes: Array.from(lateAccepted),
    consideredCandidateIndexes: Array.from(considered),
    lateCandidateConsidered: considered.size,
    lateCandidateAccepted: lateAccepted.size,
    unmatchedPhasePositionCount: unmatched.length,
    traces,
  };
}
