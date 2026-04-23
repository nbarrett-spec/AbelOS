// Abel Builder Platform — Service Worker
// Provides offline caching, background sync, and push notification support

const CACHE_NAME = 'abel-platform-v1'
const STATIC_CACHE = 'abel-static-v1'
const API_CACHE = 'abel-api-v1'

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/images/logos/abel-logo.png',
  '/images/logos/abel-logo-full.png',
]

// API routes to cache with network-first strategy
const CACHEABLE_API_PATTERNS = [
  '/api/agent-hub/intelligence/builders',
  '/api/agent-hub/context/daily-brief',
  '/api/agent-hub/tasks',
  '/api/ops/builders',
  // Driver portal — offline-first for the truck cab
  '/api/ops/delivery/today',
  '/api/ops/delivery/', // individual delivery detail (prefix match)
]

// Install — pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('SW: Pre-cache partial failure (non-blocking):', err)
      })
    })
  )
  // Activate immediately, don't wait for old SW to finish
  self.skipWaiting()
})

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      )
    })
  )
  // Take control of all pages immediately
  self.clients.claim()
})

// Fetch — smart caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET requests (POST, PATCH, etc. always go to network)
  if (event.request.method !== 'GET') return

  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') return

  // API requests — Network first, fall back to cache
  if (url.pathname.startsWith('/api/')) {
    const isCacheable = CACHEABLE_API_PATTERNS.some((pattern) =>
      url.pathname.startsWith(pattern)
    )

    if (isCacheable) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            // Cache successful responses
            if (response.ok) {
              const responseClone = response.clone()
              caches.open(API_CACHE).then((cache) => {
                cache.put(event.request, responseClone)
              })
            }
            return response
          })
          .catch(() => {
            // Network failed — try cache
            return caches.match(event.request).then((cached) => {
              if (cached) return cached
              // Return offline JSON response
              return new Response(
                JSON.stringify({ error: 'Offline', offline: true }),
                { headers: { 'Content-Type': 'application/json' } }
              )
            })
          })
      )
      return
    }
    // Non-cacheable API — always network
    return
  }

  // Page navigations — Network first, fall back to cache, then offline page
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the page
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone)
          })
          return response
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached
            // Return a basic offline page
            return new Response(
              `<!DOCTYPE html>
              <html><head><title>Abel Lumber — Offline</title>
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <style>
                body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
                  justify-content: center; min-height: 100vh; margin: 0; background: #f8f9fa; color: #1B4F72; }
                .offline { text-align: center; padding: 2rem; }
                h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
                p { color: #666; }
                button { background: #1B4F72; color: white; border: none; padding: 0.75rem 1.5rem;
                  border-radius: 6px; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
              </style></head>
              <body><div class="offline">
                <h1>You're offline</h1>
                <p>Check your connection and try again.</p>
                <button onclick="location.reload()">Retry</button>
              </div></body></html>`,
              { headers: { 'Content-Type': 'text/html' } }
            )
          })
        })
    )
    return
  }

  // Static assets — Cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        // Cache static assets
        if (response.ok && (url.pathname.match(/\.(js|css|png|jpg|svg|woff2?)$/))) {
          const responseClone = response.clone()
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(event.request, responseClone)
          })
        }
        return response
      })
    })
  )
})

// Push notifications (for future use with agent alerts)
self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const options = {
    body: data.body || '',
    icon: '/images/logos/abel-logo.png',
    badge: '/images/logos/abel-logo.png',
    tag: data.tag || 'abel-notification',
    data: { url: data.url || '/' },
    actions: data.actions || [],
    vibrate: [100, 50, 100],
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Abel Lumber', options)
  )
})

// Notification click — open the relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus()
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(url)
    })
  )
})
