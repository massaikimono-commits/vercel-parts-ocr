/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef, useState } from "react";
import { saveOCRTransferImage } from "../../../transfer";
import { analyzeGuidedFrame, canvasToFile, perspectiveCorrect, type FrameMetrics, type Quad } from "./acquisition";

type PartRow = { name: string; qty: string; retail: string; cost: string };
type EvalSummary = {
  rows: number; fieldTotal: number; fieldCorrect: number; fieldAccuracy: number;
  completeRows: number; completeRowRate: number; misreadFields: number; blankFields: number; falseRows: number;
  byField: Record<string,{ correct:number; total:number; accuracy:number }>;
};

const PHOTO_TIME_KEY = "parts-poc-photo-start";
const LIVE_TIME_KEY = "parts-poc-live-start";
const LIVE_METRICS_KEY = "parts-poc-live-metrics";

const styles: Record<string, React.CSSProperties> = {
  page:{maxWidth:980,margin:"0 auto",padding:"14px 12px 60px",background:"#f5f7fb",minHeight:"100vh",color:"#172033"},
  card:{background:"#fff",border:"1px solid #dbe2ec",borderRadius:16,padding:14,marginBottom:12},
  primary:{width:"100%",border:0,borderRadius:13,padding:"14px 12px",background:"#2468df",color:"#fff",fontWeight:800,fontSize:17,marginTop:8},
  secondary:{width:"100%",border:"1px solid #cfd8e6",borderRadius:13,padding:"12px",background:"#fff",color:"#2459a8",fontWeight:800,fontSize:15,marginTop:8},
  textarea:{width:"100%",minHeight:120,boxSizing:"border-box",border:"1px solid #ccd5e3",borderRadius:10,padding:9,fontSize:13},
};

function videoCanvas(video: HTMLVideoElement, maxSide=1280) {
  const w0=video.videoWidth||1280,h0=video.videoHeight||720; const s=Math.min(1,maxSide/Math.max(w0,h0));
  const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(w0*s)); c.height=Math.max(1,Math.round(h0*s));
  const ctx=c.getContext("2d"); if(!ctx) throw new Error("canvas unavailable"); ctx.drawImage(video,0,0,c.width,c.height); return c;
}

function scaleQuad(q: Quad, fromW:number, fromH:number, toW:number, toH:number): Quad {
  const sx=toW/fromW, sy=toH/fromH; const p=(v:any)=>({x:v.x*sx,y:v.y*sy}); return {tl:p(q.tl),tr:p(q.tr),br:p(q.br),bl:p(q.bl)};
}

function parseRows(text:string): PartRow[] {
  return text.split(/\n+/).map((line)=>line.trim()).filter(Boolean).map((line)=>{
    const c=line.split("\t"); return {name:(c[0]||"").trim(),qty:(c[1]||"").trim(),retail:(c[2]||"").trim(),cost:(c[3]||"").trim()};
  });
}
function norm(v:string){return v.normalize("NFKC").replace(/[￥¥,\s]/g,"").trim().toUpperCase();}
function evaluate(gt:PartRow[], pred:PartRow[]): EvalSummary {
  const fields:[keyof PartRow,string][]=[["name","name"],["qty","qty"],["retail","retail"],["cost","cost"]];
  const byField:any={}; fields.forEach(([,n])=>byField[n]={correct:0,total:gt.length,accuracy:0});
  let fieldCorrect=0,misread=0,blank=0,complete=0;
  for(let i=0;i<gt.length;i++){
    let rowOk=true; const p=pred[i]||{name:"",qty:"",retail:"",cost:""};
    for(const [k,n] of fields){ const a=norm(gt[i][k]),b=norm(p[k]); if(a===b&&a!==""){fieldCorrect++;byField[n].correct++;} else {rowOk=false;if(!b) blank++;else misread++;} }
    if(rowOk) complete++;
  }
  for(const [,n] of fields) byField[n].accuracy=gt.length?byField[n].correct/gt.length:0;
  const total=gt.length*4; return {rows:gt.length,fieldTotal:total,fieldCorrect,fieldAccuracy:total?fieldCorrect/total:0,completeRows:complete,completeRowRate:gt.length?complete/gt.length:0,misreadFields:misread,blankFields:blank,falseRows:Math.max(0,pred.length-gt.length),byField};
}

