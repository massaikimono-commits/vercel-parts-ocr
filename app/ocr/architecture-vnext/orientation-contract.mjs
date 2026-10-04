/** Document-internal orientation measurement, frozen before real-image evaluation. */
const median=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:0;
export function inverseCardinalBox(box,angle,width,height) {
  const corners=[[box.x1,box.y1],[box.x2,box.y1],[box.x2,box.y2],[box.x1,box.y2]].map(([x,y])=> {
    if(angle===0)return[x,y];
    if(angle===90)return[y,height-x];
    if(angle===180)return[width-x,height-y];
    if(angle===270)return[width-y,x];
    throw Error('Cardinal angle required');
  });
  return {x1:Math.min(...corners.map(p=>p[0])),y1:Math.min(...corners.map(p=>p[1])),x2:Math.max(...corners.map(p=>p[0])),y2:Math.max(...corners.map(p=>p[1]))};
}
export function orientationEvidence(tokens,width,height) {
  const valid=tokens.filter(t=>[t.x1,t.y1,t.x2,t.y2].every(Number.isFinite)&&t.x1>=0&&t.y1>=0&&t.x2<=width&&t.y2<=height&&t.x2>t.x1&&t.y2>t.y1);
  const known=valid.filter(t=>Number.isFinite(t.confidence)&&t.confidence>=0&&t.confidence<=1);
  const h=median(valid.map(t=>t.y2-t.y1));
  let coherent=0;
  for(const t of valid)if(valid.some(other=>other!==t&&Math.abs((other.y1+other.y2-t.y1-t.y2)/2)<=h/2))coherent++;
  const confidenceMass=known.reduce((sum,t)=>sum+t.confidence,0);
  const coveredArea=valid.reduce((sum,t)=>sum+(t.x2-t.x1)*(t.y2-t.y1),0);
  // Word count is OCR observation count, never expected part-row count. Diminishing returns.
  const score=known.length?confidenceMass/Math.sqrt(known.length)*(valid.length?coherent/valid.length:0):0;
  return {score,validTokenCount:valid.length,confidenceKnownCount:known.length,confidenceMass,lineCoherence:valid.length?coherent/valid.length:0,boxAreaCoverage:coveredArea/(width*height),medianTokenHeight:h};
}
export function selectCardinalHypotheses(observations) {
  const ranked=observations.map(o=>({...o,evidence:orientationEvidence(o.tokens,o.width,o.height)})).sort((a,b)=>b.evidence.score-a.evidence.score||a.angle-b.angle);
  if(!ranked.length||ranked[0].evidence.score<=0)return{selected:[],ambiguous:true,reason:'NO_SUPPORTED_ORIENTATION',ranked};
  const top=ranked[0],second=ranked[1];
  // Retain exactly two candidates for an unresolved tie; never interpolate angles or tune scores.
  const ambiguous=!!second&&second.evidence.score>=top.evidence.score*.9;
  return {selected:ambiguous?[top,second]:[top],ambiguous,reason:ambiguous?'ORIENTATION_EVIDENCE_TIE':null,ranked};
}
