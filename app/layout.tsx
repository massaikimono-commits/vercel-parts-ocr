import "./globals.css";

export const metadata = {
  title: "部品伝票OCR・印刷",
  description: "部品伝票から4項目を抽出して指定用紙へ印刷"
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="ja"><body>{children}</body></html>;
}
