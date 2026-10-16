import {getFunctions, httpsCallable} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import {firebaseApp} from './store.js?v=20261017.1';
import {currentUser} from './auth.js?v=20261017.1';
const functions = getFunctions(firebaseApp, 'europe-west1');
const call = async (name, data = {}) => (await httpsCallable(functions, name, {timeout: name === 'pushSchedule' ? 120000 : 15000})(data)).data;
const $ = id => document.getElementById(id);
const scope = new URL('../', import.meta.url).href;
const deviceKey = 'kabinet-push-user';
let permitted = false, busy = false, registration, publicKey, registeredUid, generation = 0;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const storedUid = () => { try { return localStorage.getItem(deviceKey); } catch { return null; } };
function saveUid(uid) { try { uid ? localStorage.setItem(deviceKey, uid) : localStorage.removeItem(deviceKey); } catch { /* No password/token is stored here. */ } }
function message(text) { if ($('push-status')) $('push-status').textContent = text; }
function errorText(error) {
  if (error.code === 'functions/permission-denied') return 'Адміністратор має надати вам доступ до графіка.';
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
  $('push-enable').hidden = enabled;
  $('push-disable').hidden = !enabled;
  $('push-enable').disabled = busy || !publicKey;
  $('push-disable').disabled = busy;
}
export async function setPushAccess(access) {
  permitted = access;
  const ticket = ++generation;
  $('push-panel').hidden = !access;
  publicKey = null; draw();
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
      message(Notification.permission === 'denied' ? 'Сповіщення заблоковані. Дозвольте їх у налаштуваннях пристрою.' : 'Отримуйте повідомлення, коли адміністратор оновить графік.'); draw(false);
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
export async function notifySchedule(month) {
  try {
    const result = await call('pushSchedule', {month});
    if (!result.accepted && !result.failed) return 'Немає активних підписок. Працівники мають увімкнути сповіщення на своїх пристроях.';
    return `Передано службі сповіщень: ${result.accepted}. Помилок: ${result.failed}. Доставка залежить від пристрою та його налаштувань.`;
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
