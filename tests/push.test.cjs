const {test}=require('node:test');
const assert=require('node:assert/strict');
const {eligible,subscription}=require('../functions/policy.cjs');
const owner='yBHHkxuh4OSboz1gGOtZFqmfVHE3';
const worker={uid:'worker',emailVerified:true};
const sub={endpoint:'https://web.push.apple.com/test',keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
test('push requires current reciprocal membership and verified, enabled identity',()=>{
 assert.equal(eligible(null),false);
 assert.equal(eligible(worker),false);
 assert.equal(eligible(worker,null,{employeeId:'e1'},{uid:'worker'}),true);
 assert.equal(eligible(worker,null,{employeeId:'e1'},{uid:'old'}),false);
 assert.equal(eligible({...worker,emailVerified:false},null,{employeeId:'e1'},{uid:'worker'}),false);
 assert.equal(eligible({...worker,disabled:true},{status:'approved'}),false);
});
test('only owner or approved verified admin may send; revoked admins cannot send as workers',()=>{
 assert.equal(eligible({uid:owner},null,null,null,true),true);
 assert.equal(eligible(worker,{status:'approved'},null,null,true),true);
 assert.equal(eligible(worker,{status:'revoked'},{employeeId:'e1'},{uid:'worker'},true),false);
 assert.equal(eligible({...worker,emailVerified:false},{status:'approved'},null,null,true),false);
});
test('subscription validation rejects arbitrary hosts, credentials, ports and invalid keys',()=>{
 assert.deepEqual(subscription(sub),sub);
 for (const endpoint of ['http://web.push.apple.com/test','https://web.push.apple.com.attacker.example/test','https://localhost/test','https://169.254.169.254/test','https://u:p@web.push.apple.com/test','https://web.push.apple.com:444/test','https://fcm.googleapis.com@evil.example/test'])
  assert.throws(()=>subscription({...sub,endpoint}));
 assert.throws(()=>subscription({...sub,keys:{auth:'abc',p256dh:'def'}}));
});
