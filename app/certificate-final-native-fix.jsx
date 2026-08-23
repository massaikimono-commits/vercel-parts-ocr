"use client";

import { useEffect } from "react";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const compact = (v = "") => String(v).normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

function section(title) {
  return Array.from(document.querySelectorAll("section.card")).find((s) =>
    s.querySelector("h2")?.textContent?.includes(title)
  ) || null;
}

function detailInput(labelText) {
  const s = section("車検証読み取り情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const title = compact(label.querySelector("span")?.textContent || "");
    if (title === compact(labelText)) return label.querySelector("input");
  }
  return null;
}

function basicInput(prefix) {
  const s = section("基本情報");
  if (!s) return null;
  for (const label of Array.from(s.querySelectorAll("label"))) {
    const text = compact(label.textContent || "");
    if (text.startsWith(compact(prefix))) return label.querySelector("input");
  }
  return null;
}

function nativeReactInput(el, value) {
  if (!(el instanceof HTMLInputElement) || !value) return false;
  if (el.value === value) return true;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const previous = el.value;
  if (setter) setter.call(el, value); else el.value = value;
  if (el._valueTracker) el._valueTracker.setValue(previous);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function setVerified(getter, value, tries = 8) {
  if (!value) return true;
  for (let i = 0; i < tries; i += 1) {
    const el = getter();
    if (el?.value === value) return true;
    if (el) nativeReactInput(el, value);
    await sleep(500);
    if (getter()?.value === value) return true;
  }
  return false;
}

function normalizeDate(raw = "") {
  return compact(raw)
    .replace(/信和|令入|令禾|今和|作和|三和|合和|令乱|命和/g, "令和")
    .replace(/平[或戊陰咸戌]/g, "平成")
    .replace(/昭[禾口知]/g, "昭和")
    .replace(/[OoQqDd]/g, "0")
    .replace(/[Il!|｜]/g, "1");
}

function parseDate(raw = "") {
  const t = normalizeDate(raw);
  const era = t.match(/令和|平成|昭和/)?.[0];
  if (!era) return "";
  const tail = t.slice(t.indexOf(era) + era.length);
  const nums = (tail.match(/\d{1,2}/g) || []).map(Number);
  for (let i = 0; i + 2 < nums.length; i += 1) {
    const y = nums[i], m = nums[i + 1], d = nums[i + 2];
    if (y >= 1 && y <= 64 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${era}${y}年${m}月${d}日`;
  }
  return "";
}

function parseBody(raw = "") {
  const t = compact(raw).replace(/\s+/g, "")
    .replace(/パン|ハン|バソ|パソ|ヴァン/g, "バン");
  const names = ["キャブオーバ","ステーションワゴン","ピックアップ","ボンネット","バン","箱型","セダン","トラック","ダンプ","幌型","バス"];
  return names.find((x) => t.includes(x)) || "";
}

async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const n = new Image(); n.onload = () => resolve(n); n.onerror = reject; n.src = url;
    });
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 5600 / Math.max(iw, ih));
    const c = document.createElement("canvas");
    c.width = Math.round(iw * scale); c.height = Math.round(ih * scale);
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff"; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

function detectPaper(c) {
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return { x:0,y:0,w:c.width,h:c.height };
  const w=c.width,h=c.height,d=x.getImageData(0,0,w,h).data,step=Math.max(5,Math.floor(Math.max(w,h)/700));
  const white=(px,py)=>{const p=(py*w+px)*4,r=d[p],g=d[p+1],b=d[p+2],br=(r+g+b)/3;return br>105&&Math.max(r,g,b)-Math.min(r,g,b)<110;};
  const ys=[]; for(let y=0;y<h;y+=step){let hit=0,n=0;for(let xx=0;xx<w;xx+=step){if(white(xx,y))hit++;n++;}if(hit/Math.max(1,n)>.22)ys.push(y);} 
  if(ys.length<10)return{x:0,y:0,w,h};
  const top=Math.max(0,ys[0]-step*3),bottom=Math.min(h-1,ys[ys.length-1]+step*3),xs=[];
  for(let xx=0;xx<w;xx+=step){let hit=0,n=0;for(let y=top;y<=bottom;y+=step){if(white(xx,y))hit++;n++;}if(hit/Math.max(1,n)>.22)xs.push(xx);} 
  if(xs.length<10)return{x:0,y:top,w,h:bottom-top+1};
  const left=Math.max(0,xs[0]-step*3),right=Math.min(w-1,xs[xs.length-1]+step*3);
  return{x:left,y:top,w:right-left+1,h:bottom-top+1};
}

function crop(src,paper,b,target=2800,binary=false){
  const [x0,y0,x1,y1]=b,sx=Math.round(paper.x+paper.w*x0),sy=Math.round(paper.y+paper.h*y0),sw=Math.max(1,Math.round(paper.w*(x1-x0))),sh=Math.max(1,Math.round(paper.h*(y1-y0))),sc=Math.max(1,Math.min(12,target/sw)),pad=36;
  const c=document.createElement("canvas");c.width=Math.round(sw*sc)+pad*2;c.height=Math.round(sh*sc)+pad*2;const x=c.getContext("2d",{willReadFrequently:true});x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";x.drawImage(src,sx,sy,sw,sh,pad,pad,c.width-pad*2,c.height-pad*2);
  if(binary){const im=x.getImageData(0,0,c.width,c.height);let sum=0,n=0;for(let p=0;p<im.data.length;p+=4){const g=Math.round(im.data[p]*.22+im.data[p+1]*.70+im.data[p+2]*.08);sum+=g;n++;im.data[p]=im.data[p+1]=im.data[p+2]=g;}const th=Math.max(105,Math.min(220,sum/Math.max(1,n)-15));for(let p=0;p<im.data.length;p+=4){const v=im.data[p]<th?0:255;im.data[p]=im.data[p+1]=im.data[p+2]=v;im.data[p+3]=255;}x.putImageData(im,0,0);}return c;
}

function mode(a){const m=new Map();for(const v of a.filter(Boolean))m.set(v,(m.get(v)||0)+1);return[...m.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"";}

async function targeted(file){
  const src=await imageCanvas(file),paper=detectPaper(src),t=await import("tesseract.js"),worker=await t.createWorker("jpn+eng",1),dates=[],bodies=[],dateRaws=[],bodyRaws=[];
  // 実画像で確認した位置。旧設定より車体形状を上へ移動。
  const dateBoxes=[[.13,.215,.45,.270],[.15,.222,.43,.265],[.17,.228,.41,.268]];
  const bodyBoxes=[[.07,.430,.35,.485],[.09,.438,.33,.480],[.11,.445,.31,.478]];
  try{
    for(const b of dateBoxes)for(const bin of [false,true]){const c=crop(src,paper,b,3000,bin);for(const psm of ["7","6","11"]){await worker.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:"1",user_defined_dpi:"300"});const raw=compact((await worker.recognize(c)).data.text||"");if(raw)dateRaws.push(raw);const v=parseDate(raw);if(v)dates.push(v);}}
    for(const b of bodyBoxes)for(const bin of [false,true]){const c=crop(src,paper,b,2600,bin);for(const psm of ["7","6","11"]){await worker.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:"1",user_defined_dpi:"300"});const raw=compact((await worker.recognize(c)).data.text||"");if(raw)bodyRaws.push(raw);const v=parseBody(raw);if(v)bodies.push(v);}}
  }finally{await worker.terminate().catch(()=>{});}return{registrationDate:mode(dates),bodyShape:mode(bodies),dateRaws,bodyRaws};
}

function status(extra,state){
  const host=document.getElementById("certificate-qr-debug")||document.querySelector("img.preview")?.closest("section.card");if(!host)return;let box=document.getElementById("certificate-final-native-status");if(!box){box=document.createElement("details");box.id="certificate-final-native-status";box.style.marginTop="12px";box.innerHTML='<summary style="font-weight:800">最終反映チェック（確認用）</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>';host.appendChild(box);}const q=window.__vehicleCertificateQrPriority||{},pre=box.querySelector("pre");if(pre)pre.textContent=[`状態: ${state}`,`登録年月日 target=${extra?.registrationDate||"未取得"} live=${detailInput("登録年月日／交付年月日")?.value||""}`,`初度登録 target=${q.firstRegistration||"待機"} live=${detailInput("初度登録年月")?.value||""}`,`基本初度 live=${basicInput("初度登録")?.value||""}`,`有効期限 target=${q.inspectionExpiry||"待機"} live=${detailInput("有効期間の満了する日")?.value||""}`,`車体形状 target=${extra?.bodyShape||"未取得"} live=${detailInput("車体の形状")?.value||""}`,"","登録年月日OCR:",...(extra?.dateRaws||["(空)"]),"","形状OCR:",...(extra?.bodyRaws||["(空)"])].join("\n");
}

export default function CertificateFinalNativeFix(){
  useEffect(()=>{
    if(!location.pathname.startsWith("/vehicle-workflow"))return;let dead=false,scan=0;
    const onChange=(e)=>{const input=e.target;if(!(input instanceof HTMLInputElement)||input.type!=="file")return;const file=input.files?.[0];if(!file||!file.type.startsWith("image/"))return;const id=++scan;
      void(async()=>{
        for(let i=0;i<160&&!dead&&id===scan;i++){if(!document.querySelector(".progress")&&window.__vehicleCertificateQrPriority?.firstRegistration)break;await sleep(350);}if(dead||id!==scan)return;
        status(null,"専用OCR中");const extra=await targeted(file);if(dead||id!==scan)return;const q=window.__vehicleCertificateQrPriority||{};
        const results=[];
        results.push(await setVerified(()=>detailInput("登録年月日／交付年月日"),extra.registrationDate));
        results.push(await setVerified(()=>detailInput("初度登録年月"),q.firstRegistration));
        results.push(await setVerified(()=>basicInput("初度登録"),q.firstRegistration));
        results.push(await setVerified(()=>detailInput("有効期間の満了する日"),q.inspectionExpiry));
        results.push(await setVerified(()=>detailInput("車体の形状"),extra.bodyShape));
        status(extra,results.every(Boolean)?"画面反映完了":"一部反映失敗");
      })().catch(err=>status({dateRaws:[String(err?.message||err)]},"エラー"));
    };
    document.addEventListener("change",onChange,true);return()=>{dead=true;document.removeEventListener("change",onChange,true);};
  },[]);return null;
}
