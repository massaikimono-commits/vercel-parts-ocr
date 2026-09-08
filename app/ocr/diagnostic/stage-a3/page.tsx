/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { prepareOCRInputFile } from "../../transfer";

type CropBox = { x: number; y: number; w: number; h: number };
type RowBand = { top: number; bottom: number; center: number; source: "rules" | "tsv"; index?: number };
type TsvWord = { text: string; left: number; top: number; width: number; height: number; conf: number };
type GtRow = { rowIndex: number; y1Norm: number; y2Norm: number };
type GtImage = {
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  rotationDeg: number;
  rowCount: number;
  rows: GtRow[];
};

const SOURCE_HEAD = "6a31ec4b9028410e90a8dbd9c8b40d53de7742d2";
const DYNAMIC_ROWS_BLOB_SHA = "c505b7afb37ed1a4cdf4b6b6dd00022c603bddc7";
const TRANSFER_BLOB_SHA = "0540d6aa4699adcaf2a3a7154d91ea47513a7921";
const DYNAMIC_DIAGNOSTIC_BLOB_SHA = "c5dfcee10776db17d7aabe495585c56502aac57b";

const ACCEPTED_GT: GtImage[] = [
  { fileName:"IMG_0675(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:6, rows:[
    {rowIndex:1,y1Norm:0.387566,y2Norm:0.449735},{rowIndex:2,y1Norm:0.436508,y2Norm:0.503968},{rowIndex:3,y1Norm:0.498677,y2Norm:0.555556},{rowIndex:4,y1Norm:0.546296,y2Norm:0.600529},{rowIndex:5,y1Norm:0.59127,y2Norm:0.650794},{rowIndex:6,y1Norm:0.648148,y2Norm:0.71164}]},
  { fileName:"IMG_0676(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:6, rows:[
    {rowIndex:1,y1Norm:0.40873,y2Norm:0.455026},{rowIndex:2,y1Norm:0.436508,y2Norm:0.478836},{rowIndex:3,y1Norm:0.46164,y2Norm:0.51455},{rowIndex:4,y1Norm:0.507937,y2Norm:0.537037},{rowIndex:5,y1Norm:0.52381,y2Norm:0.558201},{rowIndex:6,y1Norm:0.559524,y2Norm:0.596561}]},
  { fileName:"IMG_0677(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:5, rows:[
    {rowIndex:1,y1Norm:0.419312,y2Norm:0.47619},{rowIndex:2,y1Norm:0.443122,y2Norm:0.537037},{rowIndex:3,y1Norm:0.531746,y2Norm:0.589947},{rowIndex:4,y1Norm:0.57672,y2Norm:0.634921},{rowIndex:5,y1Norm:0.638889,y2Norm:0.678571}]},
  { fileName:"IMG_0678(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:5, rows:[
    {rowIndex:1,y1Norm:0.421958,y2Norm:0.47619},{rowIndex:2,y1Norm:0.474868,y2Norm:0.518519},{rowIndex:3,y1Norm:0.517196,y2Norm:0.570106},{rowIndex:4,y1Norm:0.571429,y2Norm:0.615079},{rowIndex:5,y1Norm:0.597884,y2Norm:0.669312}]},
  { fileName:"IMG_0679(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:5, rows:[
    {rowIndex:1,y1Norm:0.433862,y2Norm:0.47619},{rowIndex:2,y1Norm:0.464286,y2Norm:0.51455},{rowIndex:3,y1Norm:0.511905,y2Norm:0.555556},{rowIndex:4,y1Norm:0.534392,y2Norm:0.596561},{rowIndex:5,y1Norm:0.582011,y2Norm:0.654762}]},
  { fileName:"IMG_0680(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.37037,y2Norm:0.460317},{rowIndex:2,y1Norm:0.448413,y2Norm:0.522487}]},
  { fileName:"IMG_0681(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.462963,y2Norm:0.525132},{rowIndex:2,y1Norm:0.519841,y2Norm:0.572751}]},
  { fileName:"IMG_0682(1)", imageWidth:4032, imageHeight:3024, rotationDeg:180, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.384921,y2Norm:0.448413},{rowIndex:2,y1Norm:0.443122,y2Norm:0.510582}]},
  { fileName:"IMG_0683(1)", imageWidth:4032, imageHeight:3024, rotationDeg:0, rowCount:2, rows:[
    {rowIndex:1,y1Norm:0.306878,y2Norm:0.383598},{rowIndex:2,y1Norm:0.390212,y2Norm:0.453704}]},
  { fileName:"IMG_0684(1)", imageWidth:4032, imageHeight:3024, rotationDeg:0, rowCount:8, rows:[
    {rowIndex:1,y1Norm:0.195767,y2Norm:0.246032},{rowIndex:2,y1Norm:0.239418,y2Norm:0.276455},{rowIndex:3,y1Norm:0.272487,y2Norm:0.305556},{rowIndex:4,y1Norm:0.293651,y2Norm:0.337302},{rowIndex:5,y1Norm:0.325397,y2Norm:0.365079},{rowIndex:6,y1Norm:0.359788,y2Norm:0.396825},{rowIndex:7,y1Norm:0.60582,y2Norm:0.660053},{rowIndex:8,y1Norm:0.646825,y2Norm:0.699735}]},
  { fileName:"IMG_0685(1)", imageWidth:4032, imageHeight:3024, rotationDeg:0, rowCount:8, rows:[
    {rowIndex:1,y1Norm:0.289683,y2Norm:0.332011},{rowIndex:2,y1Norm:0.318783,y2Norm:0.359788},{rowIndex:3,y1Norm:0.347884,y2Norm:0.384921},{rowIndex:4,y1Norm:0.371693,y2Norm:0.412698},{rowIndex:5,y1Norm:0.403439,y2Norm:0.436508},{rowIndex:6,y1Norm:0.428571,y2Norm:0.473545},{rowIndex:7,y1Norm:0.689153,y2Norm:0.743386},{rowIndex:8,y1Norm:0.730159,y2Norm:0.798942}]},
  { fileName:"IMG_0686(1)", imageWidth:4032, imageHeight:3024, rotationDeg:270, rowCount:3, rows:[
    {rowIndex:1,y1Norm:0.42328,y2Norm:0.519841},{rowIndex:2,y1Norm:0.531746,y2Norm:0.637566},{rowIndex:3,y1Norm:0.686508,y2Norm:0.797619}]},
];

