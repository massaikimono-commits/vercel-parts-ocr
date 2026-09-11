/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo,useRef,useState } from "react";
import corrected from "../../../evaluation/parts/yellow-documents.corrected.v2.json";
import manifest from "../../../evaluation/parts/yellow-regression-manifest.v2.json";
import type { StagePredictionExport } from "../../../app/ocr/diagnostic/corrected-rescore/prediction-export";

type Field="name"|"qty"|"retail"|"cost";
const FIELDS:Field[]=["name","qty","retail","cost"];
const GT_STORAGE="icb.parts-ocr.stage-a19.four-field-gt.v1";
const stageRoutes={A20:"/ocr/diagnostic/stage-a20",A21:"/ocr/diagnostic/stage-a21",A22:"/ocr/diagnostic/stage-a22"};
const norm=(value:unknown)=>String(value??"").normalize("NFKC").replace(/[￥¥,\s]/g,"").toUpperCase();
const captureMap=new Map((manifest.captures as any[]).map(c=>[c.imageId,c]));
const docs=(corrected.documents as Record<string,any[]>);
const gtFor=(imageId:string)=>(corrected.captureDocumentOrder as Record<string,string[]>)[imageId].flatMap(id=>docs[id]);

function legacyScoringMap(){return Object.fromEntries(Object.keys(corrected.captureDocumentOrder).map(imageId=>[`${imageId}(1)`,gtFor(imageId).map(row=>({name:row.partName,qty:row.qty,retail:row.retail,cost:row.cost}))]));}
function duplicateRows(rows:any[]){const seen=new Set<string>();let duplicates=0;for(const row of rows){const key=JSON.stringify(FIELDS.map(f=>norm(row.fields?.[f])));if(seen.has(key)&&key!==JSON.stringify(["","","",""]))duplicates++;seen.add(key);}return duplicates;}

function scoreImage(image:any,engine:string){
 const capture:any=captureMap.get(image.imageId),gt=gtFor(image.imageId),pred=image.engines?.[engine]?.rows||[];let correct=0,blank=0,wrong=0,completeRows=0;const byField:any=Object.fromEntries(FIELDS.map(f=>[f,{correct:0,total:gt.length}]));
 for(let i=0;i<gt.length;i++){const p=pred[i]?.fields||{},g=gt[i];let complete=true;for(const f of FIELDS){const gv=norm(f==="name"?g.partName:g[f]),pv=norm(p[f]);if(gv===pv&&gv){correct++;byField[f].correct++;}else{complete=false;if(!pv)blank++;else wrong++;}}if(complete)completeRows++;}
 const detected=pred.length,falseRows=Math.max(0,detected-gt.length),missedRows=Math.max(0,gt.length-detected),duplicates=duplicateRows(pred);
 return{imageId:image.imageId,captureId:capture.captureId,documentIds:capture.documentsInCapture.map((d:any)=>d.documentId),subset:capture.subset,expectedRows:gt.length,detectedRows:detected,rowRecall:gt.length?(gt.length-missedRows)/gt.length:0,falseRows,missedRows,duplicateRows:duplicates,fieldExactMatch:{correct,total:gt.length*4},byField,completeRows,documentComplete:completeRows===gt.length&&falseRows===0,captureComplete:completeRows===gt.length&&falseRows===0,blank,wrongField:wrong,abstain:"NOT AVAILABLE",timeout:"NOT AVAILABLE",processingTimeMs:image.engines?.[engine]?.processingTimeMs??"NOT AVAILABLE",error:image.engines?.[engine]?.error??null};
}

function aggregate(stage:string,engine:string,images:any[]){const scored=images.map(image=>scoreImage(image,engine));const subset=(name:string)=>{const rows=scored.filter(item=>item.subset===name),sum=(key:string)=>rows.reduce((n,item)=>n+Number((item as any)[key]||0),0),expected=sum("expectedRows"),fieldTotal=rows.reduce((n,item)=>n+item.fieldExactMatch.total,0),fieldCorrect=rows.reduce((n,item)=>n+item.fieldExactMatch.correct,0);return{subset:name,captureCount:rows.length,documentCount:new Set(rows.flatMap(item=>item.documentIds)).size,expectedRows:expected,detectedRows:sum("detectedRows"),rowRecall:expected?(expected-sum("missedRows"))/expected:0,falseRows:sum("falseRows"),duplicateRows:sum("duplicateRows"),fieldExactMatch:{correct:fieldCorrect,total:fieldTotal,rate:fieldTotal?fieldCorrect/fieldTotal:0},completeRows:sum("completeRows"),documentComplete:rows.filter(item=>item.documentComplete).length,captureComplete:rows.filter(item=>item.captureComplete).length,blank:sum("blank"),wrongField:sum("wrongField"),abstain:"NOT AVAILABLE",timeout:"NOT AVAILABLE",processingTimeMs:"PARTIALLY AVAILABLE",images:rows};};return{stage,engine,historicalResultRewritten:false,formal:false,gtRuntimeUse:false,gtScoringOnly:true,singleDocument:subset("SINGLE_DOCUMENT"),composite:subset("MULTI_DOCUMENT_COMPOSITE")};}

