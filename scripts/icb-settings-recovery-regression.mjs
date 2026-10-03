import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

for (const route of ['staff', 'vendors']) {
  const source = fs.readFileSync(`app/settings/${route}/page.tsx`, 'utf8');
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let functionText;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'runAction') functionText = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert(functionText, `${route}: source-owned action guard exists`);
  const busy = [], messages = [], actionLock = { current: false };
  const context = vm.createContext({ actionLock, setBusy: v => busy.push(v), setMessage: v => messages.push(v), safeActionError: (_, e) => e.message });
  vm.runInContext(ts.transpile(functionText, { target: ts.ScriptTarget.ES2022 }), context);
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const first = context.runAction(async () => { calls++; await pending; });
  await context.runAction(async () => { calls++; });
  assert.equal(calls, 1, 'same-tick duplicate is ignored');
  release(); await first;
  assert.equal(actionLock.current, false);
  await context.runAction(async () => { throw new Error('fixture rejection'); });
  assert.equal(messages.at(-1), 'fixture rejection');
  assert.equal(busy.at(-1), false, 'rejection releases busy state');
  await context.runAction(async () => { calls++; });
  assert.equal(calls, 2, 'next action recovers after rejection');
  assert.match(source, /loaded && !busy && !\w+\.length/, 'empty requires successful read');
}
console.log('ICB settings action recovery regression: PASS');

const source = fs.readFileSync('app/customer-vehicles/page.tsx', 'utf8');
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let linkSource;
function visitLink(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'linkExistingCustomer') linkSource = node.getText(tree);
  ts.forEachChild(node, visitLink);
}
visitLink(tree);
let release, writes = 0, snapshots = 0;
let rows = [{id:'vehicle-a',customerId:'old'}];
const pending = new Promise(resolve => { release = resolve; });
const lock = {current:false}, selection = {current:'vehicle-a'}, busy = [];
const ctx = vm.createContext({
  linkMutationLock:lock, selectedVehicleRef:selection, savingCustomer:false, deletingCustomer:false,
  selectedVehicle:{id:'vehicle-a',customerId:'old'}, linkCustomerId:'customer-new',
  linkCustomerOptions:[{id:'customer-new'}], customers:[],
  supabase:{from:()=>({update:()=>({eq:()=>{writes++;return pending;}})})},
  setLinkingCustomer:v=>busy.push(v), setVehicles:fn=>{rows=fn(rows);},
  setSelectedVehicleSnapshot:()=>{snapshots++;}, setSelectedCustomerSnapshot:()=>{snapshots++;},
  setCustomers:()=>{}, setMessage:()=>{}, dedupeCustomers:v=>v, customerLabel:()=>'', safeActionError:()=>''
});
vm.runInContext(ts.transpile(linkSource,{target:ts.ScriptTarget.ES2022}),ctx);
const first=ctx.linkExistingCustomer();
await ctx.linkExistingCustomer();
assert.equal(writes,1,'link ignores same-tick duplicate');
selection.current='vehicle-b';
release({error:null}); await first;
assert.equal(snapshots,0,'old link response cannot replace newer vehicle selection');
assert.equal(rows[0].customerId,'customer-new','completed server mutation updates original list row');
assert.equal(lock.current,false); assert.equal(busy.at(-1),false);
console.log('ICB customer linking race regression: PASS');
let saveSource, selectSource;
function visitSave(node) {
  if(ts.isFunctionDeclaration(node) && node.name?.text==='saveCustomer') saveSource=node.getText(tree);
  if(ts.isFunctionDeclaration(node) && node.name?.text==='selectVehicle') selectSource=node.getText(tree);
  ts.forEachChild(node,visitSave);
}
visitSave(tree);
let releaseSave, customerWrites=0;
const savePending=new Promise(resolve=>{releaseSave=resolve;});
const saveLock={current:false};
const saveContext=vm.createContext({CUSTOMER_COLUMNS:'id,name',CUSTOMER_SEARCH_LIMIT:100,customerSaveLock:saveLock,linkMutationLock:{current:false},deletingCustomer:false,
  selectedVehicle:{id:'vehicle-a'},customerForm:{id:'',type:'individual',name:'検証',companyName:'',phone:'',email:'',postalCode:'',address:'',notes:''},
  supabase:{from:()=>({insert:()=>({select:()=>({single:()=>{customerWrites++;return savePending;}})}),update:()=>({eq:async()=>({error:null})})})},
  setSavingCustomer:()=>{},setCustomers:()=>{},setVehicles:()=>{},setSelectedVehicleSnapshot:()=>{},setSelectedCustomerSnapshot:()=>{},setLinkCustomerOptions:()=>{},setLinkCustomerId:()=>{},setCustomerEditing:()=>{},setMessage:()=>{},dedupeCustomers:v=>v,customerLabel:()=>'',safeActionError:()=>''});
vm.runInContext(ts.transpile(saveSource+'\n'+selectSource,{target:ts.ScriptTarget.ES2022}),saveContext);
const saveFirst=saveContext.saveCustomer(); await saveContext.saveCustomer();
assert.equal(customerWrites,1,'same-tick customer creation cannot duplicate');
// The real selection handler exits before reading any new-vehicle state.
saveContext.selectVehicle({id:'vehicle-b'});
releaseSave({data:{id:'customer-new',name:'検証'},error:null});await saveFirst;
assert.equal(saveLock.current,false,'save lock is released');
console.log('ICB customer creation duplicate and selection guard regression: PASS');
