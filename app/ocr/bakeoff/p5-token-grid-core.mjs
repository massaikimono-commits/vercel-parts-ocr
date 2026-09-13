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

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function textClass(text) {
  const value = String(text ?? "");
  let han = 0;
  let kana = 0;
  let digit = 0;
  let latin = 0;
  let other = 0;
  for (const char of value) {
    if (/\p{Script=Han}/u.test(char)) han += 1;
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)) kana += 1;
    else if (/\d/u.test(char)) digit += 1;
    else if (/[A-Za-z]/u.test(char)) latin += 1;
    else if (!/\s/u.test(char)) other += 1;
  }
  return { han, kana, digit, latin, other };
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

export function diagnoseHeaderCandidates(tokens) {
  const anchors = inferHeaderAnchors(tokens);
  const mappedFields = FIELDS.filter((field) => anchors[field]);
  const ys = tokens.map((token) => (token.y1 + token.y2) / 2).filter(Number.isFinite);
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const headerZoneMaxY = minY + (maxY - minY) * 0.45;
  const candidates = tokens
    .map((token, index) => {
      const normalized = compact(token.text);
      const matches = FIELDS.filter((field) => HEADER_ALIASES[field].some((alias) => normalized.includes(compact(alias))));
      const xCenter = (token.x1 + token.x2) / 2;
      const yCenter = (token.y1 + token.y2) / 2;
      return {
        tokenIndex: index,
        textHash: `fnv1a:${fnv1a(normalized)}`,
        normalizedLength: normalized.length,
        textClass: textClass(normalized),
        xCenter,
        yCenter,
        confidence: token.confidence ?? null,
        headerCandidateReason: matches.length ? "alias-match" : (yCenter <= headerZoneMaxY ? "header-zone-observation" : "not-header-zone"),
        semanticLabelCandidates: matches,
        labelConfidence: matches.length ? 1 : 0,
      };
    })
    .filter((candidate) => candidate.headerCandidateReason !== "not-header-zone")
    .sort((a, b) => a.yCenter - b.yCenter || a.xCenter - b.xCenter)
    .slice(0, 48);
  return {
    mappedFields,
    columnCenterEstimate: Object.fromEntries(mappedFields.map((field) => [field, anchors[field].x])),
    observedHeaderZoneTokenCount: candidates.length,
    candidates,
  };
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
