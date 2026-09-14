"use client";

function scrub(value: unknown) {
  const text = String(value ?? "");
  return text
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, "[token]")
    .slice(0, 4000);
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const detail = [
    `name: ${scrub(error?.name)}`,
    `message: ${scrub(error?.message)}`,
    `digest: ${scrub(error?.digest ?? "")}`,
    "",
    scrub(error?.stack ?? ""),
  ].join("\n");

  return (
    <html lang="ja">
      <body style={{ margin: 0, padding: 20, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        <h1 style={{ fontFamily: "system-ui, sans-serif" }}>ICB_RUNTIME_ERROR</h1>
        <pre id="icb-global-error-detail" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{detail}</pre>
        <button onClick={reset} style={{ padding: "12px 16px", fontSize: 16 }}>Retry</button>
      </body>
    </html>
  );
}
