/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { safeActionError, spreadsheetSafeCell } from "../lib/client-security";
import { REVIEW_META_KEY, type StagedPart } from "../ocr/stage-parts-review";

type ReviewMeta = {
  batchId: string;
  localIds: string[];
  recognitionRoute: "dedicated" | "general";
  rawOcrText: string;
  stagedAt: string;
};

type ActiveVehicle = {
  id?: string;
  number?: string;
  registration?: string;
  last4?: string;
  chassis?: string;
  model?: string;
};

type Vehicle = {
  id: string;
  customer_id: string | null;
  registration_number: string | null;
  registration_number_last4: string | null;
  vehicle_number: string | null;
  maker: string | null;
  model: string | null;
  chassis_number: string | null;
};

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  schedule_display_name: string | null;
};

type WorkOrder = {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  planned_delivery_date: string | null;
};

type OcrItemRow = {
  id: string;
  line_no: number;
  part_name: string | null;
  quantity: number | string | null;
  list_price: number | string | null;
  cost_price: number | string | null;
};

type SavedPart = {
  id: string;
  vehicle_id: string | null;
  work_order_id: string | null;
  parts_ocr_item_id: string | null;
  part_name: string;
  quantity: number | string;
  list_price: number | string | null;
  purchase_price: number | string | null;
  created_at: string;
};

const PARTS_KEY = "parts-data";
const ACTIVE_KEY = "parts-active-vehicle";
const BEFORE_KEY = "parts-before-ocr-ids";
const PRINT_KEY = "parts-print-data";

function parse<T>(value: string | null, fallback: T): T {
  try {
    return JSON.parse(value || "") as T;
  } catch {
    return fallback;
  }
}

