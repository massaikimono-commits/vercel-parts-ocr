"use client";

import { useMemo, useState } from "react";
import CertificateQrDecodeExperimentPage from "../certificate-qr-decode-experiment/page";

const FIXED_MATRIX = [
  { id:"IMG_0940.jpeg", evidence:"insufficient", rerun:true, missing:"per-image decode path / candidate ownership / geometry cause trace", observe:"candidate ownership, detected→decode fail, crop/resolution, finder/quad, angle/perspective, quiet zone, contrast, multi-QR interference, decoder差, parser/dedupe/counting, near-threshold", reason:"formal count alone cannot identify the primary failure cause" },
  { id:"IMG_0941.jpeg", evidence:"insufficient", rerun:true, missing:"per-image decode path / candidate ownership / geometry cause trace", observe:"candidate ownership, detected→decode fail, crop/resolution, finder/quad, angle/perspective, quiet zone, contrast, multi-QR interference, decoder差, parser/dedupe/counting, near-threshold", reason:"historical Full Diagnostic JSON is not persisted in the repository" },
  { id:"IMG_0942.jpeg", evidence:"sufficient", rerun:false, missing:"none for candidate ownership reclassification", observe:"reuse existing 10-candidate A/B/C/D ownership evidence", reason:"10 candidate ownership classifications are already preserved as diagnostic evidence" },
  { id:"IMG_0943.jpeg", evidence:"insufficient", rerun:true, missing:"per-image decode path / candidate ownership / geometry cause trace", observe:"candidate ownership, detected→decode fail, crop/resolution, finder/quad, angle/perspective, quiet zone, contrast, multi-QR interference, decoder差, parser/dedupe/counting, near-threshold", reason:"historical Full Diagnostic JSON is not persisted in the repository" },
  { id:"IMG_0944.jpeg", evidence:"sufficient", rerun:false, missing:"none for candidate ownership reclassification", observe:"reuse existing 5-candidate A/B/C/D ownership evidence", reason:"5 candidate ownership classifications are already preserved as diagnostic evidence" },
  { id:"IMG_0945.jpeg", evidence:"insufficient", rerun:true, missing:"per-image decode path / candidate ownership / geometry cause trace", observe:"candidate ownership, detected→decode fail, crop/resolution, finder/quad, angle/perspective, quiet zone, contrast, multi-QR interference, decoder差, parser/dedupe/counting, near-threshold", reason:"historical Full Diagnostic JSON is not persisted in the repository" },
  { id:"IMG_0946.jpeg", evidence:"insufficient", rerun:true, missing:"per-image decode path / candidate ownership / geometry cause trace", observe:"candidate ownership, detected→decode fail, crop/resolution, finder/quad, angle/perspective, quiet zone, contrast, multi-QR interference, decoder差, parser/dedupe/counting, near-threshold", reason:"historical Full Diagnostic JSON is not persisted in the repository" },
  { id:"IMG_0947.jpeg", evidence:"insufficient", rerun:true, missing:"per-image decode path / candidate ownership / geometry cause trace", observe:"candidate ownership, detected→decode fail, crop/resolution, finder/quad, angle/perspective, quiet zone, contrast, multi-QR interference, decoder差, parser/dedupe/counting, near-threshold", reason:"historical Full Diagnostic JSON is not persisted in the repository" },
];

const FIXED_MINIMAL = FIXED_MATRIX.filter((r)=>r.rerun).map((r)=>r.id);
const DIAGNOSTIC_BUNDLE = [
  "candidate ownership",
  "QR detected / decode fail",
  "crop coverage",
  "resolution",
  "finder / quad",
  "angle / perspective",
  "quiet zone",
  "contrast",
  "multi-QR interference",
  "decoder差",
  "parser reject",
  "dedupe / counting",
  "near-threshold",
];

function tdStyle() { return {borderBottom:"1px solid #ddd",padding:"7px 6px",verticalAlign:"top",fontSize:12}; }

