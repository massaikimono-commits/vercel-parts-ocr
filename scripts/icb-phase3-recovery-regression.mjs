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
const calendar=runFunctions('app/lib/calendar-day.ts',['isCalendarDay'],{});
for(const day of ['2026-10-03','2024-02-29','2026-12-31','2027-01-01']) assert(calendar.isCalendarDay(day));
for(const day of [null,'','2026-02-29','2026-13-01','2026-10-99','2026-04-31','2026-1-01']) assert(!calendar.isCalendarDay(day));
console.log('PASS phase3 strict calendar date/leap/year boundaries');

for(const [route,name] of [['week','loadWeek'],['month','loadMonth']]) {
  const old=deferred(), latest=deferred(); let reads=0, entries=[], busy=[];
  const ctx=runFunctions(`app/schedule/${route}/page.tsx`,[name],{
    loadSequence:{current:0},weekStart:'2026-10-05',monthStart:'2026-10-01',weekDays:['2026-10-05'],
    addDays:(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),addMonths:()=> '2026-11-01',jstIso:d=>d,
    weekTitle:()=>'',monthTitle:()=>'',safeActionError:(_,e)=>e.message,
    supabase:{from:table=>query(table==='schedule_entries' ? (++reads===1?old.promise:latest.promise) : {data:[],error:null}),rpc:async()=>({data:[],error:null})},
    setEntries:x=>{entries=x;},setBusy:x=>busy.push(x),setLoaded:()=>{},setWorks:()=>{},setVehicles:()=>{},setCustomers:()=>{},setCalendar:()=>{},setCapacities:()=>{},setMessage:()=>{}
  });
  const first=ctx[name](), second=ctx[name]();
  old.resolve({data:[{id:'obsolete'}],error:null}); await first;
  assert.equal(entries.length,0,'old response cannot expose old schedule');
  assert.equal(busy.at(-1),true,'old finally cannot finish new request');
  latest.resolve({data:[{id:'current'}],error:null});await second;
  assert.equal(entries[0].id,'current'); assert.equal(busy.at(-1),false);
  console.log('PASS phase3 '+route+' obsolete response and busy ownership');
}

let countReads=0, deletes=0, busy=[];const pendingCount=deferred();
const deleteLock={current:false};
const customer=runFunctions('app/customer-vehicles/page.tsx',['deleteSelectedCustomer','selectVehicle'],{
  selectedCustomer:{id:'customer-a'},selectedVehicle:{id:'vehicle-a'},customerDeleteLock:deleteLock,customerSaveLock:{current:false},linkMutationLock:{current:false},
  supabase:{from:()=>({select:()=>({eq:()=>{countReads++;return pendingCount.promise;}}),delete:()=>{deletes++;return {eq:async()=>({error:null})};}})},
  window:{confirm:()=>false},customerLabel:()=>'',safeActionError:(_,e)=>e.message,setMessage:()=>{},setDeletingCustomer:v=>busy.push(v)
});
const deletion=customer.deleteSelectedCustomer();await customer.deleteSelectedCustomer();
customer.selectVehicle({id:'vehicle-b'}); // exits synchronously while deletion preflight owns selection
assert.equal(countReads,1);pendingCount.resolve({count:1,error:null});await deletion;
assert.equal(deletes,0,'cancelled confirmation never deletes');assert.equal(deleteLock.current,false);assert.equal(busy.at(-1),false);
customer.supabase.from=()=>({select:()=>({eq:async()=>{throw new Error('fixture rejection');}})});
await customer.deleteSelectedCustomer();assert.equal(deleteLock.current,false);assert.equal(busy.at(-1),false);
console.log('PASS phase3 customer delete preflight duplicate, selection, cancellation and rejection recovery');

let availabilityReads=0;const availability=deferred(), actionLock={current:false};busy=[];
const loaner=runFunctions('app/schedule/loaners/page.tsx',['openAllocation'],{
  actionLock,loanerStart:()=> '2026-10-05T09:00:00Z',allocationEnd:()=> '2026-10-05T16:00:00Z',
  supabase:{rpc:()=>{availabilityReads++;return availability.promise;}},setBusy:v=>busy.push(v),setMessage:()=>{},setAllocation:()=>{},safeActionError:(_,e)=>e.message
});
const allocation=loaner.openAllocation({assignment:null,work:{}});await loaner.openAllocation({assignment:null,work:{}});
assert.equal(availabilityReads,1);availability.reject(new Error('fixture rejection'));await allocation;
assert.equal(actionLock.current,false);assert.equal(busy.at(-1),false);
console.log('PASS phase3 loaner availability duplicate and rejected-promise recovery');

