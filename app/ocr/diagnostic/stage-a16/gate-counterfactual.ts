import type { LateCandidatePrecisionRow } from "../stage-a15/precision-decomposition";

export type CounterfactualGateKind = "G1_PHASE_RESIDUAL" | "G2_P_DISTANCE" | "G3_PHASE_AND_P_DISTANCE";

export type CounterfactualCandidate = LateCandidatePrecisionRow & {
  fileName: string;
};

export type CounterfactualImageContext = {
  fileName: string;
  gtRowCount: number;
  pCoveredGtRows: number[];
  dCoveredGtRows?: number[];
};

export type CounterfactualThreshold = {
  phaseResidualMin?: number;
  existingPCandidateDistanceMin?: number;
};

export type CounterfactualCandidateTrace = {
  fileName: string;
  candidateIndex: number;
  matchedGtRowIndex: number | null;
  candidateCorrect: boolean;
  candidateNewGtPotential: boolean;
  gateAccepted: boolean;
  sameGtCompetingCandidate: boolean;
  phaseResidual: number | null;
  existingPCandidateDistance: number | null;
};

export type CounterfactualGateResult = {
  gate: CounterfactualGateKind;
  threshold: CounterfactualThreshold;
  acceptedCandidateCount: number;
  correctAccepted: number;
  falseAccepted: number;
  candidateNewGtPotentialAccepted: number;
  netUniqueGtRecovery: number;
  alreadyCoveredDuplicate: number;
  sameGtCompetingCandidate: number;
  coverageCounterfactual: number;
  falseCounterfactual: number;
  duplicateCounterfactual: number;
  correctRowRegressionVsD: number;
  protection: {
    IMG_0678_row5_retained: boolean;
    IMG_0685_row1_retained: boolean;
    IMG_0677_coverage: number;
    IMG_0677_5_of_5_retained: boolean;
    IMG_0684_coverage: number;
    IMG_0684_8_of_8_retained: boolean;
  };
  byImage: Array<{
    fileName: string;
    pCoverage: number;
    counterfactualCoverage: number;
    acceptedCandidateCount: number;
    correctAccepted: number;
    falseAccepted: number;
    netUniqueGtRecovery: number;
    duplicateCounterfactual: number;
  }>;
  candidates: CounterfactualCandidateTrace[];
};

export const PHASE_RESIDUAL_SWEEP = [10, 12, 14, 15, 16, 18, 20] as const;
export const P_DISTANCE_SWEEP = [40, 60, 80, 100, 120] as const;

function passesGate(candidate: CounterfactualCandidate, gate: CounterfactualGateKind, threshold: CounterfactualThreshold) {
  const phase = candidate.phaseResidual;
  const distance = candidate.existingPCandidateDistance;
  const phasePass = threshold.phaseResidualMin == null || (phase != null && phase >= threshold.phaseResidualMin);
  const distancePass = threshold.existingPCandidateDistanceMin == null || (distance != null && distance >= threshold.existingPCandidateDistanceMin);

  if (gate === "G1_PHASE_RESIDUAL") return phasePass;
  if (gate === "G2_P_DISTANCE") return distancePass;
  return phasePass && distancePass;
}

