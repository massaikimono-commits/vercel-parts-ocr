/** Pixel-only geometry. No OCR labels, expected counts, or reference coordinates. */
export function detectTableGeometry(image, options = {}) {
  const empty = reason => ({ tableRegions: [], rules: { horizontal: [], vertical: [], intersections: [] }, rowBands: [], columnBands: [], cellProposals: [], diagnostics: { abstained: true, fallback: 'full-page', reason, quality: 0 } });
  const { data, width: w, height: h } = image || {};
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || !data || data.length !== w * h * 4 || w * h > 40_000_000) return empty('invalid-image-data');
  // Ratios describe long connected strokes and neighbourhood size, not table layout.
  const minRunRatio = options.minRunRatio ?? 0.08;
  if (!(minRunRatio >= 0.03 && minRunRatio <= 0.4)) return empty('invalid-options');
  const gray = new Float32Array(w * h), valid = new Uint8Array(w * h), border = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    gray[i] = .299 * r + .587 * g + .114 * b;
    valid[i] = data[p + 3] > 127 && Math.max(r, g, b) - Math.min(r, g, b) < 55 ? 1 : 0;
    // Background hue is independent of the neutral-stroke mask. Transparent
    // boundary samples cannot establish a visible background polarity.
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && data[p + 3] > 127) border.push(gray[i]);
  }
  if (!border.length) return empty('background-polarity-unavailable');
  border.sort((a, b) => a - b);
  const darkBackground = border[Math.floor(border.length / 2)] < 128;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let sum = 0; for (let x = 0; x < w; x++) { sum += gray[y * w + x]; integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + sum; } }
  const ink = new Uint8Array(w * h), radius = Math.max(3, Math.round(Math.min(w, h) * .025));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    const mean = (integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    const i = y * w + x; ink[i] = valid[i] && (darkBackground ? gray[i] - mean : mean - gray[i]) > 3 ? 1 : 0;
  }
  function scan(horizontal) {
    const outer = horizontal ? h : w, inner = horizontal ? w : h, minimum = Math.max(12, Math.ceil(inner * minRunRatio)), strokes = [];
    for (let a = 0; a < outer; a++) { let start = -1; for (let b = 0; b <= inner; b++) {
      const hit = b < inner && ink[horizontal ? a * w + b : b * w + a];
      if (hit && start < 0) start = b;
      // Bridge at most two pixels of isolated stroke damage, never missing lines.
      if (!hit && start >= 0) {
        let next = b + 1; while (next < Math.min(inner, b + 3) && !ink[horizontal ? a * w + next : next * w + a]) next++;
        if (next < inner && next <= b + 2 && ink[horizontal ? a * w + next : next * w + a]) { b = next - 1; continue; }
        if (b - start >= minimum) strokes.push({ pos: a, lo: start, hi: b - 1, thickness: 1 }); start = -1;
      }
    } }
    const merged = [];
    for (const s of strokes) {
      const last = merged.findLast(t => s.pos - t.last <= 2 && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) >= .8 * Math.min(s.hi - s.lo, t.hi - t.lo));
      if (last) { last.pos = (last.pos * last.thickness + s.pos) / (last.thickness + 1); last.thickness++; last.last = s.pos; last.lo = Math.min(last.lo, s.lo); last.hi = Math.max(last.hi, s.hi); }
      else merged.push({ ...s, last: s.pos });
    }
    return merged.map((s, i) => ({ id: `${horizontal ? 'h' : 'v'}${i}`, ...s, box: horizontal ? { x: s.lo, y: Math.round(s.pos - (s.thickness - 1) / 2), width: s.hi - s.lo + 1, height: s.thickness } : { x: Math.round(s.pos - (s.thickness - 1) / 2), y: s.lo, width: s.thickness, height: s.hi - s.lo + 1 } }));
  }
  const horizontal = scan(true), vertical = scan(false), intersections = [], nodes = [...horizontal, ...vertical], parent = nodes.map((_, i) => i);
  const root = i => { while (parent[i] !== i) i = parent[i]; return i; };
  for (let i = 0; i < horizontal.length; i++) for (let j = 0; j < vertical.length; j++) {
    const a = horizontal[i], b = vertical[j], tolerance = Math.max(2, a.thickness, b.thickness);
    if (b.pos >= a.lo - tolerance && b.pos <= a.hi + tolerance && a.pos >= b.lo - tolerance && a.pos <= b.hi + tolerance) {
      intersections.push({ horizontalId: a.id, verticalId: b.id, x: b.pos, y: a.pos }); parent[root(i)] = root(horizontal.length + j);
    }
  }
  const groups = new Map(); nodes.forEach((n, i) => { const k = root(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); });
  const tableRegions = [], rowBands = [], columnBands = [], cellProposals = [];
  const variance = values => { const mean = values.reduce((a, b) => a + b, 0) / values.length; return values.length ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) / Math.max(1, mean) : 0; };
  for (const group of groups.values()) {
    const hs = group.filter(n => n.id[0] === 'h').sort((a, b) => a.pos - b.pos), vs = group.filter(n => n.id[0] === 'v').sort((a, b) => a.pos - b.pos);
    if (hs.length < 3 || vs.length < 2) continue;
    const crosses = intersections.filter(p => hs.some(a => a.id === p.horizontalId) && vs.some(b => b.id === p.verticalId));
    const completeness = crosses.length / (hs.length * vs.length);
    // Partial boundaries cannot safely establish cell topology.
    if (completeness < .95) continue;
    const id = `table${tableRegions.length}`, box = { x: vs[0].pos, y: hs[0].pos, width: vs.at(-1).pos - vs[0].pos, height: hs.at(-1).pos - hs[0].pos };
    const rows = hs.slice(1).map((line, i) => ({ tableId: id, index: i, box: { x: box.x, y: hs[i].pos, width: box.width, height: line.pos - hs[i].pos } }));
    const cols = vs.slice(1).map((line, i) => ({ tableId: id, index: i, box: { x: vs[i].pos, y: box.y, width: line.pos - vs[i].pos, height: box.height } }));
    if (rows.some(r => r.box.height < 4) || cols.some(c => c.box.width < 4)) continue;
    const endpointResidual = hs.reduce((s, a) => s + Math.abs(a.lo - box.x) + Math.abs(a.hi - box.x - box.width), 0) / (hs.length * 2 * box.width) + vs.reduce((s, a) => s + Math.abs(a.lo - box.y) + Math.abs(a.hi - box.y - box.height), 0) / (vs.length * 2 * box.height);
    if (endpointResidual > .03) continue;
    const stability = { normalizedRowPitch: rows.map(r => r.box.height / box.height), normalizedColumnPositions: vs.map(v => (v.pos - box.x) / box.width), rowPitchVariation: variance(rows.map(r => r.box.height)), columnWidthVariation: variance(cols.map(c => c.box.width)), normalizedBoundaryResidual: endpointResidual };
    tableRegions.push({ id, box, quality: completeness * Math.max(0, 1 - endpointResidual), qualityBasis: 'observed-rule-topology-only', sourceCoverage: box.width * box.height / (w * h), stability }); rowBands.push(...rows); columnBands.push(...cols);
    for (const row of rows) for (const col of cols) {
      const cell = { x: col.box.x, y: row.box.y, width: col.box.width, height: row.box.height }, inset = 2 + Math.ceil(Math.max(...hs.map(a => a.thickness), ...vs.map(a => a.thickness)) / 2);
      let count = 0, area = 0;
      for (let y = Math.ceil(cell.y + inset); y < cell.y + cell.height - inset; y++) for (let x = Math.ceil(cell.x + inset); x < cell.x + cell.width - inset; x++) { count += ink[y * w + x]; area++; }
      cellProposals.push({ tableId: id, rowIndex: row.index, columnIndex: col.index, box: cell, inkFraction: area ? count / area : null, visibleInk: area ? count > 0 : null, blank: area ? count === 0 : null, quality: completeness, semanticField: null });
    }
  }
  return { tableRegions, rules: { horizontal, vertical, intersections }, rowBands, columnBands, cellProposals, diagnostics: { abstained: !tableRegions.length, fallback: tableRegions.length ? null : 'full-page', reason: tableRegions.length ? null : 'insufficient-axis-aligned-complete-rule-boundaries', quality: tableRegions.length ? Math.min(...tableRegions.map(t => t.quality)) : 0, polarity: darkBackground ? 'light-on-dark' : 'dark-on-light', rectification: 'none', skewPolicy: 'unresolved-skew-abstains', sourceCoverage: tableRegions.reduce((s, t) => s + t.sourceCoverage, 0), parameters: { minRunRatio, adaptiveRadius: radius, contrastThreshold: 3 } } };
}
