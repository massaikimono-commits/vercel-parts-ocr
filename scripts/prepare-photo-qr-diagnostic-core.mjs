import fs from "node:fs";
import crypto from "node:crypto";

const pagePath = "app/eval/certificate-qr-decode-experiment/page.jsx";
const corePath = "app/eval/certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated.js";
const manifestPath = ".photo-qr-core-manifest.json";

const source = fs.readFileSync(pagePath, "utf8");
const marker = "async function runMatrix(file)";
const componentMarker = "export default function CertificateQrDecodeExperimentPage()";

function functionBlock(text, startToken) {
  const start = text.indexOf(startToken);
  if (start < 0) throw new Error(`missing token: ${startToken}`);
  const brace = text.indexOf("{", start);
  if (brace < 0) throw new Error(`missing opening brace: ${startToken}`);
  let depth = 0;
  let quote = null;
  let templateDepth = 0;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (quote === "`" && ch === "$" && next === "{") { templateDepth += 1; i += 1; depth += 1; continue; }
      if (quote === "`" && ch === "}" && templateDepth > 0) { templateDepth -= 1; depth -= 1; continue; }
      if (ch === quote && templateDepth === 0) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") { depth -= 1; if (depth === 0) return { start, end: i + 1, text: text.slice(start, i + 1) }; }
  }
  throw new Error(`unterminated function: ${startToken}`);
}

const componentIndex = source.indexOf(componentMarker);
if (componentIndex < 0) throw new Error("diagnostic page component marker missing");
const constantsIndex = source.indexOf("const REQUIRED_NAMES");
if (constantsIndex < 0) throw new Error("diagnostic core start missing");
const run = functionBlock(source, marker);
const coreBody = source.slice(constantsIndex, componentIndex);
const exportedBody = coreBody.replace(marker, "export async function runPhotoQrDiagnostic(file)");
if (exportedBody === coreBody) throw new Error("runMatrix export rewrite failed");

