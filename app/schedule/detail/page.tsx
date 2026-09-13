/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { safeActionError } from "../../lib/client-security";

type Entry = {
  id:string;
  vehicle_id:string|null;
  work_order_id:string|null;
  entry_type:"delivery"|"pickup"|"customer_visit"|"onsite_repair";
  starts_at:string;
  ends_at:string;
  notes:string|null;
  print_time_mode:string|null;
  print_time_label_override:string|null;
};

type WorkOrder = {
  id:string;
  vehicle_id:string;
  reason:string;
  status:string;
  worker_name:string|null;
  outsource_vendor_name:string|null;
  notes:string|null;
  work_completed:boolean;
  planned_delivery_date:string|null;
  is_urgent:boolean;
  needs_loaner:boolean;
  is_waiting_service:boolean;
};

type Vehicle = {
  id:string;
  customer_id:string|null;
  registration_number:string|null;
  registration_number_last4:string|null;
  vehicle_number:string|null;
  maker:string|null;
  model:string|null;
  vehicle_type:string|null;
  model_code:string|null;
  chassis_number:string|null;
};

type Customer = {
  id:string;
  name:string;
  company_name:string|null;
  schedule_display_name:string|null;
  phone:string|null;
};

const ENTRY_LABEL:Record<string,string>={
  pickup:"引取",
  customer_visit:"来社",
  onsite_repair:"出張",
  delivery:"納車",
};

function customerLabel(customer:Customer|null){
  return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
}

function naturalLast4(value:string|null|undefined){
  const raw=(value||"").trim();
  if(!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function dateLabel(value:string){
  return new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"numeric",day:"numeric",weekday:"short",
  }).format(new Date(value));
}

function timeLabel(entry:Entry|null){
  if(!entry) return "未登録";
  if(entry.print_time_label_override) return entry.print_time_label_override;
  if(entry.print_time_mode==="morning") return "A中";
  if(entry.print_time_mode==="unspecified") return "中";
  return new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false,
  }).format(new Date(entry.starts_at));
}

function workStateLabel(work:WorkOrder|null){
  if(!work) return "作業未実施";
  if(work.work_completed || work.status==="completed") return "作業完了";
  if(work.status==="in_progress") return "作業中";
  return "作業未実施";
}

