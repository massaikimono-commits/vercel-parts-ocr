import assert from "node:assert/strict";
import { resolveCertificatePdfMissingFields } from "../app/certificate-pdf-canonical-missing-field-resolver.js";
import { resolveCertificatePdfWeightDisplacementFields } from "../app/certificate-pdf-weight-displacement-resolver.js";
function line(y,entries){return{y,text:entries.map(([text])=>text).join(" "),tokens:entries.map(([text,x,w=.04])=>({text,x,y,w,h:.012}))};}
{
 const lines=[line(.2,[["総排気量又は定格出力",.2,.18],["1.99",.5],["kW",.57]]),line(.3,[["車両重量",.2,.08],["9999 kg",.35]])];
 const strict={displacementOrRatedOutput:"1.99 L",vehicleWeightKg:"1250"};const r=resolveCertificatePdfMissingFields(lines,strict);assert.equal(r.patch.displacementOrRatedOutput,"1.99 L");assert.equal(r.patch.vehicleWeightKg,"1250");assert.equal(r.provenance.displacementOrRatedOutput.source,"strict");
}
{
 const lines=[line(.10,[["車台番号",.10,.08],["PE52-000952",.28,.10]]),line(.18,[["型式",.10,.05],["DBA-PE52",.28,.09]]),line(.26,[["原動機の型式",.10,.10],["VQ35",.28,.06]]),line(.34,[["車両重量",.10,.08],["2020 kg",.28,.08]]),line(.42,[["車両総重量",.10,.10],["2405 kg",.28,.08]])];const r=resolveCertificatePdfMissingFields(lines,{});assert.equal(r.patch.chassisNumber,"PE52-000952");assert.equal(r.patch.model,"DBA-PE52");assert.equal(r.patch.engineModel,"VQ35");assert.equal(r.patch.vehicleWeightKg,"2020");assert.equal(r.patch.grossVehicleWeightKg,"2405");
}
{
 const lines=[line(.50,[["総排気量又は定格出力",.10,.18],["1.99",.40,.05],["L",.47,.02]]),line(.53,[["kW",.47,.02]])];const r=resolveCertificatePdfMissingFields(lines,{});assert.equal(r.patch.displacementOrRatedOutput,"1.99 L");assert.equal(r.provenance.displacementOrRatedOutput.evidence.method,"baseline-affinity-split-token");
}
{const r=resolveCertificatePdfMissingFields([line(.60,[["総排気量又は定格出力",.10,.18],["85",.40],["kW",.46]])],{});assert.equal(r.patch.displacementOrRatedOutput,"85 kW");}
{const r=resolveCertificatePdfMissingFields([line(.70,[["PE52-000952",.20],["2020 kg",.40],["3.49",.55],["L",.60]])],{});assert.equal(r.patch.chassisNumber,undefined);assert.equal(r.patch.vehicleWeightKg,undefined);assert.equal(r.patch.displacementOrRatedOutput,undefined);}
{const r=resolveCertificatePdfMissingFields([line(.74,[["原動機の型式",.10,.10],["DBA-PE52",.28,.09]]),line(.76,[["VQ35",.28,.06]])],{});assert.equal(r.patch.engineModel,"VQ35");}
{
 const lines=[line(.80,[["車台番号",.10,.08],["PE52-000952",.28,.10]]),line(.82,[["車両重量",.10,.08],["2020 kg",.28,.08]]),line(.84,[["車両総重量",.10,.10],["2405 kg",.28,.08]])];const strict={chassisNumber:"LOCKED-0001",vehicleWeightKg:"1999"};const r=resolveCertificatePdfMissingFields(lines,strict);assert.equal(r.patch.chassisNumber,"LOCKED-0001");assert.equal(r.patch.vehicleWeightKg,"1999");assert.equal(r.patch.grossVehicleWeightKg,"2405");
}
{const r=resolveCertificatePdfMissingFields([line(.88,[["車両重量",.10,.08],["2020",.28,.08]]),line(.90,[["長さ",.10,.05],["ABC cm",.28,.08]]),line(.92,[["型式指定番号",.10,.10],["12A45",.28,.08]])],{});assert.equal(r.patch.vehicleWeightKg,undefined);assert.equal(r.patch.lengthCm,undefined);assert.equal(r.patch.modelDesignationNumber,undefined);}
// Registration reconstruction: fragmented region tokens remain part of the four-part number.
{
 const lines=[line(.10,[["自動車登録番号又は車両番号",.08,.20]]),line(.13,[["なに",.10,.04],["わ",.145,.02],["400",.20,.04],["む",.25,.02],["5905",.29,.05]])];
 const r=resolveCertificatePdfMissingFields(lines,{registrationNumber:"わ 400 む 5905"});assert.equal(r.patch.registrationNumber,"なにわ 400 む 5905");assert.equal(r.provenance.registrationNumber.replacedInvalidStrict,true);
}
// Optional payload: a label without a positive kg value-cell stays empty; nearby dimensions cannot leak in.
{
 const lines=[line(.20,[["最大積載量",.10,.08],["長さ",.24,.04],["491",.30,.04],["cm",.35,.02]]),line(.23,[["車両重量",.10,.08],["2020",.30,.04],["kg",.35,.02]])];
 const a=resolveCertificatePdfMissingFields(lines,{});const b=resolveCertificatePdfWeightDisplacementFields(lines,a.patch);assert.equal(b.patch.maxPayloadKg,undefined);
}
// Optional payload: unrelated kg in a sibling cell must not be harvested.
{
 const lines=[line(.30,[["最大積載量",.10,.08],["車両重量",.24,.08],["2020",.34,.04],["kg",.39,.02]])];const r=resolveCertificatePdfWeightDisplacementFields(lines,{});assert.equal(r.patch.maxPayloadKg,undefined);
}
// Positive payload evidence remains recoverable when numeric and kg are inside its bounded cell.
{
 const lines=[line(.40,[["最大積載量",.10,.08],["350",.20,.04],["kg",.245,.02],["車両重量",.34,.08],["940",.45,.04],["kg",.495,.02]])];const r=resolveCertificatePdfWeightDisplacementFields(lines,{});assert.equal(r.patch.maxPayloadKg,"350");
}
console.log("certificate PDF canonical resolver regression: PASS");
