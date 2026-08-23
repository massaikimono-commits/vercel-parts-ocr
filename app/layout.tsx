import "./globals.css";

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
  };

  const routeFromTarget = (event) => {
    if (location.pathname !== "/") return false;
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return false;
    const text = target.textContent || "";

    let path = "";
    if (text.includes("①車体番号")) path = "/vehicle-workflow";
    else if (text.includes("⑤顧客・車両管理")) path = "/customer-vehicles";
    else if (text.includes("③データ")) path = "/parts-data";
    else if (text.includes("②伝票OCR") || text.includes("自動判定OCRで読み込む") || text.includes("高精度OCRで読み込む")) path = "/ocr/auto";
    else if (text.includes("④印刷")) path = "/parts-print";

    if (!path) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    location.assign(path);
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
        {children}
        <script dangerouslySetInnerHTML={{ __html: photoPickerEnhancer }} />
      </body>
    </html>
  );
}
