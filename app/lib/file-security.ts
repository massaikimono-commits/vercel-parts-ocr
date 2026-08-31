export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

type FileCheck = { ok: true } | { ok: false; message: string };

function ascii(bytes: Uint8Array) {
  return String.fromCharCode(...Array.from(bytes));
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
      ? { ok: true }
      : { ok: false, message: "この画面ではPDFは読み込めません。画像を選んでください。" };
  }
  if (jpeg || png || webp || heif) return { ok: true };

  return {
    ok: false,
    message: "対応していない、または内容と拡張子が一致しないファイルです。JPEG・PNG・WebP・HEIC" +
      (options.allowPdf ? "・PDF" : "") + "を選んでください。",
  };
}
