const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/store.js'), 'utf8')
  .replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, '').replace(/export /g, '');
const seed = () => ({employees:[{id:1,name:'Антон',shifts:[15],shiftsFirst:[],shiftsSecond:[],unavail:[]}],banquets:{}});
function setup() {
  const docs = new Map([['schedules/2026-10', seed()]]), listeners=[];
  let queue = Promise.resolve();
  const snap = ref => ({exists:()=>docs.has(ref),data:()=>structuredClone(docs.get(ref))});
  const ctx = {query:(ref,...filters)=>({ref,filters}),where:(_,op,value)=>({op,value}),orderBy:()=>null,documentId:()=> '__name__',limit:()=>null,
    getDocs:async path=>{const ids=[...docs.keys()].filter(k=>/^schedules\/\d{4}-\d{2}$/.test(k)).sort().reverse();return {empty:!ids.length,docs:ids.map(ref=>({ref,id:ref.split('/')[1]}))};},console, crypto:require('node:crypto').webcrypto, firebaseConfig:{}, initializeApp:()=>({}),getFirestore:()=>({}),serverTimestamp:()=>1,
    doc:(_, ...args)=>args.join('/'), collection:(_, ...args)=>args.join('/'),getDoc:async ref=>snap(ref),setDoc:async(ref,data)=>docs.set(ref,data),
    onSnapshot:(ref, next, error)=>{ const listener={ref,next,error};listeners.push(listener);return()=>{listener.stopped=true}; },
    runTransaction:(_, fn)=> { const execute=async()=>{const writes=[];await fn({get:async ref=>snap(ref),set:(ref,data)=>writes.push(()=>docs.set(ref,structuredClone(data))),update:(ref,data)=>writes.push(()=>docs.set(ref,{...docs.get(ref),...structuredClone(data)})),delete:ref=>writes.push(()=>docs.delete(ref))});writes.forEach(f=>f());}; const result=queue.then(execute);queue=result.catch(()=>{});return result; }
  };
  vm.createContext(ctx); vm.runInContext(source+'\nglobalThis.api={ensureMonthRoster,moveEmployee,normalizeSchedule,setAvailability,updateSchedule,subscribeSchedule,saveEmployeeProfile,addReceipt,removeBanquet};',ctx);
  return {api:ctx.api,docs,listeners};
}
test('parallel day edits retain both changes and do not overwrite shifts',async()=>{
 const {api,docs}=setup();await Promise.all([api.setAvailability('2026-10',1,16,true),api.setAvailability('2026-10',1,17,true)]);
 assert.deepEqual(docs.get('availability/2026-10/employees/1').days,[16,17]);assert.deepEqual(docs.get('schedules/2026-10').employees[0].shifts,[15]);
 await api.setAvailability('2026-10',1,16,true);assert.deepEqual(docs.get('availability/2026-10/employees/1').days,[16,17]);
 await api.setAvailability('2026-10',1,16,false);assert.deepEqual(docs.get('availability/2026-10/employees/1').days,[17]);
});
test('invalid dates and removed employees cannot create availability',async()=>{
 const {api,docs}=setup();await assert.rejects(api.setAvailability('2026-02',1,30,true));await assert.rejects(api.setAvailability('2026-10',999,15,true));assert.equal(docs.size,1);
});
test('separate administrator edits preserve latest schedule',async()=>{
 const {api,docs}=setup();await Promise.all([api.updateSchedule('2026-10',d=>d.employees[0].shifts.push(16)),api.updateSchedule('2026-10',d=>d.banquets['20']={active:true})]);
 assert.deepEqual(docs.get('schedules/2026-10').employees[0].shifts,[15,16]);assert(docs.get('schedules/2026-10').banquets['20']);
});
test('schedule appears immediately; availability updates later; errors and stop prevent stale events',()=>{
 const {api,listeners}=setup();const output=[],errors=[];const stop=api.subscribeSchedule('2026-10',d=>output.push(d),e=>errors.push(e));
 assert.equal(output.length,0,'do not show an empty graph before schedule data');
 listeners[0].next({exists:()=>true,data:seed});
 assert.equal(output.length,1,'schedule must render without waiting for availability');
 assert.deepEqual(output[0].employees[0].shifts,[15]);
 assert.equal(listeners[1].ref,'availability/2026-10/employees/1');
 listeners[1].next({exists:()=>true,data:()=>({days:[20]})});
 assert.equal(output.length,2);
 assert.deepEqual([...output[1].employees[0].unavail],[20]);
 listeners[0].error(Error('denied'));
 listeners[1].next({exists:()=>true,data:()=>({days:[21]})});
 assert.equal(output.length,2,'stop publishing after fatal schedule error');
 assert.equal(errors.length,1);
 stop();assert(listeners.every(l=>l.stopped));
});
test('employee and access save atomically; missing employee fails without access write',async()=>{
 const {api,docs}=setup();await api.saveEmployeeProfile('2026-10',1,'Антон М','uid');assert.equal(docs.get('employeeAccess/1').uid,'uid');assert.equal(docs.get('schedules/2026-10').employees[0].name,'Антон М');await assert.rejects(api.saveEmployeeProfile('2026-10',2,'Інший','uid'));assert(!docs.has('employeeAccess/2'));
});
test('receipt stays in captured month; removing banquet removes its receipts',async()=>{
 const {api,docs}=setup();docs.get('schedules/2026-10').banquets['20']={active:true};await api.addReceipt('2026-10',20,'data:image/jpeg;base64,AAAA');const ids=docs.get('schedules/2026-10').banquets['20'].receiptIds;assert.equal(ids.length,1);assert(docs.has('schedules/2026-10/receipts/'+ids[0]));await api.removeBanquet('2026-10',20);assert(!docs.has('schedules/2026-10/receipts/'+ids[0]));assert(!docs.get('schedules/2026-10').banquets['20']);
});
test('normalization resolves overlapping shifts and stable missing ids',()=>{
 const {api}=setup();const raw={employees:[{name:'X',shifts:[1],shiftsFirst:[1,2],shiftsSecond:[1,2,3]}],banquets:{10:{active:true,type:'cleaning'},11:{active:true}}};const a=api.normalizeSchedule(raw),b=api.normalizeSchedule(raw);assert.equal(a.employees[0].id,b.employees[0].id);assert.equal(JSON.stringify(a.employees[0].shiftsFirst),'[2]');assert.equal(JSON.stringify(a.employees[0].shiftsSecond),'[3]');assert.equal(a.banquets['10'].type,'cleaning');assert.equal(a.banquets['11'].type,'banquet');
});
test('change journal is isolated by month and tracks event type across reload',()=>{
 const data=new Map();const ctx={localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};vm.createContext(ctx);const code=fs.readFileSync(path.join(__dirname,'../js/session.js'),'utf8').replace(/export /g,'');vm.runInContext(code+';recordChange("2026-10","shifts",15);recordChange("2026-11","banquets",20,"cleaning")',ctx);assert.equal(vm.runInContext('changeJournal("2026-10").shifts.has(15)',ctx),true);assert.equal(vm.runInContext('changeJournal("2026-10").banquets.size',ctx),0);assert.equal(vm.runInContext('changeJournal("2026-11").banquets.get(20)',ctx),'cleaning');vm.runInContext('clearChangeJournal("2026-11")',ctx);assert.equal(vm.runInContext('changeJournal("2026-11").banquets.size',ctx),0);
});

