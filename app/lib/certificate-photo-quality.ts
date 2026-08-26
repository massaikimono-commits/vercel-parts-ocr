export type CertificatePhotoQuality = {
  width: number;
  height: number;
  megapixels: number;
  meanLuma: number;
  contrast: number;
  darkRatio: number;
  brightRatio: number;
  laplacianVariance: number;
  score: number;
  acceptable: boolean;
  warnings: string[];
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lumaAt(data: Uint8ClampedArray, pixelIndex: number) {
  const i = pixelIndex * 4;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/**
 * Lightweight browser-side quality gate used before expensive OCR.
 * It does not identify document content; it only checks whether an image is
 * likely sharp and exposed enough to be worth processing.
 */
export function analyzeCertificatePhotoQuality(image: ImageData): CertificatePhotoQuality {
  const { width, height, data } = image;
  const totalPixels = Math.max(1, width * height);
  const megapixels = totalPixels / 1_000_000;

  // Sample at most roughly 250k pixels so iPhone Safari stays responsive.
  const sampleStep = Math.max(1, Math.floor(Math.sqrt(totalPixels / 250_000)));
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let bright = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const value = lumaAt(data, y * width + x);
      count += 1;
      sum += value;
      sumSq += value * value;
      if (value <= 24) dark += 1;
      if (value >= 242) bright += 1;
    }
  }

  const meanLuma = count ? sum / count : 0;
  const variance = count ? Math.max(0, sumSq / count - meanLuma * meanLuma) : 0;
  const contrast = Math.sqrt(variance);
  const darkRatio = count ? dark / count : 1;
  const brightRatio = count ? bright / count : 1;

  // Variance of a simple 4-neighbour Laplacian is a useful no-dependency blur proxy.
  // Sample away from borders and use the same stride as the exposure pass.
  let lapCount = 0;
  let lapSum = 0;
  let lapSumSq = 0;
  const stride = Math.max(1, sampleStep);
  for (let y = stride; y < height - stride; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const center = lumaAt(data, y * width + x);
      const left = lumaAt(data, y * width + (x - stride));
      const right = lumaAt(data, y * width + (x + stride));
      const up = lumaAt(data, (y - stride) * width + x);
      const down = lumaAt(data, (y + stride) * width + x);
      const lap = 4 * center - left - right - up - down;
      lapCount += 1;
      lapSum += lap;
      lapSumSq += lap * lap;
    }
  }
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const laplacianVariance = lapCount ? Math.max(0, lapSumSq / lapCount - lapMean * lapMean) : 0;

  const warnings: string[] = [];
  const minSide = Math.min(width, height);
  if (megapixels < 2.0 || minSide < 1200) warnings.push("解像度が低いため、文字が潰れる可能性があります。");
  if (meanLuma < 55) warnings.push("画像が暗すぎます。明るい場所で撮り直してください。");
  if (meanLuma > 225) warnings.push("画像が明るすぎます。白飛びを避けて撮り直してください。");
  if (darkRatio > 0.22) warnings.push("黒つぶれが多く、文字認識精度が下がる可能性があります。");
  if (brightRatio > 0.30) warnings.push("白飛び・反射が多く、文字認識精度が下がる可能性があります。");
  if (contrast < 22) warnings.push("コントラストが低く、文字と背景の分離が弱い可能性があります。");
  if (laplacianVariance < 110) warnings.push("ピンぼけの可能性があります。車検証にピントを合わせてください。");

  // Weighted 0..100 score. Thresholds are deliberately conservative and must
  // be calibrated with actual certificate photos before becoming a hard block.
  const resolutionScore = clamp01(megapixels / 4.0);
  const exposureScore = clamp01(1 - Math.abs(meanLuma - 145) / 145);
  const contrastScore = clamp01(contrast / 55);
  const sharpnessScore = clamp01(laplacianVariance / 450);
  const clippingScore = clamp01(1 - Math.max(darkRatio / 0.30, brightRatio / 0.38));
  const score = Math.round(100 * (
    resolutionScore * 0.18 +
    exposureScore * 0.18 +
    contrastScore * 0.18 +
    sharpnessScore * 0.30 +
    clippingScore * 0.16
  ));

  return {
    width,
    height,
    megapixels: Number(megapixels.toFixed(2)),
    meanLuma: Number(meanLuma.toFixed(1)),
    contrast: Number(contrast.toFixed(1)),
    darkRatio: Number(darkRatio.toFixed(4)),
    brightRatio: Number(brightRatio.toFixed(4)),
    laplacianVariance: Number(laplacianVariance.toFixed(1)),
    score,
    acceptable: warnings.length === 0,
    warnings,
  };
}
