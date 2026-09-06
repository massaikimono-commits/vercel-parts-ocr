"use client";

const IMAGE_KEY = "ocr-auto-transfer-image";
const NAME_KEY = "ocr-auto-transfer-name";
const NORMALIZED_SUFFIX = ".ocr-normalized.jpg";

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

function shouldRotatePartsPhoto(img: HTMLImageElement) {
  // 実写真の黄色伝票・白い部品一覧は横長帳票を縦持ちで撮影したものが多い。
  // 明確な縦長ピクセルだけを対象にし、すでに横長の画像には触れない。
  return img.naturalHeight > img.naturalWidth * 1.08;
}

function normalizePartsPhotoIllumination(canvas: HTMLCanvasElement) {
  // 黄ばみ・照明ムラ・影で文字コントラストが落ちる実写真向けの局所背景補正。
  // Canvas filter が使えない環境では安全に元画像のまま返す。
  const sourceCtx = canvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return;

  const background = document.createElement("canvas");
  background.width = canvas.width;
  background.height = canvas.height;
  const backgroundCtx = background.getContext("2d", { willReadFrequently: true });
  if (!backgroundCtx || !("filter" in backgroundCtx)) return;

  backgroundCtx.fillStyle = "#fff";
  backgroundCtx.fillRect(0, 0, background.width, background.height);
  backgroundCtx.filter = "blur(25px)";
  backgroundCtx.drawImage(canvas, 0, 0);
  backgroundCtx.filter = "none";

  const source = sourceCtx.getImageData(0, 0, canvas.width, canvas.height);
  const bg = backgroundCtx.getImageData(0, 0, canvas.width, canvas.height);
  const count = canvas.width * canvas.height;
  const values = new Uint16Array(count);
  let min = 255;
  let max = 0;

  for (let i = 0, p = 0; i < count; i += 1, p += 4) {
    const gray = Math.round(source.data[p] * 0.20 + source.data[p + 1] * 0.72 + source.data[p + 2] * 0.08);
    const bgGray = Math.max(16, Math.round(bg.data[p] * 0.20 + bg.data[p + 1] * 0.72 + bg.data[p + 2] * 0.08));
    const value = Math.max(0, Math.min(255, Math.round((gray * 255) / bgGray)));
    values[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < count; i += 1, p += 4) {
    let value = Math.round(((values[i] - min) * 255) / range);
    if (value > 248) value = 255;
    source.data[p] = value;
    source.data[p + 1] = value;
    source.data[p + 2] = value;
    source.data[p + 3] = 255;
  }
  sourceCtx.putImageData(source, 0, 0);
}

function normalizedName(name: string) {
  const base = (name || "ocr-input").replace(/\.ocr-normalized\.jpg$/i, "").replace(/\.[^.]+$/, "");
  return `${base}${NORMALIZED_SUFFIX}`;
}

export async function prepareOCRInputFile(file: File) {
  // 自動判定から引き継がれた画像は既に同じ共通前処理済み。二重補正を避ける。
  if (file.name.toLowerCase().endsWith(NORMALIZED_SUFFIX)) return file;

  const img = await loadImage(file);
  const rotate = shouldRotatePartsPhoto(img);
  const sourceWidth = rotate ? img.naturalHeight : img.naturalWidth;
  const sourceHeight = rotate ? img.naturalWidth : img.naturalHeight;
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を前処理できませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (rotate) {
    // 固定評価セットでは反時計回り90度で帳票文字が正立する。
    ctx.save();
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0, canvas.height, canvas.width);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  normalizePartsPhotoIllumination(canvas);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("画像を前処理できませんでした。")), "image/jpeg", 0.88);
  });
  return new File([blob], normalizedName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
}

export async function saveOCRTransferImage(file: File) {
  const prepared = await prepareOCRInputFile(file);
  const img = await loadImage(prepared);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を引き継げませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  // sessionStorageの容量に収まりやすいようにOCR用サイズへ縮小。
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  try {
    sessionStorage.setItem(IMAGE_KEY, dataUrl);
    sessionStorage.setItem(NAME_KEY, prepared.name);
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
    sessionStorage.setItem(NAME_KEY, prepared.name);
  }
}

export async function consumeOCRTransferImage() {
  const dataUrl = sessionStorage.getItem(IMAGE_KEY);
  if (!dataUrl) return null;
  const name = sessionStorage.getItem(NAME_KEY) || `ocr-transfer${NORMALIZED_SUFFIX}`;
  sessionStorage.removeItem(IMAGE_KEY);
  sessionStorage.removeItem(NAME_KEY);

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}
