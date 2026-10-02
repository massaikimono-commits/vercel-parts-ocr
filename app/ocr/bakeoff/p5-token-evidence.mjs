/** Token acquisition contract: headered TSV, Tesseract headerless TSV, then blocks. No GT. */
const COLUMNS=['level','page_num','block_num','par_num','line_num','word_num','left','top','width','height','conf','text'];
const number=value=>typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
function token(text,x1,y1,x2,y2,confidence){
 if(typeof text!=='string'||!text.trim()||![x1,y1,x2,y2].every(Number.isFinite)||x1<0||y1<0||x2<=x1||y2<=y1)return null;
 const conf=number(confidence);return{text:text.trim(),x1,y1,x2,y2,confidence:Number.isFinite(conf)&&conf>=0&&conf<=100?conf/100:null};
}
export function parsePageTsv(tsv){
 if(typeof tsv!=='string')return [];
 const lines=tsv.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());if(!lines.length)return [];
 const first=lines[0].split('\t'),headered=first[0]==='level';
 const columns=headered?first:COLUMNS;
 if(!headered && (first.length!==12 || !/^\d+$/.test(first[0])))return [];
 if(new Set(columns).size!==columns.length || ['level','left','top','width','height','conf','text'].some(x=>!columns.includes(x)))return [];
 const ix=Object.fromEntries(columns.map((v,i)=>[v,i])),out=[];
 for(const line of headered?lines.slice(1):lines){
  const c=line.split('\t');if(c.length!==columns.length||number(c[ix.level])!==5)continue;
  const left=number(c[ix.left]),top=number(c[ix.top]),width=number(c[ix.width]),height=number(c[ix.height]);
  const t=token(c[ix.text],left,top,left+width,top+height,c[ix.conf]);if(t)out.push(t);
 }
 return out;
}
export function parsePageBlocks(blocks){
 if(!Array.isArray(blocks))return [];
 const out=[];
 for(const b of blocks)for(const p of Array.isArray(b?.paragraphs)?b.paragraphs:[])for(const l of Array.isArray(p?.lines)?p.lines:[])for(const w of Array.isArray(l?.words)?l.words:[]){
  const bb=w?.bbox,t=token(w?.text,number(bb?.x0),number(bb?.y0),number(bb?.x1),number(bb?.y1),w?.confidence);if(t)out.push(t);
 }
 return out;
}
export function extractPageTokens(data){
 const tsvTokens=parsePageTsv(data?.tsv),blockTokens=parsePageBlocks(data?.blocks);
 return{tokens:tsvTokens.length?tsvTokens:blockTokens,tsvTokens,blockTokens,
  tokenSource:tsvTokens.length?'tsv':blockTokens.length?'blocks':'none',
  representation:tsvTokens.length?(String(data.tsv).replace(/^\uFEFF/,'').startsWith('level\t')?'HEADERED_TSV':'HEADERLESS_TSV'):blockTokens.length?'BLOCK_WORDS':'NONE'};
}
