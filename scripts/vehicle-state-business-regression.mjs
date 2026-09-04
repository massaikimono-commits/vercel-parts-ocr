import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/schedule/business-vehicle-state.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

const work = (id, reason = "一般整備", status = "scheduled") => ({
  id, vehicle_id: "v-" + id, reason, status,
});
const entry = (id, workId, type, day, mode = "unspecified") => ({
  id,
  work_order_id: workId,
  vehicle_id: "v-" + workId,
  entry_type: type,
  starts_at: day + (mode === "exact" ? "T06:00:00.000Z" : "T04:00:00.000Z"),
  print_time_mode: mode,
});

// Case A: 8/31一般整備・引取・納車未定 => 当日から滞留、翌日も継続。
{
  const works = [work("A")];
  const rows = [entry("A-in", "A", "pickup", "2026-08-31")];
  const d1 = mod.classifyVehicleBusinessStates(works, rows, "2026-08-31");
  const d2 = mod.classifyVehicleBusinessStates(works, rows, "2026-09-01");
  assert.equal(d1.stayingVehicles.length, 1);
  assert.equal(d1.stayingVehicles[0].inboundDay, "2026-08-31");
  assert.equal(d2.stayingVehicles.length, 1);
}

// Case B: 後から9/3「中」のdeliveryを登録 => 滞留から外れ、9/1・9/2は納車予定、9/3は下部には出ない。
{
  const works = [work("B")];
  const rows = [
    entry("B-in", "B", "pickup", "2026-08-31"),
    entry("B-out", "B", "delivery", "2026-09-03", "unspecified"),
  ];
  const d1 = mod.classifyVehicleBusinessStates(works, rows, "2026-09-01");
  const d2 = mod.classifyVehicleBusinessStates(works, rows, "2026-09-02");
  const d3 = mod.classifyVehicleBusinessStates(works, rows, "2026-09-03");
  assert.equal(d1.stayingVehicles.length, 0);
  assert.equal(d1.plannedDeliveries.length, 1);
  assert.equal(d2.plannedDeliveries.length, 1);
  assert.equal(d3.plannedDeliveries.length, 0);
  assert.equal(mod.deliveryTimeLabel(d1.plannedDeliveries[0].deliveryEntry), "中");
}

// Case C: 板金塗装は引取日から板金欄、納車日まで継続。納車日は板金欄から除外。
{
  const works = [work("C", "板金塗装")];
  const rows = [
    entry("C-in", "C", "pickup", "2026-08-31"),
    entry("C-out", "C", "delivery", "2026-09-03", "exact"),
  ];
  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-08-31").bodyShopVehicles.length, 1);
  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-09-02").bodyShopVehicles.length, 1);
  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-09-03").bodyShopVehicles.length, 0);
}

// Case D: 予約取消は滞留対象外。
{
  const works = [work("D", "一般整備", "cancelled")];
  const rows = [entry("D-in", "D", "customer_visit", "2026-08-31")];
  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-08-31").stayingVehicles.length, 0);
}

// 出張整備は入庫開始にしない。
{
  const works = [work("E")];
  const rows = [entry("E-in", "E", "onsite_repair", "2026-08-31")];
  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-08-31").stayingVehicles.length, 0);
}

// 来社は引取と同じく予定入庫日から滞留開始。
{
  const works = [work("F")];
  const rows = [entry("F-in", "F", "customer_visit", "2026-08-31")];
  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-08-31").stayingVehicles.length, 1);
}

// checked_in/out・作業完了はトップ/日別/日報の滞留判定へ混ぜない。
{
  const works = [{
    ...work("G"),
    checked_in_at: null,
    checked_out_at: "2026-08-31T08:00:00.000Z",
    work_completed: true,
    work_completed_at: "2026-08-31T08:00:00.000Z",
    delivery_completed: true,
  }];
  const rows = [entry("G-in", "G", "pickup", "2026-08-31")];
  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-09-01").stayingVehicles.length, 1);
}

console.log("vehicle state business regression: ok");
