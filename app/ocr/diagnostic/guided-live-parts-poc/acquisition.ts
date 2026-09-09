export type Point = { x: number; y: number };
export type Quad = { tl: Point; tr: Point; br: Point; bl: Point };

export type FrameMetrics = {
  coverage: number;
  tiltDeg: number;
  perspectiveDistortion: number;
  sharpness: number;
  brightness: number;
  glareRatio: number;
  stability: number | null;
  score: number;
  eligible: boolean;
  quad: Quad | null;
};

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function dist(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }

function paperLike(r: number, g: number, b: number) {
  const bright = (r + g + b) / 3;
  const yellow = r > 105 && g > 95 && r + g > b * 1.7;
  return bright > 165 || yellow;
}

function detectQuad(canvas: HTMLCanvasElement): Quad | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 320));
  const points: Point[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4;
      if (paperLike(data[p], data[p + 1], data[p + 2])) points.push({ x, y });
    }
  }
  if (points.length < 80) return null;
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const spanY = Math.max(1, maxY - minY);
  const top = points.filter((p) => p.y <= minY + spanY * 0.22);
  const bottom = points.filter((p) => p.y >= maxY - spanY * 0.22);
  if (top.length < 8 || bottom.length < 8) return null;
  const tl = top.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b));
  const tr = top.reduce((a, b) => (a.x - a.y > b.x - b.y ? a : b));
  const bl = bottom.reduce((a, b) => (a.x - a.y < b.x - b.y ? a : b));
  const br = bottom.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));
  if (dist(tl, tr) < w * 0.35 || dist(bl, br) < w * 0.35 || dist(tl, bl) < h * 0.2) return null;
  return { tl, tr, br, bl };
}

function polygonArea(q: Quad) {
  const p = [q.tl, q.tr, q.br, q.bl];
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = p[i]; const b = p[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function sharpnessScore(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 240));
  let sum = 0; let sum2 = 0; let n = 0;
  const gray = (x: number, y: number) => { const p = (y * w + x) * 4; return d[p] * .2 + d[p + 1] * .72 + d[p + 2] * .08; };
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const c = gray(x, y);
      const lap = 4 * c - gray(x - step, y) - gray(x + step, y) - gray(x, y - step) - gray(x, y + step);
      sum += lap; sum2 += lap * lap; n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.max(0, sum2 / n - mean * mean);
}

function lightMetrics(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { brightness: 0, glareRatio: 1 };
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(2, Math.floor(Math.max(w, h) / 240));
  let total = 0; let glare = 0; let n = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const p = (y * w + x) * 4;
    const v = (d[p] + d[p + 1] + d[p + 2]) / 3;
    total += v; if (d[p] > 248 && d[p + 1] > 248 && d[p + 2] > 248) glare += 1; n += 1;
  }
  return { brightness: n ? total / n : 0, glareRatio: n ? glare / n : 1 };
}

function normalizedQuadDelta(a: Quad | null, b: Quad | null, w: number, h: number) {
  if (!a || !b) return null;
  const pairs: Array<[Point, Point]> = [[a.tl,b.tl],[a.tr,b.tr],[a.br,b.br],[a.bl,b.bl]];
  const diag = Math.hypot(w, h) || 1;
  return pairs.reduce((s, [p, q]) => s + dist(p, q) / diag, 0) / 4;
}

