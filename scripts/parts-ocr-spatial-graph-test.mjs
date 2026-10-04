import assert from 'node:assert/strict';
import {reconstructSpatialGraph} from '../app/ocr/architecture-vnext/token-spatial-graph.mjs';
// Independent procedural fixtures. No photographs, stored OCR, GT, or runtime arrays.
function fixture({count=3,scale=1,dx=0,dy=0,standard=true,split=false,multiline=false}={}) {
 const ts=[];const add=(text,x,y,w=30)=>ts.push({text,x1:dx+x*scale,x2:dx+(x+w)*scale,y1:dy+y*scale,y2:dy+(y+10)*scale,confidence:.95});
 const headers=standard?[['品名',20],['出庫数',180],['標準価格',260],['単価',360],['金額',460]]:[['品名',20],['数量',180],['単価',280],['金額',460]];
 for(const [text,x] of headers) {if(split) [...text].forEach((c,i)=>add(c,x+i*10,20,9));else add(text,x,20,text.length*10);}
 for(let i=0;i<count;i++){const y=60+i*40;add(`部品${String.fromCharCode(65+i%26)}`,20,y,60);add(String(i+1),180,y);add(String(1200+i),standard?260:280,y);if(standard)add(String(800+i),360,y);add(String(2400+i),460,y);if(multiline)add('補助名称',20,y+15,60);}
 return {tokens:ts,dimensions:{width:dx+550*scale,height:dy+(80+count*40)*scale}};
}
let checks=0;
for(const count of [1,2,7,13])for(const scale of [.5,1,3])for(const standard of [false,true])for(const split of [false,true]) {
 const {tokens,dimensions}=fixture({count,scale,dx:27,dy:31,standard,split,multiline:true});const r=reconstructSpatialGraph(tokens,dimensions);
 assert.equal(r.rows.length,count);assert.equal(r.hypotheses.length,1);assert.equal(r.rows[0].retail.normalized,'1200');assert.equal(r.rows[0].cost.status,standard?'observed':'missing');assert.match(r.rows[0].name.raw,/補助名称/);assert.equal(r.manualReviewRequired,true);assert.equal(r.autoConfirmedRows,0);checks++;
}
{
 const f=fixture();f.tokens=f.tokens.filter(t=>t.text!=='800');const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.rows[0].cost.status,'missing');checks++;
}
{
 const f=fixture({standard:false});f.tokens.push({text:'単価',x1:360,x2:380,y1:20,y2:30});const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.ok(r.diagnostics.includes('duplicate-semantic-columns'));assert.equal(r.rows[0].retail.status,'ambiguous');assert.equal(r.rows[0].cost.status,'ambiguous');checks++;
}
{
 const f=fixture();f.tokens.push({text:'999',x1:220,x2:280,y1:60,y2:70});const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.rows[0].retail.status,'ambiguous');checks++;
}
{
 const f=fixture();f.tokens.push({text:'数量についての注意事項',x1:0,x2:140,y1:0,y2:10});const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.hypotheses.length,1);checks++;
}
{
 const f=fixture();f.tokens=f.tokens.filter(t=>t.y1!==20);const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.rows.length,0);assert.ok(r.diagnostics.includes('no-proven-header-band'));checks++;
}
{
 const f=fixture();f.tokens.push(...f.tokens.filter(t=>t.y1===20).map(t=>({...t,y1:35,y2:45})));const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.hypotheses.length,2);assert.equal(r.rows[0].qty.status,'ambiguous');checks++;
}
{
 const r=reconstructSpatialGraph([{text:'noise',x1:0,x2:10,y1:0,y2:10}],{width:100,height:100});assert.equal(r.rows.length,0);checks++;
}
{
 const f=fixture();const r=reconstructSpatialGraph(f.tokens,{width:NaN,height:100});assert.equal(r.rows.length,0);checks++;
}
// Seeded generated layouts vary ordering, column width, line height, and row count.
let seed=0x51ab23;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let caseId=0;caseId<30;caseId++) {
 const order=['品名','数量','単価','品番','金額'].sort(()=>random()-.5);
 const cell=90+random()*80, lineHeight=8+random()*16, count=1+Math.floor(random()*9), tokens=[];
 const add=(text,col,y,confidence=null)=>tokens.push({text,x1:col*cell+cell*.25,x2:col*cell+cell*.5,y1:y,y2:y+lineHeight,confidence});
 order.forEach((s,c)=>add(s,c,10));
 for(let row=0;row<count;row++)order.forEach((s,c)=>add(s==='品名'?`交換部品${row}`:s==='数量'?'0':s==='単価'?'1234':s==='品番'?'987654':'5678',c,50+row*lineHeight*3,s==='数量'?0:null));
 const r=reconstructSpatialGraph(tokens,{width:cell*5,height:100+count*lineHeight*3});
 assert.equal(r.rows.length,count);assert.equal(r.rows[0].qty.normalized,'0');assert.equal(r.rows[0].qty.confidence,0);assert.equal(r.rows[0].retail.confidence,null);assert.equal(r.rows[0].retail.normalized,'1234');assert.equal(r.rows[0].cost.columnAbsent,true);checks++;
}
for(const bad of [{x1:-1},{x2:10000},{confidence:NaN},{confidence:Infinity}]) {
 const f=fixture();Object.assign(f.tokens[0],bad);assert.equal(reconstructSpatialGraph(f.tokens,f.dimensions).rows.length,0);checks++;
}
{
 const f=fixture();f.tokens.push({text:'1234',x1:260,x2:290,y1:220,y2:230});f.dimensions.height=300;const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.rows.length,3);checks++;
}
{
 const f=fixture();const header=f.tokens.filter(t=>t.y1===20);const line={text:header.map(t=>t.text).join(''),x1:20,x2:490,y1:20,y2:30};
 const without=f.tokens.filter(t=>t.y1!==20);assert.equal(reconstructSpatialGraph([line,...without],f.dimensions).rows.length,0);
 line.characterBoxes=header.flatMap(t=>[...t.text].map((text,i)=>({...t,text,x1:t.x1+i*10,x2:t.x1+(i+1)*10})));
 assert.equal(reconstructSpatialGraph([line,...without],f.dimensions).rows.length,3);checks++;
}
{
 const f=fixture();
 for(const t of f.tokens) {
  t.confidence=null;
  t.characterBoxes=[...t.text].map((text,i)=>({text,x1:t.x1+(t.x2-t.x1)*i/t.text.length,x2:t.x1+(t.x2-t.x1)*(i+1)/t.text.length,y1:t.y1,y2:t.y2,confidence:null}));
 }
 const r=reconstructSpatialGraph(f.tokens,f.dimensions);
 assert.equal(r.rows[0].name.raw,'部品A');assert.equal(r.rows[0].retail.normalized,'1200');assert.equal(r.rows[0].retail.status,'observed');assert.equal(r.rows[0].qty.normalized,'1');assert.equal(r.rows[0].name.confidence,null);assert.equal(r.rows[0].retail.confidence,null);checks++;
}
{
 const f=fixture();f.tokens.find(t=>t.text==='標準価格').text='未知見出し';
 const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.hypotheses[0].schema,'unknown-mixed');assert.equal(r.hypotheses[0].familyEvidence.outgoingQuantity,true);assert.equal(r.rows[0].retail.status,'ambiguous');assert.equal(r.rows[0].cost.status,'ambiguous');assert.equal(r.rows[0].cost.columnAbsent,false);checks++;
}
{
 const f=fixture();f.tokens.push({text:'原価',x1:410,x2:430,y1:20,y2:30});
 const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.hypotheses[0].ambiguous,true);assert.equal(r.rows[0].cost.status,'ambiguous');checks++;
}
{
 const f=fixture({standard:false});const header=f.tokens.filter(t=>t.y1===20);
 const line={text:header.map(t=>t.text).join(' '),x1:20,x2:490,y1:20,y2:30,confidence:null,characterBoxes:header.flatMap(t=>[...t.text].map((text,i)=>({...t,text,confidence:null,x1:t.x1+i*10,x2:t.x1+(i+1)*10})))};
 const r=reconstructSpatialGraph([line,...f.tokens.filter(t=>t.y1!==20)],f.dimensions);assert.equal(r.rows.length,3);assert.equal(r.hypotheses[0].absentCostProven,true);assert.equal(r.rows[0].retail.normalized,'1200');checks++;
}
for(const text of ['？？','12345']) {
 const f=fixture({standard:false});f.tokens.push({text,x1:360,x2:390,y1:20,y2:30,confidence:null});const r=reconstructSpatialGraph(f.tokens,f.dimensions);assert.equal(r.hypotheses[0].absentCostProven,false);assert.equal(r.rows[0].cost.columnAbsent,false);assert.equal(r.rows[0].cost.status,'missing');checks++;
}
console.log(`TOKEN_SPATIAL_GRAPH: ${checks} deterministic synthetic cases passed`);
