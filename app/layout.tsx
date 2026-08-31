import "./globals.css";
import AuthRouteGuard from "./auth-route-guard";
import CertificatePriorityFix from "./certificate-priority-fix";
import CertificateEssentialFieldsFix from "./certificate-essential-fields-fix";
import CertificateRowPriorityFix from "./certificate-row-priority-fix";
import CertificateFuelClassificationFix from "./certificate-fuel-classification-fix";
import CertificateChassisCorrectionFix from "./certificate-chassis-correction-fix";
import CertificateConsistencyFix from "./certificate-consistency-fix";
import CertificatePdfNativeReader from "./certificate-pdf-native-reader";
import CertificatePdfBridge from "./certificate-pdf-bridge";
import CertificateQrFast from "./certificate-qr-fast";
import CertificateQrRescue from "./certificate-qr-rescue";
import CertificateQrLowerSixFallback from "./certificate-qr-lower-six-fallback";
import CertificateKeiBaseline from "./certificate-kei-baseline";
import CertificateQrApply from "./certificate-qr-apply-fixed";
import CertificatePhotoRescue from "./certificate-photo-rescue";
import CertificateFinalNativeFix from "./certificate-final-native-fix";

export const metadata = {
  title: "部品伝票OCR・印刷",
  description: "部品伝票から4項目を抽出して指定用紙へ印刷"
};

const photoPickerEnhancer = `
(() => {
  const PARTS_KEY = "parts-data";
  const ACTIVE_KEY = "parts-active-vehicle";
  const BEFORE_KEY = "parts-before-ocr-ids";

  const parse = (value, fallback) => {
    try { return JSON.parse(value || ""); } catch { return fallback; }
  };

  const enrichPart = (part, vehicle) => ({
    ...part,
    vehicleId: vehicle?.id || "",
    vehicleNumber: vehicle?.number || "",
    registration: vehicle?.registration || "",
    chassis: vehicle?.chassis || "",
    linkedAt: new Date().toISOString()
  });

  const autoLinkCurrentBatch = () => {
    const vehicle = parse(localStorage.getItem(ACTIVE_KEY), null);
    const before = parse(localStorage.getItem(BEFORE_KEY), null);
    const parts = parse(localStorage.getItem(PARTS_KEY), []);
    if (!vehicle || !Array.isArray(before) || !Array.isArray(parts)) return;

    const beforeIds = new Set(before);
    let changed = false;
    const next = parts.map((part) => {
      if (!part?.id || beforeIds.has(part.id) || part.vehicleId || part.vehicleNumber) return part;
      changed = true;
      return enrichPart(part, vehicle);
    });

    if (changed) localStorage.setItem(PARTS_KEY, JSON.stringify(next));
    if (changed || parts.some((p) => p?.id && !beforeIds.has(p.id))) {
      localStorage.removeItem(BEFORE_KEY);
    }
  };

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && key === PARTS_KEY) {
      const vehicle = parse(localStorage.getItem(ACTIVE_KEY), null);
      const previous = parse(localStorage.getItem(PARTS_KEY), []);
      const incoming = parse(value, null);
      if (vehicle && Array.isArray(previous) && Array.isArray(incoming)) {
        const oldIds = new Set(previous.map((p) => p?.id).filter(Boolean));
        const linked = incoming.map((part) => {
          if (!part?.id || oldIds.has(part.id) || part.vehicleId || part.vehicleNumber) return part;
          return enrichPart(part, vehicle);
        });
        value = JSON.stringify(linked);
      }
    }
    return originalSetItem.call(this, key, value);
  };

  const go = (path, event) => {
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
    }
    location.assign(path);
  };

  const routeForText = (text) => {
    if (text.includes("①車体番号")) return "/vehicle-workflow-v2";
    if (text.includes("⑤顧客・車両管理")) return "/customer-vehicles";
    if (text.includes("③データ")) return "/parts-data";
    if (text.includes("②伝票OCR") || text.includes("自動判定OCRで読み込む") || text.includes("高精度OCRで読み込む")) return "/ocr/auto";
    if (text.includes("④印刷")) return "/parts-print";
    return "";
  };

  const bindDirectRoutes = () => {
    if (location.pathname !== "/") return;
    document.querySelectorAll("button").forEach((button) => {
      const path = routeForText(button.textContent || "");
      if (!path || button.dataset.icbRouteBound === path) return;
      button.dataset.icbRouteBound = path;
      button.addEventListener("click", (event) => go(path, event), true);
    });
  };

  const injectCertificateEntry = () => {
    if (location.pathname !== "/") return;
    const cards = Array.from(document.querySelectorAll("section.card"));
    const card = cards.find((node) => {
      const h1 = node.querySelector("h1");
      return h1 && (h1.textContent || "").trim() === "車体番号";
    });
    if (!card || card.querySelector('[data-icb-certificate-entry="1"]')) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.icbCertificateEntry = "1";
    button.textContent = "📄 車検証PDF・写真を読み取る";
    button.style.width = "100%";
    button.style.margin = "0 0 14px";
    button.style.padding = "16px";
    button.style.borderRadius = "14px";
    button.style.border = "1px solid #2f6fe4";
    button.style.background = "#2f6fe4";
    button.style.color = "#fff";
    button.style.fontSize = "18px";
    button.style.fontWeight = "800";
    button.addEventListener("click", (event) => go("/vehicle-workflow-v2", event), true);

    const h1 = card.querySelector("h1");
    if (h1?.nextSibling) card.insertBefore(button, h1.nextSibling);
    else card.appendChild(button);
  };

  const enhance = () => {
    if (location.pathname !== "/") return;

    const input = document.querySelector(
      'input[type="file"][accept="image/*"][capture]'
    );
    if (input) input.removeAttribute("capture");

    document.querySelectorAll("button").forEach((button) => {
      if (button.textContent?.includes("部品伝票を撮影・読み込む")) {
        button.textContent = "📷 自動判定OCRで読み込む";
      }
      if (button.textContent?.includes("撮影 / 写真から読み込む")) {
        button.textContent = "📷 自動判定OCRで読み込む";
      }
    });

    bindDirectRoutes();
    injectCertificateEntry();
  };

  const routeFromTarget = (event) => {
    if (location.pathname !== "/") return false;
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return false;
    const path = routeForText(target.textContent || "");
    if (!path) return false;
    go(path, event);
    return true;
  };

  document.addEventListener("pointerdown", routeFromTarget, true);
  document.addEventListener("touchstart", routeFromTarget, { capture: true, passive: false });
  document.addEventListener("click", routeFromTarget, true);

  enhance();
  autoLinkCurrentBatch();

  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["capture"]
  });
})();
`;

export default function RootLayout({children}:{children:React.ReactNode}) {
  return (
    <html lang="ja">
      <body>
        <AuthRouteGuard>
          {children}
          <CertificatePriorityFix />
        <CertificateEssentialFieldsFix />
        <CertificateRowPriorityFix />
        <CertificateFuelClassificationFix />
        <CertificateChassisCorrectionFix />
        <CertificateConsistencyFix />
        <CertificatePdfNativeReader />
        <CertificatePdfBridge />
        <CertificateQrFast />
        <CertificateQrRescue />
        <CertificateQrLowerSixFallback />
        <CertificateKeiBaseline />
        <CertificateQrApply />
        <CertificatePhotoRescue />
        <CertificateFinalNativeFix />
          <script dangerouslySetInnerHTML={{ __html: photoPickerEnhancer }} />
        </AuthRouteGuard>
      </body>
    </html>
  );
}
