import fs from 'node:fs';

const path = 'app/certificate-qr-fast.jsx';
let src = fs.readFileSync(path, 'utf8');

const replacements = [
  [
    '  const densityCenters = qrDensityCenters(source);\n  let found = [];',
    '  const densityCenters = qrDensityCenters(source);\n  window.__certificateQrFastAudit = { pathname: location.pathname, densityCenters: [...densityCenters], reached: [], startedAt: performance.now(), budgetMs };\n  let found = [];'
  ],
  [
    '    await runBand(.755, "color");',
    '    window.__certificateQrFastAudit?.reached.push({ stage: "normalized-band-color", atMs: Math.round(performance.now() - started) });\n    await runBand(.755, "color");'
  ],
  [
    'if (found.length < expected.count && performance.now() - started < budgetMs) await runBand(.785, "contrast");',
    'if (found.length < expected.count && performance.now() - started < budgetMs) { window.__certificateQrFastAudit?.reached.push({ stage: "normalized-band-contrast", atMs: Math.round(performance.now() - started) }); await runBand(.785, "contrast"); }'
  ],
  [
    'if (found.length < expected.count && performance.now() - started < budgetMs) await scanSlots(false, .785, "color");',
    'if (found.length < expected.count && performance.now() - started < budgetMs) { window.__certificateQrFastAudit?.reached.push({ stage: "normalized-slots-color", atMs: Math.round(performance.now() - started) }); await scanSlots(false, .785, "color"); }'
  ],
  [
    'if (found.length < expected.count && performance.now() - started < budgetMs) await scanSlots(false, .805, "contrast");',
    'if (found.length < expected.count && performance.now() - started < budgetMs) { window.__certificateQrFastAudit?.reached.push({ stage: "normalized-slots-contrast", atMs: Math.round(performance.now() - started) }); await scanSlots(false, .805, "contrast"); }'
  ],
  [
    'if (found.length < expected.count && performance.now() - started < budgetMs) await runRawBand(.74, "color");',
    'if (found.length < expected.count && performance.now() - started < budgetMs) { window.__certificateQrFastAudit?.reached.push({ stage: "raw-band-color", atMs: Math.round(performance.now() - started) }); await runRawBand(.74, "color"); }'
  ],
  [
    'if (found.length < expected.count && performance.now() - started < budgetMs) await scanSlots(true, .765, "contrast");',
    'if (found.length < expected.count && performance.now() - started < budgetMs) { window.__certificateQrFastAudit?.reached.push({ stage: "raw-slots-contrast", atMs: Math.round(performance.now() - started) }); await scanSlots(true, .765, "contrast"); }'
  ],
  [
    'if (found.length < expected.count && performance.now() - started < budgetMs) await runRawBand(.755, "binary");',
    'if (found.length < expected.count && performance.now() - started < budgetMs) { window.__certificateQrFastAudit?.reached.push({ stage: "raw-band-binary", atMs: Math.round(performance.now() - started) }); await runRawBand(.755, "binary"); }'
  ],
  [
    '  const expected = expectedCertificateQrCount(found);\n  return {',
    '  const expected = expectedCertificateQrCount(found);\n  if (window.__certificateQrFastAudit) { window.__certificateQrFastAudit.finishedAtMs = Math.round(performance.now() - started); window.__certificateQrFastAudit.finalCount = found.length; window.__certificateQrFastAudit.expected = expected; window.__certificateQrFastAudit.scanTags = found.map((item) => item.scanTag || ""); window.__certificateQrFastAudit.budgetReached = performance.now() - started >= budgetMs; }\n  return {'
  ]
];

for (const [needle, replacement] of replacements) {
  if (!src.includes(needle)) {
    throw new Error(`audit instrumentation target not found: ${needle.slice(0, 90)}`);
  }
  src = src.replace(needle, replacement);
}

fs.writeFileSync(path, src);
console.log('Applied eval-only CertificateQrFast observation instrumentation.');
