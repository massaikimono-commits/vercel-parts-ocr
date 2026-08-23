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

  const routeMainActions = (event) => {
    if (location.pathname !== "/") return;
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    const text = target.textContent || "";

    const go = (path) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      location.assign(path);
    };

    if (text.includes("①車体番号")) return go("/vehicle-workflow");
    if (text.includes("③データ")) return go("/parts-data");
    if (text.includes("②伝票OCR") || text.includes("自動判定OCRで読み込む") || text.includes("高精度OCRで読み込む")) return go("/ocr/auto");
    if (text.includes("④印刷")) return go("/parts-print");
  };

  document.addEventListener("click", routeMainActions, true);
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
