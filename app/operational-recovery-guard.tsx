"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const SLOW_LOAD_MS = 18000;
const PRINT_PREFIXES = ["/schedule/print", "/parts-print", "/inspection/print"];
const LOADING_MARKERS = ["読み込み中…", "読み込み中...", "読込中…", "読込中...", "空き確認中"];

function isPrintRoute(pathname: string) {
  return PRINT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function pageStillLoading() {
  const text = document.body?.innerText || "";
  return LOADING_MARKERS.some((marker) => text.includes(marker));
}

export default function OperationalRecoveryGuard() {
  const pathname = usePathname() || "/";
  const [offline, setOffline] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setSlow(false);
    setOffline(!navigator.onLine);
    if (isPrintRoute(pathname)) return;

    const online = () => {
      setOffline(false);
      setSlow(false);
    };
    const offlineHandler = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineHandler);

    const timer = window.setTimeout(() => {
      if (pageStillLoading()) setSlow(true);
    }, SLOW_LOAD_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offlineHandler);
    };
  }, [pathname]);

  if (isPrintRoute(pathname) || (!offline && !slow)) return null;

  return (
    <aside className="operationalRecovery" role={offline ? "alert" : "status"} aria-live="polite">
      <div>
        <b>{offline ? "通信がオフラインです" : "読み込みに時間がかかっています"}</b>
        <span>{offline ? "接続を確認してから再読み込みしてください。" : "画面が止まったように見える場合は再読み込みできます。"}</span>
      </div>
      <div className="operationalRecoveryActions">
        <button type="button" onClick={() => location.reload()}>再読み込み</button>
        <button type="button" onClick={() => location.assign("/")}>ホーム</button>
      </div>
      <style jsx global>{`
        .operationalRecovery{position:fixed;z-index:1400;right:14px;bottom:14px;max-width:min(440px,calc(100vw - 28px));display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid #e3b66e;border-radius:14px;background:#fffaf0;color:#5f4512;box-shadow:0 8px 28px rgba(30,40,55,.18)}
        .operationalRecovery>div:first-child{display:grid;gap:2px;min-width:0}.operationalRecovery b{font-size:13px}.operationalRecovery span{font-size:11px;line-height:1.35}.operationalRecoveryActions{display:flex;gap:6px;flex:0 0 auto}.operationalRecoveryActions button{min-height:38px;padding:7px 9px;border:1px solid #cda65d;border-radius:9px;background:#fff;color:#6f521a;font-weight:900}
        @media(max-width:760px){
          html{scroll-padding-bottom:calc(78px + env(safe-area-inset-bottom))}
          input:not([type="checkbox"]):not([type="radio"]),select,textarea{font-size:16px!important}
          button,a,input,select,textarea{touch-action:manipulation}
          button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #72a7ed!important;outline-offset:2px!important}
          .operationalRecovery{left:8px;right:8px;bottom:calc(74px + env(safe-area-inset-bottom));max-width:none;display:grid;grid-template-columns:1fr auto;gap:8px;padding:9px 10px}.operationalRecoveryActions button{min-height:40px}
        }
        @media(min-width:761px){
          button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #72a7ed!important;outline-offset:2px!important}
        }
        @media print{.operationalRecovery{display:none!important}}
      `}</style>
    </aside>
  );
}
