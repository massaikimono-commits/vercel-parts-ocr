"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

function compact(v = "") {
  return String(v || "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, "").trim();
}

function isCertificateInput(node) {
  if (!(node instanceof HTMLInputElement) || node.type !== "file") return false;
  const section = node.closest("section.card");
  return !!section?.querySelector("h2")?.textContent?.includes("車検証から読み取る");
}

function fieldValue(label) {
  const wanted = compact(label);
  for (const node of document.querySelectorAll("section.card .grid label")) {
    const text = compact(node.querySelector("span")?.textContent || node.childNodes?.[0]?.textContent || node.textContent || "");
    if (!text.startsWith(wanted)) continue;
    return node.querySelector("input,select")?.value || "";
  }
  return "";
}

function numberOrZero(v) {
  const s = String(v || "").trim();
  if (!s || s === "-") return 0;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function modelFamily(model = "") {
  const t = compact(model).toUpperCase();
  return (t.split("-").pop() || t).replace(/[^A-Z0-9]/g, "");
}

function repairedChassis(current = "", model = "") {
  const c = compact(current).toUpperCase();
  const m = modelFamily(model);
  const hit = c.match(/^([A-Z0-9]{3,9})-(\d{4,10})$/);
  if (!hit || !m) return "";
  const left = hit[1];
  if (left === m) return c;
  if ((m.endsWith(left) || left.endsWith(m)) && Math.abs(m.length - left.length) <= 2) return `${m}-${hit[2]}`;
  return "";
}

function send(patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!Object.keys(clean).length) return;
  window.__vehicleCertificatePhotoPriority = { ...(window.__vehicleCertificatePhotoPriority || {}), ...clean };
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: clean }));
}

function safeDerivedPatch() {
  const patch = {};
  const model = fieldValue("型式") || window.__vehicleCertificatePhotoPriority?.model || window.__vehicleCertificateQrPriority?.model || "";
  const currentChassis = fieldValue("車台番号");
  const repaired = repairedChassis(currentChassis, model);
  if (repaired && repaired !== compact(currentChassis).toUpperCase()) patch.chassisNumber = repaired;

  const axleLabels = ["前前軸重kg", "前後軸重kg", "後前軸重kg", "後後軸重kg"];
  const axleValues = axleLabels.map(fieldValue);
  const haveAllAxles = axleValues.every((v) => String(v || "").trim() !== "");
  if (!fieldValue("車両重量kg") && haveAllAxles) {
    const sum = axleValues.reduce((a, b) => a + numberOrZero(b), 0);
    if (sum >= 300 && sum <= 30000) patch.vehicleWeightKg = String(sum);
  }

  if (!fieldValue("最大積載量kg") && compact(fieldValue("用途")) === "乗用") patch.maxPayloadKg = "-";

  if (!fieldValue("使用の本拠の位置")) {
    const debugText = Array.from(document.querySelectorAll("details pre")).map((x) => x.textContent || "").join("\n");
    if (/使用者住所に同じ/.test(debugText)) patch.baseLocation = "使用者住所に同じ";
  }

  return patch;
}

