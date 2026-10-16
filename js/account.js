import { requestAdmin, watchAdminRole } from './roles.js?v=20261016.4';
import { isAdmin, isOwner, currentUser, canEditWorker, login, logout, registerWorker, sendVerification, refreshVerification, resetPassword, authMessage, watchAuth } from './auth.js?v=20261016.4';
const $ = id => document.getElementById(id);
let busy = false, lastSent = 0, roleStatus = null, roleUser = null, stopRole = null;
function renderAccount() {
  const user = currentUser(), signed = user && !user.isAnonymous;
  $('account-forms').hidden = !!signed;
  $('account-signed').hidden = !signed;
  $('account-summary').textContent = signed ? `${user.displayName || 'Працівник'} · ${user.email}` : 'Вхід / Реєстрація';
  $('verification-controls').hidden = !signed || canEditWorker();
  $('account-status').textContent = signed ? (canEditWorker() ? 'Пошту підтверджено. Передайте адміну код доступу для прив’язки до вашого рядка.' : 'Підтвердьте пошту: відкрийте посилання в листі, потім натисніть «Я підтвердив пошту».') : 'Графік можна переглядати без реєстрації. Для своїх вихідних увійдіть і підтвердьте пошту.';
  $('copy-access').hidden = !canEditWorker();
  $('admin-link').hidden = !isAdmin(user);
  $('request-admin').hidden = !signed || !canEditWorker() || isAdmin(user) || roleStatus === 'pending';
  $('admin-request-status').textContent = isOwner(user) ? 'Ви — власник. Тільки ви призначаєте адміністраторів.' : isAdmin(user) ? 'Ви — адміністратор.' : ({pending:'Заявка очікує рішення власника.',rejected:'Власник відхилив заявку.',revoked:'Права адміністратора відкликано.',error:'Заявки недоступні. Потрібно перевірити правила Firebase.'}[roleStatus] || '');

}
async function task(fn) {
  if (busy) return;
  busy = true;
  const controls = [...$('account-panel').querySelectorAll('button,input')];
  controls.forEach(el=>el.disabled=true);
  $('account-message').textContent='';
  try { await fn(); } catch(error) { $('account-message').textContent=authMessage(error); }
  finally { busy=false; controls.forEach(el=>el.disabled=false); renderAccount(); }
}
async function sendLetter() {
  if (Date.now()-lastSent < 60000) throw new Error('Зачекайте хвилину перед повторним надсиланням.');
  await sendVerification(); lastSent=Date.now();
  $('account-message').textContent='Лист надіслано. Перевірте вхідні та папку «Спам».';
}
export function openAccount() { $('account-panel').open=true; $('account-panel').scrollIntoView({behavior:'smooth',block:'nearest'}); }
export function initAccount() {
  $('worker-register').addEventListener('submit',event=>{
    event.preventDefault();
    task(async()=>{
      if ($('register-password').value !== $('register-confirm').value) throw new Error('Паролі не збігаються.');
      await registerWorker($('register-name').value,$('register-email').value,$('register-password').value);
      $('register-password').value=''; $('register-confirm').value='';
      try { await sendLetter(); }
      catch(error) { throw new Error('Обліковий запис створено, але лист не надіслано. '+authMessage(error)+' Скористайтеся кнопкою повторного надсилання.'); }
    });
  });
  $('worker-login').addEventListener('submit',event=>{
    event.preventDefault();task(async()=>{await login($('worker-email').value,$('worker-password').value);$('worker-password').value='';});
  });
  $('worker-reset').addEventListener('click',()=>task(async()=>{
    const email=$('worker-email'); if (!email.value || !email.checkValidity()) throw new Error('Введіть коректну пошту в полі входу.');
    await resetPassword(email.value);$('account-message').textContent='Якщо обліковий запис існує, на пошту надійде лист для відновлення пароля.';
  }));
  $('resend-verification').addEventListener('click',()=>task(sendLetter));
  $('check-verification').addEventListener('click',()=>task(async()=>{
    const verified=await refreshVerification();
    if (verified) { window.location.reload(); return; }
    $('account-message').textContent=verified?'Пошту підтверджено. Тепер можна отримати код доступу.':'Пошту ще не підтверджено. Відкрийте посилання в листі.';
  }));
  $('worker-logout').addEventListener('click',()=>task(logout));
  $('request-admin').addEventListener('click',()=>task(async()=>{
    await requestAdmin(currentUser()); $('account-message').textContent='Заявку надіслано власнику.';
  }));
  watchAuth(()=>{
    const user=currentUser();
    const key=user && !user.isAnonymous && user.emailVerified && !isOwner(user) ? user.uid : null;
    if (key !== roleUser) {
      stopRole?.(); roleUser=key; roleStatus=null;
      if (key) stopRole=watchAdminRole(key,data=>{if(roleUser!==key)return;roleStatus=data?.status;renderAccount();},()=>{if(roleUser!==key)return;roleStatus='error';renderAccount();});
    }
    renderAccount();
  });
  renderAccount();
}
