"use client";

import { useEffect } from "react";

const norm = (v = "") => String(v).normalize("NFKC").replace(/[‐‑‒–—―ー]/g, "-").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const compact = (v = "") => norm(v).replace(/\s+/g, "");
const numText = (v = "") => norm(v).replace(/[OoQqDd]/g, "0").replace(/[Il|]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss]/g, "5").replace(/[Bb]/g, "8");

function globalText(debug) {
  const m = "【車検証 全体OCR】";
  const i = debug.indexOf(m);
  return i >= 0 ? debug.slice(i + m.length).trim() : "";
}

function rawField(debug, label) {
  const a = `【${label} 生OCR】`, b = `【${label} 採用】`;
  const i = debug.indexOf(a);
  if (i < 0) return "";
  const j = debug.indexOf(b, i + a.length);
  return debug.slice(i + a.length, j >= 0 ? j : undefined).trim();
}

function docNumber(text) {
  for (const raw of numText(text).match(/(?:\d[\s\n]*){12,13}/g) || []) {
    const d = raw.replace(/\D/g, "");
    if (d.length === 12 && new Set(d).size >= 4) return d;
  }
  return "";
}

function findModel(text) {
  const t = norm(text).toUpperCase().replace(/\s+/g, "").replace(/[＿_]/g, "-").replace(/-NKRS(?=\d)/g, "-NKR");
  const p = "DAA|DBA|ABA|5AA|6AA|3BA|4BA|5BA|3DA|2RG|TKG|QKG|PKG|SKG|LDA|CBA|HBD|EBD|GBD|ZAA|QDG|PDG|2KG|2PG|2DG|2TG";
  return t.match(new RegExp(`(?:${p})-[A-Z0-9]{3,12}`))?.[0] || "";
}

function findEngine(text) {
  const t = norm(text).toUpperCase().replace(/[Oo]/g, "0").replace(/[リり]/g, "J").replace(/\s+/g, "");
  return (t.match(/\d[A-Z]{2}\d/g) || [])[0] || (t.match(/[A-Z0-9]{3,8}/g) || []).find(x => /[A-Z]/.test(x) && /\d/.test(x) && !/^(TKG|QKG|PKG|SKG|DAA|DBA|ABA)/.test(x)) || "";
}