const a21 = String.raw`
function a21AttemptEvidence(rows, attemptKey) {
  const out=[];
  for(const row of rows||[]) for(const attempt of row?.[attemptKey]||[]) {
    const pairs=[
      ["jsqr",attempt.jsCanonical,attempt.jsRawPosition,attempt.jsStructuralPass],
      ["zxing",attempt.zxingCanonical,attempt.zxingRawPosition,attempt.zxingStructuralPass],
    ];
    for(const [engine,canonical,position,structuralPass] of pairs){
      if(!canonical||!structuralPass||!position) continue;
      out.push({candidateIndex:row.candidateIndex,engine,canonical,position,configId:attempt.configId});
    }
  }
  return out;
}
function a21ClusterEvidence(evidence,radius,geometryDiagnostics){
  const clusters=[];
  for(const item of evidence){
    let c=clusters.find((known)=>Math.hypot(known.x-item.position.x,known.y-item.position.y)<=radius);
    if(!c){ c={x:item.position.x,y:item.position.y,items:[],canonicalCounts:new Map(),candidateIndexes:new Set()}; clusters.push(c); }
    const n=c.items.length; c.x=(c.x*n+item.position.x)/(n+1); c.y=(c.y*n+item.position.y)/(n+1); c.items.push(item);
    c.canonicalCounts.set(item.canonical,(c.canonicalCounts.get(item.canonical)||0)+1); c.candidateIndexes.add(item.candidateIndex);
  }
  return clusters.map((c,index)=>{
    const ranked=[...c.canonicalCounts.entries()].sort((a,b)=>b[1]-a[1]);
    const dominant=ranked[0]||[null,0], second=ranked[1]||[null,0];
    const geometryAligned=(geometryDiagnostics||[]).some((g)=>g?.qrCenter&&g.geometryValid&&!g.overlapRejected&&Math.hypot(Number(g.qrCenter.x)-c.x,Number(g.qrCenter.y)-c.y)<=radius*1.7);
    const mixed=ranked.length>1&&second[1]>0;
    return {clusterId:index+1,x:c.x,y:c.y,evidenceCount:c.items.length,engineCount:new Set(c.items.map(x=>x.engine)).size,candidateIndexes:[...c.candidateIndexes],dominantCanonical:dominant[0],dominantEvidence:dominant[1],secondEvidence:second[1],geometryAligned,mixed};
  });
}
function a21RecoveredAttributions(items,radius){
  let duplicateInflation=0;
  for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){
    if(items[i].canonical===items[j].canonical) continue;
    if(items[i].position&&items[j].position&&Math.hypot(items[i].position.x-items[j].position.x,items[i].position.y-items[j].position.y)<=radius) duplicateInflation++;
  }
  return duplicateInflation;
}
async function a21PrepareBase(file){
  const raw=await sourceCanvas(file);
  const normalized=normalizeCertificateCanvas(raw,1800);
  const norm=normalized.canvas;
  const normCtx=norm.getContext("2d",{willReadFrequently:true});
  const normImage=normCtx.getImageData(0,0,norm.width,norm.height);
  const paperW=paperWidthPx(normalized.paper,raw);
  const rawCandidates=detectCertificateQrDensityCandidates2D(normImage.data,normImage.width,normImage.height,{maxCandidates:20});
  const coarse=clusterCertificateQrCandidates2D(rawCandidates,{maxCandidates:10,xTolerance:.030,rowTolerance:.060});
  const [readerBundle,jsMod]=await Promise.all([makeReader(),import("jsqr")]);
  const jsQR=jsMod.default||jsMod;
  const current=await runAdaptiveRows({candidates:coarse.candidates,configs:ENSEMBLE_CONFIGS,jsQR,reader:readerBundle.reader,raw,normalized,successKey:"currentSuccess",attemptKey:"currentAttempts"});
  const compactA=compactConsensusAuditFromRows(current.rows,"currentAttempts",paperW);
  const compactSkipIndexes=new Set(compactA.diagnostics.filter(x=>x.physicalQrConsensusAccepted).map(x=>x.candidateIndex));
  const geometry=await runGeometryFailOnly({current,raw,normalized,jsQR,reader:readerBundle.reader,physicalConsensusSkipCandidateIndexes:compactSkipIndexes});
  const compactE=compactConsensusAuditFromRows(geometry.rows,"geometryAttempts",paperW);
  const aConflict=resolvePositionConflicts(current.rows,"currentAttempts",paperW,geometry.diagnostics);
  const eConflict=resolvePositionConflicts(geometry.rows,"geometryAttempts",paperW,geometry.diagnostics);
  const aStructural=canonicalSetFromRows(current.rows,"currentSuccess");
  const eStructural=canonicalSetFromRows(geometry.rows,"geometrySuccess");
  const currentFinal=unionCanonicalSets(aStructural,eStructural,compactA.acceptedCanonicalSet,compactE.acceptedCanonicalSet,aConflict.resolvedCanonicalSet,eConflict.resolvedCanonicalSet);
  return {raw,normalized,norm,paperW,jsQR,reader:readerBundle.reader,current,geometry,currentFinal};
}
function a21Result(id,currentCount,recovered,runtimeMs,duplicateInflation,reasonCounts={}){
  const unique=new Map();
  for(const item of recovered||[]) if(item?.canonical&&!unique.has(item.canonical)) unique.set(item.canonical,item);
  const rows=[...unique.values()];
  return {id,physicalUniqueQrCount:currentCount+rows.length,netNewCanonicalQrCount:rows.length,lostCurrentQrCount:0,duplicateInflationCount:duplicateInflation||0,countingIntegrityFail:false,runtimeMs,candidateAttribution:rows.map(({canonical,...rest})=>rest),recoveredCandidateReasonCounts:reasonCounts};
}
export async function runPhotoQrA21Counterfactual(file){
  const totalStarted=performance.now();
  const base=await a21PrepareBase(file);
  const currentCount=base.currentFinal.size;
  const radius=Math.max(8,base.paperW*.018);
  try{
    const aStarted=performance.now();
    const evidence=[...a21AttemptEvidence(base.current.rows,"currentAttempts"),...a21AttemptEvidence(base.geometry.rows,"geometryAttempts")];
    const clusters=a21ClusterEvidence(evidence,radius,base.geometry.diagnostics);
    const aRecovered=[];
    for(const c of clusters){
      const stable=!c.mixed&&c.dominantCanonical&&(c.engineCount>=2||c.dominantEvidence>=2||c.geometryAligned);
      if(stable&&!base.currentFinal.has(c.dominantCanonical)) aRecovered.push({canonical:c.dominantCanonical,position:{x:c.x,y:c.y},candidateIndexes:c.candidateIndexes,reason:"stable-physical-position-cluster",evidenceCount:c.evidenceCount,geometryAligned:c.geometryAligned});
    }
    const a=a21Result("A_PHYSICAL_SEPARATION",currentCount,aRecovered,Math.round(performance.now()-aStarted),a21RecoveredAttributions(aRecovered,radius),{stablePhysicalPositionCluster:aRecovered.length});

    const bStarted=performance.now();
    const bRecovered=[];
    for(const g of base.geometry.diagnostics||[]){
      if(g.skippedBecauseASuccess||g.overlapRejected) continue;
      for(const t of g.tripletDiagnostics||[]){
        if(t.geometryValid) continue;
        if(!["quad-too-small","quad-side-spread-too-large"].includes(t.rejectedReason)) continue;
        const modulePx=Number(t.modulePx||0), dimension=Number(t.qrDimension||0);
        const side=quadSideMetricsFromDiagnostic(t.qrQuad||[]);
        if(!modulePx||!dimension||!side) continue;
        const minSideModules=side.minSidePx/modulePx;
        const sideRatio=minSideModules/dimension;
        const areaRatio=(side.areaPx2/(modulePx*modulePx))/(dimension*dimension);
        const normalizedConsistent=sideRatio>=.65&&sideRatio<=1.35&&areaRatio>=.42&&areaRatio<=1.85&&Number(t.perspectiveScaleSpread||side.perspectiveScaleSpread||1)<=2.5;
        if(!normalizedConsistent) continue;
        const geometry={geometryValid:true,qrQuad:t.qrQuad,quietQuad:t.quietQuad,qrDimension:dimension,modulePx,perspectiveScaleSpread:Number(t.perspectiveScaleSpread||0)};
        const canvas=rectifyQrGeometry(base.raw,geometry,{id:"a21-normalized-quad",outputScale:1,sampling:"bilinear"});
        if(!canvas) continue;
        try{
          const result=await decodeCanvasPair({jsQR:base.jsQR,reader:base.reader,canvas});
          for(const canonical of unionCanonicalSets(result.canonicalSet,result.compactCanonicalSet)) if(canonical&&!base.currentFinal.has(canonical)) bRecovered.push({canonical,position:g.qrCenter||null,candidateIndex:g.candidateIndex,tripletRank:t.rank,reason:"normalized-quad-counterfactual",sideToDimensionRatio:Number(sideRatio.toFixed(4)),areaToDimensionSquaredRatio:Number(areaRatio.toFixed(4))});
        } finally { canvas.width=1; canvas.height=1; }
      }
    }
    const b=a21Result("B_NORMALIZED_QUAD",currentCount,bRecovered,Math.round(performance.now()-bStarted),a21RecoveredAttributions(bRecovered,radius),{normalizedQuadDecodeRecovery:bRecovered.length});

    const cStarted=performance.now();
    const cRecovered=[];
    const eByIndex=new Map((base.geometry.rows||[]).map(x=>[x.candidateIndex,x]));
    for(const g of base.geometry.diagnostics||[]){
      if(!g.geometryValid||g.overlapRejected||g.skippedBecauseASuccess) continue;
      const eRow=eByIndex.get(g.candidateIndex);
      if(eRow?.geometrySuccess) continue;
      const variants=[
        {id:"native-nearest",outputScale:1,sampling:"nearest"},
        {id:"module-scale-1.5-nearest",outputScale:1.5,sampling:"nearest"},
        {id:"module-scale-1.5-bilinear",outputScale:1.5,sampling:"bilinear"},
        {id:"module-scale-2-nearest",outputScale:2,sampling:"nearest"},
      ];
      for(const config of variants){
        const canvas=rectifyQrGeometry(base.raw,g,config);
        if(!canvas) continue;
        try{
          const result=await decodeCanvasPair({jsQR:base.jsQR,reader:base.reader,canvas});
          const recovered=unionCanonicalSets(result.canonicalSet,result.compactCanonicalSet);
          let got=false;
          for(const canonical of recovered) if(canonical&&!base.currentFinal.has(canonical)) { cRecovered.push({canonical,position:g.qrCenter||null,candidateIndex:g.candidateIndex,reason:"rectified-recovery",variantId:config.id,modulePx:Number(g.modulePx||0)||null}); got=true; }
          if(got) break;
        } finally { canvas.width=1; canvas.height=1; }
      }
    }
    const c=a21Result("C_RECTIFIED_RECOVERY",currentCount,cRecovered,Math.round(performance.now()-cStarted),a21RecoveredAttributions(cRecovered,radius),{rectifiedRecovery:cRecovered.length});
    return {current:{id:"CURRENT",physicalUniqueQrCount:currentCount,netNewCanonicalQrCount:0,lostCurrentQrCount:0,duplicateInflationCount:0,countingIntegrityFail:false,runtimeMs:Number(base.current?.totalAttempts||0)},a,b,c,totalCounterfactualRuntimeMs:Math.round(performance.now()-totalStarted),gtUsedDuringDecode:false,formalDecodeLogicChanged:false};
  } finally { base.raw.width=1;base.raw.height=1;base.norm.width=1;base.norm.height=1; }
}
`;

