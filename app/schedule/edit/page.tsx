/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { safeActionError } from "../../lib/client-security";

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
  print_time_mode:string;
};

type WorkOrder = {
  id:string;
  reason:string;
  worker_staff_id:string|null;
  worker_name:string|null;
  outsource_vendor_id:string|null;
  outsource_vendor_name:string|null;
  stay_reason:string|null;
  planned_delivery_date:string|null;
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

const LABEL:Record<string,string>={delivery:"納車",pickup:"引取",customer_visit:"来社",onsite_repair:"出張"};
const STAY_REASON_SUGGESTIONS=["部品待ち","外注作業待ち","見積確認待ち","お客様連絡待ち","作業待ち"];

export default function ScheduleEditPage(){
  const [entry,setEntry]=useState<Entry|null>(null);
  const [day,setDay]=useState("");
  const [options,setOptions]=useState<TimeOption[]>([]);
  const [selected,setSelected]=useState("");
  const [stayReason,setStayReason]=useState("");
  const [plannedDeliveryDate,setPlannedDeliveryDate]=useState("");
  const [reason,setReason]=useState("");
  const [staffMembers,setStaffMembers]=useState<StaffMember[]>([]);
  const [staffId,setStaffId]=useState("");
  const [vendors,setVendors]=useState<ExternalVendor[]>([]);
  const [vendorId,setVendorId]=useState("");
  const [vendorName,setVendorName]=useState("");
  const [message,setMessage]=useState("予約情報を読み込みます。");
  const [warnings,setWarnings]=useState<string[]>([]);
  const [busy,setBusy]=useState(true);

  const id=typeof window!=="undefined" ? new URLSearchParams(location.search).get("id") : null;

  useEffect(()=>{
    void loadAssignments();
    if(id) void loadEntry(id); else { setBusy(false); setMessage("変更する予定が指定されていません。"); }
  },[]);

  async function loadAssignments(){
    const [staffRes,vendorRes]=await Promise.all([
      supabase.from("staff_members").select("id,display_name,short_name").eq("is_active",true).order("display_order",{ascending:true}).order("display_name",{ascending:true}),
      supabase.from("external_vendors").select("id,display_name,short_name").eq("is_active",true).order("display_order",{ascending:true}).order("display_name",{ascending:true}),
    ]);
    if(!staffRes.error) setStaffMembers((staffRes.data||[]) as StaffMember[]);
    if(!vendorRes.error) setVendors((vendorRes.data||[]) as ExternalVendor[]);
  }

  async function loadEntry(entryId:string){
    setBusy(true);
    const {data,error}=await supabase.from("schedule_entries")
      .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode")
      .eq("id",entryId).single();
    if(error){setMessage(safeActionError("予定の読み込み", error));setBusy(false);return;}
    const e=data as Entry;
    setEntry(e);
    if(e.work_order_id){
      const {data:workData,error:workError}=await supabase.from("work_orders")
        .select("id,reason,worker_staff_id,worker_name,outsource_vendor_id,outsource_vendor_name,stay_reason,planned_delivery_date")
        .eq("id",e.work_order_id).maybeSingle();
      if(workError){setMessage("作業情報の読み込みエラー: "+workError.message);setBusy(false);return;}
      const work=(workData||null) as WorkOrder|null;
      setReason(work?.reason||"");
      setStaffId(work?.worker_staff_id||"");
      setVendorId(work?.outsource_vendor_id||"");
      setVendorName(work?.outsource_vendor_id ? "" : (work?.outsource_vendor_name||""));
      setStayReason(work?.stay_reason||"");
      setPlannedDeliveryDate(work?.planned_delivery_date||"");
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
    if(error){setMessage(safeActionError("時間候補の読み込み", error));return;}
    const opts=(Array.isArray(data?.options)?data.options:[]) as TimeOption[];
    setOptions(opts);
    const current=timeKey(base.starts_at);
    const sameDay=dateKey(base.starts_at)===targetDay;
    const match=sameDay ? opts.find(x=>x.label===current) : null;
    setSelected(match?.key || opts[0]?.key || "");
  }

  async function changeDay(next:string){
    setDay(next);
    if(entry) await loadOptions(next,entry);
  }

  const selectedOption=useMemo(()=>options.find(x=>x.key===selected)||null,[options,selected]);

  async function saveWorkDetails(){
    if(!entry?.work_order_id) return;
    const {error}=await supabase.from("work_orders").update({
      stay_reason:stayReason.trim()||null,
      planned_delivery_date:plannedDeliveryDate||null,
    }).eq("id",entry.work_order_id);
    if(error) throw error;

    const {error:assignmentError}=await supabase.rpc("set_work_order_assignment",{
      p_work_order_id:entry.work_order_id,
      p_staff_id:staffId||null,
      p_vendor_id:reason==="板金塗装" ? (vendorId||null) : null,
      p_vendor_name:reason==="板金塗装" ? (vendorName.trim()||null) : null,
      p_actor:"schedule-edit",
    });
    if(assignmentError) throw assignmentError;
  }

  async function save(override=false){
    if(!entry){return;}
    if(entry.entry_type!=="onsite_repair" && !selectedOption){
      setMessage("変更先の時間を選択してください。");return;
    }
    setBusy(true);
    setWarnings([]);
    try{
      let startsAt:string;
      let endsAt:string;
      let mode:string;
      if(selectedOption){
        startsAt=selectedOption.startsAt; endsAt=selectedOption.endsAt; mode=selectedOption.mode;
      }else{
        const currentTime=timeKey(entry.starts_at);
        const duration=new Date(entry.ends_at).getTime()-new Date(entry.starts_at).getTime();
        startsAt=new Date(day+"T"+currentTime+":00+09:00").toISOString();
        endsAt=new Date(new Date(startsAt).getTime()+duration).toISOString();
        mode=entry.print_time_mode;
      }
      const {data,error}=await supabase.rpc("reschedule_schedule_entry",{
        p_entry_id:entry.id,
        p_starts_at:startsAt,
        p_ends_at:endsAt,
        p_print_time_mode:mode,
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
        await saveWorkDetails();
        setMessage("予約と滞留情報を変更しました。予約変更は履歴にも保存しました。");
        window.setTimeout(()=>location.assign("/schedule?day="+day),350);
      }
    }catch(error:any){
      setMessage(safeActionError("予約変更", error));
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
        <div className="current">現在：<b>{dateKey(entry.starts_at)} {timeKey(entry.starts_at)}</b></div>
        <div className="grid">
          <label>変更日<input type="date" value={day} onChange={(e)=>void changeDay(e.target.value)} /></label>
          {entry.entry_type!=="onsite_repair" && <label>変更時間
            <select value={selected} onChange={(e)=>setSelected(e.target.value)}>
              {!options.length && <option value="">候補なし</option>}
              {options.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>}
        </div>
        {entry.work_order_id && <section className="stayBox">
          <b>担当・外注先</b>
          <div className="grid stayGrid">
            <label>作業担当
              <select value={staffId} onChange={(e)=>setStaffId(e.target.value)}>
                <option value="">未選択</option>
                {staffMembers.map(staff=><option key={staff.id} value={staff.id}>{staff.short_name||staff.display_name}</option>)}
              </select>
            </label>
            {reason==="板金塗装" && <label>外注先
              <select value={vendorId} onChange={(e)=>{setVendorId(e.target.value);if(e.target.value)setVendorName("");}}>
                <option value="">未選択 / 直接入力</option>
                {vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.short_name||vendor.display_name}</option>)}
              </select>
            </label>}
            {reason==="板金塗装" && !vendorId && <label>外注先名（直接入力）
              <input value={vendorName} onChange={(e)=>setVendorName(e.target.value)} placeholder="例：○○鈑金" />
            </label>}
          </div>
          <div className="manageLinks">
            <button type="button" onClick={()=>location.assign("/settings/staff")}>社員名を管理</button>
            {reason==="板金塗装" && <button type="button" onClick={()=>location.assign("/settings/vendors")}>外注先を管理</button>}
          </div>
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
        <button className="primary" disabled={busy} onClick={()=>void save(false)}>この内容で変更</button>
      </>}
    </section>
    <style jsx global>{`
      *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}
      .editPage{max-width:760px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.top button,button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 13px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:20px}.eyebrow{color:#2674e8;font-weight:800}h1{margin:4px 0 12px}.notice{background:#eef6ff;border-radius:12px;padding:11px;color:#48627f}.current{margin:14px 0;background:#f7f9fc;padding:12px;border-radius:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid label{display:grid;gap:5px;font-weight:800;color:#627083}.grid input,.grid select{border:1px solid #cbd6e3;border-radius:10px;padding:12px;background:#fff}.stayBox{margin-top:14px;padding:14px;border:1px solid #dbe3ed;border-radius:14px;background:#fafcff}.stayGrid{margin-top:9px}.stayBox small{display:block;margin-top:7px;color:#7a8798}.primary{margin-top:14px;background:#2f6fe4;color:#fff;border-color:#2f6fe4;width:100%;padding:13px}.warnings{margin-top:12px;background:#fff7e8;border:1px solid #e7c27d;border-radius:12px;padding:12px;color:#7c560d}.warnings button{margin-top:8px}.manageLinks{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.manageLinks button{padding:8px 10px}@media(max-width:600px){.grid{grid-template-columns:1fr}}
    `}</style>
  </main>;
}