function canonicalCode(value = "") {
  return compact(value).toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function normalizeChassisCandidate(raw = "", model = "") {
  const t = compact(raw).toUpperCase().replace(/[‐‑‒–—―ー−]/g, "-");
  const m = t.match(/([A-Z0-9]{2,10})-([0-9OQI|]{4,10})/);
  if (!m) return "";
  let prefix = m[1];
  const suffix = m[2].replace(/[OQ]/g, "0").replace(/[I|]/g, "1");
  if (!/[A-Z]/.test(prefix) || !/\d/.test(prefix) || !/^\d{4,10}$/.test(suffix)) return "";

  const modelCore = compact(model).toUpperCase().split("-").pop() || "";
  if (modelCore) {
    const same = candidate => candidate.length === modelCore.length && canonicalCode(candidate) === canonicalCode(modelCore);
    if (same(prefix)) prefix = modelCore;
    else if (prefix.length === modelCore.length + 1 && (same(prefix.slice(1)) || same(prefix.slice(0, -1)))) prefix = modelCore;
  }
  return `${prefix}-${suffix}`;
}

function findChassis(text, model = "") {
  const t = norm(text).toUpperCase();
  const labelIndex = t.indexOf("車台番号");
  const primary = labelIndex >= 0 ? t.slice(labelIndex, labelIndex + 260) : "";
  const pools = [primary, t.slice(0, 1400)].filter(Boolean);
  const modelCore = compact(model).toUpperCase().split("-").pop() || "";

  for (let poolIndex = 0; poolIndex < pools.length; poolIndex += 1) {
    const pool = pools[poolIndex];
    for (const match of pool.matchAll(/[A-Z0-9]{2,10}\s*[-‐‑‒–—―ー−]\s*[0-9OQI|]{4,10}/g)) {
      const value = normalizeChassisCandidate(match[0], model);
      if (!value) continue;
      if (poolIndex === 0 || !modelCore) return value;
      const prefix = value.split("-")[0];
      if (canonicalCode(prefix) === canonicalCode(modelCore)) return value;
    }
  }
  return "";
}

function known(text, choices) {
  const t = compact(text);
  return choices.find(x => t.includes(compact(x))) || "";
}

function maker(text) {
  const x = known(text, ["いすゞ", "トヨタ", "日産", "ホンダ", "マツダ", "スズキ", "三菱", "ダイハツ", "スバル", "日野", "UDトラックス", "レクサス"]);
  if (x) return x;
  return /い[^\n]{0,6}ゞ/.test(norm(text)) ? "いすゞ" : "";
}

function company(text) {
  for (const line0 of norm(text).split("\n")) {
    const line = line0.replace(/\s{2,}/g, " ").trim();
    const m = line.match(/(株式会社|有限会社|合同会社).*/);
    if (m && m[0].length <= 70) return m[0].replace(/[|｜]+$/g, "").trim();
  }
  return "";
}

function fuzzyRecordDate(raw) {
  let t = norm(raw).replace(/作\s*和/g, "令和").replace(/三\s*和/g, "令和").replace(/今\s*和/g, "令和");
  const era = t.match(/令和|平成|昭和/);
  if (!era) return "";
  t = t.slice((era.index || 0) + era[0].length);
  const toks = t.match(/\d{1,3}/g) || [];
  const vals = s => {
    const a = [], n = Number(s);
    if (n <= 99) a.push(n);
    if (s.length === 3) a.push(Number(s.slice(0,2)), Number(s.slice(1)), Number(s[0]), Number(s[2]));
    return [...new Set(a)];
  };
  for (let i=0;i<toks.length;i++) for (const y of vals(toks[i])) {
    const ymax = era[0] === "令和" ? 30 : era[0] === "平成" ? 31 : 64;
    if (y < 1 || y > ymax) continue;
    for (let j=i+1;j<Math.min(toks.length,i+4);j++) for (const m of vals(toks[j])) {
      if (m < 1 || m > 12) continue;
      for (let k=j+1;k<Math.min(toks.length,j+4);k++) for (const d of vals(toks[k])) {
        if (d >= 1 && d <= 31) return `${era[0]}${y}年${m}月${d}日`;
      }
    }
  }
  return "";
}

function findRecordDate(debug, global) {
  const direct = fuzzyRecordDate(rawField(debug, "記録年月日"));
  if (direct) return direct;

  const t = norm(global);
  const labelMatch = t.match(/記録.{0,3}年月[日5]?/);
  if (labelMatch && typeof labelMatch.index === "number") {
    const nearby = fuzzyRecordDate(t.slice(labelMatch.index, labelMatch.index + 280));
    if (nearby) return nearby;
  }

  // 電子車検証の記録年月日は先頭の基本情報より前に置かれる。
  // 絶対座標や特定車両の値は使わず、文書冒頭の記録日候補だけを最終フォールバックにする。
  return fuzzyRecordDate(t.slice(0, 520));
}

const nums = text => (numText(text).replace(/,/g, "").match(/\d{1,5}/g) || []).map(Number);

function rowValues(text) {
  const t = norm(text);
  let s = t.indexOf("車両総重量");
  if (s < 0) s = t.indexOf("車両重量");
  if (s < 0) return null;
  const e0 = t.indexOf("総排気量", s), e = e0 > s ? e0 : Math.min(t.length, s + 700);
  const a = nums(t.slice(s, e));
  for (let i=0;i+4<a.length;i++) {
    const [vw, gw, len, wid, hei] = a.slice(i, i+5);
    if (vw>=500&&vw<=50000&&gw>=vw&&gw<=80000&&len>=200&&len<=2000&&wid>=100&&wid<=350&&hei>=100&&hei<=500) {
      return {vw, gw, len, wid, hei, rest:a.slice(i+5).filter(n=>n>=200&&n<=30000)};
    }
  }
  return null;
}

function seating(text) {
  const t = norm(text);
  let s = t.indexOf("車体の形状"); if (s<0) s=t.indexOf("乗車定員"); if (s<0) return "";
  let e=t.indexOf("車両総重量",s); if(e<0)e=Math.min(t.length,s+450);
  const a=nums(t.slice(s,e)).filter(n=>n>=1&&n<=20&&n!==2);
  return a.length ? String(a[0]) : "";
}

function displacement(text) {
  const t=norm(text),i=t.indexOf("総排気量"),c=i>=0?t.slice(i,i+180):t;
  return c.match(/\b\d{1,2}\.\d{1,2}\b/)?.[0] || "";
}

function fuel(text, eng) {
  const x=known(text,["軽油","ガソリン","揮発油","電気","LPG","CNG","水素"]);
  if(x)return x==="揮発油"?"ガソリン":x;
  return /^(4JJ1|4JJ3|4JZ1|4HK1|4HK2|4JB1|4JG2|1KD|2KD|1GD|2GD|ZD30|4M50|4M51|4P10|J05E|J07E|J08E|N04C|S05C|S05D|GH5|GH7|GH11)$/.test((eng||"").toUpperCase()) ? "軽油" : "";
}

function parse(debug) {
  const g=globalText(debug); if(!g)return {};
  const v={};
  v.recordDate=findRecordDate(debug,g);
  v.documentNumber=docNumber(g);
  v.model=findModel(g);
  v.chassisNumber=findChassis(g,v.model);
  const gi=norm(g).indexOf("原動機の型式");
  v.engineModel=findEngine(gi>=0?norm(g).slice(gi,gi+160):g);
  v.vehicleName=maker(g);
  v.vehicleClass=known(g,["普通","小型","軽自動車","大型特殊"]);
  v.purpose=known(g,["貨物","乗用","乗合","特種"]);
  v.privateBusiness=known(g,["自家用","事業用"]);
  v.bodyShape=known(g,["バン","キャブオーバ","箱型","ステーションワゴン","セダン","ボンネット","トラック","ダンプ","幌型","ピックアップ","バス"]);
  v.userName=company(g);
  const bi=norm(g).indexOf("使用の本拠の位置");
  if(bi>=0&&/[*＊kK]{3,}/.test(norm(g).slice(bi,bi+180)))v.baseLocation="***";
  v.seatingCapacity=seating(g);
  const r=rowValues(g);
  if(r){
    v.vehicleWeightKg=String(r.vw);v.grossVehicleWeightKg=String(r.gw);v.lengthCm=String(r.len);v.widthCm=String(r.wid);v.heightCm=String(r.hei);
    if(r.rest.length>=4){v.frontFrontAxleWeightKg=String(r.rest[0]);v.frontRearAxleWeightKg=String(r.rest[1]);v.rearFrontAxleWeightKg=String(r.rest[2]);v.rearRearAxleWeightKg=String(r.rest[3]);}
    else if(r.rest.length>=2){v.frontFrontAxleWeightKg=String(r.rest[0]);v.frontRearAxleWeightKg="";v.rearFrontAxleWeightKg="";v.rearRearAxleWeightKg=String(r.rest[r.rest.length-1]);}
    const n=Number(v.seatingCapacity||0),p=r.gw-r.vw-n*55;if(n>=1&&n<=20&&p>=0&&p<=50000&&p%5===0)v.maxPayloadKg=String(p);
  }
  v.displacementOrRatedOutput=displacement(g);
  v.fuel=fuel(g,v.engineModel);
  return v;
}

function section(title){return Array.from(document.querySelectorAll("section.card")).find(s=>s.querySelector("h2")?.textContent?.includes(title))||null;}
function input(title,label){const s=section(title);if(!s)return null;for(const l of Array.from(s.querySelectorAll("label"))){const t=(l.querySelector("span")?.textContent||l.childNodes[0]?.textContent||"").trim();if(compact(t)===compact(label))return l.querySelector("input");}return null;}
function setInput(el,val,empty=false){if(!el||val==null||(!empty&&!val)||el.value===val)return;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;if(set)set.call(el,val);else el.value=val;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}
function setFuel(val){if(!val)return;const s=section("基本情報"),sel=Array.from(s?.querySelectorAll("label")||[]).find(l=>(l.textContent||"").includes("燃料"))?.querySelector("select");if(!sel)return;const x=val==="軽油"?"ディーゼル":val==="ガソリン"?"ガソリン":val==="電気"?"EV":"その他";const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value")?.set;if(set)set.call(sel,x);else sel.value=x;sel.dispatchEvent(new Event("change",{bubbles:true}));}

function apply(v){
  const d=l=>input("車検証読み取り情報",l),b=l=>input("基本情報",l);
  const list=[
    ["記録年月日",v.recordDate],["記録事項番号",v.documentNumber],["車台番号",v.chassisNumber],["使用者の氏名又は名称",v.userName],["使用の本拠の位置",v.baseLocation],["車名",v.vehicleName],["型式",v.model],["自動車の種別",v.vehicleClass],["用途",v.purpose],["自家用・事業用の別",v.privateBusiness],["車体の形状",v.bodyShape],["乗車定員",v.seatingCapacity],["最大積載量 kg",v.maxPayloadKg],["車両重量 kg",v.vehicleWeightKg],["車両総重量 kg",v.grossVehicleWeightKg],["長さ cm",v.lengthCm],["幅 cm",v.widthCm],["高さ cm",v.heightCm],["前前軸重 kg",v.frontFrontAxleWeightKg],["前後軸重 kg",v.frontRearAxleWeightKg,true],["後前軸重 kg",v.rearFrontAxleWeightKg,true],["後後軸重 kg",v.rearRearAxleWeightKg],["総排気量又は定格出力",v.displacementOrRatedOutput],["燃料の種類",v.fuel]
  ];
  // 原動機型式は全体OCRでは確定しない。K2 QR / 罫線セルOCRの複数候補で確定した時だけ採用する。
  for(const [l,x,e] of list)setInput(d(l),x,!!e);
  setInput(b("型式"),v.model);setInput(b("車両重量 kg"),v.vehicleWeightKg);setFuel(v.fuel);
}

export default function CertificateFulltextFix(){
  useEffect(()=>{
    if(location.pathname!=="/vehicle-workflow-v2")return;
    let last="",dead=false;
    const run=()=>{if(dead)return;const debug=Array.from(document.querySelectorAll("details pre")).map(x=>x.textContent||"").find(x=>x.includes("【車検証 全体OCR】"))||"";if(!debug||debug===last)return;last=debug;const v=parse(debug);apply(v);[500,1400,3200].forEach(ms=>setTimeout(()=>{if(!dead)apply(v);},ms));};
    const obs=new MutationObserver(run);obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});const id=setInterval(run,700);run();return()=>{dead=true;obs.disconnect();clearInterval(id);};
  },[]);
  return null;
}
