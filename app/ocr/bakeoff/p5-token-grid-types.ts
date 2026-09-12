export type P5Token = {
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence?: number | null;
};

export type P5Row = {
  rowId: string;
  fields: {
    name: string;
    qty: string;
    retail: string;
    cost: string;
  };
  sourceTokenCount: number;
};

export type P5StageDiagnostics = {
  inputTokenCount: number;
  mappedHeaderFieldCount: number;
  clusteredRowCount: number;
  reconstructedRowCount: number;
};

export type P5Result = {
  candidateId: "P5";
  candidateVersion: "token-grid-hybrid.v0-poc";
  architecture: string;
  stageDiagnostics: P5StageDiagnostics;
  rows: P5Row[];
  manualReviewRequired: true;
  abstainReason: string;
  wrongAutoConfirm: 0;
  gtIncluded: false;
};
