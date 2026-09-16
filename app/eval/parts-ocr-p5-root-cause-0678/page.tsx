/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState } from "react";
import scoringGt from "../../../evaluation/parts/yellow-documents.corrected.v2.json";
import { orientedCanvas } from "../../ocr/diagnostic/stage-a20/a19-table-crops";
import { loadFormalSet, P5_FORMAL_SET_MANIFEST_VERSION } from "../../ocr/bakeoff/p5-formal-set-idb";

type Field = "name" | "qty" | "retail" | "cost";
type Token = { text: string; x1: number; y1: number; x2: number; y2: number };
type DRow = { rowId: string; fields: Record<Field, string>; sourceTokenCount?: number };
const FIELDS: Field[] = ["name", "qty", "retail", "cost"];
const GT_FIELD = { name: "partName", qty: "qty", retail: "retail", cost: "cost" } as const;
const HEAD = process.env.NEXT_PUBLIC_EVAL_HEAD || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";

function canvasBlob(canvas: HTMLCanvasElement) { return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob failed")), "image/jpeg", .96)); }
function parseTsv(tsv: string): Token[] { const lines = String(tsv || "").split(/\r?\n/).filter(Boolean); if (lines.length < 2) return []; const h = lines[0].split("\t"); const ix = Object.fromEntries(h.map((v, i) => [v, i])); if (["level","left","top","width","height","text"].some((k) => ix[k] === undefined)) return []; return lines.slice(1).flatMap((line) => { const c = line.split("\t"); if (Number(c[ix.level]) !== 5) return []; const text = String(c[ix.text] ?? "").trim(); const x1=Number(c[ix.left]), y1=Number(c[ix.top]), w=Number(c[ix.width]), hgt=Number(c[ix.height]); return text && [x1,y1,w,hgt].every(Number.isFinite) && w>0 && hgt>0 ? [{text,x1,y1,x2:x1+w,y2:y1+hgt}] : []; }); }
function parseBlocks(blocks: any): Token[] { if (!Array.isArray(blocks)) return []; const out: Token[]=[]; for (const b of blocks) for (const p of b?.paragraphs ?? []) for (const l of p?.lines ?? []) for (const w of l?.words ?? []) { const text=String(w?.text ?? "").trim(), bb=w?.bbox; const x1=Number(bb?.x0),y1=Number(bb?.y0),x2=Number(bb?.x1),y2=Number(bb?.y1); if(text&&[x1,y1,x2,y2].every(Number.isFinite)&&x2>x1&&y2>y1) out.push({text,x1,y1,x2,y2}); } return out; }
function normName(v: unknown) { return String(v ?? "").normalize("NFKC").replace(/\s+/g," ").trim(); }
function normNumber(v: unknown) { let s=String(v ?? "").normalize("NFKC").trim().replace(/[￥¥円,，\s]/g,""); if(!s)return ""; if(!/^[+-]?\d+(?:\.\d+)?$/.test(s))return s; const sign=s.startsWith("-")?"-":""; s=s.replace(/^[+-]/,""); let [i,f=""]=s.split("."); i=i.replace(/^0+(?=\d)/,"")||"0"; f=f.replace(/0+$/,""); return `${sign}${i}${f?`.${f}`:""}`; }
function norm(field: Field,v: unknown){return field==="name"?normName(v):normNumber(v)}
function expectedRows(){ const order=(scoringGt.captureDocumentOrder as Record<string,string[]>)["IMG_0678"]??[]; const docs=scoringGt.documents as Record<string,any[]>; return order.flatMap((id)=>docs[id]??[]); }
function fieldMask(gt:any,row:DRow){return Object.fromEntries(FIELDS.map((f)=>[f,Boolean(norm(f,row.fields[f]))&&norm(f,row.fields[f])===norm(f,gt?.[GT_FIELD[f]]??"")])) as Record<Field,boolean>}
function copyText(text:string){ if(navigator.clipboard?.writeText&&window.isSecureContext)return navigator.clipboard.writeText(text); const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();return Promise.resolve(); }

export default function Page(){
 const [status,setStatus]=useState("READY"); const [result,setResult]=useState<any>(null); const [copied,setCopied]=useState(false);
 const pretty=useMemo(()=>result?JSON.stringify(result,null,2):"",[result]);
 async function run(){ setStatus("RUNNING"); setCopied(false); try{
  const stored=await loadFormalSet(); const rec=stored.find((x)=>x.manifestVersion===P5_FORMAL_SET_MANIFEST_VERSION&&x.imageId==="IMG_0678"); if(!rec) throw new Error("正式12枚の端末内保存から対象を取得できません。正式12枚を再登録してください。");
  const file=new File([rec.blob],rec.filename,{type:rec.mimeType||rec.blob.type||"image/jpeg"}); const source=await orientedCanvas(file,2200); const blob=await canvasBlob(source.canvas);
  const tess:any=await import("tesseract.js"); const semantic:any=await import("../../ocr/bakeoff/p5-semantic-candidates.mjs"); const worker=await tess.createWorker("jpn+eng",1); let tokens:Token[]=[]; let elapsed=0;
  try{await worker.setParameters({preserve_interword_spaces:"1",user_defined_dpi:"300",tessedit_char_whitelist:"",tessedit_pageseg_mode:tess.PSM?.SINGLE_BLOCK??"6"}); const t0=performance.now(); const recognized=await worker.recognize(blob,{}, {text:true,blocks:true,layoutBlocks:false,hocr:false,tsv:true,box:false,unlv:false,osd:false,pdf:false,imageColor:false,imageGrey:false,imageBinary:false,debug:false}); elapsed=Math.round(performance.now()-t0); const data=recognized?.data??{}; const tsv=parseTsv(typeof data.tsv==="string"?data.tsv:""); const blocks=parseBlocks(data.blocks); tokens=tsv.length?tsv:blocks;} finally {await worker.terminate().catch(()=>undefined)}
  const variants=semantic.compareSemanticMappingCandidates(tokens); const d=variants.find((v:any)=>v.variantId==="D_PARTIAL_HEADER_COLUMN_LATTICE"); if(!d) throw new Error("D candidate unavailable"); const rows:DRow[]=d.rows??[]; const gt=expectedRows();
  const rowDetails=rows.map((row,index)=>{const mask=gt[index]?fieldMask(gt[index],row):{name:false,qty:false,retail:false,cost:false}; const nonEmpty=FIELDS.filter((f)=>Boolean(norm(f,row.fields[f]))); return {predRowIndex:index,yOrder:index,sourceRowId:row.rowId,assignedTokenCount:row.sourceTokenCount??0,emptyNonEmptyMask:Object.fromEntries(FIELDS.map((f)=>[f,nonEmpty.includes(f)])),rowGeometryVerdict: rows.length===gt.length?"ORDER_COUNT_PLAUSIBLE":"COUNT_OR_ORDER_SUSPECT",columnAssignmentVerdict: nonEmpty.length>=2?"MULTI_COLUMN_ASSIGNED":"SPARSE_ASSIGNMENT",tokenRecognitionVerdict:Object.values(mask).some(Boolean)?"AT_LEAST_ONE_GT_FIELD_EXACT":"NO_GT_FIELD_EXACT"};});
  const exactCounts=Object.fromEntries(FIELDS.map((f)=>[f,rows.reduce((n,row,i)=>n+(gt[i]&&fieldMask(gt[i],row)[f]?1:0),0)])); const geometryUsable=rows.length===gt.length&&rows.length>0; const anyFieldExact=Object.values(exactCounts).some((v:any)=>v>0); const multiColumnRows=rowDetails.filter((r)=>r.columnAssignmentVerdict==="MULTI_COLUMN_ASSIGNED").length; const columnUsable=multiColumnRows>=Math.ceil(Math.max(1,rows.length)/2); const tokenUsable=anyFieldExact;
  let rootCause="E"; if(!geometryUsable) rootCause="A"; else if(!columnUsable) rootCause="B"; else if(!tokenUsable) rootCause="C"; else if(rows.length===gt.length&&multiColumnRows===0) rootCause="D";
  const potential=rootCause==="C"?"RETAIN":rootCause==="E"?"HOLD":rootCause==="B"?"RETAIN":"HOLD";
  const nextAction=rootCause==="A"?"Inspect row geometry only; no tuning in this run":rootCause==="B"?"Inspect generalized column assignment evidence; no tuning in this run":rootCause==="C"?"Token recognition quality is dominant; evaluate recognition architecture before semantic tuning":rootCause==="D"?"Inspect table-region/header-footer discrimination; no tuning in this run":"Separate mixed geometry/column/token evidence before any candidate change";
  setResult({schema:"icb.parts-ocr.p5-0678-d-root-cause-short.v1",evaluationHead:HEAD,imageId:"IMG_0678",variant:"D_PARTIAL_HEADER_COLUMN_LATTICE",psm:6,pageOcrTokenCount:tokens.length,reconstructedRowCount:rows.length,gtRowCountScoringOnly:gt.length,processingTimeMs:elapsed,fieldExactCounts:exactCounts,rows:rowDetails,rootCause,rowGeometryUsable:geometryUsable,columnAssignmentUsable:columnUsable,tokenRecognitionUsable:tokenUsable,P5ArchitecturePotential:potential,nextAction,wrongAutoConfirm:0,gtRuntimeUsed:false,productionChanged:false}); setStatus("DONE — STOP");
 }catch(e:any){setStatus(`ERROR: ${e?.message??String(e)}`)} }
 return <main style={{maxWidth:900,margin:"0 auto",padding:20,fontFamily:"system-ui"}}><h1>P5 0678-D Root Cause Diagnostic</h1><p>正式12枚の端末内保存から対象を自動取得します。個別画像選択は不要です。</p><p><b>Status:</b> {status}</p><button onClick={run} disabled={status==="RUNNING"} style={{padding:"12px 18px",fontSize:16}}>自動診断開始</button>{result&&<><p style={{marginTop:18}}><button onClick={async()=>{await copyText(pretty);setCopied(true)}} style={{padding:"12px 18px",fontSize:16}}>総合管理用結果をコピー</button> {copied?"コピーしました":""}</p><pre style={{whiteSpace:"pre-wrap",fontSize:12,background:"#f4f4f4",padding:12,borderRadius:8}}>{pretty}</pre></>}</main>
}
