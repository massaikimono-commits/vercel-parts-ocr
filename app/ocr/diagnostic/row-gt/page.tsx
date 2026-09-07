"use client";

import { PointerEvent, useMemo, useRef, useState } from "react";

type Band = {
  rowIndex: number;
  y1Norm: number;
  y2Norm: number;
  y1Px: number;
  y2Px: number;
};

type PhotoState = {
  canonicalName: string;
  sourceFile: File;
  url: string;
  width: number;
  height: number;
  rotationDeg: number;
  bands: Band[];
};

const FORMAL_IDS = Array.from({ length: 12 }, (_, i) => `IMG_${String(675 + i).padStart(4, "0")}(1)`);

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 880,
    margin: "0 auto",
    padding: "14px 12px 56px",
    color: "#172033",
    background: "#f5f7fb",
    minHeight: "100vh",
  },
  card: {
    background: "#fff",
    border: "1px solid #dbe2ec",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    boxShadow: "0 2px 8px rgba(20,35,60,.05)",
  },
  title: { margin: 0, fontSize: 24, fontWeight: 900 },
  sub: { margin: "8px 0 0", color: "#5b6678", fontSize: 14, lineHeight: 1.65 },
  primary: {
    width: "100%",
    border: 0,
    borderRadius: 13,
    padding: "14px 12px",
    fontSize: 17,
    fontWeight: 800,
    background: "#2468df",
    color: "#fff",
  },
  secondary: {
    flex: 1,
    minWidth: 110,
    border: "1px solid #ccd5e3",
    borderRadius: 12,
    padding: "12px 10px",
    fontSize: 15,
    fontWeight: 800,
    background: "#fff",
    color: "#234f9f",
  },
  danger: {
    flex: 1,
    minWidth: 110,
    border: "1px solid #efc5c5",
    borderRadius: 12,
    padding: "12px 10px",
    fontSize: 15,
    fontWeight: 800,
    background: "#fff7f7",
    color: "#a72a2a",
  },
  nav: {
    border: 0,
    borderRadius: 11,
    padding: "11px 14px",
    background: "#eef3fb",
    color: "#1f4f9b",
    fontWeight: 800,
    fontSize: 15,
  },
};

