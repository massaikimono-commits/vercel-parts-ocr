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
  displayLabel?: string;
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

type PickupCapacity = {
  morning_pickup_count: number;
  morning_pickup_limit: number;
  morning_pickup_over: boolean;
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
  pickup: "引取",
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

function addDay(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function nextBusinessDay(day: string) {
  const { data, error } = await supabase
    .from("business_calendar")
    .select("business_date")
    .gt("business_date", day)
    .eq("is_business_day", true)
    .order("business_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.business_date ? String(data.business_date) : "";
}

function naturalLast4(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
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
  const [entryType, setEntryType] = useState<EntryType>("pickup");
  const [reason, setReason] = useState<Reason>("点検");
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
  const [inspectionScheduleType, setInspectionScheduleType] = useState("schedule");
  const [timeOptions, setTimeOptions] = useState<TimeOption[]>([]);
  const [selectedTimeKey, setSelectedTimeKey] = useState("");
  const [onsiteMode, setOnsiteMode] = useState<"exact" | "morning" | "unspecified">("exact");
  const [onsiteTime, setOnsiteTime] = useState("09:00");
  const [onsiteDuration, setOnsiteDuration] = useState("60");

  const [addDelivery, setAddDelivery] = useState(true);
  const [deliveryDay, setDeliveryDay] = useState(todayJst());
  const [deliveryOptions, setDeliveryOptions] = useState<TimeOption[]>([]);
  const [deliveryTimeKey, setDeliveryTimeKey] = useState("");

  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [pickupCapacity, setPickupCapacity] = useState<PickupCapacity | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [message, setMessage] = useState("お客様・車両を選んでから、入庫内容と日時を登録します。");
  const [successMessage, setSuccessMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hardErrors, setHardErrors] = useState<string[]>([]);
  const [existingCustomerId, setExistingCustomerId] = useState("");
  const [existingVehicleId, setExistingVehicleId] = useState("");
  const [registeredSearch, setRegisteredSearch] = useState("");
  const [registeredVehicles, setRegisteredVehicles] = useState<RegisteredVehicleOption[]>([]);
  const [registeredVehiclesLoading, setRegisteredVehiclesLoading] = useState(false);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("day");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDay(q);
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    scrollToTopAfterSuccessfulRegistration();
  }, [successMessage]);

  useEffect(() => {
    let active = true;
    async function applyDefaultDeliveryDay() {
      if (reason !== "車検") {
        if (reason === "点検") setDeliveryTimeKey("");
        setDeliveryDay(day);
        return;
      }
      try {
        const next = await nextBusinessDay(day);
        if (!active) return;
        setDeliveryTimeKey("");
        if (next) {
          setDeliveryDay(next);
        } else {
          setDeliveryDay("");
          setMessage("年間予定表に翌営業日がありません。納車日を選択してください。");
        }
      } catch (error: any) {
        if (!active) return;
        setDeliveryDay("");
        setMessage(safeActionError("翌営業日の読み込み", error));
      }
    }
    void applyDefaultDeliveryDay();
    return () => { active = false; };
  }, [day, reason]);

  useEffect(() => {
    if (reason !== "点検" && inspectionScheduleType) setInspectionScheduleType("");
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
    const [capacityResult, pickupResult] = await Promise.all([
      supabase.rpc("schedule_capacity", { p_day: day }),
      supabase.rpc("schedule_pickup_capacity", { p_day: day }),
    ]);
    if (capacityResult.error) {
      setMessage(safeActionError("空き状況の読み込み", capacityResult.error));
      return;
    }
    if (pickupResult.error) {
      setMessage(safeActionError("引取上限の読み込み", pickupResult.error));
      return;
    }
    const row = Array.isArray(capacityResult.data) ? capacityResult.data[0] : capacityResult.data;
    setCapacity((row || null) as Capacity | null);
    setPickupCapacity((pickupResult.data || null) as PickupCapacity | null);
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
      const preferredBroad = (reason === "点検" || reason === "車検")
        ? options.find((x) => x.mode === "unspecified" && x.availability !== "blocked")
        : null;
      return preferredBroad?.key
        || options.find((x) => x.availability === "open")?.key
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
    if (onsiteMode === "morning") {
      return {
        startsAt: jstIso(day, "08:30"),
        endsAt: jstIso(day, "12:00"),
        printMode: "morning" as const,
      };
    }
    if (onsiteMode === "unspecified") {
      return {
        startsAt: jstIso(day, "13:00"),
        endsAt: jstIso(day, "17:00"),
        printMode: "unspecified" as const,
      };
    }
    const startsAt = jstIso(day, onsiteTime);
    return {
      startsAt,
      endsAt: plusMinutes(startsAt, Math.max(30, Number(onsiteDuration) || 60)),
      printMode: "exact" as const,
    };
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

  function applyRegisteredVehicle(row: RegisteredVehicleOption, nextIds: string[]) {
    const last4 = row.registrationLast4 || row.registrationNumber.match(/(\\d{4})(?!.*\\d)/)?.[1] || "";
    setSelectedVehicleIds(nextIds);
    setExistingVehicleId(nextIds.length === 1 ? nextIds[0] : "");
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
  }

  function toggleRegisteredVehicle(row: RegisteredVehicleOption) {
    if (!row.customerId) {
      applyRegisteredVehicle(row, [row.vehicleId]);
      setMessage("この車両はお客様未紐付けのため、単独登録として必要な顧客情報を入力してください。");
      return;
    }

    if (selectedVehicleIds.includes(row.vehicleId)) {
      const nextIds = selectedVehicleIds.filter((id) => id !== row.vehicleId);
      const nextPrimary = registeredVehicles.find((vehicle) => vehicle.vehicleId === nextIds[0]);
      if (nextPrimary) {
        applyRegisteredVehicle(nextPrimary, nextIds);
        setMessage(nextIds.length > 1
          ? `${nextIds.length}台選択しています。別のお客様・別車両でも共通条件でまとめて登録できます。`
          : "登録済みのお客様・車両を予定へ反映しました。");
      } else {
        setSelectedVehicleIds([]);
        setExistingVehicleId("");
        setExistingCustomerId("");
        setMessage("車両の選択を解除しました。");
      }
      return;
    }

    const nextIds = [...selectedVehicleIds, row.vehicleId];
    applyRegisteredVehicle(row, nextIds);
    setMessage(nextIds.length > 1
      ? `${nextIds.length}台選択しました。別のお客様・別車両でも、共通の日付・区分/時間・入庫要因・納車予定でまとめて登録できます。`
      : "登録済みのお客様・車両を予定へ反映しました。別のお客様・別車両も続けて選択できます。");
  }

  async function sameDayVehicleScheduleWarnings(vehicleIds: string[]) {
    const ids = [...new Set(vehicleIds.filter(Boolean))];
    if (!ids.length) return [] as string[];

    const dayStart = jstIso(day, "00:00");
    const nextDayStart = jstIso(addDay(day, 1), "00:00");
    const { data, error } = await supabase
      .from("schedule_entries")
      .select("id,vehicle_id,entry_type,starts_at")
      .in("vehicle_id", ids)
      .gte("starts_at", dayStart)
      .lt("starts_at", nextDayStart);
    if (error) throw error;

    const scheduledVehicleIds = new Set(
      (data || []).map((row: any) => String(row.vehicle_id || "")).filter(Boolean)
    );

    return ids
      .filter((id) => scheduledVehicleIds.has(id))
      .map((id) => {
        const row = registeredVehicles.find((vehicle) => vehicle.vehicleId === id);
        const plateDigits = row?.registrationLast4
          || row?.registrationNumber.match(/(\d{1,4})(?!.*\d)/)?.[1]
          || "";
        const label = naturalLast4(plateDigits) || row?.registrationNumber || "車両";
        return `同日予定：車番 ${label} は ${day} にすでに予定があります。時間や入庫内容が違っていても同日のため確認してください。`;
      });
  }


  async function preflight() {
    const main = mainTimes();
    if (!main) throw new Error("時間を選択してください。");

    const { data, error } = await supabase.rpc("schedule_slot_check_v2", {
      p_entry_type: entryType,
      p_starts_at: main.startsAt,
      p_ends_at: main.endsAt,
      p_reason: reason,
      p_exclude_entry_id: null,
      p_print_time_mode: main.printMode,
    });
    if (error) throw error;
    const mainCheck = extractWarnings(data);

    let deliveryCheck = { allowed: true, overrideRequired: false, hardErrors: [] as string[], warnings: [] as string[] };
    if (addDelivery && entryType !== "delivery") {
      if (!selectedDelivery) throw new Error("納車時間を選択してください。");
      if (new Date(selectedDelivery.startsAt).getTime() < new Date(main.endsAt).getTime()) {
        throw new Error("納車予定は入庫・作業予定の終了後に設定してください。");
      }
      const { data: deliveryData, error: deliveryError } = await supabase.rpc("schedule_slot_check_v2", {
        p_entry_type: "delivery",
        p_starts_at: selectedDelivery.startsAt,
        p_ends_at: selectedDelivery.endsAt,
        p_reason: reason,
        p_exclude_entry_id: null,
        p_print_time_mode: selectedDelivery.mode,
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

  function scrollToTopAfterSuccessfulRegistration() {
    // iPhone Safariではフォームの再描画・入力フォーカス解除後にスクロール位置が戻ることがあるため、
    // 成功時だけ複数タイミングで先頭位置を確定する。
    const jumpToTop = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(jumpToTop);
    });
    window.setTimeout(jumpToTop, 80);
    window.setTimeout(jumpToTop, 240);
  }

  function resetAfterSuccessfulRegistration() {
    setEntryType("pickup");
    setReason("点検");
    setCustomerName("");
    setCustomerType("individual");
    setCompanyName("");
    setPhone("");
    setScheduleDisplayName("");
    setRegistrationNumber("");
    setRegistrationLast4("");
    setMaker("");
    setModel("");
    setStaffId("");
    setVendorId("");
    setVendorName("");
    setIsUrgent(false);
    setNeedsLoaner(false);
    setNotes("");
    setInspectionScheduleType("schedule");
    setSelectedTimeKey("");
    setOnsiteMode("exact");
    setOnsiteTime("09:00");
    setOnsiteDuration("60");
    setAddDelivery(true);
    setDeliveryDay(day);
    setDeliveryTimeKey("");
    setRegisteredSearch("");
    setSelectedVehicleIds([]);
    setExistingVehicleId("");
    setExistingCustomerId("");
    setWarnings([]);
    setHardErrors([]);
  }

  async function submit(allowOverride = false) {
    setSuccessMessage("");
    setWarnings([]);
    setHardErrors([]);
    if (selectedVehicleIds.length <= 1 && !customerName.trim()) {
      setHardErrors(["お客様名を入力してください。"]);
      return;
    }
    if (selectedVehicleIds.length <= 1 && !registrationNumber.trim() && !registrationLast4.trim()) {
      setHardErrors(["登録番号またはナンバー下4桁を入力してください。"]);
      return;
    }

    setBusy(true);
    try {
      if (selectedVehicleIds.length > 1) {
        const selectedRows = selectedVehicleIds
          .map((id) => registeredVehicles.find((vehicle) => vehicle.vehicleId === id))
          .filter(Boolean) as RegisteredVehicleOption[];
        if (selectedRows.length !== selectedVehicleIds.length) {
          setHardErrors(["選択した車両情報を再取得できませんでした。選択し直してください。"]);
          return;
        }

        const check = await preflight();
        if (!check.allowed || check.hardErrors.length) {
          setHardErrors(check.hardErrors.length ? check.hardErrors : ["この時間は登録できません。"]);
          setMessage("登録できない条件があります。内容を確認してください。");
          return;
        }

        const sameDayWarnings = await sameDayVehicleScheduleWarnings(selectedVehicleIds);
        if ((check.overrideRequired || sameDayWarnings.length > 0) && !allowOverride) {
          setWarnings([...check.warnings, ...sameDayWarnings]);
          setMessage(sameDayWarnings.length
            ? "同じ車両に同日の予定があります。確認後は「それでも登録する」で登録できます。"
            : "警告があります。内容を確認してから登録してください。");
          return;
        }

        const batchItems = selectedRows.map((row) => ({
          vehicleId: row.vehicleId,
          customerId: row.customerId,
          customerName: row.customerName || row.companyName || "顧客未割当",
          customerType: row.customerType || "individual",
          companyName: row.companyName || null,
          phone: row.phone || null,
          scheduleDisplayName: row.scheduleDisplayName || null,
          registrationNumber: row.registrationNumber || null,
          registrationLast4: row.registrationLast4 || row.registrationNumber.match(/(\d{1,4})(?!.*\d)/)?.[1] || null,
          maker: row.maker || null,
          model: row.model || null,
          entryType,
          reason,
          startsAt: check.main.startsAt,
          endsAt: check.main.endsAt,
          staffId: staffId || null,
          notes: notes.trim() || null,
          inspectionScheduleType: reason === "点検" ? (inspectionScheduleType || null) : null,
          printTimeMode: check.main.printMode,
          isUrgent,
          needsLoaner,
          vendorId: (reason === "板金塗装" || reason === "一般整備") ? (vendorId || null) : null,
          vendorName: (reason === "板金塗装" || reason === "一般整備") ? (vendorName.trim() || null) : null,
          addDelivery: addDelivery && entryType !== "delivery",
          deliveryStartsAt: addDelivery && entryType !== "delivery" ? selectedDelivery?.startsAt || null : null,
          deliveryEndsAt: addDelivery && entryType !== "delivery" ? selectedDelivery?.endsAt || null : null,
          deliveryPrintTimeMode: addDelivery && entryType !== "delivery" ? selectedDelivery?.mode || null : null,
        }));

        const { data, error } = await supabase.rpc("create_schedule_registration_batch_v1", {
          p_day: day,
          p_items: batchItems,
          p_allow_warning_override: allowOverride,
        });
        if (error) throw error;

        const batchHardErrors = Array.isArray(data?.hardErrors) ? data.hardErrors.map(String) : [];
        const batchWarnings = Array.isArray(data?.warnings) ? data.warnings.map(String) : [];
        if (batchHardErrors.length || data?.created === false) {
          setHardErrors(batchHardErrors.length ? batchHardErrors : ["複数台の一括登録を完了できませんでした。"]);
          setMessage("複数台のうち登録できない条件があります。1台も登録せずに止めました。");
          return;
        }
        if (data?.overrideRequired && !allowOverride) {
          setWarnings(batchWarnings);
          setMessage("複数台登録に警告があります。内容を確認してください。");
          return;
        }
        if (!data?.created) throw new Error("複数台の予定を登録できませんでした。");

        resetAfterSuccessfulRegistration();
        setMessage("");
        setSuccessMessage(`${selectedRows.length}台の予定を登録しました。`);
        return;
      }

      const selectedCustomerForSubmit = existingCustomerId;
      const selectedVehicleForSubmit = existingVehicleId;

      const check = await preflight();
      if (!check.allowed || check.hardErrors.length) {
        setHardErrors(check.hardErrors.length ? check.hardErrors : ["この時間は登録できません。"]);
        setMessage("登録できない条件があります。内容を確認してください。");
        return;
      }

      const resolvedVehicleId = selectedVehicleForSubmit
        || (selectedVehicleIds.length === 1 ? selectedVehicleIds[0] : "");
      const sameDayWarnings = resolvedVehicleId
        ? await sameDayVehicleScheduleWarnings([resolvedVehicleId])
        : [];
      if ((check.overrideRequired || sameDayWarnings.length > 0) && !allowOverride) {
        setWarnings([...check.warnings, ...sameDayWarnings]);
        setMessage(sameDayWarnings.length
          ? "この車両は同じ日にすでに予定があります。確認後は「それでも登録する」で登録できます。"
          : "警告があります。内容を確認してから登録してください。");
        return;
      }

      const selectedCustomerForSubmitNow = existingCustomerId;
      const selectedVehicleForSubmitNow = existingVehicleId;

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
        p_inspection_schedule_type: reason === "点検" ? (inspectionScheduleType || null) : null,
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
          p_vendor_id: (reason === "板金塗装" || reason === "一般整備") ? (vendorId || null) : null,
          p_vendor_name: (reason === "板金塗装" || reason === "一般整備") ? (vendorName.trim() || null) : null,
          p_actor: "schedule-registration",
        });
        if (assignmentError) throw assignmentError;
      }

      resetAfterSuccessfulRegistration();
      setMessage("");
      setSuccessMessage("予定を登録しました。");
    } catch (error: any) {
      setMessage(safeActionError("予定登録", error));
    } finally {
      setBusy(false);
    }
  }

  const capMorning = capacity ? `${capacity.morning_count}/${capacity.morning_total_limit}` : "-";
  const capAfternoon = capacity ? `${capacity.afternoon_count}/${capacity.afternoon_total_limit}` : "-";
  const capInspection = capacity ? `${capacity.morning_inspection_count}/${capacity.morning_inspection_warning}` : "-";
  const capMorningPickup = pickupCapacity ? `${pickupCapacity.morning_pickup_count}/${pickupCapacity.morning_pickup_limit}` : "-";

  return (
    <main className="page">
      <header className="top">
        <button onClick={() => location.assign(`/schedule?day=${day}`)}>← スケジュールへ</button>
        <strong>icb</strong>
      </header>

      <section className="card">
        <div className="eyebrow">入出庫予定登録</div>
        <h1>予定を追加</h1>
        <div className="notice">初入庫は「お客様名＋ナンバー下4桁」だけでも予定登録できます。型式・車台番号・完全な登録番号は、入庫後や車検証読取後に追記できます。</div>
        {successMessage && (
          <div className="successBanner" role="status" aria-live="polite">
            <b>{successMessage}</b>
            <span>登録日 {day} を引き継いで、他の入力内容はリセットしました。</span>
          </div>
        )}

        <div className="capacity">
          <div><small>午前 引取</small><b>{capMorningPickup}</b></div>
          <div><small>午前 入庫系</small><b>{capMorning}</b></div>
          <div><small>午後 入庫系</small><b>{capAfternoon}</b></div>
          <div><small>午前 車検</small><b>{capInspection}</b></div>
        </div>

      </section>


      <section className="card">
        <h2>① お客様・車両</h2>
        <div style={{margin:"12px 0 16px",padding:"14px",border:"1px solid #c9d8ee",borderRadius:14,background:"#f8fbff"}}>
          <b style={{display:"block",marginBottom:6}}>登録済みのお客様・車両から選ぶ</b>
          <div style={{color:"#607086",fontSize:13,lineHeight:1.6,marginBottom:10}}>
            お客様名・会社名・電話番号・登録番号・下4桁・車台番号・メーカー・型式で検索できます。別のお客様・別車両でも続けて複数台選択できます。
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
                  onClick={() => toggleRegisteredVehicle(row)}
                  style={{
                    textAlign:"left",
                    border: selectedVehicleIds.includes(row.vehicleId) ? "2px solid #2f6fe4" : "1px solid #ccd7e5",
                    background: selectedVehicleIds.includes(row.vehicleId) ? "#eef4ff" : "#fff",
                    color:"#172033",
                    display:"grid",
                    gap:3,
                  }}
                >
                  <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                    <b>{row.customerName || row.companyName || "お客様未紐付け"}</b>
                    <strong style={{fontSize:20}}>{naturalLast4(row.registrationLast4 || row.registrationNumber.match(/(\d{1,4})(?!.*\d)/)?.[1] || "") || "----"}</strong>
                  </div>
                  <span>{[row.registrationNumber, row.maker, row.model].filter(Boolean).join("　") || "詳細情報は入庫後に追記できます"}</span>
                  <small style={{color:"#69778a"}}>{[row.phone, row.chassisNumber].filter(Boolean).join(" / ")}</small>
                </button>
              ))}
            </div>
          )}
          {selectedVehicleIds.length > 0 && (
            <div className="selectedVehiclesSummary">
              <b>選択中：{selectedVehicleIds.length}台</b>
              <span>{selectedVehicleIds.length > 1 ? "別のお客様・別車両を、共通の日付・区分/時間・入庫要因・納車予定で一括登録します。各車両の顧客・車両情報は保存済み情報を使用します。" : "別のお客様・別車両も続けて選べます。"}</span>
              <button type="button" onClick={() => {
                setSelectedVehicleIds([]);
                setExistingVehicleId("");
                setExistingCustomerId("");
              }}>選択をクリア</button>
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
        </div>
      </section>

      <section className="card">
        <h2>② 入庫内容</h2>
        <div className="grid">
          <label>区分
            <select value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)}>
              <option value="pickup">引取</option>
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
          {reason === "点検" && (
            <label>点検区分
              <select value={inspectionScheduleType} onChange={(e) => setInspectionScheduleType(e.target.value)}>
                <option value="">未指定</option>
                <option value="schedule">スケジュール点検</option>
                <option value="legal_6m">法定6ヶ月点検</option>
                <option value="legal_12m">法定12ヶ月点検</option>
              </select>
            </label>
          )}
          <label>作業担当
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">未選択</option>
              {staffMembers.map((staff) => (
                <option key={staff.id} value={staff.id}>{staff.short_name || staff.display_name}</option>
              ))}
            </select>
          </label>
          {(reason === "板金塗装" || reason === "一般整備") && (
            <>
              <label>外注先
                <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); if (e.target.value) setVendorName(""); }}>
                  <option value="">自社作業 / 未選択 / 直接入力</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{vendor.short_name || vendor.display_name}</option>
                  ))}
                </select>
              </label>
              {!vendorId && (
                <label>外注先名（必要な時だけ）
                  <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="例：ガラス業者、電装業者、○○鈑金" />
                </label>
              )}
            </>
          )}
          <div className="flagBox">
            <label className="switch"><input type="checkbox" checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)} />急ぎ</label>
            <label className="switch"><input type="checkbox" checked={needsLoaner} onChange={(e) => setNeedsLoaner(e.target.checked)} />代車あり</label>
            <button type="button" onClick={() => location.assign("/settings/staff")}>社員名を管理</button>
            {(reason === "板金塗装" || reason === "一般整備") && <button type="button" onClick={() => location.assign("/settings/vendors")}>外注先を管理</button>}
          </div>
          <label className="wide">備考<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
      </section>

      <section className="card">
        <h2>③ 日時</h2>
        <div className="grid">
          <label>日付<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>

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
                        <span>{mark}</span><b>{x.displayLabel || x.label}</b>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <label>出張時間
                <select value={onsiteMode} onChange={(e) => setOnsiteMode(e.target.value as "exact" | "morning" | "unspecified")}>
                  <option value="exact">時間指定</option>
                  <option value="morning">午前中</option>
                  <option value="unspecified">午後中</option>
                </select>
              </label>
              {onsiteMode === "exact" && (
                <>
                  <label>出張開始<input type="time" min="08:30" max="17:00" step="1800" value={onsiteTime} onChange={(e) => setOnsiteTime(e.target.value)} /></label>
                  <label>作業枠
                    <select value={onsiteDuration} onChange={(e) => setOnsiteDuration(e.target.value)}>
                      <option value="30">30分</option><option value="60">60分</option><option value="90">90分</option><option value="120">120分</option>
                    </select>
                  </label>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {entryType !== "delivery" && (
        <section className="card">
          <h2>④ 納車予定</h2>
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

      <section className="card actionCard">
        {!!hardErrors.length && (
          <div className="errors actionFeedback">
            <b>登録できない項目</b>
            {hardErrors.map((x, i) => <div key={i}>・{x}</div>)}
          </div>
        )}
        {!!warnings.length && (
          <div className="warnings actionFeedback">
            <b>確認が必要です</b>
            {warnings.map((x, i) => <div key={i}>・{x}</div>)}
            <button disabled={busy} onClick={() => void submit(true)}>
              {warnings.some((x) => x.startsWith("同日予定：")) ? "それでも登録する" : "警告を確認して登録"}
            </button>
          </div>
        )}
        {message && (
          <div className="actionMessage" aria-live="polite">{message}</div>
        )}
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
        .capacity{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.capacity>div{background:#f6f8fb;border-radius:12px;padding:12px;display:grid}.capacity b{font-size:24px}.capacity small{color:#78869a}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.selectedVehiclesSummary{margin-top:10px;padding:10px 12px;border:1px solid #bfd3f3;border-radius:12px;background:#eef5ff;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.selectedVehiclesSummary span{color:#53647b;font-size:12px;flex:1 1 260px}.selectedVehiclesSummary button{padding:7px 9px}.grid label{display:grid;gap:6px;font-weight:700;color:#5c6878}.grid .wide{grid-column:1/-1}
        .availabilityBlock{display:grid;gap:10px}.availabilityTitle{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;color:#5c6878}.legend{font-size:12px;font-weight:800}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px}.openDot{background:#4f9c68}.warnDot{background:#d69a36}.blockedDot{background:#9aa5b3}.availabilityLoading{background:#f7f9fc;border-radius:12px;padding:14px;color:#78869a}.timeGrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.timeSlot{display:flex;gap:5px;justify-content:center;align-items:center;padding:10px 7px;border-radius:12px}.timeSlot.open{background:#f2fbf5;border-color:#9bceb0;color:#236c3b}.timeSlot.warning{background:#fff8ea;border-color:#e5bd73;color:#8a5a08}.timeSlot.blocked{background:#f1f3f6;border-color:#d5dbe3;color:#8a95a3;opacity:.7}.timeSlot.selected{outline:3px solid #2674e8;outline-offset:1px}.timeSlot:disabled{cursor:not-allowed}
        input,select,textarea{width:100%;border:1px solid #cbd6e3;border-radius:11px;background:#fff;padding:12px;color:#172033}textarea{min-height:90px;resize:vertical}
        .switch{display:flex;align-items:center;gap:9px;font-weight:800}.switch input{width:auto}.flagBox{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #e0e6ef;border-radius:12px;padding:11px}.flagBox .switch{color:#27364a}.flagBox button{padding:8px 10px}.deliveryGrid{margin-top:12px}
        .successBanner{margin:14px 0 0;padding:14px 16px;border-radius:14px;background:#edf7ef;border:1px solid #b9ddc2;color:#2f5a39;display:grid;gap:4px}.successBanner b{font-size:18px}.successBanner span{font-size:13px;line-height:1.5}.actionCard{scroll-margin-top:16px}.actionFeedback{margin:0 0 10px}.actionMessage{margin:0 0 10px;padding:12px 14px;border-radius:12px;background:#edf7ef;border:1px solid #c2e5cb;color:#3c5944;line-height:1.6}
        .primary{width:100%;background:#2f6fe4;border-color:#2f6fe4;color:#fff;font-size:18px;padding:16px}
        .errors,.warnings{margin-top:12px;border-radius:12px;padding:13px 14px;line-height:1.7}.errors{background:#fff0f0;border:1px solid #efbcbc;color:#8f2f2f}.warnings{background:#fff8df;border:1px solid #ecd98d;color:#6d5912}.warnings button{margin-top:8px;background:#fff}
        .footnote{color:#6f7c8e;line-height:1.6;margin-bottom:0}
        @media(max-width:650px){
          .grid{grid-template-columns:1fr}.grid .wide{grid-column:auto}.capacity{grid-template-columns:1fr 1fr}
          .availabilityTitle{align-items:flex-start}.legend{line-height:1.8}
          .timeGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
          .timeSlot{min-height:54px;padding:10px 6px;white-space:nowrap;gap:4px}
          .timeSlot span{font-size:13px}.timeSlot b{font-size:17px}
        }
      `}</style>
    </main>
  );
}
