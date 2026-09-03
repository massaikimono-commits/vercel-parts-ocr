/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type TimeOption = {
  key:string;
  label:string;
  mode:"exact"|"morning"|"unspecified";
  startsAt:string;
  endsAt:string;
};

type Entry = {
  id:string;
  vehicle_id:string|null;
  work_order_id:string|null;
  entry_type:"delivery"|"pickup"|"customer_visit"|"onsite_repair";
  starts_at:string;
  ends_at:string;
  print_time_mode:"exact"|"morning"|"unspecified";
};

type WorkOrder = {
  id:string;
  stay_reason:string|null;
  planned_delivery_date:string|null;
  worker_staff_id:string|null;
  worker_name:string|null;
  outsource_vendor_id:string|null;
  outsource_vendor_name:string|null;
};

type StaffMember = {
  id:string;
  display_name:string;
  short_name:string|null;
};

type ExternalVendor = {
  id:string;
  display_name:string;
  short_name:string|null;
};

function dateKey(value:string){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
}

function timeKey(value:string){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
}

function flexibleTimeLabel(entryType:Entry["entry_type"],mode:Entry["print_time_mode"],startsAt:string){
  if(mode==="exact") return timeKey(startsAt);
  if(entryType==="delivery") return "中";
  if(entryType==="onsite_repair") return mode==="morning" ? "A中" : "中";
  return mode==="morning" ? "A中" : "午後";
}

const LABEL:Record<string,string>={delivery:"納車",pickup:"引取",customer_visit:"来社",onsite_repair:"出張"};
const STAY_REASON_SUGGESTIONS=["部品待ち","外注作業待ち","見積確認待ち","お客様連絡待ち","作業待ち"];

