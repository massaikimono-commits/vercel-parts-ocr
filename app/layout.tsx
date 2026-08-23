import "./globals.css";

export const metadata = {
  title: "部品伝票OCR・印刷",
  description: "部品伝票から4項目を抽出して指定用紙へ印刷"
};

const photoPickerEnhancer = `
(() => {
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

  // iPhone SafariではReactのclick処理より先に確実に捕まえるためpointerdownも使う。
  document.addEventListener("pointerdown", routeFromTarget, true);
  document.addEventListener("touchstart", routeFromTarget, { capture: true, passive: false });
  document.addEventListener("click", routeFromTarget, true);

  enhance();

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