const GT_MAP = new Map(ACCEPTED_GT.map((x) => [x.fileName, x]));
const EXPECTED_FILES = ACCEPTED_GT.map((x) => x.fileName);

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto", padding: "16px 12px 60px", color: "#172033", background: "#f5f7fb", minHeight: "100vh" },
  card: { background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14, marginBottom: 12 },
  title: { margin: 0, fontSize: 24, fontWeight: 900 },
  text: { color: "#5b6678", lineHeight: 1.65, fontSize: 14 },
  primary: { width: "100%", border: 0, borderRadius: 13, padding: "14px 12px", background: "#2468df", color: "#fff", fontWeight: 800, fontSize: 17 },
  secondary: { width: "100%", border: "1px solid #ccd5e3", borderRadius: 13, padding: "12px", background: "#fff", color: "#234f9f", fontWeight: 800, fontSize: 15, marginTop: 8 },
  pre: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#f7f9fc", border: "1px solid #e2e7ef", borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 1.45, maxHeight: 520, overflow: "auto" },
};

function canonicalFromName(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  return m ? `IMG_${m[1]}(1)` : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function luminance(r: number, g: number, b: number) {
  return r * 0.20 + g * 0.72 + b * 0.08;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を開けませんでした。")); };
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
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
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
  return { canvas, rotate, rawWidth: img.naturalWidth, rawHeight: img.naturalHeight };
}

async function fileCanvas(file: File) {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("画像を処理できませんでした。");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function detectPaperBoxWithTrace(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { box: { x:0,y:0,w:canvas.width,h:canvas.height }, state: "no-context-fallback" };
  }
  const { width: w, height: h } = canvas;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 800));
  const isPaper = (r: number, g: number, b: number) => {
    const bright = (r + g + b) / 3;
    const yellow = r > 100 && g > 95 && r + g > b * 1.75;
    return bright > 150 || yellow;
  };
  const ys: number[] = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0; let count = 0;
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.18) ys.push(y);
  }
  if (ys.length < 4) {
    return { box: { x:0,y:0,w,h }, state: "insufficient-y-paper-hits-fallback", trace: { step, yHitCount: ys.length } };
  }
  const top = Math.max(0, ys[0] - step * 2);
  const roughBottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs: number[] = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0; let count = 0;
    for (let y = top; y <= roughBottom; y += step) {
      const p = (y * w + x) * 4;
      if (isPaper(pixels[p], pixels[p + 1], pixels[p + 2])) hit += 1;
      count += 1;
    }
    if (count && hit / count > 0.20) xs.push(x);
  }
  const left = xs.length ? Math.max(0, xs[0] - step * 2) : 0;
  const right = xs.length ? Math.min(w - 1, xs[xs.length - 1] + step * 2) : w - 1;
  const width = right - left + 1;
  let boxHeight = roughBottom - top + 1;
  const beforeAspectClipHeight = boxHeight;
  const expectedHeight = Math.round(width / 1.74);
  let aspectClipApplied = false;
  if (width / boxHeight < 1.55 && expectedHeight < boxHeight) {
    boxHeight = Math.min(expectedHeight, h - top);
    aspectClipApplied = true;
  }
  if (width < w * 0.55 || boxHeight < h * 0.25) {
    return {
      box: { x:0,y:0,w,h },
      state: "small-detected-box-fallback",
      trace: { step, yHitCount: ys.length, xHitCount: xs.length, detected: { left, top, width, boxHeight }, aspectClipApplied, beforeAspectClipHeight, expectedHeight },
    };
  }
  return {
    box: { x:left,y:top,w:width,h:boxHeight },
    state: "detected",
    trace: { step, yHitCount: ys.length, xHitCount: xs.length, aspectClipApplied, beforeAspectClipHeight, expectedHeight },
  };
}

