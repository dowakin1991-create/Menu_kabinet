import {registerViewer,watchViewerAccess} from './access.js?v=20261017.13';
import {saveDirectoryProfile} from './user-directory.js?v=20261018.12';
import {disconnectPush} from './push.js?v=20261017.5';
import { requestAdmin, watchAdminRole } from './roles.js?v=20261017.5';
import { isAdmin, isOwner, currentUser, canEditWorker, login, logout, registerWorker, sendVerification, refreshVerification, resetPassword, authMessage, watchAuth } from './auth.js?v=20261017.5';
const $ = id => document.getElementById(id);
let lastCompact = null;
let viewerMode=false,stopViewer=null,lastDirectoryUid=null;
let hasAccess = false, formMode = "register";
let busy = false, lastSent = 0, roleStatus = null, roleUser = null, stopRole = null;
function renderAccount() {
  const user = currentUser(), signed = user && !user.isAnonymous;
  $('account-forms').hidden = !!signed;
  $('account-signed').hidden = !signed;
  $('account-summary').textContent = signed ? `${user.displayName || (isOwner(user) ? 'Власник' : isAdmin(user) ? 'Шеф' : 'Мій профіль')}` : formMode === 'register' ? 'Створити обліковий запис' : 'Вхід у KABINET';
  $('account-email').hidden = !signed;
  $('account-email').textContent = signed ? user.email : '';
  $('profile-hint').textContent = signed && viewerMode ? 'Глядач · Лише перегляд графіка' : signed ? (isOwner(user) ? 'Власник · Керування профілем' : isAdmin(user) ? 'Шеф · Керування профілем' : 'Працівник · Керування профілем') : 'Приватний графік команди';
  const compact = !!signed && hasAccess;
  if (compact !== lastCompact) { $('account-panel').open = !compact; lastCompact = compact; }
  $('social-auth').hidden = !!signed;
  $('worker-login').hidden = formMode !== 'login';
  $('worker-register').hidden = formMode !== 'register';
  $('account-panel').classList.toggle('auth-gate',!hasAccess);
  $('verification-controls').hidden = !signed || canEditWorker();
  $('account-status').textContent = signed ? (canEditWorker() ? (hasAccess ? 'Ви маєте доступ до графіка команди.' : 'Пошту підтверджено. Щоб отримати доступ до графіка, передайте адміну свій код доступу.') : 'Підтвердьте пошту: відкрийте посилання в листі, потім натисніть «Я підтвердив пошту».') : 'Закритий графік команди. Для перегляду потрібні вхід і дозвіл адміністратора.';
  $('copy-access').hidden = viewerMode || !canEditWorker();
  $('admin-link').hidden = !isAdmin(user);
  $('request-admin').hidden = viewerMode || !signed || !canEditWorker() || isAdmin(user) || roleStatus === 'pending';
  $('admin-request-status').textContent = isOwner(user) ? 'Ви — власник. Тільки ви призначаєте адміністраторів.' : isAdmin(user) ? 'Ви — адміністратор.' : ({pending:'Заявка очікує рішення власника.',rejected:'Власник відхилив заявку.',revoked:'Права адміністратора відкликано.',error:'Заявки недоступні. Потрібно перевірити правила Firebase.'}[roleStatus] || '');

}
async function task(fn) {
  if (busy) return;
  busy = true;
  const controls = [...$('account-panel').querySelectorAll('button,input')];
  controls.forEach(el=>el.disabled=true);
  $('account-message').textContent='';
  try { await fn(); } catch(error) { $('account-message').textContent=authMessage(error); $('account-panel').open=true; }
  finally { busy=false; controls.forEach(el=>el.disabled=false); renderAccount(); }
}
async function sendLetter() {
  if (Date.now()-lastSent < 60000) throw new Error('Зачекайте хвилину перед повторним надсиланням.');
  await sendVerification(); lastSent=Date.now();
  $('account-message').textContent='Лист надіслано. Перевірте вхідні та папку «Спам».';
}
export function setScheduleAccess(value) { hasAccess = value; renderAccount(); }
export function openAccount() { $('account-panel').open=true; $('account-panel').scrollIntoView({behavior:'smooth',block:'nearest'}); }
export function initAccount() {
  $('show-login').addEventListener('click',()=>{formMode='login';renderAccount();$('worker-email').focus();});
  $('show-register').addEventListener('click',()=>{formMode='register';renderAccount();$('register-name').focus();});

  $('worker-register').addEventListener('submit',event=>{
    event.preventDefault();
    task(async()=>{
      if ($('register-password').value !== $('register-confirm').value) throw new Error('Паролі не збігаються.');
      const registered=await registerWorker($('register-name').value,$('register-email').value,$('register-password').value,$('remember-me').checked);
      if($('register-role').value==='viewer') await registerViewer(registered.uid);
      await saveDirectoryProfile(registered,$('register-role').value);
      $('register-password').value=''; $('register-confirm').value='';
      try { await sendLetter(); }
      catch(error) { throw new Error('Обліковий запис створено, але лист не надіслано. '+authMessage(error)+' Скористайтеся кнопкою повторного надсилання.'); }
    });
  });
  $('worker-login').addEventListener('submit',event=>{
    event.preventDefault();task(async()=>{const signedIn=await login($('worker-email').value,$('worker-password').value,$('remember-me').checked);await saveDirectoryProfile(signedIn);$('worker-password').value='';});
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
  $('worker-logout').addEventListener('click',()=>task(async()=>{await disconnectPush();await logout();}));
  $('request-admin').addEventListener('click',()=>task(async()=>{
    await requestAdmin(currentUser()); $('account-message').textContent='Заявку надіслано власнику.';
  }));
  watchAuth(()=>{
    const user=currentUser();
    if(user&&!user.isAnonymous&&user.uid!==lastDirectoryUid){
      lastDirectoryUid=user.uid;
      saveDirectoryProfile(user).catch(error=>{console.warn('Directory profile sync:',error.code||error.message);lastDirectoryUid=null;});
    }
    if(!user||user.isAnonymous)lastDirectoryUid=null;
    stopViewer?.(); stopViewer=null; viewerMode=false;
    if(user && !user.isAnonymous && user.emailVerified) stopViewer=watchViewerAccess(user,enabled=>{viewerMode=enabled;renderAccount();});
    const key=user && !user.isAnonymous && user.emailVerified && !isOwner(user) ? user.uid : null;
    if (key !== roleUser) {
      stopRole?.(); roleUser=key; roleStatus=null;
      if (key) stopRole=watchAdminRole(key,data=>{if(roleUser!==key)return;roleStatus=data?.status;renderAccount();},()=>{if(roleUser!==key)return;roleStatus='error';renderAccount();});
    }
    renderAccount();
  });
  renderAccount();
}
