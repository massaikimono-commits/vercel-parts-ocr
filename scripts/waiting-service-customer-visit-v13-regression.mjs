import assert from "node:assert/strict";
import fs from "node:fs";

const registration = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");
const edit = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");
const state = fs.readFileSync(new URL("../app/schedule/business-vehicle-state.ts", import.meta.url), "utf8");
const v13 = fs.readFileSync(new URL("../database/waiting-service-customer-visit-v13.sql", import.meta.url), "utf8");
const correction = fs.readFileSync(new URL("../database/waiting-service-duplicate-warning-v13-correction.sql", import.meta.url), "utf8");
const v12 = fs.readFileSync(new URL("../database/waiting-service-v12.sql", import.meta.url), "utf8");

assert.match(registration, /const eligible = entryType === "customer_visit";/, "new registration waiting eligibility must remain customer_visit only");
assert.doesNotMatch(registration, /reason === "点検" && entryType === "customer_visit"/, "registration UI must not restore inspection-only waiting eligibility");
assert.match(registration, /\{entryType === "customer_visit" && \(/, "waiting toggle must show for every customer visit");
assert.match(registration, /if \(!eligible && isWaitingService\) setIsWaitingService\(false\)/, "leaving customer_visit must clear waiting service");
assert.match(registration, /if \(isWaitingService && addDelivery\) setAddDelivery\(false\)/, "waiting service must disable delivery");
assert.doesNotMatch(edit, /reason==="点検" && \(entry\.entry_type==="customer_visit"/, "edit UI must not restore inspection-only waiting eligibility");
assert.match(edit, /entry\.entry_type==="customer_visit" \|\| relatedInboundEntry\?\.entry_type==="customer_visit"/, "edit UI must allow any related customer visit");
assert.match(edit, /作業待ち（来社したお客様が作業完了まで待つ）/, "edit UI must use reason-neutral waiting-service wording");
assert.doesNotMatch(edit, /作業待ち（来社したお客様が点検完了まで待つ）/, "obsolete inspection-only waiting-service wording must be removed");
assert.doesNotMatch(state, /work\.reason === "点検"[\s\S]{0,100}inboundEntry\.entry_type === "customer_visit"/, "business state exclusion must remain reason-independent");
assert.match(state, /work\.is_waiting_service === true &&\s*inboundEntry\.entry_type === "customer_visit"/, "waiting customer visits must remain excluded before state buckets");

assert.match(v13, /p_entry_type <> ''customer_visit''/, "registration RPC patch must keep waiting eligibility reason-neutral");
assert.match(v13, /not v_has_customer_visit/, "reschedule RPC patch must keep waiting eligibility reason-neutral");
assert.match(v13, /作業待ちは「来社」の予定だけで使用できます。/, "waiting validation message must remain reason-neutral");

assert.match(correction, /pg_get_functiondef/, "correction must patch the current live slot-check definition instead of rolling back migrations");
assert.match(correction, /p_reason = ''点検''/, "candidate inspection reason filter must be restored");
assert.match(correction, /wo\.reason = ''点検''/, "existing-row inspection reason filter must be restored");
assert.match(correction, /点検の来社・作業待ちが同じ時刻に重複しています/, "inspection-only duplicate warning text must be restored");
assert.doesNotMatch(correction, /create_schedule_registration_v2/, "correction migration must not modify registration eligibility RPC");
assert.doesNotMatch(correction, /reschedule_schedule_entry_v2/, "correction migration must not modify reschedule eligibility RPC");

function shouldSpecialWarn(candidate, existing){
  return candidate.reason === "点検"
    && candidate.entryType === "customer_visit"
    && candidate.waiting === true
    && candidate.mode === "exact"
    && existing.reason === "点検"
    && existing.entryType === "customer_visit"
    && existing.waiting === true
    && existing.mode === "exact"
    && existing.startsAt === candidate.startsAt;
}

const exactInspection = {reason:"点検",entryType:"customer_visit",waiting:true,mode:"exact",startsAt:"2026-09-09T10:00:00+09:00"};
assert.equal(shouldSpecialWarn(exactInspection,{...exactInspection}), true, "1 inspection waiting exact + inspection waiting exact at same starts_at must warn");
assert.equal(shouldSpecialWarn(exactInspection,{...exactInspection,reason:"車検"}), false, "2 inspection waiting + vehicle-inspection waiting must not use the special warning");
assert.equal(shouldSpecialWarn({...exactInspection,reason:"車検"},{...exactInspection,reason:"車検"}), false, "3 vehicle-inspection waiting pairs must not use the special warning");
assert.equal(shouldSpecialWarn({...exactInspection,reason:"一般整備"},{...exactInspection,reason:"一般整備"}), false, "4 general-repair waiting pairs must not use the special warning");
assert.equal(shouldSpecialWarn({...exactInspection,reason:"板金塗装"},{...exactInspection,reason:"板金塗装"}), false, "5 body-shop waiting pairs must not use the special warning");
assert.equal(shouldSpecialWarn({...exactInspection,mode:"morning"},{...exactInspection}), false, "6 broad A中 waiting candidate must not use the special warning");
assert.equal(shouldSpecialWarn({...exactInspection,waiting:false},{...exactInspection}), false, "7 waiting-service OFF must not use the special warning");

// Existing delivery cleanup/nulling behavior is deliberately preserved.
assert.match(v12, /来社・作業待ちには納車予定を登録しません。/, "waiting plus delivery prohibition must remain part of the baseline function contract");
assert.match(v12, /when v_waiting_service then null/, "waiting reschedule must keep planned delivery nulling");
assert.match(v12, /delete from public\.schedule_entries[\s\S]*entry_type='delivery'/, "waiting reschedule must keep delivery entry deletion");

console.log("waiting service customer-visit v1.3 corrected regression: ok");
