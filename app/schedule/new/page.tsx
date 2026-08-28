/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type EntryType = "delivery" | "pickup" | "customer_visit" | "onsite_repair";
type Reason = "点検" | "車検" | "一般整備" | "板金塗装";

type TimeOption = {
  key: string;
  label: string;
  group?: string;
  mode: "exact" | "morning" | "unspecified";
  startsAt: string;
  endsAt: string;
  durationMinutes?: number;
};

type Capacity = {
  morning_count: number;
  afternoon_count: number;
  morning_inspection_count: number;
  morning_total_limit: number;
  afternoon_total_limit: number;
  morning_inspection_warning: number;
  morning_total_over: boolean;
  afternoon_total_over: boolean;
  morning_inspection_warning_reached: boolean;
};

const ENTRY_LABEL: Record<EntryType, string> = {
  delivery: "納車",
  pickup: "引き取り",
  customer_visit: "来社",
  onsite_repair: "出張整備",
};

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

function extractWarnings(check: any) {
  return {
    allowed: Boolean(check?.allowed),
    overrideRequired: Boolean(check?.override_required),
    hardErrors: Array.isArray(check?.hard_errors) ? check.hard_errors.map(String) : [],
    warnings: Array.isArray(check?.warnings) ? check.warnings.map(String) : [],
  };
}

