/* No offline cache: private schedules and receipts must not be cached here. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  // Accept only validated change codes and build all text/links locally.
  event.waitUntil((async()=>{
    let data;
    try { data=event.data?.json(); } catch {}
    const month=typeof data?.month==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(data.month)?data.month:null;
    const kinds={schedule:'Графік змінено',banquet:'Додано Бенкет',cleaning:'Додано генеральне прибирання','cancel-banquet':'Бенкет скасовано','cancel-cleaning':'Генеральне прибирання скасовано'};
    const notices=Array.isArray(data?.notices)?data.notices.filter(n=>month&&n&&Object.hasOwn(kinds,n.kind)&&Number.isInteger(n.day)&&n.day>0&&n.day<=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()).slice(0,31):[];
    if(!notices.length) return self.registration.showNotification('KABINET',{body:'Графік оновлено. Відкрийте кабінет, щоб переглянути зміни.',icon:new URL('IMG_9802.png',self.registration.scope).href,tag:'kabinet-schedule',renotify:true});
    await Promise.all(notices.map(({kind,day},index)=>{
      const body=`${kinds[kind]} ${String(day).padStart(2,'0')}.${month.slice(5,7)}. Відкрийте, щоб ознайомитися.`;
      const target=new URL(`index.html?month=${month}&day=${day}`,self.registration.scope).href;
      return self.registration.showNotification('KABINET',{body,icon:new URL('IMG_9802.png',self.registration.scope).href,tag:`kabinet-${month}-${day}-${kind}-${index}`,renotify:true,data:{target}});
    }));
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const rawTarget=event.notification.data?.target;
  let target=new URL('index.html',self.registration.scope).href;
  if(typeof rawTarget==='string')try{const candidate=new URL(rawTarget,self.registration.scope);if(candidate.origin===self.location.origin&&candidate.pathname.startsWith(new URL(self.registration.scope).pathname)&&candidate.searchParams.has('month')&&candidate.searchParams.has('day'))target=candidate.href;}catch{}
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
