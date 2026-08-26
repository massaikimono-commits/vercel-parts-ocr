import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "../test/fixtures/vehicle-certificates");

const MAKERS = ["トヨタ", "レクサス", "日産", "ホンダ", "三菱", "マツダ", "スバル", "スズキ", "ダイハツ", "いすゞ", "日野", "UDトラックス", "メルセデス・ベンツ", "フォルクスワーゲン", "アウディ", "BMW", "ボルボ"];
const BODY_TYPES = ["キャブオーバ", "ステーションワゴン", "ボンネット", "ピックアップ", "トラック", "ダンプ", "セダン", "箱型", "バン", "バス", "幌型"];

function norm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー]/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compact(value) {
  return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g, "");
}

function jpMonth(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if (!m) return "";
  const month = Number(m[3]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月`;
}

function jpDate(text) {
  const m = norm(text).match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/);
  if (!m) return "";
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m[1]}${m[2] === "元" ? "元" : Number(m[2])}年${month}月${day}日`;
}

function registration(text) {
  const m = norm(text).match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  return m ? `${m[1]} ${m[2].replace(/\D/g, "")} ${m[3]} ${m[4].replace(/\D/g, "")}` : "";
}

function findRow(rows, matcher) {
  const index = rows.findIndex((row) => matcher(compact(row)));
  return { index, row: index >= 0 ? rows[index] : "" };
}

function nextRow(rows, index, maxAhead = 4) {
  if (index < 0) return { index: -1, row: "" };
  for (let i = index + 1; i < Math.min(rows.length, index + 1 + maxAhead); i += 1) {
    if (norm(rows[i])) return { index: i, row: rows[i] };
  }
  return { index: -1, row: "" };
}

function afterLabel(row, label) {
  const normalized = norm(row);
  const labelDense = compact(label);
  const tokens = normalized.split(/\s+/);
  let joined = "";
  for (let i = 0; i < tokens.length; i += 1) {
    joined += compact(tokens[i]);
    if (joined.includes(labelDense)) return norm(tokens.slice(i + 1).join(" "));
    if (joined.length > labelDense.length + 40) break;
  }
  return "";
}

function parseRows(rawRows) {
  const rows = rawRows.map(norm).filter(Boolean);
  const out = {};
  const put = (key, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") out[key] = String(value).trim();
  };

  const created = rows.find((row) => compact(row).includes("作成日付"));
  if (created) {
    const m = created.match(/作成日付\s*[:：]?\s*((?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年?\s*\d{1,2}\s*月?\s*\d{1,2}\s*日?)/);
    if (m) put("recordDate", jpDate(m[1]));
  }

  const topHeader = findRow(rows, (t) => t.includes("自動車登録番号又は車両番号") && t.includes("初度登録年月") && t.includes("車体の形状"));
  const topValue = nextRow(rows, topHeader.index, 3).row;
  if (topValue) {
    put("registrationNumber", registration(topValue));
    const dates = [...topValue.matchAll(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?(?:\s*(\d{1,2})\s*日?)?/g)];
    if (dates[0]) put("registrationDate", jpDate(dates[0][0]));
    if (dates[1]) put("firstRegistration", jpMonth(dates[1][0]));
    put("vehicleClass", ["普通", "小型", "軽自動車", "大型特殊"].find((v) => topValue.includes(v)) || "");
    put("purpose", ["乗用", "貨物", "乗合", "特種"].find((v) => topValue.includes(v)) || "");
    put("privateBusiness", ["自家用", "事業用"].find((v) => topValue.includes(v)) || "");
    put("bodyShape", BODY_TYPES.find((v) => topValue.includes(v)) || "");
  }

  const weightHeader = findRow(rows, (t) => t.includes("車名") && t.includes("乗車定員") && t.includes("最大積載量") && t.includes("車両重量") && t.includes("車両総重量"));
  const weightValue = nextRow(rows, weightHeader.index, 3).row;
  if (weightValue) {
    put("vehicleName", MAKERS.find((v) => weightValue.includes(v)) || "");
    const seat = weightValue.match(/(?:\[[^\]]+\]\s*)?(\d{1,2})\s*人/);
    if (seat) put("seatingCapacity", String(Number(seat[1])));
    const kg = [...weightValue.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kg.length >= 3) {
      put("maxPayloadKg", kg[0] === "-" ? "-" : String(Number(kg[0])));
      put("vehicleWeightKg", kg[1] === "-" ? "-" : String(Number(kg[1])));
      put("grossVehicleWeightKg", kg[2] === "-" ? "-" : String(Number(kg[2])));
    }
  }

  const dimensionHeader = findRow(rows, (t) => t.includes("車台番号") && t.includes("長さ") && t.includes("幅") && t.includes("高さ") && t.includes("前前軸重") && t.includes("後後軸重"));
  const dimensionValue = nextRow(rows, dimensionHeader.index, 3).row.toUpperCase();
  if (dimensionValue) {
    const m = dimensionValue.match(/([A-Z]{1,5}[A-Z0-9]{2,8}-[0-9O]{4,12})\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg/i);
    if (m) {
      put("chassisNumber", m[1].replace(/O/g, "0"));
      put("lengthCm", String(Number(m[2])));
      put("widthCm", String(Number(m[3])));
      put("heightCm", String(Number(m[4])));
      put("frontFrontAxleWeightKg", m[5] === "-" ? "-" : String(Number(m[5])));
      put("frontRearAxleWeightKg", m[6] === "-" ? "-" : String(Number(m[6])));
      put("rearFrontAxleWeightKg", m[7] === "-" ? "-" : String(Number(m[7])));
      put("rearRearAxleWeightKg", m[8] === "-" ? "-" : String(Number(m[8])));
    }
  }

  const modelHeader = findRow(rows, (t) => t.includes("型式") && t.includes("原動機の型式") && t.includes("総排気量又は定格出力") && t.includes("燃料の種類") && t.includes("型式指定番号") && t.includes("類別区分番号"));
  if (modelHeader.index >= 0) {
    let next = nextRow(rows, modelHeader.index, 4);
    if (/^KW$/i.test(next.row)) next = nextRow(rows, next.index, 2);
    const text = next.row.toUpperCase();
    const m = text.match(/((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14})\s+([A-Z0-9]{2,8}-[A-Z0-9]{2,10})\s+(\d+(?:\.\d+)?)\s*(L|KW)?\s+(軽油|ガソリン|揮発油|電気|LPG|CNG|水素)\s+(\d{1,6})\s+(\d{4})/i);
    if (m) {
      put("model", m[1]);
      put("engineModel", m[2]);
      put("displacementOrRatedOutput", `${m[3]}${m[4] ? ` ${m[4]}` : ""}`);
      put("fuel", m[5]);
      put("modelDesignationNumber", m[6]);
      put("classificationNumber", m[7]);
    }
  }

  const userNameRow = rows.find((row) => compact(row).includes("使用者の氏名又は名称"));
  if (userNameRow) put("userName", afterLabel(userNameRow, "使用者の氏名又は名称").replace(/\s*\[[0-9\s]+\]\s*$/, "").trim());

  const userAddressRow = rows.find((row) => compact(row).includes("使用者の住所") && !compact(row).includes("所有者の住所"));
  if (userAddressRow) put("userAddress", afterLabel(userAddressRow, "使用者の住所").replace(/\s*\[[0-9\s]+\]\s*$/, "").trim());

  const expiryHeader = findRow(rows, (t) => t.includes("有効期間の満了する日") && t.includes("車検期間"));
  const expiryValue = nextRow(rows, expiryHeader.index, 3).row;
  if (expiryValue) put("inspectionExpiry", jpDate(expiryValue));

  return out;
}

function compareFixture(fixture) {
  const actual = parseRows(fixture.rows || []);
  const expected = fixture.expected || {};
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const failures = [];
  for (const key of [...keys].sort()) {
    const e = expected[key] ?? "";
    const a = actual[key] ?? "";
    if (String(e) !== String(a)) failures.push({ key, expected: e, actual: a });
  }
  return { actual, failures };
}

const files = fs.existsSync(FIXTURE_DIR)
  ? fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()
  : [];

if (!files.length) {
  console.error("No vehicle-certificate fixtures found.");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
  const { failures } = compareFixture(fixture);
  if (failures.length) {
    failed += 1;
    console.error(`FAIL ${fixture.id || file}: ${failures.length} mismatch(es)`);
    for (const item of failures) console.error(`  ${item.key}: expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}`);
  } else {
    console.log(`PASS ${fixture.id || file}: ${Object.keys(fixture.expected || {}).length} fields`);
  }
}

if (failed) {
  console.error(`\n${failed}/${files.length} fixture(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} vehicle-certificate fixture(s) passed.`);
