/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { safeActionError, spreadsheetSafeCell } from "../lib/client-security";

type Customer = {
  id: string;
  type: "individual" | "company";
  name: string;
  companyName: string;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  notes: string;
};

type Vehicle = {
  id: string;
  customerId: string;
  number: string;
  registration: string;
  last4: string;
  chassis: string;
  model: string;
  maker: string;
  fuel: string;
  weight: string;
};

type CloudPart = {
  id: string;
  vehicle_id: string;
  work_order_id: string | null;
  parts_ocr_item_id: string | null;
  part_name: string;
  quantity: number | string;
  list_price: number | string | null;
  purchase_price: number | string | null;
  source_text: string | null;
  created_at: string;
  work_order: { id: string; reason: string; status: string } | null;
};

type LocalPart = {
  id: string;
  name: string;
  qty: string;
  retail: string;
  cost: string;
  source?: string;
  vehicleId?: string;
  vehicleNumber?: string;
  registration?: string;
  chassis?: string;
  linkedAt?: string;
};

type VehicleSearchMode = "last4" | "customer" | "phone";

type CustomerForm = {
  id: string;
  type: "individual" | "company";
  name: string;
  companyName: string;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  notes: string;
};

const ACTIVE_KEY = "parts-active-vehicle";
const PARTS_KEY = "parts-data";

const blankCustomer: CustomerForm = {
  id: "",
  type: "individual",
  name: "",
  companyName: "",
  phone: "",
  email: "",
  postalCode: "",
  address: "",
  notes: "",
};

