export type DocumentVariantName =
  | "original"
  | "grayscale"
  | "contrast"
  | "adaptiveBinary"
  | "binaryDark"
  | "binaryLight";

export type ImageQuality = {
  brightness: number;
  contrast: number;
  clippedDarkRatio: number;
  clippedLightRatio: number;
  edgeScore: number;
  warnings: string[];
};

export type PaperBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

export type PreparedDocument = {
  source: HTMLCanvasElement;
  normalized: HTMLCanvasElement;
  variants: Record<DocumentVariantName, HTMLCanvasElement>;
  quality: ImageQuality;
  paperBounds: PaperBounds | null;
};

export type PrepareDocumentOptions = {
  maxSide?: number;
  cropPaper?: boolean;
  minPaperConfidence?: number;
};

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function cloneCanvas(source: HTMLCanvasElement) {
  const out = canvas(source.width, source.height);
  out.getContext("2d")!.drawImage(source, 0, 0);
  return out;
}

async function decodeImage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return bitmap as ImageBitmap;
    } catch {
      // Safari fallback below.
    }
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img as HTMLImageElement);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}

export async function fileToCanvas(file: File, maxSide = 3200) {
  const image = await decodeImage(file);
  const w = image.width;
  const h = image.height;
  if (!w || !h) throw new Error("画像サイズを取得できませんでした");

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const out = canvas(w * scale, h * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, out.width, out.height);

  if ("close" in image && typeof (image as ImageBitmap).close === "function") {
    (image as ImageBitmap).close();
  }
  return out;
}

function sampleCanvas(source: HTMLCanvasElement, maxSide = 640) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const out = canvas(source.width * scale, source.height * scale);
  out.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function measureImageQuality(source: HTMLCanvasElement): ImageQuality {
  const small = sampleCanvas(source, 520);
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, small.width, small.height);

  let sum = 0;
  let sum2 = 0;
  let dark = 0;
  let light = 0;
  let edges = 0;
  let edgeCount = 0;
  const gray = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    gray[p] = g;
    sum += g;
    sum2 += g * g;
    if (g < 22) dark++;
    if (g > 245) light++;
  }

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const p = y * width + x;
      const dx = Math.abs(gray[p + 1] - gray[p - 1]);
      const dy = Math.abs(gray[p + width] - gray[p - width]);
      edges += dx + dy;
      edgeCount++;
    }
  }

  const n = width * height;
  const brightness = sum / n;
  const variance = Math.max(0, sum2 / n - brightness * brightness);
  const contrast = Math.sqrt(variance);
  const clippedDarkRatio = dark / n;
  const clippedLightRatio = light / n;
  const edgeScore = edgeCount ? edges / edgeCount : 0;
  const warnings: string[] = [];

  if (brightness < 75) warnings.push("画像が暗すぎます");
  if (brightness > 225) warnings.push("画像が明るすぎます");
  if (contrast < 28) warnings.push("文字と背景のコントラストが低いです");
  if (clippedDarkRatio > 0.22) warnings.push("黒つぶれが多いです");
  if (clippedLightRatio > 0.35) warnings.push("白飛びが多いです");
  if (edgeScore < 18) warnings.push("ピントが甘い可能性があります");

  small.width = 1;
  small.height = 1;
  return { brightness, contrast, clippedDarkRatio, clippedLightRatio, edgeScore, warnings };
}

/**
 * Conservative paper detector. It intentionally returns null when confidence is low;
 * a wrong crop is much worse than keeping the original image for OCR.
 */
export function detectLikelyPaperBounds(source: HTMLCanvasElement): PaperBounds | null {
  const small = sampleCanvas(source, 700);
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, small.width, small.height);
  const { data, width, height } = image;
  const row = new Uint32Array(height);
  const col = new Uint32Array(width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = r * 0.299 + g * 0.587 + b * 0.114;
      if (luma > 132 && max - min < 78) {
        row[y]++;
        col[x]++;
      }
    }
  }

  const rowNeed = Math.max(8, Math.floor(width * 0.22));
  const colNeed = Math.max(8, Math.floor(height * 0.22));
  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  while (top < bottom && row[top] < rowNeed) top++;
  while (bottom > top && row[bottom] < rowNeed) bottom--;
  while (left < right && col[left] < colNeed) left++;
  while (right > left && col[right] < colNeed) right--;

  const bw = right - left + 1;
  const bh = bottom - top + 1;
  const areaRatio = (bw * bh) / (width * height);
  if (bw < width * 0.42 || bh < height * 0.42 || areaRatio < 0.22) {
    small.width = 1;
    small.height = 1;
    return null;
  }

  let paperPixels = 0;
  for (let y = top; y <= bottom; y++) paperPixels += row[y];
  const density = paperPixels / Math.max(1, bw * bh);
  const confidence = Math.max(0, Math.min(1, density * 1.25 + Math.min(0.25, areaRatio * 0.2)));
  if (confidence < 0.48) {
    small.width = 1;
    small.height = 1;
    return null;
  }

  const sx = source.width / width;
  const sy = source.height / height;
  const padX = Math.round(bw * 0.012);
  const padY = Math.round(bh * 0.012);
  const x = Math.max(0, (left - padX) * sx);
  const y = Math.max(0, (top - padY) * sy);
  const x2 = Math.min(source.width, (right + 1 + padX) * sx);
  const y2 = Math.min(source.height, (bottom + 1 + padY) * sy);
  small.width = 1;
  small.height = 1;

  return { x, y, width: x2 - x, height: y2 - y, confidence };
}

