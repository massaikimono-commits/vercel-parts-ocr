import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCertificateQrDensityCenters } from "../app/lib/certificate-qr-density.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "../test/fixtures/vehicle-certificates");

function syntheticQrImage(width, height, centers) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(255);
  for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;

  // Non-QR text-like noise on the left should not become scan targets.
  for (let y = Math.floor(height * .84); y < Math.floor(height * .94); y += 18) {
    for (let x = 80; x < Math.floor(width * .34); x += 9) {
      const on = ((x + y) / 9) % 3 < 1;
      if (!on) continue;
      for (let yy = y; yy < Math.min(height, y + 3); yy += 1) {
        for (let xx = x; xx < Math.min(width, x + 5); xx += 1) {
          const p = (yy * width + xx) * 4;
          rgba[p] = rgba[p + 1] = rgba[p + 2] = 20;
        }
      }
    }
  }

  const size = Math.max(42, Math.round(width * .052));
  const cell = Math.max(3, Math.floor(size / 13));
  const cy = Math.floor(height * .90);
  for (const center of centers) {
    const cx = Math.round(width * center);
    const left = Math.max(0, cx - Math.floor(size / 2));
    const top = Math.max(0, cy - Math.floor(size / 2));
    for (let yy = 0; yy < size; yy += 1) {
      for (let xx = 0; xx < size; xx += 1) {
        const gx = Math.floor(xx / cell);
        const gy = Math.floor(yy / cell);
        const finder =
          (gx < 4 && gy < 4) ||
          (gx >= 9 && gy < 4) ||
          (gx < 4 && gy >= 9);
        const dark = finder
          ? (gx + gy) % 2 === 0 || gx % 3 === 0 || gy % 3 === 0
          : ((gx * 3 + gy * 5 + gx * gy) % 7) < 3;
        if (!dark) continue;
        const x = left + xx, y = top + yy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const p = (y * width + x) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = 10;
      }
    }
  }
  return rgba;
}

function runQrDensityRegression() {
  const cases = [
    { name: "kei-six", centers: [.485, .574, .658, .744, .829, .911] },
    { name: "registered-five-left", centers: [.511, .567, .617, .733, .789] },
    { name: "registered-five-right", centers: [.538, .598, .651, .789, .853] },
    { name: "legacy-two", centers: [.703, .928] },
  ];
  for (const test of cases) {
    const width = 1200, height = 1697;
    const rgba = syntheticQrImage(width, height, test.centers);
    const actual = detectCertificateQrDensityCenters(rgba, width, height).map((item) => item.x);
    if (actual.length < test.centers.length) {
      throw new Error(`QR density ${test.name}: expected at least ${test.centers.length} centers, got ${actual.length}: ${actual.join(",")}`);
    }
    for (const expected of test.centers) {
      if (!actual.some((x) => Math.abs(x - expected) <= .025)) {
        throw new Error(`QR density ${test.name}: missing center ${expected}; actual=${actual.join(",")}`);
      }
    }
  }
  console.log(`PASS QR density targeting: ${cases.length} layout(s)`);
}

runQrDensityRegression();

const MAKERS = ["トヨタ", "レクサス", "日産", "ニッサン", "ホンダ", "三菱", "マツダ", "スバル", "スズキ", "ダイハツ", "いすゞ", "日野", "UDトラックス", "メルセデス・ベンツ", "フォルクスワーゲン", "アウディ", "BMW", "ボルボ"];
const BODY_TYPES = ["キャブオーバ", "ステーションワゴン", "ボンネット", "ピックアップ", "トラック", "ダンプ", "セダン", "箱型", "バン", "バス", "幌型"];

function makerFromText(text) {
  const raw = norm(text);
  const dense = compact(raw);
  return MAKERS.find((value) => raw.includes(value) || dense.includes(compact(value))) || "";
}

function bodyTypeFromText(text) {
  const dense = compact(text);
  return BODY_TYPES.find((value) => dense.includes(compact(value))) || "";
}

