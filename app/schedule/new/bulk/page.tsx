/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabase";

type EntryType = "delivery" | "pickup" | "customer_visit" | "onsite_repair";
type Reason = "点検" | "車検" | "一般整備" | "板金塗装";
type Mode = "exact" | "morning" | "unspecified";

type VehicleRow = {
  vehicleId:string;
  customerId:string|null;
  customerName:string|null;
  companyName:string|null;
  scheduleDisplayName:string|null;
  phone:string|null;
  registrationNumber:string|null;
  registrationLast4:string|null;
  chassisNumber:string|null;
  maker:string|null;
  model:string|null;
};

type TimeOption = {
  key:string;
  label:string;
  mode:Mode;
  startsAt:string;
  endsAt:string;
  availability?:"open"|"warning"|"blocked";
  warnings?:string[];
  hardErrors?:string[];
};

type StaffMember = { id:string; display_name:string; short_name:string|null };
type ExternalVendor = { id:string; display_name:string; short_name:string|null };

type SelectedItem = VehicleRow & {
  entryType:EntryType;
  reason:Reason;
  timeKey:string;
  onsiteMode:Mode;
  onsiteTime:string;
  onsiteDuration:number;
  inspectionScheduleType:string;
  staffId:string;
  vendorName:string;
  isUrgent:boolean;
  needsLoaner:boolean;
  notes:string;
  addDelivery:boolean;
  deliveryDay:string;
  deliveryTimeKey:string;
};

const ENTRY_LABEL:Record<EntryType,string>={
  delivery:"納車", pickup:"引取", customer_visit:"来社", onsite_repair:"出張"
};

function todayJst(){
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date());
}

function addDays(day:string,delta:number){
  const d=new Date(day+"T00:00:00Z");
  d.setUTCDate(d.getUTCDate()+delta);
  return d.toISOString().slice(0,10);
}

function defaultDeliveryDay(day:string,reason:Reason){
  return reason==="車検" ? addDays(day,1) : day;
}

function daysBetween(fromDay:string,toDay:string){
  const from=new Date(fromDay+"T00:00:00Z").getTime();
  const to=new Date(toDay+"T00:00:00Z").getTime();
  return Math.round((to-from)/(24*60*60*1000));
}

function jstIso(day:string,time:string){
  return new Date(`${day}T${time}:00+09:00`).toISOString();
}

function plusMinutes(iso:string,minutes:number){
  return new Date(new Date(iso).getTime()+minutes*60_000).toISOString();
}

function customerLabel(v:VehicleRow){
  return v.scheduleDisplayName || v.companyName || v.customerName || "顧客未割当";
}

function last4Label(v:VehicleRow){
  const raw=v.registrationLast4 || v.registrationNumber?.match(/(\d{4})(?!.*\d)/)?.[1] || "";
  if(!raw) return "----";
  return /^\d+$/.test(raw) ? String(Number.parseInt(raw,10)) : raw;
}

function vehicleLabel(v:VehicleRow){
  return v.registrationNumber || (v.registrationLast4 ? `下4桁 ${last4Label(v)}` : null) || v.chassisNumber || v.model || "車両";
}

function optionKey(day:string,entryType:EntryType,reason:Reason){
  return `${day}|${entryType}|${reason}`;
}

function defaultOption(options:TimeOption[],preferUnspecified=false){
  if(preferUnspecified){
    const x=options.find(v=>v.key==="unspecified" && v.availability!=="blocked");
    if(x) return x;
  }
  return options.find(v=>v.availability==="open")
    || options.find(v=>v.availability==="warning")
    || options.find(v=>v.availability!=="blocked")
    || null;
}