function traceHorizontalRules(
  rgba: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  paper: CropBox,
) {
  const left = clamp(Math.round(paper.x + paper.w * 0.015), 0, imageWidth - 1);
  const right = clamp(Math.round(paper.x + paper.w * 0.985), left + 1, imageWidth);
  const top = clamp(Math.round(paper.y + paper.h * 0.18), 0, imageHeight - 1);
  const bottom = clamp(Math.round(paper.y + paper.h * 0.96), top + 1, imageHeight);
  const xStep = Math.max(1, Math.floor(paper.w / 900));
  const rowScores: Array<{ y:number; score:number }> = [];

  for (let y = top; y < bottom; y += 1) {
    let dark = 0; let sampled = 0;
    for (let x = left; x < right; x += xStep) {
      const p = (y * imageWidth + x) * 4;
      if (p < 0 || p + 2 >= rgba.length) continue;
      if (luminance(rgba[p], rgba[p + 1], rgba[p + 2]) < 118) dark += 1;
      sampled += 1;
    }
    rowScores.push({ y, score: sampled ? dark / sampled : 0 });
  }

  const minScore = 0.26;
  const active = rowScores.filter((x) => x.score >= minScore);
  const groups: Array<{start:number;end:number;peak:number}> = [];
  for (const item of active) {
    const last = groups[groups.length - 1];
    if (!last || item.y > last.end + 2) groups.push({ start:item.y,end:item.y,peak:item.score });
    else {
      last.end = item.y;
      last.peak = Math.max(last.peak, item.score);
    }
  }

  const maxThickness = Math.max(2, Math.round(paper.h * 0.018));
  const rules = groups
    .filter((g) => g.end - g.start + 1 <= maxThickness)
    .map((g) => ({ start:g.start,end:g.end,center:Math.round((g.start + g.end) / 2),peak:g.peak }));

  return {
    rules,
    stages: [
      {
        stageName: "detectHorizontalRuleBands: score>=0.26",
        inputCount: rowScores.length,
        outputCount: active.length,
        rejectedCount: rowScores.length - active.length,
        rejectReasonCounts: { scoreBelow0_26: rowScores.length - active.length },
      },
      {
        stageName: "detectHorizontalRuleBands: adjacent-scanline grouping (<=2px)",
        inputCount: active.length,
        outputCount: groups.length,
        rejectedCount: Math.max(0, active.length - groups.length),
        rejectReasonCounts: { mergedIntoAdjacentGroup: Math.max(0, active.length - groups.length) },
      },
      {
        stageName: "detectHorizontalRuleBands: max-thickness filter",
        inputCount: groups.length,
        outputCount: rules.length,
        rejectedCount: groups.length - rules.length,
        rejectReasonCounts: { thicknessAboveMax: groups.length - rules.length },
      },
    ],
    constants: { left,right,top,bottom,xStep,minScore,maxThickness },
  };
}

function traceRuleRows(rules: Array<{start:number;end:number;center:number}>, paper: CropBox) {
  if (rules.length < 2) {
    return {
      gapCandidates: [] as RowBand[],
      ruleRows: [] as RowBand[],
      stages: [
        { stageName:"rowBandsFromRules: adjacent-rule gap range", inputCount:0, outputCount:0, rejectedCount:0, rejectReasonCounts:{} },
        { stageName:"rowBandsFromRules: median-height filter", inputCount:0, outputCount:0, rejectedCount:0, rejectReasonCounts:{} },
      ],
      constants: { minGap:Math.max(16, Math.round(paper.h * 0.018)), maxGap:Math.max(Math.max(16, Math.round(paper.h * 0.018))+1, Math.round(paper.h * 0.14)), median:null },
    };
  }

  const sorted = [...rules].sort((a,b) => a.center - b.center);
  const minGap = Math.max(16, Math.round(paper.h * 0.018));
  const maxGap = Math.max(minGap + 1, Math.round(paper.h * 0.14));
  const gapCandidates: RowBand[] = [];
  let tooSmall = 0; let tooLarge = 0;

  for (let i=0;i<sorted.length-1;i+=1) {
    const a=sorted[i], b=sorted[i+1];
    const gap=b.start-a.end-1;
    if (gap < minGap) { tooSmall += 1; continue; }
    if (gap > maxGap) { tooLarge += 1; continue; }
    const top=a.end+1, bottom=b.start-1;
    gapCandidates.push({ top,bottom,center:Math.round((top+bottom)/2),source:"rules",index:gapCandidates.length+1 });
  }

  if (!gapCandidates.length) {
    return {
      gapCandidates,
      ruleRows: [] as RowBand[],
      stages: [
        { stageName:"rowBandsFromRules: adjacent-rule gap range", inputCount:sorted.length-1, outputCount:0, rejectedCount:sorted.length-1, rejectReasonCounts:{ gapBelowMin:tooSmall,gapAboveMax:tooLarge } },
        { stageName:"rowBandsFromRules: median-height filter", inputCount:0, outputCount:0, rejectedCount:0, rejectReasonCounts:{} },
      ],
      constants:{minGap,maxGap,median:null},
    };
  }

  const heights = gapCandidates.map((r) => r.bottom-r.top+1).sort((a,b)=>a-b);
  const median = heights[Math.floor(heights.length/2)] || 1;
  let below = 0; let above = 0;
  const ruleRows = gapCandidates.filter((r) => {
    const h=r.bottom-r.top+1;
    if (h < median*0.50) { below += 1; return false; }
    if (h > median*1.85) { above += 1; return false; }
    return true;
  }).map((r,i)=>({...r,index:i+1}));

  return {
    gapCandidates,
    ruleRows,
    stages:[
      { stageName:"rowBandsFromRules: adjacent-rule gap range", inputCount:sorted.length-1, outputCount:gapCandidates.length, rejectedCount:tooSmall+tooLarge, rejectReasonCounts:{gapBelowMin:tooSmall,gapAboveMax:tooLarge} },
      { stageName:"rowBandsFromRules: median-height filter", inputCount:gapCandidates.length, outputCount:ruleRows.length, rejectedCount:below+above, rejectReasonCounts:{heightBelowMedianHalf:below,heightAboveMedian1_85:above} },
    ],
    constants:{minGap,maxGap,median},
  };
}

