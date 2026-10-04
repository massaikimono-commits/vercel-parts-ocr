/** Document-local token graph. Constants are dimensionless typography ratios,
 * chosen for generic glyph spacing/line overlap; no evaluation-derived cutoffs.
 * Half-height overlap groups same-line glyphs; 1.5 line-heights bounds phrase
 * gaps; .75 line-heights bounds continuation attachment. These typography
 * ratios are not probabilities. Empty OCR cells never prove visual blankness.
 * Geometry cannot establish OCR truth: automatic confirmation is always disabled. */
const ALIASES = { name: ['部品名称','商品名','品名','名称','description'], qty: ['出庫数','数量','個数','qty','quantity'], standard: ['標準価格','定価','retail'], unit: ['単価'], cost: ['仕入価格','仕入','原価','cost'], amount: ['金額','合計','amount'], code: ['品番','部品番号','商品コード','code'] };
const compact = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s/g,'');
const box = ts => ({x1:Math.min(...ts.map(t=>t.x1)),y1:Math.min(...ts.map(t=>t.y1)),x2:Math.max(...ts.map(t=>t.x2)),y2:Math.max(...ts.map(t=>t.y2))});
const overlap = (a,b) => Math.max(0,Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1))/Math.min(a.y2-a.y1,b.y2-b.y1);
const median = xs => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)] || 1;
const numeric = s => { const n=String(s).normalize('NFKC').replace(/[,¥￥\s]/g,''); return /^\d+(?:\.\d+)?$/.test(n)?n:null; };
function field(ts,status='missing',region=null) {
 const raw=ts.map(t=>t.text).join(' '); return {raw,normalized: status==='observed'?(numeric(raw)??raw.normalize('NFKC')):'',confidence:ts.length&&ts.every(t=>t.confidence!=null)?Math.min(...ts.map(t=>t.confidence)):null,status,source:ts.map(t=>t.id),region:ts.length?box(ts):region};
}
export function reconstructSpatialGraph(input,{width,height}={}) {
 const diagnostics=[];
 const result=(rows=[],hypotheses=[])=>({rows,hypotheses,diagnostics,manualReviewRequired:true,wrongAutoConfirm0:true,autoConfirmedRows:0});
 if(!Array.isArray(input)) {diagnostics.push('invalid-token-input');return result();}
 // Character geometry must come from the provider. Never interpolate line boxes.
 const expanded=input.flatMap((t,lineIndex)=> {
  const chars=t.characterBoxes;
  if(!Array.isArray(chars)||chars.map(c=>c.text??c.character).join('').replace(/\s/g,'')!==t.text.replace(/\s/g,'')) return [t];
  // Preserve native body words/numbers. Split only a combined semantic header,
  // into whole phrase nodes using exact supplied character spans.
  const headerText=t.text.replace(/\s/g,'');
  const aliases=[...new Set(Object.values(ALIASES).flat())].sort((a,b)=>b.length-a.length);
  const spans=[];let offset=0;
  while(offset<headerText.length) {
   const alias=aliases.find(a=>headerText.slice(offset,offset+a.length).toLowerCase()===a);
   if(alias){spans.push({start:offset,end:offset+alias.length,semantic:true});offset+=alias.length;}
   else {const start=offset++;while(offset<headerText.length&&!aliases.some(a=>headerText.slice(offset,offset+a.length).toLowerCase()===a))offset++;spans.push({start,end:offset,semantic:false});}
  }
  if(spans.filter(s=>s.semantic).length<2) return [t];
  const charSpans=[];let charOffset=0;
  chars.forEach(c=>{const text=String(c.text??c.character).replace(/\s/g,'');if(!text)return;charSpans.push({...c,text,start:charOffset,end:charOffset+text.length});charOffset+=text.length;});
  const nodes=spans.map((span,i)=> {
   const cs=charSpans.filter(c=>c.start>=span.start&&c.end<=span.end);
   if(!cs.length||cs[0].start!==span.start||cs.at(-1).end!==span.end) return null;
   return {...box(cs),text:headerText.slice(span.start,span.end),id:`${t.id??`line:${lineIndex}`}:phrase:${i}`,confidence:cs.every(c=>c.confidence!=null)?Math.min(...cs.map(c=>c.confidence)):t.confidence??null};
  });
  return nodes.every(Boolean)?nodes:[t];
 });
 const tokens=expanded.map((t,i)=>({...t,id:t.id??`token:${t.x1??t.box?.x1}:${t.y1??t.box?.y1}:${t.x2??t.box?.x2}:${t.y2??t.box?.y2}`,text:String(t.text??''),x1:Number(t.x1 ?? t.box?.x1),y1:Number(t.y1 ?? t.box?.y1),x2:Number(t.x2 ?? t.box?.x2),y2:Number(t.y2 ?? t.box?.y2)})).filter(t=>[t.x1,t.x2,t.y1,t.y2].every(Number.isFinite)&&t.x2>t.x1&&t.y2>t.y1&&t.text.trim());
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) diagnostics.push('invalid-document-dimensions');
 if(tokens.length!==expanded.length) diagnostics.push('invalid-or-empty-tokens');
 if(tokens.some(t=>t.x1<0||t.y1<0||t.x2>width||t.y2>height)) diagnostics.push('out-of-bounds-token');
 if(tokens.some(t=>t.confidence!=null&&(!Number.isFinite(t.confidence)||t.confidence<0||t.confidence>1))) diagnostics.push('invalid-confidence');
 if(diagnostics.length) return result();
 const h=median(tokens.map(t=>t.y2-t.y1));
 const lines=[];
 for(const t of [...tokens].sort((a,b)=>a.y1-b.y1||a.x1-b.x1)) {let l=lines.find(l=>overlap(t,l.bounds)>=.5); if(!l){l={tokens:[],bounds:t};lines.push(l);}l.tokens.push(t);l.bounds=box(l.tokens);}
 const bands=[];
 for(const l of lines) {
  const sorted=l.tokens.sort((a,b)=>a.x1-b.x1), hits=[];
  for(let i=0;i<sorted.length;i++) for(let j=i;j<Math.min(sorted.length,i+12);j++) {
   if(j>i&&sorted[j].x1-sorted[j-1].x2>h*1.5) break;
   const ts=sorted.slice(i,j+1),text=compact(ts.map(t=>t.text).join(''));
   for(const [semantic,aliases] of Object.entries(ALIASES)) if(aliases.includes(text)) hits.push({semantic,tokens:ts,...box(ts)});
  }
  // Prefer longest phrase when an alias is nested in the same spatial phrase.
  const maximal=hits.filter(a=>!hits.some(b=>a!==b&&a.semantic===b.semantic&&b.tokens.length>a.tokens.length&&a.tokens.every(t=>b.tokens.includes(t))));
  if(maximal.some(a=>a.semantic==='name')&&maximal.some(a=>a.semantic==='qty')&&maximal.some(a=>['standard','unit'].includes(a.semantic))) bands.push({bounds:l.bounds,anchors:maximal.concat(l.tokens.filter(t=>!maximal.some(a=>a.tokens.includes(t))).map(t=>({semantic:'auxiliary',tokens:[t],...box([t])})))});
 }
 const hypotheses=bands.map((band,index)=> {
  const standard=band.anchors.some(a=>a.semantic==='standard');
  const outgoing=band.anchors.some(a=>a.semantic==='qty'&&compact(a.tokens.map(t=>t.text).join(''))==='出庫数');
  const unknownAuxiliary=band.anchors.some(a=>a.semantic==='auxiliary');
  const whiteQuantity=band.anchors.some(a=>a.semantic==='qty'&&['数量','個数','qty','quantity'].includes(compact(a.tokens.map(t=>t.text).join(''))));
  const unknownMixed=outgoing&&!standard;
  const anchors=band.anchors.map(a=>({...a,field:a.semantic==='standard'?'retail':a.semantic==='unit'?(standard?'cost':unknownMixed?'unknown-price':'retail'):a.semantic})).sort((a,b)=>a.x1-b.x1);
  const counts={};anchors.filter(a=>a.field!=='auxiliary').forEach(a=>counts[a.field]=(counts[a.field]??0)+1);
  const ambiguous=unknownMixed||Object.values(counts).some(n=>n>1);
  const columns=anchors.map((a,i)=>({field:a.field,left:i?(anchors[i-1].x2+a.x1)/2:0,right:i+1<anchors.length?(a.x2+anchors[i+1].x1)/2:width,anchor:a}));
  return {id:index,schema:unknownMixed?'unknown-mixed':standard?'standard-unit':'unit-only',familyEvidence:{whiteQuantity,unknownAuxiliary,outgoingQuantity:outgoing,standardPrice:standard,unitPrice:band.anchors.some(a=>a.semantic==='unit')},headerRegion:band.bounds,columns,ambiguous,absentCostProven:whiteQuantity&&!unknownAuxiliary&&!outgoing&&!standard&&!counts.cost&&counts.retail===1&&counts.qty===1};
 });
 if(hypotheses.length!==1) diagnostics.push(hypotheses.length?'multiple-header-hypotheses':'no-proven-header-band');
 const hyp=hypotheses[0]; const rows=[];
 if(hyp) {
  if(hyp.ambiguous) diagnostics.push('duplicate-semantic-columns');
  const data=lines.filter(l=>l.bounds.y1>=hyp.headerRegion.y2 && l.tokens.some(t=>numeric(t.text)!==null));
  for(const l of data) {
   const owned={}; let ambiguous=false;
   for(const t of l.tokens) {
    const candidates=hyp.columns.filter(c=>t.x1>=c.left&&t.x2<=c.right);
    if(candidates.length!==1) {ambiguous=true;continue;}
    (owned[candidates[0].field]??=[]).push(t);
   }
   const nameTokens=owned.name??[];
   if(!nameTokens.length||nameTokens.every(t=>numeric(t.text)!==null)||nameTokens.some(t=>/^(合計|総合計|小計|total|subtotal)$/i.test(compact(t.text)))) {diagnostics.push('excluded-line-without-part-name');continue;}
   const row={rowId:`spatial:${l.bounds.x1}:${l.bounds.y1}:${l.bounds.x2}:${l.bounds.y2}`,region:l.bounds};
   for(const key of ['name','qty','retail','cost','amount']) {
    const ts=owned[key]??[];let status=ts.length?'observed':'missing';
    if(diagnostics.includes('invalid-document-dimensions')||ambiguous||hyp.ambiguous||hypotheses.length!==1||key!=='name'&&(ts.length>1||ts.some(t=>numeric(t.text)===null)||(key==='qty'&&ts.some(t=>!/^\d+(?:\.\d+)?$/.test(compact(t.text)))))) status='ambiguous';
    row[key]=field(ts,status,hyp.columns.find(c=>c.field===key)?{x1:hyp.columns.find(c=>c.field===key).left,x2:hyp.columns.find(c=>c.field===key).right,y1:l.bounds.y1,y2:l.bounds.y2}:null);
   }
   row.cost.columnAbsent=hyp.absentCostProven&&!hyp.ambiguous&&hypotheses.length===1;
   rows.push(row);
  }
  // Attach name-only continuation lines only when one adjacent numeric row owns them.
  for(const l of lines.filter(l=>l.bounds.y1>=hyp.headerRegion.y2&&!l.tokens.some(t=>numeric(t.text)!==null))) {
   const col=hyp.columns.find(c=>c.field==='name');if(!col||!l.tokens.every(t=>t.x1>=col.left&&t.x2<=col.right))continue;
   const near=rows.filter(r=>r.qty.region&&Math.max(0,l.bounds.y1-r.qty.region.y2,r.qty.region.y1-l.bounds.y2)<=h*.75);
   if(near.length===1&&near[0].name.status==='observed') {const r=near[0];r.name=field(tokens.filter(t=>r.name.source.includes(t.id)).concat(l.tokens));}
   else if(near.length) {near.forEach(r=>r.name.status='ambiguous');diagnostics.push('ambiguous-name-continuation');}
  }
 }
 return result(rows,hypotheses);
}
