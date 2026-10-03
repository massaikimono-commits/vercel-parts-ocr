// Run against a local production build only. All Supabase traffic is fixture-only.
// ICB_PLAYWRIGHT_MODULE points at an externally installed playwright package.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ICB_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.ICB_TEST_BASE_URL || 'http://127.0.0.1:4317';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'fixture runner is localhost-only');
const out = process.env.ICB_EVIDENCE_DIR || 'evidence/icb-overnight-20261003';
fs.mkdirSync(out, { recursive: true });
const browser = process.env.ICB_TEST_CDP ? await chromium.connectOverCDP(process.env.ICB_TEST_CDP) : await chromium.launch({ executablePath: process.env.ICB_CHROME_PATH });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const userId = '00000000-0000-4000-8000-000000000001';
const day = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
const customer = {id:'customer-1',name:'検証 太郎',company_name:null,schedule_display_name:null,phone:'090-0000-0000'};
const vehicle = {id:'vehicle-1',customer_id:customer.id,registration_number:'品川500あ0010',registration_number_last4:'0010',maker:'テスト',model:'検証車',vehicle_type:'乗用',model_code:'TEST',chassis_number:'TEST-0001'};
const work = {id:'work-1',vehicle_id:vehicle.id,reason:'点検',status:'scheduled',work_completed:false,is_waiting_service:false,inspection_schedule_type:'6',needs_loaner:false,is_urgent:false};
const inbound = {id:'entry-1',vehicle_id:vehicle.id,work_order_id:work.id,entry_type:'customer_visit',starts_at:day+'T09:00:00+09:00',ends_at:day+'T10:00:00+09:00',print_time_mode:'exact',print_time_label_override:null};
const delivery = {...inbound,id:'entry-2',entry_type:'delivery',starts_at:day+'T16:00:00+09:00',ends_at:day+'T17:00:00+09:00',print_time_label_override:'16時以降'};
let alert = {severity:'warning',alert_code:'fixture-alert',occurred_at:day+'T01:00:00Z',message:'検証用ログイン通知'};
let empty = false, detailFail = false, searchFail = false, historyFail = false, last4Reads = 0;
const requests = [], errors = [], checks = [], routeAudit = [];
let passed=false;
let settingsFail=false, vehicleHistoryFail=false;
let settingsRows=[];
let calendarFail=false, rangeFail=false, historyRows=false, loanerFail=false, loanerOverflow=false;
let leaseRows=[];
let leaseRefreshFail=false, leaseWriteCompleted=false;
await context.route('https://example.supabase.co/**', async route => {
  const request = route.request(); const url = new URL(request.url());
  const path = url.pathname; requests.push({method:request.method(),path,query:url.search});
  let data = [], status = 200;
  if(path.includes('/auth/')) data = {user:{id:userId},access_token:'fixture'};
  else if(path.endsWith('/app_user_profiles')) data = {is_active:true};
  else if(path.endsWith('/my_login_security_alerts')) data = [alert];
  else if(path.endsWith('/my_login_security_history')) {
    if(historyFail){status=500;data={message:'fixture network failure'};}
    else data=[{occurred_at:day+'T01:00:00Z',event_type:'login_success',ip_address:'2001:db8::0123:4567:89ab:cdef',user_agent:'iPhone Safari',aal:'aal2'}];
  }
  else if(path.endsWith('/staff_members') || path.endsWith('/external_vendors')) {
    if(settingsFail){status=500;data={message:'fixture settings failure'};}
    else if(request.method()==='POST') { await new Promise(r=>setTimeout(r,120)); settingsRows=[{id:'setting-1',...request.postDataJSON()}]; data=null; }
    else if(request.method()==='PATCH') data=null;
    else data=settingsRows;
  }
  else if(vehicleHistoryFail && /vehicle_action_history|vehicle_documents|lease_maintenance_contracts/.test(path)) {status=500;data={message:'fixture history failure'};}
  else if(path.endsWith('/schedule_time_availability')) data={options:[]};
  else if(path.endsWith('/schedule_day_capacity')) data={morning_count:0,afternoon_count:0,morning_inspection_count:0,morning_total_limit:15,afternoon_total_limit:10,morning_inspection_warning:4};
  else if(path.endsWith('/schedule_entries')) {
    if(rangeFail){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'fixture range failure'})});return;}
    const id=url.searchParams.get('id');
    if(id && detailFail){status=500;data={message:'fixture detail failure'};}
    else if(id) data=id==='eq.entry-1'?inbound:id==='eq.entry-2'?delivery:null;
    else data=empty?[]:[inbound,delivery];
  }
  else if(path.endsWith('/vehicles')) {
    if(url.searchParams.has('registration_number_last4')){last4Reads++; await new Promise(r=>setTimeout(r,120));}
    if(searchFail){status=500;data={message:'fixture search failure'};}else data=empty?[]:[url.searchParams.get('id')==='eq.vehicle-2'?{...vehicle,id:'vehicle-2',registration_number_last4:'0011'}:vehicle];
  }
  else if(path.endsWith('/customers')) data=[customer];
  else if(path.endsWith('/work_orders')) data=url.searchParams.has('needs_loaner')?(loanerOverflow?Array.from({length:301},(_,i)=>({...work,id:'loaner-work-'+i,needs_loaner:true,planned_delivery_at:day+'T17:00:00+09:00'})):[{...work,needs_loaner:true,planned_delivery_at:day+'T17:00:00+09:00'}]):[work];
  else if(path.endsWith('/business_calendar')) {if(calendarFail){status=500;data={message:'fixture calendar failure'};}else data=[];}
  else if(path.endsWith('/loaner_vehicle_availability')) {
    if(loanerFail){status=500;data={message:'fixture loaner failure'};} else data={vehicles:[]};
  }
  else if(path.endsWith('/vehicle_action_history') && historyRows) data=[{id:'action-1',action_type:'OTHER',created_at:day+'T00:00:00Z',details:{}}];
  else if(path.endsWith('/lease_maintenance_contracts')) {
    if(request.method()==='PATCH') {await new Promise(r=>setTimeout(r,180));const id=url.searchParams.get('id')?.replace(/^eq\./,'');data={...leaseRows.find(r=>r.id===id),...request.postDataJSON()};leaseRows=leaseRows.map(r=>r.id===id?data:r);leaseWriteCompleted=true;}
    else if(leaseRefreshFail && leaseWriteCompleted){status=500;data={message:'fixture post-save refresh failure'};}
    else data=leaseRows;
  }
  if(request.headers()['accept']?.includes('vnd.pgrst.object') && Array.isArray(data)) data=data[0]||null;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data),headers:{'content-range':'0-0/1'}});
});
// Block every unexpected external request, including real databases and OCR assets.
await context.route(/https?:\/\/(?!127\.0\.0\.1|localhost|example\.supabase\.co).*/, r=>r.abort());
await context.addInitScript(({userId})=>{
  const token='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+86400})) + '.fixture';
  localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+86400,expires_in:86400,token_type:'bearer',user:{id:userId,aud:'authenticated',role:'authenticated'}}));
},{userId});
const page=await context.newPage(); page.on('pageerror', e=>errors.push(e.message));
const check=(name)=>{checks.push(name);console.log('PASS '+name);};
async function ready(){await page.waitForTimeout(250); await page.locator('main').first().waitFor();}
async function noOverflow(){return await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1}));}
try {
  await page.goto(base+'/'); await page.getByText('⚠ セキュリティ確認',{exact:true}).waitFor(); check('home source-owned security alert');
  await page.getByText('⚠ セキュリティ確認',{exact:true}).click();
  await page.getByRole('button',{name:'確認済みにする',exact:true}).click();
  assert(await page.getByRole('button',{name:'確認済み',exact:true}).isDisabled());
  await page.goto(base+'/'); await page.getByRole('heading',{name:'1週間のスケジュール'}).waitFor();
  assert.equal(await page.getByText('⚠ セキュリティ確認',{exact:true}).count(),0); check('acknowledged event hides on home');
  alert={...alert,occurred_at:day+'T02:00:00Z'};
  await page.reload(); await page.getByText('⚠ セキュリティ確認',{exact:true}).waitFor();check('new security event reappears');
  await page.goto(base+'/schedule/search');
  await page.getByRole('textbox',{name:'予定を検索する文字'}).fill('１０');
  await page.getByRole('textbox',{name:'予定を検索する文字'}).press('Enter');
  await page.getByRole('textbox',{name:'予定を検索する文字'}).press('Enter');
  await page.getByRole('button',{name:'予定詳細',exact:true}).waitFor();
  assert.equal(last4Reads,1); assert.equal(await page.locator('.resultSetRow').count(),1);check('NFKC last4 search, duplicate Enter guard, one work-order result');
  assert((await page.locator('.deliveryLeg').innerText()).includes('16時以降'));check('persisted delivery label override stays visible');
  await page.getByRole('button',{name:'予定詳細',exact:true}).click();
  await page.getByRole('heading',{name:'検証 太郎',exact:true}).waitFor();
  await page.getByRole('button',{name:'← 戻る',exact:true}).click();
  await page.getByRole('button',{name:'予定詳細',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'予定を検索する文字'}).inputValue(),'10');check('search → detail → back restores search and reloads current results');
  await page.getByRole('button',{name:'予定詳細',exact:true}).click();
  await page.getByRole('heading',{name:'検証 太郎',exact:true}).waitFor();
  detailFail=true; await page.goto(base+'/schedule/detail?entry=entry-1');
  await page.getByRole('button',{name:'再試行',exact:true}).waitFor();
  assert.equal(await page.locator('.stateButton').isDisabled(),true);
  detailFail=false; await page.getByRole('button',{name:'再試行',exact:true}).click();
  await page.getByRole('heading',{name:'検証 太郎',exact:true}).waitFor();check('detail failure prevents partial actions and retry recovers');
  const detailResponse=page.waitForResponse(r=>r.url().includes('/schedule_entries?') && r.url().includes('id=eq.entry-2'));
  await page.evaluate(()=>history.pushState(null,'','/schedule/detail?entry=entry-2'));
  await detailResponse; await page.getByRole('heading',{name:'検証 太郎',exact:true}).waitFor();check('same-route entry query change loads the new detail');
  searchFail=true;await page.goto(base+'/schedule/search');
  await page.getByText('検索を完了できませんでした。上の検索ボタンから再試行してください。').waitFor();
  searchFail=false;await page.getByRole('button',{name:'検索',exact:true}).click();await page.getByRole('button',{name:'予定詳細',exact:true}).waitFor();check('search failure and retry are distinct from empty');
  empty=true; await page.goto(base+'/schedule/search');
  await page.getByText('一致する予定がありません。検索条件や期間を変更してください。').waitFor();check('search empty state after real query'); empty=false;
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:1000});
    for(const path of ['/', '/schedule/search','/schedule/detail?entry=entry-1','/settings/login-history']){
      await page.goto(base+path);await ready();
      if(path.includes('login-history')) await page.getByText('2001:db8::0123:4567:89ab:cdef',{exact:true}).waitFor();
      if(path==='/'){
        const firstDay=await page.locator('.homeWeekDay').first().getAttribute('class');
        if(width===390)assert(firstDay.includes('today'),'today is the first mobile weekly card');
      }
      const dimensions=await noOverflow();
      if(dimensions.overflow){
        const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('main,main>*,.homeHead,.notice,.mobileActions')).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,scroll:e.scrollWidth})).filter(x=>x.right>innerWidth));
        console.log(JSON.stringify(overflow));await page.screenshot({path:`${out}/overflow-${width}.png`,fullPage:true});
      }
      assert(!dimensions.overflow,`${path} horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
      await page.screenshot({path:`${out}/${width}-${path.includes('login-history')?'login-history':path.includes('detail')?'detail':path.includes('search')?'search':'home'}.png`,fullPage:true});
    }
    check(`responsive no page overflow at ${width}`);
  }
  historyFail=true; await page.goto(base+'/settings/login-history');await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('まだログイン履歴はありません。',{exact:true}).count(),0);check('login history failure differs from empty'); historyFail=false;
  const routes=['/schedule','/schedule/week','/schedule/month','/schedule/new','/schedule/edit','/schedule/active','/schedule/workload','/schedule/loaners','/customer-vehicles','/customer-vehicles/history','/customer-vehicles/photos','/customer-vehicles/bulk-import','/customer-vehicles/lease-maintenance','/loaners','/loaners/week','/inspection','/inspection/select','/settings/staff','/settings/vendors','/settings/business-calendar','/settings/business-calendar/edit','/schedule/print','/inspection/print','/parts-print','/vehicle-workflow?mode=new','/vehicle-workflow-fast?mode=new','/vehicle-workflow-v2?mode=new','/vehicle-workflow-v3?mode=new','/this-page-does-not-exist'];
  for(const path of routes){
    await page.goto(base+path);await ready();
    routeAudit.push({path,main:await page.locator('main').count(),dimensions:await noOverflow(),title:await page.title(),headings:await page.locator('h1').allTextContents()});
  }
  check('28 additional real core/print/PDF-entry routes and 404 recovery smoke audit');
  await page.goto(base+'/schedule?day=2026-10-01');
  await page.getByLabel('表示する予定日').waitFor();
  assert.equal(await page.getByLabel('表示する予定日').inputValue(),'2026-10-01');
  await page.locator('.desktopQuickNav').getByRole('link',{name:'今日',exact:true}).click();
  await page.waitForFunction(day=>document.querySelector('.datePicker')?.value===day,day);
  assert.equal(await page.locator('.desktopQuickNav').getByRole('link',{name:'今日',exact:true}).getAttribute('aria-current'),'page');
  await page.getByRole('button',{name:'← 前日',exact:true}).click();
  await page.waitForFunction(day=>document.querySelector('.datePicker')?.value!==day,day);
  assert.equal(await page.locator('.desktopQuickNav').getByRole('link',{name:'今日',exact:true}).getAttribute('aria-current'),null);
  await page.locator('.desktopQuickNav').getByRole('link',{name:'今日',exact:true}).click();
  await page.waitForFunction(day=>document.querySelector('.datePicker')?.value===day,day);
  check('same-route Today/day controls and active navigation remain in sync');
  searchFail=true; await page.goto(base+'/customer-vehicles'); await ready();
  await page.getByRole('heading',{name:'車両検索',exact:true}).waitFor();
  await page.getByRole('button',{name:'再検索',exact:true}).waitFor();
  assert.equal(await page.getByText('該当する車両がありません。',{exact:false}).count(),0);
  searchFail=false; await page.getByRole('button',{name:'再検索',exact:true}).click();
  await page.locator('.vehicleList button').first().waitFor();
  check('customer vehicle search failure differs from empty and retry recovers');
  vehicleHistoryFail=true;
  for(const [path,emptyText] of [['history','この車両に紐付く既存履歴はまだありません。'],['photos','この車両には写真履歴がありません。'],['lease-maintenance','契約履歴はまだありません。']]) {
    await page.goto(base+'/customer-vehicles/'+path+'?vehicle=vehicle-1'); await ready();
    await page.getByRole('button',{name:'再読み込み',exact:true}).waitFor();
    assert.equal(await page.getByText(emptyText,{exact:true}).count(),0);
    vehicleHistoryFail=false; await page.getByRole('button',{name:'再読み込み',exact:true}).click();
    await page.getByText(emptyText,{exact:true}).waitFor();
    vehicleHistoryFail=true; check(path+' initial failure avoids false empty and retry recovers');
  }
  vehicleHistoryFail=false;
  for (const [path,label,emptyText] of [['staff','社員','社員がまだ登録されていません。'],['vendors','外注先','外注先がまだ登録されていません。']]) {
    settingsRows=[]; settingsFail=true;
    await page.goto(base+'/settings/'+path); await ready();
    await page.getByRole('status').filter({hasText:'読み込み'}).waitFor();
    assert.equal(await page.getByText(emptyText,{exact:true}).count(),0);
    settingsFail=false; await page.getByRole('button',{name:'一覧を再読み込み'}).click();
    await page.getByText(emptyText,{exact:true}).waitFor();
    await page.getByLabel(label+'名',{exact:true}).fill('検証担当');
    const before=requests.filter(r=>r.method==='POST' && /staff_members|external_vendors/.test(r.path)).length;
    await page.getByLabel(label+'名',{exact:true}).evaluate(el=>{el.form.requestSubmit();el.form.requestSubmit();});
    await page.getByRole('button',{name:'保存',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.method==='POST' && /staff_members|external_vendors/.test(r.path)).length-before,1);
    await page.getByLabel(label+'名',{exact:true}).last().fill('   ');
    const updates=requests.filter(r=>r.method==='PATCH').length;
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByRole('status').filter({hasText:label+'名を入力してください。'}).waitFor();
    assert.equal(requests.filter(r=>r.method==='PATCH').length,updates);
    check(path+' settings error/retry, keyboard form duplicate guard and blank-name validation');
  }
  for(const width of [390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    for(const path of ['/customer-vehicles','/customer-vehicles/history?vehicle=vehicle-1','/customer-vehicles/photos?vehicle=vehicle-1','/customer-vehicles/lease-maintenance?vehicle=vehicle-1','/settings/staff','/settings/vendors']) {
      await page.goto(base+path); await ready();
      assert(!(await noOverflow()).overflow,path+' continuation overflow at '+width);
      await page.screenshot({path:`${out}/continuation-${width}-${path.split('/').pop().split('?')[0]}.png`,fullPage:true});
    }
    check('continuation six routes responsive at '+width);
  }
  for(const path of ['/schedule/week','/schedule/month']) {
    await page.goto(base+path+'?day=2026-99-99');await ready();
    if(path.endsWith('week')) assert.equal(await page.getByLabel('表示する週の日付').inputValue(),day);
    else await page.getByRole('heading',{level:1}).waitFor();
    await page.evaluate(path=>history.pushState(null,'',path+'?day=2026-12-31'),path);
    if(path.endsWith('week')) await page.waitForFunction(()=>document.querySelector('input[type=date]')?.value==='2026-12-31');
    else await page.getByRole('heading',{name:'2026年12月',exact:true}).waitFor();
    await page.evaluate(path=>history.pushState(null,'',path+'?day=2027-01-01'),path);
    if(path.endsWith('week')) await page.waitForFunction(()=>document.querySelector('input[type=date]')?.value==='2027-01-01');
    else await page.getByRole('heading',{name:'2027年1月',exact:true}).waitFor();
    check(path+' invalid date fallback and same-route year-boundary navigation');
    if(path.endsWith('week')) {
      await page.getByRole('button',{name:'← 前週',exact:true}).click();
      await page.waitForURL('**/schedule/week?day=2026-12-21');
      await page.reload();await page.getByLabel('表示する週の日付').waitFor();
      assert.equal(await page.getByLabel('表示する週の日付').inputValue(),'2026-12-21');
    } else {
      await page.getByRole('button',{name:'← 前月',exact:true}).click();
      await page.waitForURL('**/schedule/month?day=2026-12-01');
      await page.reload();await page.getByRole('heading',{name:'2026年12月',exact:true}).waitFor();
    }
    check(path+' period controls persist in URL and survive reload');
    rangeFail=true;await page.reload();await page.getByRole('button',{name:'再読み込み',exact:true}).waitFor();
    if(path.endsWith('week')) assert.equal(await page.getByText('予定なし',{exact:true}).count(),0);
    rangeFail=false;await page.getByRole('button',{name:'再読み込み',exact:true}).click();
    await page.getByRole('status').filter({hasText:'予定を表示しています。'}).waitFor();
    check(path+' read error/retry avoids false empty');
  }
  calendarFail=true;
  for(const path of ['/settings/business-calendar','/settings/business-calendar/edit']) {
    await page.goto(base+path);await ready();await page.getByRole('button',{name:'再読み込み',exact:true}).waitFor();
    assert.equal(await page.locator('.monthsGrid,.missingCount').count(),0);
    calendarFail=false;await page.getByRole('button',{name:'再読み込み',exact:true}).click();await page.locator('.monthsGrid').waitFor();
    calendarFail=true;check(path+' failure is not a missing calendar and retry recovers');
  }
  calendarFail=false;
  for(const path of ['history','photos','lease-maintenance']) {
    await page.goto(base+'/customer-vehicles/'+path+'?vehicle=vehicle-1');await ready();
    await page.getByRole('heading',{level:1}).filter({hasText:'車番 10'}).waitFor();
    await page.evaluate(path=>history.pushState(null,'',path+'?vehicle=vehicle-2'),'/customer-vehicles/'+path);
    await page.getByRole('heading',{level:1}).filter({hasText:'車番 11'}).waitFor();
    check(path+' same-route vehicle query resets scoped state');
  }
  historyRows=true;await page.goto(base+'/customer-vehicles/history?vehicle=vehicle-1');await ready();
  await page.locator('.sourceFilters').getByRole('button',{name:'記録簿',exact:true}).click();
  await page.getByText('読み込み済み履歴に、この種類の履歴はありません。',{exact:true}).waitFor();
  assert.equal(await page.getByText('この車両に紐付く既存履歴はまだありません。',{exact:true}).count(),0);
  historyRows=false;check('history filtered-empty describes loaded subset');
  const contract=(id,start)=>({id,vehicle_id:'vehicle-1',contract_number:id,contract_start_date:start,contract_end_date:'2028-12-31',created_at:'2026-01-01T00:00:00Z',needs_review:true,substitute_car_eligible_work_types:[],inspection_intervals_months:[],tire_maker_names:[]});
  leaseRows=[contract('newer','2026-10-01'),contract('older','2026-01-01')];
  await page.goto(base+'/customer-vehicles/lease-maintenance?vehicle=vehicle-1');await ready();
  await page.locator('.historyCard').getByRole('button',{name:'内容を見る / 編集',exact:true}).nth(1).click();
  await page.getByLabel('契約開始日',{exact:true}).fill('2027-01-01');
  await page.getByRole('button',{name:'変更を保存（要確認に戻す）',exact:true}).click();
  assert(await page.getByLabel('契約開始日',{exact:true}).isDisabled());
  assert(await page.getByRole('button',{name:'＋ 新しい契約を登録',exact:true}).isDisabled());
  await page.getByRole('status').filter({hasText:'契約内容を保存しました。'}).waitFor();
  assert((await page.locator('.summary').innerText()).includes('2027-01-01'));
  check('lease saving locks editor and updated contract becomes latest');
  leaseRefreshFail=true;leaseWriteCompleted=false;
  await page.getByLabel('契約開始日',{exact:true}).fill('2028-01-01');
  await page.getByRole('button',{name:'変更を保存（要確認に戻す）',exact:true}).click();
  await page.getByRole('status').filter({hasText:'契約内容は保存済みです。'}).waitFor();
  const leaseWrites=requests.filter(r=>r.method==='PATCH' && r.path.endsWith('/lease_maintenance_contracts')).length;
  leaseRefreshFail=false;await page.getByRole('button',{name:'契約履歴を再読み込み',exact:true}).click();
  await page.getByRole('status').filter({hasText:'契約履歴を再読み込みました。'}).waitFor();
  assert.equal(requests.filter(r=>r.method==='PATCH' && r.path.endsWith('/lease_maintenance_contracts')).length,leaseWrites);
  leaseRows=[];check('lease committed write with failed refresh recovers via read-only retry');
  loanerFail=true;await page.goto(base+'/schedule/loaners');await ready();
  await page.getByRole('button',{name:'代車を割当',exact:true}).first().click();
  await page.getByRole('status').filter({hasText:'代車空き確認'}).waitFor();
  loanerFail=false;await page.getByRole('button',{name:'代車を割当',exact:true}).first().click();
  await page.getByRole('status').filter({hasText:'空いている代車を選択してください。'}).waitFor();
  check('loaner availability error/retry releases controls');
  loanerOverflow=true;await page.reload();await page.getByRole('alert').filter({hasText:'表示上限300件を超えています。'}).waitFor();
  assert.equal(await page.locator('.board .row').count(),300);loanerOverflow=false;
  check('loaner sentinel warns that capped demand is incomplete');
  for(const width of [390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    for(const path of ['/schedule/week','/schedule/month','/schedule/loaners','/settings/business-calendar','/settings/business-calendar/edit']) {
      await page.goto(base+path);await ready();
      const dimensions=await noOverflow();
      assert(!dimensions.overflow,path+' phase3 overflow at '+width+': '+JSON.stringify(dimensions));
      await page.screenshot({path:`${out}/phase3-${width}-${path.replaceAll('/','-')}.png`,fullPage:true});
    }
    check('phase3 five routes responsive at '+width);
  }
  assert.deepEqual(errors,[],'no browser page errors');
  passed=true;
} finally {
  fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({status:passed?'PASS':'FAIL',fixtureOnly:true,sharedDatabaseTouched:false,checks,errors,routeAudit,requests},null,2));
  await context.close();await browser.close();
}
