export function validateSubscription(sub) {
  if (typeof sub?.endpoint !== 'string' || sub.endpoint.length > 2048) throw Error('Invalid endpoint');
  const url = new URL(sub.endpoint), host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'web.push.apple.com'
    || host === 'updates.push.services.mozilla.com' || host.endsWith('.notify.windows.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw Error('Invalid endpoint');
  const keys = sub.keys;
  if (!keys || !/^[\w-]{87}={0,2}$/.test(keys.p256dh) || !/^[\w-]{22}={0,2}$/.test(keys.auth)) throw Error('Invalid keys');
  const decode = text => atob(text.replace(/-/g,'+').replace(/_/g,'/'));
  const point = decode(keys.p256dh);
  if (point.length !== 65 || point.charCodeAt(0) !== 4 || decode(keys.auth).length !== 16) throw Error('Invalid keys');
  return {endpoint: sub.endpoint, keys: {p256dh: keys.p256dh, auth: keys.auth}};
}
export const deviceId = async endpoint => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint)))].map(b=>b.toString(16).padStart(2,'0')).join('');
