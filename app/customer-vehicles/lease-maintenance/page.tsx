/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { safeActionError } from "../../lib/client-security";
import { supabase } from "../../supabase";

type FourState = "yes" | "no" | "not_stated" | "needs_review";

type VehicleSummary = {
  id: string;
  registration_number: string | null;
  registration_number_last4: string | null;
  registration_last4: string | null;
  maker: string | null;
  model: string | null;
  chassis_number: string | null;
};

type LeaseContract = {
  id: string;
  vehicle_id: string;
  source_document_id: string | null;
  contract_number: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  substitute_car_state: FourState;
  substitute_car_eligible_work_types: string[];
  substitute_car_start_day: number | null;
  substitute_car_max_days: number | null;
  substitute_car_notes: string | null;
  inspection_timing_state: FourState;
  inspection_intervals_months: number[];
  battery_contract_state: FourState;
  summer_tire_contract_state: FourState;
  winter_tire_contract_state: FourState;
  tire_storage_contract_state: FourState;
  oil_interval_state: FourState;
  oil_interval_km: number | null;
  tire_maker_restriction_state: FourState;
  tire_maker_names: string[];
  notes: string | null;
  needs_review: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ContractForm = {
  contract_number: string;
  contract_start_date: string;
  contract_end_date: string;
  substitute_car_state: FourState;
  substitute_car_eligible_work_types: string[];
  substitute_car_start_day: string;
  substitute_car_max_days: string;
  substitute_car_notes: string;
  inspection_timing_state: FourState;
  inspection_intervals_months: string;
  battery_contract_state: FourState;
  summer_tire_contract_state: FourState;
  winter_tire_contract_state: FourState;
  tire_storage_contract_state: FourState;
  oil_interval_state: FourState;
  oil_interval_km: string;
  tire_maker_restriction_state: FourState;
  tire_maker_names: string;
  notes: string;
};

const PAGE_SIZE = 20;
const WORK_TYPES = ["点検", "車検", "一般整備", "板金塗装"] as const;
const CONTRACT_COLUMNS = [
  "id","vehicle_id","source_document_id","contract_number","contract_start_date","contract_end_date",
  "substitute_car_state","substitute_car_eligible_work_types","substitute_car_start_day","substitute_car_max_days",
  "substitute_car_notes","inspection_timing_state","inspection_intervals_months","battery_contract_state",
  "summer_tire_contract_state","winter_tire_contract_state","tire_storage_contract_state","oil_interval_state",
  "oil_interval_km","tire_maker_restriction_state","tire_maker_names","notes","needs_review","reviewed_by",
  "reviewed_at","created_at","updated_at",
].join(",");

const blankForm = (): ContractForm => ({
  contract_number: "",
  contract_start_date: "",
  contract_end_date: "",
  substitute_car_state: "needs_review",
  substitute_car_eligible_work_types: [],
  substitute_car_start_day: "",
  substitute_car_max_days: "",
  substitute_car_notes: "",
  inspection_timing_state: "needs_review",
  inspection_intervals_months: "",
  battery_contract_state: "needs_review",
  summer_tire_contract_state: "needs_review",
  winter_tire_contract_state: "needs_review",
  tire_storage_contract_state: "needs_review",
  oil_interval_state: "needs_review",
  oil_interval_km: "",
  tire_maker_restriction_state: "needs_review",
  tire_maker_names: "",
  notes: "",
});

function stateLabel(value: FourState) {
  if (value === "yes") return "あり / 対象";
  if (value === "no") return "なし / 対象外";
  if (value === "not_stated") return "記載なし";
  return "要確認";
}

function naturalLast4(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function vehicleLabel(vehicle: VehicleSummary | null) {
  if (!vehicle) return "車両";
  const last4 = naturalLast4(vehicle.registration_number_last4 || vehicle.registration_last4);
  const model = [vehicle.maker, vehicle.model].filter(Boolean).join(" ");
  return [last4 ? `車番 ${last4}` : "", model].filter(Boolean).join(" / ")
    || vehicle.registration_number
    || "車両";
}

function contractStatus(contract: LeaseContract | null) {
  if (!contract) return "未登録";
  if (contract.needs_review) return "要確認";
  const today = new Date().toISOString().slice(0, 10);
  if (!contract.contract_start_date || !contract.contract_end_date) return "期間要確認";
  if (today < contract.contract_start_date) return "開始前";
  if (today > contract.contract_end_date) return "契約終了";
  return "契約中";
}

function toForm(contract: LeaseContract): ContractForm {
  return {
    contract_number: contract.contract_number || "",
    contract_start_date: contract.contract_start_date || "",
    contract_end_date: contract.contract_end_date || "",
    substitute_car_state: contract.substitute_car_state,
    substitute_car_eligible_work_types: contract.substitute_car_eligible_work_types || [],
    substitute_car_start_day: contract.substitute_car_start_day ? String(contract.substitute_car_start_day) : "",
    substitute_car_max_days: contract.substitute_car_max_days ? String(contract.substitute_car_max_days) : "",
    substitute_car_notes: contract.substitute_car_notes || "",
    inspection_timing_state: contract.inspection_timing_state,
    inspection_intervals_months: (contract.inspection_intervals_months || []).join(", "),
    battery_contract_state: contract.battery_contract_state,
    summer_tire_contract_state: contract.summer_tire_contract_state,
    winter_tire_contract_state: contract.winter_tire_contract_state,
    tire_storage_contract_state: contract.tire_storage_contract_state,
    oil_interval_state: contract.oil_interval_state,
    oil_interval_km: contract.oil_interval_km ? String(contract.oil_interval_km) : "",
    tire_maker_restriction_state: contract.tire_maker_restriction_state,
    tire_maker_names: (contract.tire_maker_names || []).join(", "),
    notes: contract.notes || "",
  };
}

function positiveInteger(value: string) {
  const n = Number(value);
  return value.trim() && Number.isInteger(n) && n > 0 ? n : null;
}

function parseMonths(value: string) {
  return [...new Set(
    value
      .split(/[,、\s]+/)
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x > 0),
  )].sort((a, b) => a - b);
}

function parseNames(value: string) {
  return [...new Set(value.split(/[,、\n]+/).map((x) => x.trim()).filter(Boolean))];
}

function StateSelect({
  value,
  onChange,
}: {
  value: FourState;
  onChange: (value: FourState) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as FourState)}>
      <option value="needs_review">要確認</option>
      <option value="yes">あり / 対象</option>
      <option value="no">なし / 対象外</option>
      <option value="not_stated">記載なし</option>
    </select>
  );
}

