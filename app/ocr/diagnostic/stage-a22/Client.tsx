"use client";

import { useEffect,useState } from "react";
import RealImageAudit from "./RealImageAudit";

const card:React.CSSProperties={background:"#fff",border:"1px solid #dbe2ec",borderRadius:16,padding:14,marginBottom:12};
export default function Client({deployedHead}:{deployedHead:string}){
  const[real,setReal]=useState(false);
  useEffect(()=>setReal(new URLSearchParams(window.location.search).get("real")==="1"),[]);
  return <main style={{maxWidth:1040,margin:"0 auto",padding:"16px 12px 60px",background:"#f5f7fb",minHeight:"100vh",color:"#172033"}}>
    <section style={card}>
      <h1 style={{margin:0}}>Stage A22 Cell-Crop Correction</h1>
      <p>Stage A21で確定したCELL_CROP_QUALITY PRIMARYを、recognizer/model交換なしで構造的に補正します。</p>
      <div style={{fontSize:13}}><strong>deployed commit:</strong> {deployedHead}</div>
    </section>
    <section style={card}>
      <h2>補正内容</h2>
      <ul style={{lineHeight:1.7}}>
        <li>用紙quad推定後、2-triangle affineでpaperをdeskew / perspective rectification。</li>
        <li>rectified paper上で水平・垂直table ruleを実測。</li>
        <li>A19 dynamic row centerを保持しつつ、上下は隣接する実測罫線で再境界化。</li>
        <li>隣接罫線が取れない場合は、従来の10%内側trimをやめ、安全側へ拡張。</li>
        <li>column左右も実測vertical ruleから再構成し、罫線厚+安全marginを内側除外。</li>
        <li>GTはscoring-only。row/crop位置決定へ不使用。</li>
      </ul>
      <p style={{fontSize:13}}>JA_LIGHT/V5のraw→normalized空は、numeric fieldでrawに数字がないケースを「numeric-policy-rejected-no-digit」と分離記録し、normalization破壊と誤分類しないようdiagnostic分類のみ追加。recognition output自体は変更しません。</p>
    </section>
    {!real&&<section style={card}><strong>実写真再run：HOLD。</strong><p>static/synthetic crop auditとbuildが成立するまで通常URLでは画像選択を出しません。</p></section>}
    {real&&<RealImageAudit deployedHead={deployedHead}/>} 
  </main>;
}
