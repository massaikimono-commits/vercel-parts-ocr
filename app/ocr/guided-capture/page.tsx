"use client";

import { useEffect, useRef, useState } from "react";
import { saveOCRTransferImage } from "../transfer";

type BBox = { x: number; y: number; w: number; h: number };

type Metrics = {
  paperFound: boolean;
  bbox: BBox | null;
  occupancy: number;
  widthRatio: number;
  heightRatio: number;
  tiltDeg: number;
  sharpness: number;
  brightness: number;
  contrast: number;
  glareRatio: number;
  estimatedPaperWidthPx: number;
  estimatedPaperHeightPx: number;
  enoughResolution: boolean;
  insideGuide: boolean;
  ready: boolean;
  message: string;
};

const EMPTY_METRICS: Metrics = {
  paperFound: false,
  bbox: null,
  occupancy: 0,
  widthRatio: 0,
  heightRatio: 0,
  tiltDeg: 90,
  sharpness: 0,
  brightness: 0,
  contrast: 0,
  glareRatio: 1,
  estimatedPaperWidthPx: 0,
  estimatedPaperHeightPx: 0,
  enoughResolution: false,
  insideGuide: false,
  ready: false,
  message: "カメラを起動してください",
};

const ANALYSIS_WIDTH = 360;
const GUIDE = { x: 0.05, y: 0.17, w: 0.9, h: 0.66 };

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizeAxisTilt(angleDeg: number) {
  let angle = angleDeg;
  while (angle > 90) angle -= 180;
  while (angle < -90) angle += 180;
  const abs = Math.abs(angle);
  return Math.min(abs, Math.abs(90 - abs));
}

