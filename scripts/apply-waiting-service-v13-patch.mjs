import fs from "node:fs";

function replaceExact(path, from, to) {
  const source = fs.readFileSync(path, "utf8");
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}`);
  fs.writeFileSync(path, source.replace(from, to));
}

function appendOnce(path, marker, body) {
  const source = fs.readFileSync(path, "utf8");
  if (source.includes(marker)) return;
  fs.writeFileSync(path, `${source.trimEnd()}\n\n${body.trim()}\n`);
}

// New schedule UI: waiting service is available for every customer visit.
replaceExact(
  "app/schedule/new/page.tsx",
  `  useEffect(() => {\n    const eligible = reason === "点検" && entryType === "customer_visit";\n    if (!eligible && isWaitingService) setIsWaitingService(false);\n    if (isWaitingService && addDelivery) setAddDelivery(false);\n  }, [reason, entryType, isWaitingService, addDelivery]);`,
  `  useEffect(() => {\n    const eligible = entryType === "customer_visit";\n    if (!eligible && isWaitingService) setIsWaitingService(false);\n    if (isWaitingService && addDelivery) setAddDelivery(false);\n  }, [entryType, isWaitingService, addDelivery]);`,
);
replaceExact(
  "app/schedule/new/page.tsx",
  `{reason === "点検" && entryType === "customer_visit" && (`,
  `{entryType === "customer_visit" && (`,
);
replaceExact(
  "app/schedule/new/page.tsx",
  `来社・作業待ちは、その場で点検完了まで待つ運用のため納車予定は登録しません。`,
  `来社・作業待ちは、その場で作業完了まで待つ運用のため納車予定は登録しません。`,
);

// Schedule edit: any work order with a customer_visit can toggle waiting service.
replaceExact(
  "app/schedule/edit/page.tsx",
  `{(reason==="点検" && (entry.entry_type==="customer_visit" || relatedInboundEntry?.entry_type==="customer_visit")) && (`,
  `{(entry.entry_type==="customer_visit" || relatedInboundEntry?.entry_type==="customer_visit") && (`,
);

// Business-state classification: waiting visits never enter staying/body-shop/planned-delivery buckets.
replaceExact(
  "app/schedule/business-vehicle-state.ts",
  `    const isWaitingVisit =\n      work.is_waiting_service === true &&\n      work.reason === "点検" &&\n      inboundEntry.entry_type === "customer_visit";`,
  `    const isWaitingVisit =\n      work.is_waiting_service === true &&\n      inboundEntry.entry_type === "customer_visit";`,
);

// Functional regression: expand waiting-service cases across all reasons.
replaceExact(
  "scripts/vehicle-state-business-regression.mjs",
  `// 点検・来社・作業待ちは納車予定なしでも滞留車両へ入れない。\n{\n  const works = [work("WAIT", "点検", "scheduled", true)];\n  const rows = [entry("WAIT-in", "WAIT", "customer_visit", "2026-08-31", "exact")];\n  const state = mod.classifyVehicleBusinessStates(works, rows, "2026-08-31");\n  assert.equal(state.stayingVehicles.length, 0);\n  assert.equal(state.plannedDeliveries.length, 0);\n}\n\n// 通常の点検・来社は、作業待ちでなければ従来どおり滞留対象。\n{\n  const works = [work("VISIT", "点検", "scheduled", false)];\n  const rows = [entry("VISIT-in", "VISIT", "customer_visit", "2026-08-31", "exact")];\n  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-08-31").stayingVehicles.length, 1);\n}`,
  `// 来社・作業待ちは入庫要因に関係なく、滞留・板金滞留・納車予定へ入れない。\nfor (const [id, reason] of [["WAIT-I", "点検"], ["WAIT-S", "車検"], ["WAIT-R", "一般整備"], ["WAIT-B", "板金塗装"]]) {\n  const works = [work(id, reason, "scheduled", true)];\n  const rows = [entry(id + "-in", id, "customer_visit", "2026-08-31", "exact")];\n  const state = mod.classifyVehicleBusinessStates(works, rows, "2026-08-31");\n  assert.equal(state.stayingVehicles.length, 0, reason + " waiting visit must not stay");\n  assert.equal(state.bodyShopVehicles.length, 0, reason + " waiting visit must not enter body shop staying");\n  assert.equal(state.plannedDeliveries.length, 0, reason + " waiting visit must not become planned delivery");\n}\n\n// 通常の来社・納車未定は、作業待ちでなければ従来どおり滞留対象。\n{\n  const works = [work("VISIT", "一般整備", "scheduled", false)];\n  const rows = [entry("VISIT-in", "VISIT", "customer_visit", "2026-08-31", "exact")];\n  assert.equal(mod.classifyVehicleBusinessStates(works, rows, "2026-08-31").stayingVehicles.length, 1);\n}`,
);

// Build a new migration source from the deployed v1.2 definition while preserving v1.2 history.
// The live DB received active-app-user hardening after v1.2, so reproduce that later hardening
// before changing the waiting-service business rules. Never reintroduce auth.uid-only guards.
const v12Path = "database/waiting-service-v12.sql";
const v13Path = "database/waiting-service-customer-visit-v13.sql";
let sql = fs.readFileSync(v12Path, "utf8");
const oldAuthBlock = `  if auth.uid() is null and not public.request_has_app_secret() then\n    raise exception 'not authorized';\n  end if;`;
const hardenedAuthBlock = `  if not public.request_has_app_secret() and not public.is_active_app_user() then\n    raise insufficient_privilege using message = 'not authorized';\n  end if;`;
const oldAuthCount = sql.split(oldAuthBlock).length - 1;
if (oldAuthCount !== 6) throw new Error(`migration source: expected 6 historical mutation auth guards, found ${oldAuthCount}`);
sql = sql.split(oldAuthBlock).join(hardenedAuthBlock);

const sqlReplacements = [
  [
    `if v_waiting_service\n     and not (p_reason = '点検' and p_entry_type = 'customer_visit') then`,
    `if v_waiting_service\n     and p_entry_type <> 'customer_visit' then`,
  ],
  [`作業待ちは「点検・来社」の予定だけで使用できます。`, `作業待ちは「来社」の予定だけで使用できます。`],
  [
    `if v_waiting_service\n       and not (v_reason='点検' and v_has_customer_visit) then`,
    `if v_waiting_service\n       and not v_has_customer_visit then`,
  ],
  [`and warning_text <> '点検の来社・作業待ちが同じ時刻に重複しています'`, `and warning_text <> '点検の来社・作業待ちが同じ時刻に重複しています'\n    and warning_text <> '来社・作業待ちが同じ時刻に重複しています'`],
  [`     and p_reason = '点検'\n     and coalesce(p_is_waiting_service,false) then`, `     and coalesce(p_is_waiting_service,false) then`],
  [`      and wo.reason = '点検'\n      and wo.is_waiting_service = true`, `      and wo.is_waiting_service = true`],
  [`'点検の来社・作業待ちが同じ時刻に重複しています'`, `'来社・作業待ちが同じ時刻に重複しています'`],
  [`True only when a customer_visit inspection customer waits on site until the inspection work is finished.`, `True only when a customer_visit customer waits on site until the scheduled work is finished.`],
];
for (const [from, to] of sqlReplacements) {
  const count = sql.split(from).length - 1;
  if (count < 1) throw new Error(`migration source: missing pattern ${from.slice(0, 80)}`);
  sql = sql.split(from).join(to);
}
// Neutralize the old top comment in the new migration copy; v1.2 historical source stays untouched.
sql = sql
  .replace("-- ICB-SPEC v1.2: inspection customer-visit waiting-service rules.", "-- ICB waiting-service v1.3 function baseline, superseding the v1.2 reason restriction.")
  .replace("-- Applied to shared Supabase as migration: add_waiting_service_visit_rules_v12", "-- Source derived from the deployed v1.2 functions plus the later active-app-user hardening.")
  .replace("-- Captured from the live database immediately after application.", "-- No column/backfill change is required by v1.3.")
  .replace("--   work_orders.is_waiting_service = true only when a customer arrives for an\n--   inspection and waits on site until the inspection work is completed.", "--   work_orders.is_waiting_service = true only for customer_visit entries where\n--   the customer waits on site until the scheduled work is completed.");
sql = `-- ICB waiting-service v1.3: all customer_visit reasons may use is_waiting_service.\n-- No new column and no backfill. This file supersedes the v1.2 function rules while preserving its schema.\n\n${sql}`;
fs.writeFileSync(v13Path, sql);

// Dedicated source/DB contract regression, kept permanently.
fs.writeFileSync("scripts/waiting-service-customer-visit-v13-regression.mjs", `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst registration = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");\nconst edit = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");\nconst state = fs.readFileSync(new URL("../app/schedule/business-vehicle-state.ts", import.meta.url), "utf8");\nconst sql = fs.readFileSync(new URL("../database/waiting-service-customer-visit-v13.sql", import.meta.url), "utf8");\n\nassert.match(registration, /const eligible = entryType === "customer_visit";/, "new registration waiting eligibility must be customer_visit only");\nassert.doesNotMatch(registration, /reason === "点検" && entryType === "customer_visit"/, "registration UI must not restrict waiting service by reason");\nassert.match(registration, /\\{entryType === "customer_visit" && \\(/, "waiting toggle must show for every customer visit");\nassert.match(registration, /if \\(!eligible && isWaitingService\\) setIsWaitingService\\(false\\)/, "leaving customer_visit must clear waiting service");\nassert.match(registration, /if \\(isWaitingService && addDelivery\\) setAddDelivery\\(false\\)/, "waiting service must disable delivery");\nassert.doesNotMatch(edit, /reason==="点検" && \\(entry\\.entry_type==="customer_visit"/, "edit UI must not restrict waiting service by reason");\nassert.match(edit, /entry\\.entry_type==="customer_visit" \\|\\| relatedInboundEntry\\?\\.entry_type==="customer_visit"/, "edit UI must allow any related customer visit");\nassert.doesNotMatch(state, /work\\.reason === "点検"[\\s\\S]{0,100}inboundEntry\\.entry_type === "customer_visit"/, "business state exclusion must be reason-independent");\nassert.match(state, /work\\.is_waiting_service === true &&\\s*inboundEntry\\.entry_type === "customer_visit"/, "waiting customer visits must be excluded before state buckets");\n\nassert.match(sql, /if v_waiting_service\\s+and p_entry_type <> 'customer_visit' then/, "registration RPC must allow waiting only for customer_visit");\nassert.match(sql, /作業待ちは「来社」の予定だけで使用できます。/, "waiting validation message must be reason-neutral");\nassert.doesNotMatch(sql, /not \\(p_reason = '点検' and p_entry_type = 'customer_visit'\\)/, "registration RPC must remove inspection reason restriction");\nassert.match(sql, /if v_waiting_service\\s+and not v_has_customer_visit then/, "reschedule RPC must require only a customer_visit");\nassert.doesNotMatch(sql, /not \\(v_reason='点検' and v_has_customer_visit\\)/, "reschedule RPC must remove inspection reason restriction");\nassert.match(sql, /来社・作業待ちには納車予定を登録しません。/, "waiting plus delivery must remain prohibited");\nassert.match(sql, /when v_waiting_service then null/, "reschedule waiting service must null planned delivery");\nassert.match(sql, /delete from public\\.schedule_entries[\\s\\S]*entry_type='delivery'/, "reschedule waiting service must delete delivery entries");\nassert.match(sql, /v_mode = 'exact'\\s+and p_entry_type = 'customer_visit'\\s+and coalesce\\(p_is_waiting_service,false\\)/, "special duplicate warning must use exact waiting customer visits");\nassert.doesNotMatch(sql, /and p_reason = '点検'\\s+and coalesce\\(p_is_waiting_service,false\\)/, "duplicate warning input must ignore reason");\nassert.doesNotMatch(sql, /and wo\\.reason = '点検'\\s+and wo\\.is_waiting_service = true/, "duplicate warning existing row must ignore reason");\nassert.match(sql, /'来社・作業待ちが同じ時刻に重複しています'/, "duplicate warning must use the new reason-neutral text");\nassert.equal((sql.match(/if not public\\.request_has_app_secret\\(\\) and not public\\.is_active_app_user\\(\\) then/g) || []).length, 6, "all six schedule mutation signatures must retain active-user hardening");\nassert.doesNotMatch(sql, /auth\\.uid\\(\\) is null and not public\\.request_has_app_secret\\(\\)/, "v1.3 migration must never restore auth.uid-only mutation authorization");\nconsole.log("waiting service customer-visit v1.3 regression: ok");\n`);

// Keep GitHub ledgers explicit about the formal v1.3 override. Older v1.2 sections remain historical.
const ledgerSection = `### 2026-09-08 — Waiting-service v1.3 formal override\n- This section supersedes the v1.2 reason-limited waiting-service rule.\n- \`is_waiting_service=true\` is valid for every \`customer_visit\` regardless of reason: 点検 / 車検 / 一般整備 / 板金塗装.\n- Pickup, onsite repair, and delivery cannot use waiting-service. Leaving customer_visit clears the UI flag.\n- Waiting-service has no delivery plan/entry, is excluded from staying vehicles, body-shop vehicles, and planned deliveries, and remains labeled \`来社待ち\` in the daily report.\n- Exact-time duplicate warning is reason-independent: both entries must be customer_visit + waiting-service + exact + identical start time. Warning text: \`来社・作業待ちが同じ時刻に重複しています\`.\n- No new column and no backfill. Migration source: \`database/waiting-service-customer-visit-v13.sql\`.\n`;
for (const path of ["docs/app-development-ledger.md", "docs/shared-project-state.md", "docs/pending-fix-ledger.md"]) {
  appendOnce(path, "Waiting-service v1.3 formal override", ledgerSection);
}

// Add permanent v1.3 regression to the normal build without hand-editing JSON formatting.
const packagePath = "package.json";
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.scripts["test:waiting-service-v13"] = "node scripts/waiting-service-customer-visit-v13-regression.mjs";
const buildNeedle = "npm run test:vehicle-business-state";
if (!pkg.scripts.build.includes(buildNeedle)) throw new Error("package build: vehicle-state step missing");
if (!pkg.scripts.build.includes("test:waiting-service-v13")) {
  pkg.scripts.build = pkg.scripts.build.replace(buildNeedle, `${buildNeedle} && npm run test:waiting-service-v13`);
}
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

console.log("waiting-service v1.3 patch applied");
