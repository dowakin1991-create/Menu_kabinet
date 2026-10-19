import { currentUser, isOwner, watchAuth } from './auth.js?v=20261019.5';
import { watchAdminRequests, decideAdmin } from './roles.js?v=20261017.5';
const $=id=>document.getElementById(id);
let stop=null, generation=0, saving=false;
function renderRequests(items) {
  const root=$('owner-requests'); root.replaceChildren();
  const visible=items.filter(r=>r.uid!==currentUser()?.uid && ['pending','approved'].includes(r.status));
  visible.sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||a.email.localeCompare(b.email));
  if (!visible.length) {root.textContent='Нових заявок і призначених адміністраторів поки немає.';return;}
  for (const request of visible) {
    const row=document.createElement('div');row.className='owner-request';
    const label=document.createElement('p');label.textContent=`${request.name} · ${request.email} — ${request.status==='pending'?'очікує схвалення':'адміністратор'}`;row.append(label);
    for (const [text,status] of request.status==='pending' ? [['Схвалити','approved'],['Відхилити','rejected']] : [['Відкликати права','revoked']]) {
      const button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=saving;
      button.addEventListener('click',async()=>{
        if(saving || !isOwner(currentUser()))return;
        if(!confirm(`${text}: ${request.name} (${request.email})?`))return;
        saving=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
        try {await decideAdmin(request.uid,request.status,status);$('owner-message').textContent='Рішення збережено.';}
        catch(error){$('owner-message').textContent=error.code==='permission-denied'?'Оновіть правила Firebase для керування адміністраторами.':error.message;}
        finally {saving=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
      });
      row.append(button);
    }
    root.append(row);
  }
}
function subscribe() {
  stop?.();stop=null;const ticket=++generation;
  const owner=isOwner(currentUser());$('owner-panel').hidden=!owner;
  $('owner-requests').replaceChildren();$('owner-message').textContent='';$('owner-retry').hidden=true;
  if (!owner)return;
  $('owner-message').textContent='Завантаження заявок…';
  stop=watchAdminRequests(items=>{if(ticket!==generation)return;$('owner-message').textContent='';renderRequests(items);},()=>{
    if(ticket!==generation)return;
    $('owner-requests').replaceChildren();$('owner-message').textContent='Не вдалося отримати заявки. Перевірте з’єднання та опублікуйте нові правила Firebase.';$('owner-retry').hidden=false;
  });
}
export function initOwnerPanel() { $('owner-retry').addEventListener('click',subscribe);watchAuth(subscribe); }
