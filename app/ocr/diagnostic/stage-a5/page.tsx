/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { prepareOCRInputFile } from "../../transfer";
import {
  detectHorizontalRuleBands,
  rowBandsFromRules,
  type CropBox,
} from "../../dynamic-rows";
import {
  parseHeaderlessRuntimeTsv,
  tsvLineRows,
  tsvWordGroupRows,
  type GeometryRow,
} from "../stage-a4/runtime-tsv";
import {
  GT_MAP,
  EXPECTED_FILES,
  type GtImage,
} from "../stage-a4/gt";
import {
  buildLevel4LineProposals,
  combineRulesAndRescue,
  consolidateLineCandidates,
  filterByWordChildSupport,
  filterByWordGroupConsensus,
  filterToRulesUncoveredVerticalGaps,
  type StageA5SelectiveRow,
} from "./selective-tsv";

type CandidateRow = {
  top: number;
  bottom: number;
  center: number;
  source: string;
};

const SOURCE_HEAD =
  "6a31ec4b9028410e90a8dbd9c8b40d53de7742d2";
const A4_LINE_RESCUE_TOTAL = 19;

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 900,
    margin: "0 auto",
    padding: "16px 12px 60px",
    color: "#172033",
    background: "#f5f7fb",
    minHeight: "100vh",
  },
  card: {
    background: "#fff",
    border: "1px solid #dbe2ec",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  title: { margin: 0, fontSize: 24, fontWeight: 900 },
  text: {
    color: "#5b6678",
    lineHeight: 1.65,
    fontSize: 14,
  },
  primary: {
    width: "100%",
    border: 0,
    borderRadius: 13,
    padding: "14px 12px",
    background: "#2468df",
    color: "#fff",
    fontWeight: 800,
    fontSize: 17,
  },
  pre: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    background: "#f7f9fc",
    border: "1px solid #e2e7ef",
    borderRadius: 10,
    padding: 10,
    fontSize: 11,
    lineHeight: 1.45,
    maxHeight: 620,
    overflow: "auto",
  },
};

function canonicalFromName(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  return m ? `IMG_${m[1]}(1)` : "";
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を開けませんでした。"));
    };
    img.src = url;
  });
}

async function orientedColorCanvas(file: File) {
  const img = await loadImage(file);
  const rotate = img.naturalHeight > img.naturalWidth * 1.08;
  const sourceWidth = rotate ? img.naturalHeight : img.naturalWidth;
  const sourceHeight = rotate ? img.naturalWidth : img.naturalHeight;
  const scale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!ctx) throw new Error("画像を処理できませんでした。");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (rotate) {
    ctx.save();
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0, canvas.height, canvas.width);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  return {
    canvas,
    rotate,
    rawWidth: img.naturalWidth,
    rawHeight: img.naturalHeight,
  };
}

async function fileCanvas(file: File) {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function detectPaperBox(canvas: HTMLCanvasElement): CropBox {
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!ctx) {
    return {
      x: 0,
      y: 0,
      w: canvas.width,
      h: canvas.height,
    };
  }

  const { width: w, height: h } = canvas;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(
    2,
    Math.floor(Math.max(w, h) / 800),
  );

  const isPaper = (r: number, g: number, b: number) => {
    const bright = (r + g + b) / 3;
    const yellow =
      r > 100 &&
      g > 95 &&
      r + g > b * 1.75;
    return bright > 150 || yellow;
  };

  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0;
    let count = 0;
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (
        isPaper(
          pixels[p],
          pixels[p + 1],
          pixels[p + 2],
        )
      ) {
        hit += 1;
      }
      count += 1;
    }
    if (count && hit / count > 0.18) ys.push(y);
  }

  if (ys.length < 4) {
    return { x: 0, y: 0, w, h };
  }

  const top = Math.max(0, ys[0] - step * 2);
  const roughBottom = Math.min(
    h - 1,
    ys[ys.length - 1] + step * 2,
  );

  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let count = 0;

    for (
      let y = top;
      y <= roughBottom;
      y += step
    ) {
      const p = (y * w + x) * 4;
      if (
        isPaper(
          pixels[p],
          pixels[p + 1],
          pixels[p + 2],
        )
      ) {
        hit += 1;
      }
      count += 1;
    }

    if (count && hit / count > 0.2) xs.push(x);
  }

  const left = xs.length
    ? Math.max(0, xs[0] - step * 2)
    : 0;
  const right = xs.length
    ? Math.min(
        w - 1,
        xs[xs.length - 1] + step * 2,
      )
    : w - 1;

  const width = right - left + 1;
  let boxHeight = roughBottom - top + 1;
  const expectedHeight = Math.round(width / 1.74);

  if (
    width / boxHeight < 1.55 &&
    expectedHeight < boxHeight
  ) {
    boxHeight = Math.min(
      expectedHeight,
      h - top,
    );
  }

  if (
    width < w * 0.55 ||
    boxHeight < h * 0.25
  ) {
    return { x: 0, y: 0, w, h };
  }

  return {
    x: left,
    y: top,
    w: width,
    h: boxHeight,
  };
}

