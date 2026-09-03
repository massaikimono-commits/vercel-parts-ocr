/* eslint-disable @typescript-eslint/no-explicit-any */

export type BulkVehiclePdfResult = {
  fileName:string;
  pageNumber:number;
  pageCount:number;
  rawText:string;
  parsedFields:Record<string,any>;
  parseConfidence:Record<string,number>;
  quality:"ready"|"review"|"image_pdf";
  reason:string;
};

type Token = { text:string; x:number; y:number; w:number; h:number };
type Line = { y:number; tokens:Token[]; text:string };

const MAKERS=["トヨタ","レクサス","日産","ホンダ","三菱","マツダ","スバル","スズキ","ダイハツ","いすゞ","日野","UDトラックス","メルセデス・ベンツ","フォルクスワーゲン","アウディ","BMW","ボルボ"];
const FUELS=["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"];

const LABELS={
  registration:["自動車登録番号又は車両番号","自動車登録番号","車両番号"],
  chassis:["車台番号"],
  firstRegistration:["初度登録年月","初度登録"],
  maker:["車名"],
  weight:["車両重量"],
  model:["型式"],
  fuel:["燃料の種類","燃料"],
  certificateNo:["記録事項番号","自動車検査証記録事項番号"],
  userName:["使用者の氏名又は名称","使用者氏名","使用者"],
};

function norm(value:string){
  return String(value||"").normalize("NFKC").replace(/[‐‑‒–—―ー]/g,"-").replace(/\r/g,"").replace(/[ \t]+/g," ").trim();
}
function compact(value:string){ return norm(value).replace(/[\s:：・,，.。()（）\[\]［］]/g,""); }
function digits(value:string){ return norm(value).replace(/\D/g,""); }
function pick(text:string,values:string[]){ const t=compact(text); return values.find(v=>t.includes(compact(v)))||""; }

function registration(text:string){
  const m=norm(text).match(/([ぁ-んァ-ヶ一-龠]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);
  return m ? `${m[1]} ${digits(m[2])} ${m[3]} ${digits(m[4])}` : "";
}
function chassis(text:string){
  const t=norm(text).toUpperCase().replace(/\s+/g,"");
  const a=t.match(/[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9O]{4,12}/g)||[];
  return a.map(x=>{const [l,r]=x.split("-");return `${l}-${r.replace(/O/g,"0")}`;}).sort((a,b)=>b.length-a.length)[0]||"";
}
function model(text:string){
  const t=norm(text).toUpperCase().replace(/\s+/g,"");
  const a=t.match(/(?:[0-9][A-Z]{1,3}|[A-Z]{1,4})-[A-Z0-9]{3,14}/g)||[];
  return a.filter(x=>!/^[A-Z]{1,5}[A-Z0-9]{2,8}-[0-9]{4,12}$/.test(x)).sort((a,b)=>b.length-a.length)[0]||"";
}
function integer(text:string,min:number,max:number){
  const a=norm(text).replace(/[Oo]/g,"0").replace(/[Il|]/g,"1").replace(/,/g,"").match(/\d{1,6}/g)||[];
  for(const x of a){const n=Number(x);if(n>=min&&n<=max)return String(n);}
  return "";
}
function jpMonth(text:string){
  const t=norm(text);
  const m=t.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?\s*(\d{1,2})\s*月?/);
  if(m){const mo=Number(m[3]);if(mo>=1&&mo<=12)return `${m[1]}${m[2]==="元"?"元":Number(m[2])}年${mo}月`;}
  const w=t.match(/(20\d{2}|19\d{2})\s*[年/.\-]\s*(\d{1,2})/);
  if(w){
    const y=Number(w[1]),mo=Number(w[2]);
    if(mo<1||mo>12)return "";
    if(y>=2019){const n=y-2018;return `令和${n===1?"元":n}年${mo}月`;}
    if(y>=1989){const n=y-1988;return `平成${n===1?"元":n}年${mo}月`;}
  }
  return "";
}
function certificateNo(text:string){
  const d=digits(text);
  return d.match(/\d{10,14}/)?.[0]||"";
}
function freeText(text:string){
  const t=norm(text).replace(/^[:：|/\\\-\s]+|[:：|/\\\-\s]+$/g,"").replace(/\s+/g," ").trim();
  if(!t || t.length>90) return "";
  return /[一-龠ぁ-んァ-ヶA-Za-z0-9＊*]/.test(t) ? t : "";
}

