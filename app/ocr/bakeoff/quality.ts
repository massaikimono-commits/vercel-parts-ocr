import type { QualityMetrics } from "./contract";

function luminance(data: Uint8ClampedArray, index: number) {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

export function measureCaptureQuality(canvas: HTMLCanvasElement, geometry?: { coverage?: number; angleDeg?: number; perspectiveDelta?: number }): QualityMetrics {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { width: canvas.width, height: canvas.height, documentCoverage: null, blurScore: null, glareRatio: null, angleDeg: null, perspectiveDelta: null, accepted: false, rejectionReasons: ["canvas-unavailable"] };
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = image;
  const step = Math.max(1, Math.floor(Math.max(width, height) / 900));
  let laplacianSquared = 0;
  let glare = 0;
  let samples = 0;
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const index = (y * width + x) * 4;
      const center = luminance(data, index);
      const laplacian = center * 4 - luminance(data, index - step * 4) - luminance(data, index + step * 4) - luminance(data, index - width * step * 4) - luminance(data, index + width * step * 4);
      laplacianSquared += laplacian * laplacian;
      if (data[index] > 247 && data[index + 1] > 247 && data[index + 2] > 247) glare += 1;
      samples += 1;
    }
  }
  const blurScore = samples ? Math.sqrt(laplacianSquared / samples) : 0;
  const glareRatio = samples ? glare / samples : 1;
  const coverage = geometry?.coverage ?? null;
  const angle = geometry?.angleDeg ?? null;
  const perspective = geometry?.perspectiveDelta ?? null;
  const rejectionReasons: string[] = [];
  if (Math.min(width, height) < 720) rejectionReasons.push("resolution-low");
  if (blurScore < 12) rejectionReasons.push("blur-high");
  if (glareRatio > 0.22) rejectionReasons.push("glare-high");
  if (coverage !== null && coverage < 0.35) rejectionReasons.push("document-coverage-low");
  if (angle !== null && Math.abs(angle) > 8) rejectionReasons.push("angle-high");
  if (perspective !== null && perspective > 0.28) rejectionReasons.push("perspective-high");
  return { width, height, documentCoverage: coverage, blurScore, glareRatio, angleDeg: angle, perspectiveDelta: perspective, accepted: rejectionReasons.length === 0, rejectionReasons };
}
