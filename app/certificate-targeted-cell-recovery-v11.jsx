"use client";

import { useEffect } from "react";
import { createDocumentRecognitionSession, createSharedTesseractWorker } from "./lib/document-recognition-v2";

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
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function numericPart(value = "") {
  return String(value)
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
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

function isCompanyStub(value = "") {
  return /^(株式会社|有限会社|合同会社)$/.test(norm(value));
}

function needsUserRecovery() {
  const value = norm(fieldInput("使用者の氏名又は名称")?.value || "");
  return !value || isCompanyStub(value);
}

function needsChassisRecovery() {
  return !norm(fieldInput("車台番号")?.value || "");
}

function modelCore() {
  const raw = fieldInput("型式")?.value || window.__vehicleCertificateQrPriority?.model || "";
  const value = compact(raw);
  return value.includes("-") ? value.split("-").pop() : value;
}

function crop(source, x, y, width, height, targetWidth = 3600) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * height)));
  const scale = Math.max(1, Math.min(4.2, targetWidth / sw));
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

async function recognizePass(worker, tesseract, canvas, psm, whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_char_whitelist: whitelist,
  });
  const result = await worker.recognize(canvas);
  return { text: norm(result?.data?.text || ""), confidence: Number(result?.data?.confidence || 0) };
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
    const seen = new Set(chassisCandidates(observation.text, core));
    for (const value of seen) {
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

function cleanNameLine(value = "") {
  let text = norm(value)
    .replace(/^[|｜:：・_=\s]+/, "")
    .replace(/[|｜]+$/g, "")
    .replace(/使用者の氏名又は名称|使用者氏名又は名称|氏名又は名称/g, "")
    .trim();
  if (!text || /住所|本拠|車台番号|車両番号|登録年月|初度/.test(text)) return "";
  if (/^(株式会社|有限会社|合同会社)$/.test(text)) return "";
  if ((text.match(/[一-龠々ぁ-んァ-ヶA-Za-z0-9]/g) || []).length < 2 || text.length > 70) return "";
  if (CORP.test(text)) {
    const start = text.search(CORP);
    text = text.slice(start).trim();
    return /(?:株式会社|有限会社|合同会社).{2,}/.test(text) ? text : "";
  }
  if (/[都道府県市区町村丁目番地]/.test(text)) return "";
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

function normalizeNameKey(value = "") {
  return norm(value).replace(/[\s・._＿|｜-]+/g, "").toUpperCase();
}

function nameSimilarity(a = "", b = "") {
  const x = normalizeNameKey(a);
  const y = normalizeNameKey(b);
  if (!x || !y) return 0;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length, 1);
}

function chooseUserName(observations) {
  const groups = [];
  for (const observation of observations) {
    for (const value of nameCandidates(observation.text)) {
      let group = groups.find(item => nameSimilarity(item.values[0].value, value) >= 0.78);
      if (!group) {
        group = { values: [], passes: new Set() };
        groups.push(group);
      }
      group.values.push({ value, confidence: observation.confidence });
      group.passes.add(observation.pass);
    }
  }
  groups.sort((a, b) => b.passes.size - a.passes.size || b.values.reduce((s, x) => s + x.confidence, 0) - a.values.reduce((s, x) => s + x.confidence, 0));
  const best = groups[0];
  if (!best || best.passes.size < 2) return null;
  const corpValues = best.values.filter(item => CORP.test(item.value));
  const pool = corpValues.length ? corpValues : best.values;
  pool.sort((a, b) => b.confidence - a.confidence || b.value.length - a.value.length);
  return { value: pool[0].value, support: best.passes.size };
}

function pipelineReady() {
  const pre = document.querySelector("#certificate-layout-recognition-v6-debug pre");
  return /共通罫線セルOCR v6 完了/.test(pre?.textContent || "");
}

function showDebug(lines) {
  const host = section("車検証から読み取る");
  if (!host) return;
  let box = document.getElementById("certificate-targeted-cell-recovery-v11-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-targeted-cell-recovery-v11-debug";
    box.open = true;
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.border = "1px solid #8fc7a9";
    box.style.borderRadius = "12px";
    box.style.background = "#ecfdf5";
    box.innerHTML = '<summary style="font-weight:800">弱セル重点再読取 v11（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const pre = box.querySelector("pre");
  if (pre) pre.textContent = lines.join("\n");
}

export default function CertificateTargetedCellRecoveryV11() {
  useEffect(() => {
    if (typeof window === "undefined" || location.pathname !== "/vehicle-workflow-v2") return;
    let sourceFile = null;
    let generation = 0;
    let running = false;
    let completed = false;

    const recover = async currentGeneration => {
      if (!sourceFile || running || completed || currentGeneration !== generation) return;
      const wantChassis = needsChassisRecovery();
      const wantUser = needsUserRecovery();
      if (!wantChassis && !wantUser) {
        completed = true;
        showDebug(["状態: 重点再読取不要", "未確定対象: なし"]);
        return;
      }

      running = true;
      let worker = null;
      try {
        showDebug(["状態: 未確定セルだけ高解像度で再読取中", `対象: ${[wantChassis && "車台番号", wantUser && "使用者名"].filter(Boolean).join(" / ")}`]);
        const session = await createDocumentRecognitionSession(sourceFile, { maxSide: 3900, cropPaper: true, minPaperConfidence: 0.45 });
        if (currentGeneration !== generation) return;
        const page = session.prepared.normalized;
        const shared = await createSharedTesseractWorker();
        worker = shared.worker;
        const t = shared.tesseract;
        const patch = {};
        const lines = ["状態: 弱セル重点再読取 v11 完了", "追加全文OCR: なし"];

        if (wantChassis && needsChassisRecovery()) {
          const observations = [];
          for (const [pass, source, psm] of [
            ["original-p6", page, t.PSM?.SINGLE_BLOCK ?? 6],
            ["original-p11", page, t.PSM?.SPARSE_TEXT ?? 11],
            ["contrast-p6", session.prepared.variants.contrast || page, t.PSM?.SINGLE_BLOCK ?? 6],
          ]) {
            const region = crop(source, 0.08, 0.055, 0.82, 0.115, 3600);
            const result = await recognizePass(worker, t, region, psm, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
            observations.push({ ...result, pass });
          }
          const chosen = chooseChassis(observations, modelCore());
          if (chosen) {
            patch.chassisNumber = chosen.value;
            lines.push(`車台番号: ${chosen.value} / targeted support=${chosen.support}`);
          } else {
            lines.push("車台番号: 複数pass一致なし → 空欄維持");
          }
          lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 180) || "(空)"}`));
        }

        if (wantUser && needsUserRecovery()) {
          const observations = [];
          for (const [pass, source, psm] of [
            ["original-p6", page, t.PSM?.SINGLE_BLOCK ?? 6],
            ["original-p11", page, t.PSM?.SPARSE_TEXT ?? 11],
            ["contrast-p6", session.prepared.variants.contrast || page, t.PSM?.SINGLE_BLOCK ?? 6],
          ]) {
            const region = crop(source, 0.08, 0.155, 0.84, 0.145, 3600);
            const result = await recognizePass(worker, t, region, psm, "");
            observations.push({ ...result, pass });
          }
          const chosen = chooseUserName(observations);
          if (chosen) {
            patch.userName = chosen.value;
            lines.push(`使用者名: ${chosen.value} / targeted support=${chosen.support}`);
          } else {
            lines.push("使用者名: 複数pass一致なし → 既存値を維持");
          }
          lines.push(...observations.map(item => `  ${item.pass}: conf=${item.confidence.toFixed(1)} / ${item.text.replace(/\n/g, " | ").slice(0, 220) || "(空)"}`));
        }

        if (Object.keys(patch).length) {
          window.__vehicleCertificateTargetedV11Patch = patch;
          if (patch.chassisNumber) setReactInputValue(fieldInput("車台番号"), patch.chassisNumber);
          if (patch.userName) setReactInputValue(fieldInput("使用者の氏名又は名称"), patch.userName);
          for (let i = 0; i < 4; i += 1) {
            window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: patch }));
            await new Promise(resolve => setTimeout(resolve, 320));
          }
        }
        completed = true;
        showDebug(lines);
      } catch (error) {
        showDebug(["状態: 弱セル重点再読取 v11 エラー", String(error?.message || error)]);
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
      completed = false;
      running = false;
      showDebug(["状態: v6完了を待機中（全画面progress判定なし）"]);
      window.setTimeout(maybeStart, 1000);
    };

    const observer = new MutationObserver(maybeStart);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(maybeStart, 600);
    document.addEventListener("change", onChange, true);

    return () => {
      observer.disconnect();
      window.clearInterval(poll);
      document.removeEventListener("change", onChange, true);
      generation += 1;
    };
  }, []);

  return null;
}
