// Real Firestore transactions; mocked Auth and push sender. Never sends external notifications.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const requireBackend=require('node:module').createRequire(path.resolve(__dirname,'../functions/index.cjs'));
const {getFirestore}=requireBackend('firebase-admin/firestore');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore Emulator required');
requireBackend('firebase-admin/app').initializeApp({projectId:'demo-kabinet-roles'});
const db=getFirestore(),owner='yBHHkxuh4OSboz1gGOtZFqmfVHE3',deliveries=[],api={};
const users=new Map([owner,'worker','outsider','revoked','disabled'].map(uid=>[uid,{uid,emailVerified:true,disabled:uid==='disabled'}]));
const load=vm.runInThisContext('(function(exports,require){'+fs.readFileSync(path.join(__dirname,'../functions/index.cjs'),'utf8')+'\n})');
load(api,function(name){
 if(name==='firebase-admin/app')return {initializeApp:()=>{}};
 if(name==='firebase-admin/auth')return {getAuth:()=>({getUser:async uid=>users.get(uid)||{uid,disabled:true}})};
 if(name==='firebase-functions/v2/https')return {onCall:(_,fn)=>fn,HttpsError:requireBackend(name).HttpsError};
 if(name==='web-push')return {generateVAPIDKeys:requireBackend(name).generateVAPIDKeys,sendNotification:async(sub,payload)=>{deliveries.push(JSON.parse(payload));if(sub.endpoint.endsWith('/expired'))throw {statusCode:410}}};
 return requireBackend(name);
});
const request=(uid,data={})=>({auth:uid?{uid}:null,data});
const sub=suffix=>({endpoint:'https://web.push.apple.com/'+suffix,keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}});
const fail=(promise,code)=>assert.rejects(promise,e=>e.code===code);
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-kabinet-roles',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 try{
 await env.clearFirestore();
 await db.doc('schedules/2026-10').set({employees:[],banquets:{}});
 await db.doc('teamAccess/worker').set({employeeId:'e1'});await db.doc('employeeAccess/e1').set({uid:'worker'});
 await db.doc('adminRequests/revoked').set({status:'revoked'});
 await fail(api.pushConfig(request(null)),'unauthenticated');await fail(api.pushConfig(request('outsider')),'permission-denied');
 await fail(api.pushSubscribe(request('outsider',{subscription:sub('outsider')})),'permission-denied');
 const keys=await Promise.all([api.pushConfig(request(owner)),api.pushConfig(request('worker'))]);
 assert.equal(keys[0].publicKey,keys[1].publicKey);assert.equal(keys[0].privateKey,undefined);
 for(const uid of [owner,'worker','outsider']){
 const client=env.authenticatedContext(uid,{email_verified:true}).firestore();
 await assertFails(getDoc(doc(client,'_pushPrivate','vapid')));await assertFails(setDoc(doc(client,'_pushDevices','forged'),{uid}));
 }
 await api.pushSubscribe(request('worker',{subscription:sub('device1')}));await api.pushSubscribe(request('worker',{subscription:sub('expired')}));await api.pushSubscribe(request(owner,{subscription:sub('owner')}));
 await db.doc('_pushDevices/revoked').set({uid:'revoked',subscription:sub('revoked')});await db.doc('_pushDevices/disabled').set({uid:'disabled',subscription:sub('disabled')});
 await fail(api.pushSchedule(request('worker',{month:'2026-10'})),'permission-denied');await fail(api.pushSchedule(request('revoked',{month:'2026-10'})),'permission-denied');
 await fail(api.pushSchedule(request(owner,{month:'invalid'})),'invalid-argument');await fail(api.pushSchedule(request(owner,{month:'2026-11'})),'failed-precondition');
 const first=await api.pushSchedule(request(owner,{month:'2026-10'}));assert.equal(first.accepted,2);assert.equal(first.removed,3);assert.equal(first.failed,0);
 assert(deliveries.every(p=>Object.keys(p).sort().join(',')==='body,title'));
 await fail(api.pushSchedule(request(owner,{month:'2026-10'})),'resource-exhausted');
 await api.pushUnsubscribe(request('worker',{endpoint:sub('owner').endpoint}));assert.equal((await db.collection('_pushDevices').get()).size,2);
 await db.doc('employeeAccess/e1').set({uid:''});await db.doc('_pushPrivate/rate').delete();
 const second=await api.pushSchedule(request(owner,{month:'2026-10'}));assert.equal(second.accepted,1);assert.equal(second.removed,1);
 await db.doc('employeeAccess/e1').set({uid:'worker'});await api.pushSubscribe(request('worker',{subscription:sub('owner')}));assert.equal((await db.collection('_pushDevices').get()).size,1);
 await api.pushUnsubscribe(request('worker',{endpoint:sub('owner').endpoint}));assert.equal((await db.collection('_pushDevices').get()).size,0);
 for(let i=0;i<10;i++)await api.pushSubscribe(request('worker',{subscription:sub('limit'+i)}));
 await fail(api.pushSubscribe(request('worker',{subscription:sub('limit11')})),'resource-exhausted');await api.pushSubscribe(request('worker',{subscription:sub('limit1')}));
 console.log('Push emulator: access control, private keys, limits, revocation, cooldown, rebinding and cleanup passed. No external sends.');
 }catch(e){console.error('Push integration failure:',e);throw e;}finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
