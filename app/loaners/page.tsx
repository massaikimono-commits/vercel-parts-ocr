/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

type LoanerVehicle = {
  loanerVehicleId: string;
  displayName: string;
  sourceType: "company_vehicle" | "rental_company";
  sourceLabel: string;
  providerName: string | null;
  registrationLast4: string | null;
  maker: string | null;
  model: string | null;
  operationalStatus: string;
  reservations: Array<{
    loanerReservationId: string;
    status: string;
    rentalProviderStatus: string | null;
    rentalReservationReference: string | null;
    startsAt: string;
    endsAt: string;
    bookingRequestId: string | null;
    bookingReference: string | null;
    customerName: string | null;
    registrationLast4: string | null;
    reason: string | null;
    workOrderId: string | null;
  }>;
};

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"
  }).format(new Date());
}

function timeLabel(value:string) {
  return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
}

function reservationStatusLabel(status:string) {
  if(status==="checked_out") return "貸出中";
  if(status==="returned") return "返却済み";
  if(status==="cancelled") return "取消";
  return "予約済み";
}

function providerStatusLabel(status:string | null) {
  if(!status || status==="not_applicable") return null;
  if(status==="reserved") return "会社予約済み";
  if(status==="cancellation_requested") return "取消連絡待ち";
  if(status==="cancelled") return "会社側取消済み";
  return status;
}

function vehicleAvailabilityLabel(v:LoanerVehicle, activeReservations:number) {
  if(v.operationalStatus==="maintenance") return "整備中";
  if(v.operationalStatus==="out_of_service") return "使用停止";
  if(v.operationalStatus!=="active") return v.operationalStatus;
  return activeReservations===0 ? "空き" : "使用予定あり";
}

function isAvailable(v:LoanerVehicle) {
  return v.operationalStatus==="active" && !v.reservations?.some(r=>r.status!=="returned" && r.status!=="cancelled");
}

