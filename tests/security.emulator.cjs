// Run with Firestore Emulator only; never connects to the production project.
const fs=require('node:fs');const path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,getDocs,collection,serverTimestamp}=require('firebase/firestore');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-kabinet-roles',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 const owner=env.authenticatedContext('yBHHkxuh4OSboz1gGOtZFqmfVHE3').firestore();
 const worker=env.authenticatedContext('worker',{email:'worker@example.com',email_verified:true}).firestore();
 const other=env.authenticatedContext('other',{email:'other@example.com',email_verified:true}).firestore();
 const unverified=env.authenticatedContext('unverified',{email:'u@example.com',email_verified:false}).firestore();
 const request={name:'Worker',email:'worker@example.com',status:'pending',updatedAt:serverTimestamp()};
 try {
  await assertFails(setDoc(doc(unverified,'adminRequests','unverified'),{...request,email:'u@example.com'}));
  await assertFails(setDoc(doc(worker,'adminRequests','worker'),{...request,status:'approved'}));
  await assertSucceeds(setDoc(doc(worker,'adminRequests','worker'),request));
  await assertFails(updateDoc(doc(worker,'adminRequests','worker'),{status:'approved',updatedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(other,'adminRequests','worker')));
  await assertSucceeds(getDocs(collection(owner,'adminRequests')));
  await assertSucceeds(updateDoc(doc(owner,'adminRequests','worker'),{status:'approved',updatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(worker,'schedules','2026-10'),{employees:[],banquets:{}}));
  await assertSucceeds(setDoc(doc(other,'adminRequests','other'),{...request,email:'other@example.com'}));
  await assertFails(updateDoc(doc(worker,'adminRequests','other'),{status:'approved',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(worker,'adminRequests','yBHHkxuh4OSboz1gGOtZFqmfVHE3'),request));
  await assertSucceeds(updateDoc(doc(owner,'adminRequests','worker'),{status:'revoked',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(worker,'schedules','2026-10'),{employees:[],banquets:{}}));
  await assertSucceeds(setDoc(doc(owner,'employeeAccess','e1'),{uid:'other'}));
  await assertSucceeds(setDoc(doc(other,'availability','2026-10','employees','e1'),{days:[1],updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(worker,'availability','2026-10','employees','e1'),{days:[2],updatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(worker,'adminRequests','worker'),request));
  await assertFails(setDoc(doc(worker,'schedules','2026-10'),{employees:[],banquets:{}}));

  const guest=env.unauthenticatedContext().firestore();
  const anonymous=env.authenticatedContext('guest',{firebase:{sign_in_provider:'anonymous'}}).firestore();
  await assertFails(getDoc(doc(guest,'schedules','2026-10')));
  await assertFails(getDoc(doc(anonymous,'schedules','2026-10')));
  await assertFails(getDoc(doc(worker,'schedules','2026-10')));
  await assertFails(getDoc(doc(other,'schedules','2026-10')));
  await assertFails(setDoc(doc(other,'teamAccess','other'),{employeeId:'e1'}));
  await assertSucceeds(setDoc(doc(owner,'teamAccess','other'),{employeeId:'e1'}));
  await assertSucceeds(getDoc(doc(other,'schedules','2026-10')));
  await assertSucceeds(getDocs(collection(other,'availability','2026-10','employees')));
  await assertFails(getDocs(collection(worker,'availability','2026-10','employees')));
  await assertFails(getDoc(doc(worker,'schedules','2026-10','receipts','test')));
  await assertSucceeds(setDoc(doc(owner,'employeeAccess','e1'),{uid:''}));
  await assertFails(getDoc(doc(other,'schedules','2026-10')));
  await assertSucceeds(getDoc(doc(owner,'schedules','2026-10')));
  console.log('PASS: owner/admin roles, private schedule reads, self-grant denial, and immediate revocation.');
 } finally {await env.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1});