export default function LeaseMaintenancePage() {
  const [vehicleId, setVehicleId] = useState("");
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [contracts, setContracts] = useState<LeaseContract[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContractForm>(blankForm());
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("契約情報を読み込んでいます。");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("vehicle")?.trim() || "";
    setVehicleId(id);
    if (!id) {
      setBusy(false);
      setMessage("車両が指定されていません。顧客・車両管理から車両を選んでください。");
      return;
    }
    void loadInitial(id);
  }, []);

  const latest = contracts[0] || null;
  const editingContract = useMemo(
    () => contracts.find((contract) => contract.id === editingId) || null,
    [contracts, editingId],
  );

  async function loadInitial(id: string) {
    setBusy(true);
    try {
      const [vehicleResult, contractResult] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id,registration_number,registration_number_last4,registration_last4,maker,model,chassis_number")
          .eq("id", id)
          .maybeSingle(),
        loadContractPage(id, 0),
      ]);
      if (vehicleResult.error) throw vehicleResult.error;
      if (!vehicleResult.data) {
        setVehicle(null);
        setContracts([]);
        setMessage("指定した車両が見つかりませんでした。");
        return;
      }
      setVehicle(vehicleResult.data as VehicleSummary);
      setContracts(contractResult);
      setOffset(contractResult.length);
      setHasMore(contractResult.length === PAGE_SIZE);
      if (contractResult[0]) {
        setEditingId(contractResult[0].id);
        setForm(toForm(contractResult[0]));
        setMessage("最新の契約を表示しています。変更して保存した場合は再確認が必要になります。");
      } else {
        setEditingId(null);
        setForm(blankForm());
        setMessage("この車両のリースメンテナンス契約はまだ登録されていません。");
      }
    } catch (error: any) {
      setMessage(safeActionError("リースメンテ契約の読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  async function loadContractPage(id: string, start: number) {
    const { data, error } = await supabase
      .from("lease_maintenance_contracts")
      .select(CONTRACT_COLUMNS)
      .eq("vehicle_id", id)
      .order("contract_start_date", { ascending: false, nullsFirst: false })
      .order("contract_end_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    return (data || []) as LeaseContract[];
  }

  async function loadMore() {
    if (!vehicleId || busy || !hasMore) return;
    setBusy(true);
    try {
      const rows = await loadContractPage(vehicleId, offset);
      setContracts((old) => [...old, ...rows]);
      setOffset((old) => old + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
      setMessage(`契約履歴を${contracts.length + rows.length}件表示しています。`);
    } catch (error: any) {
      setMessage(safeActionError("契約履歴の追加読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    setEditingId(null);
    setForm(blankForm());
    setMessage("新しい契約を入力してください。保存時は「要確認」で登録します。");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editContract(contract: LeaseContract) {
    setEditingId(contract.id);
    setForm(toForm(contract));
    setMessage("契約内容を編集中です。保存すると確認状態は「要確認」に戻ります。");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleWorkType(value: string) {
    setForm((old) => ({
      ...old,
      substitute_car_eligible_work_types: old.substitute_car_eligible_work_types.includes(value)
        ? old.substitute_car_eligible_work_types.filter((item) => item !== value)
        : [...old.substitute_car_eligible_work_types, value],
    }));
  }

  async function saveContract() {
    if (!vehicleId || saving) return;
    if (form.contract_start_date && form.contract_end_date && form.contract_end_date < form.contract_start_date) {
      setMessage("契約終了日は契約開始日以降にしてください。");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        contract_number: form.contract_number.trim() || null,
        contract_start_date: form.contract_start_date || null,
        contract_end_date: form.contract_end_date || null,
        substitute_car_state: form.substitute_car_state,
        substitute_car_eligible_work_types: form.substitute_car_eligible_work_types,
        substitute_car_start_day: positiveInteger(form.substitute_car_start_day),
        substitute_car_max_days: positiveInteger(form.substitute_car_max_days),
        substitute_car_notes: form.substitute_car_notes.trim() || null,
        inspection_timing_state: form.inspection_timing_state,
        inspection_intervals_months: parseMonths(form.inspection_intervals_months),
        battery_contract_state: form.battery_contract_state,
        summer_tire_contract_state: form.summer_tire_contract_state,
        winter_tire_contract_state: form.winter_tire_contract_state,
        tire_storage_contract_state: form.tire_storage_contract_state,
        oil_interval_state: form.oil_interval_state,
        oil_interval_km: positiveInteger(form.oil_interval_km),
        tire_maker_restriction_state: form.tire_maker_restriction_state,
        tire_maker_names: parseNames(form.tire_maker_names),
        notes: form.notes.trim() || null,
        needs_review: true,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      };

      const result = editingId
        ? await supabase
            .from("lease_maintenance_contracts")
            .update(payload)
            .eq("id", editingId)
            .eq("vehicle_id", vehicleId)
            .select(CONTRACT_COLUMNS)
            .single()
        : await supabase
            .from("lease_maintenance_contracts")
            .insert({ vehicle_id: vehicleId, ...payload })
            .select(CONTRACT_COLUMNS)
            .single();

      if (result.error) throw result.error;
      const saved = result.data as LeaseContract;
      const next = editingId
        ? contracts.map((row) => row.id === saved.id ? saved : row)
        : [saved, ...contracts];
      setContracts(next);
      setEditingId(saved.id);
      setForm(toForm(saved));
      setMessage("契約内容を保存しました。内容確認後に「確認済みにする」を実行してください。");
    } catch (error: any) {
      setMessage(safeActionError("リースメンテ契約の保存", error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmContract() {
    if (!editingId || confirming) return;
    setConfirming(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const userId = sessionData.session?.user?.id;
      if (!userId) {
        setMessage("確認者を特定できません。再ログイン後に確認してください。");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("app_user_profiles")
        .select("display_name,login_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (profileError) throw profileError;

      const reviewer = String(profile?.display_name || profile?.login_id || "").trim();
      if (!reviewer) {
        setMessage("確認者名を取得できないため、要確認のまま保存しています。");
        return;
      }

      const reviewedAt = new Date().toISOString();
      const { data, error } = await supabase
        .from("lease_maintenance_contracts")
        .update({
          needs_review: false,
          reviewed_by: reviewer,
          reviewed_at: reviewedAt,
          updated_at: reviewedAt,
        })
        .eq("id", editingId)
        .eq("vehicle_id", vehicleId)
        .select(CONTRACT_COLUMNS)
        .single();
      if (error) throw error;

      const saved = data as LeaseContract;
      setContracts((old) => old.map((row) => row.id === saved.id ? saved : row));
      setMessage(`${reviewer} さんの確認済みとして記録しました。`);
    } catch (error: any) {
      setMessage(safeActionError("契約確認", error));
    } finally {
      setConfirming(false);
    }
  }

  async function openSourceDocument(contract: LeaseContract) {
    if (!contract.source_document_id) return;
    try {
      const { data: document, error } = await supabase
        .from("vehicle_documents")
        .select("id,vehicle_id,storage_path,original_filename,mime_type")
        .eq("id", contract.source_document_id)
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      if (error) throw error;
      if (!document?.storage_path) {
        setMessage("元契約書ファイルの保存先を確認できませんでした。");
        return;
      }
      const { data, error: signError } = await supabase.storage
        .from("documents")
        .createSignedUrl(document.storage_path, 300);
      if (signError) throw signError;
      if (!data?.signedUrl) throw new Error("契約書URLを作成できませんでした。");
      window.location.assign(data.signedUrl);
    } catch (error: any) {
      setMessage(safeActionError("契約書の表示", error));
    }
  }

  return (
    <main className="leasePage">
      <header className="top">
        <button onClick={() => history.back()}>← 戻る</button>
        <strong>icb</strong>
      </header>

      <section className="summary card">
        <div className="summaryTitle">
          <div>
            <span>リースメンテ契約</span>
            <h1>{vehicleLabel(vehicle)}</h1>
            {vehicle?.chassis_number && <small>車台番号 {vehicle.chassis_number}</small>}
          </div>
          <button onClick={() => location.assign("/customer-vehicles")}>顧客・車両管理</button>
        </div>

        <div className="summaryGrid">
          <div><small>契約期間</small><b>{latest ? `${latest.contract_start_date || "未確認"} ～ ${latest.contract_end_date || "未確認"}` : "-"}</b></div>
          <div><small>契約状態</small><b>{contractStatus(latest)}</b></div>
          <div><small>代車特約</small><b>{latest ? stateLabel(latest.substitute_car_state) : "-"}</b></div>
          <div><small>確認</small><b className={latest?.needs_review ? "reviewBadge" : "okBadge"}>{latest ? (latest.needs_review ? "要確認" : "確認済み") : "-"}</b></div>
        </div>

        <div className="summaryActions">
          <button className="primary" onClick={startNew}>＋ 新しい契約を登録</button>
          {latest?.source_document_id && (
            <button onClick={() => void openSourceDocument(latest)}>元契約書を開く</button>
          )}
        </div>
      </section>

      <div className="notice">{busy ? "読み込み中…" : message}</div>

      <section className="card editor">
        <div className="sectionHead">
          <div>
            <span>{editingId ? "契約編集" : "新規契約"}</span>
            <h2>{editingId ? (editingContract?.contract_number || "契約番号未入力") : "契約条件を登録"}</h2>
          </div>
          {editingContract && (
            <b className={editingContract.needs_review ? "reviewBadge" : "okBadge"}>
              {editingContract.needs_review ? "要確認" : "確認済み"}
            </b>
          )}
        </div>

        <details open>
          <summary>基本情報</summary>
          <div className="formGrid">
            <label>契約番号<input value={form.contract_number} onChange={(e) => setForm((old) => ({ ...old, contract_number: e.target.value }))} /></label>
            <label>契約開始日<input type="date" value={form.contract_start_date} onChange={(e) => setForm((old) => ({ ...old, contract_start_date: e.target.value }))} /></label>
            <label>契約終了日<input type="date" value={form.contract_end_date} onChange={(e) => setForm((old) => ({ ...old, contract_end_date: e.target.value }))} /></label>
            {editingContract?.source_document_id && (
              <div className="readonly wide">
                <small>元契約書</small>
                <button onClick={() => void openSourceDocument(editingContract)}>既存の契約書を開く</button>
              </div>
            )}
          </div>
        </details>

        <details open>
          <summary>代車条件</summary>
          <div className="formGrid">
            <label>代車特約<StateSelect value={form.substitute_car_state} onChange={(value) => setForm((old) => ({ ...old, substitute_car_state: value }))} /></label>
            <div className="wide fieldBlock">
              <small>対象となる入庫理由</small>
              <div className="checkGrid">
                {WORK_TYPES.map((type) => (
                  <label className="check" key={type}>
                    <input
                      type="checkbox"
                      checked={form.substitute_car_eligible_work_types.includes(type)}
                      onChange={() => toggleWorkType(type)}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>
            <label>利用開始日（入庫○日目から）<input inputMode="numeric" value={form.substitute_car_start_day} onChange={(e) => setForm((old) => ({ ...old, substitute_car_start_day: e.target.value.replace(/\D/g, "") }))} /></label>
            <label>最大利用日数<input inputMode="numeric" value={form.substitute_car_max_days} onChange={(e) => setForm((old) => ({ ...old, substitute_car_max_days: e.target.value.replace(/\D/g, "") }))} /></label>
            <label className="wide">代車条件メモ<textarea value={form.substitute_car_notes} onChange={(e) => setForm((old) => ({ ...old, substitute_car_notes: e.target.value }))} /></label>
          </div>
        </details>

        <details>
          <summary>点検条件</summary>
          <div className="formGrid">
            <label>点検時期条件<StateSelect value={form.inspection_timing_state} onChange={(value) => setForm((old) => ({ ...old, inspection_timing_state: value }))} /></label>
            <label>点検周期（月）<input value={form.inspection_intervals_months} onChange={(e) => setForm((old) => ({ ...old, inspection_intervals_months: e.target.value }))} placeholder="例：6, 12" /></label>
          </div>
        </details>

        <details>
          <summary>タイヤ / バッテリー</summary>
          <div className="formGrid">
            <label>バッテリー<StateSelect value={form.battery_contract_state} onChange={(value) => setForm((old) => ({ ...old, battery_contract_state: value }))} /></label>
            <label>夏タイヤ<StateSelect value={form.summer_tire_contract_state} onChange={(value) => setForm((old) => ({ ...old, summer_tire_contract_state: value }))} /></label>
            <label>冬タイヤ<StateSelect value={form.winter_tire_contract_state} onChange={(value) => setForm((old) => ({ ...old, winter_tire_contract_state: value }))} /></label>
            <label>タイヤ保管<StateSelect value={form.tire_storage_contract_state} onChange={(value) => setForm((old) => ({ ...old, tire_storage_contract_state: value }))} /></label>
            <label>メーカー指定<StateSelect value={form.tire_maker_restriction_state} onChange={(value) => setForm((old) => ({ ...old, tire_maker_restriction_state: value }))} /></label>
            <label>指定メーカー<input value={form.tire_maker_names} onChange={(e) => setForm((old) => ({ ...old, tire_maker_names: e.target.value }))} placeholder="例：BRIDGESTONE, DUNLOP" /></label>
          </div>
        </details>

        <details>
          <summary>オイル</summary>
          <div className="formGrid">
            <label>交換距離条件<StateSelect value={form.oil_interval_state} onChange={(value) => setForm((old) => ({ ...old, oil_interval_state: value }))} /></label>
            <label>交換距離 km<input inputMode="numeric" value={form.oil_interval_km} onChange={(e) => setForm((old) => ({ ...old, oil_interval_km: e.target.value.replace(/\D/g, "") }))} /></label>
          </div>
        </details>

        <details>
          <summary>その他 / 確認</summary>
          <div className="formGrid">
            <label className="wide">備考<textarea value={form.notes} onChange={(e) => setForm((old) => ({ ...old, notes: e.target.value }))} /></label>
            {editingContract && (
              <div className="reviewInfo wide">
                <div><small>確認状態</small><b>{editingContract.needs_review ? "要確認" : "確認済み"}</b></div>
                <div><small>確認者</small><b>{editingContract.reviewed_by || "-"}</b></div>
                <div><small>確認日時</small><b>{editingContract.reviewed_at ? new Date(editingContract.reviewed_at).toLocaleString("ja-JP") : "-"}</b></div>
              </div>
            )}
          </div>
        </details>

        <div className="saveActions">
          <button className="primary" disabled={saving || !vehicleId} onClick={() => void saveContract()}>
            {saving ? "保存中…" : editingId ? "変更を保存（要確認に戻す）" : "契約を登録（要確認）"}
          </button>
          {editingId && (
            <button disabled={confirming || saving} onClick={() => void confirmContract()}>
              {confirming ? "確認者を取得中…" : "✓ 確認済みにする"}
            </button>
          )}
        </div>
      </section>

      <section className="card historyCard">
        <div className="sectionHead">
          <div><span>車両別</span><h2>契約履歴</h2></div>
          <b>{contracts.length}件表示</b>
        </div>
        {!contracts.length && !busy && <div className="empty">契約履歴はまだありません。</div>}
        <div className="historyList">
          {contracts.map((contract, index) => (
            <article className={contract.id === editingId ? "history selected" : "history"} key={contract.id}>
              <div className="historyMain">
                <div className="historyTitle">
                  <b>{contract.contract_number || "契約番号未入力"}</b>
                  <span>{index === 0 ? "最新" : "履歴"}</span>
                </div>
                <small>{contract.contract_start_date || "開始日未確認"} ～ {contract.contract_end_date || "終了日未確認"}</small>
                <div className="historyMeta">
                  <span>{contract.needs_review ? "要確認" : "確認済み"}</span>
                  <span>代車 {stateLabel(contract.substitute_car_state)}</span>
                  {contract.reviewed_by && <span>確認者 {contract.reviewed_by}</span>}
                </div>
              </div>
              <div className="historyActions">
                <button onClick={() => editContract(contract)}>内容を見る / 編集</button>
                {contract.source_document_id && <button onClick={() => void openSourceDocument(contract)}>元契約書</button>}
              </div>
            </article>
          ))}
        </div>
        {hasMore && (
          <div className="more">
            <button disabled={busy} onClick={() => void loadMore()}>
              {busy ? "読み込み中…" : `さらに${PAGE_SIZE}件表示`}
            </button>
          </div>
        )}
      </section>

      <section className="card rpcNote">
        <b>レンタカー判定との関係</b>
        <p>保存した契約条件は既存 lease_rental_eligibility が参照する構造です。今回は代車・レンタカー予約側の強制判定や予定登録ロジックは変更していません。</p>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        button,input,select,textarea{font:inherit}button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 12px;font-weight:800}button:disabled{opacity:.5}
        .leasePage{max-width:980px;margin:0 auto;padding:16px 14px 52px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.card{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:16px;margin-bottom:12px}
        .summaryTitle,.sectionHead,.historyTitle{display:flex;align-items:center;justify-content:space-between;gap:10px}.summaryTitle>div,.sectionHead>div{display:grid;gap:2px}.summaryTitle span,.sectionHead span{font-size:11px;font-weight:900;color:#2674e8}.summaryTitle h1{font-size:25px;line-height:1.2;margin:0}.summaryTitle small{color:#6b7789}
        .summaryGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:12px}.summaryGrid>div{display:grid;gap:4px;background:#f8fafc;border-radius:11px;padding:10px}.summaryGrid small{color:#6d7888}.summaryActions,.saveActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}.primary{background:#2f6fe4;color:#fff;border-color:#2f6fe4}.reviewBadge,.okBadge{display:inline-flex;align-items:center;width:max-content;border-radius:999px;padding:4px 8px;font-size:12px}.reviewBadge{background:#fff0d7;color:#895d00}.okBadge{background:#e7f7ed;color:#237344}
        .notice{background:#eef5ff;border:1px solid #d6e6fb;color:#40546e;border-radius:11px;padding:9px 11px;margin-bottom:10px;font-size:13px}.sectionHead h2{font-size:21px;margin:0}.sectionHead>b{font-size:12px;color:#657386}
        details{border-top:1px solid #e2e8f0;padding:10px 0}details:first-of-type{margin-top:10px}summary{cursor:pointer;font-weight:900;padding:3px 0}.formGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:9px}.formGrid label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#5a6677}.formGrid input,.formGrid select,.formGrid textarea{width:100%;border:1px solid #ccd7e5;background:#fff;color:#172033;border-radius:10px;padding:10px;font-size:15px}.formGrid textarea{min-height:78px;resize:vertical}.wide{grid-column:1/-1}.fieldBlock,.readonly,.reviewInfo{border:1px solid #e0e7ef;border-radius:11px;padding:10px}.fieldBlock>small,.readonly>small{display:block;color:#687587;font-weight:800;margin-bottom:7px}.checkGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.check{display:flex!important;align-items:center;gap:5px!important;background:#f8fafc;border-radius:9px;padding:8px!important}.check input{width:auto!important}.reviewInfo{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.reviewInfo>div{display:grid;gap:3px}.reviewInfo small{color:#748195}
        .historyList{display:grid;gap:8px;margin-top:10px}.history{border:1px solid #dbe3ee;border-radius:13px;padding:11px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.history.selected{border:2px solid #2f6fe4;background:#f6f9ff}.historyMain{display:grid;gap:4px;min-width:0}.historyTitle{justify-content:flex-start}.historyTitle span{font-size:10px;background:#eef4ff;color:#2674e8;border-radius:999px;padding:4px 7px}.historyMain>small{color:#6b7789}.historyMeta{display:flex;gap:7px;flex-wrap:wrap;font-size:11px;color:#657386}.historyActions{display:flex;gap:6px;flex-wrap:wrap}.historyActions button{font-size:12px;padding:8px}.more{display:flex;justify-content:center;margin-top:10px}.empty{margin-top:10px;padding:20px;text-align:center;color:#8491a3;background:#f8fafc;border-radius:12px}.rpcNote{font-size:13px}.rpcNote p{margin:5px 0 0;color:#5f6b7a;line-height:1.55}
        @media(max-width:650px){.leasePage{padding:7px 7px 34px}.top{margin-bottom:5px}.top button{min-height:40px;padding:7px 9px}.card{padding:10px;margin-bottom:8px;border-radius:14px}.summaryTitle{align-items:flex-start}.summaryTitle h1{font-size:19px}.summaryTitle button{font-size:11px;padding:7px;min-height:40px}.summaryGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:8px}.summaryGrid>div{padding:7px}.summaryGrid small{font-size:10px}.summaryGrid b{font-size:12px}.summaryActions{margin-top:7px}.summaryActions button{flex:1 1 auto;min-height:40px;padding:7px;font-size:12px}.notice{padding:7px 8px;margin-bottom:7px;font-size:12px}.sectionHead h2{font-size:18px}details{padding:8px 0}.formGrid{grid-template-columns:1fr;gap:7px}.wide{grid-column:auto}.formGrid input,.formGrid select,.formGrid textarea{padding:9px}.checkGrid{grid-template-columns:repeat(2,1fr)}.reviewInfo{grid-template-columns:1fr}.saveActions button{flex:1 1 100%;min-height:42px}.history{grid-template-columns:1fr;padding:9px}.historyActions button{flex:1 1 auto;min-height:40px}.rpcNote{padding:9px;font-size:11px}}
      `}</style>
    </main>
  );
}
