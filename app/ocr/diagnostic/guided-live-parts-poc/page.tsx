/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef, useState } from "react";
import { saveOCRTransferImage } from "../../../transfer";
import { analyzeGuidedFrame, canvasToFile, perspectiveCorrect, type FrameMetrics, type Quad } from "./acquisition";

type Row = { name: string; qty: string; retail: string; cost: string };
const MODE_KEY="parts-poc-mode", START_KEY="parts-poc-start", LIVE_METRICS_KEY="parts-poc-live-metrics";
const PHOTO_RESULT_KEY="parts-poc-photo-result", LIVE_RESULT_KEY="parts-poc-live-result";
const styles: Record<string,React.CSSProperties>={page:{maxWidth:980,margin:"0 auto",padding:"14px 12px 60px",background:"#f5f7fb",minHeight:"100vh",color:"#172033"},card:{background:"#fff",border:"1px solid #dbe2ec",borderRadius:16,padding:14,marginBottom:12},primary:{width:"100%",border:0,borderRadius:13,padding:"14px 12px",background:"#2468df",color:"#fff",fontWeight:800,fontSize:17,marginTop:8},secondary:{width:"100%",border:"1px solid #cfd8e6",borderRadius:13,padding:12,background:"#fff",color:"#2459a8",fontWeight:800,fontSize:15,marginTop:8}};

function videoCanvas(video:HTMLVideoElement,maxSide=1280){const w0=video.videoWidth||1280,h0=video.videoHeight||720,s=Math.min(1,maxSide/Math.max(w0,h0));const c=document.createElement("canvas");c.width=Math.max(1,Math.round(w0*s));c.height=Math.max(1,Math.round(h0*s));c.getContext("2d")!.drawImage(video,0,0,c.width,c.height);return c;}
function rows(key:string){try{return JSON.parse(sessionStorage.getItem(key)||"[]") as Row[];}catch{return [];}}

export default function GuidedLivePartsPocPage(){
 const videoRef=useRef<HTMLVideoElement>(null),streamRef=useRef<MediaStream|null>(null),loopRef=useRef<number|null>(null),bestRef=useRef<{score:number;dataUrl:string;metrics:FrameMetrics}|null>(null),prevQuadRef=useRef<Quad|null>(null);
 const [running,setRunning]=useState(false),[metrics,setMetrics]=useState<FrameMetrics|null>(null),[bestScore,setBestScore]=useState(0),[photoRows,setPhotoRows]=useState<Row[]>([]),[liveRows,setLiveRows]=useState<Row[]>([]),[message,setMessage]=useState("PhotoとGuided Liveを同じ既存OCRへ自動handoffします。");
 useEffect(()=>{setPhotoRows(rows(PHOTO_RESULT_KEY));setLiveRows(rows(LIVE_RESULT_KEY));return()=>{streamRef.current?.getTracks().forEach(t=>t.stop());if(loopRef.current)cancelAnimationFrame(loopRef.current);};},[]);
 async function startLive(){streamRef.current?.getTracks().forEach(t=>t.stop());const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});streamRef.current=stream;if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play();}bestRef.current=null;prevQuadRef.current=null;setBestScore(0);setRunning(true);const tick=()=>{const v=videoRef.current;if(!v||!streamRef.current)return;if(v.videoWidth>0){const c=videoCanvas(v,960),m=analyzeGuidedFrame(c,prevQuadRef.current);prevQuadRef.current=m.quad;setMetrics(m);if(m.quad&&m.score>(bestRef.current?.score||0)){bestRef.current={score:m.score,dataUrl:c.toDataURL("image/jpeg",.93),metrics:m};setBestScore(m.score);}}loopRef.current=requestAnimationFrame(tick);};tick();}
 async function send(mode:"photo"|"live",file:File,telemetry?:FrameMetrics){sessionStorage.setItem(MODE_KEY,mode);sessionStorage.setItem(START_KEY,String(Date.now()));if(telemetry)sessionStorage.setItem(LIVE_METRICS_KEY,JSON.stringify(telemetry));await saveOCRTransferImage(file);location.assign("/ocr");}
 async function usePhoto(file:File|null){if(file)await send("photo",file);}
 async function useBestLive(){const best=bestRef.current;if(!best||!best.metrics.quad){setMessage("まだ伝票を安定検出できていません。");return;}const img=new Image();img.src=best.dataUrl;await img.decode();const src=document.createElement("canvas");src.width=img.naturalWidth;src.height=img.naturalHeight;src.getContext("2d")!.drawImage(img,0,0);const corrected=perspectiveCorrect(src,best.metrics.quad,1800),file=await canvasToFile(corrected,"guided-live-yellow.jpg");await send("live",file,best.metrics);}
 const renderRows=(label:string,data:Row[])=><div><b>{label}</b>{data.length?data.map((r,i)=><div key={i} style={{fontSize:13,padding:"4px 0"}}>{i+1}. {r.name} / {r.qty} / {r.retail} / {r.cost}</div>):<div style={{fontSize:13,color:"#667085"}}>未取得</div>}</div>;
 return <main style={styles.page}>
  <section style={styles.card}><h1 style={{margin:0}}>Guided Live Parts Scan PoC</h1><p>取得方法だけを比較。OCR engine / PSM / 4項目抽出ロジックは共通です。</p></section>
  <section style={styles.card}><h2>A. Photo</h2><input type="file" accept="image/*" onChange={e=>usePhoto(e.target.files?.[0]||null)}/><p style={{fontSize:13}}>画像選択後、そのまま既存OCRを実行し結果を自動返却します。</p></section>
  <section style={styles.card}><h2>B. Guided Live</h2><div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#111",aspectRatio:"16/9"}}><video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover"}}/><div style={{position:"absolute",left:"8%",right:"8%",top:"17%",bottom:"17%",border:"3px solid #ffd34d",borderRadius:10,pointerEvents:"none"}}/></div><button style={styles.primary} onClick={startLive}>{running?"カメラ再開始":"Live camera開始"}</button><button style={styles.secondary} onClick={useBestLive} disabled={!bestRef.current}>best frameを既存OCRへ送る</button>{metrics&&<div style={{fontSize:13,lineHeight:1.7,marginTop:8}}>score {metrics.score.toFixed(1)} / best {bestScore.toFixed(1)} / coverage {(metrics.coverage*100).toFixed(1)}% / tilt {metrics.tiltDeg.toFixed(1)}° / perspective {(metrics.perspectiveDistortion*100).toFixed(1)}% / sharpness {metrics.sharpness.toFixed(0)} / brightness {metrics.brightness.toFixed(0)} / glare {(metrics.glareRatio*100).toFixed(1)}% / stability {metrics.stability==null?"-":metrics.stability.toFixed(4)}</div>}</section>
  <section style={styles.card}><h2>自動返却済み4項目</h2><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{renderRows("Photo",photoRows)}{renderRows("Guided Live",liveRows)}</div><button style={styles.primary} onClick={()=>location.assign("/ocr/diagnostic/guided-live-parts-poc/eval")}>paired comparisonを開く</button></section>
  <section style={styles.card}><b>状態：</b>{message}</section>
 </main>;
}
