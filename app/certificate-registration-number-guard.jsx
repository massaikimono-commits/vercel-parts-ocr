"use client";

import { useEffect } from "react";

const AUTH_EVENT = "vehicle-certificate-authoritative";

const PLATE_AREAS = new Set([
  "札幌","函館","旭川","室蘭","釧路","帯広","北見",
  "青森","弘前","八戸","岩手","盛岡","平泉","宮城","仙台","秋田","山形","庄内","福島","会津","郡山",
  "水戸","土浦","つくば","宇都宮","那須","とちぎ","群馬","前橋","高崎",
  "大宮","所沢","熊谷","春日部","川越","越谷","川口",
  "千葉","習志野","袖ヶ浦","野田","成田","柏","松戸","市川","船橋","市原",
  "品川","練馬","足立","八王子","多摩","世田谷","杉並","板橋","江東","葛飾",
  "横浜","川崎","湘南","相模",
  "山梨","新潟","長岡","上越","富山","石川","金沢","福井","長野","松本","諏訪",
  "岐阜","飛騨","静岡","浜松","沼津","伊豆","富士山",
  "名古屋","尾張小牧","三河","豊橋","岡崎","豊田","春日井",
  "三重","鈴鹿","伊勢志摩","四日市","滋賀","京都","大阪","なにわ","和泉","堺","神戸","姫路","奈良","飛鳥","和歌山",
  "鳥取","島根","岡山","倉敷","広島","福山","山口","下関","徳島","香川","高松","愛媛","高知",
  "福岡","北九州","久留米","筑豊","佐賀","長崎","佐世保","熊本","大分","宮崎","鹿児島","奄美","沖縄",
]);

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function digits(value = "") {
  return String(value).replace(/\D/g, "");
}

/**
 * Registration numbers must stand on their own.
 * Never recover an area name by taking a substring from an address such as
 * "大阪府松原市" or "大阪府茨木市". If the plate area itself was not read,
 * the value stays blank and the recognition engine gets another chance.
 */
function parseRegistration(value = "") {
  const text = norm(value);
  const re = /(?:^|[\n\r])\s*([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]?\s*[0-9]?)\s*([ぁ-ん])\s*[・･.\- ]*([0-9](?:\s*[0-9]){0,3})\s*(?:$|[\n\r])/g;
  const matches = [...`${text}\n`.matchAll(re)];
  if (!matches.length) {
    // A field input usually contains only one line, so allow the same strict shape without anchors.
    const single = text.match(/^([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]?\s*[0-9]?)\s*([ぁ-ん])\s*[・･.\- ]*([0-9](?:\s*[0-9]){0,3})$/);
    if (!single) return { value: "", raw: text, reason: "形式不一致" };
    matches.push(single);
  }

  const m = matches[matches.length - 1];
  const area = String(m[1] || "").replace(/\s+/g, "");
  const classification = digits(m[2]);
  const kana = String(m[3] || "");
  const serial = digits(m[4]);

  if (!PLATE_AREAS.has(area)) return { value: "", raw: text, reason: `地域名未確定: ${area || "空"}` };
  if (classification.length < 1 || classification.length > 3) return { value: "", raw: text, reason: "分類番号不正" };
  if (!/^[ぁ-ん]$/.test(kana)) return { value: "", raw: text, reason: "かな不正" };
  if (serial.length < 1 || serial.length > 4) return { value: "", raw: text, reason: "一連番号不正" };

  return {
    value: `${area} ${classification} ${kana} ${serial}`,
    raw: text,
    reason: "登録番号欄の文字列として確定",
  };
}

function detailInput() {
  const card = [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes("車検証読み取り情報")
  );
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.querySelector(":scope > span")?.textContent || "");
    if (title !== "自動車登録番号又は車両番号") continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function basicInput() {
  const card = [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes("基本情報")
  );
  if (!card) return null;
  for (const label of card.querySelectorAll("label")) {
    const title = norm(label.childNodes?.[0]?.textContent || "");
    if (title !== "登録番号") continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function setReactInputValue(input, value) {
  if (!(input instanceof HTMLInputElement) || input.value === value) return;
  const key = Object.keys(input).find(name => name.startsWith("__reactProps$"));
  const props = key ? input[key] : null;
  if (typeof props?.onChange === "function") {
    props.onChange({ target: { value }, currentTarget: { value }, preventDefault() {}, stopPropagation() {} });
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const previous = input.value;
  descriptor?.set?.call(input, value);
  if (input._valueTracker) input._valueTracker.setValue(previous);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showDebug(before, after, source, reason = "") {
  const card = [...document.querySelectorAll("section.card")].find(node =>
    node.querySelector("h2")?.textContent?.includes("車検証から読み取る")
  );
  if (!card) return;
  let details = document.getElementById("certificate-registration-number-guard-debug");
  if (!details) {
    details = document.createElement("details");
    details.id = "certificate-registration-number-guard-debug";
    details.style.marginTop = "14px";
    details.style.border = "1px solid #d9e0ea";
    details.style.borderRadius = "12px";
    details.style.padding = "12px";
    details.innerHTML = '<summary style="font-weight:800">登録番号検証（確認用）</summary><div data-registration-guard-content style="margin-top:8px;white-space:pre-wrap"></div>';
    card.appendChild(details);
  }
  const box = details.querySelector("[data-registration-guard-content]");
  if (box) box.textContent = `取得元: ${source}\n読取値: ${before || "(空)"}\n確定値: ${after || "(保留)"}${reason ? `\n${reason}` : ""}`;
}

export default function CertificateRegistrationNumberGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !location.pathname.startsWith("/vehicle-workflow")) return;
    let lastKey = "";

    const sync = () => {
      const detail = detailInput();
      const basic = basicInput();
      if (!detail && !basic) return;

      const qrRaw = window.__vehicleCertificateQrPriority?.registrationNumber || "";
      const fieldRaw = detail?.value || basic?.value || "";
      const raw = qrRaw || fieldRaw;
      if (!raw) return;

      const parsed = parseRegistration(raw);
      const source = qrRaw ? "QR" : "登録番号欄OCR";
      const key = `${source}|${raw}|${parsed.value}|${parsed.reason}`;
      if (key === lastKey) return;
      lastKey = key;

      if (parsed.value) {
        window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { registrationNumber: parsed.value } }));
        if (detail && detail.value !== parsed.value) setReactInputValue(detail, parsed.value);
        if (basic && basic.value !== parsed.value) setReactInputValue(basic, parsed.value);
        showDebug(raw, parsed.value, source, parsed.reason);
        return;
      }

      // Do not transform address-like text into a plate area. Keep it blank and let
      // QR / label-anchored OCR / repeated ensemble OCR try again.
      if (!qrRaw && fieldRaw) {
        if (detail?.value) setReactInputValue(detail, "");
        if (basic?.value) setReactInputValue(basic, "");
      }
      showDebug(raw, "", source, `${parsed.reason}。住所から地域名は推測しません。`);
    };

    sync();
    const timer = window.setInterval(sync, 350);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