async function canvasBlob(
  canvas: HTMLCanvasElement,
  quality = 0.96,
) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("画像変換失敗")),
      "image/jpeg",
      quality,
    ),
  );
}

function rawToGtPoint(
  rawX: number,
  rawY: number,
  rawWidth: number,
  rawHeight: number,
  rotationDeg: number,
) {
  const r =
    ((rotationDeg % 360) + 360) % 360;

  if (r === 0) {
    return {
      x: rawX,
      y: rawY,
      width: rawWidth,
      height: rawHeight,
    };
  }
  if (r === 90) {
    return {
      x: rawHeight - rawY,
      y: rawX,
      width: rawHeight,
      height: rawWidth,
    };
  }
  if (r === 180) {
    return {
      x: rawWidth - rawX,
      y: rawHeight - rawY,
      width: rawWidth,
      height: rawHeight,
    };
  }
  if (r === 270) {
    return {
      x: rawY,
      y: rawWidth - rawX,
      width: rawHeight,
      height: rawWidth,
    };
  }

  throw new Error(
    "rotationDeg must be 0/90/180/270",
  );
}

function candidateToRawPoint(
  x: number,
  y: number,
  meta: {
    rawWidth: number;
    rawHeight: number;
    geometryWidth: number;
    geometryHeight: number;
    autoRotate90CCW: boolean;
  },
) {
  const sourceWidth = meta.autoRotate90CCW
    ? meta.rawHeight
    : meta.rawWidth;
  const sourceHeight = meta.autoRotate90CCW
    ? meta.rawWidth
    : meta.rawHeight;

  const sx = meta.geometryWidth / sourceWidth;
  const sy = meta.geometryHeight / sourceHeight;

  return meta.autoRotate90CCW
    ? {
        x: (meta.geometryHeight - y) / sy,
        y: x / sx,
      }
    : {
        x: x / sx,
        y: y / sy,
      };
}

function scoreRows(
  rows: CandidateRow[],
  paper: CropBox,
  meta: {
    rawWidth: number;
    rawHeight: number;
    geometryWidth: number;
    geometryHeight: number;
    autoRotate90CCW: boolean;
  },
  gt: GtImage,
) {
  const assigned = new Map(
    gt.rows.map((row) => [row.rowIndex, 0]),
  );

  let falseCount = 0;

  const mapped = rows.map((row, index) => {
    const raw = candidateToRawPoint(
      paper.x + paper.w / 2,
      row.center,
      meta,
    );
    const center = rawToGtPoint(
      raw.x,
      raw.y,
      meta.rawWidth,
      meta.rawHeight,
      gt.rotationDeg,
    );
    const centerYNorm =
      center.y / center.height;

    const containing = gt.rows.filter(
      (g) =>
        centerYNorm >= g.y1Norm &&
        centerYNorm <= g.y2Norm,
    );

    let match:
      | null
      | (typeof gt.rows)[number] = null;

    if (containing.length) {
      match = [...containing].sort(
        (a, b) =>
          Math.abs(
            centerYNorm -
              (a.y1Norm + a.y2Norm) / 2,
          ) -
          Math.abs(
            centerYNorm -
              (b.y1Norm + b.y2Norm) / 2,
          ),
      )[0];

      assigned.set(
        match.rowIndex,
        (assigned.get(match.rowIndex) || 0) + 1,
      );
    } else {
      falseCount += 1;
    }

    return {
      candidateIndex: index + 1,
      source: row.source,
      centerYNorm:
        +centerYNorm.toFixed(6),
      matchedGtRowIndex:
        match?.rowIndex ?? null,
    };
  });

  const coveredGtRows = gt.rows
    .filter(
      (row) =>
        (assigned.get(row.rowIndex) || 0) > 0,
    )
    .map((row) => row.rowIndex);

  const duplicateCount = gt.rows.reduce(
    (sum, row) =>
      sum +
      Math.max(
        0,
        (assigned.get(row.rowIndex) || 0) - 1,
      ),
    0,
  );

  return {
    candidateCount: rows.length,
    gtCoverage: coveredGtRows.length,
    recall: gt.rowCount
      ? coveredGtRows.length / gt.rowCount
      : 0,
    falseCount,
    duplicateCount,
    coveredGtRows,
    mapped,
  };
}