function traceTsvRows(tsv: string, paper: CropBox) {
  const lines = String(tsv || "").split(/\r?\n/);
  if (lines.length < 2) {
    return { tsvRows:[] as RowBand[], stages:[], constants:{medianHeight:null,tolerance:null,minWords:2}, invoked:true };
  }
  const header=lines[0].split("\t");
  const idx=(name:string)=>header.indexOf(name);
  const textIdx=idx("text"), leftIdx=idx("left"), topIdx=idx("top"), widthIdx=idx("width"), heightIdx=idx("height"), confIdx=idx("conf");
  if ([textIdx,leftIdx,topIdx,widthIdx,heightIdx].some((x)=>x<0)) {
    return { tsvRows:[] as RowBand[], stages:[{stageName:"rowBandsFromTSV: TSV header validation",inputCount:lines.length-1,outputCount:0,rejectedCount:lines.length-1,rejectReasonCounts:{missingRequiredColumn:lines.length-1}}], constants:{medianHeight:null,tolerance:null,minWords:2}, invoked:true };
  }

  const nonEmptyLines=lines.slice(1).filter((line)=>line.trim());
  const words:TsvWord[]=[];
  let blankText=0, invalidGeometry=0, negativeConf=0;
  for (const line of nonEmptyLines) {
    const c=line.split("\t");
    const text=String(c[textIdx] || "").trim();
    if (!text) { blankText += 1; continue; }
    const left=Number(c[leftIdx]), top=Number(c[topIdx]), width=Number(c[widthIdx]), height=Number(c[heightIdx]);
    const conf=confIdx>=0?Number(c[confIdx]):0;
    if (![left,top,width,height].every(Number.isFinite) || width<=0 || height<=0) { invalidGeometry += 1; continue; }
    if (Number.isFinite(conf) && conf<0) { negativeConf += 1; continue; }
    words.push({text,left,top,width,height,conf:Number.isFinite(conf)?conf:0});
  }

  const inPaper=words.filter((word)=>{
    const cx=word.left+word.width/2, cy=word.top+word.height/2;
    return cx>=paper.x && cx<=paper.x+paper.w && cy>=paper.y && cy<=paper.y+paper.h;
  });
  const heights=inPaper.map((w)=>w.height).sort((a,b)=>a-b);
  const medianHeight=Math.max(4,heights[Math.floor(heights.length/2)] || 4);
  const tolerance=Math.max(5,medianHeight*0.75);
  const rows:Array<{words:TsvWord[];center:number}>=[];
  for (const word of [...inPaper].sort((a,b)=>a.top-b.top || a.left-b.left)) {
    const center=word.top+word.height/2;
    let best=rows.find((row)=>Math.abs(row.center-center)<=tolerance);
    if (!best) { best={words:[],center}; rows.push(best); }
    best.words.push(word);
    best.center=best.words.reduce((sum,w)=>sum+w.top+w.height/2,0)/best.words.length;
  }

  const minWords=2;
  const acceptedGroups=rows.filter((row)=>row.words.length>=minWords);
  const tsvRows=acceptedGroups.map((row,i)=>{
    const top=Math.max(paper.y,Math.min(...row.words.map((w)=>w.top))-Math.round(medianHeight*0.45));
    const bottom=Math.min(paper.y+paper.h-1,Math.max(...row.words.map((w)=>w.top+w.height))+Math.round(medianHeight*0.45));
    return {top,bottom,center:Math.round((top+bottom)/2),source:"tsv" as const,index:i+1};
  }).sort((a,b)=>a.center-b.center).map((r,i)=>({...r,index:i+1}));

  return {
    tsvRows,
    stages:[
      {stageName:"rowBandsFromTSV: parse valid words",inputCount:nonEmptyLines.length,outputCount:words.length,rejectedCount:blankText+invalidGeometry+negativeConf,rejectReasonCounts:{blankText,invalidGeometry,negativeConfidence:negativeConf}},
      {stageName:"rowBandsFromTSV: paper-bbox word filter",inputCount:words.length,outputCount:inPaper.length,rejectedCount:words.length-inPaper.length,rejectReasonCounts:{outsidePaperBox:words.length-inPaper.length}},
      {stageName:"rowBandsFromTSV: word-center grouping",inputCount:inPaper.length,outputCount:rows.length,rejectedCount:Math.max(0,inPaper.length-rows.length),rejectReasonCounts:{mergedIntoExistingTextRow:Math.max(0,inPaper.length-rows.length)}},
      {stageName:"rowBandsFromTSV: minWords>=2 filter",inputCount:rows.length,outputCount:acceptedGroups.length,rejectedCount:rows.length-acceptedGroups.length,rejectReasonCounts:{tooFewWords:rows.length-acceptedGroups.length}},
    ],
    constants:{medianHeight,tolerance,minWords},
    invoked:true,
  };
}

