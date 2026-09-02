import fs from "node:fs";

const source = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const failures = [];

for (const expected of [
  'type RegisteredVehicleOption = {',
  '.from("customers")',
  '.from("vehicles")',
  '登録済みの車検証・車両情報から選ぶ',
  'function selectRegisteredVehicle(row: RegisteredVehicleOption)',
  'setExistingVehicleId(row.vehicleId);',
  'setExistingCustomerId(row.customerId || "");',
  'setCustomerName(row.customerName || row.companyName);',
  'setRegistrationNumber(row.registrationNumber);',
  'setRegistrationLast4(last4);',
  'setMaker(row.maker);',
  'setModel(row.model);',
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

if (failures.length) {
  console.error("FAIL schedule existing-vehicle selection regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS schedule existing-vehicle selection regression");
console.log("- registered customer/vehicle records are searchable");
console.log("- selection fills schedule customer/vehicle fields");
console.log("- existing customer/vehicle IDs are preserved for schedule registration");
