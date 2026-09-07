export type ColumnKey = "name" | "qty" | "retail" | "cost" | "amount";

export type SlipColumnProfile = {
  id: string;
  label: string;
  headers: Partial<Record<ColumnKey, string[]>>;
  unitPriceTarget: "retail" | "cost" | "unknown";
  missingCost: "blank" | "unknown";
};

const WHITE_UNIT_PRICE_PROFILE: SlipColumnProfile = {
  id: "white-unit-price-no-cost",
  label: "白伝票（部品名称・数量・単価・計）",
  headers: {
    name: ["部品名称", "部品名", "品名"],
    qty: ["数量", "個数"],
    retail: ["単価"],
    amount: ["計", "金額"],
  },
  unitPriceTarget: "retail",
  missingCost: "blank",
};

function normalizedHeader(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s:：・|｜/／.()（）\[\]［］_-]/g, "")
    .toUpperCase();
}

function hasAny(text: string, labels: string[]) {
  const t = normalizedHeader(text);
  return labels.some((label) => t.includes(normalizedHeader(label)));
}

/**
 * Detect only the known white slip family where the visible table semantics are
 * 部品名称 / 数量 / 単価 / 計 and there is no purchase-price/cost column.
 *
 * Important: this does NOT globally reinterpret 単価. If a cost-like header exists,
 * or the white profile evidence is incomplete, the caller receives null and the
 * normal/general parser keeps its existing behavior.
 */
export function detectSlipColumnProfile(rawText: string): SlipColumnProfile | null {
  const text = String(rawText || "");
  const hasName = hasAny(text, ["部品名称", "部品名", "品名"]);
  const hasQty = hasAny(text, ["数量", "個数"]);
  const hasUnit = hasAny(text, ["単価"]);
  const hasAmount = hasAny(text, ["計", "金額"]);
  const hasExplicitRetail = hasAny(text, ["定価", "標準価格", "希望小売価格", "売価", "販売価格"]);
  const hasCost = hasAny(text, ["仕入れ", "仕入", "原価", "仕切", "仕切価格"]);

  if (hasName && hasQty && hasUnit && hasAmount && !hasCost && !hasExplicitRetail) {
    return WHITE_UNIT_PRICE_PROFILE;
  }
  return null;
}

export function profileHeaderTarget(profile: SlipColumnProfile | null, header: string): ColumnKey | null {
  if (!profile) return null;
  const normalized = normalizedHeader(header);
  for (const [key, labels] of Object.entries(profile.headers) as Array<[ColumnKey, string[] | undefined]>) {
    if (labels?.some((label) => normalized.includes(normalizedHeader(label)))) return key;
  }
  return null;
}

export function applyProfileCostRule(profile: SlipColumnProfile | null, value: string) {
  if (profile?.missingCost === "blank") return "";
  return value;
}
