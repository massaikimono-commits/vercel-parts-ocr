import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

function functionSource(path, names) {
  const source=fs.readFileSync(path,'utf8');
  const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const found=[];
  function visit(node) {
    if(ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.push(node.getText(tree).replace(/^export /,''));
    ts.forEachChild(node,visit);
  }
  visit(tree); assert.equal(found.length,names.length,path+' functions found'); return found.join('\n');
}
function runFunctions(path,names,values) {
  const ctx=vm.createContext(values);
  vm.runInContext(ts.transpile(functionSource(path,names),{target:ts.ScriptTarget.ES2022}),ctx);
  return ctx;
}
function deferred() {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function query(result) {
  const chain=new Proxy({}, {get:(_,key)=>key==='then' ? Promise.resolve(result).then.bind(Promise.resolve(result)) : ()=>chain});
  return chain;
}
const path='app/schedule/edit/page.tsx';
const calendar=runFunctions('app/lib/calendar-day.ts',['isCalendarDay'],{});
function editContext(extra={}) {
 const state={entry:{id:'a',work_order_id:'w',entry_type:'customer_visit',starts_at:'2026-10-03T00:00:00Z'},loaded:true,optionsBusy:false,day:'2026-10-03',selectedOption:{startsAt:'2026-10-03T00:00:00Z',endsAt:'2026-10-03T01:00:00Z',mode:'exact'},isWaitingService:false,deliveryEnabled:false,stayReason:'',staffId:'',vendorId:'',vendorName:'',reason:'一般整備',cancelReason:'',actionLock:{current:false},loadLock:{current:false},mounted:{current:true},redirectTimer:{current:null},options:[],optionRequest:{current:0},safeActionError:(_,e)=>e.message,isCalendarDay:calendar.isCalendarDay,setWarnings:()=>{},setBusy:()=>{},setLoaded:v=>{state.loaded=v;},setEntry:v=>{state.entry=v;},setMessage:v=>{state.message=v;},setShowCancel:()=>{},window:{setTimeout:()=>1},location:{assign:()=>{}},...extra};
 return runFunctions(path,['save','cancelReservation','dateKey','buildDeliveryTarget'],state);
}
let calls=[];const pending=deferred();
let ctx=editContext({supabase:{rpc:(name)=>{calls.push(name);return pending.promise;}}});
const save=ctx.save();await ctx.save();await ctx.cancelReservation();assert.equal(calls.length,1,'one mutation across same-tick save/cancel');pending.resolve({data:{updated:false},error:null});await save;assert.equal(ctx.actionLock.current,false);
console.log('PASS night shared edit save/cancel synchronous guard');
ctx=editContext({day:'2026-10-04',supabase:{rpc:()=>{throw new Error('must not run');}}});await ctx.save();assert.match(ctx.message,/変更日/);
ctx=editContext({entry:{id:'delivery',entry_type:'delivery'},isWaitingService:true,supabase:{rpc:()=>{throw new Error('must not run');}}});await ctx.save();assert.match(ctx.message,/来社予定/);
console.log('PASS night mismatched-date and delivery-row waiting mutation rejected');
let writes=0, sync=0;ctx=editContext({supabase:{rpc:async(name)=>{writes++;return name==='reschedule_schedule_entry_v2'?{data:{updated:true},error:null}:{error:new Error('assignment failed')};}},syncDeliveryPlan:async()=>{sync++;}});await ctx.save();assert.equal(writes,2);assert.equal(ctx.loaded,false);assert.equal(ctx.entry,null);assert.match(ctx.message,/変更済み/);await ctx.save();assert.equal(writes,2);assert.equal(sync,0);
console.log('PASS night partial edit save blocks blind retry and requires canonical reread');
ctx=editContext({supabase:{rpc:async()=>{throw new Error('network result unknown');}}});await ctx.save();assert.equal(ctx.loaded,false);assert.match(ctx.message,/結果を確認できません/);assert.equal(ctx.actionLock.current,false);
console.log('PASS night uncertain mutation response fails closed');
ctx=editContext({supabase:{rpc:async()=>({data:{cancelled:true},error:null})}});await ctx.cancelReservation();await ctx.cancelReservation();assert.equal(ctx.actionLock.current,true,'completed cancellation remains locked through redirect');
console.log('PASS night successful cancel cannot be repeated during delayed navigation');
const old=deferred(), latest=deferred();let reads=0,options=[];let optionBusy=[];const waits=[];
ctx=runFunctions(path,['loadOptions','jstIso','plusMinutes','dateKey','timeKey'],{entry:null,reason:'一般整備',isWaitingService:false,optionRequest:{current:0},mounted:{current:true},isCalendarDay:calendar.isCalendarDay,setOptions:v=>{options=v;},setSelected:()=>{},setOptionsBusy:v=>optionBusy.push(v),setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{rpc:async(name,args)=>{if(name==='schedule_time_options')return ++reads===1?old.promise:latest.promise;waits.push(args.p_is_waiting_service);return {data:{allowed:true},error:null};}}});
const base={id:'a',entry_type:'customer_visit',starts_at:'2026-10-03T00:00:00Z',print_time_mode:'exact'};
const first=ctx.loadOptions('2026-10-03',base,'一般整備',true),second=ctx.loadOptions('2026-10-04',base,'一般整備',true);
const opt=day=>({key:'09',group:'morning',mode:'exact',startsAt:day+'T00:00:00Z',endsAt:day+'T01:00:00Z'});
latest.resolve({data:{options:[opt('2026-10-04')]},error:null});await second;old.resolve({data:{options:[opt('2026-10-03')]},error:null});await first;assert.equal(options[0].startsAt.slice(0,10),'2026-10-04');assert.equal(optionBusy.at(-1),false);assert(waits.every(Boolean));
console.log('PASS night options latest-response ownership and explicit waiting payload');
let queryCalls=0;const search=runFunctions('app/schedule/search/page.tsx',['search','normalizeSearchInput','isShortPlateNumberQuery'],{searching:{current:false},query:'',range:'future',setRange:()=>{},setRows:()=>{},setMessage:()=>{},supabase:{from:()=>{queryCalls++;throw new Error('invalid inputs must not query');}}});for(const q of ['山田','09012345678','品川300','12345',''])await search.search('future',q);assert.equal(queryCalls,0);
console.log('PASS night schedule search rejects name/phone/full plate without database traffic');
const source=fs.readFileSync(path,'utf8');assert.match(source,/ScheduleEditContent key=\{`\$\{targetId\}:\$\{directCancel\}`\}/);assert.match(source,/fieldset disabled=\{busy \|\| optionsBusy \|\| actionLock.current \|\| !loaded\}/);assert.match(source,/entry.entry_type!=="delivery" && \(entry.entry_type==="customer_visit"/);
console.log('PASS night query-owned edit form and fail-closed fieldset wiring');
function activeContext(extra={}){
 const state={actionLock:{current:false},registrationBlocked:false,mainOptionsBusy:false,deliveryOptionsBusy:false,vehicle:{id:'v'},entryType:'customer_visit',isWaitingService:true,addDelivery:false,selectedDelivery:null,day:'2026-10-03',reason:'一般整備',notes:'',inspectionScheduleType:'',urgent:false,needsLoaner:false,staffId:'',vendorId:'',vendorName:'',mounted:{current:true},redirectTimer:{current:null},isCalendarDay:calendar.isCalendarDay,mainTimes:()=>({startsAt:'2026-10-03T00:00:00Z',endsAt:'2026-10-03T01:00:00Z',printMode:'exact'}),setWarnings:()=>{},setErrors:()=>{},setBusy:()=>{},setMessage:v=>{state.message=v;},setRegistrationBlocked:v=>{state.registrationBlocked=v;},checkSlot:async()=>({allowed:true,hardErrors:[],warnings:[],overrideRequired:false}),window:{setTimeout:()=>1},location:{assign:()=>{}},safeActionError:(_,e)=>e.message,...extra};
 return runFunctions('app/schedule/active/page.tsx',['submit','optionMatchesDay'],state);
}
let inserts=0;const firstCheck=deferred();ctx=activeContext({checkSlot:()=>firstCheck.promise,supabase:{from:()=>{inserts++;return query({data:{id:'w'},error:null});}}});const registration=ctx.submit();await ctx.submit();firstCheck.resolve({allowed:true,hardErrors:[],warnings:[],overrideRequired:false});await registration;assert.equal(inserts,2,'waiting writes work and inbound only, never delivery');assert.equal(ctx.actionLock.current,true);await ctx.submit();assert.equal(inserts,2);
console.log('PASS night active registration serialized through preflight and delayed redirect; waiting has no delivery insert');
inserts=0;ctx=activeContext({supabase:{from:()=>{inserts++;return query(inserts===1?{data:{id:'w'},error:null}:{error:new Error('inbound write failed')});}}});await ctx.submit();assert(ctx.registrationBlocked);assert.match(ctx.message,/一部が保存/);await ctx.submit();assert.equal(inserts,2);
console.log('PASS night active partial registration blocks duplicate retry');
const latestActive=deferred(),oldActive=deferred();reads=0;options=[];ctx=runFunctions('app/schedule/active/page.tsx',['loadMainOptions'],{mainRequest:{current:0},day:'2026-10-03',entryType:'customer_visit',mounted:{current:true},isCalendarDay:calendar.isCalendarDay,setTimeOptions:v=>{options=v;},setTimeKey:()=>{},setMainOptionsBusy:()=>{},setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{rpc:()=>++reads===1?oldActive.promise:latestActive.promise}});const older=ctx.loadMainOptions();ctx.day='2026-10-04';const newer=ctx.loadMainOptions();latestActive.resolve({data:{options:[opt('2026-10-04')]},error:null});await newer;oldActive.resolve({data:{options:[opt('2026-10-03')]},error:null});await older;assert.equal(options[0].startsAt.slice(0,10),'2026-10-04');
console.log('PASS night active stale time options cannot replace current day');
let finished=[];ctx=runFunctions('app/loaners/week/page.tsx',['loadWeek'],{loadSequence:{current:0},days:['2026-10-03'],weekStart:'2026-10-03',setRows:()=>{},setLoaded:()=>{},setDemandCapped:()=>{},setBusy:v=>finished.push(v),setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{from:()=>query({error:new Error('demand read failure')}),rpc:async()=>({data:{vehicles:[],counts:{}},error:null})}});await ctx.loadWeek();assert.equal(finished.at(-1),false);
console.log('PASS night weekly loaner demand error releases loading');
let commits=[];reads=0;const oldDemand=deferred(),newDemand=deferred();ctx=runFunctions('app/loaners/week/page.tsx',['loadWeek'],{loadSequence:{current:0},days:['2026-10-03'],weekStart:'2026-10-03',setRows:v=>commits.push(v),setLoaded:()=>{},setDemandCapped:()=>{},setBusy:()=>{},setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{from:()=>query(++reads===1?oldDemand.promise:newDemand.promise),rpc:async()=>({data:{vehicles:[],counts:{}},error:null})}});const firstWeek=ctx.loadWeek(),secondWeek=ctx.loadWeek();newDemand.resolve({data:[],error:null});await secondWeek;oldDemand.resolve({data:[],error:null});await firstWeek;assert.equal(commits.length,3,'two clears plus latest commit only');
console.log('PASS night weekly loaner stale snapshots ignored');
let board=[];finished=[];ctx=runFunctions('app/loaners/page.tsx',['load'],{loadSequence:{current:0},readPending:{current:false},day:'2026-10-03',setLoaded:()=>{},setVehicles:v=>{board=v;},setCounts:()=>{},setBusy:v=>finished.push(v),setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{rpc:async()=>{throw new Error('network reject');}}});await ctx.load();assert.equal(finished.at(-1),false);assert.equal(board.length,0);assert.equal(ctx.readPending.current,false);
console.log('PASS night loaner main thrown network error releases controls and stale board');
reads=0;let messages=[];const boardOld=deferred(),boardNew=deferred();ctx=runFunctions('app/loaners/page.tsx',['load'],{loadSequence:{current:0},readPending:{current:false},day:'2026-10-03',setLoaded:()=>{},setVehicles:v=>{board=v;},setCounts:()=>{},setBusy:()=>{},setMessage:v=>messages.push(v),safeActionError:(_,e)=>e.message,supabase:{rpc:()=>++reads===1?boardOld.promise:boardNew.promise}});const boardFirst=ctx.load();ctx.day='2026-10-04';const boardSecond=ctx.load();boardNew.resolve({data:{vehicles:[{loanerVehicleId:'new'}]},error:null});await boardSecond;boardOld.resolve({data:{vehicles:[{loanerVehicleId:'old'}]},error:null});await boardFirst;assert.equal(board[0].loanerVehicleId,'new');assert.match(messages.at(-1),/2026-10-04/);
console.log('PASS night loaner main date ownership ignores old board');
const addPending=deferred();inserts=0;ctx=runFunctions('app/loaners/page.tsx',['addVehicle','setStatus','updateReservationStatus'],{actionLock:{current:false},readPending:{current:false},loaded:true,name:'Test',sourceType:'company_vehicle',provider:'',last4:'００１０',maker:'',model:'',setBusy:()=>{},setLoaded:()=>{},setVehicles:()=>{},setCounts:()=>{},setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{from:()=>({insert:payload=>{inserts++;assert.equal(payload.registration_last4,'0010');return addPending.promise;}}),rpc:()=>{throw new Error('shared mutation lock must reject other writes');}}});const add=ctx.addVehicle();await ctx.addVehicle();await ctx.setStatus('a','maintenance');await ctx.updateReservationStatus('r','returned');addPending.reject(new Error('network reject'));await add;assert.equal(inserts,1);assert.equal(ctx.actionLock.current,false);
console.log('PASS night loaner creation/status/reservation share synchronous mutation guard and NFKC');
const progressPending=deferred();let stateWrites=0, reloads=0;let works=[{id:'w',status:'scheduled',work_completed:false}];
ctx=runFunctions('app/schedule/page.tsx',['beginWorkAction','finishWorkAction','toggleWorkCompleted','toggleWorkProgress','advanceWorkState'],{loadPending:{current:false},loadSequence:{current:1},workActionLocks:{current:new Set()},setPendingWorkIds:()=>{},setWorkOrders:fn=>{works=fn(works);},setMessage:()=>{},safeActionError:(_,e)=>e.message,currentLoad:{current:async()=>{reloads++;}},supabase:{rpc:()=>{stateWrites++;return progressPending.promise;}}});const action=ctx.advanceWorkState(works[0]);await ctx.advanceWorkState(works[0]);await ctx.toggleWorkCompleted(works[0]);assert.equal(stateWrites,1);ctx.loadSequence.current=2;progressPending.resolve({data:{status:'in_progress'},error:null});await action;assert.equal(reloads,1,'navigation during mutation reloads current day');assert.equal(works[0].status,'scheduled','old mutation cannot patch new-day snapshot');assert.equal(ctx.workActionLocks.current.size,0);
ctx.supabase.rpc=async()=>{throw new Error('work update failed');};await ctx.advanceWorkState(works[0]);assert.equal(ctx.workActionLocks.current.size,0,'rejected action releases work guard');
console.log('PASS night per-work status serialization, stale-day reload and rejection release');
const workloadPath='app/schedule/workload/page.tsx';let snapshots=[];ctx=runFunctions(workloadPath,['load'],{assignmentLock:{current:false},loadSequence:{current:0},setLoaded:()=>{},setCapped:()=>{},setWorks:v=>snapshots.push(v),setScheduleLinks:()=>{},setVehicles:()=>{},setCustomers:()=>{},setStaffMembers:()=>{},setBusy:()=>{},setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{from:()=>query({error:new Error('workload read failed')})}});await ctx.load();assert(snapshots.every(v=>v.length===0));
const dates=runFunctions(workloadPath,['dayKey','elapsedStayDays'],{});assert.equal(dates.elapsedStayDays('malformed'),null);assert.equal(dates.elapsedStayDays(null),null);
console.log('PASS night workload failed reads remain unknown and malformed stay dates do not crash');
let assignments=0;const workerPending=deferred();ctx=runFunctions(workloadPath,['assignWorker'],{assignmentLock:{current:false},busy:false,loaded:true,loadSequence:{current:1},staffMembers:[{id:'staff',display_name:'Test'}],setAssigningWorkId:()=>{},setWorks:()=>{},setMessage:()=>{},safeActionError:(_,e)=>e.message,supabase:{rpc:()=>{assignments++;return workerPending.promise;}}});const assigning=ctx.assignWorker('w','staff');await ctx.assignWorker('w','staff');assert.equal(assignments,1);workerPending.reject(new Error('worker write failed'));await assigning;assert.equal(ctx.assignmentLock.current,false);
console.log('PASS night workload same-tick assignment serialized and rejection releases guard');
