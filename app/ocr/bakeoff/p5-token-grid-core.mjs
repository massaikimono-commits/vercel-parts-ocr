const FIELDS = ["name", "qty", "retail", "cost"];

const HEADER_ALIASES = {
  name: ["品名", "部品名称", "商品名", "名称", "description"],
  qty: ["出庫数", "数量", "個数", "qty", "quantity"],
  retail: ["標準価格", "定価", "単価", "retail", "listprice"],
  cost: ["仕入", "原価", "卸値", "cost", "purchase"],
};

function compact(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase().replace(/[\s/／・:_-]+/g, "");
}

function numeric(text) {
  const normalized = String(text ?? "").normalize("NFKC").replace(/[￥¥,\s]/g, "").replace(/[|Il!]/g, "1").replace(/[Oo]/g, "0");
  const match = normalized.match(/\d{1,7}/);
  return match?.[0] ?? "";
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function inferHeaderAnchors(tokens) {
  const anchors = {};
  for (const token of tokens) {
    const value = compact(token.text);
    for (const field of FIELDS) {
      if (anchors[field]) continue;
      if (HEADER_ALIASES[field].some((alias) => value.includes(compact(alias)))) {
        anchors[field] = { x: (token.x1 + token.x2) / 2, y: (token.y1 + token.y2) / 2, token };
      }
    }
  }
  return anchors;
}

export function clusterRows(tokens) {
  const content = tokens.filter((t) => String(t.text ?? "").trim());
  const medianHeight = median(content.map((t) => Math.max(1, t.y2 - t.y1))) || 12;
  const tolerance = Math.max(3, medianHeight * 0.65);
  const rows = [];
  for (const token of [...content].sort((a, b) => ((a.y1 + a.y2) - (b.y1 + b.y2)) || a.x1 - b.x1)) {
    const cy = (token.y1 + token.y2) / 2;
    let row = rows.find((r) => Math.abs(r.cy - cy) <= tolerance);
    if (!row) {
      row = { cy, tokens: [] };
      rows.push(row);
    }
    row.tokens.push(token);
    row.cy = row.tokens.reduce((sum, item) => sum + (item.y1 + item.y2) / 2, 0) / row.tokens.length;
  }
  return rows.sort((a, b) => a.cy - b.cy).map((row, index) => ({ rowId: `R${String(index + 1).padStart(2, "0")}`, cy: row.cy, tokens: row.tokens.sort((a, b) => a.x1 - b.x1) }));
}

function nearestField(x, anchors) {
  let best = null;
  for (const field of FIELDS) {
    const anchor = anchors[field];
    if (!anchor) continue;
    const distance = Math.abs(x - anchor.x);
    if (!best || distance < best.distance) best = { field, distance };
  }
  return best?.field ?? null;
}

function normalizeField(field, text) {
  if (field === "name") return String(text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return numeric(text);
}

export function reconstructTokenGrid(tokens) {
  const anchors = inferHeaderAnchors(tokens);
  const mappedFields = FIELDS.filter((field) => anchors[field]);
  const headerY = mappedFields.length ? Math.max(...mappedFields.map((field) => anchors[field].y)) : null;
  const clustered = clusterRows(tokens);
  const dataRows = headerY === null ? clustered : clustered.filter((row) => row.cy > headerY);
  const rows = [];
  for (const sourceRow of dataRows) {
    const buckets = { name: [], qty: [], retail: [], cost: [] };
    for (const token of sourceRow.tokens) {
      const cx = (token.x1 + token.x2) / 2;
      const field = nearestField(cx, anchors);
      if (field) buckets[field].push(token.text);
    }
    const fields = Object.fromEntries(FIELDS.map((field) => [field, normalizeField(field, buckets[field].join(" "))]));
    if (!Object.values(fields).some(Boolean)) continue;
    rows.push({ rowId: sourceRow.rowId, fields, sourceTokenCount: sourceRow.tokens.length });
  }
  const reasons = [];
  if (mappedFields.length < 4) reasons.push("header-mapping-incomplete");
  if (!rows.length) reasons.push("no-reconstructed-rows");
  for (const row of rows) {
    if (!row.fields.name) reasons.push(`${row.rowId}:name-blank`);
    if (!row.fields.qty || !row.fields.retail || !row.fields.cost) reasons.push(`${row.rowId}:numeric-field-missing`);
  }
  const uniqueReasons = [...new Set(reasons)];
  return {
    candidateId: "P5",
    candidateVersion: "token-grid-hybrid.v0-poc",
    architecture: "ocr-token-boxes+header-anchors+row-clustering",
    stageDiagnostics: {
      inputTokenCount: tokens.length,
      mappedHeaderFieldCount: mappedFields.length,
      clusteredRowCount: clustered.length,
      reconstructedRowCount: rows.length,
    },
    rows,
    manualReviewRequired: true,
    abstainReason: uniqueReasons.length ? uniqueReasons.join(";") : "poc-not-auto-confirmable",
    wrongAutoConfirm: 0,
    gtIncluded: false,
  };
}