function rulesRows(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  paper: CropBox,
): StageA5SelectiveRow[] {
  const rules = detectHorizontalRuleBands(
    rgba,
    width,
    height,
    paper,
  );

  return rowBandsFromRules(rules, paper).map(
    (row) => ({
      top: row.top,
      bottom: row.bottom,
      center: row.center,
      source: "rules" as const,
    }),
  );
}

function asCandidateRows(
  rows: Array<{
    top: number;
    bottom: number;
    center: number;
    source: string;
  }>,
): CandidateRow[] {
  return rows.map((row) => ({ ...row }));
}

function setDiff(
  a: number[],
  b: number[],
) {
  const bSet = new Set(b);
  return a.filter((value) => !bSet.has(value));
}

function intersection(
  a: number[],
  b: number[],
) {
  const bSet = new Set(b);
  return a.filter((value) => bSet.has(value));
}

function summarizeVariant(
  images: any[],
  name: string,
) {
  const summary = {
    candidateCount: 0,
    gtCoverage: 0,
    falseCount: 0,
    duplicateCount: 0,
    tsvOnlyNewRescueRetained: 0,
    a4LineRescueRetained: 0,
    bothMiss: 0,
  };

  for (const image of images) {
    const variant = image.variants[name];
    summary.candidateCount +=
      variant.candidateCount;
    summary.gtCoverage += variant.gtCoverage;
    summary.falseCount += variant.falseCount;
    summary.duplicateCount +=
      variant.duplicateCount;
    summary.tsvOnlyNewRescueRetained +=
      image.complementarity[name]
        .tsvOnlyNewRescueRetained;
    summary.a4LineRescueRetained +=
      image.complementarity[name]
        .a4LineRescueRetained;
    summary.bothMiss +=
      image.complementarity[name].bothMiss;
  }

  return {
    ...summary,
    recall: summary.gtCoverage / 54,
    a4LineRescueRetentionRate:
      summary.a4LineRescueRetained /
      A4_LINE_RESCUE_TOTAL,
  };
}