export default function CorrectedRescorePage(){
 const input=useRef<HTMLInputElement>(null),[exports,setExports]=useState<StagePredictionExport[]>([]),[status,setStatus]=useState("A20・A21・A22で保存したGTなしprediction JSONを選択してください。"),[result,setResult]=useState<any>(null);
 const stages=useMemo(()=>new Set(exports.map(item=>item.stage)),[exports]);
 async function load(files:FileList|null){if(!files)return;try{const parsed=await Promise.all(Array.from(files).map(async file=>JSON.parse(await file.text())));for(const payload of parsed){if(payload.schema!=="icb.parts-ocr.prediction-export.v2"||payload.gtIncluded!==false)throw new Error("prediction export v2以外、またはGT混入payloadです");}setExports(parsed);setResult(null);setStatus(`${parsed.length} prediction files読込：${parsed.map(p=>p.stage).join(", ")}`);}catch(error:any){setStatus(`STOP: ${String(error?.message||error)}`);}}
 function seed(){localStorage.setItem(GT_STORAGE,JSON.stringify(legacyScoringMap()));setStatus("corrected GTをscoring-only localStorageへ設定しました。OCR処理・候補生成・停止条件には参照されません。");}
 function run(){if(!stages.has("A20")||!stages.has("A21")||!stages.has("A22")){setStatus("STOP: A20・A21・A22の3 exportが必要です");return;}const reports=exports.flatMap(payload=>{const engines=[...new Set(payload.images.flatMap(image=>Object.keys(image.engines)))];return engines.map(engine=>aggregate(payload.stage,engine,payload.images));});const out={schema:"icb.parts-ocr.corrected-rescore-result.v2",timestamp:new Date().toISOString(),manifestVersion:manifest.schemaVersion,fixtureVersion:corrected.fixtureVersion,historicalResultsRewritten:false,formalAdoption:false,documentLevelUniqueRows:23,captureVisibleRows:60,reports};setResult(out);setStatus("corrected-v2採点完了。historical scoreとは別resultです。");}
 function save(){if(!result)return;const link=document.createElement("a"),blob=new Blob([JSON.stringify(result,null,2)],{type:"application/json"});link.href=URL.createObjectURL(blob);link.download=`parts-corrected-rescore-v2-${Date.now()}.json`;link.click();URL.revokeObjectURL(link.href);}
 return <main style={{maxWidth:980,margin:"0 auto",padding:16,fontFamily:"sans-serif"}}><h1>Parts OCR Corrected Re-score v2</h1><p>Evaluation-only。GTはこのrouteの採点層とA20のhistorical表示用scoring localStorageだけで参照し、OCR処理には渡しません。</p><section style={{padding:14,border:"1px solid #ccc",borderRadius:12}}><button onClick={seed}>1. Corrected scoring GTを端末へ設定</button><ol>{Object.entries(stageRoutes).map(([stage,href])=><li key={stage}><a href={href} target="_blank">{stage}評価routeを開く</a> → 画像選択 → 「GTなしprediction JSONを保存」</li>)}</ol><input ref={input} hidden multiple type="file" accept="application/json" onChange={e=>load(e.target.files)}/><button onClick={()=>input.current?.click()}>2. A20/A21/A22 prediction JSONを選択</button><button onClick={run} style={{marginLeft:8}} disabled={exports.length<3}>3. Corrected-v2再採点</button>{result&&<button onClick={save} style={{marginLeft:8}}>4. Result JSONを保存</button>}<p>{status}</p></section>{result&&<pre style={{whiteSpace:"pre-wrap",fontSize:11,maxHeight:700,overflow:"auto",background:"#f5f5f5",padding:12}}>{JSON.stringify(result,null,2)}</pre>}</main>;
}
