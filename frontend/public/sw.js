/**
 * Naikkan VERSION setiap kali aturan cache di berkas ini berubah.
 *
 * Nama cache diturunkan dari sini, dan `activate` menghapus semua cache yang
 * namanya di luar himpunan versi sekarang. Sebelumnya ketiga nama itu berupa
 * string tetap, jadi cache lama TIDAK PERNAH terbuang: shell aplikasi yang
 * pertama kali tersimpan akan disajikan selamanya, betapa pun seringnya
 * di-deploy.
 */
const VERSION = 'v2';
const CACHE_NAME = `fayolla-${VERSION}`;
const RUNTIME_CACHE = `fayolla-runtime-${VERSION}`;
const API_CACHE = `fayolla-api-${VERSION}`;
const CACHES_SEKARANG = [CACHE_NAME, RUNTIME_CACHE, API_CACHE];

// Essential URLs to cache on install
const ESSENTIAL_URLS = [
  '/',
  '/index.html',
];

/**
 * Benar untuk permintaan dokumen (buka aplikasi, reload, tap notifikasi).
 *
 * Dokumen HTML tidak boleh cache-first. Nama berkas JS/CSS-nya mengandung
 * hash yang berubah tiap build, jadi index.html basi menunjuk chunk yang
 * sudah tidak ada di server. Chunk yang sudah pernah dikunjungi tetap
 * tersaji dari cache sehingga aplikasi tampak sehat — tapi begitu ada
 * `import()` malas ke chunk yang belum pernah diambil (ekspor PDF, sub-layar
 * lazy), permintaannya 404 dan importnya melempar. Gejalanya menyesatkan:
 * "tidak ada jaringan" di perangkat yang jelas online.
 */
function permintaanDokumen(request) {
  return request.mode === 'navigate'
    || (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ESSENTIAL_URLS).catch(() => {
        // Fail silently on install if offline — critical path caches on first success
      });
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !CACHES_SEKARANG.includes(name))
          .map((name) => caches.delete(name)),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin and non-GET requests
  if (!url.origin.includes(location.origin) || request.method !== 'GET') {
    return;
  }

  // API calls: network-first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const cache = caches.open(API_CACHE).then((c) => {
              c.put(request, response.clone());
              return response;
            });
            return cache;
          }
          return response;
        })
        .catch(() => {
          return caches
            .match(request)
            .then((cached) => cached || new Response(null, { status: 503 }));
        }),
    );
    return;
  }

  // Dokumen HTML: network-first, cache cuma jaring pengaman saat offline.
  //
  // Inilah yang menjaga shell tetap segar. Aset lain aman cache-first karena
  // nama berkasnya sudah mengandung hash isi — berkas dengan nama sama tidak
  // pernah berubah isinya — tapi index.html memakai nama tetap, jadi versi
  // cache-nya akan membekukan seluruh aplikasi di build lama.
  if (permintaanDokumen(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const salinan = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, salinan));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/index.html'))
            .then((cached) => cached || new Response(null, { status: 503 })),
        ),
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches
      .match(request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            const cache = caches.open(RUNTIME_CACHE);
            cache.then((c) => c.put(request, response.clone()));
            return response;
          })
          .catch(() => new Response(null, { status: 503 }));
      }),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Fayolla', body: event.data.text() };
    }
  }

  const title = data.title || 'Fayolla';
  const options = {
    body: data.body || 'Pengingat Kebiasaan!',
    icon: '/icons/icon-192.png',
    badge: '/favicon.svg',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
