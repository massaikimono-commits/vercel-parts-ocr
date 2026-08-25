"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";
import { extractOcrTokens, findLabelAnchor, relativeRegionFromAnchor } from "./lib/document-layout-recognition";
import { createRuledGridDetector } from "./lib/document-ruled-grid";

const AUTH_EVENT = "vehicle-certificate-authoritative";

const norm = (value = "") => String(value)
  .normalize("NFKC")
  .replace(/[‐‑‒–—―ー−]/g, "-")
  .replace(/\r/g, "")
  .replace(/[\t\u3000]+/g, " ")
  .replace(/ {2,}/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const compact = (value = "") => norm(value).toUpperCase().replace(/\s+/g, "");

function canonicalCode(value = "") {
  return compact(value)
    .replace(/[OQD]/g, "0")
    .replace(/[I|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function numericPart(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[I|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8")
    .replace(/[^0-9]/g, "");
}

function editDistance(a = "", b = "") {
  const x = String(a);
  const y = String(b);
  const row = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (x[i - 1] === y[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[y.length];
}

function similarity(a = "", b = "") {
  const x = canonicalCode(a);
  const y = canonicalCode(b);
  if (!x || !y) return 0;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length, 1);
}

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

function setReactInputValue(input, value) {
  if (!(input instanceof HTMLInputElement) || input.value === value) return;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const card = node.closest("section.card");
  return !!card?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function modelCore() {
  const raw = fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "";
  const value = compact(raw);
  return value.includes("-") ? value.split("-").pop() : value;
}

function needsChassisRecovery() {
  return !norm(fieldInput("車台番号")?.value || "");
}

function isCompanyStub(value = "") {
  return /^(株式会社|有限会社|合同会社)$/.test(norm(value));
}

function needsUserRecovery() {
  const value = norm(fieldInput("使用者の氏名又は名称")?.value || "");
  return !value || isCompanyStub(value);
}

function needsEngineRecovery() {
  return !norm(fieldInput("原動機の型式")?.value || "");
}

function cropRegion(source, region, targetWidth = 3600) {
  const sx = Math.max(0, Math.floor(source.width * region.x));
  const sy = Math.max(0, Math.floor(source.height * region.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * region.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * region.height)));
  const scale = Math.max(1, Math.min(5, targetWidth / sw));
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

async function recognize(worker, tesseract, canvas, psm, whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_char_whitelist: whitelist,
  });
  const result = await worker.recognize(canvas);
  return {
    text: norm(result?.data?.text || ""),
    confidence: Number(result?.data?.confidence || 0),
    data: result?.data || {},
  };
}

function chassisCandidates(text = "", core = "") {
  const out = new Set();
  const normalized = norm(text).toUpperCase().replace(/[‐‑‒–—―ー−]/g, "-");
  if (!canonicalCode(core) || core.length < 3) return [];

  const add = (prefixRaw, suffixRaw) => {
    const prefix = String(prefixRaw || "").replace(/[^A-Z0-9]/g, "");
    const suffix = numericPart(suffixRaw);
    if (suffix.length < 5 || suffix.length > 9) return;
    if (similarity(prefix, core) < 0.70) return;
    out.add(`${core}-${suffix}`);
  };

  for (const match of normalized.matchAll(/([A-Z0-9]{3,10})\s*[- ]\s*((?:[0-9OQDI|!BGSZ]\s*){5,9})/g)) {
    add(match[1], match[2]);
  }

  const collapsed = normalized.replace(/\s+/g, "");
  for (let i = 0; i < Math.max(0, collapsed.length - 7); i += 1) {
    for (let prefixLen = Math.max(3, core.length - 2); prefixLen <= Math.min(core.length + 2, 10); prefixLen += 1) {
      const prefix = collapsed.slice(i, i + prefixLen);
      if (similarity(prefix, core) < 0.74) continue;
      const rest = collapsed.slice(i + prefixLen, i + prefixLen + 10);
      const suffixMatch = rest.match(/^[-]?([0-9OQDI|!BGSZ]{5,9})/);
      if (suffixMatch) add(prefix, suffixMatch[1]);
    }
  }
  return [...out];
}

function chooseChassis(observations, core) {
  const counts = new Map();
  for (const observation of observations) {
    for (const value of new Set(chassisCandidates(observation.text, core))) {
      const item = counts.get(value) || { value, support: 0, confidence: 0 };
      item.support += 1;
      item.confidence += observation.confidence;
      counts.set(value, item);
    }
  }
  const ranked = [...counts.values()].sort((a, b) => b.support - a.support || b.confidence - a.confidence);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.support < 2) return null;
  if (second && second.support === best.support && second.value !== best.value && Math.abs(second.confidence - best.confidence) < 12) return null;
  return best;
}

const CORP = /(株式会社|有限会社|合同会社)/;
const NAME_STOP = /(?:住所|本拠|車台番号|車両番号|登録年月|交付年月|初度|有効期間|原動機|型式指定|類別区分|燃料|乗車定員|車両重量|総重量|長さ|幅|高さ|軸重)/;

function cleanCompanyCandidate(value = "") {
  let text = norm(value)
    .replace(/[_＿]+/g, " ")
    .replace(/^[|｜:：・=\s]+/, "")
    .replace(/[|｜\[\]【】]+.*$/, "")
    .trim();
  const index = text.search(CORP);
  if (index < 0) return "";
  text = text.slice(index).trim();
  const stop = text.search(NAME_STOP);
  if (stop > 0) text = text.slice(0, stop).trim();
  text = text.replace(/\s{2,}/g, " ").replace(/[,:：;；]+$/g, "").trim();
  const useful = (text.match(/[一-龠々ぁ-んァ-ヶA-Za-z]/g) || []).length;
  if (!CORP.test(text) || useful < 5 || text.length > 36) return "";
  return text;
}

function companyCandidates(text = "") {
  const chunks = norm(text).split(/\n|\||｜/).map(value => value.trim()).filter(Boolean);
  const out = [];
  for (const chunk of chunks) {
    const candidate = cleanCompanyCandidate(chunk);
    if (candidate) out.push(candidate);
  }
  const whole = cleanCompanyCandidate(text);
  if (whole) out.push(whole);
  return [...new Set(out)];
}

function nameKey(value = "") {
  return norm(value).replace(/[\s・._＿|｜-]+/g, "").toUpperCase();
}

function nameSimilarity(a = "", b = "") {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length, 1);
}

function chooseUserName(observations, anchorConfidence) {
  const entries = [];
  for (const observation of observations) {
    for (const value of companyCandidates(observation.text)) {
      entries.push({ value, pass: observation.pass, confidence: observation.confidence });
    }
  }
  const groups = [];
  for (const entry of entries) {
    let group = groups.find(item => nameSimilarity(item.values[0].value, entry.value) >= 0.80);
    if (!group) {
      group = { values: [], passes: new Set() };
      groups.push(group);
    }
    group.values.push(entry);
    group.passes.add(entry.pass);
  }
  groups.sort((a, b) => b.passes.size - a.passes.size || b.values.reduce((s, x) => s + x.confidence, 0) - a.values.reduce((s, x) => s + x.confidence, 0));
  const best = groups[0];
  if (best?.passes.size >= 2) {
    const pool = [...best.values].sort((a, b) => b.confidence - a.confidence || b.value.length - a.value.length);
    return { value: pool[0].value, support: best.passes.size, mode: "multi-pass" };
  }

  // 法人格を含む完全候補は、ラベル位置が十分確かな場合に限り1passでも採用する。
  const strongSingle = entries
    .filter(item => anchorConfidence >= 0.70 && item.confidence >= 40 && CORP.test(item.value))
    .sort((a, b) => b.confidence - a.confidence || b.value.length - a.value.length)[0];
  if (strongSingle) return { value: strongSingle.value, support: 1, mode: "strong-company-single" };
  return null;
}

function engineCandidates(text = "") {
  const normalized = compact(text)
    .replace(/原動機の型式|原動機型式/g, "")
    .replace(/[^A-Z0-9-]/g, " ");
  const out = new Set();
  for (const match of normalized.matchAll(/[A-Z0-9]{2,8}-[A-Z0-9]{2,8}/g)) {
    const value = match[0];
    if (/[A-Z]/.test(value) && /\d/.test(value)) out.add(value);
  }
  for (const match of normalized.matchAll(/(?:^|\s)([A-Z]{1,4}\d[A-Z0-9]{1,8})(?=$|\s)/g)) {
    out.add(match[1]);
  }
  return [...out].filter(value => value.length >= 3 && value.length <= 18);
}

function chooseEngine(observations) {
  const counts = new Map();
  for (const observation of observations) {
    for (const value of new Set(engineCandidates(observation.text))) {
      const item = counts.get(value) || { value, support: 0, confidence: 0 };
      item.support += 1;
      item.confidence += observation.confidence;
      counts.set(value, item);
    }
  }
  const ranked = [...counts.values()].sort((a, b) => b.support - a.support || b.confidence - a.confidence);
  const best = ranked[0];
  if (!best || best.support < 2) return null;
  const second = ranked[1];
  if (second && second.support === best.support && second.value !== best.value && Math.abs(second.confidence - best.confidence) < 12) return null;
  return best;
}

function ruledRightOrFallback(detector, anchor, page, width = 0.40) {
  const ruled = detector.detect(anchor, page.width, page.height);
  const right = ruled.find(item => item.direction === "right");
  if (right?.region) return { region: right.region, source: "ruled-right" };
  const labelHeight = Math.max(0.018, (anchor.bbox.y1 - anchor.bbox.y0) / page.height);
  return {
    region: relativeRegionFromAnchor(anchor, page.width, page.height, {
      direction: "right",
      gap: 0.001,
      width,
      height: Math.max(0.034, labelHeight * 2.0),
      padY: Math.max(0.004, labelHeight * 0.38),
    }),
    source: "right-fallback",
  };
}

function chassisBand(anchors, page) {
  const upper = anchors.registrationNumber;
  const lower = anchors.registrationDate;
  if (!upper || !lower) return null;
  const top = Math.max(0, upper.bbox.y1 / page.height + 0.004);
  const bottom = Math.min(0.98, lower.bbox.y0 / page.height - 0.004);
  if (bottom - top < 0.022 || bottom - top > 0.16) return null;
  return { x: 0.03, y: top, width: 0.84, height: bottom - top };
}

function pipelineReady() {
  const pre = document.querySelector("#certificate-layout-recognition-v6-debug pre");
  return /共通罫線セルOCR v6 完了/.test(pre?.textContent || "");
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById("certificate-targeted-cell-recovery-v13-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-targeted-cell-recovery-v13-debug";
    box.open = true;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #69a985";
    box.style.borderRadius = "12px";
    box.style.background = "#ecfdf5";
    box.innerHTML = '<summary style="font-weight:800">罫線＋ラベル追従 弱セル再読取 v13（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

export default function CertificateTargetedCellRecoveryV13() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;

    let sourceFile = null;
    let generation = 0;
    let running = false;
    let completed = false;
    let poll = 0;

    const recover = async currentGeneration => {
      if (!sourceFile || running || completed || currentGeneration !== generation) return;
      const wants = {
        chassisNumber: needsChassisRecovery(),
        userName: needsUserRecovery(),
        engineModel: needsEngineRecovery(),
      };
      if (!Object.values(wants).some(Boolean)) {
        completed = true;
        showDebug(["状態: v13 再読取不要", "未確定対象: なし"]);
        return;
      }

      running = true;
      let worker = null;
      try {
        showDebug(["状態: ラベル・罫線位置を探索中", `対象: ${Object.entries(wants).filter(([, value]) => value).map(([key]) => key).join(" / ")}`]);
        const session = await createDocumentRecognitionSession(sourceFile, {
          maxSide: 2800,
          cropPaper: true,
          minPaperConfidence: 0.45,
        });
        if (currentGeneration !== generation) return;

        const page = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        worker = shared.worker;
        const t = shared.tesseract;
        const layoutResult = await recognize(worker, t, page, t.PSM?.SPARSE_TEXT ?? 11, "");
        const tokens = extractOcrTokens(layoutResult.data);
        const detector = createRuledGridDetector(page);

        const anchors = {
          registrationNumber: findLabelAnchor(tokens, ["自動車登録番号又は車両番号", "自動車登録番号", "車両番号"], { minSimilarity: 0.58, maxTokens: 12 }),
          registrationDate: findLabelAnchor(tokens, ["登録年月日／交付年月日", "登録年月日", "交付年月日"], { minSimilarity: 0.58, maxTokens: 12 }),
          chassisNumber: findLabelAnchor(tokens, ["車台番号"], { minSimilarity: 0.68, maxTokens: 6 }),
          userName: findLabelAnchor(tokens, ["使用者の氏名又は名称", "使用者氏名又は名称", "氏名又は名称"], { minSimilarity: 0.56, maxTokens: 12 }),
          engineModel: findLabelAnchor(tokens, ["原動機の型式", "原動機型式"], { minSimilarity: 0.62, maxTokens: 8 }),
        };

        const patch = {};
        const lines = [
          "状態: 罫線＋ラベル追従 弱セル再読取 v13 完了",
          `位置探索OCR: 1pass / tokens=${tokens.length} / conf=${layoutResult.confidence.toFixed(1)}`,
        ];

        if (wants.chassisNumber && needsChassisRecovery()) {
          let region = null;
          let mode = "";
          if (anchors.chassisNumber) {
            const located = ruledRightOrFallback(detector, anchors.chassisNumber, page, 0.55);
            region = located.region;
            mode = `label-${located.source}`;
          }
          if (!region) {
            region = chassisBand(anchors, page);
            mode = "between-registration-rows";
          }

          if (!region) {
            lines.push("車台番号: 安全な対象帯を確定できず → 空欄維持");
          } else {
            const observations = [];
            for (const [pass, source, psm] of [
              ["original-p6", page, t.PSM?.SINGLE_BLOCK ?? 6],
              ["original-p11", page, t.PSM?.SPARSE_TEXT ?? 11],
              ["contrast-p6", session.prepared.variants.contrast || page, t.PSM?.SINGLE_BLOCK ?? 6],
            ]) {
              const result = await recognize(worker, t, cropRegion(source, region, 4200), psm, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
              observations.push({ ...result, pass });
            }
            const chosen = chooseChassis(observations, modelCore());
            if (chosen) {
              patch.chassisNumber = chosen.value;
              lines.push(`車台番号: ${chosen.value} / ${mode} / support=${chosen.support}`);
            } else {
              lines.push(`車台番号: 複数pass一致なし → 空欄維持 / ${mode}`);
            }
            if (anchors.chassisNumber) lines.push(`  chassis-label=${anchors.chassisNumber.matchedText} conf=${anchors.chassisNumber.confidence.toFixed(2)}`);
            lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 180) || "(空)"}`));
          }
        }

        if (wants.userName && needsUserRecovery()) {
          const anchor = anchors.userName;
          if (!anchor) {
            lines.push("使用者名: ラベル位置を確定できず → 空欄維持");
          } else {
            const located = ruledRightOrFallback(detector, anchor, page, 0.62);
            const observations = [];
            for (const [pass, source, psm] of [
              ["original-p6", page, t.PSM?.SINGLE_BLOCK ?? 6],
              ["original-p7", page, t.PSM?.SINGLE_LINE ?? 7],
              ["contrast-p6", session.prepared.variants.contrast || page, t.PSM?.SINGLE_BLOCK ?? 6],
            ]) {
              const result = await recognize(worker, t, cropRegion(source, located.region, 4200), psm, "");
              observations.push({ ...result, pass });
            }
            const chosen = chooseUserName(observations, anchor.confidence);
            if (chosen) {
              patch.userName = chosen.value;
              lines.push(`使用者名: ${chosen.value} / ${located.source} / ${chosen.mode}`);
            } else {
              lines.push(`使用者名: 安全な完全候補なし → 空欄維持 / ${located.source}`);
            }
            lines.push(`  label=${anchor.matchedText} conf=${anchor.confidence.toFixed(2)}`);
            lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 200) || "(空)"}`));
          }
        }

        if (wants.engineModel && needsEngineRecovery()) {
          const anchor = anchors.engineModel;
          if (!anchor) {
            lines.push("原動機型式: ラベル位置を確定できず → 空欄維持");
          } else {
            const located = ruledRightOrFallback(detector, anchor, page, 0.42);
            const observations = [];
            for (const [pass, source, psm] of [
              ["original-p6", page, t.PSM?.SINGLE_BLOCK ?? 6],
              ["original-p7", page, t.PSM?.SINGLE_LINE ?? 7],
              ["original-p13", page, t.PSM?.RAW_LINE ?? 13],
              ["contrast-p7", session.prepared.variants.contrast || page, t.PSM?.SINGLE_LINE ?? 7],
            ]) {
              const result = await recognize(worker, t, cropRegion(source, located.region, 4200), psm, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
              observations.push({ ...result, pass });
            }
            const chosen = chooseEngine(observations);
            if (chosen) {
              patch.engineModel = chosen.value;
              lines.push(`原動機型式: ${chosen.value} / ${located.source} / support=${chosen.support}`);
            } else {
              lines.push(`原動機型式: 複数pass完全一致なし → 空欄維持 / ${located.source}`);
            }
            lines.push(`  label=${anchor.matchedText} conf=${anchor.confidence.toFixed(2)}`);
            lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 180) || "(空)"}`));
          }
        }

        if (Object.keys(patch).length) {
          window.__vehicleCertificateTargetedV13Patch = patch;
          if (patch.chassisNumber) setReactInputValue(fieldInput("車台番号"), patch.chassisNumber);
          if (patch.userName) setReactInputValue(fieldInput("使用者の氏名又は名称"), patch.userName);
          if (patch.engineModel) setReactInputValue(fieldInput("原動機の型式"), patch.engineModel);
          for (let i = 0; i < 5; i += 1) {
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
            await new Promise(resolve => setTimeout(resolve, 320));
          }
        }

        completed = true;
        showDebug(lines);
      } catch (error) {
        showDebug(["状態: v13 エラー", String(error?.message || error)]);
      } finally {
        running = false;
        if (worker) await worker.terminate().catch(() => {});
      }
    };

    const maybeStart = () => {
      if (!sourceFile || running || completed || !pipelineReady()) return;
      void recover(generation);
    };

    const onChange = event => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      sourceFile = file;
      generation += 1;
      running = false;
      completed = false;
      showDebug(["状態: v6完了後、罫線と周辺ラベルから未確定セルだけ再読取します"]);
    };

    document.addEventListener("change", onChange, true);
    poll = window.setInterval(maybeStart, 600);

    return () => {
      document.removeEventListener("change", onChange, true);
      clearInterval(poll);
      generation += 1;
    };
  }, []);

  return null;
}
