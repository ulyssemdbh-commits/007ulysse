const CACHE_NAME = "ulysse-v5";
const STATIC_CACHE = "ulysse-static-v5";
const DYNAMIC_CACHE = "ulysse-dynamic-v5";

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/favicon.png"
];

const API_CACHE_ROUTES = [
  "/api/auth/status",
  "/api/v2/summary/today"
];

self.addEventListener("install", (event) => {
  console.log("[SW] Installing service worker v4");
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.log("[SW] Some static assets failed to cache:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activating service worker v4");
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  
  if (event.request.method !== "GET") {
    return;
  }
  
  if (url.pathname === "/manifest.json") {
    event.respondWith(
      clients.matchAll({ type: "window" }).then((windowClients) => {
        let manifestPath = "/manifest.json";
        for (const client of windowClients) {
          if (client.url.includes("/courses/suguval")) {
            manifestPath = "/manifest-suguval.json";
            break;
          } else if (client.url.includes("/talking")) {
            manifestPath = "/manifest-talking.json";
            break;
          } else if (client.url.includes("/max")) {
            manifestPath = "/manifest-alfred.json";
            break;
          }
        }
        return fetch(manifestPath);
      })
    );
    return;
  }
  
  if (url.pathname.startsWith("/api/")) {
    if (API_CACHE_ROUTES.some(route => url.pathname.includes(route))) {
      event.respondWith(networkFirstWithCache(event.request));
    }
    return;
  }
  
  if (url.pathname.startsWith("/assets/") && url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }
  
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?)$/)) {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }
  
  event.respondWith(networkFirstWithCache(event.request));
});

async function cacheFirstWithNetwork(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log("[SW] Network request failed:", error);
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirstWithCache(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    if (request.mode === "navigate") {
      return caches.match("/");
    }
    
    return new Response(JSON.stringify({ error: "Offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
  
  if (event.data === "clearCache") {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || "Nouvelle notification",
    icon: "/favicon.png",
    badge: "/favicon.png",
    vibrate: [100, 50, 100],
    data: {
      url: data.url || "/"
    },
    actions: data.actions || []
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || "Ulysse", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  
  const url = event.notification.data?.url || "/";
  
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
