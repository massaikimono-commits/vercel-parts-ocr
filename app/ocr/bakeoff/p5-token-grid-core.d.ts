export type P5Token = { text: string; x1: number; y1: number; x2: number; y2: number; confidence?: number | null };
export type P5Row = { rowId: string; fields: { name: string; qty: string; retail: string; cost: string }; sourceTokenCount: number };
export type P5Result = {
  candidateId: "P5";
  candidateVersion: "token-grid-hybrid.v0-poc";
  architecture: string;
  stageDiagnostics: { inputTokenCount: number; mappedHeaderFieldCount: number; clusteredRowCount: number; reconstructedRowCount: number };
  rows: P5Row[];
  manualReviewRequired: true;
  abstainReason: string;
  wrongAutoConfirm: 0;
  gtIncluded: false;
};
export function inferHeaderAnchors(tokens: P5Token[]): Partial<Record<"name" | "qty" | "retail" | "cost", { x: number; y: number; token: P5Token }>>;
export function clusterRows(tokens: P5Token[]): Array<{ rowId: string; cy: number; tokens: P5Token[] }>;
export function reconstructTokenGrid(tokens: P5Token[]): P5Result;
