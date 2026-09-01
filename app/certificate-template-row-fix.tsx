/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect } from "react";

type Box = { x:number; y:number; w:number; h:number };
type Era = { era:"令和"|"平成"|"昭和"; year:number; month:number; day?:number };
type Values = Record<string,string>;

const DETAIL_LABELS = [
  "記録年月日","記録事項番号","自動車登録番号又は車両番号","車台番号","登録年月日／交付年月日","初度登録年月",
  "有効期間の満了する日","使用者の氏名又は名称","使用者の住所","使用の本拠の位置","車名","型式","原動機の型式",
  "自動車の種別","用途","自家用・事業用の別","車体の形状","乗車定員","最大積載量 kg","車両重量 kg",
  "車両総重量 kg","長さ cm","幅 cm","高さ cm","前前軸重 kg","前後軸重 kg","後前軸重 kg","後後軸重 kg",
  "総排気量又は定格出力","燃料の種類","型式指定番号","類別区分番号"
];

function norm(s:string){return (s||"").normalize("NFKC").replace(/[‐‑‒–—―ー]/g,"-").replace(/\r/g,"").replace(/[ \t]+/g," ").replace(/\n{2,}/g,"\n").trim();}
function compact(s:string){return norm(s).replace(/[\s:：|｜/\\・,，.。()（）\[\]【】]/g,"");}
function numText(s:string){return norm(s).replace(/[OoQqDd]/g,"0").replace(/[Il|]/g,"1").replace(/[Zz]/g,"2").replace(/[Ss]/g,"5").replace(/[Bb]/g,"8");}
function known(s:string,a:string[]){const t=compact(s);return a.find(x=>t.includes(compact(x)))||"";}
function formatEra(v:Era){const y=v.year===1?"元":String(v.year);return v.day==null?`${v.era}${y}年${v.month}月`:`${v.era}${y}年${v.month}月${v.day}日`;}
function validEra(v:Era){if(v.year<1||v.month<1||v.month>12)return false;if(v.era==="令和"&&v.year>20)return false;if(v.era==="平成"&&v.year>31)return false;if(v.era==="昭和"&&v.year>64)return false;if(v.day==null)return true;if(v.day<1||v.day>31)return false;const b=v.era==="令和"?2018:v.era==="平成"?1988:1925,d=new Date(b+v.year,v.month-1,v.day);return d.getFullYear()===b+v.year&&d.getMonth()===v.month-1&&d.getDate()===v.day;}
function eras(s:string){const t=numText(s).replace(/[年月日．・]/g,".").replace(/[／/]/g,".");const ms=[...t.matchAll(/令和|平成|昭和/g)],out:Era[]=[];for(let i=0;i<ms.length;i++){const seg=t.slice(ms[i].index||0,ms[i+1]?.index??t.length),em=seg.match(/(令和|平成|昭和)/);if(!em)continue;const n=(seg.slice((em.index||0)+em[1].length).match(/\d{1,2}/g)||[]).map(Number);if(n.length<2)continue;const v:Era={era:em[1] as Era["era"],year:n[0],month:n[1],day:n[2]};if(validEra(v))out.push(v);}return out;}
function docNo(s:string){const a=numText(s).match(/\b\d{12}\b/g)||[];return a.find(x=>new Set(x).size>=4)||"";}
function reg(s:string){const m=norm(s).match(/([一-龠ぁ-んァ-ヶ]{1,8})\s*([0-9]\s*[0-9]\s*[0-9])\s*([ぁ-ん])\s*([0-9]\s*[0-9]\s*[0-9]\s*[0-9])/);if(!m)return"";const a=m[2].replace(/\D/g,""),b=m[4].replace(/\D/g,"");return a.length===3&&b.length===4?`${m[1]} ${a} ${m[3]} ${b}`:"";}
function chassis(s:string){const t=numText(s).toUpperCase().replace(/[＿_]/g,"-"),a=t.match(/[A-Z]{2,5}\d{1,5}\s*-\s*[0-9\s]{6,10}/g)||[];const c=a.map(x=>{const [l0,r0]=x.replace(/\s+/g,"").split("-");return `${l0.replace(/^NKRS(?=\d)/,"NKR")}-${r0.replace(/\D/g,"")}`;}).filter(x=>{const [l,r]=x.split("-");return/[A-Z]/.test(l)&&/\d/.test(l)&&r.length>=6&&r.length<=9&&new Set(r).size>=3;});c.sort((a,b)=>(b.startsWith("NKR")?50:0)-(a.startsWith("NKR")?50:0)+(new Set((b.split("-")[1]||"")).size-new Set((a.split("-")[1]||"")).size));return c[0]||"";}
function maker(s:string){return known(s,["いすゞ","トヨタ","日産","ホンダ","マツダ","スズキ","三菱","ダイハツ","スバル","日野","UDトラックス"]);}
function model(s:string){const t=norm(s).toUpperCase().replace(/\s+/g,"").replace(/[＿_]/g,"-").replace(/-NKRS(?=\d)/g,"-NKR");const p="DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG";return (t.match(new RegExp(`(?:${p})-[A-Z0-9]{3,12}`))?.[0]||"").replace(/-NKRS(?=\d)/g,"-NKR");}
function engine(s:string){const t=norm(s).toUpperCase().replace(/[Oo]/g,"0");return (t.match(/\b\d[A-Z]{2}\d\b/g)||[])[0]||(t.match(/\b\d[A-Z]{1,3}[0-9A-Z]{1,3}\b/g)||[]).find(x=>!/^(TKG|QKG|PKG|SKG|DAA|DBA|ABA)$/.test(x))||"";}
function cleanName(s:string){for(let x of norm(s).split("\n").map(x=>x.trim()).filter(Boolean)){const i=x.search(/株式会社|有限会社|合同会社/);if(i>=0)x=x.slice(i);x=x.replace(/^[|｜:：・.\-\s]+|[|｜:：・.\-\s]+$/g,"").replace(/\s{2,}/g," ").trim();const jp=(x.match(/[一-龠々ぁ-んァ-ヶ]/g)||[]).length;if(jp>=5&&/(株式会社|有限会社|合同会社|支店|営業所|本社)/.test(x)&&x.length<=80)return x;}return"";}
function cleanAddress(s:string){for(let x of norm(s).split("\n").map(x=>x.trim()).filter(Boolean)){const p=x.match(/(?:北海道|東京都|大阪府|京都府|[一-龠]{2,3}県)/);if(p?.index!=null)x=x.slice(p.index);x=numText(x).replace(/(?<=\d)\s+(?=\d)/g,"").replace(/\s*[-ー]\s*/g,"-").replace(/\s{2,}/g," ").trim();const jp=(x.match(/[一-龠々ぁ-んァ-ヶ]/g)||[]).length;if(/[都道府県]/.test(x)&&/[市区町村郡]/.test(x)&&jp>=5&&x.length<=110)return x;}return"";}
function base(s:string){const t=norm(s);return /[*＊※]{2,}/.test(t)?"***":/使用者.*住所.*同じ|住所に同じ/.test(t)?"使用者住所に同じ":"";}
function seating(s:string){const t=numText(s),m=t.match(/\b(\d{1,2})\s*人/);if(m)return String(Number(m[1]));const a=(t.match(/\b\d{1,2}\b/g)||[]).map(Number).filter(n=>n>=1&&n<=20);return a.length===1?String(a[0]):"";}
function payload(s:string){const a=(numText(s).replace(/,/g,"").match(/\d{3,5}/g)||[]).map(Number).filter(n=>n>=100&&n<=50000&&n%10===0);return a.length?String(Math.max(...a)):"";}
function nums(s:string){return (numText(s).replace(/,/g,"").match(/\d{2,5}/g)||[]).map(Number);}
function dims(s:string){const a=nums(s);for(let i=0;i+4<a.length;i++){const [vw,gw,l,w,h]=a.slice(i,i+5);if(vw>=500&&vw<=50000&&vw%10===0&&gw>=vw&&gw<=80000&&l>=200&&l<=2000&&w>=100&&w<=350&&h>=100&&h<=500)return[vw,gw,l,w,h].map(String);}return[];}
function axle(s:string){const a=nums(s).filter(n=>n>=200&&n<=30000&&n%10===0);if(a.length>=4)return a.slice(0,4).map(String);if(a.length===2)return[String(a[0]),"","",String(a[1])];return[];}
function output(s:string){return numText(s).match(/\b\d+\.\d+\b/)?.[0]||"";}
function five(s:string){return(numText(s).match(/\b\d{5}\b/)||[""])[0];}
function four(s:string){return(numText(s).match(/\b\d{4}\b/)||[""])[0];}

