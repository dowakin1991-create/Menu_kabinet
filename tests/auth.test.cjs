const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function setup(user) {
 const persisted=[],calls=[],authListeners=[],roleListeners=[];const auth={currentUser:user,authStateReady:async()=>{}};
 const context={getAdminRole:async()=>false,watchAdminRole:(uid,next,fail)=>{const listener={uid,next,fail};roleListeners.push(listener);return()=>{listener.stopped=true}},getAuth:()=>auth,firebaseApp:{},ADMIN_UID:'admin',browserSessionPersistence:'session',browserLocalPersistence:'local',
 onAuthStateChanged:(_,callback)=>{authListeners.push(callback);return()=>{}},signOut:async()=>{auth.currentUser=null},setPersistence:async(_,mode)=>persisted.push(mode),
 signInWithEmailAndPassword:async(_,email)=>{calls.push(['login',email]);return {user:auth.currentUser}},
 signInAnonymously:async()=>{},EmailAuthProvider:{credential:(email,password)=>({email,password})},
 linkWithCredential:async(u,c)=>{calls.push(['link',u.uid,c.email]);u.isAnonymous=false;u.email=c.email;return {user:u}},
 createUserWithEmailAndPassword:async(_,email)=>{calls.push(['create',email]);auth.currentUser={uid:'new',email,isAnonymous:false,emailVerified:false};return {user:auth.currentUser}},
 updateProfile:async(u,profile)=>Object.assign(u,profile),sendEmailVerification:async u=>calls.push(['verify',u.uid]),
 sendPasswordResetEmail:async(_,email)=>calls.push(['reset',email]),reload:async u=>{u.emailVerified=true},
 };
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/auth.js'),'utf8').replace(/import[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'')+';globalThis.api={isAdmin,isOwner,watchAuth,registerWorker,sendVerification,refreshVerification,canEditWorker,ensureWorkerSession,login,resetPassword};',context);
 return {api:context.api,auth,persisted,calls,authListeners,roleListeners};
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

test('owner has immutable access; admins gain and lose access from live role updates',()=>{
 const user={uid:'candidate',isAnonymous:false,emailVerified:true};
 const {api,authListeners,roleListeners}=setup(user);const states=[];
 const stop=api.watchAuth(u=>states.push(api.isAdmin(u)));
 authListeners[0](user);roleListeners[0].next({status:'pending'});roleListeners[0].next({status:'approved'});roleListeners[0].next({status:'revoked'});
 assert.deepEqual(states,[false,true,false]);assert(api.isOwner({uid:'admin'}));assert(api.isAdmin({uid:'admin'}));
 stop();roleListeners[0].next({status:'approved'});assert.equal(states.length,3);
});
test('unverified users and failed role reads cannot become admins',()=>{
 const user={uid:'candidate',isAnonymous:false,emailVerified:false};const {api,authListeners,roleListeners}=setup(user);
 api.watchAuth(()=>{});authListeners[0](user);assert.equal(roleListeners.length,0);assert.equal(api.isAdmin(user),false);
 user.emailVerified=true;authListeners[0](user);roleListeners[0].next({status:'approved'});assert(api.isAdmin(user));roleListeners[0].fail(Error('denied'));assert.equal(api.isAdmin(user),false);
});

test('remember-me persists a session without storing passwords in app storage',async()=>{
 const {api,persisted}=setup({uid:'worker',isAnonymous:false,emailVerified:false});
 await api.login('a@example.com','secret',true);await api.login('a@example.com','secret',false);assert.deepEqual(persisted,['local','local']);
});
test('opening a public page never creates an anonymous account',async()=>{
 const {api,auth}=setup(null);assert.equal(await api.ensureWorkerSession(),null);assert.equal(auth.currentUser,null);
});