function analyzeFrame(
  canvas: HTMLCanvasElement,
  videoWidth: number,
  videoHeight: number,
): Metrics {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return EMPTY_METRICS;

  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const step = 2;

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  let maskCount = 0;
  let sampleCount = 0;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  const isPaperLike = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const brightness = (r + g + b) / 3;
    const lowChromaBright = brightness > 142 && max - min < 72;
    const yellowish = r > 110 && g > 100 && b < (r + g) * 0.48;
    return lowChromaBright || yellowish;
  };

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      sampleCount += 1;
      const p = (y * width + x) * 4;
      const r = pixels[p];
      const g = pixels[p + 1];
      const b = pixels[p + 2];
      if (!isPaperLike(r, g, b)) continue;

      maskCount += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
    }
  }

  if (maskCount < Math.max(120, sampleCount * 0.045) || maxX <= minX || maxY <= minY) {
    return {
      ...EMPTY_METRICS,
      message: "伝票全体をガイド枠内へ入れてください",
    };
  }

  const bbox: BBox = {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };

  const widthRatio = bbox.w / width;
  const heightRatio = bbox.h / height;
  const occupancy = (bbox.w * bbox.h) / (width * height);

  const meanX = sumX / maskCount;
  const meanY = sumY / maskCount;
  const covXX = sumXX / maskCount - meanX * meanX;
  const covYY = sumYY / maskCount - meanY * meanY;
  const covXY = sumXY / maskCount - meanX * meanY;
  const principalAngle = (0.5 * Math.atan2(2 * covXY, covXX - covYY) * 180) / Math.PI;
  const tiltDeg = normalizeAxisTilt(principalAngle);

  const bx1 = clamp(Math.floor(bbox.x), 1, width - 2);
  const by1 = clamp(Math.floor(bbox.y), 1, height - 2);
  const bx2 = clamp(Math.ceil(bbox.x + bbox.w), bx1 + 1, width - 1);
  const by2 = clamp(Math.ceil(bbox.y + bbox.h), by1 + 1, height - 1);

  let lumSum = 0;
  let lumSqSum = 0;
  let lumCount = 0;
  let glare = 0;
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;

  const grayAt = (x: number, y: number) => {
    const p = (y * width + x) * 4;
    return pixels[p] * 0.2 + pixels[p + 1] * 0.72 + pixels[p + 2] * 0.08;
  };

  for (let y = by1; y < by2; y += 2) {
    for (let x = bx1; x < bx2; x += 2) {
      const p = (y * width + x) * 4;
      const r = pixels[p];
      const g = pixels[p + 1];
      const b = pixels[p + 2];
      const lum = r * 0.2 + g * 0.72 + b * 0.08;
      lumSum += lum;
      lumSqSum += lum * lum;
      lumCount += 1;
      if (lum >= 248 && Math.max(r, g, b) - Math.min(r, g, b) <= 14) glare += 1;

      if (x + 1 < width && y + 1 < height && x - 1 >= 0 && y - 1 >= 0) {
        const center = grayAt(x, y);
        const lap =
          grayAt(x - 1, y) +
          grayAt(x + 1, y) +
          grayAt(x, y - 1) +
          grayAt(x, y + 1) -
          4 * center;
        lapSum += lap;
        lapSqSum += lap * lap;
        lapCount += 1;
      }
    }
  }

  const brightness = lumCount ? lumSum / lumCount : 0;
  const contrast = lumCount
    ? Math.sqrt(Math.max(0, lumSqSum / lumCount - brightness * brightness))
    : 0;
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const sharpness = lapCount
    ? Math.max(0, lapSqSum / lapCount - lapMean * lapMean)
    : 0;
  const glareRatio = lumCount ? glare / lumCount : 1;

  const guideLeft = GUIDE.x * width;
  const guideTop = GUIDE.y * height;
  const guideRight = (GUIDE.x + GUIDE.w) * width;
  const guideBottom = (GUIDE.y + GUIDE.h) * height;

  const insideGuide =
    bbox.x >= guideLeft - width * 0.035 &&
    bbox.y >= guideTop - height * 0.06 &&
    bbox.x + bbox.w <= guideRight + width * 0.035 &&
    bbox.y + bbox.h <= guideBottom + height * 0.06;

  const estimatedPaperWidthPx = Math.round(widthRatio * videoWidth);
  const estimatedPaperHeightPx = Math.round(heightRatio * videoHeight);
  const enoughResolution =
    Math.max(estimatedPaperWidthPx, estimatedPaperHeightPx) >= 1500 &&
    Math.min(estimatedPaperWidthPx, estimatedPaperHeightPx) >= 650;

  const distanceOkay = widthRatio >= 0.52 && widthRatio <= 0.95 && heightRatio >= 0.28;
  const tiltOkay = tiltDeg <= 7.5;
  const sharpnessOkay = sharpness >= 95;
  const brightnessOkay = brightness >= 72 && brightness <= 230;
  const contrastOkay = contrast >= 25;
  const glareOkay = glareRatio <= 0.045;

  let message = "撮影できます";
  if (!insideGuide) message = "伝票全体を枠内へ";
  else if (widthRatio > 0.95 || heightRatio > 0.9) message = "もう少し離してください";
  else if (!distanceOkay) message = "伝票をもう少し大きく写してください";
  else if (!tiltOkay) message = "傾きを直してください";
  else if (!sharpnessOkay) message = "ピントを合わせています";
  else if (!brightnessOkay) message = brightness < 72 ? "もう少し明るくしてください" : "明るすぎます";
  else if (!contrastOkay) message = "文字が見える位置へ動かしてください";
  else if (!glareOkay) message = "反射を避けてください";
  else if (!enoughResolution) message = "もう少し近づいてください";

  const ready =
    insideGuide &&
    distanceOkay &&
    tiltOkay &&
    sharpnessOkay &&
    brightnessOkay &&
    contrastOkay &&
    glareOkay &&
    enoughResolution;

  return {
    paperFound: true,
    bbox,
    occupancy,
    widthRatio,
    heightRatio,
    tiltDeg,
    sharpness,
    brightness,
    contrast,
    glareRatio,
    estimatedPaperWidthPx,
    estimatedPaperHeightPx,
    enoughResolution,
    insideGuide,
    ready,
    message,
  };
}

