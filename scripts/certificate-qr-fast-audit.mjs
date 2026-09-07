import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.CERT_QR_BASE_URL || 'http://127.0.0.1:3000';
const fixtureDir = process.env.CERT_QR_FIXTURE_DIR;
if (!fixtureDir) throw new Error('CERT_QR_FIXTURE_DIR is required');
const manifestPath = path.join(fixtureDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Missing private manifest: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = manifest.files || [];
if (!files.length) throw new Error('Private manifest has no files');

const browser = await chromium.launch({ headless: true });
const out = [];
try {
  for (const item of files) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(`${baseUrl}/vehicle-workflow-v2`, { waitUntil: 'domcontentloaded' });
    const input = page.locator('section.card').filter({ hasText: '車検証から読み取る' }).locator('input[type=file]').first();
    await input.setInputFiles(path.join(fixtureDir, item.file));
    await page.waitForFunction(() => window.__vehicleCertificateQrFastState?.running === false, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1400);

    const result = await page.evaluate(() => {
      const fast = window.__vehicleCertificateQrFastState || null;
      const audit = window.__certificateQrFastAudit || null;
      const qr = Array.isArray(window.__vehicleCertificateQr) ? window.__vehicleCertificateQr : [];
      const tags = qr.map((x) => String(x?.scanTag || ''));
      const classify = {
        normalizedBandJsqr: tags.filter((x) => x.includes('帯域/norm/y0.755/color/jsQR')).length,
        contrastBandJsqr: tags.filter((x) => x.includes('帯域/norm/y0.785/contrast/jsQR')).length,
        normalizedZxing: tags.filter((x) => x.includes('個別/norm/')).length,
        rawBandJsqr: tags.filter((x) => x.includes('帯域/raw/y0.74/color/jsQR')).length,
        rawZxing: tags.filter((x) => x.includes('個別/raw/')).length,
        binaryBandJsqr: tags.filter((x) => x.includes('帯域/raw/y0.755/binary/jsQR')).length,
      };
      const rescue = document.getElementById('certificate-qr-rescue-status')?.textContent || '';
      const apply = document.getElementById('certificate-qr-applied-fixed')?.textContent || '';
      const filledLabels = [];
      for (const label of document.querySelectorAll('section.card .grid label')) {
        const control = label.querySelector('input,select');
        if (!control || !String(control.value || '').trim()) continue;
        const name = String(label.querySelector('span')?.textContent || label.textContent || '').trim().replace(/\s+/g, ' ');
        if (name) filledLabels.push(name);
      }
      return {
        pathname: location.pathname,
        fastFired: !!fast,
        fast,
        densityCenters: audit?.densityCenters || fast?.densityCenters || [],
        reached: audit?.reached || [],
        budgetReached: audit?.budgetReached ?? ((fast?.elapsed || 0) >= 4600),
        fastElapsedMs: fast?.elapsed || audit?.finishedAtMs || 0,
        stageCounts: classify,
        finalUniqueQr: qr.length,
        scanTags: tags,
        rescueFired: !!rescue,
        applyFixedFired: !!apply,
        filledLabels,
      };
    });

    out.push({ file: item.file, expectedQr: item.expectedQr ?? null, ...result, jsErrors: errors, timeout: !result.fastFired || result.fast?.running === true });
    await page.close();
  }
} finally {
  await browser.close();
}

fs.mkdirSync('audit-results', { recursive: true });
fs.writeFileSync('audit-results/certificate-qr-fast-audit.json', JSON.stringify({ pathname: '/vehicle-workflow-v2', files: out }, null, 2));
console.log(JSON.stringify(out.map(({ file, expectedQr, finalUniqueQr, fastElapsedMs, budgetReached, jsErrors }) => ({ file, expectedQr, finalUniqueQr, fastElapsedMs, budgetReached, jsErrorCount: jsErrors.length })), null, 2));