export function analyzeGuidedFrame(canvas: HTMLCanvasElement, previousQuad: Quad | null): FrameMetrics {
  const q = detectQuad(canvas);
  const lights = lightMetrics(canvas);
  const sharp = sharpnessScore(canvas);
  if (!q) return { coverage: 0, tiltDeg: 90, perspectiveDistortion: 1, sharpness: sharp, brightness: lights.brightness, glareRatio: lights.glareRatio, stability: null, score: 0, eligible: false, quad: null };
  const coverage = polygonArea(q) / (canvas.width * canvas.height);
  const tiltDeg = Math.abs(Math.atan2(q.tr.y - q.tl.y, q.tr.x - q.tl.x) * 180 / Math.PI);
  const topW = dist(q.tl, q.tr), bottomW = dist(q.bl, q.br), leftH = dist(q.tl, q.bl), rightH = dist(q.tr, q.br);
  const perspectiveDistortion = Math.max(Math.abs(topW - bottomW) / Math.max(topW, bottomW, 1), Math.abs(leftH - rightH) / Math.max(leftH, rightH, 1));
  const stability = normalizedQuadDelta(q, previousQuad, canvas.width, canvas.height);
  const sharpN = clamp01((sharp - 80) / 900);
  const coverageN = clamp01((coverage - .18) / .48);
  const tiltN = 1 - clamp01(tiltDeg / 12);
  const perspectiveN = 1 - clamp01(perspectiveDistortion / .28);
  const brightN = 1 - clamp01(Math.abs(lights.brightness - 185) / 120);
  const glareN = 1 - clamp01(lights.glareRatio / .08);
  const stabilityN = stability == null ? .4 : 1 - clamp01(stability / .035);
  const score = 100 * (.25 * coverageN + .2 * sharpN + .14 * tiltN + .14 * perspectiveN + .12 * brightN + .08 * glareN + .07 * stabilityN);
  const eligible = coverage >= .28 && tiltDeg <= 10 && perspectiveDistortion <= .25 && sharp >= 120 && lights.brightness >= 85 && lights.brightness <= 245 && lights.glareRatio <= .09 && (stability == null || stability <= .045);
  return { coverage, tiltDeg, perspectiveDistortion, sharpness: sharp, brightness: lights.brightness, glareRatio: lights.glareRatio, stability, score, eligible, quad: q };
}

function solveLinear(A: number[][], b: number[]) {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    const div = m[c][c] || 1e-9;
    for (let j = c; j <= n; j += 1) m[c][j] /= div;
    for (let r = 0; r < n; r += 1) if (r !== c) {
      const f = m[r][c];
      for (let j = c; j <= n; j += 1) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row) => row[n]);
}

function homographyFromRectToQuad(w: number, h: number, q: Quad) {
  const dst = [[0,0],[w-1,0],[w-1,h-1],[0,h-1]];
  const src = [q.tl,q.tr,q.br,q.bl];
  const A: number[][] = []; const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x,y] = dst[i]; const u = src[i].x, v = src[i].y;
    A.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u);
    A.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v);
  }
  const s = solveLinear(A,b);
  return [...s,1];
}

export function perspectiveCorrect(source: HTMLCanvasElement, q: Quad, maxWidth = 1800) {
  const topW = dist(q.tl,q.tr), bottomW = dist(q.bl,q.br), leftH = dist(q.tl,q.bl), rightH = dist(q.tr,q.br);
  const rawW = Math.max(1, (topW + bottomW) / 2), rawH = Math.max(1, (leftH + rightH) / 2);
  const scale = Math.min(1, maxWidth / rawW);
  const w = Math.max(1, Math.round(rawW * scale)), h = Math.max(1, Math.round(rawH * scale));
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const srcCtx = source.getContext("2d", { willReadFrequently: true }); const outCtx = out.getContext("2d");
  if (!srcCtx || !outCtx) return source;
  const src = srcCtx.getImageData(0,0,source.width,source.height); const dst = outCtx.createImageData(w,h);
  const H = homographyFromRectToQuad(w,h,q);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const den = H[6]*x + H[7]*y + 1;
    const sx = (H[0]*x + H[1]*y + H[2]) / den;
    const sy = (H[3]*x + H[4]*y + H[5]) / den;
    const ix = Math.max(0, Math.min(source.width-1, Math.round(sx)));
    const iy = Math.max(0, Math.min(source.height-1, Math.round(sy)));
    const sp = (iy*source.width+ix)*4, dp = (y*w+x)*4;
    dst.data[dp]=src.data[sp]; dst.data[dp+1]=src.data[sp+1]; dst.data[dp+2]=src.data[sp+2]; dst.data[dp+3]=255;
  }
  outCtx.putImageData(dst,0,0);
  return out;
}

export async function canvasToFile(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("capture failed")), "image/jpeg", .94));
  return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
}
