// Service worker: funcționare offline + verificare expirări în fundal.
importScripts('js/reminder-core.js');

const CACHE = 'bonuri-v2';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/db.js', 'js/parsers.js', 'js/ocr.js',
  'js/reminder-core.js', 'js/sanitize.js', 'js/crypto.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'bonuri-runtime').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // rețea întâi (ca să primești actualizările), cache dacă ești offline
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
  } else if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@tesseract.js-data/')) {
    // datele de limbă pentru OCR sunt mari și nu se schimbă: cache întâi
    e.respondWith(caches.open('bonuri-runtime').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
  }
});

function readReminders() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('bonuri-db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('reminders')) return resolve({ db, list: [] });
      const r = db.transaction('reminders').objectStore('reminders').getAll();
      r.onsuccess = () => resolve({ db, list: r.result });
      r.onerror = () => reject(r.error);
    };
  });
}

async function checkReminders() {
  const { db, list } = await readReminders();
  const due = self.ReminderCore.dueNotifications(list, new Date());
  for (const n of due) {
    await self.registration.showNotification(n.title, { body: n.body, tag: n.key, icon: 'icons/icon-192.png' });
    const r = list.find((x) => x.id === n.id);
    r.notified = [...(r.notified || []), n.key];
    await new Promise((res) => {
      const tx = db.transaction('reminders', 'readwrite');
      tx.objectStore('reminders').put(r);
      tx.oncomplete = res;
      tx.onerror = res;
    });
  }
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'check-reminders') e.waitUntil(checkReminders());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('./'))));
});