export default function ScheduleNewPage() {
  const [day, setDay] = useState(todayJst());
  const [entryType, setEntryType] = useState<EntryType>("customer_visit");
  const [reason, setReason] = useState<Reason>("車検");
  const [customerName, setCustomerName] = useState("");
  const [customerType, setCustomerType] = useState<"individual" | "company">("individual");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [scheduleDisplayName, setScheduleDisplayName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registrationLast4, setRegistrationLast4] = useState("");
  const [maker, setMaker] = useState("");
  const [model, setModel] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [notes, setNotes] = useState("");
  const [inspectionScheduleType, setInspectionScheduleType] = useState("");
  const [timeOptions, setTimeOptions] = useState<TimeOption[]>([]);
  const [selectedTimeKey, setSelectedTimeKey] = useState("");
  const [onsiteTime, setOnsiteTime] = useState("09:00");
  const [onsiteDuration, setOnsiteDuration] = useState("60");

  const [addDelivery, setAddDelivery] = useState(true);
  const [deliveryDay, setDeliveryDay] = useState(todayJst());
  const [deliveryOptions, setDeliveryOptions] = useState<TimeOption[]>([]);
  const [deliveryTimeKey, setDeliveryTimeKey] = useState("");

  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [message, setMessage] = useState("入出庫予定を登録します。");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hardErrors, setHardErrors] = useState<string[]>([]);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q) && q !== day) {
      setDay(q);
      setDeliveryDay(q);
      return;
    }
    setDeliveryDay(day);
  }, [day]);

  useEffect(() => {
    void loadCapacity();
    void loadMainOptions();
  }, [day, entryType]);

  useEffect(() => {
    if (entryType === "delivery") {
      setAddDelivery(false);
      return;
    }
    void loadDeliveryOptions();
  }, [deliveryDay, entryType]);

  async function loadCapacity() {
    const { data, error } = await supabase.rpc("schedule_capacity", { p_day: day });
    if (error) {
      setMessage(`空き状況の読み込みエラー: ${error.message}`);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setCapacity((row || null) as Capacity | null);
  }

  async function loadMainOptions() {
    setLoadingOptions(true);
    try {
      if (entryType === "onsite_repair") {
        setTimeOptions([]);
        setSelectedTimeKey("");
        return;
      }
      const { data, error } = await supabase.rpc("schedule_time_options", {
        p_day: day,
        p_entry_type: entryType,
      });
      if (error) throw error;
      const options = Array.isArray(data?.options) ? data.options as TimeOption[] : [];
      setTimeOptions(options);
      setSelectedTimeKey((old) => options.some((x) => x.key === old) ? old : options[0]?.key || "");
    } catch (error: any) {
      setMessage(`時間候補の読み込みエラー: ${error?.message || error}`);
      setTimeOptions([]);
      setSelectedTimeKey("");
    } finally {
      setLoadingOptions(false);
    }
  }

  async function loadDeliveryOptions() {
    if (entryType === "delivery") return;
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
    setDeliveryTimeKey((old) => options.some((x) => x.key === old) ? old : options[0]?.key || "");
  }

  const selectedTime = useMemo(
    () => timeOptions.find((x) => x.key === selectedTimeKey) || null,
    [timeOptions, selectedTimeKey]
  );

  const selectedDelivery = useMemo(
    () => deliveryOptions.find((x) => x.key === deliveryTimeKey) || null,
    [deliveryOptions, deliveryTimeKey]
  );

  function mainTimes() {
    if (entryType !== "onsite_repair") {
      if (!selectedTime) return null;
      return {
        startsAt: selectedTime.startsAt,
        endsAt: selectedTime.endsAt,
        printMode: selectedTime.mode,
      };
    }
    const startsAt = jstIso(day, onsiteTime);
    return {
      startsAt,
      endsAt: plusMinutes(startsAt, Math.max(30, Number(onsiteDuration) || 60)),
      printMode: "exact" as const,
    };
  }

  async function preflight() {
    const main = mainTimes();
    if (!main) throw new Error("時間を選択してください。");

    const { data, error } = await supabase.rpc("schedule_slot_check", {
      p_entry_type: entryType,
      p_starts_at: main.startsAt,
      p_ends_at: main.endsAt,
      p_reason: reason,
      p_exclude_entry_id: null,
    });
    if (error) throw error;
    const mainCheck = extractWarnings(data);

    let deliveryCheck = { allowed: true, overrideRequired: false, hardErrors: [] as string[], warnings: [] as string[] };
    if (addDelivery && entryType !== "delivery") {
      if (!selectedDelivery) throw new Error("納車時間を選択してください。");
      const { data: deliveryData, error: deliveryError } = await supabase.rpc("schedule_slot_check", {
        p_entry_type: "delivery",
        p_starts_at: selectedDelivery.startsAt,
        p_ends_at: selectedDelivery.endsAt,
        p_reason: reason,
        p_exclude_entry_id: null,
      });
      if (deliveryError) throw deliveryError;
      deliveryCheck = extractWarnings(deliveryData);
    }

    return {
      main,
      hardErrors: [...mainCheck.hardErrors, ...deliveryCheck.hardErrors],
      warnings: [...mainCheck.warnings, ...deliveryCheck.warnings],
      overrideRequired: mainCheck.overrideRequired || deliveryCheck.overrideRequired,
      allowed: mainCheck.allowed && deliveryCheck.allowed,
    };
  }

  async function submit(allowOverride = false) {
    setWarnings([]);
    setHardErrors([]);
    if (!customerName.trim()) {
      setHardErrors(["お客様名を入力してください。"]);
      return;
    }
    if (!registrationNumber.trim() && !registrationLast4.trim()) {
      setHardErrors(["登録番号またはナンバー下4桁を入力してください。"]);
      return;
    }

    setBusy(true);
    try {
      const check = await preflight();
      if (!check.allowed || check.hardErrors.length) {
        setHardErrors(check.hardErrors.length ? check.hardErrors : ["この時間は登録できません。"]);
        setMessage("登録できない条件があります。内容を確認してください。");
        return;
      }

      if (check.overrideRequired && !allowOverride) {
        setWarnings(check.warnings);
        setMessage("警告があります。内容を確認してから登録してください。");
        return;
      }

      const { data, error } = await supabase.rpc("create_manual_schedule_registration", {
        p_customer_name: customerName.trim(),
        p_entry_type: entryType,
        p_reason: reason,
        p_starts_at: check.main.startsAt,
        p_ends_at: check.main.endsAt,
        p_customer_type: customerType,
        p_company_name: companyName.trim() || null,
        p_phone: phone.trim() || null,
        p_schedule_display_name: scheduleDisplayName.trim() || null,
        p_registration_number: registrationNumber.trim() || null,
        p_registration_last4: (registrationLast4.trim() || registrationNumber.match(/(\d{4})(?!.*\d)/)?.[1] || "").slice(-4) || null,
        p_maker: maker.trim() || null,
        p_model: model.trim() || null,
        p_worker_name: workerName.trim() || null,
        p_notes: notes.trim() || null,
        p_inspection_schedule_type: inspectionScheduleType || null,
        p_print_time_mode: check.main.printMode,
        p_allow_warning_override: allowOverride,
      });
      if (error) throw error;

      const workOrderId = data?.workOrderId;
      const vehicleId = data?.vehicleId;

      if (addDelivery && entryType !== "delivery" && selectedDelivery && workOrderId && vehicleId) {
        const { error: workError } = await supabase
          .from("work_orders")
          .update({
            planned_delivery_at: selectedDelivery.startsAt,
            last_schedule_change_at: new Date().toISOString(),
          })
          .eq("id", workOrderId);
        if (workError) throw workError;

        const { error: scheduleError } = await supabase.from("schedule_entries").insert({
          vehicle_id: vehicleId,
          work_order_id: workOrderId,
          entry_type: "delivery",
          starts_at: selectedDelivery.startsAt,
          ends_at: selectedDelivery.endsAt,
          print_time_mode: selectedDelivery.mode,
          notes: notes.trim() || null,
        });
        if (scheduleError) throw scheduleError;
      }

      setMessage("予定を登録しました。1日のスケジュールへ戻ります。");
      window.setTimeout(() => location.assign(`/schedule?day=${day}`), 350);
    } catch (error: any) {
      setMessage(`予定登録エラー: ${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  const capMorning = capacity ? `${capacity.morning_count}/${capacity.morning_total_limit}` : "-";
  const capAfternoon = capacity ? `${capacity.afternoon_count}/${capacity.afternoon_total_limit}` : "-";
  const capInspection = capacity ? `${capacity.morning_inspection_count}/${capacity.morning_inspection_warning}` : "-";

  return (
    <main className="page">
      <header className="top">
        <button onClick={() => location.assign("/schedule")}>← 予定一覧へ</button>
        <strong>icb</strong>
      </header>

      <section className="card">
        <div className="eyebrow">入出庫予定登録</div>
        <h1>予定を追加</h1>
        <div className="notice">{message}</div>

        <div className="capacity">
          <div><small>午前 入庫系</small><b>{capMorning}</b></div>
          <div><small>午後 入庫系</small><b>{capAfternoon}</b></div>
          <div><small>午前 車検</small><b>{capInspection}</b></div>
        </div>

        {!!hardErrors.length && (
          <div className="errors">
            <b>登録できない項目</b>
            {hardErrors.map((x, i) => <div key={i}>・{x}</div>)}
          </div>
        )}
        {!!warnings.length && (
          <div className="warnings">
            <b>確認が必要です</b>
            {warnings.map((x, i) => <div key={i}>・{x}</div>)}
            <button disabled={busy} onClick={() => void submit(true)}>警告を確認して登録</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>① 日時と区分</h2>
        <div className="grid">
          <label>日付<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label>区分
            <select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)}>
              <option value="pickup">引き取り</option>
              <option value="customer_visit">来社</option>
              <option value="onsite_repair">出張整備</option>
              <option value="delivery">納車</option>
            </select>
          </label>
          <label>入庫要因
            <select value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
              <option>点検</option><option>車検</option><option>一般整備</option><option>板金塗装</option>
            </select>
          </label>

          {entryType !== "onsite_repair" ? (
            <label className="wide">時間
              <select disabled={loadingOptions} value={selectedTimeKey} onChange={(e) => setSelectedTimeKey(e.target.value)}>
                {!timeOptions.length && <option value="">候補なし</option>}
                {timeOptions.map((x) => <option value={x.key} key={x.key}>{x.label}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label>出張開始<input type="time" min="08:30" max="17:00" step="1800" value={onsiteTime} onChange={(e) => setOnsiteTime(e.target.value)} /></label>
              <label>作業枠
                <select value={onsiteDuration} onChange={(e) => setOnsiteDuration(e.target.value)}>
                  <option value="30">30分</option><option value="60">60分</option><option value="90">90分</option><option value="120">120分</option>
                </select>
              </label>
            </>
          )}

          {(reason === "点検" || reason === "車検") && (
            <label>点検区分
              <select value={inspectionScheduleType} onChange={(e) => setInspectionScheduleType(e.target.value)}>
                <option value="">未指定</option>
                <option value="schedule">通常予定</option>
                <option value="legal_6m">法定6ヶ月</option>
                <option value="legal_12m">法定12ヶ月</option>
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="card">
        <h2>② お客様・車両</h2>
        <div className="grid">
          <label>顧客区分
            <select value={customerType} onChange={(e) => setCustomerType(e.target.value as "individual" | "company")}>
              <option value="individual">個人</option><option value="company">法人</option>
            </select>
          </label>
          <label>お客様名<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label>
          <label>会社名<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></label>
          <label>予定表表示名<input value={scheduleDisplayName} onChange={(e) => setScheduleDisplayName(e.target.value)} placeholder="短い表示名・任意" /></label>
          <label>電話番号<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>登録番号<input value={registrationNumber} onChange={(e) => {
            const value = e.target.value;
            setRegistrationNumber(value);
            const last = value.match(/(\d{4})(?!.*\d)/)?.[1];
            if (last) setRegistrationLast4(last);
          }} /></label>
          <label>ナンバー下4桁<input inputMode="numeric" maxLength={4} value={registrationLast4} onChange={(e) => setRegistrationLast4(e.target.value.replace(/\D/g, "").slice(-4))} /></label>
          <label>メーカー<input value={maker} onChange={(e) => setMaker(e.target.value)} /></label>
          <label>型式<input value={model} onChange={(e) => setModel(e.target.value)} /></label>
          <label>作業担当<input value={workerName} onChange={(e) => setWorkerName(e.target.value)} /></label>
          <label className="wide">備考<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
      </section>

      {entryType !== "delivery" && (
        <section className="card">
          <h2>③ 納車予定</h2>
          <label className="switch">
            <input type="checkbox" checked={addDelivery} onChange={(e) => setAddDelivery(e.target.checked)} />
            入庫予定と同時に納車予定も登録する
          </label>
          {addDelivery && (
            <div className="grid deliveryGrid">
              <label>納車日<input type="date" value={deliveryDay} onChange={(e) => setDeliveryDay(e.target.value)} /></label>
              <label>納車時間
                <select value={deliveryTimeKey} onChange={(e) => setDeliveryTimeKey(e.target.value)}>
                  {!deliveryOptions.length && <option value="">候補なし</option>}
                  {deliveryOptions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </label>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <button className="primary" disabled={busy} onClick={() => void submit(false)}>
          {busy ? "登録中…" : "この内容で予定を登録"}
        </button>
        <p className="footnote">
          営業時間・昼休み・重複・午前/午後上限・午前車検台数は登録前に自動チェックします。
        </p>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .page{max-width:920px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
        button,input,select,textarea{font:inherit}.top button,button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:12px;padding:11px 14px;font-weight:800}
        .card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}.eyebrow{font-weight:800;color:#2674e8}h1{font-size:34px;margin:4px 0 10px}h2{margin:0 0 14px}
        .notice{background:#edf7ef;border:1px solid #c2e5cb;border-radius:12px;padding:12px 14px;color:#3c5944}
        .capacity{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.capacity>div{background:#f6f8fb;border-radius:12px;padding:12px;display:grid}.capacity b{font-size:24px}.capacity small{color:#78869a}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.grid label{display:grid;gap:6px;font-weight:700;color:#5c6878}.grid .wide{grid-column:1/-1}
        input,select,textarea{width:100%;border:1px solid #cbd6e3;border-radius:11px;background:#fff;padding:12px;color:#172033}textarea{min-height:90px;resize:vertical}
        .switch{display:flex;align-items:center;gap:9px;font-weight:800}.switch input{width:auto}.deliveryGrid{margin-top:12px}
        .primary{width:100%;background:#2f6fe4;border-color:#2f6fe4;color:#fff;font-size:18px;padding:16px}
        .errors,.warnings{margin-top:12px;border-radius:12px;padding:13px 14px;line-height:1.7}.errors{background:#fff0f0;border:1px solid #efbcbc;color:#8f2f2f}.warnings{background:#fff8df;border:1px solid #ecd98d;color:#6d5912}.warnings button{margin-top:8px;background:#fff}
        .footnote{color:#6f7c8e;line-height:1.6;margin-bottom:0}
        @media(max-width:650px){.grid{grid-template-columns:1fr}.grid .wide{grid-column:auto}.capacity{grid-template-columns:1fr 1fr}.capacity>div:last-child{grid-column:1/-1}}
      `}</style>
    </main>
  );
}