export function cropCanvas(source: HTMLCanvasElement, bounds: PaperBounds) {
  const out = canvas(bounds.width, bounds.height);
  out.getContext("2d", { willReadFrequently: true })!.drawImage(
    source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    out.width,
    out.height,
  );
  return out;
}

function otsuThreshold(gray: Uint8Array) {
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 128;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVariance) {
      bestVariance = between;
      best = t;
    }
  }
  return best;
}

/**
 * Block-adaptive thresholding without a full-resolution integral image. A small grid
 * of local luminance means is cheap enough for iPhone Safari and handles shadows or
 * uneven desk lighting much better than one global Otsu threshold.
 */
function adaptiveBinary(source: HTMLCanvasElement) {
  const out = cloneCanvas(source);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const { data } = image;
  const width = out.width;
  const height = out.height;
  const gray = new Uint8Array(width * height);
  const block = Math.max(28, Math.min(96, Math.round(Math.min(width, height) / 34)));
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const sums = new Float64Array(cols * rows);
  const counts = new Uint32Array(cols * rows);

  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / block);
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;
      const g = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      gray[p] = g;
      const cell = by * cols + Math.floor(x / block);
      sums[cell] += g;
      counts[cell]++;
    }
  }

  const means = new Float32Array(cols * rows);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let sum = 0;
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = by + oy;
        if (yy < 0 || yy >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = bx + ox;
          if (xx < 0 || xx >= cols) continue;
          const cell = yy * cols + xx;
          sum += sums[cell];
          n += counts[cell];
        }
      }
      means[by * cols + bx] = n ? sum / n : 180;
    }
  }

  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / block);
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;
      const localMean = means[by * cols + Math.floor(x / block)];
      const threshold = Math.max(72, Math.min(232, localMean - 13));
      const v = gray[p] < threshold ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

function transformPixels(
  source: HTMLCanvasElement,
  mode: Exclude<DocumentVariantName, "original" | "adaptiveBinary">,
) {
  const out = cloneCanvas(source);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const { data } = image;
  const gray = new Uint8Array(out.width * out.height);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }
  const threshold = otsuThreshold(gray);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = gray[p];
    let v = g;
    if (mode === "contrast") v = Math.max(0, Math.min(255, (g - 128) * 1.55 + 138));
    if (mode === "binaryDark") v = g < Math.min(225, threshold + 10) ? 0 : 255;
    if (mode === "binaryLight") v = g < Math.max(70, threshold - 18) ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }

  ctx.putImageData(image, 0, 0);
  return out;
}

export function createOcrVariants(source: HTMLCanvasElement): Record<DocumentVariantName, HTMLCanvasElement> {
  return {
    original: cloneCanvas(source),
    grayscale: transformPixels(source, "grayscale"),
    contrast: transformPixels(source, "contrast"),
    adaptiveBinary: adaptiveBinary(source),
    binaryDark: transformPixels(source, "binaryDark"),
    binaryLight: transformPixels(source, "binaryLight"),
  };
}

export async function prepareDocumentImage(
  file: File,
  options: PrepareDocumentOptions = {},
): Promise<PreparedDocument> {
  const maxSide = options.maxSide ?? 3000;
  const source = await fileToCanvas(file, maxSide);
  const quality = measureImageQuality(source);
  const detected = options.cropPaper === false ? null : detectLikelyPaperBounds(source);
  const minConfidence = options.minPaperConfidence ?? 0.54;
  const paperBounds = detected && detected.confidence >= minConfidence ? detected : null;
  const normalized = paperBounds ? cropCanvas(source, paperBounds) : cloneCanvas(source);
  const variants = createOcrVariants(normalized);
  return { source, normalized, variants, quality, paperBounds };
}

export type CandidateRule = {
  pattern?: RegExp;
  minLength?: number;
  maxLength?: number;
  score?: (value: string) => number;
};

export function normalizeOcrText(value: string) {
  return value
    .replace(/[\u3000\t\r]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Generic consensus selector shared by certificates and parts slips.
 * Invalid-looking candidates lose instead of being blindly written to state.
 */
export function chooseOcrCandidate(values: string[], rule: CandidateRule = {}) {
  const normalized = values.map(normalizeOcrText).filter(Boolean);
  if (!normalized.length) return { value: "", confidence: 0 };

  const frequency = new Map<string, number>();
  for (const value of normalized) frequency.set(value, (frequency.get(value) ?? 0) + 1);

  let best = "";
  let bestScore = -Infinity;
  for (const value of normalized) {
    if (rule.minLength && value.length < rule.minLength) continue;
    if (rule.maxLength && value.length > rule.maxLength) continue;
    if (rule.pattern && !rule.pattern.test(value)) continue;
    const consensus = (frequency.get(value) ?? 1) * 10;
    const custom = rule.score ? rule.score(value) : 0;
    const score = consensus + custom;
    if (score > bestScore) {
      bestScore = score;
      best = value;
    }
  }

  if (!best) return { value: "", confidence: 0 };
  const agree = frequency.get(best) ?? 1;
  const confidence = Math.min(1, 0.45 + (agree - 1) * 0.22 + Math.max(0, bestScore - agree * 10) * 0.01);
  return { value: best, confidence };
}
