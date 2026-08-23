"use client";

import { useEffect } from "react";

const norm = (v = "") => String(v).normalize("NFKC").replace(/[‐‑‒–—―ー]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const compact = (v = "") => norm(v).replace(/\s+/g, "");

function section(title) {
  return Array.from(document.querySelectorAll("section.card")).find((s) => s.querySelector("h2")?.textContent?.includes(title)) || null;
}
function input(title, label) {
  const s = section(title); if (!s) return null;
  for (const l of Array.from(s.querySelectorAll("label"))) {
    const t = (l.querySelector("span")?.textContent || l.childNodes[0]?.textContent || "").trim();
    if (compact(t) === compact(label)) return l.querySelector("input");
  }
  return null;
}
function setInput(el, value) {
  if (!el || !value || el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function pageDebug() {
  return Array.from(document.querySelectorAll("details pre")).map((x) => x.textContent || "").filter(Boolean).join("\n");
}
function logValue(debug, label) {
  const m = debug.match(new RegExp(`【${label.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}】\\s*([^\\n]*)`));
  return (m?.[1] || "").trim();
}
function numish(s = "") {
  return norm(s).replace(/[OoQqDd]/g, "0").replace(/[Il|!]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss§]/g, "5").replace(/[Bb]/g, "8");
}
function digits(s = "") { return numish(s).replace(/\D/g, ""); }
function modelStem(model = "") {
  const t = norm(model).toUpperCase().replace(/\s+/g, "");
  const core = t.includes("-") ? t.split("-").pop() || "" : t;
  return core.match(/^([A-Z]{2,5}\d{1,4})/)?.[1] || "";
}
function regionFromUser() {
  const name = input("車検証読み取り情報", "使用者の氏名又は名称")?.value || "";
  const b = norm(name).match(/([一-龠]{2,5})(?:支店|営業所|事業所)/)?.[1];
  if (b) return b;
  const a = input("車検証読み取り情報", "使用者の住所")?.value || "";
  return norm(a).match(/([一-龠]{2,5})市/)?.[1] || "";
}
function registrationFromLogs(debug) {
  const texts = [logValue(debug, "登録番号行 白黒"), logValue(debug, "登録番号行 灰"), logValue(debug, "登録かな 白黒")].join(" ");
  const t = numish(texts);
  const m = t.match(/(?:^|\D)(\d{2,3})\s*([ぁ-ん])\s*(\d{4})(?:\D|$)/);
  if (!m) return "";
  const region = regionFromUser();
  return region ? `${region} ${m[1]} ${m[2]} ${m[3]}` : "";
}
function chassisFromLogs(debug) {
  const stem = modelStem(input("車検証読み取り情報", "型式")?.value || input("基本情報", "型式")?.value || "");
  if (!stem) return "";
  for (const label of ["車台番号行 白黒", "車台番号行 灰"]) {
    const raw = logValue(debug, label);
    const ds = numish(raw).match(/\d{6,9}/g) || [];
    if (ds.length) return `${stem}-${ds[ds.length - 1]}`;
  }
  return "";
}
function normalizeAddress(debug) {
  const all = norm(debug).replace(/一/g, "-");
  const target = `${logValue(debug, "使用者住所 灰")} ${logValue(debug, "使用者住所 白黒")}`;
  let s = norm(target)
    .replace(/静[過遇逼瞭剛闘]県/g, "静岡県")
    .replace(/浜[稚雑維]市/g, "浜松市")
    .replace(/浜[稚雑維]/g, "浜松")
    .replace(/\s+/g, "")
    .replace(/[|｜「」『』\[\]()（）]/g, "");
  const no = (s.match(/\d{3,5}-\d{1,4}/) || all.match(/\d\s*\d\s*\d\s*\d\s*[-一]\s*\d/))?.[0]?.replace(/\s+/g, "").replace(/一/g, "-") || "";
  const hasIrino = /入\s*野\s*町/.test(all) || /入野町/.test(all);
  const ward = s.match(/[一-龠]{1,3}区/)?.[0] || "西区";
  const city = regionFromUser();
  if (city === "浜松" && no) return `静岡県浜松市${ward}${hasIrino ? "入野町" : ""}${no}`;
  const direct = s.match(/静岡県[^\d]{2,18}\d{3,5}-\d{1,4}/)?.[0];
  return direct || "";
}
function bodyFromDebug(debug) {
  const t = compact(debug);
  const choices = ["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","トラック","ダンプ","セダン","箱型","幌型","バス","バン"];
  for (const x of choices) if (t.includes(x)) return x;
  const i = t.indexOf("車体の形状");
  const a = i >= 0 ? t.slice(i, i + 30) : "";
  if (/ン[プフ]/.test(a)) return "バン";
  return "";
}
function eraFrom(text = "") {
  const t = norm(text).replace(/信和|令入|作和|今和|三和|合和/g, "令和").replace(/平[或戊成陰]/g, "平成");
  if (t.includes("令和")) return "令和";
  if (t.includes("平成")) return "平成";
  if (t.includes("昭和")) return "昭和";
  return "";
}
function detectPaper(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return { x:0,y:0,w:canvas.width,h:canvas.height };
  const w=canvas.width,h=canvas.height,d=ctx.getImageData(0,0,w,h).data,step=Math.max(4,Math.floor(Math.max(w,h)/650));
  const ok=(x,y)=>{const p=(y*w+x)*4,r=d[p],g=d[p+1],b=d[p+2],br=(r+g+b)/3;return br>120&&Math.max(r,g,b)-Math.min(r,g,b)<90;};
  const ys=[]; for(let y=0;y<h;y+=step){let hit=0,n=0;for(let x=0;x<w;x+=step){if(ok(x,y))hit++;n++;}if(hit/Math.max(1,n)>.25)ys.push(y);} if(ys.length<10)return{x:0,y:0,w,h};
  const top=Math.max(0,ys[0]-step*2),bottom=Math.min(h-1,ys[ys.length-1]+step*2),xs=[];
  for(let x=0;x<w;x+=step){let hit=0,n=0;for(let y=top;y<=bottom;y+=step){if(ok(x,y))hit++;n++;}if(hit/Math.max(1,n)>.25)xs.push(x);} if(xs.length<10)return{x:0,y:top,w,h:bottom-top+1};
  const left=Math.max(0,xs[0]-step*2),right=Math.min(w-1,xs[xs.length-1]+step*2);return{x:left,y:top,w:right-left+1,h:bottom-top+1};
}
async function buildSource(img) {
  if (!img.complete) await new Promise((res,rej)=>{img.addEventListener("load",res,{once:true});img.addEventListener("error",rej,{once:true});});
  const c=document.createElement("canvas"),max=4600,s=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
  c.width=Math.max(1,Math.round((img.naturalWidth||img.width)*s));c.height=Math.max(1,Math.round((img.naturalHeight||img.height)*s));const x=c.getContext("2d",{willReadFrequently:true});x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);return c;
}
function makeCell(source,paper,x0,x1,y0,y1,binary=false,targetWidth=1900){
  const sx=Math.max(0,Math.round(paper.x+paper.w*x0)),sy=Math.max(0,Math.round(paper.y+paper.h*y0)),sw=Math.max(1,Math.round(paper.w*(x1-x0))),sh=Math.max(1,Math.round(paper.h*(y1-y0))),scale=Math.max(1,Math.min(12,targetWidth/sw));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));const x=c.getContext("2d",{willReadFrequently:true});x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";x.drawImage(source,sx,sy,sw,sh,0,0,c.width,c.height);
  if(binary){const im=x.getImageData(0,0,c.width,c.height);let sum=0,n=0;for(let p=0;p<im.data.length;p+=4){const g=Math.round(im.data[p]*.22+im.data[p+1]*.70+im.data[p+2]*.08);sum+=g;n++;}const th=Math.max(115,Math.min(205,sum/Math.max(1,n)-18));for(let p=0;p<im.data.length;p+=4){const g=Math.round(im.data[p]*.22+im.data[p+1]*.70+im.data[p+2]*.08),v=g<th?0:255;im.data[p]=im.data[p+1]=im.data[p+2]=v;im.data[p+3]=255;}x.putImageData(im,0,0);}
  return c;
}
async function rec(worker,canvas,psm="7",white=""){await worker.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:"1",...(white?{tessedit_char_whitelist:white}:{})});return norm((await worker.recognize(canvas)).data.text||"");}
function numberGroups(text){return (numish(text).match(/\d{1,2}/g)||[]).map(Number).filter(Number.isFinite);}
function bestDate(groups, monthOnly=false){
  for(const g of groups){
    if(monthOnly){for(let i=0;i+1<g.length;i++){const y=g[i],m=g[i+1];if(y>=1&&y<=64&&m>=1&&m<=12)return[y,m];}}
    else{for(let i=0;i+2<g.length;i++){const y=g[i],m=g[i+1],d=g[i+2];if(y>=1&&y<=64&&m>=1&&m<=12&&d>=1&&d<=31)return[y,m,d];}}
  }
  return null;
}
function ensureDebug(lines){
  let box=document.getElementById("certificate-micro-debug");
  if(!box){box=document.createElement("details");box.id="certificate-micro-debug";box.style.margin="12px 0";box.innerHTML='<summary style="font-weight:700;cursor:pointer">マイクロOCR（確認用）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre>';const img=document.querySelector("img.preview");img?.closest("section.card")?.appendChild(box);}
  const pre=box?.querySelector("pre");if(pre)pre.textContent=lines.join("\n");
}

