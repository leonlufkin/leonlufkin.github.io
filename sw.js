/* Offline-first cache for the whole site.

   Every same-origin GET is answered at once from a cache on the device when it
   is there, and brought up to date from the network in the background. After a
   first visit, pages and assets never wait on the connection, and the site
   opens offline. Nothing is listed here: the cache holds whatever the pages
   requested, plus what site.js asks to have stored after a first visit.

   When a page on the server differs from the copy that was just served, open
   windows are told ({ type: "page-updated", path }) so site.js can show it. */
"use strict";

const CACHE = "site-v1";

// Cache key → the fetch in flight for it. Requests for the same file share one
// fetch, and a file is never written twice at the same time.
const pending = new Map();

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()));
});

function isPage(url) {
  return url.pathname.endsWith("/") || url.pathname.endsWith(".html");
}

// The address a request is stored under, and fetched from.
// - Pages drop their query string (/?ref=… is still the home page), and a
//   directory is its index.html: the home page is kept once, so the copy a
//   reload shows is the one that was just found to have changed.
// - Assets keep their query string, because ?v= names a version.
function keyFor(url) {
  if (!isPage(url)) return url.origin + url.pathname + url.search;
  return url.origin + url.pathname + (url.pathname.endsWith("/") ? "index.html" : "");
}

// Tell open windows that a page changed. `opening` is the window being loaded
// with the old copy, if any: it only counts as a client once it has started,
// and a fast network can answer before that.
async function announce(path, opening) {
  for (let tries = 0; opening && tries < 40 && !(await self.clients.get(opening)); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: "page-updated", path: path });
}

// Fetch `key` and store a complete, successful answer.
async function update(cache, key, opening) {
  const url = new URL(key), page = isPage(url);
  const previous = page ? await cache.match(key) : undefined;
  // Pages are checked with the server every time, so a deploy shows on the
  // next visit; assets follow their HTTP caching.
  const response = await fetch(key, page ? { cache: "no-cache" } : {});
  if (response.status !== 200 || response.redirected || response.type !== "basic") return response;
  await cache.put(key, response.clone());
  if (page) {
    if (previous && (await previous.text()) !== (await response.clone().text())) await announce(url.pathname, opening);
  } else if (url.search) {
    // A new ?v= replaces the copies stored under older ones.
    for (const stored of await cache.keys()) {
      const other = new URL(stored.url);
      if (other.pathname === url.pathname && other.search !== url.search) await cache.delete(stored);
    }
  }
  return response;
}

// Bring `key` up to date, joining the fetch already in flight for it. Resolves
// to the network's answer: take a clone(), others may be waiting for the same.
function refresh(cache, key, opening) {
  let job = pending.get(key);
  if (!job) {
    job = update(cache, key, opening);
    pending.set(key, job);
    const done = () => pending.delete(key);
    job.then(done, done);
  }
  return job;
}

self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || request.headers.has("range")) return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), key = keyFor(url);
    const cached = await cache.match(key);
    const fresh = refresh(cache, key, event.resultingClientId);
    if (!cached) return (await fresh).clone();
    event.waitUntil(fresh.catch(() => {})); // offline: the cached copy stands
    return cached;
  })());
});

// A first visit loads before this worker is in control; site.js then sends the
// URLs it used, and the rest of the site, to be stored for the next one.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "store" || !Array.isArray(data.urls)) return;
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(data.urls.map(async (href) => {
    const url = new URL(href, self.location.href), key = keyFor(url);
    if (url.origin !== self.location.origin || await cache.match(key)) return;
    await refresh(cache, key).catch(() => {});
  }))));
});
