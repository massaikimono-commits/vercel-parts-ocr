"use client";

import { detectPaperBox, orientedCanvas } from "../diagnostic/stage-a20/a19-table-crops";
import { measureTableRules, rectifyPaper } from "../diagnostic/stage-a22/crop-correction";

export type BrowserGeometryTrace = {
  sourceWidth: number;
  sourceHeight: number;
  rotated: boolean;
  paper: { x: number; y: number; w: number; h: number };
  rectifiedWidth: number;
  rectifiedHeight: number;
  horizontalRuleCount: number;
  verticalRuleCount: number;
  p1RuleBoundedRowCount: number;
  skewDeg: number;
  perspectiveDelta: number;
};

function ruleBoundedRowCount(horizontal: number[], paper: { h: number }) {
  const relevant = horizontal.filter((value) => value >= paper.h * .38 && value <= paper.h * .94).sort((a, b) => a - b);
  let count = 0;
  for (let index = 0; index < relevant.length - 1; index += 1) {
    const height = relevant[index + 1] - relevant[index];
    if (height >= paper.h * .018 && height <= paper.h * .13) count += 1;
  }
  return count;
}

export async function diagnoseBrowserGeometry(file: File): Promise<BrowserGeometryTrace> {
  const source = await orientedCanvas(file, 2200);
  const paper = detectPaperBox(source.canvas);
  const rectified = rectifyPaper(source.canvas, paper);
  const rules = measureTableRules(rectified.canvas, rectified.paper);
  return {
    sourceWidth: source.canvas.width,
    sourceHeight: source.canvas.height,
    rotated: source.rotate,
    paper,
    rectifiedWidth: rectified.canvas.width,
    rectifiedHeight: rectified.canvas.height,
    horizontalRuleCount: rules.horizontal.length,
    verticalRuleCount: rules.vertical.length,
    p1RuleBoundedRowCount: ruleBoundedRowCount(rules.horizontal, rectified.paper),
    skewDeg: rectified.skewDeg,
    perspectiveDelta: rectified.perspectiveDelta,
  };
}
