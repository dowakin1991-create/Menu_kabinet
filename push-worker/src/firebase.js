import {createRemoteJWKSet, jwtVerify, importPKCS8, SignJWT} from 'jose';
const certificates = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const OWNER = 'yBHHkxuh4OSboz1gGOtZFqmfVHE3';
let cachedToken, expires = 0, cachedKey, cachedAccount;
export class ApiError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export async function serviceToken(env) {
  if (cachedToken && Date.now() < expires) return cachedToken;
  if (!cachedAccount) {
    cachedAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (cachedAccount.project_id !== env.FIREBASE_PROJECT) throw new ApiError('not-configured', 'Сервіс сповіщень ще не підключено.', 503);
    cachedKey = await importPKCS8(cachedAccount.private_key, 'RS256');
  }
  const assertion = await new SignJWT({scope: 'https://www.googleapis.com/auth/cloud-platform'})
    .setProtectedHeader({alg: 'RS256'}).setIssuer(cachedAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(cachedKey);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new ApiError('unavailable', 'Не вдалося перевірити доступ.', 503);
  const result = await response.json(); cachedToken = result.access_token; expires = Date.now() + (result.expires_in - 60) * 1000;
  return cachedToken;
}
async function google(env, url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(10000), headers: {
    'Authorization': `Bearer ${await serviceToken(env)}`, 'Content-Type': 'application/json'
  }});
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError('unavailable', 'Перевірка прав тимчасово недоступна.', 503);
  return response.json();
}
export async function document(env, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/${path}`;
  const result = await google(env, url);
  if (!result) return null;
  return Object.fromEntries(Object.entries(result.fields || {}).map(([key, value]) => [key, value.stringValue ?? value.booleanValue ?? value.integerValue]));
}
export async function access(env, uid, adminOnly = false, claims) {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) return false;
  const result = await google(env, `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/accounts:lookup`, {
    method: 'POST', body: JSON.stringify({localId: [uid]})
  });
  const user = result?.users?.find(u => u.localId === uid);
  if (!user || user.disabled || (claims && Number(user.validSince || 0) > Number(claims.auth_time || 0))) return false;
  if (uid === OWNER) return true;
  if (!user.emailVerified) return false;
  const role = await document(env, `adminRequests/${encodeURIComponent(uid)}`);
  if (role?.status === 'approved') return true;
  if (adminOnly) return false;
  const team = await document(env, `teamAccess/${encodeURIComponent(uid)}`);
  const id = team?.employeeId;
  if (typeof id !== 'string' || !id || id.length > 128 || id.includes('/')) return false;
  const binding = await document(env, `employeeAccess/${encodeURIComponent(id)}`);
  return binding?.uid === uid;
}
export async function authenticate(request, env, adminOnly = false) {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token.length > 8000) throw new ApiError('unauthenticated', 'Увійдіть у кабінет.', 401);
  let payload;
  try {
    ({payload} = await jwtVerify(token, certificates, {
      algorithms: ['RS256'], audience: env.FIREBASE_PROJECT,
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT}`,
      requiredClaims: ['sub','exp','iat','auth_time']
    }));
  } catch { throw new ApiError('unauthenticated', 'Увійдіть повторно.', 401); }
  if (!await access(env, payload.sub, adminOnly, payload)) throw new ApiError('permission-denied', 'Немає дозволу на цю дію.', 403);
  return payload.sub;
}
