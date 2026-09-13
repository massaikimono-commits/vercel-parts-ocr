/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { safeActionError } from "../../lib/client-security";
import { supabase } from "../../supabase";

type VehicleSummary = {
  id: string;
  registration_number: string | null;
  registration_number_last4: string | null;
  registration_last4: string | null;
  vehicle_number: string | null;
  maker: string | null;
  model: string | null;
  chassis_number: string | null;
};

type VehiclePhotoRow = {
  id: string;
  vehicle_id: string;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  source_type: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const PHOTO_PAGE_SIZE = 24;
const PHOTO_COLUMNS =
  "id,vehicle_id,storage_path,original_filename,mime_type,file_size_bytes,source_type,status,created_at,updated_at";

function naturalLast4(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function vehicleLabel(vehicle: VehicleSummary | null) {
  if (!vehicle) return "車両";
  const last4 = naturalLast4(vehicle.registration_number_last4 || vehicle.registration_last4);
  const model = [vehicle.maker, vehicle.model].filter(Boolean).join(" ");
  return [last4 ? `車番 ${last4}` : "", model].filter(Boolean).join(" / ") || vehicle.registration_number || "車両";
}

function fileSize(value: number | null) {
  if (!value || value <= 0) return "-";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function VehiclePhotoHistoryPage() {
  const [vehicleId, setVehicleId] = useState("");
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [photos, setPhotos] = useState<VehiclePhotoRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [openingId, setOpeningId] = useState("");
  const [message, setMessage] = useState("写真履歴を読み込んでいます。");

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

  async function loadInitial(id: string) {
    setBusy(true);
    try {
      const [{ data: vehicleData, error: vehicleError }, photoResult] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id,registration_number,registration_number_last4,registration_last4,vehicle_number,maker,model,chassis_number")
          .eq("id", id)
          .maybeSingle(),
        loadPhotoPage(id, 0),
      ]);
      if (vehicleError) throw vehicleError;
      if (!vehicleData) {
        setVehicle(null);
        setPhotos([]);
        setHasMore(false);
        setMessage("指定した車両が見つかりませんでした。");
        return;
      }
      setVehicle(vehicleData as VehicleSummary);
      setPhotos(photoResult.rows);
      setOffset(photoResult.rows.length);
      setHasMore(photoResult.rows.length === PHOTO_PAGE_SIZE);
      setMessage(
        photoResult.rows.length
          ? `${photoResult.rows.length}件の写真メタデータを表示しています。`
          : "この車両の保存済み写真はまだありません。"
      );
    } catch (error: any) {
      setVehicle(null);
      setPhotos([]);
      setHasMore(false);
      setMessage(safeActionError("写真履歴の読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  async function loadPhotoPage(id: string, start: number) {
    const { data, error } = await supabase
      .from("vehicle_documents")
      .select(PHOTO_COLUMNS)
      .eq("vehicle_id", id)
      .eq("document_type", "OTHER")
      .like("mime_type", "image/%")
      .order("created_at", { ascending: false })
      .range(start, start + PHOTO_PAGE_SIZE - 1);
    if (error) throw error;
    return { rows: (data || []) as VehiclePhotoRow[] };
  }

  function rememberVehicleAndOpen(path: string) {
    if (!vehicle) return;
    const snapshot = JSON.stringify({
      id: vehicle.id,
      number: vehicle.vehicle_number || "",
      registration: vehicle.registration_number || "",
      last4: vehicle.registration_number_last4 || vehicle.registration_last4 || "",
      chassis: vehicle.chassis_number || "",
      model: vehicle.model || "",
    });
    try { sessionStorage.setItem("parts-active-vehicle", snapshot); } catch {}
    try { localStorage.setItem("parts-active-vehicle", snapshot); } catch {}
    location.assign(path);
  }

  async function loadMore() {
    if (!vehicleId || busy || !hasMore) return;
    setBusy(true);
    try {
      const result = await loadPhotoPage(vehicleId, offset);
      setPhotos((old) => [...old, ...result.rows]);
      setOffset((old) => old + result.rows.length);
      setHasMore(result.rows.length === PHOTO_PAGE_SIZE);
      setMessage(`写真メタデータを${photos.length + result.rows.length}件表示しています。`);
    } catch (error: any) {
      setMessage(safeActionError("写真履歴の追加読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  async function openOriginal(photo: VehiclePhotoRow) {
    if (!photo.storage_path || openingId) return;
    setOpeningId(photo.id);
    try {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(photo.storage_path, 300);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("写真URLを作成できませんでした。");
      window.location.assign(data.signedUrl);
    } catch (error: any) {
      setMessage(safeActionError("元画像の表示", error));
      setOpeningId("");
    }
  }

  return (
    <main className="photoPage">
      <header className="top">
        <button onClick={() => history.back()}>← 戻る</button>
        <strong>icb</strong>
      </header>

      <section className="hero card">
        <div>
          <span>車両写真履歴</span>
          <h1>{vehicleLabel(vehicle)}</h1>
          {vehicle?.chassis_number && <small>車台番号 {vehicle.chassis_number}</small>}
        </div>
        <button onClick={() => location.assign("/customer-vehicles")}>顧客・車両管理</button>
      </section>

      {vehicle && (
        <section className="continueCard card">
          <b>この車両で続ける</b>
          <div className="continueActions">
            <button onClick={() => rememberVehicleAndOpen("/schedule/active")}>📅 次回予定登録</button>
            <button onClick={() => rememberVehicleAndOpen("/inspection")}>🧾 記録簿</button>
          </div>
        </section>
      )}

      <section className="card foundationNotice">
        <b>写真保存機能の土台</b>
        <p>
          現在は既存 vehicle_documents の写真メタデータだけを車両単位でページング表示します。
          元画像は「元画像を開く」を押した時だけ5分間のURLを発行します。
        </p>
        <small>写真追加・期限管理・削除・サムネイル保存は、必要なDB列とStorage削除権限を整備後に有効化します。</small>
      </section>

      <section className="card">
        <div className="sectionHead">
          <h2>写真履歴</h2>
          <span>表示中 {photos.length}件</span>
        </div>
        <div className="notice">{busy && !photos.length ? "読み込み中…" : message}</div>

        {!busy && !photos.length && (
          <div className="empty">この車両には写真履歴がありません。</div>
        )}

        <div className="photoList">
          {photos.map((photo) => (
            <article className="photoRow" key={photo.id}>
              <div className="photoPlaceholder" aria-hidden="true">写真</div>
              <div className="photoMeta">
                <b>{photo.original_filename || "写真"}</b>
                <div>
                  <span>{photo.created_at ? new Date(photo.created_at).toLocaleString("ja-JP") : "-"}</span>
                  <span>{fileSize(photo.file_size_bytes)}</span>
                  <span>{photo.source_type === "CAMERA" ? "撮影" : "選択"}</span>
                </div>
                <small>{photo.mime_type || "image"}</small>
              </div>
              <button
                disabled={!photo.storage_path || Boolean(openingId)}
                onClick={() => void openOriginal(photo)}
              >
                {openingId === photo.id ? "準備中…" : "元画像を開く"}
              </button>
            </article>
          ))}
        </div>

        {hasMore && (
          <div className="actions">
            <button disabled={busy} onClick={() => void loadMore()}>
              {busy ? "読み込み中…" : `さらに${PHOTO_PAGE_SIZE}件表示`}
            </button>
          </div>
        )}
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        button{font:inherit;border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 12px;font-weight:800}
        button:disabled{opacity:.5}.photoPage{max-width:920px;margin:0 auto;padding:16px 14px 50px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
        .card{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:16px;margin-bottom:12px}.hero{display:flex;justify-content:space-between;align-items:center;gap:12px}.hero>div{display:grid;gap:3px}.hero span{font-size:12px;color:#2674e8;font-weight:900}.hero h1{font-size:25px;line-height:1.2;margin:0}.hero small{color:#6b7789}
        .continueCard{display:flex;align-items:center;justify-content:space-between;gap:10px}.continueActions{display:flex;gap:8px;flex-wrap:wrap}.continueActions button{min-height:40px}.foundationNotice{background:#fff8df;border-color:#ead88f}.foundationNotice p{margin:5px 0;color:#625d4d;line-height:1.5}.foundationNotice small{color:#746d57}.sectionHead{display:flex;align-items:center;justify-content:space-between;gap:10px}.sectionHead h2{margin:0;font-size:21px}.sectionHead span{font-size:12px;background:#eef4ff;color:#2674e8;border-radius:999px;padding:5px 8px}.notice{margin-top:8px;padding:8px 10px;background:#f5f8fc;border-radius:10px;color:#53647b;font-size:13px}
        .photoList{display:grid;gap:8px;margin-top:10px}.photoRow{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #dbe3ee;border-radius:13px;padding:10px}.photoPlaceholder{width:64px;height:52px;border-radius:9px;background:#eef2f7;color:#7e8998;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900}.photoMeta{display:grid;gap:4px;min-width:0}.photoMeta>b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.photoMeta>div{display:flex;gap:8px;flex-wrap:wrap;color:#5f6b7a;font-size:12px}.photoMeta small{color:#8994a3}.empty{margin-top:10px;padding:20px;text-align:center;color:#8491a3;background:#f8fafc;border-radius:12px}.actions{display:flex;justify-content:center;margin-top:10px}
        @media(max-width:650px){.continueCard{display:grid}.continueActions{display:grid;grid-template-columns:1fr 1fr}.continueActions button{width:100%;font-size:12px;padding:8px}.photoPage{padding:7px 7px 34px}.top{margin-bottom:5px}.top button{min-height:40px;padding:7px 9px}.card{padding:11px;margin-bottom:8px;border-radius:14px}.hero{align-items:flex-start}.hero h1{font-size:20px}.hero button{min-height:40px;padding:7px 9px;font-size:12px}.foundationNotice{padding:9px 10px}.foundationNotice p{font-size:12px}.foundationNotice small{font-size:11px}.photoRow{grid-template-columns:52px minmax(0,1fr);padding:8px;gap:8px}.photoPlaceholder{width:52px;height:46px}.photoRow>button{grid-column:1/-1;min-height:40px}.sectionHead h2{font-size:18px}.notice{font-size:12px;padding:7px 8px}}
      `}</style>
    </main>
  );
}