export default function ScheduleDetailPage(){
  const [entry,setEntry]=useState<Entry|null>(null);
  const [entries,setEntries]=useState<Entry[]>([]);
  const [work,setWork]=useState<WorkOrder|null>(null);
  const [vehicle,setVehicle]=useState<Vehicle|null>(null);
  const [customer,setCustomer]=useState<Customer|null>(null);
  const [message,setMessage]=useState("予定・車両情報を読み込みます。");
  const [busy,setBusy]=useState(true);
  const [workStateBusy,setWorkStateBusy]=useState(false);

  useEffect(()=>{
    const id=new URLSearchParams(location.search).get("entry");
    if(!id){
      setBusy(false);
      setMessage("表示する予定が指定されていません。");
      return;
    }
    void loadDetail(id);
  },[]);

  async function loadDetail(id:string){
    setBusy(true);
    try{
      const {data:entryData,error:entryError}=await supabase
        .from("schedule_entries")
        .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,notes,print_time_mode,print_time_label_override")
        .eq("id",id)
        .maybeSingle();
      if(entryError) throw entryError;
      const current=(entryData||null) as Entry|null;
      if(!current){
        setMessage("予定が見つかりません。");
        setBusy(false);
        return;
      }
      setEntry(current);

      let workOrder:WorkOrder|null=null;
      let scheduleSet:Entry[]=[current];

      if(current.work_order_id){
        const [{data:workData,error:workError},{data:setData,error:setError}]=await Promise.all([
          supabase.from("work_orders")
            .select("id,vehicle_id,reason,status,worker_name,outsource_vendor_name,notes,work_completed,planned_delivery_date,is_urgent,needs_loaner,is_waiting_service")
            .eq("id",current.work_order_id)
            .maybeSingle(),
          supabase.from("schedule_entries")
            .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,notes,print_time_mode,print_time_label_override")
            .eq("work_order_id",current.work_order_id)
            .order("starts_at",{ascending:true}),
        ]);
        if(workError) throw workError;
        if(setError) throw setError;
        workOrder=(workData||null) as WorkOrder|null;
        scheduleSet=((setData||[]) as Entry[]);
      }

      setWork(workOrder);
      setEntries(scheduleSet);

      const vehicleId=current.vehicle_id || workOrder?.vehicle_id || scheduleSet.find(x=>x.vehicle_id)?.vehicle_id || null;
      if(vehicleId){
        const {data:vehicleData,error:vehicleError}=await supabase
          .from("vehicles")
          .select("id,customer_id,registration_number,registration_number_last4,vehicle_number,maker,model,vehicle_type,model_code,chassis_number")
          .eq("id",vehicleId)
          .maybeSingle();
        if(vehicleError) throw vehicleError;
        const v=(vehicleData||null) as Vehicle|null;
        setVehicle(v);

        if(v?.customer_id){
          const {data:customerData,error:customerError}=await supabase
            .from("customers")
            .select("id,name,company_name,schedule_display_name,phone")
            .eq("id",v.customer_id)
            .maybeSingle();
          if(customerError) throw customerError;
          setCustomer((customerData||null) as Customer|null);
        }
      }

      setMessage("予定・車両詳細");
    }catch(error:any){
      setMessage(safeActionError("予定・車両詳細の読み込み",error));
    }finally{
      setBusy(false);
    }
  }

  async function advanceWorkState(){
    if(!work || workStateBusy) return;
    setWorkStateBusy(true);
    try{
      if(work.work_completed || work.status==="completed"){
        const {data,error}=await supabase.rpc("reopen_work_order",{
          p_work_order_id:work.id,
          p_actor:"schedule",
        });
        if(error) throw error;
        setWork({...work,work_completed:false,status:data?.status || "scheduled"});
        setMessage("作業未実施へ戻しました。");
        return;
      }

      if(work.status==="in_progress"){
        const {data,error}=await supabase.rpc("complete_work_order_one_tap",{
          p_work_order_id:work.id,
          p_actor:"schedule",
        });
        if(error) throw error;
        setWork({...work,work_completed:true,status:data?.status || "completed"});
        setMessage("作業完了にしました。");
        return;
      }

      const {data,error}=await supabase.rpc("set_work_order_progress_state",{
        p_work_order_id:work.id,
        p_state:"in_progress",
        p_actor:"schedule",
      });
      if(error) throw error;
      setWork({...work,work_completed:false,status:data?.status || "in_progress"});
      setMessage("作業中にしました。");
    }catch(error:any){
      setMessage(safeActionError("作業状態の保存",error));
    }finally{
      setWorkStateBusy(false);
    }
  }

  const inboundEntry=useMemo(
    ()=>entries.find(x=>x.entry_type==="pickup" || x.entry_type==="customer_visit" || x.entry_type==="onsite_repair") || (entry?.entry_type!=="delivery" ? entry : null),
    [entries,entry]
  );
  const deliveryEntry=useMemo(
    ()=>entries.find(x=>x.entry_type==="delivery") || (entry?.entry_type==="delivery" ? entry : null),
    [entries,entry]
  );
  const actionEntry=inboundEntry || entry;

  const noteText=useMemo(()=>{
    const notes=[
      work?.notes?.trim() || "",
      ...entries.map(x=>x.notes?.trim() || ""),
    ].filter(Boolean);
    return [...new Set(notes)].join("\n");
  },[work,entries]);

  const numberInfo=[
    vehicle?.registration_number || "",
    naturalLast4(vehicle?.registration_number_last4) ? `下4桁 ${naturalLast4(vehicle?.registration_number_last4)}` : "",
  ].filter(Boolean).join(" / ") || "未登録";

  const vehicleName=[vehicle?.maker,vehicle?.model || vehicle?.vehicle_type].filter(Boolean).join(" ") || "未登録";
  const currentWorkState=workStateLabel(work);
  const workStateActionLabel=currentWorkState==="作業完了"
    ? "作業未実施へ戻す"
    : currentWorkState==="作業中"
      ? "作業完了にする"
      : "作業中にする";

  function rememberActiveVehicle(){
    if(!vehicle) return false;
    const snapshot={
      id:vehicle.id,
      number:vehicle.vehicle_number || "",
      registration:vehicle.registration_number || "",
      last4:vehicle.registration_number_last4 || "",
      chassis:vehicle.chassis_number || "",
      model:vehicle.model || vehicle.vehicle_type || "",
    };
    try{sessionStorage.setItem("parts-active-vehicle",JSON.stringify(snapshot));}catch{}
    try{localStorage.setItem("parts-active-vehicle",JSON.stringify(snapshot));}catch{}
    return true;
  }

  function callCustomer(){
    const phone=customer?.phone?.replace(/[^\d+]/g,"") || "";
    if(!phone) return;
    location.href=`tel:${phone}`;
  }

  function openVehicleTool(path:string){
    if(!rememberActiveVehicle()) return;
    location.assign(path);
  }

  function openVehicleHistory(kind:"history"|"photos"){
    if(!vehicle) return;
    rememberActiveVehicle();
    location.assign(`/customer-vehicles/${kind}?vehicle=${encodeURIComponent(vehicle.id)}`);
  }

  function openVehicleScopedTool(path:string){
    if(!vehicle) return;
    rememberActiveVehicle();
    location.assign(`${path}?vehicle=${encodeURIComponent(vehicle.id)}`);
  }

  function openOneDaySchedule(){
    const source=inboundEntry || entry;
    if(!source) return;
    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(source.starts_at));
    location.assign(`/schedule?day=${day}`);
  }

  function openInspection(){
    if(!work || !vehicle || (work.reason!=="点検" && work.reason!=="車検")) return;
    rememberActiveVehicle();
    location.assign(`/inspection?workOrderId=${encodeURIComponent(work.id)}`);
  }

  return (
    <main className="detailPage">
      <header className="top">
        <div className="topBackActions"><button onClick={()=>history.back()}>← 戻る</button><button onClick={openOneDaySchedule} disabled={!entry}>1日の予定</button></div>
        <strong>予定・車両詳細</strong>
        <b>icb</b>
      </header>

      <section className="card">
        <div className="headline">
          <div>
            <small>{busy ? "読み込み中…" : message}</small>
            <h1>{customerLabel(customer)}</h1>
          </div>
          <button
            type="button"
            className={`state stateButton ${currentWorkState==="作業完了"?"done":currentWorkState==="作業中"?"running":"pending"}`}
            disabled={!work || workStateBusy}
            onClick={()=>void advanceWorkState()}
            aria-label={workStateActionLabel}
            title={`${currentWorkState} → ${workStateActionLabel}`}
          >
            {workStateBusy ? "保存中…" : currentWorkState}
          </button>
        </div>

        {entry && (
          <>
            <section className="section">
              <h2>お客様・車両</h2>
              <div className="infoGrid">
                <div><span>お客様名</span><b>{customerLabel(customer)}</b></div>
                <div><span>電話番号</span><b>{customer?.phone || "未登録"}</b>{customer?.phone && <button type="button" className="phoneButton" onClick={callCustomer}>電話する</button>}</div>
                <div><span>ナンバー情報</span><b>{numberInfo}</b></div>
                <div><span>車種</span><b>{vehicleName}</b></div>
                <div><span>型式</span><b>{vehicle?.model_code || "未登録"}</b></div>
                <div className="wide"><span>車台番号</span><b>{vehicle?.chassis_number || "未登録"}</b></div>
              </div>
            </section>

            <section className="section">
              <h2>今回の入庫予定</h2>
              <div className="infoGrid">
                <div><span>入庫日</span><b>{inboundEntry ? dateLabel(inboundEntry.starts_at) : "未登録"}</b></div>
                <div><span>入庫時間</span><b>{timeLabel(inboundEntry)}</b></div>
                <div><span>入庫区分</span><b>{inboundEntry ? ENTRY_LABEL[inboundEntry.entry_type] || inboundEntry.entry_type : "未登録"}</b></div>
                <div><span>入庫要因</span><b>{work?.reason || "未登録"}</b></div>
                <div><span>納車予定日</span><b>{deliveryEntry ? dateLabel(deliveryEntry.starts_at) : (work?.planned_delivery_date || "未登録")}</b></div>
                <div><span>納車予定時間</span><b>{timeLabel(deliveryEntry)}</b></div>
                <div><span>担当者</span><b>{work?.worker_name || "未設定"}</b></div>
                <div><span>作業状態</span><b>{currentWorkState}</b></div>
                <div><span>作業待ち</span><b>{work?.is_waiting_service ? "あり" : "なし"}</b></div>
                <div><span>代車</span><b>{work?.needs_loaner ? "必要" : "不要"}</b></div>
                <div><span>優先</span><b>{work?.is_urgent ? "急ぎ" : "通常"}</b></div>
                <div><span>外注先</span><b>{work?.outsource_vendor_name || "自社作業"}</b></div>
              </div>
            </section>

            <section className="section">
              <h2>備考</h2>
              <div className="notes">{noteText || "備考なし"}</div>
            </section>

            {vehicle && (
              <section className="section">
                <h2>この車両で続ける</h2>
                <div className="toolActions">
                  <button onClick={()=>openVehicleTool("/schedule/active")}>次回予定登録</button>
                  <button onClick={()=>openVehicleTool("/customer-vehicles")}>顧客・車両情報</button>
                  <button onClick={()=>openVehicleTool("/parts-data")}>部品データ</button>
                  <button onClick={()=>openVehicleHistory("history")}>車両履歴</button>
                  <button onClick={()=>openVehicleHistory("photos")}>写真履歴</button>
                  <button onClick={()=>openVehicleScopedTool("/customer-vehicles/lease-maintenance")}>リースメンテ契約</button>
                  {work && (work.reason==="点検" || work.reason==="車検") && (
                    <button onClick={openInspection}>点検記録簿</button>
                  )}
                </div>
              </section>
            )}

            {actionEntry && (
              <div className="actions">
                <button className="edit" onClick={()=>location.assign("/schedule/edit?id="+encodeURIComponent(actionEntry.id))}>予約変更</button>
                <button className="cancel" onClick={()=>location.assign("/schedule/edit?id="+encodeURIComponent(actionEntry.id)+"&mode=cancel")}>予約取消</button>
              </div>
            )}
          </>
        )}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit}
        .detailPage{max-width:820px;margin:0 auto;padding:14px 12px 44px}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.top button,.actions button{border:1px solid #ccd7e5;background:#fff;border-radius:11px;padding:10px 12px;font-weight:900}.top button{color:#2674e8}.card{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:18px}.headline{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.headline small{color:#718096}.headline h1{font-size:26px;margin:3px 0 0}.state{border-radius:999px;padding:6px 9px;font-size:12px;font-weight:900;white-space:nowrap}.stateButton{border:0;cursor:pointer;min-height:34px}.stateButton:disabled{cursor:default;opacity:.65}.state.pending{background:#f0f2f5;color:#657180}.state.running{background:#fff0d8;color:#9a5d00}.state.done{background:#e9f7ef;color:#176b37}.section{border-top:1px solid #e7ecf2;margin-top:14px;padding-top:13px}.section h2{font-size:15px;margin:0 0 9px}.infoGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.infoGrid>div{display:grid;gap:3px;border:1px solid #e0e6ef;background:#fafbfd;border-radius:11px;padding:10px}.infoGrid>div.wide{grid-column:1/-1}.infoGrid span{font-size:10px;color:#6b7788;font-weight:800}.infoGrid b{font-size:14px;word-break:break-word}.notes{white-space:pre-wrap;border:1px solid #e0e6ef;background:#fffdf5;border-radius:11px;padding:11px;min-height:44px;font-size:13px;line-height:1.5}.toolActions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.toolActions button{border:1px solid #cbd7e7;background:#f8fbff;color:#205fbf;border-radius:11px;padding:11px 8px;font-weight:900}.actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}.actions .edit{background:#2f6fe4;border-color:#2f6fe4;color:#fff}.actions .cancel{background:#fff8f7;border-color:#e4a39d;color:#b42318}
        @media(max-width:600px){.detailPage{padding:7px 6px 28px}.top{margin-bottom:5px}.top button{padding:6px 8px;font-size:10px}.top strong,.top b{font-size:11px}.card{border-radius:12px;padding:10px}.headline h1{font-size:18px}.headline small{font-size:9px}.state{font-size:9px;padding:4px 6px}.stateButton{min-height:40px}.section{margin-top:9px;padding-top:8px}.section h2{font-size:12px;margin-bottom:5px}.infoGrid{gap:5px}.infoGrid>div{padding:7px;border-radius:8px}.infoGrid span{font-size:8px}.infoGrid b{font-size:11px}.notes{font-size:10px;padding:8px;min-height:36px}.toolActions{gap:6px}.toolActions button{min-height:44px;padding:8px 5px;font-size:12px}.actions{gap:6px;margin-top:10px}.actions button{min-height:44px;padding:8px 5px;font-size:13px}}
      `}</style>
    </main>
  );
}
