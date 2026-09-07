const fs = require("node:fs");
const path = require("node:path");

function arg(name, fallback = "") {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const manifestPath = arg("manifest");
const resultsPath = arg("results");
const outPath = arg("out", "parts-ocr-quality-score.json");
if (!manifestPath || !resultsPath) {
  throw new Error("--manifest and --results are required");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const payload = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const results = Array.isArray(payload.results) ? payload.results : [];
const fields = ["name", "qty", "retail", "cost"];

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function normalizeField(field, value) {
  const s = normalizeText(value);
  if (field === "qty" || field === "retail" || field === "cost") {
    return s.replace(/[，,￥¥円\s]/g, "");
  }
  return s;
}

function scoreOne(item, result) {
  const expectedRows = Array.isArray(item.expectedRows) ? item.expectedRows : null;
  const actualRows = Array.isArray(result?.parts) ? result.parts : [];
  const score = {
    inputFile: item.filename,
    set: item.set || "",
    expectedRowsAvailable: !!expectedRows,
    expectedRows: expectedRows ? expectedRows.length : null,
    actualRows: actualRows.length,
    correctRows: null,
    missingRows: expectedRows ? Math.max(0, expectedRows.length - actualRows.length) : null,
    extraRows: expectedRows ? Math.max(0, actualRows.length - expectedRows.length) : null,
    blankErrors: null,
    misreadErrors: null,
    extraNonBlankFields: null,
    expectedMode: item.expectedMode || "",
    actualMode: result?.autoDecision || "",
    expectedModeMatch: item.expectedMode ? result?.autoDecision === item.expectedMode : null,
    timedOut: !!result?.timedOut,
    jsExceptionCount: Array.isArray(result?.jsExceptions) ? result.jsExceptions.length : 0,
    processingMs: typeof result?.processingMs === "number" ? result.processingMs : null,
    nonZero: actualRows.length > 0,
    fields: {},
  };

  for (const field of fields) {
    score.fields[field] = {
      correct: expectedRows ? 0 : null,
      total: expectedRows ? expectedRows.length : null,
      blankErrors: expectedRows ? 0 : null,
      misreadErrors: expectedRows ? 0 : null,
      accuracy: null,
    };
  }

  if (!expectedRows) return score;

  let correctRows = 0;
  let blankErrors = 0;
  let misreadErrors = 0;

  for (let i = 0; i < expectedRows.length; i += 1) {
    const expected = expectedRows[i] || {};
    const actual = actualRows[i] || {};
    let rowCorrect = true;

    for (const field of fields) {
      const e = normalizeField(field, expected[field]);
      const a = normalizeField(field, actual[field]);
      const fieldScore = score.fields[field];

      if (a === e) {
        fieldScore.correct += 1;
      } else {
        rowCorrect = false;
        if (a === "" && e !== "") {
          fieldScore.blankErrors += 1;
          blankErrors += 1;
        } else {
          fieldScore.misreadErrors += 1;
          misreadErrors += 1;
        }
      }
    }

    if (rowCorrect) correctRows += 1;
  }

  let extraNonBlankFields = 0;
  for (const row of actualRows.slice(expectedRows.length)) {
    for (const field of fields) {
      if (normalizeField(field, row?.[field]) !== "") extraNonBlankFields += 1;
    }
  }

  score.correctRows = correctRows;
  score.blankErrors = blankErrors;
  score.misreadErrors = misreadErrors + extraNonBlankFields;
  score.extraNonBlankFields = extraNonBlankFields;

  for (const field of fields) {
    const f = score.fields[field];
    f.accuracy = f.total ? f.correct / f.total : null;
  }

  return score;
}

const resultByFile = new Map(results.map((r) => [r.inputFile, r]));
const images = manifest.map((item) => scoreOne(item, resultByFile.get(item.filename)));

function aggregate(rows) {
  const scored = rows.filter((r) => r.expectedRowsAvailable);
  const agg = {
    images: rows.length,
    scoredImages: scored.length,
    unscoredImages: rows.length - scored.length,
    nonZeroImages: rows.filter((r) => r.nonZero).length,
    timeouts: rows.filter((r) => r.timedOut).length,
    jsExceptionCount: rows.reduce((n, r) => n + r.jsExceptionCount, 0),
    expectedRows: scored.reduce((n, r) => n + (r.expectedRows || 0), 0),
    actualRows: rows.reduce((n, r) => n + (r.actualRows || 0), 0),
    correctRows: scored.reduce((n, r) => n + (r.correctRows || 0), 0),
    blankErrors: scored.reduce((n, r) => n + (r.blankErrors || 0), 0),
    misreadErrors: scored.reduce((n, r) => n + (r.misreadErrors || 0), 0),
    processingMsTotal: rows.reduce((n, r) => n + (r.processingMs || 0), 0),
    processingMsAverage: rows.length
      ? Math.round(rows.reduce((n, r) => n + (r.processingMs || 0), 0) / rows.length)
      : null,
    expectedModeMismatches: rows.filter((r) => r.expectedModeMatch === false).length,
    fields: {},
  };

  for (const field of fields) {
    const total = scored.reduce((n, r) => n + (r.fields[field].total || 0), 0);
    const correct = scored.reduce((n, r) => n + (r.fields[field].correct || 0), 0);
    const blanks = scored.reduce((n, r) => n + (r.fields[field].blankErrors || 0), 0);
    const misreads = scored.reduce((n, r) => n + (r.fields[field].misreadErrors || 0), 0);
    agg.fields[field] = {
      correct,
      total,
      blankErrors: blanks,
      misreadErrors: misreads,
      accuracy: total ? correct / total : null,
    };
  }
  return agg;
}

const grouped = {};
for (const row of images) {
  if (!grouped[row.set]) grouped[row.set] = [];
  grouped[row.set].push(row);
}

const sets = Object.fromEntries(
  Object.entries(grouped).map(([name, rows]) => [name, aggregate(rows)])
);
const formalRows = images.filter((r) => r.set === "formal-yellow" || r.set === "formal-white");

const output = {
  generatedAt: new Date().toISOString(),
  manifest: path.resolve(manifestPath),
  results: path.resolve(resultsPath),
  scoring: {
    normalization: "NFKC + collapsed whitespace; numeric fields also ignore commas/currency markers/whitespace",
    alignment: "strict row order; no fuzzy row matching",
    extraRows: "counted separately; nonblank fields on extra rows are included in misreadErrors",
  },
  images,
  sets,
  formalOverall: aggregate(formalRows),
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ outPath, formalOverall: output.formalOverall, sets: output.sets }, null, 2));
