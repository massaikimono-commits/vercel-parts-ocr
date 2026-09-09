import type { AltTopologyCandidate } from "../stage-a11/anchored-lattice";
import type { PhaseLatticeResult } from "../stage-a12/phase-lattice";
import type { LatePhaseSelection } from "../stage-a14/late-reconsideration";

export const A17_PHASE_RESIDUAL_MIN = 12;
export const A17_P_DISTANCE_MIN_PX = 60;

export type A17GateTrace = {
  candidateIndex: number;
  phaseResidualPx: number | null;
  existingPCandidateDistancePx: number | null;
  existingPCandidateDistanceOverPitch: number | null;
  phaseResidualOverPitch: number | null;
  acceptedByA14: boolean;
  acceptedByA17Gate: boolean;
};

export type A17RuntimeGateResult = {
  acceptedCandidateIndexes: number[];
  rejectedCandidateIndexes: number[];
  traces: A17GateTrace[];
  threshold: {
    phaseResidualMin: number;
    existingPCandidateDistanceMinPx: number;
  };
  pixelSpaceNote: string;
};

function nearestDistance(value: number, values: number[]) {
  if (!values.length) return null;
  return Math.min(...values.map((item) => Math.abs(value - item)));
}

export function applyA17LateCandidateRuntimeGate(args: {
  topologyRows: AltTopologyCandidate[];
  phaseResult: PhaseLatticeResult;
  lateSelection: LatePhaseSelection;
}): A17RuntimeGateResult {
  const { topologyRows, phaseResult, lateSelection } = args;
  const pitch = phaseResult.selectedPitch || 0;
  const pAcceptedCenters = phaseResult.acceptedCandidateIndexes
    .map((index) => topologyRows[index - 1]?.center)
    .filter((value): value is number => Number.isFinite(value));

  const traces = lateSelection.acceptedCandidateIndexes.map((candidateIndex) => {
    const candidate = topologyRows[candidateIndex - 1];
    const lateTrace = lateSelection.traces.find((trace) => trace.winnerCandidateIndex === candidateIndex);
    const phaseResidualPx = lateTrace?.winnerDistance ?? null;
    const existingPCandidateDistancePx = candidate
      ? nearestDistance(candidate.center, pAcceptedCenters)
      : null;
    const acceptedByA17Gate =
      phaseResidualPx != null &&
      existingPCandidateDistancePx != null &&
      phaseResidualPx >= A17_PHASE_RESIDUAL_MIN &&
      existingPCandidateDistancePx >= A17_P_DISTANCE_MIN_PX;

    return {
      candidateIndex,
      phaseResidualPx,
      existingPCandidateDistancePx,
      existingPCandidateDistanceOverPitch:
        existingPCandidateDistancePx != null && pitch > 0
          ? existingPCandidateDistancePx / pitch
          : null,
      phaseResidualOverPitch:
        phaseResidualPx != null && pitch > 0 ? phaseResidualPx / pitch : null,
      acceptedByA14: true,
      acceptedByA17Gate,
    };
  });

  return {
    acceptedCandidateIndexes: traces.filter((trace) => trace.acceptedByA17Gate).map((trace) => trace.candidateIndex),
    rejectedCandidateIndexes: traces.filter((trace) => !trace.acceptedByA17Gate).map((trace) => trace.candidateIndex),
    traces,
    threshold: {
      phaseResidualMin: A17_PHASE_RESIDUAL_MIN,
      existingPCandidateDistanceMinPx: A17_P_DISTANCE_MIN_PX,
    },
    pixelSpaceNote:
      "existingPCandidateDistance is measured in the Stage A geometry canvas pixel space (max dimension capped at 1800), so it is pixel-space dependent; normalized distance/pitch is recorded for post-hoc validation and is not used by the A17 gate.",
  };
}
