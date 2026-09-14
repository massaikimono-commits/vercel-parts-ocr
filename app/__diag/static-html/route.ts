export const runtime = "edge";

const HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ICB Static Diagnostic</title>
  <style>
    html,body{margin:0;padding:0;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    .card{max-width:680px;border:2px solid #111;border-radius:16px;padding:24px}
    h1{margin:0 0 12px;font-size:28px}
    p{margin:8px 0;font-size:18px;line-height:1.5}
    code{font-size:16px}
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>ICB STATIC DIAG PASS</h1>
      <p>JavaScriptなしの静的HTML診断ページです。</p>
      <p>これが表示されれば、Workers.dev / iPhoneで静的HTML配信は成立しています。</p>
      <p><code>STATIC_HTML_V1</code></p>
    </div>
  </main>
</body>
</html>`;

export async function GET() {
  return new Response(HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-icb-diagnostic": "static-html-v1",
    },
  });
}