function section(title:string){return Array.from(document.querySelectorAll("section.card")).find(x=>x.querySelector("h2")?.textContent?.includes(title))||null;}
function input(sectionTitle:string,labelText:string){const s=section(sectionTitle);if(!s)return null;for(const l of Array.from(s.querySelectorAll("label"))){const t=(l.querySelector("span")?.textContent||l.textContent||"").trim();if(compact(t)===compact(labelText))return l.querySelector("input") as HTMLInputElement|null;}return null;}
function detail(label:string){return input("車検証読み取り情報",label);}
function basic(label:string){return input("基本情報",label);}
function setExact(el:HTMLInputElement|null,value:string){if(!el||el.value===value)return;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;if(set)set.call(el,value);else el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}
function apply(v:Values){for(const l of DETAIL_LABELS)setExact(detail(l),v[l]||"");setExact(basic("登録番号"),v["自動車登録番号又は車両番号"]||"");setExact(basic("車台番号"),v["車台番号"]||"");setExact(basic("型式"),v["型式"]||"");setExact(basic("車両重量 kg"),v["車両重量 kg"]||"");setExact(basic("初度登録（和暦）"),v["初度登録年月"]||"");}

function paperBox(c:HTMLCanvasElement):Box{const x=c.getContext("2d",{willReadFrequently:true});if(!x)return{x:0,y:0,w:c.width,h:c.height};const{width:w,height:h}=c,d=x.getImageData(0,0,w,h).data,st=Math.max(4,Math.floor(Math.max(w,h)/700)),ok=(xx:number,yy:number)=>{const p=(yy*w+xx)*4,r=d[p],g=d[p+1],b=d[p+2],br=(r+g+b)/3;return br>118&&Math.max(r,g,b)-Math.min(r,g,b)<110;};const ys:number[]=[];for(let y=0;y<h;y+=st){let hit=0,n=0;for(let xx=0;xx<w;xx+=st){if(ok(xx,y))hit++;n++;}if(hit/Math.max(1,n)>.22)ys.push(y);}if(ys.length<8)return{x:0,y:0,w,h};const top=Math.max(0,ys[0]-st*2),bottom=Math.min(h-1,ys[ys.length-1]+st*2),xs:number[]=[];for(let xx=0;xx<w;xx+=st){let hit=0,n=0;for(let y=top;y<=bottom;y+=st){if(ok(xx,y))hit++;n++;}if(hit/Math.max(1,n)>.22)xs.push(xx);}if(xs.length<8)return{x:0,y:top,w,h:bottom-top+1};const left=Math.max(0,xs[0]-st*2),right=Math.min(w-1,xs[xs.length-1]+st*2);return{x:left,y:top,w:right-left+1,h:bottom-top+1};}
async function sourceCanvas(img:HTMLImageElement){if(!img.complete||!img.naturalWidth)await new Promise<void>((res,rej)=>{img.addEventListener("load",()=>res(),{once:true});img.addEventListener("error",()=>rej(new Error("image load failed")),{once:true});});const sc=Math.min(1,4500/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.naturalWidth*sc));c.height=Math.max(1,Math.round(img.naturalHeight*sc));const x=c.getContext("2d",{willReadFrequently:true})!;x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);return c;}
function crop(src:HTMLCanvasElement,p:Box,x:number,y:number,w:number,h:number,target=2800){const b={x:Math.round(p.x+p.w*x),y:Math.round(p.y+p.h*y),w:Math.round(p.w*w),h:Math.round(p.h*h)},sc=Math.max(1,Math.min(7,target/Math.max(1,b.w))),c=document.createElement("canvas");c.width=Math.max(1,Math.round(b.w*sc));c.height=Math.max(1,Math.round(b.h*sc));const z=c.getContext("2d",{willReadFrequently:true})!;z.fillStyle="#fff";z.fillRect(0,0,c.width,c.height);z.imageSmoothingEnabled=true;z.imageSmoothingQuality="high";z.drawImage(src,b.x,b.y,b.w,b.h,0,0,c.width,c.height);const im=z.getImageData(0,0,c.width,c.height);for(let q=0;q<im.data.length;q+=4){const g=im.data[q]*.22+im.data[q+1]*.70+im.data[q+2]*.08,v=Math.max(0,Math.min(255,Math.round((g-120)*1.85+165)));im.data[q]=im.data[q+1]=im.data[q+2]=v;}z.putImageData(im,0,0);return c;}
async function read(worker:any,c:HTMLCanvasElement,psm:any,wl=""){await worker.setParameters({preserve_interword_spaces:"1",user_defined_dpi:"300",tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:wl});return norm((await worker.recognize(c)).data.text||"");}

