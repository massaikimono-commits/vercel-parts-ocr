// Original PDFs and copied form state stay PRIVATE. No GT is imported by this capture harness.
// Usage: node scripts/certificate-pdf-original-form-capture.mjs INVENTORY_JSON PRIVATE_DIR TAG
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ICB_PLAYWRIGHT_MODULE||'playwright');
const inventory=JSON.parse(fs.readFileSync(process.argv[2]));
const privateDir=process.argv[3];
assert(privateDir,'Provide a PRIVATE output directory');
fs.mkdirSync(privateDir,{recursive:true});
const tag=process.argv[4]||'capture';
assert(/^[a-z0-9-]+$/i.test(tag),'Simple output tag required');
const base=process.env.ICB_TEST_BASE_URL||'http://127.0.0.1:4338';
assert(/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(base),'Localhost only; never Production');
const browser=await chromium.launch({...(process.env.ICB_CHROME_PATH?{executablePath:process.env.ICB_CHROME_PATH}:{})});
const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
const requests=[],errors=[];
await ctx.route('https://example.supabase.co/**',async route=>{
 const req=route.request(),url=new URL(req.url());requests.push({method:req.method(),path:url.pathname});
 let body=[];
 if(url.pathname.includes('/auth/'))body={user:{id:'00000000-0000-4000-8000-000000000001'},access_token:'fixture'};
 if(url.pathname.endsWith('/app_user_profiles'))body={is_active:true};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});
await ctx.route(/https?:\/\/(?!127\.0\.0\.1|localhost|example\.supabase\.co).*/,r=>r.abort());
await ctx.addInitScript(()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const token='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+86400}))+'.fixture';
 localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+86400,expires_in:86400,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated'}}));
 window.__pdfEvents=[];window.__copiedText='';
 Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copiedText=text}},configurable:true});
 window.addEventListener('vehicle-certificate-authoritative',e=>window.__pdfEvents.push({at:Date.now(),patch:JSON.parse(JSON.stringify(e.detail))}));
});
const page=await ctx.newPage();
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const results=[];
try{
 for(const f of inventory.files){
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex'),f.sha256,'Original PDF bytes changed');
  await page.goto(base+'/vehicle-workflow-v2?mode=new');
  await page.getByRole('heading',{name:'車検証から読み取る'}).waitFor();
  await page.waitForTimeout(200);
  await page.locator('input[type=file][accept="image/*,application/pdf"]').setInputFiles(f.path);
  const copy=page.getByRole('button',{name:'読取結果をコピー',exact:true});
  await copy.waitFor();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='読取結果をコピー');return b&&!b.disabled},{},{timeout:45000});
  await page.waitForTimeout(2500);
  await copy.click();
  const state=await page.evaluate(()=>({copy:window.__copiedText,events:window.__pdfEvents,priority:window.__vehicleCertificatePdfPriority,fields:[...document.querySelectorAll('label')].map(l=>({label:(l.querySelector('span')?.textContent||l.firstChild?.textContent||'').trim(),value:l.querySelector('input')?.value})).filter(x=>x.value!==undefined),message:document.querySelector('.notice')?.textContent}));
  assert(state.copy.startsWith('車検証読取結果'),'must capture actual current form copy button');
  const row={caseId:f.caseId,filename:f.filename,sha256:f.sha256,...state};results.push(row);
  fs.writeFileSync(path.join(privateDir,`${tag}-${f.caseId}.txt`),state.copy+'\n');
  fs.writeFileSync(path.join(privateDir,`${tag}.json`),JSON.stringify({route:'/vehicle-workflow-v2?mode=new',source:'Actual copied current form; localhost production build with auth/DB fixtures only',results,requests,errors},null,2));
  console.log(JSON.stringify({case:f.caseId,eventCount:state.events.length,fields:state.copy.split('\n').length,priorityCount:Object.keys(state.priority||{}).length,message:state.message}));
 }
 assert(!requests.some(r=>r.method!=='GET'&&!r.path.includes('/auth/')),'no DB writes permitted');
 console.log(JSON.stringify({cases:results.length,errors,dbWrites:0}));
}finally{await browser.close()}
