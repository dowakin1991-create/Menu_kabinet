/* No offline cache: private schedules and receipts must not be cached here. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  // Fixed safe copy; never trust a push payload to supply links or private content.
  event.waitUntil(self.registration.showNotification('KABINET', {
    body: 'Графік оновлено. Відкрийте кабінет, щоб переглянути зміни.',
    icon: new URL('IMG_9802.png', self.registration.scope).href,
    tag: 'kabinet-schedule', renotify: true
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('index.html', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
