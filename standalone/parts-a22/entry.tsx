import React from "react";
import { createRoot } from "react-dom/client";
import RealImageAudit from "../../app/ocr/diagnostic/stage-a22/RealImageAudit";

const EVAL_HEAD = "fa8df79c3eff7cc9c100d48b357d09c930168cdf";
const root = document.getElementById("root");
if (!root) throw new Error("root missing");

createRoot(root).render(
  <React.StrictMode>
    <main style={{maxWidth:1040,margin:"0 auto",padding:"16px 12px 60px",background:"#f5f7fb",minHeight:"100vh",color:"#172033"}}>
      <section style={{background:"#fff",border:"1px solid #dbe2ec",borderRadius:16,padding:14,marginBottom:12}}>
        <h1 style={{marginTop:0}}>Stage A22 Standalone Real-Image Evaluation</h1>
        <p>Vercelを使わない一時評価ページです。formal yellow 12枚を端末内で選択し、IMG_0684だけを自動特定してbrowser-onlyで処理します。</p>
        <div style={{fontSize:13}}>evalHead: <code>{EVAL_HEAD}</code></div>
        <div style={{fontSize:13}}>画像・crop・結果をサーバへ保存しません。外部アクセスはOCR runtime/model/dictionary取得のみです。</div>
      </section>
      <RealImageAudit deployedHead={EVAL_HEAD}/>
    </main>
  </React.StrictMode>
);
