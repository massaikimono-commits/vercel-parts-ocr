export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 100_000_000;
export const MAX_IMAGE_EDGE = 20_000;

type FileCheck = { ok: true; kind: "image" | "pdf" } | { ok: false; message: string };

function ascii(bytes: Uint8Array) {
  return String.fromCharCode(...Array.from(bytes));
}

function u16be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32be(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24) return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker) && length >= 7) {
      return {
        height: u16be(bytes, offset + 3),
        width: u16be(bytes, offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function safeDimensions(dim: { width: number; height: number } | null) {
  if (!dim) return true;
  if (!Number.isFinite(dim.width) || !Number.isFinite(dim.height) || dim.width <= 0 || dim.height <= 0) return false;
  if (dim.width > MAX_IMAGE_EDGE || dim.height > MAX_IMAGE_EDGE) return false;
  return dim.width * dim.height <= MAX_IMAGE_PIXELS;
}

export async function validateDocumentFile(
  file: File,
  options: { allowPdf?: boolean; maxBytes?: number } = {}
): Promise<FileCheck> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  if (!file || file.size <= 0) return { ok: false, message: "空のファイルは読み込めません。" };
  if (file.size > maxBytes) {
    return { ok: false, message: `ファイルが大きすぎます。最大${Math.floor(maxBytes / 1024 / 1024)}MBまでです。` };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  } catch {
    return { ok: false, message: "ファイル形式を確認できませんでした。" };
  }

  const head = ascii(bytes);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const webp = head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  const pdf = head.startsWith("%PDF-");
  const brand = head.slice(4, 12).toLowerCase();
  const heif = /^ftyp(?:heic|heix|hevc|hevx|mif1|msf1)$/.test(brand);

  if (pdf) {
    return options.allowPdf
      ? { ok: true, kind: "pdf" }
      : { ok: false, message: "この画面ではPDFは読み込めません。画像を選んでください。" };
  }
  if (jpeg || png) {
    try {
      const dimensionBytes = jpeg
        ? new Uint8Array(await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer())
        : bytes;
      const dimensions = jpeg ? jpegDimensions(dimensionBytes) : pngDimensions(dimensionBytes);
      if (!safeDimensions(dimensions)) {
        return { ok: false, message: "画像サイズが大きすぎるため安全のため読み込めません。" };
      }
    } catch {
      return { ok: false, message: "画像サイズを安全に確認できませんでした。" };
    }
    return { ok: true, kind: "image" };
  }
  if (webp || heif) return { ok: true, kind: "image" };

  return {
    ok: false,
    message: "対応していない、または内容と拡張子が一致しないファイルです。JPEG・PNG・WebP・HEIC" +
      (options.allowPdf ? "・PDF" : "") + "を選んでください。",
  };
}
