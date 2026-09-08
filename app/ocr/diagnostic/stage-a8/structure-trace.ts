import type { CropBox } from "../../dynamic-rows";
import type { GeometryRow, RuntimeTsvRecord } from "../stage-a4/runtime-tsv";
import type { StageA5LineProposal, StageA5SelectiveRow } from "../stage-a5/selective-tsv";

export type RawLineDiagnostic = StageA5LineProposal & {
  diagnosticId: string;
};

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
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + 1,
  );
}

export function overlapRatio(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number },
) {
  const overlap = overlapHeight(a, b);
  const ah = Math.max(1, a.bottom - a.top + 1);
  const bh = Math.max(1, b.bottom - b.top + 1);
  return overlap / Math.min(ah, bh);
}

function rowHeight(row: { top: number; bottom: number }) {
  return Math.max(1, row.bottom - row.top + 1);
}

function nearestDistance(center: number, rows: Array<{ center: number }>) {
  if (!rows.length) return Infinity;
  return Math.min(...rows.map((row) => Math.abs(row.center - center)));
}

function positiveAdjacentGaps(centers: number[]) {
  const sorted = [...centers].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}

export function traceConsolidationAndPreservation(args: {
  rawLines: StageA5LineProposal[];
  consolidated: StageA5LineProposal[];
  wordGroups: GeometryRow[];
}) {
  const { rawLines, consolidated, wordGroups } = args;
  const raw: RawLineDiagnostic[] = [...rawLines]
    .sort((a, b) => a.center - b.center)
    .map((line, index) => ({
      ...line,
      diagnosticId: `raw-${index + 1}`,
    }));

  const medianLineHeight = Math.max(
    1,
    median(raw.map((line) => rowHeight(line))),
  );
  const consolidationCenterTolerance = Math.max(4, medianLineHeight * 0.55);

  const groups: Array<{
    groupId: string;
    members: RawLineDiagnostic[];
    decisions: any[];
  }> = [];

  for (const line of raw) {
    const last = groups[groups.length - 1];

    if (!last) {
      groups.push({
        groupId: "group-1",
        members: [line],
        decisions: [
          {
            rawDiagnosticId: line.diagnosticId,
            action: "new-group",
            reason: "first-raw-line",
            overlapWithPreviousRepresentative: null,
            centerDistanceFromPreviousRepresentative: null,
            adaptiveCenterTolerance: consolidationCenterTolerance,
          },
        ],
      });
      continue;
    }

    const representative = last.members[last.members.length - 1];
    const overlap = overlapRatio(representative, line);
    const centerDistance = Math.abs(representative.center - line.center);
    const sameVerticalRow =
      overlap >= 0.3 || centerDistance <= consolidationCenterTolerance;

    if (sameVerticalRow) {
      last.members.push(line);
      last.decisions.push({
        rawDiagnosticId: line.diagnosticId,
        action: "merge-into-current-group",
        overlapWithPreviousRepresentative: overlap,
        centerDistanceFromPreviousRepresentative: centerDistance,
        adaptiveCenterTolerance: consolidationCenterTolerance,
        predicate: {
          overlapAtLeastPoint3: overlap >= 0.3,
          centerDistanceWithinTolerance:
            centerDistance <= consolidationCenterTolerance,
        },
      });
    } else {
      const groupId = `group-${groups.length + 1}`;
      groups.push({
        groupId,
        members: [line],
        decisions: [
          {
            rawDiagnosticId: line.diagnosticId,
            action: "new-group",
            overlapWithPreviousRepresentative: overlap,
            centerDistanceFromPreviousRepresentative: centerDistance,
            adaptiveCenterTolerance: consolidationCenterTolerance,
            predicate: {
              overlapAtLeastPoint3: overlap >= 0.3,
              centerDistanceWithinTolerance:
                centerDistance <= consolidationCenterTolerance,
            },
          },
        ],
      });
    }
  }

  const groupSummaries = groups.map((group, index) => {
    const linkedConsolidated = consolidated[index] || null;
    const centers = group.members.map((member) => member.center);
    const heights = group.members.map((member) => rowHeight(member));
    const memberCenterGaps = positiveAdjacentGaps(centers);

    return {
      groupId: group.groupId,
      memberCount: group.members.length,
      memberDiagnosticIds: group.members.map((member) => member.diagnosticId),
      memberCenters: centers,
      memberHeights: heights,
      memberCenterGapDistribution: memberCenterGaps,
      decisions: group.decisions,
      consolidatedId: linkedConsolidated ? `consolidated-${index + 1}` : null,
      consolidatedCenter: linkedConsolidated?.center ?? null,
      consolidatedHeight: linkedConsolidated ? rowHeight(linkedConsolidated) : null,
    };
  });

  const medianRawCenterGap = Math.max(
    1,
    median(positiveAdjacentGaps(raw.map((line) => line.center))),
  );
  const distinctCenterSeparation = Math.max(
    medianLineHeight * 0.42,
    medianRawCenterGap * 0.45,
  );
  const supportCenterTolerance = Math.max(
    medianLineHeight * 0.8,
    medianRawCenterGap * 0.7,
  );
  const mergeLossMaxDistance = Math.max(
    medianLineHeight * 1.2,
    medianRawCenterGap,
  );

  const output: Array<{
    top: number;
    bottom: number;
    center: number;
    source: string;
  }> = [...consolidated];

  const preservation = raw.map((line) => {
    const wordGroupMatches = wordGroups
      .map((group, index) => {
        const overlap = overlapRatio(line, group);
        const centerDistance = Math.abs(line.center - group.center);
        const supported =
          overlap >= 0.2 || centerDistance <= supportCenterTolerance;
        return {
          wordGroupId: `word-group-${index + 1}`,
          overlapRatio: overlap,
          centerDistance,
          supported,
        };
      })
      .filter((item) => item.supported);

    const wordSupported = wordGroupMatches.length > 0;
    const nearestConsolidatedDistance = nearestDistance(line.center, consolidated);

    const representationMatches = output.map((row, index) => {
      const overlap = overlapRatio(line, row);
      const centerDistance = Math.abs(line.center - row.center);
      return {
        outputId: `output-${index + 1}`,
        overlapRatio: overlap,
        centerDistance,
        represented:
          overlap >= 0.45 || centerDistance < distinctCenterSeparation,
      };
    });

    const alreadyRepresented = representationMatches.some(
      (item) => item.represented,
    );

    const mergeLossEvidence =
      nearestConsolidatedDistance <= mergeLossMaxDistance;

    let preserveAccepted = false;
    let rejectionReason = "accepted";

    if (!wordSupported) {
      rejectionReason = "no-word-group-support";
    } else if (alreadyRepresented) {
      rejectionReason = "already-represented-by-output";
    } else if (!mergeLossEvidence) {
      rejectionReason = "no-merge-loss-evidence";
    } else {
      preserveAccepted = true;
      output.push(line);
    }

    const group = groupSummaries.find((summary) =>
      summary.memberDiagnosticIds.includes(line.diagnosticId),
    );

    return {
      rawDiagnosticId: line.diagnosticId,
      rawCenter: line.center,
      rawHeight: rowHeight(line),
      hierarchyKey: line.hierarchyKey,
      level5ChildCount: line.childWordCount,
      consolidationGroupId: group?.groupId ?? null,
      mergeTargetConsolidatedId: group?.consolidatedId ?? null,
      groupMemberCount: group?.memberCount ?? 0,
      groupMemberCenters: group?.memberCenters ?? [],
      groupMemberHeights: group?.memberHeights ?? [],
      groupMemberCenterGapDistribution:
        group?.memberCenterGapDistribution ?? [],
      wordGroupSupport: {
        present: wordSupported,
        supportingGroups: wordGroupMatches,
      },
      preservationPredicate: {
        wordSupported,
        alreadyRepresented,
        mergeLossEvidence,
        nearestConsolidatedDistance,
        distinctCenterSeparation,
        supportCenterTolerance,
        mergeLossMaxDistance,
      },
      preserveAccepted,
      preserveRejectedBy: preserveAccepted ? null : rejectionReason,
    };
  });

  return {
    rawLines: raw,
    consolidation: {
      inputCount: raw.length,
      groupCount: groups.length,
      outputCount: consolidated.length,
      medianLineHeight,
      adaptiveCenterTolerance: consolidationCenterTolerance,
      groups: groupSummaries,
    },
    preservation: {
      medianLineHeight,
      medianRawCenterGap,
      distinctCenterSeparation,
      supportCenterTolerance,
      mergeLossMaxDistance,
      rows: preservation,
      acceptedCount: preservation.filter((row) => row.preserveAccepted).length,
      rejectedCount: preservation.filter((row) => !row.preserveAccepted).length,
    },
  };
}

