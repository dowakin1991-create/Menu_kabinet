import {getFirestore,doc,setDoc,getDoc,collection,onSnapshot,runTransaction} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {firebaseApp} from './store.js?v=20261029.soho1';
import {sendAccountEvent} from './push.js?v=20261019.8';
import {currentUser,isOwner,watchAuth} from './auth.js?v=20261019.8';
const db=getFirestore(firebaseApp),$=id=>document.getElementById(id);
let refreshDirectory=()=>{};
export function refreshOwnerUserDirectory(){refreshDirectory();}
export async function saveDirectoryProfile(user,role='worker'){
 if(!user||user.isAnonymous||!user.email||isOwner(user))return;
 const ref=doc(db,'userDirectory',user.uid);
 const previous=await getDoc(ref);
 const savedRole=previous.exists()&&previous.data().role==='viewer'?'viewer':role==='viewer'?'viewer':'worker';
 const status=previous.exists()?(previous.data().status||'approved'):'pending';
 await setDoc(ref,{name:(user.displayName||'Працівник').slice(0,80),email:user.email.slice(0,254),role:savedRole,status});
 if(!previous.exists())sendAccountEvent('registered',user.uid).catch(e=>console.warn('Registration push:',e.code||e.message));
}
export function watchMyApproval(user,callback){
 if(!user||user.isAnonymous){callback(false);return()=>{};}
 return onSnapshot(doc(db,'userDirectory',user.uid),snap=>callback(!snap.exists()||snap.data().status!=='pending'),()=>callback(false));
}
export function initUserDirectory(getEmployees) {
 let stop=null,stopBindings=null;let bindings=new Map();
 const root=$('owner-user-list'),status=$('owner-user-status');
 async function bind(uid,employeeId,replaceUid='') {
   const ids=[...new Set(getEmployees().map(e=>String(e.id)))];
   if(!ids.includes(employeeId))throw Error('Оберіть ім’я з поточного графіка.');
   const team=doc(db,'teamAccess',uid);
   await runTransaction(db,async tx=>{
     const refs=ids.map(id=>doc(db,'employeeAccess',id));
     const current=await tx.get(team);
     const snaps=[];
     for(const ref of refs)snaps.push(await tx.get(ref));
     const selected=ids.indexOf(employeeId);
     const taken=snaps[selected].exists()?snaps[selected].data().uid:'';
     if(taken&&taken!==uid&&taken!==replaceUid){const error=new Error('Ім’я зайняте іншою прив’язкою.');error.occupiedUid=taken;throw error;}
     if(taken&&taken!==uid){const replacedTeam=doc(db,'teamAccess',taken);const replacedSnap=await tx.get(replacedTeam);if(replacedSnap.exists()&&String(replacedSnap.data().employeeId)===employeeId)tx.delete(replacedTeam);}
     const oldId=current.exists()?String(current.data().employeeId||''):'';
     let oldRef=null,oldSnap=null;
     if(oldId&&!ids.includes(oldId)&&oldId!==employeeId){oldRef=doc(db,'employeeAccess',oldId);oldSnap=await tx.get(oldRef);}
     for(let i=0;i<ids.length;i++)if(ids[i]!==employeeId&&snaps[i].exists()&&snaps[i].data().uid===uid)tx.set(refs[i],{uid:''});
     if(oldRef&&oldSnap.exists()&&oldSnap.data().uid===uid)tx.set(oldRef,{uid:''});
     tx.set(refs[selected],{uid});
     tx.set(team,{employeeId});
     tx.update(doc(db,'userDirectory',uid),{status:'approved'});
   });
   const check=await getDoc(team);
   if(!check.exists()||String(check.data().employeeId)!==employeeId)throw Error('Firebase не підтвердив прив’язку. Повторіть спробу.');
 }
 let cachedUsers=[];
 function draw(users){
   root.replaceChildren();
   if(!users.length){root.textContent='Зареєстровані користувачі ще не з’явилися у списку.';return;}
   const listed=users.filter(u=>u.uid!==currentUser()?.uid);
   if(!listed.length){root.textContent='Інших зареєстрованих користувачів поки немає.';return;}
   for(const u of listed.sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||a.name.localeCompare(b.name,'uk'))){
     const card=document.createElement('div');card.className='directory-card';
     const label=document.createElement('strong');label.textContent=u.name||'Без імені';
     const meta=document.createElement('p');meta.textContent=(u.email||'')+' · '+(u.role==='viewer'?'Глядач':'Працівник');
     const key=document.createElement('code');key.textContent=u.uid;
     const select=document.createElement('select');select.setAttribute('aria-label','Ім’я у графіку для '+u.name);
     select.add(new Option('Вибрати ім’я з графіка',''));
     for(const employee of getEmployees())select.add(new Option(employee.name,String(employee.id)));
     const savedId=bindings.get(u.uid);
     if(savedId&&Array.from(select.options).some(option=>option.value===savedId))select.value=savedId;
     const bindingLabel=document.createElement('p');bindingLabel.textContent=savedId?'Прив’язано: '+(getEmployees().find(e=>String(e.id)===savedId)?.name||'інше ім’я з графіка'):'Не прив’язано до графіка';
     const button=document.createElement('button');button.type='button';button.textContent=u.status==='pending'?'Підтвердити та прив’язати':'Змінити прив’язку';
     button.onclick=async()=>{button.disabled=true;status.textContent='Збереження…';try{await bind(u.uid,select.value);bindings.set(u.uid,select.value);bindingLabel.textContent='Прив’язано: '+(getEmployees().find(e=>String(e.id)===select.value)?.name||select.value);if(u.status==='pending')await sendAccountEvent('approved',u.uid).catch(()=>{});status.textContent='Акаунт '+u.name+' прив’язаний і підтверджений.';}catch(e){
       if(e.occupiedUid){
         const holder=cachedUsers.find(user=>user.uid===e.occupiedUid);
         const holderName=e.occupiedUid===currentUser()?.uid?'ВАШ АКАУНТ ВЛАСНИКА':holder?`${holder.name} (${holder.email})`:'акаунт, відсутній у довіднику';
         if(confirm(`Ім’я вже прив’язане до: ${holderName}. Замінити цю прив’язку на ${u.name}? Попередній акаунт втратить доступ до цього імені.`)){
           try{await bind(u.uid,select.value,e.occupiedUid);status.textContent='Прив’язку замінено та збережено.';bindings.set(u.uid,select.value);if(u.status==='pending')await sendAccountEvent('approved',u.uid).catch(()=>{});draw(cachedUsers);}
           catch(retryError){status.textContent=retryError.message||'Не вдалося замінити прив’язку.';}
         }else status.textContent='Заміну скасовано. Стару прив’язку збережено.';
       }else status.textContent=e.message||'Не вдалося зберегти.';
     }finally{button.disabled=false;}};
     if(u.role==='viewer'&&u.status==='pending'){
       const approve=document.createElement('button');approve.type='button';approve.textContent='Підтвердити глядача';
       approve.onclick=async()=>{approve.disabled=true;try{await setDoc(doc(db,'userDirectory',u.uid),{status:'approved'},{merge:true});await sendAccountEvent('approved',u.uid).catch(()=>{});status.textContent='Глядача підтверджено.';}catch(e){status.textContent=e.message;}finally{approve.disabled=false;}};
       card.append(approve);
     }
     card.append(label,meta,key,...(u.role==='viewer'?[]:[bindingLabel,select,button]));root.append(card);
   }
 }
 function start(user){
   stop?.();stopBindings?.();stop=null;stopBindings=null;bindings=new Map();const owner=isOwner(user);
   $('owner-users-panel').hidden=!owner;
   if(!owner)return;
   status.textContent='Завантаження користувачів…';
   stopBindings=onSnapshot(collection(db,'teamAccess'),snapshot=>{bindings=new Map(snapshot.docs.map(d=>[d.id,String(d.data().employeeId||'')]));if(cachedUsers.length)draw(cachedUsers);},error=>{status.textContent='Не вдалося прочитати прив’язки: '+(error.code||error.message);});
   stop=onSnapshot(collection(db,'userDirectory'),snapshot=>{status.textContent='';cachedUsers=snapshot.docs.map(d=>({uid:d.id,...d.data()}));draw(cachedUsers);},error=>{status.textContent='Помилка читання користувачів: '+(error.code||error.message);});
 }
 refreshDirectory=()=>{if(isOwner(currentUser())&&cachedUsers.length)draw(cachedUsers);};
 watchAuth(start);
}