export default function CertificateQrMinimalDiagnosticPage(){
  const [additionalCount,setAdditionalCount]=useState(0);
  const [copied,setCopied]=useState("");
  const additionalRows=useMemo(()=>Array.from({length:Math.max(0,Math.min(32,Number(additionalCount)||0))},(_,i)=>({
    vehicleRun:"historical-additional-real",
    slotId:`additional-${String(i+1).padStart(2,"0")}`,
    evidence:"insufficient",
    rerun:true,
    missing:"historical per-slot Full Diagnostic trace not persisted",
    observe:DIAGNOSTIC_BUNDLE.join(", "),
    reason:"slot-level cause cannot be inferred safely from aggregate counts",
  })),[additionalCount]);

  const plan={
    schema:"icb-certificate-qr-minimal-diagnostic-plan-v1",
    role:"Missing Evidence Matrix / acquisition-only",
    formalReference:{finalSafeUnion:28,expectedQrCount:47,preserved:true},
    fixed8:FIXED_MATRIX,
    fixedMinimalRunOrder:FIXED_MINIMAL,
    additionalReal:{
      identityConstraint:"same historical photo set and same selection order; slots are assigned additional-01..N only",
      historicalFullDiagnosticPersisted:false,
      selectedSlotCount:additionalRows.length,
      rows:additionalRows,
    },
    isolation:{groundTruthScoringOnly:true,runtimeControlUsesGroundTruth:false,formalDecodeLogicChanged:false,recognitionLogicChanged:false},
    protection:{candidateLock:"HOLD / NOT EVALUATED",physicalSlot:"HOLD",frozen:"HOLD",production:"HOLD",adoptedHead:null},
  };
  const copyPlan=async()=>{
    await navigator.clipboard.writeText(JSON.stringify(plan,null,2));
    setCopied("Missing Evidence Matrixをコピーしました。");
  };

  return <main style={{fontFamily:"system-ui,sans-serif",maxWidth:1180,margin:"0 auto",padding:16}}>
    <h1 style={{fontSize:22,marginBottom:6}}>Photo QR Minimal Diagnostic Acquisition</h1>
    <div style={{fontSize:13,fontWeight:800,color:"#8a4b00"}}>全面fixed8再runは禁止。0942 / 0944は既存証拠を再利用し、下記missing対象だけ取得します。</div>
    <div style={{fontSize:12,marginTop:5}}>Formal 28/47 preserved / GT scoring-only / runtime-control利用なし / recognition logic変更なし</div>

    <section style={{marginTop:14,border:"1px solid #bbb",borderRadius:10,padding:12}}>
      <h2 style={{fontSize:17,margin:"0 0 8px"}}>Missing Evidence Matrix — fixed8</h2>
      <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",width:"100%",minWidth:980}}>
        <thead><tr>{["image","evidence","rerun","不足diagnostic","再runで観測","理由"].map(x=><th key={x} style={{textAlign:"left",borderBottom:"2px solid #aaa",padding:"6px",fontSize:12}}>{x}</th>)}</tr></thead>
        <tbody>{FIXED_MATRIX.map(r=><tr key={r.id}>
          <td style={tdStyle()}><code>{r.id}</code></td><td style={tdStyle()}><b>{r.evidence}</b></td><td style={tdStyle()}>{r.rerun?"yes":"no"}</td><td style={tdStyle()}>{r.missing}</td><td style={tdStyle()}>{r.observe}</td><td style={tdStyle()}>{r.reason}</td>
        </tr>)}</tbody>
      </table></div>
      <div style={{marginTop:10,fontSize:13}}><b>fixed最小run順:</b> {FIXED_MINIMAL.join(" → ")}</div>
      <div style={{fontSize:12,marginTop:4}}>この6枚のみを、下の既存「追加実車写真 Photo Decode評価」欄へ上記順で選択すると、additional-01〜06として同一decode pathを1回ずつ通せます。0942/0944は選択しないでください。</div>
    </section>

    <section style={{marginTop:14,border:"1px solid #bbb",borderRadius:10,padding:12}}>
      <h2 style={{fontSize:17,margin:"0 0 8px"}}>Missing Evidence Matrix — additional real</h2>
      <p style={{fontSize:12,marginTop:0}}>過去のFull Diagnostic JSONはrepoへ保存されていないため、既存aggregateからslot causeを推測しません。過去と同じ写真セット・同じ選択順を維持し、slot IDで分離します。</p>
      <label style={{fontSize:13,fontWeight:700}}>過去additional-realで使用した枚数（最大32）: <input type="number" min="0" max="32" value={additionalCount} onChange={e=>setAdditionalCount(e.target.value)} style={{width:72,padding:5,marginLeft:6}} /></label>
      {additionalRows.length>0&&<div style={{overflowX:"auto",marginTop:8}}><table style={{borderCollapse:"collapse",width:"100%",minWidth:900}}>
        <thead><tr>{["vehicle/run","slot","evidence","rerun","不足diagnostic","理由"].map(x=><th key={x} style={{textAlign:"left",borderBottom:"2px solid #aaa",padding:6,fontSize:12}}>{x}</th>)}</tr></thead>
        <tbody>{additionalRows.map(r=><tr key={r.slotId}><td style={tdStyle()}>{r.vehicleRun}</td><td style={tdStyle()}><code>{r.slotId}</code></td><td style={tdStyle()}>{r.evidence}</td><td style={tdStyle()}>yes</td><td style={tdStyle()}>{r.missing}</td><td style={tdStyle()}>{r.reason}</td></tr>)}</tbody>
      </table></div>}
      <div style={{fontSize:12,marginTop:8}}>※ 枚数/slot identityが旧summaryから復元できる場合は、その値を使います。復元不能な場合だけ同一セットの選択順からslotを再構成します。</div>
    </section>

    <section style={{marginTop:14,border:"1px solid #8ab4f8",borderRadius:10,padding:12}}>
      <h2 style={{fontSize:17,margin:"0 0 8px"}}>1-run acquisition rule</h2>
      <div style={{fontSize:12,lineHeight:1.6}}>観測bundle: {DIAGNOSTIC_BUNDLE.join(" / ")}</div>
      <div style={{fontSize:12,marginTop:5}}>同一画像を複数方式で手動runしません。既存Photo Decodeの1回のmatrix実行へ集約します。GTはdecode完了後のscoring-onlyです。</div>
      <button onClick={copyPlan} style={{marginTop:9,padding:"9px 13px",fontWeight:800}}>Missing Evidence Matrix JSONをコピー</button>
      {copied&&<span style={{marginLeft:8,fontSize:12}}>{copied}</span>}
    </section>

    <section style={{marginTop:18,borderTop:"3px solid #222",paddingTop:12}}>
      <h2 style={{fontSize:18,marginBottom:4}}>既存 formal-decode diagnostic UI</h2>
      <div style={{fontSize:12,fontWeight:800,marginBottom:8}}>固定8枚開始ボタンは使用しないでください。Minimal acquisitionでは上記不足対象だけを「追加実車写真」欄で選択します。</div>
      <CertificateQrDecodeExperimentPage />
    </section>
  </main>;
}
