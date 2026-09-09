"use client";

import {useEffect,useMemo,useState} from "react";
import {runPhotoQrA21Counterfactual} from "../certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated";
import {A21_FIXED_IDS,buildA21Summary} from "./contract.mjs";

function normalizeFixedName(file){
  const leaf=String(file?.name||"").normalize("NFKC").trim().split(/[\\/]/).pop()||"";
  const match=leaf.match(/^IMG_(094[0-7])(?:[\s_-]*(?:\(\d+\)|\d+|copy(?:[\s_-]*\d+)?))?\.(jpe?g)$/i);
  return match?`IMG_${match[1]}.jpeg`:null;
}
function mapFixedSet(files){
  if(files.length!==8)return{valid:false,mode:"invalid",rows:[],message:`固定評価8枚をまとめて選択してください（現在 ${files.length}枚）。`};
  const exact=new Map();let duplicate=false;
  for(const file of files){const id=normalizeFixedName(file);if(id&&exact.has(id))duplicate=true;if(id&&!exact.has(id))exact.set(id,file);}
  if(!duplicate&&exact.size===8&&A21_FIXED_IDS.every(id=>exact.has(id)))return{valid:true,mode:"filename",rows:A21_FIXED_IDS.map(id=>({id,file:exact.get(id)})),message:"固定8枚を正式IMG番号へ自動対応しました。サムネイルだけ確認してください。"};
  const sorted=[...files].sort((a,b)=>Number(a.lastModified||0)-Number(b.lastModified||0)||String(a.name).localeCompare(String(b.name)));
  return{valid:true,mode:"metadata-fallback",rows:A21_FIXED_IDS.map((id,i)=>({id,file:sorted[i]})),message:"iOSで正式名を保持していないためmetadata順で対応しました。8枚のサムネイルだけ確認してください。"};
}
function publicMethod(row){
  return{
    id:row.id,
    physicalUniqueQrCount:Number(row.physicalUniqueQrCount||0),
    netNewCanonicalQrCount:Number(row.netNewCanonicalQrCount||0),
    lostCurrentQrCount:Number(row.lostCurrentQrCount||0),
    duplicateInflationCount:Number(row.duplicateInflationCount||0),
    countingIntegrityFail:Boolean(row.countingIntegrityFail),
    runtimeMs:Number(row.runtimeMs||0),
    candidateAttribution:row.candidateAttribution||[],
    recoveredCandidateReasonCounts:row.recoveredCandidateReasonCounts||{},
  };
}

