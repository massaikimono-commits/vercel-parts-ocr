import assert from "node:assert/strict";
import fs from "node:fs";

const registration = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");
const edit = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");
const state = fs.readFileSync(new URL("../app/schedule/business-vehicle-state.ts", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../database/waiting-service-customer-visit-v13.sql", import.meta.url), "utf8");

assert.match(registration, /const eligible = entryType === "customer_visit";/, "new registration waiting eligibility must be customer_visit only");
assert.doesNotMatch(registration, /reason === "点検" && entryType === "customer_visit"/, "registration UI must not restrict waiting service by reason");
assert.match(registration, /\{entryType === "customer_visit" && \(/, "waiting toggle must show for every customer visit");
assert.match(registration, /if \(!eligible && isWaitingService\) setIsWaitingService\(false\)/, "leaving customer_visit must clear waiting service");
assert.match(registration, /if \(isWaitingService && addDelivery\) setAddDelivery\(false\)/, "waiting service must disable delivery");
assert.doesNotMatch(edit, /reason==="点検" && \(entry\.entry_type==="customer_visit"/, "edit UI must not restrict waiting service by reason");
assert.match(edit, /entry\.entry_type==="customer_visit" \|\| relatedInboundEntry\?\.entry_type==="customer_visit"/, "edit UI must allow any related customer visit");
assert.doesNotMatch(state, /work\.reason === "点検"[\s\S]{0,100}inboundEntry\.entry_type === "customer_visit"/, "business state exclusion must be reason-independent");
assert.match(state, /work\.is_waiting_service === true &&\s*inboundEntry\.entry_type === "customer_visit"/, "waiting customer visits must be excluded before state buckets");

assert.match(sql, /if v_waiting_service\s+and p_entry_type <> 'customer_visit' then/, "registration RPC must allow waiting only for customer_visit");
assert.match(sql, /作業待ちは「来社」の予定だけで使用できます。/, "waiting validation message must be reason-neutral");
assert.doesNotMatch(sql, /not \(p_reason = '点検' and p_entry_type = 'customer_visit'\)/, "registration RPC must remove inspection reason restriction");
assert.match(sql, /if v_waiting_service\s+and not v_has_customer_visit then/, "reschedule RPC must require only a customer_visit");
assert.doesNotMatch(sql, /not \(v_reason='点検' and v_has_customer_visit\)/, "reschedule RPC must remove inspection reason restriction");
assert.match(sql, /来社・作業待ちには納車予定を登録しません。/, "waiting plus delivery must remain prohibited");
assert.match(sql, /when v_waiting_service then null/, "reschedule waiting service must null planned delivery");
assert.match(sql, /delete from public\.schedule_entries[\s\S]*entry_type='delivery'/, "reschedule waiting service must delete delivery entries");
assert.match(sql, /v_mode = 'exact'\s+and p_entry_type = 'customer_visit'\s+and coalesce\(p_is_waiting_service,false\)/, "special duplicate warning must use exact waiting customer visits");
assert.doesNotMatch(sql, /and p_reason = '点検'\s+and coalesce\(p_is_waiting_service,false\)/, "duplicate warning input must ignore reason");
assert.doesNotMatch(sql, /and wo\.reason = '点検'\s+and wo\.is_waiting_service = true/, "duplicate warning existing row must ignore reason");
assert.match(sql, /'来社・作業待ちが同じ時刻に重複しています'/, "duplicate warning must use the new reason-neutral text");
assert.equal((sql.match(/if not public\.request_has_app_secret\(\) and not public\.is_active_app_user\(\) then/g) || []).length, 4, "all four mutation signatures redefined by v1.3 must retain active-user hardening");
assert.doesNotMatch(sql, /auth\.uid\(\) is null and not public\.request_has_app_secret\(\)/, "v1.3 migration must never restore auth.uid-only mutation authorization");
console.log("waiting service customer-visit v1.3 regression: ok");
