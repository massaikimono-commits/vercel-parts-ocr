/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

type Customer = {
  id: string;
  name: string;
  companyName: string;
  phone: string;
  email: string;
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

const ACTIVE_KEY = "parts-active-vehicle";
const PARTS_KEY = "parts-data";

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

export default function CustomerVehiclesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [cloudParts, setCloudParts] = useState<CloudPart[]>([]);
  const [localParts, setLocalParts] = useState<LocalPart[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("顧客・車両・部品履歴をまとめて確認できます。");

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
        name: c.name || "",
        companyName: c.company_name || "",
        phone: c.phone || "",
        email: c.email || "",
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
        const active = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
        const found = vehicleList.find((v) => v.id === active?.id || v.number === active?.number);
        if (found) setSelectedVehicleId(found.id);
      } catch {}

      setMessage(
        syncedCount
          ? `顧客 ${customerList.length}件・車両 ${vehicleList.length}台を読み込み、部品 ${syncedCount}件をクラウドへ同期しました。`
          : `顧客 ${customerList.length}件・車両 ${vehicleList.length}台を読み込みました。`
      );
    } catch (error: any) {
      setMessage(`読み込みエラー: ${error?.message || error}`);
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
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({
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
    localStorage.setItem("parts-before-ocr-ids", JSON.stringify(before));
    location.assign("/ocr/auto");
  }

  function openParts() {
    if (!selectedVehicle) return;
    selectVehicle(selectedVehicle);
    location.assign("/parts-data");
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
                <div>{c ? (c.companyName || c.name || "顧客名未入力") : "顧客未割り当て"}</div>
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
              <div><small>お客様</small><b>{selectedCustomer ? (selectedCustomer.companyName || selectedCustomer.name || "未入力") : "未割り当て"}</b></div>
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
              <button onClick={() => location.assign("/vehicle-workflow")}>車両情報を編集</button>
            </div>
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
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:920px;margin:0 auto;padding:18px 14px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}button{border:1px solid #cdd7e5;border-radius:12px;background:#fff;color:#2674e8;padding:11px 14px;font-size:15px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:32px;margin:0 0 10px}h2{margin:0}h3{font-size:26px;margin:12px 0}p{color:#5d6878;line-height:1.7}.notice{background:#e9f7ef;border:1px solid #bfe6ce;border-radius:12px;padding:13px 15px;margin:14px 0}.search{width:100%;border:1px solid #cdd7e5;border-radius:12px;padding:14px;font-size:16px}.sectionHead,.vehicleTitle,.historyTop{display:flex;align-items:center;justify-content:space-between;gap:10px}.sectionHead span,.vehicleTitle span,.historyTop span,.badge{font-size:13px;border-radius:999px;padding:5px 9px;background:#eef4ff;color:#2f6fe4}.vehicleList,.historyList{display:grid;gap:10px;margin-top:14px}.vehicle{text-align:left;color:#172033;display:grid;gap:5px}.vehicle small{color:#718096;font-weight:500}.vehicle.selected{border:2px solid #2f6fe4;background:#eef4ff}.infoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.infoGrid>div{border:1px solid #e0e6ef;border-radius:12px;padding:12px;display:grid;gap:4px}.infoGrid small{color:#78869a}.address{margin-top:10px;padding:12px;background:#f8fafc;border-radius:12px;color:#5d6878}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.primary{background:#2f6fe4;color:white;border-color:#2f6fe4}.history{border:1px solid #dbe3ee;border-radius:14px;padding:14px;display:grid;gap:9px}.history.local{border-style:dashed}.numbers{display:flex;gap:18px;flex-wrap:wrap;color:#5d6878}.history>small{color:#8a96a7}.empty{margin-top:14px;padding:20px;text-align:center;color:#8491a3;background:#f8fafc;border-radius:12px}@media(max-width:650px){.infoGrid{grid-template-columns:1fr}.sectionHead{align-items:flex-start}.actions button{flex:1 1 100%}}
      `}</style>
    </main>
  );
}
