const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {getAuth} = require('firebase-admin/auth');
const {createHash} = require('node:crypto');
const webpush = require('web-push');
const {eligible, subscription} = require('./policy.cjs');
initializeApp();
const db = getFirestore();
const options = {region: 'europe-west1', maxInstances: 2, concurrency: 10, timeoutSeconds: 120,
  cors: ['https://dowakin1991-create.github.io']};
const hash = endpoint => createHash('sha256').update(endpoint).digest('hex');
async function hasAccess(uid, adminOnly = false) {
  let user;
  try { user = await getAuth().getUser(uid); }
  catch (e) { if (e.code === 'auth/user-not-found') return false; throw e; }
  const [role, team] = await db.getAll(db.doc(`adminRequests/${uid}`), db.doc(`teamAccess/${uid}`));
  const id = team.data()?.employeeId;
  const binding = typeof id === 'string' && id.length <= 128 && !id.includes('/')
    ? (await db.doc(`employeeAccess/${id}`).get()).data() : null;
  return eligible(user, role.data(), team.data(), binding, adminOnly);
}
async function requireAccess(request, adminOnly = false) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Увійдіть у кабінет.');
  if (!await hasAccess(request.auth.uid, adminOnly)) throw new HttpsError('permission-denied', 'Немає доступу до графіка.');
  return request.auth.uid;
}
async function vapid() {
  // Server-only documents: existing catch-all Firestore Rules deny every client.
  return db.runTransaction(async tx => {
    const ref = db.doc('_pushPrivate/vapid');
    const doc = await tx.get(ref);
    if (doc.exists) return doc.data();
    const keys = webpush.generateVAPIDKeys();
    tx.create(ref, keys);
    return keys;
  });
}
exports.pushConfig = onCall(options, async request => {
  await requireAccess(request);
  const {publicKey} = await vapid();
  return {publicKey};
});
exports.pushSubscribe = onCall(options, async request => {
  const uid = await requireAccess(request);
  let sub;
  try { sub = subscription(request.data?.subscription); }
  catch { throw new HttpsError('invalid-argument', 'Некоректна підписка пристрою.'); }
  const ref = db.doc(`_pushDevices/${hash(sub.endpoint)}`);
  await db.runTransaction(async tx => {
    const devices = await tx.get(db.collection('_pushDevices').where('uid', '==', uid));
    if (devices.size >= 10 && !devices.docs.some(d => d.id === ref.id))
      throw new HttpsError('resource-exhausted', 'Ліміт — 10 пристроїв. Вимкніть сповіщення на старому пристрої.');
    // Same endpoint belongs to just one signed-in account at a time.
    tx.set(ref, {uid, subscription: sub, updatedAt: FieldValue.serverTimestamp()});
  });
  return {ok: true};
});
exports.pushUnsubscribe = onCall(options, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Увійдіть.');
  const endpoint = request.data?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) throw new HttpsError('invalid-argument', 'Некоректний пристрій.');
  const ref = db.doc(`_pushDevices/${hash(endpoint)}`);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (doc.data()?.uid === request.auth.uid) tx.delete(ref);
  });
  return {ok: true};
});
exports.pushSchedule = onCall(options, async request => {
  await requireAccess(request, true);
  const month = request.data?.month;
  if (typeof month !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month))
    throw new HttpsError('invalid-argument', 'Некоректний місяць.');
  if (!(await db.doc(`schedules/${month}`).get()).exists)
    throw new HttpsError('failed-precondition', 'Спочатку збережіть графік цього місяця.');
  await db.runTransaction(async tx => {
    const ref = db.doc('_pushPrivate/rate');
    const previous = await tx.get(ref);
    if (Date.now() - (previous.data()?.sentAt || 0) < 60000)
      throw new HttpsError('resource-exhausted', 'Повторне сповіщення можна надіслати через хвилину.');
    tx.set(ref, {sentAt: Date.now()});
  });
  const keys = await vapid();
  const devices = await db.collection('_pushDevices').get();
  const users = new Map();
  const result = {accepted: 0, failed: 0, removed: 0};
  // Deliberately no names, shift dates, receipts or other private content on lock screens.
  const payload = JSON.stringify({title: 'KABINET', body: 'Графік оновлено. Відкрийте кабінет, щоб переглянути зміни.'});
  for (let start = 0; start < devices.docs.length; start += 10) {
    await Promise.all(devices.docs.slice(start, start + 10).map(async doc => {
      const device = doc.data();
      if (!users.has(device.uid)) users.set(device.uid, hasAccess(device.uid));
      if (!await users.get(device.uid)) { await doc.ref.delete(); result.removed++; return; }
      try {
        const sub = subscription(device.subscription);
        await webpush.sendNotification(sub, payload, {
          vapidDetails: {subject: 'mailto:dowakin1991@gmail.com', ...keys},
          TTL: 3600, urgency: 'normal', topic: 'kabinet-schedule', timeout: 8000
        });
        result.accepted++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { await doc.ref.delete(); result.removed++; }
        else result.failed++;
      }
    }));
  }
  // Push provider acceptance is not a delivery/read receipt.
  return result;
});
