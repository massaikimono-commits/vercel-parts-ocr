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

function levenshtein(a, b) {
  const x = [...a];
  const y = [...b];
  const row = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = saved;
    }
  }
  return row[y.length];
}

function lexiconEvidence(normalized) {
  const evidence = [];
  for (const field of FIELDS) {
    let best = null;
    for (const alias of HEADER_ALIASES[field]) {
      const normalizedAlias = compact(alias);
      const rawDistance = levenshtein(normalized, normalizedAlias);
      const normalizedEditDistance = normalized.length || normalizedAlias.length ? rawDistance / Math.max(normalized.length, normalizedAlias.length) : 0;
      const substring = normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized);
      const prefix = normalized.startsWith(normalizedAlias) || normalizedAlias.startsWith(normalized);
      const suffix = normalized.endsWith(normalizedAlias) || normalizedAlias.endsWith(normalized);
      const item = { aliasHash: `fnv1a:${fnv1a(normalizedAlias)}`, aliasLength: normalizedAlias.length, normalizedEditDistance: Number(normalizedEditDistance.toFixed(4)), substring, prefix, suffix };
      if (!best || item.normalizedEditDistance < best.normalizedEditDistance || (item.substring && !best.substring)) best = item;
    }
    evidence.push({ field, ...best });
  }
  return evidence;
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

export function diagnoseSemanticHeaderRootCause(tokens) {
  if (!tokens.length) return { diagnosticOnly: true, mappedFields: [], headerBand: null, columnCentersNormalized: {}, tokenXDistribution: [], rowTokenXDistribution: [], candidates: [] };
  const anchors = inferHeaderAnchors(tokens);
  const mappedFields = FIELDS.filter((field) => anchors[field]);
  const minX = Math.min(...tokens.map((token) => token.x1));
  const maxX = Math.max(...tokens.map((token) => token.x2));
  const minY = Math.min(...tokens.map((token) => token.y1));
  const maxY = Math.max(...tokens.map((token) => token.y2));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const headerBandMaxY = minY + height * 0.45;
  const medianHeight = median(tokens.map((token) => Math.max(1, token.y2 - token.y1))) || 12;
  const lineTolerance = Math.max(3, medianHeight * 0.75);
  const candidates = tokens.map((token, index) => {
    const normalized = compact(token.text);
    const cx = (token.x1 + token.x2) / 2;
    const cy = (token.y1 + token.y2) / 2;
    const neighbors = tokens.map((other, otherIndex) => ({ other, otherIndex, cy: (other.y1 + other.y2) / 2, cx: (other.x1 + other.x2) / 2 })).filter((item) => item.otherIndex !== index && Math.abs(item.cy - cy) <= lineTolerance).sort((a, b) => Math.abs(a.cx - cx) - Math.abs(b.cx - cx));
    const adjacent = neighbors.filter((item) => Math.abs(item.cx - cx) <= Math.max(token.x2 - token.x1, medianHeight) * 3).slice(0, 4);
    const splitEvidence = adjacent.flatMap((item) => {
      const pairA = compact(token.text) + compact(item.other.text);
      const pairB = compact(item.other.text) + compact(token.text);
      return [pairA, pairB].map((pair) => ({ pairHash: `fnv1a:${fnv1a(pair)}`, pairLength: pair.length, evidence: lexiconEvidence(pair).filter((entry) => entry.substring || entry.normalizedEditDistance <= 0.5) })).filter((item) => item.evidence.length);
    });
    const lexical = lexiconEvidence(normalized);
    const exactFields = FIELDS.filter((field) => HEADER_ALIASES[field].some((alias) => normalized.includes(compact(alias))));
    const best = [...lexical].sort((a, b) => a.normalizedEditDistance - b.normalizedEditDistance || Number(b.substring) - Number(a.substring))[0];
    const inHeaderBand = cy <= headerBandMaxY;
    let rejectReason = "none";
    if (!inHeaderBand && !exactFields.length) rejectReason = "outside-observed-header-band";
    else if (!exactFields.length && splitEvidence.length) rejectReason = "possible-split-token-fragmentation";
    else if (!exactFields.length && best?.normalizedEditDistance <= 0.5) rejectReason = "near-lexicon-but-current-exact-alias-reject";
    else if (!exactFields.length) rejectReason = "ocr-or-lexicon-distance-too-large";
    return {
      tokenIndex: index,
      textHash: `fnv1a:${fnv1a(normalized)}`,
      bboxNormalized: { x: Number(((token.x1 - minX) / width).toFixed(5)), y: Number(((token.y1 - minY) / height).toFixed(5)), w: Number(((token.x2 - token.x1) / width).toFixed(5)), h: Number(((token.y2 - token.y1) / height).toFixed(5)) },
      centerNormalized: { x: Number(((cx - minX) / width).toFixed(5)), y: Number(((cy - minY) / height).toFixed(5)) },
      confidence: token.confidence ?? null,
      normalizedCharCount: normalized.length,
      characterClassPattern: textClass(normalized),
      lexiconEvidence: lexical,
      sameLineNeighborCount: neighbors.length,
      adjacentTokenEvidence: adjacent.map((item) => ({ tokenIndex: item.otherIndex, textHash: `fnv1a:${fnv1a(compact(item.other.text))}`, normalizedDx: Number((Math.abs(item.cx - cx) / width).toFixed(5)) })),
      splitTokenAdjacencyEvidence: splitEvidence,
      candidateHeaderBandMembership: inHeaderBand,
      candidateSemanticLabel: exactFields[0] ?? best?.field ?? null,
      semanticScore: exactFields.length ? 1 : best ? Number((1 - best.normalizedEditDistance).toFixed(4)) : 0,
      rejectReason,
    };
  }).filter((candidate) => candidate.candidateHeaderBandMembership || candidate.semanticScore >= 0.5 || candidate.splitTokenAdjacencyEvidence.length).sort((a, b) => a.centerNormalized.y - b.centerNormalized.y || a.centerNormalized.x - b.centerNormalized.x).slice(0, 96);
  const clustered = clusterRows(tokens);
  return {
    diagnosticOnly: true,
    mappedFields,
    headerBand: { normalizedMinY: 0, normalizedMaxY: 0.45, source: "observed-token-y-range" },
    columnCentersNormalized: Object.fromEntries(mappedFields.map((field) => [field, Number(((anchors[field].x - minX) / width).toFixed(5))])),
    interColumnDistancesNormalized: mappedFields.slice(1).map((field, index) => ({ left: mappedFields[index], right: field, distance: Number((Math.abs(anchors[field].x - anchors[mappedFields[index]].x) / width).toFixed(5)) })),
    tokenXDistribution: tokens.map((token) => Number((((token.x1 + token.x2) / 2 - minX) / width).toFixed(5))).sort((a, b) => a - b),
    rowTokenXDistribution: clustered.slice(0, 20).map((row) => ({ rowId: row.rowId, cyNormalized: Number(((row.cy - minY) / height).toFixed(5)), x: row.tokens.map((token) => Number((((token.x1 + token.x2) / 2 - minX) / width).toFixed(5))) })),
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