function norm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
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
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      out[key] = String(value).trim();
    }
  };
  const joinedAfter = (index, count = 3) =>
    rows.slice(Math.max(0, index + 1), Math.min(rows.length, index + 1 + count)).join(" ");

  const created = rows.find((row) => compact(row).includes("作成日付"));
  if (created) {
    const m = created.match(
      /作成日付\s*[:：]?\s*((?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年?\s*\d{1,2}\s*月?\s*\d{1,2}\s*日?)/
    );
    if (m) put("recordDate", jpDate(m[1]));
  }

  const topHeader = findRow(
    rows,
    (t) =>
      (t.includes("自動車登録番号又は車両番号") || t.includes("車両番号")) &&
      (t.includes("初度登録年月") || t.includes("初度検査年月")) &&
      t.includes("車体の形状")
  );
  const topValue = nextRow(rows, topHeader.index, 3).row;
  if (topValue) {
    put("registrationNumber", registration(topValue));
    const dates = [
      ...topValue.matchAll(
        /(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?(?:\s*(\d{1,2})\s*日?)?/g
      ),
    ];
    if (dates[0]) put("registrationDate", jpDate(dates[0][0]));
    if (dates[1]) put("firstRegistration", jpMonth(dates[1][0]));
    put("vehicleClass", ["普通", "小型", "軽自動車", "大型特殊"].find((v) => topValue.includes(v)) || "");
    put("purpose", ["乗用", "貨物", "乗合", "特種"].find((v) => topValue.includes(v)) || "");
    put("privateBusiness", ["自家用", "事業用"].find((v) => topValue.includes(v)) || "");
    put("bodyShape", bodyTypeFromText(topValue));
  }

  const weightHeader = findRow(
    rows,
    (t) =>
      t.includes("車名") &&
      t.includes("乗車定員") &&
      t.includes("最大積載量") &&
      t.includes("車両重量") &&
      t.includes("車両総重量")
  );
  const weightValue = nextRow(rows, weightHeader.index, 3).row;
  if (weightValue) {
    put("vehicleName", makerFromText(weightValue));
    const seat = weightValue.match(/(?:\[[^\]]+\]\s*)?(\d{1,2})\s*人/);
    if (seat) put("seatingCapacity", String(Number(seat[1])));
    const kg = [...weightValue.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kg.length >= 3) {
      put("maxPayloadKg", kg[0] === "-" ? "-" : String(Number(kg[0])));
      put("vehicleWeightKg", kg[1] === "-" ? "-" : String(Number(kg[1])));
      put("grossVehicleWeightKg", kg[2] === "-" ? "-" : String(Number(kg[2])));
    }
  }

  const keiChassisHeader = findRow(
    rows,
    (t) =>
      t.includes("車台番号") &&
      t.includes("乗車定員") &&
      t.includes("最大積載量") &&
      t.includes("車両重量") &&
      t.includes("長さ") &&
      t.includes("幅") &&
      t.includes("高さ")
  );
  if (keiChassisHeader.index >= 0) {
    const text = joinedAfter(keiChassisHeader.index, 3).toUpperCase();
    const chassis = text.match(/\b([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\b/i);
    if (chassis) put("chassisNumber", chassis[1].replace(/O/g, "0"));

    const seat = text.match(/(\d{1,2})\s*人/);
    if (seat) put("seatingCapacity", String(Number(seat[1])));

    const kg = [...text.matchAll(/(-|\d{1,5})\s*kg/gi)].map((m) => m[1]);
    if (kg.length >= 3) {
      put("maxPayloadKg", kg[0] === "-" ? "-" : String(Number(kg[0])));
      put("vehicleWeightKg", kg[1] === "-" ? "-" : String(Number(kg[1])));
      put("grossVehicleWeightKg", kg[2] === "-" ? "-" : String(Number(kg[2])));
    }

    const cm = [...text.matchAll(/(\d{2,4})\s*cm/gi)].map((m) => m[1]);
    if (cm.length >= 3) {
      put("lengthCm", String(Number(cm[0])));
      put("widthCm", String(Number(cm[1])));
      put("heightCm", String(Number(cm[2])));
    }
  }

  const dimensionHeader = findRow(
    rows,
    (t) =>
      t.includes("車台番号") &&
      t.includes("長さ") &&
      t.includes("幅") &&
      t.includes("高さ") &&
      t.includes("前前軸重") &&
      t.includes("後後軸重")
  );
  const dimensionValue = nextRow(rows, dimensionHeader.index, 3).row.toUpperCase();
  if (dimensionValue) {
    const m = dimensionValue.match(
      /([A-Z]{1,6}[A-Z0-9]{0,8}-[A-Z0-9]{4,14})\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(\d{2,4})\s*cm\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg\s+(-|\d{1,5})\s*kg/i
    );
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

  const modelHeader = findRow(
    rows,
    (t) =>
      t.includes("型式") &&
      t.includes("原動機の型式") &&
      t.includes("総排気量又は定格出力") &&
      t.includes("燃料の種類") &&
      t.includes("型式指定番号") &&
      t.includes("類別区分番号")
  );
  if (modelHeader.index >= 0) {
    let next = nextRow(rows, modelHeader.index, 4);
    if (/^KW$/i.test(next.row)) next = nextRow(rows, next.index, 2);
    if (next.row) {
      const raw = norm(next.row);
      const text = raw.toUpperCase();

      put("vehicleName", makerFromText(raw) || out.vehicleName || "");

      const modelMatch = text.match(/\b((?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{2,14})\b/i);
      if (modelMatch) {
        put("model", modelMatch[1]);
        const rest = text.slice((modelMatch.index || 0) + modelMatch[0].length).trim();
        const engine = rest.match(/^([A-Z0-9]{2,10}(?:-[A-Z0-9]{2,10})?)(?:\s|$)/i);
        if (engine && !["L", "KW"].includes(engine[1].toUpperCase())) put("engineModel", engine[1]);
      }

      const fuel = ["軽油", "ガソリン", "揮発油", "電気", "LPG", "CNG", "水素"].find((v) =>
        raw.includes(v)
      );
      if (fuel) put("fuel", fuel);

      let displacement = null;
      if (fuel) {
        displacement =
          raw.match(new RegExp("(\\d+(?:\\.\\d+)?)\\s*(L|kW|KW)\\s+" + fuel, "i")) ||
          raw.match(new RegExp(fuel + "\\s+(\\d+(?:\\.\\d+)?)\\s*(L|kW|KW)", "i"));
      }
      if (!displacement) displacement = raw.match(/(\d+(?:\.\d+)?)\s*(L|kW|KW)\b/i);
      if (displacement) {
        put(
          "displacementOrRatedOutput",
          String(displacement[1]) + " " + String(displacement[2]).toUpperCase()
        );
      }

      const tail = text.match(/(?:^|\s)(\d{4,6})\s+(\d{4})\s*$/);
      if (tail) {
        put("modelDesignationNumber", tail[1]);
        put("classificationNumber", tail[2]);
      }

      const headerDense = compact(modelHeader.row);
      const axleKg = [...raw.matchAll(/(\d{1,5})\s*kg/gi)].map((m) => m[1]);
      if (headerDense.includes("前軸重") && headerDense.includes("後軸重") && axleKg.length >= 2) {
        put("frontFrontAxleWeightKg", String(Number(axleKg[0])));
        put("rearRearAxleWeightKg", String(Number(axleKg[1])));
      }
    }
  }

  const userNameRow = rows.find((row) => compact(row).includes("使用者の氏名又は名称"));
  if (userNameRow) {
    put(
      "userName",
      afterLabel(userNameRow, "使用者の氏名又は名称")
        .replace(/\s*\[[0-9\s]+\]\s*$/, "")
        .trim()
    );
  }

  const userAddressRow = rows.find(
    (row) => compact(row).includes("使用者の住所") && !compact(row).includes("所有者の住所")
  );
  if (userAddressRow) {
    put(
      "userAddress",
      afterLabel(userAddressRow, "使用者の住所")
        .replace(/\s*\[[0-9\s]+\]\s*$/, "")
        .trim()
    );
  }

  if (!out.userName) {
    const sectionStart = Math.max(0, modelHeader.index + 1);
    const baseIndex = rows.findIndex((row) => compact(row).includes("使用の本拠の位置"));
    const sectionEnd = Math.min(rows.length, baseIndex >= 0 ? baseIndex : sectionStart + 12);
    for (let i = sectionStart; i < sectionEnd; i += 1) {
      const text = rows[i];
      const dense = compact(text);
      if (!dense.includes("氏名又は名称")) continue;
      const value = text.replace(/^.*?氏名又は名称\s*/, "").trim();
      if (value && value !== "使用者に同じ" && !value.includes("所有者")) {
        put("userName", value.replace(/\s*\[[0-9\s]+\]\s*$/, "").trim());
        for (let j = i + 1; j < Math.min(sectionEnd, i + 5); j += 1) {
          const addressText = rows[j];
          if (!compact(addressText).includes("住所")) continue;
          const address = addressText
            .replace(/^.*?住\s*所\s*/, "")
            .replace(/\s*\[[0-9\s]+\]\s*$/, "")
            .trim();
          if (address && address !== "使用者に同じ") put("userAddress", address);
          break;
        }
        break;
      }
    }
  }

  const expiryHeader = rows.findIndex((row) => compact(row).includes("有効期間の満了する日"));
  if (expiryHeader >= 0) {
    for (let i = expiryHeader; i < Math.min(rows.length, expiryHeader + 7); i += 1) {
      const value = jpDate(rows[i]);
      if (value) {
        put("inspectionExpiry", value);
        break;
      }
    }
  }

  const allText = rows.join("\n");
  if (!out.registrationNumber) put("registrationNumber", registration(allText));
  if (!out.vehicleName) put("vehicleName", makerFromText(allText));

  return out;
}

function stressVariants(rows = []) {
  const source = rows.map((row) => String(row || ""));
  const variants = [];

  variants.push({
    name: "wide-spaces",
    rows: source.map((row) => row.replace(/ /g, "   ")),
  });

  variants.push({
    name: "dash-glyphs",
    rows: source.map((row) => row.replace(/-/g, "—")),
  });

  variants.push({
    name: "registration-digit-spacing",
    rows: source.map((row) => {
      if (!/(?:普通|小型|軽自動車|大型特殊)/.test(row)) return row;
      const eraAt = row.search(/令和|平成|昭和/);
      if (eraAt < 0) return row;
      const head = row.slice(0, eraAt)
        .replace(/(?<!\d)(\d{3})(?!\d)/g, (m) => m.split("").join(" "))
        .replace(/(?<!\d)(\d{4})(?!\d)/g, (m) => m.split("").join(" "));
      return head + row.slice(eraAt);
    }),
  });

  return variants;
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
let cases = 0;
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
  const runs = [
    { name: "base", rows: fixture.rows || [] },
    ...stressVariants(fixture.rows || []),
  ];

  for (const run of runs) {
    cases += 1;
    const { failures } = compareFixture({ ...fixture, rows: run.rows });
    const label = `${fixture.id || file}/${run.name}`;
    if (failures.length) {
      failed += 1;
      console.error(`FAIL ${label}: ${failures.length} mismatch(es)`);
      for (const item of failures) console.error(`  ${item.key}: expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(item.actual)}`);
    } else {
      console.log(`PASS ${label}: ${Object.keys(fixture.expected || {}).length} fields`);
    }
  }
}

if (failed) {
  console.error(`\n${failed}/${cases} vehicle-certificate case(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${cases} vehicle-certificate case(s) passed across ${files.length} fixture(s).`);