async function sourceCanvas(file) {
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
    const scale = Math.min(1, 3800 / Math.max(iw, ih));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cropRegion(source, x0, y0, w0, h0, binary = false, target = 3000) {
  const sx = Math.round(source.width * x0), sy = Math.round(source.height * y0);
  const sw = Math.max(1, Math.round(source.width * w0)), sh = Math.max(1, Math.round(source.height * h0));
  const scale = Math.max(1, Math.min(8, target / Math.max(1, sw)));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const im = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  for (let p = 0; p < im.data.length; p += 4) {
    const g = Math.round(im.data[p] * .22 + im.data[p + 1] * .70 + im.data[p + 2] * .08);
    sum += g;
    im.data[p] = im.data[p + 1] = im.data[p + 2] = g;
  }
  const th = Math.max(100, Math.min(215, sum / Math.max(1, im.data.length / 4) - 15));
  for (let p = 0; p < im.data.length; p += 4) {
    const g = im.data[p];
    const v = binary ? (g < th ? 0 : 255) : Math.max(0, Math.min(255, Math.round((g - 128) * 1.8 + 154)));
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
    im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

function numericTuple(raw) {
  const nums = (String(raw || "").replace(/,/g, "").match(/\d{2,5}/g) || []).map(Number);
  const axle = ["前前軸重kg", "前後軸重kg", "後前軸重kg", "後後軸重kg"].map(fieldValue);
  const haveAllAxles = axle.every((v) => String(v || "").trim() !== "");
  const axleSum = haveAllAxles ? axle.reduce((a, b) => a + numberOrZero(b), 0) : 0;
  const knownGross = numberOrZero(fieldValue("車両総重量kg"));
  const kei = compact(fieldValue("自動車の種別")) === "軽自動車";
  let best = null;

  for (let a = 0; a < nums.length - 4; a += 1)
    for (let b = a + 1; b < nums.length - 3; b += 1)
      for (let c = b + 1; c < nums.length - 2; c += 1)
        for (let d = c + 1; d < nums.length - 1; d += 1)
          for (let e = d + 1; e < nums.length; e += 1) {
            const [weight, gross, length, width, height] = [nums[a], nums[b], nums[c], nums[d], nums[e]];
            if (weight < 300 || weight > 30000 || gross < weight || gross > 50000) continue;
            if (length < 100 || length > 3000 || width < 100 || width > 300 || height < 100 || height > 450) continue;
            if (kei && (weight > 2200 || gross > 3000 || length > 340 || width > 148 || height > 220)) continue;
            let score = 1;
            if (axleSum && weight === axleSum) score += 15;
            else if (axleSum && Math.abs(weight - axleSum) <= 20) score += 8;
            if (knownGross && gross === knownGross) score += 12;
            if (kei && length <= 340 && width <= 148) score += 6;
            if (!best || score > best.score) best = { score, weight, gross, length, width, height };
          }
  return best;
}

function decimalCandidate(raw) {
  const t = String(raw || "").replace(/,/g, ".").replace(/[^0-9.]/g, " ");
  const vals = t.match(/\d+(?:\.\d+)?/g) || [];
  const candidates = vals.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < 20);
  return candidates.find((n) => n < 10 && !Number.isInteger(n)) || null;
}

function showStatus(text) {
  const host = document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-photo-derived-v2-status");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-photo-derived-v2-status";
    box.style.marginTop = "10px";
    box.style.padding = "10px";
    box.style.borderRadius = "10px";
    box.style.background = "#eef4ff";
    box.style.border = "1px solid #c8d8fb";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }
  box.textContent = text;
}

export default function CertificatePhotoDerivedV2() {
  useEffect(() => {
    if (location.pathname !== "/vehicle-workflow-v2" && location.pathname !== "/vehicle-workflow-fast") return;
    let dead = false;
    let token = 0;

    const onChange = (event) => {
      const input = event.target;
      if (!isCertificateInput(input)) return;
      const file = input.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const id = ++token;

      void (async () => {
        for (let i = 0; i < 70 && !dead && id === token; i += 1) {
          if (!document.querySelector(".progress")) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (dead || id !== token) return;
        await new Promise((resolve) => setTimeout(resolve, 450));

        const derived = safeDerivedPatch();
        send(derived);

        const needDimensions = ["長さcm", "幅cm", "高さcm"].some((label) => !fieldValue(label));
        const needOutput = !fieldValue("総排気量又は定格出力");
        if (!needDimensions && !needOutput) {
          showStatus(`写真補完v2: 安全導出 ${Object.keys(derived).length}項目 / 追加OCR不要`);
          return;
        }

        showStatus("写真補完v2: 不足している数値セルだけ再読取中…");
        const source = await sourceCanvas(file);
        const t = await import("./lib/tesseract-local");
        const worker = await t.createWorker("eng", 1);
        let tuple = null;
        let output = null;
        let passes = 0;
        const logs = [];
        try {
          const P = t.PSM;
          const sparse = P?.SPARSE_TEXT ?? "11";
          const line = P?.SINGLE_LINE ?? "7";

          if (needDimensions) {
            let raw = "";
            // 軽自動車記録事項の「車両重量/総重量/長さ/幅/高さ」1行を広めに読む。
            for (const plan of [[0.485, false], [0.510, false], [0.500, true], [0.530, true]]) {
              const [y, binary] = plan;
              passes += 1;
              const c = cropRegion(source, .055, y, .89, .105, binary, 3200);
              try {
                await worker.setParameters({
                  tessedit_pageseg_mode: String(sparse),
                  preserve_interword_spaces: "1",
                  user_defined_dpi: "300",
                  tessedit_char_whitelist: "0123456789 -kgKGMcmCM",
                });
                const part = (await worker.recognize(c)).data.text || "";
                raw += `\n${part}`;
                logs.push(`寸法${binary ? "白黒" : "灰"}@${y}=${compact(part).slice(0, 90)}`);
              } finally {
                c.width = 1;
                c.height = 1;
              }
              tuple = numericTuple(raw);
              if (tuple && tuple.score >= 12) break;
            }
          }

          if (needOutput) {
            // 右端の「総排気量又は定格出力」セル。軽自動車では 0.xx L が多い。
            for (const plan of [[.805, .555, .16, .075, false], [.800, .575, .17, .070, true]]) {
              passes += 1;
              const [x, y, w, h, binary] = plan;
              const c = cropRegion(source, x, y, w, h, binary, 1800);
              try {
                await worker.setParameters({
                  tessedit_pageseg_mode: String(line),
                  preserve_interword_spaces: "1",
                  user_defined_dpi: "300",
                  tessedit_char_whitelist: "0123456789.,LlkKWw ",
                });
                const raw = (await worker.recognize(c)).data.text || "";
                logs.push(`排気量${binary ? "白黒" : "灰"}=${compact(raw)}`);
                output = decimalCandidate(raw);
                if (output) break;
              } finally {
                c.width = 1;
                c.height = 1;
              }
            }
          }
        } finally {
          source.width = 1;
          source.height = 1;
          await worker.terminate().catch(() => {});
        }

        if (dead || id !== token) return;
        const patch = {};
        if (tuple) {
          if (!fieldValue("車両重量kg")) patch.vehicleWeightKg = String(tuple.weight);
          if (!fieldValue("車両総重量kg")) patch.grossVehicleWeightKg = String(tuple.gross);
          if (!fieldValue("長さcm")) patch.lengthCm = String(tuple.length);
          if (!fieldValue("幅cm")) patch.widthCm = String(tuple.width);
          if (!fieldValue("高さcm")) patch.heightCm = String(tuple.height);
        }
        if (output && !fieldValue("総排気量又は定格出力")) patch.displacementOrRatedOutput = String(output);
        send(patch);
        showStatus(`写真補完v2: 安全導出 ${Object.keys(derived).length}項目 / 数値OCR ${passes}pass / ${tuple ? `寸法score ${tuple.score}` : "寸法候補なし"}${output ? ` / 排気量 ${output}` : ""}${logs.length ? ` / ${logs.join(" | ").slice(0, 180)}` : ""}`);
      })().catch((e) => {
        if (!dead && id === token) showStatus(`写真補完v2エラー: ${e?.message || e}`);
      });
    };

    document.addEventListener("change", onChange, true);
    return () => {
      dead = true;
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