export default function CertificateTemplateRowFix(){
  useEffect(()=>{
    if(location.pathname!=="/vehicle-workflow-v2")return;
    let last="",timer:ReturnType<typeof setTimeout>|null=null,worker:any=null,dead=false;
    const run=async(srcKey:string)=>{const img=document.querySelector("img.preview") as HTMLImageElement|null;if(!img?.src||img.src!==srcKey)return;const v:Values={};try{const src=await sourceCanvas(img),p=paperBox(src),t:any=await import("./lib/tesseract-local");worker=await t.createWorker("jpn+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract/core", langPath: "/tesseract/lang" });const one=t.PSM?.SINGLE_LINE??"7",sparse=t.PSM?.SPARSE_TEXT??"11",block=t.PSM?.SINGLE_BLOCK??"6";
      const record=await read(worker,crop(src,p,.64,.100,.34,.070),sparse);
      const registration=await read(worker,crop(src,p,.20,.155,.60,.040),one);
      const ch=await read(worker,crop(src,p,.15,.188,.55,.040),one,"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
      const dates=await read(worker,crop(src,p,.20,.218,.78,.045),sparse);
      const name=await read(worker,crop(src,p,.22,.270,.65,.045),block);
      const address=await read(worker,crop(src,p,.20,.305,.72,.045),block);
      const home=await read(worker,crop(src,p,.12,.338,.45,.045),one);
      const vehicle=await read(worker,crop(src,p,.10,.382,.38,.040),one);
      const modelEngine=await read(worker,crop(src,p,.08,.415,.88,.045),sparse,"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ");
      const cls=await read(worker,crop(src,p,.08,.452,.88,.040),sparse);
      const body=await read(worker,crop(src,p,.08,.482,.90,.042),sparse);
      const dimension=await read(worker,crop(src,p,.10,.515,.88,.040),sparse,"0123456789,.-cmkgCMKG ");
      const ax=await read(worker,crop(src,p,.10,.545,.88,.042),sparse,"0123456789,.-LlkWKWkgKG ");
      const fuel=await read(worker,crop(src,p,.08,.575,.90,.038),sparse);
      const rds=eras(record).filter(x=>x.day!=null);v["記録年月日"]=rds[0]?formatEra(rds[0]):"";v["記録事項番号"]=docNo(record);v["自動車登録番号又は車両番号"]=reg(registration);v["車台番号"]=chassis(ch);
      const ds=eras(dates),full=ds.filter(x=>x.day!=null),month=ds.find(x=>x.day==null);v["登録年月日／交付年月日"]=full[0]?formatEra(full[0]):"";v["初度登録年月"]=month?formatEra(month):"";v["有効期間の満了する日"]=full[1]?formatEra(full[1]):"";
      v["使用者の氏名又は名称"]=cleanName(name);v["使用者の住所"]=cleanAddress(address);v["使用の本拠の位置"]=base(home);v["車名"]=maker(vehicle);v["型式"]=model(modelEngine);v["原動機の型式"]=engine(modelEngine);
      v["自動車の種別"]=known(cls,["普通","小型","軽自動車","大型特殊"]);v["用途"]=known(cls,["貨物","乗用","乗合","特種"]);v["自家用・事業用の別"]=known(cls,["自家用","事業用"]);v["車体の形状"]=known(body,["バン","キャブオーバ","箱型","ステーションワゴン","セダン","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]);v["乗車定員"]=seating(body);v["最大積載量 kg"]=payload(body);
      const d=dims(dimension);if(d.length===5)[v["車両重量 kg"],v["車両総重量 kg"],v["長さ cm"],v["幅 cm"],v["高さ cm"]]=d;const a=axle(ax);if(a.length===4)[v["前前軸重 kg"],v["前後軸重 kg"],v["後前軸重 kg"],v["後後軸重 kg"]]=a;v["総排気量又は定格出力"]=output(ax);v["燃料の種類"]=known(fuel,["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]);v["型式指定番号"]=five(fuel);v["類別区分番号"]=four(fuel);
    }catch(e){console.warn("template row OCR failed",e);}finally{if(worker)await worker.terminate().catch(()=>{});worker=null;}if(!dead&&(document.querySelector("img.preview") as HTMLImageElement|null)?.src===srcKey)apply(v);};
    const check=()=>{const img=document.querySelector("img.preview") as HTMLImageElement|null,dbg=Array.from(document.querySelectorAll("details pre")).map(x=>x.textContent||"").join("\n");if(!img?.src||!dbg.includes("【車検証 全体OCR】")||img.src===last)return;last=img.src;if(timer)clearTimeout(timer);timer=setTimeout(()=>void run(img.src),900);};const it=window.setInterval(check,700);check();return()=>{dead=true;window.clearInterval(it);if(timer)clearTimeout(timer);if(worker)void worker.terminate().catch(()=>{});};
  },[]);
  return null;
}
