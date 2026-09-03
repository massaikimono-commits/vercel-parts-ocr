/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { safeActionError } from "../lib/client-security";

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
  part_name: string;
  quantity: number | string;
  list_price: number | string | null;
  purchase_price: number | string | null;
  source_text: string | null;
  created_at: string;
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

function numberOrNull(value: string) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && value !== "" ? n : null;
}

function marker(id: string) {
  return `[local-id:${id}]`;
}

function markerFromSource(source: string | null | undefined) {
  return source?.match(/\[local-id:([^\]]+)\]/)?.[1] || "";
}

function vehicleLabel(v: Vehicle) {
  return v.registration || v.number || v.chassis || "車両";
}

function customerLabel(c: Customer) {
  return c.companyName || c.name || "顧客名未入力";
}

export default function CustomerVehiclesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cloudParts, setCloudParts] = useState<CloudPart[]>([]);
  const [localParts, setLocalParts] = useState<LocalPart[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("顧客・車両・部品履歴をまとめて確認できます。");
  const [customerEditing, setCustomerEditing] = useState(false);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(blankCustomer);
  const [linkCustomerId, setLinkCustomerId] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setBusy(true);
    try {
      const local = readLocalParts();
      setLocalParts(local);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessage("ログイン後に顧客・車両履歴を読み込みます。");
        return;
      }

      const [customerRes, vehicleRes, partsRes] = await Promise.all([
        supabase.from("customers").select("*").order("updated_at", { ascending: false }),
        supabase.from("vehicles").select("*").order("updated_at", { ascending: false }),
        supabase.from("parts").select("id,vehicle_id,part_name,quantity,list_price,purchase_price,source_text,created_at").order("created_at", { ascending: false }).limit(500),
      ]);

      if (customerRes.error) throw customerRes.error;
      if (vehicleRes.error) throw vehicleRes.error;
      if (partsRes.error) throw partsRes.error;

      const customerList: Customer[] = (customerRes.data || []).map((c: any) => ({
        id: c.id,
        type: c.customer_type === "company" ? "company" : "individual",
        name: c.name || "",
        companyName: c.company_name || "",
        phone: c.phone || "",
        email: c.email || "",
        postalCode: c.postal_code || "",
        address: c.address || "",
        notes: c.notes || "",
      }));

      const vehicleList: Vehicle[] = (vehicleRes.data || []).map((v: any) => ({
        id: v.id,
        customerId: v.customer_id || "",
        number: v.vehicle_number || "",
        registration: v.registration_number || "",
        last4: v.registration_number_last4 || v.registration_last4 || "",
        chassis: v.chassis_number || "",
        model: v.model || v.model_code || "",
        maker: v.maker || "",
        fuel: v.fuel_type || v.vehicle_type || "",
        weight: v.vehicle_weight == null ? (v.curb_weight_kg == null ? "" : String(v.curb_weight_kg)) : String(v.vehicle_weight),
      }));

      let cloud = (partsRes.data || []) as CloudPart[];
      const alreadySynced = new Set(cloud.map((p) => markerFromSource(p.source_text)).filter(Boolean));
      const vehicleIds = new Set(vehicleList.map((v) => v.id));
      const pending = local.filter((p) =>
        p.id && p.name && p.vehicleId && vehicleIds.has(p.vehicleId) && !alreadySynced.has(p.id)
      );

      let syncedCount = 0;
      if (pending.length) {
        const rows = pending.map((p) => ({
          vehicle_id: p.vehicleId,
          part_name: p.name,
          quantity: numberOrNull(p.qty) ?? 1,
          list_price: numberOrNull(p.retail),
          purchase_price: numberOrNull(p.cost),
          source_text: `${marker(p.id)} ${p.source || ""}`.trim(),
        }));
        const { data: inserted, error } = await supabase
          .from("parts")
          .insert(rows)
          .select("id,vehicle_id,part_name,quantity,list_price,purchase_price,source_text,created_at");
        if (error) throw error;
        if (inserted?.length) {
          syncedCount = inserted.length;
          cloud = [...(inserted as CloudPart[]), ...cloud];
        }
      }

      setCustomers(customerList);
      setVehicles(vehicleList);
      setCloudParts(cloud);

      try {
        const active = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null");
        const found = vehicleList.find((v) => v.id === active?.id || v.number === active?.number);
        if (found) {
          setSelectedVehicleId(found.id);
          setLinkCustomerId(found.customerId || "");
        }
      } catch {}

      setMessage(
        syncedCount
          ? `顧客 ${customerList.length}件・車両 ${vehicleList.length}台を読み込み、部品 ${syncedCount}件をクラウドへ同期しました。`
          : `顧客 ${customerList.length}件・車両 ${vehicleList.length}台を読み込みました。`
      );
    } catch (error: any) {
      setMessage(safeActionError("顧客・車両情報の読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const filteredVehicles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vehicles;
    const digits = q.replace(/\D/g, "");
    return vehicles.filter((v) => {
      const c = customerMap.get(v.customerId);
      const text = [
        v.number, v.registration, v.last4, v.chassis, v.model, v.maker,
        c?.name, c?.companyName, c?.phone, c?.address,
      ].join(" ").toLowerCase();
      return text.includes(q) || (digits.length >= 2 && (v.last4 || "").includes(digits.slice(-4)));
    });
  }, [vehicles, query, customerMap]);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || null;
  const selectedCustomer = selectedVehicle ? customerMap.get(selectedVehicle.customerId) || null : null;

  const selectedCloudParts = useMemo(
    () => selectedVehicle ? cloudParts.filter((p) => p.vehicle_id === selectedVehicle.id) : [],
    [cloudParts, selectedVehicle]
  );

  const selectedLocalParts = useMemo(() => {
    if (!selectedVehicle) return [];
    const cloudMarkers = new Set(selectedCloudParts.map((p) => markerFromSource(p.source_text)).filter(Boolean));
    return localParts.filter((p) => {
      const match = p.vehicleId === selectedVehicle.id || (!p.vehicleId && p.vehicleNumber === selectedVehicle.number);
      return match && !cloudMarkers.has(p.id);
    });
  }, [localParts, selectedVehicle, selectedCloudParts]);

  function selectVehicle(v: Vehicle) {
    setSelectedVehicleId(v.id);
    setLinkCustomerId(v.customerId || "");
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
        const { data, error } = await supabase.from("customers").update(payload).eq("id", customerForm.id).select("*").single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await supabase.from("customers").insert(payload).select("*").single();
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

      setCustomers((prev) => {
        const exists = prev.some((c) => c.id === normalized.id);
        return exists ? prev.map((c) => c.id === normalized.id ? normalized : c) : [normalized, ...prev];
      });
      setVehicles((prev) => prev.map((v) => v.id === selectedVehicle.id ? { ...v, customerId: normalized.id } : v));
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
      setVehicles((prev) => prev.map((v) => v.id === selectedVehicle.id ? { ...v, customerId: linkCustomerId } : v));
      const customer = customers.find((c) => c.id === linkCustomerId);
      setMessage(`${customer ? customerLabel(customer) : "選択した顧客"} をこの車両へ紐付けました。`);
    } catch (error: any) {
      setMessage(safeActionError("顧客と車両の紐付け", error));
    }
  }

  async function deleteSelectedCustomer() {
    if (!selectedCustomer || deletingCustomer) return;
    const label = customerLabel(selectedCustomer);
    const linkedCount = vehicles.filter((v) => v.customerId === selectedCustomer.id).length;
    const ok = window.confirm(
      `${label} の顧客情報を削除しますか？\n\n紐づく車両 ${linkedCount}台・予定・作業履歴は削除せず、顧客だけを削除します。車両は「顧客未割り当て」になります。`
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

  const totalHistory = selectedCloudParts.length + selectedLocalParts.length;

  return (
    <main className="page">
      <div className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <strong>icb</strong>
      </div>

      <section className="card">
        <h1>顧客・車両管理</h1>
        <p>お客様名・電話番号・ナンバー下4桁・車台番号・型式から検索し、車両を開くと過去の部品OCR履歴まで確認できます。端末で保存した車両紐付け済み部品はクラウドにも自動同期します。</p>
        <div className="notice">{busy ? "顧客・車両を読み込み中…" : message}</div>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="お客様名 / 電話番号 / 下4桁 / 車台番号 / 型式"
        />
        <div className="actions">
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
            const localCount = localParts.filter((p) => p.vehicleId === v.id || (!p.vehicleId && p.vehicleNumber === v.number)).length;
            const cloudCount = cloudParts.filter((p) => p.vehicle_id === v.id).length;
            return (
              <button key={v.id} className={`vehicle ${selectedVehicleId === v.id ? "selected" : ""}`} onClick={() => selectVehicle(v)}>
                <div className="vehicleTitle"><b>{vehicleLabel(v)}</b><span>部品履歴 {Math.max(localCount, cloudCount)}件</span></div>
                <div>{c ? customerLabel(c) : "顧客未割り当て"}</div>
                <small>{[v.maker, v.model, v.chassis].filter(Boolean).join(" / ") || "車両情報未入力"}</small>
              </button>
            );
          })}
        </div>
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

                {!!customers.length && (
                  <div className="linkBox">
                    <label>既存顧客をこの車両へ割り当て</label>
                    <select value={linkCustomerId} onChange={(e) => setLinkCustomerId(e.target.value)}>
                      <option value="">顧客を選択</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{customerLabel(c)}{c.phone ? ` / ${c.phone}` : ""}</option>)}
                    </select>
                    <button onClick={linkExistingCustomer}>この顧客を車両へ紐付け</button>
                  </div>
                )}
              </>
            )}

            {customerEditing && (
              <div className="customerForm">
                <label>お客様名<input lang="ja" inputMode="text" autoCapitalize="none" spellCheck={false} autoComplete="name" value={customerForm.name} onChange={(e) => setCustomerForm((f) => ({ ...f, name: e.target.value }))} placeholder="お客様名" /></label>
                <label>会社名<input lang="ja" inputMode="text" autoCapitalize="none" spellCheck={false} autoComplete="organization" value={customerForm.companyName} onChange={(e) => setCustomerForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="会社名" /></label>
                <label>電話番号<input value={customerForm.phone} onChange={(e) => setCustomerForm((f) => ({ ...f, phone: e.target.value }))} inputMode="tel" placeholder="電話番号" /></label>
                <label>メール<input value={customerForm.email} onChange={(e) => setCustomerForm((f) => ({ ...f, email: e.target.value }))} inputMode="email" placeholder="メール" /></label>
                <label>郵便番号<input value={customerForm.postalCode} onChange={(e) => setCustomerForm((f) => ({ ...f, postalCode: e.target.value }))} inputMode="numeric" placeholder="郵便番号" /></label>
                <label>住所<input lang="ja" inputMode="text" autoCapitalize="none" spellCheck={false} autoComplete="street-address" value={customerForm.address} onChange={(e) => setCustomerForm((f) => ({ ...f, address: e.target.value }))} placeholder="住所" /></label>
                <label className="wide">備考<textarea value={customerForm.notes} onChange={(e) => setCustomerForm((f) => ({ ...f, notes: e.target.value }))} placeholder="備考" /></label>
                <div className="actions wide">
                  <button className="primary" disabled={savingCustomer} onClick={saveCustomer}>{savingCustomer ? "保存中…" : customerForm.id ? "顧客情報を更新" : "新規顧客を保存して紐付け"}</button>
                  <button onClick={() => setCustomerEditing(false)}>キャンセル</button>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <div className="sectionHead"><h2>部品OCR履歴</h2><span>{totalHistory}件</span></div>
            {!totalHistory && <div className="empty">この車両の部品履歴はまだありません。</div>}
            <div className="historyList">
              {selectedCloudParts.map((p) => (
                <div className="history" key={`cloud-${p.id}`}>
                  <div className="historyTop"><b>{p.part_name || "名称未入力"}</b><span>クラウド保存</span></div>
                  <div className="numbers"><span>個数 <b>{p.quantity || "-"}</b></span><span>定価 <b>{money(p.list_price)}</b></span><span>仕入れ <b>{money(p.purchase_price)}</b></span></div>
                  <small>{p.created_at ? new Date(p.created_at).toLocaleString("ja-JP") : ""}</small>
                </div>
              ))}
              {selectedLocalParts.map((p) => (
                <div className="history local" key={`local-${p.id}`}>
                  <div className="historyTop"><b>{p.name || "名称未入力"}</b><span>端末保存</span></div>
                  <div className="numbers"><span>個数 <b>{p.qty || "-"}</b></span><span>定価 <b>{money(p.retail)}</b></span><span>仕入れ <b>{money(p.cost)}</b></span></div>
                  <small>{p.linkedAt ? new Date(p.linkedAt).toLocaleString("ja-JP") : ""}</small>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:920px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:11px 14px;font-size:15px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}h2{margin:0}h3{font-size:26px;margin:12px 0}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0}.search,.customerForm input,.customerForm textarea,.linkBox select{width:100%;border:1px solid #cdd7e5;border-radius:12px;padding:14px;font-size:16px;background:#fff;color:#172033}.customerForm textarea{min-height:90px;resize:vertical}.sectionHead,.vehicleTitle,.historyTop{display:flex;align-items:center;justify-content:space-between;gap:10px}.sectionHead span,.vehicleTitle span,.historyTop span,.badge{font-size:13px;border-radius:999px;padding:5px 9px;background:#eef4ff;color:#2f6fe4}.vehicleList,.historyList{display:grid;gap:10px;margin-top:14px}.vehicle{text-align:left;color:#172033;display:grid;gap:5px}.vehicle small{color:#718096;font-weight:500}.vehicle.selected{border:2px solid #2f6fe4;background:#eef4ff}.infoGrid,.customerSummary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.infoGrid>div,.customerSummary>div{border:1px solid #e0e6ef;border-radius:12px;padding:12px;display:grid;gap:4px}.infoGrid small,.customerSummary small{color:#78869a}.customerSummary .wide{grid-column:1/-1}.address{margin-top:10px;padding:12px;background:#f8fafc;border-radius:12px;color:#5d6878}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.primary{background:#2f6fe4;color:white;border-color:#2f6fe4}.history{border:1px solid #dbe3ee;border-radius:14px;padding:14px;display:grid;gap:9px}.history.local{border-style:dashed}.numbers{display:flex;gap:18px;flex-wrap:wrap;color:#5d6878}.history>small{color:#8a96a7}.empty{margin-top:14px;padding:20px;text-align:center;color:#8491a3;background:#f8fafc;border-radius:12px}.linkBox{margin-top:16px;padding:14px;border:1px solid #e0e6ef;border-radius:14px;display:grid;gap:10px}.linkBox label,.customerForm label{display:grid;gap:6px;color:#5d6878;font-weight:700}.customerForm{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}.customerForm .wide{grid-column:1/-1}.segmented{grid-column:1/-1;display:flex;gap:8px}.segmented button{flex:1}.segmented button.active{background:#2f6fe4;color:#fff;border-color:#2f6fe4}button:disabled{opacity:.55}.customerSummary{margin-top:14px}@media(max-width:650px){.infoGrid,.customerSummary,.customerForm{grid-template-columns:1fr}.customerSummary .wide,.customerForm .wide{grid-column:auto}.sectionHead{align-items:flex-start}.actions button{flex:1 1 100%}}
      `}</style>
    </main>
  );
}
