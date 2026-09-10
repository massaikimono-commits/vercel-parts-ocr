export type FormalGtRow = { name: string; qty: string; retail: string; cost: string };
export type FormalGtMap = Record<string, FormalGtRow[]>;

const rows6: FormalGtRow[] = [
  { name: "F/ワイパーラバー", qty: "1", retail: "900", cost: "405" },
  { name: "F/ワイパーラバー", qty: "1", retail: "1000", cost: "450" },
  { name: "R/ワイパーラバー", qty: "1", retail: "900", cost: "405" },
  { name: "ファンベルト", qty: "1", retail: "5070", cost: "2410" },
  { name: "クリーンフィルター", qty: "1", retail: "2100", cost: "1260" },
  { name: "キーレスデンチ", qty: "1", retail: "460", cost: "270" },
];

const rows5: FormalGtRow[] = [
  { name: "バルブカバーG/K", qty: "1", retail: "1210", cost: "1029" },
  { name: "スパークプラグ", qty: "4", retail: "2700", cost: "1740" },
  { name: "キャンバーガスケット", qty: "1", retail: "410", cost: "246" },
  { name: "ショック", qty: "2", retail: "9630", cost: "6741" },
  { name: "ショックアブソーバーブッシュ", qty: "4", retail: "850", cost: "105" },
];

const rows2: FormalGtRow[] = [
  { name: "ウォーターポンプ", qty: "1", retail: "10300", cost: "6650" },
  { name: "ロワボールブーツ", qty: "2", retail: "1060", cost: "552" },
];

const rows8: FormalGtRow[] = [
  { name: "F/ワイパーラバー", qty: "1", retail: "420", cost: "338" },
  { name: "F/ワイパーラバー", qty: "1", retail: "640", cost: "360" },
  { name: "R/ワイパーラバー", qty: "1", retail: "420", cost: "293" },
  { name: "F/ブレーキホース:LH", qty: "1", retail: "2500", cost: "2125" },
  { name: "F/ブレーキホース", qty: "1", retail: "2500", cost: "2125" },
  { name: "R/ブレーキホース", qty: "2", retail: "1820", cost: "1547" },
  { name: "クリーンフィルター", qty: "1", retail: "2100", cost: "1260" },
  { name: "ブレーキホースP/K", qty: "2", retail: "310", cost: "196" },
];

const cloneRows = (rows: FormalGtRow[]) => rows.map((row) => ({ ...row }));

export const FORMAL_A19_GT: FormalGtMap = {
  "IMG_0675(1)": cloneRows(rows6),
  "IMG_0676(1)": cloneRows(rows6),
  "IMG_0677(1)": cloneRows(rows6),
  "IMG_0678(1)": cloneRows(rows5),
  "IMG_0679(1)": cloneRows(rows5),
  "IMG_0680(1)": cloneRows(rows2),
  "IMG_0681(1)": cloneRows(rows2),
  "IMG_0682(1)": cloneRows(rows2),
  "IMG_0683(1)": cloneRows(rows2),
  "IMG_0684(1)": cloneRows(rows8),
  "IMG_0685(1)": cloneRows(rows8),
  "IMG_0686(1)": cloneRows(rows8),
};

export const FORMAL_A19_GT_EXPECTED_ROW_COUNTS: Record<string, number> = {
  "IMG_0675(1)": 6,
  "IMG_0676(1)": 6,
  "IMG_0677(1)": 6,
  "IMG_0678(1)": 5,
  "IMG_0679(1)": 5,
  "IMG_0680(1)": 2,
  "IMG_0681(1)": 2,
  "IMG_0682(1)": 2,
  "IMG_0683(1)": 2,
  "IMG_0684(1)": 8,
  "IMG_0685(1)": 8,
  "IMG_0686(1)": 8,
};

export function assertFormalA19GtInvariant(gt: FormalGtMap = FORMAL_A19_GT) {
  const files = Object.keys(FORMAL_A19_GT_EXPECTED_ROW_COUNTS);
  if (files.length !== 12) throw new Error(`formal GT file invariant failed: ${files.length}/12`);

  let rows = 0;
  let fields = 0;
  for (const file of files) {
    const expectedRows = FORMAL_A19_GT_EXPECTED_ROW_COUNTS[file];
    const actualRows = gt[file];
    if (!Array.isArray(actualRows) || actualRows.length !== expectedRows) {
      throw new Error(`formal GT row invariant failed: ${file} ${actualRows?.length ?? 0}/${expectedRows}`);
    }
    rows += actualRows.length;
    for (const row of actualRows) {
      const values = [row.name, row.qty, row.retail, row.cost];
      if (values.some((value) => typeof value !== "string" || !value.trim())) {
        throw new Error(`formal GT field invariant failed: ${file}`);
      }
      fields += values.length;
    }
  }

  if (rows !== 60) throw new Error(`formal GT total row invariant failed: ${rows}/60`);
  if (fields !== 240) throw new Error(`formal GT field invariant failed: ${fields}/240`);
  return { files: 12, rows, fields, gtRuntimeUse: false, gtScoringOnly: true } as const;
}

export const FORMAL_A19_GT_INVARIANT = assertFormalA19GtInvariant();
