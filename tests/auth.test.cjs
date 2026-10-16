const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function setup(user) {
 const calls=[];const auth={currentUser:user,authStateReady:async()=>{}};
 const context={getAuth:()=>auth,firebaseApp:{},ADMIN_UID:'admin',browserSessionPersistence:'session',
 onAuthStateChanged:()=>{},signOut:async()=>{auth.currentUser=null},setPersistence:async()=>{},
 signInWithEmailAndPassword:async(_,email)=>{calls.push(['login',email]);return {user:auth.currentUser}},
 signInAnonymously:async()=>{},EmailAuthProvider:{credential:(email,password)=>({email,password})},
 linkWithCredential:async(u,c)=>{calls.push(['link',u.uid,c.email]);u.isAnonymous=false;u.email=c.email;return {user:u}},
 createUserWithEmailAndPassword:async(_,email)=>{calls.push(['create',email]);auth.currentUser={uid:'new',email,isAnonymous:false,emailVerified:false};return {user:auth.currentUser}},
 updateProfile:async(u,profile)=>Object.assign(u,profile),sendEmailVerification:async u=>calls.push(['verify',u.uid]),
 sendPasswordResetEmail:async(_,email)=>calls.push(['reset',email]),reload:async u=>{u.emailVerified=true},
 };
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/auth.js'),'utf8').replace(/import[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'')+';globalThis.api={registerWorker,sendVerification,refreshVerification,canEditWorker,login,resetPassword};',context);
 return {api:context.api,auth,calls};
}
test('registration upgrades anonymous UID, preserving employee binding',async()=>{
 const {api,auth,calls}=setup({uid:'bound-worker',isAnonymous:true,emailVerified:false});
 await api.registerWorker(' Антон ',' worker@example.com ','password123');
 assert.equal(auth.currentUser.uid,'bound-worker');assert.equal(auth.currentUser.displayName,'Антон');assert.deepEqual(calls,[['link','bound-worker','worker@example.com']]);assert.equal(api.canEditWorker(),false);
 await api.sendVerification();assert.deepEqual(calls[1],['verify','bound-worker']);
});
test('registration validates input and cannot replace an authenticated user',async()=>{
 const guest=setup(null);await assert.rejects(guest.api.registerWorker('','a@b.com','password123'));await assert.rejects(guest.api.registerWorker('A','a@b.com','short'));assert.equal(guest.calls.length,0);
 const signed=setup({uid:'existing',isAnonymous:false});await assert.rejects(signed.api.registerWorker('A','a@b.com','password123'));assert.equal(signed.calls.length,0);
});
test('verification reload refreshes token before allowing edits',async()=>{
 let refreshed=false;const {api}=setup({uid:'worker',emailVerified:false,isAnonymous:false,getIdToken:async force=>{refreshed=force}});
 assert.equal(api.canEditWorker(),false);assert.equal(await api.refreshVerification(),true);assert.equal(refreshed,true);
});
test('new registration and verification are separate for recoverable email delivery failures',async()=>{
 const {api,auth,calls}=setup(null);await api.registerWorker('Олег','a@example.com','password123');assert.equal(auth.currentUser.uid,'new');assert.deepEqual(calls,[['create','a@example.com']]);await api.sendVerification();assert.deepEqual(calls[1],['verify','new']);
});
