const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function setup(){
 const handlers={},shown=[],clients=[];
 const scope='https://example.github.io/Menu_kabinet/';
 const self={location:{origin:'https://example.github.io'},registration:{scope,showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>clients,openWindow:async url=>({url})},addEventListener:(name,fn)=>handlers[name]=fn};
 const ctx={self,URL,Promise,Number,Array,Object,String,Date};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),ctx);
 return {handlers,shown,clients,self,scope};
}

test('change push creates specific, safely targeted notices and opens the exact schedule date',async()=>{
 const x=setup(),payload={month:'2026-10',notices:[{kind:'schedule',day:15},{kind:'cleaning',day:20}]};
 let wait; x.handlers.push({data:{json:()=>payload},waitUntil:p=>wait=p});await wait;
 assert.equal(x.shown.length,2);
 assert.equal(x.shown[0].options.body,'Графік змінено 15.10. Відкрийте, щоб ознайомитися.');
 assert.equal(x.shown[1].options.body,'Додано генеральне прибирання 20.10. Відкрийте, щоб ознайомитися.');
 const opened=[];x.clients.push({url:x.scope+'index.html',focus:async()=>{},navigate:async url=>opened.push(url)});
 let click;x.handlers.notificationclick({notification:{data:x.shown[1].options.data,close(){}},waitUntil:p=>click=p});await click;
 assert.equal(new URL(opened[0]).searchParams.get('month'),'2026-10');assert.equal(new URL(opened[0]).searchParams.get('day'),'20');
});

test('push notification cannot navigate outside the app scope',async()=>{
 const x=setup(),opened=[];x.clients.push({url:x.scope+'index.html',focus:async()=>{},navigate:async url=>opened.push(url)});
 let click;x.handlers.notificationclick({notification:{data:{target:'https://evil.example/?month=2026-10&day=1'},close(){}},waitUntil:p=>click=p});await click;
 assert.equal(opened[0],x.scope+'index.html');
});
