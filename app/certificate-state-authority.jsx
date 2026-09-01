"use client";

import { useEffect } from "react";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

const BODY_TYPES = [
  "キャブオーバ", "ステーションワゴン", "ピックアップ", "ボンネット",
  "バン", "箱型", "セダン", "トラック", "ダンプ", "幌型", "バス"
];

function parseBody(raw = "") {
  let t = compact(raw).replace(/\s+/g, "");
  t = t
    .replace(/パン/g, "バン")
    .replace(/ハン/g, "バン")
    .replace(/バソ/g, "バン")
    .replace(/パソ/g, "バン")
    .replace(/ヴァン/g, "バン");
  return BODY_TYPES.find((name) => t.includes(name)) || "";
}

function normalizeDate(raw = "") {
  return compact(raw)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il!]/g, "1");
}

function parseJpDate(raw = "") {
  const t = normalizeDate(raw);
  const eraMatch = t.match(/令和|平成|昭和/);
  if (!eraMatch) return "";
  const era = eraMatch[0];
  const tail = t.slice(t.indexOf(era) + era.length);

  // 車検証の細字OCRでは「20日」の0が | / ｜ に見えることがある。
  // 2| を先に20へ補正し、その後に通常候補を試す。
  const variants = [];
  if (/2\s*[|｜]/.test(tail)) variants.push(tail.replace(/2\s*[|｜]/g, "20"));
  variants.push(tail.replace(/[|｜]/g, "1"));
  variants.push(tail);

  for (const v of variants) {
    const nums = (v.match(/\d{1,2}/g) || []).map(Number);
    for (let i = 0; i + 2 < nums.length; i += 1) {
      const y = nums[i], m = nums[i + 1], d = nums[i + 2];
      if (y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${era}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

async function canvasFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const n = new Image();
      n.onload = () => resolve(n);
      n.onerror = () => reject(new Error("画像を開けませんでした"));
      n.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 5600 / Math.max(iw, ih));
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
    return br > 105 && Math.max(r, g, b) - Math.min(r, g, b) < 110;
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

function crop(source, paper, box, binary = false, targetWidth = 2600) {
  const [x0, y0, x1, y1] = box;
  const sx = Math.round(paper.x + paper.w * x0);
  const sy = Math.round(paper.y + paper.h * y0);
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(12, targetWidth / sw));
  const pad = 42;
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
    const th = Math.max(100, Math.min(220, sum / Math.max(1, n) - 15));
    for (let p = 0; p < im.data.length; p += 4) {
      const v = im.data[p] < th ? 0 : 255;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      im.data[p + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

function mode(items) {
  const counts = new Map();
  for (const v of items.filter(Boolean)) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

async function targetedRead(file) {
  const source = await canvasFromFile(file);
  const paper = detectPaper(source);
  const t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract/core", langPath: "/tesseract/lang" });
  const dateCandidates = [], bodyCandidates = [], dateRaws = [], bodyRaws = [];

  // 本体OCRと同じ用紙比率を基準に、対象セルだけを狭く再読込。
  const dateBoxes = [
    [0.155, 0.232, 0.425, 0.282],
    [0.170, 0.238, 0.410, 0.276],
    [0.135, 0.225, 0.445, 0.288],
  ];
  const bodyBoxes = [
    [0.105, 0.485, 0.345, 0.540],
    [0.125, 0.493, 0.325, 0.535],
    [0.080, 0.478, 0.365, 0.548],
  ];

  try {
    for (const b of dateBoxes) {
      for (const binary of [false, true]) {
        const c = crop(source, paper, b, binary, 3000);
        for (const psm of ["7", "6", "11"]) {
          await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          const raw = compact((await worker.recognize(c)).data.text || "");
          if (raw) dateRaws.push(raw);
          const value = parseJpDate(raw);
          if (value) dateCandidates.push(value);
        }
      }
    }

    for (const b of bodyBoxes) {
      for (const binary of [false, true]) {
        const c = crop(source, paper, b, binary, 2600);
        for (const psm of ["7", "6", "11"]) {
          await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", user_defined_dpi: "300" });
          const raw = compact((await worker.recognize(c)).data.text || "");
          if (raw) bodyRaws.push(raw);
          const value = parseBody(raw);
          if (value) bodyCandidates.push(value);
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  return { registrationDate: mode(dateCandidates), bodyShape: mode(bodyCandidates), dateRaws, bodyRaws };
}

function section(title) {
  return Array.from(document.querySelectorAll("section.card")).find((s) =>
    s.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function detailInput(labelText) {
  const s = section("車検証読み取り情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const title = compact(label.querySelector("span")?.textContent || "");
    if (title === compact(labelText)) return label.querySelector("input");
  }
  return null;
}

function basicInput(prefix) {
  const s = section("基本情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const text = compact(label.textContent || "");
    if (text.startsWith(compact(prefix))) return label.querySelector("input");
  }
  return null;
}

function reactProps(el) {
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? el[key] : null;
}

function fireReactChange(el, value) {
  if (!(el instanceof HTMLInputElement) || !value) return false;
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

  // React propsが取れない場合のフォールバック。
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const previous = el.value;
  if (setter) setter.call(el, value); else el.value = value;
  if (el._valueTracker) el._valueTracker.setValue(previous);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function setAndVerify(getter, value, attempts = 5) {
  if (!value) return true;
  for (let i = 0; i < attempts; i += 1) {
    const el = getter();
    if (el?.value === value) return true;
    if (el) fireReactChange(el, value);
    await sleep(650);
    if (getter()?.value === value) return true;
  }
  return false;
}

function snapshot(extra) {
  const qr = window.__vehicleCertificateQrPriority || {};
  return {
    registrationDate: detailInput("登録年月日／交付年月日")?.value || "",
    firstDetail: detailInput("初度登録年月")?.value || "",
    firstBasic: basicInput("初度登録")?.value || "",
    expiry: detailInput("有効期間の満了する日")?.value || "",
    body: detailInput("車体の形状")?.value || "",
    targetRegistrationDate: extra?.registrationDate || "",
    targetFirst: qr.firstRegistration || "",
    targetExpiry: qr.inspectionExpiry || "",
    targetBody: extra?.bodyShape || "",
  };
}

function showStatus(extra, state) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-state-authority-status");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-state-authority-status";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">本体state最終確定（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const s = snapshot(extra);
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = [
    `状態: ${state}`,
    `登録年月日: ${s.registrationDate} → ${s.targetRegistrationDate || "未取得"}`,
    `初度登録(詳細): ${s.firstDetail} → ${s.targetFirst || "待機中"}`,
    `初度登録(基本): ${s.firstBasic} → ${s.targetFirst || "待機中"}`,
    `有効期限: ${s.expiry} → ${s.targetExpiry || "待機中"}`,
    `車体の形状: ${s.body || "空欄"} → ${s.targetBody || "未取得"}`,
    "",
    "登録年月日OCR:", ...(extra?.dateRaws || ["(空)"]),
    "", "車体形状OCR:", ...(extra?.bodyRaws || ["(空)"]),
  ].join("\n");
}

async function applyAll(extra) {
  const qr = window.__vehicleCertificateQrPriority || {};

  // 同じupdate()が古いstateを使わないよう、必ず1項目ずつ再描画を待つ。
  if (extra.registrationDate) {
    showStatus(extra, "登録年月日を反映中");
    await setAndVerify(() => detailInput("登録年月日／交付年月日"), extra.registrationDate);
  }

  if (qr.firstRegistration) {
    showStatus(extra, "初度登録を反映中");
    // 基本情報の初度登録はupdate("firstRegistration")なので、ここを起点にすると詳細欄も同時更新される。
    const basicOk = await setAndVerify(() => basicInput("初度登録"), qr.firstRegistration);
    if (!basicOk || detailInput("初度登録年月")?.value !== qr.firstRegistration) {
      await setAndVerify(() => detailInput("初度登録年月"), qr.firstRegistration);
    }
  }

  if (qr.inspectionExpiry) {
    showStatus(extra, "有効期限を確認中");
    await setAndVerify(() => detailInput("有効期間の満了する日"), qr.inspectionExpiry);
  }

  if (extra.bodyShape) {
    showStatus(extra, "車体の形状を反映中");
    await setAndVerify(() => detailInput("車体の形状"), extra.bodyShape);
  }

  const s = snapshot(extra);
  const required = [
    !extra.registrationDate || s.registrationDate === extra.registrationDate,
    !qr.firstRegistration || (s.firstDetail === qr.firstRegistration && s.firstBasic === qr.firstRegistration),
    !qr.inspectionExpiry || s.expiry === qr.inspectionExpiry,
    !extra.bodyShape || s.body === extra.bodyShape,
  ];
  const done = required.every(Boolean);
  showStatus(extra, done ? "本体フォーム反映完了" : "一部未反映（再試行）");
  return done;
}

export default function CertificateStateAuthority() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let scanId = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++scanId;

      void (async () => {
        // 本体OCRとQRを先に完了させる。
        for (let i = 0; i < 180 && !dead && id === scanId; i += 1) {
          if (!document.querySelector(".progress") && window.__vehicleCertificateQrPriority?.firstRegistration) break;
          await sleep(350);
        }
        if (dead || id !== scanId) return;

        showStatus(null, "登録年月日・車体形状を再読込中");
        const extra = await targetedRead(file);
        if (dead || id !== scanId) return;

        // 最大3巡だけ。永続ループはしない。
        for (let pass = 0; pass < 3 && !dead && id === scanId; pass += 1) {
          if (await applyAll(extra)) return;
          await sleep(900);
        }
        showStatus(extra, "確認終了（未反映項目あり）");
      })().catch((error) => showStatus({ dateRaws: [String(error?.message || error)] }, "最終確定エラー"));
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