function wordInsidePaper(record: RuntimeTsvRecord, paper: CropBox) {
  if (record.level !== 5 || record.width <= 0 || record.height <= 0) {
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
}

export function traceWordFallbackEligibility(args: {
  records: RuntimeTsvRecord[];
  paper: CropBox;
  level4LineCount: number;
  pathological: boolean;
}) {
  const { records, paper, level4LineCount, pathological } = args;

  const words = records
    .filter((record) => wordInsidePaper(record, paper))
    .sort(
      (a, b) =>
        a.top + a.height / 2 - (b.top + b.height / 2),
    )
    .map((record, index) => ({
      diagnosticId: `word-${index + 1}`,
      centerY: record.top + record.height / 2,
      height: record.height,
      x1: record.left,
      x2: record.left + record.width,
      blockNum: record.blockNum,
      parNum: record.parNum,
      lineNum: record.lineNum,
      wordNum: record.wordNum,
    }));

  const medianWordHeight = Math.max(
    1,
    median(words.map((word) => word.height)),
  );
  const adaptiveCenterTolerance = Math.max(4, medianWordHeight * 0.85);

  const clusters: Array<{
    clusterId: string;
    words: typeof words;
    decisions: any[];
  }> = [];

  for (const word of words) {
    const last = clusters[clusters.length - 1];

    if (!last) {
      clusters.push({
        clusterId: "word-cluster-1",
        words: [word],
        decisions: [
          {
            wordDiagnosticId: word.diagnosticId,
            action: "new-cluster",
            previousClusterMedianCenter: null,
            centerDistance: null,
            adaptiveCenterTolerance,
          },
        ],
      });
      continue;
    }

    const lastCenter = median(last.words.map((item) => item.centerY));
    const centerDistance = Math.abs(word.centerY - lastCenter);

    if (centerDistance <= adaptiveCenterTolerance) {
      last.words.push(word);
      last.decisions.push({
        wordDiagnosticId: word.diagnosticId,
        action: "merge-into-current-cluster",
        previousClusterMedianCenter: lastCenter,
        centerDistance,
        adaptiveCenterTolerance,
        withinTolerance: true,
      });
    } else {
      clusters.push({
        clusterId: `word-cluster-${clusters.length + 1}`,
        words: [word],
        decisions: [
          {
            wordDiagnosticId: word.diagnosticId,
            action: "new-cluster",
            previousClusterMedianCenter: lastCenter,
            centerDistance,
            adaptiveCenterTolerance,
            withinTolerance: false,
          },
        ],
      });
    }
  }

  const preFilterClusterCount = clusters.length;
  const survivingClusters = clusters.filter((cluster) => cluster.words.length >= 2);
  const rowClusterCount = survivingClusters.length;

  const structuralHierarchyDeficitConditions = {
    enoughWords: words.length >= 6,
    rowClustersExceedLevel4PlusOne:
      rowClusterCount > Math.max(1, level4LineCount + 1),
  };

  const structuralHierarchyDeficit =
    structuralHierarchyDeficitConditions.enoughWords &&
    structuralHierarchyDeficitConditions.rowClustersExceedLevel4PlusOne;

  const fallbackEligible = pathological || structuralHierarchyDeficit;

  let eligibilityReason = "not-eligible";
  if (pathological) {
    eligibilityReason = "pathological-tsv";
  } else if (structuralHierarchyDeficit) {
    eligibilityReason = "structural-hierarchy-deficit";
  } else if (!structuralHierarchyDeficitConditions.enoughWords) {
    eligibilityReason = "too-few-level5-words-for-deficit-test";
  } else if (
    !structuralHierarchyDeficitConditions.rowClustersExceedLevel4PlusOne
  ) {
    eligibilityReason =
      "word-row-clusters-do-not-exceed-level4-hierarchy-by-required-margin";
  }

  const blockCounts: Record<string, number> = {};
  const lineCounts: Record<string, number> = {};

  for (const word of words) {
    blockCounts[String(word.blockNum)] =
      (blockCounts[String(word.blockNum)] || 0) + 1;
    const lineKey = `${word.blockNum}:${word.parNum}:${word.lineNum}`;
    lineCounts[lineKey] = (lineCounts[lineKey] || 0) + 1;
  }

  return {
    wordCount: words.length,
    level4LineCount,
    wordCenterYDistribution: words.map((word) => word.centerY),
    wordHeightDistribution: words.map((word) => word.height),
    wordXSpanDistribution: words.map((word) => ({
      diagnosticId: word.diagnosticId,
      x1: word.x1,
      x2: word.x2,
      width: word.x2 - word.x1,
    })),
    hierarchy: {
      blockCounts,
      lineKeyCounts: lineCounts,
    },
    clustering: {
      medianWordHeight,
      adaptiveCenterTolerance,
      preFilterClusterCount,
      rowClusterCount,
      rejectedSingletonClusterCount:
        preFilterClusterCount - rowClusterCount,
      clusters: clusters.map((cluster) => ({
        clusterId: cluster.clusterId,
        memberCount: cluster.words.length,
        memberWordIds: cluster.words.map((word) => word.diagnosticId),
        memberCenters: cluster.words.map((word) => word.centerY),
        memberHeights: cluster.words.map((word) => word.height),
        xSpan: cluster.words.length
          ? {
              x1: Math.min(...cluster.words.map((word) => word.x1)),
              x2: Math.max(...cluster.words.map((word) => word.x2)),
            }
          : null,
        blockNums: Array.from(new Set(cluster.words.map((word) => word.blockNum))),
        lineNums: Array.from(new Set(cluster.words.map((word) => word.lineNum))),
        survivesMinTwoWords: cluster.words.length >= 2,
        decisions: cluster.decisions,
      })),
    },
    fallbackEligibility: {
      pathological,
      structuralHierarchyDeficit,
      conditions: structuralHierarchyDeficitConditions,
      fallbackEligible,
      reason: eligibilityReason,
    },
  };
}

export function summarizeDocumentBandGeometry(
  candidates: Array<{ top: number; bottom: number; center: number }>,
) {
  const heights = candidates.map((candidate) => rowHeight(candidate));
  return {
    candidateCount: candidates.length,
    candidateHeightDistribution: heights,
    medianCandidateHeight: Math.max(1, median(heights)),
  };
}

export function candidateSupportSummary(args: {
  candidate: { top: number; bottom: number; center: number };
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
}) {
  const { candidate, rawLines, wordGroups } = args;

  const rawLineSupport = rawLines
    .map((row, index) => ({
      rawLineId: `raw-${index + 1}`,
      overlapRatio: overlapRatio(candidate, row),
      centerDistance: Math.abs(candidate.center - row.center),
    }))
    .filter((item) => item.overlapRatio > 0);

  const wordGroupSupport = wordGroups
    .map((row, index) => ({
      wordGroupId: `word-group-${index + 1}`,
      overlapRatio: overlapRatio(candidate, row),
      centerDistance: Math.abs(candidate.center - row.center),
    }))
    .filter((item) => item.overlapRatio > 0);

  return {
    rawLineSupport,
    wordGroupSupport,
  };
}
