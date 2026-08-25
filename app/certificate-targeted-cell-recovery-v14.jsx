"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";
import { extractOcrTokens, findLabelAnchor, relativeRegionFromAnchor } from "./lib/document-layout-recognition";
import { normalizeJapanesePlateRegion } from "./lib/japanese-plate-regions";

const AUTH_EVENT = "vehicle-certificate-authoritative";
const DEBUG_ID = "certificate-targeted-cell-recovery-v13-debug";

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/\r/g, "")
  .replace(/[\t\u3000]+/g, " ")
  .replace(/ {2,}/g, " ")
  .trim();

function section(title) {
  return [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function fieldInput(labelText) {
  const card = section("車検証読み取り情報");
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || label.childNodes?.[0]?.textContent || "");
    if (title !== labelText) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function value(label) {
  return norm(fieldInput(label)?.value || "");
}

function setReactInputValue(input, next) {
  if (!(input instanceof HTMLInputElement) || !next || input.value === next) return;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, next);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById(DEBUG_ID);
  if (!box) {
    box = document.createElement("details");
    box.id = DEBUG_ID;
    box.open = true;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #69a985";
    box.style.borderRadius = "12px";
    box.style.background = "#ecfdf5";
    box.innerHTML = '<summary style="font-weight:800">軽量セル補完 v14（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const summary = box.querySelector("summary");
  if (summary) summary.textContent = "軽量セル補完 v14（確認用）";
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

function pipelineReady() {
  const pre = document.querySelector("#certificate-layout-recognition-v6-debug pre");
  return /共通罫線セルOCR v6 完了/.test(pre?.textContent || "");
}

function scaleCachedTokens(page) {
  const data = window.__vehicleCertificateFastBaseOcrData;
  const geom = window.__vehicleCertificateFastBaseGeometry;
  if (!data || !geom?.width || !geom?.height) return [];
  const raw = extractOcrTokens(data);
  const sx = page.width / Number(geom.width);
  const coveredHeight = page.height * Number(geom.cropRatio || 1);
  const sy = coveredHeight / Number(geom.height);
  return raw.map(token => ({
    ...token,
    bbox: {
      x0: token.bbox.x0 * sx,
      y0: token.bbox.y0 * sy,
      x1: token.bbox.x1 * sx,
      y1: token.bbox.y1 * sy,
    },
  }));
}

function cropRegion(source, region, targetWidth = 1800) {
  const sx = Math.max(0, Math.floor(source.width * region.x));
  const sy = Math.max(0, Math.floor(source.height * region.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * region.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * region.height)));
  const scale = Math.max(1, Math.min(3.2, targetWidth / sw));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function recognize(worker, tesseract, source, region, whitelist = "") {
  const canvas = cropRegion(source, region);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(tesseract.PSM?.SINGLE_LINE ?? 7),
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_whitelist: whitelist,
    });
    const result = await worker.recognize(canvas);
    return { text: norm(result?.data?.text || ""), confidence: Number(result?.data?.confidence || 0) };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function regionFor(anchor, page, direction, width = 0.42, height = 0.05) {
  if (!anchor) return null;
  return relativeRegionFromAnchor(anchor, page.width, page.height, {
    direction,
    gap: 0.001,
    width,
    height,
    padX: 0.006,
    padY: 0.006,
  });
}

function digits(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8")
    .replace(/\D/g, "");
}

function parseNumber(raw, min, max) {
  for (const token of norm(raw).match(/[0-9OQDGIL|!SZB]{2,6}/g) || []) {
    const d = digits(token);
    if (!d) continue;
    const n = Number(d);
    if (n >= min && n <= max) return String(n);
  }
  return "";
}

function parsePlate(raw = "") {
  const text = norm(raw);
  const re = /([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9OQDGIL|SZB]{3})\s*([ぁ-ん])\s*([0-9OQDGIL|SZB]{1,4})/;
  const m = text.match(re);
  if (!m) return "";
  const region = normalizeJapanesePlateRegion(m[1]);
  const klass = digits(m[2]);
  const serial = digits(m[4]);
  if (!region || klass.length !== 3 || serial.length < 1 || serial.length > 4) return "";
  return `${region} ${klass} ${m[3]} ${serial}`;
}

function modelCore() {
  const raw = value("型式") || window.__vehicleCertificateQrPriority?.model || "";
  const t = norm(raw).toUpperCase().replace(/\s+/g, "");
  return t.includes("-") ? t.split("-").pop() : t;
}

function parseChassis(raw = "") {
  const core = modelCore();
  const text = norm(raw).toUpperCase().replace(/[‐‑‒–—―ー−]/g, "-").replace(/\s+/g, "");
  const matches = [...text.matchAll(/([A-Z0-9]{3,10})-([0-9OQDIL|!SZBG]{5,9})/g)];
  for (const m of matches) {
    const suffix = digits(m[2]);
    if (suffix.length < 5 || suffix.length > 9) continue;
    if (core && m[1].length >= 3) {
      const a = m[1].replace(/[OQD]/g, "0").replace(/[IL|!]/g, "1").replace(/S/g, "5");
      const b = core.replace(/[OQD]/g, "0").replace(/[IL|!]/g, "1").replace(/S/g, "5");
      if (a !== b && !a.endsWith(b) && !b.endsWith(a)) continue;
      return `${core}-${suffix}`;
    }
    return `${m[1]}-${suffix}`;
  }
  return "";
}

function parseEraDate(raw = "") {
  const t = norm(raw)
    .replace(/信和|今和|作和|三和|令禾|令入/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/\s+/g, "");
  const m = t.match(/(令和|平成|昭和)([0-9OQDGIL|SZB]{1,2})年?([0-9OQDGIL|SZB]{1,2})月?([0-9OQDGIL|SZB]{1,2})[日HＢB]?/);
  if (!m) return "";
  const y = Number(digits(m[2]));
  const mo = Number(digits(m[3]));
  const d = Number(digits(m[4]));
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[1]}${y}年${mo}月${d}日`;
}

function parseMaker(raw = "") {
  const t = norm(raw);
  return ["トヨタ", "日産", "ホンダ", "マツダ", "スズキ", "三菱", "ダイハツ", "スバル", "いすゞ", "日野", "UDトラックス", "レクサス"].find(name => t.includes(name)) || "";
}

function parseVehicleClass(raw = "") {
  const t = norm(raw);
  if (/軽\s*自動車|軽自動車/.test(t)) return "軽自動車";
  if (/大型\s*特殊/.test(t)) return "大型特殊自動車";
  if (/小型/.test(t)) return "小型自動車";
  if (/普通/.test(t)) return "普通自動車";
  return "";
}

function parseHomeBase(raw = "") {
  const t = norm(raw).replace(/\s+/g, "");
  return /使用者住所に同じ|使用者の住所に同じ/.test(t) ? "使用者住所に同じ" : "";
}

function validNumberField(label, min, max) {
  const n = Number((value(label).match(/\d+/) || [])[0]);
  return Number.isFinite(n) && n >= min && n <= max;
}

export default function CertificateTargetedCellRecoveryV14() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let stopped = false;
    let running = false;
    let completed = false;
    let timer = 0;

    const run = async () => {
      if (stopped || running || completed || !pipelineReady()) return;
      const sourceFile = window.__vehicleCertificateSourceFile;
      if (!sourceFile) return;

      const wants = {
        registrationNumber: !parsePlate(value("自動車登録番号又は車両番号")),
        chassisNumber: !value("車台番号"),
        registrationDate: !parseEraDate(value("登録年月日／交付年月日")),
        vehicleName: !value("車名"),
        vehicleClass: !value("自動車の種別"),
        homeBase: !value("使用の本拠の位置"),
        lengthCm: !validNumberField("長さ cm", 200, 3000),
        widthCm: !validNumberField("幅 cm", 100, 300),
      };

      if (!Object.values(wants).some(Boolean)) {
        completed = true;
        showDebug(["状態: 軽量セル補完 v14 完了", "未確定対象なし / 全ページ再OCRなし"]);
        return;
      }

      running = true;
      let worker = null;
      let session = null;
      try {
        showDebug(["状態: 軽量セル補完 v14 実行中", "全ページOCR: なし", `対象: ${Object.entries(wants).filter(([, yes]) => yes).map(([key]) => key).join(" / ")}`]);
        session = await createDocumentRecognitionSession(sourceFile, {
          maxSide: 2100,
          cropPaper: true,
          minPaperConfidence: 0.38,
        });
        if (stopped) return;

        const page = session.prepared.normalized;
        const tokens = scaleCachedTokens(page);
        const shared = await createSharedTesseractWorker();
        worker = shared.worker;
        const t = shared.tesseract;
        const contrast = session.prepared.variants?.contrast || page;

        const anchors = {
          registrationNumber: findLabelAnchor(tokens, ["自動車登録番号又は車両番号", "自動車登録番号", "車両番号"], { minSimilarity: 0.52, maxTokens: 12 }),
          chassisNumber: findLabelAnchor(tokens, ["車台番号"], { minSimilarity: 0.55, maxTokens: 7 }),
          registrationDate: findLabelAnchor(tokens, ["登録年月日／交付年月日", "登録年月日", "交付年月日"], { minSimilarity: 0.52, maxTokens: 12 }),
          vehicleName: findLabelAnchor(tokens, ["車名"], { minSimilarity: 0.55, maxTokens: 5 }),
          vehicleClass: findLabelAnchor(tokens, ["自動車の種別", "種別"], { minSimilarity: 0.52, maxTokens: 8 }),
          homeBase: findLabelAnchor(tokens, ["使用の本拠の位置", "本拠の位置"], { minSimilarity: 0.50, maxTokens: 10 }),
          lengthCm: findLabelAnchor(tokens, ["長さ"], { minSimilarity: 0.58, maxTokens: 4 }),
          widthCm: findLabelAnchor(tokens, ["幅"], { minSimilarity: 0.58, maxTokens: 3 }),
        };

        const patch = {};
        const lines = [
          "状態: 軽量セル補完 v14 完了",
          "全ページOCR: 0pass（高速ベースの位置情報を再利用）",
          `再利用tokens=${tokens.length}`,
        ];

        const read = async (key, directions, parser, options = {}) => {
          const anchor = anchors[key];
          if (!anchor) {
            lines.push(`${key}: ラベル未検出 → 保留`);
            return "";
          }
          for (const direction of directions) {
            const region = regionFor(anchor, page, direction, options.width || 0.42, options.height || 0.05);
            if (!region) continue;
            const first = await recognize(worker, t, page, region, options.whitelist || "");
            let parsed = parser(first.text);
            if (!parsed && options.contrast !== false) {
              const second = await recognize(worker, t, contrast, region, options.whitelist || "");
              parsed = parser(second.text);
              if (parsed) lines.push(`${key}: ${parsed} / ${direction} / contrast conf=${second.confidence.toFixed(1)}`);
            } else if (parsed) {
              lines.push(`${key}: ${parsed} / ${direction} / conf=${first.confidence.toFixed(1)}`);
            }
            if (parsed) return parsed;
          }
          lines.push(`${key}: 安全な候補なし → 保留`);
          return "";
        };

        if (wants.registrationNumber) patch.registrationNumber = await read("registrationNumber", ["right", "below"], parsePlate, { width: 0.58, height: 0.055 });
        if (wants.chassisNumber) patch.chassisNumber = await read("chassisNumber", ["right", "below"], parseChassis, { width: 0.62, height: 0.055, whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- " });
        if (wants.registrationDate) patch.registrationDate = await read("registrationDate", ["right", "below"], parseEraDate, { width: 0.46, height: 0.055 });
        if (wants.vehicleName) patch.vehicleName = await read("vehicleName", ["below", "right"], parseMaker, { width: 0.30, height: 0.055 });
        if (wants.vehicleClass) patch.vehicleClass = await read("vehicleClass", ["below", "right"], parseVehicleClass, { width: 0.34, height: 0.055 });
        if (wants.homeBase) patch.homeBase = await read("homeBase", ["right", "below"], parseHomeBase, { width: 0.66, height: 0.06 });
        if (wants.lengthCm) patch.lengthCm = await read("lengthCm", ["below", "right"], text => parseNumber(text, 200, 3000), { width: 0.16, height: 0.055, whitelist: "0123456789 " });
        if (wants.widthCm) patch.widthCm = await read("widthCm", ["below", "right"], text => parseNumber(text, 100, 300), { width: 0.14, height: 0.055, whitelist: "0123456789 " });

        for (const key of Object.keys(patch)) if (!patch[key]) delete patch[key];

        // A value below 200 cm cannot safely remain in the vehicle-length field. If width is empty
        // and that value is a valid width, move it to width and let targeted length recovery fill length.
        const currentLength = Number((value("長さ cm").match(/\d+/) || [])[0]);
        if (!patch.widthCm && !validNumberField("幅 cm", 100, 300) && currentLength >= 100 && currentLength < 200) {
          patch.widthCm = String(currentLength);
          setReactInputValue(fieldInput("幅 cm"), patch.widthCm);
          const lengthInput = fieldInput("長さ cm");
          if (lengthInput) {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
            const previous = lengthInput.value;
            descriptor?.set?.call(lengthInput, "");
            if (lengthInput._valueTracker) lengthInput._valueTracker.setValue(previous);
            lengthInput.dispatchEvent(new Event("input", { bubbles: true }));
            lengthInput.dispatchEvent(new Event("change", { bubbles: true }));
          }
          lines.push(`寸法整合: 長さ欄の${currentLength}cmを幅へ移動、長さは再読取対象`);
        }

        if (patch.registrationNumber) setReactInputValue(fieldInput("自動車登録番号又は車両番号"), patch.registrationNumber);
        if (patch.chassisNumber) setReactInputValue(fieldInput("車台番号"), patch.chassisNumber);
        if (patch.registrationDate) setReactInputValue(fieldInput("登録年月日／交付年月日"), patch.registrationDate);
        if (patch.vehicleName) setReactInputValue(fieldInput("車名"), patch.vehicleName);
        if (patch.vehicleClass) setReactInputValue(fieldInput("自動車の種別"), patch.vehicleClass);
        if (patch.homeBase) setReactInputValue(fieldInput("使用の本拠の位置"), patch.homeBase);
        if (patch.lengthCm) setReactInputValue(fieldInput("長さ cm"), patch.lengthCm);
        if (patch.widthCm) setReactInputValue(fieldInput("幅 cm"), patch.widthCm);

        if (Object.keys(patch).length) {
          window.__vehicleCertificateTargetedV14Patch = patch;
          for (let i = 0; i < 3; i += 1) {
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
            await new Promise(resolve => setTimeout(resolve, 180));
          }
        }

        completed = true;
        showDebug(lines);
      } catch (error) {
        showDebug(["状態: 軽量セル補完 v14 エラー", String(error?.message || error), "全ページOCRには戻しません"]);
      } finally {
        running = false;
        if (worker) await worker.terminate().catch(() => {});
      }
    };

    timer = window.setInterval(() => { void run(); }, 260);
    void run();

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
