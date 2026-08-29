/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../supabase";

type StaffMember = {
  id: string;
  display_name: string;
  short_name: string | null;
  is_active: boolean;
  quick_select: boolean;
  display_order: number;
};

export default function StaffSettingsPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [message, setMessage] = useState("入社・退職に合わせて社員名を管理できます。");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setBusy(true);
    const { data, error } = await supabase
      .from("staff_members")
      .select("id,display_name,short_name,is_active,quick_select,display_order")
      .order("is_active", { ascending: false })
      .order("display_order", { ascending: true })
      .order("display_name", { ascending: true });
    if (error) setMessage("社員一覧の読み込みエラー: " + error.message);
    else setStaff((data || []) as StaffMember[]);
    setBusy(false);
  }

  async function addStaff() {
    const display = name.trim();
    if (!display) {
      setMessage("社員名を入力してください。");
      return;
    }
    setBusy(true);
    const maxOrder = staff.reduce((max, x) => Math.max(max, x.display_order || 0), 0);
    const { error } = await supabase.from("staff_members").insert({
      display_name: display,
      short_name: shortName.trim() || null,
      is_active: true,
      quick_select: true,
      display_order: maxOrder + 10,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setMessage("社員追加エラー: " + error.message);
      setBusy(false);
      return;
    }
    setName("");
    setShortName("");
    setMessage(display + " を追加しました。");
    await load();
  }

  function patchMember(id: string, patch: Partial<StaffMember>) {
    setStaff((old) => old.map((x) => x.id === id ? { ...x, ...patch } : x));
  }

  async function saveMember(member: StaffMember) {
    setBusy(true);
    const { error } = await supabase
      .from("staff_members")
      .update({
        display_name: member.display_name.trim(),
        short_name: member.short_name?.trim() || null,
        quick_select: member.quick_select,
        display_order: Number(member.display_order) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", member.id);
    setMessage(error ? "保存エラー: " + error.message : member.display_name + " を保存しました。");
    setBusy(false);
  }

  async function toggleActive(member: StaffMember) {
    setBusy(true);
    const next = !member.is_active;
    const { error } = await supabase
      .from("staff_members")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", member.id);
    if (error) setMessage("更新エラー: " + error.message);
    else setMessage(next ? member.display_name + " を在籍に戻しました。" : member.display_name + " を退職扱いにしました。過去の担当者名は残ります。");
    await load();
  }

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "18px 14px 60px", fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button onClick={() => location.assign("/schedule/new")}>← 予定登録へ</button>
        <strong>icb</strong>
      </header>

      <section style={{ background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, color: "#2674e8" }}>社員名設定</div>
        <h1>担当者を管理</h1>
        <p>予定登録では在籍中の社員だけを表示します。退職扱いにしても、過去の作業記録に保存済みの担当者名は残ります。</p>
        <div style={{ padding: 12, borderRadius: 12, background: "#edf7ef", marginBottom: 14 }}>{busy ? "処理中…" : message}</div>
        <div style={{ display: "grid", gap: 9 }}>
          <label>社員名<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：山田 太郎" /></label>
          <label>一覧表示名<input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="例：山田" /></label>
          <button onClick={() => void addStaff()} disabled={busy}>＋ 社員を追加</button>
        </div>
      </section>

      <section style={{ background: "#fff", border: "1px solid #d9e0ea", borderRadius: 22, padding: 22 }}>
        <h2>社員一覧</h2>
        {!staff.length && <div>社員がまだ登録されていません。</div>}
        <div style={{ display: "grid", gap: 10 }}>
          {staff.map((member) => (
            <article key={member.id} style={{ border: "1px solid #dbe3ee", borderRadius: 14, padding: 14, opacity: member.is_active ? 1 : 0.6 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <label>社員名<input value={member.display_name} onChange={(e) => patchMember(member.id, { display_name: e.target.value })} /></label>
                <label>表示名<input value={member.short_name || ""} onChange={(e) => patchMember(member.id, { short_name: e.target.value })} /></label>
                <label>並び順<input inputMode="numeric" value={member.display_order} onChange={(e) => patchMember(member.id, { display_order: Number(e.target.value) || 0 })} /></label>
                <label><input type="checkbox" checked={member.quick_select} onChange={(e) => patchMember(member.id, { quick_select: e.target.checked })} /> 通常候補に表示</label>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <strong>{member.is_active ? "在籍" : "退職"}</strong>
                <button onClick={() => void saveMember(member)} disabled={busy}>保存</button>
                <button onClick={() => void toggleActive(member)} disabled={busy}>{member.is_active ? "退職扱いにする" : "在籍に戻す"}</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
