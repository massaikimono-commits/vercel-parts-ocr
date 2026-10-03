export default function Loading() {
  return (
    <main aria-busy="true" style={{ maxWidth: 720, padding: "24px 16px" }}>
      <section className="card" role="status" aria-live="polite">
        <h1>画面を読み込み中…</h1>
        <p>そのままお待ちください。</p>
      </section>
    </main>
  );
}
