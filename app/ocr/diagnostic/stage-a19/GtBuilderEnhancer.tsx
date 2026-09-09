"use client";

import { useEffect, useMemo, useState } from "react";
import { EXPECTED_FILES } from "../stage-a4/gt";

type GtRow = { name: string; qty: string; retail: string; cost: string };
type GtMap = Record<string, GtRow[]>;

const STORAGE_KEY = "icb.parts-ocr.stage-a19.four-field-gt.v1";
const EMPTY_ROW: GtRow = { name: "", qty: "", retail: "", cost: "" };

function blankMap(): GtMap {
  return Object.fromEntries(EXPECTED_FILES.map((file) => [file, [{ ...EMPTY_ROW }]]));
}

function normalizeStored(value: unknown): GtMap {
  const base = blankMap();
  if (!value || typeof value !== "object") return base;
  for (const file of EXPECTED_FILES) {
    const rows = (value as Record<string, unknown>)[file];
    if (!Array.isArray(rows) || !rows.length) continue;
    base[file] = rows.map((row) => {
      const v = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        name: String(v.name ?? ""),
        qty: String(v.qty ?? ""),
        retail: String(v.retail ?? ""),
        cost: String(v.cost ?? ""),
      };
    });
  }
  return base;
}

function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function GtBuilderEnhancer() {
  const [gt, setGt] = useState<GtMap>(() => blankMap());
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("未保存");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setGt(normalizeStored(JSON.parse(raw)));
    } catch {
      setSaveState("保存済みGTの読込に失敗");
    } finally {
      setLoaded(true);
    }
  }, []);

  const scoringJson = useMemo(() => {
    const out: GtMap = {};
    for (const file of EXPECTED_FILES) {
      out[file] = (gt[file] || []).map((row) => ({
        name: row.name.trim(),
        qty: row.qty.trim(),
        retail: row.retail.trim(),
        cost: row.cost.trim(),
      }));
    }
    return JSON.stringify(out);
  }, [gt]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gt));
      setSaveState("ブラウザに自動保存済み");
    } catch {
      setSaveState("ブラウザ保存に失敗");
    }

    const sync = () => {
      const textarea = document.querySelector("main textarea") as HTMLTextAreaElement | null;
      if (!textarea) return false;
      setReactTextareaValue(textarea, scoringJson);
      textarea.readOnly = true;
      textarea.style.display = "none";
      const section = textarea.closest("section");
      const heading = section?.querySelector("h2");
      if (heading) heading.textContent = "正式12枚評価";
      const paragraph = section?.querySelector("p");
      if (paragraph) paragraph.textContent = "4項目GTは上の表から内部生成済みです。JSONの手入力は不要です。";
      return true;
    };

    if (!sync()) {
      const timer = window.setInterval(() => {
        if (sync()) window.clearInterval(timer);
      }, 100);
      return () => window.clearInterval(timer);
    }
  }, [loaded, scoringJson, gt]);

  function update(file: string, index: number, key: keyof GtRow, value: string) {
    setGt((current) => ({
      ...current,
      [file]: current[file].map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  }

  function addRow(file: string) {
    setGt((current) => ({ ...current, [file]: [...current[file], { ...EMPTY_ROW }] }));
  }

  function removeRow(file: string, index: number) {
    setGt((current) => {
      const rows = current[file].filter((_, i) => i !== index);
      return { ...current, [file]: rows.length ? rows : [{ ...EMPTY_ROW }] };
    });
  }

  const completed = EXPECTED_FILES.filter((file) =>
    (gt[file] || []).some((row) => row.name.trim() || row.qty.trim() || row.retail.trim() || row.cost.trim()),
  ).length;

  return (
    <section style={{ maxWidth: 1040, margin: "16px auto 0", padding: "0 12px" }}>
      <div style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14 }}>
        <h2 style={{ marginTop: 0 }}>Stage A19 4項目Ground Truth入力</h2>
        <p style={{ lineHeight: 1.65, marginBottom: 8 }}>
          実際の伝票印字だけを見て入力してください。OCR結果は見ないでください。入力内容はこのブラウザに自動保存され、採点用JSONは内部で自動生成されます。
        </p>
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          入力済み伝票: {completed} / {EXPECTED_FILES.length}　・　{saveState}
        </div>
        {EXPECTED_FILES.map((file) => (
          <details key={file} open={file === EXPECTED_FILES[0]} style={{ borderTop: "1px solid #e5e9f0", padding: "10px 0" }}>
            <summary style={{ fontWeight: 800, cursor: "pointer" }}>{file}</summary>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 6 }}>#</th>
                    <th style={{ textAlign: "left", padding: 6 }}>部品名称</th>
                    <th style={{ textAlign: "left", padding: 6 }}>個数</th>
                    <th style={{ textAlign: "left", padding: 6 }}>定価</th>
                    <th style={{ textAlign: "left", padding: 6 }}>仕入れ</th>
                    <th style={{ padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {(gt[file] || []).map((row, index) => (
                    <tr key={`${file}-${index}`}>
                      <td style={{ padding: 4 }}>{index + 1}</td>
                      {(["name", "qty", "retail", "cost"] as const).map((key) => (
                        <td key={key} style={{ padding: 4 }}>
                          <input
                            value={row[key]}
                            onChange={(e) => update(file, index, key, e.target.value)}
                            inputMode={key === "name" ? "text" : "numeric"}
                            aria-label={`${file} row ${index + 1} ${key}`}
                            style={{ width: "100%", boxSizing: "border-box", padding: "9px 8px", border: "1px solid #ccd5e3", borderRadius: 8 }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: 4 }}>
                        <button
                          type="button"
                          onClick={() => removeRow(file, index)}
                          style={{ border: "1px solid #c9d2df", borderRadius: 8, background: "#fff", padding: "8px 10px" }}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => addRow(file)}
              style={{ marginTop: 8, border: 0, borderRadius: 9, background: "#eef4ff", color: "#245eb7", fontWeight: 800, padding: "9px 12px" }}
            >
              ＋ 行追加
            </button>
          </details>
        ))}
      </div>
    </section>
  );
}
