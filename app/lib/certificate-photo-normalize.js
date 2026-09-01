"use client";

function normText(value) {
  return String(value || "").normalize("NFKC").replace(/\u3000/g, " ").trim();
}

export function certificateQrFields(item) {
  return normText(item && item.data)
    .split("/")
    .map((x) => x.trim());
}

function parseEraDate(value) {
  const text = normText(value);
  const m = text.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return 0;
  const eraYear = m[2] === "元" ? 1 : Number(m[2]);
  const year = m[1] === "令和" ? 2018 + eraYear : m[1] === "平成" ? 1988 + eraYear : 1925 + eraYear;
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return 0;
  return year * 10000 + month * 100 + day;
}

export function expectedCertificateQrCount(items, recordDate) {
  const list = Array.isArray(items) ? items : [];
  const kei = list.some((item) => certificateQrFields(item)[0] === "K");
  if (!kei) return { count: 5, kind: "registered", label: "登録車5QR" };
  const date = parseEraDate(recordDate);
  if (date >= 20240101 && date <= 20240331) {
    return { count: 2, kind: "kei-legacy", label: "軽・令和6年1〜3月 2QR" };
  }
  return { count: 6, kind: "kei", label: "軽6QR" };
}

function fitLine(points, axis) {
  if (!points || points.length < 8) return null;
  let work = points.slice();
  let last = null;
  for (let pass = 0; pass < 2; pass += 1) {
    const n = work.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of work) {
      const x = axis === "xByY" ? p.y : p.x;
      const y = axis === "xByY" ? p.x : p.y;
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-6) return null;
    const a = (n * sxy - sx * sy) / den;
    const b = (sy - a * sx) / n;
    last = { a, b, n };
    const residuals = work.map((p) => {
      const x = axis === "xByY" ? p.y : p.x;
      const y = axis === "xByY" ? p.x : p.y;
      return Math.abs(y - (a * x + b));
    });
    const sorted = residuals.slice().sort((x, y) => x - y);
    const limit = sorted[Math.floor(sorted.length * 0.82)] || 9999;
    work = work.filter((_, i) => residuals[i] <= Math.max(3, limit));
    if (work.length < 8) break;
  }
  return last;
}

function intersect(leftOrRight, topOrBottom) {
  if (!leftOrRight || !topOrBottom) return null;
  const ax = leftOrRight.a, bx = leftOrRight.b;
  const ay = topOrBottom.a, by = topOrBottom.b;
  const den = 1 - ax * ay;
  if (Math.abs(den) < 1e-5) return null;
  const x = (ax * by + bx) / den;
  const y = ay * x + by;
  return { x, y };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function detectCertificatePaper(source) {
  const scale = Math.min(1, 720 / Math.max(1, Math.max(source.width, source.height)));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(source.width * scale));
  small.height = Math.max(1, Math.round(source.height * scale));
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, small.width, small.height);
  const data = ctx.getImageData(0, 0, small.width, small.height).data;
  const w = small.width, h = small.height;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 260));
  const isPaper = (x, y) => {
    const i = (y * w + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const bright = (r + g + b) / 3;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return bright >= 92 && chroma <= 105;
  };

  const left = [], right = [];
  for (let y = 0; y < h; y += step) {
    let first = -1, last = -1;
    for (let x = 0; x < w; x += step) {
      if (!isPaper(x, y)) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first >= 0 && last - first >= w * 0.34) {
      left.push({ x: first, y });
      right.push({ x: last, y });
    }
  }

  const top = [], bottom = [];
  for (let x = 0; x < w; x += step) {
    let first = -1, last = -1;
    for (let y = 0; y < h; y += step) {
      if (!isPaper(x, y)) continue;
      if (first < 0) first = y;
      last = y;
    }
    if (first >= 0 && last - first >= h * 0.34) {
      top.push({ x, y: first });
      bottom.push({ x, y: last });
    }
  }

  const lf = fitLine(left, "xByY");
  const rf = fitLine(right, "xByY");
  const tf = fitLine(top, "yByX");
  const bf = fitLine(bottom, "yByX");

  let quad = null;
  if (lf && rf && tf && bf) {
    const tl = intersect(lf, tf);
    const tr = intersect(rf, tf);
    const br = intersect(rf, bf);
    const bl = intersect(lf, bf);
    if (tl && tr && br && bl) {
      const q = [tl, tr, br, bl];
      const area = polygonArea(q);
      const avgW = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
      const avgH = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
      const ratio = avgW / Math.max(1, avgH);
      const inside = q.every((p) => p.x > -w * 0.08 && p.x < w * 1.08 && p.y > -h * 0.08 && p.y < h * 1.08);
      if (inside && area > w * h * 0.22 && ratio > 0.48 && ratio < 0.92) quad = q;
    }
  }

  const allLeft = left.map((p) => p.x);
  const allRight = right.map((p) => p.x);
  const allTop = top.map((p) => p.y);
  const allBottom = bottom.map((p) => p.y);
  const minX = allLeft.length ? Math.max(0, Math.min(...allLeft)) : 0;
  const minY = allTop.length ? Math.max(0, Math.min(...allTop)) : 0;
  const fallback = {
    x: minX,
    y: minY,
    w: allRight.length ? Math.max(1, Math.max(...allRight) - minX) : w,
    h: allBottom.length ? Math.max(1, Math.max(...allBottom) - minY) : h,
  };

  const toSource = (p) => ({ x: p.x / scale, y: p.y / scale });
  small.width = 1; small.height = 1;
  return {
    quad: quad ? quad.map(toSource) : null,
    bounds: { x: fallback.x / scale, y: fallback.y / scale, w: fallback.w / scale, h: fallback.h / scale },
    confidence: quad && lf && rf && tf && bf ? Math.min(1, (lf.n + rf.n + tf.n + bf.n) / 100) : 0.35,
  };
}

function drawTriangle(ctx, source, s0, s1, s2, d0, d1, d2) {
  const den = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(den) < 1e-6) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / den;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / den;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / den;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / den;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / den;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / den;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

export function normalizeCertificateCanvas(source, targetWidth) {
  const width = Math.max(1200, Math.min(2200, Number(targetWidth) || 1800));
  const height = Math.round(width * 1.41421356237);
  const paper = detectCertificatePaper(source);
  const out = document.createElement("canvas");
  out.width = width; out.height = height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);

  if (paper.quad) {
    const q = paper.quad;
    const tl = { x: 0, y: 0 }, tr = { x: width, y: 0 }, br = { x: width, y: height }, bl = { x: 0, y: height };
    drawTriangle(ctx, source, q[0], q[1], q[2], tl, tr, br);
    drawTriangle(ctx, source, q[0], q[2], q[3], tl, br, bl);
    return { canvas: out, mode: "quad", confidence: paper.confidence, paper };
  }

  const b = paper.bounds;
  const sx = Math.max(0, Math.round(b.x));
  const sy = Math.max(0, Math.round(b.y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(b.w)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(b.h)));
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  return { canvas: out, mode: "bbox", confidence: paper.confidence, paper };
}