const orderSource=ts.transpile(fs.readFileSync('app/lib/lease-contract-order.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});
const order=vm.createContext({exports:{}});vm.runInContext(orderSource,order);
const contract=(id,start,end='2026-12-01')=>({id,contract_start_date:start,contract_end_date:end,created_at:'2026-10-01T00:00:00Z'});
const rows=[contract('a',null),contract('b','2026-01-01'),contract('c','2026-10-01'),contract('d','2026-10-01')];
assert.equal(order.exports.sortLeaseContracts(rows).map(x=>x.id).join(','),'d,c,b,a');
assert.equal(rows[0].id,'a','sorting does not mutate state');
assert.equal(order.exports.sortLeaseContracts(rows.map(x=>x.id==='b'?{...x,contract_start_date:'2027-01-01'}:x))[0].id,'b','edited latest contract moves to first');
console.log('PASS phase3 contract DESC/null/tie-break ordering after edits');

for(const route of ['history','photos','lease-maintenance']) {
  const source=fs.readFileSync(`app/customer-vehicles/${route}/page.tsx`,'utf8');
  const count=(source.match(/\.range\(/g)||[]).length;
  assert.equal((source.match(/\.order\("id", \{ ascending: false \}\)/g)||[]).length,count,'each offset query has deterministic unique tie-break');
}
console.log('PASS phase3 deterministic history/photo/contract page boundaries');

for(const route of ['app/settings/business-calendar/page.tsx','app/settings/business-calendar/edit/page.tsx']) {
  const old=deferred(),latest=deferred();let reads=0, rows=[], busy=[];
  const ctx=runFunctions(route,['loadYear'],{
    CALENDAR_COLUMNS:'business_date',loadSequence:{current:0},fiscalBounds:()=>({start:'2026-04-01',end:'2027-03-31'}),expectedFiscalDays:()=>365,
    supabase:{from:()=>query(++reads===1?old.promise:latest.promise)},setRows:v=>{rows=v;},setBusy:v=>busy.push(v),setLoaded:()=>{},setSelectedDate:()=>{},setMessage:()=>{},safeActionError:(_,e)=>e.message
  });
  const first=ctx.loadYear(2025),second=ctx.loadYear(2026);
  latest.resolve({data:[{business_date:'2026-04-01'}],error:null});await second;
  old.resolve({data:[{business_date:'2025-04-01'}],error:null});await first;
  assert.equal(rows[0].business_date,'2026-04-01');assert.equal(busy.at(-1),false);
}
console.log('PASS phase3 calendar obsolete fiscal-year snapshots are ignored');

for(const route of ['photos','lease-maintenance']) {
  const pending=deferred(),readLock={current:false};let reads=0,offset=0,rows=[{id:'same',contract_start_date:'2026-01-01',contract_end_date:null,created_at:'2026-01-01'}];
  const load=()=>{reads++;return pending.promise;};
  const ctx=runFunctions(`app/customer-vehicles/${route}/page.tsx`,['loadMore'],{
    vehicleId:'vehicle-a',busy:false,hasMore:true,readLock,contractMutationLock:{current:false},offset:20,photos:rows,
    loadPhotoPage:load,loadContractPage:load,PHOTO_PAGE_SIZE:20,PAGE_SIZE:20,
    setBusy:()=>{},setMessage:()=>{},setHasMore:()=>{},setOffset:fn=>{offset=fn(offset);},
    setPhotos:fn=>{rows=fn(rows);},setContracts:fn=>{rows=fn(rows);},sortLeaseContracts:v=>v,safeActionError:()=>''
  });
  const first=ctx.loadMore();await ctx.loadMore();assert.equal(reads,1);
  pending.resolve(route==='photos'?{rows:[rows[0]]}:[rows[0]]);await first;
  assert.equal(rows.length,1,'overlapping server page never duplicates a row');assert.equal(readLock.current,false);assert.equal(offset,1);
}
console.log('PASS phase3 photo/lease same-tick pagination and overlapping-row deduplication');

const mutation=deferred(),contractMutationLock={current:false};let confirmations=0,confirmBusy=[];
const lease=runFunctions('app/customer-vehicles/lease-maintenance/page.tsx',['confirmContract','saveContract','startNew','editContract'],{
  editingId:'contract-a',vehicleId:'vehicle-a',loaded:true,contractMutationLock,readLock:{current:false},
  supabase:{auth:{getSession:()=>{confirmations++;return mutation.promise;}}},setConfirming:v=>confirmBusy.push(v),setMessage:()=>{},safeActionError:()=>''
});
const confirm=lease.confirmContract();await lease.confirmContract();await lease.saveContract();lease.startNew();lease.editContract({id:'other'});
assert.equal(confirmations,1);mutation.reject(new Error('fixture rejection'));await confirm;
assert.equal(contractMutationLock.current,false);assert.equal(confirmBusy.at(-1),false);
console.log('PASS phase3 lease save/confirm/editor actions share one mutation lock');

let refreshedRows=[],nextOffset=-1,hasMore=false;
const snapshot=runFunctions('app/customer-vehicles/lease-maintenance/page.tsx',['reloadContractHistory'],{
  vehicleId:'vehicle-a',readLock:{current:false},PAGE_SIZE:3,
  loadContractPage:async(id,start)=>{assert.equal(id,'vehicle-a');assert.equal(start,0);return [{id:'B'},{id:'C'},{id:'D'}];},
  setContracts:v=>{refreshedRows=v;},setOffset:v=>{nextOffset=v;},setHasMore:v=>{hasMore=v;},setBusy:()=>{},setHistoryRefreshFailed:()=>{},setMessage:()=>{},sortLeaseContracts:v=>v,safeActionError:()=>''
});
assert.equal(await snapshot.reloadContractHistory({id:'A'}),true);
assert.equal(refreshedRows.map(r=>r.id).join(','),'B,C,D,A','canonical new boundary retains formerly skipped D and saved editor A');
assert.equal(nextOffset,3,'offset derives only from newly fetched DB page, not added editor record');assert(hasMore);
snapshot.loadContractPage=async()=>{throw new Error('fixture refresh failure');};
assert.equal(await snapshot.reloadContractHistory({id:'A'}),false);assert.equal(hasMore,false,'failed refresh blocks stale pagination');
console.log('PASS phase3 saved lease refresh resets pagination and preserves editor on read failure');
