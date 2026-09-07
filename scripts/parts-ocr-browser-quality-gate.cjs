const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");

function arg(name, fallback = "") {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const baseURL = arg("base-url", "http://127.0.0.1:3000").replace(/\/$/, "");
const manifestPath = arg("manifest");
const outPath = arg("out", "parts-ocr-quality-gate.json");
const runDynamic = arg("dynamic", "false") === "true";
const assetDir = arg("asset-dir", "");
const replayAssetDir = arg("replay-asset-dir", "");
if (!manifestPath) throw new Error("--manifest is required");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest)) throw new Error("manifest must be an array");
if (assetDir) fs.mkdirSync(assetDir, { recursive: true });

let replayAssets = {};
if (replayAssetDir) {
  const replayManifestPath = path.join(replayAssetDir, "assets-manifest.json");
  if (!fs.existsSync(replayManifestPath)) {
    throw new Error("missing replay asset manifest: " + replayManifestPath);
  }
  replayAssets = JSON.parse(fs.readFileSync(replayManifestPath, "utf8"));
}

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
    if (location.pathname !== "/ocr/auto") return true;
    const section = Array.from(document.querySelectorAll("section")).find((s) =>
      (s.querySelector("h2")?.textContent || "").includes("判定結果")
    );
    if (!section) return false;
    const firstDiv = section.querySelector("div");
    const result = (firstDiv?.textContent || "").trim();
    return result === "大一用品商会 専用OCR" || result === "汎用A4・他社伝票OCR" || result === "判定保留";
  }, undefined, { timeout: timeoutMs });
}

async function waitForExpectedRedirect(page, mode) {
  if (mode !== "dedicated" && mode !== "general") return;
  const target = mode === "dedicated" ? "/ocr" : "/ocr/general";
  await page.waitForURL((url) => url.pathname === target, { timeout: 15000 }).catch(() => {});
}

async function waitForOcrCompletion(page, timeoutMs) {
  await page.waitForFunction(() => {
    const text = document.querySelector("main")?.textContent || "";
    const textareas = Array.from(document.querySelectorAll("textarea"))
      .map((el) => "value" in el ? String(el.value || "") : "");

    if (/\d+件を抽出しました|\d+件を候補抽出しました|まだ部品行を抽出できませんでした|候補を自動抽出できませんでした|OCR処理でエラー|汎用OCR処理でエラー/.test(text)) {
      return true;
    }
    if (location.pathname === "/ocr") {
      return textareas.some((value) => value.trim().length > 20);
    }
    if (location.pathname === "/ocr/general") {
      return textareas.some((value) => value.includes("帳票プロファイル:"));
    }
    return false;
  }, undefined, { timeout: timeoutMs });
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
    }, undefined, { timeout: timeoutMs });
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

function shouldCaptureAsset(url) {
  return /tesseract|traineddata|tessdata|projectnaptha|jsdelivr|unpkg/i.test(url);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const all = [];
  const capturedAssets = {};
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
        externalRequests: [],
      };
      if (!fs.existsSync(file)) {
        row.timedOut = true;
        row.jsExceptions.push("missing input file: " + file);
        all.push(row);
        continue;
      }

      const context = await browser.newContext({ viewport: { width: 1280, height: 1600 }, locale: "ja-JP" });
      if (replayAssetDir) {
        await context.route("**/*", async (route) => {
          const url = route.request().url();
          const hit = replayAssets[url];
          if (hit && hit.file) {
            const local = path.join(replayAssetDir, hit.file);
            if (fs.existsSync(local)) {
              await route.fulfill({
                status: 200,
                body: fs.readFileSync(local),
                contentType: hit.contentType || "application/octet-stream",
              });
              return;
            }
          }
          await route.continue();
        });
      }
      await context.addInitScript(() => {
        setInterval(() => {
          if (location.pathname !== "/ocr/auto") return;
          const sections = Array.from(document.querySelectorAll("section"));
          const resultSection = sections.find((s) => (s.querySelector("h2")?.textContent || "").includes("判定結果"));
          const resultText = (resultSection?.querySelector("div")?.textContent || "").trim();
          const mode = resultText === "大一用品商会 専用OCR" ? "dedicated"
            : resultText === "汎用A4・他社伝票OCR" ? "general"
            : resultText === "判定保留" ? "unknown" : "";
          const reason = (resultSection?.querySelector("p")?.textContent || "").trim();
          const raw = document.querySelector("textarea")?.value || "";
          if (mode) {
            sessionStorage.setItem("__qg_auto_snapshot", JSON.stringify({
              pathname: location.pathname,
              mode,
              reason,
              resultText,
              raw: raw.slice(0, 20000),
            }));
          }
        }, 50);
      });
      const page = await context.newPage();
      const assetTasks = [];
      page.on("pageerror", (err) => row.jsExceptions.push(err.message));
      page.on("request", (req) => {
        const url = req.url();
        if (/^https?:\/\//.test(url) && !url.startsWith(baseURL)) {
          if (!row.externalRequests.includes(url)) row.externalRequests.push(url);
        }
      });
      if (assetDir) {
        page.on("response", (response) => {
          const url = response.url();
          if (!shouldCaptureAsset(url) || !response.ok()) return;
          const task = (async () => {
            try {
              const body = await response.body();
              const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 20);
              const pathname = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
              const ext = path.extname(pathname).slice(0, 12) || ".bin";
              const filename = hash + ext;
              fs.writeFileSync(path.join(assetDir, filename), body);
              capturedAssets[url] = {
                file: filename,
                contentType: response.headers()["content-type"] || "",
                size: body.length,
              };
            } catch (e) {
              capturedAssets[url] = { error: e instanceof Error ? e.message : String(e) };
            }
          })();
          assetTasks.push(task);
        });
      }

      const started = now();
      try {
        await prepareInitialState(page);
        const inputs = page.locator('input[type="file"]');
        const count = await inputs.count();
        if (!count) throw new Error("no file input on /ocr/auto");
        await inputs.nth(Math.max(0, count - 1)).setInputFiles(file);
        await waitForAutoDecision(page, Number(item.autoTimeoutMs || 300000));

        let snapshot = await getAutoSnapshot(page);
        row.autoDecision = snapshot?.mode || "";
        row.autoReason = snapshot?.reason || "";
        await waitForExpectedRedirect(page, row.autoDecision);
        row.finalPathname = new URL(page.url()).pathname;
        if (!row.autoDecision) {
          row.autoDecision = row.finalPathname === "/ocr" ? "dedicated"
            : row.finalPathname === "/ocr/general" ? "general" : "unknown";
          snapshot = await getAutoSnapshot(page);
          row.autoReason = snapshot?.reason || row.autoReason;
        }

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
        const snapshot = await getAutoSnapshot(page).catch(() => null);
        if (!row.autoDecision && snapshot?.mode) row.autoDecision = snapshot.mode;
        if (!row.autoReason && snapshot?.reason) row.autoReason = snapshot.reason;
      } finally {
        await Promise.allSettled(assetTasks);
        await context.close();
      }
      all.push(row);
      console.log(JSON.stringify(row));
    }
  } finally {
    await browser.close();
  }
  if (assetDir) {
    fs.writeFileSync(path.join(assetDir, "assets-manifest.json"), JSON.stringify(capturedAssets, null, 2));
  }
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseURL,
    viewport: { width: 1280, height: 1600 },
    results: all,
    capturedAssets,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