function numberOrNull(value: string) {
  const cleaned = String(value || "").replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function safeRawText(text: string) {
  return (text || "").slice(0, 70000);
}

function displayLast4(vehicle: Vehicle | null) {
  const raw =
    vehicle?.registration_number_last4 ||
    vehicle?.registration_number?.match(/(\d{1,4})(?!.*\d)/)?.[1] ||
    "";
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw || "----";
}

function customerName(customer: Customer | null) {
  return (
    customer?.schedule_display_name ||
    customer?.company_name ||
    customer?.name ||
    "お客様未登録"
  );
}

function printSnapshot(parts: SavedPart[]) {
  return parts.map((part) => ({
    id: part.id,
    name: part.part_name,
    qty: String(part.quantity ?? ""),
    retail: part.list_price === null ? "" : String(part.list_price),
    cost: part.purchase_price === null ? "" : String(part.purchase_price),
  }));
}

export default function PartsReviewPage() {
  const [meta, setMeta] = useState<ReviewMeta | null>(null);
  const [parts, setParts] = useState<StagedPart[]>([]);
  const [active, setActive] = useState<ActiveVehicle | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workOrderId, setWorkOrderId] = useState("");
  const [savedParts, setSavedParts] = useState<SavedPart[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("OCR結果と保存先を確認してください。");

  useEffect(() => {
    const nextMeta = parse<ReviewMeta | null>(
      sessionStorage.getItem(REVIEW_META_KEY),
      null
    );
    const nextActive = parse<ActiveVehicle | null>(
      sessionStorage.getItem(ACTIVE_KEY),
      null
    );
    const allParts = parse<StagedPart[]>(
      localStorage.getItem(PARTS_KEY),
      []
    );
    const ids = new Set(nextMeta?.localIds || []);

    setMeta(nextMeta);
    setActive(nextActive);
    setParts(allParts.filter((part) => part?.id && ids.has(part.id)));

    if (nextActive?.id) {
      void loadTarget(nextActive.id);
    } else {
      setLoading(false);
      setMessage(
        "対象車両が未選択です。OCR結果は未確定のまま端末に保持しています。"
      );
    }
  }, []);

  async function loadTarget(vehicleId: string) {
    setLoading(true);
    try {
      const [
        { data: vehicleData, error: vehicleError },
        { data: workData, error: workError },
      ] = await Promise.all([
        supabase
          .from("vehicles")
          .select(
            "id,customer_id,registration_number,registration_number_last4,vehicle_number,maker,model,chassis_number"
          )
          .eq("id", vehicleId)
          .maybeSingle(),
        supabase
          .from("work_orders")
          .select("id,reason,status,created_at,planned_delivery_date")
          .eq("vehicle_id", vehicleId)
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (vehicleError) throw vehicleError;
      if (workError) throw workError;

      const nextVehicle = (vehicleData || null) as Vehicle | null;
      setVehicle(nextVehicle);
      setWorkOrders((workData || []) as WorkOrder[]);

      if (nextVehicle?.customer_id) {
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,company_name,schedule_display_name")
          .eq("id", nextVehicle.customer_id)
          .maybeSingle();
        if (error) throw error;
        setCustomer((data || null) as Customer | null);
      }
    } catch (error: any) {
      setMessage(safeActionError("保存対象車両の確認", error));
    } finally {
      setLoading(false);
    }
  }

  const canSave = Boolean(
    meta?.batchId &&
      vehicle?.id &&
      parts.length &&
      parts.every((part) => part.name.trim())
  );

  const selectedWork = useMemo(
    () => workOrders.find((work) => work.id === workOrderId) || null,
    [workOrders, workOrderId]
  );

  function updatePart(
    index: number,
    key: keyof StagedPart,
    value: string
  ) {
    setParts((old) =>
      old.map((part, i) =>
        i === index ? { ...part, [key]: value } : part
      )
    );
  }

  function removePart(index: number) {
    setParts((old) => old.filter((_, i) => i !== index));
  }

  async function saveFormal() {
    if (!meta || !vehicle || !canSave || busy) return;

    setBusy(true);
    setMessage("確認済み部品を正式保存しています。");

    try {
      const documentMeta = {
        client_batch_id: meta.batchId,
        recognition_route: meta.recognitionRoute,
        confirmation: "user_reviewed",
        local_ids: meta.localIds,
      };

      const { data: existingDoc, error: existingError } = await supabase
        .from("parts_ocr_documents")
        .select("id,status")
        .eq("vehicle_id", vehicle.id)
        .contains("extraction_meta", {
          client_batch_id: meta.batchId,
        })
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      let documentId = existingDoc?.id ? String(existingDoc.id) : "";

      if (!documentId) {
        const { data, error } = await supabase
          .from("parts_ocr_documents")
          .insert({
            vehicle_id: vehicle.id,
            work_order_id: workOrderId || null,
            source_type: "UPLOAD",
            source_path: null,
            raw_ocr_text: safeRawText(meta.rawOcrText),
            status: "REVIEWED",
            needs_review: false,
            extraction_meta: documentMeta,
            reviewed_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (error) throw error;
        documentId = String(data.id);
      } else {
        const { error } = await supabase
          .from("parts_ocr_documents")
          .update({
            work_order_id: workOrderId || null,
            raw_ocr_text: safeRawText(meta.rawOcrText),
            status: existingDoc?.status === "SAVED" ? "SAVED" : "REVIEWED",
            needs_review: false,
            extraction_meta: documentMeta,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", documentId);

        if (error) throw error;
      }

      const itemPayload = parts.map((part, index) => ({
        document_id: documentId,
        line_no: index + 1,
        part_name: part.name.trim(),
        quantity: numberOrNull(part.qty),
        list_price: numberOrNull(part.retail),
        cost_price: numberOrNull(part.cost),
        confidence: {},
        needs_review: false,
        updated_at: new Date().toISOString(),
      }));

      const { data: itemRows, error: itemError } = await supabase
        .from("parts_ocr_items")
        .upsert(itemPayload, { onConflict: "document_id,line_no" })
        .select("id,line_no,part_name,quantity,list_price,cost_price");

      if (itemError) throw itemError;

      const items = (itemRows || []) as OcrItemRow[];
      const itemIds = items.map((item) => item.id);

      const { data: existingFormal, error: existingFormalError } =
        await supabase
          .from("parts")
          .select("id,parts_ocr_item_id")
          .in("parts_ocr_item_id", itemIds);

      if (existingFormalError) throw existingFormalError;

      const existingByItem = new Map(
        (existingFormal || [])
          .filter((row: any) => row.parts_ocr_item_id)
          .map((row: any) => [
            String(row.parts_ocr_item_id),
            String(row.id),
          ])
      );

      const itemById = new Map(items.map((item) => [item.id, item]));

      const updateResults = await Promise.all(
        [...existingByItem.entries()].map(([itemId, partId]) => {
          const item = itemById.get(itemId);
          if (!item) return Promise.resolve({ error: null });
          return supabase
            .from("parts")
            .update({
              vehicle_id: vehicle.id,
              work_order_id: workOrderId || null,
              part_name: item.part_name || "",
              quantity: item.quantity ?? 1,
              list_price: item.list_price,
              purchase_price: item.cost_price,
            })
            .eq("id", partId);
        })
      );

      const updateError = updateResults.find((result) => result.error)?.error;
      if (updateError) throw updateError;

      const missingItems = items.filter(
        (item) => !existingByItem.has(item.id)
      );

      if (missingItems.length) {
        const localByLine = new Map(
          parts.map((part, index) => [index + 1, part])
        );

        const { error } = await supabase.from("parts").insert(
          missingItems.map((item) => ({
            vehicle_id: vehicle.id,
            work_order_id: workOrderId || null,
            parts_ocr_item_id: item.id,
            part_name: item.part_name || "",
            quantity: item.quantity ?? 1,
            list_price: item.list_price,
            purchase_price: item.cost_price,
            source_text:
              (localByLine.get(item.line_no)?.source || "").slice(
                0,
                5000
              ) || null,
          }))
        );

        if (error) throw error;
      }

      const { data: finalParts, error: finalPartsError } = await supabase
        .from("parts")
        .select(
          "id,vehicle_id,work_order_id,parts_ocr_item_id,part_name,quantity,list_price,purchase_price,created_at"
        )
        .in("parts_ocr_item_id", itemIds)
        .order("created_at", { ascending: true });

      if (finalPartsError) throw finalPartsError;

      const { error: finalDocError } = await supabase
        .from("parts_ocr_documents")
        .update({
          work_order_id: workOrderId || null,
          status: "SAVED",
          needs_review: false,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      if (finalDocError) throw finalDocError;

      const saved = (finalParts || []) as SavedPart[];
      setSavedParts(saved);
      sessionStorage.setItem(
        PRINT_KEY,
        JSON.stringify(printSnapshot(saved))
      );

      const removeIds = new Set(meta.localIds);
      const local = parse<StagedPart[]>(
        localStorage.getItem(PARTS_KEY),
        []
      );
      localStorage.setItem(
        PARTS_KEY,
        JSON.stringify(
          local.filter((part) => !removeIds.has(part.id))
        )
      );
      sessionStorage.removeItem(BEFORE_KEY);
      sessionStorage.removeItem(REVIEW_META_KEY);

      setMessage(`${saved.length}件をこの車両へ正式保存しました。`);
    } catch (error: any) {
      setMessage(safeActionError("部品の正式保存", error));
    } finally {
      setBusy(false);
    }
  }

  async function copySaved() {
    if (!savedParts.length) return;

    const rows = [
      ["部品名称", "個数", "定価", "仕入れ"],
      ...savedParts.map((part) => [
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
      "正式保存した4項目をExcel貼り付け用にコピーしました。"
    );
  }

  return (
    <main className="reviewPage">
      <header className="top">
        <button onClick={() => history.back()}>← OCR結果へ</button>
        <strong>icb</strong>
      </header>

      <section className="card">
        <div className="sectionHead">
          <div>
            <small>正式保存前確認</small>
            <h1>部品OCR 確認・保存</h1>
          </div>
          <span>{parts.length}件</span>
        </div>
        <div className="notice">
          {loading ? "対象車両を確認中…" : message}
        </div>
      </section>

      <section className="card target">
        <div className="sectionHead">
          <h2>保存先車両</h2>
          <span>{vehicle ? "選択済み" : "未選択"}</span>
        </div>

        {vehicle ? (
          <>
            <div className="vehicleName">
              {customerName(customer)}　<b>{displayLast4(vehicle)}</b>
            </div>
            <div className="targetGrid">
              <div>
                <small>登録番号</small>
                <b>
                  {vehicle.registration_number ||
                    vehicle.vehicle_number ||
                    "-"}
                </b>
              </div>
              <div>
                <small>車種</small>
                <b>
                  {[vehicle.maker, vehicle.model]
                    .filter(Boolean)
                    .join(" ") || "-"}
                </b>
              </div>
              <div>
                <small>車台番号</small>
                <b>{vehicle.chassis_number || "-"}</b>
              </div>
              <div>
                <small>vehicle_id</small>
                <b className="mono">{vehicle.id}</b>
              </div>
            </div>

            <label className="workSelect">
              関連作業（必要な場合のみ）
              <select
                value={workOrderId}
                onChange={(event) =>
                  setWorkOrderId(event.target.value)
                }
              >
                <option value="">作業へは紐付けない</option>
                {workOrders.map((work) => (
                  <option key={work.id} value={work.id}>
                    {work.reason} / {work.status} /{" "}
                    {new Date(
                      work.created_at
                    ).toLocaleDateString("ja-JP")}
                  </option>
                ))}
              </select>
            </label>

            {selectedWork && (
              <small className="workHint">
                選択作業：{selectedWork.reason} /{" "}
                {selectedWork.status}
              </small>
            )}
          </>
        ) : (
          <div className="missingVehicle">
            <b>
              車両未選択のため、まだ正式保存しません。
            </b>
            <p>
              OCR結果は端末の未確定データとして保持しています。
              対象車両を選択してから正式保存してください。
            </p>
            <div className="actions">
              <button
                onClick={() =>
                  location.assign("/customer-vehicles")
                }
              >
                顧客・車両管理で車両を選ぶ
              </button>
              <button
                onClick={() => location.assign("/parts-data")}
              >
                未確定部品を確認
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="sectionHead">
          <h2>4項目を確認</h2>
          <span>必要箇所だけ修正</span>
        </div>

        <div className="headRow">
          <b>部品名称</b>
          <b>個数</b>
          <b>定価</b>
          <b>仕入れ</b>
          <b />
        </div>

        <div className="parts">
          {parts.map((part, index) => (
            <div className="partRow" key={part.id}>
              <input
                value={part.name}
                onChange={(e) =>
                  updatePart(index, "name", e.target.value)
                }
                placeholder="部品名称"
              />
              <input
                inputMode="decimal"
                value={part.qty}
                onChange={(e) =>
                  updatePart(index, "qty", e.target.value)
                }
                placeholder="個数"
              />
              <input
                inputMode="decimal"
                value={part.retail}
                onChange={(e) =>
                  updatePart(index, "retail", e.target.value)
                }
                placeholder="定価"
              />
              <input
                inputMode="decimal"
                value={part.cost}
                onChange={(e) =>
                  updatePart(index, "cost", e.target.value)
                }
                placeholder="仕入れ"
              />
              <button
                className="remove"
                onClick={() => removePart(index)}
              >
                削除
              </button>
            </div>
          ))}
        </div>

        {!parts.length && (
          <div className="empty">
            確認するOCR結果がありません。
          </div>
        )}

        <button
          className="save"
          disabled={!canSave || busy}
          onClick={() => void saveFormal()}
        >
          {busy
            ? "正式保存中…"
            : "✓ この車両へ正式保存"}
        </button>
      </section>

      {!!savedParts.length && (
        <section className="card success">
          <h2>正式保存完了</h2>
          <p>
            OCR元 → 確認済み明細 → 正式部品データの
            参照関係も保存しました。
          </p>
          <div className="actions">
            <button onClick={() => void copySaved()}>
              📋 Excelへ4項目コピー
            </button>
            <button
              onClick={() =>
                location.assign("/parts-print?source=formal")
              }
            >
              🖨 既存印刷へ渡す
            </button>
            <button
              onClick={() => location.assign("/parts-data")}
            >
              部品履歴へ
            </button>
          </div>
        </section>
      )}

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.reviewPage{max-width:920px;margin:0 auto;padding:14px 12px 50px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}button,input,select{font:inherit}.top button,.actions button,.remove{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:10px;padding:9px 11px;font-weight:800}.card{background:#fff;border:1px solid #d9e0ea;border-radius:18px;padding:18px;margin-bottom:12px}.sectionHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.sectionHead h1,.sectionHead h2{margin:0}.sectionHead h1{font-size:27px}.sectionHead span{font-size:11px;background:#eef4ff;color:#245ca8;border-radius:999px;padding:5px 8px;font-weight:900}.notice{margin-top:10px;padding:10px 12px;border-radius:10px;background:#eef5ff;color:#315f98}.vehicleName{font-size:20px;margin:12px 0}.targetGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.targetGrid>div{display:grid;gap:3px;padding:10px;border:1px solid #e2e8f0;border-radius:10px}.targetGrid small{color:#718096}.mono{font-size:10px;word-break:break-all}.workSelect{display:grid;gap:5px;margin-top:12px;font-size:12px;font-weight:800;color:#5d6878}.workSelect select,.partRow input{border:1px solid #ccd7e5;border-radius:9px;padding:9px;background:#fff;color:#172033}.workHint{display:block;margin-top:5px;color:#718096}.missingVehicle{margin-top:12px;padding:13px;border-radius:12px;background:#fff8dd;border:1px solid #ecd986}.missingVehicle p{color:#6c7480}.actions{display:flex;gap:7px;flex-wrap:wrap}.headRow,.partRow{display:grid;grid-template-columns:minmax(170px,2fr) 80px 110px 110px 60px;gap:6px;align-items:center}.headRow{margin:12px 0 5px;color:#687487;font-size:11px}.parts{display:grid;gap:7px}.remove{padding:8px 5px;color:#b84040}.save{width:100%;margin-top:14px;border:0;border-radius:12px;padding:14px;background:#2f6fe4;color:#fff;font-weight:900;font-size:17px}.save:disabled{opacity:.45}.empty{padding:18px;text-align:center;background:#f8fafc;color:#8491a3;border-radius:10px}.success{border-color:#9fd0ae;background:#f4fbf6}.success p{color:#52705c}
        @media(max-width:650px){.reviewPage{padding:7px 6px 30px}.card{padding:11px;margin-bottom:7px;border-radius:13px}.sectionHead h1{font-size:20px}.vehicleName{font-size:16px;margin:8px 0}.targetGrid{grid-template-columns:1fr 1fr;gap:4px}.targetGrid>div{padding:7px}.headRow{display:none}.partRow{grid-template-columns:minmax(0,1fr) 62px 82px 82px;gap:4px;padding:6px;border:1px solid #e4e9f0;border-radius:9px}.partRow .remove{grid-column:1/-1;justify-self:end;padding:4px 8px;font-size:10px}.partRow input{min-width:0;padding:7px 5px;font-size:12px}.save{padding:11px;font-size:14px}.actions button{padding:8px 9px;font-size:12px}}
      `}</style>
    </main>
  );
}
