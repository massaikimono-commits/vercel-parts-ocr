"use client";

const IMAGE_KEY = "guided-certificate-transfer-image";
const NAME_KEY = "guided-certificate-transfer-name";

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("撮影画像を開けませんでした。"));
    };
    img.src = url;
  });
}

export async function saveCertificateTransferImage(file: File) {
  const img = await loadImage(file);
  const maxSide = 2000;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("撮影画像を引き継げませんでした。");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const store = (quality: number) => {
    sessionStorage.setItem(IMAGE_KEY, canvas.toDataURL("image/jpeg", quality));
    sessionStorage.setItem(NAME_KEY, file.name || "guided-certificate.jpg");
  };

  try {
    store(0.9);
  } catch {
    const smaller = document.createElement("canvas");
    const shrink = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
    smaller.width = Math.max(1, Math.round(canvas.width * shrink));
    smaller.height = Math.max(1, Math.round(canvas.height * shrink));
    const sctx = smaller.getContext("2d");
    if (!sctx) throw new Error("撮影画像を引き継げませんでした。");
    sctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    sessionStorage.setItem(IMAGE_KEY, smaller.toDataURL("image/jpeg", 0.78));
    sessionStorage.setItem(NAME_KEY, file.name || "guided-certificate.jpg");
  }
}

export async function consumeCertificateTransferImage() {
  const dataUrl = sessionStorage.getItem(IMAGE_KEY);
  if (!dataUrl) return null;
  const name = sessionStorage.getItem(NAME_KEY) || "guided-certificate.jpg";
  sessionStorage.removeItem(IMAGE_KEY);
  sessionStorage.removeItem(NAME_KEY);

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}
