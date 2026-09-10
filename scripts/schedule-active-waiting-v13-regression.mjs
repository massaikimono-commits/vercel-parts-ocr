import fs from "node:fs";
import assert from "node:assert/strict";

const page = fs.readFileSync("app/schedule/active/page.tsx", "utf8");

assert.ok(page.includes('const [isWaitingService, setIsWaitingService] = useState(false);'), "active schedule tracks waiting state");
assert.ok(page.includes('entryType === "customer_visit" && <label>'), "waiting control is customer-visit eligible without reason gating");
assert.ok(page.includes('entryType !== "customer_visit" && isWaitingService'), "switching away from customer visit clears waiting");
assert.ok(page.includes('const waitingService = entryType === "customer_visit" && isWaitingService;'), "submit revalidates waiting eligibility");
assert.ok(page.includes('if (isWaitingService && addDelivery) setAddDelivery(false);'), "waiting disables delivery selection");
assert.ok(page.includes('p_is_waiting_service: waitingService'), "main slot check passes waiting flag");
assert.ok(page.includes('is_waiting_service: waitingService'), "work order persists waiting flag");
assert.ok(page.includes('planned_delivery_at: !waitingService && addDelivery'), "waiting keeps planned delivery null");
assert.ok(page.includes('if (!waitingService && addDelivery && selectedDelivery)'), "waiting creates no delivery schedule entry");
assert.ok(page.includes('if (!waitingService && addDelivery && !selectedDelivery)'), "waiting does not require a delivery time");
assert.ok(page.includes('作業待ちのため納車予定は登録しません。'), "waiting UI explains delivery suppression");
assert.ok(!page.includes('reason === "点検" && <label><input type="checkbox" checked={isWaitingService}'), "waiting eligibility is not inspection-only");
console.log("schedule active waiting v1.3 regression: PASS");
