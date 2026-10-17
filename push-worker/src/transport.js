// Keep fetch's receiver intact in workerd. Never follow push-service redirects.
export function sendPush(endpoint, payload) {
  return fetch(endpoint, {...payload, redirect: 'manual', signal: AbortSignal.timeout(8000)});
}