export default function BulkSchedulePage(){
  const [day,setDay]=useState(todayJst());
  const [query,setQuery]=useState("");
  const [results,setResults]=useState<VehicleRow[]>([]);
  const [selected,setSelected]=useState<SelectedItem[]>([]);
  const [staffMembers,setStaffMembers]=useState<StaffMember[]>([]);
  const [externalVendors,setExternalVendors]=useState<ExternalVendor[]>([]);
  const [optionsCache,setOptionsCache]=useState<Record<string,TimeOption[]>>({});
  const [defaultEntryType,setDefaultEntryType]=useState<EntryType>("customer_visit");
  const [defaultReason,setDefaultReason]=useState<Reason>("車検");
  const [defaultInspectionScheduleType,setDefaultInspectionScheduleType]=useState("");
  const [defaultOnsiteDuration,setDefaultOnsiteDuration]=useState(60);
  const [defaultStaffId,setDefaultStaffId]=useState("");
  const [defaultVendorName,setDefaultVendorName]=useState("");
  const [defaultUrgent,setDefaultUrgent]=useState(false);
  const [defaultLoaner,setDefaultLoaner]=useState(false);
  const [busy,setBusy]=useState(true);
  const [message,setMessage]=useState("同じ日の予定を複数台まとめて登録できます。");
  const [warnings,setWarnings]=useState<string[]>([]);
  const [hardErrors,setHardErrors]=useState<string[]>([]);

  useEffect(()=>{
    const q=new URLSearchParams(location.search).get("day");
    if(q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDay(q);
    void Promise.all([searchVehicles(""),loadMasters()]).finally(()=>setBusy(false));
  },[]);

  async function loadMasters(){
    const [staffRes,vendorRes]=await Promise.all([
      supabase.from("staff_members").select("id,display_name,short_name").eq("is_active",true)
        .order("display_order",{ascending:true}).order("display_name",{ascending:true}),
      supabase.from("external_vendors").select("id,display_name,short_name").eq("is_active",true)
        .order("display_order",{ascending:true}).order("display_name",{ascending:true}),
    ]);
    if(!staffRes.error) setStaffMembers((staffRes.data||[]) as StaffMember[]);
    if(!vendorRes.error) setExternalVendors((vendorRes.data||[]) as ExternalVendor[]);
  }

  async function searchVehicles(value=query){
    setBusy(true);
    const {data,error}=await supabase.rpc("search_schedule_vehicles_v1",{
      p_query:value.trim()||null,
      p_limit:80,
    });
    if(error){
      setMessage("車両検索エラー: "+error.message);
      setResults([]);
    }else{
      setResults((data?.items||[]) as VehicleRow[]);
      setMessage(`${data?.count||0}台見つかりました。検索を変えても選択済み車両は保持されます。`);
    }
    setBusy(false);
  }

  async function loadOptions(targetDay:string,entryType:EntryType,reason:Reason){
    if(entryType==="onsite_repair") return [] as TimeOption[];
    const key=optionKey(targetDay,entryType,reason);
    if(optionsCache[key]) return optionsCache[key];
    const {data,error}=await supabase.rpc("schedule_time_availability",{
      p_day:targetDay,p_entry_type:entryType,p_reason:reason,
    });
    if(error) throw error;
    const opts=(Array.isArray(data?.options)?data.options:[]) as TimeOption[];
    setOptionsCache(prev=>({...prev,[key]:opts}));
    return opts;
  }

  async function addVehicle(v:VehicleRow){
    if(selected.some(x=>x.vehicleId===v.vehicleId)) return;
    setBusy(true);
    try{
      const deliveryDay=defaultDeliveryDay(day,defaultReason);
      const opts=await loadOptions(day,defaultEntryType,defaultReason);
      const deliveryOpts=defaultEntryType==="delivery"
        ? []
        : await loadOptions(deliveryDay,"delivery",defaultReason);
      const first=defaultOption(opts);
      const delivery=defaultOption(deliveryOpts,true);
      setSelected(old=>[...old,{
        ...v,
        entryType:defaultEntryType,
        reason:defaultReason,
        timeKey:first?.key || "",
        onsiteMode:"exact",
        onsiteTime:"09:00",
        onsiteDuration:defaultOnsiteDuration,
        inspectionScheduleType:(defaultReason==="点検"||defaultReason==="車検") ? defaultInspectionScheduleType : "",
        staffId:defaultStaffId,
        vendorName:defaultVendorName,
        isUrgent:defaultUrgent,
        needsLoaner:defaultLoaner,
        notes:"",
        addDelivery:defaultEntryType!=="delivery",
        deliveryDay,
        deliveryTimeKey:delivery?.key || "",
      }]);
      setMessage(`${customerLabel(v)} / ${vehicleLabel(v)} を選択しました。`);
    }catch(error:any){
      setMessage("時間候補の読み込みエラー: "+(error?.message||error));
    }finally{
      setBusy(false);
    }
  }

  function removeVehicle(vehicleId:string){
    setSelected(old=>old.filter(x=>x.vehicleId!==vehicleId));
  }

  async function changeSchedule(vehicleId:string,patch:Partial<SelectedItem>){
    const current=selected.find(x=>x.vehicleId===vehicleId);
    if(!current) return;
    const next={...current,...patch};
    if(patch.reason && patch.reason!==current.reason){
      next.deliveryDay=defaultDeliveryDay(day,next.reason);
      next.deliveryTimeKey="";
      next.inspectionScheduleType=(next.reason==="点検"||next.reason==="車検") ? defaultInspectionScheduleType : "";
    }
    if(patch.entryType && patch.entryType!==current.entryType){
      next.addDelivery=patch.entryType!=="delivery";
      next.timeKey="";
    }
    setSelected(old=>old.map(x=>x.vehicleId===vehicleId?next:x));
    try{
      const opts=await loadOptions(day,next.entryType,next.reason);
      const main=defaultOption(opts);
      const deliveryOpts=next.entryType==="delivery" || !next.addDelivery
        ? []
        : await loadOptions(next.deliveryDay,"delivery",next.reason);
      const delivery=defaultOption(deliveryOpts,true);
      setSelected(old=>old.map(x=>x.vehicleId===vehicleId?{
        ...x,
        timeKey:x.entryType==="onsite_repair" ? x.timeKey : (opts.some(o=>o.key===x.timeKey)?x.timeKey:(main?.key||"")),
        deliveryTimeKey:x.addDelivery ? (deliveryOpts.some(o=>o.key===x.deliveryTimeKey)?x.deliveryTimeKey:(delivery?.key||"")) : "",
      }:x));
    }catch(error:any){
      setMessage("時間候補の読み込みエラー: "+(error?.message||error));
    }
  }

  async function changeDeliveryDay(vehicleId:string,nextDay:string){
    const current=selected.find(x=>x.vehicleId===vehicleId);
    if(!current) return;
    setSelected(old=>old.map(x=>x.vehicleId===vehicleId?{...x,deliveryDay:nextDay,deliveryTimeKey:""}:x));
    try{
      const opts=await loadOptions(nextDay,"delivery",current.reason);
      const delivery=defaultOption(opts,true);
      setSelected(old=>old.map(x=>x.vehicleId===vehicleId?{...x,deliveryTimeKey:delivery?.key||""}:x));
    }catch(error:any){
      setMessage("納車時間候補の読み込みエラー: "+(error?.message||error));
    }
  }

  async function changeCommonDay(nextDay:string){
    if(!nextDay || nextDay===day) return;
    const delta=daysBetween(day,nextDay);
    const shifted=selected.map(item=>({
      ...item,
      timeKey:item.entryType==="onsite_repair" ? item.timeKey : "",
      deliveryDay:item.addDelivery && item.entryType!=="delivery"
        ? addDays(item.deliveryDay,delta)
        : item.deliveryDay,
      deliveryTimeKey:"",
    }));
    setDay(nextDay);
    setSelected(shifted);
    setWarnings([]);
    setHardErrors([]);
    if(!shifted.length){
      setMessage("共通日付を変更しました。");
      return;
    }

    setBusy(true);
    try{
      const refreshed:SelectedItem[]=[];
      for(const item of shifted){
        let timeKey=item.timeKey;
        let deliveryTimeKey=item.deliveryTimeKey;

        if(item.entryType!=="onsite_repair"){
          const opts=await loadOptions(nextDay,item.entryType,item.reason);
          timeKey=defaultOption(opts)?.key||"";
        }
        if(item.addDelivery && item.entryType!=="delivery"){
          const opts=await loadOptions(item.deliveryDay,"delivery",item.reason);
          deliveryTimeKey=defaultOption(opts,true)?.key||"";
        }
        refreshed.push({...item,timeKey,deliveryTimeKey});
      }
      setSelected(refreshed);
      setMessage(`共通日付を${nextDay}へ変更し、${refreshed.length}台の時間候補を新しい日に更新しました。`);
    }catch(error:any){
      setMessage("日付変更後の時間候補更新エラー: "+(error?.message||error));
    }finally{
      setBusy(false);
    }
  }

  async function applyDefaults(){
    setBusy(true);
    try{
      const mainOpts=await loadOptions(day,defaultEntryType,defaultReason);
      const main=defaultOption(mainOpts);
      const deliveryDay=defaultDeliveryDay(day,defaultReason);
      const deliveryOpts=defaultEntryType==="delivery" ? [] : await loadOptions(deliveryDay,"delivery",defaultReason);
      const delivery=defaultOption(deliveryOpts,true);
      setSelected(old=>old.map(item=>({
        ...item,
        entryType:defaultEntryType,
        reason:defaultReason,
        timeKey:main?.key||"",
        onsiteMode:"exact",
        onsiteTime:"09:00",
        onsiteDuration:defaultOnsiteDuration,
        inspectionScheduleType:(defaultReason==="点検"||defaultReason==="車検") ? defaultInspectionScheduleType : "",
        staffId:defaultStaffId,
        vendorName:defaultVendorName,
        isUrgent:defaultUrgent,
        needsLoaner:defaultLoaner,
        addDelivery:defaultEntryType!=="delivery",
        deliveryDay,
        deliveryTimeKey:delivery?.key||"",
      })));
      setMessage("共通設定を選択中の全車両へ適用しました。");
    }catch(error:any){
      setMessage("共通設定の反映エラー: "+(error?.message||error));
    }finally{
      setBusy(false);
    }
  }

  function onsiteTimes(item:SelectedItem){
    const time=item.onsiteMode==="morning" ? "09:00" : item.onsiteMode==="unspecified" ? "13:00" : item.onsiteTime;
    const startsAt=jstIso(day,time);
    return {startsAt,endsAt:plusMinutes(startsAt,item.onsiteDuration),printMode:item.onsiteMode};
  }

  async function itemPayload(item:SelectedItem){
    let main:{startsAt:string;endsAt:string;printMode:Mode};
    if(item.entryType==="onsite_repair"){
      main=onsiteTimes(item);
    }else{
      const opts=await loadOptions(day,item.entryType,item.reason);
      const picked=opts.find(x=>x.key===item.timeKey);
      if(!picked) throw new Error(`${customerLabel(item)}：時間を選択してください。`);
      main={startsAt:picked.startsAt,endsAt:picked.endsAt,printMode:picked.mode};
    }

    let delivery:TimeOption|null=null;
    if(item.addDelivery && item.entryType!=="delivery"){
      const opts=await loadOptions(item.deliveryDay,"delivery",item.reason);
      delivery=opts.find(x=>x.key===item.deliveryTimeKey)||null;
      if(!delivery) throw new Error(`${customerLabel(item)}：納車時間を選択してください。`);
      const before=delivery.mode==="exact"
        ? new Date(delivery.startsAt).getTime()<new Date(main.endsAt).getTime()
        : item.deliveryDay<day;
      if(before) throw new Error(`${customerLabel(item)}：納車予定が入庫・作業予定より前です。`);
    }

    const vendor=externalVendors.find(v=>v.display_name===item.vendorName || v.short_name===item.vendorName)||null;
    return {
      vehicleId:item.vehicleId,
      customerId:item.customerId,
      customerName:customerLabel(item),
      companyName:item.companyName,
      phone:item.phone,
      scheduleDisplayName:item.scheduleDisplayName,
      registrationNumber:item.registrationNumber,
      registrationLast4:item.registrationLast4,
      maker:item.maker,
      model:item.model,
      entryType:item.entryType,
      reason:item.reason,
      startsAt:main.startsAt,
      endsAt:main.endsAt,
      printTimeMode:main.printMode,
      inspectionScheduleType:item.inspectionScheduleType||null,
      staffId:item.staffId||null,
      vendorId:vendor?.id||null,
      vendorName:vendor?null:(item.vendorName.trim()||null),
      notes:item.notes.trim()||null,
      isUrgent:item.isUrgent,
      needsLoaner:item.needsLoaner,
      addDelivery:item.addDelivery && item.entryType!=="delivery",
      deliveryStartsAt:delivery?.startsAt||null,
      deliveryEndsAt:delivery?.endsAt||null,
      deliveryPrintTimeMode:delivery?.mode||null,
    };
  }

  async function submit(override=false){
    setWarnings([]);
    setHardErrors([]);
    if(!selected.length){
      setHardErrors(["登録する車両を1台以上選択してください。"]);
      return;
    }
    setBusy(true);
    try{
      const items=[];
      for(const item of selected) items.push(await itemPayload(item));
      const {data,error}=await supabase.rpc("create_schedule_registration_batch_v1",{
        p_day:day,
        p_items:items,
        p_allow_warning_override:override,
      });
      if(error) throw error;

      const hard=Array.isArray(data?.hardErrors)?data.hardErrors.map(String):[];
      const warns=Array.isArray(data?.warnings)?data.warnings.map(String):[];
      const failedIndex=Number(data?.failedIndex||0);
      const failedItem=failedIndex>0 ? selected[failedIndex-1] : null;
      const failedLabel=failedItem ? `${customerLabel(failedItem)} / ${vehicleLabel(failedItem)}` : "";
      if(data?.overrideRequired && !override){
        const contextualWarnings=(warns.length?warns:["上限・重複の警告があります。"])
          .map((warning:string)=>failedLabel ? `${failedLabel}：${warning}` : warning);
        setWarnings(contextualWarnings);
        setMessage(failedLabel
          ? `${failedLabel} に警告があります。まとめ登録はまだ行っていません。`
          : "まとめ登録はまだ行っていません。警告を確認してください。");
        return;
      }
      if(!data?.created){
        const contextualHard=hard.map((problem:string)=>failedLabel ? `${failedLabel}：${problem}` : problem);
        setHardErrors(contextualHard.length?contextualHard:[failedItem ? `${failedLabel} の予定を登録できません。` : "まとめ登録できませんでした。"]);
        setMessage(data?.rolledBack ? "1台で問題が見つかったため、全台をロールバックしました。" : "まとめ登録できませんでした。");
        return;
      }

      setMessage(`${data?.createdCount||selected.length}台の予定をまとめて登録しました。`);
      window.setTimeout(()=>location.assign("/schedule?day="+day),500);
    }catch(error:any){
      setHardErrors([error?.message||String(error)]);
      setMessage("まとめ予定登録エラー。登録は完了していません。");
    }finally{
      setBusy(false);
    }
  }

  const selectedIds=useMemo(()=>new Set(selected.map(x=>x.vehicleId)),[selected]);

  return <main className="bulkPage">
    <header className="top">
      <button onClick={()=>location.assign("/schedule/new?day="+day)}>← 1台登録へ</button>
      <div><b>複数台まとめて予定登録</b><span>同じ日なら同一・別のお客様を混在できます</span></div>
      <strong>icb</strong>
    </header>

    <section className="card">
      <div className="headRow"><div><div className="eyebrow">共通日付</div><h1>{day}</h1></div><input type="date" value={day} onChange={(e)=>void changeCommonDay(e.target.value)} /></div>
      <div className="notice">{busy?"処理中…":message}</div>
      {!!hardErrors.length && <div className="errors"><b>登録できません</b>{hardErrors.map((x,i)=><div key={i}>・{x}</div>)}</div>}
      {!!warnings.length && <div className="warnings"><b>確認が必要</b>{warnings.map((x,i)=><div key={i}>・{x}</div>)}<button disabled={busy} onClick={()=>void submit(true)}>警告を確認して全台登録</button></div>}
    </section>

    <section className="card">
      <h2>① 車両を複数選択</h2>
      <div className="searchRow">
        <input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")void searchVehicles();}} placeholder="お客様名 / 電話 / 下4桁 / 車台番号 / 型式" />
        <button disabled={busy} onClick={()=>void searchVehicles()}>検索</button>
      </div>
      <small className="hint">別のお客様を続けて検索しても、すでに選んだ車両は残ります。</small>
      <div className="resultGrid">
        {results.map(v=>{
          const picked=selectedIds.has(v.vehicleId);
          return <button type="button" key={v.vehicleId} className={picked?"vehicleResult picked":"vehicleResult"} disabled={busy||picked} onClick={()=>void addVehicle(v)}>
            <b>{customerLabel(v)}</b>
            <span>{vehicleLabel(v)}　下4桁 {last4Label(v)}</span>
            <small>{[v.maker,v.model,v.chassisNumber].filter(Boolean).join(" / ")||"車両詳細なし"}</small>
            <em>{picked?"選択済み":"＋ 追加"}</em>
          </button>;
        })}
      </div>
    </section>

    <section className="card">
      <h2>② 共通初期設定</h2>
      <div className="commonGrid">
        <label>区分<select value={defaultEntryType} onChange={(e)=>setDefaultEntryType(e.target.value as EntryType)}>
          <option value="pickup">引取</option><option value="customer_visit">来社</option><option value="onsite_repair">出張</option><option value="delivery">納車</option>
        </select></label>
        <label>入庫要因<select value={defaultReason} onChange={(e)=>setDefaultReason(e.target.value as Reason)}>
          <option>点検</option><option>車検</option><option>一般整備</option><option>板金塗装</option>
        </select></label>
        {(defaultReason==="点検"||defaultReason==="車検") && <label>点検区分<select value={defaultInspectionScheduleType} onChange={(e)=>setDefaultInspectionScheduleType(e.target.value)}>
          <option value="">未指定</option><option value="schedule">通常予定</option><option value="legal_6m">法定6ヶ月</option><option value="legal_12m">法定12ヶ月</option>
        </select></label>}
        {defaultEntryType==="onsite_repair" && <label>出張作業時間<select value={defaultOnsiteDuration} onChange={(e)=>setDefaultOnsiteDuration(Number(e.target.value))}>
          <option value={30}>30分</option><option value={60}>60分</option><option value={90}>90分</option><option value={120}>120分</option>
        </select></label>}
        <label>作業担当<select value={defaultStaffId} onChange={(e)=>setDefaultStaffId(e.target.value)}>
          <option value="">未選択</option>{staffMembers.map(s=><option key={s.id} value={s.id}>{s.short_name||s.display_name}</option>)}
        </select></label>
        {(defaultReason==="一般整備"||defaultReason==="板金塗装") && <label>外注先<input list="bulk-vendors" value={defaultVendorName} onChange={(e)=>setDefaultVendorName(e.target.value)} placeholder="自社なら空欄" /></label>}
        <label className="check"><input type="checkbox" checked={defaultUrgent} onChange={(e)=>setDefaultUrgent(e.target.checked)} />急ぎ</label>
        <label className="check"><input type="checkbox" checked={defaultLoaner} onChange={(e)=>setDefaultLoaner(e.target.checked)} />代車あり</label>
      </div>
      <datalist id="bulk-vendors">{externalVendors.map(v=><option key={v.id} value={v.display_name}>{v.short_name||v.display_name}</option>)}</datalist>
      <button disabled={busy||!selected.length} onClick={()=>void applyDefaults()}>この設定を選択中 {selected.length}台へ一括適用</button>
    </section>

    <section className="card">
      <div className="headRow"><h2>③ 選択中の車両</h2><strong>{selected.length}台</strong></div>
      {!selected.length && <div className="empty">上の検索から車両を追加してください。</div>}
      <div className="selectedList">
        {selected.map((item,index)=>{
          const opts=optionsCache[optionKey(day,item.entryType,item.reason)]||[];
          const deliveryOpts=optionsCache[optionKey(item.deliveryDay,"delivery",item.reason)]||[];
          return <article className="selectedCard" key={item.vehicleId}>
            <div className="selectedHead">
              <div><span>{index+1}</span><b>{customerLabel(item)}</b><small>{vehicleLabel(item)} / 下4桁 {last4Label(item)}</small></div>
              <button className="remove" onClick={()=>removeVehicle(item.vehicleId)}>外す</button>
            </div>
            <div className="rowGrid">
              <label>区分<select value={item.entryType} onChange={(e)=>void changeSchedule(item.vehicleId,{entryType:e.target.value as EntryType})}>
                <option value="pickup">引取</option><option value="customer_visit">来社</option><option value="onsite_repair">出張</option><option value="delivery">納車</option>
              </select></label>
              <label>入庫要因<select value={item.reason} onChange={(e)=>void changeSchedule(item.vehicleId,{reason:e.target.value as Reason})}>
                <option>点検</option><option>車検</option><option>一般整備</option><option>板金塗装</option>
              </select></label>
              {(item.reason==="点検"||item.reason==="車検") && <label>点検区分<select value={item.inspectionScheduleType} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,inspectionScheduleType:e.target.value}:x))}>
                <option value="">未指定</option><option value="schedule">通常予定</option><option value="legal_6m">法定6ヶ月</option><option value="legal_12m">法定12ヶ月</option>
              </select></label>}
              {item.entryType!=="onsite_repair" ? <label>時間<select value={item.timeKey} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,timeKey:e.target.value}:x))}>
                <option value="">選択</option>
                {opts.map(o=><option key={o.key} value={o.key} disabled={o.availability==="blocked"}>{o.availability==="blocked"?"×":o.availability==="warning"?"△":"○"} {o.label}</option>)}
              </select></label> : <>
                <label>出張枠<select value={item.onsiteMode} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,onsiteMode:e.target.value as Mode}:x))}>
                  <option value="exact">時間指定</option><option value="morning">A中</option><option value="unspecified">中</option>
                </select></label>
                {item.onsiteMode==="exact" && <label>開始<input type="time" min="08:30" max="17:00" step="1800" value={item.onsiteTime} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,onsiteTime:e.target.value}:x))} /></label>}
                <label>作業時間<select value={item.onsiteDuration} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,onsiteDuration:Number(e.target.value)}:x))}>
                  <option value={30}>30分</option><option value={60}>60分</option><option value={90}>90分</option><option value={120}>120分</option>
                </select></label>
              </>}
              <label>担当<select value={item.staffId} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,staffId:e.target.value}:x))}>
                <option value="">未選択</option>{staffMembers.map(s=><option key={s.id} value={s.id}>{s.short_name||s.display_name}</option>)}
              </select></label>
              {(item.reason==="一般整備"||item.reason==="板金塗装") && <label>外注先<input list="bulk-vendors" value={item.vendorName} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,vendorName:e.target.value}:x))} placeholder="自社なら空欄" /></label>}
              <div className="flags">
                <label><input type="checkbox" checked={item.isUrgent} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,isUrgent:e.target.checked}:x))} />急ぎ</label>
                <label><input type="checkbox" checked={item.needsLoaner} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,needsLoaner:e.target.checked}:x))} />代車</label>
              </div>
              {item.entryType!=="delivery" && <label className="deliverySwitch"><input type="checkbox" checked={item.addDelivery} onChange={(e)=>void changeSchedule(item.vehicleId,{addDelivery:e.target.checked})} />納車予定も登録</label>}
              {item.addDelivery && item.entryType!=="delivery" && <>
                <label>納車日<input type="date" value={item.deliveryDay} onChange={(e)=>void changeDeliveryDay(item.vehicleId,e.target.value)} /></label>
                <label>納車時間<select value={item.deliveryTimeKey} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,deliveryTimeKey:e.target.value}:x))}>
                  <option value="">選択</option>{deliveryOpts.map(o=><option key={o.key} value={o.key} disabled={o.availability==="blocked"}>{o.availability==="blocked"?"×":o.availability==="warning"?"△":"○"} {o.label}</option>)}
                </select></label>
              </>}
              <label className="wide">備考<input value={item.notes} onChange={(e)=>setSelected(old=>old.map(x=>x.vehicleId===item.vehicleId?{...x,notes:e.target.value}:x))} /></label>
            </div>
          </article>;
        })}
      </div>
      <button className="primary" disabled={busy||!selected.length} onClick={()=>void submit(false)}>選択した {selected.length}台をまとめて登録</button>
      <small className="safeNote">1台でも登録不可なら全台ロールバックします。途中まで登録されません。</small>
    </section>

    <style jsx global>{`
      *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      button,input,select{font:inherit}.bulkPage{max-width:1080px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:11px;color:#708096}
      button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 12px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:16px;margin-bottom:12px}.card h2{margin:0 0 10px}.eyebrow{color:#2674e8;font-weight:900}.headRow{display:flex;justify-content:space-between;align-items:center;gap:10px}.headRow h1{margin:3px 0}.headRow input{max-width:180px}
      input,select{border:1px solid #cbd6e3;border-radius:9px;padding:10px;background:#fff;color:#172033}.notice{margin-top:10px;background:#eef6ff;border-radius:11px;padding:10px;color:#49627e}.errors,.warnings{margin-top:10px;border-radius:11px;padding:10px}.errors{background:#fff0ef;color:#9a362f;border:1px solid #efb4af}.warnings{background:#fff7e8;color:#79540c;border:1px solid #e6c37d}.warnings button{margin-top:8px}.searchRow{display:grid;grid-template-columns:1fr auto;gap:8px}.hint,.safeNote{display:block;margin-top:7px;color:#718096}
      .resultGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.vehicleResult{text-align:left;color:#172033;display:grid;gap:3px;position:relative}.vehicleResult span,.vehicleResult small{color:#617086}.vehicleResult em{font-style:normal;color:#2674e8;font-size:11px}.vehicleResult.picked{background:#edf5ff;border-color:#8db9f5}
      .commonGrid,.rowGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.commonGrid label,.rowGrid label{display:grid;gap:4px;font-size:11px;font-weight:800;color:#5f6c7c}.check,.flags label,.deliverySwitch{display:flex!important;align-items:center;gap:6px}.check input,.flags input,.deliverySwitch input{width:auto}.selectedList{display:grid;gap:9px}.selectedCard{border:1px solid #dbe3ee;border-radius:14px;padding:12px;background:#fbfcfe}.selectedHead{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:9px}.selectedHead>div{display:grid;grid-template-columns:auto 1fr;column-gap:7px}.selectedHead span{grid-row:1/3;width:28px;height:28px;border-radius:999px;background:#2f6fe4;color:#fff;display:grid;place-items:center;font-weight:900}.selectedHead small{color:#6c7888}.remove{color:#a43b3b;border-color:#e0aaaa;padding:6px 9px}.flags{display:flex;align-items:center;gap:10px}.wide{grid-column:1/-1}.primary{width:100%;margin-top:12px;background:#2f6fe4;color:#fff;border-color:#2f6fe4;padding:13px}.empty{padding:22px;text-align:center;color:#8390a1;background:#f7f9fc;border-radius:11px}
      @media(max-width:850px){.resultGrid{grid-template-columns:1fr 1fr}.commonGrid,.rowGrid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.top>div span{display:none}.resultGrid,.commonGrid,.rowGrid{grid-template-columns:1fr}.headRow{align-items:flex-end}.selectedHead{align-items:center}}
    `}</style>
  </main>;
}
