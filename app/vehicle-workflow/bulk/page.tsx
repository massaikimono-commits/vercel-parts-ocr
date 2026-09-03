/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useState } from "react";
import { supabase } from "../../supabase";
import { parseVehicleCertificatePdf } from "../../lib/vehicle-bulk-pdf";

type Action = ""|"CREATE_VEHICLE"|"UPDATE_EXISTING";
type VehicleCandidate = { vehicle_id:string; score:number; matched_on:any };
type CustomerCandidate = { customer_id:string; score:number; matched_on:any };
type VehicleDetail = {
  id:string;
  registration_number:string|null;
  registration_number_last4:string|null;
  chassis_number:string|null;
  maker:string|null;
  model:string|null;
  customer_id:string|null;
};
type CustomerDetail = { id:string; name:string; company_name:string|null; phone:string|null };

type ReviewItem = {
  importId:string;
  fileName:string;
  quality:"ready"|"review"|"image_pdf";
  reason:string;
  pageNumber:number;
  pageCount:number;
  parsedFields:Record<string,any>;
  action:Action;
  targetVehicleId:string;
  customerId:string;
  include:boolean;
  matchScore:number|null;
  vehicleCandidates:VehicleCandidate[];
  customerCandidates:CustomerCandidate[];
};

function field(item:ReviewItem,key:string){ return String(item.parsedFields[key]||""); }

function last4Label(value:string){
  if(!value)return "----";
  return /^\d+$/.test(value)?String(Number.parseInt(value,10)):value;
}