function tokenFromItem(item:any,pageWidth:number,pageHeight:number):Token|null{
  const text=norm(item?.str||"");
  if(!text)return null;
  const tr=item?.transform||[1,0,0,1,0,0];
  const x=Number(tr[4]||0)/Math.max(1,pageWidth);
  const baseline=Number(tr[5]||0)/Math.max(1,pageHeight);
  const h=Math.max(Math.abs(Number(tr[3]||0)),Number(item?.height||0),1)/Math.max(1,pageHeight);
  const w=Math.max(Number(item?.width||0),1)/Math.max(1,pageWidth);
  return {text,x,y:1-baseline,w,h};
}

function buildLines(tokens:Token[]):Line[]{
  const out:Array<{y:number;tokens:Token[];text?:string}>=[];
  for(const token of [...tokens].sort((a,b)=>a.y-b.y||a.x-b.x)){
    let line=out.find(v=>Math.abs(v.y-token.y)<=Math.max(0.0045,token.h*0.72));
    if(!line){line={y:token.y,tokens:[]};out.push(line);}
    line.tokens.push(token);
    line.y=line.tokens.reduce((s,v)=>s+v.y,0)/line.tokens.length;
  }
  for(const line of out){
    line.tokens.sort((a,b)=>a.x-b.x);
    line.text=line.tokens.map(v=>v.text).join(" ");
  }
  return out.sort((a,b)=>a.y-b.y).map(v=>({y:v.y,tokens:v.tokens,text:v.text||""}));
}

function findAnchor(lines:Line[],labels:string[]){
  for(const label of labels){
    const wanted=compact(label);
    for(const line of lines){
      for(let s=0;s<line.tokens.length;s++){
        let joined="";
        for(let e=s;e<Math.min(line.tokens.length,s+16);e++){
          joined+=compact(line.tokens[e].text);
          if(joined.includes(wanted)){
            const slice=line.tokens.slice(s,e+1);
            const x=Math.min(...slice.map(v=>v.x));
            const right=Math.max(...slice.map(v=>v.x+v.w));
            return {x,right,y:line.y,h:Math.max(...slice.map(v=>v.h)),line};
          }
          if(joined.length>wanted.length+30)break;
        }
      }
    }
  }
  return null;
}

function rightOf(lines:Line[],labels:string[],parser:(s:string)=>string,span=0.78){
  const a=findAnchor(lines,labels);
  if(!a)return "";
  const same=a.line.tokens.filter(v=>v.x>=a.right-0.002&&v.x<=Math.min(1,a.right+span)).map(v=>v.text).join(" ");
  const parsed=parser(same);
  if(parsed)return parsed;
  const below=lines.filter(line=>line.y>a.y+0.002&&line.y-a.y<=0.07);
  for(const line of below){
    const text=line.tokens.filter(v=>v.x>=Math.max(0,a.x-0.02)&&v.x<=Math.min(1,a.right+span)).map(v=>v.text).join(" ");
    const value=parser(text);
    if(value)return value;
  }
  return "";
}

function parseTokens(tokens:Token[]){
  const lines=buildLines(tokens);
  const allText=lines.map(v=>v.text).join("\n");

  const registrationNumber=rightOf(lines,LABELS.registration,registration)||registration(allText);
  const chassisNumber=rightOf(lines,LABELS.chassis,chassis)||chassis(allText);
  const modelCode=rightOf(lines,LABELS.model,model)||model(allText);
  const maker=rightOf(lines,LABELS.maker,s=>pick(s,MAKERS),0.34)||pick(allText,MAKERS);
  const vehicleWeight=rightOf(lines,LABELS.weight,s=>integer(s,100,99999),0.26);
  const firstRegistration=rightOf(lines,LABELS.firstRegistration,jpMonth,0.34)||jpMonth(allText);
  const fuel=rightOf(lines,LABELS.fuel,s=>pick(s,FUELS),0.32)||pick(allText,FUELS);
  const inspectionCertificateNumber=rightOf(lines,LABELS.certificateNo,certificateNo,0.42);
  const userName=rightOf(lines,LABELS.userName,freeText,0.62);

  const registrationLast4=registrationNumber.match(/(\d{4})(?!.*\d)/)?.[1]||"";
  const core=[registrationNumber,chassisNumber,modelCode,maker,vehicleWeight,firstRegistration,fuel];
  const found=core.filter(Boolean).length;
  const essential=[registrationNumber,chassisNumber,modelCode].filter(Boolean).length;
  const score=Math.min(1,(essential*0.2)+(found/7)*0.4+(tokens.length>=80?0.2:tokens.length>=30?0.1:0));

  const parsedFields:Record<string,any>={
    registration_number:registrationNumber,
    registration_last4:registrationLast4,
    chassis_number:chassisNumber,
    model:modelCode,
    model_code:modelCode,
    maker,
    vehicle_weight:vehicleWeight,
    first_registration:firstRegistration,
    fuel_type:fuel,
    inspection_certificate_number:inspectionCertificateNumber,
    user_name:userName,
    certificate_fields:{
      registrationNumber,
      chassisNumber,
      model:modelCode,
      vehicleName:maker,
      vehicleWeightKg:vehicleWeight,
      firstRegistration,
      fuel,
      inspectionCertificateNumber,
      userName,
    },
  };
  for(const key of Object.keys(parsedFields)){
    if(parsedFields[key]===""||parsedFields[key]==null) delete parsedFields[key];
  }

  const confidence:Record<string,number>={};
  for(const key of ["registration_number","chassis_number","model_code","maker","vehicle_weight","first_registration","fuel_type"]){
    if(parsedFields[key]) confidence[key]=key==="registration_number"||key==="chassis_number"||key==="model_code"?0.96:0.9;
  }

  return {parsedFields,parseConfidence:confidence,allText,score,found,essential};
}

