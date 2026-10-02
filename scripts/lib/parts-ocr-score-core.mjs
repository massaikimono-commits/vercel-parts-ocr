/** Scoring-only: never imported by runtime candidates. */
const fields = ["name", "qty", "retail", "cost"];
const gtField = { name: "partName", qty: "qty", retail: "retail", cost: "cost" };
export const ALIGNMENT_VERSION = "order-preserving-weighted-v1";

const normName = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const normNumber = (value) => String(value ?? "").normalize("NFKC").replace(/[￥¥,\s]/g, "").trim();
export const normalizeField = (field, value) => field === "name" ? normName(value) : normNumber(value);
function rowMatchWeight(gt, row) {
  if (!row) return 0;
  // Generic, predeclared identity evidence. qty alone can never align a row.
  // This is scoring-only and is not available to any runtime candidate.
  const weights = { name: 4, qty: 1, retail: 3, cost: 3 };
  let score = 0;
  for (const field of fields) {
    const predicted = normalizeField(field, row?.fields?.[field]?.normalized ?? "");
    const wanted = normalizeField(field, gt?.[gtField[field]] ?? "");
    if (predicted && wanted && predicted === wanted) score += weights[field];
  }
  return score;
}

function betterAlignment(a, b) {
  if (a.score !== b.score) return a.score > b.score ? a : b;
  if (a.pairs.length !== b.pairs.length) return a.pairs.length > b.pairs.length ? a : b;
  const aKey = a.pairs.map(([i, j]) => `${String(i).padStart(3, "0")}:${String(j).padStart(3, "0")}`).join("|");
  const bKey = b.pairs.map(([i, j]) => `${String(i).padStart(3, "0")}:${String(j).padStart(3, "0")}`).join("|");
  return aKey <= bKey ? a : b;
}

export function alignRows(expected, actual) {
  const minWeight = 4; // name exact OR equivalent multi-field numeric evidence; never qty-only.
  const dp = Array.from({ length: expected.length + 1 }, () => Array(actual.length + 1));
  dp[0][0] = { score: 0, pairs: [] };
  for (let i = 0; i <= expected.length; i += 1) {
    for (let j = 0; j <= actual.length; j += 1) {
      if (i === 0 && j === 0) continue;
      let best = null;
      if (i > 0 && dp[i - 1][j]) best = dp[i - 1][j];
      if (j > 0 && dp[i][j - 1]) best = best ? betterAlignment(best, dp[i][j - 1]) : dp[i][j - 1];
      if (i > 0 && j > 0 && dp[i - 1][j - 1]) {
        const weight = rowMatchWeight(expected[i - 1], actual[j - 1]);
        if (weight >= minWeight) {
          const candidate = {
            score: dp[i - 1][j - 1].score + weight,
            pairs: [...dp[i - 1][j - 1].pairs, [i - 1, j - 1]],
          };
          best = best ? betterAlignment(best, candidate) : candidate;
        }
      }
      dp[i][j] = best ?? { score: 0, pairs: [] };
    }
  }
  return dp[expected.length][actual.length].pairs;
}


export function scoreRows(expected,actual){
 const pairs=alignRows(expected,actual),matched=new Map(pairs.map(([i,j])=>[i,j]));
 const summary={expectedRows:expected.length,detectedRows:actual.length,matchedRows:pairs.length,missingRows:expected.length-pairs.length,falseRows:actual.length-pairs.length,completeRows:0,fields:Object.fromEntries(fields.map(f=>[f,{correct:0,total:expected.length}])),blank:{correct:0,total:0,falseNonBlank:0},rows:[]};
 for(let i=0;i<expected.length;i++){const j=matched.get(i),row=j===undefined?null:actual[j],wanted=expected[i],exact={};
 for(const field of fields){const a=normalizeField(field,row?.fields?.[field]?.normalized??''),b=normalizeField(field,wanted[gtField[field]]??'');exact[field]=Boolean(row)&&a===b;if(exact[field])summary.fields[field].correct++;if(!b){summary.blank.total++;if(row&&!a)summary.blank.correct++;if(row&&a)summary.blank.falseNonBlank++;}}
 const complete=Boolean(row)&&Object.values(exact).every(Boolean);if(complete)summary.completeRows++;summary.rows.push({expectedIndex:i,predictionIndex:j??null,exact,complete});}
 return summary;
}