function traceMerge(ruleRows: RowBand[], tsvRows: RowBand[], paper: CropBox) {
  const combined=[...ruleRows.map((r)=>({...r}))];
  const mergeDistance=Math.max(8,Math.round(paper.h*0.018));
  let suppressed=0;
  for (const row of tsvRows) {
    const existing=combined.find((candidate)=>Math.abs(candidate.center-row.center)<=mergeDistance);
    if (!existing) combined.push({...row});
    else suppressed += 1;
  }
  const beforeRange=combined.sort((a,b)=>a.center-b.center).map((r,i)=>({...r,index:i+1}));
  let before20=0, after96=0;
  const finalRows=beforeRange.filter((row)=>{
    if (row.center < paper.y+paper.h*0.20) { before20 += 1; return false; }
    if (row.center > paper.y+paper.h*0.96) { after96 += 1; return false; }
    return true;
  }).sort((a,b)=>a.center-b.center).map((r,i)=>({...r,index:i+1}));

  return {
    beforeRange,
    finalRows,
    stages:[
      {stageName:"mergeDynamicRows: TSV near-center dedupe",inputCount:ruleRows.length+tsvRows.length,outputCount:beforeRange.length,rejectedCount:suppressed,rejectReasonCounts:{tsvNearExistingCenter:suppressed}},
      {stageName:"mergeDynamicRows: final center range 20%-96%",inputCount:beforeRange.length,outputCount:finalRows.length,rejectedCount:before20+after96,rejectReasonCounts:{centerBefore20pct:before20,centerAfter96pct:after96}},
    ],
    constants:{mergeDistance},
  };
}

function rawToGtPoint(rawX:number,rawY:number,rawWidth:number,rawHeight:number,rotationDeg:number) {
  const r=((rotationDeg%360)+360)%360;
  if (r===0) return {x:rawX,y:rawY,width:rawWidth,height:rawHeight};
  if (r===90) return {x:rawHeight-rawY,y:rawX,width:rawHeight,height:rawWidth};
  if (r===180) return {x:rawWidth-rawX,y:rawHeight-rawY,width:rawWidth,height:rawHeight};
  if (r===270) return {x:rawY,y:rawWidth-rawX,width:rawHeight,height:rawWidth};
  throw new Error("rotationDeg must be 0/90/180/270");
}

function candidateToRawPoint(x:number,y:number,rawWidth:number,rawHeight:number,geometryWidth:number,geometryHeight:number,autoRotate90CCW:boolean) {
  const sourceWidth=autoRotate90CCW?rawHeight:rawWidth;
  const sourceHeight=autoRotate90CCW?rawWidth:rawHeight;
  const sx=geometryWidth/sourceWidth, sy=geometryHeight/sourceHeight;
  return autoRotate90CCW ? {x:(geometryHeight-y)/sy,y:x/sx} : {x:x/sx,y:y/sy};
}

