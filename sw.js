/* Offline cache for the GMS field monitoring form.
   Update strategy for new deployments:
   - The page itself (navigations) is NETWORK FIRST: online users always get the
     newest deployment immediately; offline users get the cached copy.
   - Static assets (fonts, logos, icons) are STALE WHILE REVALIDATE: served from
     cache instantly, refreshed in the background on every online visit.
   - Browsers re-check this file on each navigation; a changed CACHE version
     installs the new worker, which deletes all older caches on activation.
     Bump CACHE only when the precache list itself changes. */
const CACHE = 'gms-fsm-v6';
const PRECACHE = [
  './',
  'index.html',
  'css/styles.css',
  'js/store.js',
  'js/app.js',
  'manifest.webmanifest',
  'assets/fonts/fonts.css',
  'assets/fonts/roboto-300-latin.woff2',
  'assets/fonts/roboto-300-latin-ext.woff2',
  'assets/fonts/roboto-400-latin.woff2',
  'assets/fonts/roboto-400-latin-ext.woff2',
  'assets/fonts/roboto-400-italic-latin.woff2',
  'assets/fonts/roboto-400-italic-latin-ext.woff2',
  'assets/fonts/roboto-500-latin.woff2',
  'assets/fonts/roboto-500-latin-ext.woff2',
  'assets/fonts/roboto-600-latin.woff2',
  'assets/fonts/roboto-600-latin-ext.woff2',
  'assets/fonts/roboto-700-latin.woff2',
  'assets/fonts/roboto-700-latin-ext.woff2',
  'assets/ESAHF_2024_wordmark_Blue.svg',
  'assets/OCHA_logo_vertical_blue.svg',
  'assets/icons/XLSX-file.svg',
  'assets/icons/Smartphone.svg',
  'assets/icons/Monitoring.svg',
  'assets/icons/Upload.svg',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('index.html', copy));
        return r;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
