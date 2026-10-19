import {PUSH_API_URL} from './push-config.js?v=20261017.5';
import {currentUser} from './auth.js?v=20261019.8';
async function call(name, data = {}) {
  if (!PUSH_API_URL) throw Object.assign(new Error('Безкоштовний сервіс сповіщень ще не підключено.'), {code:'not-configured'});
  const user = currentUser();
  if (!user) throw Object.assign(new Error('Увійдіть повторно.'), {code:'functions/unauthenticated'});
  const response = await fetch(`${PUSH_API_URL.replace(/\/$/,'')}/${name}`, {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${await user.getIdToken()}`},
    body:JSON.stringify(data), signal:AbortSignal.timeout(30000)
  });
  let result;
  try { result = await response.json(); }
  catch { throw Object.assign(new Error('Некоректна відповідь сервера.'), {diagnostic:'worker-http-'+response.status}); }
  if (!response.ok) throw Object.assign(new Error(result.error?.message || 'Сервіс недоступний.'), {diagnostic:'worker-http-'+response.status,code:result.error?.code==='not-configured'?'not-configured':`functions/${result.error?.code || 'unavailable'}`});
  return result;
}
const $ = id => document.getElementById(id);
const scope = new URL('../', import.meta.url).href;
const deviceKey = 'kabinet-push-user';
let permitted = false, busy = false, registration, publicKey, registeredUid, generation = 0;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const storedUid = () => { try { return localStorage.getItem(deviceKey); } catch { return null; } };
function saveUid(uid) { try { uid ? localStorage.setItem(deviceKey, uid) : localStorage.removeItem(deviceKey); } catch { /* No password/token is stored here. */ } }
function message(text) {
  if ($('push-status')) $('push-status').textContent = text;
  const state=$('push-summary-state');
  if(state) state.textContent = text.startsWith('Сповіщення увімкнено') ? 'Увімкнено' : text.startsWith('Передано службі') ? 'Результат' : text.startsWith('Надсилаємо') ? 'Надсилання…' : 'Налаштувати';
}
function errorText(error) {
  if (error.code === 'not-configured') return error.message;
  if (error.code === 'functions/permission-denied') return 'Сервер відхилив підписку. Власнику потрібно оновити Cloudflare Worker.';
  if (error.code === 'functions/resource-exhausted' || error.code === 'functions/failed-precondition') return error.message;
  if (error.code === 'functions/unauthenticated') return 'Увійдіть у кабінет повторно.';
  if (error.name === 'NotAllowedError') return 'Сповіщення заборонені. Дозвольте їх у налаштуваннях пристрою.';
  return 'Сервіс сповіщень недоступний. Перевірте інтернет; якщо помилка повторюється, власник має завершити налаштування сервісу.';
}
async function worker() {
  if (registration) return registration;
  registration = await navigator.serviceWorker.register(new URL('sw.js', scope), {scope});
  if (!registration.active) await new Promise((resolve, reject) => {
    const sw = registration.installing || registration.waiting;
    if (!sw) return reject(Error('Service worker unavailable'));
    const timer = setTimeout(() => reject(Error('Service worker timeout')), 15000);
    const check = () => { if (sw.state === 'activated') { clearTimeout(timer); resolve(); } };
    sw.addEventListener('statechange', check); check();
  });
  return registration;
}
function bytes(key) {
  const value = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(value, char => char.charCodeAt(0));
}
function draw(enabled = false) {
  const bell=$('push-bell-icon');
  if(bell){bell.textContent=enabled?'🔔':'🔕';$('push-bell')?.setAttribute('aria-label',enabled?'Сповіщення увімкнено. Відкрити налаштування':'Сповіщення вимкнено. Відкрити налаштування');}
  $('push-enable').hidden = enabled;
  $('push-disable').hidden = !enabled;
  $('push-enable').disabled = busy || !publicKey;
  $('push-disable').disabled = busy;
}
export async function setPushAccess(access) {
  permitted = access;
  const ticket = ++generation;
  $('push-panel').hidden = !access;
  publicKey = null; draw(false);
  if (!access || !currentUser()) return;
  const uid = currentUser().uid;
  if (ios && !installed()) { message('На iPhone: Safari → Поділитися → На початковий екран. Відкрийте KABINET через нову іконку й увімкніть сповіщення.'); return; }
  if (!supported()) { message('Цей браузер не підтримує сповіщення. Спробуйте оновлений браузер.'); return; }
  message('Перевіряємо сповіщення…');
  try {
    const reg = await worker();
    const config = await call('pushConfig');
    if (ticket !== generation || uid !== currentUser()?.uid) return;
    publicKey = config.publicKey;
    let sub = await reg.pushManager.getSubscription();
    // Never silently transfer another user's subscription on shared devices.
    if (sub && storedUid() !== uid) { await sub.unsubscribe(); sub = null; saveUid(null); }
    if (sub) {
      await call('pushSubscribe', {subscription: sub.toJSON()});
      if (ticket !== generation || uid !== currentUser()?.uid) return;
      registeredUid = uid;
      message('Сповіщення увімкнено на цьому пристрої.'); draw(true);
    } else {
      message(Notification.permission === 'denied' ? 'Сповіщення заблоковані. Дозвольте їх у налаштуваннях пристрою.' : 'Натисніть «Увімкнути сповіщення», щоб отримувати зміни графіка.'); draw(false);
    }
  } catch (error) { if (ticket === generation) message(errorText(error)); }
}
async function enable() {
  if (busy || !permitted || !publicKey) return;
  const uid = currentUser()?.uid, ticket = generation;
  busy = true; draw();
  let created;
  try {
    // Request permission directly within the click, before any network await (iOS).
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new DOMException('Permission denied', 'NotAllowedError');
    if (ticket !== generation || uid !== currentUser()?.uid) return;
    created = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: bytes(publicKey)});
    if (ticket !== generation || uid !== currentUser()?.uid) { await created.unsubscribe(); return; }
    await call('pushSubscribe', {subscription: created.toJSON()});
    if (ticket !== generation || uid !== currentUser()?.uid) { await created.unsubscribe(); return; }
    registeredUid = uid; saveUid(uid); message('Сповіщення увімкнено на цьому пристрої.');
  } catch (error) {
    if (created) await created.unsubscribe().catch(() => {});
    registeredUid = null; saveUid(null); message(errorText(error));
  } finally { busy = false; draw(registeredUid === currentUser()?.uid && !!registeredUid); }
}
export async function disconnectPush() {
  generation++; registeredUid = null; saveUid(null);
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration(scope);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  // Browser unsubscribe works even if our backend is offline; a stale endpoint expires.
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await Promise.all((await reg.getNotifications()).map(n => n.close()));
  if (currentUser()) await call('pushUnsubscribe', {endpoint}).catch(() => {});
}
export async function sendAccountEvent(event,uid) {
  return call('accountAlert',{event,uid});
}
export async function notifySchedule(month, notices) {
  try {
    const job = await call('pushSchedule', {month, notices});
    const result = {accepted:0,failed:0,removed:0};
    const diagnostics = new Set();
    let index = 0;
    $('push-panel').open=true;
    message('Надсилаємо сповіщення. Залиште кабінет відкритим до завершення.');
    // Each server call encrypts one message; no paid background queues or functions.
    await Promise.all(Array.from({length: Math.min(3, job.total)}, async () => {
      while (index < job.total) {
        const next = index++;
        try {
          const delivered = await call('pushDeliver', {jobId:job.jobId,index:next});
          result.accepted += delivered.accepted || 0;
          result.failed += (delivered.failed || 0) + (delivered.skipped || 0);
          result.removed += delivered.removed || 0;
          if (/^[a-zA-Z0-9-]{1,100}$/.test(delivered.diagnostic || '')) diagnostics.add(delivered.diagnostic);
          if (delivered.skipped) diagnostics.add('delivery-already-claimed');
        } catch(error) {
          result.failed++;
          diagnostics.add(error.diagnostic || (error.name==='TimeoutError'?'request-timeout':'request-failed'));
        }
      }
    }));
    let summary;
    if (!result.accepted && !result.failed) summary='Немає активних підписок. Працівники мають увімкнути сповіщення на своїх пристроях.';
    else summary=`Передано службі сповіщень: ${result.accepted}. Помилок: ${result.failed}.`;
    if (diagnostics.size) summary+=' Код: '+[...diagnostics].join(', ')+'.';
    message(summary);
    return summary;
  } catch (error) { throw Error(errorText(error)); }
}
export function initPush() {
  $('push-enable').addEventListener('click', enable);
  $('push-disable').addEventListener('click', async () => {
    if (busy) return;
    busy = true; draw(true);
    try { await disconnectPush(); message('Сповіщення вимкнено на цьому пристрої.'); }
    catch { message('Не вдалося вимкнути сповіщення. Спробуйте ще раз.'); }
    finally { busy = false; await setPushAccess(permitted); }
  });
  $('push-retry').addEventListener('click', () => setPushAccess(permitted));
}