export default function BulkVehicleRegistrationPage(){
  const fileRef=useRef<HTMLInputElement>(null);
  const [items,setItems]=useState<ReviewItem[]>([]);
  const [vehicleDetails,setVehicleDetails]=useState<Record<string,VehicleDetail>>({});
  const [customerDetails,setCustomerDetails]=useState<Record<string,CustomerDetail>>({});
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [message,setMessage]=useState("車検証PDFを複数選ぶと、順番に解析して既存車との重複まで確認します。");
  const [errors,setErrors]=useState<string[]>([]);

  async function loadDetails(nextItems:ReviewItem[]){
    const vehicleIds=[...new Set(nextItems.flatMap(x=>x.vehicleCandidates.map(v=>v.vehicle_id)).filter(Boolean))];
    const customerIds=[...new Set(nextItems.flatMap(x=>x.customerCandidates.map(c=>c.customer_id)).filter(Boolean))];

    if(vehicleIds.length){
      const {data}=await supabase.from("vehicles")
        .select("id,registration_number,registration_number_last4,chassis_number,maker,model,customer_id")
        .in("id",vehicleIds);
      if(data) setVehicleDetails(Object.fromEntries((data as VehicleDetail[]).map(v=>[v.id,v])));
    }
    if(customerIds.length){
      const {data}=await supabase.from("customers").select("id,name,company_name,phone").in("id",customerIds);
      if(data) setCustomerDetails(Object.fromEntries((data as CustomerDetail[]).map(c=>[c.id,c])));
    }
  }

  async function processFiles(files:FileList|File[]){
    const list=Array.from(files).filter(f=>f.type==="application/pdf"||/\.pdf$/i.test(f.name));
    if(!list.length){setMessage("PDFを選択してください。");return;}
    if(list.length>100){setMessage("一度に選べるPDFは100件までです。");return;}

    setBusy(true);
    setErrors([]);
    setProgress(`0/${list.length}`);
    setMessage("PDFを順番に解析しています。");
    const nextItems:ReviewItem[]=[];

    try{
      for(let i=0;i<list.length;i++){
        const file=list[i];
        let stagedImportId="";
        let parsedSnapshot:any=null;
        setProgress(`${i+1}/${list.length}　${file.name}`);
        try{
          const parsed=await parseVehicleCertificatePdf(file);
          parsedSnapshot=parsed;
          const customerName=String(parsed.parsedFields.user_name||"");
          const status=parsed.quality==="ready"?"PARSED":"NEEDS_REVIEW";
          const {data:importRow,error:insertError}=await supabase.from("vehicle_imports").insert({
            source_type:"PDF",
            source_path:file.name,
            raw_text:parsed.rawText.slice(0,80000)||null,
            parsed_fields:parsed.parsedFields,
            parse_confidence:parsed.parseConfidence,
            customer_fields:customerName?{name:customerName}:{},
            status,
          }).select("id").single();
          if(insertError) throw insertError;
          stagedImportId=importRow.id;

          let suggested:Action="";
          let targetVehicleId="";
          let matchScore:number|null=null;
          let vehicleCandidates:VehicleCandidate[]=[];
          let customerCandidates:CustomerCandidate[]=[];

          if(parsed.quality!=="image_pdf"){
            const [reviewRes,vehicleMatchRes,customerMatchRes]=await Promise.all([
              supabase.rpc("vehicle_import_review",{p_import_id:importRow.id}),
              supabase.rpc("find_vehicle_import_matches",{p_import_id:importRow.id}),
              customerName
                ? supabase.rpc("find_customer_import_matches",{p_import_id:importRow.id})
                : Promise.resolve({data:[],error:null} as any),
            ]);
            if(reviewRes.error) throw reviewRes.error;
            if(vehicleMatchRes.error) throw vehicleMatchRes.error;
            if(customerMatchRes.error) throw customerMatchRes.error;

            const review=Array.isArray(reviewRes.data)?reviewRes.data[0]:reviewRes.data;
            vehicleCandidates=((vehicleMatchRes.data||[]) as VehicleCandidate[]).slice(0,5);
            customerCandidates=((customerMatchRes.data||[]) as CustomerCandidate[]).slice(0,5);
            matchScore=review?.best_score==null?null:Number(review.best_score);
            targetVehicleId=review?.best_vehicle_id||"";
            suggested=review?.suggested_action==="UPDATE_EXISTING"
              ?"UPDATE_EXISTING"
              : review?.suggested_action==="CREATE_VEHICLE"
                ?"CREATE_VEHICLE"
                :"";

            const {error:updateError}=await supabase.from("vehicle_imports").update({
              matched_vehicle_id:targetVehicleId||null,
              match_score:matchScore,
              status:suggested==="UPDATE_EXISTING"?"MATCHED":suggested==="CREATE_VEHICLE"?"PARSED":"NEEDS_REVIEW",
              resolution_action:suggested||null,
              updated_at:new Date().toISOString(),
            }).eq("id",importRow.id);
            if(updateError) throw updateError;
          }

          nextItems.push({
            importId:importRow.id,
            fileName:file.name,
            quality:parsed.quality,
            reason:parsed.reason,
            pageNumber:parsed.pageNumber,
            pageCount:parsed.pageCount,
            parsedFields:parsed.parsedFields,
            action:suggested,
            targetVehicleId,
            customerId:"",
            include:parsed.quality==="ready",
            matchScore,
            vehicleCandidates,
            customerCandidates,
          });
        }catch(error:any){
          if(stagedImportId){
            const {error:reviewMarkError}=await supabase.from("vehicle_imports").update({
              status:"NEEDS_REVIEW",
              resolution_action:null,
              updated_at:new Date().toISOString(),
            }).eq("id",stagedImportId);
            if(reviewMarkError){
              console.error("取込データを要確認へ更新できませんでした",reviewMarkError);
            }
          }
          nextItems.push({
            importId:stagedImportId,
            fileName:file.name,
            quality:stagedImportId?"review":"image_pdf",
            reason:(stagedImportId?"取込後の照合エラー。要確認として保持しました: ":"解析エラー: ")+(error?.message||error),
            pageNumber:parsedSnapshot?.pageNumber||1,
            pageCount:parsedSnapshot?.pageCount||1,
            parsedFields:parsedSnapshot?.parsedFields||{},
            action:"",targetVehicleId:"",
            customerId:"",include:false,matchScore:null,vehicleCandidates:[],customerCandidates:[],
          });
        }
      }

      setItems(nextItems);
      await loadDetails(nextItems);
      const ready=nextItems.filter(x=>x.quality==="ready"&&x.include&&x.action).length;
      const review=nextItems.filter(x=>x.quality!=="ready").length;
      setMessage(`${nextItems.length}件解析しました。すぐ保存候補 ${ready}件 / 要確認 ${review}件です。`);
    }finally{
      setBusy(false);
      setProgress("");
      if(fileRef.current) fileRef.current.value="";
    }
  }

  function updateItem(importId:string,patch:Partial<ReviewItem>){
    setItems(old=>old.map(x=>x.importId===importId?{...x,...patch}:x));
  }

  function updateField(importId:string,key:string,value:string){
    setItems(old=>old.map(x=>x.importId===importId?{
      ...x,
      parsedFields:{...x.parsedFields,[key]:value},
    }:x));
  }

  function vehicleCandidateLabel(id:string){
    const v=vehicleDetails[id];
    if(!v)return id.slice(0,8);
    const last=v.registration_number_last4 ? last4Label(v.registration_number_last4) : "----";
    return `${v.registration_number||v.chassis_number||"既存車両"} / 下4桁 ${last} ${[v.maker,v.model].filter(Boolean).join(" ")}`;
  }

  function customerCandidateLabel(id:string){
    const c=customerDetails[id];
    if(!c)return id.slice(0,8);
    return `${c.company_name||c.name}${c.phone?" / "+c.phone:""}`;
  }

  async function saveBatch(){
    setErrors([]);
    const targets=items.filter(x=>x.include);
    if(!targets.length){setErrors(["保存対象を1件以上選択してください。"]);return;}

    const missing=targets.find(x=>!x.importId||!x.action||(x.action==="UPDATE_EXISTING"&&!x.targetVehicleId));
    if(missing){
      setErrors([`${missing.fileName}：新規作成か既存車更新を選択してください。`]);
      return;
    }

    setBusy(true);
    setMessage("車両をまとめて保存しています。");
    try{
      const payload=targets.map(x=>({
        importId:x.importId,
        action:x.action,
        targetVehicleId:x.action==="UPDATE_EXISTING"?x.targetVehicleId:null,
        customerId:x.customerId||null,
        parsedFields:x.parsedFields,
      }));
      const {data,error}=await supabase.rpc("apply_vehicle_import_batch_v1",{
        p_items:payload,
        p_actor:"vehicle-pdf-batch",
      });
      if(error) throw error;

      if(!data?.applied){
        const failedIndex=Number(data?.failedIndex||0);
        const failed=failedIndex>0?targets[failedIndex-1]:null;
        const hard=Array.isArray(data?.hardErrors)?data.hardErrors.map(String):[];
        setErrors(hard.length?hard:[failed?`${failed.fileName} を保存できません。`:"まとめ保存できませんでした。"]);
        setMessage(data?.rolledBack?"1件で問題が見つかったため、車両保存は全件ロールバックしました。":"まとめ保存できませんでした。");
        const duplicateId=data?.failure?.duplicateVehicleId;
        if(duplicateId && failed){
          updateItem(failed.importId,{action:"UPDATE_EXISTING",targetVehicleId:String(duplicateId)});
        }
        return;
      }

      setMessage(`${data?.appliedCount||targets.length}台をまとめて車両登録しました。`);
      window.setTimeout(()=>location.assign("/customer-vehicles"),700);
    }catch(error:any){
      setErrors([error?.message||String(error)]);
      setMessage("車両まとめ保存エラー。保存は完了していません。");
    }finally{
      setBusy(false);
    }
  }

  const saveCount=items.filter(x=>x.include).length;

  return <main className="bulkVehiclePage">
    <header className="top">
      <button onClick={()=>location.assign("/vehicle-workflow")}>← 1台読取へ</button>
      <div><b>複数PDF 車両登録</b><span>PDFをまとめて解析・重複確認・保存</span></div>
      <strong>icb</strong>
    </header>

    <section className="card hero">
      <div>
        <div className="eyebrow">車検証PDF 一括取込</div>
        <h1>複数台まとめて登録</h1>
        <p>PDFを複数選ぶだけで1台ずつ解析します。既存車と一致する場合は更新候補、新規なら新規候補として表示します。</p>
      </div>
      <input ref={fileRef} hidden type="file" multiple accept="application/pdf,.pdf" onChange={(e)=>e.target.files&&void processFiles(e.target.files)} />
      <button className="primary" disabled={busy} onClick={()=>fileRef.current?.click()}>📄 PDFを複数選択</button>
      <div className="notice">{busy?(progress||"処理中…"):message}</div>
      {!!errors.length&&<div className="errors"><b>確認してください</b>{errors.map((x,i)=><div key={i}>・{x}</div>)}</div>}
    </section>

    {!!items.length&&<section className="card">
      <div className="sectionHead"><h2>解析結果</h2><strong>{items.length}件 / 保存対象 {saveCount}件</strong></div>
      <div className="legend">○ 自動候補　△ 要確認　□ 個別高精度読取推奨</div>
      <div className="reviewList">
        {items.map((item,index)=>{
          const status=item.quality==="ready"?"ready":item.quality==="review"?"review":"weak";
          return <article className={`reviewItem ${status}`} key={item.importId||item.fileName+"-"+index}>
            <div className="itemHead">
              <label className="include"><input type="checkbox" checked={item.include} disabled={!item.importId} onChange={(e)=>updateItem(item.importId,{include:e.target.checked})} />保存対象</label>
              <div className="fileTitle"><b>{index+1}. {item.fileName}</b><small>PDF {item.pageCount}ページ / 車検証候補 {item.pageNumber}ページ目</small></div>
              <strong>{item.quality==="ready"?"○ 自動候補":item.quality==="review"?"△ 要確認":"□ 個別読取推奨"}</strong>
            </div>
            <div className="reason">{item.reason}</div>

            <div className="fieldGrid">
              <label>登録番号<input value={field(item,"registration_number")} onChange={(e)=>{const value=e.target.value;updateField(item.importId,"registration_number",value);const last=value.match(/(\d{4})(?!.*\d)/)?.[1]||"";updateField(item.importId,"registration_last4",last);}} /></label>
              <label>下4桁<input value={field(item,"registration_last4")} maxLength={4} onChange={(e)=>updateField(item.importId,"registration_last4",e.target.value.replace(/\D/g,"").slice(-4))} /></label>
              <label>車台番号<input value={field(item,"chassis_number")} onChange={(e)=>updateField(item.importId,"chassis_number",e.target.value)} /></label>
              <label>型式<input value={field(item,"model_code")||field(item,"model")} onChange={(e)=>{updateField(item.importId,"model_code",e.target.value);updateField(item.importId,"model",e.target.value);}} /></label>
              <label>メーカー<input value={field(item,"maker")} onChange={(e)=>updateField(item.importId,"maker",e.target.value)} /></label>
              <label>燃料<input value={field(item,"fuel_type")} onChange={(e)=>updateField(item.importId,"fuel_type",e.target.value)} /></label>
              <label>車両重量<input inputMode="numeric" value={field(item,"vehicle_weight")} onChange={(e)=>updateField(item.importId,"vehicle_weight",e.target.value.replace(/[^0-9.]/g,""))} /></label>
              <label>初度登録<input value={field(item,"first_registration")} onChange={(e)=>updateField(item.importId,"first_registration",e.target.value)} /></label>
              <label className="wide">車検証の使用者名<input value={field(item,"user_name")} onChange={(e)=>updateField(item.importId,"user_name",e.target.value)} /></label>
            </div>

            <div className="decisionGrid">
              <label>保存方法<select value={item.action} disabled={!item.include||!item.importId} onChange={(e)=>updateItem(item.importId,{action:e.target.value as Action})}>
                <option value="">要確認</option>
                <option value="CREATE_VEHICLE">新規車両として登録</option>
                <option value="UPDATE_EXISTING">既存車両を更新</option>
              </select></label>

              {item.action==="UPDATE_EXISTING"&&<label>更新する車両<select value={item.targetVehicleId} onChange={(e)=>updateItem(item.importId,{targetVehicleId:e.target.value})}>
                <option value="">既存車両を選択</option>
                {item.vehicleCandidates.map(v=><option key={v.vehicle_id} value={v.vehicle_id}>{Math.round(Number(v.score)*100)}% / {vehicleCandidateLabel(v.vehicle_id)}</option>)}
                {item.targetVehicleId&&!item.vehicleCandidates.some(v=>v.vehicle_id===item.targetVehicleId)&&<option value={item.targetVehicleId}>{vehicleCandidateLabel(item.targetVehicleId)}</option>}
              </select></label>}

              <label>顧客紐付け<select value={item.customerId} onChange={(e)=>updateItem(item.importId,{customerId:e.target.value})}>
                <option value="">未割当のまま</option>
                {item.customerCandidates.map(c=><option key={c.customer_id} value={c.customer_id}>{Math.round(Number(c.score)*100)}% / {customerCandidateLabel(c.customer_id)}</option>)}
              </select></label>
            </div>

            {item.vehicleCandidates.length>0&&<div className="matchInfo">既存車候補：{item.vehicleCandidates.slice(0,3).map(v=><span key={v.vehicle_id}>{Math.round(Number(v.score)*100)}% {vehicleCandidateLabel(v.vehicle_id)}</span>)}</div>}
            {item.quality==="image_pdf"&&<div className="weakNote">このPDFは文字レイヤーが弱いため自動保存対象から外しています。既存の1台用高精度読取で確認してください。</div>}
          </article>;
        })}
      </div>
      <button className="saveAll" disabled={busy||saveCount===0} onClick={()=>void saveBatch()}>保存対象 {saveCount}台をまとめて登録</button>
      <small className="safeNote">1件でも重複・入力不足があれば全件ロールバックします。要確認PDFは保存対象から外して、確実な車両だけ先に登録できます。</small>
    </section>}

    <style jsx global>{`
      *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}
      .bulkVehiclePage{max-width:1080px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:11px;color:#718096}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 12px;font-weight:800}
      .card{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:17px;margin-bottom:12px}.hero h1{font-size:30px;margin:3px 0}.hero p{color:#5d6878;line-height:1.6}.eyebrow{color:#2674e8;font-weight:900}.primary,.saveAll{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.primary{width:100%;padding:14px}.notice{margin-top:10px;background:#eef6ff;border-radius:11px;padding:11px;color:#49627e}.errors{margin-top:10px;background:#fff0ef;border:1px solid #efb4af;border-radius:11px;padding:10px;color:#9a362f}
      .sectionHead{display:flex;justify-content:space-between;align-items:center;gap:10px}.legend{margin:8px 0;color:#718096;font-size:12px}.reviewList{display:grid;gap:10px}.reviewItem{border:2px solid #cfe2d4;border-radius:14px;padding:12px;background:#fbfffc}.reviewItem.review{border-color:#e7ca81;background:#fffdf6}.reviewItem.weak{border-color:#cbd4df;background:#f8fafc}.itemHead{display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:center}.include{display:flex;gap:5px;font-size:11px;font-weight:900}.fileTitle{display:grid}.fileTitle small{color:#718096}.reason{margin:8px 0;padding:7px 9px;border-radius:9px;background:#f1f5f9;color:#5f6c7c;font-size:12px}
      .fieldGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.fieldGrid label,.decisionGrid label{display:grid;gap:4px;font-size:11px;font-weight:800;color:#5f6c7c}.fieldGrid input,.decisionGrid select{width:100%;border:1px solid #cbd6e3;border-radius:9px;padding:9px;background:#fff}.wide{grid-column:1/-1}.decisionGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:9px}.matchInfo{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.matchInfo span{font-size:10px;border-radius:999px;padding:4px 7px;background:#eef4ff;color:#315f9f}.weakNote{margin-top:8px;background:#fff5e9;border-radius:9px;padding:8px;color:#8b5a1f;font-size:12px}.saveAll{width:100%;margin-top:12px;padding:14px}.safeNote{display:block;margin-top:7px;color:#718096}
      @media(max-width:820px){.fieldGrid{grid-template-columns:1fr 1fr}.decisionGrid{grid-template-columns:1fr}.itemHead{grid-template-columns:auto 1fr}.itemHead>strong{grid-column:1/-1}}@media(max-width:520px){.top>div span{display:none}.fieldGrid{grid-template-columns:1fr}.wide{grid-column:auto}}
    `}</style>
  </main>;
}
