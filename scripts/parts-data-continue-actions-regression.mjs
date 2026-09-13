import fs from "node:fs";

const source = fs.readFileSync("app/parts-data/page.tsx", "utf8");

function expectMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function expectNoMatch(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

expectMatch(/function readActive\(\)[\s\S]*sessionStorage\.getItem\(ACTIVE_KEY\)[\s\S]*localStorage\.getItem\(ACTIVE_KEY\)/,
  "parts-data must restore the active vehicle from sessionStorage with localStorage fallback");

expectMatch(/function continueWithActive\(path: string\)[\s\S]*sessionStorage\.setItem\(ACTIVE_KEY, payload\)[\s\S]*localStorage\.setItem\(ACTIVE_KEY, payload\)[\s\S]*location\.assign\(path\)/,
  "continuation actions must persist active vehicle context in both session and local storage before navigation");

expectMatch(/この車両で続ける/, "parts-data must expose a clear continuation section");
expectMatch(/continueWithActive\("\/schedule\/active"\)/, "parts-data must offer next schedule registration");
expectMatch(/continueWithActive\("\/inspection"\)/, "parts-data must offer inspection record continuation");
expectMatch(/customer-vehicles\/history\?vehicle=/, "parts-data must offer integrated vehicle history continuation");

expectMatch(/\.from\("parts"\)[\s\S]*\.eq\("vehicle_id", vehicleId\)[\s\S]*\.range\(start, start \+ FORMAL_PAGE_SIZE - 1\)/,
  "formal parts history must remain vehicle-scoped and paginated");

expectNoMatch(/continueWithActive\("\/ocr\/auto"\)/,
  "parts-data continuation UX must not couple directly to OCR execution");

const continuationBody = source.match(/function continueWithActive\(path: string\) \{([\s\S]*?)\n  \}/)?.[1] || "";
if (!continuationBody) throw new Error("continueWithActive helper body not found");
if (/supabase|fetch\(|\.from\(/.test(continuationBody)) {
  throw new Error("continuation helper must not add DB/network work");
}

console.log("Parts data continue actions regression: PASS");
