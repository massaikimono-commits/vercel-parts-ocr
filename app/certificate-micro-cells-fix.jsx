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

function section(title) {
  return (
    Array.from(document.querySelectorAll("section.card")).find((s) =>
      s.querySelector("h2")?.textContent?.includes(title)
    ) || null
  );
}

function field(title, label) {
  const s = section(title);
  if (!s) return null;
  for (const l of Array.from(s.querySelectorAll("label"))) {
    const text = (
      l.querySelector("span")?.textContent ||
      l.childNodes[0]?.textContent ||
      ""
    ).trim();
    if (compact(text) === compact(label)) return l.querySelector("input");
  }
  return null;
}

function setInput(el, value) {
  if (!el || !value || el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function mainDebug() {
  const details = Array.from(document.querySelectorAll("details")).find((d) =>
    d.querySelector("summary")?.textContent?.includes("OCR詳細")
  );
  return details?.querySelector("pre")?.textContent || "";
}

function eraFrom(text = "") {
  const t = norm(text)
    .replace(/信和|令入|令禾|今和|今禾|作和|三和|合和|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾知]/g, "昭和");
  if (t.includes("令和")) return "令和";
  if (t.includes("平成")) return "平成";
  if (t.includes("昭和")) return "昭和";
  return "";
}

function numish(text = "") {
  return norm(text)
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss§]/g, "5")
    .replace(/[Bb]/g, "8");
}

function validDateParts(values, monthOnly) {
  if (monthOnly) {
    if (values.length !== 2) return null;
    const [y, m] = values;
    return y >= 1 && y <= 64 && m >= 1 && m <= 12 ? [y, m] : null;
  }
  if (values.length !== 3) return null;
  const [y, m, d] = values;
  return y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? [y, m, d]
    : null;
}

function splitCompactDigits(ds, monthOnly) {
  const need = monthOnly ? 2 : 3;
  const out = [];
  const walk = (start, parts) => {
    if (parts.length === need) {
      if (start === ds.length) out.push(parts.map(Number));
      return;
    }
    for (const len of [1, 2]) {
      if (start + len > ds.length) continue;
      walk(start + len, [...parts, ds.slice(start, start + len)]);
    }
  };
  walk(0, []);
  for (const candidate of out) {
    const ok = validDateParts(candidate, monthOnly);
    if (ok) return ok;
  }
  return null;
}

function dateNumbers(texts, monthOnly = false) {
  for (const raw of texts) {
    const t = numish(raw);
    const groups = (t.match(/\d{1,2}/g) || []).map(Number);
    const need = monthOnly ? 2 : 3;
    for (let i = 0; i + need <= groups.length; i += 1) {
      const ok = validDateParts(groups.slice(i, i + need), monthOnly);
      if (ok) return ok;
    }
    const ds = t.replace(/\D/g, "");
    if (ds.length >= need && ds.length <= need * 2) {
      const ok = splitCompactDigits(ds, monthOnly);
      if (ok) return ok;
    }
  }
  return null;
}

function bodyFrom(text = "") {
  const t = compact(text)
    .replace(/パン/g, "バン")
    .replace(/ハン/g, "バン")
    .replace(/バソ/g, "バン");
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
  return choices.find((v) => t.includes(v)) || "";
}

