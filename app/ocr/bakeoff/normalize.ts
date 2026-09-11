import type { FieldKey, NormalizedFieldPrediction, RowPrediction } from "./contract";

const EMPTY_FIELDS = ["name", "qty", "retail", "cost"] as const;

export function normalizeField(raw: string, field: FieldKey, confidence: number | null, source: string): NormalizedFieldPrediction {
  const text = raw.normalize("NFKC").replace(/\r/g, "").replace(/\s+/g, " ").trim();
  if (field === "name") {
    return { raw, normalized: text.replace(/^[\s|:;.,・]+|[\s|:;.,・]+$/g, "").trim(), confidence, source };
  }
  const candidates = text.replace(/[|Il!]/g, "1").replace(/[Oo]/g, "0").match(/\d{1,3}(?:[,\.\s]\d{3})+|\d{1,7}/g);
  return { raw, normalized: candidates?.map((value) => value.replace(/\D/g, "")).find(Boolean) ?? "", confidence, source };
}

export function emptyRow(rowId: string, source: string): RowPrediction {
  return {
    rowId,
    region: null,
    fields: Object.fromEntries(EMPTY_FIELDS.map((field) => [field, normalizeField("", field, null, source)])) as RowPrediction["fields"],
    confidence: null,
    duplicateOf: null,
  };
}

export function rowConfidence(row: RowPrediction) {
  const values = Object.values(row.fields).map((field) => field.confidence).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
