import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const sourcePath="scripts/append-photo-qr-a212-runner.mjs";
let source=fs.readFileSync(sourcePath,"utf8");
const unsafe='id:`a212-a-triplet-${t.rank??0}`';
if(!source.includes(unsafe)) throw new Error("A21.2 expected template marker missing");
source=source.replace(unsafe,'id:"a212-a-triplet-"+String(t.rank??0)');
const tempPath=path.resolve(".a212-append-fixed.mjs");
fs.writeFileSync(tempPath,source);
try{await import(pathToFileURL(tempPath).href+`?v=${Date.now()}`);}finally{fs.rmSync(tempPath,{force:true});}
