const FIELDS = ["name", "qty", "retail", "cost"];

const HEADER_ALIASES = {
  name: ["品名", "部品名称", "商品名", "名称", "description"],
  qty: ["出庫数", "数量", "個数", "qty", "quantity"],
  retail: ["標準価格", "定価", "単価", "retail", "listprice"],
  cost: ["仕入", "原価", "卸値", "cost", "purchase"],
};

function compact(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase().replace(/[\s/／・:：;；,，._\-—‐―ー()（）\[\]【】{}「」『』<>＜＞]+/g, "");
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

function similarity(a, b) {
  if (!a && !b) return 1;
  const denominator = Math.max([...a].length, [...b].length, 1);
  return 1 - levenshtein(a, b) / denominator;
}

function numeric(text) {
  const normalized = String(text ?? "").normalize("NFKC").replace(/[￥¥,\s]/g, "").replace(/[|Il!]/g, "1").replace(/[Oo]/g, "0");
  return normalized.match(/\d{1,7}/)?.[0] ?? "";
}

function numericLike(text) {
  const source = String(text ?? "").normalize("NFKC").replace(/[￥¥,\.\s-]/g, "").replace(/[|Il!]/g, "1").replace(/[Oo]/g, "0");
  return /^\d{1,9}$/.test(source);
}

function normalizeField(field, text) {
  if (field === "name") return String(text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return numeric(text);
}

function tokenCenter(token) {
  return { x: (token.x1 + token.x2) / 2, y: (token.y1 + token.y2) / 2 };
}

function tokenBounds(tokens) {
  if (!tokens.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1, width: 1, height: 1 };
  const minX = Math.min(...tokens.map((token) => token.x1));
  const maxX = Math.max(...tokens.map((token) => token.x2));
  const minY = Math.min(...tokens.map((token) => token.y1));
  const maxY = Math.max(...tokens.map((token) => token.y2));
  return { minX, maxX, minY, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function clusterRows(tokens) {
  const content = tokens.filter((token) => String(token.text ?? "").trim());
  const medianHeight = median(content.map((token) => Math.max(1, token.y2 - token.y1))) || 12;
  const tolerance = Math.max(3, medianHeight * 0.65);
  const rows = [];
  for (const token of [...content].sort((a, b) => ((a.y1 + a.y2) - (b.y1 + b.y2)) || a.x1 - b.x1)) {
    const cy = (token.y1 + token.y2) / 2;
    let row = rows.find((candidate) => Math.abs(candidate.cy - cy) <= tolerance);
    if (!row) {
      row = { cy, tokens: [] };
      rows.push(row);
    }
    row.tokens.push(token);
    row.cy = row.tokens.reduce((sum, item) => sum + (item.y1 + item.y2) / 2, 0) / row.tokens.length;
  }
  return rows.sort((a, b) => a.cy - b.cy).map((row, index) => ({ rowId: `R${String(index + 1).padStart(2, "0")}`, cy: row.cy, tokens: row.tokens.sort((a, b) => a.x1 - b.x1) }));
}

function exactSemantic(text) {
  const normalized = compact(text);
  for (const field of FIELDS) {
    if (HEADER_ALIASES[field].some((alias) => normalized.includes(compact(alias)))) return { field, score: 1 };
  }
  return null;
}

function fuzzySemantic(text) {
  const normalized = compact(text);
  if (normalized.length < 2) return null;
  let best = null;
  for (const field of FIELDS) {
    for (const alias of HEADER_ALIASES[field]) {
      const target = compact(alias);
      const score = similarity(normalized, target);
      const contains = normalized.includes(target) || target.includes(normalized);
      const adjusted = contains && Math.min(normalized.length, target.length) >= 2 ? Math.max(score, 0.82) : score;
      if (!best || adjusted > best.score) best = { field, score: adjusted };
    }
  }
  return best && best.score >= 0.66 ? best : null;
}

function buildPhraseCandidates(tokens) {
  const rows = clusterRows(tokens);
  const medianHeight = median(tokens.map((token) => Math.max(1, token.y2 - token.y1))) || 12;
  const phrases = [];
  for (const row of rows) {
    const ordered = row.tokens;
    for (let start = 0; start < ordered.length; start += 1) {
      for (let size = 1; size <= 3 && start + size <= ordered.length; size += 1) {
        const slice = ordered.slice(start, start + size);
        if (size > 1) {
          let adjacent = true;
          for (let i = 1; i < slice.length; i += 1) {
            const gap = Math.max(0, slice[i].x1 - slice[i - 1].x2);
            const localWidth = Math.max(1, Math.min(slice[i].x2 - slice[i].x1, slice[i - 1].x2 - slice[i - 1].x1));
            if (gap > Math.max(medianHeight * 2.5, localWidth * 1.5)) adjacent = false;
          }
          if (!adjacent) continue;
        }
        const text = slice.map((token) => token.text).join("");
        const x1 = Math.min(...slice.map((token) => token.x1));
        const x2 = Math.max(...slice.map((token) => token.x2));
        const y1 = Math.min(...slice.map((token) => token.y1));
        const y2 = Math.max(...slice.map((token) => token.y2));
        phrases.push({ text, x1, x2, y1, y2, tokenCount: size, rowId: row.rowId });
      }
    }
  }
  return phrases;
}

function inferAnchors(tokens, mode) {
  const bounds = tokenBounds(tokens);
  const bandMaxY = bounds.minY + bounds.height * 0.45;
  const phrases = mode === "CURRENT" ? tokens.map((token) => ({ ...token, tokenCount: 1 })) : buildPhraseCandidates(tokens);
  const candidates = [];
  for (const phrase of phrases) {
    const center = tokenCenter(phrase);
    const inBand = center.y <= bandMaxY;
    const semantic = mode === "CURRENT" || mode === "A_SPLIT" ? exactSemantic(phrase.text) : fuzzySemantic(phrase.text);
    if (!semantic) continue;
    if (mode === "A_SPLIT" && phrase.tokenCount === 1 && !inBand) continue;
    if (mode === "B_FUZZY" && !inBand) continue;
    let score = semantic.score;
    if (inBand) score += 0.12;
    if (phrase.tokenCount >= 2) score += 0.04;
    if (mode === "C_SOFT_BAND" && !inBand) {
      const normalizedY = (center.y - bounds.minY) / bounds.height;
      if (semantic.score < 0.82 || normalizedY > 0.72) continue;
      score -= 0.12 + Math.max(0, normalizedY - 0.45) * 0.3;
    }
    candidates.push({ field: semantic.field, score, semanticScore: semantic.score, x: center.x, y: center.y, tokenCount: phrase.tokenCount, inBand });
  }

  const anchors = {};
  for (const field of FIELDS) {
    const fieldCandidates = candidates.filter((candidate) => candidate.field === field).sort((a, b) => b.score - a.score || a.y - b.y);
    if (fieldCandidates[0]) anchors[field] = fieldCandidates[0];
  }
  return anchors;
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

function reconstructWithAnchors(tokens, anchors, variantId) {
  const mappedFields = FIELDS.filter((field) => anchors[field]);
  const headerY = mappedFields.length ? Math.max(...mappedFields.map((field) => anchors[field].y)) : null;
  const clustered = clusterRows(tokens);
  const dataRows = headerY === null ? [] : clustered.filter((row) => row.cy > headerY);
  const rows = [];
  let columnAssignmentCount = 0;
  for (const sourceRow of dataRows) {
    const buckets = { name: [], qty: [], retail: [], cost: [] };
    for (const token of sourceRow.tokens) {
      const cx = (token.x1 + token.x2) / 2;
      const field = nearestField(cx, anchors);
      if (!field) continue;
      buckets[field].push(token.text);
      columnAssignmentCount += 1;
    }
    const fields = Object.fromEntries(FIELDS.map((field) => [field, normalizeField(field, buckets[field].join(" "))]));
    if (!Object.values(fields).some(Boolean)) continue;
    rows.push({ rowId: sourceRow.rowId, fields, sourceTokenCount: sourceRow.tokens.length });
  }
  const counts = Object.fromEntries(FIELDS.map((field) => [`nonBlank${field[0].toUpperCase()}${field.slice(1)}Count`, rows.filter((row) => Boolean(row.fields[field])).length]));
  return {
    variantId,
    mappedHeaderFieldCount: mappedFields.length,
    rowClusterCount: clustered.length,
    columnAssignmentCount,
    reconstructedRowCount: rows.length,
    nonBlankNameCount: counts.nonBlankNameCount,
    nonBlankQtyCount: counts.nonBlankQtyCount,
    nonBlankRetailCount: counts.nonBlankRetailCount,
    nonBlankCostCount: counts.nonBlankCostCount,
    wrongAutoConfirm: 0,
    manualReviewRequired: true,
    rows,
  };
}

function kmeans1d(values, k) {
  if (!values.length || k <= 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const count = Math.min(k, sorted.length);
  let centers = Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : index * (sorted.length - 1) / (count - 1);
    return sorted[Math.round(position)];
  });
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const buckets = centers.map(() => []);
    for (const value of sorted) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      centers.forEach((center, index) => {
        const distance = Math.abs(value - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      buckets[bestIndex].push(value);
    }
    const next = centers.map((center, index) => buckets[index].length ? median(buckets[index]) : center);
    if (next.every((value, index) => Math.abs(value - centers[index]) < 1e-5)) break;
    centers = next;
  }
  return centers.sort((a, b) => a - b);
}

function deriveColumnLattice(tokens, semanticAnchors) {
  const bounds = tokenBounds(tokens);
  const clustered = clusterRows(tokens);
  const known = FIELDS.filter((field) => semanticAnchors[field]);
  const headerY = known.length ? Math.max(...known.map((field) => semanticAnchors[field].y)) : bounds.minY + bounds.height * 0.35;
  const dataRows = clustered.filter((row) => row.cy > headerY && row.cy <= bounds.maxY);

  const rowNormalizedXs = [];
  for (const row of dataRows) {
    const xs = row.tokens
      .filter((token) => String(token.text ?? "").trim())
      .map((token) => (tokenCenter(token).x - bounds.minX) / bounds.width)
      .filter((x) => x >= 0 && x <= 1)
      .sort((a, b) => a - b);
    if (xs.length < 2) continue;
    const deduped = [];
    for (const x of xs) {
      if (!deduped.length || Math.abs(x - deduped[deduped.length - 1]) > 0.025) deduped.push(x);
    }
    rowNormalizedXs.push(...deduped);
  }

  const semanticXs = known.map((field) => (semanticAnchors[field].x - bounds.minX) / bounds.width);
  const allXs = [...rowNormalizedXs, ...semanticXs];
  if (allXs.length < 4) return { anchors: semanticAnchors, confidences: Object.fromEntries(known.map((field) => [field, Math.min(1, semanticAnchors[field].semanticScore ?? 1)])), headerY, dataRows, bounds };

  let centers = kmeans1d(allXs, 4);
  if (centers.length < 4) return { anchors: semanticAnchors, confidences: Object.fromEntries(known.map((field) => [field, Math.min(1, semanticAnchors[field].semanticScore ?? 1)])), headerY, dataRows, bounds };

  const assignments = {};
  const usedCenters = new Set();
  for (const field of known) {
    const x = (semanticAnchors[field].x - bounds.minX) / bounds.width;
    let best = -1;
    let bestDistance = Infinity;
    centers.forEach((center, index) => {
      if (usedCenters.has(index)) return;
      const distance = Math.abs(x - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (best >= 0 && bestDistance <= 0.16) {
      assignments[field] = best;
      usedCenters.add(best);
    }
  }

  const orderedKnown = FIELDS.map((field, fieldIndex) => ({ field, fieldIndex, centerIndex: assignments[field] })).filter((item) => Number.isInteger(item.centerIndex));
  let orderValid = true;
  for (let i = 1; i < orderedKnown.length; i += 1) {
    if (orderedKnown[i].centerIndex <= orderedKnown[i - 1].centerIndex) orderValid = false;
  }
  if (!orderValid) {
    centers = centers.sort((a, b) => a - b);
    for (const key of Object.keys(assignments)) delete assignments[key];
    usedCenters.clear();
  }

  const remainingFields = FIELDS.filter((field) => assignments[field] === undefined);
  const remainingCenters = centers.map((_, index) => index).filter((index) => !usedCenters.has(index));
  for (const field of remainingFields) {
    const fieldIndex = FIELDS.indexOf(field);
    const compatible = remainingCenters.filter((centerIndex) => {
      const leftKnown = FIELDS.slice(0, fieldIndex).reverse().find((candidate) => assignments[candidate] !== undefined);
      const rightKnown = FIELDS.slice(fieldIndex + 1).find((candidate) => assignments[candidate] !== undefined);
      if (leftKnown && centerIndex <= assignments[leftKnown]) return false;
      if (rightKnown && centerIndex >= assignments[rightKnown]) return false;
      return true;
    });
    if (!compatible.length) continue;
    const idealRank = fieldIndex / (FIELDS.length - 1);
    compatible.sort((a, b) => Math.abs(centers[a] - idealRank) - Math.abs(centers[b] - idealRank));
    const chosen = compatible[0];
    assignments[field] = chosen;
    remainingCenters.splice(remainingCenters.indexOf(chosen), 1);
  }

  const anchors = {};
  const confidences = {};
  for (const field of FIELDS) {
    if (semanticAnchors[field]) {
      anchors[field] = semanticAnchors[field];
      confidences[field] = Math.min(1, Math.max(0.72, semanticAnchors[field].semanticScore ?? 1));
      continue;
    }
    const centerIndex = assignments[field];
    if (!Number.isInteger(centerIndex)) continue;
    const center = centers[centerIndex];
    const nearbyRows = dataRows.filter((row) => row.tokens.some((token) => Math.abs(((tokenCenter(token).x - bounds.minX) / bounds.width) - center) <= 0.075)).length;
    const coverage = dataRows.length ? nearbyRows / dataRows.length : 0;
    const neighborSupport = [fieldIndexOf(field) - 1, fieldIndexOf(field) + 1]
      .map((index) => FIELDS[index])
      .filter(Boolean)
      .filter((neighbor) => semanticAnchors[neighbor] || assignments[neighbor] !== undefined).length;
    const confidence = Math.min(0.78, 0.36 + coverage * 0.32 + neighborSupport * 0.05);
    if (confidence < 0.45) continue;
    anchors[field] = { field, score: confidence, semanticScore: 0, x: bounds.minX + center * bounds.width, y: headerY, tokenCount: 0, inBand: false, inferredFromLattice: true };
    confidences[field] = confidence;
  }
  return { anchors, confidences, headerY, dataRows, bounds };
}

function fieldIndexOf(field) {
  return FIELDS.indexOf(field);
}

function reconstructColumnLattice(tokens, semanticAnchors) {
  const lattice = deriveColumnLattice(tokens, semanticAnchors);
  const { anchors, confidences, headerY, bounds } = lattice;
  const mappedFields = FIELDS.filter((field) => anchors[field] && (confidences[field] ?? 0) >= 0.45);
  const clustered = clusterRows(tokens);
  const dataRows = clustered.filter((row) => row.cy > headerY);
  const rows = [];
  let columnAssignmentCount = 0;
  const centers = mappedFields.map((field) => anchors[field].x).sort((a, b) => a - b);
  const spacings = centers.slice(1).map((value, index) => value - centers[index]).filter((value) => value > 0);
  const typicalSpacing = median(spacings) || bounds.width * 0.18;
  const minCenter = centers.length ? Math.min(...centers) : bounds.minX;
  const maxCenter = centers.length ? Math.max(...centers) : bounds.maxX;

  for (const sourceRow of dataRows) {
    const rowTokens = sourceRow.tokens.filter((token) => {
      const cx = tokenCenter(token).x;
      return cx >= minCenter - typicalSpacing * 0.7 && cx <= maxCenter + typicalSpacing * 0.7;
    });
    if (rowTokens.length < 2) continue;
    const buckets = { name: [], qty: [], retail: [], cost: [] };
    const assignedFields = new Set();
    let numericAssignments = 0;
    let rowAssignments = 0;
    for (const token of rowTokens) {
      const cx = tokenCenter(token).x;
      let best = null;
      for (const field of mappedFields) {
        const distance = Math.abs(cx - anchors[field].x);
        if (!best || distance < best.distance) best = { field, distance };
      }
      if (!best || best.distance > typicalSpacing * 0.72) continue;
      buckets[best.field].push(token.text);
      assignedFields.add(best.field);
      rowAssignments += 1;
      if (best.field !== "name" && numericLike(token.text)) numericAssignments += 1;
    }
    const fields = Object.fromEntries(FIELDS.map((field) => [field, normalizeField(field, buckets[field].join(" "))]));
    const nonBlankFields = FIELDS.filter((field) => Boolean(fields[field]));
    const numericNonBlank = ["qty", "retail", "cost"].filter((field) => Boolean(fields[field])).length;
    const semanticSupport = nonBlankFields.length + numericNonBlank;
    const horizontalAlignment = assignedFields.size >= 2;
    const plausible = numericAssignments > 0 || numericNonBlank >= 1;
    if (!horizontalAlignment || !plausible || semanticSupport < 3) continue;
    columnAssignmentCount += rowAssignments;
    rows.push({ rowId: sourceRow.rowId, fields, sourceTokenCount: sourceRow.tokens.length });
  }

  const counts = Object.fromEntries(FIELDS.map((field) => [`nonBlank${field[0].toUpperCase()}${field.slice(1)}Count`, rows.filter((row) => Boolean(row.fields[field])).length]));
  return {
    variantId: "D_PARTIAL_HEADER_COLUMN_LATTICE",
    mappedHeaderFieldCount: mappedFields.length,
    rowClusterCount: clustered.length,
    columnAssignmentCount,
    reconstructedRowCount: rows.length,
    nonBlankNameCount: counts.nonBlankNameCount,
    nonBlankQtyCount: counts.nonBlankQtyCount,
    nonBlankRetailCount: counts.nonBlankRetailCount,
    nonBlankCostCount: counts.nonBlankCostCount,
    wrongAutoConfirm: 0,
    manualReviewRequired: true,
    rows,
  };
}

export function compareSemanticMappingCandidates(tokens) {
  const variants = [
    ["CURRENT", "CURRENT"],
    ["A_SPLIT_TOKEN_COMPOSITION", "A_SPLIT"],
    ["B_GENERALIZED_FUZZY", "B_FUZZY"],
    ["C_SOFT_HEADER_BAND", "C_SOFT_BAND"],
  ];
  const baseline = variants.map(([variantId, mode]) => reconstructWithAnchors(tokens, inferAnchors(tokens, mode), variantId));
  const cAnchors = inferAnchors(tokens, "C_SOFT_BAND");
  return [...baseline, reconstructColumnLattice(tokens, cAnchors)];
}
