/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type EntryType = "pickup" | "customer_visit" | "onsite_repair";
type Reason = "点検" | "車検" | "一般整備" | "板金塗装";

type TimeOption = {
  key: string;
  label: string;
  mode: "exact" | "morning" | "unspecified";
  startsAt: string;
  endsAt: string;
};

type Staff = {
  id: string;
  display_name: string;
  short_name: string | null;
};

type Vehicle = {
  id: string;
  customer_id: string | null;
  registration_number: string | null;
  registration_number_last4: string | null;
  chassis_number: string | null;
  maker: string | null;
  model: string | null;
};

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  schedule_display_name: string | null;
  phone: string | null;
};

const ACTIVE_KEY = "parts-active-vehicle";

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function jstIso(day: string, time: string) {
  return new Date(`${day}T${time}:00+09:00`).toISOString();
}

function plusMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function extractCheck(value: any) {
  return {
    allowed: Boolean(value?.allowed),
    overrideRequired: Boolean(value?.override_required),
    hardErrors: Array.isArray(value?.hard_errors) ? value.hard_errors.map(String) : [],
    warnings: Array.isArray(value?.warnings) ? value.warnings.map(String) : [],
  };
}

export default function ActiveVehicleSchedulePage() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [day, setDay] = useState(todayJst());
  const [entryType, setEntryType] = useState<EntryType>("customer_visit");
  const [reason, setReason] = useState<Reason>("車検");
  const [inspectionScheduleType, setInspectionScheduleType] = useState("");
  const [timeOptions, setTimeOptions] = useState<TimeOption[]>([]);
  const [timeKey, setTimeKey] = useState("");
  const [onsiteTime, setOnsiteTime] = useState("09:00");
  const [onsiteDuration, setOnsiteDuration] = useState("60");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [needsLoaner, setNeedsLoaner] = useState(false);
  const [notes, setNotes] = useState("");
  const [addDelivery, setAddDelivery] = useState(true);
  const [deliveryDay, setDeliveryDay] = useState(todayJst());
  const [deliveryOptions, setDeliveryOptions] = useState<TimeOption[]>([]);
  const [deliveryKey, setDeliveryKey] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("選択中の既存車両へ予定を登録します。");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadActiveVehicle();
    void loadStaff();
  }, []);

  useEffect(() => {
    void loadMainOptions();
  }, [day, entryType]);

  useEffect(() => {
    setDeliveryDay((old) => old || day);
  }, [day]);

  useEffect(() => {
    if (addDelivery) void loadDeliveryOptions();
  }, [deliveryDay, addDelivery]);

  async function loadActiveVehicle() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
      if (!saved?.id) {
        setMessage("作業車両が選択されていません。顧客・車両管理から車両を選択してください。");
        return;
      }
      const { data: vehicleData, error: vehicleError } = await supabase
        .from("vehicles")
        .select("id,customer_id,registration_number,registration_number_last4,chassis_number,maker,model")
        .eq("id", saved.id)
        .single();
      if (vehicleError) throw vehicleError;
      setVehicle(vehicleData as Vehicle);

      if (vehicleData.customer_id) {
        const { data: customerData, error: customerError } = await supabase
          .from("customers")
          .select("id,name,company_name,schedule_display_name,phone")
          .eq("id", vehicleData.customer_id)
          .single();
        if (customerError) throw customerError;
        setCustomer(customerData as Customer);
      }
    } catch (error: any) {
      setMessage(`作業車両の読み込みエラー: ${error?.message || error}`);
    }
  }

  async function loadStaff() {
    const { data, error } = await supabase
      .from("staff_members")
      .select("id,display_name,short_name")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    if (!error) setStaff((data || []) as Staff[]);
  }

  async function loadMainOptions() {
    if (entryType === "onsite_repair") {
      setTimeOptions([]);
      setTimeKey("");
      return;
    }
    const { data, error } = await supabase.rpc("schedule_time_options", {
      p_day: day,
      p_entry_type: entryType,
    });
    if (error) {
      setMessage(`時間候補の読み込みエラー: ${error.message}`);
      return;
    }
    const options = Array.isArray(data?.options) ? data.options as TimeOption[] : [];
    setTimeOptions(options);
    setTimeKey((old) => options.some((x) => x.key === old) ? old : options[0]?.key || "");
  }

  async function loadDeliveryOptions() {
    const { data, error } = await supabase.rpc("schedule_time_options", {
      p_day: deliveryDay,
      p_entry_type: "delivery",
    });
    if (error) {
      setMessage(`納車時間候補の読み込みエラー: ${error.message}`);
      return;
    }
    const options = Array.isArray(data?.options) ? data.options as TimeOption[] : [];
    setDeliveryOptions(options);
    setDeliveryKey((old) => options.some((x) => x.key === old) ? old : options[0]?.key || "");
  }

  const selectedTime = useMemo(() => timeOptions.find((x) => x.key === timeKey) || null, [timeOptions, timeKey]);
  const selectedDelivery = useMemo(() => deliveryOptions.find((x) => x.key === deliveryKey) || null, [deliveryOptions, deliveryKey]);

  function mainTimes() {
    if (entryType === "onsite_repair") {
      const startsAt = jstIso(day, onsiteTime);
      return {
        startsAt,
        endsAt: plusMinutes(startsAt, Math.max(30, Number(onsiteDuration) || 60)),
        printMode: "exact" as const,
      };
    }
    if (!selectedTime) return null;
    return {
      startsAt: selectedTime.startsAt,
      endsAt: selectedTime.endsAt,
      printMode: selectedTime.mode,
    };
  }

  async function checkSlot(entry: string, startsAt: string, endsAt: string) {
    const { data, error } = await supabase.rpc("schedule_slot_check", {
      p_entry_type: entry,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_reason: reason,
      p_exclude_entry_id: null,
    });
    if (error) throw error;
    return extractCheck(data);
  }

  async function submit(allowOverride = false) {
    setWarnings([]);
    setErrors([]);
    if (!vehicle) {
      setErrors(["作業車両を選択してください。"]);
      return;
    }
    const main = mainTimes();
    if (!main) {
      setErrors(["時間を選択してください。"]);
      return;
    }
    if (addDelivery && !selectedDelivery) {
      setErrors(["納車時間を選択してください。"]);
      return;
    }

    setBusy(true);
    try {
      const mainCheck = await checkSlot(entryType, main.startsAt, main.endsAt);
      const deliveryCheck = addDelivery && selectedDelivery
        ? await checkSlot("delivery", selectedDelivery.startsAt, selectedDelivery.endsAt)
        : { allowed: true, overrideRequired: false, hardErrors: [] as string[], warnings: [] as string[] };

      const hardErrors = [...mainCheck.hardErrors, ...deliveryCheck.hardErrors];
      const allWarnings = [...mainCheck.warnings, ...deliveryCheck.warnings];
      if (!mainCheck.allowed || !deliveryCheck.allowed || hardErrors.length) {
        setErrors(hardErrors.length ? hardErrors : ["この時間は登録できません。"]);
        setMessage("営業時間・上限・重複条件を確認してください。");
        return;
      }
      if ((mainCheck.overrideRequired || deliveryCheck.overrideRequired) && !allowOverride) {
        setWarnings(allWarnings);
        setMessage("警告があります。確認後に登録できます。");
        return;
      }

      const { data: work, error: workError } = await supabase
        .from("work_orders")
        .insert({
          vehicle_id: vehicle.id,
          reason,
          notes: notes.trim() || null,
          scheduled_at: main.startsAt,
          inspection_schedule_type: inspectionScheduleType || null,
          is_urgent: urgent,
          needs_loaner: needsLoaner,
          planned_delivery_at: addDelivery && selectedDelivery ? selectedDelivery.startsAt : null,
        })
        .select("id")
        .single();
      if (workError) throw workError;

      const { error: scheduleError } = await supabase.from("schedule_entries").insert({
        vehicle_id: vehicle.id,
        work_order_id: work.id,
        entry_type: entryType,
        starts_at: main.startsAt,
        ends_at: main.endsAt,
        notes: notes.trim() || null,
        print_time_mode: main.printMode,
      });
      if (scheduleError) throw scheduleError;

      if (staffId) {
        const { error: staffError } = await supabase.rpc("set_work_order_worker", {
          p_work_order_id: work.id,
          p_staff_id: staffId,
          p_actor: "active-vehicle-schedule",
        });
        if (staffError) throw staffError;
      }

      if (addDelivery && selectedDelivery) {
        const { error: deliveryError } = await supabase.from("schedule_entries").insert({
          vehicle_id: vehicle.id,
          work_order_id: work.id,
          entry_type: "delivery",
          starts_at: selectedDelivery.startsAt,
          ends_at: selectedDelivery.endsAt,
          notes: notes.trim() || null,
          print_time_mode: selectedDelivery.mode,
        });
        if (deliveryError) throw deliveryError;
      }

      setMessage("既存車両へ予定を登録しました。顧客・車両を重複作成していません。");
      window.setTimeout(() => location.assign(`/schedule?day=${day}`), 450);
    } catch (error: any) {
      setMessage(`予定登録エラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  const customerName = customer?.schedule_display_name || customer?.company_name || customer?.name || "顧客未割り当て";
  const registration = vehicle?.registration_number || vehicle?.chassis_number || "車両未選択";

  return (
    <main className="page">
      <header className="top">
        <button onClick={() => location.assign("/customer-vehicles")}>← 顧客・車両管理</button>
        <strong>icb</strong>
      </header>

      <section className="card">
        <div className="eyebrow">既存車両の入出庫登録</div>
        <h1>{customerName}</h1>
        <div className="vehicleName">{registration} {[vehicle?.maker, vehicle?.model].filter(Boolean).join(" / ")}</div>
        <div className="notice">{message}</div>
        {!vehicle && <button onClick={() => location.assign("/customer-vehicles")}>車両を選択する</button>}
        {!!errors.length && <div className="errors">{errors.map((x, i) => <div key={i}>・{x}</div>)}</div>}
        {!!warnings.length && (
          <div className="warnings">
            <b>確認が必要です</b>
            {warnings.map((x, i) => <div key={i}>・{x}</div>)}
            <button disabled={busy} onClick={() => void submit(true)}>警告を確認して登録</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>① 入庫予定</h2>
        <div className="grid">
          <label>日付<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label>区分<select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)}><option value="pickup">引き取り</option><option value="customer_visit">来社</option><option value="onsite_repair">出張整備</option></select></label>
          <label>入庫要因<select value={reason} onChange={(e) => setReason(e.target.value as Reason)}><option>点検</option><option>車検</option><option>一般整備</option><option>板金塗装</option></select></label>
          {entryType === "onsite_repair" ? (
            <>
              <label>出張開始<input type="time" min="08:30" max="17:00" step="1800" value={onsiteTime} onChange={(e) => setOnsiteTime(e.target.value)} /></label>
              <label>作業枠<select value={onsiteDuration} onChange={(e) => setOnsiteDuration(e.target.value)}><option value="30">30分</option><option value="60">60分</option><option value="90">90分</option><option value="120">120分</option></select></label>
            </>
          ) : (
            <label className="wide">時間<select value={timeKey} onChange={(e) => setTimeKey(e.target.value)}>{!timeOptions.length && <option value="">候補なし</option>}{timeOptions.map((x) => <option value={x.key} key={x.key}>{x.label}</option>)}</select></label>
          )}
          {(reason === "点検" || reason === "車検") && <label>点検区分<select value={inspectionScheduleType} onChange={(e) => setInspectionScheduleType(e.target.value)}><option value="">未指定</option><option value="schedule">スケジュール点検</option><option value="legal_6m">法定6ヶ月</option><option value="legal_12m">法定12ヶ月</option></select></label>}
          <label>作業担当<select value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">未選択</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.short_name || x.display_name}</option>)}</select></label>
          <div className="flags"><label><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 急ぎ</label><label><input type="checkbox" checked={needsLoaner} onChange={(e) => setNeedsLoaner(e.target.checked)} /> 代車あり</label></div>
          <label className="wide">備考<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
      </section>

      <section className="card">
        <h2>② 納車予定</h2>
        <label className="switch"><input type="checkbox" checked={addDelivery} onChange={(e) => setAddDelivery(e.target.checked)} /> 入庫と同時に納車予定も登録する</label>
        {addDelivery && <div className="grid delivery"><label>納車日<input type="date" value={deliveryDay} onChange={(e) => setDeliveryDay(e.target.value)} /></label><label>納車時間<select value={deliveryKey} onChange={(e) => setDeliveryKey(e.target.value)}>{!deliveryOptions.length && <option value="">候補なし</option>}{deliveryOptions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label></div>}
      </section>

      <section className="card">
        <button className="primary" disabled={busy || !vehicle} onClick={() => void submit(false)}>{busy ? "登録中…" : "この車両で予定を登録"}</button>
        <p className="footnote">営業時間・昼休み・重複・午前/午後上限・午前車検台数は既存のチェックRPCで確認します。既存車両を使うため、顧客・車両の仮データは新規作成しません。</p>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:900px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.card{background:#fff;border:1px solid #d9e0ea;border-radius:20px;padding:21px;margin-bottom:15px}button,input,select,textarea{font:inherit}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 13px;font-weight:800}.eyebrow{font-weight:800;color:#2674e8}h1{margin:4px 0 6px}h2{margin:0 0 14px}.vehicleName{color:#697689;margin-bottom:12px}.notice{background:#edf7ef;border:1px solid #c3e4cb;border-radius:11px;padding:11px 13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid label{display:grid;gap:6px;font-weight:700;color:#5c6878}.wide{grid-column:1/-1}input,select,textarea{width:100%;border:1px solid #cbd6e3;border-radius:10px;padding:11px;background:#fff;color:#172033}textarea{min-height:85px}.flags{display:flex;gap:16px;align-items:center;border:1px solid #e0e6ef;border-radius:11px;padding:11px}.flags label,.switch{display:flex;gap:7px;align-items:center;font-weight:800}.flags input,.switch input{width:auto}.delivery{margin-top:12px}.primary{width:100%;padding:15px;background:#2f6fe4;color:#fff;border-color:#2f6fe4;font-size:17px}.errors,.warnings{margin-top:12px;border-radius:11px;padding:12px;line-height:1.7}.errors{background:#fff0f0;border:1px solid #efbcbc;color:#8f2f2f}.warnings{background:#fff8df;border:1px solid #ecd98d;color:#6d5912}.warnings button{margin-top:8px}.footnote{color:#6f7c8e;line-height:1.6;margin-bottom:0}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
      `}</style>
    </main>
  );
}
