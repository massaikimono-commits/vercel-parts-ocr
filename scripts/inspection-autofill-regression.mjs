const DEFAULT_ITEMS = [
  { id: "brake-pad", mark: "" },
  { id: "brake-drum", mark: "" },
  { id: "brake-fluid", mark: "" },
  { id: "engine-oil", mark: "" },
  { id: "belt", mark: "" },
  { id: "tire", mark: "" },
  { id: "lamp", mark: "" },
  { id: "battery", mark: "" },
];

const DYNAMIC_MARKS = new Set(["×", "L"]);

function normalizePowertrain(vehicle = {}) {
  return `${vehicle.fuel_type || ""} ${vehicle.vehicle_type || ""}`.toUpperCase();
}

function deriveInspectionItems({ vehicle = {}, previousPrinted = [], currentParts = [] }) {
  const items = DEFAULT_ITEMS.map((item) => ({ ...item, source: "blank" }));

  const set = (id, mark, source) => {
    const item = items.find((x) => x.id === id);
    if (!item || !mark) return;
    item.mark = mark;
    item.source = source;
  };

  // Previous printed results are the reusable baseline, but replacement/top-up are job-specific.
  for (const prev of previousPrinted || []) {
    if (!prev?.id || !prev?.mark || DYNAMIC_MARKS.has(prev.mark)) continue;
    set(prev.id, prev.mark, "previous");
  }

  // Vehicle/powertrain rules only fill still-empty fields. A previous printed correction wins.
  const powertrain = normalizePowertrain(vehicle);
  const isEv = /(^|\s)EV($|\s)|ELECTRIC|電気/.test(powertrain);
  const isHv = /HV|HYBRID|ハイブリッド/.test(powertrain);
  if (isEv) {
    if (!items.find((x) => x.id === "engine-oil")?.mark) set("engine-oil", "／", "vehicle-rule");
    if (!items.find((x) => x.id === "belt")?.mark) set("belt", "／", "vehicle-rule");
  } else if (isHv) {
    if (!items.find((x) => x.id === "belt")?.mark) set("belt", "／", "vehicle-rule");
  }

  // Current job parts always override reusable baseline. They are one-time and never become the next baseline.
  for (const part of currentParts || []) {
    const text = `${part.part_name || ""} ${part.source_text || ""}`.toLowerCase();
    const topup = /補給|つぎ足|継ぎ足|top\s*up/.test(text);
    const dynamicMark = topup ? "L" : "×";
    if (/ブレーキ.*(パッド|シュー)|パッド|ブレーキシュー/.test(text)) set("brake-pad", dynamicMark, "current-parts");
    if (/ブレーキ.*(液|フルード)|brake.*fluid/.test(text)) set("brake-fluid", dynamicMark, "current-parts");
    if (/エンジン.*オイル|オイルフィルタ|oil\s*filter|engine\s*oil/.test(text)) set("engine-oil", dynamicMark, "current-parts");
    if (/ベルト|belt/.test(text)) set("belt", dynamicMark, "current-parts");
    if (/タイヤ|tire/.test(text)) set("tire", dynamicMark, "current-parts");
    if (/バッテ|battery/.test(text)) set("battery", dynamicMark, "current-parts");
  }

  return items;
}

function get(items, id) {
  return items.find((x) => x.id === id);
}

const cases = [
  {
    name: "first EV print uses vehicle rules",
    input: { vehicle: { fuel_type: "EV" } },
    checks: [
      ["engine-oil", "／", "vehicle-rule"],
      ["belt", "／", "vehicle-rule"],
    ],
  },
  {
    name: "first HV print uses belt absent rule",
    input: { vehicle: { vehicle_type: "HYBRID" } },
    checks: [["belt", "／", "vehicle-rule"]],
  },
  {
    name: "printed exception wins over HV rule",
    input: {
      vehicle: { vehicle_type: "HYBRID" },
      previousPrinted: [{ id: "belt", mark: "✓" }],
    },
    checks: [["belt", "✓", "previous"]],
  },
  {
    name: "previous replacement and top-up are not reused",
    input: {
      previousPrinted: [
        { id: "brake-pad", mark: "×" },
        { id: "brake-fluid", mark: "L" },
        { id: "tire", mark: "✓" },
      ],
    },
    checks: [
      ["brake-pad", "", "blank"],
      ["brake-fluid", "", "blank"],
      ["tire", "✓", "previous"],
    ],
  },
  {
    name: "current parts override previous baseline",
    input: {
      previousPrinted: [{ id: "brake-pad", mark: "✓" }],
      currentParts: [{ part_name: "フロントブレーキパッド" }],
    },
    checks: [["brake-pad", "×", "current-parts"]],
  },
  {
    name: "handwritten top-up result is current job only",
    input: {
      previousPrinted: [{ id: "brake-fluid", mark: "✓" }],
      currentParts: [{ part_name: "ブレーキフルード", source_text: "手書き追加 補給" }],
    },
    checks: [["brake-fluid", "L", "current-parts"]],
  },
];

let failed = 0;
for (const test of cases) {
  const actual = deriveInspectionItems(test.input);
  const failures = [];
  for (const [id, mark, source] of test.checks) {
    const item = get(actual, id);
    if ((item?.mark || "") !== mark || (item?.source || "") !== source) {
      failures.push({ id, expected: { mark, source }, actual: item });
    }
  }
  if (failures.length) {
    failed += 1;
    console.error(`FAIL ${test.name}`);
    for (const x of failures) console.error(" ", x);
  } else {
    console.log(`PASS ${test.name}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${cases.length} inspection autofill case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} inspection autofill case(s) passed.`);
