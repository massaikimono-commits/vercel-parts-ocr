/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { saveOCRTransferImage } from "../ocr/transfer";
import { saveCertificateTransferImage } from "./certificate-transfer";

type CaptureMode = "certificate" | "parts";
type CameraState = "idle" | "opening" | "ready" | "captured" | "error";

function captureName(mode: CaptureMode) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${mode === "certificate" ? "guided-certificate" : "guided-parts"}-${stamp}.jpg`;
}

export default function GuidedCapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mode, setMode] = useState<CaptureMode>("parts");
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [status, setStatus] = useState("カメラを起動してください。");
  const [detail, setDetail] = useState("iPhoneを対象へ向け、ガイド枠に合わせます。");
  const [capturedUrl, setCapturedUrl] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [autoCapture, setAutoCapture] = useState(false);
  const [videoSize, setVideoSize] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setMode(params.get("mode") === "certificate" ? "certificate" : "parts");
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (cameraState !== "ready") return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width && height) {
        setVideoSize(`${width} × ${height}`);
        setStatus("撮影OK");
        setDetail(mode === "certificate" ? "QRをガイド中央へ合わせてください。" : "伝票全体をガイド内へ収めてください。");
      } else {
        setStatus("カメラ調整中");
        setDetail("ピントが合うまで端末を少し止めてください。");
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [cameraState, mode]);

  useEffect(() => {
    if (!autoCapture || cameraState !== "ready") {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
      return;
    }
    autoTimerRef.current = setTimeout(() => {
      void captureStill();
    }, 1600);
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    };
  }, [autoCapture, cameraState, mode]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startCamera() {
    setCapturedFile(null);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setStatus("カメラを利用できません");
      setDetail("Safariのカメラ権限とHTTPS接続を確認してください。");
      return;
    }
    setCameraState("opening");
    setStatus("カメラ起動中…");
    setDetail("初回はSafariのカメラ許可を選択してください。");
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("camera view missing");
      video.srcObject = stream;
      await video.play();
      setCameraState("ready");
      setStatus("ガイドに合わせてください");
      setDetail(mode === "certificate" ? "QRが中央の枠へ入るように調整します。" : "伝票の四辺がガイド内へ収まるように調整します。");
    } catch (error: any) {
      stopCamera();
      setCameraState("error");
      setStatus("カメラを開始できませんでした");
      setDetail(error?.name === "NotAllowedError" ? "Safariのカメラ許可をオンにしてください。" : "別のカメラ利用中でないか確認して再試行してください。");
    }
  }

  async function captureStill() {
    const video = videoRef.current;
    if (!video || cameraState !== "ready" || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
    if (!blob) return;
    const file = new File([blob], captureName(mode), { type: "image/jpeg" });
    const url = URL.createObjectURL(file);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(url);
    setCapturedFile(file);
    setCameraState("captured");
    setStatus("静止画を取得しました");
    setDetail("画像を確認し、問題なければ既存OCRへ渡します。");
    stopCamera();
  }

  async function handoff() {
    if (!capturedFile) return;
    setStatus("既存OCRへ受け渡し中…");
    setDetail("認識処理は既存OCR側で実行します。");
    if (mode === "parts") {
      await saveOCRTransferImage(capturedFile);
      location.assign("/ocr");
      return;
    }
    await saveCertificateTransferImage(capturedFile);
    location.assign("/vehicle-workflow-v2");
  }

  const certificate = mode === "certificate";

  return (
    <main className="page">
      <header className="top">
        <button onClick={() => history.back()}>← 戻る</button>
        <strong>icb Guided Capture PoC</strong>
      </header>

      <section className="intro card">
        <small>{certificate ? "車検証" : "部品伝票"}</small>
        <h1>{certificate ? "Guided Live QR Scanner" : "Guided Parts Capture"}</h1>
        <p>{certificate ? "QR読取ロジックは後から接続します。今は安定したcamera streamと静止画受け渡しを確認します。" : "Live全文OCRは行わず、OCRへ渡す高品質な静止画を撮るための土台です。"}</p>
      </section>

      <section className="cameraCard card">
        <div className="statusRow">
          <span className={`dot ${cameraState}`} />
          <div><b>{status}</b><small>{detail}</small></div>
        </div>

        <div className={`viewer ${certificate ? "certificate" : "parts"}`}>
          {capturedUrl ? (
            <img src={capturedUrl} alt="撮影した確認画像" />
          ) : (
            <video ref={videoRef} playsInline muted autoPlay />
          )}
          <div className={`guide ${certificate ? "qrGuide" : "paperGuide"}`} aria-hidden="true">
            <i /><i /><i /><i />
          </div>
          {!capturedUrl && <div className="guideText">{certificate ? "QRをこの枠へ" : "伝票全体をこの枠へ"}</div>}
        </div>

        <div className="metrics">
          <span>camera: {cameraState === "ready" ? "LIVE" : cameraState.toUpperCase()}</span>
          <span>frame: {videoSize || "-"}</span>
          <span>quality判定: 接続待ち</span>
        </div>

        {cameraState === "ready" && (
          <label className="auto">
            <input type="checkbox" checked={autoCapture} onChange={(event) => setAutoCapture(event.target.checked)} />
            撮影OK状態が続いたら自動captureするPoC
          </label>
        )}

        <div className="actions">
          {(cameraState === "idle" || cameraState === "error") && <button className="primary" onClick={() => void startCamera()}>📷 カメラを起動</button>}
          {cameraState === "opening" && <button className="primary" disabled>カメラ起動中…</button>}
          {cameraState === "ready" && <button className="primary" onClick={() => void captureStill()}>● この状態で撮影</button>}
          {cameraState === "captured" && <button onClick={() => void startCamera()}>↻ 再撮影</button>}
          {capturedFile && <button className="primary" onClick={() => void handoff()}>✓ この画像を既存OCRへ渡す</button>}
        </div>
      </section>

      <section className="card notes">
        <h2>PoC接続境界</h2>
        <div><b>アプリ本体</b><span>camera / guide / status / capture / transfer</span></div>
        <div><b>OCR専任</b><span>{certificate ? "finder / geometry / quad / decode / rescue / multi-frame判定" : "row detection / threshold / field OCR / recognition / capture品質条件"}</span></div>
      </section>

      <style jsx>{`
        *{box-sizing:border-box}.page{max-width:760px;margin:0 auto;padding:12px 10px 42px;color:#172033}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.top button,.actions button{border:1px solid #cbd6e4;background:#fff;border-radius:11px;padding:10px 12px;font-weight:800;color:#245fae}.card{background:#fff;border:1px solid #d8e0eb;border-radius:18px;padding:16px;margin-bottom:12px}.intro small{font-weight:900;color:#2f6fe4}.intro h1{margin:4px 0 8px;font-size:26px}.intro p{margin:0;color:#647084;line-height:1.55}.statusRow{display:flex;gap:10px;align-items:center;margin-bottom:10px}.statusRow div{display:grid;gap:2px}.statusRow small{color:#68758a}.dot{width:12px;height:12px;border-radius:50%;background:#9aa6b5;box-shadow:0 0 0 5px #eef1f5}.dot.ready{background:#2aaa61;box-shadow:0 0 0 5px #def4e6}.dot.captured{background:#2f6fe4;box-shadow:0 0 0 5px #e5efff}.dot.error{background:#c94c4c;box-shadow:0 0 0 5px #fde6e6}.viewer{position:relative;overflow:hidden;border-radius:16px;background:#101722;min-height:420px;display:flex;align-items:center;justify-content:center}.viewer video,.viewer img{width:100%;height:100%;min-height:420px;object-fit:cover;display:block}.guide{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none}.paperGuide{width:88%;aspect-ratio:1.55/1}.qrGuide{width:min(60vw,300px);aspect-ratio:1/1}.guide i{position:absolute;width:34px;height:34px;border-color:#fff;border-style:solid;filter:drop-shadow(0 1px 2px #000)}.guide i:nth-child(1){left:0;top:0;border-width:4px 0 0 4px}.guide i:nth-child(2){right:0;top:0;border-width:4px 4px 0 0}.guide i:nth-child(3){left:0;bottom:0;border-width:0 0 4px 4px}.guide i:nth-child(4){right:0;bottom:0;border-width:0 4px 4px 0}.guideText{position:absolute;bottom:18px;background:#101722cc;color:#fff;padding:7px 10px;border-radius:999px;font-size:12px;font-weight:900}.metrics{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.metrics span{font-size:10px;padding:5px 7px;border-radius:999px;background:#f0f4f9;color:#556277;font-weight:800}.auto{display:flex;gap:8px;align-items:center;margin-top:10px;padding:9px;background:#f8fafc;border-radius:10px;font-size:12px;font-weight:800}.actions{display:grid;grid-template-columns:1fr;gap:7px;margin-top:10px}.actions .primary{border:0;background:#2f6fe4;color:#fff}.actions button:disabled{opacity:.55}.notes h2{margin:0 0 10px;font-size:16px}.notes div{display:grid;grid-template-columns:90px 1fr;gap:8px;padding:7px 0;border-top:1px solid #edf0f4}.notes span{font-size:12px;color:#667386}@media(max-width:600px){.page{padding:7px 6px 28px}.card{padding:11px;border-radius:13px}.intro h1{font-size:20px}.viewer,.viewer video,.viewer img{min-height:58vh}.paperGuide{width:92%}.qrGuide{width:64vw}.top strong{font-size:12px}}
      `}</style>
    </main>
  );
}
