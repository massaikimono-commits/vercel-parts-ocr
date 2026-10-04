import assert from 'node:assert/strict';
import { detectTableGeometry } from '../app/ocr/architecture-vnext/row-first-geometry.mjs';

function canvas(w = 400, h = 300, bg = 255) {
  const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = bg; data[i + 3] = 255; }
  return { data, width: w, height: h };
}
function line(im, x0, y0, x1, y1, color = 0) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= steps; k++) { const x = Math.round(x0 + (x1 - x0) * k / Math.max(1, steps)), y = Math.round(y0 + (y1 - y0) * k / Math.max(1, steps)); if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue; const p = (y * im.width + x) * 4; const rgb = Array.isArray(color) ? color : [color, color, color]; im.data.set([...rgb, 255], p); }
}
function table(im, xs, ys, color = 0) { ys.forEach(y => line(im, xs[0], y, xs.at(-1), y, color)); xs.forEach(x => line(im, x, ys[0], x, ys.at(-1), color)); }
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
check('invalid input and blank abstain', () => { for (const im of [null, {}, { width: 20, height: 20, data: [] }, canvas()]) assert.equal(detectTableGeometry(im).diagnostics.abstained, true); });
for (const scale of [1, 2, 3]) check(`scaled measured nonuniform bands ${scale}`, () => {
  const im = canvas(400 * scale, 300 * scale), xs = [50, 120, 210, 340].map(x => x * scale), ys = [40, 70, 120, 190, 250].map(y => y * scale); table(im, xs, ys);
  line(im, 65 * scale, 82 * scale, 90 * scale, 82 * scale);
  const result = detectTableGeometry(im); assert.equal(result.tableRegions.length, 1); assert.equal(result.rowBands.length, 4); assert.equal(result.columnBands.length, 3); assert.equal(result.cellProposals.length, 12); assert.equal(result.cellProposals[3].visibleInk, true); assert.equal(result.cellProposals[0].blank, true); assert.deepEqual(result.rowBands.map(r => r.box.height), [30, 50, 70, 60].map(n => n * scale)); assert.ok(result.tableRegions[0].stability.rowPitchVariation > 0);
});
check('translation and variable column count', () => { const im = canvas(); table(im, [90, 140, 180, 220, 280, 350], [90, 150, 210]); const r = detectTableGeometry(im); assert.equal(r.cellProposals.length, 10); assert.equal(r.tableRegions[0].box.x, 90); });
check('light contrast and dark background', () => { for (const [bg, fg] of [[255, 232], [20, 240]]) { const im = canvas(400, 300, bg); table(im, [50, 180, 340], [40, 90, 150, 250], fg); assert.equal(detectTableGeometry(im).cellProposals.length, 6); } });
check('yellow paper matches white paper geometry', () => {
  const white = canvas(), yellow = canvas();
  for (let p = 0; p < yellow.data.length; p += 4) yellow.data.set([255, 244, 176, 255], p);
  for (const im of [white, yellow]) table(im, [50, 180, 340], [40, 90, 150, 250]);
  const a = detectTableGeometry(white), b = detectTableGeometry(yellow);
  assert.equal(b.tableRegions.length, 1); assert.equal(b.diagnostics.polarity, 'dark-on-light');
  assert.deepEqual(b.rowBands, a.rowBands); assert.deepEqual(b.columnBands, a.columnBands); assert.deepEqual(b.cellProposals, a.cellProposals);
});
check('pictorial colored margin needs no neutral boundary samples', () => {
  const im = canvas();
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (x < 15 || y < 15 || x >= im.width - 15 || y >= im.height - 15) {
      const rgb = ((x + y) % 30 < 15) ? [255, 190, 90] : [90, 220, 255]; im.data.set([...rgb, 255], (y * im.width + x) * 4);
    }
  }
  table(im, [50, 180, 340], [40, 90, 150, 250]);
  const r = detectTableGeometry(im); assert.equal(r.tableRegions.length, 1); assert.equal(r.cellProposals.length, 6); assert.equal(r.diagnostics.polarity, 'dark-on-light');
});
check('transparent boundary fails closed even with interior rules', () => {
  const im = canvas(); table(im, [50, 180, 340], [40, 90, 150, 250]);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (x === 0 || y === 0 || x === im.width - 1 || y === im.height - 1) im.data[(y * im.width + x) * 4 + 3] = 0;
  const r = detectTableGeometry(im); assert.equal(r.diagnostics.abstained, true); assert.equal(r.diagnostics.reason, 'background-polarity-unavailable'); assert.equal(r.diagnostics.quality, 0); assert.equal(r.diagnostics.fallback, 'full-page');
});
check('red scribbles do not invent columns', () => { const im = canvas(); table(im, [50, 180, 340], [40, 90, 150, 250]); line(im, 110, 20, 110, 270, [255, 0, 0]); assert.equal(detectTableGeometry(im).columnBands.length, 2); });
check('two separate tables and text distractor', () => { const im = canvas(800, 500); table(im, [30, 130, 260], [40, 100, 160]); table(im, [430, 550, 740], [250, 320, 400]); line(im, 310, 20, 390, 20); const r = detectTableGeometry(im); assert.equal(r.tableRegions.length, 2); assert.equal(r.cellProposals.length, 8); });
check('missing whole rule yields only actual measured bands', () => { const im = canvas(); table(im, [50, 180, 340], [40, 90, 250]); const r = detectTableGeometry(im); assert.equal(r.rowBands.length, 2); assert.equal(r.rowBands[1].box.height, 160); });
check('broken topology fails closed', () => { const im = canvas(); table(im, [50, 180, 340], [40, 90, 150, 250]); line(im, 165, 150, 195, 150, 255); const r = detectTableGeometry(im); assert.equal(r.diagnostics.abstained, true); assert.equal(r.diagnostics.fallback, 'full-page'); });
check('skewed quadrilateral and geometry loss abstain', () => { const im = canvas(); for (const y of [40, 90, 150, 240]) line(im, 50, y, 340, y + 25); for (const x of [50, 180, 340]) line(im, x, 40 + (x - 50) * 25 / 290, x + 15, 240 + (x - 50) * 25 / 290); assert.equal(detectTableGeometry(im).diagnostics.abstained, true); const lost = canvas(); line(lost, 50, 40, 340, 40); line(lost, 50, 250, 340, 250); assert.equal(detectTableGeometry(lost).diagnostics.abstained, true); });
console.log(`${checks} geometry checks passed`);
