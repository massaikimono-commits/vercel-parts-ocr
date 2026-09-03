import assert from "node:assert/strict";

const TYPE_ORDER = {
  customer_visit: 0,
  pickup: 1,
  onsite_repair: 2,
};

function timeValue(row) {
  return new Date(row.starts_at).getTime();
}

function inboundModeOrder(row) {
  if (row.entry_type !== "pickup") return 0;
  return row.print_time_mode === "exact" ? 0 : 1;
}

function isMorningJst(value) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(value)));
  return Number.isFinite(hour) && hour < 12;
}

function printTimeLabel(row) {
  if (row.print_time_label_override) return row.print_time_label_override;
  if (row.print_time_mode === "exact") {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(row.starts_at));
  }
  if (
    row.entry_type === "pickup"
    && (row.print_time_mode === "morning" || (row.print_time_mode === "unspecified" && isMorningJst(row.starts_at)))
  ) return "A中";
  if (row.entry_type === "pickup" && row.print_time_mode === "unspecified") return "午後";
  if (row.entry_type === "customer_visit" && row.print_time_mode === "morning") return "A中";
  if (row.entry_type === "customer_visit" && row.print_time_mode === "unspecified") return "午後";
  if (row.entry_type === "onsite_repair" && row.print_time_mode === "morning") return "A中";
  if (row.entry_type === "onsite_repair" && row.print_time_mode === "unspecified") return "中";
  if (row.entry_type === "delivery" && row.print_time_mode === "unspecified") return "中";
  return row.print_time_mode === "morning" ? "午前" : "時間未定";
}

function sortInbound(rows) {
  return [...rows].sort((a, b) => {
    const typeDiff = (TYPE_ORDER[a.entry_type] ?? 99) - (TYPE_ORDER[b.entry_type] ?? 99);
    if (typeDiff) return typeDiff;
    const modeDiff = inboundModeOrder(a) - inboundModeOrder(b);
    if (modeDiff) return modeDiff;
    return timeValue(a) - timeValue(b);
  });
}

function sortDelivery(rows) {
  return [...rows].sort((a, b) => timeValue(a) - timeValue(b));
}

function stackForPrint(rows, period) {
  const sorted = [...rows];
  if (period === "morning") return sorted;
  return sorted.reverse();
}

const rows = [
  { id: "v2", entry_type: "customer_visit", starts_at: "2026-08-29T01:30:00.000Z", print_time_mode: "exact", print_time_label_override: null },
  { id: "p2", entry_type: "pickup", starts_at: "2026-08-29T02:00:00.000Z", print_time_mode: "exact", print_time_label_override: null },
  { id: "v1", entry_type: "customer_visit", starts_at: "2026-08-29T00:30:00.000Z", print_time_mode: "exact", print_time_label_override: null },
  { id: "o1", entry_type: "onsite_repair", starts_at: "2026-08-29T00:00:00.000Z", print_time_mode: "exact", print_time_label_override: null },
  { id: "p1", entry_type: "pickup", starts_at: "2026-08-28T23:30:00.000Z", print_time_mode: "exact", print_time_label_override: null },
];

assert.deepEqual(sortInbound(rows).map((x) => x.id), ["v1", "v2", "p1", "p2", "o1"], "引取系は来社→引取→出張、各種類内は時間順");
assert.deepEqual(
  stackForPrint(sortInbound(rows), "afternoon").map((x) => x.id),
  ["o1", "p2", "p1", "v2", "v1"],
  "午後はDOM順を反転し、用紙を下から読むと来社→引取→出張・各種類内時間順を維持",
);

const deliveries = [
  { id: "d2", entry_type: "delivery", starts_at: "2026-08-29T05:00:00.000Z", print_time_mode: "exact", print_time_label_override: null },
  { id: "d1", entry_type: "delivery", starts_at: "2026-08-29T04:00:00.000Z", print_time_mode: "exact", print_time_label_override: null },
];
assert.deepEqual(sortDelivery(deliveries).map((x) => x.id), ["d1", "d2"], "納車は時間順");
assert.deepEqual(stackForPrint(["09:00", "10:00", "11:00"], "morning"), ["09:00", "10:00", "11:00"], "午前は上から時間順");
assert.deepEqual(stackForPrint(["13:00", "14:00", "15:00"], "afternoon"), ["15:00", "14:00", "13:00"], "午後は下から時間順になるようDOM順を反転");

assert.equal(printTimeLabel({ entry_type: "pickup", starts_at: "2026-08-29T00:00:00.000Z", print_time_mode: "morning", print_time_label_override: null }), "A中", "午前中の引取・時間指定なしはA中");
assert.equal(printTimeLabel({ entry_type: "pickup", starts_at: "2026-08-29T01:00:00.000Z", print_time_mode: "unspecified", print_time_label_override: null }), "A中", "午前帯に置かれた引取・時間未定もA中");
assert.equal(printTimeLabel({ entry_type: "pickup", starts_at: "2026-08-29T05:00:00.000Z", print_time_mode: "unspecified", print_time_label_override: null }), "午後", "午後の引取・時間指定なしは午後表示");
assert.equal(printTimeLabel({ entry_type: "delivery", starts_at: "2026-08-29T00:00:00.000Z", print_time_mode: "unspecified", print_time_label_override: null }), "中", "納車・時間指定なしは中");
assert.equal(printTimeLabel({ entry_type: "onsite_repair", starts_at: "2026-08-29T00:00:00.000Z", print_time_mode: "morning", print_time_label_override: null }), "A中", "出張の午前帯指定はA中");
assert.equal(printTimeLabel({ entry_type: "onsite_repair", starts_at: "2026-08-29T04:00:00.000Z", print_time_mode: "unspecified", print_time_label_override: null }), "中", "出張の午後帯指定は中");
assert.equal(printTimeLabel({ entry_type: "pickup", starts_at: "2026-08-29T00:00:00.000Z", print_time_mode: "morning", print_time_label_override: "AM" }), "AM", "明示上書きが最優先");
assert.equal(printTimeLabel({ entry_type: "customer_visit", starts_at: "2026-08-29T00:30:00.000Z", print_time_mode: "exact", print_time_label_override: null }), "09:30", "時刻指定はJST HH:mm");
assert.equal(printTimeLabel({ entry_type: "customer_visit", starts_at: "2026-08-29T00:00:00.000Z", print_time_mode: "morning", print_time_label_override: null }), "A中", "来社の午前帯指定はA中");
assert.equal(printTimeLabel({ entry_type: "customer_visit", starts_at: "2026-08-29T04:00:00.000Z", print_time_mode: "unspecified", print_time_label_override: null }), "午後", "来社の午後帯指定は午後");

const pickupMixed = [
  { id: "p-a", entry_type: "pickup", starts_at: "2026-08-29T00:00:00.000Z", print_time_mode: "morning", print_time_label_override: null },
  { id: "p-11", entry_type: "pickup", starts_at: "2026-08-29T02:00:00.000Z", print_time_mode: "exact", print_time_label_override: null },
  { id: "p-10", entry_type: "pickup", starts_at: "2026-08-29T01:00:00.000Z", print_time_mode: "exact", print_time_label_override: null },
];
assert.deepEqual(sortInbound(pickupMixed).map((x) => x.id), ["p-10", "p-11", "p-a"], "引取は時間指定を先に時間順、その後A中/午後");

console.log("schedule print rule regression: ok");
