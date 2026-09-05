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
assert.match(source, /setDeliveryDay\(day\)/, "delivery date resets from the kept registration day");

assert.match(source, /useState<EntryType>\("pickup"\)/, "initial entry type defaults to pickup");
assert.match(source, /useState<Reason>\("点検"\)/, "initial reason defaults to inspection");
assert.match(source, /useState\("schedule"\)/, "initial inspection subtype defaults to schedule");
assert.match(source, /setEntryType\("pickup"\)/, "reset entry type defaults to pickup");
assert.match(source, /setReason\("点検"\)/, "reset reason defaults to inspection");
assert.match(source, /setInspectionScheduleType\("schedule"\)/, "reset inspection subtype defaults to schedule");

assert.match(source, /resetAfterSuccessfulRegistration\(\);\s*setMessage\(""\);\s*setSuccessMessage\(/s, "successful registration resets before showing top success");
assert.match(source, /requestAnimationFrame\(\(\) => window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)\)/, "successful registration scrolls to top");

console.log("schedule cross-customer batch regression: ok");