const core = `\"use client\";\n\nimport { normalizeCertificateCanvas, expectedCertificateQrCount } from \"../../lib/certificate-photo-normalize\";\nimport { detectCertificateQrDensityCandidates2D, clusterCertificateQrCandidates2D } from \"../../lib/certificate-qr-density-2d.mjs\";\n\n// GENERATED at build from the frozen diagnostic implementation in page.jsx.\n// Do not hand-edit. Recognition/decode/control logic is byte-derived from runMatrix.\n${exportedBody}\n${a21}`;
fs.writeFileSync(corePath, core);

const densityImport = 'import { detectCertificateQrDensityCandidates2D, clusterCertificateQrCandidates2D } from "../../lib/certificate-qr-density-2d.mjs";';
if (!source.includes(densityImport)) throw new Error("density import marker missing");
const sharedImport = 'import { runPhotoQrDiagnostic } from "./photo-qr-diagnostic-core.generated";';
let rewritten = source.includes(sharedImport) ? source : source.replace(densityImport, `${densityImport}\n${sharedImport}`);
const runAfterImport = functionBlock(rewritten, marker);
rewritten = rewritten.slice(0, runAfterImport.start) + "const runMatrix = runPhotoQrDiagnostic;" + rewritten.slice(runAfterImport.end);
fs.writeFileSync(pagePath, rewritten);

const normalize = (value) => value.replace("async function runMatrix(file)", "async function CORE(file)").replace("export async function runPhotoQrDiagnostic(file)", "async function CORE(file)").replace(/\r\n/g, "\n").trim();
const generatedRun = functionBlock(core, "export async function runPhotoQrDiagnostic(file)").text;
const sourceHash = crypto.createHash("sha256").update(normalize(run.text)).digest("hex");
const generatedHash = crypto.createHash("sha256").update(normalize(generatedRun)).digest("hex");
if (sourceHash !== generatedHash) throw new Error("shared diagnostic core identity mismatch");

fs.writeFileSync(manifestPath, JSON.stringify({sourcePage:pagePath,generatedCore:corePath,sourceRunMatrixSha256:sourceHash,generatedRunnerSha256:generatedHash,identical:true,pageUsesSharedRunner:rewritten.includes(sharedImport)&&rewritten.includes("const runMatrix = runPhotoQrDiagnostic;"),recognitionLogicChanged:false,formalAlgorithmChanged:false,stageA21CounterfactualRunner:true},null,2));
console.log(`Photo QR shared core prepared: ${sourceHash}`);
