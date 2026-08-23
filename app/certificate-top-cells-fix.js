"use client";

import { useEffect } from "react";

const norm = (v = "") =>
  String(v)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const compact = (v = "") => norm(v).replace(/\s+/g, "");

const numish = (v = "") =>
  norm(v)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");

function section(title) {
  return (
    Array.from(document.querySelectorAll("section.card")).find((s) =>
      s.querySelector("h2")?.textContent?.includes(title)
    ) || null
  );
}

function input(title, label) {
  const s = section(title);
  if (!s) return null;
  for (const l of Array.from(s.querySelectorAll("label"))) {
    const t = (
      l.querySelector("span")?.textContent ||
      l.childNodes[0]?.textContent ||
      ""
    ).trim();
    if (compact(t) === compact(label)) return l.querySelector("input");
  }
  return null;
}

function setInput(el, value, allowEmpty = false) {
  if (!el || value == null || (!allowEmpty && !value) || el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function globalText(debug) {
  const marker = "【車検証 全体OCR】";
  const i = debug.indexOf(marker);
  return i >= 0 ? debug.slice(i + marker.length) : debug;
}

function rawField(debug, label) {
  const a = `【${label} 生OCR】`;
  const b = `【${label} 採用】`;
  const i = debug.indexOf(a);
  if (i < 0) return "";
  const j = debug.indexOf(b, i + a.length);
  return debug.slice(i + a.length, j >= 0 ? j : undefined).trim();
}

function documentNumberFromDebug(debug) {
  const text = numish(globalText(debug));
  const exact = text.match(/(?<!\d)\d{12}(?!\d)/);
  if (exact) return exact[0];
  for (const raw of text.match(/(?:\d[\s\n]*){11,13}/g) || []) {
    const d = raw.replace(/\D/g, "");
    if (d.length === 12 && new Set(d).size >= 4) return d;
  }
  return "";
}

function modelValue() {
  return (
    input("車検証読み取り情報", "型式")?.value ||
    input("基本情報", "型式")?.value ||
    ""
  );
}

function modelStem(model) {
  const t = norm(model).toUpperCase().replace(/\s+/g, "");
  const core = t.includes("-") ? t.split("-").pop() || "" : t;
  return core.match(/^([A-Z]{2,5}\d{1,4})/)?.[1] || "";
}

function normalizeChassis(value, model) {
  let t = norm(value)
    .toUpperCase()
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[＿_]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/--+/g, "-")
    .replace(/^S(?=N(?:KR|PR|LR|MR|QR|KS|PS|LS|MS|QS))/g, "")
    .replace(/NKRS(?=\d)/g, "NKR");

  const serial = t.match(/-([0-9]{4,12})/)?.[1] || "";
  const stem = modelStem(model);
  if (stem && serial) {
    const before = t.split("-")[0] || "";
    if (
      before === stem ||
      before.endsWith(stem) ||
      stem.endsWith(before) ||
      before.replace(/S/g, "") === stem.replace(/S/g, "") ||
      Math.abs(before.length - stem.length) <= 2
    ) {
      t = `${stem}-${serial}`;
    }
  }

  const all = t.match(/[A-Z]{1,6}\d{1,5}-\d{4,12}/g) || [];
  return all.sort((a, b) => b.length - a.length)[0] || "";
}

function currentUserName() {
  return input("車検証読み取り情報", "使用者の氏名又は名称")?.value || "";
}

function fallbackRegionFromContext() {
  const s = norm(currentUserName());
  const m = s.match(/([一-龠]{2,4})(?:支店|営業所|事業所)/);
  return m?.[1] || "";
}

function parseRegistration(texts) {
  const list = texts.map((x) => norm(x)).filter(Boolean);
  let cls = "";
  let kana = "";
  let serial = "";
  const regions = [];

  for (const raw of list) {
    const t = numish(raw).replace(/[一―‐‑‒–—ー]/g, "-");
    const groups = t.match(/\d{2,4}/g) || [];
    const c = groups.find((x) => Number(x) >= 10 && Number(x) <= 999) || "";
    const after = c ? groups.slice(groups.indexOf(c) + 1).filter((x) => x.length <= 4) : [];
    const s = after[after.length - 1] || "";
    if (!cls && c) cls = c;
    if (!serial && s) serial = s;

    if (!kana) {
      const km = raw.match(/[ぁ-ん]/g) || [];
      kana = km.find((x) => !/[あいうえお]/.test(x)) || km[0] || "";
    }

    const beforeClass = c ? t.split(c)[0] : t;
    const rs = beforeClass.match(/[一-龠]{2,4}/g) || [];
    for (const r of rs) regions.push(r);
  }

  const contextRegion = fallbackRegionFromContext();
  let region = "";
  if (contextRegion) region = contextRegion;
  else region = regions.find((x) => x.length >= 2 && x.length <= 4) || "";

  if (region && cls && kana && serial) {
    return `${region} ${cls} ${kana} ${serial.padStart(4, "0")}`;
  }
  return "";
}

function eraFromText(text) {
  const t = norm(text)
    .replace(/作\s*和|今\s*和|三\s*和|信\s*和|合\s*和|令\s*[禾ロ]/g, "令和")
    .replace(/平\s*[或戊成陰]/g, "平成");
  if (/令和/.test(t)) return "令和";
  if (/平成/.test(t)) return "平成";
  if (/昭和/.test(t)) return "昭和";
  return "";
}

function numberTokens(text) {
  const t = numish(text);
  const raw = t.match(/\d{1,4}/g) || [];
  const out = [];
  for (const s of raw) {
    out.push(Number(s));
    if (s.length === 3) {
      out.push(Number(s.slice(0, 2)));
      out.push(Number(s.slice(1)));
    }
  }
  return out.filter((x) => Number.isFinite(x));
}

function looseDate(text, { monthOnly = false, eraHint = "", model = "" } = {}) {
  let era = eraFromText(text) || eraHint;
  const a = numberTokens(text);
  for (let i = 0; i < a.length; i++) {
    const y = a[i];
    if (y < 1 || y > 64) continue;
    for (let j = i + 1; j < Math.min(a.length, i + 4); j++) {
      const m = a[j];
      if (m < 1 || m > 12) continue;
      if (monthOnly) {
        if (!era) {
          if (
            y >= 10 &&
            /^(TKG|QKG|PKG|SKG|LDA|DBA|DAA|CBA|ABA)-/i.test(norm(model))
          ) {
            era = "平成";
          } else if (y <= 15) {
            era = "令和";
          }
        }
        if (!era) continue;
        return `${era}${y}年${m}月`;
      }
      for (let k = j + 1; k < Math.min(a.length, j + 4); k++) {
        const d = a[k];
        if (d < 1 || d > 31 || !era) continue;
        return `${era}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

function cleanAddressLine(line0) {
  let line = norm(line0)
    .replace(/使用者の住所/g, "")
    .replace(/使[房用]者.*住所/g, "")
    .replace(/[［【\[(（].*$/g, "")
    .replace(/([0-9])一([0-9])/g, "$1-$2")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .trim();

  line = line.replace(/[A-Za-z<>{}|_^~]{2,}/g, "");
  if (/-\d{1,4}\d{5,}$/.test(line)) {
    const m = line.match(/^(.*?-\d{1,4}?)(\d{5,})$/);
    if (m) line = m[1];
  }
  return line;
}

function address(text) {
  const lines = norm(text).split("\n");
  for (const line0 of lines) {
    const line = cleanAddressLine(line0);
    if (
      line.length >= 8 &&
      line.length <= 70 &&
      /[都道府県]/.test(line) &&
      /[市区町村]/.test(line) &&
      /\d/.test(line)
    ) {
      return line;
    }
  }

  const joined = cleanAddressLine(lines.join(""));
  if (
    joined.length >= 8 &&
    joined.length <= 70 &&
    /[都道府県]/.test(joined) &&
    /[市区町村]/.test(joined) &&
    /\d/.test(joined)
  ) {
    return joined;
  }
  return "";
}

function baseLocation(debug) {
  const g = norm(globalText(debug));
  const i = g.indexOf("使用の本拠の位置");
  const around = i >= 0 ? g.slice(i, i + 240) : g;
  if (/(?:[*＊※kK]\s*){2,}/.test(around)) return "***";
  const raw = rawField(debug, "使用の本拠の位置");
  if (/(?:[*＊※kK]\s*){2,}/.test(raw)) return "***";
  return "";
}

function bodyShape(text) {
  const t = compact(text);
  const choices = [
    "キャブオーバ",
    "ステーションワゴン",
    "ピックアップ",
    "ボンネット",
    "トラック",
    "ダンプ",
    "セダン",
    "箱型",
    "幌型",
    "バス",
    "バン",
  ];
  for (const x of choices) if (t.includes(x)) return x;
  if (/[バパハ]ン/.test(t)) return "バン";
  return "";
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const paperish = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };

  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0, n = 0;
    for (let x = 0; x < w; x += step) {
      if (paperish(x, y)) hit++;
      n++;
    }
    if (hit / Math.max(1, n) > 0.25) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };
  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);

  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0, n = 0;
    for (let y = top; y <= bottom; y += step) {
      if (paperish(x, y)) hit++;
      n++;
    }
    if (hit / Math.max(1, n) > 0.25) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };
  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

async function buildSource(img) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }
  const c = document.createElement("canvas");
  const max = 4600;
  const s = Math.min(
    1,
    max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height)
  );
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function makeCell(source, paper, x0, x1, y0, y1, { targetWidth = 2800, binary = true } = {}) {
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * (x1 - x0)));
  const sh = Math.max(1, Math.round(paper.h * (y1 - y0)));
  const scale = Math.max(1, Math.min(10, targetWidth / sw));
  const pad = 28;

  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale)) + pad * 2;
  c.height = Math.max(1, Math.round(sh * scale)) + pad * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    pad,
    pad,
    c.width - pad * 2,
    c.height - pad * 2
  );

  const im = ctx.getImageData(0, 0, c.width, c.height);
  const gray = new Uint8Array(c.width * c.height);
  let min = 255, max = 0;
  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) {
    const v = Math.round(im.data[p] * 0.22 + im.data[p + 1] * 0.7 + im.data[p + 2] * 0.08);
    gray[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const span = Math.max(25, max - min);
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((gray[i] - min) * 255) / span)));
    gray[i] = v;
    hist[v]++;
  }

  let threshold = 170;
  if (binary) {
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = -1;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const score = wB * wF * (mB - mF) * (mB - mF);
      if (score > best) {
        best = score;
        threshold = i;
      }
    }
    threshold = Math.max(115, Math.min(210, threshold + 10));
  }

  for (let p = 0, i = 0; p < im.data.length; p += 4, i++) {
    const v = binary ? (gray[i] > threshold ? 255 : 0) : gray[i];
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
    im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

async function recognize(worker, canvas, psm = "7", whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
    tessedit_char_whitelist: whitelist,
  });
  const r = await worker.recognize(canvas);
  return norm(r?.data?.text || "");
}

async function extract(img, debug) {
  const source = await buildSource(img);
  const paper = detectPaper(source);
  const t = await import("tesseract.js");
  const worker = await t.createWorker("jpn+eng", 1);

  try {
    const regBox = [0.30, 0.69, 0.214, 0.238];
    const regBinary = await recognize(
      worker,
      makeCell(source, paper, ...regBox, { targetWidth: 3000, binary: true }),
      "7"
    );
    const regGray = await recognize(
      worker,
      makeCell(source, paper, ...regBox, { targetWidth: 3000, binary: false }),
      "7"
    );

    const chassisText = await recognize(
      worker,
      makeCell(source, paper, 0.235, 0.67, 0.236, 0.258, {
        targetWidth: 3000,
        binary: true,
      }),
      "7",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
    );

    const registrationDateText = await recognize(
      worker,
      makeCell(source, paper, 0.275, 0.49, 0.258, 0.282, {
        targetWidth: 2400,
        binary: true,
      }),
      "7"
    );
    const firstRegistrationText = await recognize(
      worker,
      makeCell(source, paper, 0.485, 0.685, 0.258, 0.282, {
        targetWidth: 2200,
        binary: true,
      }),
      "7"
    );
    const expiryText = await recognize(
      worker,
      makeCell(source, paper, 0.675, 0.90, 0.258, 0.282, {
        targetWidth: 2400,
        binary: true,
      }),
      "7"
    );

    const addressText = await recognize(
      worker,
      makeCell(source, paper, 0.27, 0.86, 0.326, 0.351, {
        targetWidth: 3200,
        binary: false,
      }),
      "7"
    );

    const bodyText = await recognize(
      worker,
      makeCell(source, paper, 0.18, 0.39, 0.458, 0.486, {
        targetWidth: 2200,
        binary: true,
      }),
      "7"
    );

    const model = modelValue();
    const record = input("車検証読み取り情報", "記録年月日")?.value || "";
    const eraHint = eraFromText(record) || "令和";

    return {
      documentNumber: documentNumberFromDebug(debug),
      registrationNumber: parseRegistration([regBinary, regGray]),
      chassisNumber: normalizeChassis(chassisText, model),
      registrationDate: looseDate(registrationDateText, { eraHint, model }),
      firstRegistration: looseDate(firstRegistrationText, { monthOnly: true, model }),
      inspectionExpiry: looseDate(expiryText, { eraHint, model }),
      userAddress: address(addressText),
      baseLocation: baseLocation(debug),
      bodyShape: bodyShape(bodyText),
    };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

function apply(v) {
  const d = (label) => input("車検証読み取り情報", label);
  const b = (label) => input("基本情報", label);

  setInput(d("記録事項番号"), v.documentNumber);
  setInput(d("自動車登録番号又は車両番号"), v.registrationNumber);
  setInput(d("車台番号"), v.chassisNumber);
  setInput(d("登録年月日／交付年月日"), v.registrationDate);
  setInput(d("初度登録年月"), v.firstRegistration);
  setInput(d("有効期間の満了する日"), v.inspectionExpiry);
  setInput(d("使用者の住所"), v.userAddress);
  setInput(d("使用の本拠の位置"), v.baseLocation);
  setInput(d("車体の形状"), v.bodyShape);

  if (v.registrationNumber) {
    setInput(b("登録番号"), v.registrationNumber);
    const last = v.registrationNumber.match(/(\d{4})(?!.*\d)/)?.[1] || "";
    if (last) setInput(b("ナンバー下4桁"), last);
  }
  setInput(b("車台番号"), v.chassisNumber);
  setInput(b("初度登録（和暦）"), v.firstRegistration);

  const addr = d("使用者の住所");
  if (
    addr &&
    !v.userAddress &&
    (/\[[A-Za-z0-9]/.test(addr.value) || /[A-Z]{3,}/.test(addr.value) || /ペペ|バケ|TTTT|手細情報/.test(addr.value))
  ) {
    setInput(addr, "", true);
  }

  const base = d("使用の本拠の位置");
  if (base && !v.baseLocation && /原動機|KG-|ババ|T-\s*e/.test(base.value)) {
    setInput(base, "", true);
  }

  for (const label of ["型式指定番号", "類別区分番号"]) {
    const el = d(label);
    if (el && (/^\d{1,2}$/.test(el.value) || /[^0-9-]/.test(el.value))) {
      setInput(el, "", true);
    }
  }
}

export default function CertificateTopCellsFix() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2") return;

    let dead = false;
    let running = false;
    let lastKey = "";

    const run = async () => {
      if (dead || running) return;
      const debug =
        Array.from(document.querySelectorAll("details pre"))
          .map((x) => x.textContent || "")
          .find((x) => x.includes("【車検証 全体OCR】")) || "";
      const img = document.querySelector("img.preview");
      if (!debug || !img?.src) return;

      const key = `${img.src}|${debug.length}`;
      if (key === lastKey) return;
      lastKey = key;
      running = true;

      try {
        const values = await extract(img, debug);
        if (dead) return;
        apply(values);
        [600, 1800, 3600, 6500].forEach((ms) =>
          setTimeout(() => {
            if (!dead) apply(values);
          }, ms)
        );
      } catch (e) {
        console.warn("certificate calibrated-cell correction skipped", e);
      } finally {
        running = false;
      }
    };

    const obs = new MutationObserver(() => void run());
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const id = setInterval(() => void run(), 900);
    void run();

    return () => {
      dead = true;
      obs.disconnect();
      clearInterval(id);
    };
  }, []);

  return null;
}
