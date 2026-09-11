import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const manifestPath="evaluation/parts/yellow-regression-manifest.v2.json";
const fixturePath="evaluation/parts/yellow-documents.corrected.v2.json";
const schemaPath="evaluation/schemas/icb-ocr-evaluation-manifest.v2.schema.json";
const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
const fixture=JSON.parse(fs.readFileSync(fixturePath,"utf8"));
JSON.parse(fs.readFileSync(schemaPath,"utf8"));
assert.equal(manifest.schemaVersion,"2.0.0");assert.equal(manifest.setType,"REGRESSION");
assert.equal(manifest.documents.length,6);assert.equal(manifest.captures.length,12);
const unique=(items,key)=>new Set(items.map(item=>item[key])).size===items.length;
assert.ok(unique(manifest.documents,"documentId"));assert.ok(unique(manifest.captures,"captureId"));assert.ok(unique(manifest.captures,"imageId"));
const docs=new Map(manifest.documents.map(document=>[document.documentId,document]));let uniqueRows=0,visibleRows=0,composites=0;
for(const document of manifest.documents){assert.equal(document.reviewStatus,"CONFIRMED");assert.equal(document.rows.length,document.physicalRowCount);assert.equal(document.fieldGT,`${fixture.fixtureVersion}#${document.documentId}`);assert.deepEqual(document.rows,fixture.documents[document.documentId].map(row=>row.rowId));uniqueRows+=document.physicalRowCount;}
assert.equal(uniqueRows,23);
for(const capture of manifest.captures){assert.equal(capture.reviewCopyHash,null,"public manifest must not expose review-copy hashes");assert.equal(capture.historicalEvaluationHash,null);assert.equal(capture.reviewStatus,"CONFIRMED");assert.equal(capture.subset==="MULTI_DOCUMENT_COMPOSITE",capture.documentsInCapture.length>1);if(capture.documentsInCapture.length>1)composites++;const count=capture.documentsInCapture.reduce((sum,relation)=>{const document=docs.get(relation.documentId);assert.ok(document);assert.equal(relation.visibleRowCount,relation.visibleRowIds.length);assert.ok(relation.visibleRowIds.every(row=>document.rows.includes(row)));return sum+relation.visibleRowCount;},0);assert.equal(count,capture.captureVisibleRowCount);visibleRows+=count;}
assert.equal(visibleRows,60);assert.equal(composites,3);
const fingerprints=new Set();for(const document of manifest.documents){const value=crypto.createHash("sha256").update(JSON.stringify(fixture.documents[document.documentId].map(({rowId,...row})=>row))).digest("hex");assert.ok(!fingerprints.has(value),"cross-document GT duplication");fingerprints.add(value);}
assert.equal(fixture.gtScoringOnly,true);assert.equal(fixture.runtimeUse,false);assert.equal(fixture.historicalLineage.historicalInvalid,true);
const route=fs.readFileSync("app/eval/parts-ocr-corrected-rescore/page.tsx","utf8"),helper=fs.readFileSync("app/ocr/diagnostic/corrected-rescore/prediction-export.ts","utf8");
for(const token of ["gtIncluded: false","prediction-export.v2","downloadPredictionExport"])assert.ok(helper.includes(token));
for(const token of ["historicalResultsRewritten:false","formalAdoption:false","gtRuntimeUse:false","SINGLE_DOCUMENT","MULTI_DOCUMENT_COMPOSITE"])assert.ok(route.includes(token));
for(const forbidden of ["detectPaperBox","getA19DynamicRows","recognizeTess","recognizeOnnx","makeA22CellCrop"])assert.ok(!route.includes(forbidden),`GT scoring route imports runtime operation: ${forbidden}`);
for(const path of ["app/ocr/diagnostic/stage-a20/a19-table-crops.ts","app/ocr/diagnostic/stage-a20/recognition.ts","app/ocr/diagnostic/stage-a21/model-diagnostics.ts","app/ocr/diagnostic/stage-a22/crop-correction.ts"]){const code=fs.readFileSync(path,"utf8");assert.ok(!code.includes("yellow-documents.corrected.v2"));assert.ok(!code.includes("yellow-regression-manifest.v2"));}
console.log(JSON.stringify({ok:true,publicSafe:true,schemaVersion:"2.0.0",documents:6,captures:12,uniqueDocumentRows:23,captureVisibleRows:60,singleDocumentCaptures:9,compositeCaptures:3,unresolved:0,validationLeakage:false,gtRuntimeReference:false,manifestIntegrityReady:true,correctedRescoreComplete:false,architectureBakeoffReady:false,previewToolingReady:true},null,2));
