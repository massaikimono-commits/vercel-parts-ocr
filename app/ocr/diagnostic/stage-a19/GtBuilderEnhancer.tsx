"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EXPECTED_FILES } from "../stage-a4/gt";

type GtRow = { name: string; qty: string; retail: string; cost: string };
type GtMap = Record<string, GtRow[]>;
type PreviewMap = Record<string, { url: string; originalName: string }>;

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

function canonicalFromSelectedName(name: string) {
  const match = name.match(/IMG_(067[5-9]|068[0-6])/i);
  if (!match) return "";
  const stem = `IMG_${match[1]}`;
  return EXPECTED_FILES.find((file) => file.startsWith(stem)) || "";
}

function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function evaluationInput() {
  return document.querySelector('main input[type="file"][multiple]') as HTMLInputElement | null;
}

export default function GtBuilderEnhancer() {
  const [gt, setGt] = useState<GtMap>(() => blankMap());
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("未保存");
  const [previews, setPreviews] = useState<PreviewMap>({});
  const [selectionState, setSelectionState] = useState("正式12枚を選択すると、各GT欄に対応写真が表示されます。");
  const previewUrls = useRef<string[]>([]);

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

  useEffect(() => {
    const captureSelection = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type !== "file" || !target.multiple || !target.closest("main")) return;
      if (target.dataset.a19AllowRun === "1") return;

      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(target.files || []);
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current = [];

      const next: PreviewMap = {};
      const duplicates: string[] = [];
      const unknown: string[] = [];
      for (const file of files) {
        const canonical = canonicalFromSelectedName(file.name);
        if (!canonical) {
          unknown.push(file.name);
          continue;
        }
        if (next[canonical]) {
          duplicates.push(file.name);
          continue;
        }
        const url = URL.createObjectURL(file);
        previewUrls.current.push(url);
        next[canonical] = { url, originalName: file.name };
      }
      setPreviews(next);
      const missing = EXPECTED_FILES.filter((file) => !next[file]);
      const notes = [
        `対応確認: ${Object.keys(next).length} / ${EXPECTED_FILES.length}枚`,
        missing.length ? `不足: ${missing.join(", ")}` : "12枚すべて対応済み",
        duplicates.length ? `重複候補: ${duplicates.join(", ")}` : "",
        unknown.length ? `対象外ファイル: ${unknown.join(", ")}` : "",
      ].filter(Boolean);
      setSelectionState(notes.join(" / "));
    };

    document.addEventListener("change", captureSelection, true);
    return () => {
      document.removeEventListener("change", captureSelection, true);
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current = [];
    };
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
      section?.querySelectorAll("button").forEach((button) => {
        if (button.textContent?.includes("黄色正式12枚を選択")) (button as HTMLButtonElement).style.display = "none";
      });
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

  function chooseImages() {
    const input = evaluationInput();
    if (!input) {
      setSelectionState("評価用ファイル選択欄を取得できませんでした。ページを再読み込みしてください。");
      return;
    }
    input.click();
  }

  function startEvaluation() {
    const input = evaluationInput();
    if (!input?.files?.length) {
      setSelectionState("先に正式12枚を選択してください。");
      return;
    }
    const missing = EXPECTED_FILES.filter((file) => !previews[file]);
    if (missing.length) {
      setSelectionState(`正式12枚の対応が未完了です。不足: ${missing.join(", ")}`);
      return;
    }
    input.dataset.a19AllowRun = "1";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => delete input.dataset.a19AllowRun, 0);
  }

  const completed = EXPECTED_FILES.filter((file) =>
    (gt[file] || []).some((row) => row.name.trim() || row.qty.trim() || row.retail.trim() || row.cost.trim()),
  ).length;
  const selectedCount = EXPECTED_FILES.filter((file) => previews[file]).length;

  return (
    <section style={{ maxWidth: 1040, margin: "16px auto 0", padding: "0 12px" }}>
      <div style={{ background: "#fff", border: "1px solid #dbe2ec", borderRadius: 16, padding: 14 }}>
        <h2 style={{ marginTop: 0 }}>Stage A19 4項目Ground Truth入力</h2>
        <p style={{ lineHeight: 1.65, marginBottom: 8 }}>
          最初に正式12枚を一括選択してください。各入力欄に対応写真とファイル名を表示します。実際の伝票印字だけを見てGTを入力し、OCR結果は見ないでください。
        </p>
        <button
          type="button"
          onClick={chooseImages}
          style={{ width: "100%", border: 0, borderRadius: 12, padding: "12px", background: "#174ea6", color: "#fff", fontWeight: 800, fontSize: 16 }}
        >
          正式12枚を一括選択して写真対応を確認
        </button>
        <div style={{ fontSize: 13, margin: "10px 0 12px", lineHeight: 1.5 }}>
          写真対応: {selectedCount} / {EXPECTED_FILES.length}　・　入力済み伝票: {completed} / {EXPECTED_FILES.length}　・　{saveState}<br />
          {selectionState}
        </div>
        {EXPECTED_FILES.map((file) => {
          const preview = previews[file];
          return (
            <details key={file} open={file === EXPECTED_FILES[0]} style={{ borderTop: "1px solid #e5e9f0", padding: "10px 0" }}>
              <summary style={{ fontWeight: 800, cursor: "pointer" }}>{file}</summary>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr", gap: 12, alignItems: "start", marginTop: 10 }}>
                <div>
                  {preview ? (
                    <>
                      <img src={preview.url} alt={`${file} 対応画像`} style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "contain", border: "1px solid #ccd5e3", borderRadius: 10, background: "#f8fafc" }} />
                      <div style={{ marginTop: 5, fontSize: 12, overflowWrap: "anywhere" }}>
                        対応ファイル: <strong>{preview.originalName}</strong>
                      </div>
                    </>
                  ) : (
                    <div style={{ border: "1px dashed #c6ceda", borderRadius: 10, minHeight: 120, display: "grid", placeItems: "center", padding: 10, color: "#667085", textAlign: "center" }}>
                      {file}<br />対応画像未選択
                    </div>
                  )}
                </div>
                <div style={{ overflowX: "auto" }}>
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
                  <button
                    type="button"
                    onClick={() => addRow(file)}
                    style={{ marginTop: 8, border: 0, borderRadius: 9, background: "#eef4ff", color: "#245eb7", fontWeight: 800, padding: "9px 12px" }}
                  >
                    ＋ 行追加
                  </button>
                </div>
              </div>
            </details>
          );
        })}
        <button
          type="button"
          onClick={startEvaluation}
          disabled={selectedCount !== EXPECTED_FILES.length || completed !== EXPECTED_FILES.length}
          style={{ width: "100%", border: 0, borderRadius: 13, padding: "14px 12px", marginTop: 14, background: selectedCount === EXPECTED_FILES.length && completed === EXPECTED_FILES.length ? "#2468df" : "#aeb8c7", color: "#fff", fontWeight: 800, fontSize: 17 }}
        >
          この12枚とGTで CONTROL / A19_ROW / A19_TABLE を1run
        </button>
        <div style={{ marginTop: 7, fontSize: 12, color: "#667085" }}>
          評価開始は12枚すべての写真対応とGT入力が揃った時だけ有効になります。画像はファイル名からIMG_0675〜IMG_0686へ自動対応し、並び順に依存しません。
        </div>
      </div>
    </section>
  );
}
