"use client";
import { appLocation as location } from "./lib/internal-navigation";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="routeError" role="alert">
      <section>
        <span>画面エラー</span>
        <h1>この画面を表示できませんでした</h1>
        <p>入力内容を再確認し、まず再試行してください。同じ状態が続く場合はホームへ戻って開き直してください。</p>
        <div>
          <button type="button" onClick={() => reset()}>再試行</button>
          <button type="button" onClick={() => location.assign("/")}>ホームへ</button>
        </div>
      </section>
      <style jsx>{`
        .routeError{min-height:60vh;display:grid;place-items:center;padding:20px;background:#f3f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.routeError section{width:min(520px,100%);background:#fff;border:1px solid #d9e0ea;border-radius:16px;padding:18px}.routeError span{font-size:11px;font-weight:900;color:#b42318}.routeError h1{font-size:21px;margin:4px 0 8px}.routeError p{font-size:13px;line-height:1.55;color:#5f6d80}.routeError div{display:grid;grid-template-columns:1fr 1fr;gap:8px}.routeError button{min-height:44px;border:1px solid #bdcbe0;border-radius:10px;background:#fff;color:#245fae;font-weight:900}.routeError button:first-child{background:#2f6fe4;border-color:#2f6fe4;color:#fff}@media(max-width:600px){.routeError{padding:9px}.routeError section{padding:13px}.routeError h1{font-size:18px}}
      `}</style>
    </main>
  );
}