async function microDates(img,debug){
  const source=await buildSource(img),paper=detectPaper(source),t=await import("tesseract.js"),worker=await t.createWorker("jpn+eng",1),logs=[`マイクロ紙範囲 x=${paper.x} y=${paper.y} w=${paper.w} h=${paper.h}`];
  try{
    const readDate=async(name,box,monthOnly=false)=>{
      const a=await rec(worker,makeCell(source,paper,...box,false,2300),"7","0123456789");
      const b=await rec(worker,makeCell(source,paper,...box,true,2300),"7","0123456789");
      logs.push(`【${name} 数字灰】 ${a||"(空)"}`,`【${name} 数字白黒】 ${b||"(空)"}`);
      return bestDate([numberGroups(b),numberGroups(a)],monthOnly);
    };
    const reg=await readDate("登録年月日",[0.245,0.405,0.260,0.284],false);
    const first=await readDate("初度登録",[0.455,0.600,0.260,0.284],true);
    const exp=await readDate("有効期限",[0.675,0.845,0.260,0.284],false);
    const bodyA=await rec(worker,makeCell(source,paper,0.175,0.305,0.452,0.482,false,1700),"7");
    const bodyB=await rec(worker,makeCell(source,paper,0.175,0.305,0.452,0.482,true,1700),"7");
    logs.push(`【車体形状マイクロ 灰】 ${bodyA||"(空)"}`,`【車体形状マイクロ 白黒】 ${bodyB||"(空)"}`);
    const regEra=eraFrom(`${logValue(debug,"登録年月日 灰")} ${logValue(debug,"登録年月日 白黒")}`)||"令和";
    const firstEra=eraFrom(`${logValue(debug,"初度登録 灰")} ${logValue(debug,"初度登録 白黒")}`)||"平成";
    const expEra=eraFrom(`${logValue(debug,"有効期限 灰")} ${logValue(debug,"有効期限 白黒")}`)||"令和";
    const out={
      registrationDate:reg?`${regEra}${reg[0]}年${reg[1]}月${reg[2]}日`:"",
      firstRegistration:first?`${firstEra}${first[0]}年${first[1]}月`:"",
      inspectionExpiry:exp?`${expEra}${exp[0]}年${exp[1]}月${exp[2]}日`:"",
      bodyShape:bodyFromDebug(`${bodyA}\n${bodyB}`)
    };
    logs.push(`【マイクロ採用 登録年月日】 ${out.registrationDate||"未読"}`,`【マイクロ採用 初度登録】 ${out.firstRegistration||"未読"}`,`【マイクロ採用 有効期限】 ${out.inspectionExpiry||"未読"}`,`【マイクロ採用 車体形状】 ${out.bodyShape||"未読"}`);
    ensureDebug(logs);return out;
  } finally {await worker.terminate();}
}

