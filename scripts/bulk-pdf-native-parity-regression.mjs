import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const bulk = read("app/customer-vehicles/bulk-import/page.tsx");
const v3 = read("app/certificate-pdf-structured-reader-v3.jsx");
const rpc = read("database/import-vehicle-certificates-batch-v1.sql");

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

expect(/export async function parseVehicleCertificatePdfStructured\(file\)/.test(v3), "structured v3 shared parser export missing");
expect(/parseVehicleCertificatePdfStructured/.test(bulk), "bulk import must use structured PDF v3");
expect(/const structured[^;]*= await parseVehicleCertificatePdfStructured\(file\)/s.test(bulk), "bulk import must run structured v3 first");
expect(/structured\?\.strong[\s\S]*parseVehicleCertificatePdfNative\(file\)/.test(bulk), "bulk import must use v2 only as a weak-v3 fallback");
expect(/for \(let index = 0; index < list\.length; index \+= 1\)/.test(bulk), "bulk PDF processing must remain file-ordered and isolated");
expect(!/Promise\.all\([^)]*parseVehicleCertificatePdf/.test(bulk), "bulk PDF parsing must not introduce shared-worker parallel races");

for (const key of [
  "registrationDate", "firstRegistration", "vehicleClass", "purpose", "privateBusiness",
  "bodyShape", "seatingCapacity", "maxPayloadKg", "vehicleWeightKg", "grossVehicleWeightKg",
  "lengthCm", "widthCm", "heightCm", "engineModel", "displacementOrRatedOutput", "fuel",
  "modelDesignationNumber", "classificationNumber", "frontFrontAxleWeightKg",
  "frontRearAxleWeightKg", "rearFrontAxleWeightKg", "rearRearAxleWeightKg",
  "inspectionExpiry", "baseLocation",
]) {
  expect(bulk.includes(`["${key}",`), `bulk review field missing: ${key}`);
}

expect(/updateCertificateField/.test(bulk), "bulk certificate fields must be editable");
expect(/certificateFields: row\.patch/.test(bulk), "complete parsed fields must reach the batch payload");
expect(/import_vehicle_certificates_batch_v1/.test(bulk), "bulk import RPC invocation missing");
expect(/coalesce\(v_item->'certificateFields', '\{\}'::jsonb\)/.test(rpc), "RPC must preserve complete certificate fields");
expect(/certificate_fields = case[\s\S]*v_item->'certificateFields'/.test(rpc), "RPC update must merge complete certificate fields");

console.log("bulk PDF native parity regression: PASS");