function mapRowToGt(row:RowBand,paper:CropBox,meta:any,gt:GtImage) {
  const x1=paper.x,x2=paper.x+paper.w,y1=row.top,y2=row.bottom+1;
  const corners=[[x1,y1],[x2,y1],[x1,y2],[x2,y2]].map(([x,y])=>{
    const raw=candidateToRawPoint(x,y,meta.rawWidth,meta.rawHeight,meta.geometryWidth,meta.geometryHeight,meta.autoRotate90CCW);
    return rawToGtPoint(raw.x,raw.y,meta.rawWidth,meta.rawHeight,gt.rotationDeg);
  });
  const cr=candidateToRawPoint(paper.x+paper.w/2,(y1+y2)/2,meta.rawWidth,meta.rawHeight,meta.geometryWidth,meta.geometryHeight,meta.autoRotate90CCW);
  const center=rawToGtPoint(cr.x,cr.y,meta.rawWidth,meta.rawHeight,gt.rotationDeg);
  const h=center.height;
  const yMin=Math.min(...corners.map((p)=>p.y))/h;
  const yMax=Math.max(...corners.map((p)=>p.y))/h;
  return {y1Norm:yMin,y2Norm:yMax,centerYNorm:center.y/h,heightNorm:yMax-yMin};
}

function scoreRows(rows:RowBand[],paper:CropBox,meta:any,gt:GtImage) {
  const covered=new Set<number>();
  let falseCount=0;
  const mapped=rows.map((row,i)=>{
    const m=mapRowToGt(row,paper,meta,gt);
    const containing=gt.rows.filter((g)=>m.centerYNorm>=g.y1Norm && m.centerYNorm<=g.y2Norm);
    let match: GtRow | null=null;
    if (containing.length) {
      match=[...containing].sort((a,b)=>Math.abs(m.centerYNorm-(a.y1Norm+a.y2Norm)/2)-Math.abs(m.centerYNorm-(b.y1Norm+b.y2Norm)/2))[0];
      covered.add(match.rowIndex);
    } else falseCount += 1;
    return {candidateIndex:i+1,source:row.source,y1Norm:+m.y1Norm.toFixed(6),y2Norm:+m.y2Norm.toFixed(6),centerYNorm:+m.centerYNorm.toFixed(6),heightNorm:+m.heightNorm.toFixed(6),matchedGtRowIndex:match?.rowIndex ?? null};
  });
  return {candidateCount:rows.length,GTcoverageAfterStage:covered.size,falseCountAfterStage:falseCount,coveredGtRows:[...covered].sort((a,b)=>a-b),mapped};
}

function dimensionAudit(meta:any,gt:GtImage) {
  const r=((gt.rotationDeg%360)+360)%360;
  const rw=(r===90||r===270)?meta.rawHeight:meta.rawWidth;
  const rh=(r===90||r===270)?meta.rawWidth:meta.rawHeight;
  const scaleX=gt.imageWidth/rw, scaleY=gt.imageHeight/rh;
  const exact=gt.imageWidth===rw && gt.imageHeight===rh;
  const aspect=Math.abs(gt.imageWidth/gt.imageHeight-rw/rh)<=1e-6*Math.max(1,Math.abs(gt.imageWidth/gt.imageHeight),Math.abs(rw/rh));
  const uniform=scaleX>0&&scaleY>0&&Math.abs(scaleX-scaleY)<=1e-6*Math.max(1,scaleX,scaleY)&&aspect;
  if (!exact && !uniform) throw new Error(`${gt.fileName}: dimension mapping incompatible`);
  return {gtWidth:gt.imageWidth,gtHeight:gt.imageHeight,candidateRawWidth:meta.rawWidth,candidateRawHeight:meta.rawHeight,rotationDeg:gt.rotationDeg,candidateRotatedWidth:rw,candidateRotatedHeight:rh,exactDimensionMatch:exact,scaleX,scaleY,uniformScale:uniform,dimensionMappingMode:exact?"exact-dimension-match":"uniform-scale-normalized-space"};
}

async function canvasBlob(canvas:HTMLCanvasElement,quality=0.96) {
  return new Promise<Blob>((resolve,reject)=>canvas.toBlob((b)=>b?resolve(b):reject(new Error("画像変換失敗")),"image/jpeg",quality));
}

function normPaper(paper:CropBox,w:number,h:number) {
  return {x:+(paper.x/w).toFixed(6),y:+(paper.y/h).toFixed(6),w:+(paper.w/w).toFixed(6),h:+(paper.h/h).toFixed(6)};
}

function enrichStages(stages:any[],scoreByStage:Record<string,any>) {
  return stages.map((s)=>({...s,...(scoreByStage[s.stageName]||{GTcoverageAfterStage:null,falseCountAfterStage:null})}));
}

