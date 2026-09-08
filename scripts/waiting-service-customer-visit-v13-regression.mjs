import assert from "node:assert/strict";
import fs from "node:fs";

const registration = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");
const edit = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");
const state = fs.readFileSync(new URL("../app/schedule/business-vehicle-state.ts", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../database/waiting-service-customer-visit-v13.sql", import.meta.url), "utf8");
const v12 = fs.readFileSync(new URL("../database/waiting-service-v12.sql", import.meta.url), "utf8");

assert.match(registration, /const eligible = entryType === "customer_visit";/, "new registration waiting eligibility must be customer_visit only");
assert.doesNotMatch(registration, /reason === "点検" && entryType === "customer_visit"/, "registration UI must not restrict waiting service by reason");
assert.match(registration, /\{entryType === "customer_visit" && \(/, "waiting toggle must show for every customer visit");
assert.match(registration, /if \(!eligible && isWaitingService\) setIsWaitingService\(false\)/, "leaving customer_visit must clear waiting service");
assert.match(registration, /if \(isWaitingService && addDelivery\) setAddDelivery\(false\)/, "waiting service must disable delivery");
assert.doesNotMatch(edit, /reason==="点検" && \(entry\.entry_type==="customer_visit"/, "edit UI must not restrict waiting service by reason");
assert.match(edit, /entry\.entry_type==="customer_visit" \|\| relatedInboundEntry\?\.entry_type==="customer_visit"/, "edit UI must allow any related customer visit");
assert.doesNotMatch(state, /work\.reason === "点検"[\s\S]{0,100}inboundEntry\.entry_type === "customer_visit"/, "business state exclusion must be reason-independent");
assert.match(state, /work\.is_waiting_service === true &&\s*inboundEntry\.entry_type === "customer_visit"/, "waiting customer visits must be excluded before state buckets");

assert.match(sql, /pg_get_functiondef/, "v1.3 must patch current live function definitions instead of replaying stale v1.2 bodies");
assert.match(sql, /create_schedule_registration_v2\(text,text,text,timestamp with time zone/, "waiting-aware registration overload must be patched");
assert.match(sql, /reschedule_schedule_entry_v2\(uuid,timestamp with time zone/, "waiting-aware reschedule overload must be patched");
assert.match(sql, /schedule_slot_check_v2\(text,timestamp with time zone/, "waiting-aware slot-check overload must be patched");
assert.match(sql, /not public\.request_has_app_secret\(\) and not public\.is_active_app_user\(\)/, "mutation patches must fail closed if live active-user hardening is missing");
assert.doesNotMatch(sql, /auth\.uid\(\) is null and not public\.request_has_app_secret\(\)/, "v1.3 migration must never restore auth.uid-only mutation authorization");
assert.match(sql, /p_entry_type <> ''customer_visit''/, "registration RPC patch must allow waiting only for customer_visit");
assert.match(sql, /not v_has_customer_visit/, "reschedule RPC patch must require only a customer_visit");
assert.match(sql, /作業待ちは「来社」の予定だけで使用できます。/, "waiting validation message must be reason-neutral");
assert.match(sql, /E'     and p_reason = ''点検''\\n'/, "slot-check patch must remove candidate reason restriction with newline-safe matching");
assert.match(sql, /E'      and wo.reason = ''点検''\\n'/, "slot-check patch must remove existing-row reason restriction with newline-safe matching");
assert.match(sql, /来社・作業待ちが同じ時刻に重複しています/, "duplicate warning must use the new reason-neutral text");

// Existing delivery cleanup/nulling behavior is deliberately preserved by patching the live body in place.
assert.match(v12, /来社・作業待ちには納車予定を登録しません。/, "waiting plus delivery prohibition must remain part of the baseline function contract");
assert.match(v12, /when v_waiting_service then null/, "waiting reschedule must keep planned delivery nulling");
assert.match(v12, /delete from public\.schedule_entries[\s\S]*entry_type='delivery'/, "waiting reschedule must keep delivery entry deletion");

console.log("waiting service customer-visit v1.3 regression: ok");
