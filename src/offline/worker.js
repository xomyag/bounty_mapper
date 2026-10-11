const manifest = JSON.parse('__BM_PRECACHE__')
const prefix = 'bounty-mapper-shell-'
const cacheName = `${prefix}${manifest.version}`
const urls = manifest.urls.map((path) => new URL(path, self.registration.scope).href)
const shell = urls.find((url) => new URL(url).pathname.endsWith('/index.html'))

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName)
      // Include every lazy canvas/editor chunk, even when it has never been opened.
      await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })))
    } catch (error) { await caches.delete(cacheName); throw error }
  })())
  // An update waits for explicit approval; initial installation activates normally.
})
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Other tabs may still be editing with an older lazy chunk. Keep their shell.
    if (clients.length <= 1) {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName).map((name) => caches.delete(name)))
    }
    await self.clients.claim()
  })())
})
self.addEventListener('message', (event) => {
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting())
  if (event.data?.type === 'CACHE_STATUS') event.waitUntil((async () => {
    const exists = await caches.has(cacheName)
    const cache = exists && await caches.open(cacheName)
    const ready = !!cache && (await Promise.all(urls.map((url) => cache.match(url)))).every(Boolean)
    event.ports[0]?.postMessage({ ready, version: manifest.version })
  })())
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  const key = event.request.mode === 'navigate' ? shell : `${url.origin}${url.pathname}`
  const assetsPath = `${new URL(self.registration.scope).pathname}assets/`
  if (!key || (!urls.includes(key) && !url.pathname.startsWith(assetsPath))) return
  event.respondWith((async () => {
    const current = await caches.open(cacheName)
    const cached = await current.match(key)
    // A tab which declined reload can still request its previous hashed chunk.
    return cached ?? await caches.match(key) ?? fetch(event.request)
  })())
})
