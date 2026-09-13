import fs from "node:fs";

const report = fs.readFileSync("app/schedule/print/page.tsx", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(report.includes('page: { widthMm: 297, heightMm: 420'), "daily report must retain exact A3 physical dimensions");
assert(report.includes('@page{size:A3 portrait;margin:0}'), "daily report must retain A3 portrait margin-zero page contract");
assert(report.includes('position:fixed!important') && report.includes('width:297mm!important') && report.includes('height:420mm!important'), "print sheet must be fixed to one physical A3 page");
assert(report.includes('page-break-before:avoid!important') && report.includes('page-break-after:avoid!important'), "daily report must prevent page splitting");
assert(report.includes('transform:none!important'), "print layout must not depend on transform scaling or Safari compositor offsets");
assert(report.includes('sourceWidth: 1755') && report.includes('sourceHeight: 2482'), "field calibration must declare the source-PDF coordinate system");
for (const section of ["delivery", "inbound", "messages", "stayingVehicles", "bodyShopVehicles", "plannedDeliveries"]) {
  assert(report.includes(`${section}: {`), `daily report must retain calibrated section ${section}`);
}
assert(report.includes('fieldAnchors: {'), "daily report must define a structured field-anchor map");
for (const field of ["customerName", "vehicleNo", "time", "assignee", "workCode", "progress", "visitLabel", "dueDay", "dueHour", "dueMinute", "dueBroad", "messages", "stayingAssignee", "stayingCustomer", "stayingVehicle", "stayingInboundDay", "stayingDueDay", "bodyShopVendor", "bodyShopCustomer", "bodyShopVehicle", "bodyShopInboundDay", "bodyShopDueDay", "plannedCustomer", "plannedVehicle", "plannedDue", "vehicleInspectionCount", "workCompletionPlan", "reportAssignee"]) {
  assert(report.includes(`${field}: {`), `field anchor ${field} must be explicitly defined`);
}
const customerAnchorCount = (report.match(/customerName:\s*\{[^}]*align:\s*"left"/g) || []).length;
assert(customerAnchorCount >= 2, "delivery and inbound customer names must be explicitly left anchored");
assert(report.includes('className="anchoredField reportAssignee"') && report.includes('{entry.workerName}'), "row assignee must print in its dedicated anchor");
assert(report.includes('className="anchoredField reportWorkCode"') && report.includes('dailyReportWorkCode('), "work/inspection code must remain printed in its dedicated anchor");
assert(report.includes('.reportWorkCode{font-size:.64em;font-weight:700}'), "work-code helper text must have an explicit field style");
assert(!report.includes('.reportVehicle small{font-size:.62em'), "legacy generic vehicle-cell helper placement must be removed");
assert(report.includes('.stayingRow .secCustomer') && report.includes('justify-content:flex-start'), "staying customer must be left anchored");
assert(report.includes('.bodyShopRow .secCustomer') && report.includes('justify-content:flex-start'), "body-shop customer must be left anchored");
assert(report.includes('.plannedRow .secCustomer') && report.includes('justify-content:flex-start'), "planned-delivery customer must be left anchored");
const printStart = report.indexOf('@media print');
assert(printStart >= 0, "daily report must have an isolated print media block");
const printCss = report.slice(printStart);
assert(!printCss.includes('vw') && !printCss.includes('vh'), "print field geometry must not depend on viewport units");
assert(!printCss.includes('scale('), "print field geometry must not use scale to mask calibration errors");

console.log("Daily report A3 field-anchor regression: PASS");
