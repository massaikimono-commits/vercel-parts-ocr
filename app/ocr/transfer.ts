"use client";

const IMAGE_KEY = "ocr-auto-transfer-image";
const NAME_KEY = "ocr-auto-transfer-name";

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
      reject(new Error("画像を開けませんでした。"));
    };
    img.src = url;
  });
}

export async function saveOCRTransferImage(file: File) {
  const img = await loadImage(file);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を引き継げませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // sessionStorageの容量に収まりやすいようにOCR用サイズへ縮小。
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  try {
    sessionStorage.setItem(IMAGE_KEY, dataUrl);
    sessionStorage.setItem(NAME_KEY, file.name || "ocr-transfer.jpg");
  } catch {
    // 容量超過時はもう一段小さくして保存。
    const smaller = document.createElement("canvas");
    const s = Math.min(1, 1200 / Math.max(canvas.width, canvas.height));
    smaller.width = Math.max(1, Math.round(canvas.width * s));
    smaller.height = Math.max(1, Math.round(canvas.height * s));
    const sctx = smaller.getContext("2d");
    if (!sctx) throw new Error("画像を引き継げませんでした。");
    sctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    sessionStorage.setItem(IMAGE_KEY, smaller.toDataURL("image/jpeg", 0.72));
    sessionStorage.setItem(NAME_KEY, file.name || "ocr-transfer.jpg");
  }
}

export async function consumeOCRTransferImage() {
  const dataUrl = sessionStorage.getItem(IMAGE_KEY);
  if (!dataUrl) return null;
  const name = sessionStorage.getItem(NAME_KEY) || "ocr-transfer.jpg";
  sessionStorage.removeItem(IMAGE_KEY);
  sessionStorage.removeItem(NAME_KEY);

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}
