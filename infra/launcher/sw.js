// Service worker for the Futrx IDE launcher. Its job is narrow: make the
// launcher shell installable and openable offline. It deliberately does NOT
// cache or intercept anything under a project path (/<slug>/*, owned by each
// code-server, which registers its own service worker at that deeper scope) or
// the live project list (/api/*). Only the shell document and its own static
// assets are handled here.
const CACHE = "futrx-ide-shell-v3";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];
// Paths this worker is allowed to serve from cache. Everything else falls
// through to the network untouched.
const SHELL_ASSETS = new Set(SHELL.filter((p) => p !== "/" && p !== "/index.html"));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Shell navigation (the launcher itself): network-first so the live project
  // list script is always fresh, cache as an offline fallback.
  if (req.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/", { ignoreSearch: true }).then((r) => r || caches.match("/index.html"))),
    );
    return;
  }

  // Shell static assets: cache-first (they are content-stable, versioned by
  // CACHE name). Never touch project (/<slug>/*) or /api/* requests.
  if (SHELL_ASSETS.has(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })),
    );
  }
});
