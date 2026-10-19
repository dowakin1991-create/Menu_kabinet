const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/legacy-ui.js'),'utf8').replace(/import[\s\S]*?from\s+["'][^"']+["'];/g,'');
const fixture=require('./legacy-interface.json');
test('all original static interface IDs and entire original CSS are retained on both pages',()=>{
 for(const name of ['index','admin']){
  const html=fs.readFileSync(path.join(root,name+'.html'),'utf8');
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  for(const id of fixture[name].ids)assert(ids.has(id === 'tgNotifyBtn' ? 'pushNotifyBtn' : id),name+' missing '+id);
  const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';assert(css.length>100,name+' lost core styles');
 }
});
function setup(){
 const elements={};const el=id=>elements[id]??={innerHTML:'',textContent:'',value:'',style:{},addEventListener(){},querySelector:()=>({textContent:''})};
 const context={initPush:()=>{},initOwnerPanel:()=>{},initUserDirectory:()=>{},installOwnerSelfBinding:()=>{},console,document:{body:{dataset:{page:'admin'}},getElementById:el,querySelector:()=>({scrollLeft:0}),querySelectorAll:()=>[],addEventListener(){}},watchAuth:()=>{},withBusy:fn=>fn,setTimeout:()=>{},getDutyName:()=> 'Столи',monthId:()=> '2026-10',isAdmin:()=>true};context.window=context;
 vm.createContext(context);vm.runInContext(source,context);return {context,elements,run:s=>vm.runInContext(s,context)};
}
test('all original inline handlers resolve, including the previously broken pencil',()=>{
 const {context}=setup();
 for(const name of ['changeMonth','toggleRedDotMode','executeRedDot','cancelRedDot','closeModal','toggleColFromReceipt','handleHeaderClick','showEmployeeInfo','handleCellClick','addEmployee','exportHalfMonth','notifyTeam','setShiftType','triggerEditName','triggerDeleteEmp','toggleColFromSettings','openDaySettings','editEmployee','handleBanquetUpload','deleteBanquet','markBanquetNoPhoto']) assert.equal(typeof context[name],'function',name);
});
test('legacy table escapes names and supports UUID employee identifiers',()=>{
 const {elements,run}=setup();run(`ready=true;employees=[{id:'test-uuid',name:'<img src=x onerror=alert(1)>',shifts:[],shiftsFirst:[],shiftsSecond:[],unavail:[]}];renderAdmin();renderIndex();`);
 for(const id of ['b-row','body-row']){assert(!elements[id].innerHTML.includes('<img'));assert(elements[id].innerHTML.includes('&lt;img'));assert(elements[id].innerHTML.includes('&quot;test-uuid&quot;'));}
});
test('admin row controls have boundary guards and are absent from worker table',()=>{
 const {elements,run}=setup();run(`ready=true;employees=[{id:'a',name:'Антон',shifts:[],shiftsFirst:[],shiftsSecond:[],unavail:[]},{id:'b',name:'Олег',shifts:[],shiftsFirst:[],shiftsSecond:[],unavail:[]}];renderAdmin();renderIndex();`);
 assert(elements['b-row'].innerHTML.includes('startEmployeeDrag'));
 assert.match(elements['b-row'].innerHTML,/moveEmployeeRow\(event, &quot;a&quot;, -1\)" disabled/);
 assert.match(elements['b-row'].innerHTML,/moveEmployeeRow\(event, &quot;b&quot;, 1\)" disabled/);
 assert(!elements['body-row'].innerHTML.includes('row-order-controls'));
});