export default function CertificateMicroCellsFix(){
  useEffect(()=>{
    let dead=false,running=false,lastKey="";
    const run=async()=>{
      if(dead||running)return;const debug=pageDebug(),img=document.querySelector("img.preview");if(!img?.src||!debug.includes("【最終採用"))return;const key=`${img.src}|${debug.length}`;if(key===lastKey)return;lastKey=key;running=true;
      try{
        const reg=registrationFromLogs(debug),ch=chassisFromLogs(debug),addr=normalizeAddress(debug),body0=bodyFromDebug(debug);
        if(reg){setInput(input("車検証読み取り情報","自動車登録番号又は車両番号"),reg);setInput(input("基本情報","登録番号"),reg);setInput(input("基本情報","ナンバー下4桁"),reg.match(/\d{4}$/)?.[0]||"");}
        if(ch){setInput(input("車検証読み取り情報","車台番号"),ch);setInput(input("基本情報","車台番号"),ch);}
        if(addr)setInput(input("車検証読み取り情報","使用者の住所"),addr);
        if(body0)setInput(input("車検証読み取り情報","車体の形状"),body0);
        const m=await microDates(img,debug);if(dead)return;
        if(m.registrationDate)setInput(input("車検証読み取り情報","登録年月日／交付年月日"),m.registrationDate);
        if(m.firstRegistration){setInput(input("車検証読み取り情報","初度登録年月"),m.firstRegistration);setInput(input("基本情報","初度登録（和暦）"),m.firstRegistration);}
        if(m.inspectionExpiry)setInput(input("車検証読み取り情報","有効期間の満了する日"),m.inspectionExpiry);
        if(m.bodyShape)setInput(input("車検証読み取り情報","車体の形状"),m.bodyShape);
      }catch(e){ensureDebug([`マイクロOCRエラー: ${e?.message||e}`]);}finally{running=false;}
    };
    const obs=new MutationObserver(()=>void run());obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});const id=setInterval(()=>void run(),1100);void run();return()=>{dead=true;obs.disconnect();clearInterval(id);};
  },[]);return null;
}