export default function GuidedPartsCapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const stableReadyFramesRef = useRef(0);
  const capturedRef = useRef(false);

  const [cameraStarted, setCameraStarted] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedUrl, setCapturedUrl] = useState("");
  const [autoCapture, setAutoCapture] = useState(true);
  const [error, setError] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function stopCamera() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraStarted(false);
  }

  async function startCamera() {
    setError("");
    setCapturedFile(null);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl("");
    capturedRef.current = false;
    stableReadyFramesRef.current = 0;

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("video element unavailable");
      video.srcObject = stream;
      await video.play();
      setCameraStarted(true);
      analyzeLoop();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "カメラを起動できませんでした。Safariのカメラ許可を確認してください。",
      );
    }
  }

  function analyzeLoop() {
    const video = videoRef.current;
    const canvas = analysisCanvasRef.current;
    if (!video || !canvas || capturedRef.current) return;

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const scale = Math.min(1, ANALYSIS_WIDTH / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const next = analyzeFrame(canvas, video.videoWidth, video.videoHeight);
        setMetrics(next);

        if (next.ready) stableReadyFramesRef.current += 1;
        else stableReadyFramesRef.current = 0;

        if (autoCapture && stableReadyFramesRef.current >= 8 && !capturedRef.current) {
          void captureFrame();
          return;
        }
      }
    }

    rafRef.current = requestAnimationFrame(analyzeLoop);
  }

  async function captureFrame() {
    if (capturedRef.current) return;
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    capturedRef.current = true;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      capturedRef.current = false;
      analyzeLoop();
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.96),
    );
    if (!blob) {
      capturedRef.current = false;
      analyzeLoop();
      return;
    }

    const file = new File([blob], `guided-parts-${Date.now()}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    setCapturedFile(file);
    const url = URL.createObjectURL(file);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(url);
    stopCamera();
  }

  async function handoffToExistingOcr() {
    if (!capturedFile) return;
    setHandoffBusy(true);
    setError("");
    try {
      await saveOCRTransferImage(capturedFile);
      location.assign("/ocr/auto");
    } catch (e) {
      setError(e instanceof Error ? e.message : "既存OCRへ画像を渡せませんでした。");
      setHandoffBusy(false);
    }
  }

  const metricRows = [
    ["用紙枠内", metrics.insideGuide ? "OK" : "NG"],
    ["傾き", `${metrics.tiltDeg.toFixed(1)}°`],
    ["sharpness", metrics.sharpness.toFixed(0)],
    ["明るさ", metrics.brightness.toFixed(0)],
    ["contrast", metrics.contrast.toFixed(1)],
    ["白飛び", `${(metrics.glareRatio * 100).toFixed(1)}%`],
    ["用紙占有", `${(metrics.occupancy * 100).toFixed(1)}%`],
    [
      "推定用紙解像度",
      `${metrics.estimatedPaperWidthPx}×${metrics.estimatedPaperHeightPx}px`,
    ],
  ];

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "14px 12px 48px",
        color: "#172033",
      }}
    >
      <section
        style={{
          border: "1px solid #dbe2ec",
          borderRadius: 18,
          padding: 14,
          marginBottom: 12,
          background: "#fff",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 25 }}>Guided Parts Capture PoC</h1>
        <p style={{ color: "#5d6878", lineHeight: 1.65, fontSize: 14 }}>
          Live OCRは行わず、撮影品質だけを判定します。条件成立後の静止画を既存Photo OCRへ渡します。
          サーバーへの画像upload・DB保存・PIIログ保存は行いません。
        </p>
        {!cameraStarted && !capturedFile && (
          <button
            onClick={startCamera}
            style={{
              width: "100%",
              border: 0,
              borderRadius: 14,
              padding: "15px 12px",
              background: "#2468df",
              color: "#fff",
              fontWeight: 800,
              fontSize: 17,
            }}
          >
            iPhoneカメラを起動
          </button>
        )}
      </section>

      {cameraStarted && (
        <>
          <section
            style={{
              position: "relative",
              overflow: "hidden",
              borderRadius: 18,
              background: "#111",
              marginBottom: 12,
            }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              style={{ display: "block", width: "100%", height: "auto" }}
            />
            <div
              style={{
                position: "absolute",
                left: `${GUIDE.x * 100}%`,
                top: `${GUIDE.y * 100}%`,
                width: `${GUIDE.w * 100}%`,
                height: `${GUIDE.h * 100}%`,
                border: metrics.ready ? "3px solid #32d271" : "3px solid #ffd24a",
                borderRadius: 12,
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 10,
                right: 10,
                bottom: 10,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(0,0,0,.72)",
                color: "#fff",
                fontWeight: 800,
                textAlign: "center",
              }}
            >
              {metrics.message}
            </div>
          </section>

          <section
            style={{
              border: "1px solid #dbe2ec",
              borderRadius: 18,
              padding: 14,
              marginBottom: 12,
              background: "#fff",
            }}
          >
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={autoCapture}
                onChange={(e) => {
                  stableReadyFramesRef.current = 0;
                  setAutoCapture(e.target.checked);
                }}
              />
              品質OKが安定したら自動撮影
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {metricRows.map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    border: "1px solid #e1e6ee",
                    borderRadius: 10,
                    padding: "8px 9px",
                    fontSize: 13,
                  }}
                >
                  <div style={{ color: "#697386" }}>{label}</div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <button
              disabled={!metrics.ready}
              onClick={() => void captureFrame()}
              style={{
                width: "100%",
                marginTop: 12,
                border: 0,
                borderRadius: 14,
                padding: "14px 12px",
                background: metrics.ready ? "#1f9d55" : "#aeb8c8",
                color: "#fff",
                fontWeight: 800,
                fontSize: 17,
              }}
            >
              {metrics.ready ? "撮影OK — 撮影する" : "条件が整うと撮影できます"}
            </button>

            <button
              onClick={stopCamera}
              style={{
                width: "100%",
                marginTop: 8,
                border: "1px solid #ccd5e2",
                borderRadius: 12,
                padding: "12px",
                background: "#fff",
                color: "#546174",
                fontWeight: 700,
              }}
            >
              カメラを閉じる
            </button>
          </section>
        </>
      )}

      {capturedFile && capturedUrl && (
        <section
          style={{
            border: "1px solid #dbe2ec",
            borderRadius: 18,
            padding: 14,
            marginBottom: 12,
            background: "#fff",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 19 }}>撮影画像</h2>
          <img
            src={capturedUrl}
            alt="Guided capture"
            style={{
              width: "100%",
              maxHeight: 520,
              objectFit: "contain",
              borderRadius: 12,
              background: "#eef2f7",
            }}
          />
          <button
            onClick={handoffToExistingOcr}
            disabled={handoffBusy}
            style={{
              width: "100%",
              marginTop: 12,
              border: 0,
              borderRadius: 14,
              padding: "15px 12px",
              background: "#2468df",
              color: "#fff",
              fontWeight: 800,
              fontSize: 17,
            }}
          >
            {handoffBusy ? "既存OCRへ渡しています…" : "この画像を既存Photo OCRへ渡す"}
          </button>
          <button
            onClick={startCamera}
            style={{
              width: "100%",
              marginTop: 8,
              border: "1px solid #ccd5e2",
              borderRadius: 12,
              padding: "12px",
              background: "#fff",
              color: "#2468df",
              fontWeight: 700,
            }}
          >
            撮り直す
          </button>
        </section>
      )}

      {error && (
        <section
          style={{
            border: "1px solid #efc5c5",
            borderRadius: 14,
            padding: 12,
            background: "#fff7f7",
            color: "#a72a2a",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </section>
      )}

      <canvas ref={analysisCanvasRef} hidden />
      <canvas ref={captureCanvasRef} hidden />
    </main>
  );
}