function unique(values: number[]) {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function evaluateLateCandidateGateCounterfactual(args: {
  gate: CounterfactualGateKind;
  threshold: CounterfactualThreshold;
  candidates: CounterfactualCandidate[];
  images: CounterfactualImageContext[];
}): CounterfactualGateResult {
  const { gate, threshold, candidates, images } = args;
  const imageMap = new Map(images.map((image) => [image.fileName, image]));
  const accepted = candidates.filter((candidate) => passesGate(candidate, gate, threshold));

  const acceptedGtCounts = new Map<string, number>();
  for (const candidate of accepted) {
    if (candidate.matchedGtRowIndex == null) continue;
    const key = `${candidate.fileName}#${candidate.matchedGtRowIndex}`;
    acceptedGtCounts.set(key, (acceptedGtCounts.get(key) || 0) + 1);
  }

  const candidateTraces: CounterfactualCandidateTrace[] = candidates.map((candidate) => {
    const context = imageMap.get(candidate.fileName);
    const pCovered = new Set(context?.pCoveredGtRows || []);
    const gateAccepted = passesGate(candidate, gate, threshold);
    const candidateCorrect = candidate.matchedGtRowIndex != null;
    const candidateNewGtPotential = candidateCorrect && !pCovered.has(candidate.matchedGtRowIndex!);
    const key = candidateCorrect ? `${candidate.fileName}#${candidate.matchedGtRowIndex}` : "";
    return {
      fileName: candidate.fileName,
      candidateIndex: candidate.candidateIndex,
      matchedGtRowIndex: candidate.matchedGtRowIndex,
      candidateCorrect,
      candidateNewGtPotential,
      gateAccepted,
      sameGtCompetingCandidate: gateAccepted && candidateCorrect && (acceptedGtCounts.get(key) || 0) > 1,
      phaseResidual: candidate.phaseResidual,
      existingPCandidateDistance: candidate.existingPCandidateDistance,
    };
  });

  const byImage = images.map((image) => {
    const pCovered = new Set(image.pCoveredGtRows);
    const acceptedForImage = accepted.filter((candidate) => candidate.fileName === image.fileName);
    const newGtRows = unique(
      acceptedForImage
        .map((candidate) => candidate.matchedGtRowIndex)
        .filter((row): row is number => row != null && !pCovered.has(row)),
    );
    const correctAccepted = acceptedForImage.filter((candidate) => candidate.matchedGtRowIndex != null).length;
    const falseAccepted = acceptedForImage.length - correctAccepted;
    const alreadyCovered = acceptedForImage.filter((candidate) => candidate.matchedGtRowIndex != null && pCovered.has(candidate.matchedGtRowIndex)).length;
    const sameGtExtra = Array.from(
      acceptedForImage.reduce((map, candidate) => {
        if (candidate.matchedGtRowIndex == null || pCovered.has(candidate.matchedGtRowIndex)) return map;
        map.set(candidate.matchedGtRowIndex, (map.get(candidate.matchedGtRowIndex) || 0) + 1);
        return map;
      }, new Map<number, number>()).values(),
    ).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    return {
      fileName: image.fileName,
      pCoverage: pCovered.size,
      counterfactualCoverage: pCovered.size + newGtRows.length,
      acceptedCandidateCount: acceptedForImage.length,
      correctAccepted,
      falseAccepted,
      netUniqueGtRecovery: newGtRows.length,
      duplicateCounterfactual: alreadyCovered + sameGtExtra,
    };
  });

  const correctAccepted = accepted.filter((candidate) => candidate.matchedGtRowIndex != null).length;
  const falseAccepted = accepted.length - correctAccepted;
  const candidateNewGtPotentialAccepted = accepted.filter((candidate) => {
    if (candidate.matchedGtRowIndex == null) return false;
    const context = imageMap.get(candidate.fileName);
    return !new Set(context?.pCoveredGtRows || []).has(candidate.matchedGtRowIndex);
  }).length;
  const netUniqueGtRecovery = byImage.reduce((sum, image) => sum + image.netUniqueGtRecovery, 0);
  const alreadyCoveredDuplicate = accepted.filter((candidate) => {
    if (candidate.matchedGtRowIndex == null) return false;
    const context = imageMap.get(candidate.fileName);
    return new Set(context?.pCoveredGtRows || []).has(candidate.matchedGtRowIndex);
  }).length;
  const sameGtCompetingCandidate = candidateTraces.filter((candidate) => candidate.sameGtCompetingCandidate).length;
  const duplicateCounterfactual = byImage.reduce((sum, image) => sum + image.duplicateCounterfactual, 0);
  const coverageCounterfactual = byImage.reduce((sum, image) => sum + image.counterfactualCoverage, 0);

  const coverageFor = (fileName: string) => byImage.find((image) => image.fileName === fileName)?.counterfactualCoverage || 0;
  const hasRow = (fileName: string, rowIndex: number) => {
    const context = imageMap.get(fileName);
    if (context?.pCoveredGtRows.includes(rowIndex)) return true;
    return accepted.some((candidate) => candidate.fileName === fileName && candidate.matchedGtRowIndex === rowIndex);
  };

  return {
    gate,
    threshold,
    acceptedCandidateCount: accepted.length,
    correctAccepted,
    falseAccepted,
    candidateNewGtPotentialAccepted,
    netUniqueGtRecovery,
    alreadyCoveredDuplicate,
    sameGtCompetingCandidate,
    coverageCounterfactual,
    falseCounterfactual: falseAccepted,
    duplicateCounterfactual,
    correctRowRegressionVsD: 0,
    protection: {
      IMG_0678_row5_retained: hasRow("IMG_0678(1)", 5),
      IMG_0685_row1_retained: hasRow("IMG_0685(1)", 1),
      IMG_0677_coverage: coverageFor("IMG_0677(1)"),
      IMG_0677_5_of_5_retained: coverageFor("IMG_0677(1)") === 5,
      IMG_0684_coverage: coverageFor("IMG_0684(1)"),
      IMG_0684_8_of_8_retained: coverageFor("IMG_0684(1)") === 8,
    },
    byImage,
    candidates: candidateTraces,
  };
}

export function buildStageA16CounterfactualSweep(args: {
  candidates: CounterfactualCandidate[];
  images: CounterfactualImageContext[];
}) {
  const { candidates, images } = args;
  const g1 = PHASE_RESIDUAL_SWEEP.map((phaseResidualMin) =>
    evaluateLateCandidateGateCounterfactual({
      gate: "G1_PHASE_RESIDUAL",
      threshold: { phaseResidualMin },
      candidates,
      images,
    }),
  );
  const g2 = P_DISTANCE_SWEEP.map((existingPCandidateDistanceMin) =>
    evaluateLateCandidateGateCounterfactual({
      gate: "G2_P_DISTANCE",
      threshold: { existingPCandidateDistanceMin },
      candidates,
      images,
    }),
  );
  const g3 = PHASE_RESIDUAL_SWEEP.flatMap((phaseResidualMin) =>
    P_DISTANCE_SWEEP.map((existingPCandidateDistanceMin) =>
      evaluateLateCandidateGateCounterfactual({
        gate: "G3_PHASE_AND_P_DISTANCE",
        threshold: { phaseResidualMin, existingPCandidateDistanceMin },
        candidates,
        images,
      }),
    ),
  );

  return { g1, g2, g3 };
}

export function leaveOneImageOutStability(args: {
  candidates: CounterfactualCandidate[];
  images: CounterfactualImageContext[];
  gate: CounterfactualGateKind;
  threshold: CounterfactualThreshold;
}) {
  const { candidates, images, gate, threshold } = args;
  return images.map((leftOut) => {
    const trainingImages = images.filter((image) => image.fileName !== leftOut.fileName);
    const trainingCandidates = candidates.filter((candidate) => candidate.fileName !== leftOut.fileName);
    const heldOutCandidates = candidates.filter((candidate) => candidate.fileName === leftOut.fileName);
    const training = evaluateLateCandidateGateCounterfactual({ gate, threshold, candidates: trainingCandidates, images: trainingImages });
    const heldOut = evaluateLateCandidateGateCounterfactual({ gate, threshold, candidates: heldOutCandidates, images: [leftOut] });
    return {
      leftOutFileName: leftOut.fileName,
      training: {
        acceptedCandidateCount: training.acceptedCandidateCount,
        correctAccepted: training.correctAccepted,
        falseAccepted: training.falseAccepted,
        netUniqueGtRecovery: training.netUniqueGtRecovery,
      },
      heldOut: {
        acceptedCandidateCount: heldOut.acceptedCandidateCount,
        correctAccepted: heldOut.correctAccepted,
        falseAccepted: heldOut.falseAccepted,
        netUniqueGtRecovery: heldOut.netUniqueGtRecovery,
      },
    };
  });
}
