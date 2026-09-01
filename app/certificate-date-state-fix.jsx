"use client";

import { useEffect } from "react";

const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function normDateText(v = "") {
  return compact(v)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");
}

function parseJpDate(raw = "") {
  const t = normDateText(raw);
  const era = t.match(/令和|平成|昭和/)?.[0] || "";
  if (!era) return "";
  const tail = t.slice(Math.max(0, t.indexOf(era) + era.length));
  const nums = (tail.match(/\d{1,2}/g) || []).map(Number);
  for (let i = 0; i + 2 < nums.length; i += 1) {
    const y = nums[i], m = nums[i + 1], d = nums[i + 2];
    if (y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${era}${y}年${m}月${d}日`;
    }
  }
  return "";
}

function section(title) {
  return Array.from(document.querySelectorAll("section.card")).find((s) =>
    s.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function realDetailInput(labelText) {
  const s = section("車検証読み取り情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const title = compact(label.querySelector("span")?.textContent || "");
    if (title === compact(labelText)) return label.querySelector("input");
  }
  return null;
}

function basicInput(labelText) {
  const s = section("基本情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const title = compact(label.childNodes?.[0]?.textContent || label.textContent || "");
    if (title.startsWith(compact(labelText))) return label.querySelector("input");
  }
  return null;
}

function reactProps(el) {
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? el[key] : null;
}

function applyReact(el, value) {
  if (!(el instanceof HTMLInputElement) || !value) return false;
  if (el.value === value) return true;
  const props = reactProps(el);
  if (typeof props?.onChange === "function") {
    props.onChange({
      target: { value },
      currentTarget: { value },
      preventDefault() {},
      stopPropagation() {},
    });
    return true;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const old = el.value;
  if (setter) setter.call(el, value); else el.value = value;
  if (el._valueTracker) el._valueTracker.setValue(old);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function canvasFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const n = new Image();
      n.onload = () => resolve(n);
      n.onerror = () => reject(new Error("日付補正用画像を開けませんでした"));
      n.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 5200 / Math.max(iw, ih));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff";
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(5, Math.floor(Math.max(w, h) / 700));
  const ok = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 108 && Math.max(r, g, b) - Math.min(r, g, b) < 105;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 3);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (ok(x, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 3);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(source, paper, box, binary = false, targetWidth = 2500) {
  const [x0, x1, y0, y1] = box;
  const sx = Math.round(paper.x + paper.w * x0);
  const sy = Math.round(paper.y + paper.h * y0);
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(12, targetWidth / sw));
  const pad = 36;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(source, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  if (binary) {
    const im = x.getImageData(0, 0, c.width, c.height);
    let sum = 0, n = 0;
    for (let p = 0; p < im.data.length; p += 4) {
      const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08);
      sum += g; n += 1;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
    }
    const th = Math.max(105, Math.min(220, sum / Math.max(1, n) - 18));
    for (let p = 0; p < im.data.length; p += 4) {
      const v = im.data[p] < th ? 0 : 255;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      im.data[p + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

async function readRegistrationDate(file) {
  const source = await canvasFromFile(file);
  const paper = detectPaper(source);
  const t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract/core", langPath: "/tesseract/lang" });
  const boxes = [
    [0.155, 0.405, 0.214, 0.246],
    [0.175, 0.395, 0.218, 0.244],
    [0.135, 0.425, 0.208, 0.252],
  ];
  const raws = [];
  try {
    for (const b of boxes) {
      for (const binary of [false, true]) {
        const c = crop(source, paper, b, binary, 2600);
        for (const psm of ["7", "6"]) {
          await worker.setParameters({
            tessedit_pageseg_mode: psm,
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          });
          const raw = compact((await worker.recognize(c)).data.text || "");
          if (raw) raws.push(raw);
          const parsed = parseJpDate(raw);
          if (parsed) return { value: parsed, raws };
        }
      }
    }
    return { value: "", raws };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

function showDebug(registrationDate, raws, state) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-date-state-fix-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-date-state-fix-debug";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">日付最終確定（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const first = window.__vehicleCertificateQrPriority?.firstRegistration || "";
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = `登録年月日: ${registrationDate || "未取得"}\n初度登録(QR): ${first || "待機中"}\n状態: ${state}\n\n登録年月日OCR:\n${(raws || []).join("\n---\n") || "(空)"}`;
}

export default function CertificateDateStateFix() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let scanId = 0;

    const applyFinal = async (registrationDate, raws, id) => {
      let stable = 0;
      for (let i = 0; i < 30 && !dead && id === scanId; i += 1) {
        if (document.querySelector(".progress")) {
          showDebug(registrationDate, raws, "OCR完了待ち");
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }

        const qrFirst = window.__vehicleCertificateQrPriority?.firstRegistration || "";
        const regEl = realDetailInput("登録年月日／交付年月日");
        const firstEl = realDetailInput("初度登録年月");
        const basicFirst = basicInput("初度登録（和暦）");

        // 1項目ずつ入れてReactの再描画を待つ。update()が古いstateを使って互いに消すのを防ぐ。
        if (registrationDate && regEl?.value !== registrationDate) {
          applyReact(regEl, registrationDate);
          showDebug(registrationDate, raws, "登録年月日をstateへ反映");
          await new Promise((r) => setTimeout(r, 420));
          continue;
        }
        if (qrFirst && firstEl?.value !== qrFirst) {
          applyReact(firstEl, qrFirst);
          showDebug(registrationDate, raws, "初度登録をstateへ反映");
          await new Promise((r) => setTimeout(r, 420));
          continue;
        }
        if (qrFirst && basicFirst?.value !== qrFirst) {
          // 詳細欄のupdateで本来同時に変わる。残った場合だけ基本欄も確定する。
          applyReact(basicFirst, qrFirst);
          showDebug(registrationDate, raws, "基本情報の初度登録を確定");
          await new Promise((r) => setTimeout(r, 420));
          continue;
        }

        if (registrationDate && qrFirst && regEl?.value === registrationDate && firstEl?.value === qrFirst && basicFirst?.value === qrFirst) {
          stable += 1;
          showDebug(registrationDate, raws, stable >= 3 ? "反映完了" : "反映確認中");
          if (stable >= 3) return;
        } else {
          stable = 0;
          showDebug(registrationDate, raws, qrFirst ? "入力欄待ち" : "QR初度登録待ち");
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      showDebug(registrationDate, raws, "確認終了");
    };

    const onChange = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++scanId;
      void readRegistrationDate(file)
        .then(({ value, raws }) => applyFinal(value, raws, id))
        .catch((error) => showDebug("", [String(error?.message || error)], "日付OCRエラー"));
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      scanId += 1;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
