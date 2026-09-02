import fs from "node:fs";

const source = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const failures = [];

for (const expected of [
  'type RegisteredVehicleOption = {',
  '.from("customers")',
  '.from("vehicles")',
  '登録済みのお客様・車両から選ぶ',
  'function applyRegisteredVehicle(row: RegisteredVehicleOption, nextIds: string[])',
  'function toggleRegisteredVehicle(row: RegisteredVehicleOption)',
  'setSelectedVehicleIds(nextIds);',
  'setExistingCustomerId(row.customerId || "");',
  'setCustomerName(row.customerName || row.companyName);',
  'setRegistrationNumber(row.registrationNumber);',
  'setRegistrationLast4(last4);',
  'setMaker(row.maker);',
  'setModel(row.model);',
  'selectedVehicleIds.includes(row.vehicleId)',
  '同じお客様の車両',
  'create_schedule_registration_batch_v1',
  'p_vehicle_ids: selectedVehicleIds',
  'p_existing_customer_id: selectedCustomerForSubmitNow || null',
  'p_existing_vehicle_id: selectedVehicleForSubmitNow || null',
]) {
  if (!source.includes(expected)) failures.push("missing: " + expected);
}

for (const searchable of [
  "row.customerName",
  "row.companyName",
  "row.phone",
  "row.registrationNumber",
  "row.registrationLast4",
  "row.chassisNumber",
  "row.maker",
  "row.model",
]) {
  if (!source.includes(searchable)) failures.push("search field missing: " + searchable);
}

if (!source.includes('selectedVehicleIds.length > 1')) {
  failures.push("multi-vehicle branch missing");
}
if (!source.includes('customerIds.length !== 1')) {
  failures.push("same-customer guard missing");
}

if (failures.length) {
  console.error("FAIL schedule existing-vehicle selection regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS schedule existing-vehicle selection regression");
console.log("- registered customer/vehicle records are searchable");
console.log("- one or more vehicles from the same customer can be selected");
console.log("- selected vehicle/customer fields are preserved for single registration");
console.log("- multiple selected vehicles use the atomic batch registration RPC");
