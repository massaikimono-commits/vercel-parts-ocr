"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const FIXED_IDS = Array.from({ length: 8 }, (_, i) => `IMG_${String(940 + i).padStart(4, "0")}.jpeg`);
const RUN_IDS = new Set(["IMG_0940.jpeg","IMG_0941.jpeg","IMG_0943.jpeg","IMG_0945.jpeg","IMG_0946.jpeg","IMG_0947.jpeg"]);
const SKIP_IDS = new Set(["IMG_0942.jpeg","IMG_0944.jpeg"]);
const DIAGNOSTIC_ROUTE = "/eval/certificate-qr-decode-experiment";

function normalizeFixedName(file){
  const leaf=String(file?.name||"").normalize("NFKC").trim().split(/[\\/]/).pop()||"";
  const match=leaf.match(/^IMG_(094[0-7])(?:[\s_-]*(?:\(\d+\)|\d+|copy(?:[\s_-]*\d+)?))?\.(jpe?g)$/i);
  return match?`IMG_${match[1]}.jpeg`:null;
}

function mapFixedSet(files){
  const exact=new Map();
  for(const file of files){
    const id=normalizeFixedName(file);
    if(id&&!exact.has(id)) exact.set(id,file);
  }
  if(files.length===8&&exact.size===8&&FIXED_IDS.every((id)=>exact.has(id))){
    return {mode:"filename",rows:FIXED_IDS.map((id)=>({id,file:exact.get(id),source:"File.name"})),valid:true,message:"正式IMG番号を自動判別しました。"};
  }
  if(files.length!==8){
    return {mode:"invalid",rows:[],valid:false,message:`8枚まとめて選択してください（現在 ${files.length}枚）。`};
  }
  const sorted=[...files].sort((a,b)=>Number(a.lastModified||0)-Number(b.lastModified||0)||String(a.name).localeCompare(String(b.name)));
  return {
    mode:"metadata-fallback",
    rows:FIXED_IDS.map((id,i)=>({id,file:sorted[i],source:"metadata/selection fallback"})),
    valid:true,
    message:"iOSで正式IMG番号を保持していない可能性があります。撮影metadata順で自動対応しました。下の8枚サムネイルを1回だけ確認してください。",
  };
}