export default function StageA5Page() {
  const inputRef =
    useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "黄色正式12枚を選択してください。",
  );
  const [result, setResult] =
    useState<any>(null);
  const [copyState, setCopyState] =
    useState("");

  async function run(files: FileList | null) {
    if (!files?.length) return;

    const byCanonical = new Map<string, File>();

    for (const file of Array.from(files)) {
      const id = canonicalFromName(file.name);
      if (id && !byCanonical.has(id)) {
        byCanonical.set(id, file);
      }
    }

    const missing = EXPECTED_FILES.filter(
      (id) => !byCanonical.has(id),
    );

    if (missing.length) {
      setStatus(
        `正式12枚が揃っていません。missing: ${missing.join(", ")}`,
      );
      return;
    }

    setBusy(true);
    setResult(null);
    setCopyState("");

    let worker: any = null;

    try {
      const tesseract: any =
        await import("tesseract.js");

      worker = await tesseract.createWorker(
        "jpn+eng",
        1,
      );

      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode:
          tesseract.PSM?.AUTO ?? "3",
        user_defined_dpi: "300",
        tessedit_char_whitelist: "",
      });

      const images: any[] = [];

      for (
        let i = 0;
        i < EXPECTED_FILES.length;
        i += 1
      ) {
        const fileName = EXPECTED_FILES[i];
        const file =
          byCanonical.get(fileName)!;
        const gt = GT_MAP.get(fileName)!;

        setStatus(
          `${i + 1}/12 ${fileName} Stage A5解析中…`,
        );

        const color =
          await orientedColorCanvas(file);
        const paper = detectPaperBox(
          color.canvas,
        );
        const colorCtx =
          color.canvas.getContext("2d", {
            willReadFrequently: true,
          });

        if (!colorCtx) {
          throw new Error(
            "色保持geometryを取得できません。",
          );
        }

        const rgba = colorCtx.getImageData(
          0,
          0,
          color.canvas.width,
          color.canvas.height,
        ).data;

        const prepared =
          await prepareOCRInputFile(file);
        const ocrSource =
          await fileCanvas(prepared);

        if (
          ocrSource.width !==
            color.canvas.width ||
          ocrSource.height !==
            color.canvas.height
        ) {
          throw new Error(
            `${fileName}: TSV/OCR座標系 ${ocrSource.width}x${ocrSource.height} と geometry ${color.canvas.width}x${color.canvas.height} が不一致`,
          );
        }

        const full = await worker.recognize(
          await canvasBlob(
            ocrSource,
            0.96,
          ),
          {},
          {
            blocks: false,
            text: false,
            layoutBlocks: false,
            hocr: false,
            tsv: true,
            box: false,
            unlv: false,
            osd: false,
            pdf: false,
            imageColor: false,
            imageGrey: false,
            imageBinary: false,
            debug: false,
          },
        );

        const tsv = String(
          full.data.tsv || "",
        );
        const parsed =
          parseHeaderlessRuntimeTsv(tsv);

        if (
          parsed.contract.headerPresent
        ) {
          throw new Error(
            `${fileName}: runtime TSV unexpectedly contains a named header`,
          );
        }

        const wordGroup =
          tsvWordGroupRows(
            parsed.records,
            paper,
          );
        const rawLineRows =
          tsvLineRows(
            parsed.records,
            paper,
          );
        const ruleRows = rulesRows(
          rgba,
          color.canvas.width,
          color.canvas.height,
          paper,
        );

        const lineBuild =
          buildLevel4LineProposals(
            parsed.records,
            paper,
          );
        const consolidated =
          consolidateLineCandidates(
            lineBuild.lines,
          );
        const wordSupported =
          filterByWordChildSupport(
            consolidated.rows,
          );
        const consensus =
          filterByWordGroupConsensus(
            consolidated.rows,
            wordGroup.rows,
          );
        const gapSelective =
          filterToRulesUncoveredVerticalGaps(
            ruleRows,
            consolidated.rows,
          );

        const variantRows = {
          A_rulesPlusConsolidatedLine:
            combineRulesAndRescue(
              ruleRows,
              consolidated.rows,
            ),
          B_rulesPlusWordSupportedLine:
            combineRulesAndRescue(
              ruleRows,
              wordSupported.rows,
            ),
          C_rulesPlusLineWordConsensus:
            combineRulesAndRescue(
              ruleRows,
              consensus.rows,
            ),
          D_rulesGapSelectiveRescue:
            combineRulesAndRescue(
              ruleRows,
              gapSelective.rows,
            ),
        };

        const meta = {
          rawWidth: color.rawWidth,
          rawHeight: color.rawHeight,
          geometryWidth:
            color.canvas.width,
          geometryHeight:
            color.canvas.height,
          autoRotate90CCW: color.rotate,
        };

        const rulesOnly = scoreRows(
          asCandidateRows(ruleRows),
          paper,
          meta,
          gt,
        );

        const a4LineOnly = scoreRows(
          asCandidateRows(rawLineRows),
          paper,
          meta,
          gt,
        );

        const a4RawUnion = scoreRows(
          asCandidateRows([
            ...ruleRows,
            ...rawLineRows,
          ]),
          paper,
          meta,
          gt,
        );

        const variants: Record<string, any> = {
          rulesOnly,
          a4LineOnly,
          a4RawUnion,
        };

        for (
          const [name, rows] of Object.entries(
            variantRows,
          )
        ) {
          variants[name] = scoreRows(
            asCandidateRows(rows),
            paper,
            meta,
            gt,
          );
        }

        const a4LineNewRescue = setDiff(
          a4LineOnly.coveredGtRows,
          rulesOnly.coveredGtRows,
        );

        const complementarity: Record<
          string,
          any
        > = {};

        for (const name of Object.keys(
          variantRows,
        )) {
          const covered =
            variants[name].coveredGtRows;

          const newRescue = setDiff(
            covered,
            rulesOnly.coveredGtRows,
          );

          const retained = intersection(
            covered,
            a4LineNewRescue,
          );

          complementarity[name] = {
            rulesCovered:
              rulesOnly.gtCoverage,
            variantCovered:
              variants[name].gtCoverage,
            tsvOnlyNewRescueRetained:
              newRescue.length,
            tsvOnlyNewRescueRows:
              newRescue,
            a4LineNewRescueCount:
              a4LineNewRescue.length,
            a4LineNewRescueRows:
              a4LineNewRescue,
            a4LineRescueRetained:
              retained.length,
            a4LineRescueRetainedRows:
              retained,
            bothMiss:
              gt.rowCount -
              variants[name].gtCoverage,
          };
        }

        const wordHeights =
          parsed.records
            .filter(
              (record) =>
                record.level === 5 &&
                record.height > 0,
            )
            .map((record) => record.height);

        const maxWordHeight =
          wordHeights.length
            ? Math.max(...wordHeights)
            : 0;

        images.push({
          fileName,
          gtRowCount: gt.rowCount,
          runtimeTsvContract:
            parsed.contract,
          paperBBoxNormalized: {
            x:
              +(paper.x /
                color.canvas.width).toFixed(
                6,
              ),
            y:
              +(paper.y /
                color.canvas.height).toFixed(
                6,
              ),
            w:
              +(paper.w /
                color.canvas.width).toFixed(
                6,
              ),
            h:
              +(paper.h /
                color.canvas.height).toFixed(
                6,
              ),
          },
          diagnostic: {
            lineBuildTrace:
              lineBuild.trace,
            consolidationTrace:
              consolidated.trace,
            wordSupportTrace:
              wordSupported.trace,
            consensusTrace:
              consensus.trace,
            gapSelectiveTrace:
              gapSelective.trace,
            pathologicalTsvSegmentation:
              lineBuild.trace
                .level5WordCountInsidePaper <=
                1 &&
              maxWordHeight >
                paper.h * 0.5,
          },
          variants,
          complementarity,
        });
      }

      const selectiveNames = [
        "A_rulesPlusConsolidatedLine",
        "B_rulesPlusWordSupportedLine",
        "C_rulesPlusLineWordConsensus",
        "D_rulesGapSelectiveRescue",
      ];

      const aggregate: Record<
        string,
        any
      > = {};

      for (const name of selectiveNames) {
        aggregate[name] =
          summarizeVariant(images, name);
      }

      const baseline = {
        rulesOnly: {
          candidateCount: images.reduce(
            (sum, img) =>
              sum +
              img.variants.rulesOnly
                .candidateCount,
            0,
          ),
          gtCoverage: images.reduce(
            (sum, img) =>
              sum +
              img.variants.rulesOnly
                .gtCoverage,
            0,
          ),
          falseCount: images.reduce(
            (sum, img) =>
              sum +
              img.variants.rulesOnly
                .falseCount,
            0,
          ),
          duplicateCount:
            images.reduce(
              (sum, img) =>
                sum +
                img.variants.rulesOnly
                  .duplicateCount,
              0,
            ),
        },
        a4LineOnly: {
          candidateCount: images.reduce(
            (sum, img) =>
              sum +
              img.variants.a4LineOnly
                .candidateCount,
            0,
          ),
          gtCoverage: images.reduce(
            (sum, img) =>
              sum +
              img.variants.a4LineOnly
                .gtCoverage,
            0,
          ),
          falseCount: images.reduce(
            (sum, img) =>
              sum +
              img.variants.a4LineOnly
                .falseCount,
            0,
          ),
          duplicateCount:
            images.reduce(
              (sum, img) =>
                sum +
                img.variants.a4LineOnly
                  .duplicateCount,
              0,
            ),
        },
        a4RawUnion: {
          candidateCount: images.reduce(
            (sum, img) =>
              sum +
              img.variants.a4RawUnion
                .candidateCount,
            0,
          ),
          gtCoverage: images.reduce(
            (sum, img) =>
              sum +
              img.variants.a4RawUnion
                .gtCoverage,
            0,
          ),
          falseCount: images.reduce(
            (sum, img) =>
              sum +
              img.variants.a4RawUnion
                .falseCount,
            0,
          ),
          duplicateCount:
            images.reduce(
              (sum, img) =>
                sum +
                img.variants.a4RawUnion
                  .duplicateCount,
              0,
            ),
        },
      };

      for (const value of Object.values(
        baseline,
      )) {
        (value as any).recall =
          (value as any).gtCoverage / 54;
      }

      const payload = {
        schema:
          "icb.parts-ocr.stage-a5-selective-tsv-rescue.v1",
        sourceHead: SOURCE_HEAD,
        evaluationSet:
          "formal-yellow-12",
        gtTotalRows: 54,
        experimentOnly: true,
        gtUsage:
          "post-hoc scoring only; no GT candidate selection or parameter tuning",
        baseline,
        aggregate,
        images,
      };

      setResult(payload);
      setStatus(
        "12/12 Stage A5解析完了。summaryをコピーできます。",
      );
    } catch (error) {
      setStatus(
        `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (worker) {
        await worker
          .terminate()
          .catch(() => {});
      }
      setBusy(false);
    }
  }

  function shortSummary() {
    if (!result) return null;

    return {
      schema: result.schema,
      sourceHead: result.sourceHead,
      evaluationSet:
        result.evaluationSet,
      gtTotalRows: result.gtTotalRows,
      experimentOnly: true,
      baseline: result.baseline,
      aggregate: result.aggregate,
      images: result.images.map(
        (image: any) => ({
          fileName: image.fileName,
          gtRowCount: image.gtRowCount,
          diagnostic: image.diagnostic,
          perImageCoverage:
            Object.fromEntries(
              Object.entries(
                image.variants,
              ).map(([name, value]: any) => [
                name,
                {
                  candidateCount:
                    value.candidateCount,
                  gtCoverage:
                    value.gtCoverage,
                  recall: value.recall,
                  falseCount:
                    value.falseCount,
                  duplicateCount:
                    value.duplicateCount,
                  coveredGtRows:
                    value.coveredGtRows,
                },
              ]),
            ),
          complementarity:
            image.complementarity,
        }),
      ),
    };
  }

  async function copySummary() {
    const summary = shortSummary();
    if (!summary) return;

    const text = JSON.stringify(
      summary,
      null,
      2,
    );

    try {
      await navigator.clipboard.writeText(
        text,
      );
    } catch {
      const ta =
        document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }

    setCopyState(
      "コピーしました。総合管理チャットへそのまま貼り付けてください。",
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>
          Stage A5 Selective TSV Rescue
        </h1>
        <p style={styles.text}>
          rulesをprimary proposalとして維持し、
          actual runtime TSV level-4 lineを
          rescue proposalとしてselectiveに評価します。
          GTは全candidate生成完了後のpost-hoc scoringだけに使用し、
          OCR文字列の意味、GT row位置、固定12枚専用parameterは
          candidate生成・選択に使用しません。
        </p>
      </section>

      <section style={styles.card}>
        <p style={styles.text}>
          A: level-4 line consolidation
          <br />
          B: level-5 word child support
          <br />
          C: TSV line / TSV word-group consensus
          <br />
          D: rules-uncovered vertical gap rescue
        </p>

        <input
          ref={inputRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={(event) =>
            run(event.target.files)
          }
        />

        <button
          style={styles.primary}
          disabled={busy}
          onClick={() =>
            inputRef.current?.click()
          }
        >
          {busy
            ? "Stage A5解析中…"
            : "黄色正式12枚を選択してStage A5実行"}
        </button>

        <div
          style={{
            marginTop: 10,
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {status}
        </div>
      </section>

      {result && (
        <>
          <section style={styles.card}>
            <button
              style={styles.primary}
              onClick={copySummary}
            >
              総合管理用Stage A5 summaryをコピー
            </button>

            {copyState && (
              <div
                style={{
                  marginTop: 8,
                  color: "#1d6b32",
                  fontWeight: 800,
                }}
              >
                {copyState}
              </div>
            )}
          </section>

          <section style={styles.card}>
            <pre style={styles.pre}>
              {JSON.stringify(
                shortSummary(),
                null,
                2,
              )}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
