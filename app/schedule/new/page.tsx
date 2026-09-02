/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { safeActionError } from "../../lib/client-security";

type EntryType = "delivery" | "pickup" | "customer_visit" | "onsite_repair";
type Reason = "点検" | "車検" | "一般整備" | "板金塗装";

type StaffMember = {
  id: string;
  display_name: string;
  short_name: string | null;
};

type ExternalVendor = {
  id: string;
  display_name: string;
  short_name: string | null;
};

type TimeOption = {
  key: string;
  label: string;
  group?: string;
  mode: "exact" | "morning" | "unspecified";
  startsAt: string;
  endsAt: string;
  durationMinutes?: number;
  availability?: "open" | "warning" | "blocked";
  warnings?: string[];
  hardErrors?: string[];
  conflicts?: number;
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

type DuplicateCustomerCandidate = {
  customerId: string;
  displayName: string;
  phone: string | null;
  score: number;
};

type DuplicateVehicleCandidate = {
  vehicleId: string;
  customerId: string | null;
  registrationNumber: string | null;
  registrationLast4: string | null;
  maker: string | null;
  model: string | null;
  score: number;
};
type RegisteredVehicleOption = {
  vehicleId: string;
  customerId: string | null;
  customerType: "individual" | "company";
  customerName: string;
  companyName: string;
  scheduleDisplayName: string;
  phone: string;
  registrationNumber: string;
  registrationLast4: string;
  chassisNumber: string;
  maker: string;
  model: string;
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
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [staffId, setStaffId] = useState("");
  const [vendors, setVendors] = useState<ExternalVendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [needsLoaner, setNeedsLoaner] = useState(false);
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
  const [duplicateCustomers, setDuplicateCustomers] = useState<DuplicateCustomerCandidate[]>([]);
  const [duplicateVehicles, setDuplicateVehicles] = useState<DuplicateVehicleCandidate[]>([]);
  const [existingCustomerId, setExistingCustomerId] = useState("");
  const [existingVehicleId, setExistingVehicleId] = useState("");
  const [duplicateDecisionFingerprint, setDuplicateDecisionFingerprint] = useState("");
  const [duplicateBypassFingerprint, setDuplicateBypassFingerprint] = useState("");
  const [registeredSearch, setRegisteredSearch] = useState("");
  const [registeredVehicles, setRegisteredVehicles] = useState<RegisteredVehicleOption[]>([]);
  const [registeredVehiclesLoading, setRegisteredVehiclesLoading] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDay(q);
  }, []);

  useEffect(() => {
    setDeliveryDay(day);
  }, [day]);

  useEffect(() => {
    void loadCapacity();
    void loadMainOptions();
  }, [day, entryType, reason]);

  useEffect(() => {
    if (entryType === "delivery") {
      setAddDelivery(false);
      return;
    }
    void loadDeliveryOptions();
  }, [deliveryDay, entryType, reason]);

  useEffect(() => {
    void loadStaff();
    void loadVendors();
    void loadRegisteredVehicles();
  }, []);

  async function loadStaff() {
    const { data, error } = await supabase
      .from("staff_members")
      .select("id,display_name,short_name")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true });
    if (error) {
      setMessage(safeActionError("社員一覧の読み込み", error));
      return;
    }
    setStaffMembers((data || []) as StaffMember[]);
  }

  async function loadVendors() {
    const { data, error } = await supabase
      .from("external_vendors")
      .select("id,display_name,short_name")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true });
    if (error) {
      setMessage(safeActionError("外注先一覧の読み込み", error));
      return;
    }
    setVendors((data || []) as ExternalVendor[]);
  }
  async function loadRegisteredVehicles() {
    setRegisteredVehiclesLoading(true);
    try {
      const [{ data: customerRows, error: customerError }, { data: vehicleRows, error: vehicleError }] = await Promise.all([
        supabase
          .from("customers")
          .select("id,customer_type,name,company_name,phone,schedule_display_name")
          .order("updated_at", { ascending: false })
          .limit(1000),
        supabase
          .from("vehicles")
          .select("id,customer_id,registration_number,registration_number_last4,chassis_number,maker,model,vehicle_number")
          .order("updated_at", { ascending: false })
          .limit(1000),
      ]);
      if (customerError) throw customerError;
      if (vehicleError) throw vehicleError;

      const customersById = new Map((customerRows || []).map((row: any) => [row.id, row]));
      const options = (vehicleRows || []).map((vehicle: any): RegisteredVehicleOption => {
        const customer: any = vehicle.customer_id ? customersById.get(vehicle.customer_id) : null;
        return {
          vehicleId: String(vehicle.id),
          customerId: vehicle.customer_id ? String(vehicle.customer_id) : null,
          customerType: customer?.customer_type === "company" ? "company" : "individual",
          customerName: String(customer?.name || customer?.company_name || ""),
          companyName: String(customer?.company_name || ""),
          scheduleDisplayName: String(customer?.schedule_display_name || ""),
          phone: String(customer?.phone || ""),
          registrationNumber: String(vehicle.registration_number || ""),
          registrationLast4: String(vehicle.registration_number_last4 || ""),
          chassisNumber: String(vehicle.chassis_number || vehicle.vehicle_number || ""),
          maker: String(vehicle.maker || ""),
          model: String(vehicle.model || ""),
        };
      });
      setRegisteredVehicles(options);
    } catch (error: any) {
      setMessage(safeActionError("登録済み車両の読み込み", error));
    } finally {
      setRegisteredVehiclesLoading(false);
    }
  }

  async function loadCapacity() {
    const { data, error } = await supabase.rpc("schedule_capacity", { p_day: day });
    if (error) {
      setMessage(safeActionError("空き状況の読み込み", error));
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
      const { data, error } = await supabase.rpc("schedule_time_availability", {
        p_day: day,
        p_entry_type: entryType,
        p_reason: reason,
      });
      if (error) throw error;
      const options = Array.isArray(data?.options) ? data.options as TimeOption[] : [];
      setTimeOptions(options);
      setSelectedTimeKey((old) => {
        const oldOption = options.find((x) => x.key === old);
        if (oldOption && oldOption.availability !== "blocked") return old;
        return options.find((x) => x.availability === "open")?.key
          || options.find((x) => x.availability === "warning")?.key
          || "";
      });
    } catch (error: any) {
      setMessage(safeActionError("時間候補の読み込み", error));
      setTimeOptions([]);
      setSelectedTimeKey("");
    } finally {
      setLoadingOptions(false);
    }
  }

  async function loadDeliveryOptions() {
    if (entryType === "delivery") return;
    const { data, error } = await supabase.rpc("schedule_time_availability", {
      p_day: deliveryDay,
      p_entry_type: "delivery",
      p_reason: reason,
    });
    if (error) {
      setMessage(safeActionError("納車時間候補の読み込み", error));
      return;
    }
    const options = Array.isArray(data?.options) ? data.options as TimeOption[] : [];
    setDeliveryOptions(options);
    setDeliveryTimeKey((old) => {
      const oldOption = options.find((x) => x.key === old);
      if (oldOption && oldOption.availability !== "blocked") return old;
      return options.find((x) => x.availability === "open")?.key
        || options.find((x) => x.availability === "warning")?.key
        || "";
    });
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

  function makeDuplicateFingerprint(values: {
    customerName: string;
    companyName: string;
    phone: string;
    registrationNumber: string;
    registrationLast4: string;
  }) {
    return [
      values.customerName.normalize("NFKC").replace(/[\\s　]+/g, "").toLowerCase(),
      values.companyName.normalize("NFKC").replace(/[\\s　]+/g, "").toLowerCase(),
      values.phone.normalize("NFKC").replace(/\\D/g, ""),
      values.registrationNumber.normalize("NFKC").replace(/[\\s　・･-]+/g, "").toUpperCase(),
      values.registrationLast4.normalize("NFKC").replace(/[^0-9A-Za-z]/g, "").toUpperCase(),
    ].join("|");
  }

  function duplicateFingerprint() {
    return makeDuplicateFingerprint({ customerName, companyName, phone, registrationNumber, registrationLast4 });
  }

  const filteredRegisteredVehicles = useMemo(() => {
    const q = registeredSearch.normalize("NFKC").trim().toLowerCase();
    const normalizedDigits = registeredSearch.normalize("NFKC").replace(/\\D/g, "");
    const list = !q
      ? registeredVehicles
      : registeredVehicles.filter((row) => {
          const haystack = [
            row.customerName, row.companyName, row.phone, row.registrationNumber,
            row.registrationLast4, row.chassisNumber, row.maker, row.model,
          ].join(" ").normalize("NFKC").toLowerCase();
          const phoneDigits = row.phone.replace(/\\D/g, "");
          return haystack.includes(q) || (normalizedDigits.length >= 2 && phoneDigits.includes(normalizedDigits));
        });
    return list.slice(0, 20);
  }, [registeredSearch, registeredVehicles]);

  function selectRegisteredVehicle(row: RegisteredVehicleOption) {
    const last4 = row.registrationLast4 || row.registrationNumber.match(/(\\d{4})(?!.*\\d)/)?.[1] || "";
    setExistingVehicleId(row.vehicleId);
    setExistingCustomerId(row.customerId || "");
    setCustomerType(row.customerType);
    setCustomerName(row.customerName || row.companyName);
    setCompanyName(row.companyName);
    setPhone(row.phone);
    setScheduleDisplayName(row.scheduleDisplayName);
    setRegistrationNumber(row.registrationNumber);
    setRegistrationLast4(last4);
    setMaker(row.maker);
    setModel(row.model);
    setDuplicateCustomers([]);
    setDuplicateVehicles([]);
    setDuplicateBypassFingerprint("");
    setDuplicateDecisionFingerprint(makeDuplicateFingerprint({
      customerName: row.customerName || row.companyName,
      companyName: row.companyName,
      phone: row.phone,
      registrationNumber: row.registrationNumber,
      registrationLast4: last4,
    }));
    setRegisteredSearch("");
    setMessage(row.customerId
      ? "登録済みのお客様・車両を予定へ反映しました。日時と内容を確認して登録してください。"
      : "登録済み車両を反映しました。お客様情報が未紐付けのため、必要な項目を入力してください。");
  }

  async function checkDuplicateRegistration() {
    const { data, error } = await supabase.rpc("find_schedule_registration_duplicates", {
      p_customer_name: customerName.trim() || null,
      p_company_name: companyName.trim() || null,
      p_phone: phone.trim() || null,
      p_registration_number: registrationNumber.trim() || null,
      p_registration_last4: registrationLast4.trim() || null,
      p_chassis_number: null,
    });
    if (error) throw error;

    const customerCandidates = (Array.isArray(data?.customerCandidates) ? data.customerCandidates : []) as DuplicateCustomerCandidate[];
    const vehicleCandidates = (Array.isArray(data?.vehicleCandidates) ? data.vehicleCandidates : []) as DuplicateVehicleCandidate[];
    const strongCustomerIds = new Set(customerCandidates.filter((x) => Number(x.score) >= 100).map((x) => x.customerId));
    const pairedCustomerIds = new Set(
      customerCandidates
        .filter((c) => Number(c.score) >= 70 && vehicleCandidates.some((v) => v.customerId === c.customerId && Number(v.score) >= 50))
        .map((c) => c.customerId)
    );
    const strongCustomers = customerCandidates.filter((x) => Number(x.score) >= 70 || strongCustomerIds.has(x.customerId) || pairedCustomerIds.has(x.customerId));
    const strongVehicles = vehicleCandidates.filter((x) => Number(x.score) >= 100 || (x.customerId ? pairedCustomerIds.has(x.customerId) : false));

    if (!strongCustomers.length && !strongVehicles.length) {
      setDuplicateCustomers([]);
      setDuplicateVehicles([]);
      return true;
    }

    setDuplicateCustomers(strongCustomers);
    setDuplicateVehicles(strongVehicles);
    setExistingCustomerId("");
    setExistingVehicleId("");
    setDuplicateDecisionFingerprint("");
    setMessage("既存のお客様・車両と一致する候補があります。重複登録を防ぐため、使用する既存データか「新規として登録」を選んでください。");
    return false;
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
      if (new Date(selectedDelivery.startsAt).getTime() < new Date(main.endsAt).getTime()) {
        throw new Error("納車予定は入庫・作業予定の終了後に設定してください。");
      }
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
      const fp = duplicateFingerprint();
      const decisionIsCurrent = duplicateDecisionFingerprint === fp;
      const selectedCustomerForSubmit = decisionIsCurrent ? existingCustomerId : "";
      const selectedVehicleForSubmit = decisionIsCurrent ? existingVehicleId : "";

      if (!selectedCustomerForSubmit && !selectedVehicleForSubmit && duplicateBypassFingerprint !== fp) {
        const clear = await checkDuplicateRegistration();
        if (!clear) return;
      }

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

      const fpNow = duplicateFingerprint();
      const decisionIsCurrentNow = duplicateDecisionFingerprint === fpNow;
      const selectedCustomerForSubmitNow = decisionIsCurrentNow ? existingCustomerId : "";
      const selectedVehicleForSubmitNow = decisionIsCurrentNow ? existingVehicleId : "";

      const { data, error } = await supabase.rpc("create_schedule_registration_v2", {
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
        p_registration_last4: (registrationLast4.trim() || registrationNumber.match(/(\\d{4})(?!.*\\d)/)?.[1] || "").slice(-4) || null,
        p_maker: maker.trim() || null,
        p_model: model.trim() || null,
        p_staff_id: staffId || null,
        p_notes: notes.trim() || null,
        p_inspection_schedule_type: inspectionScheduleType || null,
        p_print_time_mode: check.main.printMode,
        p_is_urgent: isUrgent,
        p_needs_loaner: needsLoaner,
        p_existing_customer_id: selectedCustomerForSubmitNow || null,
        p_existing_vehicle_id: selectedVehicleForSubmitNow || null,
        p_add_delivery: addDelivery && entryType !== "delivery",
        p_delivery_starts_at: addDelivery && entryType !== "delivery" ? selectedDelivery?.startsAt || null : null,
        p_delivery_ends_at: addDelivery && entryType !== "delivery" ? selectedDelivery?.endsAt || null : null,
        p_delivery_print_time_mode: addDelivery && entryType !== "delivery" ? selectedDelivery?.mode || null : null,
        p_allow_warning_override: allowOverride,
      });
      if (error) throw error;

      const rpcHardErrors = Array.isArray(data?.hardErrors) ? data.hardErrors.map(String) : [];
      const rpcWarnings = Array.isArray(data?.warnings) ? data.warnings.map(String) : [];
      if (rpcHardErrors.length || data?.allowed === false) {
        setHardErrors(rpcHardErrors.length ? rpcHardErrors : ["この内容では登録できません。"]);
        setMessage("登録直前の再確認で登録できない条件が見つかりました。");
        return;
      }
      if (data?.overrideRequired && !allowOverride) {
        setWarnings(rpcWarnings);
        setMessage("登録直前の再確認で警告が見つかりました。内容を確認してください。");
        return;
      }
      if (!data?.created) throw new Error("予定を登録できませんでした。");

      const workOrderId = data?.workOrderId;
      const vehicleId = data?.vehicleId;

      if (workOrderId) {
        const { error: flagError } = await supabase
          .from("work_orders")
          .update({
            is_urgent: isUrgent,
            needs_loaner: needsLoaner,
            updated_at: new Date().toISOString(),
          })
          .eq("id", workOrderId);
        if (flagError) throw flagError;

        const { error: assignmentError } = await supabase.rpc("set_work_order_assignment", {
          p_work_order_id: workOrderId,
          p_staff_id: staffId || null,
          p_vendor_id: reason === "板金塗装" ? (vendorId || null) : null,
          p_vendor_name: reason === "板金塗装" ? (vendorName.trim() || null) : null,
          p_actor: "schedule-registration",
        });
        if (assignmentError) throw assignmentError;
      }

      setMessage("予定を登録しました。1日のスケジュールへ戻ります。");
      window.setTimeout(() => location.assign(`/schedule?day=${day}`), 350);
    } catch (error: any) {
      setMessage(safeActionError("予定登録", error));
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
        <button onClick={() => location.assign(`/schedule?day=${day}`)}>← 予定一覧へ</button>
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

      {(duplicateCustomers.length > 0 || duplicateVehicles.length > 0) && (
        <section className="card">
          <h2>重複候補の確認</h2>
          <div className="notice">既存のお客様・車両を選ぶと、新しい仮顧客・仮車両を増やさず予定だけ登録します。</div>
          <div style={{display:"grid",gap:8,marginTop:12}}>
            {duplicateVehicles.map((v) => (
              <button type="button" key={v.vehicleId} onClick={() => {
                setExistingVehicleId(v.vehicleId);
                setExistingCustomerId(v.customerId || "");
                setDuplicateDecisionFingerprint(duplicateFingerprint());
                setDuplicateBypassFingerprint("");
                setMessage("既存車両を使用して予定を登録します。");
              }}>
                既存車両を使う：{v.registrationNumber || `下4桁 ${v.registrationLast4 || "----"}`} {[v.maker,v.model].filter(Boolean).join(" ")}
              </button>
            ))}
            {duplicateCustomers.map((c) => (
              <button type="button" key={c.customerId} onClick={() => {
                setExistingVehicleId("");
                setExistingCustomerId(c.customerId);
                setDuplicateDecisionFingerprint(duplicateFingerprint());
                setDuplicateBypassFingerprint("");
                setMessage("既存顧客に新しい車両を追加して予定を登録します。");
              }}>
                既存顧客を使う：{c.displayName}{c.phone ? ` / ${c.phone}` : ""}
              </button>
            ))}
            <button type="button" onClick={() => {
              setExistingVehicleId("");
              setExistingCustomerId("");
              setDuplicateDecisionFingerprint("");
              setDuplicateBypassFingerprint(duplicateFingerprint());
              setMessage("候補とは別のお客様・車両として新規登録します。");
            }}>
              候補とは別なので新規として登録
            </button>
          </div>
        </section>
      )}

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
            <div className="wide availabilityBlock">
              <div className="availabilityTitle">
                <b>時間・空き状況</b>
                <span className="legend"><i className="dot openDot" />○ 空き　<i className="dot warnDot" />△ 要確認　<i className="dot blockedDot" />× 不可</span>
              </div>
              {loadingOptions ? (
                <div className="availabilityLoading">空き時間を確認中…</div>
              ) : !timeOptions.length ? (
                <div className="availabilityLoading">時間候補がありません。</div>
              ) : (
                <div className="timeGrid">
                  {timeOptions.map((x) => {
                    const state = x.availability || "open";
                    const mark = state === "open" ? "○" : state === "warning" ? "△" : "×";
                    const detail = [...(x.hardErrors || []), ...(x.warnings || [])].join(" / ");
                    return (
                      <button
                        type="button"
                        key={x.key}
                        className={`timeSlot ${state} ${selectedTimeKey === x.key ? "selected" : ""}`}
                        disabled={state === "blocked"}
                        onClick={() => setSelectedTimeKey(x.key)}
                        title={detail || (state === "open" ? "空いています" : "確認が必要です")}
                      >
                        <span>{mark}</span><b>{x.label}</b>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
        <div style={{margin:"12px 0 16px",padding:"14px",border:"1px solid #c9d8ee",borderRadius:14,background:"#f8fbff"}}>
          <b style={{display:"block",marginBottom:6}}>登録済みの車検証・車両情報から選ぶ</b>
          <div style={{color:"#607086",fontSize:13,lineHeight:1.6,marginBottom:10}}>
            お客様名・会社名・電話番号・登録番号・下4桁・車台番号・メーカー・型式で検索できます。
          </div>
          <input
            value={registeredSearch}
            onChange={(e) => setRegisteredSearch(e.target.value)}
            placeholder="例：1234 / 山田 / 090 / 車台番号"
            style={{width:"100%",marginBottom:10}}
          />
          {registeredVehiclesLoading ? (
            <div className="notice">登録済み車両を読み込み中…</div>
          ) : !filteredRegisteredVehicles.length ? (
            <div className="notice">一致する登録済み車両がありません。</div>
          ) : (
            <div style={{display:"grid",gap:8,maxHeight:320,overflow:"auto"}}>
              {filteredRegisteredVehicles.map((row) => (
                <button
                  type="button"
                  key={row.vehicleId}
                  onClick={() => selectRegisteredVehicle(row)}
                  style={{
                    textAlign:"left",
                    border: existingVehicleId === row.vehicleId ? "2px solid #2f6fe4" : "1px solid #ccd7e5",
                    background: existingVehicleId === row.vehicleId ? "#eef4ff" : "#fff",
                    color:"#172033",
                    display:"grid",
                    gap:3,
                  }}
                >
                  <b>{row.customerName || row.companyName || "お客様未紐付け"}</b>
                  <span>{row.registrationNumber || ("下4桁 " + (row.registrationLast4 || "----"))}　{[row.maker,row.model].filter(Boolean).join(" ")}</span>
                  <small style={{color:"#69778a"}}>{[row.phone, row.chassisNumber].filter(Boolean).join(" / ")}</small>
                </button>
              ))}
            </div>
          )}
        </div>
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
          <label>作業担当
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">未選択</option>
              {staffMembers.map((staff) => (
                <option key={staff.id} value={staff.id}>{staff.short_name || staff.display_name}</option>
              ))}
            </select>
          </label>
          {reason === "板金塗装" && (
            <>
              <label>外注先
                <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); if (e.target.value) setVendorName(""); }}>
                  <option value="">未選択 / 直接入力</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{vendor.short_name || vendor.display_name}</option>
                  ))}
                </select>
              </label>
              {!vendorId && (
                <label>外注先名（直接入力）
                  <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="例：○○鈑金" />
                </label>
              )}
            </>
          )}
          <div className="flagBox">
            <label className="switch"><input type="checkbox" checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)} />急ぎ</label>
            <label className="switch"><input type="checkbox" checked={needsLoaner} onChange={(e) => setNeedsLoaner(e.target.checked)} />代車あり</label>
            <button type="button" onClick={() => location.assign("/settings/staff")}>社員名を管理</button>
            {reason === "板金塗装" && <button type="button" onClick={() => location.assign("/settings/vendors")}>外注先を管理</button>}
          </div>
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
                  {deliveryOptions.map((x) => {
                    const mark = x.availability === "blocked" ? "×" : x.availability === "warning" ? "△" : "○";
                    return <option key={x.key} value={x.key} disabled={x.availability === "blocked"}>{mark} {x.label}</option>;
                  })}
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
        .availabilityBlock{display:grid;gap:10px}.availabilityTitle{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;color:#5c6878}.legend{font-size:12px;font-weight:800}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px}.openDot{background:#4f9c68}.warnDot{background:#d69a36}.blockedDot{background:#9aa5b3}.availabilityLoading{background:#f7f9fc;border-radius:12px;padding:14px;color:#78869a}.timeGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.timeSlot{display:flex;gap:5px;justify-content:center;align-items:center;padding:10px 7px;border-radius:12px}.timeSlot.open{background:#f2fbf5;border-color:#9bceb0;color:#236c3b}.timeSlot.warning{background:#fff8ea;border-color:#e5bd73;color:#8a5a08}.timeSlot.blocked{background:#f1f3f6;border-color:#d5dbe3;color:#8a95a3;opacity:.7}.timeSlot.selected{outline:3px solid #2674e8;outline-offset:1px}.timeSlot:disabled{cursor:not-allowed}
        input,select,textarea{width:100%;border:1px solid #cbd6e3;border-radius:11px;background:#fff;padding:12px;color:#172033}textarea{min-height:90px;resize:vertical}
        .switch{display:flex;align-items:center;gap:9px;font-weight:800}.switch input{width:auto}.flagBox{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #e0e6ef;border-radius:12px;padding:11px}.flagBox .switch{color:#27364a}.flagBox button{padding:8px 10px}.deliveryGrid{margin-top:12px}
        .primary{width:100%;background:#2f6fe4;border-color:#2f6fe4;color:#fff;font-size:18px;padding:16px}
        .errors,.warnings{margin-top:12px;border-radius:12px;padding:13px 14px;line-height:1.7}.errors{background:#fff0f0;border:1px solid #efbcbc;color:#8f2f2f}.warnings{background:#fff8df;border:1px solid #ecd98d;color:#6d5912}.warnings button{margin-top:8px;background:#fff}
        .footnote{color:#6f7c8e;line-height:1.6;margin-bottom:0}
        @media(max-width:650px){
          .grid{grid-template-columns:1fr}.grid .wide{grid-column:auto}.capacity{grid-template-columns:1fr 1fr}.capacity>div:last-child{grid-column:1/-1}
          .availabilityTitle{align-items:flex-start}.legend{line-height:1.8}
          .timeGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
          .timeSlot{min-height:54px;padding:10px 6px;white-space:nowrap;gap:4px}
          .timeSlot span{font-size:13px}.timeSlot b{font-size:17px}
        }
      `}</style>
    </main>
  );
}
