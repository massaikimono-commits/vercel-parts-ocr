"use client";

import { useEffect } from "react";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

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

function forceReactChange(el, value) {
  if (!(el instanceof HTMLInputElement) || !value) return false;

  // DOM上の表示がすでに正しくても、React stateが古い場合があるため
  // 必ず本物のonChangeを呼ぶ。これが今回の初度登録の要点。
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
  const previous = el.value;
  if (setter) setter.call(el, value); else el.value = value;
  if (el._valueTracker) el._valueTracker.setValue(previous === value ? `${value}__old` : previous);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function eraYear(era, y) {
  const n = Number(y);
  if (!Number.isFinite(n) || n < 1) return 0;
  if (era === "令和") return 2018 + n;
  if (era === "平成") return 1988 + n;
  if (era === "昭和") return 1925 + n;
  return 0;
}

function eraFromYear(era, y, m, d) {
  return `${era}${Number(y)}年${Number(m)}月${Number(d)}日`;
}

function parseMonthYear(value) {
  const m = compact(value).match(/(令和|平成|昭和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月/);
  if (!m) return 0;
  return eraYear(m[1], m[2]);
}

function parseDateYear(value) {
  const m = compact(value).match(/(令和|平成|昭和)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return 0;
  return eraYear(m[1], m[2]);
}

function candidateTriples(raw) {
  const groups = (String(raw || "").match(/\d{1,4}/g) || []).map((v) => v.replace(/^0+(?=\d)/, ""));
  const triples = [];

  for (let i = 0; i + 2 < groups.length; i += 1) {
    triples.push([Number(groups[i]), Number(groups[i + 1]), Number(groups[i + 2])]);
  }

  const digits = groups.join("");
  for (let yl = 1; yl <= 2; yl += 1) {
    for (let ml = 1; ml <= 2; ml += 1) {
      for (let dl = 1; dl <= 2; dl += 1) {
        if (yl + ml + dl !== digits.length) continue;
        const y = Number(digits.slice(0, yl));
        const m = Number(digits.slice(yl, yl + ml));
        const d = Number(digits.slice(yl + ml));
        triples.push([y, m, d]);
      }
    }
  }

  return triples.filter(([y, m, d]) => y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31);
}

async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const n = new Image();
      n.onload = () => resolve(n);
      n.onerror = reject;
      n.src = url;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 6000 / Math.max(iw, ih));
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

function detectPaper(c) {
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return { x: 0, y: 0, w: c.width, h: c.height };
  const w = c.width, h = c.height, d = x.getImageData(0, 0, w, h).data;
  const step = Math.max(5, Math.floor(Math.max(w, h) / 700));
  const white = (px, py) => {
    const p = (py * w + px) * 4;
    const r = d[p], g = d[p + 1], b = d[p + 2], br = (r + g + b) / 3;
    return br > 105 && Math.max(r, g, b) - Math.min(r, g, b) < 110;
  };
  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let xx = 0; xx < w; xx += step) { if (white(xx, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 3), bottom = Math.min(h - 1, ys[ys.length - 1] + step * 3), xs = [];
  for (let xx = 0; xx < w; xx += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) { if (white(xx, y)) hit += 1; n += 1; }
    if (hit / Math.max(1, n) > 0.22) xs.push(xx);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 3), right = Math.min(w - 1, xs[xs.length - 1] + step * 3);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function crop(src, paper, box, binary = false, target = 3000) {
  const [x0, y0, x1, y1] = box;
  const sx = Math.round(paper.x + paper.w * x0), sy = Math.round(paper.y + paper.h * y0);
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0))), sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(14, target / sw)), pad = 44;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale) + pad * 2;
  c.height = Math.round(sh * scale) + pad * 2;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(src, sx, sy, sw, sh, pad, pad, c.width - pad * 2, c.height - pad * 2);
  if (binary) {
    const im = x.getImageData(0, 0, c.width, c.height);
    let sum = 0, n = 0;
    for (let p = 0; p < im.data.length; p += 4) {
      const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08);
      sum += g; n += 1;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
    }
    const th = Math.max(105, Math.min(220, sum / Math.max(1, n) - 15));
    for (let p = 0; p < im.data.length; p += 4) {
      const v = im.data[p] < th ? 0 : 255;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      im.data[p + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

function eraHint() {
  const current = detailInput("登録年月日／交付年月日")?.value || "";
  return current.match(/令和|平成|昭和/)?.[0] || "令和";
}

async function readRegistrationDate(file) {
  const src = await imageCanvas(file);
  const paper = detectPaper(src);
  const t = await import("./lib/tesseract-local");
  const worker = await t.createWorker("jpn+eng", 1);
  const raws = [];
  const candidates = [];
  const q = window.__vehicleCertificateQrPriority || {};
  const minYear = parseMonthYear(q.firstRegistration) || 1926;
  const maxYear = parseDateYear(q.inspectionExpiry) || 2100;
  const era = eraHint();

  // 実画像の「登録年月日/交付年月日」の値だけに絞る。
  const boxes = [
    [0.170, 0.215, 0.420, 0.255],
    [0.185, 0.220, 0.405, 0.252],
    [0.155, 0.212, 0.435, 0.258],
  ];

  try {
    for (const box of boxes) {
      for (const binary of [false, true]) {
        const c = crop(src, paper, box, binary, 3200);
        for (const psm of ["7", "6"]) {
          await worker.setParameters({
            tessedit_pageseg_mode: psm,
            tessedit_char_whitelist: "0123456789 .,/年月日令和平成昭和",
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          });
          const raw = compact((await worker.recognize(c)).data.text || "");
          if (!raw) continue;
          raws.push(raw);

          const localEra = raw.match(/令和|平成|昭和/)?.[0] || era;
          for (const [y, m, d] of candidateTriples(raw)) {
            const gy = eraYear(localEra, y);
            if (!gy || gy < minYear || gy > maxYear) continue;
            candidates.push(eraFromYear(localEra, y, m, d));
          }
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  const counts = new Map();
  for (const v of candidates) counts.set(v, (counts.get(v) || 0) + 1);
  const value = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return { value, raws, candidates };
}

function showStatus(dateInfo, state) {
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-last-mile-status");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-last-mile-status";
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">残り2項目確定（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const q = window.__vehicleCertificateQrPriority || {};
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = [
    `状態: ${state}`,
    `登録年月日 target=${dateInfo?.value || "未取得"} live=${detailInput("登録年月日／交付年月日")?.value || ""}`,
    `初度登録 target=${q.firstRegistration || "待機"} live=${detailInput("初度登録年月")?.value || ""}`,
    `基本初度 live=${basicInput("初度登録")?.value || ""}`,
    "",
    "登録年月日 狭域OCR:",
    ...(dateInfo?.raws || ["(空)"]),
  ].join("\n");
}

async function forceLastFields(dateInfo, deadCheck) {
  const q = window.__vehicleCertificateQrPriority || {};
  const targetFirst = q.firstRegistration || "";
  const targetDate = dateInfo?.value || "";

  let stable = 0;
  for (let i = 0; i < 24 && !deadCheck(); i += 1) {
    // 登録年月日を先に入れ、初度登録を必ず最後に入れる。
    if (targetDate && detailInput("登録年月日／交付年月日")?.value !== targetDate) {
      forceReactChange(detailInput("登録年月日／交付年月日"), targetDate);
      await sleep(250);
    }

    // DOM表示が既にtargetでもReact stateを更新するため毎回onChangeを通す。
    if (targetFirst) forceReactChange(detailInput("初度登録年月"), targetFirst);
    await sleep(450);

    const firstDetail = detailInput("初度登録年月")?.value || "";
    const firstBasic = basicInput("初度登録")?.value || "";
    const liveDate = detailInput("登録年月日／交付年月日")?.value || "";
    const ok = (!targetDate || liveDate === targetDate) && (!targetFirst || (firstDetail === targetFirst && firstBasic === targetFirst));

    showStatus(dateInfo, ok ? `安定確認 ${stable + 1}/3` : "再反映中");
    if (ok) stable += 1; else stable = 0;
    if (stable >= 3) {
      showStatus(dateInfo, "反映完了");
      return true;
    }
    await sleep(700);
  }
  showStatus(dateInfo, "反映要確認");
  return false;
}

export default function CertificateLastMileFix() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    let dead = false;
    let scan = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++scan;

      void (async () => {
        // 既存QR/OCR/最終補正を全部先に終わらせてから最後に走る。
        for (let i = 0; i < 200 && !dead && id === scan; i += 1) {
          const qrReady = Boolean(window.__vehicleCertificateQrPriority?.firstRegistration);
          const nativeText = document.querySelector("#certificate-final-native-status pre")?.textContent || "";
          const nativeDone = nativeText && !nativeText.includes("専用OCR中");
          if (!document.querySelector(".progress") && qrReady && nativeDone) break;
          await sleep(350);
        }
        if (dead || id !== scan) return;

        showStatus(null, "登録年月日を狭域再OCR中");
        const dateInfo = await readRegistrationDate(file);
        if (dead || id !== scan) return;

        await forceLastFields(dateInfo, () => dead || id !== scan);
      })().catch((error) => showStatus({ raws: [String(error?.message || error)] }, "エラー"));
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
