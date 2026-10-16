const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup({ios=false,installed=false,offline=false}={}){
 const elements={},log=[],handlers={},storage=new Map();let subscribed=false;
 const sub={endpoint:'https://web.push.apple.com/test',toJSON:()=>({endpoint:'https://web.push.apple.com/test'}),unsubscribe:async()=>{log.push('unsubscribe');subscribed=false;return true}};
 const registration={active:{},pushManager:{getSubscription:async()=>subscribed?sub:null,subscribe:async()=>{log.push('subscribe');subscribed=true;return sub}},getNotifications:async()=>[]};
 const el=id=>elements[id]??={textContent:'',hidden:false,disabled:false,addEventListener:(type,fn)=>{handlers[id]=fn}};
 const ctx={console,URL,Uint8Array,DOMException,setTimeout,clearTimeout,atob,currentUser:()=>({uid:'worker'}),firebaseApp:{},
 getFunctions:()=>({}),httpsCallable:(_,name)=>async()=>{log.push(name);if(offline&&name==='pushSubscribe')throw Error('offline');return {data:{publicKey:'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}}},
 document:{getElementById:el},navigator:{userAgent:ios?'iPhone':'desktop',platform:'',maxTouchPoints:0,serviceWorker:{register:async()=>registration,getRegistration:async()=>registration}},
 localStorage:{getItem:key=>storage.get(key),setItem:(key,v)=>storage.set(key,v),removeItem:key=>storage.delete(key)},
 Notification:{permission:'default',requestPermission:async()=>{log.push('permission');return 'granted'}},window:{PushManager:{},Notification:{},matchMedia:()=>({matches:installed})}};
 vm.createContext(ctx);let source=fs.readFileSync(path.join(__dirname,'../js/push.js'),'utf8').replace(/import[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'').replace('import.meta.url',"'https://dowakin1991-create.github.io/Menu_kabinet/js/push.js'");
 vm.runInContext(source+';globalThis.api={initPush,setPushAccess,disconnectPush};',ctx);ctx.api.initPush();
 return {api:ctx.api,elements,handlers,log,storage};
}
test('unapproved users never initialize a push subscription',async()=>{
 const x=setup();await x.api.setPushAccess(false);assert.equal(x.elements['push-panel'].hidden,true);assert.deepEqual(x.log,[]);
});
test('iPhone browser explains Home Screen installation without prompting or backend request',async()=>{
 const x=setup({ios:true});await x.api.setPushAccess(true);assert.match(x.elements['push-status'].textContent,/початковий екран/);assert.deepEqual(x.log,[]);
});
test('opt-in permission comes before subscription; logout unsubscribes device before backend cleanup',async()=>{
 const x=setup();await x.api.setPushAccess(true);await x.handlers['push-enable']();
 assert.deepEqual(x.log,['pushConfig','permission','subscribe','pushSubscribe']);assert.equal(x.elements['push-disable'].hidden,false);
 await x.api.disconnectPush();assert.deepEqual(x.log.slice(-2),['unsubscribe','pushUnsubscribe']);assert.equal(x.storage.size,0);
});
test('failed registration rolls back browser subscription and never claims success',async()=>{
 const x=setup({offline:true});await x.api.setPushAccess(true);await x.handlers['push-enable']();assert.equal(x.log.at(-1),'unsubscribe');assert.match(x.elements['push-status'].textContent,/недоступний/);assert.equal(x.elements['push-disable'].hidden,true);
});