export default function StageA21Page(){
  const[files,setFiles]=useState([]);const[thumbs,setThumbs]=useState({});const[running,setRunning]=useState(false);const[status,setStatus]=useState("固定評価8枚をまとめて選択してください。");const[summary,setSummary]=useState(null);
  const mapping=useMemo(()=>mapFixedSet(files),[files]);
  useEffect(()=>{const next={};for(const row of mapping.rows||[])next[row.id]=URL.createObjectURL(row.file);setThumbs(next);return()=>{for(const url of Object.values(next))URL.revokeObjectURL(url);};},[mapping]);
  const start=async()=>{
    if(!mapping.valid||running)return;setRunning(true);setSummary(null);
    try{
      const evaluationHead=new URLSearchParams(window.location.search).get("head")||null;
      if(!/^[0-9a-f]{40}$/i.test(String(evaluationHead||"")))throw new Error("Preview HEADが固定されていません。管理側Preview URLを開き直してください。");
      const records=[];
      for(let i=0;i<mapping.rows.length;i++){
        const row=mapping.rows[i];setStatus(`${i+1}/8 ${row.id}: CURRENT / A / B / C を同条件で比較中…`);
        try{
          const result=await runPhotoQrA21Counterfactual(row.file);
          records.push({imageId:row.id,diagnosticError:null,methods:{CURRENT:publicMethod(result.current),A_PHYSICAL_SEPARATION:publicMethod(result.a),B_NORMALIZED_QUAD:publicMethod(result.b),C_RECTIFIED_RECOVERY:publicMethod(result.c)},gtUsedDuringDecode:Boolean(result.gtUsedDuringDecode),formalDecodeLogicChanged:Boolean(result.formalDecodeLogicChanged)});
        }catch(error){records.push({imageId:row.id,diagnosticError:{name:String(error?.name||"Error"),message:String(error?.message||error||"unknown")},methods:null});}
      }
      const out=buildA21Summary({evaluationHead,records});
      if(records.some(r=>r.gtUsedDuringDecode||r.formalDecodeLogicChanged))throw new Error("A21 isolation invariant FAIL");
      setSummary(out);setStatus("A21比較完了。下の総合管理用短縮summaryをコピーしてください。");
    }catch(error){setSummary(null);setStatus(`FAIL: ${error?.message||error}`);}finally{setRunning(false);}
  };
  const copy=async()=>{if(!summary)return;await navigator.clipboard.writeText(JSON.stringify(summary,null,2));setStatus("総合管理用短縮summaryをコピーしました。ChatGPTへそのまま貼り付けてください。");};
  return <main style={{fontFamily:"system-ui,sans-serif",maxWidth:980,margin:"0 auto",padding:16}}>
    <h1 style={{fontSize:22,marginBottom:5}}>Stage A21 Photo QR Counterfactual Matrix</h1>
    <div style={{fontSize:13,fontWeight:800}}>操作は「固定8枚選択 → A21比較開始 → summaryコピー」だけです。</div>
    <div style={{fontSize:12,marginTop:5}}>CURRENT / A_PHYSICAL_SEPARATION / B_NORMALIZED_QUAD / C_RECTIFIED_RECOVERY。Formal 28/47は変更しません。</div>
    <section style={{marginTop:14,border:"1px solid #aaa",borderRadius:12,padding:12}}>
      <label style={{display:"block",fontWeight:850}}>① 固定評価8枚をまとめて選択</label>
      <input type="file" accept="image/*" multiple disabled={running} onChange={e=>{setFiles([...e.target.files]);setSummary(null);setStatus("8枚を確認中…");}} style={{marginTop:8}}/>
      <div style={{marginTop:8,fontSize:13,fontWeight:700}}>{mapping.message}</div>
      {mapping.valid&&<div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8,marginTop:10}}>{mapping.rows.map(row=><div key={row.id} style={{border:"1px solid #ddd",borderRadius:9,padding:6}}><div style={{fontSize:11,fontFamily:"monospace",fontWeight:800}}>{row.id}</div><img src={thumbs[row.id]} alt={row.id} style={{display:"block",width:"100%",height:130,objectFit:"contain",background:"#f5f5f5",marginTop:4}}/></div>)}</div>}
      <button disabled={!mapping.valid||running} onClick={start} style={{marginTop:12,width:"100%",padding:"12px 10px",fontWeight:900,fontSize:16}}>{running?"A21比較中…":"② A21比較を開始"}</button>
      <div style={{marginTop:10,fontSize:13,fontWeight:800}}>{status}</div>
    </section>
    {summary&&<section style={{marginTop:14,border:"1px solid #6a8",borderRadius:12,padding:12}}>
      <div style={{fontWeight:900}}>比較完了</div>
      <div style={{fontSize:12,marginTop:6}}>CURRENT {summary.totals.CURRENT.physicalUniqueQrCount}/47 ／ A {summary.totals.A_PHYSICAL_SEPARATION.physicalUniqueQrCount}/47 ／ B {summary.totals.B_NORMALIZED_QUAD.physicalUniqueQrCount}/47 ／ C {summary.totals.C_RECTIFIED_RECOVERY.physicalUniqueQrCount}/47</div>
      <button onClick={copy} style={{marginTop:12,width:"100%",padding:"12px 10px",fontWeight:900,fontSize:16}}>③ 総合管理用短縮summaryをコピー</button>
    </section>}
  </main>;
}
