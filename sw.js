/* Service worker: maakt installeren als app mogelijk en laat de lijst ook zonder internet werken.
   Eerst het netwerk (zo zie je altijd de nieuwste versie), zonder verbinding de reservekopie.
   Omslagen komen van Google Books / Open Library en gaan via de gewone browsercache. */
const CACHE = "pb-v2";
const SHELL = ["./", "index.html", "app.js", "data-boeken-1.js", "data-boeken-2.js", "data-boeken-3.js", "data-boeken-4.js", "data-schrijvers.js", "data-wensen.js", "manifest.webmanifest", "img/icon-192.png", "img/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "no-cache" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;   // omslagen: gewone browsercache
  e.respondWith(
    fetch(r.url, { cache: "no-cache", credentials: "same-origin" }).then(res => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
