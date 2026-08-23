import "./globals.css";

export const metadata = {
  title: "部品伝票OCR・印刷",
  description: "部品伝票から4項目を抽出して指定用紙へ印刷"
};

const photoPickerEnhancer = `
(() => {
  const enhance = () => {
    // 旧OCR画面ではライブラリ選択もできるようにする。
    // 新しい /ocr 画面には撮影用とライブラリ用を別々に用意しているため触らない。
    if (location.pathname !== "/") return;

    const input = document.querySelector(
      'input[type="file"][accept="image/*"][capture]'
    );

    if (input) {
      input.removeAttribute("capture");
    }

    document.querySelectorAll("button").forEach((button) => {
      if (button.textContent?.includes("部品伝票を撮影・読み込む")) {
        button.textContent = "📷 高精度OCRで読み込む";
      }
      if (button.textContent?.includes("撮影 / 写真から読み込む")) {
        button.textContent = "📷 高精度OCRで読み込む";
      }
    });
  };

  const goHighAccuracyOCR = (event) => {
    if (location.pathname !== "/") return;
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    const text = target.textContent || "";
    if (text.includes("②伝票OCR") || text.includes("高精度OCRで読み込む")) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      location.assign("/ocr");
    }
  };

  document.addEventListener("click", goHighAccuracyOCR, true);
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
