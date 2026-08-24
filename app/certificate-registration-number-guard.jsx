"use client";

import { useEffect } from "react";

const PLATE_AREAS = [
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
].sort((a, b) => b.length - a.length);

function norm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function digits(value = "") {
  return String(value).replace(/\D/g, "");
}

function bestArea(prefix = "") {
  const text = norm(prefix).replace(/\s+/g, "");
  let best = "";
  let bestEnd = -1;
  for (const area of PLATE_AREAS) {
    const i = text.lastIndexOf(area);
    if (i < 0) continue;
    const end = i + area.length;
    if (end > bestEnd || (end === bestEnd && area.length > best.length)) {
      best = area;
      bestEnd = end;
    }
  }
  return best;
}

function parseRegistration(value = "") {
  const text = norm(value);
  const re = /([ぁ-んァ-ヶ一-龠]{1,20})\s*([0-9]\s*[0-9]?\s*[0-9]?)\s*([ぁ-ん])\s*[・･.\- ]*([0-9](?:\s*[0-9]){0,3})/g;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return { value: "", suspicious: false, raw: text };

  const m = matches[matches.length - 1];
  const prefix = String(m[1] || "").replace(/\s+/g, "");
  const classification = digits(m[2]);
  const kana = m[3] || "";
  const serial = digits(m[4]);
  if (!classification || classification.length > 3 || !kana || !serial || serial.length > 4) {
    return { value: "", suspicious: true, raw: text, prefix, area: "" };
  }

  const known = bestArea(prefix);
  if (!known) {
    return { value: "", suspicious: true, raw: text, prefix, area: "" };
  }

  return {
    value: `${known} ${classification} ${kana} ${serial}`,
    suspicious: prefix !== known,
    raw: text,
    prefix,
    area: known,
  };
}

function findRegistrationInput() {
  for (const label of document.querySelectorAll("label")) {
    const text = (label.childNodes?.[0]?.textContent || label.textContent || "").trim();
    if (!text.startsWith("登録番号")) continue;
    const input = label.querySelector("input");
    if (input instanceof HTMLInputElement) return input;
  }
  return null;
}

function setReactInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showDebug(before, after, source, reason = "") {
  const card = [...document.querySelectorAll("section.card")].find((node) =>
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
    const summary = document.createElement("summary");
    summary.style.fontWeight = "800";
    summary.textContent = "登録番号補正（確認用）";
    details.appendChild(summary);
    card.appendChild(details);
  }

  let box = details.querySelector("[data-registration-guard-content]");
  if (!box) {
    box = document.createElement("div");
    box.dataset.registrationGuardContent = "1";
    box.style.marginTop = "8px";
    box.style.whiteSpace = "pre-wrap";
    details.appendChild(box);
  }
  box.textContent = `${source}優先\n補正前: ${before || "(空)"}\n補正後: ${after || "(保留)"}${reason ? `\n${reason}` : ""}`;
}

export default function CertificateRegistrationNumberGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !location.pathname.startsWith("/vehicle-workflow")) return;

    let lastKey = "";
    const sync = () => {
      const input = findRegistrationInput();
      if (!input) return;

      const qrRaw = window.__vehicleCertificateQrPriority?.registrationNumber || "";
      const current = input.value || "";
      const source = qrRaw ? "QR" : "OCR";
      const raw = qrRaw || current;
      if (!raw) return;

      const parsed = parseRegistration(raw);
      const key = `${source}|${raw}|${parsed.value}|${parsed.suspicious ? 1 : 0}`;
      if (key === lastKey) return;
      lastKey = key;

      if (parsed.value) {
        if (parsed.value !== current) setReactInputValue(input, parsed.value);
        if (parsed.value !== raw || parsed.suspicious || qrRaw) {
          showDebug(raw, parsed.value, source, parsed.suspicious ? "住所などの余分な地名を除外しました。" : "");
        }
        return;
      }

      if (parsed.suspicious) {
        if (!qrRaw && current) setReactInputValue(input, "");
        showDebug(raw, "", source, "実在するナンバープレート地域名として確定できないため保留（空欄）にしました。");
      }
    };

    sync();
    const timer = window.setInterval(sync, 300);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
