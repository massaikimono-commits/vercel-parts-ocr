"use client";

import { useEffect } from "react";

const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function visible(node) {
  if (!(node instanceof HTMLElement)) return false;
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function bestSection(title) {
  const all = Array.from(document.querySelectorAll("section.card")).filter((s) =>
    s.querySelector("h2")?.textContent?.includes(title)
  );
  return all.find((s) => visible(s)) || all[all.length - 1] || null;
}

function detailInput(labelText) {
  const section = bestSection("車検証読み取り情報");
  if (!section) return null;
  const found = [];
  for (const label of Array.from(section.querySelectorAll("label"))) {
    const title = compact(label.querySelector("span")?.textContent || "");
    if (title !== compact(labelText)) continue;
    const input = label.querySelector("input");
    if (input) found.push(input);
  }
  return found.find((x) => visible(x)) || found[found.length - 1] || null;
}

function basicFirstInput() {
  const section = bestSection("基本情報");
  if (!section) return null;
  for (const label of Array.from(section.querySelectorAll("label"))) {
    if (!compact(label.textContent || "").startsWith("初度登録")) continue;
    const input = label.querySelector("input");
    if (input) return input;
  }
  return null;
}

function reactProps(el) {
  if (!el) return null;
  const keys = Object.keys(el).filter((k) => k.startsWith("__reactProps$"));
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const props = el[keys[i]];
    if (props && Object.prototype.hasOwnProperty.call(props, "value")) return props;
  }
  return null;
}

function pair(el) {
  if (!(el instanceof HTMLInputElement)) return { live: "-", react: "-" };
  const props = reactProps(el);
  return {
    live: el.value || "-",
    react: props && "value" in props ? String(props.value || "-") : "(react propsなし)",
  };
}

function render() {
  if (!location.pathname.startsWith("/vehicle-workflow")) return;
  const host = document.getElementById("certificate-qr-debug") || document.querySelector("img.preview")?.closest("section.card");
  if (!host) return;
  let box = document.getElementById("certificate-react-props-debug");
  if (!box) {
    box = document.createElement("details");
    box.id = "certificate-react-props-debug";
    box.open = true;
    box.style.marginTop = "12px";
    box.innerHTML = '<summary style="font-weight:800">React値照合（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';
    host.appendChild(box);
  }
  const first = pair(detailInput("初度登録年月"));
  const basic = pair(basicFirstInput());
  const expiry = pair(detailInput("有効期間の満了する日"));
  const qr = window.__vehicleCertificateQrPriority || {};
  const pre = box.querySelector("pre");
  if (!pre) return;
  pre.textContent = [
    `QR初度=${qr.firstRegistration || "-"}`,
    `詳細初度 live=${first.live}`,
    `詳細初度 react=${first.react}`,
    `基本初度 live=${basic.live}`,
    `基本初度 react=${basic.react}`,
    `QR有効期限=${qr.inspectionExpiry || "-"}`,
    `有効期限 live=${expiry.live}`,
    `有効期限 react=${expiry.react}`,
  ].join("\n");
}

export default function CertificateReactPropsDebug() {
  useEffect(() => {
    if (!location.pathname.startsWith("/vehicle-workflow")) return;
    const timer = window.setInterval(render, 500);
    render();
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
