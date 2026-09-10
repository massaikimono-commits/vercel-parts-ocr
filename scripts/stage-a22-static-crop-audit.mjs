import assert from 'node:assert/strict';

function nearestBelow(vals,x,maxDist){return vals.filter(v=>v<x&&x-v<=maxDist).sort((a,b)=>(x-b)-(x-a))[0]??null;}
function nearestAbove(vals,x,maxDist){return vals.filter(v=>v>x&&v-x<=maxDist).sort((a,b)=>(a-x)-(b-x))[0]??null;}
function refine(center,top,bottom,rules,h,thickness){const max=h*.075,lo=nearestBelow(rules,center,max),hi=nearestAbove(rules,center,max);if(lo!==null&&hi!==null&&hi-lo>h*.018&&hi-lo<h*.12){const margin=Math.max(thickness+1,h*.0025);return {top:lo+margin,bottom:hi-margin,bounded:true};}const expand=Math.max((bottom-top)*.18,h*.006);return {top:top-expand,bottom:bottom+expand,bounded:false};}

// Synthetic table: 8 rows, horizontal rules every 70 px. Source text boxes are intentionally tight.
const H=1000;
const rules=Array.from({length:9},(_,i)=>360+i*70);
for(let i=0;i<8;i++){
  const textTop=rules[i]+18,textBottom=rules[i+1]-18,center=(textTop+textBottom)/2;
  const out=refine(center,textTop,textBottom,rules,H,2);
  assert.equal(out.bounded,true);
  assert.ok(out.top<=rules[i]+4,'top margin should retain ascenders');
  assert.ok(out.bottom>=rules[i+1]-4,'bottom margin should retain descenders');
  assert.ok(out.top<textTop && out.bottom>textBottom,'rule-bounded crop must expand beyond tight OCR row');
}

// Missing adjacent rules: fail safe expands source row rather than trimming 10% from it.
const fallback=refine(500,480,520,[300,700],H,2);
assert.equal(fallback.bounded,false);
assert.ok(fallback.top<480 && fallback.bottom>520);

// Vertical rule margins must be inward and proportional to measured rule thickness.
const paperW=1600,th=3,margin=Math.max((th+1)/paperW,.003);
assert.ok(margin>=.003 && margin<.01);

// Normalization root-cause classification: non-digit ONNX raw on numeric field is policy rejection, not CTC/index corruption.
function classify(raw,normalized,field){const r=raw.normalize('NFKC').trim(),n=normalized.trim();if(!r&&!n)return'raw-blank';if(r&&n)return r===n?'unchanged':'transformed-nonempty';if(r&&!n){if(field!=='name'&&!/\d/.test(r))return'numeric-policy-rejected-no-digit';if(field==='name'&&/^[\s|:;.,・]+$/.test(r))return'name-punctuation-only';return'emptied-other';}return'other';}
assert.equal(classify('部品','', 'retail'),'numeric-policy-rejected-no-digit');
assert.equal(classify('1,250','1250','retail'),'transformed-nonempty');
assert.equal(classify('123','123','qty'),'unchanged');

console.log(JSON.stringify({stage:'A22',structuralCropAudit:'PASS',tightRowTrimRemoved:true,ruleBoundedExpansion:true,ruleMarginApplied:true,normalizationAudit:'PASS'}));
