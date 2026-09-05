/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { safeActionError } from "../../lib/client-security";

type TimeOption = {
  key:string;
  label:string;
  displayLabel?:string;
  group?:string;
  mode:"exact"|"morning"|"unspecified";
  startsAt:string;
  endsAt:string;
  durationMinutes?:number;
  availability?:"open"|"warning"|"blocked";
  warnings?:string[];
  hardErrors?:string[];
  conflicts?:number;
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
  vehicle_id?:string;
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

type DeliveryTarget = {
  startsAt:string;
  endsAt:string;
  mode:"exact"|"unspecified";
};

type VehicleSummary = {
  id:string;
  customer_id:string|null;
  registration_number_last4:string|null;
};

type CustomerSummary = {
  id:string;
  name:string;
  company_name:string|null;
  schedule_display_name:string|null;
};

function dateKey(value:string){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
}

function timeKey(value:string){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
}

function jstIso(day:string,time:string){
  return new Date(day+"T"+time+":00+09:00").toISOString();
}

function plusMinutes(iso:string,minutes:number){
  return new Date(new Date(iso).getTime()+minutes*60_000).toISOString();
}

function naturalLast4(value:string|null|undefined){
  const raw=(value||"").trim();
  if(!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function customerSummaryLabel(customer:CustomerSummary|null){
  return customer?.schedule_display_name || customer?.company_name || customer?.name || "お客様未登録";
}

function entrySummaryLabel(entry:Entry|null){
  if(!entry) return "未登録";
  const date=new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",weekday:"short",
  }).format(new Date(entry.starts_at));
  if(entry.print_time_mode==="morning") return `${LABEL[entry.entry_type]||entry.entry_type} ${date} A中`;
  if(entry.print_time_mode==="unspecified") return `${LABEL[entry.entry_type]||entry.entry_type} ${date} 中`;
  return `${LABEL[entry.entry_type]||entry.entry_type} ${date} ${timeKey(entry.starts_at)}`;
}

const LABEL:Record<string,string>={delivery:"納車",pickup:"引取",customer_visit:"来社",onsite_repair:"出張"};
const STAY_REASON_SUGGESTIONS=["部品待ち","外注作業待ち","見積確認待ち","お客様連絡待ち","作業待ち"];

export default function ScheduleEditPage(){
  const [entry,setEntry]=useState<Entry|null>(null);
  const [day,setDay]=useState("");
  const [options,setOptions]=useState<TimeOption[]>([]);
  const [selected,setSelected]=useState("");
  const [showAfternoonOptions,setShowAfternoonOptions]=useState(false);
  const [stayReason,setStayReason]=useState("");
  const [plannedDeliveryDate,setPlannedDeliveryDate]=useState("");
  const [deliveryEntry,setDeliveryEntry]=useState<Entry|null>(null);
  const [relatedInboundEntry,setRelatedInboundEntry]=useState<Entry|null>(null);
  const [vehicleSummary,setVehicleSummary]=useState<VehicleSummary|null>(null);
  const [customerSummary,setCustomerSummary]=useState<CustomerSummary|null>(null);
  const [deliveryEnabled,setDeliveryEnabled]=useState(false);
  const [deliveryDay,setDeliveryDay]=useState("");
  const [deliveryMode,setDeliveryMode]=useState<"unspecified"|"exact">("unspecified");
  const [deliveryTime,setDeliveryTime]=useState("15:00");
  const [reason,setReason]=useState("");
  const [staffMembers,setStaffMembers]=useState<StaffMember[]>([]);
  const [staffId,setStaffId]=useState("");
  const [vendors,setVendors]=useState<ExternalVendor[]>([]);
  const [vendorId,setVendorId]=useState("");
  const [vendorName,setVendorName]=useState("");
  const [message,setMessage]=useState("予約情報を読み込みます。");
  const [warnings,setWarnings]=useState<string[]>([]);
  const [showCancel,setShowCancel]=useState(false);
  const [cancelReason,setCancelReason]=useState("");
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
    let loadedReason="";
    if(e.work_order_id){
      const [
        {data:workData,error:workError},
        {data:deliveryData,error:deliveryError},
        {data:inboundData,error:inboundError},
      ]=await Promise.all([
        supabase.from("work_orders")
          .select("id,vehicle_id,reason,worker_staff_id,worker_name,outsource_vendor_id,outsource_vendor_name,stay_reason,planned_delivery_date")
          .eq("id",e.work_order_id).maybeSingle(),
        supabase.from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode")
          .eq("work_order_id",e.work_order_id)
          .eq("entry_type","delivery")
          .order("starts_at",{ascending:true})
          .limit(1)
          .maybeSingle(),
        supabase.from("schedule_entries")
          .select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode")
          .eq("work_order_id",e.work_order_id)
          .in("entry_type",["pickup","customer_visit","onsite_repair"])
          .order("starts_at",{ascending:true})
          .limit(1)
          .maybeSingle(),
      ]);
      if(workError){setMessage("作業情報の読み込みエラー: "+workError.message);setBusy(false);return;}
      if(deliveryError){setMessage("納車予定の読み込みエラー: "+deliveryError.message);setBusy(false);return;}
      if(inboundError){setMessage("入庫予定の読み込みエラー: "+inboundError.message);setBusy(false);return;}
      const work=(workData||null) as WorkOrder|null;
      const delivery=(deliveryData||null) as Entry|null;
      const relatedInbound=(inboundData||null) as Entry|null;
      setRelatedInboundEntry(relatedInbound);
      loadedReason=work?.reason||"";
      setReason(loadedReason);
      setStaffId(work?.worker_staff_id||"");
      setVendorId(work?.outsource_vendor_id||"");
      setVendorName(work?.outsource_vendor_id ? "" : (work?.outsource_vendor_name||""));
      setStayReason(work?.stay_reason||"");
      setPlannedDeliveryDate(work?.planned_delivery_date||"");
      setDeliveryEntry(delivery);
      setDeliveryEnabled(Boolean(delivery));
      setDeliveryDay(delivery ? dateKey(delivery.starts_at) : (work?.planned_delivery_date || dateKey(e.starts_at)));
      setDeliveryMode(delivery?.print_time_mode==="exact" ? "exact" : "unspecified");
      setDeliveryTime(delivery ? timeKey(delivery.starts_at) : "15:00");

      const vehicleId=e.vehicle_id || work?.vehicle_id || relatedInbound?.vehicle_id || delivery?.vehicle_id || "";
      if(vehicleId){
        const {data:vehicleData,error:vehicleError}=await supabase
          .from("vehicles")
          .select("id,customer_id,registration_number_last4")
          .eq("id",vehicleId)
          .maybeSingle();
        if(vehicleError){setMessage("車両情報の読み込みエラー: "+vehicleError.message);setBusy(false);return;}
        const vehicle=(vehicleData||null) as VehicleSummary|null;
        setVehicleSummary(vehicle);
        if(vehicle?.customer_id){
          const {data:customerData,error:customerError}=await supabase
            .from("customers")
            .select("id,name,company_name,schedule_display_name")
            .eq("id",vehicle.customer_id)
            .maybeSingle();
          if(customerError){setMessage("お客様情報の読み込みエラー: "+customerError.message);setBusy(false);return;}
          setCustomerSummary((customerData||null) as CustomerSummary|null);
        }else{
          setCustomerSummary(null);
        }
      }else{
        setVehicleSummary(null);
        setCustomerSummary(null);
      }
    }
    const d=dateKey(e.starts_at);
    setDay(d);
    setShowAfternoonOptions(false);
    await loadOptions(d,e,loadedReason);
    setBusy(false);
  }

  async function loadOptions(targetDay:string,base=entry,targetReason=reason){
    if(!base) return;

    const checkedOption=async(option:TimeOption):Promise<TimeOption>=>{
      const {data,error}=await supabase.rpc("schedule_slot_check_v2",{
        p_entry_type:base.entry_type,
        p_starts_at:option.startsAt,
        p_ends_at:option.endsAt,
        p_reason:targetReason||null,
        p_exclude_entry_id:base.id,
        p_print_time_mode:option.mode,
      });
      if(error) throw error;
      const availability:TimeOption["availability"]=!Boolean(data?.allowed)
        ? "blocked"
        : Boolean(data?.override_required)
          ? "warning"
          : "open";
      return {
        ...option,
        availability,
        warnings:Array.isArray(data?.warnings)?data.warnings.map(String):[],
        hardErrors:Array.isArray(data?.hard_errors)?data.hard_errors.map(String):[],
        conflicts:Number(data?.conflicts||0),
      };
    };

    const exactOption=(time:string,group:"morning"|"afternoon",durationMinutes:number,displayLabel?:string):TimeOption=>{
      const startsAt=jstIso(targetDay,time);
      return {
        key:`exact_${time.replace(":","")}`,
        label:time,
        displayLabel:displayLabel||time,
        group,
        mode:"exact",
        startsAt,
        endsAt:plusMinutes(startsAt,durationMinutes),
        durationMinutes,
      };
    };

    try{
      let opts:TimeOption[]=[];

      if(base.entry_type==="onsite_repair"){
        const morningTimes=["08:30","09:00","09:30","10:00","10:30","11:00"];
        const afternoonTimes=["13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00"];
        const raw:TimeOption[]=[
          ...morningTimes.map(time=>exactOption(time,"morning",60)),
          {
            key:"morning_unspecified",
            label:"A中",
            displayLabel:"A中",
            group:"morning",
            mode:"morning",
            startsAt:jstIso(targetDay,"09:00"),
            endsAt:jstIso(targetDay,"10:00"),
            durationMinutes:60,
          },
          ...afternoonTimes.map(time=>exactOption(time,"afternoon",time==="17:00"?30:60)),
          {
            key:"afternoon_unspecified",
            label:"中",
            displayLabel:"中",
            group:"afternoon",
            mode:"unspecified",
            startsAt:jstIso(targetDay,"13:00"),
            endsAt:jstIso(targetDay,"14:00"),
            durationMinutes:60,
          },
        ];
        opts=await Promise.all(raw.map(checkedOption));
      }else{
        const {data,error}=await supabase.rpc("schedule_time_options",{p_day:targetDay,p_entry_type:base.entry_type});
        if(error) throw error;
        opts=(Array.isArray(data?.options)?data.options:[]) as TimeOption[];

        if(base.entry_type==="pickup" && !opts.some(x=>x.group==="afternoon" && x.mode==="exact")){
          const afternoonTimes=["13:00","14:00","15:00","16:00","17:00"];
          const afternoonExact=afternoonTimes.map(time=>exactOption(
            time,
            "afternoon",
            time==="17:00"?30:60,
            Number(time.slice(3))===0
              ? `${Number(time.slice(0,2))}時まで`
              : `${Number(time.slice(0,2))}時${time.slice(3)}分まで`
          ));
          const afternoonBroad=opts.filter(x=>x.group==="afternoon" && x.mode==="unspecified");
          opts=[
            ...opts.filter(x=>!(x.group==="afternoon" && x.mode==="unspecified")),
            ...afternoonExact,
            ...afternoonBroad,
          ];
        }

        opts=opts.map(option=>(
          option.mode==="unspecified" && option.group==="afternoon"
            ? {...option,label:"中",displayLabel:"中"}
            : option
        ));

        opts=await Promise.all(opts.map(checkedOption));
      }

      setOptions(opts);
      const current=timeKey(base.starts_at);
      const sameDay=dateKey(base.starts_at)===targetDay;
      const match=sameDay
        ? opts.find(x=>x.mode===base.print_time_mode && (x.mode!=="exact" || timeKey(x.startsAt)===current))
          || opts.find(x=>timeKey(x.startsAt)===current)
        : null;
      const morningOptions=opts.filter(x=>x.group==="morning");
      setSelected(match?.key
        || morningOptions.find(x=>x.availability==="open")?.key
        || morningOptions.find(x=>x.availability==="warning")?.key
        || opts.find(x=>x.availability==="open")?.key
        || opts.find(x=>x.availability==="warning")?.key
        || "");
    }catch(error:any){
      setOptions([]);
      setSelected("");
      setMessage(safeActionError("時間候補の読み込み", error));
    }
  }

  function resetWarningsForTargetChange(){
    setWarnings([]);
    setMessage("変更先を更新しました。保存時に空き・重複・上限を再確認します。");
  }

  async function changeDay(next:string){
    setDay(next);
    setShowAfternoonOptions(false);
    resetWarningsForTargetChange();
    if(entry) await loadOptions(next,entry,reason);
  }

  const selectedOption=useMemo(()=>options.find(x=>x.key===selected)||null,[options,selected]);

  function changeTime(next:string){
    setSelected(next);
    resetWarningsForTargetChange();
  }

  const targetSummary=useMemo(()=>{
    if(!entry||!day) return "";
    return selectedOption ? `${day} ${selectedOption.displayLabel || selectedOption.label}` : `${day} 時間候補なし`;
  },[day,entry,selectedOption]);

  function buildDeliveryTarget():DeliveryTarget|null {
    if(!deliveryEnabled) return null;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDay)) throw new Error("納車予定日を入力してください。");
    const time=deliveryMode==="unspecified" ? "13:00" : deliveryTime;
    if(deliveryMode==="exact" && !/^\d{2}:\d{2}$/.test(time)) throw new Error("納車時間を入力してください。");
    const startsAt=jstIso(deliveryDay,time);
    return {
      startsAt,
      endsAt:plusMinutes(startsAt,30),
      mode:deliveryMode,
    };
  }

  async function preflightDelivery(target:DeliveryTarget,override:boolean){
    const {data,error}=await supabase.rpc("schedule_slot_check_v2",{
      p_entry_type:"delivery",
      p_starts_at:target.startsAt,
      p_ends_at:target.endsAt,
      p_reason:reason||null,
      p_exclude_entry_id:deliveryEntry?.id||null,
      p_print_time_mode:target.mode,
    });
    if(error) throw error;
    const hard=Array.isArray(data?.hard_errors)?data.hard_errors.map(String):[];
    const warns=Array.isArray(data?.warnings)?data.warnings.map(String):[];
    if(!data?.allowed || hard.length){
      setMessage("納車予定を登録できません: "+(hard.length?hard.join(" / "):"時間条件を確認してください。"));
      return false;
    }
    if(data?.override_required && !override){
      setWarnings(warns);
      setMessage("納車予定に警告があります。内容を確認してください。");
      return false;
    }
    return true;
  }

  async function syncDeliveryPlan(target:DeliveryTarget|null){
    if(!entry?.work_order_id) return;

    if(!target){
      if(deliveryEntry){
        const {error:deleteError}=await supabase.from("schedule_entries").delete().eq("id",deliveryEntry.id);
        if(deleteError) throw deleteError;
      }
      const {error:syncError}=await supabase.from("work_orders").update({
        planned_delivery_at:null,
        planned_delivery_date:null,
        updated_at:new Date().toISOString(),
      }).eq("id",entry.work_order_id);
      if(syncError) throw syncError;
      setDeliveryEntry(null);
      setPlannedDeliveryDate("");
      return;
    }

    if(deliveryEntry){
      const {data,error}=await supabase.rpc("reschedule_schedule_entry_v2",{
        p_entry_id:deliveryEntry.id,
        p_starts_at:target.startsAt,
        p_ends_at:target.endsAt,
        p_print_time_mode:target.mode,
        p_stay_reason:stayReason.trim()||null,
        p_planned_delivery_date:deliveryDay,
        p_actor:"schedule-edit-delivery",
        p_allow_warning_override:true,
      });
      if(error) throw error;
      const hard=Array.isArray(data?.hardErrors)?data.hardErrors.map(String):[];
      if(hard.length || !data?.updated) throw new Error(hard.join(" / ") || "納車予定を変更できませんでした。");
      setDeliveryEntry({...deliveryEntry,starts_at:target.startsAt,ends_at:target.endsAt,print_time_mode:target.mode});
    }else{
      const {data,error}=await supabase.from("schedule_entries").insert({
        vehicle_id:entry.vehicle_id,
        work_order_id:entry.work_order_id,
        entry_type:"delivery",
        starts_at:target.startsAt,
        ends_at:target.endsAt,
        print_time_mode:target.mode,
      }).select("id,vehicle_id,work_order_id,entry_type,starts_at,ends_at,print_time_mode").single();
      if(error) throw error;
      setDeliveryEntry(data as Entry);
      const {error:syncError}=await supabase.from("work_orders").update({
        planned_delivery_at:target.startsAt,
        planned_delivery_date:deliveryDay,
        updated_at:new Date().toISOString(),
      }).eq("id",entry.work_order_id);
      if(syncError) throw syncError;
    }
    setPlannedDeliveryDate(deliveryDay);
  }

  async function save(override=false){
    if(!entry){return;}
    if(!selectedOption){
      setMessage("変更先の時間を選択してください。");return;
    }
    setBusy(true);
    setWarnings([]);
    try{
      const startsAt=selectedOption.startsAt;
      const endsAt=selectedOption.endsAt;
      const mode=selectedOption.mode;
      const deliveryTarget=entry.work_order_id && entry.entry_type!=="delivery" ? buildDeliveryTarget() : null;
      if(deliveryTarget){
        const mainDay=dateKey(startsAt);
        const deliveryTargetDay=dateKey(deliveryTarget.startsAt);
        if(deliveryTargetDay<mainDay || (deliveryTarget.mode==="exact" && deliveryTargetDay===mainDay && new Date(deliveryTarget.startsAt).getTime()<new Date(endsAt).getTime())){
          setMessage("納車予定は入庫・作業予定の終了後に設定してください。");
          return;
        }
        if(!(await preflightDelivery(deliveryTarget,override))) return;
      }

      const {data,error}=await supabase.rpc("reschedule_schedule_entry_v2",{
        p_entry_id:entry.id,
        p_starts_at:startsAt,
        p_ends_at:endsAt,
        p_print_time_mode:mode,
        p_stay_reason:entry.work_order_id ? stayReason.trim()||null : null,
        p_planned_delivery_date:entry.work_order_id
          ? (entry.entry_type==="delivery" ? day : (deliveryTarget ? deliveryDay : null))
          : null,
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
        if(entry.work_order_id){
          const {error:assignmentError}=await supabase.rpc("set_work_order_assignment",{
            p_work_order_id:entry.work_order_id,
            p_staff_id:staffId||null,
            p_vendor_id:(reason==="板金塗装" || reason==="一般整備") ? (vendorId||null) : null,
            p_vendor_name:(reason==="板金塗装" || reason==="一般整備") ? (vendorName.trim()||null) : null,
            p_actor:"schedule-edit",
          });
          if(assignmentError) throw assignmentError;
          if(entry.entry_type!=="delivery") await syncDeliveryPlan(deliveryTarget);
        }
        setMessage("予約と納車予定を変更しました。滞留判定は納車予定の有無から自動更新されます。");
        window.setTimeout(()=>location.assign("/schedule?day="+day),350);
      }
    }catch(error:any){
      setMessage(safeActionError("予約変更", error));
    }finally{
      setBusy(false);
    }
  }

  async function cancelReservation(){
    if(!entry) return;
    setBusy(true);
    try{
      const {data,error}=await supabase.rpc("cancel_schedule_entry_v1",{
        p_entry_id:entry.id,
        p_reason:cancelReason.trim() || null,
        p_actor:"schedule-edit",
      });
      if(error) throw error;
      if(data?.rentalCancellationPending){
        setShowCancel(false);
        setMessage("取消手続きを開始しました。レンタカーは業者への取消連絡待ちのため、入庫予定一式はまだ取消確定していません。");
        return;
      }
      setMessage(entry.work_order_id
        ? "入庫予定一式を取消しました。関連する入庫・納車予定と代車予約も更新しました。"
        : "予定を取消しました。");
      window.setTimeout(()=>location.assign("/schedule?day="+day),700);
    }catch(error:any){
      const detail=String(error?.message||"");
      setMessage(detail.includes("started work cannot be cancelled")
        ? "入庫済み・作業中・作業完了の予約は、この画面から取消できません。"
        : safeActionError("予約取消", error));
    }finally{
      setBusy(false);
    }
  }

  const cancelInboundEntry=entry?.entry_type==="delivery" ? relatedInboundEntry : entry;
  const cancelDeliveryEntry=entry?.entry_type==="delivery" ? entry : deliveryEntry;
  const cancelSetLabel=entry?.work_order_id ? "この入庫予定一式を取消します" : "この予定を取消します";

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
          {entry.entry_type==="delivery" ? (
            <label>変更時間
              <select value={selected} onChange={(e)=>changeTime(e.target.value)}>
                {!options.length && <option value="">候補なし</option>}
                {options.map(x=><option key={x.key} value={x.key}>{x.displayLabel || x.label}</option>)}
              </select>
            </label>
          ) : (
            <div className="wide availabilityBlock">
              <div className="availabilityTitle">
                <b>変更時間</b>
                <span className="legend"><i className="dot openDot" />○ 空き　<i className="dot warnDot" />△ 要確認　<i className="dot blockedDot" />× 不可</span>
              </div>
              {!options.length ? (
                <div className="availabilityLoading">時間候補がありません。</div>
              ) : (
                <>
                  <div className="timeGrid">
                    {options.filter(x=>x.group==="morning").map(x=>{
                      const state=x.availability||"open";
                      const mark=state==="open"?"○":state==="warning"?"△":"×";
                      const detail=[...(x.hardErrors||[]),...(x.warnings||[])].join(" / ");
                      return <button
                        type="button"
                        key={x.key}
                        className={`timeSlot ${state} ${selected===x.key?"selected":""}`}
                        disabled={state==="blocked"}
                        onClick={()=>{changeTime(x.key);setShowAfternoonOptions(false);}}
                        title={detail || (state==="open"?"空いています":"確認が必要です")}
                      ><span>{mark}</span><b>{x.displayLabel || x.label}</b></button>;
                    })}
                    <button
                      type="button"
                      className={`timeSlot afternoonSelector ${showAfternoonOptions || selectedOption?.group==="afternoon"?"selected":""}`}
                      onClick={()=>{setSelected("");setShowAfternoonOptions(true);resetWarningsForTargetChange();}}
                    ><span>▶</span><b>午後</b></button>
                  </div>

                  {showAfternoonOptions && (
                    <div className="afternoonChoices">
                      <div className="afternoonChoicesTitle">午後の時間指定 または 中</div>
                      <div className="timeGrid">
                        {options.filter(x=>x.group==="afternoon").map(x=>{
                          const state=x.availability||"open";
                          const mark=state==="open"?"○":state==="warning"?"△":"×";
                          const detail=[...(x.hardErrors||[]),...(x.warnings||[])].join(" / ");
                          return <button
                            type="button"
                            key={x.key}
                            className={`timeSlot ${state} ${selected===x.key?"selected":""}`}
                            disabled={state==="blocked"}
                            onClick={()=>changeTime(x.key)}
                            title={detail || (state==="open"?"空いています":"確認が必要です")}
                          ><span>{mark}</span><b>{x.displayLabel || x.label}</b></button>;
                        })}
                      </div>
                      <div className="timeMeaning">「中」はその日の営業時間内で時間指定なしです。</div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="targetPreview">
          <span>変更後</span><b>{targetSummary}</b>
          <small>「空きチェックして変更」を押すと、更新前に空き・重複・受付上限を確認します。警告がある場合はそのまま変更せず、確認画面を表示します。</small>
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
            {(reason==="板金塗装" || reason==="一般整備") && <label>外注先
              <select value={vendorId} onChange={(e)=>{setVendorId(e.target.value);if(e.target.value)setVendorName("");}}>
                <option value="">未選択 / 直接入力</option>
                {vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.short_name||vendor.display_name}</option>)}
              </select>
            </label>}
            {(reason==="板金塗装" || reason==="一般整備") && !vendorId && <label>外注先名（直接入力）
              <input value={vendorName} onChange={(e)=>setVendorName(e.target.value)} placeholder="例：○○鈑金" />
            </label>}
          </div>
          <div className="manageLinks">
            <button type="button" onClick={()=>location.assign("/settings/staff")}>社員名を管理</button>
            {(reason==="板金塗装" || reason==="一般整備") && <button type="button" onClick={()=>location.assign("/settings/vendors")}>外注先を管理</button>}
          </div>
        </section>}
        {entry.work_order_id && <section className="stayBox">
          <b>滞留・納車情報</b>
          <div className="grid stayGrid">
            <label>滞留理由
              <input list="stay-reasons" value={stayReason} onChange={(e)=>setStayReason(e.target.value)} placeholder="例：部品待ち" />
              <datalist id="stay-reasons">{STAY_REASON_SUGGESTIONS.map(x=><option key={x} value={x} />)}</datalist>
            </label>
          </div>
          {entry.entry_type==="delivery" ? (
            <div className="deliveryEditNotice">この予定自体が納車予定です。上の「日付・時間」から変更してください。</div>
          ) : (
            <div className="deliveryPlan">
              <label className="deliveryToggle">
                <input type="checkbox" checked={deliveryEnabled} onChange={(e)=>{setDeliveryEnabled(e.target.checked);resetWarningsForTargetChange();}} />
                納車予定を登録する
              </label>
              {deliveryEnabled && <div className="grid stayGrid">
                <label>納車予定日
                  <input type="date" value={deliveryDay} onChange={(e)=>{setDeliveryDay(e.target.value);resetWarningsForTargetChange();}} />
                </label>
                <label>納車指定
                  <select value={deliveryMode} onChange={(e)=>{setDeliveryMode(e.target.value as "unspecified"|"exact");resetWarningsForTargetChange();}}>
                    <option value="unspecified">中</option>
                    <option value="exact">時間指定</option>
                  </select>
                </label>
                {deliveryMode==="exact" && <label>納車時間
                  <input type="time" min="08:30" max="17:30" step="1800" value={deliveryTime} onChange={(e)=>{setDeliveryTime(e.target.value);resetWarningsForTargetChange();}} />
                </label>}
              </div>}
            </div>
          )}
          <small>納車予定の正本は schedule_entries の「納車」予定です。「中」も正式な納車予定として扱います。</small>
        </section>}
        {!!warnings.length && <div className="warnings"><b>確認が必要</b>{warnings.map((w,i)=><div key={i}>・{w}</div>)}<button onClick={()=>void save(true)}>警告を確認して変更</button></div>}
        <button className="primary" disabled={busy} onClick={()=>void save(false)}>空きチェックして変更</button>
        {!showCancel ? <button className="cancelOpen" disabled={busy} onClick={()=>setShowCancel(true)}>{entry.work_order_id ? "この入庫予定一式を取消" : "この予定を取消"}</button> :
          <section className="cancelBox">
            <b>予約取消の確認</b>
            <h3>{cancelSetLabel}</h3>
            <div className="cancelSummary">
              <div><span>お客様名</span><b>{customerSummaryLabel(customerSummary)}</b></div>
              <div><span>下4桁</span><b>{naturalLast4(vehicleSummary?.registration_number_last4) || "未登録"}</b></div>
              <div><span>入庫要因</span><b>{reason || "未登録"}</b></div>
              <div><span>入庫予定</span><b>{entrySummaryLabel(cancelInboundEntry)}</b></div>
              <div><span>納車予定</span><b>{entrySummaryLabel(cancelDeliveryEntry)}</b></div>
            </div>
            <p>同じ work_order_id に紐づく引取・来社・出張・納車予定は1セットとして取消します。紐づく代車予約も既存の取消処理で連動します。この操作は元に戻せません。</p>
            <label>取消理由（任意）
              <textarea value={cancelReason} onChange={(e)=>setCancelReason(e.target.value)} placeholder="必要な場合だけ入力：お客様都合、日程再調整など" />
            </label>
            <div className="cancelActions">
              <button type="button" disabled={busy} onClick={()=>{setShowCancel(false);setCancelReason("");}}>戻る</button>
              <button type="button" className="danger" disabled={busy} onClick={()=>void cancelReservation()}>{entry.work_order_id ? "この入庫予定一式を取消" : "この予定を取消"}</button>
            </div>
          </section>}
      </>}
    </section>
    <style jsx global>{`
      *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}
      .editPage{max-width:760px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.top button,button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 13px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:20px}.eyebrow{color:#2674e8;font-weight:800}h1{margin:4px 0 12px}.notice{background:#eef6ff;border-radius:12px;padding:11px;color:#48627f}.current{margin:14px 0;background:#f7f9fc;padding:12px;border-radius:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid label{display:grid;gap:5px;font-weight:800;color:#627083}.grid input,.grid select{border:1px solid #cbd6e3;border-radius:10px;padding:12px;background:#fff}.grid .wide{grid-column:1/-1}.availabilityBlock{display:grid;gap:9px}.availabilityTitle{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.legend{font-size:12px;color:#68778a}.dot{display:inline-block;width:9px;height:9px;border-radius:999px;margin:0 3px 0 7px}.openDot{background:#5eaf76}.warnDot{background:#d5a238}.blockedDot{background:#c76a64}.timeGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.timeSlot{display:flex;align-items:center;justify-content:center;gap:6px;min-height:46px;color:#315678}.timeSlot.open{border-color:#b7d8c0}.timeSlot.warning{border-color:#e2c36f;background:#fffaf0}.timeSlot.blocked{opacity:.55}.timeSlot.selected{border-color:#2674e8;background:#eaf3ff;color:#145dc0;box-shadow:0 0 0 1px #2674e8 inset}.afternoonSelector{border-style:dashed}.afternoonChoices{margin-top:4px;padding-top:12px;border-top:1px dashed #cad5e3}.afternoonChoicesTitle{font-size:13px;font-weight:800;color:#53647b;margin-bottom:8px}.timeMeaning{font-size:12px;color:#64748b;margin-top:8px}.availabilityLoading{font-size:13px;color:#68778a;padding:8px 0}.targetPreview{margin-top:12px;padding:13px;border:1px solid #c8ddfb;border-radius:13px;background:#f5f9ff;display:grid;gap:4px}.targetPreview span{font-size:12px;font-weight:900;color:#2674e8}.targetPreview b{font-size:18px}.targetPreview small{color:#627083;line-height:1.5}.stayBox{margin-top:14px;padding:14px;border:1px solid #dbe3ed;border-radius:14px;background:#fafcff}.stayGrid{margin-top:9px}.stayBox small{display:block;margin-top:7px;color:#7a8798}.deliveryPlan{margin-top:12px;padding-top:12px;border-top:1px solid #dbe3ed}.deliveryToggle{display:flex!important;grid-template-columns:auto 1fr!important;align-items:center;justify-content:flex-start;gap:8px!important;font-weight:900!important;color:#2f5f9f!important}.deliveryToggle input{width:20px;height:20px}.deliveryEditNotice{margin-top:12px;padding:10px 12px;border-radius:10px;background:#eef6ff;color:#45637f;font-weight:700}.primary{margin-top:14px;background:#2f6fe4;color:#fff;border-color:#2f6fe4;width:100%;padding:13px}.warnings{margin-top:12px;background:#fff7e8;border:1px solid #e7c27d;border-radius:12px;padding:12px;color:#7c560d}.warnings button{margin-top:8px}.manageLinks{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.manageLinks button{padding:8px 10px}.cancelOpen{margin-top:12px;width:100%;color:#b42318;border-color:#efb5af}.cancelBox{margin-top:14px;padding:14px;border:1px solid #efb5af;border-radius:14px;background:#fff7f6}.cancelBox h3{margin:8px 0 10px;color:#9b2c25}.cancelSummary{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 12px}.cancelSummary>div{display:grid;gap:3px;padding:9px 10px;border:1px solid #efcbc7;border-radius:10px;background:#fff}.cancelSummary span{font-size:11px;color:#8a5a56;font-weight:800}.cancelSummary b{font-size:14px;color:#4f2f2c}.cancelBox p{color:#7a3d37;line-height:1.5}.cancelBox label{display:grid;gap:6px;font-weight:800;color:#7a3d37}.cancelBox textarea{min-height:86px;resize:vertical;border:1px solid #d9a6a0;border-radius:10px;padding:11px;background:#fff}.cancelActions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:11px}.cancelActions .danger{background:#c4322b;border-color:#c4322b;color:#fff}.cancelActions button:disabled{opacity:.5}@media(max-width:600px){.grid{grid-template-columns:1fr}.cancelSummary{grid-template-columns:1fr}}
    `}</style>
  </main>;
}
