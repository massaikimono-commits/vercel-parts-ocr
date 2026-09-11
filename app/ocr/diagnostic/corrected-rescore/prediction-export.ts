export type PredictionRow = {
  rowIndex: number;
  fields: { name: string; qty: string; retail: string; cost: string };
  confidence: { name: number | null; qty: number | null; retail: number | null; cost: number | null };
};

export type StagePredictionExport = {
  schema: "icb.parts-ocr.prediction-export.v2";
  stage: "A20" | "A21" | "A22";
  timestamp: string;
  runtimeConfigIdentifier: string;
  gtIncluded: false;
  images: Array<{
    imageId: string;
    captureId: string;
    documentIds: string[];
    subset: "SINGLE_DOCUMENT" | "MULTI_DOCUMENT_COMPOSITE";
    engines: Record<string, { rows: PredictionRow[]; processingTimeMs: number | null; error: string | null }>;
  }>;
};

const lineage: Record<string, { captureId: string; documentIds: string[]; subset: "SINGLE_DOCUMENT" | "MULTI_DOCUMENT_COMPOSITE" }> = {
  IMG_0675:{captureId:"CAP-0675",documentIds:["YD-001"],subset:"SINGLE_DOCUMENT"},
  IMG_0676:{captureId:"CAP-0676",documentIds:["YD-001"],subset:"SINGLE_DOCUMENT"},
  IMG_0677:{captureId:"CAP-0677",documentIds:["YD-001"],subset:"SINGLE_DOCUMENT"},
  IMG_0678:{captureId:"CAP-0678",documentIds:["YD-002"],subset:"SINGLE_DOCUMENT"},
  IMG_0679:{captureId:"CAP-0679",documentIds:["YD-002"],subset:"SINGLE_DOCUMENT"},
  IMG_0680:{captureId:"CAP-0680",documentIds:["YD-003"],subset:"SINGLE_DOCUMENT"},
  IMG_0681:{captureId:"CAP-0681",documentIds:["YD-003"],subset:"SINGLE_DOCUMENT"},
  IMG_0682:{captureId:"CAP-0682",documentIds:["YD-004"],subset:"SINGLE_DOCUMENT"},
  IMG_0683:{captureId:"CAP-0683",documentIds:["YD-004"],subset:"SINGLE_DOCUMENT"},
  IMG_0684:{captureId:"CAP-0684",documentIds:["YD-005","YD-006"],subset:"MULTI_DOCUMENT_COMPOSITE"},
  IMG_0685:{captureId:"CAP-0685",documentIds:["YD-005","YD-006"],subset:"MULTI_DOCUMENT_COMPOSITE"},
  IMG_0686:{captureId:"CAP-0686",documentIds:["YD-005","YD-006"],subset:"MULTI_DOCUMENT_COMPOSITE"}
};

export function canonicalImageId(value: string) {
  const match = value.match(/IMG_(067[5-9]|068[0-6])/i);
  return match ? `IMG_${match[1]}` : "";
}

export function relationFor(imageId: string) {
  const relation = lineage[imageId];
  if (!relation) throw new Error(`unknown image lineage: ${imageId}`);
  return relation;
}

export function downloadPredictionExport(payload: StagePredictionExport) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${payload.stage.toLowerCase()}-corrected-v2-predictions-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export function rowsFromCells(cells: any[], engine: string): PredictionRow[] {
  const byRow = new Map<number, PredictionRow>();
  for (const cell of cells || []) {
    const rowIndex = Number(cell.rowIndex);
    if (!byRow.has(rowIndex)) byRow.set(rowIndex, { rowIndex, fields:{name:"",qty:"",retail:"",cost:""}, confidence:{name:null,qty:null,retail:null,cost:null} });
    const row = byRow.get(rowIndex)!;
    const field = cell.field as keyof PredictionRow["fields"];
    if (!(field in row.fields)) continue;
    const recognition = cell.recognition?.[engine] || {};
    row.fields[field] = String(recognition.normalized || "");
    row.confidence[field] = typeof recognition.confidence === "number" ? recognition.confidence : null;
  }
  return [...byRow.values()].sort((a,b) => a.rowIndex-b.rowIndex);
}
