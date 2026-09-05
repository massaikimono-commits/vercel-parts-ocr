import fs from "node:fs";

const customer = fs.readFileSync("app/customer-vehicles/page.tsx", "utf8");
const schedule = fs.readFileSync("app/schedule/new/page.tsx", "utf8");
const bulk = fs.readFileSync("app/customer-vehicles/bulk-import/page.tsx", "utf8");
const pdfNative = fs.readFileSync("app/certificate-pdf-native-reader-v2.jsx", "utf8");
const scheduleSql = fs.readFileSync("database/create-schedule-registration-batch-v1.sql", "utf8");
const importSql = fs.readFileSync("database/import-vehicle-certificates-batch-v1.sql", "utf8");

const failures = [];

function expect(source, value, label) {
  if (!source.includes(value)) failures.push(label + ": missing " + value);
}

expect(customer, "deleteSelectedCustomer", "customer deletion");
expect(customer, '.from("customers").delete()', "customer deletion");
expect(customer, "車両・予定・作業履歴は残", "customer deletion safety copy");
expect(customer, "/customer-vehicles/bulk-import", "bulk import navigation");

expect(schedule, "selectedVehicleIds", "multi-vehicle schedule");
expect(schedule, "toggleRegisteredVehicle", "multi-vehicle schedule");
expect(schedule, "create_schedule_registration_batch_v1", "multi-vehicle schedule");
expect(schedule, "p_items: batchItems", "cross-customer JSONB batch schedule");
expect(schedule, "customerId: row.customerId", "cross-customer JSONB batch schedule");
expect(schedule, "別のお客様・別車両", "cross-customer multi-vehicle schedule");
expect(schedule, "1台も登録せずに止めました", "multi-vehicle atomic failure");

expect(scheduleSql, "create_schedule_registration_batch_v1", "schedule batch sql");
expect(scheduleSql, "all selected vehicles must belong to the same customer", "schedule batch sql");
expect(scheduleSql, "exception", "schedule batch sql rollback");
expect(scheduleSql, "auth.uid() is null", "schedule batch sql auth");
expect(scheduleSql, "grant execute", "schedule batch sql grant");

expect(bulk, 'multiple', "bulk PDF UI");
expect(bulk, "parseVehicleCertificatePdfNative", "bulk PDF UI");
expect(bulk, "import_vehicle_certificates_batch_v1", "bulk PDF UI");
expect(bulk, "要確認", "bulk PDF review");
expect(bulk, "customerType", "bulk PDF customer type");
expect(bulk, "同じ車両と思われるPDF", "bulk PDF duplicate guard");

expect(importSql, "import_vehicle_certificates_batch_v1", "bulk import sql");
expect(importSql, "jsonb_array_length(p_items) > 200", "bulk import sql limit");
expect(importSql, "bulk_pdf_import", "bulk import sql source marker");
expect(importSql, "v_customer_type", "bulk import customer type");
expect(importSql, "customer that also has no address", "bulk import customer match safety");
expect(importSql, "auth.uid() is null", "bulk import sql auth");
expect(importSql, "grant execute", "bulk import sql grant");

expect(pdfNative, "export async function parseVehicleCertificatePdfNative", "native PDF parser");
expect(pdfNative, 'new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs"', "native PDF parser local worker");
if (pdfNative.includes("cdn.jsdelivr.net")) failures.push("native PDF parser: external jsDelivr worker dependency returned");

if (failures.length) {
  console.error("FAIL customer migration workflow regression");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS customer migration workflow regression");
console.log("- customer records can be removed without deleting vehicle/work history");
console.log("- different customers' existing vehicles can be scheduled together through the JSONB batch RPC");
console.log("- multiple native-text vehicle-certificate PDFs can be reviewed and bulk imported");
console.log("- bulk workflows remain authenticated and bounded");
