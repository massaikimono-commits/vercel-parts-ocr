import "./globals.css";
import AuthRouteGuard from "./auth-route-guard";
import SessionLifetimeGuard from "./session-lifetime-guard";
import MobileQuickNav from "./mobile-quick-nav";
import ResponsiveUxController from "./responsive-ux-controller";
import LayoutDensityCalibration from "./layout-density-calibration";
import DailyReportVisualAlignment from "./daily-report-visual-alignment";
import OperationalRecoveryGuard from "./operational-recovery-guard";
import ClientBootDiagnostic from "./__diag/client-boot-diagnostic";

const earlyRuntimeProbe = String.raw`(() => {
  const scrub = (v) => String(v ?? "")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, "[token]")
    .slice(0, 4000);
  const show = (kind, value) => {
    const detail = kind + "\n" + scrub(value && (value.stack || value.message || value));
    const render = () => {
      let el = document.getElementById("icb-early-runtime-error");
      if (!el) {
        el = document.createElement("pre");
        el.id = "icb-early-runtime-error";
        Object.assign(el.style, {
          position: "fixed", inset: "0", zIndex: "2147483647", margin: "0", padding: "18px",
          background: "white", color: "black", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
          overflow: "auto", font: "12px ui-monospace, SFMono-Regular, Menlo, monospace"
        });
      }
      el.textContent = "ICB_EARLY_RUNTIME_ERROR\n\n" + detail;
      (document.body || document.documentElement).appendChild(el);
    };
    render();
    setTimeout(render, 0);
    setTimeout(render, 250);
    setTimeout(render, 1000);
  };
  window.addEventListener("error", (e) => show("error", e.error || e.message || "unknown"), true);
  window.addEventListener("unhandledrejection", (e) => show("unhandledrejection", e.reason || "unknown"), true);
})();`;

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: earlyRuntimeProbe }} />
      </head>
      <body>
        <ClientBootDiagnostic />
        <SessionLifetimeGuard />
        <AuthRouteGuard>
          {children}
          <ResponsiveUxController />
          <LayoutDensityCalibration />
          <DailyReportVisualAlignment />
          <OperationalRecoveryGuard />
          <MobileQuickNav />
        </AuthRouteGuard>
      </body>
    </html>
  );
}
