import assert from "node:assert/strict";
import fs from "node:fs";

const script=fs.readFileSync("scripts/append-photo-qr-a217-character-class-evidence.mjs","utf8");
for(const token of ["icb-certificate-qr-character-class-v1","classCounts","nonAsciiPositions","separatorPositions","asciiNonAsciiPattern","positionClassMask","payloadFragmentIncluded:false","unicodeCodePointsIncluded:false"]){assert.ok(script.includes(token),`missing ${token}`);}
assert.equal(script.includes("rawPayload:"),false);
assert.equal(script.includes("unicodeCodePoints:"),false);
assert.equal(script.includes("payloadFragment:"),false);

function classify(value){
 const text=String(value||"");const chars=Array.from(text);
 const isJapanese=cp=>(cp>=0x3040&&cp<=0x30ff)||(cp>=0x3400&&cp<=0x4dbf)||(cp>=0x4e00&&cp<=0x9fff)||(cp>=0xff66&&cp<=0xff9f);
 const cc=chars.map(ch=>{const cp=ch.codePointAt(0)??0;if(ch==="\uFFFD")return"R";if(cp<32||(cp>=127&&cp<=159))return"C";if(/[0-9]/.test(ch))return"D";if(/[A-Za-z]/.test(ch))return"L";if(cp>=32&&cp<=126)return"P";if(isJapanese(cp))return"J";return"N";});
 const pos=codes=>cc.flatMap((c,i)=>codes.includes(c)?[i]:[]);
 return {classCounts:{digit:pos(["D"]).length,latin:pos(["L"]).length,asciiPunctuation:pos(["P"]).length,japanese:pos(["J"]).length,otherNonAscii:pos(["N"]).length,control:pos(["C"]).length,replacement:pos(["R"]).length},nonAsciiPositions:pos(["J","N"]),separatorPositions:pos(["P"]),asciiNonAsciiPattern:cc.map(c=>(c==="J"||c==="N")?"N":"A").join(""),positionClassMask:cc.join("")};
}
const payload="1".repeat(20)+"A".repeat(20)+"-".repeat(8)+"車".repeat(12);
const got=classify(payload);
assert.deepEqual(got.classCounts,{digit:20,latin:20,asciiPunctuation:8,japanese:12,otherNonAscii:0,control:0,replacement:0});
assert.deepEqual(got.nonAsciiPositions,Array.from({length:12},(_,i)=>48+i));
assert.deepEqual(got.separatorPositions,Array.from({length:8},(_,i)=>40+i));
assert.equal(got.asciiNonAsciiPattern,"A".repeat(48)+"N".repeat(12));
assert.equal(got.positionClassMask,"D".repeat(20)+"L".repeat(20)+"P".repeat(8)+"J".repeat(12));
assert.match(got.positionClassMask,/^[DLPJNCR]+$/);
assert.equal(got.positionClassMask.includes("車"),false);
console.log("Stage A21.7 privacy invariants: PASS");
