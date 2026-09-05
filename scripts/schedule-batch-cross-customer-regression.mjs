import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/schedule/new/page.tsx", import.meta.url), "utf8");

assert.doesNotMatch(source, /all selected vehicles must belong to the same customer|同じお客様に紐づく登録済み車両だけ/, "UI must not enforce same-customer batching");
assert.match(source, /p_day: day/, "JSONB batch overload receives shared registration day");
assert.match(source, /p_items: batchItems/, "JSONB batch overload receives per-vehicle items");
assert.match(source, /customerId: row\.customerId/, "each batch item keeps its own customer id");
assert.match(source, /customerName: row\.customerName \|\| row\.companyName/, "each batch item keeps its own customer identity");
assert.match(source, /entryType,\s*reason,\s*startsAt: check\.main\.startsAt/s, "shared entry/reason/time are copied to every batch item");
assert.match(source, /deliveryStartsAt: addDelivery/, "shared delivery plan is copied to every batch item");
assert.match(source, /別のお客様・別車両でも/, "UI explains cross-customer batching");

assert.match(source, /function resetAfterSuccessfulRegistration\(\)/, "success reset helper exists");
assert.match(source, /setSelectedVehicleIds\(\[\]\)/, "selected vehicles reset");
assert.match(source, /setCustomerName\(""\)/, "customer name resets");
assert.match(source, /setRegistrationLast4\(""\)/, "last4 resets");
assert.match(source, /setStaffId\(""\)/, "staff selection resets");
assert.match(source, /setNotes\(""\)/, "notes reset");
assert.match(source, /setRegisteredSearch\(""\)/, "vehicle search resets");
assert.match(source, /setDeliveryTimeKey\(""\)/, "delivery time selection resets");
assert.match(source, /setDeliveryDay\(day\)/, "registration day is kept as the only carried date basis");
assert.match(source, /resetAfterSuccessfulRegistration\(\);\s*setMessage\(\`\$\{selectedRows\.length\}台の予定をまとめて登録しました。登録日だけ引き継いで/s, "batch success resets then reports continuation");
assert.match(source, /resetAfterSuccessfulRegistration\(\);\s*setMessage\("予定を登録しました。登録日だけ引き継いで/s, "single success resets then reports continuation");

console.log("schedule cross-customer batch regression: ok");
