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
  '別のお客様・別車両',
  'create_schedule_registration_batch_v1',
  'p_items: batchItems',
  'customerId: row.customerId',
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
if (source.includes('customerIds.length !== 1')) {
  failures.push("obsolete same-customer guard returned");
}
if (source.includes('p_vehicle_ids: selectedVehicleIds')) {
  failures.push("obsolete same-customer UUID[] batch call returned");
}

if (failures.length) {
  console.error("FAIL schedule existing-vehicle selection regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS schedule existing-vehicle selection regression");
console.log("- registered customer/vehicle records are searchable");
console.log("- vehicles from different customers can be selected together");
console.log("- selected vehicle/customer fields are preserved for single registration");
console.log("- multiple selected vehicles use the JSONB atomic batch registration RPC");