function canonicalFromName(name: string) {
  const m = name.match(/IMG_(067[5-9]|068[0-6])/i);
  if (!m) return "";
  return `IMG_${m[1]}(1)`;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function loadFileImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} を開けませんでした`));
    };
    img.src = url;
  });
}

async function rotatedPreview(file: File, rotationDeg: number) {
  if (rotationDeg % 360 === 0) {
    const img = await loadFileImage(file);
    return {
      url: URL.createObjectURL(file),
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  }

  const img = await loadFileImage(file);
  const normalized = ((rotationDeg % 360) + 360) % 360;
  const swap = normalized === 90 || normalized === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? img.naturalHeight : img.naturalWidth;
  canvas.height = swap ? img.naturalWidth : img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像回転に失敗しました。");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((normalized * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("画像回転に失敗しました。")), "image/jpeg", 0.96),
  );
  return { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

function bandFromNorm(y1: number, y2: number, h: number, rowIndex: number): Band {
  const a = clamp01(Math.min(y1, y2));
  const b = clamp01(Math.max(y1, y2));
  return {
    rowIndex,
    y1Norm: +a.toFixed(6),
    y2Norm: +b.toFixed(6),
    y1Px: Math.round(a * h),
    y2Px: Math.round(b * h),
  };
}

export default function PartsOcrRowGtPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const imageBoxRef = useRef<HTMLDivElement>(null);

  const [photos, setPhotos] = useState<PhotoState[]>([]);
  const [current, setCurrent] = useState(0);
  const [startY, setStartY] = useState<number | null>(null);
  const [draftY, setDraftY] = useState<number | null>(null);
  const [copyState, setCopyState] = useState("");
  const [selectionNote, setSelectionNote] = useState("");

  const photo = photos[current] || null;
  const annotatedCount = photos.filter((p) => p.bands.length > 0).length;
  const selectedFormalCount = useMemo(
    () => new Set(photos.map((p) => p.canonicalName)).size,
    [photos],
  );

  function rebuildIndices(bands: Band[], height: number) {
    return [...bands]
      .sort((a, b) => a.y1Norm - b.y1Norm)
      .map((b, i) => bandFromNorm(b.y1Norm, b.y2Norm, height, i + 1));
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;

    photos.forEach((p) => URL.revokeObjectURL(p.url));

    const list = Array.from(files);
    const loaded: PhotoState[] = [];
    const ignored: string[] = [];
    const duplicates: string[] = [];
    const seen = new Set<string>();

    for (const file of list) {
      const canonicalName = canonicalFromName(file.name);
      if (!canonicalName) {
        ignored.push(file.name);
        continue;
      }
      if (seen.has(canonicalName)) {
        duplicates.push(canonicalName);
        continue;
      }
      seen.add(canonicalName);

      const url = URL.createObjectURL(file);
      const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error(`${file.name} を開けませんでした`));
        img.src = url;
      });

      loaded.push({
        canonicalName,
        sourceFile: file,
        url,
        width: dims.width,
        height: dims.height,
        rotationDeg: 0,
        bands: [],
      });
    }

    loaded.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
    setPhotos(loaded);
    setCurrent(0);
    setStartY(null);
    setDraftY(null);
    setCopyState("");

    const notes = [
      `${loaded.length}/12枚を正式セットとして読み込みました。`,
      ignored.length ? `対象外: ${ignored.length}枚` : "",
      duplicates.length ? `重複: ${duplicates.join(", ")}` : "",
    ].filter(Boolean);
    setSelectionNote(notes.join(" "));
  }

  async function rotateCurrent(delta: number) {
    if (!photo) return;
    const nextRotation = ((photo.rotationDeg + delta) % 360 + 360) % 360;
    const rendered = await rotatedPreview(photo.sourceFile, nextRotation);
    const oldUrl = photo.url;
    setPhotos((old) =>
      old.map((p, i) =>
        i === current
          ? {
              ...p,
              url: rendered.url,
              width: rendered.width,
              height: rendered.height,
              rotationDeg: nextRotation,
              bands: [],
            }
          : p,
      ),
    );
    URL.revokeObjectURL(oldUrl);
    setStartY(null);
    setDraftY(null);
    setCopyState("");
  }

  function pointerNormY(ev: PointerEvent<HTMLDivElement>) {
    const box = imageBoxRef.current?.getBoundingClientRect();
    if (!box?.height) return null;
    return clamp01((ev.clientY - box.top) / box.height);
  }

  function onPointerDown(ev: PointerEvent<HTMLDivElement>) {
    if (!photo) return;
    const y = pointerNormY(ev);
    if (y == null) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setStartY(y);
    setDraftY(y);
  }

  function onPointerMove(ev: PointerEvent<HTMLDivElement>) {
    if (startY == null) return;
    const y = pointerNormY(ev);
    if (y != null) setDraftY(y);
  }

  function onPointerUp(ev: PointerEvent<HTMLDivElement>) {
    if (!photo || startY == null) return;
    const y = pointerNormY(ev);
    const end = y == null ? draftY ?? startY : y;
    const minHeight = 8 / Math.max(1, photo.height);
    if (Math.abs(end - startY) >= minHeight) {
      setPhotos((old) =>
        old.map((p, i) => {
          if (i !== current) return p;
          const next = [
            ...p.bands,
            bandFromNorm(startY, end, p.height, p.bands.length + 1),
          ];
          return { ...p, bands: rebuildIndices(next, p.height) };
        }),
      );
    }
    setStartY(null);
    setDraftY(null);
  }

  function deleteBand(index: number) {
    if (!photo) return;
    setPhotos((old) =>
      old.map((p, i) =>
        i === current
          ? { ...p, bands: rebuildIndices(p.bands.filter((_, j) => j !== index), p.height) }
          : p,
      ),
    );
  }

  function undo() {
    if (!photo?.bands.length) return;
    deleteBand(photo.bands.length - 1);
  }

  function clearCurrent() {
    setPhotos((old) => old.map((p, i) => (i === current ? { ...p, bands: [] } : p)));
  }

  const draftBand =
    photo && startY != null && draftY != null
      ? bandFromNorm(startY, draftY, photo.height, 0)
      : null;

  function buildGtJson() {
    const ordered = FORMAL_IDS.map((formalId) => photos.find((p) => p.canonicalName === formalId))
      .filter(Boolean) as PhotoState[];

    return {
      schema: "icb.parts-ocr.row-gt.v1",
      variant: "yellow-delivery",
      evaluationSet: "formal-yellow-12",
      images: ordered.map((p) => ({
        fileName: p.canonicalName,
        imageWidth: p.width,
        imageHeight: p.height,
        rotationDeg: p.rotationDeg,
        rowCount: p.bands.length,
        rows: p.bands.map((b, index) => ({
          rowIndex: index + 1,
          y1Norm: b.y1Norm,
          y2Norm: b.y2Norm,
          y1Px: b.y1Px,
          y2Px: b.y2Px,
        })),
      })),
    };
  }

  async function copyJson() {
    const payload = JSON.stringify(buildGtJson(), null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyState("コピーしました。総合管理チャットへそのまま貼り付けてください。");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setCopyState("コピーしました。総合管理チャットへそのまま貼り付けてください。");
    }
  }

  const readyToCopy =
    selectedFormalCount === 12 &&
    FORMAL_IDS.every((id) => photos.find((p) => p.canonicalName === id)?.bands.length);

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>黄色伝票 Row GT 作成</h1>
        <p style={styles.sub}>
          Stage A評価専用です。元写真だけを見て、実際の部品明細1行ごとに縦方向のbandを指で指定してください。
          OCR・fixed candidate・dynamic candidateは表示しません。画像はこのブラウザ内だけで扱い、アップロード・保存は行いません。
        </p>
      </section>

      <section style={styles.card}>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => onFiles(e.target.files)}
        />
        <button style={styles.primary} onClick={() => fileInputRef.current?.click()}>
          黄色正式12枚を選択
        </button>
        <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6 }}>
          <strong>選択：</strong>{selectedFormalCount}/12枚　
          <strong>GT入力済み：</strong>{annotatedCount}/12枚
        </div>
        {selectionNote && <div style={{ marginTop: 6, color: "#5b6678", fontSize: 13 }}>{selectionNote}</div>}
      </section>

      {photo && (
        <>
          <section style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <button
                style={styles.nav}
                disabled={current === 0}
                onClick={() => {
                  setCurrent((v) => Math.max(0, v - 1));
                  setStartY(null);
                  setDraftY(null);
                }}
              >
                ← 前
              </button>
              <div style={{ textAlign: "center", minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{photo.canonicalName}</div>
                <div style={{ color: "#687386", fontSize: 12 }}>{current + 1}/{photos.length} ・ GT {photo.bands.length}行</div>
              </div>
              <button
                style={styles.nav}
                disabled={current >= photos.length - 1}
                onClick={() => {
                  setCurrent((v) => Math.min(photos.length - 1, v + 1));
                  setStartY(null);
                  setDraftY(null);
                }}
              >
                次 →
              </button>
            </div>

            <div
              ref={imageBoxRef}
              style={{
                position: "relative",
                width: "100%",
                lineHeight: 0,
                borderRadius: 12,
                overflow: "hidden",
                background: "#1b2430",
                touchAction: "none",
                userSelect: "none",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                setStartY(null);
                setDraftY(null);
              }}
            >
              <img
                ref={imgRef}
                src={photo.url}
                alt={photo.canonicalName}
                draggable={false}
                style={{ width: "100%", height: "auto", display: "block", pointerEvents: "none" }}
              />
              {photo.bands.map((b) => (
                <div
                  key={b.rowIndex}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${b.y1Norm * 100}%`,
                    height: `${(b.y2Norm - b.y1Norm) * 100}%`,
                    background: "rgba(255,45,45,.18)",
                    borderTop: "2px solid rgba(255,45,45,.95)",
                    borderBottom: "2px solid rgba(255,45,45,.95)",
                    pointerEvents: "none",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: 5,
                      top: 4,
                      lineHeight: 1,
                      background: "rgba(255,255,255,.92)",
                      borderRadius: 999,
                      padding: "4px 7px",
                      color: "#b01818",
                      fontWeight: 900,
                      fontSize: 12,
                    }}
                  >
                    {b.rowIndex}
                  </span>
                </div>
              ))}
              {draftBand && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${draftBand.y1Norm * 100}%`,
                    height: `${Math.max(0.002, draftBand.y2Norm - draftBand.y1Norm) * 100}%`,
                    background: "rgba(36,104,223,.18)",
                    borderTop: "2px dashed #2468df",
                    borderBottom: "2px dashed #2468df",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>

            <p style={{ ...styles.sub, marginTop: 10 }}>
              指を行の上端から下端まで縦にドラッグしてください。bandは画像全幅に表示されますが、Stage A採点ではY位置だけを使用します。
              伝票が横向きなら、先に回転ボタンで明細行が横方向になる向きへ直してください。回転するとその写真のbandはリセットされます。
            </p>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={styles.secondary} onClick={() => rotateCurrent(-90)}>
                ↶ 左90°
              </button>
              <button style={styles.secondary} onClick={() => rotateCurrent(90)}>
                右90° ↷
              </button>
            </div>
            <div style={{ color: "#687386", fontSize: 12, marginTop: 6, textAlign: "center" }}>
              表示回転: {photo.rotationDeg}°
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={styles.secondary} onClick={undo} disabled={!photo.bands.length}>
                1つ戻す
              </button>
              <button style={styles.danger} onClick={clearCurrent} disabled={!photo.bands.length}>
                この写真をやり直す
              </button>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>この写真のGT：{photo.bands.length}行</h2>
            {photo.bands.length === 0 ? (
              <div style={{ color: "#687386", fontSize: 14 }}>まだbandがありません。</div>
            ) : (
              <div style={{ display: "grid", gap: 7 }}>
                {photo.bands.map((b, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      border: "1px solid #e1e6ee",
                      borderRadius: 10,
                      padding: "8px 10px",
                    }}
                  >
                    <span style={{ fontWeight: 800 }}>行 {i + 1}</span>
                    <span style={{ color: "#687386", fontSize: 12 }}>
                      {b.y1Norm.toFixed(4)} – {b.y2Norm.toFixed(4)}
                    </span>
                    <button
                      onClick={() => deleteBand(i)}
                      style={{
                        border: "1px solid #efc5c5",
                        background: "#fff",
                        color: "#a72a2a",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontWeight: 800,
                      }}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section style={styles.card}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>12枚の進捗</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
          {FORMAL_IDS.map((id) => {
            const p = photos.find((x) => x.canonicalName === id);
            return (
              <div
                key={id}
                style={{
                  border: "1px solid #e0e6ef",
                  borderRadius: 9,
                  padding: "7px 8px",
                  fontSize: 12,
                  background: p?.bands.length ? "#f0f8f1" : "#fafbfc",
                }}
              >
                <strong>{id}</strong><br />
                {p ? `${p.bands.length}行` : "未選択"}
              </div>
            );
          })}
        </div>
      </section>

      <section style={styles.card}>
        <button
          style={{ ...styles.primary, opacity: readyToCopy ? 1 : 0.55 }}
          disabled={!readyToCopy}
          onClick={copyJson}
        >
          総合管理用GT JSONをコピー
        </button>
        {!readyToCopy && (
          <p style={styles.sub}>12枚すべてを選択し、各画像に1本以上のrow-bandを指定するとコピーできます。</p>
        )}
        {copyState && <div style={{ marginTop: 10, fontWeight: 800, color: "#1d6b32" }}>{copyState}</div>}
      </section>
    </main>
  );
}