export default function StageA3DynamicPipelineTracePage() {
  const inputRef=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("黄色正式12枚を選択してください。");
  const [result,setResult]=useState<any>(null);
  const [copyState,setCopyState]=useState("");

  async function run(files:FileList|null) {
    if (!files?.length) return;
    const byCanonical=new Map<string,File>();
    for (const file of Array.from(files)) {
      const id=canonicalFromName(file.name);
      if (id && !byCanonical.has(id)) byCanonical.set(id,file);
    }
    const missing=EXPECTED_FILES.filter((id)=>!byCanonical.has(id));
    if (missing.length) {
      setStatus(`正式12枚が揃っていません。missing: ${missing.join(", ")}`);
      return;
    }

    setBusy(true); setResult(null); setCopyState("");
    let worker:any=null;
    try {
      const tesseract:any=await import("tesseract.js");
      worker=await tesseract.createWorker("jpn+eng",1);
      await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:tesseract.PSM?.AUTO ?? "3",user_defined_dpi:"300",tessedit_char_whitelist:""});

      const images:any[]=[];
      for (let i=0;i<EXPECTED_FILES.length;i+=1) {
        const fileName=EXPECTED_FILES[i];
        const file=byCanonical.get(fileName)!;
        const gt=GT_MAP.get(fileName)!;
        setStatus(`${i+1}/12 ${fileName} をtrace中…`);

        const color=await orientedColorCanvas(file);
        const paperTrace=detectPaperBoxWithTrace(color.canvas);
        const paper=paperTrace.box;
        const ctx=color.canvas.getContext("2d",{willReadFrequently:true});
        if (!ctx) throw new Error("色保持画像を読めませんでした。");
        const rgba=ctx.getImageData(0,0,color.canvas.width,color.canvas.height).data;

        // Candidate pipeline first. GT is not referenced until all candidate stages below are complete.
        const ruleTrace=traceHorizontalRules(rgba,color.canvas.width,color.canvas.height,paper);
        const ruleRowsTrace=traceRuleRows(ruleTrace.rules,paper);

        const prepared=await prepareOCRInputFile(file);
        const ocrSource=await fileCanvas(prepared);
        const full=await worker.recognize(await canvasBlob(ocrSource,0.96),{}, {text:true,tsv:true});
        const tsv=full.data.tsv || "";
        const tsvTrace=traceTsvRows(tsv,paper);
        const mergeTrace=traceMerge(ruleRowsTrace.ruleRows,tsvTrace.tsvRows,paper);

        const meta={rawWidth:color.rawWidth,rawHeight:color.rawHeight,geometryWidth:color.canvas.width,geometryHeight:color.canvas.height,autoRotate90CCW:color.rotate};
        const dim=dimensionAudit(meta,gt);

        // Post-hoc scoring only, after candidate generation is complete.
        const gapScore=scoreRows(ruleRowsTrace.gapCandidates,paper,meta,gt);
        const ruleScore=scoreRows(ruleRowsTrace.ruleRows,paper,meta,gt);
        const tsvScore=scoreRows(tsvTrace.tsvRows,paper,meta,gt);
        const preRangeScore=scoreRows(mergeTrace.beforeRange,paper,meta,gt);
        const finalScore=scoreRows(mergeTrace.finalRows,paper,meta,gt);

        const scoreByStage:Record<string,any>={
          "rowBandsFromRules: adjacent-rule gap range":{GTcoverageAfterStage:gapScore.GTcoverageAfterStage,falseCountAfterStage:gapScore.falseCountAfterStage},
          "rowBandsFromRules: median-height filter":{GTcoverageAfterStage:ruleScore.GTcoverageAfterStage,falseCountAfterStage:ruleScore.falseCountAfterStage},
          "rowBandsFromTSV: minWords>=2 filter":{GTcoverageAfterStage:tsvScore.GTcoverageAfterStage,falseCountAfterStage:tsvScore.falseCountAfterStage},
          "mergeDynamicRows: TSV near-center dedupe":{GTcoverageAfterStage:preRangeScore.GTcoverageAfterStage,falseCountAfterStage:preRangeScore.falseCountAfterStage},
          "mergeDynamicRows: final center range 20%-96%":{GTcoverageAfterStage:finalScore.GTcoverageAfterStage,falseCountAfterStage:finalScore.falseCountAfterStage},
        };

        const pipelineStages=enrichStages([...ruleTrace.stages,...ruleRowsTrace.stages,...tsvTrace.stages,...mergeTrace.stages],scoreByStage);
        const finalSourceCounts={
          rules:mergeTrace.finalRows.filter((r)=>r.source==="rules").length,
          tsv:mergeTrace.finalRows.filter((r)=>r.source==="tsv").length,
        };

        images.push({
          fileName,
          inputGeometry:{
            rawWidth:color.rawWidth,rawHeight:color.rawHeight,
            candidateGeometryWidth:color.canvas.width,candidateGeometryHeight:color.canvas.height,
            autoRotate90CCW:color.rotate,
            dynamicPaperBBox:paper,
            dynamicPaperBBoxNormalized:normPaper(paper,color.canvas.width,color.canvas.height),
            paperDetectionState:paperTrace.state,
            paperDetectionTrace:paperTrace.trace || null,
            dimension:dim,
          },
          finalDynamicCandidateCount:mergeTrace.finalRows.length,
          pipelineStages,
          tsvPath:{invoked:true,intermediateCount:tsvTrace.tsvRows.length,finalCount:finalSourceCounts.tsv},
          beforeMerge:{rulesCandidateCount:ruleRowsTrace.ruleRows.length,tsvCandidateCount:tsvTrace.tsvRows.length,combinedInputCount:ruleRowsTrace.ruleRows.length+tsvTrace.tsvRows.length},
          finalSourceCounts,
          finalRows:finalScore.mapped,
        });
      }

      const stageNames=Array.from(new Set(images.flatMap((img)=>img.pipelineStages.map((s:any)=>s.stageName))));
      const aggregateStages=stageNames.map((stageName)=>{
        const rows=images.map((img)=>img.pipelineStages.find((s:any)=>s.stageName===stageName)).filter(Boolean);
        const scoreable=rows.some((s:any)=>s.GTcoverageAfterStage!=null);
        return {
          stageName,
          inputTotal:rows.reduce((sum:number,s:any)=>sum+s.inputCount,0),
          outputTotal:rows.reduce((sum:number,s:any)=>sum+s.outputCount,0),
          rejectedTotal:rows.reduce((sum:number,s:any)=>sum+s.rejectedCount,0),
          GTcoverageTotal:scoreable?rows.reduce((sum:number,s:any)=>sum+(s.GTcoverageAfterStage||0),0):null,
          falseTotal:scoreable?rows.reduce((sum:number,s:any)=>sum+(s.falseCountAfterStage||0),0):null,
        };
      });

      const summary={
        schema:"icb.parts-ocr.stage-a3-dynamic-pipeline-trace.v1",
        sourceHead:SOURCE_HEAD,
        traceSource:{dynamicRowsBlobSha:DYNAMIC_ROWS_BLOB_SHA,transferBlobSha:TRANSFER_BLOB_SHA,dynamicDiagnosticBlobSha:DYNAMIC_DIAGNOSTIC_BLOB_SHA},
        evaluationSet:"formal-yellow-12",
        gtTotalRows:54,
        traceOnly:true,
        images,
        aggregate:{stageTotals:aggregateStages,finalDynamicCandidateTotal:images.reduce((s,x)=>s+x.finalDynamicCandidateCount,0),finalSourceCounts:{rules:images.reduce((s,x)=>s+x.finalSourceCounts.rules,0),tsv:images.reduce((s,x)=>s+x.finalSourceCounts.tsv,0)}},
      };
      setResult(summary);
      setStatus("12/12 trace完了。総合管理用short summaryをコピーできます。");
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (worker) await worker.terminate().catch(()=>{});
      setBusy(false);
    }
  }

  function makeShortSummary() {
    if (!result) return null;
    return {
      schema:result.schema,
      sourceHead:result.sourceHead,
      traceSource:result.traceSource,
      evaluationSet:result.evaluationSet,
      gtTotalRows:result.gtTotalRows,
      traceOnly:true,
      images:result.images.map((img:any)=>({
        fileName:img.fileName,
        inputGeometry:img.inputGeometry,
        finalDynamicCandidateCount:img.finalDynamicCandidateCount,
        pipelineStages:img.pipelineStages,
        tsvPath:img.tsvPath,
        finalSourceCounts:img.finalSourceCounts,
        finalRows:img.finalRows.map((r:any)=>({candidateIndex:r.candidateIndex,source:r.source,y1Norm:r.y1Norm,y2Norm:r.y2Norm,centerYNorm:r.centerYNorm,heightNorm:r.heightNorm})),
      })),
      aggregate:result.aggregate,
    };
  }

  async function copySummary() {
    const summary=makeShortSummary();
    if (!summary) return;
    const text=JSON.stringify(summary,null,2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    setCopyState("コピーしました。総合管理チャットへそのまま貼り付けてください。");
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>Stage A3 Dynamic Pipeline Trace</h1>
        <p style={styles.text}>
          黄色正式12枚のdynamic row generatorをtrace-onlyで観察します。threshold・gap・height・merge・paper bbox等の条件は変更しません。
          GTはcandidate生成完了後のpost-hoc scoringにだけ使用し、OCR文字列・部品名・価格は出力しません。
        </p>
      </section>

      <section style={styles.card}>
        <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(e)=>run(e.target.files)} />
        <button style={styles.primary} disabled={busy} onClick={()=>inputRef.current?.click()}>
          {busy ? "Stage A3 trace中…" : "黄色正式12枚を選択してtrace"}
        </button>
        <div style={{marginTop:10,fontWeight:800,fontSize:14}}>{status}</div>
      </section>

      {result && (
        <>
          <section style={styles.card}>
            <button style={styles.primary} onClick={copySummary}>総合管理用short summaryをコピー</button>
            {copyState && <div style={{marginTop:8,color:"#1d6b32",fontWeight:800}}>{copyState}</div>}
          </section>
          <section style={styles.card}>
            <div style={{fontWeight:900,marginBottom:8}}>確認用summary preview</div>
            <pre style={styles.pre}>{JSON.stringify(makeShortSummary(),null,2)}</pre>
          </section>
        </>
      )}
    </main>
  );
}
