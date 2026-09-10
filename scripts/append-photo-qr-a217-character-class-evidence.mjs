import fs from "node:fs";

const corePath="app/eval/certificate-qr-decode-experiment/photo-qr-diagnostic-core.generated.js";
if(!fs.existsSync(corePath)) throw new Error("generated Photo QR core missing");
let core=fs.readFileSync(corePath,"utf8");
if(core.includes("function a217CharacterClassEvidence")){
  console.log("Stage A21.7 character-class instrumentation already appended");
  process.exit(0);
}
if(!core.includes("async function a213EvidenceRecord")) throw new Error("A21.3 evidence instrumentation missing before A21.7");

const helper=String.raw`
function a217CharacterClassEvidence(value){
  const text=String(value||"");
  const chars=Array.from(text);
  const isJapanese=(cp)=>(cp>=0x3040&&cp<=0x30ff)||(cp>=0x3400&&cp<=0x4dbf)||(cp>=0x4e00&&cp<=0x9fff)||(cp>=0xff66&&cp<=0xff9f);
  const classify=(ch)=>{
    const cp=ch.codePointAt(0)??0;
    if(ch==="\uFFFD")return "R";
    if(cp<32||(cp>=127&&cp<=159))return "C";
    if(/[0-9]/.test(ch))return "D";
    if(/[A-Za-z]/.test(ch))return "L";
    if(cp>=32&&cp<=126)return "P";
    if(isJapanese(cp))return "J";
    return "N";
  };
  const classes=chars.map(classify);
  const positions=(codes)=>classes.flatMap((c,i)=>codes.includes(c)?[i]:[]);
  const classCounts={digit:positions(["D"]).length,latin:positions(["L"]).length,asciiPunctuation:positions(["P"]).length,japanese:positions(["J"]).length,otherNonAscii:positions(["N"]).length,control:positions(["C"]).length,replacement:positions(["R"]).length};
  return {
    schema:"icb-certificate-qr-character-class-v1",
    codePointCount:chars.length,
    utf16CodeUnitLength:text.length,
    classCounts,
    nonAsciiPositions:positions(["J","N"]),
    separatorPositions:positions(["P"]),
    asciiNonAsciiPattern:classes.map(c=>(c==="J"||c==="N")?"N":"A").join(""),
    positionClassMask:classes.join(""),
    rawPayloadIncluded:false,
    payloadFragmentIncluded:false,
    unicodeCodePointsIncluded:false,
  };
}
`;
core=core.replace("async function a213EvidenceRecord",helper+"\nasync function a213EvidenceRecord");
core=core.replace(
  "payloadShape:a213PayloadShape(structural),\n    formalParserStep:",
  "payloadShape:a213PayloadShape(structural),\n    characterClassEvidence:a217CharacterClassEvidence(canonical),\n    formalParserStep:"
);
for(const token of ["a217CharacterClassEvidence","characterClassEvidence:a217CharacterClassEvidence(canonical)","nonAsciiPositions","separatorPositions","asciiNonAsciiPattern","positionClassMask","payloadFragmentIncluded:false"]){
  if(!core.includes(token))throw new Error(`A21.7 insertion failed: ${token}`);
}
fs.writeFileSync(corePath,core);
console.log("Stage A21.7 privacy-safe character-class evidence appended");
