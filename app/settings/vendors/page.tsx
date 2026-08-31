/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { safeActionError } from "../../lib/client-security";

import { useEffect, useState } from "react";
import { supabase } from "../../supabase";

type ExternalVendor = {
  id: string;
  display_name: string;
  short_name: string | null;
  is_active: boolean;
  quick_select: boolean;
  display_order: number;
  notes: string | null;
};

export default function VendorSettingsPage() {
  const [vendors, setVendors] = useState<ExternalVendor[]>([]);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("板金塗装などで使う外注先を管理できます。");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setBusy(true);
    const { data, error } = await supabase
      .from("external_vendors")
      .select("id,display_name,short_name,is_active,quick_select,display_order,notes")
      .order("is_active", { ascending: false })
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true });
    if (error) setMessage(safeActionError("外注先一覧の読み込み", error));
    else setVendors((data || []) as ExternalVendor[]);
    setBusy(false);
  }

  async function addVendor() {
    const display = name.trim();
    if (!display) {
      setMessage("外注先名を入力してください。");
      return;
    }
    setBusy(true);
    const maxOrder = vendors.reduce((max, x) => Math.max(max, x.display_order || 0), 0);
    const { error } = await supabase.from("external_vendors").insert({
      display_name: display,
      short_name: shortName.trim() || null,
      notes: notes.trim() || null,
      is_active: true,
      quick_select: true,
      display_order: maxOrder + 10,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setMessage(safeActionError("外注先の追加", error));
      setBusy(false);
      return;
    }
    setName("");
    setShortName("");
    setNotes("");
    setMessage(display + " を追加しました。");
    await load();
  }

  function patchVendor(id: string, patch: Partial<ExternalVendor>) {
    setVendors((old) => old.map((x) => x.id === id ? { ...x, ...patch } : x));
  }

  async function saveVendor(vendor: ExternalVendor) {
    setBusy(true);
    const { error } = await supabase
      .from("external_vendors")
      .update({
        display_name: vendor.display_name.trim(),
        short_name: vendor.short_name?.trim() || null,
        notes: vendor.notes?.trim() || null,
        quick_select: vendor.quick_select,
        display_order: Number(vendor.display_order) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", vendor.id);
    setMessage(error ? safeActionError("外注先情報の保存", error) : vendor.display_name + " を保存しました。");
    setBusy(false);
  }

  async function toggleActive(vendor: ExternalVendor) {
    setBusy(true);
    const next = !vendor.is_active;
    const { error } = await supabase
      .from("external_vendors")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", vendor.id);
    if (error) setMessage(safeActionError("外注先情報の更新", error));
    else setMessage(next ? vendor.display_name + " を使用中に戻しました。" : vendor.display_name + " を使用停止にしました。過去の外注先名は残ります。");
    await load();
  }

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "18px 14px 60px", fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button onClick={() => history.back()}>← 戻る</button>
        <strong>icb</strong>
      </header>

      <section style={{ background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, color: "#2674e8" }}>外注先設定</div>
        <h1>外注先を管理</h1>
        <p>板金塗装の予定登録で選択できます。使用停止にしても、過去の作業に保存済みの外注先名は残ります。</p>
        <div style={{ padding: 12, borderRadius: 12, background: "#edf7ef", marginBottom: 14 }}>{busy ? "処理中…" : message}</div>
        <div style={{ display: "grid", gap: 9 }}>
          <label>外注先名<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：○○鈑金" /></label>
          <label>一覧表示名<input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="例：○○鈑金" /></label>
          <label>メモ<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="担当者・電話番号など" /></label>
          <button onClick={() => void addVendor()} disabled={busy}>＋ 外注先を追加</button>
        </div>
      </section>

      <section style={{ background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22 }}>
        <h2>外注先一覧</h2>
        {!vendors.length && <div>外注先がまだ登録されていません。</div>}
        <div style={{ display: "grid", gap: 10 }}>
          {vendors.map((vendor) => (
            <article key={vendor.id} style={{ border: "1px solid #dbe3ee", borderRadius: 14, padding: 14, opacity: vendor.is_active ? 1 : 0.6 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <label>外注先名<input value={vendor.display_name} onChange={(e) => patchVendor(vendor.id, { display_name: e.target.value })} /></label>
                <label>表示名<input value={vendor.short_name || ""} onChange={(e) => patchVendor(vendor.id, { short_name: e.target.value })} /></label>
                <label>メモ<input value={vendor.notes || ""} onChange={(e) => patchVendor(vendor.id, { notes: e.target.value })} /></label>
                <label>並び順<input inputMode="numeric" value={vendor.display_order} onChange={(e) => patchVendor(vendor.id, { display_order: Number(e.target.value) || 0 })} /></label>
                <label><input type="checkbox" checked={vendor.quick_select} onChange={(e) => patchVendor(vendor.id, { quick_select: e.target.checked })} /> 通常候補に表示</label>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <strong>{vendor.is_active ? "使用中" : "使用停止"}</strong>
                <button onClick={() => void saveVendor(vendor)} disabled={busy}>保存</button>
                <button onClick={() => void toggleActive(vendor)} disabled={busy}>{vendor.is_active ? "使用停止にする" : "使用中に戻す"}</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
