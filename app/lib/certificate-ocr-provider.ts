export type OcrBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type OcrToken = {
  text: string;
  confidence: number;
  box: OcrBox;
};

export type CertificateOcrResult = {
  provider: string;
  width: number;
  height: number;
  elapsedMs: number;
  tokens: OcrToken[];
  rawText?: string;
};

export type CertificateOcrRequest = {
  image: Blob;
  language?: "ja" | "auto";
};

/**
 * Provider-neutral contract for photo/scanned-certificate OCR.
 * Implementations may use a cloud document OCR service, a self-hosted OCR
 * server, or the existing browser Tesseract fallback. The rest of the app
 * should consume only this normalized result shape.
 */
export interface CertificateOcrProvider {
  readonly name: string;
  recognize(request: CertificateOcrRequest): Promise<CertificateOcrResult>;
}
