import { getFirestore, doc, collection, getDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseApp } from './store.js?v=20261017.5';
const db = getFirestore(firebaseApp);
export async function getAdminRole(uid) {
  const snap = await getDoc(doc(db, 'adminRequests', uid));
  return snap.exists() && snap.data().status === 'approved';
}
export function watchAdminRole(uid, next, fail) {
  return onSnapshot(doc(db, 'adminRequests', uid), snap => next(snap.exists() ? snap.data() : null), fail);
}
export function watchAdminRequests(next, fail) {
  return onSnapshot(collection(db, 'adminRequests'), snap => next(snap.docs.map(d=>({...d.data(),uid:d.id}))), fail);
}
export async function requestAdmin(user) {
  if (!user || user.isAnonymous || !user.emailVerified) throw new Error('Спочатку підтвердьте пошту.');
  const ref = doc(db,'adminRequests',user.uid);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if (snap.exists() && ['pending','approved'].includes(snap.data().status)) return;
    tx.set(ref,{name:(user.displayName || 'Працівник').slice(0,80),email:user.email,status:'pending',updatedAt:serverTimestamp()});
  });
}
export async function decideAdmin(uid, expected, status) {
  if (!(['pending','approved'].includes(expected)) || !(expected==='pending' ? ['approved','rejected'] : ['revoked']).includes(status)) throw new Error('Неприпустима зміна ролі.');
  const ref=doc(db,'adminRequests',uid);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if (!snap.exists() || snap.data().status!==expected) throw new Error('Статус заявки вже змінився. Оновіть список.');
    tx.update(ref,{status,updatedAt:serverTimestamp()});
  });
}
