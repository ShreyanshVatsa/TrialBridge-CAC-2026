/*
 * TrialBridge service worker: caches the APP SHELL ONLY (HTML pages, hashed JS/CSS, fonts, icons).
 * It never caches /api/* (AI responses), trial data, models, or anything sent by the user.
 * Intake answers live only in page memory and never pass through this worker.
 */
// scripts/postbuild.ts replaces the placeholder with a hash of the built shell, so every deploy changes
// this file's bytes (the browser then installs the new worker) and gets its own cache name.
const BUILD_ID = "__TB_BUILD_ID__";
const CACHE_PREFIX = "tb-shell-";
const VERSION = CACHE_PREFIX + BUILD_ID;
const SHELL_PAGES = ["/", "/find/", "/trial/", "/privacy/", "/access/", "/methodology/", "/about/", "/for-sites/", "/offline/"];
const SHELL_ASSETS = ["/theme-init.js", "/logo.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // Cache what we can; a missing page must not block installation.
      Promise.all([...SHELL_PAGES, ...SHELL_ASSETS].map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks a waiting worker to take over after the user accepts an update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** Only same-origin GETs for shell resources are handled; everything else goes straight to the network. */
function isShellAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_inline/") ||
    url.pathname.startsWith("/icons/") ||
    SHELL_ASSETS.includes(url.pathname)
  );
}

function isNeverCached(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/data/") ||
    url.pathname.startsWith("/models/") ||
    url.pathname.startsWith("/ort/")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isNeverCached(url)) return;

  if (req.mode === "navigate") {
    // Network first so pages stay fresh; fall back to the cached page, then the offline page.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) || (await caches.match("/offline/")) || Response.error()),
    );
    return;
  }

  if (isShellAsset(url)) {
    // Hashed build assets are immutable: cache first.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
