// ─────────────────────────────────────────────────────────────
// Service worker : cache des fichiers du site + notifications (phase 8)
// Changer CACHE_VERSION à chaque mise en ligne pour forcer la mise à jour.
// ─────────────────────────────────────────────────────────────

const CACHE_VERSION = 'ss-v0.2.0'

const FICHIERS_APP = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'calculs.js',
  'profil.js',
  'auth.js',
  'init.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
]

// Librairies externes, mises en cache au premier passage
const CDN_AUTORISES = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(FICHIERS_APP)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cles => Promise.all(cles.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Fichiers du site : réseau d'abord (toujours la dernière version), cache si hors ligne.
  // cache: 'no-cache' force la vérification auprès de GitHub Pages (sinon jusqu'à 10 min d'ancienne version).
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(rep => {
          if (rep.ok) { const copie = rep.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, copie)) }
          return rep
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
    )
    return
  }

  // Librairies CDN : cache d'abord (versions figées)
  if (CDN_AUTORISES.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(enCache => enCache || fetch(req).then(rep => {
        if (rep.ok) { const copie = rep.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, copie)) }
        return rep
      }))
    )
  }
  // Tout le reste (Supabase, API) : jamais mis en cache, données toujours fraîches
})

// ── Notifications push (branchées en phase 8) ────────────────
self.addEventListener('push', event => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch (e) { d = { corps: event.data?.text() } }
  event.waitUntil(self.registration.showNotification(d.titre || 'Suivi santé', {
    body: d.corps || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { page: d.page || 'aujourdhui' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const cible = './#' + (event.notification.data?.page || 'aujourdhui')
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(fenetres => {
      for (const f of fenetres) { f.navigate(cible); return f.focus() }
      return self.clients.openWindow(cible)
    })
  )
})
