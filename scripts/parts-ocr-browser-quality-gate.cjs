const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function arg(name, fallback = "") {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const baseURL = arg("base-url", "http://127.0.0.1:3000").replace(/\/$/, "");
const manifestPath = arg("manifest");
const outPath = arg("out", "parts-ocr-quality-gate.json");
const runDynamic = arg("dynamic", "false") === "true";
if (!manifestPath) throw new Error("--manifest is required");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest)) throw new Error("manifest must be an array");

const READY_PATTERNS = [
  /\d+件を抽出しました/,
  /\d+件を候補抽出しました/,
  /まだ部品行を抽出できませんでした/,
  /候補を自動抽出できませんでした/,
  /OCR処理でエラー/,
  /汎用OCR処理でエラー/,
];

function now() { return Date.now(); }

async function prepareInitialState(page) {
  await page.goto(baseURL + "/ocr/auto", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("parts-data", "[]");
    localStorage.setItem("parts-active-vehicle", JSON.stringify({
      id: "quality-gate-vehicle",
      number: "0000",
      registration: "QUALITY-GATE",
      chassis: "QUALITY-GATE",
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
}

async function waitForAutoDecision(page, timeoutMs) {
  await page.waitForFunction(() => {
    const p = location.pathname;
    if (p === "/ocr" || p === "/ocr/general") return true;
    if (p !== "/ocr/auto") return true;
    const body = document.body?.innerText || "";
    return body.includes("判定保留") || body.includes("自動判定を確定できませんでした") || body.includes("自動判定を止めました");
  }, { timeout: timeoutMs });
}

async function waitForOcrCompletion(page, timeoutMs) {
  await page.waitForFunction((patterns) => {
    const body = document.body?.innerText || "";
    return patterns.some((s) => body.includes(s));
  }, READY_PATTERNS.map((r) => r.source.replace(/\\d\+/, "")), { timeout: timeoutMs }).catch(async () => {
    await page.waitForFunction(() => {
      const body = document.body?.innerText || "";
      return /\d+件を抽出しました|\d+件を候補抽出しました|まだ部品行を抽出できませんでした|候補を自動抽出できませんでした|OCR処理でエラー|汎用OCR処理でエラー/.test(body);
    }, { timeout: timeoutMs });
  });
}

async function extractParts(page) {
  return await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("section"));
    const target = sections.find((section) => {
      const h2 = section.querySelector("h2");
      return (h2?.textContent || "").includes("抽出データ");
    });
    if (!target) return [];
    const inputs = Array.from(target.querySelectorAll("input"))
      .filter((el) => el.getAttribute("type") !== "file");
    const values = inputs.map((el) => "value" in el ? String(el.value || "") : "");
    const rows = [];
    for (let i = 0; i + 3 < values.length; i += 4) {
      rows.push({ name: values[i], qty: values[i + 1], retail: values[i + 2], cost: values[i + 3] });
    }
    return rows;
  });
}

async function getAutoSnapshot(page) {
  return await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem("__qg_auto_snapshot") || "null"); }
    catch { return null; }
  });
}

