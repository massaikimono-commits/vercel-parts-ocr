import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../database/schedule-rpc-active-user-guard.sql", import.meta.url), "utf8");

const guard = /if not public\.request_has_app_secret\(\) and not public\.is_active_app_user\(\) then/g;
const unauthorized = /raise insufficient_privilege using message = 'not authorized'/g;

assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.create_schedule_registration_v2\(/g) || []).length, 2, "registration core + compatibility signatures must both be recorded");
assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.create_schedule_registration_batch_v1\(/g) || []).length, 2, "batch JSONB + compatibility signatures must both be recorded");
assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.reschedule_schedule_entry_v2\(/g) || []).length, 2, "reschedule core + compatibility signatures must both be recorded");
assert.equal((sql.match(guard) || []).length, 6, "all six SECURITY DEFINER schedule mutation signatures must require app-secret or active app user");
assert.equal((sql.match(unauthorized) || []).length, 6, "all six signatures must fail closed with insufficient_privilege");
assert.doesNotMatch(sql, /auth\.uid\(\) is null and not public\.request_has_app_secret\(\)/, "legacy auth.uid-only guard must never return");
assert.ok((sql.match(/SECURITY DEFINER/g) || []).length >= 6, "SECURITY DEFINER stays intentional; this hardening must not switch it mechanically to invoker");
assert.ok((sql.match(/revoke all on function public\./g) || []).length >= 6, "all target signatures must explicitly revoke public/anon execute");
assert.ok((sql.match(/grant execute on function public\./g) || []).length >= 6, "all target signatures must explicitly grant authenticated/service execution");
assert.doesNotMatch(sql, /grant execute on function[\s\S]{0,300}\bto\s+anon\b/i, "anon must not gain direct execute access");
assert.match(sql, /request_has_app_secret\(\).*is_active_app_user\(\)/s, "trusted app-secret path must remain an alternative to active-user auth");

console.log("schedule RPC active-user security regression: ok");