test('reordering preserves shifts and concurrent changes, and rejects deleted targets', async()=>{
 const {api,docs}=setup();
 docs.get('schedules/2026-10').employees.push({...seed().employees[0],id:'b',name:'Богдан'},{...seed().employees[0],id:'c',name:'Олег'});
 await Promise.all([api.updateSchedule('2026-10',d=>d.employees[0].shifts.push(22)),api.moveEmployee('2026-10',1,'c',true)]);
 assert.deepEqual(docs.get('schedules/2026-10').employees.map(e=>e.id),['b','c',1]);
 assert.deepEqual(docs.get('schedules/2026-10').employees[2].shifts,[15,22]);
 await api.moveEmployee('2026-10',1,'b',false);
 assert.deepEqual(docs.get('schedules/2026-10').employees.map(e=>e.id),[1,'b','c']);
 await assert.rejects(api.moveEmployee('2026-10',1,'deleted'));
 assert.deepEqual(docs.get('schedules/2026-10').employees.map(e=>e.id),[1,'b','c']);
});

test('new month inherits latest roster order and IDs but no schedule or banquet data',async()=>{
 const {api,docs}=setup();docs.get('schedules/2026-10').employees.push({...seed().employees[0],id:'b',name:'Олег',unavail:[12]});
 docs.get('schedules/2026-10').banquets={20:{active:true}};
 await api.ensureMonthRoster('2026-12');
 const result=docs.get('schedules/2026-12');assert.deepEqual(result.employees.map(e=>e.id),[1,'b']);
 assert(result.employees.every(e=>[e.shifts,e.shiftsFirst,e.shiftsSecond,e.unavail].every(a=>a.length===0)));
 assert.deepEqual(result.banquets,{});assert.deepEqual(docs.get('schedules/2026-10').employees[0].shifts,[15]);
});
test('roster initialization never overwrites existing or concurrently edited months',async()=>{
 const {api,docs}=setup();docs.set('schedules/2026-11',{employees:[],banquets:{}});
 await api.ensureMonthRoster('2026-11');assert.deepEqual(docs.get('schedules/2026-11').employees,[]);
 await Promise.all([api.ensureMonthRoster('2026-12'),api.updateSchedule('2026-12',d=>d.employees.push({...seed().employees[0],id:'new'}))]);
 assert.equal(docs.get('schedules/2026-12').employees[0].id,'new');
 await api.ensureMonthRoster('2026-09');assert(!docs.has('schedules/2026-09'));
});