function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height };

  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(Math.max(w, h) / 650));
  const isPaper = (x, y) => {
    const p = (y * w + x) * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const br = (r + g + b) / 3;
    return br > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 90;
  };

  const ys = [];
  for (let y = 0; y < h; y += step) {
    let hit = 0;
    let n = 0;
    for (let x = 0; x < w; x += step) {
      if (isPaper(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.25) ys.push(y);
  }
  if (ys.length < 10) return { x: 0, y: 0, w, h };

  const top = Math.max(0, ys[0] - step * 2);
  const bottom = Math.min(h - 1, ys[ys.length - 1] + step * 2);
  const xs = [];
  for (let x = 0; x < w; x += step) {
    let hit = 0;
    let n = 0;
    for (let y = top; y <= bottom; y += step) {
      if (isPaper(x, y)) hit += 1;
      n += 1;
    }
    if (hit / Math.max(1, n) > 0.25) xs.push(x);
  }
  if (xs.length < 10) return { x: 0, y: top, w, h: bottom - top + 1 };

  const left = Math.max(0, xs[0] - step * 2);
  const right = Math.min(w - 1, xs[xs.length - 1] + step * 2);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

async function sourceCanvas(img) {
  if (!img.complete) {
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
    });
  }
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  const scale = Math.min(1, 4600 / Math.max(naturalW, naturalH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalW * scale));
  canvas.height = Math.max(1, Math.round(naturalH * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropCell(source, paper, box, binary = false, targetWidth = 2200) {
  const [x0, y0, w0, h0] = box;
  const sx = Math.max(0, Math.round(paper.x + paper.w * x0));
  const sy = Math.max(0, Math.round(paper.y + paper.h * y0));
  const sw = Math.max(1, Math.round(paper.w * w0));
  const sh = Math.max(1, Math.round(paper.h * h0));
  const scale = Math.max(1, Math.min(14, targetWidth / sw));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  if (binary) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let count = 0;
    for (let p = 0; p < image.data.length; p += 4) {
      sum += Math.round(
        image.data[p] * 0.22 + image.data[p + 1] * 0.7 + image.data[p + 2] * 0.08
      );
      count += 1;
    }
    const threshold = Math.max(115, Math.min(205, sum / Math.max(1, count) - 18));
    for (let p = 0; p < image.data.length; p += 4) {
      const g = Math.round(
        image.data[p] * 0.22 + image.data[p + 1] * 0.7 + image.data[p + 2] * 0.08
      );
      const v = g < threshold ? 0 : 255;
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

async function recognize(worker, canvas, psm, whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_char_whitelist: whitelist,
  });
  return norm((await worker.recognize(canvas)).data.text || "");
}

async function readDate(worker, source, paper, box, psm, monthOnly, currentValue) {
  const gray = cropCell(source, paper, box, false, 2400);
  const bw = cropCell(source, paper, box, true, 2400);
  const rawGray = await recognize(worker, gray, psm, "");
  const rawBw = await recognize(worker, bw, psm, "");
  const digitsGray = await recognize(worker, gray, psm, "0123456789. ");
  const digitsBw = await recognize(worker, bw, psm, "0123456789. ");
  const parts = dateNumbers([digitsBw, digitsGray, rawBw, rawGray], monthOnly);
  const era = eraFrom(`${rawGray} ${rawBw}`) || eraFrom(currentValue);
  if (!parts || !era) {
    return { value: "", raw: `${rawGray} / ${rawBw} / ${digitsGray} / ${digitsBw}` };
  }
  const value = monthOnly
    ? `${era}${parts[0]}年${parts[1]}月`
    : `${era}${parts[0]}年${parts[1]}月${parts[2]}日`;
  return { value, raw: `${rawGray} / ${rawBw} / ${digitsGray} / ${digitsBw}` };
}

function showDebug(lines) {
  let details = document.getElementById("certificate-date-body-debug");
  if (!details) {
    details = document.createElement("details");
    details.id = "certificate-date-body-debug";
    details.style.marginTop = "12px";
    details.innerHTML =
      '<summary style="font-weight:800;cursor:pointer">日付・形状セルOCR（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    document.querySelector("img.preview")?.closest("section.card")?.appendChild(details);
  }
  const pre = details.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

export default function CertificateMicroCellsFix() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let stopped = false;
    let running = false;
    let lastKey = "";

    const run = async () => {
      if (stopped || running) return;
      const img = document.querySelector("img.preview");
      const debug = mainDebug();
      if (!img?.src || !debug.includes("【車検証 全体OCR】")) return;

      const key = `${img.src}|${debug.length}`;
      if (key === lastKey) return;
      lastKey = key;
      running = true;

      let worker = null;
      try {
        const source = await sourceCanvas(img);
        const paper = detectPaper(source);
        const t = await import("./lib/tesseract-local");
        worker = await t.createWorker("jpn+eng", 1);
        const psm = t.PSM?.SINGLE_LINE ?? "7";

        // 自動車検査証記録事項の値セルだけを狙う。
        // ラベルや上下の行を含めないことで、別の数字を日付として組み合わせる誤読を防ぐ。
        const regBox = [0.275, 0.198, 0.21, 0.034];
        const firstBox = [0.49, 0.198, 0.17, 0.034];
        const expiryBox = [0.735, 0.198, 0.205, 0.034];
        const bodyBox = [0.26, 0.414, 0.12, 0.036];

        const regCurrent = field(
          "車検証読み取り情報",
          "登録年月日／交付年月日"
        )?.value;
        const firstCurrent = field("車検証読み取り情報", "初度登録年月")?.value;
        const expiryCurrent = field(
          "車検証読み取り情報",
          "有効期間の満了する日"
        )?.value;

        const reg = await readDate(
          worker,
          source,
          paper,
          regBox,
          psm,
          false,
          regCurrent
        );
        const first = await readDate(
          worker,
          source,
          paper,
          firstBox,
          psm,
          true,
          firstCurrent
        );
        const expiry = await readDate(
          worker,
          source,
          paper,
          expiryBox,
          psm,
          false,
          expiryCurrent
        );

        const bodyGray = await recognize(
          worker,
          cropCell(source, paper, bodyBox, false, 1900),
          psm,
          ""
        );
        const bodyBw = await recognize(
          worker,
          cropCell(source, paper, bodyBox, true, 1900),
          psm,
          ""
        );
        const body = bodyFrom(`${bodyGray} ${bodyBw}`);

        if (stopped) return;
        if (reg.value) {
          setInput(
            field("車検証読み取り情報", "登録年月日／交付年月日"),
            reg.value
          );
        }
        if (first.value) {
          setInput(field("車検証読み取り情報", "初度登録年月"), first.value);
          setInput(field("基本情報", "初度登録（和暦）"), first.value);
        }
        if (expiry.value) {
          setInput(
            field("車検証読み取り情報", "有効期間の満了する日"),
            expiry.value
          );
        }
        if (body) {
          setInput(field("車検証読み取り情報", "車体の形状"), body);
        }

        showDebug([
          `紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`,
          `【登録年月日 セルOCR】 ${reg.raw || "(空)"}`,
          `【登録年月日 採用】 ${reg.value || "未読"}`,
          `【初度登録 セルOCR】 ${first.raw || "(空)"}`,
          `【初度登録 採用】 ${first.value || "未読"}`,
          `【有効期限 セルOCR】 ${expiry.raw || "(空)"}`,
          `【有効期限 採用】 ${expiry.value || "未読"}`,
          `【車体形状 セルOCR】 ${bodyGray || "(空)"} / ${bodyBw || "(空)"}`,
          `【車体形状 採用】 ${body || "未読"}`,
        ]);
      } catch (e) {
        showDebug([`日付・形状セルOCRエラー: ${e?.message || e}`]);
      } finally {
        if (worker) await worker.terminate().catch(() => {});
        running = false;
      }
    };

    const observer = new MutationObserver(() => void run());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const timer = window.setInterval(() => void run(), 900);
    void run();

    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
