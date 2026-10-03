/** Scoring-only gates. Never import this module into OCR runtime. */
export const FORMAL_COUNTS = {
  YELLOW_FORMAL: Object.fromEntries([6,6,5,5,5,2,2,2,2,8,8,3].map((n,i)=>[`IMG_${String(675+i).padStart(4,'0')}`,n])),
  WHITE_FORMAL: {IMG_0699:3,IMG_0700:3,IMG_0701:3},
};

export function auditFormalScope(gt, manifest) {
  const entries = new Map(manifest.entries.map(e=>[e.image_id,e]));
  const findings=[];
  for(const [subset,counts] of Object.entries(FORMAL_COUNTS)) {
    for(const [imageId,expectedRows] of Object.entries(counts)) {
      const entry=entries.get(imageId),annotation=gt.images[imageId];
      const reasons=[];
      if(!entry) reasons.push('PHOTO_MISSING');
      if(!annotation) reasons.push('ROW_GT_MISSING');
      if(annotation && annotation.rows.length!==expectedRows) reasons.push('ROW_GT_COUNT_CONFLICT');
      const verified=entry?.formalIdentity;
      if(!verified || verified.status!=='VERIFIED' || !verified.evidence || !verified.reviewCopySha256 || verified.sourceSha256!==entry?.sha256) reasons.push('FORMAL_PHOTO_IDENTITY_UNPROVEN');
      if(annotation?.subset!==subset) reasons.push('ANNOTATION_NOT_FORMAL');
      findings.push({imageId,subset,expectedRows,availableAnnotationRows:annotation?.rows.length??null,status:reasons.length?'HOLD':'VERIFIED',reasons});
    }
  }
  return {scoringOnly:true,runtimeUse:false,formalAdoptionAllowed:findings.every(f=>f.status==='VERIFIED'),findings};
}
