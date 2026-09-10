"use client";

import { useEffect, useMemo, useState } from "react";
import { A214_STORAGE_KEY } from "../certificate-qr-stage-a21-4-evidence/contract.mjs";
import { analyzeA216PersistedEvidence } from "../../../../scripts/photo-qr-stage-a21-6-character-class-audit.mjs";

export default function Page(){
  const [detail,setDetail]=useState(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    try{
      const raw=localStorage.getItem(A214_STORAGE_KEY);
      if(!raw){setError("A21.4保存evidenceが見つかりません。同じブラウザ・同じbranch aliasで開いてください。QR再runはしないでください。");return;}
      setDetail(JSON.parse(raw));
    }catch(e){setError(String(e?.message||e));}
  },[]);
  const result=useMemo(()=>detail?analyzeA216PersistedEvidence(detail):null,[detail]);
  const compact=useMemo(()=>result?JSON.stringify(result):"",[result]);
  const copy=async()=>{if(compact)await navigator.clipboard.writeText(compact)};
  return <main style={{fontFamily:"system-ui,sans-serif",maxWidth:900,margin:"0 auto",padding:16}}>
    <h1 style={{fontSize:22}}>Stage A21.6 Character-Class Audit</h1>
    <p style={{fontSize:13,fontWeight:800}}>A21.4のprivacy-safe保存evidenceのみを解析。QR再run・raw payload表示・gate緩和・Formal parser変更は行いません。</p>
    {error&&<section style={{border:"1px solid #b00",borderRadius:12,padding:12}}>{error}</section>}
    {result&&<>
      <section style={{border:"1px solid #aaa",borderRadius:12,padding:12}}>
        <div>raw success: {result.rawSuccessCount}</div>
        <div>unique fingerprint: {result.uniqueFingerprintCount}</div>
        <div>3 fingerprint aggregate structure identical: {String(result.aggregateStructureIdenticalAcrossFingerprints)}</div>
        <div style={{marginTop:8,fontWeight:800}}>alnum/known-symbolの個別内訳と位置別classはA21.4保存データから復元不可。QR再runは禁止のため、ここでNOT FULLY EVALUABLEとして止めます。</div>
      </section>
      {result.fingerprintGroups.map((g)=><section key={g.fingerprint} style={{border:"1px solid #ddd",borderRadius:12,padding:12,marginTop:10,fontSize:13}}>
        <div>fingerprint: {g.fingerprint}</div><div>images: {g.images.join(", ")}</div><div>length: {g.length}</div><div>ASCII visible: {String(g.asciiVisibleCount)}</div><div>non-ASCII: {String(g.nonAsciiCount)}</div><div>alnum + known symbol: {String(g.alnumKnownSymbolCombinedCount)}</div><div>ASCII other: {String(g.asciiOtherCount)}</div><div>alnum only: NOT RECOVERABLE</div><div>known symbol only: NOT RECOVERABLE</div><div>per-position class: NOT RECOVERABLE</div>
      </section>)}
      <button onClick={copy} style={{marginTop:12,width:"100%",padding:12,fontWeight:900}}>総合管理用A21.6 summaryをコピー</button>
    </>}
  </main>
}
