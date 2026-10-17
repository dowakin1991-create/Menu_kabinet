import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHandler} from '../src/index.js';
import {ApiError} from '../src/firebase.js';
import {validateSubscription} from '../src/policy.js';
const sqlite=new DatabaseSync(':memory:');
const db={
 exec:async sql=>sqlite.exec(sql),
 prepare(sql){const stmt=sqlite.prepare(sql);let params=[];return {
 bind(...values){params=values;return this},
 first:async()=>stmt.get(...params)||null,
 run:async()=>stmt.run(...params)
 }},
 async batch(statements){sqlite.exec('BEGIN');try{for(const stmt of statements)await stmt.run();sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}}
};
await db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
after(()=>sqlite.close());
const origin='https://dowakin1991-create.github.io';
const env={DB:db,ALLOWED_ORIGIN:origin,FIREBASE_SERVICE_ACCOUNT:'mock',VAPID_JSON:JSON.stringify({publicKey:'public',privateKey:'secret'})};
let revoked=false,sendCount=0;
const handler=createHandler({
 authenticate:async(req,env,admin)=>{const uid=req.headers.get('Authorization');if(!uid)throw new ApiError('unauthenticated','Login',401);if(uid==='outsider'||(admin&&uid!=='owner'))throw new ApiError('permission-denied','Denied',403);return uid;},
 access:async(_,uid)=>uid==='owner'||(uid==='worker'&&!revoked),document:async()=>({}),
 buildPushPayload:async()=>({method:'POST',body:'encrypted'}),send:async()=>{sendCount++;return new Response(null,{status:201})}
});
const call=async(route,uid,data={},customOrigin=origin)=>{
 const response=await handler(new Request('https://push.example/'+route,{method:'POST',headers:{Origin:customOrigin,...(uid?{Authorization:uid}:{}),'Content-Type':'application/json'},body:JSON.stringify(data)}),env);
 return {status:response.status,body:response.status===403&&customOrigin!==origin?null:await response.json()};
};
const sub=name=>({endpoint:'https://web.push.apple.com/'+name,keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}});
test('CORS, authentication and admin gate fail closed',async()=>{
 assert.equal((await call('pushConfig',null)).status,401);
 assert.equal((await call('pushConfig','outsider')).status,403);
 assert.equal((await call('pushSchedule','worker',{month:'2026-10'})).status,403);
 assert.equal((await call('pushConfig','owner',{},'https://evil.example')).status,403);
 assert.deepEqual((await call('pushConfig','owner')).body,{publicKey:'public'});
});
test('subscription validation prevents arbitrary outgoing URLs',()=>{
 assert.deepEqual(validateSubscription(sub('test')),sub('test'));
 for(const endpoint of ['https://localhost/x','https://web.push.apple.com.evil.example/x','https://169.254.169.254/x','http://web.push.apple.com/x','https://u:p@web.push.apple.com/x'])assert.throws(()=>validateSubscription({...sub('test'),endpoint}));
});
test('subscription limit is enforced in database, rebinding and owner-only deletion work',async()=>{
 for(let i=0;i<10;i++)assert.equal((await call('pushSubscribe','worker',{subscription:sub('device'+i)})).status,200);
 assert.equal((await call('pushSubscribe','worker',{subscription:sub('extra')})).status,429);
 assert.equal((await call('pushSubscribe','worker',{subscription:sub('device1')})).status,200);
 await call('pushUnsubscribe','owner',{endpoint:sub('device1').endpoint});
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM devices').first()).n,10);
 await call('pushSubscribe','owner',{subscription:sub('device1')});
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM devices').first()).n,10);
 await call('pushUnsubscribe','owner',{endpoint:sub('device1').endpoint});
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM devices').first()).n,9);
});
test('jobs are owner-scoped, deduplicate sends and recheck revoked recipients',async()=>{
 const first=await call('pushSchedule','owner',{month:'2026-10'});assert.equal(first.status,200);assert.equal(first.body.total,9);
 const {jobId}=first.body;
 assert.equal((await call('pushSchedule','owner',{month:'2026-10'})).status,429);
 const one=await call('pushDeliver','owner',{jobId,index:0});assert.equal(one.body.accepted,1);
 const again=await call('pushDeliver','owner',{jobId,index:0});assert.equal(again.body.skipped,1);assert.equal(sendCount,1);
 revoked=true;
 const two=await call('pushDeliver','owner',{jobId,index:1});assert.equal(two.body.removed,1);assert.equal(sendCount,1);
 assert.equal((await call('pushDeliver','owner',{jobId:'wrong',index:0})).status,403);
});
