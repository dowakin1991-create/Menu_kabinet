import { getFirestore, doc, onSnapshot, collection, getDocs, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseApp } from './store.js?v=20261017.5';
const db=getFirestore(firebaseApp);
// Both sides of the binding are checked; a stale membership never grants access.
export function watchTeamAccess(user, next) {
  let stopped=false, stopBinding=null, generation=0;
  if (!user || user.isAnonymous || !user.emailVerified) { next(false);return()=>{}; }
  const stop=onSnapshot(doc(db,'teamAccess',user.uid),snap=>{
    if(stopped)return;
    const ticket=++generation;stopBinding?.();stopBinding=null;next(false);
    const id=snap.exists()?snap.data().employeeId:null;
    if (!id || typeof id!=='string' || id.includes('/')) return;
    stopBinding=onSnapshot(doc(db,'employeeAccess',id),binding=>{
      if(!stopped && ticket===generation) next(binding.exists() && binding.data().uid===user.uid);
    },()=>{if(!stopped && ticket===generation)next(false);});
  },()=>{generation++;stopBinding?.();if(!stopped)next(false);});
  return()=>{stopped=true;generation++;stop();stopBinding?.();};
}
// Existing bindings were already approved by admins; build the lookup for them.
export async function syncTeamAccess() {
  const snapshot=await getDocs(collection(db,'employeeAccess'));
  for(const binding of snapshot.docs) {
    const uid=binding.data().uid;
    if(typeof uid==='string' && uid && uid.length<=128 && !uid.includes('/'))
      await setDoc(doc(db,'teamAccess',uid),{employeeId:binding.id});
  }
}
