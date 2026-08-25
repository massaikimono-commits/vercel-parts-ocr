"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";
import { extractOcrTokens, findLabelAnchor, relativeRegionFromAnchor } from "./lib/document-layout-recognition";

const AUTH_EVENT = "vehicle-certificate-authoritative";

const LABELS = {
  chassisNumber: ["車台番号"],
  userName: ["使用者の氏名又は名称", "使用者氏名又は名称", "氏名又は名称"],
  engineModel: ["原動機の型式", "原動機型式"],
};

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

function modelCore() {
  const raw = fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "";
  const value = compact(raw);
  return value.includes("-") ? value.split("-").pop() : value;
}

function cropRegion(source, region, targetWidth = 3800) {
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
    if (similarity(prefix, core) < 0.68) return;
    out.add(`${core}-${suffix}`);
  };

  for (const match of normalized.matchAll(/([A-Z0-9]{3,10})\s*[- ]\s*((?:[0-9OQDI|!BGSZ]\s*){5,9})/g)) {
    add(match[1], match[2]);
  }

  const collapsed = normalized.replace(/\s+/g, "");
  for (let i = 0; i < Math.max(0, collapsed.length - 7); i += 1) {
    for (let prefixLen = Math.max(3, core.length - 2); prefixLen <= Math.min(core.length + 2, 10); prefixLen += 1) {
      const prefix = collapsed.slice(i, i + prefixLen);
      if (similarity(prefix, core) < 0.72) continue;
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
const NAME_FORBIDDEN = /基本情報|使用者・所有者情報|使用者所有者情報|車両詳細|自動車検査証|記録事項|車両番号|車台番号|登録年月|交付年月|初度|有効期間|住所|本拠|原動機|型式指定|類別区分|燃料|乗車定員|車両重量|総重量|長さ|幅|高さ|軸重/;

function cleanNameLine(value = "") {
  let text = norm(value)
    .replace(/^[|｜:：・_=\s]+/, "")
    .replace(/[|｜]+$/g, "")
    .replace(/使用者の氏名又は名称|使用者氏名又は名称|氏名又は名称/g, "")
    .trim();
  if (!text || NAME_FORBIDDEN.test(text)) return "";
  if (/^(株式会社|有限会社|合同会社)$/.test(text)) return "";
  if (/^(令和|平成|昭和)?\s*\d/.test(text)) return "";
  if (/[都道府県市区町村丁目番地]/.test(text) && !CORP.test(text)) return "";
  const useful = (text.match(/[一-龠々ぁ-んァ-ヶA-Za-z]/g) || []).length;
  if (useful < 2 || text.length > 60) return "";
  if (CORP.test(text)) {
    const start = text.search(CORP);
    text = text.slice(start).trim();
    if (!/(?:株式会社|有限会社|合同会社).{2,}/.test(text)) return "";
  }
  return text;
}

function nameCandidates(text = "") {
  const lines = norm(text).split("\n").map(line => line.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const current = cleanNameLine(lines[i]);
    if (current) out.push(current);
    if (/^(株式会社|有限会社|合同会社)$/.test(lines[i]) && lines[i + 1]) {
      const joined = cleanNameLine(`${lines[i]} ${lines[i + 1]}`);
      if (joined) out.push(joined);
    }
  }
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

function chooseUserName(observations) {
  const groups = [];
  for (const observation of observations) {
    for (const value of nameCandidates(observation.text)) {
      let group = groups.find(item => nameSimilarity(item.values[0].value, value) >= 0.76);
      if (!group) {
        group = { values: [], passes: new Set() };
        groups.push(group);
      }
      group.values.push({ value, confidence: observation.confidence, pass: observation.pass });
      group.passes.add(observation.pass);
    }
  }
  groups.sort((a, b) => {
    const corpA = a.values.some(item => CORP.test(item.value)) ? 1 : 0;
    const corpB = b.values.some(item => CORP.test(item.value)) ? 1 : 0;
    return b.passes.size - a.passes.size || corpB - corpA || b.values.reduce((s, x) => s + x.confidence, 0) - a.values.reduce((s, x) => s + x.confidence, 0);
  });
  const best = groups[0];
  if (!best || best.passes.size < 2) return null;
  const corpValues = best.values.filter(item => CORP.test(item.value));
  const pool = corpValues.length ? corpValues : best.values;
  pool.sort((a, b) => b.confidence - a.confidence || b.value.length - a.value.length);
  return { value: pool[0].value, support: best.passes.size };
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
  for (const match of normalized.matchAll(/(?:^|\s)([A-Z]{1,4}\d[A-Z0-9]{1,7})(?=$|\s)/g)) {
    out.add(match[1]);
  }
  return [...out].filter(value => value.length >= 3 && value.length <= 17);
}

function chooseEngine(observations) {
  const exact = new Map();
  const fuzzy = new Map();
  for (const observation of observations) {
    const values = new Set(engineCandidates(observation.text));
    for (const value of values) {
      const e = exact.get(value) || { value, support: 0, confidence: 0 };
      e.support += 1;
      e.confidence += observation.confidence;
      exact.set(value, e);

      const key = canonicalCode(value);
      const f = fuzzy.get(key) || { key, values: [], support: 0 };
      f.values.push({ value, confidence: observation.confidence });
      f.support += 1;
      fuzzy.set(key, f);
    }
  }

  const exactRanked = [...exact.values()].sort((a, b) => b.support - a.support || b.confidence - a.confidence);
  const bestExact = exactRanked[0];
  if (bestExact?.support >= 2) {
    const second = exactRanked[1];
    if (!second || second.support < bestExact.support || second.value === bestExact.value || Math.abs(second.confidence - bestExact.confidence) >= 12) {
      return { value: bestExact.value, support: bestExact.support, mode: "exact" };
    }
  }

  // O/0・S/5 等だけが割れている場合は、勝手に文字を決めず保留する。
  const fuzzyRanked = [...fuzzy.values()].sort((a, b) => b.support - a.support);
  if (fuzzyRanked[0]?.support >= 2) return { ambiguous: true, support: fuzzyRanked[0].support };
  return null;
}

function pipelineReady() {
  const pre = document.querySelector("#certificate-layout-recognition-v6-debug pre");
  return /共通罫線セルOCR v6 完了/.test(pre?.textContent || "");
}

function anchorRegion(anchor, page, kind) {
  const labelHeight = Math.max(0.018, (anchor.bbox.y1 - anchor.bbox.y0) / page.height);
  const widths = { chassisNumber: 0.60, userName: 0.58, engineModel: 0.36 };
  return relativeRegionFromAnchor(anchor, page.width, page.height, {
    direction: "right",
    gap: 0.002,
    width: widths[kind] || 0.45,
    height: Math.max(0.028, labelHeight * 1.65),
    padY: Math.max(0.003, labelHeight * 0.28),
  });
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById("certificate-targeted-cell-recovery-v12-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-targeted-cell-recovery-v12-debug";
    box.open = true;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #7eb59a";
    box.style.borderRadius = "12px";
    box.style.background = "#ecfdf5";
    box.innerHTML = '<summary style="font-weight:800">ラベル追従 弱セル再読取 v12（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

export default function CertificateTargetedCellRecoveryV12() {
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
        showDebug(["状態: v12 再読取不要", "未確定対象: なし"]);
        return;
      }

      running = true;
      let worker = null;
      try {
        showDebug(["状態: ラベル位置を探索中", `対象: ${Object.entries(wants).filter(([, value]) => value).map(([key]) => key).join(" / ")}`]);

        // 位置探索は低解像度1passだけ。値はラベル右隣の小領域だけを高解像度で読む。
        const session = await createDocumentRecognitionSession(sourceFile, {
          maxSide: 2700,
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
        const anchors = {};
        for (const [key, labels] of Object.entries(LABELS)) {
          if (!wants[key]) continue;
          anchors[key] = findLabelAnchor(tokens, labels, { minSimilarity: 0.46, maxTokens: 10 });
        }

        const patch = {};
        const lines = [
          "状態: ラベル追従 弱セル再読取 v12 完了",
          `位置探索OCR: 1pass / tokens=${tokens.length} / conf=${layoutResult.confidence.toFixed(1)}`,
        ];

        if (wants.chassisNumber && needsChassisRecovery()) {
          const anchor = anchors.chassisNumber;
          if (!anchor) {
            lines.push("車台番号: ラベル位置を確定できず → 空欄維持");
          } else {
            const region = anchorRegion(anchor, page, "chassisNumber");
            const observations = [];
            const defs = [
              ["original-p7", page, t.PSM?.SINGLE_LINE ?? 7],
              ["original-p13", page, t.PSM?.RAW_LINE ?? 13],
              ["contrast-p7", session.prepared.variants.contrast || page, t.PSM?.SINGLE_LINE ?? 7],
            ];
            for (const [pass, source, psm] of defs) {
              const result = await recognize(worker, t, cropRegion(source, region, 4200), psm, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
              observations.push({ ...result, pass });
            }
            const chosen = chooseChassis(observations, modelCore());
            if (chosen) {
              patch.chassisNumber = chosen.value;
              lines.push(`車台番号: ${chosen.value} / label-follow support=${chosen.support}`);
            } else {
              lines.push("車台番号: 複数pass一致なし → 空欄維持");
            }
            lines.push(`  label=${anchor.matchedText} conf=${anchor.confidence.toFixed(2)} y=${Math.round(anchor.bbox.y0)}-${Math.round(anchor.bbox.y1)}`);
            lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 160) || "(空)"}`));
          }
        }

        if (wants.userName && needsUserRecovery()) {
          const anchor = anchors.userName;
          if (!anchor) {
            lines.push("使用者名: ラベル位置を確定できず → 空欄維持");
          } else {
            const region = anchorRegion(anchor, page, "userName");
            const observations = [];
            const defs = [
              ["original-p7", page, t.PSM?.SINGLE_LINE ?? 7],
              ["original-p6", page, t.PSM?.SINGLE_BLOCK ?? 6],
              ["contrast-p7", session.prepared.variants.contrast || page, t.PSM?.SINGLE_LINE ?? 7],
            ];
            for (const [pass, source, psm] of defs) {
              const result = await recognize(worker, t, cropRegion(source, region, 4200), psm, "");
              observations.push({ ...result, pass });
            }
            const chosen = chooseUserName(observations);
            if (chosen) {
              patch.userName = chosen.value;
              lines.push(`使用者名: ${chosen.value} / label-follow support=${chosen.support}`);
            } else {
              lines.push("使用者名: 複数pass一致なし → 空欄維持");
            }
            lines.push(`  label=${anchor.matchedText} conf=${anchor.confidence.toFixed(2)} y=${Math.round(anchor.bbox.y0)}-${Math.round(anchor.bbox.y1)}`);
            lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 180) || "(空)"}`));
          }
        }

        if (wants.engineModel && needsEngineRecovery()) {
          const anchor = anchors.engineModel;
          if (!anchor) {
            lines.push("原動機型式: ラベル位置を確定できず → 空欄維持");
          } else {
            const region = anchorRegion(anchor, page, "engineModel");
            const observations = [];
            const defs = [
              ["original-p7", page, t.PSM?.SINGLE_LINE ?? 7],
              ["original-p13", page, t.PSM?.RAW_LINE ?? 13],
              ["contrast-p7", session.prepared.variants.contrast || page, t.PSM?.SINGLE_LINE ?? 7],
            ];
            for (const [pass, source, psm] of defs) {
              const result = await recognize(worker, t, cropRegion(source, region, 4200), psm, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
              observations.push({ ...result, pass });
            }
            const chosen = chooseEngine(observations);
            if (chosen?.value) {
              patch.engineModel = chosen.value;
              lines.push(`原動機型式: ${chosen.value} / label-follow support=${chosen.support} / ${chosen.mode}`);
            } else if (chosen?.ambiguous) {
              lines.push("原動機型式: O/0・S/5等だけが割れている → 推測せず空欄維持");
            } else {
              lines.push("原動機型式: 複数pass一致なし → 空欄維持");
            }
            lines.push(`  label=${anchor.matchedText} conf=${anchor.confidence.toFixed(2)} y=${Math.round(anchor.bbox.y0)}-${Math.round(anchor.bbox.y1)}`);
            lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 160) || "(空)"}`));
          }
        }

        if (Object.keys(patch).length) {
          window.__vehicleCertificateTargetedV12Patch = patch;
          if (patch.chassisNumber) setReactInputValue(fieldInput("車台番号"), patch.chassisNumber);
          if (patch.userName) setReactInputValue(fieldInput("使用者の氏名又は名称"), patch.userName);
          if (patch.engineModel) setReactInputValue(fieldInput("原動機の型式"), patch.engineModel);
          for (let i = 0; i < 5; i += 1) {
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
            await new Promise(resolve => setTimeout(resolve, 360));
          }
        }

        completed = true;
        showDebug(lines);
      } catch (error) {
        showDebug(["状態: v12 エラー", String(error?.message || error)]);
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
      showDebug(["状態: v6完了後、ラベル位置から未確定セルだけ再読取します"]);
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
