import { compactPdfText, clusterPhysicalRows } from './certificate-pdf-row-semantics.mjs';

// Japanese prolonged sound marks are letters in names, not dash punctuation.
const normalizePdfText = v => String(v??'').normalize('NFKC').replace(/[‐‑‒–—―]/g,'-').replace(/[ \t]+/g,' ').trim();

// Ownership comes from labels and token relationships. No document identity or
// expected data participates in extraction or reconciliation.
const DEFINITIONS = [
  ['registrationNumber', '自動車登録番号又は車両番号'], ['registrationNumber', '車両番号'],
  ['chassisNumber', '車台番号'], ['recordDate', '記録年月日'],
  ['registrationDate', '登録年月日/交付年月日'], ['registrationDate', '交付年月日'],
  ['firstRegistration', '初度登録年月'], ['firstRegistration', '初度検査年月'],
  ['inspectionExpiry', '有効期間の満了する日'],
  ['vehicleName', '車名'], ['model', '型式'], ['engineModel', '原動機の型式'],
  ['vehicleClass', '自動車の種別'], ['purpose', '用途'],
  ['privateBusiness', '自家用・事業用の別'], ['bodyShape', '車体の形状'],
  ['seatingCapacity', '乗車定員'], ['maxPayloadKg', '最大積載量'],
  ['vehicleWeightKg', '車両重量'], ['grossVehicleWeightKg', '車両総重量'],
  ['lengthCm', '長さ'], ['widthCm', '幅'], ['heightCm', '高さ'],
  ['frontFrontAxleWeightKg', '前前軸重'], ['frontRearAxleWeightKg', '前後軸重'],
  ['rearFrontAxleWeightKg', '後前軸重'], ['rearRearAxleWeightKg', '後後軸重'],
  ['frontFrontAxleWeightKg', '前軸重'], ['rearRearAxleWeightKg', '後軸重'],
  ['displacementOrRatedOutput', '総排気量又は定格出力'],
  ['fuel', '燃料の種類'], ['modelDesignationNumber', '型式指定番号'], ['classificationNumber', '類別区分番号'],
  ['ownerNameRaw', '所有者の氏名又は名称'], ['ownerAddressRaw', '所有者の住所'],
  ['userNameRaw', '使用者の氏名又は名称'], ['userAddressRaw', '使用者の住所'],
  ['baseLocation', '使用の本拠の位置'],
  ['identityName', '氏名又は名称'], ['identityAddress', '住所'],
];
const dense = v => compactPdfText(v).replace(/\//g, '/');
const section = t => /^(?:[1-4][.．]?|[1-4]\s*[.．])(?:基本情報|所有者.*情報|使用者.*情報|車両詳細情報|備考)$/.test(dense(t));

export function extractPdfTableLines(operatorList, ops, width, height) {
  const lines=[],stack=[];let matrix=[1,0,0,1,0,0],pending=[];
  const point=(x,y)=>({x:(matrix[0]*x+matrix[2]*y+matrix[4])/width,y:1-(matrix[1]*x+matrix[3]*y+matrix[5])/height});
  const add=(p,q)=>{
    if(Math.abs(p.x-q.x)<.0001&&Math.abs(p.y-q.y)>.008) pending.push({axis:'x',at:p.x,start:Math.min(p.y,q.y),end:Math.max(p.y,q.y)});
    if(Math.abs(p.y-q.y)<.0001&&Math.abs(p.x-q.x)>.008) pending.push({axis:'y',at:p.y,start:Math.min(p.x,q.x),end:Math.max(p.x,q.x)});
  };
  for(let i=0;i<operatorList.fnArray.length;i++) {
    const op=operatorList.fnArray[i],args=operatorList.argsArray[i];
    if([ops.stroke,ops.closeStroke,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(op)) {lines.push(...pending);pending=[];}
    if([ops.endPath,ops.fill,ops.eoFill].includes(op)) pending=[];
    if(op===ops.save) stack.push([...matrix]);
    if(op===ops.restore) matrix=stack.pop()||[1,0,0,1,0,0];
    if(op===ops.transform) {
      const [a,b,c,d,e,f]=matrix,[A,B,C,D,E,F]=args;
      matrix=[a*A+c*B,b*A+d*B,a*C+c*D,b*C+d*D,a*E+c*F+e,b*E+d*F+f];
    }
    if(op!==ops.constructPath) continue;
    const [commands,coords]=args;let cursor=0,last=null,first=null;
    for(const command of commands) {
      if(command===ops.moveTo) {last=point(coords[cursor++],coords[cursor++]);first=last;}
      else if(command===ops.lineTo) {const next=point(coords[cursor++],coords[cursor++]);if(last)add(last,next);last=next;}
      else if(command===ops.rectangle) {
        const x=coords[cursor++],y=coords[cursor++],w=coords[cursor++],h=coords[cursor++];
        const ps=[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)];ps.forEach((p,j)=>add(p,ps[(j+1)%4]));
      }else if(command===ops.closePath) {if(last&&first)add(last,first);last=first;}
      else if(command===ops.curveTo) cursor+=6;
      else if(command===ops.curveTo2||command===ops.curveTo3) cursor+=4;
    }
  }
  return lines;
}

function tableCell(lines,x,y) {
  const vertical=lines.filter(l=>l.axis==='x'&&l.start<=y+.0005&&l.end>=y-.0005);
  const horizontal=lines.filter(l=>l.axis==='y'&&l.start<=x+.0005&&l.end>=x-.0005);
  const left=Math.max(-1,...vertical.filter(l=>l.at<x).map(l=>l.at)),right=Math.min(2,...vertical.filter(l=>l.at>x).map(l=>l.at));
  const top=Math.max(-1,...horizontal.filter(l=>l.at<y).map(l=>l.at)),bottom=Math.min(2,...horizontal.filter(l=>l.at>y).map(l=>l.at));
  return left>=0&&right<=1&&top>=0&&bottom<=1?{left,right,top,bottom}:null;
}

function ruledCellTokens(tokens,anchors,a,lines) {
  const cx=(a.x+a.right)/2,cy=a.y-a.h/2,cell=tableCell(lines,cx,cy);
  if(!cell||cell.right-cell.left<a.right-a.x-.002) return null;
  const isLabel=t=>anchors.some(b=>b.row.tokens.slice(b.start,b.end+1).includes(t));
  const contents=c=>c?tokens.filter(t=>!isLabel(t)&&!section(t.text)&&t.x+(t.w||0)/2>c.left+.0001&&t.x+(t.w||0)/2<c.right-.0001&&t.y-(t.h||0)/2>c.top+.0001&&t.y-(t.h||0)/2<c.bottom-.0001).sort((p,q)=>p.y-q.y||p.x-q.x):[];
  const own=contents(cell);
  if(parseValue(a.field,own)) return own;
  const identity=a.field.endsWith('Raw')||a.field.startsWith('identity')||a.field==='baseLocation';
  const candidates=identity?[tableCell(lines,cell.right+.001,cy)]:[tableCell(lines,cell.right+.001,cy),tableCell(lines,cx,cell.bottom+.001)];
  for(const c of candidates) {
    const values=contents(c);
    if(parseValue(a.field,values)) return values;
    if(identity) return values;
  }
  return own;
}

function anchorsForRows(rows) {
  const anchors = [];
  for (const row of rows) {
    const found = [];
    for (let start=0; start<row.tokens.length; start++) {
      let text='';
      for(let end=start; end<Math.min(row.tokens.length,start+20); end++) {
        text+=dense(row.tokens[end].text);
        const def=DEFINITIONS.find(([,label])=>text===dense(label));
        if(def) {
          const first=row.tokens[start], last=row.tokens[end];
          found.push({field:def[0],label:def[1],row,start,end,x:first.x,right:last.x+(last.w||0),y:first.y,h:first.h||.01});
        }
        if(text.length>32) break;
      }
    }
    // A generic suffix (住所 or 型式) inside a longer recognized label is not a
    // second cell. Match longest labels first, then retain disjoint spans.
    for(const a of found.sort((a,b)=>(b.end-b.start)-(a.end-a.start))) {
      if(!anchors.some(b=>b.row===row&&a.start<=b.end&&a.end>=b.start)) anchors.push(a);
    }
  }
  return anchors.sort((a,b)=>a.y-b.y||a.x-b.x);
}

function roleMarkers(tokens) {
  const markers=tokens.filter(t=>['使用者','所有者'].includes(dense(t.text))).map(t=>({...t,role:dense(t.text)}));
  const chars=tokens.filter(t=>/^[使用者所有]$/.test(dense(t.text)));
  for(const start of chars.filter(t=>/^[使所]$/.test(dense(t.text)))) {
    const wanted=dense(start.text)==='使'?'使用者':'所有者';
    const column=chars.filter(t=>Math.abs(t.x-start.x)<=Math.max(start.h||0,.008)&&t.y>=start.y).sort((a,b)=>a.y-b.y);
    if(column.slice(0,3).map(t=>dense(t.text)).join('')===wanted) markers.push({...start,role:wanted,bottom:column[2].y});
  }
  return markers;
}

function cellTokens(tokens, anchors, a) {
  const peers=anchors.filter(b=>b.row===a.row).sort((p,q)=>p.x-q.x);
  const index=peers.indexOf(a), prev=peers[index-1], next=peers[index+1];
  const isLabel=t=>anchors.some(b=>b.row.tokens.slice(b.start,b.end+1).includes(t));
  const same=a.row.tokens.filter(t=>!isLabel(t)&&t.x>=a.right-.001&&(!next||t.x<next.x)&&!section(t.text));
  // Label/value share a row on portrait certificates. Landscape table headers
  // are centered above the value cells, and need center-derived boundaries.
  const inline=same.some(t=>! /^(?:kg|cm|人|L|kW)$/i.test(normalizePdfText(t.text)));
  const left=inline?a.x:prev?prev.right:0;
  const right=next?.x??1;
  const nextHeader=anchors.filter(b=>b.y>a.y+Math.max(.01,a.h*.85)&&b.x<right&&b.right>left).sort((p,q)=>p.y-q.y)[0];
  const stop=tokens.filter(t=>section(t.text)&&t.y>a.y+.001).sort((p,q)=>p.y-q.y)[0];
  const bottom=Math.min(nextHeader?.y??1,stop?.y??1,a.y+Math.max(.075,a.h*5));
  return tokens.filter(t=>!isLabel(t)&&!section(t.text)&&t.y>=a.y-.002&&t.y<bottom-.001&&
    (inline?t.x>=a.right-.001&&t.x<right:(t.x+(t.w||0)/2)>=left&&(t.x+(t.w||0)/2)<right))
    .sort((p,q)=>p.y-q.y||p.x-q.x);
}

function textInRows(tokens) {
  return clusterPhysicalRows(tokens,.004).map(row=>row.tokens.map(t=>normalizePdfText(t.text)).join(' ')).join(' ');
}
function cleanIdentity(tokens) {
  return textInRows(tokens).replace(/\s*\[[\d\s]*\]?\s*$/,'').replace(/\s*\]\s*$/,'').trim();
}
function primaryNumber(tokens) {
  // Bracketed alternatives can appear ABOVE the primary. Follow brackets in
  // reading order, then select the unbracketed number, preserving alternatives.
  const text=textInRows(tokens).replace(/,/g,'');
  const outside=text.replace(/\[[^\]]*\]/g,'');
  const m=outside.match(/(?:^|\s)(-|\d+(?:\.\d+)?)(?=\s|kg|cm|人|$)/i);
  if(!m) return '';
  const primary=tokens.find(t=>normalizePdfText(t.text).replace(/,/g,'').match(new RegExp(`^${m[1]}(?:kg|cm|人|\\[|\\s|$)`)));
  const bracket=tokens.find(t=>/\[/.test(normalizePdfText(t.text)));
  const aligned=primary&&bracket&&Math.abs(primary.x+(primary.w||0)/2-bracket.x-(bracket.w||0)/2)<=Math.max(primary.w||0,bracket.w||0);
  const alternative=aligned?text.match(/\[\s*(\d+)\s*\]/)?.[1]:null;
  return alternative&&m[1]!=='-'?`${Number(m[1])} [${Number(alternative)}]`:m[1]==='-'?'-':String(Number(m[1]));
}
function dateValue(tokens,monthOnly=false) {
  const text=normalizePdfText(textInRows(tokens)).replace(/\s/g,'');
  const m=text.match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(?:([0-9]{1,2})日)?/);
  if(!m||(!monthOnly&&!m[4])) return '';
  return `${m[1]}${m[2]==='元'?'元':Number(m[2])}年${Number(m[3])}月${monthOnly?'':`${Number(m[4])}日`}`;
}
function outputValue(tokens) {
  const pairs=[];
  for(const t of tokens) {
    const text=normalizePdfText(t.text),m=text.match(/^(\d+(?:\.\d+)?)\s*(L|ℓ|kW)$/i);
    if(m) return `${m[1]} ${/^kw$/i.test(m[2])?'kW':'L'}`;
    if(!/^\d+(?:\.\d+)?$/.test(text)) continue;
    for(const u of tokens.filter(u=>/^(L|ℓ|kW)$/i.test(normalizePdfText(u.text)))) {
      const dx=u.x-(t.x+(t.w||0)),dy=Math.abs(u.y-t.y);
      if(dx>=-.005&&dx<=Math.max(t.w||0,.04)*3&&dy<=Math.max(t.h||0,u.h||0)*1.8) pairs.push({t,u,dy,dx});
    }
  }
  const p=pairs.sort((a,b)=>a.dy-b.dy||Math.abs(a.dx)-Math.abs(b.dx))[0];
  return p?`${normalizePdfText(p.t.text)} ${/^kw$/i.test(normalizePdfText(p.u.text))?'kW':'L'}`:'';
}
function parseValue(field,tokens) {
  const text=textInRows(tokens),compact=normalizePdfText(text).replace(/\s/g,'');
  if(field==='registrationNumber') {
    const m=compact.match(/^([一-龠ぁ-んァ-ヶ]{1,8})([0-9A-Z]{3})([ぁ-ん])([0-9・-]{1,4})$/);
    return m?`${m[1]} ${m[2]} ${m[3]} ${m[4].replace(/^[・-]+/,'')}`:'';
  }
  if(field==='chassisNumber'||field==='model'||field==='engineModel') return /^[A-Z0-9]{2,12}(?:-[A-Z0-9]{1,14})?$/i.test(compact)?compact.toUpperCase():'';
  if(['recordDate','registrationDate','inspectionExpiry','firstRegistration'].includes(field)) return dateValue(tokens,field==='firstRegistration');
  if(field==='baseLocation') {
    const value=cleanIdentity(tokens);
    return /^(?:\[|令和|平成|昭和|車検期間|走行距離)/.test(value)?'':value;
  }
  if(field.endsWith('Raw')||field.startsWith('identity')) return cleanIdentity(tokens);
  if(field==='displacementOrRatedOutput') return outputValue(tokens);
  if(field==='modelDesignationNumber') return /^\d{4,6}$/.test(compact)?compact:'';
  if(field==='classificationNumber') return /^\d{4}$/.test(compact)?compact:'';
  if(field==='fuel') return ['軽油','ガソリン','揮発油','電気','LPG','CNG','水素'].find(v=>compact===v)||'';
  const enums={vehicleClass:['普通','小型','軽自動車','大型特殊'],purpose:['貨物','乗用','乗合','特種'],privateBusiness:['自家用','事業用']};
  if(enums[field]) return enums[field].includes(compact)?compact:'';
  if(['vehicleName','bodyShape'].includes(field)) return compact.replace(/\[\d+\]$/,'');
  return primaryNumber(tokens);
}

export function normalizePdfIdentity(patch) {
  const out={...patch};
  for(const key of ['userName','userAddress','ownerName','ownerAddress']) {
    const raw=normalizePdfText(out[key+'Raw']??out[key]??'');
    if(!raw) continue;
    out[key+'Raw']=raw;
    const compact=raw.replace(/\s/g,'');
    if(/^\*+$/.test(compact)) {out[key]='';out[key+'Status']='MASKED';continue;}
    const same=key==='ownerName'?compact==='使用者に同じ':key==='ownerAddress'?/^(使用者(?:の)?住所に同じ|使用者に同じ)$/.test(compact):false;
    if(same) {
      const userKey=key==='ownerName'?'userName':'userAddress',value=out[userKey]||'';
      out[key]=value;out[key+'Status']=value?'SAME_AS_USER':'UNRESOLVED_SAME_AS_USER';
    }else{out[key]=raw;out[key+'Status']='VALUE';}
  }
  return out;
}

export function parseCertificatePdfSemanticFields(tokens,tableLines=[]) {
  const rows=clusterPhysicalRows(tokens),anchors=anchorsForRows(rows),roles=roleMarkers(tokens),patch={},evidence={};
  const issuance=tokens.find(t=>dense(t.text).includes('自動車検査証発行時における所有者情報'));
  for(const a of anchors) {
    let field=a.field;
    if(field.startsWith('identity')) {
      const role=roles.filter(r=>r.x<a.x&&a.y>=r.y-.02&&a.y<=(r.bottom??r.y)+Math.max(.075,a.h*5)).sort((p,q)=>Math.abs(a.y-p.y)-Math.abs(a.y-q.y))[0];
      if(!role) continue;
      field=(role.role==='所有者'?'owner':'user')+(field==='identityName'?'NameRaw':'AddressRaw');
    }
    let ts=ruledCellTokens(tokens,anchors,a,tableLines)??cellTokens(tokens,anchors,a);
    if(issuance&&a.y>issuance.y&&field.startsWith('owner')) {
      field=field.replace(/^owner/,'ownerAtIssuance');
      // The notes region is one large ruled cell. Its inline owner labels,
      // rather than that outer cell, delimit each issuance value.
      ts=cellTokens(tokens,anchors,a).filter(t=>t.y>=a.y-.002);
      // Issuance notes end at a rule, blank marker or other inspection item.
      const stop=tokens.filter(t=>t.y>a.y&&(/^-{3,}$/.test(normalizePdfText(t.text).replace(/\s/g,''))||/^\[|^その他検査事項|^以下余白/.test(normalizePdfText(t.text)))).sort((p,q)=>p.y-q.y)[0];
      if(stop) ts.splice(0,ts.length,...ts.filter(t=>t.y<stop.y-.001));
    }
    const value=parseValue(a.field.startsWith('identity')?field:a.field,ts);
    if((value||field==='baseLocation')&&!Object.hasOwn(patch,field)) {patch[field]=value;evidence[field]={label:a.label,x:a.x,y:a.y,tokenCount:ts.length};}
  }
  const out=normalizePdfIdentity(patch);
  const title=tokens.find(t=>dense(t.text)==='自動車検査証記録事項');
  if(title) {
    const number=tokens.find(t=>t.x>title.x+title.w&&Math.abs(t.y-title.y)<Math.max(t.h,title.h)*.5&&/^\d{11,14}$/.test(dense(t.text)));
    if(number) out.documentNumber=dense(number.text);
  }
  // Creation/printing dates are not the formal 記録年月日. Clear an earlier
  // writer's date only on a recognized certificate table without that label.
  if(anchors.length>=12&&!anchors.some(a=>a.field==='recordDate')) out.recordDate='';
  for(const key of ['ownerName','ownerAddress']) {
    const at=key.replace(/^owner/,'ownerAtIssuance')+'Raw';
    if(!Object.hasOwn(out,key+'Raw')&&out[at]) {out[key]=out[at];out[key+'Raw']=out[at];out[key+'Status']='VALUE';}
  }
  if(/^\*+$/.test(String(out.baseLocation||'').replace(/\s/g,''))) {out.baseLocationRaw=out.baseLocation;out.baseLocation='';}
  if(out.displacementOrRatedOutput) {
    const [value,unit]=out.displacementOrRatedOutput.split(' ');
    Object.assign(out,{displacementOrRatedOutputValue:value,displacementOrRatedOutputUnit:unit,displacementOrRatedOutputRaw:out.displacementOrRatedOutput});
  }
  const identityFields=['ownerName','ownerAddress','userName','userAddress'].filter(k=>Object.hasOwn(out,k+'Raw'));
  if(identityFields.length) out.ownerUserSemantics=JSON.stringify({
    ownerNameStatus:out.ownerNameStatus||'NOT_PRESENT',ownerAddressStatus:out.ownerAddressStatus||'NOT_PRESENT',
    userNameStatus:out.userNameStatus||'NOT_PRESENT',userAddressStatus:out.userAddressStatus||'NOT_PRESENT',
    automaticOwnerToUserResolution:false,
  });
  for(const [key,stem] of [['maxPayloadKg','maxPayload'],['vehicleWeightKg','vehicleWeight'],['grossVehicleWeightKg','grossVehicleWeight']]) {
    if(!Object.hasOwn(out,key)) continue;
    out[stem+'Raw']=out[key];out[stem+'PrimaryKg']=out[key].match(/^\d+/)?.[0]||'';out[stem+'AlternateKg']=out[key].match(/\[(\d+)\]/)?.[1]||'';
  }
  if(out.seatingCapacity?.includes('[')) {out.seatingCapacityRaw=out.seatingCapacity;out.seatingCapacity=out.seatingCapacity.match(/^\d+/)[0];}
  out.__pdfGeneralizationEvidence={fields:Object.keys(evidence),validatedFields:Object.keys(out),identityFields,clearedFields:Object.keys(out).filter(k=>out[k]===''),source:'label-cell-token-relationships'};
  return out;
}

export function reconcilePdfSemanticPatch(current,recovered) {
  return {...current,...recovered};
}

// Fallback writers may still add fields with no ruled-cell evidence. They must
// compare and dispatch their FINAL candidate, preserving fields already proven
// by this document's labels/cells. This also prevents recursive event churn.
export function preservePdfSemanticFields(current,proposed) {
  const merged={...proposed};
  for(const key of current.__pdfGeneralizationEvidence?.validatedFields||[]) {
    if(Object.hasOwn(current,key)) merged[key]=current[key];
  }
  return merged;
}