export default function ScheduleEditPage(){
  const [entry,setEntry]=useState<Entry|null>(null);
  const [day,setDay]=useState("");
  const [options,setOptions]=useState<TimeOption[]>([]);
  const [selected,setSelected]=useState("");
  const [onsiteMode,setOnsiteMode]=useState<"exact"|"morning"|"unspecified">("exact");
  const [onsiteTime,setOnsiteTime]=useState("09:00");
  const [stayReason,setStayReason]=useState("");
  const [plannedDeliveryDate,setPlannedDeliveryDate]=useState("");
  const [originalStayReason,setOriginalStayReason]=useState("");
  const [originalPlannedDeliveryDate,setOriginalPlannedDeliveryDate]=useState("");
  const [staffMembers,setStaffMembers]=useState<StaffMember[]>([]);
  const [externalVendors,setExternalVendors]=useState<ExternalVendor[]>([]);
  const [staffId,setStaffId]=useState("");
  const [vendorName,setVendorName]=useState("");
  const [originalStaffId,setOriginalStaffId]=useState("");
  const [originalVendorName,setOriginalVendorName]=useState("");
  const [message,setMessage]=useState("予約情報を読み込みます。");
  const [warnings,setWarnings]=useState<string[]>([]);
  const [cancelConfirmOpen,setCancelConfirmOpen]=useState(false);
  const [cancelReason,setCancelReason]=useState("");
  const [busy,setBusy]=useState(true);

  const id=typeof window!=="undefined" ? new URLSearchParams(location.search).get("id") : null;

  useEffect(()=>{
    void loadAssignmentMasters();
    if(id) void loadEntry(id);
    else { setBusy(false); setMessage("変更する予定が指定されていません。"); }
  },[]);

  async function loadAssignmentMasters(){
    const [staffRes,vendorRes]=await Promise.all([
      supabase.from("staff_members").select("id,display_name,short_name").eq("is_active",true)
        .order("display_order",{ascending:true}).order("display_name",{ascending:true}),
      supabase.from("external_vendors").select("id,display_name,short_name").eq("is_active",true)
        .order("display_order",{ascending:true}).order("display_name",{ascending:true}),
    ]);
    if(!staffRes.error) setStaffMembers((staffRes.data||[]) as StaffMember[]);
    if(!vendorRes.error) setExternalVendors((vendorRes.data||[]) as ExternalVendor[]);
  }

  async function loadEntry(entryId:string){
    setBusy(true);
    const {data,error}=await supabase.from("schedule_entries")
      .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode")
      .eq("id",entryId).single();
    if(error){setMessage("予定の読み込みエラー: "+error.message);setBusy(false);return;}
    const e=data as Entry;
    setEntry(e);
    setOnsiteMode(e.print_time_mode);
    setOnsiteTime(timeKey(e.starts_at));
    if(e.work_order_id){
      const {data:workData,error:workError}=await supabase.from("work_orders")
        .select("id,stay_reason,planned_delivery_date,worker_staff_id,worker_name,outsource_vendor_id,outsource_vendor_name")
        .eq("id",e.work_order_id).maybeSingle();
      if(workError){setMessage("作業情報の読み込みエラー: "+workError.message);setBusy(false);return;}
      const work=(workData||null) as WorkOrder|null;
      const loadedStayReason=work?.stay_reason||"";
      const loadedPlannedDeliveryDate=work?.planned_delivery_date||"";
      setStayReason(loadedStayReason);
      setPlannedDeliveryDate(loadedPlannedDeliveryDate);
      setOriginalStayReason(loadedStayReason);
      setOriginalPlannedDeliveryDate(loadedPlannedDeliveryDate);
      const loadedStaffId=work?.worker_staff_id||"";
      const loadedVendorName=work?.outsource_vendor_name||"";
      setStaffId(loadedStaffId);
      setVendorName(loadedVendorName);
      setOriginalStaffId(loadedStaffId);
      setOriginalVendorName(loadedVendorName);
    }
    const d=dateKey(e.starts_at);
    setDay(d);
    await loadOptions(d,e);
    setBusy(false);
  }

  async function loadOptions(targetDay:string,base=entry){
    if(!base) return;
    if(base.entry_type==="onsite_repair"){
      setOptions([]);
      setSelected("");
      return;
    }
    const {data,error}=await supabase.rpc("schedule_time_options",{p_day:targetDay,p_entry_type:base.entry_type});
    if(error){setMessage("時間候補の読み込みエラー: "+error.message);return;}
    const opts=(Array.isArray(data?.options)?data.options:[]) as TimeOption[];
    setOptions(opts);
    const current=timeKey(base.starts_at);
    const match=base.print_time_mode==="exact"
      ? opts.find(x=>x.mode==="exact" && x.label===current)
      : opts.find(x=>x.mode===base.print_time_mode);
    setSelected(match?.key || opts.find(x=>x.mode===base.print_time_mode)?.key || opts[0]?.key || "");
  }

  function resetWarningsForTargetChange(){
    setWarnings([]);
    setMessage("変更先を更新しました。保存時に空き・重複・上限を再確認します。");
  }

  async function changeDay(next:string){
    setDay(next);
    resetWarningsForTargetChange();
    if(entry) await loadOptions(next,entry);
  }

  function changeTime(next:string){
    setSelected(next);
    resetWarningsForTargetChange();
  }

  function changeOnsiteMode(next:"exact"|"morning"|"unspecified"){
    setOnsiteMode(next);
    resetWarningsForTargetChange();
  }

  function changeOnsiteTime(next:string){
    setOnsiteTime(next);
    resetWarningsForTargetChange();
  }

  const selectedOption=useMemo(()=>options.find(x=>x.key===selected)||null,[options,selected]);
  const currentSummary=useMemo(()=>entry
    ? `${dateKey(entry.starts_at)} ${flexibleTimeLabel(entry.entry_type,entry.print_time_mode,entry.starts_at)}`
    : "",[entry]);
  const targetSummary=useMemo(()=>{
    if(!entry||!day) return "";
    if(entry.entry_type==="onsite_repair"){
      const label=onsiteMode==="exact" ? onsiteTime : onsiteMode==="morning" ? "A中" : "中";
      return `${day} ${label}`;
    }
    return selectedOption ? `${day} ${selectedOption.label}` : `${day} 時間候補なし`;
  },[day,entry,onsiteMode,onsiteTime,selectedOption]);
  const scheduleStayChanged=useMemo(()=>{
    if(!entry||!day) return false;
    const scheduleChanged=entry.entry_type==="onsite_repair"
      ? day!==dateKey(entry.starts_at)
        || onsiteMode!==entry.print_time_mode
        || (onsiteMode==="exact" && onsiteTime!==timeKey(entry.starts_at))
      : !!selectedOption && (
          selectedOption.startsAt!==entry.starts_at ||
          selectedOption.endsAt!==entry.ends_at ||
          selectedOption.mode!==entry.print_time_mode
        );
    const stayChanged=entry.work_order_id
      ? stayReason.trim()!==originalStayReason.trim() || plannedDeliveryDate!==originalPlannedDeliveryDate
      : false;
    return scheduleChanged || stayChanged;
  },[day,entry,onsiteMode,onsiteTime,originalPlannedDeliveryDate,originalStayReason,plannedDeliveryDate,selectedOption,stayReason]);

  const assignmentChanged=useMemo(()=>entry?.work_order_id
    ? staffId!==originalStaffId || vendorName.trim()!==originalVendorName.trim()
    : false,
    [entry,originalStaffId,originalVendorName,staffId,vendorName]
  );

  const hasChanges=scheduleStayChanged || assignmentChanged;

  async function cancelReservation(){
    if(!entry || busy) return;
    setBusy(true);
    setWarnings([]);
    try{
      const {data,error}=await supabase.rpc("cancel_schedule_entry_v1",{
        p_entry_id:entry.id,
        p_reason:cancelReason.trim()||null,
        p_actor:"schedule-edit",
      });
      if(error) throw error;

      if(data?.cancelled){
        const rentalNote=data?.rentalCancellationPending
          ? " レンタカーは取消連絡待ちとして残しています。"
          : "";
        setMessage("予約を取り消しました。"+rentalNote);
        window.setTimeout(()=>location.assign("/schedule?day="+day),450);
        return;
      }

      if(data?.rentalCancellationPending || data?.requiresRentalCompanyConfirmation){
        setCancelConfirmOpen(false);
        setMessage("レンタカー会社への取消確認待ちです。確認が完了するまで予約本体は残しています。");
        return;
      }

      setMessage("予約を取り消せませんでした。内容を確認してください。");
    }catch(error:any){
      setMessage("予約取消エラー: "+(error?.message||error));
    }finally{
      setBusy(false);
    }
  }

  async function save(override=false){
    if(!entry){return;}
    if(!hasChanges){
      setWarnings([]);
      setMessage("変更内容がありません。予約は更新していません。");
      return;
    }
    if(scheduleStayChanged && entry.entry_type!=="onsite_repair" && !selectedOption){
      setMessage("変更先の時間を選択してください。");return;
    }
    setBusy(true);
    setWarnings([]);
    try{
      let startsAt:string;
      let endsAt:string;
      let mode:string;
      if(scheduleStayChanged && selectedOption){
        startsAt=selectedOption.startsAt; endsAt=selectedOption.endsAt; mode=selectedOption.mode;
      }else if(scheduleStayChanged){
        const duration=new Date(entry.ends_at).getTime()-new Date(entry.starts_at).getTime();
        const targetTime=onsiteMode==="exact" ? onsiteTime : onsiteMode==="morning" ? "09:00" : "13:00";
        startsAt=new Date(day+"T"+targetTime+":00+09:00").toISOString();
        endsAt=new Date(new Date(startsAt).getTime()+duration).toISOString();
        mode=onsiteMode;
      }else{
        startsAt=entry.starts_at;
        endsAt=entry.ends_at;
        mode=entry.print_time_mode;
      }

      const matchedVendor=externalVendors.find(v=>v.display_name===vendorName.trim() || v.short_name===vendorName.trim())||null;
      const {data,error}=await supabase.rpc("update_schedule_entry_and_assignment_v1",{
        p_entry_id:entry.id,
        p_starts_at:startsAt,
        p_ends_at:endsAt,
        p_print_time_mode:mode,
        p_stay_reason:entry.work_order_id ? stayReason.trim()||null : null,
        p_planned_delivery_date:entry.work_order_id ? plannedDeliveryDate||null : null,
        p_staff_id:entry.work_order_id ? staffId||null : null,
        p_vendor_id:entry.work_order_id ? matchedVendor?.id||null : null,
        p_vendor_name:entry.work_order_id && !matchedVendor ? vendorName.trim()||null : null,
        p_update_schedule:scheduleStayChanged,
        p_update_assignment:assignmentChanged,
        p_actor:"schedule-edit",
        p_allow_warning_override:override,
      });
      if(error) throw error;
      const hard=Array.isArray(data?.hardErrors)?data.hardErrors.map(String):[];
      const warns=Array.isArray(data?.warnings)?data.warnings.map(String):[];
      if(hard.length){setMessage("変更できません: "+hard.join(" / "));return;}
      if(data?.overrideRequired && !override){
        setWarnings(warns);
        setMessage("重複や上限の警告があります。確認してください。");
        return;
      }
      if(data?.updated){
        const changedParts=[
          scheduleStayChanged ? "予約・滞留情報" : "",
          assignmentChanged ? "担当・外注先" : "",
        ].filter(Boolean).join("と");
        setMessage(changedParts+"を一括変更しました。変更履歴も保存しました。");
        window.setTimeout(()=>location.assign("/schedule?day="+day),350);
      }
    }catch(error:any){
      setMessage("予約変更エラー: "+(error?.message||error));
    }finally{
      setBusy(false);
    }
  }

  return <main className="editPage">
    <header className="top"><button onClick={()=>history.back()}>← 戻る</button><strong>予約変更</strong><b>icb</b></header>
    <section className="card">
      <div className="eyebrow">かんたん予約変更</div>
      <h1>{entry ? LABEL[entry.entry_type] || entry.entry_type : "予約変更"}</h1>
      <div className="notice">{busy?"処理中…":message}</div>
      {entry && <>
        <div className="current">現在：<b>{currentSummary}</b></div>
        <div className="grid">
          <label>変更日<input type="date" value={day} onChange={(e)=>void changeDay(e.target.value)} /></label>
          {entry.entry_type!=="onsite_repair" ? <label>変更時間
            <select value={selected} onChange={(e)=>changeTime(e.target.value)}>
              {!options.length && <option value="">候補なし</option>}
              {options.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label> : <div className="onsiteEdit">
            <b>出張時間</b>
            <div className="onsiteModeButtons">
              <button type="button" className={onsiteMode==="exact"?"selected":""} onClick={()=>changeOnsiteMode("exact")}>時間指定</button>
              <button type="button" className={onsiteMode==="morning"?"selected":""} onClick={()=>changeOnsiteMode("morning")}>A中</button>
              <button type="button" className={onsiteMode==="unspecified"?"selected":""} onClick={()=>changeOnsiteMode("unspecified")}>中</button>
            </div>
            {onsiteMode==="exact" && <input type="time" min="08:30" max="17:00" step="1800" value={onsiteTime} onChange={(e)=>changeOnsiteTime(e.target.value)} />}
          </div>}
        </div>
        <div className="targetPreview">
          <span>変更内容</span>
          <div className="changeRoute"><b>{currentSummary}</b><strong>→</strong><b>{targetSummary}</b></div>
          <small>{hasChanges ? "「空きチェックして変更」を押すと、更新前に空き・重複・受付上限を確認します。警告がある場合はそのまま変更せず、確認画面を表示します。" : "現在の予約内容と同じです。変更がない限り更新処理は行いません。"}</small>
        </div>
        {entry.work_order_id && <section className="assignmentBox">
          <b>担当・外注先</b>
          <div className="grid assignmentGrid">
            <label>作業担当
              <select value={staffId} onChange={(e)=>setStaffId(e.target.value)}>
                <option value="">未選択</option>
                {staffMembers.map(staff=><option key={staff.id} value={staff.id}>{staff.short_name||staff.display_name}</option>)}
              </select>
            </label>
            <label>外注先
              <input list="edit-external-vendors" value={vendorName} onChange={(e)=>setVendorName(e.target.value)} placeholder="自社作業なら空欄" />
              <datalist id="edit-external-vendors">{externalVendors.map(vendor=><option key={vendor.id} value={vendor.display_name}>{vendor.short_name||vendor.display_name}</option>)}</datalist>
            </label>
          </div>
          <small>担当者・外注先の変更も予約変更と同じ履歴に残します。</small>
        </section>}
        {entry.work_order_id && <section className="stayBox">
          <b>滞留・納車情報</b>
          <div className="grid stayGrid">
            <label>滞留理由
              <input list="stay-reasons" value={stayReason} onChange={(e)=>setStayReason(e.target.value)} placeholder="例：部品待ち" />
              <datalist id="stay-reasons">{STAY_REASON_SUGGESTIONS.map(x=><option key={x} value={x} />)}</datalist>
            </label>
            <label>納車予定日<input type="date" value={plannedDeliveryDate} onChange={(e)=>setPlannedDeliveryDate(e.target.value)} /></label>
          </div>
          <small>候補から選んでも自由入力でも保存できます。</small>
        </section>}
        {!!warnings.length && <div className="warnings"><b>確認が必要</b>{warnings.map((w,i)=><div key={i}>・{w}</div>)}<button onClick={()=>void save(true)}>警告を確認して変更</button></div>}
        <button className="primary" disabled={busy||!hasChanges} onClick={()=>void save(false)}>{hasChanges?"空きチェックして変更":"変更内容なし"}</button>

        <section className="cancelBox">
          {!cancelConfirmOpen ? (
            <button className="cancelOpen" disabled={busy} onClick={()=>setCancelConfirmOpen(true)}>この予約を取り消す</button>
          ) : (
            <div className="cancelConfirm">
              <b>この予約を取り消しますか？</b>
              <small>同じ作業に紐づく入庫・納車予定もまとめて取り消します。作業開始済みの車両は予約取消できません。</small>
              <label>取消理由（任意）
                <input value={cancelReason} onChange={(e)=>setCancelReason(e.target.value)} placeholder="例：お客様都合" />
              </label>
              <div className="cancelActions">
                <button disabled={busy} onClick={()=>setCancelConfirmOpen(false)}>戻る</button>
                <button className="cancelDanger" disabled={busy} onClick={()=>void cancelReservation()}>取消を確定</button>
              </div>
            </div>
          )}
        </section>
      </>}
    </section>
    <style jsx global>{`
      *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}
      .editPage{max-width:760px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.top button,button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 13px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:20px}.eyebrow{color:#2674e8;font-weight:800}h1{margin:4px 0 12px}.notice{background:#eef6ff;border-radius:12px;padding:11px;color:#48627f}.current{margin:14px 0;background:#f7f9fc;padding:12px;border-radius:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid label{display:grid;gap:5px;font-weight:800;color:#627083}.grid input,.grid select{border:1px solid #cbd6e3;border-radius:10px;padding:12px;background:#fff}.onsiteEdit{display:grid;gap:6px;color:#627083}.onsiteModeButtons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.onsiteModeButtons button{padding:9px 7px}.onsiteModeButtons button.selected{background:#2674e8;color:#fff;border-color:#2674e8}.onsiteEdit input{border:1px solid #cbd6e3;border-radius:10px;padding:12px;background:#fff}.targetPreview{margin-top:12px;padding:13px;border:1px solid #c8ddfb;border-radius:13px;background:#f5f9ff;display:grid;gap:7px}.targetPreview span{font-size:12px;font-weight:900;color:#2674e8}.targetPreview b{font-size:16px}.targetPreview small{color:#627083;line-height:1.5}.changeRoute{display:grid;grid-template-columns:1fr auto 1fr;gap:9px;align-items:center}.changeRoute strong{color:#2674e8}.assignmentBox,.stayBox{margin-top:14px;padding:14px;border:1px solid #dbe3ed;border-radius:14px;background:#fafcff}.assignmentGrid,.stayGrid{margin-top:9px}.assignmentBox small,.stayBox small{display:block;margin-top:7px;color:#7a8798}.primary{margin-top:14px;background:#2f6fe4;color:#fff;border-color:#2f6fe4;width:100%;padding:13px}.primary:disabled{background:#aab5c5;border-color:#aab5c5;color:#fff}.warnings{margin-top:12px;background:#fff7e8;border:1px solid #e7c27d;border-radius:12px;padding:12px;color:#7c560d}.warnings button{margin-top:8px}.cancelBox{margin-top:16px;padding-top:14px;border-top:1px solid #e5eaf0}.cancelOpen{width:100%;color:#a83a3a;border-color:#e0a7a7;background:#fff}.cancelConfirm{display:grid;gap:9px;padding:13px;border:1px solid #e4adad;border-radius:13px;background:#fff7f7}.cancelConfirm>b{color:#9d2f2f}.cancelConfirm>small{color:#745f5f;line-height:1.5}.cancelConfirm label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#745f5f}.cancelConfirm input{border:1px solid #d9bcbc;border-radius:9px;padding:10px;background:#fff}.cancelActions{display:flex;justify-content:flex-end;gap:8px}.cancelDanger{background:#b63d3d;color:#fff;border-color:#b63d3d}@media(max-width:600px){.grid{grid-template-columns:1fr}.changeRoute{grid-template-columns:1fr}.changeRoute strong{transform:rotate(90deg);justify-self:start}}
    `}</style>
  </main>;
}