/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { safeActionError } from "../../lib/client-security";
import { validateDocumentFile } from "../../lib/file-security";
import { supabase } from "../../supabase";

type CalendarRow = {
  business_date: string;
  is_business_day: boolean;
  label: string | null;
  source: "manual" | "annual_upload" | "system";
  source_document_path: string | null;
  updated_at: string | null;
};

const CALENDAR_COLUMNS =
  "business_date,is_business_day,label,source,source_document_path,updated_at";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function currentFiscalYearJst() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value || 0);
  const month = Number(parts.find((part) => part.type === "month")?.value || 1);
  return month >= 4 ? year : year - 1;
}

function fiscalBounds(fiscalYear: number) {
  return {
    start: `${fiscalYear}-04-01`,
    end: `${fiscalYear + 1}-03-31`,
  };
}

function monthDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(date: string) {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

function expectedFiscalDays(fiscalYear: number) {
  const { start, end } = fiscalBounds(fiscalYear);
  return Math.round(
    (new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) / 86_400_000
  ) + 1;
}

function fiscalMonths(fiscalYear: number) {
  return [
    ...Array.from({ length: 9 }, (_, index) => ({ year: fiscalYear, month: index + 4 })),
    ...Array.from({ length: 3 }, (_, index) => ({ year: fiscalYear + 1, month: index + 1 })),
  ];
}

export default function BusinessCalendarPage() {
  const currentFiscalYear = currentFiscalYearJst();
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear);
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("営業日カレンダーを読み込んでいます。");
  const [selectedDate, setSelectedDate] = useState("");
  const [editBusinessDay, setEditBusinessDay] = useState(true);
  const [editLabel, setEditLabel] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeBusinessDay, setRangeBusinessDay] = useState(false);
  const [rangeLabel, setRangeLabel] = useState("");
  const [importFiscalYear, setImportFiscalYear] = useState(currentFiscalYear);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileKind, setImportFileKind] = useState<"image" | "pdf" | "">("");
  const [importMessage, setImportMessage] = useState("対象年度を確認して年間カレンダーファイルを選択してください。");

  useEffect(() => {
    void loadYear(fiscalYear);
  }, [fiscalYear]);

  async function loadYear(year: number) {
    setBusy(true);
    setSelectedDate("");
    const { start, end } = fiscalBounds(year);
    try {
      const { data, error } = await supabase
        .from("business_calendar")
        .select(CALENDAR_COLUMNS)
        .gte("business_date", start)
        .lte("business_date", end)
        .order("business_date", { ascending: true });
      if (error) throw error;
      const nextRows = (data || []) as CalendarRow[];
      setRows(nextRows);
      const missing = expectedFiscalDays(year) - nextRows.length;
      setMessage(
        missing > 0
          ? `${year}年度は${nextRows.length}日登録済み、${missing}日未登録です。未登録日はこの画面では作成しません。`
          : `${year}年度 ${nextRows.length}日を表示しています。`
      );
    } catch (error: any) {
      setRows([]);
      setMessage(safeActionError("営業日カレンダーの読み込み", error));
    } finally {
      setBusy(false);
    }
  }

  const rowMap = useMemo(
    () => new Map(rows.map((row) => [row.business_date, row])),
    [rows]
  );

  const counts = useMemo(() => {
    let open = 0;
    let closed = 0;
    for (const row of rows) {
      if (row.is_business_day) open += 1;
      else closed += 1;
    }
    return {
      open,
      closed,
      missing: Math.max(0, expectedFiscalDays(fiscalYear) - rows.length),
    };
  }, [rows, fiscalYear]);

  const selectedRow = selectedDate ? rowMap.get(selectedDate) || null : null;

  function selectDate(date: string) {
    const row = rowMap.get(date);
    if (!row) return;
    setSelectedDate(date);
    setEditBusinessDay(row.is_business_day);
    setEditLabel(row.label || "");
  }

  async function stageAnnualCalendarFile(file: File | null) {
    setImportFile(null);
    setImportFileKind("");
    if (!file) {
      setImportMessage("対象年度を確認して年間カレンダーファイルを選択してください。");
      return;
    }
    const check = await validateDocumentFile(file, { allowPdf: true });
    if (!check.ok) {
      setImportMessage(check.message);
      return;
    }
    setImportFile(file);
    setImportFileKind(check.kind);
    setImportMessage(
      "ファイルの安全確認は完了しました。年間カレンダーの営業/休業読取方式は未確定のため、現段階ではDB・Storageへ反映しません。"
    );
  }

  function openImportFiscalYear() {
    setFiscalYear(importFiscalYear);
  }

  async function saveSelectedDate() {
    if (!selectedRow || !selectedDate) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("business_calendar")
        .update({
          is_business_day: editBusinessDay,
          label: editLabel.trim() || null,
          source: "manual",
          updated_at: new Date().toISOString(),
        })
        .eq("business_date", selectedDate)
        .select(CALENDAR_COLUMNS)
        .single();
      if (error) throw error;
      const saved = data as CalendarRow;
      setRows((old) => old.map((row) => row.business_date === saved.business_date ? saved : row));
      setMessage(
        `${selectedDate} を${saved.is_business_day ? "営業日" : "休業日"}として保存しました。予定登録の営業日判定にもこの値が使われます。`
      );
    } catch (error: any) {
      setMessage(safeActionError("営業日の保存", error));
    } finally {
      setSaving(false);
    }
  }

  async function applyRange() {
    const { start, end } = fiscalBounds(fiscalYear);
    if (!rangeStart || !rangeEnd) {
      setMessage("範囲の開始日と終了日を選んでください。");
      return;
    }
    if (rangeStart < start || rangeEnd > end || rangeStart > rangeEnd) {
      setMessage(`${fiscalYear}年度（${start}〜${end}）の範囲内で指定してください。`);
      return;
    }

    const labelText = rangeLabel.trim();
    const statusLabel = rangeBusinessDay ? "営業日" : "休業日";
    if (!window.confirm(`${rangeStart}〜${rangeEnd} の登録済み日を「${statusLabel}」へ変更します。よろしいですか？`)) {
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        is_business_day: rangeBusinessDay,
        source: "manual",
        updated_at: new Date().toISOString(),
      };
      if (labelText) payload.label = labelText;

      const { data, error } = await supabase
        .from("business_calendar")
        .update(payload)
        .gte("business_date", rangeStart)
        .lte("business_date", rangeEnd)
        .select(CALENDAR_COLUMNS);
      if (error) throw error;

      const updated = (data || []) as CalendarRow[];
      const updatedMap = new Map(updated.map((row) => [row.business_date, row]));
      setRows((old) => old.map((row) => updatedMap.get(row.business_date) || row));
      setMessage(
        `${rangeStart}〜${rangeEnd} の登録済み${updated.length}日を${statusLabel}へ変更しました。${labelText ? ` ラベル「${labelText}」を設定しました。` : " ラベルは既存値を維持しました。"}`
      );
    } catch (error: any) {
      setMessage(safeActionError("営業日の一括保存", error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="calendarPage">
      <header className="top">
        <button onClick={() => location.assign("/")}>← メインへ</button>
        <strong>icb</strong>
      </header>

      <section className="importCard">
        <div className="importHead">
          <div>
            <span>毎年更新</span>
            <h1>年間カレンダー取込</h1>
          </div>
          <b>読取仕様確認待ち</b>
        </div>
        <div className="importSteps">
          <span><b>1</b> 対象年度</span>
          <span><b>2</b> アップロード</span>
          <span className="pendingStep"><b>3</b> 読取確認・確定</span>
        </div>
        <div className="importControls">
          <label>
            対象年度
            <input
              type="number"
              inputMode="numeric"
              min="2020"
              max="2100"
              value={importFiscalYear}
              onChange={(event) => setImportFiscalYear(Number(event.target.value) || currentFiscalYear)}
            />
          </label>
          <label className="filePicker">
            年間カレンダーを選択
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={(event) => void stageAnnualCalendarFile(event.target.files?.[0] || null)}
            />
          </label>
          <button type="button" onClick={openImportFiscalYear}>この年度の現在値を表示</button>
        </div>
        {importFile && (
          <div className="importFile">
            <div>
              <b>{importFile.name}</b>
              <small>{importFileKind === "pdf" ? "PDF" : "画像"} / {(importFile.size / 1024 / 1024).toFixed(1)}MB / {importFiscalYear}年度</small>
            </div>
            <button type="button" onClick={() => void stageAnnualCalendarFile(null)}>選択解除</button>
          </div>
        )}
        <div className="importNotice">{importMessage}</div>
      </section>

      <section className="calendarHead">
        <div className="titleRow">
          <div>
            <span>年間営業日</span>
            <h1>{fiscalYear}年度 営業日カレンダー</h1>
          </div>
          <div className="yearNav">
            <button disabled={busy || saving} onClick={() => setFiscalYear((year) => year - 1)}>← 前年度</button>
            <button disabled={busy || saving || fiscalYear === currentFiscalYear} onClick={() => setFiscalYear(currentFiscalYear)}>今年度</button>
            <button disabled={busy || saving} onClick={() => setFiscalYear((year) => year + 1)}>次年度 →</button>
          </div>
        </div>
        <div className="summary">
          <b className="openCount">営業 {counts.open}日</b>
          <b className="closedCount">休業 {counts.closed}日</b>
          {counts.missing > 0 && <b className="missingCount">未登録 {counts.missing}日</b>}
        </div>
        <div className="notice">{busy ? "営業日を読み込み中…" : message}</div>
      </section>

      <section className="monthsGrid" aria-label={`${fiscalYear}年度の営業日カレンダー`}>
        {fiscalMonths(fiscalYear).map(({ year, month }) => {
          const firstDate = monthDate(year, month, 1);
          const leading = weekdayOf(firstDate);
          const days = daysInMonth(year, month);
          const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
          return (
            <article className="monthCard" key={monthPrefix}>
              <div className="monthHead">
                <h2>{year}年 {month}月</h2>
                <span>
                  {rows.filter((row) => row.business_date.startsWith(monthPrefix) && !row.is_business_day).length}休
                </span>
              </div>
              <div className="weekdays">
                {WEEKDAYS.map((day) => <b key={day}>{day}</b>)}
              </div>
              <div className="daysGrid">
                {Array.from({ length: leading }, (_, index) => <span className="blankDay" key={`blank-${index}`} />)}
                {Array.from({ length: days }, (_, index) => {
                  const day = index + 1;
                  const date = monthDate(year, month, day);
                  const row = rowMap.get(date);
                  const selected = selectedDate === date;
                  return (
                    <button
                      type="button"
                      key={date}
                      disabled={!row || saving}
                      className={`dayCell ${!row ? "missing" : row.is_business_day ? "open" : "closed"} ${selected ? "selected" : ""}`}
                      onClick={() => selectDate(date)}
                      aria-label={`${date} ${!row ? "未登録" : row.is_business_day ? "営業日" : row.label || "休業日"}`}
                    >
                      <span>{day}</span>
                      {row && !row.is_business_day && <small>{row.label || "休業"}</small>}
                    </button>
                  );
                })}
              </div>

              {selectedDate.startsWith(monthPrefix) && selectedRow && (
                <div className="dayEditor">
                  <div className="editorHead">
                    <b>{selectedDate}</b>
                    <small>
                      {selectedRow.source === "annual_upload" ? "年間予定表取込" : selectedRow.source === "manual" ? "手動設定" : "システム"}
                    </small>
                  </div>
                  <div className="statusButtons">
                    <button
                      type="button"
                      className={editBusinessDay ? "active openChoice" : ""}
                      onClick={() => setEditBusinessDay(true)}
                    >
                      営業日
                    </button>
                    <button
                      type="button"
                      className={!editBusinessDay ? "active closedChoice" : ""}
                      onClick={() => setEditBusinessDay(false)}
                    >
                      休業日
                    </button>
                  </div>
                  <label>
                    ラベル
                    <input
                      value={editLabel}
                      onChange={(event) => setEditLabel(event.target.value)}
                      placeholder="例：夏季休業 / 年末年始 / 祝日"
                    />
                  </label>
                  {selectedRow.source_document_path && (
                    <small className="sourcePath">元資料：{selectedRow.source_document_path}</small>
                  )}
                  <button className="saveButton" disabled={saving} onClick={() => void saveSelectedDate()}>
                    {saving ? "保存中…" : "この日の変更を保存"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <details className="rangeTool">
        <summary>盆・正月・GWなどを期間でまとめて設定</summary>
        <div className="rangeBody">
          <p>登録済みの日だけを変更します。未登録日は新規作成しません。ラベルを空欄にすると既存ラベルを維持します。</p>
          <div className="rangeGrid">
            <label>開始日<input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label>
            <label>終了日<input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label>
          </div>
          <div className="statusButtons">
            <button type="button" className={rangeBusinessDay ? "active openChoice" : ""} onClick={() => setRangeBusinessDay(true)}>営業日</button>
            <button type="button" className={!rangeBusinessDay ? "active closedChoice" : ""} onClick={() => setRangeBusinessDay(false)}>休業日</button>
          </div>
          <label>共通ラベル（任意）<input value={rangeLabel} onChange={(event) => setRangeLabel(event.target.value)} placeholder="例：夏季休業" /></label>
          <button className="saveButton" disabled={saving} onClick={() => void applyRange()}>
            {saving ? "保存中…" : "確認して期間設定を保存"}
          </button>
        </div>
      </details>

      <section className="helpCard">
        <b>予定登録との連携</b>
        <p>予定登録は既存どおり business_calendar の is_business_day を参照します。この画面で保存した変更は同じテーブルへ直接反映されます。</p>
      </section>

      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        button,input{font:inherit}.calendarPage{max-width:1180px;margin:0 auto;padding:16px 14px 50px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.top button,.yearNav button,.dayCell,.statusButtons button,.saveButton{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:11px;padding:10px 12px;font-weight:800}.top button{min-height:42px}
        .importCard,.calendarHead,.monthCard,.rangeTool,.helpCard{background:#fff;border:1px solid #d9e0ea;border-radius:18px}.importCard{padding:14px;margin-bottom:10px}.importHead{display:flex;align-items:center;justify-content:space-between;gap:10px}.importHead>div{display:grid;gap:2px}.importHead span{font-size:11px;font-weight:900;color:#2674e8}.importHead h1{font-size:21px;line-height:1.2;margin:0}.importHead>b{font-size:11px;background:#fff4d8;color:#85620e;border-radius:999px;padding:5px 8px;white-space:nowrap}.importSteps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:9px}.importSteps span{font-size:11px;font-weight:800;background:#eef5ff;border-radius:9px;padding:7px;text-align:center}.importSteps span b{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;background:#2674e8;color:#fff;margin-right:3px}.importSteps .pendingStep{background:#f3f4f6;color:#727b89}.importSteps .pendingStep b{background:#8992a0}.importControls{display:grid;grid-template-columns:150px minmax(220px,1fr) auto;gap:7px;align-items:end;margin-top:9px}.importControls label{display:grid;gap:4px;font-size:12px;font-weight:800;color:#5c6878}.importControls input[type="number"]{width:100%;border:1px solid #cbd6e3;border-radius:10px;padding:9px;background:#fff}.filePicker input{width:100%;font-size:12px}.importControls>button{min-height:40px;border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:10px;padding:8px 10px;font-weight:800}.importFile{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding:8px 10px;background:#f8fbff;border:1px solid #d4e2f5;border-radius:10px}.importFile>div{display:grid;gap:2px;min-width:0}.importFile b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.importFile small{color:#6b7789}.importFile button{border:1px solid #ccd7e5;background:#fff;color:#2674e8;border-radius:9px;padding:7px 9px;font-weight:800;white-space:nowrap}.importNotice{margin-top:7px;padding:7px 9px;background:#fff8df;border:1px solid #ead88f;border-radius:9px;color:#715d1e;font-size:12px;line-height:1.45}.calendarHead{padding:16px;margin-bottom:12px}.titleRow{display:flex;justify-content:space-between;gap:12px;align-items:center}.titleRow>div:first-child{display:grid;gap:2px}.titleRow span{font-size:12px;font-weight:900;color:#2674e8}.titleRow h1{font-size:26px;line-height:1.2;margin:0}.yearNav{display:flex;gap:6px;flex-wrap:wrap}.yearNav button{padding:8px 10px;min-height:40px}.summary{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.summary b{font-size:12px;padding:5px 8px;border-radius:999px}.openCount{background:#edf7ef;color:#327149}.closedCount{background:#fff1ef;color:#a14639}.missingCount{background:#f0f2f5;color:#667085}.notice{margin-top:8px;padding:8px 10px;background:#f5f8fc;border-radius:10px;color:#53647b;font-size:13px}
        .monthsGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.monthCard{padding:11px;min-width:0}.monthHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}.monthHead h2{font-size:17px;margin:0}.monthHead span{font-size:11px;color:#8b4a40;background:#fff1ef;border-radius:999px;padding:4px 7px}.weekdays,.daysGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.weekdays{margin-bottom:3px}.weekdays b{text-align:center;font-size:10px;color:#748095;padding:3px 0}.dayCell{min-width:0;height:48px;padding:4px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:#243247;border-radius:8px}.dayCell span{font-size:13px;font-weight:900}.dayCell small{display:block;width:100%;font-size:8px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dayCell.open{background:#f7fbf8;border-color:#d6e8dc}.dayCell.closed{background:#fff1ef;border-color:#edb8b1;color:#983d32}.dayCell.missing{background:#f0f2f5;border-style:dashed;color:#98a2b3}.dayCell.selected{outline:3px solid #2674e8;outline-offset:1px}.dayCell:disabled{opacity:.65}.blankDay{height:48px}
        .dayEditor{margin-top:9px;padding:10px;background:#f8fbff;border:1px solid #cbdcf5;border-radius:12px;display:grid;gap:8px}.editorHead{display:flex;justify-content:space-between;gap:8px;align-items:center}.editorHead small,.sourcePath{color:#6b7789}.statusButtons{display:grid;grid-template-columns:1fr 1fr;gap:6px}.statusButtons button{min-height:42px;padding:8px}.statusButtons .active.openChoice{background:#edf7ef;border-color:#8bc5a0;color:#28663f}.statusButtons .active.closedChoice{background:#fff1ef;border-color:#e69e95;color:#93372e}.dayEditor label,.rangeBody label{display:grid;gap:4px;font-weight:700;color:#5c6878}.dayEditor input,.rangeBody input{width:100%;border:1px solid #cbd6e3;border-radius:10px;padding:10px;background:#fff;color:#172033}.saveButton{width:100%;min-height:44px;background:#2674e8;color:#fff;border-color:#2674e8}
        .rangeTool{margin-top:12px;padding:0;overflow:hidden}.rangeTool summary{cursor:pointer;padding:13px 15px;font-weight:900;color:#27364a}.rangeBody{border-top:1px solid #e3e8ef;padding:13px 15px;display:grid;gap:10px}.rangeBody p{margin:0;color:#687588;font-size:13px;line-height:1.5}.rangeGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.helpCard{margin-top:12px;padding:13px 15px}.helpCard p{margin:5px 0 0;color:#687588;font-size:13px;line-height:1.5}
        @media(max-width:900px){.monthsGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:620px){
          .calendarPage{padding:7px 7px 34px}.top{margin-bottom:5px}.top button{padding:7px 9px;min-height:40px}.importCard{padding:9px;margin-bottom:7px;border-radius:14px}.importHead h1{font-size:18px}.importHead>b{font-size:9px;padding:4px 6px}.importSteps{margin-top:6px;gap:3px}.importSteps span{font-size:9px;padding:5px 2px}.importSteps span b{width:16px;height:16px;font-size:9px}.importControls{grid-template-columns:1fr;gap:5px;margin-top:6px}.importControls input[type="number"]{padding:8px}.importControls>button{min-height:40px;padding:7px 9px}.importFile{margin-top:6px;padding:7px}.importNotice{margin-top:5px;padding:6px 8px;font-size:11px}.calendarHead{padding:9px;margin-bottom:7px;border-radius:14px}.titleRow{display:grid;gap:6px}.titleRow h1{font-size:19px}.titleRow span{font-size:10px}.yearNav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.yearNav button{min-width:0;padding:7px 3px;min-height:40px;font-size:11px}.summary{margin-top:6px;gap:4px}.summary b{font-size:10px;padding:4px 6px}.notice{margin-top:5px;padding:6px 8px;font-size:12px}.monthsGrid{grid-template-columns:1fr;gap:7px}.monthCard{padding:8px;border-radius:14px}.monthHead{margin-bottom:4px}.monthHead h2{font-size:16px}.weekdays,.daysGrid{gap:2px}.dayCell,.blankDay{height:45px}.dayCell{padding:3px 1px}.dayCell span{font-size:13px}.dayCell small{font-size:7.5px}.dayEditor{padding:8px;margin-top:6px;gap:6px}.rangeTool{margin-top:8px;border-radius:14px}.rangeTool summary{padding:11px 12px;font-size:13px}.rangeBody{padding:10px 12px}.rangeGrid{grid-template-columns:1fr}.helpCard{margin-top:8px;padding:10px 12px}.helpCard p{font-size:12px}
        }
      `}</style>
    </main>
  );
}
