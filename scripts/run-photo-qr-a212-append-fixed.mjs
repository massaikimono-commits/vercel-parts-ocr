import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const sourcePath="scripts/append-photo-qr-a212-runner.mjs";
let source=fs.readFileSync(sourcePath,"utf8");
function replaceRequired(from,to,label){if(!source.includes(from))throw new Error(`A21.2 ${label} marker missing`);source=source.replace(from,to);}
replaceRequired('id:`a212-a-triplet-${t.rank??0}`','id:"a212-a-triplet-"+String(t.rank??0)',"template-safe");
replaceRequired('actualRawDecodeSuccessCount:0,actualStructuralPassCount:0,actualDecodeFailCount:0','actualRawDecodeSuccessCount:0,actualStructuralPassCount:0,actualStructuralRejectCount:0,actualDecodeFailCount:0',"B structural reject counter");
replaceRequired('d.rawDecodeSuccessCount=raw;d.structuralPassCount=struct;bCounters.actualRawDecodeSuccessCount+=raw;bCounters.actualStructuralPassCount+=struct;d.canonicalResult=a212CanonicalList(result);','d.rawDecodeSuccessCount=raw;d.structuralPassCount=struct;d.structuralRejectCount=a212StructuralRejectCount(result);bCounters.actualRawDecodeSuccessCount+=raw;bCounters.actualStructuralPassCount+=struct;bCounters.actualStructuralRejectCount+=d.structuralRejectCount;d.canonicalResult=a212CanonicalList(result);',"B structural reject attribution");
replaceRequired('if(!canvas){bDetails.push(d);continue;}','if(!canvas){continue;}',"B single detail record");
replaceRequired('if(!canvas){cDetails.push(d);continue;}','if(!canvas){continue;}',"C single variant record");
const tempPath=path.resolve(".a212-append-fixed.mjs");
fs.writeFileSync(tempPath,source);
try{await import(pathToFileURL(tempPath).href+`?v=${Date.now()}`);}finally{fs.rmSync(tempPath,{force:true});}