function readLocalParts(): LocalPart[] {
  try {
    const value = JSON.parse(localStorage.getItem(PARTS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function money(value: any) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("ja-JP") : String(value);
}

function vehicleLabel(v: Vehicle) {
  return v.registration || v.number || v.chassis || "車両";
}

function naturalLast4(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function customerLabel(c: Customer) {
  return c.companyName || c.name || "顧客名未入力";
}

const VEHICLE_PAGE_SIZE = 30;
const VEHICLE_SEARCH_LIMIT = 30;
const CUSTOMER_SEARCH_LIMIT = 20;
const PARTS_PAGE_SIZE = 50;

const VEHICLE_COLUMNS =
  "id,customer_id,vehicle_number,registration_number,registration_number_last4,registration_last4,chassis_number,model,model_code,maker,fuel_type,vehicle_type,vehicle_weight,curb_weight_kg";
const CUSTOMER_COLUMNS =
  "id,customer_type,name,company_name,phone,email,postal_code,address,notes";

function safeSearchLike(value: string) {
  return value.normalize("NFKC").trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ");
}

function normalizeCustomer(row: any): Customer {
  return {
    id: String(row.id),
    type: row.customer_type === "company" ? "company" : "individual",
    name: String(row.name || ""),
    companyName: String(row.company_name || ""),
    phone: String(row.phone || ""),
    email: String(row.email || ""),
    postalCode: String(row.postal_code || ""),
    address: String(row.address || ""),
    notes: String(row.notes || ""),
  };
}

function normalizeVehicle(row: any): Vehicle {
  return {
    id: String(row.id),
    customerId: row.customer_id ? String(row.customer_id) : "",
    number: String(row.vehicle_number || ""),
    registration: String(row.registration_number || ""),
    last4: String(row.registration_number_last4 || row.registration_last4 || ""),
    chassis: String(row.chassis_number || ""),
    model: String(row.model || row.model_code || ""),
    maker: String(row.maker || ""),
    fuel: String(row.fuel_type || row.vehicle_type || ""),
    weight: row.vehicle_weight == null
      ? (row.curb_weight_kg == null ? "" : String(row.curb_weight_kg))
      : String(row.vehicle_weight),
  };
}

function dedupeVehicles(rows: Vehicle[]) {
  const map = new Map<string, Vehicle>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return [...map.values()];
}

function dedupeCustomers(rows: Customer[]) {
  const map = new Map<string, Customer>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return [...map.values()];
}

export default function CustomerVehiclesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cloudParts, setCloudParts] = useState<CloudPart[]>([]);
  const [localParts, setLocalParts] = useState<LocalPart[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedVehicleSnapshot, setSelectedVehicleSnapshot] = useState<Vehicle | null>(null);
  const [selectedCustomerSnapshot, setSelectedCustomerSnapshot] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [vehicleSearchMode, setVehicleSearchMode] = useState<VehicleSearchMode>("last4");
  const [busy, setBusy] = useState(true);
  const [vehicleOffset, setVehicleOffset] = useState(0);
  const [vehicleHasMore, setVehicleHasMore] = useState(false);
  const [partsLoading, setPartsLoading] = useState(false);
  const [cloudPartsOffset, setCloudPartsOffset] = useState(0);
  const [cloudPartsHasMore, setCloudPartsHasMore] = useState(false);
  const [message, setMessage] = useState("顧客・車両・部品履歴をまとめて確認できます。");
  const [customerEditing, setCustomerEditing] = useState(false);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(blankCustomer);
  const [linkCustomerId, setLinkCustomerId] = useState("");
  const [linkCustomerSearch, setLinkCustomerSearch] = useState("");
  const [linkCustomerOptions, setLinkCustomerOptions] = useState<Customer[]>([]);
  const [linkCustomerLoading, setLinkCustomerLoading] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState(false);
  const vehicleLoadSeq = useRef(0);
  const partsLoadSeq = useRef(0);
  const linkCustomerLoadSeq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadVehicleList(query, false, vehicleSearchMode);
    }, query.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query, vehicleSearchMode]);

  useEffect(() => {
    if (!selectedVehicleId) {
      setLinkCustomerOptions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void loadLinkCustomers(linkCustomerSearch);
    }, linkCustomerSearch.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [selectedVehicleId, linkCustomerSearch]);

  async function loadVehicleList(searchText = "", append = false, searchMode: VehicleSearchMode = vehicleSearchMode) {
    const requestId = ++vehicleLoadSeq.current;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessage("ログイン後に顧客・車両履歴を読み込みます。");
        return;
      }

      const search = safeSearchLike(searchText);
      let vehicleRows: any[] = [];
      let customerRows: any[] = [];
      let pageRowCount = 0;

      if (!search) {
        const offset = append ? vehicleOffset : 0;
        const { data, error } = await supabase
          .from("vehicles")
          .select(VEHICLE_COLUMNS)
          .order("updated_at", { ascending: false })
          .range(offset, offset + VEHICLE_PAGE_SIZE - 1);
        if (error) throw error;
        vehicleRows = data || [];
        pageRowCount = vehicleRows.length;

        if (!append) {
          try {
            const active = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null");
            if (active?.id && !vehicleRows.some((row: any) => String(row.id) === String(active.id))) {
              const { data: activeRow, error: activeError } = await supabase
                .from("vehicles")
                .select(VEHICLE_COLUMNS)
                .eq("id", active.id)
                .maybeSingle();
              if (activeError) throw activeError;
              if (activeRow) vehicleRows = [activeRow, ...vehicleRows];
            }
          } catch {}
        }
      } else if (searchMode === "last4") {
        const digits = search.replace(/\D/g, "").slice(-4);
        if (digits) {
          const { data, error } = await supabase
            .from("vehicles")
            .select(VEHICLE_COLUMNS)
            .ilike("registration_number_last4", `%${digits}%`)
            .order("updated_at", { ascending: false })
            .limit(VEHICLE_SEARCH_LIMIT);
          if (error) throw error;
          vehicleRows = data || [];
        }
      } else {
        const customerQuery = supabase
          .from("customers")
          .select(CUSTOMER_COLUMNS)
          .order("updated_at", { ascending: false })
          .limit(CUSTOMER_SEARCH_LIMIT);

        const { data, error } = searchMode === "customer"
          ? await customerQuery.or([
              `name.ilike.%${search}%`,
              `company_name.ilike.%${search}%`,
            ].join(","))
          : await customerQuery.ilike("phone", `%${search}%`);
        if (error) throw error;
        customerRows = data || [];

        const matchedCustomerIds = customerRows.map((row: any) => row.id).filter(Boolean);
        if (matchedCustomerIds.length) {
          const { data, error: vehicleError } = await supabase
            .from("vehicles")
            .select(VEHICLE_COLUMNS)
            .in("customer_id", matchedCustomerIds)
            .order("updated_at", { ascending: false })
            .limit(VEHICLE_SEARCH_LIMIT);
          if (vehicleError) throw vehicleError;
          vehicleRows = data || [];
        }
      }

      const customerIds = [...new Set(vehicleRows.map((row: any) => row.customer_id).filter(Boolean))] as string[];
      const knownCustomerIds = new Set(customerRows.map((row: any) => String(row.id)));
      const missingCustomerIds = customerIds.filter((id) => !knownCustomerIds.has(String(id)));
      if (missingCustomerIds.length) {
        const { data, error } = await supabase
          .from("customers")
          .select(CUSTOMER_COLUMNS)
          .in("id", missingCustomerIds);
        if (error) throw error;
        customerRows = [...customerRows, ...(data || [])];
      }

      if (requestId !== vehicleLoadSeq.current) return;

      const nextVehicles = dedupeVehicles(vehicleRows.map(normalizeVehicle));
      const nextCustomers = dedupeCustomers(customerRows.map(normalizeCustomer));

      setVehicles((old) => append ? dedupeVehicles([...old, ...nextVehicles]) : nextVehicles);
      setCustomers((old) => {
        if (append) return dedupeCustomers([...old, ...nextCustomers]);
        const selected = selectedCustomerSnapshot ? [selectedCustomerSnapshot] : [];
        return dedupeCustomers([...selected, ...nextCustomers]);
      });

      if (!search) {
        const nextOffset = append ? vehicleOffset + pageRowCount : pageRowCount;
        setVehicleOffset(nextOffset);
        setVehicleHasMore(pageRowCount === VEHICLE_PAGE_SIZE);
      } else {
        setVehicleOffset(0);
        setVehicleHasMore(false);
      }

      if (!append && !selectedVehicleId) {
        try {
          const active = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null");
          const activeVehicle = nextVehicles.find((vehicle) =>
            (active?.id && vehicle.id === String(active.id)) ||
            (active?.number && vehicle.number === String(active.number))
          );
          if (activeVehicle) {
            const customer = nextCustomers.find((row) => row.id === activeVehicle.customerId) || null;
            selectVehicle(activeVehicle, customer);
          }
        } catch {}
      }

      const searchModeLabel = searchMode === "last4" ? "下4桁" : searchMode === "customer" ? "お客様名" : "電話番号";
      setMessage(search
        ? `${searchModeLabel}の検索結果 ${nextVehicles.length}台（最大${VEHICLE_SEARCH_LIMIT}台）`
        : append
          ? `最近の車両を${pageRowCount}台追加しました。`
          : `最近更新した車両を${Math.min(pageRowCount, VEHICLE_PAGE_SIZE)}台表示しています。`
      );
    } catch (error: any) {
      if (requestId === vehicleLoadSeq.current) {
        setMessage(safeActionError("顧客・車両情報の読み込み", error));
        if (!append) {
          setVehicles([]);
          setCustomers(selectedCustomerSnapshot ? [selectedCustomerSnapshot] : []);
        }
      }
    } finally {
      if (requestId === vehicleLoadSeq.current) setBusy(false);
    }
  }

  async function loadLinkCustomers(searchText = "") {
    const requestId = ++linkCustomerLoadSeq.current;
    setLinkCustomerLoading(true);
    try {
      const search = safeSearchLike(searchText);
      let queryBuilder = supabase
        .from("customers")
        .select(CUSTOMER_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(CUSTOMER_SEARCH_LIMIT);
      if (search) {
        queryBuilder = queryBuilder.or([
          `name.ilike.%${search}%`,
          `company_name.ilike.%${search}%`,
          `phone.ilike.%${search}%`,
        ].join(","));
      }
      const { data, error } = await queryBuilder;
      if (error) throw error;
      if (requestId !== linkCustomerLoadSeq.current) return;
      const options = (data || []).map(normalizeCustomer);
      if (selectedCustomerSnapshot && !options.some((row) => row.id === selectedCustomerSnapshot.id)) {
        options.unshift(selectedCustomerSnapshot);
      }
      setLinkCustomerOptions(options.slice(0, CUSTOMER_SEARCH_LIMIT + 1));
    } catch (error: any) {
      if (requestId === linkCustomerLoadSeq.current) {
        setMessage(safeActionError("顧客候補の読み込み", error));
        setLinkCustomerOptions(selectedCustomerSnapshot ? [selectedCustomerSnapshot] : []);
      }
    } finally {
      if (requestId === linkCustomerLoadSeq.current) setLinkCustomerLoading(false);
    }
  }

  async function loadVehicleParts(vehicle: Vehicle) {
    const requestId = ++partsLoadSeq.current;
    setPartsLoading(true);
    setCloudParts([]);
    setCloudPartsOffset(0);
    setCloudPartsHasMore(false);

    try {
      const local = readLocalParts().filter(
        (part) =>
          part.vehicleId === vehicle.id ||
          (!part.vehicleId && part.vehicleNumber === vehicle.number)
      );
      setLocalParts(local);

      const { data, error } = await supabase
        .from("parts")
        .select(
          "id,vehicle_id,work_order_id,parts_ocr_item_id,part_name,quantity,list_price,purchase_price,source_text,created_at,work_order:work_orders!parts_work_order_id_fkey(id,reason,status)"
        )
        .eq("vehicle_id", vehicle.id)
        .order("created_at", { ascending: false })
        .range(0, PARTS_PAGE_SIZE - 1);

      if (error) throw error;
      if (requestId !== partsLoadSeq.current) return;

      const rows = (data || []) as unknown as CloudPart[];
      setCloudParts(rows);
      setCloudPartsOffset(rows.length);
      setCloudPartsHasMore(rows.length === PARTS_PAGE_SIZE);
    } catch (error: any) {
      if (requestId === partsLoadSeq.current) {
        setMessage(safeActionError("部品履歴の読み込み", error));
      }
    } finally {
      if (requestId === partsLoadSeq.current) {
        setPartsLoading(false);
      }
    }
  }

  async function loadMoreVehicleParts() {
    const vehicle = selectedVehicleSnapshot;
    if (!vehicle || partsLoading || !cloudPartsHasMore) return;

    const requestId = ++partsLoadSeq.current;
    setPartsLoading(true);

    try {
      const { data, error } = await supabase
        .from("parts")
        .select(
          "id,vehicle_id,work_order_id,parts_ocr_item_id,part_name,quantity,list_price,purchase_price,source_text,created_at,work_order:work_orders!parts_work_order_id_fkey(id,reason,status)"
        )
        .eq("vehicle_id", vehicle.id)
        .order("created_at", { ascending: false })
        .range(
          cloudPartsOffset,
          cloudPartsOffset + PARTS_PAGE_SIZE - 1
        );

      if (error) throw error;
      if (requestId !== partsLoadSeq.current) return;

      const rows = (data || []) as unknown as CloudPart[];
      setCloudParts((old) => {
        const byId = new Map<string, CloudPart>();
        for (const row of [...old, ...rows]) {
          if (!byId.has(row.id)) byId.set(row.id, row);
        }
        return [...byId.values()];
      });
      setCloudPartsOffset((old) => old + rows.length);
      setCloudPartsHasMore(rows.length === PARTS_PAGE_SIZE);
    } catch (error: any) {
      if (requestId === partsLoadSeq.current) {
        setMessage(
          safeActionError("部品履歴の追加読み込み", error)
        );
      }
    } finally {
      if (requestId === partsLoadSeq.current) {
        setPartsLoading(false);
      }
    }
  }

  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const filteredVehicles = vehicles;

  const selectedVehicle = selectedVehicleSnapshot || vehicles.find((v) => v.id === selectedVehicleId) || null;
  const selectedCustomer = selectedCustomerSnapshot
    || (selectedVehicle ? customerMap.get(selectedVehicle.customerId) || null : null);

  const selectedCloudParts = useMemo(
    () => selectedVehicle ? cloudParts.filter((p) => p.vehicle_id === selectedVehicle.id) : [],
    [cloudParts, selectedVehicle]
  );

  const selectedLocalParts = useMemo(() => {
    if (!selectedVehicle) return [];
    return localParts.filter(
      (part) =>
        part.vehicleId === selectedVehicle.id ||
        (!part.vehicleId &&
          part.vehicleNumber === selectedVehicle.number)
    );
  }, [localParts, selectedVehicle]);

  function selectVehicle(v: Vehicle, customerOverride?: Customer | null) {
    const customer = customerOverride === undefined
      ? (v.customerId ? customerMap.get(v.customerId) || null : null)
      : customerOverride;
    setSelectedVehicleId(v.id);
    setSelectedVehicleSnapshot(v);
    setSelectedCustomerSnapshot(customer);
    setLinkCustomerId(v.customerId || "");
    setLinkCustomerSearch("");
    setCustomerEditing(false);
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({
      id: v.id,
      number: v.number,
      registration: v.registration,
      last4: v.last4,
      chassis: v.chassis,
      model: v.model,
    }));
    setMessage(`${vehicleLabel(v)} を作業車両に設定しました。`);
    void loadVehicleParts(v);
  }

  function startOCR() {
    if (!selectedVehicle) return;
    selectVehicle(selectedVehicle);
    const before = readLocalParts().map((p) => p.id).filter(Boolean);
    sessionStorage.setItem("parts-before-ocr-ids", JSON.stringify(before));
    location.assign("/ocr/auto");
  }

  function openParts() {
    if (!selectedVehicle) return;
    selectVehicle(selectedVehicle);
    location.assign("/parts-data");
  }

  function beginEditCustomer(customer?: Customer | null) {
    if (customer) {
      setCustomerForm({
        id: customer.id,
        type: customer.type,
        name: customer.name,
        companyName: customer.companyName,
        phone: customer.phone,
        email: customer.email,
        postalCode: customer.postalCode,
        address: customer.address,
        notes: customer.notes,
      });
    } else {
      setCustomerForm(blankCustomer);
    }
    setCustomerEditing(true);
  }

  async function saveCustomer() {
    if (!selectedVehicle) return;
    const displayName = customerForm.type === "company"
      ? (customerForm.companyName.trim() || customerForm.name.trim())
      : (customerForm.name.trim() || customerForm.companyName.trim());
    if (!displayName) {
      setMessage("お客様名または会社名を入力してください。");
      return;
    }

    setSavingCustomer(true);
    try {
      const payload = {
        customer_type: customerForm.type,
        name: customerForm.name.trim() || displayName,
        company_name: customerForm.companyName.trim() || null,
        phone: customerForm.phone.trim() || null,
        email: customerForm.email.trim() || null,
        postal_code: customerForm.postalCode.trim() || null,
        address: customerForm.address.trim() || null,
        notes: customerForm.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      let saved: any = null;
      if (customerForm.id) {
        const { data, error } = await supabase.from("customers").update(payload).eq("id", customerForm.id).select(CUSTOMER_COLUMNS).single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await supabase.from("customers").insert(payload).select(CUSTOMER_COLUMNS).single();
        if (error) throw error;
        saved = data;
      }

      const { error: vehicleError } = await supabase.from("vehicles").update({ customer_id: saved.id, updated_at: new Date().toISOString() }).eq("id", selectedVehicle.id);
      if (vehicleError) throw vehicleError;

      const normalized: Customer = {
        id: saved.id,
        type: saved.customer_type === "company" ? "company" : "individual",
        name: saved.name || "",
        companyName: saved.company_name || "",
        phone: saved.phone || "",
        email: saved.email || "",
        postalCode: saved.postal_code || "",
        address: saved.address || "",
        notes: saved.notes || "",
      };

      setCustomers((prev) => dedupeCustomers([normalized, ...prev]));
      setVehicles((prev) => prev.map((v) => v.id === selectedVehicle.id ? { ...v, customerId: normalized.id } : v));
      setSelectedVehicleSnapshot({ ...selectedVehicle, customerId: normalized.id });
      setSelectedCustomerSnapshot(normalized);
      setLinkCustomerOptions((prev) => dedupeCustomers([normalized, ...prev]).slice(0, CUSTOMER_SEARCH_LIMIT + 1));
      setLinkCustomerId(normalized.id);
      setCustomerEditing(false);
      setMessage(`${customerLabel(normalized)} を保存し、この車両へ紐付けました。`);
    } catch (error: any) {
      setMessage(safeActionError("顧客情報の保存", error));
    } finally {
      setSavingCustomer(false);
    }
  }

  async function linkExistingCustomer() {
    if (!selectedVehicle || !linkCustomerId) {
      setMessage("紐付ける顧客を選択してください。");
      return;
    }
    try {
      const { error } = await supabase.from("vehicles").update({ customer_id: linkCustomerId, updated_at: new Date().toISOString() }).eq("id", selectedVehicle.id);
      if (error) throw error;
      const customer = linkCustomerOptions.find((row) => row.id === linkCustomerId)
        || customers.find((row) => row.id === linkCustomerId)
        || null;
      setVehicles((prev) => prev.map((v) => v.id === selectedVehicle.id ? { ...v, customerId: linkCustomerId } : v));
      setSelectedVehicleSnapshot({ ...selectedVehicle, customerId: linkCustomerId });
      setSelectedCustomerSnapshot(customer);
      if (customer) setCustomers((prev) => dedupeCustomers([customer, ...prev]));
      setMessage(`${customer ? customerLabel(customer) : "選択した顧客"} をこの車両へ紐付けました。`);
    } catch (error: any) {
      setMessage(safeActionError("顧客と車両の紐付け", error));
    }
  }

  async function deleteSelectedCustomer() {
    if (!selectedCustomer || deletingCustomer) return;
    const label = customerLabel(selectedCustomer);
    const { count: linkedCount, error: countError } = await supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", selectedCustomer.id);
    if (countError) {
      setMessage(safeActionError("紐づく車両数の確認", countError));
      return;
    }
    const ok = window.confirm(
      `${label} の顧客情報を削除しますか？\n\n紐づく車両 ${linkedCount || 0}台・予定・作業履歴は削除せず、顧客だけを削除します。車両は「顧客未割り当て」になります。`
    );
    if (!ok) return;

    setDeletingCustomer(true);
    try {
      const { error } = await supabase.from("customers").delete().eq("id", selectedCustomer.id);
      if (error) throw error;

      setCustomers((prev) => prev.filter((customer) => customer.id !== selectedCustomer.id));
      setVehicles((prev) => prev.map((vehicle) =>
        vehicle.customerId === selectedCustomer.id ? { ...vehicle, customerId: "" } : vehicle
      ));
      if (selectedVehicle) setSelectedVehicleSnapshot({ ...selectedVehicle, customerId: "" });
      setSelectedCustomerSnapshot(null);
      setLinkCustomerOptions((prev) => prev.filter((customer) => customer.id !== selectedCustomer.id));
      setLinkCustomerId("");
      setCustomerEditing(false);
      setCustomerForm(blankCustomer);
      setMessage(`${label} の顧客情報を削除しました。車両・予定・作業履歴は残しています。`);
    } catch (error: any) {
      setMessage(safeActionError("顧客情報の削除", error));
    } finally {
      setDeletingCustomer(false);
    }
  }

  async function copyFormalParts() {
    if (!selectedCloudParts.length) return;
    const rows = [
      ["部品名称", "個数", "定価", "仕入れ"],
      ...selectedCloudParts.map((part) => [
        part.part_name,
        String(part.quantity ?? ""),
        part.list_price === null ? "" : String(part.list_price),
        part.purchase_price === null
          ? ""
          : String(part.purchase_price),
      ]),
    ];
    await navigator.clipboard?.writeText(
      rows
        .map((row) =>
          row.map(spreadsheetSafeCell).join("\t")
        )
        .join("\n")
    );
    setMessage(
      "表示中の正式保存部品をExcel貼り付け用にコピーしました。"
    );
  }

  function printFormalParts() {
    if (!selectedCloudParts.length) return;
    sessionStorage.setItem(
      "parts-print-data",
      JSON.stringify(
        selectedCloudParts.map((part) => ({
          id: part.id,
          name: part.part_name,
          qty: String(part.quantity ?? ""),
          retail:
            part.list_price === null
              ? ""
              : String(part.list_price),
          cost:
            part.purchase_price === null
              ? ""
              : String(part.purchase_price),
        }))
      )
    );
    location.assign("/parts-print?source=formal");
  }

  const totalHistory = selectedCloudParts.length + selectedLocalParts.length;

  return (
    <main className="page">
      <div className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <strong>icb</strong>
      </div>

      <section className="card searchCard">
        <h1>顧客・車両管理</h1>
        <p className="searchIntro">検索方法を「下4桁・お客様名・電話番号」から選んで車両を探します。初期値は「下4桁」です。車両を開くと過去の部品OCR履歴まで確認でき、端末で保存した車両紐付け済み部品はクラウドにも自動同期します。</p>
        <div className="notice">{busy ? "顧客・車両を検索中…" : message}</div>
        <div className="vehicleSearchModes" aria-label="車両検索方法">
          <button type="button" className={vehicleSearchMode === "last4" ? "active" : ""} onClick={() => setVehicleSearchMode("last4")}>下4桁</button>
          <button type="button" className={vehicleSearchMode === "customer" ? "active" : ""} onClick={() => setVehicleSearchMode("customer")}>お客様名</button>
          <button type="button" className={vehicleSearchMode === "phone" ? "active" : ""} onClick={() => setVehicleSearchMode("phone")}>電話番号</button>
        </div>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputMode={vehicleSearchMode === "last4" ? "numeric" : vehicleSearchMode === "phone" ? "tel" : "text"}
          maxLength={vehicleSearchMode === "last4" ? 4 : undefined}
          placeholder={vehicleSearchMode === "last4" ? "例：10 / 1234" : vehicleSearchMode === "customer" ? "例：山田 / 株式会社ICB" : "例：090-1234-5678"}
        />
        <div className="actions bulkImportAction">
          <button onClick={() => location.assign("/customer-vehicles/bulk-import")}>📄 複数PDFをまとめて登録</button>
        </div>
      </section>

      <section className="card">
        <div className="sectionHead">
          <h2>車両一覧</h2>
          <span>{filteredVehicles.length}台</span>
        </div>
        {!filteredVehicles.length && <div className="empty">該当する車両がありません。</div>}
        <div className="vehicleList">
          {filteredVehicles.map((v) => {
            const c = customerMap.get(v.customerId);
            return (
              <button key={v.id} className={`vehicle ${selectedVehicleId === v.id ? "selected" : ""}`} onClick={() => selectVehicle(v)}>
                <div className="vehicleTitle"><b>{vehicleLabel(v)}</b><span>{naturalLast4(v.last4) || "----"} / 選択</span></div>
                <div>{c ? customerLabel(c) : "顧客未割り当て"}</div>
                <small>{[v.maker, v.model, v.chassis].filter(Boolean).join(" / ") || "車両情報未入力"}</small>
              </button>
            );
          })}
        </div>
        {!query.trim() && vehicleHasMore && (
          <div className="actions">
            <button disabled={busy} onClick={() => void loadVehicleList("", true)}>
              {busy ? "読み込み中…" : `さらに${VEHICLE_PAGE_SIZE}台読み込む`}
            </button>
          </div>
        )}
      </section>

      {selectedVehicle && (
        <>
          <section className="card detail">
            <div className="sectionHead"><h2>選択車両</h2><span className="badge">作業車両</span></div>
            <h3>{vehicleLabel(selectedVehicle)}</h3>
            <div className="infoGrid">
              <div><small>お客様</small><b>{selectedCustomer ? customerLabel(selectedCustomer) : "未割り当て"}</b></div>
              <div><small>電話番号</small><b>{selectedCustomer?.phone || "-"}</b></div>
              <div><small>型式</small><b>{selectedVehicle.model || "-"}</b></div>
              <div><small>車台番号</small><b>{selectedVehicle.chassis || "-"}</b></div>
              <div><small>燃料</small><b>{selectedVehicle.fuel || "-"}</b></div>
              <div><small>車両重量</small><b>{selectedVehicle.weight ? `${selectedVehicle.weight} kg` : "-"}</b></div>
            </div>
            {selectedCustomer?.address && <div className="address">{selectedCustomer.address}</div>}
            <div className="actions">
              <button className="primary" onClick={startOCR}>📷 この車両で伝票OCR</button>
              <button onClick={openParts}>③ 部品データ</button>
              <button onClick={() => location.assign(`/customer-vehicles/photos?vehicle=${encodeURIComponent(selectedVehicle.id)}`)}>🖼 写真履歴</button>
              <button onClick={() => location.assign(`/customer-vehicles/history?vehicle=${encodeURIComponent(selectedVehicle.id)}`)}>🕘 統合履歴</button>
              <button onClick={() => location.assign(`/customer-vehicles/lease-maintenance?vehicle=${encodeURIComponent(selectedVehicle.id)}`)}>📄 リースメンテ契約</button>
              <button onClick={() => location.assign("/schedule")}>📅 入出庫予定</button>
              <button onClick={() => location.assign("/vehicle-workflow")}>車両情報を編集</button>
            </div>
          </section>

          <section className="card">
            <div className="sectionHead"><h2>顧客情報</h2><span>{selectedCustomer ? "登録済み" : "未割り当て"}</span></div>

            {!customerEditing && (
              <>
                {selectedCustomer ? (
                  <div className="customerSummary">
                    <div><small>区分</small><b>{selectedCustomer.type === "company" ? "法人" : "個人"}</b></div>
                    <div><small>お客様名</small><b>{selectedCustomer.name || "-"}</b></div>
                    <div><small>会社名</small><b>{selectedCustomer.companyName || "-"}</b></div>
                    <div><small>電話番号</small><b>{selectedCustomer.phone || "-"}</b></div>
                    <div><small>メール</small><b>{selectedCustomer.email || "-"}</b></div>
                    <div><small>郵便番号</small><b>{selectedCustomer.postalCode || "-"}</b></div>
                    <div className="wide"><small>住所</small><b>{selectedCustomer.address || "-"}</b></div>
                    <div className="wide"><small>備考</small><b>{selectedCustomer.notes || "-"}</b></div>
                  </div>
                ) : <div className="empty">この車両にはまだ顧客が紐付いていません。</div>}

                <div className="actions">
                  {selectedCustomer && <button onClick={() => beginEditCustomer(selectedCustomer)}>顧客情報を編集</button>}
                  <button onClick={() => beginEditCustomer(null)}>＋ 新規顧客を登録</button>
                  {selectedCustomer && (
                    <button
                      className="danger"
                      disabled={deletingCustomer}
                      onClick={() => void deleteSelectedCustomer()}
                    >
                      {deletingCustomer ? "削除中…" : "顧客情報を削除"}
                    </button>
                  )}
                </div>
                {selectedCustomer && (
                  <p className="deleteNote">
                    顧客を削除しても、紐づく車両・予定・作業履歴は残り、車両は顧客未割り当てになります。
                  </p>
                )}

                <div className="linkBox">
                  <label>既存顧客をこの車両へ割り当て</label>
                  <input
                    value={linkCustomerSearch}
                    onChange={(e) => setLinkCustomerSearch(e.target.value)}
                    placeholder="顧客名 / 会社名 / 電話番号で検索"
                  />
                  <select value={linkCustomerId} onChange={(e) => setLinkCustomerId(e.target.value)}>
                    <option value="">{linkCustomerLoading ? "顧客候補を検索中…" : "顧客を選択"}</option>
                    {linkCustomerOptions.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customerLabel(customer)}{customer.phone ? ` / ${customer.phone}` : ""}
                      </option>
                    ))}
                  </select>
                  <button onClick={linkExistingCustomer}>この顧客を車両へ紐付け</button>
                </div>
              </>
            )}

            {customerEditing && (
              <div className="customerForm">
                <div className="segmented">
                  <button className={customerForm.type === "individual" ? "active" : ""} onClick={() => setCustomerForm((f) => ({ ...f, type: "individual" }))}>個人</button>
                  <button className={customerForm.type === "company" ? "active" : ""} onClick={() => setCustomerForm((f) => ({ ...f, type: "company" }))}>法人</button>
                </div>
                <label>お客様名<input value={customerForm.name} onChange={(e) => setCustomerForm((f) => ({ ...f, name: e.target.value }))} placeholder="お客様名" /></label>
                <label>会社名<input value={customerForm.companyName} onChange={(e) => setCustomerForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="会社名" /></label>
                <label>電話番号<input value={customerForm.phone} onChange={(e) => setCustomerForm((f) => ({ ...f, phone: e.target.value }))} inputMode="tel" placeholder="電話番号" /></label>
                <label>メール<input value={customerForm.email} onChange={(e) => setCustomerForm((f) => ({ ...f, email: e.target.value }))} inputMode="email" placeholder="メール" /></label>
                <label>郵便番号<input value={customerForm.postalCode} onChange={(e) => setCustomerForm((f) => ({ ...f, postalCode: e.target.value }))} inputMode="numeric" placeholder="郵便番号" /></label>
                <label>住所<input value={customerForm.address} onChange={(e) => setCustomerForm((f) => ({ ...f, address: e.target.value }))} placeholder="住所" /></label>
                <label className="wide">備考<textarea value={customerForm.notes} onChange={(e) => setCustomerForm((f) => ({ ...f, notes: e.target.value }))} placeholder="備考" /></label>
                <div className="actions wide">
                  <button className="primary" disabled={savingCustomer} onClick={saveCustomer}>{savingCustomer ? "保存中…" : customerForm.id ? "顧客情報を更新" : "新規顧客を保存して紐付け"}</button>
                  <button onClick={() => setCustomerEditing(false)}>キャンセル</button>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <div className="sectionHead"><h2>部品OCR履歴</h2><span>表示中 {totalHistory}件</span></div>
            {!!selectedCloudParts.length && (
              <div className="actions">
                <button onClick={() => void copyFormalParts()}>
                  📋 正式保存4項目をコピー
                </button>
                <button onClick={printFormalParts}>
                  🖨 正式保存部品を印刷へ
                </button>
              </div>
            )}
            {partsLoading && !totalHistory && <div className="empty">部品履歴を読み込み中…</div>}
            {!partsLoading && !totalHistory && <div className="empty">この車両の部品履歴はまだありません。</div>}
            <div className="historyList">
              {selectedCloudParts.map((p) => (
                <div className="history" key={`cloud-${p.id}`}>
                  <div className="historyTop"><b>{p.part_name || "名称未入力"}</b><span>正式保存</span></div>
                  <div className="numbers"><span>個数 <b>{p.quantity || "-"}</b></span><span>定価 <b>{money(p.list_price)}</b></span><span>仕入れ <b>{money(p.purchase_price)}</b></span></div>
                  <small>{p.created_at ? new Date(p.created_at).toLocaleString("ja-JP") : ""}{p.work_order ? ` / 関連作業 ${p.work_order.reason}` : ""}{selectedVehicle ? ` / 車両 ${vehicleLabel(selectedVehicle)}` : ""}</small>
                </div>
              ))}
              {selectedLocalParts.map((p) => (
                <div className="history local" key={`local-${p.id}`}>
                  <div className="historyTop"><b>{p.name || "名称未入力"}</b><span>未確定（端末）</span></div>
                  <div className="numbers"><span>個数 <b>{p.qty || "-"}</b></span><span>定価 <b>{money(p.retail)}</b></span><span>仕入れ <b>{money(p.cost)}</b></span></div>
                  <small>{p.linkedAt ? new Date(p.linkedAt).toLocaleString("ja-JP") : ""}</small>
                </div>
              ))}
            </div>
            {cloudPartsHasMore && (
              <div className="actions">
                <button disabled={partsLoading} onClick={() => void loadMoreVehicleParts()}>
                  {partsLoading ? "読み込み中…" : `さらに${PARTS_PAGE_SIZE}件表示`}
                </button>
              </div>
            )}
          </section>
        </>
      )}

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:920px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:11px 14px;font-size:15px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}h2{margin:0}h3{font-size:26px;margin:12px 0}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0}.search,.customerForm input,.customerForm textarea,.linkBox input,.linkBox select{width:100%;border:1px solid #cdd7e5;border-radius:12px;padding:14px;font-size:16px;background:#fff;color:#172033}.vehicleSearchModes{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:10px 0 4px}.vehicleSearchModes button{padding:9px 7px;color:#53647b}.vehicleSearchModes button.active{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.customerForm textarea{min-height:90px;resize:vertical}.sectionHead,.vehicleTitle,.historyTop{display:flex;align-items:center;justify-content:space-between;gap:10px}.sectionHead span,.vehicleTitle span,.historyTop span,.badge{font-size:13px;border-radius:999px;padding:5px 9px;background:#eef4ff;color:#2f6fe4}.vehicleList,.historyList{display:grid;gap:10px;margin-top:14px}.vehicle{text-align:left;color:#172033;display:grid;gap:5px}.vehicle small{color:#718096;font-weight:500}.vehicle.selected{border:2px solid #2f6fe4;background:#eef4ff}.infoGrid,.customerSummary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.infoGrid>div,.customerSummary>div{border:1px solid #e0e6ef;border-radius:12px;padding:12px;display:grid;gap:4px}.infoGrid small,.customerSummary small{color:#78869a}.customerSummary .wide{grid-column:1/-1}.address{margin-top:10px;padding:12px;background:#f8fafc;border-radius:12px;color:#5d6878}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.primary{background:#2f6fe4;color:white;border-color:#2f6fe4}.history{border:1px solid #dbe3ee;border-radius:14px;padding:14px;display:grid;gap:9px}.history.local{border-style:dashed}.numbers{display:flex;gap:18px;flex-wrap:wrap;color:#5d6878}.history>small{color:#8a96a7}.empty{margin-top:14px;padding:20px;text-align:center;color:#8491a3;background:#f8fafc;border-radius:12px}.linkBox{margin-top:16px;padding:14px;border:1px solid #e0e6ef;border-radius:14px;display:grid;gap:10px}.linkBox label,.customerForm label{display:grid;gap:6px;color:#5d6878;font-weight:700}.customerForm{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}.customerForm .wide{grid-column:1/-1}.segmented{grid-column:1/-1;display:flex;gap:8px}.segmented button{flex:1}.segmented button.active{background:#2f6fe4;color:#fff;border-color:#2f6fe4}button:disabled{opacity:.55}.customerSummary{margin-top:14px}@media(max-width:650px){.page{padding:8px 8px 34px}.top{margin-bottom:7px}.top button{padding:8px 10px}.card{padding:13px;margin-bottom:10px;border-radius:16px}.searchCard{display:flex;flex-direction:column}.searchCard h1{order:1;font-size:23px;line-height:1.2;margin:0 0 6px}.searchCard .vehicleSearchModes{order:2;margin:2px 0 5px;gap:5px}.searchCard .vehicleSearchModes button{min-height:40px;padding:7px 5px}.searchCard .search{order:3;margin:0 0 5px;padding:11px}.searchCard .notice{order:4;margin:3px 0 5px;padding:8px 10px;font-size:13px}.searchCard .bulkImportAction{order:5;margin-top:3px}.searchCard .bulkImportAction button{flex:0 1 auto;padding:8px 10px;font-size:13px;min-height:40px}.searchCard .searchIntro{order:6;display:none}.vehicleList{margin-top:8px;gap:7px}.vehicle{padding:10px}.infoGrid,.customerSummary,.customerForm{grid-template-columns:1fr}.customerSummary .wide,.customerForm .wide{grid-column:auto}.sectionHead{align-items:flex-start}.actions button{flex:1 1 100%}}
      `}</style>
    </main>
  );
}
