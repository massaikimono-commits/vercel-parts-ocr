import assert from "node:assert/strict";

const TYPE_ORDER = { customer_visit: 0, pickup: 1, onsite_repair: 2 };
const timeValue = (row) => new Date(row.starts_at).getTime();
const sortInbound = (rows) => [...rows].sort((a, b) => {
  const typeDiff = (TYPE_ORDER[a.entry_type] ?? 99) - (TYPE_ORDER[b.entry_type] ?? 99);
  return typeDiff || timeValue(a) - timeValue(b);
});
const sortDeliveries = (rows) => [...rows].sort((a, b) => timeValue(a) - timeValue(b));
const stack = (rows, period) => period === "morning" ? [...rows] : [...rows].reverse();
const prepare = (rows, period) => ({
  deliveries: stack(sortDeliveries(rows.filter((row) => row.entry_type === "delivery")), period),
  inbound: stack(sortInbound(rows.filter((row) => row.entry_type !== "delivery")), period),
});

const rows = [
  { id: "visit-1030", entry_type: "customer_visit", starts_at: "2026-08-29T01:30:00.000Z" },
  { id: "pickup-0900", entry_type: "pickup", starts_at: "2026-08-29T00:00:00.000Z" },
  { id: "visit-0930", entry_type: "customer_visit", starts_at: "2026-08-29T00:30:00.000Z" },
  { id: "onsite-0830", entry_type: "onsite_repair", starts_at: "2026-08-28T23:30:00.000Z" },
  { id: "delivery-1100", entry_type: "delivery", starts_at: "2026-08-29T02:00:00.000Z" },
  { id: "delivery-1000", entry_type: "delivery", starts_at: "2026-08-29T01:00:00.000Z" },
];

const morning = prepare(rows, "morning");
assert.deepEqual(morning.inbound.map((x) => x.id), ["visit-0930", "visit-1030", "pickup-0900", "onsite-0830"], "午前の引取系は来社→引取→出張、各種類内は時間順");
assert.deepEqual(morning.deliveries.map((x) => x.id), ["delivery-1000", "delivery-1100"], "午前の納車欄は上から時間順");

const afternoon = prepare(rows, "afternoon");
assert.deepEqual(afternoon.inbound.map((x) => x.id), ["onsite-0830", "pickup-0900", "visit-1030", "visit-0930"], "午後は下から時間順に見えるようDOM配置順を反転する");
assert.deepEqual(afternoon.deliveries.map((x) => x.id), ["delivery-1100", "delivery-1000"], "午後の納車欄も下から時間順に見えるよう反転する");

console.log("schedule print layout regression: ok");