export default function GuidedLivePartsPocPage(){
  const videoRef=useRef<HTMLVideoElement>(null); const streamRef=useRef<MediaStream|null>(null); const loopRef=useRef<number|null>(null);
  const bestRef=useRef<{score:number;dataUrl:string;metrics:FrameMetrics;width:number;height:number}|null>(null); const prevQuadRef=useRef<Quad|null>(null);
  const [running,setRunning]=useState(false); const [metrics,setMetrics]=useState<FrameMetrics|null>(null); const [bestScore,setBestScore]=useState(0); const [liveReady,setLiveReady]=useState(false); const [message,setMessage]=useState("PhotoとGuided Liveを同じ既存OCRへ渡して比較します。");
  const [gt,setGt]=useState(""); const [photoOut,setPhotoOut]=useState(""); const [liveOut,setLiveOut]=useState(""); const [photoMs,setPhotoMs]=useState(0); const [liveMs,setLiveMs]=useState(0);

  useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop()); if(loopRef.current) cancelAnimationFrame(loopRef.current);},[]);

  async function startLive(){
    streamRef.current?.getTracks().forEach(t=>t.stop());
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});
    streamRef.current=stream; if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();}
    bestRef.current=null;prevQuadRef.current=null;setBestScore(0);setLiveReady(false);setRunning(true);sessionStorage.setItem(LIVE_TIME_KEY,String(performance.now()));
    const tick=()=>{ const v=videoRef.current; if(!v||!streamRef.current) return; if(v.videoWidth>0){ const c=videoCanvas(v,960); const m=analyzeGuidedFrame(c,prevQuadRef.current); prevQuadRef.current=m.quad; setMetrics(m); if(m.quad&&m.score>(bestRef.current?.score||0)){ bestRef.current={score:m.score,dataUrl:c.toDataURL("image/jpeg",.93),metrics:m,width:c.width,height:c.height}; setBestScore(m.score); if(m.eligible) setLiveReady(true);} } loopRef.current=requestAnimationFrame(tick);}; tick();
  }

  async function useBestLive(){
    const best=bestRef.current; if(!best||!best.metrics.quad){setMessage("まだ伝票を安定検出できていません。");return;}
    const img=new Image(); img.src=best.dataUrl; await img.decode(); const src=document.createElement("canvas");src.width=img.naturalWidth;src.height=img.naturalHeight;src.getContext("2d")!.drawImage(img,0,0);
    const corrected=perspectiveCorrect(src,best.metrics.quad,1800); const file=await canvasToFile(corrected,"guided-live-yellow.jpg");
    sessionStorage.setItem(LIVE_METRICS_KEY,JSON.stringify(best.metrics)); await saveOCRTransferImage(file); const start=Number(sessionStorage.getItem(LIVE_TIME_KEY)||performance.now()); setLiveMs(Math.max(0,Math.round(performance.now()-start))); setMessage("Guided Liveのbest frameを補正し、既存OCRへ渡しました。"); location.assign("/ocr/auto");
  }

  async function usePhoto(file:File|null){ if(!file)return; sessionStorage.setItem(PHOTO_TIME_KEY,String(performance.now())); await saveOCRTransferImage(file); setPhotoMs(0); location.assign("/ocr/auto"); }

  const gtRows=parseRows(gt), photoRows=parseRows(photoOut), liveRows=parseRows(liveOut); const photoEval=evaluate(gtRows,photoRows),liveEval=evaluate(gtRows,liveRows);
  const pct=(v:number)=>(v*100).toFixed(1)+"%";

  return <main style={styles.page}>
    <section style={styles.card}><h1 style={{margin:0}}>Guided Live Parts Scan PoC</h1><p style={{lineHeight:1.6,color:"#5b6678"}}>取得層だけのPoCです。OCR engine / PSM / 4項目抽出ロジックは変更しません。</p></section>

    <section style={styles.card}><h2 style={{marginTop:0}}>A. 現在のPhoto方式</h2><input type="file" accept="image/*" onChange={(e)=>usePhoto(e.target.files?.[0]||null)}/><p style={{fontSize:13,color:"#667085"}}>同じ物理伝票を通常の写真として選び、既存OCRへ渡します。</p></section>

    <section style={styles.card}><h2 style={{marginTop:0}}>B. Guided Live方式</h2><div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#111",aspectRatio:"16/9"}}><video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover"}}/><div style={{position:"absolute",left:"8%",right:"8%",top:"17%",bottom:"17%",border:"3px solid #ffd34d",borderRadius:10,pointerEvents:"none"}}/></div><button style={styles.primary} onClick={startLive}>{running?"カメラを再開始":"Live camera開始"}</button><button style={styles.secondary} onClick={useBestLive} disabled={!bestRef.current}>best frameを既存OCRへ送る</button>
    <div style={{fontSize:13,lineHeight:1.7,marginTop:10}}>{metrics?<><b>現在score:</b> {metrics.score.toFixed(1)} / <b>best:</b> {bestScore.toFixed(1)} / <b>eligible:</b> {metrics.eligible?"YES":"NO"}<br/>coverage {(metrics.coverage*100).toFixed(1)}% / tilt {metrics.tiltDeg.toFixed(1)}° / perspective {(metrics.perspectiveDistortion*100).toFixed(1)}% / sharpness {metrics.sharpness.toFixed(0)} / brightness {metrics.brightness.toFixed(0)} / glare {(metrics.glareRatio*100).toFixed(1)}% / stability {metrics.stability==null?"-":metrics.stability.toFixed(4)}</>:"カメラ開始後に入力品質を表示します。"}</div>{liveReady&&<div style={{marginTop:8,padding:8,background:"#eaf8ef",borderRadius:9}}>高品質frame候補を取得済み</div>}</section>

    <section style={styles.card}><h2 style={{marginTop:0}}>Photo vs Live 4項目評価</h2><p style={{fontSize:13,color:"#667085"}}>1行=1部品、列はタブ区切りで「部品名称 / 個数 / 定価 / 仕入れ」。GTは実際の伝票印字から入力し、OCR結果を見て作らない。</p>
      <h3>Ground Truth</h3><textarea style={styles.textarea} value={gt} onChange={e=>setGt(e.target.value)} placeholder={'例\nブレーキパッド\t1\t12000\t8000'}/>
      <h3>Photo OCR結果</h3><textarea style={styles.textarea} value={photoOut} onChange={e=>setPhotoOut(e.target.value)}/>
      <h3>Guided Live OCR結果</h3><textarea style={styles.textarea} value={liveOut} onChange={e=>setLiveOut(e.target.value)}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12}}><div><b>Photo</b><br/>名称 {pct(photoEval.byField.name.accuracy)} / 個数 {pct(photoEval.byField.qty.accuracy)} / 定価 {pct(photoEval.byField.retail.accuracy)} / 仕入れ {pct(photoEval.byField.cost.accuracy)}<br/>全field {pct(photoEval.fieldAccuracy)} / 4項目完全row {pct(photoEval.completeRowRate)}<br/>誤読 {photoEval.misreadFields} / 空欄 {photoEval.blankFields} / false row {photoEval.falseRows} / time {photoMs||"未記録"}{photoMs?"ms":""}</div><div><b>Guided Live</b><br/>名称 {pct(liveEval.byField.name.accuracy)} / 個数 {pct(liveEval.byField.qty.accuracy)} / 定価 {pct(liveEval.byField.retail.accuracy)} / 仕入れ {pct(liveEval.byField.cost.accuracy)}<br/>全field {pct(liveEval.fieldAccuracy)} / 4項目完全row {pct(liveEval.completeRowRate)}<br/>誤読 {liveEval.misreadFields} / 空欄 {liveEval.blankFields} / false row {liveEval.falseRows} / time {liveMs||"未記録"}{liveMs?"ms":""}</div></div>
    </section>
    <section style={styles.card}><b>状態：</b>{message}<br/><span style={{fontSize:12,color:"#667085"}}>geometry値はdiagnostic専用。正式勝敗は4項目実読取精度で判定。</span></section>
  </main>;
}
