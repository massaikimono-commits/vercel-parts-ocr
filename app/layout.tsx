import "./globals.css";
import AuthRouteGuard from "./auth-route-guard";
import SessionLifetimeGuard from "./session-lifetime-guard";
import MobileQuickNav from "./mobile-quick-nav";

export const metadata = {
  title: "部品伝票OCR・印刷",
  description: "部品伝票から4項目を抽出して指定用紙へ印刷",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-image-preview": "none",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return (
    <html lang="ja">
      <body>
        <SessionLifetimeGuard />
        <AuthRouteGuard>
          {children}
          <MobileQuickNav />
        </AuthRouteGuard>
      </body>
    </html>
  );
}
