// Keeps a copy of the app on the phone so it opens with no signal.
// BUILD must match app.js. Bump both on every release.
const BUILD = 14;
const CACHE = 'homesafe-b' + BUILD;
const FILES = ['./', './index.html', './app.js', './app.css', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

// cache:'reload' skips the browser's own HTTP cache, so a new build never gets saved with old files.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache:'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Fresh-first, offline-safe: ask GitHub "has this changed?" (a tiny 304 reply if not).
   If there's no answer within 3s (weak/no signal), use the saved copy instantly. */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // never touch ntfy traffic
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch:true });
    const fresh = fetch(e.request.url, { cache:'no-cache' }).then(res => {
      if (res.ok && res.type === 'basic') cache.put(e.request, res.clone());
      return res;
    });
    if (!cached) return fresh;
    const timeout = new Promise(ok => setTimeout(() => ok(cached), 3000));
    return Promise.race([fresh.catch(() => cached), timeout]);
  })());
});

/* ---------- Notifications ----------
   ntfy sends a push through Apple. We always build the text ourselves from known
   wording, so a fake message can't put links or phone numbers on Mom's lock screen. */
const KINDS = { crescent_moon:['🌙','is staying late for OT'], car:['🚗','is on the way home'], house:['🏠','made it home safe'] };
const NAME_RE = /^([A-Za-z][A-Za-z'-]{0,19}) (?:is staying late|is on the way home|made it home)$/;

// Saves a status update into the phone's own storage (tiny: id, time, tag, title).
function saveToInbox(m){
  return new Promise(ok => {
    try{
      const r = indexedDB.open('homesafe', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('inbox', { keyPath:'id' });
      r.onerror = () => ok();
      r.onsuccess = () => {
        const db = r.result, t = db.transaction('inbox', 'readwrite');
        t.objectStore('inbox').put({ id:m.id, event:'message', time:m.time, tags:m.tags.filter(x => typeof x === 'string').slice(0,5), title:String(m.title || '').slice(0,80) });
        t.oncomplete = () => { db.close(); ok(); }; t.onerror = () => { db.close(); ok(); };
      };
    }catch{ ok(); }
  });
}

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  const m = d && typeof d.message === 'object' && d.message ? d.message : d;
  let title = 'Home Safe', body = 'Open the app to see the latest update.', tag = 'homesafe', save = false;
  if (d && d.event === 'subscription_expiring') {
    body = 'Open Home Safe to keep notifications on.';
  } else if (m && Array.isArray(m.tags)) {
    const t = m.tags.find(x => typeof x === 'string' && Object.hasOwn(KINDS, x));
    if (t) {
      const who = ((typeof m.title === 'string' && m.title.match(NAME_RE)) || [])[1] || 'He';
      title = `${KINDS[t][0]} ${who} ${KINDS[t][1]}`;
      const fmt = ms => new Date(ms).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
      const at = m.tags.map(x => typeof x === 'string' && /^at-(\d{9,10})$/.exec(x)).find(Boolean);
      const server = Number.isFinite(m.time) ? m.time * 1000 : Date.now();
      const orig = at && Number(at[1]) * 1000 <= server + 60000 && Number(at[1]) * 1000 >= server - 86400000 ? Number(at[1]) * 1000 : null;
      body = orig && server - orig > 2*60*1000 ? `Sent at ${fmt(orig)} (weak signal, arrived late)` : fmt(orig || server);
      if (orig) tag = `${t}-${orig}`;   // a retry duplicate replaces, never stacks
      else if (typeof m.id === 'string' && m.id.length < 65) tag = m.id;
      if (typeof m.id === 'string' && m.id.length < 65 && Number.isFinite(m.time)) save = true;
    } else if (m.tags.includes('question')) {
      title = '❓ Mom is asking where you’re at'; body = 'Tap to send her an update 💛'; tag = 'homesafe-ask';
    } else if (m.tags.includes('wave')) {
      title = 'Home Safe test'; body = 'Notifications are working! 💛';
    }
  }
  e.waitUntil((async () => {
    if (save) await saveToInbox(m);
    const wins = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    wins.filter(w => w.url.startsWith(self.registration.scope)).forEach(w => w.postMessage(save ? { type:'saved' } : { type:'ntfy', msg:m }));
    await self.registration.showNotification(title, { body, tag, icon:'icon-192.png', badge:'icon-192.png' });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true })
    .then(w => { w = w.filter(x => x.url.startsWith(self.registration.scope)); return w.length ? w[0].focus() : self.clients.openWindow('./'); }));
});
