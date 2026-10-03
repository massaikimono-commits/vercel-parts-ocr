import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 720, padding: "24px 16px" }}>
      <section className="card">
        <h1>ページが見つかりません</h1>
        <p>リンク先が変更された可能性があります。ホームから目的の画面を開いてください。</p>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "8px 12px" }}>ホームへ戻る</Link>
      </section>
    </main>
  );
}