async function supplementalDynamic(page, file, timeoutMs) {
  const result = { available: false, dynamicRows: null, nonEmptyRows: null, error: null };
  try {
    const response = await page.goto(baseURL + "/ocr/diagnostic/dynamic", { waitUntil: "domcontentloaded", timeout: 120000 });
    if (!response || response.status() >= 400) return result;
    const input = page.locator('input[type="file"]').first();
    if (!(await input.count())) return result;
    result.available = true;
    await input.setInputFiles(file);
    await page.waitForFunction(() => {
      const value = document.querySelector("textarea")?.value || "";
      return value.includes("診断結論材料:") || value.includes("ERROR:");
    }, { timeout: timeoutMs });
    const report = await page.locator("textarea").inputValue();
    const m = report.match(/診断結論材料:\s*dynamicRows=(\d+)\s*\/\s*rowOCR非空=(\d+)/);
    if (m) {
      result.dynamicRows = Number(m[1]);
      result.nonEmptyRows = Number(m[2]);
    }
    const err = report.match(/ERROR:\s*(.+)/);
    if (err) result.error = err[1];
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const all = [];
  try {
    for (const item of manifest) {
      const file = path.resolve(item.path);
      const row = {
        inputFile: item.filename || path.basename(file),
        set: item.set || "",
        expectedMode: item.expectedMode || "",
        firstPathname: "/ocr/auto",
        autoDecision: "",
        autoReason: "",
        finalPathname: "",
        parts: [],
        extractedRows: 0,
        whiteProfile: false,
        unitPriceToRetail: null,
        costBlank: null,
        processingMs: null,
        jsExceptions: [],
        timedOut: false,
        dynamic: null,
      };
      if (!fs.existsSync(file)) {
        row.timedOut = true;
        row.jsExceptions.push("missing input file: " + file);
        all.push(row);
        continue;
      }

      const context = await browser.newContext({ viewport: { width: 1280, height: 1600 }, locale: "ja-JP" });
      await context.addInitScript(() => {
        setInterval(() => {
          if (location.pathname !== "/ocr/auto") return;
          const body = document.body?.innerText || "";
          const raw = document.querySelector("textarea")?.value || "";
          const mode = body.includes("大一用品商会 専用OCR") ? "dedicated"
            : body.includes("汎用A4・他社伝票OCR") ? "general"
            : body.includes("判定保留") ? "unknown" : "";
          sessionStorage.setItem("__qg_auto_snapshot", JSON.stringify({
            pathname: location.pathname,
            mode,
            body: body.slice(0, 8000),
            raw: raw.slice(0, 16000),
          }));
        }, 80);
      });
      const page = await context.newPage();
      page.on("pageerror", (err) => row.jsExceptions.push(err.message));
      const started = now();
      try {
        await prepareInitialState(page);
        const inputs = page.locator('input[type="file"]');
        const count = await inputs.count();
        if (!count) throw new Error("no file input on /ocr/auto");
        await inputs.nth(Math.max(0, count - 1)).setInputFiles(file);
        await waitForAutoDecision(page, Number(item.autoTimeoutMs || 300000));
        row.finalPathname = new URL(page.url()).pathname;

        const snapshot = await getAutoSnapshot(page);
        row.autoDecision = snapshot?.mode || (row.finalPathname === "/ocr" ? "dedicated" : row.finalPathname === "/ocr/general" ? "general" : "unknown");
        const reasonLine = (snapshot?.body || "").split("\n").find((line) =>
          line.includes("特徴を検出") || line.includes("列構成を検出") || line.includes("汎用表の見出し") || line.includes("安全に確定")
        );
        row.autoReason = reasonLine || "";

        if (row.finalPathname === "/ocr" || row.finalPathname === "/ocr/general") {
          await waitForOcrCompletion(page, Number(item.ocrTimeoutMs || 600000));
          row.parts = await extractParts(page);
          row.extractedRows = row.parts.length;
          const textareas = await page.locator("textarea").allInputValues();
          const debug = textareas.join("\n");
          row.whiteProfile = debug.includes("帳票プロファイル: 白伝票");
          if (item.set && String(item.set).includes("white")) {
            row.costBlank = row.parts.length ? row.parts.every((p) => p.cost === "") : null;
            if (Array.isArray(item.expectedRetail) && item.expectedRetail.length) {
              row.unitPriceToRetail = item.expectedRetail.every((v, i) => row.parts[i]?.retail === String(v));
            }
          }
        }
        row.processingMs = now() - started;

        if (runDynamic && String(item.set).includes("yellow")) {
          row.dynamic = await supplementalDynamic(page, file, Number(item.dynamicTimeoutMs || 600000));
        }
      } catch (e) {
        row.processingMs = now() - started;
        row.timedOut = /Timeout/i.test(String(e));
        row.jsExceptions.push(e instanceof Error ? e.message : String(e));
        try { row.finalPathname = new URL(page.url()).pathname; } catch {}
      } finally {
        await context.close();
      }
      all.push(row);
      console.log(JSON.stringify(row));
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseURL,
    viewport: { width: 1280, height: 1600 },
    results: all,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