export default function LoanerPage() {
  const [day,setDay] = useState(todayJst());
  const [vehicles,setVehicles] = useState<LoanerVehicle[]>([]);
  const [counts,setCounts] = useState<any>({});
  const [busy,setBusy] = useState(true);
  const [message,setMessage] = useState("代車の空き状況を読み込みます。");
  const [name,setName] = useState("");
  const [sourceType,setSourceType] = useState<"company_vehicle"|"rental_company">("company_vehicle");
  const [provider,setProvider] = useState("");
  const [last4,setLast4] = useState("");
  const [maker,setMaker] = useState("");
  const [model,setModel] = useState("");

  useEffect(()=>{ void load(); },[day]);

  async function load() {
    setBusy(true);
    const {data,error} = await supabase.rpc("loaner_day_board",{p_day:day});
    if(error){
      setMessage("代車一覧の読み込みエラー: "+error.message);
    }else{
      setVehicles((data?.vehicles || []) as LoanerVehicle[]);
      setCounts(data?.counts || {});
      setMessage(day+" の代車状況");
    }
    setBusy(false);
  }

  async function addVehicle() {
    if(!name.trim()){
      setMessage("代車名を入力してください。");
      return;
    }
    setBusy(true);
    const {error} = await supabase.from("loaner_vehicles").insert({
      display_name:name.trim(),
      source_type:sourceType,
      provider_name:sourceType==="rental_company" ? provider.trim() || null : null,
      registration_last4:last4.replace(/\D/g,"").slice(-4) || null,
      maker:maker.trim() || null,
      model:model.trim() || null,
      operational_status:"active",
      updated_at:new Date().toISOString(),
    });
    if(error){
      setMessage("代車追加エラー: "+error.message);
      setBusy(false);
      return;
    }
    setName(""); setProvider(""); setLast4(""); setMaker(""); setModel("");
    setMessage("代車を追加しました。");
    await load();
  }

  async function setStatus(id:string,status:string) {
    setBusy(true);
    const {error}=await supabase.from("loaner_vehicles").update({
      operational_status:status,
      updated_at:new Date().toISOString(),
    }).eq("id",id);
    if(error) setMessage("状態更新エラー: "+error.message);
    else setMessage("代車状態を更新しました。");
    await load();
  }

  async function updateReservationStatus(id:string,status:"reserved"|"checked_out"|"returned"|"cancelled") {
    setBusy(true);
    const {error}=await supabase.rpc("update_loaner_reservation_status",{
      p_reservation_id:id,
      p_status:status,
      p_actor:"staff",
    });
    if(error){
      setMessage("貸出状態の更新エラー: "+error.message);
      setBusy(false);
      return;
    }
    setMessage(status==="checked_out"?"代車を貸出中にしました。":status==="returned"?"代車を返却済みにしました。":"代車予約の状態を更新しました。");
    await load();
  }

  const availableCount = useMemo(()=>vehicles.filter(isAvailable).length,[vehicles]);

  const availableBySource = useMemo(() => ({
    company: vehicles.filter(v=>v.sourceType==="company_vehicle" && isAvailable(v)).length,
    rental: vehicles.filter(v=>v.sourceType==="rental_company" && isAvailable(v)).length,
  }), [vehicles]);

  return (
    <main className="loanerPage">
      <header className="top">
        <button onClick={()=>location.assign("/")}>← メインへ</button>
        <div><b>代車管理</b><span>自社代車・レンタカー</span></div>
        <strong>icb</strong>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">代車ボード</div>
          <h1>{day}</h1>
          <div className="notice">{busy?"読み込み中…":message}</div>
        </div>
        <div className="summary">
          <div><small>空き合計</small><b>{availableCount}</b></div>
          <div className="availableBreakdown"><small>自社空き</small><b>{availableBySource.company}<em> / {counts.companyVehiclesActive ?? 0}</em></b></div>
          <div className="availableBreakdown"><small>レンタカー空き</small><b>{availableBySource.rental}<em> / {counts.rentalCompanyVehiclesActive ?? 0}</em></b></div>
          <div><small>予約/貸出</small><b>{counts.reservedOnDay ?? 0}</b></div>
          {(counts.rentalCancellationPending ?? 0)>0 && <div className="warningCount"><small>取消連絡待ち</small><b>{counts.rentalCancellationPending}</b></div>}
        </div>
      </section>

      <section className="dateBar">
        <input type="date" value={day} onChange={(e)=>setDay(e.target.value)} />
        <button onClick={()=>setDay(todayJst())}>今日</button>
      </section>

      <section className="board">
        {vehicles.map(v=>{
          const activeReservations=(v.reservations||[]).filter(r=>r.status!=="returned" && r.status!=="cancelled");
          const available=isAvailable(v);
          const availabilityLabel=vehicleAvailabilityLabel(v,activeReservations.length);
          return (
            <article className={`loanerCard ${available?"available":"busyCard"}`} key={v.loanerVehicleId}>
              <div className="cardHead">
                <div>
                  <b>{v.displayName}</b>
                  <span>{v.sourceLabel}{v.providerName?" / "+v.providerName:""}</span>
                </div>
                <strong className={available?"ok":"ng"}>{availabilityLabel}</strong>
              </div>
              <div className="meta">
                {v.registrationLast4 && <span>下4桁 {v.registrationLast4}</span>}
                {(v.maker||v.model) && <span>{[v.maker,v.model].filter(Boolean).join(" ")}</span>}
                <span>{v.operationalStatus==="active"?"稼働中":v.operationalStatus==="maintenance"?"整備中":v.operationalStatus}</span>
              </div>
              {(v.reservations||[]).map(r=>{
                const providerStatus=providerStatusLabel(r.rentalProviderStatus);
                return (
                <div className={`reservation status-${r.status}`} key={r.loanerReservationId}>
                  <div className="reservationMain">
                    <b>{timeLabel(r.startsAt)}〜{timeLabel(r.endsAt)}</b>
                    <span>{r.customerName || "予約"}</span>
                    <strong className="reservationStatus">{reservationStatusLabel(r.status)}</strong>
                    {r.registrationLast4 && <small>下4桁 {r.registrationLast4}</small>}
                    {r.reason && <small>{r.reason}</small>}
                  </div>
                  <div className="bookingLinkRow">
                    {r.bookingReference && <span className="bookingRef">予約 {r.bookingReference}</span>}
                    {r.workOrderId && <span className="linked">作業と紐付け済み</span>}
                    {r.bookingRequestId && <span className="linked">受付と紐付け済み</span>}
                  </div>
                  {(providerStatus || r.rentalReservationReference) && (
                    <div className="rentalInfo">
                      {providerStatus && <span>{providerStatus}</span>}
                      {r.rentalReservationReference && <span>会社予約番号 {r.rentalReservationReference}</span>}
                    </div>
                  )}
                  <div className="reservationActions">
                    {r.status==="reserved" && <button disabled={busy} onClick={()=>void updateReservationStatus(r.loanerReservationId,"checked_out")}>貸出開始</button>}
                    {r.status==="checked_out" && <button className="returnBtn" disabled={busy} onClick={()=>void updateReservationStatus(r.loanerReservationId,"returned")}>返却</button>}
                    {r.status==="returned" && <button disabled={busy} onClick={()=>void updateReservationStatus(r.loanerReservationId,"reserved")}>予約に戻す</button>}
                  </div>
                </div>
                );
              })}
              <div className="actions">
                <button onClick={()=>void setStatus(v.loanerVehicleId,"active")}>稼働</button>
                <button onClick={()=>void setStatus(v.loanerVehicleId,"maintenance")}>整備中</button>
                <button onClick={()=>void setStatus(v.loanerVehicleId,"out_of_service")}>使用停止</button>
              </div>
            </article>
          );
        })}
        {!vehicles.length && !busy && <div className="empty">代車がまだ登録されていません。</div>}
      </section>

      <section className="addCard">
        <h2>代車を追加</h2>
        <div className="grid">
          <label>種類
            <select value={sourceType} onChange={(e)=>setSourceType(e.target.value as any)}>
              <option value="company_vehicle">自社代車</option>
              <option value="rental_company">レンタカー会社</option>
            </select>
          </label>
          <label>表示名<input value={name} onChange={(e)=>setName(e.target.value)} placeholder="例：N-BOX 1号車" /></label>
          {sourceType==="rental_company" && <label>レンタカー会社<input value={provider} onChange={(e)=>setProvider(e.target.value)} /></label>}
          <label>ナンバー下4桁<input inputMode="numeric" maxLength={4} value={last4} onChange={(e)=>setLast4(e.target.value.replace(/\D/g,"").slice(-4))} /></label>
          <label>メーカー<input value={maker} onChange={(e)=>setMaker(e.target.value)} /></label>
          <label>車種<input value={model} onChange={(e)=>setModel(e.target.value)} /></label>
        </div>
        <button className="primary" disabled={busy} onClick={()=>void addVehicle()}>＋ 代車を追加</button>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}
        .loanerPage{max-width:1100px;margin:0 auto;padding:16px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.top>div{display:grid;text-align:center}.top span{font-size:12px;color:#78869a}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:9px 12px;font-weight:800}
        .hero,.addCard{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:18px;margin-bottom:12px}.hero{display:flex;justify-content:space-between;gap:12px}.eyebrow{color:#2674e8;font-weight:800}.hero h1{margin:3px 0}.notice{color:#667487}.summary{display:flex;gap:7px;flex-wrap:wrap}.summary>div{background:#f6f8fb;border-radius:12px;padding:10px;min-width:80px;display:grid}.summary b{font-size:22px}.summary small{color:#78869a}.summary .availableBreakdown{background:#eef8f1}.summary .availableBreakdown b{color:#25703c}.summary .availableBreakdown em{font-size:12px;color:#6c7888;font-style:normal}.summary .warningCount{background:#fff0db}.summary .warningCount b{color:#925b08}
        .dateBar{display:flex;gap:8px;margin-bottom:12px}.dateBar input,.grid input,.grid select{border:1px solid #cbd6e3;border-radius:10px;padding:10px;background:#fff}.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:14px}.loanerCard{background:#fff;border:1px solid #dbe3ee;border-radius:15px;padding:13px}.loanerCard.available{box-shadow:inset 4px 0 0 #6fb184}.loanerCard.busyCard{box-shadow:inset 4px 0 0 #d79a3d}.cardHead{display:flex;justify-content:space-between;gap:8px}.cardHead>div{display:grid}.cardHead>div span{font-size:11px;color:#6d798a}.cardHead strong{font-size:11px;border-radius:999px;padding:4px 7px;height:max-content}.cardHead .ok{background:#e9f7ef;color:#25703c}.cardHead .ng{background:#fff0db;color:#925b08}.meta{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}.meta span{font-size:10px;background:#f1f4f8;border-radius:999px;padding:3px 6px}.reservation{margin-top:8px;background:#f8fafc;border-radius:9px;padding:8px;display:grid;gap:7px}.reservationMain{display:flex;gap:5px;flex-wrap:wrap;align-items:center}.reservationMain>span{font-weight:800}.reservation small{color:#6c7888}.reservationStatus{font-size:10px;border-radius:999px;padding:3px 6px;background:#eef2f7;color:#596678}.status-checked_out .reservationStatus{background:#fff0db;color:#925b08}.status-returned{opacity:.72}.status-returned .reservationStatus{background:#e9f7ef;color:#25703c}.bookingLinkRow,.rentalInfo{display:flex;gap:5px;flex-wrap:wrap}.bookingLinkRow span,.rentalInfo span{font-size:10px;border-radius:999px;padding:3px 6px}.bookingRef{background:#e9f1ff;color:#285fb9;font-weight:900}.linked{background:#edf7ee;color:#347246}.rentalInfo span{background:#fff4df;color:#8a5b0a}.reservationActions{display:flex;gap:5px}.reservationActions button{font-size:11px;padding:6px 9px}.reservationActions .returnBtn{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.actions button{font-size:10px;padding:6px 8px}.empty{background:#fff;padding:25px;border-radius:14px;text-align:center;color:#8592a4}
        .addCard h2{margin-top:0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.grid label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#627083}.primary{margin-top:12px;background:#2f6fe4;color:#fff;border-color:#2f6fe4}
        @media(max-width:800px){.hero{display:block}.summary{margin-top:10px}.board{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr}}
      `}</style>
    </main>
  );
}