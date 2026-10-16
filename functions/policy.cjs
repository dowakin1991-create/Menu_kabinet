const OWNER_UID = 'yBHHkxuh4OSboz1gGOtZFqmfVHE3';
function eligible(user, role, membership, binding, adminOnly = false) {
  if (!user || user.disabled) return false;
  if (user.uid === OWNER_UID) return true;
  if (!user.emailVerified) return false;
  if (role?.status === 'approved') return true;
  return !adminOnly && typeof membership?.employeeId === 'string' && binding?.uid === user.uid;
}
function subscription(value) {
  const endpoint = value?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) throw Error('Invalid endpoint');
  const url = new URL(endpoint);
  // Do not turn the sender into an arbitrary URL fetcher (SSRF).
  const host = url.hostname;
  const known = host === 'fcm.googleapis.com' || host === 'web.push.apple.com'
    || host === 'updates.push.services.mozilla.com'
    || host.endsWith('.notify.windows.com');
  if (!known || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw Error('Unsupported push service');
  const keys = value.keys;
  if (!keys || !/^[\w-]{87}={0,2}$/.test(keys.p256dh) || !/^[\w-]{22}={0,2}$/.test(keys.auth)) throw Error('Invalid keys');
  const publicKey = Buffer.from(keys.p256dh, 'base64url');
  if (publicKey.length !== 65 || publicKey[0] !== 4 || Buffer.from(keys.auth, 'base64url').length !== 16) throw Error('Invalid keys');
  return {endpoint, keys: {p256dh: keys.p256dh, auth: keys.auth}};
}
module.exports = {eligible, subscription};
