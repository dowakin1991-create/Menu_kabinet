import {getFirestore,doc,setDoc,collection,onSnapshot,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseApp} from './store.js?v=20261029.soho1';
import {watchAuth,isOwner} from './auth.js?v=20261019.8';

const db=getFirestore(firebaseApp);
export const presenceOnline = timestamp => !!timestamp && Date.now()-timestamp.toMillis()<150000;
export function watchOwnerPresence(user, callback, fail) {
  if (!isOwner(user)) return () => {};
  return onSnapshot(collection(db,'presence'),snapshot=>{
    callback(new Map(snapshot.docs.map(item=>[item.id,item.data().lastSeen||null])));
  },fail);
}
export function initPresence() {
  let timer=null,uid=null;
  const ping=async()=>{
    if(!uid || document.visibilityState==='hidden' || !navigator.onLine)return;
    const target=uid;
    try{await setDoc(doc(db,'presence',target),{lastSeen:serverTimestamp()});}
    catch(error){console.warn('Presence unavailable:',error.code||error.message);}
  };
  const change=()=>{
    if(document.visibilityState==='visible')ping();
  };
  document.addEventListener('visibilitychange',change);
  window.addEventListener('focus',ping);
  window.addEventListener('online',ping);
  watchAuth(user=>{
    const next=user&&!user.isAnonymous&&user.emailVerified?user.uid:null;
    if(next===uid)return;
    uid=next;
    if(timer){clearInterval(timer);timer=null;}
    if(uid){ping();timer=setInterval(ping,60000);}
  });
}