async function loadPdfJs(){
  const pdfjs:any=await import("pdfjs-dist/legacy/build/pdf.mjs");
  if(!pdfjs.GlobalWorkerOptions.workerSrc){
    pdfjs.GlobalWorkerOptions.workerSrc=`https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

async function pageTokens(page:any){
  const viewport=page.getViewport({scale:1});
  const content=await page.getTextContent();
  return (content.items||[]).map((item:any)=>tokenFromItem(item,viewport.width,viewport.height)).filter(Boolean) as Token[];
}

function pageScore(tokens:Token[]){
  const text=compact(tokens.map(v=>v.text).join(" "));
  let score=0;
  if(text.includes("車両情報"))score+=4;
  if(text.includes("自動車登録番号")||text.includes("車両番号"))score+=4;
  if(text.includes("車台番号"))score+=4;
  if(text.includes("型式"))score+=2;
  if(text.includes("車両重量"))score+=2;
  if(text.includes("初度登録"))score+=2;
  score+=Math.min(4,tokens.length/80);
  return score;
}

export async function parseVehicleCertificatePdf(file:File):Promise<BulkVehiclePdfResult>{
  const pdfjs=await loadPdfJs();
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{
    let best:{pageNumber:number;tokens:Token[];score:number}={pageNumber:1,tokens:[],score:-1};
    const max=Math.min(pdf.numPages||1,8);
    for(let n=1;n<=max;n++){
      const page=await pdf.getPage(n);
      const tokens=await pageTokens(page).catch(()=>[] as Token[]);
      const score=pageScore(tokens);
      if(score>best.score)best={pageNumber:n,tokens,score};
    }

    if(best.tokens.length<10){
      return {
        fileName:file.name,pageNumber:best.pageNumber,pageCount:pdf.numPages||1,
        rawText:"",parsedFields:{},parseConfidence:{},quality:"image_pdf",
        reason:"PDFの文字レイヤーがほぼ無いため、まとめ登録では自動確定しません。個別の高精度読取で確認してください。",
      };
    }

    const parsed=parseTokens(best.tokens);
    const ready=Boolean(
      parsed.parsedFields.registration_number &&
      parsed.parsedFields.chassis_number &&
      parsed.parsedFields.model_code &&
      parsed.score>=0.72
    );
    const review=parsed.essential>=2 && parsed.score>=0.48;
    return {
      fileName:file.name,
      pageNumber:best.pageNumber,
      pageCount:pdf.numPages||1,
      rawText:parsed.allText,
      parsedFields:parsed.parsedFields,
      parseConfidence:parsed.parseConfidence,
      quality:ready?"ready":review?"review":"image_pdf",
      reason:ready
        ? `登録番号・車台番号・型式を含む主要${parsed.found}項目をPDF文字レイヤーから取得しました。`
        : review
          ? "主要項目は取得できましたが、自動確定には不足があります。内容を確認してください。"
          : "文字は取得できましたが主要項目が不足しています。個別の高精度読取を推奨します。",
    };
  }finally{
    await pdf.destroy?.().catch?.(()=>{});
  }
}
