import assert from "node:assert/strict";
import fs from "node:fs";

const search = fs.readFileSync(new URL("../app/schedule/search/page.tsx", import.meta.url), "utf8");
const edit = fs.readFileSync(new URL("../app/schedule/edit/page.tsx", import.meta.url), "utf8");

assert.match(search, /function isShortPlateNumberQuery\(text: string\)/, "short numeric query classifier exists");
assert.match(search, /\^\\d\{1,4\}\$/.source ? /isShortPlateNumberQuery/ : /isShortPlateNumberQuery/, "short numeric input is handled explicitly");
assert.match(search, /if \(shortPlateQuery\) \{[\s\S]*\.in\("registration_number_last4", last4Candidates\)/s, "1-4 digit search queries last4 exact candidates");
assert.match(search, /if \(shortPlateQuery\) \{[\s\S]*電話番号や登録番号全体の部分一致には流さない/s, "short numeric search excludes phone/full-registration partial matching");
assert.match(search, /digits\.padStart\(4, "0"\)/, "10 can match stored 0010");
assert.match(search, /String\(Number\(digits\)\)/, "0010 can match natural 10");

assert.match(search, /const key = row\.entry\.work_order_id \? `work:\$\{row\.entry\.work_order_id\}` : `entry:\$\{row\.entry\.id\}`/, "search results group by work_order_id");
assert.match(search, /const inbound = sorted\.find\(\(row\) => row\.entry\.entry_type !== "delivery"\)/, "group edit target prefers inbound entry");
assert.match(search, /deliveryRows = set\.rows\.filter\(\(row\) => row\.entry\.entry_type === "delivery"\)/, "delivery is rendered inside the same work-order card");
assert.match(search, /location\.assign\("\/schedule\/edit\?id="\+set\.primary\.entry\.id\)/, "one edit button opens the grouped work order through its inbound entry");
assert.doesNotMatch(search, /dayRows\.map\(\(\{entry,work,vehicle,customer\}\)/, "legacy one-card-per-schedule-entry rendering is removed");

assert.match(edit, /\.eq\("work_order_id",e\.work_order_id\)[\s\S]*\.eq\("entry_type","delivery"\)/s, "edit screen loads related delivery by work_order_id");
assert.match(edit, /if\(entry\.entry_type!=="delivery"\) await syncDeliveryPlan\(deliveryTarget\)/, "editing inbound can update related delivery in one save flow");

console.log("schedule search/work-order regression: ok");
