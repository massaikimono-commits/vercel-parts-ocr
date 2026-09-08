import type { CropBox } from "../../dynamic-rows";
import type {
  GeometryRow,
  RuntimeTsvRecord,
} from "../stage-a4/runtime-tsv";
import type {
  StageA5LineProposal,
  StageA5SelectiveRow,
} from "../stage-a5/selective-tsv";

export type SplitHypothesis = StageA5LineProposal & {
  source: "targeted-split";
  parentCandidateIndex: number;
  evidenceModeCount: number;
  evidenceMemberCount: number;
};

export type AltRowProposal = StageA5LineProposal & {
  source: "alt-sparse-word-cluster";
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

function rowHeight(row: { top: number; bottom: number }) {
  return Math.max(1, row.bottom - row.top + 1);
}

function centerInsidePaper(
  left: number,
  top: number,
  width: number,
  height: number,
  paper: CropBox,
) {
  const cx = left + width / 2;
  const cy = top + height / 2;
  return (
    cx >= paper.x &&
    cx <= paper.x + paper.w &&
    cy >= paper.y &&
    cy <= paper.y + paper.h
  );
}

function clusterEvidence(
  evidence: Array<{
    source: "raw-line" | "word-group";
    top: number;
    bottom: number;
    center: number;
  }>,
  tolerance: number,
) {
  const clusters: Array<typeof evidence> = [];

  for (const item of [...evidence].sort((a, b) => a.center - b.center)) {
    const last = clusters[clusters.length - 1];
    if (!last) {
      clusters.push([item]);
      continue;
    }

    const lastCenter = median(last.map((x) => x.center));
    if (Math.abs(item.center - lastCenter) <= tolerance) {
      last.push(item);
    } else {
      clusters.push([item]);
    }
  }

  return clusters;
}

export function buildTargetedSplitHypotheses(args: {
  dRows: StageA5SelectiveRow[];
  rawLines: StageA5LineProposal[];
  wordGroups: GeometryRow[];
}) {
  const { dRows, rawLines, wordGroups } = args;

  const documentMedianCandidateHeight = Math.max(
    1,
    median(dRows.map(rowHeight)),
  );

  const hypotheses: SplitHypothesis[] = [];
  const candidateTraces: any[] = [];

  for (let candidateIndex = 0; candidateIndex < dRows.length; candidateIndex += 1) {
    const candidate = dRows[candidateIndex];

    const rawEvidence = rawLines
      .filter(
        (row) =>
          overlapRatio(candidate, row) >= 0.15 ||
          (row.center >= candidate.top && row.center <= candidate.bottom),
      )
      .map((row) => ({
        source: "raw-line" as const,
        top: row.top,
        bottom: row.bottom,
        center: row.center,
      }));

    const wordEvidence = wordGroups
      .filter(
        (row) =>
          overlapRatio(candidate, row) >= 0.15 ||
          (row.center >= candidate.top && row.center <= candidate.bottom),
      )
      .map((row) => ({
        source: "word-group" as const,
        top: row.top,
        bottom: row.bottom,
        center: row.center,
      }));

    const evidence = [...rawEvidence, ...wordEvidence];

    const evidenceHeights = evidence.map(rowHeight);
    const medianEvidenceHeight = Math.max(
      1,
      median(evidenceHeights),
    );

    const modeTolerance = Math.max(
      4,
      Math.min(
        documentMedianCandidateHeight * 0.55,
        medianEvidenceHeight * 0.75,
      ),
    );

    const clusters = clusterEvidence(evidence, modeTolerance);

    const qualifiedModes = clusters
      .map((members, index) => {
        const rawLineCount = members.filter(
          (member) => member.source === "raw-line",
        ).length;
        const wordGroupCount = members.filter(
          (member) => member.source === "word-group",
        ).length;

        const independentSupport =
          (rawLineCount >= 1 && wordGroupCount >= 1) ||
          rawLineCount >= 2 ||
          wordGroupCount >= 2;

        const top = Math.round(
          median(members.map((member) => member.top)),
        );
        const bottom = Math.round(
          median(members.map((member) => member.bottom)),
        );
        const center = Math.round(
          median(members.map((member) => member.center)),
        );

        return {
          modeId: `candidate-${candidateIndex + 1}-mode-${index + 1}`,
          members,
          rawLineCount,
          wordGroupCount,
          independentSupport,
          top,
          bottom,
          center,
          height: Math.max(1, bottom - top + 1),
        };
      })
      .filter((mode) => mode.independentSupport);

    const splitNeeded = qualifiedModes.length >= 2;

    const existingCenterMargin = Math.max(
      4,
      documentMedianCandidateHeight * 0.45,
    );

    const addedModeIds: string[] = [];

    if (splitNeeded) {
      for (const mode of qualifiedModes) {
        const representedByExisting = dRows.some(
          (existing, existingIndex) =>
            existingIndex !== candidateIndex &&
            (overlapRatio(mode, existing) >= 0.25 ||
              Math.abs(mode.center - existing.center) <=
                existingCenterMargin),
        );

        const representedByParentCenter =
          Math.abs(mode.center - candidate.center) <=
          existingCenterMargin;

        if (representedByExisting || representedByParentCenter) {
          continue;
        }

        hypotheses.push({
          top: mode.top,
          bottom: mode.bottom,
          center: mode.center,
          source: "targeted-split",
          height: mode.height,
          childWordCount: mode.wordGroupCount,
          hierarchyKey: mode.modeId,
          parentCandidateIndex: candidateIndex + 1,
          evidenceModeCount: qualifiedModes.length,
          evidenceMemberCount: mode.members.length,
        });

        addedModeIds.push(mode.modeId);
      }
    }

    candidateTraces.push({
      candidateIndex: candidateIndex + 1,
      candidateSource: candidate.source,
      candidateTop: candidate.top,
      candidateBottom: candidate.bottom,
      candidateCenter: candidate.center,
      candidateHeight: rowHeight(candidate),
      documentMedianCandidateHeight,
      rawEvidenceCount: rawEvidence.length,
      wordEvidenceCount: wordEvidence.length,
      evidenceCount: evidence.length,
      medianEvidenceHeight,
      modeTolerance,
      modeCountBeforeQualification: clusters.length,
      qualifiedModeCount: qualifiedModes.length,
      splitNeeded,
      existingCenterMargin,
      qualifiedModes: qualifiedModes.map((mode) => ({
        modeId: mode.modeId,
        center: mode.center,
        height: mode.height,
        memberCount: mode.members.length,
        rawLineCount: mode.rawLineCount,
        wordGroupCount: mode.wordGroupCount,
      })),
      addedModeIds,
    });
  }

  return {
    rows: hypotheses,
    trace: {
      parentCandidateCount: dRows.length,
      splitParentCount: candidateTraces.filter((x) => x.splitNeeded).length,
      splitCandidateCount: hypotheses.length,
      documentMedianCandidateHeight,
      candidates: candidateTraces,
    },
  };
}

export function buildSparseTextWordRows(args: {
  records: RuntimeTsvRecord[];
  paper: CropBox;
}) {
  const { records, paper } = args;

  const words = records
    .filter((record) => {
      return (
        record.level === 5 &&
        record.width > 0 &&
        record.height > 0 &&
        centerInsidePaper(
          record.left,
          record.top,
          record.width,
          record.height,
          paper,
        )
      );
    })
    .map((record) => ({
      top: record.top,
      bottom: record.top + record.height - 1,
      center: record.top + record.height / 2,
      left: record.left,
      right: record.left + record.width,
      height: record.height,
    }))
    .sort((a, b) => a.center - b.center);

  const medianWordHeight = Math.max(
    1,
    median(words.map((word) => word.height)),
  );

  const adaptiveCenterTolerance = Math.max(
    4,
    medianWordHeight * 0.85,
  );

  const clusters: Array<typeof words> = [];

  for (const word of words) {
    const last = clusters[clusters.length - 1];

    if (!last) {
      clusters.push([word]);
      continue;
    }

    const center = median(last.map((item) => item.center));

    if (Math.abs(word.center - center) <= adaptiveCenterTolerance) {
      last.push(word);
    } else {
      clusters.push([word]);
    }
  }

  const surviving = clusters.filter((cluster) => cluster.length >= 2);

  const rows: AltRowProposal[] = surviving.map((cluster, index) => {
    const top = Math.max(
      paper.y,
      Math.min(...cluster.map((word) => word.top)),
    );
    const bottom = Math.min(
      paper.y + paper.h - 1,
      Math.max(...cluster.map((word) => word.bottom)),
    );
    const center = Math.round(
      median(cluster.map((word) => word.center)),
    );

    return {
      top,
      bottom,
      center,
      source: "alt-sparse-word-cluster",
      height: Math.max(1, bottom - top + 1),
      childWordCount: cluster.length,
      hierarchyKey: `sparse-cluster-${index + 1}`,
    };
  });

  return {
    rows,
    trace: {
      wordCount: words.length,
      medianWordHeight,
      adaptiveCenterTolerance,
      verticalClusterCountBeforeSingletonReject: clusters.length,
      verticalClusterCount: surviving.length,
      singletonRejectCount: clusters.length - surviving.length,
      candidateCount: rows.length,
    },
  };
}

export function detectAutoStructuralAbnormality(args: {
  pathological: boolean;
  autoWordCount: number;
  autoRowClusterCount: number;
  autoLevel4LineCount: number;
}) {
  const {
    pathological,
    autoWordCount,
    autoRowClusterCount,
    autoLevel4LineCount,
  } = args;

  const enoughWords = autoWordCount >= 6;
  const rowClustersMarkedlyFewerThanLevel4 =
    autoLevel4LineCount >= 3 &&
    autoRowClusterCount * 2 < autoLevel4LineCount;

  const structuralHierarchyDeficit =
    enoughWords && rowClustersMarkedlyFewerThanLevel4;

  return {
    eligible: pathological || structuralHierarchyDeficit,
    reason: pathological
      ? "pathological-auto-tsv"
      : structuralHierarchyDeficit
        ? "auto-row-clusters-markedly-fewer-than-level4"
        : "auto-structure-not-abnormal",
    conditions: {
      pathological,
      enoughWords,
      autoWordCount,
      autoRowClusterCount,
      autoLevel4LineCount,
      rowClustersMarkedlyFewerThanLevel4,
      structuralHierarchyDeficit,
    },
  };
}

export function filterNovelRowsAgainstExisting(args: {
  existing: Array<{ top: number; bottom: number; center: number }>;
  proposed: AltRowProposal[];
}) {
  const { existing, proposed } = args;

  const referenceHeights = [
    ...existing.map(rowHeight),
    ...proposed.map(rowHeight),
  ].filter((value) => value > 0);

  const medianReferenceHeight = Math.max(
    1,
    median(referenceHeights),
  );

  const adaptiveMargin = Math.max(
    4,
    medianReferenceHeight * 0.55,
  );

  const rows = proposed.filter((proposal) => {
    return !existing.some(
      (row) =>
        overlapRatio(proposal, row) >= 0.25 ||
        Math.abs(proposal.center - row.center) <= adaptiveMargin,
    );
  });

  return {
    rows,
    trace: {
      inputCount: proposed.length,
      existingCount: existing.length,
      outputCount: rows.length,
      altOnlyCandidateCount: rows.length,
      rejectedNearExisting: proposed.length - rows.length,
      medianReferenceHeight,
      adaptiveMargin,
    },
  };
}
