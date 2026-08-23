import "./globals.css";

export const metadata = {
  title: "部品伝票OCR・印刷",
  description: "部品伝票から4項目を抽出して指定用紙へ印刷"
};

const photoPickerEnhancer = `
(() => {
  const enhance = () => {
    const input = document.querySelector(
      'input[type="file"][accept="image/*"][capture]'
    );

    if (input) {
      input.removeAttribute("capture");
    }

    document.querySelectorAll("button").forEach((button) => {
      if (button.textContent?.includes("部品伝票を撮影・読み込む")) {
        button.textContent = "📷 撮影 / 写真から読み込む";
      }
    });
  };

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