export default function CertificateQrMinimalDiagnosticPage(){
  const [files,setFiles]=useState([]);
  const [thumbs,setThumbs]=useState({});
  const [status,setStatus]=useState("固定評価8枚をまとめて選択してください。");
  const [running,setRunning]=useState(false);
  const [iframeReady,setIframeReady]=useState(false);
  const frameRef=useRef(null);
  const mapping=useMemo(()=>mapFixedSet(files),[files]);

  useEffect(()=>{
    const next={};
    for(const row of mapping.rows||[]) next[row.id]=URL.createObjectURL(row.file);
    setThumbs(next);
    return()=>{for(const url of Object.values(next)) URL.revokeObjectURL(url);};
  },[mapping]);

  const runMinimal=async()=>{
    if(!mapping.valid||!iframeReady||running)return;
    setRunning(true);
    try{
      const win=frameRef.current?.contentWindow;
      const doc=frameRef.current?.contentDocument;
      if(!win||!doc)throw new Error("診断画面の準備ができていません。数秒後に再度押してください。");
      const sections=[...doc.querySelectorAll("section")];
      const additionalSection=sections.find((s)=>String(s.textContent||"").includes("追加実車写真 Photo Decode評価"));
      if(!additionalSection)throw new Error("追加実車診断欄を取得できませんでした。");
      const input=additionalSection.querySelector('input[type="file"][multiple]');
      const button=[...additionalSection.querySelectorAll("button")].find((b)=>String(b.textContent||"").includes("追加実車 Photo Decode開始"));
      if(!input||!button)throw new Error("Minimal Diagnostic実行UIを取得できませんでした。");
      const runFiles=mapping.rows.filter((row)=>RUN_IDS.has(row.id)).map((row)=>row.file);
      const dt=new win.DataTransfer();
      for(const file of runFiles)dt.items.add(file);
      input.files=dt.files;
      input.dispatchEvent(new win.Event("change",{bubbles:true}));
      await new Promise((r)=>setTimeout(r,120));
      button.click();
      setStatus("Minimal Diagnosticを開始しました。0942 / 0944は自動skip済みです。下の診断結果が完了するまでそのまま待ってください。");
    }catch(error){
      setStatus(`開始できませんでした: ${error?.message||error}`);
    }finally{
      setRunning(false);
    }
  };

  return <main style={{fontFamily:"system-ui,sans-serif",maxWidth:1160,margin:"0 auto",padding:16}}>
    <h1 style={{fontSize:22,marginBottom:6}}>Photo QR Minimal Diagnostic</h1>
    <div style={{fontSize:13,fontWeight:800}}>固定8枚はまとめて選択するだけ。個別IMG番号を探す必要はありません。</div>
    <div style={{fontSize:12,marginTop:5}}>Formal 28/47 preserved / GT scoring-only / recognition logic変更なし / 0942・0944は既存証拠利用</div>

    <section style={{marginTop:14,border:"1px solid #aaa",borderRadius:12,padding:12}}>
      <label style={{display:"block",fontWeight:850,fontSize:15}}>① 固定評価8枚をまとめて選択</label>
      <input type="file" accept="image/*" multiple disabled={running} onChange={(e)=>{setFiles([...e.target.files]);setStatus("8枚を確認中…");}} style={{marginTop:8}} />
      <div style={{marginTop:8,fontSize:13,fontWeight:700}}>{mapping.message}</div>
      {mapping.valid&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginTop:12}}>
          {mapping.rows.map((row)=><div key={row.id} style={{border:SKIP_IDS.has(row.id)?"2px solid #8b8b8b":"2px solid #2f6fe4",borderRadius:10,padding:7,background:SKIP_IDS.has(row.id)?"#f3f3f3":"#fff"}}>
            <div style={{fontFamily:"monospace",fontSize:12,fontWeight:900}}>{row.id}</div>
            <div style={{fontSize:11,fontWeight:800,margin:"3px 0"}}>{SKIP_IDS.has(row.id)?"SKIP（既存証拠）":"RUN対象"}</div>
            {thumbs[row.id]&&<img src={thumbs[row.id]} alt={row.id} style={{display:"block",width:"100%",height:110,objectFit:"contain",background:"#eee",borderRadius:7}} />}
            <div style={{fontSize:10,marginTop:4,overflowWrap:"anywhere"}}>取得名: {row.file?.name||"-"}</div>
            <div style={{fontSize:10}}>metadata: {row.file?.lastModified?new Date(row.file.lastModified).toLocaleString():"なし"}</div>
          </div>)}
        </div>
        <div style={{marginTop:10,fontSize:12}}>
          自動run: 0940 / 0941 / 0943 / 0945 / 0946 / 0947　｜　自動skip: 0942 / 0944
        </div>
        <button onClick={runMinimal} disabled={!iframeReady||running} style={{marginTop:12,width:"100%",padding:"13px 16px",fontSize:17,fontWeight:900}}>
          {running?"開始準備中…":"② この8枚でMinimal Diagnostic開始"}
        </button>
      </>}
      <div style={{marginTop:10,fontWeight:800,fontSize:13}}>{status}</div>
    </section>

    <section style={{marginTop:16,borderTop:"3px solid #222",paddingTop:10}}>
      <div style={{fontSize:12,fontWeight:800,marginBottom:7}}>診断本体（自動操作対象）</div>
      <iframe ref={frameRef} title="Photo QR diagnostic" src={`${DIAGNOSTIC_ROUTE}?head=fixed-eval-picker`} onLoad={()=>setIframeReady(true)} style={{width:"100%",height:1600,border:"1px solid #bbb",borderRadius:10}} />
    </section>
  </main>;
}
