"use client";

import { useEffect } from "react";

const compact = (v = "") =>
  String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function section(title) {
  return (
    Array.from(document.querySelectorAll("section.card")).find((s) =>
      s.querySelector("h2")?.textContent?.includes(title)
    ) || null
  );
}

function detailInput(label) {
  const s = section("車検証読み取り情報");
  if (!s) return null;
  for (const node of Array.from(s.querySelectorAll("label"))) {
    const title = compact(node.querySelector("span")?.textContent || "");
    if (title === compact(label)) return node.querySelector("input");
  }
  return null;
}

function reactProps(el) {
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? el[key] : null;
}

function setNativeValue(el, value) {
  if (!(el instanceof HTMLInputElement)) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function applyThroughReact(el, value) {
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

  const old = el.value;
  setNativeValue(el, value);
  if (el._valueTracker) el._valueTracker.setValue(old);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function eraDate(year, month, day = 0) {
  if (!year || !month) return "";
  const suffix = day ? `${day}日` : "";
  if (year >= 2019) return `令和${year - 2018}年${month}月${suffix}`;
  if (year >= 1989) return `平成${year - 1988}年${month}月${suffix}`;
  if (year >= 1926) return `昭和${year - 1925}年${month}月${suffix}`;
  return "";
}

function yyToYear(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n <= 50 ? 2000 + n : 1900 + n;
}

function date6(v) {
  const s = String(v || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(s) || s === "999999") return "";
  const y = yyToYear(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return eraDate(y, m, d);
}

function month4(v) {
  const s = String(v || "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(s) || s === "9999") return "";
  const y = yyToYear(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (!y || m < 1 || m > 12) return "";
  return eraDate(y, m);
}

function axle(v) {
  const s = compact(v).replace(/\s/g, "");
  if (!/^\d{4}$/.test(s)) return "";
  return String(Number(s) * 10);
}

function qrByPosition(items, n) {
  return items.find((item) =>
    new RegExp(`(?:^|/)QR${n}(?:/|$)`).test(String(item?.label || ""))
  );
}

function parseQr3(items) {
  const q1 = qrByPosition(items, 1);
  const q2 = qrByPosition(items, 2);
  const q3 = qrByPosition(items, 3);
  if (!q1 || !q2 || !q3) return null;

  const joined = [q1, q2, q3]
    .map((x) => String(x?.data || "").normalize("NFKC").replace(/\u3000/g, " "))
    .join("");
  const f = joined.split("/").map(compact);
  if (f.length < 19 || f[0] !== "2") return null;

  const fuelCode = String(f[18] || "").replace(/\D/g, "");
  const fuelMap = {
    "01": "ガソリン",
    "02": "軽油",
    "03": "LPG",
    "05": "電気",
    "09": "CNG",
    "13": "圧縮水素",
    "14": "ガソリン・電気",
    "16": "軽油・電気",
    "99": "その他",
  };

  return {
    inspectionExpiry: date6(f[3]),
    firstRegistration: month4(f[4]),
    model: compact(f[5]).replace(/\s/g, "").toUpperCase(),
    frontFrontAxleWeightKg: axle(f[6]),
    frontRearAxleWeightKg: axle(f[7]),
    rearFrontAxleWeightKg: axle(f[8]),
    rearRearAxleWeightKg: axle(f[9]),
    fuel: fuelMap[fuelCode] || "",
  };
}

function queueFor(v) {
  return [
    ["有効期間の満了する日", v.inspectionExpiry],
    ["初度登録年月", v.firstRegistration],
    ["型式", v.model],
    ["前前軸重 kg", v.frontFrontAxleWeightKg],
    ["前後軸重 kg", v.frontRearAxleWeightKg],
    ["後前軸重 kg", v.rearFrontAxleWeightKg],
    ["後後軸重 kg", v.rearRearAxleWeightKg],
    ["燃料の種類", v.fuel],
  ].filter(([, value]) => Boolean(value));
}

function expectedForInput(el, v) {
  if (!(el instanceof HTMLInputElement) || !v) return "";
  const label = el.closest("label");
  const title = compact(label?.querySelector("span")?.textContent || "");
  const row = queueFor(v).find(([name]) => compact(name) === title);
  return row?.[1] || "";
}

function showStatus(v, state = "") {
  const host = document.getElementById("certificate-qr-debug");
  if (!host) return;
  let box = document.getElementById("certificate-qr-applied-fixed");
  if (!box) {
    box = document.createElement("div");
    box.id = "certificate-qr-applied-fixed";
    box.style.marginTop = "12px";
    box.style.padding = "12px";
    box.style.borderRadius = "12px";
    box.style.background = "#e9f7ef";
    box.style.border = "1px solid #bfe6ce";
    box.style.fontWeight = "800";
    host.appendChild(box);
  }
  if (!v) {
    box.textContent = "QR1〜3の連結データを待っています。";
    return;
  }
  box.textContent = `QRから自動反映: 有効期限 ${v.inspectionExpiry || "未取得"} / 初度登録 ${v.firstRegistration || "未取得"} / 型式 ${v.model || "未取得"} / 前前軸重 ${v.frontFrontAxleWeightKg || "-"}kg / 後後軸重 ${v.rearRearAxleWeightKg || "-"}kg / 燃料 ${v.fuel || "未取得"}${state ? ` / ${state}` : ""}`;
}

export default function CertificateQrApplyFixed() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;

    let values = null;
    let stable = 0;
    let stopped = false;

    const protect = (event) => {
      if (!values) return;
      const el = event.target;
      const expected = expectedForInput(el, values);
      if (!expected || el.value === expected) return;
      event.stopImmediatePropagation();
      event.stopPropagation();
      setNativeValue(el, expected);
    };
    document.addEventListener("input", protect, true);
    document.addEventListener("change", protect, true);

    const tick = () => {
      if (stopped) return;
      const items = Array.isArray(window.__vehicleCertificateQr)
        ? window.__vehicleCertificateQr
        : [];
      if (!items.length) return;

      values = parseQr3(items);
      if (!values) {
        showStatus(null);
        return;
      }

      window.__vehicleCertificateQrPriority = values;
      const queue = queueFor(values);
      const pending = queue.filter(([label, value]) => {
        const el = detailInput(label);
        return !el || el.value !== value;
      });

      if (pending.length) {
        stable = 0;
        const [label, value] = pending[0];
        const el = detailInput(label);
        if (el) applyThroughReact(el, value);
        showStatus(values, `反映中 ${label}`);
        return;
      }

      if (document.querySelector(".progress")) {
        stable = 0;
        showStatus(values, "OCR完了待ち");
        return;
      }

      stable += 1;
      if (stable >= 5) {
        showStatus(values, "反映完了");
        window.clearInterval(timer);
      } else {
        showStatus(values, "反映確認中");
      }
    };

    const timer = window.setInterval(tick, 220);
    tick();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("input", protect, true);
      document.removeEventListener("change", protect, true);
    };
  }, []);

  return null;
}
